import { decodeHTML } from "entities";
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
 * declaration.
 *
 * THE FORM (owner decisions in chat on 2026-10-23, which ADR-0056 left to the
 * gate): one line that starts exactly with the key, like `Door:`,
 *
 *     Not-added: dependency, schema, telemetry
 *
 * outside HTML comments and fenced code blocks (removed first by
 * check-pr-door's own `stripNonDeclarations`); values from the closed
 * vocabulary, comma-separated, each once; at most one such line. The line is
 * OPTIONAL: absent, the gate passes and says so.
 *
 * WHAT A NEGATIVE MEANS HERE: THE SURFACE IS NOT TOUCHED (design decided by
 * the orchestrator after the second review of 2026-10-23). The gate does not
 * try to understand manifests, provenance or `uses:`: two reviews showed that
 * every such reading has a form it misses (a duplicated JSON key, a spec
 * without `/`, a widened `workspaces`, a registry configuration). Instead each
 * verifiable negative names a SURFACE, in data (`pr-negatives.v1.json`), and
 * any contact of the diff with that surface makes the negative unverifiable:
 * the check fails, naming the path ("cannot verify: <path> changed — remove
 * <value> from Not-added:"). Because the line is optional, a pull request that
 * cannot prove a negative simply does not declare it.
 *
 * - `dependency` now means "the pull request does not touch the dependency
 *   surface" — stronger than "adds no dependency": a version bump, a lockfile
 *   refresh, a removal, any change of a registry configuration, all touch
 *   it. The surface is WIDE ON PURPOSE (orchestrator, third review of
 *   2026-10-23): the line is optional, so a wide surface costs nothing, and
 *   widening beats refining the analysis. It holds, by name or path (the
 *   list in the data file is the authority): manifests, lockfiles and
 *   workspace files of the fleet's ecosystems; every `*requirements*.txt|in`,
 *   `requirements/`, `constraints*.txt`; the registry and package-manager
 *   configurations (`.npmrc`, `.yarnrc*`, `.yarn/`, `bunfig.toml`,
 *   `.cargo/`, `pip.conf`, `pip.ini`, `uv.toml`, `.pnpmfile.cjs`, Plug'n'Play
 *   loaders, import maps); the tooling pins of this repository (`*.pin.json`,
 *   `toolchains/`) and the version files (`.tool-versions`, `.nvmrc`,
 *   `.node-version`, `.python-version`, `mise.toml`, `rust-toolchain*`,
 *   `gradle/wrapper/`); third-party code and its patches (`node_modules/`,
 *   `vendor/`, `third_party/`, `patches/`); `.github/workflows/`,
 *   `.github/actions/` and every `action.yml|yaml`, where `uses:` lives;
 *   `Dockerfile*` and `Containerfile*`; `.gitmodules`. By mode: any gitlink
 *   (160000) on either side, and any symlink (120000) added, modified or
 *   deleted anywhere — a link can bring an existing manifest into a
 *   workspace. By content: any `.py` added or modified that carries a PEP 723
 *   block (`# /// script`), a byte search. Any status counts, and a rename
 *   counts on both sides (the list is read with `--no-renames`). A symlink in
 *   either TREE, in the diff or not, whose path or path-as-a-directory (`path`
 *   and `path/`) is on the surface counts too: its target can change without
 *   the link changing, and a directory link named `.cargo` holds what
 *   `.cargo/` would.
 * - `workflow`: no path added or type-changed at or under `.github/workflows`
 *   (a rename is an addition), and no symlink at or under `.github`, added or
 *   modified in the diff, or present in either tree.
 *
 * STRUCTURAL LIMITS, not enumerable by path and therefore not verified: a
 * script already referenced (a `postinstall`, a build script) that installs
 * at run time; `npm:` or `https:` imports written in source code; a change of
 * behaviour of an already-vendored dependency living outside the listed
 * paths. A reviewer reads those; the negative does not cover them.
 * - `schema`: no path added, modified or type-changed matching the schema name
 *   rules; and no `.json`, `.jsonc`, `.json5`, `.yaml` or `.yml` added,
 *   modified or type-changed whose raw content contains, in any case, the
 *   substring `schema` or an escape sequence opener (backslash `u`, backslash
 *   `x`) — a byte search, no parse. The rule is DELIBERATELY WIDE and fails
 *   closed: every escaped spelling of `$schema` needs one of those openers, so
 *   no spelling is missed, and a file that merely says `schema`, or escapes
 *   anything, makes the negative unverifiable. That is acceptable: do not
 *   declare it.
 *
 * All path comparisons are case-insensitive: macOS and Windows checkouts are.
 *
 * THE RULES ARE THE BASE'S: `pr-negatives.v1.json` is read at the merge base
 * with `git cat-file blob`, never from the head; absent or unreadable there,
 * every verifiable negative fails closed. The gate's code runs from the pull
 * request's branch, like every gate of this repository.
 *
 * MISPLACED KEYS. A visible line that is not a declaration but whose START
 * renders as the key is refused by name ("write it as `Not-added:` at the
 * start of its own line"): behind markup prefixes (`>`, `-`, `*`, `+`, `#`,
 * `_`, `[`, a backquote, `~`, a number followed by `.` or `)`), and after
 * normalising the line:
 * backslash escapes removed, HTML entities decoded, tags removed, every
 * `\p{Pd}` dash read as `-`, `\p{Cf}` characters removed (a BOM, a
 * zero-width space, a soft hyphen — the key pattern needs no separator, so
 * `Not` + U+00AD + `added:` still matches), case folded. A mention in the
 * middle of prose is not
 * refused: it reads as prose (#143 and #145 were refused for "… lists. Not
 * added: the gate refuses …" before this rule). Out of reach, declared: a
 * homoglyph (the key written with U+043E, the Cyrillic small o, in place of
 * the Latin `o`) is not normalised, so such a
 * line is neither a declaration nor refused.
 *
 * What this depends on in check-pr-door, which #141 is rewriting: only that
 * `stripNonDeclarations` returns `text` (comments and code removed, split by
 * `\n`) and `removedBlocks`. Which key lines count as declarations is read in
 * one function, `readDeclarationLines`, the only one to change when #141's
 * `readDeclarationBlocks` lands. Line numbers in refusals follow `text`.
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
/** The one valid form: the exact key at column 0. */
const DECLARATION_LINE = /^Not-added:(.*)$/;
/** The key as a normalised line start renders it. */
const NORMALISED_KEY = /^not[\s-]*added\s*:/;
/** Markup a line may start with before the key still renders first. */
const MARKUP_PREFIX = /^(?:\s+|[>\-*+#_[`~]|\d+[.)])/;
/** Any occurrence, to count the lines whose mention a comment or code block hid. */
const KEY_ANYWHERE = /not[\s\p{Pd}]*added\s*:/iu;
const BAD_SEPARATOR = /[\s;|/]/;
/** U+FEFF, written as a code point so the source carries no invisible character. */
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);

/** How a line starts once rendered: the text a reader takes for its first word. */
export function renderedLineStart(line: string): string {
  let text = line.replace(/\\([!-/:-@[-`{-~])/g, "$1");
  text = decodeHTML(text);
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/\p{Pd}/gu, "-");
  // U+00AD (soft hyphen) is Cf and goes here with the BOM and the zero-width
  // characters; NORMALISED_KEY accepts no separator at all, so `Not` U+00AD
  // `added:` still reads as the key. Mapping it to `-` first was measured as
  // an equivalent mutant on 2026-10-23, and removed.
  text = text.replace(/\p{Cf}/gu, "");
  text = text.toLowerCase();
  for (let prefix = MARKUP_PREFIX.exec(text); prefix !== null; prefix = MARKUP_PREFIX.exec(text)) {
    text = text.slice(prefix[0].length);
  }
  return text;
}

export interface NegativesLines {
  readonly linesExamined: number;
  readonly removedBlocks: number;
  /** Key mentions inside the removed comments and code blocks: not declarations. */
  readonly ignoredInBlocks: number;
  readonly declarationLines: number;
  /** Visible lines whose start renders as the key without being a declaration: refused. */
  readonly misplacedLines: number;
}

export type NegativesDeclaration =
  | (NegativesLines & { readonly kind: "absent" })
  | (NegativesLines & { readonly kind: "refused"; readonly reasons: readonly string[] })
  | (NegativesLines & { readonly kind: "declared"; readonly values: readonly Negative[] });

/** Author text quoted in a verdict: one line, escaped, bounded. */
function quote(text: string): string {
  const trimmed = text.trim();
  return JSON.stringify(trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed);
}

/** Pure parse of the declaration of a pull request description. */
export interface DeclarationLines {
  /** The visible text: comments and code blocks removed, one line per `\n`. */
  readonly text: string;
  readonly removedBlocks: number;
  /** The value of every key line the declaration grammar admits, text after the key. */
  readonly admitted: readonly string[];
}

/**
 * THE ONE SEAM with the declaration grammar of check-pr-door. When #141
 * merges, this function alone changes: `text` and `removedBlocks` keep
 * coming from `stripNonDeclarations`, and `admitted` becomes
 * `readDeclarationBlocks(body).values["Not-added"]`, which adds a real
 * boundary before the block, values free of `<>[]` and backquote and double
 * quote, and nothing after unclosed raw HTML. Everything else of this gate
 * stays: the misplaced-key detection (the grammar does not provide it), and
 * the refusal of a key line the grammar does not admit, which is dormant
 * today because both readings coincide.
 */
export function readDeclarationLines(body: string): DeclarationLines {
  const { text, removedBlocks } = stripNonDeclarations(body);
  const admitted = text.split("\n").flatMap((line) => {
    const declaration = DECLARATION_LINE.exec(line);
    return declaration === null ? [] : [declaration[1] ?? ""];
  });
  return { text, removedBlocks, admitted };
}

export function readNegativesDeclaration(
  body: string,
  readLines: (body: string) => DeclarationLines = readDeclarationLines,
): NegativesDeclaration {
  const unmarked = body.startsWith(BYTE_ORDER_MARK) ? body.slice(BYTE_ORDER_MARK.length) : body;
  const normalized = unmarked.replace(/\r\n?/g, "\n");
  const { text, removedBlocks, admitted } = readLines(normalized);
  const visible = text.split("\n");
  let keyLines = 0;
  const misplaced: string[] = [];
  visible.forEach((line, index) => {
    if (DECLARATION_LINE.test(line)) keyLines += 1;
    else if (NORMALISED_KEY.test(renderedLineStart(line))) {
      misplaced.push(
        `line ${index + 1} ${quote(line)} — write it as "${NEGATIVES_KEY}" at the start of its own line`,
      );
    }
  });
  const declarations = [...admitted];
  const lines: NegativesLines = {
    linesExamined: text === "" ? 0 : visible.length,
    removedBlocks,
    // Counted directly, never as a difference of two totals (which went to -1
    // on `Not<!-- x -->-added:`, where removing the comment CREATES a key): a
    // line is counted when it mentions the key before stripping and no longer
    // does after. `stripNonDeclarations` keeps the line count.
    ignoredInBlocks: normalized
      .split("\n")
      .filter((line, index) => KEY_ANYWHERE.test(line) && !KEY_ANYWHERE.test(visible[index] ?? ""))
      .length,
    declarationLines: declarations.length,
    misplacedLines: misplaced.length,
  };
  const refusals = [...misplaced];
  // A key line at column 0 that the grammar does not admit would otherwise be
  // neither a declaration nor a refusal: the author's negative, silently gone.
  if (keyLines > declarations.length) {
    refusals.push(
      `${keyLines - declarations.length} Not-added line(s) not admitted by the declaration grammar — see check-pr-door`,
    );
  }
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
// The surfaces, in pr-negatives.v1.json, read at the merge base.

export const CONFIG_PATH: string = "tools/quality/pr-negatives.v1.json";

export interface NegativesConfig {
  readonly workflowDirectory: string;
  readonly workflowSymlinkRoot: string;
  readonly schemaPatterns: readonly RegExp[];
  readonly schemaContentExtensions: readonly string[];
  readonly schemaContentMarkers: readonly string[];
  readonly dependencyBasenames: ReadonlySet<string>;
  readonly dependencyPatterns: readonly RegExp[];
  /** Files whose CONTENT puts them on the surface (a PEP 723 block in a `.py`). */
  readonly dependencyContentExtensions: readonly string[];
  readonly dependencyContentMarkers: readonly string[];
}

export type ConfigRead =
  | { readonly ok: true; readonly config: NegativesConfig }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
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

const trimSlashes = (path: string): string => path.replace(/^\/+|\/+$/g, "").toLowerCase();

/** Pure validation of the parsed data file. Anything unexpected is a reason, never a default. */
export function validateConfig(value: unknown): ConfigRead {
  const fail = (reason: string): ConfigRead => ({ ok: false, reason: `${CONFIG_PATH}: ${reason}` });
  if (!isRecord(value)) return fail("expected an object");
  const { workflow, schema, dependency } = value;
  if (
    !isRecord(workflow) ||
    typeof workflow.directory !== "string" ||
    workflow.directory === "" ||
    typeof workflow.symlinkRoot !== "string" ||
    workflow.symlinkRoot === ""
  ) {
    return fail("workflow needs a directory and a symlinkRoot");
  }
  if (
    !isRecord(schema) ||
    !isStrings(schema.pathPatterns) ||
    !isStrings(schema.contentExtensions) ||
    !isStrings(schema.contentMarkers)
  ) {
    return fail("schema needs pathPatterns, contentExtensions and contentMarkers");
  }
  if (
    !isRecord(dependency) ||
    !isStrings(dependency.basenames) ||
    !isStrings(dependency.pathPatterns) ||
    !isStrings(dependency.contentExtensions) ||
    !isStrings(dependency.contentMarkers)
  ) {
    return fail("dependency needs basenames, pathPatterns, contentExtensions and contentMarkers");
  }
  const schemaPatterns = compile(schema.pathPatterns, "schema.pathPatterns");
  if (typeof schemaPatterns === "string") return fail(schemaPatterns);
  const dependencyPatterns = compile(dependency.pathPatterns, "dependency.pathPatterns");
  if (typeof dependencyPatterns === "string") return fail(dependencyPatterns);
  return {
    ok: true,
    config: {
      workflowDirectory: trimSlashes(workflow.directory),
      workflowSymlinkRoot: trimSlashes(workflow.symlinkRoot),
      schemaPatterns,
      schemaContentExtensions: schema.contentExtensions.map((extension) => extension.toLowerCase()),
      schemaContentMarkers: schema.contentMarkers.map((marker) => marker.toLowerCase()),
      dependencyBasenames: new Set(dependency.basenames.map((name) => name.toLowerCase())),
      dependencyPatterns,
      dependencyContentExtensions: dependency.contentExtensions.map((extension) =>
        extension.toLowerCase(),
      ),
      dependencyContentMarkers: dependency.contentMarkers.map((marker) => marker.toLowerCase()),
    },
  };
}

// ---------------------------------------------------------------------------
// The confrontation: does the diff touch a surface?

export type BlobRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/** Reads a file at the head of the pull request. */
export type BlobReader = (path: string) => BlobRead;

export interface ChangeContext {
  readonly entries: readonly ChangedPath[];
  readonly readBlob: BlobReader;
  /** Both trees, for the symlinks the diff does not show. */
  readonly trees: { readonly base: readonly TreeEntry[]; readonly head: readonly TreeEntry[] };
  /** The surfaces, as the merge base holds them. */
  readonly config: NegativesConfig;
}

export type ContextRead =
  | ({ readonly ok: true } & ChangeContext)
  | { readonly ok: false; readonly reason: string };

const isSymlink = (entry: ChangedPath): boolean =>
  entry.oldMode === SYMLINK_MODE || entry.newMode === SYMLINK_MODE;
const isGitlink = (entry: ChangedPath): boolean =>
  entry.oldMode === GITLINK_MODE || entry.newMode === GITLINK_MODE;
const atOrUnder = (path: string, directory: string): boolean => {
  const lower = path.toLowerCase();
  return lower === directory || lower.startsWith(`${directory}/`);
};

/** A surface contact: the path, its status, and why it is on the surface. */
export interface Contact {
  readonly path: string;
  readonly status: string;
  readonly why: string;
}

/** Pure: is this path, whatever its modes, on the dependency surface by name? */
function onDependencySurfaceByName(path: string, config: NegativesConfig): string | null {
  const basename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (config.dependencyBasenames.has(basename))
    return "manifest, lockfile or registry configuration";
  if (config.dependencyPatterns.some((pattern) => pattern.test(path)))
    return "dependency surface path";
  return null;
}

/** Pure: every contact of the change set with the dependency surface. */
export function dependencyContacts(context: ChangeContext): Contact[] {
  const contacts: Contact[] = [];
  const inDiff = new Set<string>();
  for (const entry of context.entries) {
    inDiff.add(entry.path);
    const why = isGitlink(entry)
      ? "gitlink"
      : isSymlink(entry)
        ? "symlink"
        : (onDependencySurfaceByName(entry.path, context.config) ??
          dependencyContent(entry, context));
    if (why !== null) contacts.push({ path: entry.path, status: entry.status, why });
  }
  for (const side of ["base", "head"] as const) {
    for (const entry of context.trees[side]) {
      if (entry.mode !== SYMLINK_MODE || inDiff.has(entry.path)) continue;
      // A link is tested as a file AND as a directory: the directory patterns
      // end with `/`, and a link named `.cargo` holds what `.cargo/` would.
      if (
        onDependencySurfaceByName(entry.path, context.config) !== null ||
        onDependencySurfaceByName(`${entry.path}/`, context.config) !== null
      ) {
        contacts.push({ path: entry.path, status: side, why: `a symlink in the ${side} tree` });
      }
    }
  }
  return contacts;
}

/** A file put on the surface by its content: a PEP 723 block in a `.py`, by byte search. */
function dependencyContent(entry: ChangedPath, context: ChangeContext): string | null {
  const { dependencyContentExtensions, dependencyContentMarkers } = context.config;
  if (entry.status === "D") return null;
  const lower = entry.path.toLowerCase();
  if (!dependencyContentExtensions.some((extension) => lower.endsWith(extension))) return null;
  const blob = context.readBlob(entry.path);
  if (!blob.ok) return `unreadable: ${blob.reason}`;
  const content = blob.text.toLowerCase();
  const marker = dependencyContentMarkers.find((candidate) => content.includes(candidate));
  return marker === undefined ? null : `content carries ${marker}`;
}

/** Pure: every contact of the change set with the workflow surface. */
export function workflowContacts(context: ChangeContext): Contact[] {
  const { workflowDirectory, workflowSymlinkRoot } = context.config;
  const contacts: Contact[] = [];
  for (const entry of context.entries) {
    if (entry.status === "D") continue;
    if (
      (entry.status === "A" || entry.status === "T") &&
      atOrUnder(entry.path, workflowDirectory)
    ) {
      contacts.push({
        path: entry.path,
        status: entry.status,
        why: "workflow file added or type-changed",
      });
    } else if (entry.newMode === SYMLINK_MODE && atOrUnder(entry.path, workflowSymlinkRoot)) {
      contacts.push({
        path: entry.path,
        status: entry.status,
        why: `symlink under ${workflowSymlinkRoot}`,
      });
    }
  }
  const named = new Set(contacts.map((contact) => contact.path));
  for (const side of ["base", "head"] as const) {
    for (const entry of context.trees[side]) {
      if (entry.mode !== SYMLINK_MODE || named.has(entry.path)) continue;
      if (atOrUnder(entry.path, workflowSymlinkRoot)) {
        named.add(entry.path);
        contacts.push({
          path: entry.path,
          status: side,
          why: `a symlink under ${workflowSymlinkRoot} in the ${side} tree`,
        });
      }
    }
  }
  return contacts;
}

/** Pure: every contact of the change set with the schema surface. */
export function schemaContacts(context: ChangeContext): Contact[] {
  const { schemaPatterns, schemaContentExtensions, schemaContentMarkers } = context.config;
  const contacts: Contact[] = [];
  for (const entry of context.entries) {
    if (entry.status === "D") continue;
    if (schemaPatterns.some((pattern) => pattern.test(entry.path))) {
      contacts.push({ path: entry.path, status: entry.status, why: "schema file name" });
      continue;
    }
    const lower = entry.path.toLowerCase();
    if (!schemaContentExtensions.some((extension) => lower.endsWith(extension))) continue;
    if (isSymlink(entry) || isGitlink(entry)) {
      contacts.push({
        path: entry.path,
        status: entry.status,
        why: "a link, whose content cannot be read",
      });
      continue;
    }
    const blob = context.readBlob(entry.path);
    if (!blob.ok) {
      contacts.push({ path: entry.path, status: entry.status, why: `unreadable: ${blob.reason}` });
      continue;
    }
    const content = blob.text.toLowerCase();
    const marker = schemaContentMarkers.find((candidate) => content.includes(candidate));
    if (marker !== undefined) {
      contacts.push({ path: entry.path, status: entry.status, why: `content carries ${marker}` });
    }
  }
  return contacts;
}

const CONTACTS: Readonly<Record<VerifiableNegative, (context: ChangeContext) => Contact[]>> = {
  dependency: dependencyContacts,
  schema: schemaContacts,
  workflow: workflowContacts,
};

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
    `${declaration.misplacedLines} misplaced key(s)`;

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
  const examined = context.entries.length;
  const surfaces: string[] = [];
  for (const value of verifiable) {
    const contacts = CONTACTS[value](context);
    report.check(
      `${label} — Not-added ${value}`,
      contacts.length === 0,
      contacts.length === 0
        ? `the ${value} surface is not touched by any of ${examined} changed path(s)`
        : contacts
            .map(
              (contact) =>
                `cannot verify: ${contact.path} (${contact.status}, ${contact.why}) changed — remove "${value}" from ${NEGATIVES_KEY}`,
            )
            .join("; "),
    );
    surfaces.push(`${value}: ${contacts.length} contact(s)`);
  }
  report.volume(
    `${lines}; ${negatives}; rules read at the merge base; diff: ${examined} changed path(s) examined, ` +
      `${context.trees.base.length + context.trees.head.length} tree entries read for symlinks; ${surfaces.join(", ")}`,
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
  if (!data.ok) {
    return {
      ok: false,
      reason: `the rules are read at the merge base, never from the head: ${data.reason}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${CONFIG_PATH} at the merge base does not parse (${message})` };
  }
  const config = validateConfig(parsed);
  if (!config.ok) return { ok: false, reason: `at the merge base: ${config.reason}` };
  const readBlob: BlobReader = (path) => {
    const read = readGit(["cat-file", "blob", `HEAD:${path}`], `read ${path} at the head`);
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
