/**
 * Inventory-vs-GitHub reconciliation (positioning L2).
 *
 * repositories.v1.yaml claims authority over the public topology (ADR-0009
 * §7); an authority that can silently diverge from the observable GitHub
 * organization is worthless. This check compares the inventory with the live
 * org in BOTH directions — presence, name and visibility — and fails on any
 * divergence, so drift blocks the pull request that would ship it instead of
 * waiting for the weekly truth-drift audit.
 *
 * Private repositories: the default CI token only lists public repositories.
 * An entry declared `private` that is NOT observable is therefore consistent,
 * not drift (fail-open on that single case, by design and logged); a declared
 * `private` entry that IS observable as public is a real leak and fails.
 *
 * Lifecycle (ADR-0042 §7, act 3): `lifecycle` is compared with GitHub's
 * archived state in both directions. Before this, an inventory could declare a
 * repository archived while it stayed writable, or GitHub could archive one the
 * inventory still called active, and both read green. Every declared-archived
 * entry yields one named assertion and their count is printed. An archived
 * entry that is not observable is a drift whatever its visibility: the
 * private-fail-open above exists because a private repository is invisible by
 * construction, and extending it to an archived claim would turn "cannot read
 * the archived state" into "the archived state holds".
 *
 * Usage: bun ecosystem/check-inventory-drift.ts   (requires `gh` + GH_TOKEN)
 */

import { buildIndex } from "./build-index";
import { delay, ghGraphQLRaw, RETRY_DELAYS_MS } from "./github-fleet";

export const ORGANIZATION = "libre-ai";

export interface DeclaredRepository {
  /** Bare repository name, without the organization prefix. */
  name: string;
  visibility: "public" | "private";
  lifecycle: "active" | "archived";
}

export interface LiveRepository {
  /** Bare repository name as listed by the GitHub API. */
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
}

/** One per declared-archived entry: the claim, and whether GitHub bears it out. */
export interface ArchivedAssertion {
  name: string;
  holds: boolean;
  evidence: string;
}

export interface Reconciliation {
  /** Divergences that must fail the check. */
  drifts: string[];
  /** Consistent-but-unverifiable cases, logged for the record. */
  notes: string[];
  /** Exactly one entry per repository the inventory declares archived. */
  archived: ArchivedAssertion[];
}

export function reconcileInventory(
  declared: DeclaredRepository[],
  live: LiveRepository[],
): Reconciliation {
  const drifts: string[] = [];
  const notes: string[] = [];
  const archived: ArchivedAssertion[] = [];
  const declaredByName = new Map(declared.map((repo) => [repo.name, repo]));
  const liveByName = new Map(live.map((repo) => [repo.name, repo]));

  for (const repo of live) {
    const entry = declaredByName.get(repo.name);
    if (entry === undefined) {
      drifts.push(
        `DRIFT: repository '${repo.name}' is observable on GitHub but absent from the inventory`,
      );
      continue;
    }
    const liveVisibility = repo.isPrivate ? "private" : "public";
    if (entry.visibility !== liveVisibility) {
      drifts.push(
        `DRIFT: repository '${repo.name}' declared ${entry.visibility} but observable as ${liveVisibility}`,
      );
    }
    if (entry.lifecycle === "archived") {
      if (repo.isArchived) {
        archived.push({
          name: repo.name,
          holds: true,
          evidence: "declared archived and observable as archived",
        });
      } else {
        const drift = `DRIFT: '${repo.name}' declared archived but observable as active`;
        drifts.push(drift);
        archived.push({ name: repo.name, holds: false, evidence: drift });
      }
    } else if (repo.isArchived) {
      drifts.push(`DRIFT: '${repo.name}' is archived on GitHub but declared active`);
    }
  }

  for (const entry of declared) {
    if (liveByName.has(entry.name)) continue;
    if (entry.lifecycle === "archived") {
      // Checked before the private fail-open on purpose: an archived claim that
      // cannot be read is unverified, never consistent.
      const drift = `DRIFT: '${entry.name}' declared archived but not observable — its archived state cannot be verified`;
      drifts.push(drift);
      archived.push({ name: entry.name, holds: false, evidence: drift });
      continue;
    }
    if (entry.visibility === "private") {
      notes.push(
        `NOTE: '${entry.name}' declared private and not observable with this token — consistent, unverifiable here`,
      );
      continue;
    }
    drifts.push(
      `DRIFT: inventory declares '${entry.name}' public but it is not observable (deleted, renamed, or made private)`,
    );
  }

  return { drifts, notes, archived };
}

/**
 * REST fallback, retried but otherwise unchanged. Proved insufficient on
 * its own on 2026-08-19: a single call still failed all 3 attempts within
 * ~5s, in a window independently confirmed to have zero other governance
 * workflow runs in flight — the installation's REST quota was exhausted for
 * a sustained duration, not momentarily contended, so no in-run backoff
 * budget outlasts it. Kept as the last resort if the GraphQL path below
 * (which draws from a separate, points-based quota) cannot be answered
 * either.
 */
async function fetchLiveRepositoriesViaRest(): Promise<LiveRepository[]> {
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const proc = Bun.spawn(
      [
        "gh",
        "api",
        "--paginate",
        `orgs/${ORGANIZATION}/repos?per_page=100`,
        "--jq",
        ".[] | [.name, (.private | tostring), (.archived | tostring)] | @tsv",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [output, errors, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode === 0) {
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [name, isPrivate, isArchived] = line.split("\t");
          if (
            name === undefined ||
            (isPrivate !== "true" && isPrivate !== "false") ||
            (isArchived !== "true" && isArchived !== "false")
          ) {
            throw new Error(`unexpected gh api output line: ${JSON.stringify(line)}`);
          }
          return { name, isPrivate: isPrivate === "true", isArchived: isArchived === "true" };
        });
    }
    // Retried below on any non-zero exit (rate limit, other 4xx/5xx, network)
    // — there is no confirmed-empty-org answer that looks like a failure
    // here (an empty org is exit 0 with no output), so every failure is
    // genuinely transient-or-unverifiable, never a real "zero repositories"
    // answer worth trusting on the first try.
    lastError = errors.trim() || `gh api orgs/${ORGANIZATION}/repos failed (exit ${exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  // Fail closed: an unreachable API must fail the gate — loudly, as "unable
  // to verify" — never silently pass it, and never launder it into a
  // fabricated drift finding (no drift is ever asserted below this point).
  throw new Error(
    `unable to verify the ${ORGANIZATION} organization after ${RETRY_DELAYS_MS.length + 1} attempt(s): ${lastError}`,
  );
}

// --- GraphQL primary path: same escape from the shared REST quota as
// ecosystem/check-context-conformance.ts's fetchFleetViaGraphQL. One
// request per page (the fleet fits in one, verified empirically — 36
// repositories, `hasNextPage: false`) instead of gh api --paginate's many
// sequential REST calls under the hood.

export function buildOrgRepositoriesQuery(organization: string, cursor: string | null): string {
  const after = cursor === null ? "" : `, after: ${JSON.stringify(cursor)}`;
  return [
    `query {`,
    `  organization(login: ${JSON.stringify(organization)}) {`,
    `    repositories(first: 100${after}) {`,
    `      pageInfo { hasNextPage endCursor }`,
    `      nodes { name isPrivate isArchived }`,
    `    }`,
    `  }`,
    `}`,
  ].join("\n");
}

interface GraphQLRepoListPage {
  readonly nodes: readonly LiveRepository[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

/**
 * Pure parse of one page's `data` payload — `null` distinguishes "the
 * response did not carry the shape we asked for" (retry, then fall back)
 * from "the organization has zero repositories on this page" (a real,
 * structurally-present empty `nodes: []`), same 404-is-an-answer contract
 * the rest of this fleet's gates use.
 */
export function parseOrgRepositoriesPage(data: unknown): GraphQLRepoListPage | null {
  const repositories = (
    data as {
      readonly organization?: {
        readonly repositories?: {
          readonly pageInfo?: {
            readonly hasNextPage?: boolean;
            readonly endCursor?: string | null;
          };
          readonly nodes?: readonly ({
            readonly name?: string;
            readonly isPrivate?: boolean;
            readonly isArchived?: boolean;
          } | null)[];
        } | null;
      } | null;
    }
  )?.organization?.repositories;
  if (repositories === undefined || repositories === null) return null;
  // A node without `isArchived` is dropped like any other malformed node: the
  // lifecycle comparison must never read an absent field as "not archived".
  const nodes = (repositories.nodes ?? [])
    .filter(
      (node): node is { name: string; isPrivate: boolean; isArchived: boolean } =>
        node !== null &&
        typeof node.name === "string" &&
        typeof node.isPrivate === "boolean" &&
        typeof node.isArchived === "boolean",
    )
    .map(({ name, isPrivate, isArchived }) => ({ name, isPrivate, isArchived }));
  return {
    nodes,
    hasNextPage: repositories.pageInfo?.hasNextPage ?? false,
    endCursor: repositories.pageInfo?.endCursor ?? null,
  };
}

const MAX_ORG_PAGES = 20; // safety cap: 2000 repositories, far beyond this fleet's real size

async function fetchOrgRepositoriesPage(
  organization: string,
  cursor: string | null,
): Promise<GraphQLRepoListPage | null> {
  const query = buildOrgRepositoriesQuery(organization, cursor);
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { stdout, stderr, exitCode } = await ghGraphQLRaw(query);
    try {
      const parsed = JSON.parse(stdout) as { data?: unknown };
      if (parsed.data !== undefined) {
        const page = parseOrgRepositoriesPage(parsed.data);
        if (page !== null) return page;
      }
    } catch {
      // Not valid JSON (or an unexpected shape) — fall through to retry.
    }
    lastError = stderr.trim() || `gh api graphql failed (exit ${exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  console.error(`GraphQL organization repository page fetch failed after retries: ${lastError}`);
  return null;
}

/** `null` means the listing could not be answered at all — caller falls back to REST, never assumes an empty organization. */
async function fetchLiveRepositoriesViaGraphQL(
  organization: string,
): Promise<LiveRepository[] | null> {
  const collected: LiveRepository[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_ORG_PAGES; page++) {
    const result = await fetchOrgRepositoriesPage(organization, cursor);
    if (result === null) return null;
    collected.push(...result.nodes);
    if (!result.hasNextPage || result.endCursor === null) return collected;
    cursor = result.endCursor;
  }
  return collected;
}

/** Every repository the token can list, fail-closed; shared with check-truth-drift.ts. */
export async function fetchLiveRepositories(): Promise<LiveRepository[]> {
  return (
    (await fetchLiveRepositoriesViaGraphQL(ORGANIZATION)) ?? (await fetchLiveRepositoriesViaRest())
  );
}

if (import.meta.main) {
  const yamlText = await Bun.file(new URL("repositories.v1.yaml", import.meta.url)).text();
  const declared = buildIndex(yamlText).repositories.map((entry) => {
    const [owner, name] = entry.repository.split("/");
    if (owner !== ORGANIZATION || name === undefined || name.length === 0) {
      throw new Error(
        `inventory entry outside the ${ORGANIZATION} organization: ${entry.repository}`,
      );
    }
    return { name, visibility: entry.visibility, lifecycle: entry.lifecycle };
  });

  const live = await fetchLiveRepositories();
  const { drifts, notes, archived } = reconcileInventory(declared, live);
  for (const note of notes) console.log(note);
  const declaredArchived = declared.filter((entry) => entry.lifecycle === "archived").length;
  // One assertion per declared-archived entry, printed whether it holds or not,
  // so the archived claims are counted rather than inferred from silence.
  for (const assertion of archived) {
    console.log(
      `ARCHIVED ${assertion.holds ? "holds" : "FAILS"}: '${assertion.name}' — ${assertion.evidence}`,
    );
  }
  console.log(
    `${archived.length} archived assertion(s) for ${declaredArchived} declared-archived ` +
      `repositor${declaredArchived === 1 ? "y" : "ies"}, ` +
      `${archived.filter((assertion) => assertion.holds).length} holding`,
  );
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const report = new GateReport();
  if (archived.length !== declaredArchived) {
    report.check(
      "archived assertions",
      false,
      `${archived.length} assertion(s) for ${declaredArchived} declared-archived repositories`,
    );
  }
  const archivedDrifts = new Set(
    archived.filter((assertion) => !assertion.holds).map((assertion) => assertion.evidence),
  );
  for (const assertion of archived) {
    report.check(`archived '${assertion.name}'`, assertion.holds, assertion.evidence);
  }
  for (const drift of drifts) {
    // An archived drift is already recorded by its own named assertion above.
    if (archivedDrifts.has(drift)) continue;
    report.check(drift.split(":")[0] ?? drift, false, drift);
  }
  if (drifts.length === 0) {
    // An inventory of zero declared repositories reconciling against a live
    // organization is a broken read, not an agreement.
    report.check(
      `${ORGANIZATION} inventory`,
      declared.length > 0,
      declared.length > 0
        ? `${declared.length} declared repositories match the observable organization`
        : "the inventory declares no repository — the reconciliation asserted nothing",
    );
  }
  report.volume(
    `${declared.length} declared repositor${declared.length === 1 ? "y" : "ies"} reconciled ` +
      `against ${live.length} observed in the ${ORGANIZATION} organization, ` +
      `${archived.length} archived assertion(s), ${drifts.length} drift(s)`,
  );
  concludeGate("Inventory drift", report);
}
