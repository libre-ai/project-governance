/**
 * Dependabot conformance gate (owner decision 2026-09-07: "restore Dependabot
 * everywhere through a governance template").
 *
 * Context: `.github/dependabot.yml` survived on one repository out of 36
 * (`libre-ai/notebook`) — it was removed from every other one with the
 * legacy tree on 2026-07-30, and 13 orphaned Dependabot pull requests were
 * closed on 2026-09-07. A configuration restored by hand, repository by
 * repository, drifts the same way the AGENTS.md stubs did before
 * `check-context-conformance`; this gate makes the template the only
 * authority.
 *
 * For every entry in `ecosystem/repositories.v1.yaml`, this gate verifies:
 *
 *   1. `lifecycle: archived` entries are exempt — asserted, never silently
 *      skipped: an archived repository refuses every write, so no
 *      configuration can be brought into conformance there.
 *   2. The manifest set at `main` selects the template variant
 *      (`selectVariant`): github-actions always, cargo when `Cargo.toml`
 *      exists. A manifest set with no published variant fails loudly — the
 *      gate never guesses a configuration. `package.json` selects nothing
 *      since the owner decision of 2026-09-08: Dependabot's bun updater
 *      reads bun.lock lockfileVersion 1 only ("Unsupported bun.lock
 *      'lockfileVersion' 2 in /bun.lock. The bun version Dependabot runs
 *      supports up to 1.", governance run 34139635260) while every fleet
 *      lockfile is version 2 (bun 1.4) — a bun entry is a permanent job
 *      error that opens no pull request. Upstream: dependabot-core#16026.
 *      The test suite asserts that no variant declares the bun ecosystem;
 *      reintroducing it is an owner decision, not a template edit.
 *   3. `.github/dependabot.yml` exists at `main` and is byte-exact to the
 *      selected variant in `distribution/templates/dependabot/`. A drift
 *      names the variant and the first differing line, so the fleet wave
 *      that fixes it needs no second look.
 *   4. A repository the gate could not reach (rate limit, NOT_FOUND,
 *      network) is reported as unable-to-verify — never as "missing": the
 *      distinction `check-context-conformance` learned on 2026-08-19.
 *
 * Why variants rather than one file declaring every ecosystem: Dependabot
 * runs one job per `updates` entry and raises `DependencyFileNotFound`
 * ("Repo must contain a Cargo.toml.") for an ecosystem whose manifest is
 * absent — recorded as a job error in the repository's Dependabot tab, not
 * blocking the other entries, but a permanent red that proves nothing
 * (dependabot-core `updater/lib/dependabot/file_fetcher_command.rb`,
 * `cargo/lib/dependabot/cargo/file_fetcher.rb`). A variant per manifest set
 * keeps every job green by construction.
 *
 * Fetching reuses `check-context-conformance`'s GraphQL batch (one request
 * for the whole fleet, points-based quota) with its retry and REST fallback,
 * for the reason documented there: the REST quota is shared with every
 * other governance workflow and was exhausted live on 2026-08-19.
 */

import { PRIVATE_CROSS_REPOSITORY_NOTE } from "./build-index";
import {
  delay,
  fetchFile,
  type GhFetchResult,
  ghGraphQLRaw,
  ghWithRetry,
  hasUsableGraphQLData,
  parseRegistry,
  RETRY_DELAYS_MS,
  type RegistryEntry,
  type ReviewOutcome,
} from "./check-context-conformance";

export const TEMPLATE_VARIANTS = ["github-actions", "cargo"] as const;
export type TemplateVariant = (typeof TEMPLATE_VARIANTS)[number];
export type DependabotTemplates = Readonly<Record<TemplateVariant, string>>;

const TEMPLATE_DIRECTORY = "distribution/templates/dependabot";
const CONFIG_PATH = ".github/dependabot.yml";

export async function loadTemplates(): Promise<DependabotTemplates> {
  const entries = await Promise.all(
    TEMPLATE_VARIANTS.map(async (variant) => {
      const url = new URL(`../${TEMPLATE_DIRECTORY}/${variant}.yml`, import.meta.url);
      return [variant, await Bun.file(url).text()] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<TemplateVariant, string>;
}

export interface ManifestPresence {
  readonly workflows: boolean;
  readonly cargoToml: boolean;
}

/**
 * The manifest set → variant table. `null` for a set no variant covers: the
 * caller fails loudly on it, never picks a "closest" template. github-actions
 * is the floor of every variant because every fleet repository runs the
 * governance gates through `.github/workflows`; a repository without that
 * directory has no variant on purpose — it is not a fleet member yet.
 * Cargo.toml is the only other selector (see the header: no bun variant).
 */
export function selectVariant(manifests: ManifestPresence): TemplateVariant | null {
  if (!manifests.workflows) return null;
  if (manifests.cargoToml) return "cargo";
  return "github-actions";
}

export interface TemplateParts {
  /** Everything up to and including the `updates:` line. */
  readonly header: string;
  /** `package-ecosystem` values in declaration order. */
  readonly ecosystems: readonly string[];
  /** Ecosystem → its full `  - package-ecosystem:` block, verbatim. */
  readonly blocks: ReadonlyMap<string, string>;
}

const UPDATES_MARKER = "\nupdates:\n";
const BLOCK_START = "  - package-ecosystem: ";

/**
 * Splits a variant into its header and per-ecosystem blocks so the test
 * suite can assert what the byte-exact comparison cannot express on its own:
 * the committed files are one template, not several — same header, an
 * ecosystem block identical wherever it appears, and no bun block anywhere.
 */
export function splitTemplate(text: string): TemplateParts {
  const marker = text.indexOf(UPDATES_MARKER);
  if (marker < 0) throw new Error("template has no top-level `updates:` line");
  const header = text.slice(0, marker + UPDATES_MARKER.length);
  const body = text.slice(marker + UPDATES_MARKER.length);
  const blocks = new Map<string, string>();
  const ecosystems: string[] = [];
  const starts = [...body.matchAll(/^ {2}- package-ecosystem: (\S+)$/gm)];
  starts.forEach((match, index) => {
    const next = starts[index + 1];
    const block = body.slice(match.index, next === undefined ? body.length : next.index);
    const ecosystem = match[1] as string;
    if (!block.startsWith(BLOCK_START)) throw new Error(`malformed block for ${ecosystem}`);
    ecosystems.push(ecosystem);
    blocks.set(ecosystem, block);
  });
  return { header, ecosystems, blocks };
}

export interface LineDifference {
  /** 1-based, in the expected text's numbering. */
  readonly line: number;
  readonly expected: string;
  readonly actual: string;
}

const END_OF_FILE = "<end of file>";

/**
 * `null` when the texts are byte-identical; otherwise the first line that
 * differs. Lines are compared after a split on `\n` only, so a `\r` or a
 * missing final newline is a difference like any other — "byte-exact" means
 * exactly that, and a wave that pastes the template must reproduce it whole.
 */
export function firstDifference(expected: string, actual: string): LineDifference | null {
  if (expected === actual) return null;
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < length; index++) {
    const left = expectedLines[index];
    const right = actualLines[index];
    if (left !== right) {
      return {
        line: index + 1,
        expected: left ?? END_OF_FILE,
        actual: right ?? END_OF_FILE,
      };
    }
  }
  // Unreachable in practice: unequal strings differ on some line. Kept so the
  // function is total for the type checker without an assertion.
  return { line: length, expected: END_OF_FILE, actual: END_OF_FILE };
}

export interface RepoDependabotState {
  readonly config: GhFetchResult;
  /** `null` exactly when the repository could not be reached at all. */
  readonly manifests: ManifestPresence | null;
  /** Set exactly when the repository could not be verified — never for a confirmed absence. */
  readonly fetchError: string | null;
}

export function reviewDependabot(
  entry: RegistryEntry,
  state: RepoDependabotState,
  templates: DependabotTemplates,
): ReviewOutcome {
  if (entry.visibility === "private") {
    return { failures: [], notes: [PRIVATE_CROSS_REPOSITORY_NOTE], exempt: true };
  }
  if (entry.lifecycle === "archived") {
    return {
      failures: [],
      notes: ["archived — content frozen read-only, conformance not applicable"],
      exempt: true,
    };
  }

  if (state.fetchError !== null || state.manifests === null) {
    return {
      failures: [
        `unable to verify ${CONFIG_PATH} at main: ${state.fetchError ?? "no manifest information recorded"}`,
      ],
      notes: [],
      exempt: false,
    };
  }

  const variant = selectVariant(state.manifests);
  if (variant === null) {
    return {
      failures: [
        `no template variant published for manifest set ${JSON.stringify(state.manifests)} — add one in ${TEMPLATE_DIRECTORY}/ before this repository can be graded`,
      ],
      notes: [],
      exempt: false,
    };
  }
  const templatePath = `${TEMPLATE_DIRECTORY}/${variant}.yml`;

  if (state.config.error !== null) {
    return {
      failures: [`unable to verify ${CONFIG_PATH} at main: ${state.config.error}`],
      notes: [],
      exempt: false,
    };
  }
  if (state.config.text === null) {
    return {
      failures: [
        `${CONFIG_PATH} is missing at main — expected the ${variant} variant (${templatePath})`,
      ],
      notes: [],
      exempt: false,
    };
  }

  const difference = firstDifference(templates[variant], state.config.text);
  if (difference !== null) {
    return {
      failures: [
        `${CONFIG_PATH} differs from the ${variant} variant (${templatePath}) — first difference at line ${difference.line}: expected ${JSON.stringify(difference.expected)}, found ${JSON.stringify(difference.actual)}`,
      ],
      notes: [],
      exempt: false,
    };
  }

  return { failures: [], notes: [`byte-exact copy of the ${variant} variant`], exempt: false };
}

// --- GraphQL fleet batch (same shape as check-context-conformance) ---

function repoAlias(index: number): string {
  return `repo${index}`;
}

/**
 * One aliased `repository(...)` block per entry: the configuration's text
 * plus the mere existence (`id`) of the two manifests that select the
 * variant. Aliases are by index, never by name — GraphQL alias syntax
 * disallows the hyphens several repository names carry.
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
      `    config: object(expression: "main:${CONFIG_PATH}") { ... on Blob { text } }`,
      `    cargoToml: object(expression: "main:Cargo.toml") { id }`,
      `    workflows: object(expression: "main:.github/workflows") { id }`,
      `  }`,
    ].join("\n");
  });
  return `query {\n${blocks.join("\n")}\n}`;
}

interface GraphQLBlobNode {
  readonly text?: string | null;
}
interface GraphQLObjectNode {
  readonly id?: string;
}
interface GraphQLRepoNode {
  readonly config?: GraphQLBlobNode | null;
  readonly cargoToml?: GraphQLObjectNode | null;
  readonly workflows?: GraphQLObjectNode | null;
}

const GRAPHQL_UNRESOLVED_REPO =
  "repository not resolvable via GraphQL (see check-inventory-drift for real deletions/renames)";

/**
 * A `null` alias means the whole `repository(...)` field came back null — a
 * NOT_FOUND, a permissions issue or a rename, structurally indistinguishable
 * here: reported as unable-to-verify, never as a missing configuration.
 */
export function parseBatchResponse(
  repositories: readonly string[],
  data: Readonly<Record<string, unknown>> | undefined,
): Map<string, RepoDependabotState> {
  const result = new Map<string, RepoDependabotState>();
  repositories.forEach((repository, index) => {
    const node = (data?.[repoAlias(index)] ?? null) as GraphQLRepoNode | null;
    if (node === null) {
      result.set(repository, {
        config: { text: null, error: GRAPHQL_UNRESOLVED_REPO },
        manifests: null,
        fetchError: GRAPHQL_UNRESOLVED_REPO,
      });
      return;
    }
    result.set(repository, {
      config: { text: node.config?.text ?? null, error: null },
      manifests: {
        workflows: node.workflows != null,
        cargoToml: node.cargoToml != null,
      },
      fetchError: null,
    });
  });
  return result;
}

async function fetchFleetViaGraphQL(
  repositories: readonly string[],
): Promise<Map<string, RepoDependabotState> | null> {
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

/**
 * Existence through the contents endpoint: a 404 is a confirmed absence, any
 * other failure an error that must not be read as absence (a manifest
 * misread as absent would select the wrong variant and report a drift that
 * is not one).
 */
async function existsViaRest(
  repository: string,
  path: string,
): Promise<{ readonly present: boolean; readonly error: string | null }> {
  const result = await ghWithRetry(["api", `repos/${repository}/contents/${path}?ref=main`]);
  if (result.error !== null) return { present: false, error: result.error };
  return { present: result.text !== null, error: null };
}

async function fetchFleetViaRest(
  repositories: readonly string[],
): Promise<Map<string, RepoDependabotState>> {
  const result = new Map<string, RepoDependabotState>();
  for (const repository of repositories) {
    const [workflows, cargoToml] = await Promise.all([
      existsViaRest(repository, ".github/workflows"),
      existsViaRest(repository, "Cargo.toml"),
    ]);
    const manifestError = workflows.error ?? cargoToml.error;
    if (manifestError !== null) {
      result.set(repository, {
        config: { text: null, error: manifestError },
        manifests: null,
        fetchError: manifestError,
      });
      continue;
    }
    const config = await fetchFile(repository, CONFIG_PATH);
    result.set(repository, {
      config,
      manifests: {
        workflows: workflows.present,
        cargoToml: cargoToml.present,
      },
      fetchError: null,
    });
  }
  return result;
}

/** GraphQL batch first; per-repository REST only if the whole batch could not be answered at all. */
async function fetchFleetDependabot(
  repositories: readonly string[],
): Promise<Map<string, RepoDependabotState>> {
  return (await fetchFleetViaGraphQL(repositories)) ?? (await fetchFleetViaRest(repositories));
}

export type FleetDependabotTransport = (
  repositories: readonly string[],
) => Promise<Map<string, RepoDependabotState>>;

export async function fetchPublicFleetDependabot(
  registry: readonly RegistryEntry[],
  transport: FleetDependabotTransport = fetchFleetDependabot,
): Promise<Map<string, RepoDependabotState>> {
  return transport(
    registry.filter((entry) => entry.visibility !== "private").map((entry) => entry.repository),
  );
}

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const registry = parseRegistry(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const templates = await loadTemplates();
  const fleet = await fetchPublicFleetDependabot(registry);

  const report = new GateReport();
  for (const entry of registry) {
    // Both fetch paths record a state for every input repository; this
    // fallback is defensive and stays honest (unable-to-verify, never
    // "missing") if it ever fires.
    const state = fleet.get(entry.repository) ?? {
      config: { text: null, error: "no fetch outcome recorded for this repository" },
      manifests: null,
      fetchError: "no fetch outcome recorded for this repository",
    };
    const outcome = reviewDependabot(entry, state, templates);
    const ok = outcome.failures.length === 0;
    report.check(entry.repository, ok, ok ? outcome.notes.join("; ") : outcome.failures.join("; "));
  }

  concludeGate("Dependabot conformance", report);
}
