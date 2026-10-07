/**
 * Fleet presentation gate (γ 3.6, design §6.4/§7.1).
 *
 * For every repository of the topological index that declares a `card`, fetch
 * `project.v1.yaml` and `README.md` at `main` and verify: the card validates
 * against the project.v1 schema, its progress is computable or honestly
 * non-computable, and the README status section between the sentinels is
 * byte-identical to what the card generates. A missing declared card, an
 * invalid card or a divergent README is a failure — generated presentation is
 * never allowed to drift from its authority.
 *
 * The hub (`role: hub`) is exempt from the README check only: its card lives
 * under ecosystem/cards/ and its README is replaced by the migration index as
 * the repository empties. Entries without a `card` field (the org profile)
 * are reported and skipped, never silently ignored.
 */
import { buildIndex, type Visibility } from "./build-index";
import { checkStatusSection, validateCard } from "./project-cards";

export interface FleetEntry {
  readonly repository: string;
  readonly role: string;
  readonly visibility?: Visibility;
  readonly card?: string;
}

export interface RepoDocuments {
  readonly card: string | null;
  readonly readme: string | null;
}

export interface FetchOutcome {
  /** Non-null exactly when the call succeeded and the path exists. */
  readonly text: string | null;
  /**
   * Non-null exactly when the fetch could not be answered at all (rate
   * limit, other 4xx/5xx, network) — distinct from a confirmed absence.
   * Reporting `text === null` alone as "missing" would fail every fleet
   * presentation entry on a transient condition unrelated to any
   * repository's actual card or README.
   */
  readonly error: string | null;
}

export type Fetcher = (repository: string, path: string) => FetchOutcome;

export function reviewRepository(
  entry: FleetEntry,
  fetchFile: Fetcher,
): { readonly failures: readonly string[]; readonly skipped: boolean } {
  if (entry.card === undefined) {
    return { failures: [], skipped: true };
  }
  const failures: string[] = [];
  const cardFetch = fetchFile(entry.repository, entry.card);
  if (cardFetch.error !== null) {
    return {
      failures: [
        `${entry.repository}: unable to verify declared card ${entry.card} — ${cardFetch.error}`,
      ],
      skipped: false,
    };
  }
  if (cardFetch.text === null) {
    return {
      failures: [`${entry.repository}: declared card ${entry.card} is missing at main`],
      skipped: false,
    };
  }
  const cardText = cardFetch.text;
  let card: unknown;
  try {
    card = (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML.parse(cardText);
  } catch (error) {
    return {
      failures: [`${entry.repository}: ${entry.card} is not parseable YAML — ${String(error)}`],
      skipped: false,
    };
  }
  for (const problem of validateCard(card)) {
    failures.push(`${entry.repository}: invalid card — ${problem}`);
  }
  if (failures.length > 0) return { failures, skipped: false };
  if (entry.role === "hub") return { failures, skipped: false };
  const readmeFetch = fetchFile(entry.repository, "README.md");
  if (readmeFetch.error !== null) {
    return {
      failures: [`${entry.repository}: unable to verify README.md — ${readmeFetch.error}`],
      skipped: false,
    };
  }
  if (readmeFetch.text === null) {
    return { failures: [`${entry.repository}: README.md is missing at main`], skipped: false };
  }
  for (const problem of checkStatusSection(readmeFetch.text, card)) {
    failures.push(`${entry.repository}: README status diverges — ${problem}`);
  }
  return { failures, skipped: false };
}

export function parseFleet(yamlText: string): FleetEntry[] {
  return buildIndex(yamlText).repositories;
}

/** Two retries beyond the first attempt — 1s then 3s — same budget as this file's neighbors. */
const RETRY_DELAYS_MS = [1000, 3000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFromGitHubWithRetry(repository: string, path: string): Promise<FetchOutcome> {
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const proc = Bun.spawn(
      [
        "gh",
        "api",
        `repos/${repository}/contents/${path}?ref=main`,
        "-H",
        "Accept: application/vnd.github.raw+json",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode === 0) return { text: stdout, error: null };
    if (stderr.includes("(HTTP 404)")) return { text: null, error: null };
    lastError =
      stderr.trim() || `gh api repos/${repository}/contents/${path} failed (exit ${exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  return { text: null, error: lastError };
}

// --- GraphQL primary path: same escape from the shared REST quota as
// ecosystem/check-context-conformance.ts — one Blob read per file, batched
// across every card-declaring repository in a single request.

async function ghGraphQLRaw(
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

export interface PresentationTarget {
  readonly repository: string;
  readonly card: string;
}

export interface PresentationSources {
  readonly card: FetchOutcome;
  readonly readme: FetchOutcome;
}

export function buildFleetPresentationQuery(targets: readonly PresentationTarget[]): string {
  const blocks = targets.map((target, index) => {
    const separator = target.repository.indexOf("/");
    if (separator < 0) {
      throw new Error(`malformed repository entry, expected "owner/name": ${target.repository}`);
    }
    const owner = JSON.stringify(target.repository.slice(0, separator));
    const name = JSON.stringify(target.repository.slice(separator + 1));
    const cardExpression = JSON.stringify(`main:${target.card}`);
    return [
      `  repo${index}: repository(owner: ${owner}, name: ${name}) {`,
      `    card: object(expression: ${cardExpression}) { ... on Blob { text } }`,
      `    readme: object(expression: "main:README.md") { ... on Blob { text } }`,
      `  }`,
    ].join("\n");
  });
  return `query {\n${blocks.join("\n")}\n}`;
}

const GRAPHQL_UNRESOLVED_REPO =
  "repository not resolvable via GraphQL (see check-inventory-drift for real deletions/renames)";

export function parseFleetPresentationBatchResponse(
  targets: readonly PresentationTarget[],
  data: Readonly<Record<string, unknown>> | undefined,
): Map<string, PresentationSources> {
  const result = new Map<string, PresentationSources>();
  targets.forEach((target, index) => {
    const node = (data?.[`repo${index}`] ?? null) as {
      readonly card?: { readonly text?: string | null } | null;
      readonly readme?: { readonly text?: string | null } | null;
    } | null;
    if (node === null) {
      const outcome: FetchOutcome = {
        text: null,
        error: `${target.repository}: ${GRAPHQL_UNRESOLVED_REPO}`,
      };
      result.set(target.repository, { card: outcome, readme: outcome });
      return;
    }
    result.set(target.repository, {
      card: { text: node.card?.text ?? null, error: null },
      readme: { text: node.readme?.text ?? null, error: null },
    });
  });
  return result;
}

/**
 * Pure: does this parsed `gh api graphql` response body carry a usable
 * `data` payload? False for a top-level rejection (`{"data": null,
 * "errors": [...]}` — the documented shape of a rate-limited/quota-exhausted
 * response), a response with no `data` key at all, or a non-object body.
 * Accepting `data: null` as success would hand `null` to
 * parseFleetPresentationBatchResponse, which reads it as "every repository
 * unresolved" in one pass with no retry and no REST fallback.
 */
export function hasUsableGraphQLData(
  parsed: unknown,
): parsed is { readonly data: Record<string, unknown> } {
  if (typeof parsed !== "object" || parsed === null) return false;
  const data = (parsed as { readonly data?: unknown }).data;
  return typeof data === "object" && data !== null;
}

async function fetchFleetPresentationViaGraphQL(
  targets: readonly PresentationTarget[],
): Promise<Map<string, PresentationSources> | null> {
  const query = buildFleetPresentationQuery(targets);
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { stdout, stderr, exitCode } = await ghGraphQLRaw(query);
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (hasUsableGraphQLData(parsed)) {
        return parseFleetPresentationBatchResponse(targets, parsed.data);
      }
    } catch {
      // Not valid JSON — fall through to retry/backoff.
    }
    lastError = stderr.trim() || `gh api graphql failed (exit ${exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  console.error(
    `GraphQL fleet-presentation batch fetch failed after ${RETRY_DELAYS_MS.length + 1} attempt(s), falling back to per-repository REST: ${lastError}`,
  );
  return null;
}

async function fetchFleetPresentationSources(
  targets: readonly PresentationTarget[],
): Promise<Map<string, PresentationSources>> {
  const viaGraphQL = await fetchFleetPresentationViaGraphQL(targets);
  if (viaGraphQL !== null) return viaGraphQL;
  const result = new Map<string, PresentationSources>();
  for (const target of targets) {
    result.set(target.repository, {
      card: await fetchFromGitHubWithRetry(target.repository, target.card),
      readme: await fetchFromGitHubWithRetry(target.repository, "README.md"),
    });
  }
  return result;
}

if (import.meta.main) {
  const fleet = parseFleet(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const targets: PresentationTarget[] = fleet
    .filter((entry): entry is FleetEntry & { card: string } => entry.card !== undefined)
    .map((entry) => ({ repository: entry.repository, card: entry.card }));
  const fetched = await fetchFleetPresentationSources(targets);

  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const report = new GateReport();
  for (const entry of fleet) {
    if (entry.card === undefined) {
      // Asserted, not silent: "this repository declares no card" is a
      // statement about the repository, and it counts as an inspection.
      report.check(entry.repository, true, "no card declared — nothing to present");
      continue;
    }
    const sources = fetched.get(entry.repository) ?? {
      card: { text: null, error: "no fetch outcome recorded for this repository" },
      readme: { text: null, error: null },
    };
    const fetchFile: Fetcher = (_repository, path) =>
      path === entry.card ? sources.card : sources.readme;
    const review = reviewRepository(entry, fetchFile);
    report.check(
      entry.repository,
      review.failures.length === 0,
      review.failures.length === 0
        ? "card valid, README status coherent"
        : review.failures.join("; "),
    );
  }
  concludeGate("Fleet presentation", report);
}
