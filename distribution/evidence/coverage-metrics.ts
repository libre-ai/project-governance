#!/usr/bin/env bun
// Fleet coverage metrics instrument (ADR-0009 §4, invariant I-16).
// Computes the published coverage figures from the observable commit record —
// the human-touch share, the DCO-trailer rate, and the automation coverage
// (their complement). Honest by construction — it reports what the record
// shows, it does not estimate.
//
// Domain A re-ratification (2026-08-18, ADR-0023) — two defects fixed:
//
// 1. HUB COUPLING. This instrument used to default to `libre-ai/libre-ai`
//    and read the repository ONLY via a local `git log` of the invoking
//    checkout — the `repo` argument was a label, not a target. The hub was
//    archived on 2026-07-30 (ecosystem/repositories.v1.yaml, lifecycle:
//    archived); its history is frozen, and it was never the whole fleet even
//    before archival. The instrument now defaults to a FLEET-WIDE snapshot:
//    every `lifecycle: active` entry in ecosystem/repositories.v1.yaml,
//    queried through the GitHub API (`gh api repos/{repo}/commits`) so it
//    works from any checkout, not only a clone of the target repository.
//    Single-repository mode (`bun coverage-metrics.ts <owner/repo>`) still
//    works — through the same API path, so passing the archived hub still
//    reproduces its frozen historical figures on request.
//
// 2. MERGE-DETECTION HEURISTIC. The instrument used to count only 2-parent
//    commits (`git log --merges`) as "merges". Verified empirically against
//    the live fleet on 2026-08-18: governance, notebook and feed-radar
//    overwhelmingly produce 1-parent commits on main (squash-merge is the
//    enforced convention — git-push-merge-guard denies non-squash), with a
//    minority of 2-parent commits from branch-update merges or history
//    grafts (ADR-0020 §2.1/§5.1) — NOT from ordinary PR review. Filtering to
//    parents.length > 1 would silently undercount or zero out every
//    squash-merge repository, which is now all of them. Branch protection
//    forbids a direct push, so every commit reaching `main` already passed
//    the required DCO + review gates before this script ever sees it — the
//    correct population for "was this decision human or machine" is every
//    commit, not only the git-merge-shaped ones.
//
// A merge counts as "human-touched" when its commit message carries the
// maintainer sign-off trailer (the explicit owner-ratification / DCO gate)
// — the only machine-verifiable proxy for a human decision available today.
//
// Usage:
//   bun coverage-metrics.ts                      fleet-wide snapshot: every
//                                                 lifecycle: active repository
//                                                 in ecosystem/repositories.v1.yaml
//   bun coverage-metrics.ts <owner/repo> [max]    one repository (active or
//                                                 archived), via the GitHub API

export interface CommitRecord {
  readonly parentCount: number;
  readonly message: string;
}

export interface RepoCoverage {
  readonly repository: string;
  readonly window: string;
  readonly merges_with_maintainer_signoff: number;
  readonly merges_without_signoff_trailer: number;
  readonly error?: string;
}

const SIGNOFF_PATTERN = /Signed-off-by:\s*Constantin/i;

/**
 * Classifies every commit reaching `main` — not filtered to 2-parent merge
 * commits. See the module docstring, defect 2, for why.
 */
export function classifyCommits(
  repository: string,
  windowLabel: string,
  commits: readonly CommitRecord[],
): RepoCoverage {
  const withTrailer = commits.filter((commit) => SIGNOFF_PATTERN.test(commit.message)).length;
  return {
    repository,
    window: windowLabel,
    merges_with_maintainer_signoff: withTrailer,
    merges_without_signoff_trailer: commits.length - withTrailer,
  };
}

export interface FleetTotals {
  readonly merges_with_maintainer_signoff: number;
  readonly merges_without_signoff_trailer: number;
  readonly total_commits: number;
}

export interface FleetSnapshot {
  readonly schema_version: "libre-ai.coverage-metrics.v2";
  readonly captured_on: string;
  readonly window: string;
  readonly repositories_inspected: number;
  readonly repositories_unreachable: number;
  readonly repositories: readonly RepoCoverage[];
  readonly fleet_totals: FleetTotals;
  readonly genuine_automation_coverage_pct: number;
  readonly definition: string;
  readonly measurement_note: string;
}

const MEASUREMENT_NOTE =
  "the sign-off trailer proxies human touch only after each repository's DCO gate went live " +
  "(governance: 2026-07-19); pre-gate commits lack it but were human-driven, so trailer-absence " +
  "does not mean automated. Every commit reaching main already passed DCO — branch protection " +
  "forbids a direct push — so the split above is diagnostic, not yet a live automation signal: " +
  "the same Signed-off-by trailer is stamped whether a human or an agent acting on the owner's " +
  "behalf performed the git operation (git commit -s carries the owner's identity either way). " +
  "Genuine automation coverage only starts to move once an agent loop merges under its own " +
  "identity with no human decision in the loop (Polaris orchestrator runtime, SPECIFIED-PENDING " +
  "per docs/method/POLARIS.md) — until then this figure is honestly 0 by construction, the floor " +
  "waves 1-3 raise.";

/** Pure aggregation, so the fleet-wide arithmetic is testable without a network call. */
export function aggregateFleet(
  capturedOn: string,
  windowLabel: string,
  perRepo: readonly RepoCoverage[],
): FleetSnapshot {
  const reachable = perRepo.filter((repo) => repo.error === undefined);
  const totals = reachable.reduce<Omit<FleetTotals, "total_commits">>(
    (acc, repo) => ({
      merges_with_maintainer_signoff:
        acc.merges_with_maintainer_signoff + repo.merges_with_maintainer_signoff,
      merges_without_signoff_trailer:
        acc.merges_without_signoff_trailer + repo.merges_without_signoff_trailer,
    }),
    { merges_with_maintainer_signoff: 0, merges_without_signoff_trailer: 0 },
  );
  return {
    schema_version: "libre-ai.coverage-metrics.v2",
    captured_on: capturedOn,
    window: windowLabel,
    repositories_inspected: reachable.length,
    repositories_unreachable: perRepo.length - reachable.length,
    repositories: perRepo,
    fleet_totals: {
      ...totals,
      total_commits: totals.merges_with_maintainer_signoff + totals.merges_without_signoff_trailer,
    },
    genuine_automation_coverage_pct: 0,
    definition:
      "genuine automation = a merge performed by an agent loop with no human decision in the loop",
    measurement_note: MEASUREMENT_NOTE,
  };
}

function gh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  return {
    ok: result.exitCode === 0,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

async function activeRepositories(): Promise<string[]> {
  const inventoryUrl = new URL("../../ecosystem/repositories.v1.yaml", import.meta.url);
  const yamlApi = (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML;
  const document = yamlApi.parse(await Bun.file(inventoryUrl).text()) as {
    repositories: { repository: string; lifecycle: string }[];
  };
  return document.repositories
    .filter((entry) => entry.lifecycle === "active")
    .map((entry) => entry.repository)
    .sort();
}

async function fetchCommits(repository: string, max: number): Promise<CommitRecord[]> {
  const result = gh([
    "api",
    `repos/${repository}/commits?per_page=${max}`,
    "--jq",
    ".[] | [(.parents|length), .commit.message] | @json",
  ]);
  if (!result.ok) {
    throw new Error(result.stderr.trim() || `gh api call failed for ${repository}`);
  }
  return result.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [parentCount, message] = JSON.parse(line) as [number, string];
      return { parentCount, message };
    });
}

async function coverageForRepo(repository: string, max: number): Promise<RepoCoverage> {
  try {
    const commits = await fetchCommits(repository, max);
    return classifyCommits(repository, `last ${commits.length} commit(s) inspected`, commits);
  } catch (error) {
    return {
      repository,
      window: "unreachable",
      merges_with_maintainer_signoff: 0,
      merges_without_signoff_trailer: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

if (import.meta.main) {
  const targetArg = process.argv[2];
  const max = Number(process.argv[3] ?? "100");
  const capturedOn = new Date().toISOString().slice(0, 10);

  const repositories = targetArg ? [targetArg] : await activeRepositories();
  const perRepo: RepoCoverage[] = [];
  for (const repository of repositories) {
    perRepo.push(await coverageForRepo(repository, max));
  }
  const windowLabel = targetArg
    ? (perRepo[0]?.window ?? "unreachable")
    : `last ${max} commit(s) inspected per active repository`;
  const snapshot = aggregateFleet(capturedOn, windowLabel, perRepo);
  console.log(JSON.stringify(snapshot, null, 2));
}
