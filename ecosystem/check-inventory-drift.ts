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
 * Every comparison is one assertion. Each declared repository that is
 * observable yields three — presence, visibility, lifecycle — and each
 * divergence is the failing comparison itself, so the assertion count printed
 * on success is the number of facts actually compared, not a summary of them.
 *
 * Private repositories, and the blind spot they leave. The CI workflows run
 * this gate with `GH_TOKEN: ${{ github.token }}` (inventory-drift.yml,
 * truth-drift.yml): an installation token scoped to this repository, which
 * lists the organization's public repositories only. An entry declared
 * `private` and `active` that is NOT observable is therefore counted as
 * UNVERIFIABLE — neither reconciled nor drift — and the success line says so:
 * `N reconciled + M unverifiable (private, token scope) = declared`. Presence,
 * visibility and archived state of such an entry are not read in CI; only an
 * owner-scoped token (`GH_TOKEN=$(gh auth token)`) reads them, and then the
 * entry is reconciled like any other. A declared `private` entry that IS
 * observable as public is a real leak and fails whatever the token.
 *
 * The coupling that keeps that blind spot bounded: build-index.ts admits
 * exactly one private entry (`libre-ai/product-research`), and only with
 * `lifecycle: active`. Nothing here can therefore claim, from CI, that a
 * private repository is archived. If that doctrine constraint is ever lifted,
 * the branch below still fails an archived claim that cannot be read (it is
 * checked before the private case), so CI would turn red rather than green on
 * every such entry until an owner-scoped token is provided.
 *
 * Lifecycle (ADR-0042 §7, act 3): `lifecycle` is compared with GitHub's
 * archived state in both directions. Before this, an inventory could declare a
 * repository archived while it stayed writable, or GitHub could archive one the
 * inventory still called active, and both read green. Every declared-archived
 * entry yields one named assertion and their count is printed. An archived
 * entry that is not observable is a drift whatever its visibility: extending
 * the private case to an archived claim would turn "cannot read the archived
 * state" into "the archived state holds".
 *
 * Reading the organization (adversarial review of PR #48, 2026-10-09). A
 * listing that lost information is unreadable, never a shorter listing: a
 * GraphQL page is rejected when `gh` exits non-zero or `errors` is non-empty,
 * even if `data` is present; a single malformed node, a missing `pageInfo` or
 * a missing `totalCount` makes the page unreadable; the collected listing must
 * have exactly `totalCount` distinct names; an exhausted page budget throws.
 * An unreadable GraphQL answer falls back to REST; if REST cannot answer
 * either, the gate fails as "unable to verify". Before this, a FORBIDDEN node
 * served with exit 1, a node missing `isArchived`, or a page without
 * `pageInfo` each read green with "0 drift(s)".
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

export type ComparisonKind = "presence" | "visibility" | "lifecycle";

/** One compared fact. A failing comparison IS a drift; there is no other kind. */
export interface Comparison {
  name: string;
  kind: ComparisonKind;
  holds: boolean;
  evidence: string;
}

/** How the declared entries split; the four counts are derived independently. */
export interface InventoryPartition {
  /** Declared AND observable: every fact about them was compared. */
  reconciled: number;
  /** Declared private and active, not observable with this token. */
  unverifiable: string[];
  /** Declared, not observable, and not excusable by the token scope (a drift). */
  missing: number;
  declared: number;
}

export interface Reconciliation {
  /** Divergences that must fail the check — the evidence of the failing comparisons. */
  drifts: string[];
  /** Consistent-but-unverifiable cases, logged for the record. */
  notes: string[];
  /** Exactly one entry per repository the inventory declares archived. */
  archived: ArchivedAssertion[];
  /** Every fact compared, in report order. */
  comparisons: Comparison[];
  partition: InventoryPartition;
}

export function reconcileInventory(
  declared: DeclaredRepository[],
  live: LiveRepository[],
): Reconciliation {
  const notes: string[] = [];
  const archived: ArchivedAssertion[] = [];
  const comparisons: Comparison[] = [];
  const unverifiable: string[] = [];
  let missing = 0;
  const declaredByName = new Map(declared.map((repo) => [repo.name, repo]));
  const liveByName = new Map(live.map((repo) => [repo.name, repo]));
  const compare = (name: string, kind: ComparisonKind, holds: boolean, evidence: string) => {
    comparisons.push({ name, kind, holds, evidence });
  };

  for (const repo of live) {
    const entry = declaredByName.get(repo.name);
    if (entry === undefined) {
      compare(
        repo.name,
        "presence",
        false,
        `DRIFT: repository '${repo.name}' is observable on GitHub but absent from the inventory`,
      );
      continue;
    }
    compare(repo.name, "presence", true, "declared and observable");
    const liveVisibility = repo.isPrivate ? "private" : "public";
    compare(
      repo.name,
      "visibility",
      entry.visibility === liveVisibility,
      entry.visibility === liveVisibility
        ? `declared and observable as ${liveVisibility}`
        : `DRIFT: repository '${repo.name}' declared ${entry.visibility} but observable as ${liveVisibility}`,
    );
    if (entry.lifecycle === "archived") {
      if (repo.isArchived) {
        const evidence = "declared archived and observable as archived";
        compare(repo.name, "lifecycle", true, evidence);
        archived.push({ name: repo.name, holds: true, evidence });
      } else {
        const drift = `DRIFT: '${repo.name}' declared archived but observable as active`;
        compare(repo.name, "lifecycle", false, drift);
        archived.push({ name: repo.name, holds: false, evidence: drift });
      }
    } else if (repo.isArchived) {
      compare(
        repo.name,
        "lifecycle",
        false,
        `DRIFT: '${repo.name}' is archived on GitHub but declared active`,
      );
    } else {
      compare(repo.name, "lifecycle", true, "declared active and observable as active");
    }
  }

  for (const entry of declared) {
    if (liveByName.has(entry.name)) continue;
    if (entry.lifecycle === "archived") {
      // Checked before the private case on purpose: an archived claim that
      // cannot be read is unverified, never consistent.
      const drift = `DRIFT: '${entry.name}' declared archived but not observable — its archived state cannot be verified`;
      compare(entry.name, "lifecycle", false, drift);
      archived.push({ name: entry.name, holds: false, evidence: drift });
      missing += 1;
      continue;
    }
    if (entry.visibility === "private") {
      notes.push(
        `NOTE: '${entry.name}' declared private and not observable with this token — presence, visibility and archived state unverifiable here (token scope); an owner-scoped GH_TOKEN reconciles it`,
      );
      unverifiable.push(entry.name);
      continue;
    }
    compare(
      entry.name,
      "presence",
      false,
      `DRIFT: inventory declares '${entry.name}' public but it is not observable (deleted, renamed, or made private)`,
    );
    missing += 1;
  }

  const reconciled = declared.filter((entry) => liveByName.has(entry.name)).length;
  return {
    drifts: comparisons
      .filter((comparison) => !comparison.holds)
      .map((comparison) => comparison.evidence),
    notes,
    archived,
    comparisons,
    partition: { reconciled, unverifiable, missing, declared: declared.length },
  };
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
    `      totalCount`,
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
  /** Repositories the connection announces for this token, across all pages. */
  readonly totalCount: number;
}

/**
 * Pure parse of one page's `data` payload. `null` means "this page did not
 * carry everything we asked for" (retry, then fall back) — distinct from a
 * real, structurally-present empty `nodes: []`. A page is all or nothing:
 * dropping one malformed node would turn "could not read repository X" into
 * "repository X does not exist", which on an undeclared repository is a
 * missed drift and on a declared one is a fabricated one.
 */
export function parseOrgRepositoriesPage(data: unknown): GraphQLRepoListPage | null {
  const repositories = (
    data as {
      readonly organization?: {
        readonly repositories?: {
          readonly totalCount?: unknown;
          readonly pageInfo?: {
            readonly hasNextPage?: unknown;
            readonly endCursor?: unknown;
          } | null;
          readonly nodes?: unknown;
        } | null;
      } | null;
    }
  )?.organization?.repositories;
  if (repositories === undefined || repositories === null) return null;
  const { totalCount, pageInfo, nodes } = repositories;
  if (typeof totalCount !== "number" || !Number.isInteger(totalCount) || totalCount < 0) {
    return null;
  }
  // A missing pageInfo must never read as "last page": that is how a
  // truncated listing would pass for a complete one.
  if (pageInfo === undefined || pageInfo === null) return null;
  const { hasNextPage, endCursor } = pageInfo;
  if (typeof hasNextPage !== "boolean") return null;
  if (endCursor !== null && typeof endCursor !== "string") return null;
  if (hasNextPage && endCursor === null) return null;
  if (!Array.isArray(nodes)) return null;
  const parsed: LiveRepository[] = [];
  for (const node of nodes as unknown[]) {
    const candidate = node as {
      readonly name?: unknown;
      readonly isPrivate?: unknown;
      readonly isArchived?: unknown;
    } | null;
    // The lifecycle comparison must never read an absent field as "not
    // archived", nor a null node (FORBIDDEN on one repository) as absent.
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      typeof candidate.name !== "string" ||
      candidate.name.length === 0 ||
      typeof candidate.isPrivate !== "boolean" ||
      typeof candidate.isArchived !== "boolean"
    ) {
      return null;
    }
    parsed.push({
      name: candidate.name,
      isPrivate: candidate.isPrivate,
      isArchived: candidate.isArchived,
    });
  }
  return { nodes: parsed, hasNextPage, endCursor, totalCount };
}

export interface GraphQLRawResponse {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type PageReading =
  | { readonly ok: true; readonly page: GraphQLRepoListPage }
  | { readonly ok: false; readonly reason: string };

/**
 * One raw `gh api graphql` answer → a page, or the reason it is unusable.
 *
 * `ghGraphQLRaw` documents that other gates read `data` regardless of the exit
 * code, because their multi-alias batches tolerate a NOT_FOUND on one alias.
 * This query has a single root field: any error belongs to the listing itself
 * (a FORBIDDEN node, a SAML-protected repository, a timeout), so a non-zero
 * exit or a non-empty `errors` makes the whole answer unusable even when a
 * `data` object came with it.
 */
export function readOrgRepositoriesResponse(raw: GraphQLRawResponse): PageReading {
  let parsed: { data?: unknown; errors?: unknown };
  try {
    parsed = JSON.parse(raw.stdout) as { data?: unknown; errors?: unknown };
  } catch {
    return { ok: false, reason: raw.stderr.trim() || `gh api graphql: body is not JSON` };
  }
  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, reason: "gh api graphql: body is not a JSON object" };
  }
  if (parsed.errors !== undefined && parsed.errors !== null) {
    if (!Array.isArray(parsed.errors)) {
      return { ok: false, reason: "GraphQL errors: not an array" };
    }
    if (parsed.errors.length > 0) {
      const described = (parsed.errors as { type?: unknown; message?: unknown }[]).map((error) =>
        [error?.type, error?.message]
          .filter((part) => typeof part === "string" && part.length > 0)
          .join(": "),
      );
      return { ok: false, reason: `GraphQL errors: ${described.join("; ")}` };
    }
  }
  if (raw.exitCode !== 0) {
    return {
      ok: false,
      reason: raw.stderr.trim() || `gh api graphql failed (exit ${raw.exitCode})`,
    };
  }
  const page = parseOrgRepositoriesPage(parsed.data);
  if (page === null) {
    return {
      ok: false,
      reason:
        "response did not carry the requested shape (totalCount, pageInfo, and every node with name, isPrivate and isArchived)",
    };
  }
  return { ok: true, page };
}

export type GraphQLRunner = (query: string) => Promise<GraphQLRawResponse>;

/** The effects `fetchLiveRepositories` needs, injectable so its contract is testable. */
export interface FetchDependencies {
  readonly graphql: GraphQLRunner;
  readonly rest: () => Promise<LiveRepository[]>;
  readonly retryDelaysMs: readonly number[];
}

const DEFAULT_DEPENDENCIES: FetchDependencies = {
  graphql: ghGraphQLRaw,
  rest: fetchLiveRepositoriesViaRest,
  retryDelaysMs: RETRY_DELAYS_MS,
};

const MAX_ORG_PAGES = 20; // safety cap: 2000 repositories, far beyond this fleet's real size

async function fetchOrgRepositoriesPage(
  organization: string,
  cursor: string | null,
  dependencies: FetchDependencies,
): Promise<GraphQLRepoListPage | null> {
  const query = buildOrgRepositoriesQuery(organization, cursor);
  let lastError = "";
  for (let attempt = 0; attempt <= dependencies.retryDelaysMs.length; attempt++) {
    const reading = readOrgRepositoriesResponse(await dependencies.graphql(query));
    if (reading.ok) return reading.page;
    lastError = reading.reason;
    const wait = dependencies.retryDelaysMs[attempt];
    if (wait !== undefined) await delay(wait);
  }
  console.error(`GraphQL organization repository page fetch failed after retries: ${lastError}`);
  return null;
}

/**
 * `null` means a page could not be read — the caller falls back to REST, never
 * assumes a shorter organization. A listing that reads but does not add up
 * (count, duplicates, page budget) throws: that is an inconsistent answer, not
 * an unavailable one, and no fallback should be allowed to paper over it.
 */
async function fetchLiveRepositoriesViaGraphQL(
  organization: string,
  dependencies: FetchDependencies,
): Promise<LiveRepository[] | null> {
  const collected: LiveRepository[] = [];
  const seen = new Set<string>();
  let announced: number | null = null;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_ORG_PAGES; page++) {
    const result = await fetchOrgRepositoriesPage(organization, cursor, dependencies);
    if (result === null) return null;
    if (announced === null) announced = result.totalCount;
    for (const node of result.nodes) {
      if (seen.has(node.name)) {
        throw new Error(
          `unable to verify the ${organization} organization: repository '${node.name}' listed twice across pages`,
        );
      }
      seen.add(node.name);
      collected.push(node);
    }
    if (!result.hasNextPage) {
      if (collected.length !== announced) {
        throw new Error(
          `unable to verify the ${organization} organization: collected ${collected.length} repositories but the organization announced ${announced} (totalCount)`,
        );
      }
      return collected;
    }
    cursor = result.endCursor;
  }
  throw new Error(
    `unable to verify the ${organization} organization: page budget exhausted after ${MAX_ORG_PAGES} pages with more announced`,
  );
}

/** Every repository the token can list, fail-closed; shared with check-truth-drift.ts. */
export async function fetchLiveRepositories(
  dependencies: FetchDependencies = DEFAULT_DEPENDENCIES,
): Promise<LiveRepository[]> {
  return (
    (await fetchLiveRepositoriesViaGraphQL(ORGANIZATION, dependencies)) ??
    (await dependencies.rest())
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
  const { drifts, notes, archived, comparisons, partition } = reconcileInventory(declared, live);
  for (const note of notes) console.log(note);
  const declaredArchived = declared.filter((entry) => entry.lifecycle === "archived").length;
  // One line per declared-archived entry, printed whether it holds or not, so
  // the archived claims are counted rather than inferred from silence.
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
  for (const comparison of comparisons) {
    report.check(`${comparison.kind} '${comparison.name}'`, comparison.holds, comparison.evidence);
  }
  // The partition is the volume claim made checkable: every declared entry is
  // either reconciled, unverifiable for a stated reason, or a counted drift.
  // An inventory of zero entries reconciling against a live organization is a
  // broken read, not an agreement.
  const accounted = partition.reconciled + partition.unverifiable.length + partition.missing;
  report.check(
    `${ORGANIZATION} inventory partition`,
    partition.declared > 0 && accounted === partition.declared,
    partition.declared === 0
      ? "the inventory declares no repository — the reconciliation asserted nothing"
      : `${partition.reconciled} reconciled + ${partition.unverifiable.length} unverifiable + ` +
          `${partition.missing} missing = ${accounted}, for ${partition.declared} declared`,
  );
  const undeclaredObserved = live.filter(
    (repository) => !declared.some((entry) => entry.name === repository.name),
  ).length;
  report.volume(
    `${partition.reconciled} reconciled + ${partition.unverifiable.length} unverifiable ` +
      `(private, token scope)` +
      (partition.missing > 0 ? ` + ${partition.missing} missing` : "") +
      ` = ${partition.declared} declared; ${live.length} observed in the ${ORGANIZATION} ` +
      `organization (${undeclaredObserved} undeclared); ${comparisons.length} comparison(s), ` +
      `${archived.length} archived assertion(s), ${drifts.length} drift(s)`,
  );
  concludeGate("Inventory drift", report);
}
