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
 * Usage: bun ecosystem/check-inventory-drift.ts   (requires `gh` + GH_TOKEN)
 */

import { buildIndex } from "./build-index";

export const ORGANIZATION = "libre-ai";

export interface DeclaredRepository {
  /** Bare repository name, without the organization prefix. */
  name: string;
  visibility: "public" | "private";
}

export interface LiveRepository {
  /** Bare repository name as listed by the GitHub API. */
  name: string;
  isPrivate: boolean;
}

export interface Reconciliation {
  /** Divergences that must fail the check. */
  drifts: string[];
  /** Consistent-but-unverifiable cases, logged for the record. */
  notes: string[];
}

export function reconcileInventory(
  declared: DeclaredRepository[],
  live: LiveRepository[],
): Reconciliation {
  const drifts: string[] = [];
  const notes: string[] = [];
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
  }

  for (const entry of declared) {
    if (liveByName.has(entry.name)) continue;
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

  return { drifts, notes };
}

/** Two retries beyond the first attempt — 1s then 3s — same budget as ecosystem/check-context-conformance.ts's ghWithRetry. */
const RETRY_DELAYS_MS = [1000, 3000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        ".[] | [.name, (.private | tostring)] | @tsv",
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
          const [name, isPrivate] = line.split("\t");
          if (name === undefined || (isPrivate !== "true" && isPrivate !== "false")) {
            throw new Error(`unexpected gh api output line: ${JSON.stringify(line)}`);
          }
          return { name, isPrivate: isPrivate === "true" };
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

function ghApiGraphQLArgs(): string[] {
  return ["api", "graphql", "-F", "query=@-"];
}

async function ghGraphQLRaw(
  query: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["gh", ...ghApiGraphQLArgs()], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(query);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export function buildOrgRepositoriesQuery(organization: string, cursor: string | null): string {
  const after = cursor === null ? "" : `, after: ${JSON.stringify(cursor)}`;
  return [
    `query {`,
    `  organization(login: ${JSON.stringify(organization)}) {`,
    `    repositories(first: 100${after}) {`,
    `      pageInfo { hasNextPage endCursor }`,
    `      nodes { name isPrivate }`,
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
          } | null)[];
        } | null;
      } | null;
    }
  )?.organization?.repositories;
  if (repositories === undefined || repositories === null) return null;
  const nodes = (repositories.nodes ?? []).filter(
    (node): node is { name: string; isPrivate: boolean } =>
      node !== null && typeof node.name === "string" && typeof node.isPrivate === "boolean",
  );
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

async function fetchLiveRepositories(): Promise<LiveRepository[]> {
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
    return { name, visibility: entry.visibility };
  });

  const { drifts, notes } = reconcileInventory(declared, await fetchLiveRepositories());
  for (const note of notes) console.log(note);
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const report = new GateReport();
  for (const drift of drifts) {
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
  concludeGate("Inventory drift", report);
}
