import { readPullRequestEvent, stripNonDeclarations } from "./check-pr-door";
import { concludeGate, GateReport } from "./gate-report";
import {
  type ChangedPath,
  GITLINK_MODE,
  listChangedPaths,
  listTree,
  readGit,
  runGit,
  SYMLINK_MODE,
  type TreeEntry,
} from "./git-diff";

/**
 * Negatives gate (ADR-0056 D5) — a pull request that declares what it does
 * NOT add is held to that declaration by its own diff.
 *
 * Why: ADR-0056 D5 makes a negative that the diff contradicts a blocking
 * defect from the signature, and until this gate nothing read the
 * declaration: a pull request could write "adds no dependency" above a new
 * entry in `package.json` and only a careful reviewer would see it.
 *
 * THE FORM (owner decisions in chat on 2026-10-23, which ADR-0056 left to the
 * gate), on its own line, at the start of the line, like `Door:`:
 *
 *     Not-added: dependency, schema, telemetry
 *
 * - at most one declaration line, outside HTML comments and fenced code
 *   blocks (removed first by check-pr-door's own `stripNonDeclarations`, so
 *   the template's guidance or a quoted example never counts). A leading
 *   byte-order mark is removed before reading. Two declaration lines are
 *   refused;
 * - every other visible line that mentions the key — `not`, an optional
 *   separator (white space, any Unicode dash `\p{Pd}`, which holds U+2011
 *   and the en and em dashes), `added`, `:`, in any case — is refused by
 *   name: `> Not-added:`, `- Not-added:`, `**Not-added:**`, `## Not-added:`,
 *   the key with a non-ASCII dash, `not-added:`. Each renders as a declaration a reader believes, and
 *   ignoring it would let the author believe a negative is held that nothing
 *   reads (review of 2026-10-23, finding 3). Consequence: prose mentions of
 *   the key with its colon belong in code;
 * - values from the closed vocabulary, separated by commas, each once:
 *   `dependency`, `schema`, `workflow` (confronted to the diff) and
 *   `hosted-service`, `telemetry`, `public-surface` (declarative: validated as
 *   values, printed as not verified by this gate, read in review — D2);
 * - optional: no line, the gate passes and says so. A line present is
 *   validated, and each verifiable negative is confronted to the diff; a
 *   contradiction fails, named.
 *
 * THE RULES ARE THE BASE'S. What "added" means is data
 * (`pr-negatives.v1.json`), read at the merge base of the pull request with
 * `git cat-file blob`, never from the head: otherwise a pull request edits the
 * rule it is judged by (review finding 5). Data absent or unreadable at the
 * merge base fails closed. Consequence: the pull request that introduces this
 * gate cannot confront a verifiable negative — there is no data at its base.
 * The gate's code runs from the pull request's branch, like every gate of this
 * repository; that is out of this gate's scope.
 *
 * WHAT "ADDS" MEANS. All path comparisons are case-insensitive: macOS and
 * Windows checkouts are, and `.github/Workflows/x.yml` must not slip past a
 * case-sensitive pattern.
 *
 * - `workflow`: a path added at or under `.github/workflows`; a symlink or a
 *   type change at or under it; a symlink that replaces one of its parent
 *   directories. Any file there counts, one GitHub would not run included.
 *   A renamed workflow counts: the list is read with `--no-renames`, and
 *   GitHub keys a workflow by its path. Through a link, what runs is whatever
 *   the target holds, which no path pattern can see (finding 6).
 * - `schema`, four rules, each catching a convention the others miss:
 *   (1) `*.schema.json|yaml|yml` — the fleet's measured convention (320 paths
 *   on 2026-10-23), widened to YAML, which JSON Schema documents are also
 *   written in; (2) a file named `schema.json|yaml|yml` — the bare name tools
 *   such as Ajv and editors default to; (3) any JSON or YAML file added under
 *   a `schema/` or `schemas/` directory — what such a directory is for, and
 *   where a schema named `foo.json` lives; (4) any added `.json` whose root
 *   `$schema` names a JSON Schema meta-schema (`json-schema.org`) — the
 *   document's own declaration that it is a schema, whatever its path. An
 *   added `.json` that does not parse cannot be told apart: unverifiable.
 * - `dependency`, a dependency is added when (finding 1, 2):
 *   - a manifest, a lockfile, or a manifest of a format the gate does not
 *     read is added — vendored, or without a single entry, included: a new
 *     manifest is a new resolution root;
 *   - an entry appears in a dependency section or an override section of a
 *     read manifest (`package.json`: the four dependency sections and the
 *     catalogs; `overrides`, `resolutions`, `pnpm.overrides`,
 *     `bundleDependencies`/`bundledDependencies`. `Cargo.toml`: the
 *     dependency tables and their `target.*` forms; `[patch.*]`,
 *     `[replace]`). An entry moved to another section is new there;
 *   - an existing entry changes PROVENANCE: where the code comes from, not
 *     which version of it. `package.json`: an `npm:` alias target, any other
 *     protocol spec (`git`, `git+…`, `github:`, `http(s):`, `file:`, `link:`,
 *     `portal:`, any scheme) or a path or shorthand spec (`owner/repo`)
 *     appearing or changing; `workspace:` counts by its protocol only, its
 *     range is a version. `Cargo.toml`: the keys `package`, `git`, `path`,
 *     `registry`, `branch`, `rev`, `tag` (and `workspace`, which hands the
 *     provenance to the workspace table) appearing or changing. A version
 *     change alone (`8.20.0` → `8.21.0`, `"1"` → `{ version = "1.1" }`) is
 *     not a provenance change;
 *   - a submodule is added (a gitlink appears) or `.gitmodules` is added or
 *     changed (it carries the submodule URLs). A gitlink only moved to
 *     another commit is a version change, counted and not judged;
 *   - a workflow or action file gains a `uses:` — a dependency of the CI
 *     tooling in the sense of ADR-0056 D4 (`depend`). Values are compared
 *     without their `@ref` (and a `docker://` image without its tag or
 *     digest), so bumping a pinned sha is a version change; a file added
 *     brings all its `uses:`.
 *
 * A lockfile only modified is not, alone, a dependency added. It changes on
 * every version bump and every re-resolution; a direct dependency enters
 * through its manifest, which is read. The negative is about the
 * dependencies the pull request takes on, not about the transitive set a
 * resolver picks: those lockfiles are named and counted, never judged in
 * silence.
 *
 * What the gate cannot read fails the negative, never a zero: a manifest of a
 * format it does not parse (`requirements*.txt`, `pyproject.toml`,
 * `pnpm-workspace.yaml`… — the list is data) that changes while `dependency`
 * is declared; a file the scan reads that is a symlink at the base or the
 * head, in the diff or not (its target can change without its path changing,
 * finding 8); a file that does not parse. The author drops the negative or
 * the gate learns the format.
 *
 * Every changed path falls in exactly one part of the dependency partition,
 * and the parts are printed with their total, which must equal the number of
 * changed paths examined (finding 7).
 *
 * The diff is read from git, never from the REST API: the merge base of the
 * fetched base branch and HEAD, the path list from the shared `git-diff.ts`
 * (`--raw -z --no-renames --ignore-submodules=none`, with modes), file
 * contents with `git cat-file blob`, which applies no textconv, filter or
 * diff driver. The diff is read only when a verifiable negative is declared.
 *
 * Runs on `pull_request` events (including `edited`). Elsewhere it declares
 * that it judged nothing. An event payload absent or unreadable on a
 * pull_request run is a failure.
 */

export const VERIFIABLE_NEGATIVES = ["dependency", "schema", "workflow"] as const;
export const DECLARATIVE_NEGATIVES = ["hosted-service", "telemetry", "public-surface"] as const;
export type VerifiableNegative = (typeof VERIFIABLE_NEGATIVES)[number];
export type Negative = VerifiableNegative | (typeof DECLARATIVE_NEGATIVES)[number];

const VOCABULARY: ReadonlySet<string> = new Set([
  ...VERIFIABLE_NEGATIVES,
  ...DECLARATIVE_NEGATIVES,
]);
const VERIFIABLE: ReadonlySet<string> = new Set(VERIFIABLE_NEGATIVES);
const NEGATIVES_KEY = "Not-added:";
/** The one valid form: the exact key at the start of a line. */
const DECLARATION_LINE = /^[ \t]*Not-added:(.*)$/;
/**
 * Any rendering of the key: `not`, optional white space or dashes, `added`,
 * `:`. `\p{Pd}` holds U+2011 (measured on 2026-10-23), so it is not listed
 * apart: a literal would be an invisible character in the source.
 */
const KEY_MENTION = /not[\s\p{Pd}]*added\s*:/iu;
const KEY_MENTIONS = /not[\s\p{Pd}]*added\s*:/giu;
const BAD_SEPARATOR = /[\s;|/]/;
/** U+FEFF, written as a code point so the source carries no invisible character. */
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);

export interface NegativesLines {
  readonly linesExamined: number;
  readonly removedBlocks: number;
  /** Key mentions inside the removed comments and code blocks: not declarations. */
  readonly ignoredInBlocks: number;
  readonly declarationLines: number;
  /** Visible lines that mention the key without being a declaration: refused. */
  readonly misplacedLines: number;
}

export type NegativesDeclaration =
  | (NegativesLines & { readonly kind: "absent" })
  | (NegativesLines & { readonly kind: "refused"; readonly reasons: readonly string[] })
  | (NegativesLines & { readonly kind: "declared"; readonly values: readonly Negative[] });

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

/** Author text quoted in a verdict: one line, escaped, bounded. */
function quote(text: string): string {
  const trimmed = text.trim();
  return JSON.stringify(trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed);
}

/** Pure parse of the declaration of a pull request description. */
export function readNegativesDeclaration(body: string): NegativesDeclaration {
  const unmarked = body.startsWith(BYTE_ORDER_MARK) ? body.slice(BYTE_ORDER_MARK.length) : body;
  const normalized = unmarked.replace(/\r\n?/g, "\n");
  const { text, removedBlocks } = stripNonDeclarations(normalized);
  const visible = text.split("\n");
  const declarations: string[] = [];
  const misplaced: string[] = [];
  visible.forEach((line, index) => {
    const declaration = DECLARATION_LINE.exec(line);
    if (declaration !== null) declarations.push(declaration[1] ?? "");
    else if (KEY_MENTION.test(line)) {
      misplaced.push(
        `line ${index + 1} ${quote(line)} — write it as "${NEGATIVES_KEY}" at the start of its own line`,
      );
    }
  });
  const lines: NegativesLines = {
    linesExamined: text === "" ? 0 : visible.length,
    removedBlocks,
    ignoredInBlocks: countMatches(normalized, KEY_MENTIONS) - countMatches(text, KEY_MENTIONS),
    declarationLines: declarations.length,
    misplacedLines: misplaced.length,
  };
  const refusals = [...misplaced];
  if (declarations.length > 1) {
    refusals.push(`${declarations.length} Not-added lines — declare at most one`);
  }
  if (refusals.length > 0) return { ...lines, kind: "refused", reasons: refusals };
  const [declared] = declarations;
  if (declared === undefined) return { ...lines, kind: "absent" };
  const value = declared.trim();
  if (value === "") {
    return {
      ...lines,
      kind: "refused",
      reasons: ["empty Not-added line — name at least one value, or remove the line"],
    };
  }
  const reasons: string[] = [];
  const values: Negative[] = [];
  for (const raw of value.split(",")) {
    const item = raw.trim();
    if (item === "") {
      reasons.push("empty value (a doubled, leading or trailing comma)");
    } else if (BAD_SEPARATOR.test(item)) {
      reasons.push(`${quote(item)} — values are separated by commas only`);
    } else if (!VOCABULARY.has(item)) {
      reasons.push(`${quote(item)} is not in the vocabulary (${[...VOCABULARY].join(", ")})`);
    } else if (values.includes(item as Negative)) {
      reasons.push(`${quote(item)} is declared twice`);
    } else {
      values.push(item as Negative);
    }
  }
  if (reasons.length > 0) return { ...lines, kind: "refused", reasons };
  return { ...lines, kind: "declared", values };
}

// ---------------------------------------------------------------------------
// The data: what "added" means, in pr-negatives.v1.json, read at the merge base.

export const CONFIG_PATH: string = "tools/quality/pr-negatives.v1.json";

export interface JsonProvenance {
  readonly aliasProtocols: readonly string[];
  readonly rangeOnlyProtocols: readonly string[];
}

export interface ManifestFormat {
  readonly basename: string;
  readonly parser: "json" | "toml";
  readonly dependencySections: readonly string[];
  readonly overrideSections: readonly string[];
  readonly json: JsonProvenance;
  readonly tomlKeys: readonly string[];
}

export interface NegativesConfig {
  readonly workflowDirectory: string;
  readonly schemaPatterns: readonly RegExp[];
  readonly schemaContent: {
    readonly extensions: readonly string[];
    readonly rootKey: string;
    readonly metaSchemaPrefixes: readonly string[];
  };
  readonly manifests: readonly ManifestFormat[];
  readonly lockfiles: readonly string[];
  readonly unreadManifests: readonly RegExp[];
  readonly gitmodules: string;
  readonly usesFiles: readonly RegExp[];
}

export type ConfigRead =
  | { readonly ok: true; readonly config: NegativesConfig }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown, nonEmpty = true): value is string[] {
  return (
    Array.isArray(value) &&
    (!nonEmpty || value.length > 0) &&
    value.every((item) => typeof item === "string" && item !== "")
  );
}

function compile(patterns: readonly string[], where: string): RegExp[] | string {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern, "i"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `${where}: "${pattern}" is not a valid pattern (${message})`;
    }
  }
  return compiled;
}

function readFormat(manifest: unknown): ManifestFormat | string {
  const bad =
    "each dependency.manifests entry needs a basename, a json|toml parser, dependencySections, overrideSections and its provenance rule";
  if (
    !isRecord(manifest) ||
    typeof manifest.basename !== "string" ||
    manifest.basename === "" ||
    (manifest.parser !== "json" && manifest.parser !== "toml") ||
    !isStrings(manifest.dependencySections) ||
    !isStrings(manifest.overrideSections, false) ||
    !isRecord(manifest.provenance)
  ) {
    return bad;
  }
  const { provenance } = manifest;
  if (manifest.parser === "json") {
    if (
      !isStrings(provenance.aliasProtocols, false) ||
      !isStrings(provenance.rangeOnlyProtocols, false)
    ) {
      return `${manifest.basename}: provenance needs aliasProtocols and rangeOnlyProtocols`;
    }
  } else if (!isStrings(provenance.tableKeys)) {
    return `${manifest.basename}: provenance needs tableKeys`;
  }
  return {
    basename: manifest.basename,
    parser: manifest.parser,
    dependencySections: manifest.dependencySections,
    overrideSections: manifest.overrideSections,
    json: {
      aliasProtocols: (provenance.aliasProtocols as string[] | undefined) ?? [],
      rangeOnlyProtocols: (provenance.rangeOnlyProtocols as string[] | undefined) ?? [],
    },
    tomlKeys: (provenance.tableKeys as string[] | undefined) ?? [],
  };
}

/** Pure validation of the parsed data file. Anything unexpected is a reason, never a default. */
export function validateConfig(value: unknown): ConfigRead {
  const fail = (reason: string): ConfigRead => ({ ok: false, reason: `${CONFIG_PATH}: ${reason}` });
  if (!isRecord(value)) return fail("expected an object");
  const { workflow, schema, dependency } = value;
  if (!isRecord(workflow) || typeof workflow.directory !== "string" || workflow.directory === "") {
    return fail("workflow.directory must name a directory");
  }
  if (!isRecord(schema) || !isStrings(schema.addedPathPatterns)) {
    return fail("schema.addedPathPatterns must list at least one pattern");
  }
  const content = schema.content;
  if (
    !isRecord(content) ||
    !isStrings(content.extensions) ||
    typeof content.rootKey !== "string" ||
    content.rootKey === "" ||
    !isStrings(content.metaSchemaPrefixes)
  ) {
    return fail("schema.content needs extensions, a rootKey and metaSchemaPrefixes");
  }
  if (!isRecord(dependency)) return fail("dependency rule missing");
  const { manifests, lockfiles, unreadManifestPatterns, gitmodules, usesFilePatterns } = dependency;
  if (!Array.isArray(manifests) || manifests.length === 0) {
    return fail("dependency.manifests must list at least one manifest format");
  }
  const formats: ManifestFormat[] = [];
  for (const manifest of manifests) {
    const format = readFormat(manifest);
    if (typeof format === "string") return fail(format);
    formats.push(format);
  }
  if (!isStrings(lockfiles)) return fail("dependency.lockfiles must list file names");
  if (!isStrings(unreadManifestPatterns)) {
    return fail("dependency.unreadManifestPatterns must list at least one pattern");
  }
  if (typeof gitmodules !== "string" || gitmodules === "")
    return fail("dependency.gitmodules must name a file");
  if (!isStrings(usesFilePatterns))
    return fail("dependency.usesFilePatterns must list at least one pattern");
  const names = [...formats.map((format) => format.basename), ...lockfiles];
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) return fail(`"${duplicate}" is listed twice`);
  const schemaPatterns = compile(schema.addedPathPatterns, "schema.addedPathPatterns");
  const unread = compile(unreadManifestPatterns, "dependency.unreadManifestPatterns");
  const usesFiles = compile(usesFilePatterns, "dependency.usesFilePatterns");
  for (const compiled of [schemaPatterns, unread, usesFiles]) {
    if (typeof compiled === "string") return fail(compiled);
  }
  return {
    ok: true,
    config: {
      workflowDirectory: workflow.directory.replace(/\/+$/, ""),
      schemaPatterns: schemaPatterns as RegExp[],
      schemaContent: {
        extensions: content.extensions,
        rootKey: content.rootKey,
        metaSchemaPrefixes: content.metaSchemaPrefixes,
      },
      manifests: formats,
      lockfiles,
      unreadManifests: unread as RegExp[],
      gitmodules,
      usesFiles: usesFiles as RegExp[],
    },
  };
}

// ---------------------------------------------------------------------------
// Dependency entries of a manifest, with their provenance.

/** Canonical JSON: sorted keys, so two equal values always print alike. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Where a package.json spec takes its code from; a version range is `registry`. */
export function jsonProvenance(spec: unknown, rule: JsonProvenance): string {
  if (isRecord(spec)) {
    const mapped: Record<string, string> = {};
    for (const [key, value] of Object.entries(spec)) mapped[key] = jsonProvenance(value, rule);
    return canonical(mapped);
  }
  if (typeof spec !== "string") return canonical(spec);
  const value = spec.trim();
  const lower = value.toLowerCase();
  const alias = rule.aliasProtocols.find((protocol) => lower.startsWith(protocol.toLowerCase()));
  if (alias !== undefined) {
    const target = value.slice(alias.length);
    const at = target.indexOf("@", target.startsWith("@") ? 1 : 0);
    return `${alias}${at === -1 ? target : target.slice(0, at)}`;
  }
  const rangeOnly = rule.rangeOnlyProtocols.find((protocol) =>
    lower.startsWith(protocol.toLowerCase()),
  );
  if (rangeOnly !== undefined) return rangeOnly;
  if (SCHEME.test(value) || value.includes("/")) return value;
  return "registry";
}

/** Where a Cargo dependency takes its code from: its provenance keys, or `registry`. */
export function tomlProvenance(spec: unknown, keys: readonly string[]): string {
  if (typeof spec === "string") return "registry";
  if (!isRecord(spec)) return canonical(spec);
  const picked: Record<string, unknown> = {};
  for (const key of keys) if (Object.hasOwn(spec, key)) picked[key] = spec[key];
  return Object.keys(picked).length === 0 ? "registry" : canonical(picked);
}

export type EntriesRead =
  | { readonly ok: true; readonly entries: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly reason: string };

function collectEntries(
  node: unknown,
  segments: readonly string[],
  trail: readonly string[],
  provenance: (spec: unknown) => string,
  out: Map<string, string>,
): string | null {
  const [head, ...rest] = segments;
  if (head === undefined) {
    const section = trail.join(".");
    if (isRecord(node)) {
      for (const [key, value] of Object.entries(node))
        out.set(`${section}.${key}`, provenance(value));
    } else if (Array.isArray(node) && node.every((item) => typeof item === "string")) {
      for (const item of node) out.set(`${section}.${item}`, "listed");
    } else if (typeof node === "boolean") {
      if (node) out.set(`${section}.(all)`, "listed");
    } else {
      return `${section} is neither a table, a list of names nor a boolean`;
    }
    return null;
  }
  // An intermediate that is not a table holds no such section (`workspaces`
  // is a list of globs in most manifests): absent, not unreadable.
  if (!isRecord(node)) return null;
  const keys = head === "*" ? Object.keys(node) : Object.hasOwn(node, head) ? [head] : [];
  for (const key of keys) {
    const problem = collectEntries(node[key], rest, [...trail, key], provenance, out);
    if (problem !== null) return problem;
  }
  return null;
}

/**
 * Pure: the dependency and override entries of one manifest text, as
 * `<section>.<name>` → provenance. A section absent is no entry; a section
 * present but of another shape, or a text that does not parse, is a reason.
 */
export function dependencyEntries(format: ManifestFormat, text: string): EntriesRead {
  let document: unknown;
  try {
    document = format.parser === "json" ? JSON.parse(text) : Bun.TOML.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `does not parse as ${format.parser} (${message})` };
  }
  if (!isRecord(document)) return { ok: false, reason: "the document is not a table" };
  const provenance =
    format.parser === "json"
      ? (spec: unknown) => jsonProvenance(spec, format.json)
      : (spec: unknown) => tomlProvenance(spec, format.tomlKeys);
  const entries = new Map<string, string>();
  for (const section of [...format.dependencySections, ...format.overrideSections]) {
    const problem = collectEntries(document, section.split("."), [], provenance, entries);
    if (problem !== null) return { ok: false, reason: problem };
  }
  return { ok: true, entries };
}

/** `owner/repo/path@ref` → `owner/repo/path`; a `docker://` image loses its tag and its digest. */
export function usesProvenance(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) return trimmed;
  if (trimmed.toLowerCase().startsWith("docker://")) {
    return trimmed
      .replace(/@sha256:[0-9a-f]+$/i, "")
      .replace(/:[^/:]*$/, "")
      .toLowerCase();
  }
  const at = trimmed.lastIndexOf("@");
  return (at > 0 ? trimmed.slice(0, at) : trimmed).toLowerCase();
}

export type UsesRead =
  | { readonly ok: true; readonly uses: ReadonlySet<string> }
  | { readonly ok: false; readonly reason: string };

function collectUses(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectUses(item, out);
  } else if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "uses" && typeof value === "string") out.add(usesProvenance(value));
      else collectUses(value, out);
    }
  }
}

/** Pure: every `uses:` value of a workflow or action file, without its ref. */
export function usesOf(text: string): UsesRead {
  let document: unknown;
  try {
    document = Bun.YAML.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `does not parse as YAML (${message})` };
  }
  const uses = new Set<string>();
  collectUses(document, uses);
  return { ok: true, uses };
}

// ---------------------------------------------------------------------------
// The change set the negatives are confronted to.

export type BlobRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/** Reads a file at the base (merge base) or at the head of the pull request. */
export type BlobReader = (side: "base" | "head", path: string) => BlobRead;

export interface ChangeContext {
  readonly entries: readonly ChangedPath[];
  readonly readBlob: BlobReader;
  /** Both trees, for the symlinks the diff does not show. */
  readonly trees: { readonly base: readonly TreeEntry[]; readonly head: readonly TreeEntry[] };
  /** The rules, as the merge base holds them. */
  readonly config: NegativesConfig;
}

export type ContextRead =
  | ({ readonly ok: true } & ChangeContext)
  | { readonly ok: false; readonly reason: string };

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

const isSymlink = (entry: ChangedPath): boolean =>
  entry.oldMode === SYMLINK_MODE || entry.newMode === SYMLINK_MODE;

interface Confrontation {
  readonly ok: boolean;
  readonly note: string;
  readonly volume: string;
}

function verdictOf(
  contradictions: readonly string[],
  unverifiable: readonly string[],
  passNote: string,
  volume: string,
  fix: string,
): Confrontation {
  if (contradictions.length === 0 && unverifiable.length === 0)
    return { ok: true, note: passNote, volume };
  const parts = [
    contradictions.length > 0 ? `contradicted by the diff — ${contradictions.join("; ")}` : null,
    unverifiable.length > 0 ? `cannot verify — ${unverifiable.join("; ")} (${fix})` : null,
  ];
  return { ok: false, note: parts.filter((part) => part !== null).join("; "), volume };
}

/** Pure: the workflow files a change adds, under the case-insensitive directory. */
export function confrontWorkflow(
  entries: readonly ChangedPath[],
  config: NegativesConfig,
): Confrontation {
  const directory = config.workflowDirectory.toLowerCase();
  const added: string[] = [];
  for (const entry of entries) {
    if (entry.status === "D") continue;
    const path = entry.path.toLowerCase();
    const under = path === directory || path.startsWith(`${directory}/`);
    const ancestor = directory.startsWith(`${path}/`);
    if (under && isSymlink(entry)) added.push(`${entry.path} (symlink)`);
    else if (under && entry.status === "T") added.push(`${entry.path} (type changed)`);
    else if (under && entry.status === "A") added.push(entry.path);
    else if (ancestor && isSymlink(entry))
      added.push(`${entry.path} (symlink over ${config.workflowDirectory})`);
  }
  return verdictOf(
    added.map((path) => `workflow file added: ${path}`),
    [],
    `no workflow file added among ${entries.length} changed path(s)`,
    `workflow: ${added.length} addition(s) under ${config.workflowDirectory}`,
    "",
  );
}

/** Pure: the schema files a change adds, by name or by `$schema`. */
export function confrontSchema(
  entries: readonly ChangedPath[],
  readBlob: BlobReader,
  config: NegativesConfig,
): Confrontation {
  const added: string[] = [];
  const unverifiable: string[] = [];
  let byName = 0;
  let contentRead = 0;
  const { extensions, rootKey, metaSchemaPrefixes } = config.schemaContent;
  for (const entry of entries) {
    if (entry.status !== "A") continue;
    if (config.schemaPatterns.some((pattern) => pattern.test(entry.path))) {
      byName += 1;
      added.push(`schema file added: ${entry.path}`);
      continue;
    }
    const lower = entry.path.toLowerCase();
    if (!extensions.some((extension) => lower.endsWith(extension.toLowerCase()))) continue;
    contentRead += 1;
    const blob = readBlob("head", entry.path);
    let document: unknown;
    try {
      document = blob.ok && !isSymlink(entry) ? JSON.parse(blob.text) : undefined;
    } catch {
      document = undefined;
    }
    if (document === undefined) {
      unverifiable.push(
        `${entry.path}: ${blob.ok ? (isSymlink(entry) ? "a symlink" : "does not parse as JSON") : blob.reason}, so whether it is a schema cannot be read`,
      );
      continue;
    }
    const declared = isRecord(document) ? document[rootKey] : undefined;
    if (
      typeof declared === "string" &&
      metaSchemaPrefixes.some((prefix) => declared.toLowerCase().startsWith(prefix.toLowerCase()))
    ) {
      added.push(`schema file added: ${entry.path} (${rootKey} ${quote(declared)})`);
    }
  }
  return verdictOf(
    added,
    unverifiable,
    `no schema file added among ${entries.length} changed path(s)`,
    `schema: ${byName} added path(s) matched by name, ${contentRead} added ${extensions.join("/")} file(s) read for ${rootKey}, ${unverifiable.length} unreadable`,
    `remove "schema" from the Not-added line`,
  );
}

/** The parts of the dependency partition, in print order. Every changed path falls in exactly one. */
export const PARTITION_PARTS = [
  "submodule added",
  "submodule moved, not judged",
  ".gitmodules changed",
  "symlinked dependency file",
  "manifest added",
  "manifest read",
  "manifest unreadable",
  "lockfile added",
  "lockfile modified, not judged",
  "unread-format manifest added",
  "unread-format manifest changed",
  "workflow/action file read for uses",
  "workflow/action file unreadable",
  "dependency file deleted",
  "other",
] as const;
type PartitionPart = (typeof PARTITION_PARTS)[number];

export interface DependencyScan {
  readonly contradictions: readonly string[];
  readonly unverifiable: readonly string[];
  readonly partition: ReadonlyMap<PartitionPart, readonly string[]>;
  /** Symlinked dependency files of either tree that the diff does not show. */
  readonly treeSymlinks: readonly string[];
}

/** Pure over the change set: every dependency the diff adds, and what it could not read. */
export function scanDependencies(context: ChangeContext): DependencyScan {
  const { entries, readBlob, config, trees } = context;
  const contradictions: string[] = [];
  const unverifiable: string[] = [];
  const partition = new Map<PartitionPart, string[]>(PARTITION_PARTS.map((part) => [part, []]));
  const put = (part: PartitionPart, path: string): void => {
    partition.get(part)?.push(path);
  };
  const manifestOf = (path: string) =>
    config.manifests.find((format) => format.basename === basenameOf(path));
  const isLockfile = (path: string) => config.lockfiles.includes(basenameOf(path));
  const isUnread = (path: string) => config.unreadManifests.some((pattern) => pattern.test(path));
  const isUsesFile = (path: string) => config.usesFiles.some((pattern) => pattern.test(path));
  const isDependencyFile = (path: string) =>
    manifestOf(path) !== undefined || isLockfile(path) || isUnread(path) || isUsesFile(path);

  for (const entry of entries) {
    const { status, path } = entry;
    if (entry.oldMode === GITLINK_MODE || entry.newMode === GITLINK_MODE) {
      if (status === "D") put("dependency file deleted", path);
      else if (status === "M") put("submodule moved, not judged", path);
      else {
        put("submodule added", path);
        contradictions.push(`submodule added: ${path}`);
      }
    } else if (path.toLowerCase() === config.gitmodules.toLowerCase()) {
      if (status === "D") put("dependency file deleted", path);
      else {
        put(".gitmodules changed", path);
        contradictions.push(
          `${path} ${status === "A" ? "added" : "changed"}: submodule list or URLs`,
        );
      }
    } else if (status === "D" && isDependencyFile(path)) {
      put("dependency file deleted", path);
    } else if (isSymlink(entry) && isDependencyFile(path)) {
      put("symlinked dependency file", path);
      unverifiable.push(`${path} is a symlink: its target can change without its path changing`);
    } else if (manifestOf(path) !== undefined) {
      const format = manifestOf(path) as ManifestFormat;
      if (status === "A") {
        put("manifest added", path);
        contradictions.push(`manifest added: ${path}`);
        continue;
      }
      const sides: Partial<Record<"base" | "head", ReadonlyMap<string, string>>> = {};
      const problems: string[] = [];
      for (const side of ["base", "head"] as const) {
        const blob = readBlob(side, path);
        const read = blob.ok ? dependencyEntries(format, blob.text) : blob;
        if (read.ok) sides[side] = read.entries;
        else problems.push(`${path} (${side}): ${read.reason}`);
      }
      const { base, head } = sides;
      if (base === undefined || head === undefined) {
        put("manifest unreadable", path);
        unverifiable.push(...problems.map((problem) => `manifest unreadable: ${problem}`));
        continue;
      }
      put("manifest read", path);
      for (const [id, provenance] of head) {
        const before = base.get(id);
        if (before === undefined) contradictions.push(`entry added: ${path}: ${id}`);
        else if (before !== provenance) {
          contradictions.push(
            `provenance changed: ${path}: ${id} (${quote(before)} → ${quote(provenance)})`,
          );
        }
      }
    } else if (isLockfile(path)) {
      if (status === "A") {
        put("lockfile added", path);
        contradictions.push(`lockfile added: ${path}`);
      } else put("lockfile modified, not judged", path);
    } else if (isUnread(path)) {
      if (status === "A") {
        put("unread-format manifest added", path);
        contradictions.push(`manifest added: ${path}`);
      } else {
        put("unread-format manifest changed", path);
        unverifiable.push(`manifest of a format this gate does not read: ${path} (${status})`);
      }
    } else if (isUsesFile(path)) {
      const head = readBlob("head", path);
      const headUses = head.ok ? usesOf(head.text) : head;
      const base = status === "A" ? ({ ok: true, text: "" } as const) : readBlob("base", path);
      const baseUses = base.ok ? usesOf(base.text) : base;
      if (!headUses.ok || !baseUses.ok) {
        put("workflow/action file unreadable", path);
        const reason = !headUses.ok ? headUses.reason : !baseUses.ok ? baseUses.reason : "";
        unverifiable.push(`workflow/action file unreadable: ${path}: ${reason}`);
        continue;
      }
      put("workflow/action file read for uses", path);
      for (const uses of headUses.uses) {
        if (!baseUses.uses.has(uses)) contradictions.push(`uses added: ${path}: ${uses}`);
      }
    } else {
      put("other", path);
    }
  }

  const inDiff = new Set(entries.map((entry) => entry.path));
  const treeSymlinks: string[] = [];
  for (const side of ["base", "head"] as const) {
    for (const entry of trees[side]) {
      if (entry.mode === SYMLINK_MODE && !inDiff.has(entry.path) && isDependencyFile(entry.path)) {
        treeSymlinks.push(`${entry.path} (${side})`);
        unverifiable.push(
          `${entry.path} is a symlink at the ${side}: its target can change without its path changing`,
        );
      }
    }
  }
  return { contradictions, unverifiable, partition, treeSymlinks };
}

function confrontDependency(context: ChangeContext): Confrontation {
  const scan = scanDependencies(context);
  const total = [...scan.partition.values()].reduce((sum, paths) => sum + paths.length, 0);
  const parts = PARTITION_PARTS.map(
    (part) => `${scan.partition.get(part)?.length ?? 0} ${part}`,
  ).join(", ");
  const sums = total === context.entries.length;
  const lockfiles = scan.partition.get("lockfile modified, not judged") ?? [];
  const moved = scan.partition.get("submodule moved, not judged") ?? [];
  const notJudged = [
    lockfiles.length > 0
      ? `; lockfile(s) modified without a manifest entry added, not judged an addition: ${lockfiles.join(", ")}`
      : "",
    moved.length > 0
      ? `; submodule(s) moved to another commit, a version change: ${moved.join(", ")}`
      : "",
  ].join("");
  const volume =
    `dependency partition of ${total} changed path(s): ${parts}` +
    `; ${scan.treeSymlinks.length} symlinked dependency file(s) outside the diff`;
  const verdict = verdictOf(
    scan.contradictions,
    sums
      ? scan.unverifiable
      : [
          ...scan.unverifiable,
          `the partition counts ${total} of ${context.entries.length} path(s)`,
        ],
    `no dependency added in ${context.entries.length} changed path(s)${notJudged}`,
    volume,
    `remove "dependency" from the Not-added line, or teach ${CONFIG_PATH} the format`,
  );
  return verdict;
}

/** Pure verdict over one description and, when a verifiable negative needs it, the change set. */
export function evaluateNegatives(
  body: string,
  label: string,
  readContext: () => ContextRead,
): GateReport {
  const report = new GateReport();
  const declaration = readNegativesDeclaration(body);
  const ignored =
    declaration.ignoredInBlocks > 0
      ? `; ${declaration.ignoredInBlocks} Not-added mention(s) inside them ignored, not declarations`
      : "";
  const lines =
    `${declaration.linesExamined} description line(s) examined after removing ` +
    `${declaration.removedBlocks} comment/code block(s)${ignored}; ${declaration.declarationLines} Not-added line(s), ` +
    `${declaration.misplacedLines} misplaced mention(s)`;

  if (declaration.kind === "absent") {
    report.check(
      `${label} — Not-added`,
      true,
      "no Not-added line: nothing declared, nothing to confront (optional, ADR-0056 D5)",
    );
    report.volume(`${lines}; diff not read: no negative declared`);
    return report;
  }
  if (declaration.kind === "refused") {
    report.check(`${label} — Not-added`, false, `refused: ${declaration.reasons.join("; ")}`);
    report.volume(`${lines}; diff not read: the declaration is refused`);
    return report;
  }

  const { values } = declaration;
  report.check(`${label} — Not-added`, true, `Not-added: ${values.join(", ")}`);
  const verifiable = values.filter((value): value is VerifiableNegative => VERIFIABLE.has(value));
  const declarative = values.filter((value) => !VERIFIABLE.has(value));
  for (const value of declarative) {
    report.check(
      `${label} — Not-added ${value}`,
      true,
      "declarative: a vocabulary value, not verified by this gate — read in review (ADR-0056 D2)",
    );
  }
  const negatives =
    `negatives: ${values.length} declared, ${verifiable.length} verified against the diff` +
    `${verifiable.length > 0 ? ` (${verifiable.join(", ")})` : ""}, ${declarative.length} declarative, not verified by this gate` +
    `${declarative.length > 0 ? ` (${declarative.join(", ")})` : ""}`;
  if (verifiable.length === 0) {
    report.volume(`${lines}; ${negatives}; diff not read: no verifiable negative declared`);
    return report;
  }

  const context = readContext();
  if (!context.ok) {
    report.check(`${label} — diff`, false, `unreadable, nothing verified: ${context.reason}`);
    report.volume(`${lines}; ${negatives}; diff unreadable`);
    return report;
  }
  const { entries } = context;
  const counts = (["A", "M", "D", "T"] as const)
    .map((status) => `${entries.filter((entry) => entry.status === status).length} ${status}`)
    .join(", ");
  const volumes: string[] = [];
  for (const value of verifiable) {
    const confrontation =
      value === "workflow"
        ? confrontWorkflow(entries, context.config)
        : value === "schema"
          ? confrontSchema(entries, context.readBlob, context.config)
          : confrontDependency(context);
    report.check(`${label} — Not-added ${value}`, confrontation.ok, confrontation.note);
    volumes.push(confrontation.volume);
  }
  report.volume(
    `${lines}; ${negatives}; rules read at the merge base; diff: ${entries.length} changed path(s) examined (${counts}); ${volumes.join("; ")}`,
  );
  return report;
}

// ---------------------------------------------------------------------------
// The effectful half: the event, git, and the rules at the merge base.

/** Fetch the base, take its merge base with HEAD, and read the change set and the rules from there. */
function readPullRequestContext(baseRef: string): ContextRead {
  const fetched = runGit(["fetch", "--quiet", "origin", baseRef]);
  if (fetched.exitCode !== 0) {
    return { ok: false, reason: `could not fetch origin/${baseRef}: ${fetched.stderr.trim()}` };
  }
  const mergeBase = readGit(
    ["merge-base", `origin/${baseRef}`, "HEAD"],
    `find the merge base of origin/${baseRef} and HEAD`,
  );
  if (!mergeBase.ok) return mergeBase;
  const base = mergeBase.stdout.trim();
  const listed = listChangedPaths([base, "HEAD"]);
  if (!listed.ok) return listed;
  const baseTree = listTree(base);
  if (!baseTree.ok) return baseTree;
  const headTree = listTree("HEAD");
  if (!headTree.ok) return headTree;
  const data = readGit(
    ["cat-file", "blob", `${base}:${CONFIG_PATH}`],
    `read ${CONFIG_PATH} at the merge base ${base}`,
  );
  if (!data.ok)
    return {
      ok: false,
      reason: `the rules are read at the merge base, never from the head: ${data.reason}`,
    };
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${CONFIG_PATH} at the merge base does not parse (${message})` };
  }
  const config = validateConfig(parsed);
  if (!config.ok) return { ok: false, reason: `at the merge base: ${config.reason}` };
  const readBlob: BlobReader = (side, path) => {
    const read = readGit(
      ["cat-file", "blob", `${side === "base" ? base : "HEAD"}:${path}`],
      `read ${path} at the ${side}`,
    );
    return read.ok ? { ok: true, text: read.stdout } : read;
  };
  return {
    ok: true,
    entries: listed.entries,
    readBlob,
    trees: { base: baseTree.entries, head: headTree.entries },
    config: config.config,
  };
}

if (import.meta.main) {
  const gate = "PR negatives";
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    concludeGate(
      gate,
      new GateReport().allowEmpty(
        `not a pull_request run (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}) — ` +
          "the declaration lives in a pull request description, judged at the PR gate",
      ),
    );
  } else {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    const baseRef = process.env.GITHUB_BASE_REF;
    let failure: string | null = null;
    let event: { body: string; number: number | null } | null = null;
    if (!eventPath) {
      failure = "GITHUB_EVENT_PATH is unset on a pull_request run";
    } else {
      try {
        const read = readPullRequestEvent(await Bun.file(eventPath).text());
        if (read.ok) event = read;
        else failure = read.reason;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failure = `event payload unreadable at ${eventPath} (${message})`;
      }
    }
    if (event === null || failure !== null) {
      concludeGate(
        gate,
        new GateReport().check("pull request event", false, failure ?? "no event"),
      );
    } else {
      const label =
        event.number === null ? "pull request description" : `PR #${event.number} description`;
      const readContext = (): ContextRead =>
        baseRef
          ? readPullRequestContext(baseRef)
          : { ok: false, reason: "GITHUB_BASE_REF is unset on a pull_request run" };
      concludeGate(gate, evaluateNegatives(event.body, label, readContext));
    }
  }
}
