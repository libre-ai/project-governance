import { decodeHTML } from "entities";
import { readDeclarationBlocks, readPullRequestEvent, stripNonDeclarations } from "./check-pr-door";
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
 * gate; the block, owner decision of 2026-10-24): one line of the
 * declaration block at the top of the description, read by check-pr-door's
 * `readDeclarationBlocks` — zero or more whole-line HTML comments, then the
 * block (`Door:`, `Origin:`, this line…), ended by a blank line:
 *
 *     Door: two-way
 *     Origin: proposal
 *     Not-added: dependency, schema, telemetry
 *
 * Its value passes T2' (outside a code span: no `[`, `]`, `~`, `$`, no `<`
 * but a whole autolink, no HTML), and holds values from the closed
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
 *   `Dockerfile*` and `Containerfile*`; `.gitmodules`; every `*.lock` (uv
 *   locks a PEP 723 script as `<script>.lock`, whatever the script's name);
 *   `.python-versions` as well as `.python-version` (uv reads both); `.env`
 *   and every `.env.*` except `.env.example` (Bun reads a registry from
 *   them, measured — the data file carries the measure); and the data files
 *   CI reads to fetch and run other code: `.github/composition/` (the
 *   composition manifest pins fleet repositories at a ref, and
 *   run-composition.py fetches and runs them), `ecosystem/fleet-pins.v1.yaml`
 *   (it picks the generation whose manifest CI replays and installs) and
 *   `ecosystem/repositories.v1.yaml` (the repositories CI clones and scans).
 *   By mode: any gitlink (160000) on either side, and any symlink (120000)
 *   added, modified or deleted anywhere — a link can bring an existing
 *   manifest into a workspace. By content: ANY file added or modified that
 *   carries a PEP 723 block (`# /// script`), whatever its extension, by byte
 *   search — uv runs such a block from a `.pyw` or from a script without
 *   extension; reading every changed file was measured affordable on
 *   2026-10-24 (763 tracked files, about 7.5 MB, 3.7 s, one `cat-file` per
 *   file). Any status counts, and a rename counts on both sides (the list is
 *   read with `--no-renames`). A symlink in either TREE, in the diff or not,
 *   whose path or path-as-a-directory (`path` and `path/`) is on the surface
 *   counts too, once: its target can change without the link changing, and a
 *   directory link named `.cargo` holds what `.cargo/` would.
 * - `workflow`: no path added or type-changed at or under `.github/workflows`
 *   (a rename is an addition), and no symlink at or under `.github` in the
 *   diff, whatever its status, or present in either tree.
 * - `schema`: no path added, modified or type-changed matching the schema name
 *   rules; no `.json`, `.jsonc`, `.json5`, `.yaml` or `.yml` added, modified
 *   or type-changed whose raw content contains, in any case, `schema`, an
 *   escape opener (backslash `u`, backslash `x`) or a backslash followed by a
 *   line break (a YAML double-quoted scalar folds `"$sch\` + newline + `ema"`
 *   into `$schema`), and, in a `.json5`, any backslash at all (JSON5 accepts
 *   identity escapes such as `\s` and line continuations) — a byte search, no
 *   parse, deliberately wide and failing closed. A backslash before a line
 *   break never occurs in valid JSON, so that marker costs JSON nothing. No
 *   symlink, in the diff or in either tree, named as a schema directory
 *   (tested as `path/x.json`) or pointing into a `schema/` or `schemas/`
 *   directory or at a schema file. What this covers: the escapes, folds and
 *   continuations of JSON, JSONC, JSON5 and YAML known to spell `$schema`. A
 *   file that merely says `schema`, or escapes anything, makes the negative
 *   unverifiable: do not declare it.
 *
 * STRUCTURAL LIMITS, not enumerable by path and therefore not verified: a
 * script already referenced (a `postinstall`, a build script) that installs
 * at run time; `npm:` or `https:` imports written in source code; a change of
 * behaviour of an already-vendored dependency living outside the listed
 * paths. A reviewer reads those; the negative does not cover them.
 *
 * All path comparisons are case-insensitive: macOS and Windows checkouts are.
 *
 * THE RULES ARE THE BASE'S: `pr-negatives.v1.json` is read at the merge base
 * with `git cat-file blob`, never from the head; absent or unreadable there,
 * every verifiable negative fails closed. The gate's code runs from the pull
 * request's branch, like every gate of this repository.
 *
 * THE INVARIANT, AND ONLY THIS ONE (orchestrator, after the sixth review of
 * 2026-10-24): only the block at the top declares; each verifiable negative
 * in it is confronted to the diff. A form that resembles the key anywhere
 * else is PROSE, refused only when the best-effort detection below
 * recognises it. The recognition of rendered Markdown and HTML by patterns
 * is not pursued further: it is an aid, never a guarantee, and nothing here
 * claims that every displayed resemblance is refused.
 *
 * MISPLACED KEYS, best effort. A line that is not the exact key at column 0
 * and that the Door gate does not refuse is refused by name ("write it as
 * `Not-added:` at the start of its own line") when its START, once
 * normalised, reads as the key. Normalisation: backslash escapes removed;
 * complete HTML comments removed (`-->`, `--!>`, the short forms `<!-->` and
 * `<!--->`), then tags, their quoted attribute values read whole;
 * entities decoded; every `\p{Pd}` dash read as `-`; every
 * `\p{Default_Ignorable_Code_Point}` removed, with the braille blank U+2800
 * and the Hangul fillers (the key pattern needs no separator, so the key
 * split by an invisible still matches); case folded; the markers `*` and the
 * backquote removed wherever they sit, `_` only at a word's edge (GitHub
 * displays `Not_added` as written); then markup
 * prefixes stripped: white space, a task box `[ ]` or `[x]`, `>`, `-`, `+`,
 * `#`, `[`, `~`, a number followed by `.` or `)`. Where the line starts
 * inside a comment or fence the Door gate exempts, what is judged is what
 * follows its close on that line (GitHub displays it); a line wholly inside
 * one is not displayed and not judged. Where it starts inside a comment that
 * is not exempt, both the raw line and what follows the close are judged
 * (see `displayedForms`).
 *
 * Measured against GitHub's rendering (POST /markdown, gfm, 2026-10-24) on 58
 * bodies: the 15 cases of the seventh review, the 36 bodies of the fifth
 * review's point 3, 4 underscore cases and 3 short-form comments. The
 * combined verdict (Door, then this gate) differs from what GitHub displays
 * on 8 of them, all refusals of a key GitHub does not display at a line
 * start, none the reverse: a `<!--` in a code span or mid-line followed, on
 * a later line, by `-->` and the key (2); a mid-line `<!--` whose comment
 * GitHub really opens over the next line (5, kept refused since the fifth
 * review); and a comment closed then reopened on the same line, which the
 * Door gate refuses by T3 (1).
 *
 * What the detection does NOT recognise, declared and not coded: a visual
 * line break inside one source line (`<br>`, a `<p>` or the end of a
 * `</div>` that starts the key on a new displayed line); a key in a table
 * cell or a footnote; a bidirectional override (U+202E) that reorders what
 * is displayed; a homoglyph (the key written with U+043E, the Cyrillic small
 * o, in place of the Latin `o`); and any rendering not listed above. A
 * mention in the middle of prose is not refused either: it reads as prose
 * (#143 and #145 were refused for "… lists. Not added: the gate refuses …"
 * before that rule).
 *
 * What this depends on in check-pr-door: `readDeclarationBlocks` (the
 * admitted values, the block's range, the refusals, the key lines outside
 * the block) and `stripNonDeclarations` (`text` with the body's line layout,
 * `removedBlocks`), read in one function, `readDeclarationLines`. A key line
 * the Door gate refuses is never refused twice (see that function). Line
 * numbers in refusals are lines of the body.
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
/**
 * Characters that render as nothing: every `\p{Default_Ignorable_Code_Point}`
 * (the BOM, zero-width characters, the soft hyphen, U+034F, the variation
 * selectors, U+17B4 and U+17B5, the Mongolian free variation selectors, the
 * Hangul fillers), and the braille blank U+2800, which is a letter (sixth
 * review). Built from code points, so the source carries no invisible
 * character.
 */
const RENDERS_AS_NOTHING = new RegExp(
  `[\\p{Default_Ignorable_Code_Point}${String.fromCodePoint(0x2800, 0x115f, 0x1160, 0x3164, 0xffa0)}]`,
  "gu",
);
/**
 * A complete HTML comment on the line: closed by `-->` or `--!>`, as HTML5
 * closes it, or a short form (`<!-->`, `<!--->`). A comment left open to the
 * end of the line is not removed: everything after its opener is inside it,
 * so the line cannot start with the key either way (a `|$` branch was an
 * equivalent mutant, seventh review).
 */
const HTML_COMMENT = /<!--(?:-?>|[\s\S]*?--!?>)/g;
/** An HTML tag, its quoted attribute values read whole: `<span title=">">`. */
const HTML_TAG = /<\/?[A-Za-z](?:"[^"]*"|'[^']*'|[^'">])*>/g;
/**
 * Emphasis and code markers. `*` and the backquote are removed wherever they
 * sit (`N*ot*-added`, `Not-`added``): GitHub reads both inside a word. `_` is
 * removed only where it can be emphasis, at a word's edge (`__Not-added:__`),
 * never inside a word: GitHub displays `Not_added` with its underscore
 * (measured on POST /markdown, seventh review).
 */
const EMPHASIS_MARKERS = /[*`]|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu;
/** The key as a normalised line start renders it. */
const NORMALISED_KEY = /^not[\s-]*added\s*:/;
/** Markup a line may start with before the key still renders first; a task box first. */
const MARKUP_PREFIX = /^(?:\s+|\[[ x]\]|[>\-+#[~]|\d+[.)])/;
/** Any occurrence, to count the lines whose mention a comment or code block hid. */
const KEY_ANYWHERE = /not[\s\p{Pd}]*added\s*:/iu;
const BAD_SEPARATOR = /[\s;|/]/;
/** U+FEFF, written as a code point so the source carries no invisible character. */
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);

/** How a line starts once rendered: the text a reader takes for its first word. */
export function renderedLineStart(line: string): string {
  let text = line.replace(/\\([!-/:-@[-`{-~])/g, "$1");
  // Comments first, whole, then tags: a `>` inside a comment or inside a
  // quoted attribute value does not end it (sixth review).
  text = text.replace(HTML_COMMENT, "").replace(HTML_TAG, "");
  // Entities after the markup, so an encoded invisible (`&#x200B;`) is
  // decoded before the invisibles go.
  text = decodeHTML(text);
  text = text.replace(/\p{Pd}/gu, "-");
  // The soft hyphen is default-ignorable and goes with the rest;
  // NORMALISED_KEY accepts no separator at all, so `Not` U+00AD `added:`
  // still reads as the key.
  text = text.replace(RENDERS_AS_NOTHING, "");
  text = text.toLowerCase().replace(EMPHASIS_MARKERS, "");
  for (
    let prefix = text.match(MARKUP_PREFIX);
    prefix !== null;
    prefix = text.match(MARKUP_PREFIX)
  ) {
    text = text.slice(prefix[0].length);
  }
  return text;
}

export interface NegativesLines {
  /** The Door gate's partition, verbatim: totalLines = linesExamined + removedLines. */
  readonly totalLines: number;
  readonly linesExamined: number;
  readonly removedLines: number;
  readonly removedBlocks: number;
  /** Lines whose key mention a comment or code block hides: not declarations. */
  readonly ignoredInBlocks: number;
  readonly declarationLines: number;
  /** Displayed lines whose start renders as the key without being a declaration: refused. */
  readonly misplacedLines: number;
  /** `Not-added:` lines the Door gate refuses (T2', T3): named, never refused twice. */
  readonly leftToDoor: number;
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

/** Is this 1-based line one of the declaration block's? */
function inBlock(
  block: { readonly first: number; readonly last: number } | null,
  lineNumber: number,
): boolean {
  return block !== null && lineNumber >= block.first && lineNumber <= block.last;
}

/** Does this RAW line hold the exact key at column 0 (the Door gate's T1-T3)? */
function isKeyLine(line: string): boolean {
  return line.startsWith(NEGATIVES_KEY);
}

export interface DeclarationLines {
  /** The body's lines exactly as the Door gate splits them: one BOM removed, CRLF and CR normalised. */
  readonly raw: readonly string[];
  /** The same lines once comments and fences are blanked (stripNonDeclarations.lines). */
  readonly visible: readonly string[];
  /** Per line: inside a comment or fence the Door gate exempts (StrippedBody.insideClean). */
  readonly insideClean: readonly boolean[];
  /** Per line: it starts inside any comment or fence, clean or not (StrippedBody.inside). */
  readonly inside: readonly boolean[];
  /** 1-based first and last lines of the declaration block, or null when there is none. */
  readonly block: { readonly first: number; readonly last: number } | null;
  /** The value of every `Not-added:` line the declaration block admits, text after the key. */
  readonly admitted: readonly string[];
  /** `Not-added:` lines the Door gate refuses itself: T2' in the block, T3 outside it. */
  readonly leftToDoor: number;
  /** The same lines, 1-based: each line falls in one counter only. */
  readonly leftToDoorLines: ReadonlySet<number>;
  /** 1-based lines the Door gate already refuses (T1 end of block, T2'): not refused again. */
  readonly doorRefusedLines: ReadonlySet<number>;
  /** The Door gate's line partition, as it prints it. */
  readonly totalLines: number;
  readonly linesExamined: number;
  readonly removedLines: number;
  readonly removedBlocks: number;
}

/**
 * THE ONE SEAM with the declaration grammar of check-pr-door (#141, merged
 * in 0fe0a63). The owner decided on 2026-10-24 that declarations form a
 * block at the top of the description: zero or more whole-line HTML comments,
 * then the block, ended by a blank line (T1). `admitted` is
 * `readDeclarationBlocks(body).values["Not-added"]`: the block's `Not-added:`
 * lines whose value passes T2' — outside a code span, no `[`, `]`, `~`, `$`,
 * no `<` but a whole autolink, no HTML; a refused line also stops the lines
 * after it in the block from being read.
 *
 * The body is handed to check-pr-door UNCHANGED: it removes one BOM and
 * normalises line ends itself, and `raw` repeats exactly that, never more (a
 * second BOM removed here would read a block Door says does not exist).
 *
 * NEVER REFUSED TWICE (decided here, 2026-10-24). The Door gate, a required
 * check, already fails a `Not-added:` line it refuses: a value refused by
 * T2' in the block, a key line at column 0 outside it (T3, unless it sits in
 * a comment or fence opened at column 0 after a blank line, which GitHub does
 * not display), and the line that ends the block without a blank one (T1).
 * This gate does not refuse those again: it counts them as left to the Door
 * gate and prints the count. Both the count and the skip read the RAW line,
 * as T3 does (fifth review): a line where a removed comment makes the key
 * appear at column 0 (`<!-- c -->Not-added:`) is not the Door gate's, and is
 * judged here. What stays here is what the grammar does not provide: a
 * displayed line whose START RENDERS as the key without being the exact key
 * at column 0 (`> Not-added:`, `**Not-added:**`, `not-added:`, an escaped
 * dash…). The two never overlap: T3 judges the exact raw key at column 0,
 * this gate every other rendering, and a line the Door gate refuses (T1) is
 * skipped here.
 */
export function readDeclarationLines(body: string): DeclarationLines {
  const blocks = readDeclarationBlocks(body);
  const withoutBom = body.startsWith(BYTE_ORDER_MARK) ? body.slice(BYTE_ORDER_MARK.length) : body;
  const stripped = stripNonDeclarations(withoutBom);
  const normalized = withoutBom.replace(/\r\n?/g, "\n");
  const raw = normalized === "" ? [] : normalized.split("\n");
  if (normalized.endsWith("\n")) raw.pop();
  const refusedLines = new Set(blocks.refusals.map((refusal) => refusal.line));
  // Named line by line, never counted as a difference, so no count goes
  // below zero: the block's key lines the Door gate refused (T2', or after a
  // refused one), plus the key lines outside the block it judges (T3, not
  // exempt).
  const leftToDoorLines = new Set<number>();
  raw.forEach((line, index) => {
    const lineNumber = index + 1;
    if (inBlock(blocks.block, lineNumber) && isKeyLine(line) && refusedLines.has(lineNumber)) {
      leftToDoorLines.add(lineNumber);
    }
  });
  for (const keyLine of blocks.outsideKeyLines) {
    if (keyLine.key === "Not-added" && !keyLine.inside) leftToDoorLines.add(keyLine.line);
  }
  return {
    raw,
    visible: stripped.lines,
    insideClean: stripped.insideClean,
    inside: stripped.inside,
    block: blocks.block,
    admitted: blocks.values["Not-added"],
    leftToDoor: leftToDoorLines.size,
    leftToDoorLines,
    doorRefusedLines: refusedLines,
    totalLines: blocks.totalLines,
    linesExamined: blocks.linesExamined,
    removedLines: blocks.removedLines,
    removedBlocks: blocks.removedBlocks,
  };
}

/**
 * What GitHub may display of a raw line, judged by the misplaced-key check.
 * Measured against GitHub's own rendering (POST /markdown, gfm) on the
 * seventh review's bench, 2026-10-24:
 *
 * - a line inside a comment or fence the Door gate exempts (clean): only what
 *   follows the close (`visible`), since GitHub hides the rest (sixth review);
 * - a line inside a comment that is NOT clean: the raw line AND what follows
 *   the close. `stripNonDeclarations` reads a `<!--` in a code span, or one
 *   cmark ignores, as an opener, so `visible` alone would hide lines GitHub
 *   displays (19 of the 36 point-3 bodies went silent that way); the raw
 *   line alone would miss a key GitHub shows after a real comment closes
 *   (after a paragraph, an indented opener, a `<pre>` block). The cost, also
 *   measured: a key right after `-->` on a line that is in fact prose (the
 *   opener in a code span, or mid-line) is refused while GitHub shows it
 *   after other text;
 * - any other line: the raw line.
 */
function displayedForms(read: DeclarationLines, index: number): readonly string[] {
  const line = read.raw[index] ?? "";
  const visible = read.visible[index] ?? "";
  if (read.insideClean[index] === true) return [visible];
  if (read.inside[index] === true) return [line, visible];
  return [line];
}

/** Pure parse of the declaration of a pull request description. */
export function readNegativesDeclaration(
  body: string,
  readLines: (body: string) => DeclarationLines = readDeclarationLines,
): NegativesDeclaration {
  const read = readLines(body);
  const misplaced: string[] = [];
  const misplacedLines = new Set<number>();
  read.raw.forEach((line, index) => {
    // The Door gate owns the exact key at column 0 of the RAW line, and the
    // lines it refuses: neither is judged here.
    if (isKeyLine(line) || read.doorRefusedLines.has(index + 1)) return;
    if (
      displayedForms(read, index).some((shown) => NORMALISED_KEY.test(renderedLineStart(shown)))
    ) {
      misplacedLines.add(index + 1);
      misplaced.push(
        `line ${index + 1} ${quote(line)} — write it as "${NEGATIVES_KEY}" at the start of its own line`,
      );
    }
  });
  const declarations = [...read.admitted];
  const lines: NegativesLines = {
    totalLines: read.totalLines,
    linesExamined: read.linesExamined,
    removedLines: read.removedLines,
    removedBlocks: read.removedBlocks,
    // Counted directly, never as a difference of two totals: a line counts
    // when its raw text mentions the key and the stripped one no longer does,
    // and it is neither refused here nor left to the Door gate — the three
    // counters are disjoint, so their sum never exceeds the lines (sixth review).
    // A line of the declaration block is never ignored: the block is read by
    // the Door gate on raw lines, so a `<!--` in a code span above a
    // `Not-added:` line does not hide it (seventh review, minor-3).
    ignoredInBlocks: read.raw.filter(
      (line, index) =>
        KEY_ANYWHERE.test(line) &&
        !KEY_ANYWHERE.test(read.visible[index] ?? "") &&
        !inBlock(read.block, index + 1) &&
        !misplacedLines.has(index + 1) &&
        !read.leftToDoorLines.has(index + 1),
    ).length,
    declarationLines: declarations.length,
    misplacedLines: misplaced.length,
    leftToDoor: read.leftToDoor,
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
// The surfaces, in pr-negatives.v1.json, read at the merge base.

export const CONFIG_PATH: string = "tools/quality/pr-negatives.v1.json";

export interface NegativesConfig {
  readonly workflowDirectory: string;
  readonly workflowSymlinkRoot: string;
  readonly schemaPatterns: readonly RegExp[];
  readonly schemaContentExtensions: readonly string[];
  readonly schemaContentMarkers: readonly string[];
  /** Markers searched only in files of one extension (any backslash in `.json5`). */
  readonly schemaExtensionMarkers: ReadonlyMap<string, readonly string[]>;
  readonly dependencyBasenames: ReadonlySet<string>;
  readonly dependencyPatterns: readonly RegExp[];
  /** Markers whose presence in ANY file added or modified puts it on the surface (PEP 723). */
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
    !isStrings(schema.contentMarkers) ||
    !isRecord(schema.contentMarkersByExtension) ||
    !Object.values(schema.contentMarkersByExtension).every((markers) => isStrings(markers))
  ) {
    return fail(
      "schema needs pathPatterns, contentExtensions, contentMarkers and contentMarkersByExtension",
    );
  }
  if (
    !isRecord(dependency) ||
    !isStrings(dependency.basenames) ||
    !isStrings(dependency.pathPatterns) ||
    !isStrings(dependency.contentMarkers)
  ) {
    return fail("dependency needs basenames, pathPatterns and contentMarkers");
  }
  const byExtension = new Map<string, readonly string[]>(
    Object.entries(schema.contentMarkersByExtension as Record<string, string[]>).map(
      ([extension, markers]) => [
        extension.toLowerCase(),
        markers.map((marker) => marker.toLowerCase()),
      ],
    ),
  );
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
      schemaExtensionMarkers: byExtension,
      dependencyBasenames: new Set(dependency.basenames.map((name) => name.toLowerCase())),
      dependencyPatterns,
      dependencyContentMarkers: dependency.contentMarkers.map((marker) => marker.toLowerCase()),
    },
  };
}

// ---------------------------------------------------------------------------
// The confrontation: does the diff touch a surface?

export type BlobRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/** Reads a file at the head of the pull request, or at its merge base. */
export type BlobReader = (path: string, side?: "base" | "head") => BlobRead;

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

/**
 * A surface contact. `status` is the diff status of a changed path. A link the
 * pull request does not touch carries `present`, the trees it is present in,
 * and is never said to have "changed".
 */
export interface Contact {
  readonly path: string;
  readonly status: string;
  readonly why: string;
  readonly present?: readonly ("base" | "head")[];
}

/** What a surface check read: its contacts, and how much content it read to say so. */
export interface SurfaceScan {
  readonly contacts: readonly Contact[];
  /** Blobs read for their content. */
  readonly blobsRead: number;
  /** Changed files not read, their extension being outside the content rule. */
  readonly skippedByExtension: number;
  /** Changed paths deleted by the pull request: nothing at the head to read. */
  readonly deleted: number;
  /** Symlinks of the diff judged by their name or target, contact or not (schema). */
  readonly links: number;
}

const deletedIn = (entries: readonly ChangedPath[]): number =>
  entries.filter((entry) => entry.status === "D").length;

/** Pure: is this path, whatever its modes, on the dependency surface by name? */
function onDependencySurfaceByName(path: string, config: NegativesConfig): string | null {
  const basename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (config.dependencyBasenames.has(basename))
    return "manifest, lockfile or registry configuration";
  if (config.dependencyPatterns.some((pattern) => pattern.test(path)))
    return "dependency surface path";
  return null;
}

/** Every symlink of the two trees, ONCE per path, with the trees it is present in. */
function treeLinks(context: ChangeContext): Map<string, ("base" | "head")[]> {
  const links = new Map<string, ("base" | "head")[]>();
  for (const side of ["base", "head"] as const) {
    for (const entry of context.trees[side]) {
      if (entry.mode !== SYMLINK_MODE) continue;
      links.set(entry.path, [...(links.get(entry.path) ?? []), side]);
    }
  }
  return links;
}

/** The first marker the raw content carries, compared case-insensitively. */
function markerIn(text: string, markers: readonly string[]): string | undefined {
  const content = text.toLowerCase();
  return markers.find((candidate) => content.includes(candidate));
}

/** Pure: every contact of the change set with the dependency surface. */
export function dependencyContacts(context: ChangeContext): SurfaceScan {
  const contacts: Contact[] = [];
  const inDiff = new Set<string>();
  let blobsRead = 0;
  for (const entry of context.entries) {
    inDiff.add(entry.path);
    let why = isGitlink(entry)
      ? "gitlink"
      : isSymlink(entry)
        ? "symlink"
        : onDependencySurfaceByName(entry.path, context.config);
    // By content, in EVERY file added or modified, whatever its extension:
    // uv runs a PEP 723 block from a script without extension
    // (`#!/usr/bin/env -S uv run --script`) or from a `.pyw` as well.
    if (why === null && entry.status !== "D") {
      blobsRead += 1;
      const blob = context.readBlob(entry.path);
      const marker = blob.ok
        ? markerIn(blob.text, context.config.dependencyContentMarkers)
        : undefined;
      if (!blob.ok) why = `unreadable: ${blob.reason}`;
      else if (marker !== undefined) why = `content carries ${marker}`;
    }
    if (why !== null) contacts.push({ path: entry.path, status: entry.status, why });
  }
  for (const [path, present] of treeLinks(context)) {
    if (inDiff.has(path)) continue;
    // A link is tested as a file AND as a directory: the directory patterns
    // end with `/`, and a link named `.cargo` holds what `.cargo/` would.
    if (
      onDependencySurfaceByName(path, context.config) !== null ||
      onDependencySurfaceByName(`${path}/`, context.config) !== null
    ) {
      contacts.push({ path, status: present.join("+"), why: "a symlink", present });
    }
  }
  return {
    contacts,
    blobsRead,
    skippedByExtension: 0,
    deleted: deletedIn(context.entries),
    links: 0,
  };
}

/** Pure: every contact of the change set with the workflow surface. */
export function workflowContacts(context: ChangeContext): SurfaceScan {
  const { workflowDirectory, workflowSymlinkRoot } = context.config;
  const contacts: Contact[] = [];
  const inDiff = new Set<string>();
  for (const entry of context.entries) {
    inDiff.add(entry.path);
    if (
      (entry.status === "A" || entry.status === "T") &&
      atOrUnder(entry.path, workflowDirectory)
    ) {
      contacts.push({
        path: entry.path,
        status: entry.status,
        why: "workflow file added or type-changed",
      });
    } else if (isSymlink(entry) && atOrUnder(entry.path, workflowSymlinkRoot)) {
      contacts.push({
        path: entry.path,
        status: entry.status,
        why: `symlink under ${workflowSymlinkRoot}`,
      });
    }
  }
  for (const [path, present] of treeLinks(context)) {
    if (inDiff.has(path) || !atOrUnder(path, workflowSymlinkRoot)) continue;
    contacts.push({
      path,
      status: present.join("+"),
      why: `a symlink under ${workflowSymlinkRoot}`,
      present,
    });
  }
  return {
    contacts,
    blobsRead: 0,
    skippedByExtension: 0,
    deleted: deletedIn(context.entries),
    links: 0,
  };
}

const SCHEMA_DIRECTORY = /(?:^|\/)schemas?(?:\/|$)/i;

/**
 * Why a symlink touches the schema surface, or null. Tested as a directory
 * (a link named `schemas` holds schema files), by its target (a link that
 * points into a `schema/` or `schemas/` directory, or at a schema file).
 */
function schemaLinkReason(
  path: string,
  side: "base" | "head",
  context: ChangeContext,
): string | null {
  const { schemaPatterns } = context.config;
  if (schemaPatterns.some((pattern) => pattern.test(`${path}/x.json`))) {
    return "a link named as a schema directory";
  }
  const target = context.readBlob(path, side);
  if (!target.ok) return `a link whose target is unreadable: ${target.reason}`;
  if (
    SCHEMA_DIRECTORY.test(target.text) ||
    schemaPatterns.some((pattern) => pattern.test(target.text))
  ) {
    return `a link into a schema location (${quote(target.text)})`;
  }
  return null;
}

/** Pure: every contact of the change set with the schema surface. */
export function schemaContacts(context: ChangeContext): SurfaceScan {
  const { schemaPatterns, schemaContentExtensions, schemaContentMarkers, schemaExtensionMarkers } =
    context.config;
  const contacts: Contact[] = [];
  const inDiff = new Set<string>();
  let blobsRead = 0;
  let skippedByExtension = 0;
  let links = 0;
  for (const entry of context.entries) {
    inDiff.add(entry.path);
    if (entry.status === "D") continue;
    if (schemaPatterns.some((pattern) => pattern.test(entry.path))) {
      contacts.push({ path: entry.path, status: entry.status, why: "schema file name" });
      continue;
    }
    const lower = entry.path.toLowerCase();
    const extension = schemaContentExtensions.find((candidate) => lower.endsWith(candidate));
    if (entry.newMode === SYMLINK_MODE) {
      // Counted whether it touches the surface or not: every path of the diff
      // falls in one part of the partition (sixth review).
      links += 1;
      const why =
        extension !== undefined
          ? "a link, whose content cannot be read"
          : schemaLinkReason(entry.path, "head", context);
      if (why !== null) contacts.push({ path: entry.path, status: entry.status, why });
      continue;
    }
    if (extension === undefined) {
      skippedByExtension += 1;
      continue;
    }
    if (isGitlink(entry)) {
      contacts.push({
        path: entry.path,
        status: entry.status,
        why: "a gitlink, whose content cannot be read",
      });
      continue;
    }
    blobsRead += 1;
    const blob = context.readBlob(entry.path);
    if (!blob.ok) {
      contacts.push({ path: entry.path, status: entry.status, why: `unreadable: ${blob.reason}` });
      continue;
    }
    const markers = [...schemaContentMarkers, ...(schemaExtensionMarkers.get(extension) ?? [])];
    const marker = markerIn(blob.text, markers);
    if (marker !== undefined) {
      contacts.push({
        path: entry.path,
        status: entry.status,
        // Not `quote`: it trims, and a marker can be a backslash before a line break.
        why: `content carries ${JSON.stringify(marker)}`,
      });
    }
  }
  for (const [path, present] of treeLinks(context)) {
    if (inDiff.has(path)) continue;
    const why = schemaLinkReason(path, present[0] ?? "head", context);
    if (why !== null) contacts.push({ path, status: present.join("+"), why, present });
  }
  return { contacts, blobsRead, skippedByExtension, deleted: deletedIn(context.entries), links };
}

const CONTACTS: Readonly<Record<VerifiableNegative, (context: ChangeContext) => SurfaceScan>> = {
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
      ? `; ${declaration.ignoredInBlocks} line(s) mentioning Not-added inside them ignored, not declarations`
      : "";
  const lines =
    // The Door gate's partition, in its words: total = examined + removed.
    `${declaration.totalLines} description line(s) = ${declaration.linesExamined} examined + ` +
    `${declaration.removedLines} removed in ${declaration.removedBlocks} comment/code block(s)${ignored}; ` +
    `${declaration.declarationLines} Not-added line(s), ` +
    `${declaration.misplacedLines} misplaced key(s), ` +
    `${declaration.leftToDoor} Not-added line(s) left to the Door gate (T2', T3)`;

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
    const { contacts, blobsRead, skippedByExtension, deleted, links } = CONTACTS[value](context);
    const remove = `remove "${value}" from ${NEGATIVES_KEY}`;
    report.check(
      `${label} — Not-added ${value}`,
      contacts.length === 0,
      contacts.length === 0
        ? `the ${value} surface is not touched by any of ${examined} changed path(s)`
        : contacts
            .map((contact) =>
              contact.present === undefined
                ? `cannot verify: ${contact.path} (${contact.status}, ${contact.why}) changed — ${remove}`
                : `cannot verify: ${contact.path} (${contact.why}) present in the ${contact.present.join(" and ")} tree${contact.present.length > 1 ? "s" : ""} — ${remove}`,
            )
            .join("; "),
    );
    surfaces.push(
      `${value}: ${contacts.length} contact(s), ${blobsRead} blob(s) read for content, ${skippedByExtension} file(s) skipped by extension, ${deleted} deleted path(s), ${links} link(s) judged by name or target`,
    );
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
  const readBlob: BlobReader = (path, side = "head") => {
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
