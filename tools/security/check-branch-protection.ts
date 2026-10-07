/**
 * Branch protection norm gate (Domain I, Process & CI — ADR-0021-domain-i).
 *
 * A required status check and a CI job are two independent declarations —
 * one in `branches/{branch}/protection`, the other in a workflow file — and
 * nothing kept them in sync. Two ways they drift apart:
 *
 *   - a check is REQUIRED but no longer produced by CI (a job was renamed,
 *     replaced by a reusable-workflow call under a different composite name,
 *     or deleted outright): the required check sits "Expected — waiting for
 *     status" forever, and `website`'s "REUSE compliance" is exactly this —
 *     required, phantom, superseding a job that now reports as
 *     "licensing / Licensing and contribution governance";
 *   - a check RUNS but is not required (a job was added and nobody flipped
 *     the protection setting): it is decorative — its verdict is visible but
 *     never gates a merge, as `db-inspect`'s "Rust quality", "Dependency
 *     policy" and "licensing / Licensing and contribution governance" did
 *     before this gate named them.
 *
 * `--fix` closes both gaps by PATCHing `required_status_checks` to exactly
 * the set of checks CI is observed to produce — the only path this
 * repository's doctrine allows for mutating a branch protection setting
 * (ADR-0021-domain-i D1: no hand PATCH, no `gh api` one-off, no
 * `--admin` merge override; this tool, on a measured gap, or nothing).
 *
 * "What CI actually executes" is read from GitHub's check-runs API on a
 * commit — never by parsing workflow YAML — because a job that exists in a
 * file but never completes (a path filter, a disabled workflow, a typo in
 * `on:`) is exactly the silent gap this gate exists to catch; asking the
 * workflow source what it *intends* to run would launder that gap back in.
 * The commit defaults to the repository's default branch HEAD (the fleet
 * audit use case, D1 chantier 1a) but accepts an explicit `--ref`: read on
 * a pull request's own head commit, it answers "what would protection need
 * to require if this PR were main" — the legitimate way to learn a
 * not-yet-merged check's real name before requiring it, without ever
 * guessing or parsing YAML to predict it.
 *
 * Analysis (`auditProtection`, `computeFix`) is pure and unit-tested; only
 * the CLI touches the network.
 */
import {
  buildIndex,
  type InventoryEntry,
  isPublicCrossRepositoryTarget,
  PRIVATE_CROSS_REPOSITORY_NOTE,
} from "../../ecosystem/build-index";

export interface ProtectionSnapshot {
  /** Required status check contexts, exactly as declared by branch protection. */
  readonly required: readonly string[];
}

export interface CiSnapshot {
  /** Distinct check-run names GitHub reports for the inspected commit. */
  readonly observed: readonly string[];
}

export interface RepositoryAudit {
  readonly repository: string;
  /** Required, but CI does not produce them: a required check that can never pass. */
  readonly phantom: readonly string[];
  /** Produced by CI, but not required: a verdict nothing gates on. */
  readonly decorative: readonly string[];
  readonly ok: boolean;
}

/**
 * Compares declared-required against really-observed for one repository.
 * Order in the inputs carries no meaning; output arrays are sorted so two
 * audits of the same drift are byte-identical, and diff-friendly in a PR.
 */
export function auditProtection(
  repository: string,
  protection: ProtectionSnapshot,
  ci: CiSnapshot,
): RepositoryAudit {
  const requiredSet = new Set(protection.required);
  const observedSet = new Set(ci.observed);
  const phantom = [...requiredSet].filter((check) => !observedSet.has(check)).sort();
  const decorative = [...observedSet].filter((check) => !requiredSet.has(check)).sort();
  return { repository, phantom, decorative, ok: phantom.length === 0 && decorative.length === 0 };
}

/**
 * The corrected required-check list: exactly what CI is observed to run.
 * Deliberately not additive-only and not subtractive-only — a fix that only
 * ever adds would leave phantoms standing forever; one that only ever removes
 * would leave decorative checks unrequired forever. The norm this gate
 * enforces is equality, not a one-directional ratchet.
 */
export function computeFix(ci: CiSnapshot): readonly string[] {
  return [...new Set(ci.observed)].sort();
}

export type FixPlan =
  | { readonly kind: "apply"; readonly contexts: readonly string[] }
  | { readonly kind: "refuse"; readonly reason: string };

/**
 * Guards `computeFix` against emptying a branch's protection outright. CI
 * observing zero check-runs is far more likely a fetch gone wrong (rate
 * limit swallowed as empty, wrong ref, workflows not yet run on a fresh
 * commit) than a repository legitimately deciding to require nothing — and
 * `--fix` must never turn the second failure mode into the first.
 */
export function planFix(protection: ProtectionSnapshot, ci: CiSnapshot): FixPlan {
  const contexts = computeFix(ci);
  if (contexts.length === 0 && protection.required.length > 0) {
    return {
      kind: "refuse",
      reason:
        "CI observed 0 check-runs while protection currently requires " +
        `${protection.required.length} — refusing to fix to empty (likely a fetch problem, not a real drift)`,
    };
  }
  return { kind: "apply", contexts };
}

// ---------------------------------------------------------------------------
// CLI (network I/O — not unit-tested; the logic above is)

interface GhApiResult {
  readonly text: string | null;
  readonly error: string | null;
}

function ghApi(path: string, method: "GET" | "PATCH" = "GET", body?: unknown): GhApiResult {
  const args = ["gh", "api", path, "--method", method];
  if (body !== undefined) args.push("--input", "-");
  const result = Bun.spawnSync(args, {
    stdin: body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body)),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode === 0) return { text: new TextDecoder().decode(result.stdout), error: null };
  const stderr = new TextDecoder().decode(result.stderr).trim();
  // A 404 is an answer (no protection configured) — not read failure. Any
  // other status (rate limit, 5xx, network, auth) must not be read as "no
  // requirement", or an outage would silently green-light every repository.
  if (stderr.includes("(HTTP 404)")) return { text: null, error: null };
  return { text: null, error: stderr === "" ? `gh api ${path} failed` : stderr };
}

export function selectActivePublicRepositories(
  repositories: readonly Pick<InventoryEntry, "repository" | "lifecycle" | "visibility">[],
): string[] {
  return repositories
    .filter((repo) => repo.lifecycle === "active" && isPublicCrossRepositoryTarget(repo))
    .map((repo) => repo.repository);
}

async function loadInventory(): Promise<InventoryEntry[]> {
  return buildIndex(
    await Bun.file(new URL("../../ecosystem/repositories.v1.yaml", import.meta.url)).text(),
  ).repositories;
}

interface FetchedState {
  readonly branch: string;
  readonly strict: boolean;
  readonly hasProtection: boolean;
  readonly protection: ProtectionSnapshot;
  readonly ci: CiSnapshot;
}

function fetchRepositoryState(
  repository: string,
  ref?: string,
): FetchedState | { readonly error: string } {
  const repoInfo = ghApi(`repos/${repository}`);
  if (repoInfo.error !== null)
    return { error: `${repository}: cannot read repository — ${repoInfo.error}` };
  const branch = (JSON.parse(repoInfo.text as string) as { default_branch: string }).default_branch;

  const protectionRaw = ghApi(`repos/${repository}/branches/${branch}/protection`);
  if (protectionRaw.error !== null) {
    return { error: `${repository}: cannot read branch protection — ${protectionRaw.error}` };
  }
  const hasProtection = protectionRaw.text !== null;
  const parsedProtection = hasProtection
    ? (JSON.parse(protectionRaw.text as string) as {
        required_status_checks?: { strict?: boolean; contexts?: string[] };
      })
    : {};
  const required = parsedProtection.required_status_checks?.contexts ?? [];
  const strict = parsedProtection.required_status_checks?.strict ?? true;

  const commitRef = ref ?? branch;
  const commitInfo = ghApi(`repos/${repository}/commits/${encodeURIComponent(commitRef)}`);
  if (commitInfo.error !== null)
    return { error: `${repository}: cannot resolve ${commitRef} — ${commitInfo.error}` };
  if (commitInfo.text === null) return { error: `${repository}: ref ${commitRef} not found` };
  const sha = (JSON.parse(commitInfo.text) as { sha: string }).sha;

  const checkRuns = ghApi(`repos/${repository}/commits/${sha}/check-runs?per_page=100`);
  if (checkRuns.error !== null)
    return { error: `${repository}: cannot read check-runs — ${checkRuns.error}` };
  const runs =
    checkRuns.text === null
      ? []
      : (JSON.parse(checkRuns.text) as { check_runs: { name: string }[] }).check_runs;
  const observed = [...new Set(runs.map((run) => run.name))];

  return { branch, strict, hasProtection, protection: { required }, ci: { observed } };
}

function applyFix(
  repository: string,
  branch: string,
  strict: boolean,
  contexts: readonly string[],
): string | null {
  const result = ghApi(
    `repos/${repository}/branches/${branch}/protection/required_status_checks`,
    "PATCH",
    {
      strict,
      contexts,
    },
  );
  return result.error;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const repoIndex = args.indexOf("--repo");
  const onlyRepo = repoIndex >= 0 ? (args[repoIndex + 1] ?? null) : null;
  const refIndex = args.indexOf("--ref");
  const ref = refIndex >= 0 ? args[refIndex + 1] : undefined;

  if (ref !== undefined && onlyRepo === null) {
    console.error(
      "--ref requires --repo <owner/name>: a ref is only meaningful for one repository",
    );
    process.exit(1);
  }

  const { concludeGate, GateReport } = await import("../quality/gate-report");
  const report = new GateReport();
  const inventory = await loadInventory();
  const privateRepositories = inventory.filter((entry) => entry.visibility === "private");
  const requestedEntry =
    onlyRepo === null ? undefined : inventory.find((entry) => entry.repository === onlyRepo);
  const targets =
    onlyRepo === null
      ? selectActivePublicRepositories(inventory)
      : requestedEntry?.visibility === "public"
        ? [onlyRepo]
        : [];
  if (onlyRepo !== null && requestedEntry === undefined) {
    report.check(onlyRepo, false, "repository is absent from the strict governance inventory");
  }
  for (const entry of privateRepositories) {
    if (onlyRepo === null || onlyRepo === entry.repository) {
      report.check(entry.repository, true, PRIVATE_CROSS_REPOSITORY_NOTE);
    }
  }

  for (const repository of targets) {
    const state = fetchRepositoryState(repository, ref);
    if ("error" in state) {
      report.check(repository, false, state.error);
      continue;
    }
    if (!state.hasProtection) {
      report.check(repository, true, "no branch protection configured — outside this gate's scope");
      continue;
    }
    const audit = auditProtection(repository, state.protection, state.ci);
    if (audit.ok) {
      report.check(
        repository,
        true,
        `${state.protection.required.length} required check(s) match CI exactly`,
      );
      continue;
    }
    const findings: string[] = [];
    for (const name of audit.phantom) findings.push(`required but not produced by CI: "${name}"`);
    for (const name of audit.decorative)
      findings.push(`produced by CI but not required: "${name}"`);

    if (fix) {
      const plan = planFix(state.protection, state.ci);
      if (plan.kind === "refuse") {
        report.check(repository, false, `${findings.join("; ")} — fix refused: ${plan.reason}`);
        continue;
      }
      const fixError = applyFix(repository, state.branch, state.strict, plan.contexts);
      if (fixError !== null) {
        report.check(repository, false, `${findings.join("; ")} — fix failed: ${fixError}`);
      } else {
        report.check(
          repository,
          true,
          `fixed — required now: ${plan.contexts.join(", ") || "(none)"}`,
        );
      }
    } else {
      report.check(repository, false, findings.join("; "));
    }
  }

  concludeGate("Branch protection norm", report);
}
