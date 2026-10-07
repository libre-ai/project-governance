/**
 * Context conformance gate (remise à plat, Domaine D — Contexte agent,
 * 2026-08-18, owner arbitration; docs/method/CONTEXT-TEMPLATE.md).
 *
 * NOT wired into `bun run check` — it is its own standalone CI workflow
 * (`.github/workflows/context-conformance.yml`), like every other required
 * check in this repository's branch protection. A 2026-08-18 survey found
 * ~9-17 line prose stubs with zero `## ` sections on nearly every satellite;
 * the conformance wave that followed brought all 36 registry entries into
 * shape (verified 2026-08-19), which is the precondition
 * `docs/method/CONTEXT-TEMPLATE.md` set for the workflow's `pull_request`
 * trigger and this check becoming required on `governance` via
 * `tools/security/check-branch-protection.ts --fix`.
 *
 * For every entry in `ecosystem/repositories.v1.yaml`, this gate verifies:
 *
 *   1. `AGENTS.md` exists at `main` for every `lifecycle: active` entry.
 *      Absence on a non-active entry is asserted as a pass, never a silent
 *      skip (gate-report's `check()` records it either way). Two standing
 *      exemptions, both asserted, never silently skipped: the
 *      `libre-ai/.github` org-profile (no agent works there), and any
 *      `lifecycle: archived` entry — content frozen read-only cannot be
 *      brought into conformance, so no section, cap, pointer or marker
 *      requirement applies to it (mechanical consequence of the domain D
 *      arbitration, 2026-08-18: a requirement binds only what can still be
 *      edited).
 *   2. The `## ` sections required for the entry's layer (and role, and
 *      lifecycle where the template distinguishes them) are all present.
 *   3. `AGENTS.md` does not exceed the layer's line cap — blocking; there is
 *      never a floor.
 *   4. `AGENTS.md` carries at least one fetchable
 *      `https://(raw.githubusercontent.com|github.com)/libre-ai/(governance|contracts)/`
 *      URL — a prose mention with no URL does not count.
 *   5. `CLAUDE.md` is the byte-exact `@AGENTS.md\n` adapter, present if and
 *      only if `AGENTS.md` is present.
 *   6. The text carries a layer marker (`couche[- ]?[1-4]`, `transverse` or
 *      `moyeu`) matching the entry's registered `layer`.
 *   7. Freshness is informative — except when a repository's `lifecycle`
 *      value in `ecosystem/repositories.v1.yaml` last changed (a real
 *      transition, reconstructed from this file's own local git history)
 *      more recently than `AGENTS.md` was last touched in the target repo:
 *      that specific case is blocking.
 */

import { buildIndex, PRIVATE_CROSS_REPOSITORY_NOTE, type Visibility } from "./build-index";

export interface RegistryEntry {
  readonly repository: string;
  readonly role: string;
  readonly layer: string;
  readonly lifecycle: string;
  readonly visibility?: Visibility;
}

export interface LayerSpec {
  readonly requiredSections: readonly string[];
  readonly maxLines: number;
}

const BASE_SECTIONS = ["Authority", "Boundaries", "Quality gates", "Agents"] as const;
const COUCHE1_ACTIVE_SECTIONS = ["Purpose", "Domain doctrine", "Commands", "Working here"] as const;

/**
 * The template table of docs/method/CONTEXT-TEMPLATE.md, mechanised. A
 * combination the table does not name returns `null` — the caller must fail
 * loudly on that, never guess a spec for a layer/role/lifecycle triple the
 * doctrine has not fixed yet.
 */
export function resolveLayerSpec(
  entry: Pick<RegistryEntry, "layer" | "role" | "lifecycle">,
): LayerSpec | null {
  if (entry.layer === "couche-4") return { requiredSections: BASE_SECTIONS, maxLines: 40 };
  if (entry.layer === "couche-3" || entry.layer === "couche-2") {
    return { requiredSections: BASE_SECTIONS, maxLines: 45 };
  }
  if (entry.layer === "transverse" && entry.role === "authority") {
    return { requiredSections: BASE_SECTIONS, maxLines: 80 };
  }
  if (entry.layer === "transverse") {
    return { requiredSections: BASE_SECTIONS, maxLines: 45 };
  }
  if (entry.layer === "couche-1" && entry.lifecycle === "active") {
    return { requiredSections: COUCHE1_ACTIVE_SECTIONS, maxLines: 60 };
  }
  return null;
}

/** Top-level `## ` headings only — a `### ` subsection never counts. */
export function extractSections(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => /^## /.test(line))
    .map((line) => line.replace(/^## /, "").trim());
}

export function missingSections(required: readonly string[], text: string): string[] {
  const present = new Set(extractSections(text));
  return required.filter((section) => !present.has(section));
}

/** `wc -l` semantics: a single trailing newline is not an extra line. */
export function countLines(text: string): number {
  return text.replace(/\n$/, "").split("\n").length;
}

const AUTHORITY_URL =
  /https:\/\/(raw\.githubusercontent\.com|github\.com)\/libre-ai\/(governance|contracts)\//;

export function hasAuthorityPointer(text: string): boolean {
  return AUTHORITY_URL.test(text);
}

const LAYER_MARKER = /couche[\s-]?([1-4])|transverse|moyeu/gi;

/** Does the text's layer marker match the registry's declared layer — the repository's own, not any layer. */
export function layerMarkerOk(layer: string, text: string): boolean {
  const matches = [...text.matchAll(LAYER_MARKER)];
  if (layer === "transverse") return matches.some((match) => /^transverse$/i.test(match[0]));
  if (layer === "moyeu") return matches.some((match) => /^moyeu$/i.test(match[0]));
  const digit = /^couche-([1-4])$/.exec(layer)?.[1];
  if (digit === undefined) return false;
  return matches.some((match) => match[1] === digit);
}

/** `null` when the CLAUDE.md adapter is correct; otherwise the reason it is not. */
export function claudeAdapterIssue(
  agentsPresent: boolean,
  claudeText: string | null,
): string | null {
  if (!agentsPresent) {
    return claudeText !== null ? "CLAUDE.md exists without an AGENTS.md" : null;
  }
  if (claudeText === null) return "CLAUDE.md is missing while AGENTS.md exists";
  if (claudeText !== "@AGENTS.md\n")
    return "CLAUDE.md is not the byte-exact '@AGENTS.md\\n' adapter";
  return null;
}

export interface LifecycleSample {
  readonly date: string;
  readonly lifecycle: string | undefined;
}

/**
 * The date of the most recent commit where the entry's `lifecycle` value
 * actually changed (old and new both defined and different) — `null` when
 * the value has never changed since the entry first appeared, which is the
 * common case and is never blocking on its own.
 */
export function lastLifecycleTransition(history: readonly LifecycleSample[]): string | null {
  let previous: string | undefined;
  let lastChange: string | null = null;
  for (const sample of history) {
    if (sample.lifecycle !== undefined) {
      if (previous !== undefined && previous !== sample.lifecycle) {
        lastChange = sample.date;
      }
      previous = sample.lifecycle;
    }
  }
  return lastChange;
}

export interface FreshnessOutcome {
  readonly blocking: boolean;
  readonly note: string;
}

export function checkFreshness(
  transitionedOn: string | null,
  agentsLastModifiedOn: string | null,
): FreshnessOutcome {
  if (transitionedOn === null) {
    return {
      blocking: false,
      note:
        agentsLastModifiedOn !== null
          ? `AGENTS.md last touched ${agentsLastModifiedOn}; no recorded lifecycle transition`
          : "no recorded lifecycle transition; AGENTS.md modification date unavailable",
    };
  }
  if (agentsLastModifiedOn === null) {
    return {
      blocking: false,
      note: `lifecycle last transitioned ${transitionedOn}; AGENTS.md modification date unavailable`,
    };
  }
  if (agentsLastModifiedOn < transitionedOn) {
    return {
      blocking: true,
      note: `lifecycle transitioned on ${transitionedOn} but AGENTS.md was not touched since (last modified ${agentsLastModifiedOn})`,
    };
  }
  return {
    blocking: false,
    note: `AGENTS.md last touched ${agentsLastModifiedOn}, at or after the last lifecycle transition (${transitionedOn})`,
  };
}

export function parseRegistry(yamlText: string): RegistryEntry[] {
  return buildIndex(yamlText).repositories.map((entry) => ({
    repository: entry.repository,
    role: entry.role,
    layer: entry.layer,
    lifecycle: entry.lifecycle,
    visibility: entry.visibility,
  }));
}

export function parseHistoricalRegistry(yamlText: string): RegistryEntry[] {
  const document = Bun.YAML.parse(yamlText) as {
    readonly repositories?: readonly Record<string, unknown>[];
  };
  if (!Array.isArray(document.repositories)) return [];
  return document.repositories.flatMap((record) => {
    if (typeof record.repository !== "string" || typeof record.lifecycle !== "string") return [];
    return [
      {
        repository: record.repository,
        role: typeof record.role === "string" ? record.role : "historical-unknown",
        layer: typeof record.layer === "string" ? record.layer : "historical-unknown",
        lifecycle: record.lifecycle,
      },
    ];
  });
}

export interface RepoDocuments {
  readonly agents: string | null;
  readonly claude: string | null;
  /**
   * Set exactly when the AGENTS.md fetch failed without a confirmed answer
   * (rate limit, other 4xx/5xx, network) — never set for a confirmed
   * absence. Optional so existing "confirmed absent" call sites (tests and
   * the archived/org-profile exemptions, which never depend on it) stay as
   * they are; a caller that has an error MUST set it, never leave it
   * implicit as `agents: null`.
   */
  readonly agentsFetchError?: string | null;
  /** Same contract as `agentsFetchError`, for the CLAUDE.md fetch. */
  readonly claudeFetchError?: string | null;
}

export interface FreshnessInputs {
  readonly transitionedOn: string | null;
  readonly agentsLastModifiedOn: string | null;
}

export interface ReviewOutcome {
  readonly failures: readonly string[];
  readonly notes: readonly string[];
  readonly exempt: boolean;
}

const ORG_PROFILE_EXEMPTION = "libre-ai/.github";

export function reviewContext(
  entry: RegistryEntry,
  docs: RepoDocuments,
  freshness: FreshnessInputs,
): ReviewOutcome {
  if (entry.visibility === "private") {
    return { failures: [], notes: [PRIVATE_CROSS_REPOSITORY_NOTE], exempt: true };
  }
  if (entry.repository === ORG_PROFILE_EXEMPTION) {
    return {
      failures: [],
      notes: ["AGENTS.md not required — org-profile exemption (no agent works here)"],
      exempt: true,
    };
  }

  if (entry.lifecycle === "archived") {
    return {
      failures: [],
      notes: ["archived — content frozen read-only, conformance not applicable"],
      exempt: true,
    };
  }

  if (docs.agents === null) {
    if (docs.agentsFetchError) {
      // Distinct from a confirmed absence: the gate could not verify this
      // repository at all (rate limit, other 4xx/5xx, network) — reporting
      // "missing" here would be a false positive that fails every future
      // pull request on a transient condition that has nothing to do with
      // this repository's actual AGENTS.md.
      return {
        failures: [`unable to verify AGENTS.md at main: ${docs.agentsFetchError}`],
        notes: [],
        exempt: false,
      };
    }
    if (entry.lifecycle === "active") {
      return {
        failures: ["AGENTS.md is missing at main (lifecycle=active)"],
        notes: [],
        exempt: false,
      };
    }
    return {
      failures: [],
      notes: [`AGENTS.md not required — lifecycle=${entry.lifecycle}`],
      exempt: false,
    };
  }

  const failures: string[] = [];
  const notes: string[] = [];
  const agents = docs.agents;

  const spec = resolveLayerSpec(entry);
  if (spec === null) {
    failures.push(
      `no context template known for layer=${entry.layer} role=${entry.role} lifecycle=${entry.lifecycle} — docs/method/CONTEXT-TEMPLATE.md needs an entry before this repository can be graded`,
    );
    return { failures, notes, exempt: false };
  }

  const missing = missingSections(spec.requiredSections, agents);
  if (missing.length > 0) {
    failures.push(`missing section(s): ${missing.join(", ")}`);
  }

  const lines = countLines(agents);
  if (lines > spec.maxLines) {
    failures.push(
      `AGENTS.md is ${lines} lines, over the ${spec.maxLines}-line cap for layer=${entry.layer}`,
    );
  }

  if (!hasAuthorityPointer(agents)) {
    failures.push(
      "no fetchable https://(raw.githubusercontent.com|github.com)/libre-ai/(governance|contracts)/ URL found",
    );
  }

  if (docs.claudeFetchError) {
    failures.push(`unable to verify CLAUDE.md at main: ${docs.claudeFetchError}`);
  } else {
    const claudeIssue = claudeAdapterIssue(true, docs.claude);
    if (claudeIssue !== null) failures.push(claudeIssue);
  }

  if (!layerMarkerOk(entry.layer, agents)) {
    failures.push(`text carries no layer marker matching layer=${entry.layer}`);
  }

  const fresh = checkFreshness(freshness.transitionedOn, freshness.agentsLastModifiedOn);
  if (fresh.blocking) failures.push(fresh.note);
  else notes.push(fresh.note);

  return { failures, notes, exempt: false };
}

// --- Effectful shell: gh api + local git plumbing, kept apart from the pure
// core above so every rule is unit-tested without a subprocess. ---

export interface GhFetchResult {
  /** Non-null exactly when the call succeeded. */
  readonly text: string | null;
  /**
   * Non-null exactly when the call could not be answered at all (rate
   * limit, other 4xx/5xx, network) — distinct from a confirmed 404,
   * which is a real "not found" answer, not an error. A caller that
   * collapses this back to `text === null` reproduces the exact bug this
   * type exists to prevent: reporting "AGENTS.md is missing" for a
   * repository the gate never actually managed to ask.
   */
  readonly error: string | null;
}

const NOT_FOUND_PATTERN = /\(HTTP 404\)/;
/** Two retries beyond the first attempt — 1s then 3s — before giving up and reporting unable-to-verify. */
export const RETRY_DELAYS_MS = [1000, 3000];

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ghRaw(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/**
 * Retries a `gh api` call across transient failures (rate limit, other
 * 4xx/5xx, network) so a fleet-wide scan never misreports "missing" for a
 * repository it simply could not reach — same 404-is-an-answer contract as
 * `tools/security/check-branch-protection.ts`'s `ghApi`. A confirmed 404 is
 * never retried; anything else is retried up to `RETRY_DELAYS_MS.length`
 * times before surfacing as `error`.
 */
export async function ghWithRetry(args: string[]): Promise<GhFetchResult> {
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const result = await ghRaw(args);
    if (result.exitCode === 0) return { text: result.stdout, error: null };
    if (NOT_FOUND_PATTERN.test(result.stderr)) return { text: null, error: null };
    lastError = result.stderr.trim() || `gh ${args.join(" ")} failed (exit ${result.exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  return { text: null, error: lastError };
}

export function fetchFile(repository: string, path: string): Promise<GhFetchResult> {
  return ghWithRetry([
    "api",
    `repos/${repository}/contents/${path}?ref=main`,
    "-H",
    "Accept: application/vnd.github.raw+json",
  ]);
}

/**
 * Freshness is informative-only (`checkFreshness` never blocks on a `null`
 * date), so a persistent fetch error degrades to "date unavailable" rather
 * than carrying its own error channel — retried the same as `fetchFile` so
 * the common case (transient rate limit) still recovers.
 */
async function fetchLastCommitDate(repository: string, path: string): Promise<string | null> {
  const { text } = await ghWithRetry([
    "api",
    `repos/${repository}/commits?path=${path}&per_page=1`,
  ]);
  if (text === null) return null;
  try {
    const commits = JSON.parse(text) as ReadonlyArray<{
      readonly commit?: { readonly committer?: { readonly date?: string } };
    }>;
    const date = commits[0]?.commit?.committer?.date;
    return date === undefined ? null : (date.split("T")[0] ?? null);
  } catch {
    return null;
  }
}

// --- GraphQL fleet batch: one request instead of ~70+ REST calls ---
//
// The REST `GITHUB_TOKEN` this workflow runs under is capped per
// installation and shared with every other governance workflow that also
// hits `gh api` (inventory-drift, fleet-pins, feeds-freshness) — under
// concurrent fleet activity the cap is exceeded by construction, observed
// live on 2026-08-19 as "API rate limit exceeded for installation" on every
// repository this gate could not reach in time (see `reviewContext`'s
// `agentsFetchError` branch, added the same day to stop that condition from
// being misreported as "AGENTS.md is missing"). GraphQL draws from a
// separate, points-based quota — batching the whole fleet into one query
// removes the contention instead of only reporting it honestly.

export interface FleetRepoResult {
  readonly agents: GhFetchResult;
  readonly claude: GhFetchResult;
  readonly agentsLastModifiedOn: string | null;
}

function repoAlias(index: number): string {
  return `repo${index}`;
}

/**
 * One `query { repoN: repository(...) { ... } }` block per repository,
 * aliased by index (never by repository name — GraphQL alias syntax
 * disallows the hyphens several repository names carry). Owner/name are
 * JSON-string-literal-escaped, which the GraphQL spec models its String
 * grammar after; `ecosystem/repositories.v1.yaml` is this repository's own
 * trusted registry, not external input, but the escaping costs nothing.
 */
export function buildBatchQuery(repositories: readonly string[]): string {
  const blocks = repositories.map((repository, index) => {
    const separator = repository.indexOf("/");
    if (separator < 0) {
      throw new Error(`malformed repository entry, expected "owner/name": ${repository}`);
    }
    const owner = JSON.stringify(repository.slice(0, separator));
    const name = JSON.stringify(repository.slice(separator + 1));
    return [
      `  ${repoAlias(index)}: repository(owner: ${owner}, name: ${name}) {`,
      `    agents: object(expression: "main:AGENTS.md") { ... on Blob { text } }`,
      `    claude: object(expression: "main:CLAUDE.md") { ... on Blob { text } }`,
      `    defaultBranchRef {`,
      `      target {`,
      `        ... on Commit {`,
      `          history(first: 1, path: "AGENTS.md") { nodes { committedDate } }`,
      `        }`,
      `      }`,
      `    }`,
      `  }`,
    ].join("\n");
  });
  return `query {\n${blocks.join("\n")}\n}`;
}

interface GraphQLBlobNode {
  readonly text?: string | null;
}
interface GraphQLCommitHistoryNode {
  readonly committedDate?: string;
}
interface GraphQLRepoNode {
  readonly agents?: GraphQLBlobNode | null;
  readonly claude?: GraphQLBlobNode | null;
  readonly defaultBranchRef?: {
    readonly target?: {
      readonly history?: { readonly nodes?: readonly GraphQLCommitHistoryNode[] } | null;
    } | null;
  } | null;
}

const GRAPHQL_UNRESOLVED_REPO =
  "repository not resolvable via GraphQL (see check-inventory-drift for real deletions/renames)";

/**
 * `node === null` for an alias means the whole `repository(...)` field came
 * back null — a real NOT_FOUND (verified empirically: `gh api graphql`
 * exits non-zero on a partial NOT_FOUND, but `data` still carries every
 * other alias's full result plus `null` for the missing one), a permissions
 * issue, or (structurally indistinguishable here) a rename. Reported as
 * unable-to-verify rather than "missing AGENTS.md": the repository itself,
 * not one file in it, is what could not be confirmed.
 */
export function parseBatchResponse(
  repositories: readonly string[],
  data: Readonly<Record<string, unknown>> | undefined,
): Map<string, FleetRepoResult> {
  const result = new Map<string, FleetRepoResult>();
  repositories.forEach((repository, index) => {
    const node = (data?.[repoAlias(index)] ?? null) as GraphQLRepoNode | null;
    if (node === null) {
      result.set(repository, {
        agents: { text: null, error: GRAPHQL_UNRESOLVED_REPO },
        claude: { text: null, error: GRAPHQL_UNRESOLVED_REPO },
        agentsLastModifiedOn: null,
      });
      return;
    }
    const commitDate = node.defaultBranchRef?.target?.history?.nodes?.[0]?.committedDate;
    result.set(repository, {
      agents: { text: node.agents?.text ?? null, error: null },
      claude: { text: node.claude?.text ?? null, error: null },
      agentsLastModifiedOn: commitDate !== undefined ? (commitDate.split("T")[0] ?? null) : null,
    });
  });
  return result;
}

export async function ghGraphQLRaw(
  query: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["gh", "api", "graphql", "-F", "query=@-"], {
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

/**
 * `data` is read from stdout regardless of exit code — a partial NOT_FOUND
 * on one alias makes `gh` exit non-zero even though the response carries a
 * complete, usable `data` object for every other alias (verified
 * empirically against the live API). Only a `data`-less response — a
 * genuine transport/rate-limit/auth failure — is retried, twice, before
 * this returns `null` and the caller falls back to `fetchFleetViaRest`.
 */
/**
 * Pure: does this parsed `gh api graphql` response body carry a usable
 * `data` payload? False for a top-level rejection (`{"data": null,
 * "errors": [...]}` — the documented shape of a rate-limited/quota-exhausted
 * response: `data` is present, just explicitly `null`), a response with no
 * `data` key at all, or a non-object body. Treating `data: null` as success
 * would hand `null` to parseBatchResponse, which reads it as "every
 * repository unresolved" in one pass with no retry and no REST fallback —
 * the exact class of incident this file's retry logic exists to prevent,
 * moved from the REST 403 to the GraphQL top-level error.
 */
export function hasUsableGraphQLData(
  parsed: unknown,
): parsed is { readonly data: Record<string, unknown> } {
  if (typeof parsed !== "object" || parsed === null) return false;
  const data = (parsed as { readonly data?: unknown }).data;
  return typeof data === "object" && data !== null;
}

async function fetchFleetViaGraphQL(
  repositories: readonly string[],
): Promise<Map<string, FleetRepoResult> | null> {
  const query = buildBatchQuery(repositories);
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { stdout, stderr, exitCode } = await ghGraphQLRaw(query);
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (hasUsableGraphQLData(parsed)) {
        return parseBatchResponse(repositories, parsed.data);
      }
    } catch {
      // Not valid JSON — fall through to retry/backoff.
    }
    lastError = stderr.trim() || `gh api graphql failed (exit ${exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  console.error(
    `GraphQL fleet batch failed after ${RETRY_DELAYS_MS.length + 1} attempt(s), falling back to per-repository REST: ${lastError}`,
  );
  return null;
}

async function fetchFleetViaRest(
  repositories: readonly string[],
): Promise<Map<string, FleetRepoResult>> {
  const result = new Map<string, FleetRepoResult>();
  for (const repository of repositories) {
    const agents = await fetchFile(repository, "AGENTS.md");
    const claude =
      agents.text !== null ? await fetchFile(repository, "CLAUDE.md") : { text: null, error: null };
    const agentsLastModifiedOn =
      agents.text !== null ? await fetchLastCommitDate(repository, "AGENTS.md") : null;
    result.set(repository, { agents, claude, agentsLastModifiedOn });
  }
  return result;
}

/** GraphQL batch first; per-repository REST only if the whole batch could not be answered at all. */
async function fetchFleetContext(
  repositories: readonly string[],
): Promise<Map<string, FleetRepoResult>> {
  return (await fetchFleetViaGraphQL(repositories)) ?? (await fetchFleetViaRest(repositories));
}

export type FleetContextTransport = (
  repositories: readonly string[],
) => Promise<Map<string, FleetRepoResult>>;

export async function fetchPublicFleetContext(
  registry: readonly RegistryEntry[],
  transport: FleetContextTransport = fetchFleetContext,
): Promise<Map<string, FleetRepoResult>> {
  return transport(
    registry.filter((entry) => entry.visibility !== "private").map((entry) => entry.repository),
  );
}

function sh(argv: string[]): string | null {
  const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) return null;
  return new TextDecoder().decode(result.stdout);
}

/**
 * Reconstruct, from this repository's own local git history (no network),
 * every repository's `lifecycle` value at every commit that touched
 * `ecosystem/repositories.v1.yaml`. One pass over the file's history serves
 * every entry — cheaper than one `git log` per repository, and the history
 * this file carries is already a complete, trustworthy record: it is the
 * registry's own authority.
 */
function buildLifecycleHistory(): Map<string, LifecycleSample[]> {
  const log = sh([
    "git",
    "log",
    "--format=%H|%aI",
    "--reverse",
    "--",
    "ecosystem/repositories.v1.yaml",
  ]);
  const history = new Map<string, LifecycleSample[]>();
  if (log === null) return history;
  const commits = log
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, date] = line.split("|");
      return { sha: sha as string, date: (date as string).split("T")[0] as string };
    });
  for (const { sha, date } of commits) {
    const text = sh(["git", "show", `${sha}:ecosystem/repositories.v1.yaml`]);
    if (text === null) continue;
    let entries: RegistryEntry[];
    try {
      // Historical snapshots predate today's closed lifecycle/role model.
      // Only repository+lifecycle are evidence for transition chronology;
      // applying today's validator would discard the whole old snapshot.
      entries = parseHistoricalRegistry(text);
    } catch {
      continue;
    }
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.repository);
      const list = history.get(entry.repository) ?? [];
      list.push({ date, lifecycle: entry.lifecycle });
      history.set(entry.repository, list);
    }
  }
  return history;
}

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const registry = parseRegistry(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const lifecycleHistory = buildLifecycleHistory();
  const fleetContext = await fetchPublicFleetContext(registry);

  const report = new GateReport();
  for (const entry of registry) {
    // Every entry in `registry` was passed to `fetchFleetContext` above, and
    // both its GraphQL and REST paths set a result for every input
    // repository — this fallback is defensive, not expected to fire, and
    // stays honest (unable-to-verify, never "missing") if it ever does.
    const fetched = fleetContext.get(entry.repository) ?? {
      agents: { text: null, error: "no fetch outcome recorded for this repository" },
      claude: { text: null, error: null },
      agentsLastModifiedOn: null,
    };
    const transitionedOn = lastLifecycleTransition(lifecycleHistory.get(entry.repository) ?? []);

    const outcome = reviewContext(
      entry,
      {
        agents: fetched.agents.text,
        agentsFetchError: fetched.agents.error,
        claude: fetched.claude.text,
        claudeFetchError: fetched.claude.error,
      },
      { transitionedOn, agentsLastModifiedOn: fetched.agentsLastModifiedOn },
    );
    const ok = outcome.failures.length === 0;
    const note = ok
      ? outcome.exempt
        ? outcome.notes.join("; ")
        : [outcome.notes.join("; "), "conforms to CONTEXT-TEMPLATE.md"].filter(Boolean).join(" — ")
      : outcome.failures.join("; ");
    report.check(entry.repository, ok, note);
  }

  concludeGate("Context conformance", report);
}
