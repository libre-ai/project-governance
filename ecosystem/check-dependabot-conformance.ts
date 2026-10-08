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
 *   2b. A repository whose manifest set selects no variant is scanned in
 *      full (recursive tree of the default branch). If the scan finds no
 *      manifest of any ecosystem Dependabot can watch (`findEcosystemManifests`
 *      — deliberately broader than the variants), the repository has nothing
 *      to update: that is a counted success ("no ecosystem to watch"), and a
 *      `.github/dependabot.yml` there is a failure — every entry would be a
 *      job error. A scan that finds a manifest keeps the repository red and
 *      names the manifests; a scan that cannot be completed (fetch error,
 *      truncated tree) is unable-to-verify, never "nothing to watch".
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
 * caller never picks a "closest" template — it scans the whole tree instead
 * (`reviewWithoutVariant`), and only a tree with no watchable manifest at all
 * passes, as "no ecosystem to watch" (`libre-ai/.github`: profile and policy
 * documents only). github-actions is the floor of every variant because a
 * repository that runs code runs the governance gates through
 * `.github/workflows`. Cargo.toml is the only other selector (see the
 * header: no bun variant).
 */
export function selectVariant(manifests: ManifestPresence): TemplateVariant | null {
  if (!manifests.workflows) return null;
  if (manifests.cargoToml) return "cargo";
  return "github-actions";
}

export interface EcosystemManifest {
  readonly path: string;
  readonly ecosystem: string;
}

/**
 * Basename (or path) patterns of every manifest a Dependabot ecosystem reads,
 * matched at any depth. The list is broader than the published variants on
 * purpose, and errs towards detection: a false positive only keeps a
 * repository red with a named manifest to look at, while a false negative
 * would turn a repository with something to watch into a silent
 * "nothing to watch" success — the one direction this gate must not fail in.
 */
const ECOSYSTEM_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ["github-actions", /^\.github\/workflows\/[^/]+\.ya?ml$/],
  ["github-actions", /(^|\/)action\.ya?ml$/],
  ["cargo", /(^|\/)Cargo\.(toml|lock)$/],
  ["rust-toolchain", /(^|\/)rust-toolchain(\.toml)?$/],
  [
    "npm/bun",
    /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml)$/,
  ],
  ["deno", /(^|\/)deno\.jsonc?$/],
  [
    "pip/uv",
    /(^|\/)(requirements[^/]*\.(txt|in)|pyproject\.toml|uv\.lock|poetry\.lock|Pipfile(\.lock)?|setup\.py|setup\.cfg)$/,
  ],
  ["conda", /(^|\/)environment\.ya?ml$/],
  ["gomod", /(^|\/)go\.mod$/],
  ["docker", /(^|\/)(Dockerfile([.-][^/]*)?|[^/]+\.Dockerfile|Containerfile)$/],
  ["docker-compose", /(^|\/)(docker-)?compose[^/]*\.ya?ml$/],
  ["bundler", /(^|\/)(Gemfile|[^/]+\.gemspec)$/],
  ["composer", /(^|\/)composer\.json$/],
  ["maven", /(^|\/)pom\.xml$/],
  ["gradle", /(^|\/)(build|settings)\.gradle(\.kts)?$/],
  ["gitsubmodule", /^\.gitmodules$/],
  ["swift", /(^|\/)Package\.swift$/],
  ["mix", /(^|\/)mix\.exs$/],
  ["pub", /(^|\/)pubspec\.yaml$/],
  ["elm", /(^|\/)elm\.json$/],
  [
    "nuget",
    /(^|\/)([^/]+\.(cs|fs|vb)proj|packages\.config|Directory\.Packages\.props|global\.json)$/,
  ],
  ["terraform", /(^|\/)([^/]+\.tf|\.terraform\.lock\.hcl)$/],
  ["helm", /(^|\/)Chart\.yaml$/],
  ["devcontainers", /(^|\/)\.?devcontainer\.json$/],
  ["bazel", /(^|\/)MODULE\.bazel$/],
  ["vcpkg", /(^|\/)vcpkg\.json$/],
];

/** Every path of the tree that some Dependabot ecosystem would read, in tree order. */
export function findEcosystemManifests(paths: readonly string[]): EcosystemManifest[] {
  const found: EcosystemManifest[] = [];
  for (const path of paths) {
    const match = ECOSYSTEM_PATTERNS.find(([, pattern]) => pattern.test(path));
    if (match !== undefined) found.push({ path, ecosystem: match[0] });
  }
  return found;
}

export type EcosystemScan =
  | {
      readonly kind: "scanned";
      readonly files: number;
      readonly manifests: readonly EcosystemManifest[];
    }
  | { readonly kind: "unreadable"; readonly reason: string };

export function scanTree(paths: readonly string[]): EcosystemScan {
  return { kind: "scanned", files: paths.length, manifests: findEcosystemManifests(paths) };
}

interface GitTreeResponse {
  readonly truncated?: boolean;
  readonly tree?: readonly { readonly path?: string; readonly type?: string }[];
}

/**
 * The recursive git-trees response, reduced to its blob paths. A truncated
 * tree is unreadable: emptiness is the claim being proved, and a partial
 * listing cannot prove it.
 */
export function parseTreeResponse(text: string): EcosystemScan {
  let parsed: GitTreeResponse;
  try {
    parsed = JSON.parse(text) as GitTreeResponse;
  } catch {
    return { kind: "unreadable", reason: "git tree response is not JSON" };
  }
  if (!Array.isArray(parsed.tree)) {
    return { kind: "unreadable", reason: "git tree response carries no `tree` array" };
  }
  if (parsed.truncated !== false) {
    return {
      kind: "unreadable",
      reason: "git tree listing is truncated or does not say it is complete",
    };
  }
  const paths = parsed.tree
    .filter((node) => node.type === "blob" && typeof node.path === "string")
    .map((node) => node.path as string);
  return scanTree(paths);
}

export interface VolumeCounts {
  readonly graded: number;
  readonly nothingToWatch: number;
  readonly exempt: number;
  readonly failed: number;
}

export function summarizeVolume(counts: VolumeCounts): string {
  const total = counts.graded + counts.nothingToWatch + counts.exempt + counts.failed;
  return `${total} inventory entries examined: ${counts.graded} graded against a variant, ${counts.nothingToWatch} with no ecosystem to watch, ${counts.exempt} exempt, ${counts.failed} failing`;
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
  /**
   * The full-tree scan, performed only when `manifests` selects no variant;
   * `null` when it was not performed (the repository has a selector, or could
   * not be reached at all).
   */
  readonly ecosystemScan: EcosystemScan | null;
}

export const NOTHING_TO_WATCH_PREFIX = "no ecosystem to watch";

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
        `unable to verify ${CONFIG_PATH} on the default branch: ${state.fetchError ?? "no manifest information recorded"}`,
      ],
      notes: [],
      exempt: false,
    };
  }

  const variant = selectVariant(state.manifests);
  if (variant === null) {
    return reviewWithoutVariant(state.manifests, state);
  }
  const templatePath = `${TEMPLATE_DIRECTORY}/${variant}.yml`;

  if (state.config.error !== null) {
    return {
      failures: [`unable to verify ${CONFIG_PATH} on the default branch: ${state.config.error}`],
      notes: [],
      exempt: false,
    };
  }
  if (state.config.text === null) {
    return {
      failures: [
        `${CONFIG_PATH} is missing on the default branch — expected the ${variant} variant (${templatePath})`,
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

function reviewWithoutVariant(
  manifests: ManifestPresence,
  state: RepoDependabotState,
): ReviewOutcome {
  const scan = state.ecosystemScan;
  if (scan === null) {
    return {
      failures: [
        `no template variant published for manifest set ${JSON.stringify(manifests)}, and no tree scan recorded to prove there is nothing to watch`,
      ],
      notes: [],
      exempt: false,
    };
  }
  if (scan.kind === "unreadable") {
    return {
      failures: [`unable to prove the repository has no ecosystem to watch: ${scan.reason}`],
      notes: [],
      exempt: false,
    };
  }
  if (scan.manifests.length > 0) {
    const named = scan.manifests.map((m) => `${m.path} (${m.ecosystem})`).join(", ");
    return {
      failures: [
        `no template variant published for manifest set ${JSON.stringify(manifests)} — the tree carries ${named}; add a variant in ${TEMPLATE_DIRECTORY}/ before this repository can be graded`,
      ],
      notes: [],
      exempt: false,
    };
  }
  if (state.config.error !== null) {
    return {
      failures: [`unable to verify ${CONFIG_PATH} on the default branch: ${state.config.error}`],
      notes: [],
      exempt: false,
    };
  }
  if (state.config.text !== null) {
    return {
      failures: [
        `${CONFIG_PATH} is present but the repository has no ecosystem to watch — every \`updates\` entry would be a job error; remove the file`,
      ],
      notes: [],
      exempt: false,
    };
  }
  return {
    failures: [],
    notes: [
      `${NOTHING_TO_WATCH_PREFIX} — ${scan.files} file(s) scanned at the default branch, none is a manifest Dependabot can watch`,
    ],
    exempt: false,
  };
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
      // `HEAD:` resolves the repository's default branch. A literal `main:`
      // read the documentary ancestor of every consolidated destination and
      // reported `{workflows:false, cargoToml:false}` for all of them, so the
      // gate could not grade a single repository it was pointed at.
      `    config: object(expression: "HEAD:${CONFIG_PATH}") { ... on Blob { text } }`,
      `    cargoToml: object(expression: "HEAD:Cargo.toml") { id }`,
      `    workflows: object(expression: "HEAD:.github/workflows") { id }`,
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
        ecosystemScan: null,
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
      ecosystemScan: null,
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
  // No `?ref=`: the Contents API resolves the default branch.
  const result = await ghWithRetry(["api", `repos/${repository}/contents/${path}`]);
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
        ecosystemScan: null,
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
      ecosystemScan: null,
    });
  }
  return result;
}

/**
 * The recursive tree of the default branch (`HEAD` resolves it, like the
 * GraphQL `HEAD:` expressions). One REST request, issued only for the
 * repositories whose manifest set selects no variant — on 2026-10-08, one
 * repository out of 22.
 */
async function scanDefaultBranchTree(repository: string): Promise<EcosystemScan> {
  const result = await ghWithRetry(["api", `repos/${repository}/git/trees/HEAD?recursive=1`]);
  if (result.error !== null) return { kind: "unreadable", reason: result.error };
  if (result.text === null) {
    return { kind: "unreadable", reason: "default-branch tree not found" };
  }
  return parseTreeResponse(result.text);
}

export type TreeScanner = (repository: string) => Promise<EcosystemScan>;

/** Attaches a full-tree scan to every reachable repository that selects no variant. */
export async function attachEcosystemScans(
  states: Map<string, RepoDependabotState>,
  scanner: TreeScanner = scanDefaultBranchTree,
): Promise<Map<string, RepoDependabotState>> {
  for (const [repository, state] of states) {
    if (state.manifests === null || selectVariant(state.manifests) !== null) continue;
    states.set(repository, { ...state, ecosystemScan: await scanner(repository) });
  }
  return states;
}

/** GraphQL batch first; per-repository REST only if the whole batch could not be answered at all. */
async function fetchFleetDependabot(
  repositories: readonly string[],
): Promise<Map<string, RepoDependabotState>> {
  const states =
    (await fetchFleetViaGraphQL(repositories)) ?? (await fetchFleetViaRest(repositories));
  return attachEcosystemScans(states);
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
  const counts = { graded: 0, nothingToWatch: 0, exempt: 0, failed: 0 };
  for (const entry of registry) {
    // Both fetch paths record a state for every input repository; this
    // fallback is defensive and stays honest (unable-to-verify, never
    // "missing") if it ever fires.
    const state = fleet.get(entry.repository) ?? {
      config: { text: null, error: "no fetch outcome recorded for this repository" },
      manifests: null,
      fetchError: "no fetch outcome recorded for this repository",
      ecosystemScan: null,
    };
    const outcome = reviewDependabot(entry, state, templates);
    const ok = outcome.failures.length === 0;
    if (!ok) counts.failed++;
    else if (outcome.exempt) counts.exempt++;
    else if (outcome.notes.some((note) => note.startsWith(NOTHING_TO_WATCH_PREFIX)))
      counts.nothingToWatch++;
    else counts.graded++;
    report.check(entry.repository, ok, ok ? outcome.notes.join("; ") : outcome.failures.join("; "));
  }
  report.volume(summarizeVolume(counts));

  concludeGate("Dependabot conformance", report);
}
