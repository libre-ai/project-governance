import { createHash } from "node:crypto";
import { readFileSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { parseAllowlist } from "./allowlist";
import { parseStagedEntries, type StagedEntry, SYMLINK_MODE } from "./check-data-inventory";
import { concludeGate, GateReport } from "./gate-report";
import { readGit } from "./git-diff";

/**
 * Identifier fingerprints: identifiers that must not appear in this tree,
 * found by the SHA-256 of their tokens rather than by their text.
 *
 * THREAT MODEL: masking at read time, not confidentiality. A fingerprint is a
 * SHA-256 with neither salt nor key, so anyone who suspects an identifier
 * confirms it with a dictionary. What the mechanism guarantees is narrower:
 * neither the data file, nor this code, nor the gate's log carries the
 * identifier in readable form, and the gate runs without any secret. The
 * identifiers are unpublished facts, not secrets.
 *
 * FINGERPRINT, fixed here so that derivation and scan agree:
 *
 * - a line loses its default-ignorable characters (`\p{Default_Ignorable_Code_Point}`:
 *   zero width space and joiner, soft hyphen...), because they would otherwise
 *   cut an identifier in two without changing how it reads;
 * - then the WHOLE line is folded (owner decision of 2026-11-17), in this
 *   order: NFKD; every combining mark (`\p{M}`) removed, so diacritics go;
 *   lower case, with the final sigma folded to the medial one (lower case
 *   alone makes `ς` or `σ` depending on the next character); every homoglyph
 *   replaced by the lower case of its Latin skeleton; NFC. Lower case comes
 *   BEFORE the homoglyphs so that a word and its capitals always fold alike:
 *   a capital homoglyph acts through its lower case (U+0397 for H makes
 *   U+03B7 an h), unless that lower case has its own pair, which wins. The
 *   homoglyph table is DATA, `identifier-confusables.v1.json`: a bounded
 *   excerpt of UTS #39 `confusables.txt` (one letter of the Latin, Greek or
 *   Cyrillic blocks to one ASCII letter), verified when it is read; an absent
 *   or invalid table is a named failure of the gate and of every derivation,
 *   never no folding;
 * - a token is a maximal run of `\p{L}`, `\p{N}` or `\p{M}` characters, and
 *   any other character separates;
 * - the fingerprint of n tokens is the SHA-256, lower-case hexadecimal over 64
 *   characters, of the UTF-8 bytes of the tokens joined by one space (U+0020);
 * - window: for each line of a file, and for each token count n present in the
 *   data file, every run of n consecutive tokens of that line. A run never
 *   crosses a line end;
 * - an identifier whose tokens total fewer than 4 characters is not derivable:
 *   it would match everywhere. Derivation refuses it and names it by its line
 *   number in the source list, never by its text.
 *
 * Normalisation runs on the whole line, never piece by piece: lower case
 * depends on context (a final sigma) and NFKC composes across characters
 * (Hangul jamo, a base and its marks). A separate map gives each normalised
 * character its column in the original line. `tokenize` is the one function
 * both derivation and the scan call, so the two always agree.
 *
 * DATA, `identifier-fingerprints.v1.json`: `because`, `entries` (objects
 * `{ class, tokens, sha256 }`) and `exemptPaths` (objects `{ path, because }`,
 * exact tracked paths of regular DATA files, checked with the rules of
 * `allowlist.ts`: nominative, no wildcard, reason mandatory, no duplicate,
 * tracked, no symbolic link nor submodule, and no code file: a line of code
 * that must carry an identifier takes the line marker instead, so the
 * exemption stays visible where it applies). Any other key, an unknown class, a malformed fingerprint, a
 * duplicate, an empty entry list, or a file absent, unreadable or invalid is a
 * named failure. Every message names a position, never a value: a rejected
 * value could be the very identifier.
 *
 * COUNTERS. The universe is `git ls-files -s -z`. Every entry falls in exactly
 * one of five counters, and they must sum to the tracked count:
 * `examined` (regular file, text, read line by line), `exempt` (regular file
 * listed in exemptPaths), `binary` (regular file holding a NUL byte, not read),
 * `symlink` (mode 120000, its target text is searched as line 1) and `other`
 * (any other mode, gitlinks included, not read). Outside the sum, `marker
 * lines` counts the lines carrying the `allow-identifier-fingerprint` marker,
 * which are not judged. A tracked file that cannot be read is a failure.
 *
 * OUTPUT. A match prints `path:line:column`, its class and the class's action;
 * never the token, the line or the full fingerprint.
 *
 * LIMITS, said here because they decide what this gate is not:
 *
 * - an identifier glued inside a longer token (no separator) is not seen.
 *   `check-context-hygiene.sh` searches by substring and does see it: that is
 *   a reason to keep that script in service next to this module;
 * - homoglyphs are folded only as far as the table goes: one letter of the
 *   Latin, Greek or Cyrillic blocks standing for ONE ASCII letter. A homoglyph
 *   from another script (Armenian, Cherokee, mathematical letters NFKD does
 *   not reach), and one that stands for two letters (`rn` for `m`) or for a
 *   digit are not folded. A capital whose lower case has another skeleton is
 *   folded by its lower case's: Greek capital nu (an N to the eye) folds as
 *   its lower case, a v. ASCII is never mapped to ASCII: `I`, `l` and `1` stay
 *   apart, since lower case already makes `I` an `i`;
 * - folding is lossy by design: two different words of a Greek or Cyrillic
 *   text can share a fingerprint. That makes the gate stricter, never laxer;
 * - file paths are not searched, only contents and symlink targets: an
 *   identifier that only appears in a file name is not seen;
 * - a binary file is not read;
 * - the scan reads the working tree for the paths the index lists.
 *
 * Not wired into `bun run check` nor into a workflow: run it with
 * `bun run check:identifier-fingerprints`. Derive entries with
 * `bun tools/quality/check-identifier-fingerprints.ts --derive <class> <file>`,
 * from a plain list kept OUTSIDE every repository (one identifier per line);
 * a list under this repository, or in any directory where
 * `git rev-parse --show-toplevel` finds a repository, is refused, so it cannot
 * be committed by mistake.
 */

export const IDENTIFIER_CLASSES = {
  tenant: "move this content to the repository of that organization",
  group: "move this content to the group layer",
  person: "write a role instead of the name",
  provider: "make it a parameter, or extract the mechanism",
  reference: "remove the reference, or bring the content up into this layer",
} as const;

export type IdentifierClass = keyof typeof IDENTIFIER_CLASSES;

const CLASS_NAMES = Object.keys(IDENTIFIER_CLASSES) as IdentifierClass[];

function isIdentifierClass(value: unknown): value is IdentifierClass {
  return typeof value === "string" && (CLASS_NAMES as string[]).includes(value);
}

export interface FingerprintEntry {
  readonly class: IdentifierClass;
  readonly tokens: number;
  readonly sha256: string;
}

export interface FingerprintData {
  readonly because: string;
  readonly entries: readonly FingerprintEntry[];
  readonly exemptPaths: readonly { readonly path: string; readonly because: string }[];
}

export interface FingerprintFinding {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly class: IdentifierClass;
}

const GATE = "Identifier fingerprints";
const DATA_PATH = "tools/quality/identifier-fingerprints.v1.json";
const CONFUSABLES_PATH = "tools/quality/identifier-confusables.v1.json";
/** Latin beyond ASCII, Greek and Coptic, Cyrillic and its supplement. */
const CONFUSABLE_RANGES: readonly (readonly [number, number])[] = [
  [0x80, 0x2af],
  [0x370, 0x3ff],
  [0x400, 0x52f],
];
const LETTER = /^\p{L}$/u;
const ASCII_LETTER = /^[A-Za-z]$/;
const CODE_POINT_HEX = /^[0-9A-F]{4,6}$/;
const FINAL_SIGMA = /\u{3C2}/gu;
const LINE_MARKER = "allow-identifier-fingerprint";
const MINIMUM_CHARACTERS = 4;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;
const MARK = /^\p{M}$/u;
const TOKEN_CHARACTER = /^[\p{L}\p{N}\p{M}]$/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The homoglyph table as the fold applies it, after lower case: a lower-case
 * letter to a lower-case ASCII letter. `own` pairs had a lower-case (or
 * caseless) source; `derived` ones come from an upper-case source, keyed by
 * its lower case (U+0397 for H gives U+03B7 for h); `shadowed` upper-case
 * sources are dropped because their lower case has its own pair, which wins
 * (U+039D for N, while U+03BD has `v`). own + derived + shadowed = pairs.
 */
export interface ConfusableTable {
  readonly fold: ReadonlyMap<string, string>;
  readonly own: number;
  readonly derived: number;
  readonly shadowed: number;
}

export type ConfusablesResult =
  | { readonly ok: true; readonly table: ConfusableTable; readonly pairs: number }
  | { readonly ok: false; readonly reason: string };

function inConfusableRanges(codePoint: number): boolean {
  return CONFUSABLE_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
}

/**
 * Verify the homoglyph table. Each pair maps ONE letter of the declared ranges
 * (hexadecimal code point, never ASCII) to ONE ASCII letter; a source appears
 * once. Reasons name a position, never a value.
 */
export function parseConfusables(text: string): ConfusablesResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
  if (!isPlainObject(raw)) return { ok: false, reason: "the top level is not an object" };
  if (unknownKey(raw, ["because", "source", "pairs"])) {
    return { ok: false, reason: "unknown key at the top level" };
  }
  if (!isNonEmptyText(raw.because)) return { ok: false, reason: "because is missing or empty" };
  const source = raw.source;
  if (
    !isPlainObject(source) ||
    unknownKey(source, ["url", "date", "sha256"]) ||
    !isNonEmptyText(source.url) ||
    !isNonEmptyText(source.date) ||
    typeof source.sha256 !== "string" ||
    !SHA256_HEX.test(source.sha256)
  ) {
    return { ok: false, reason: "source must be { url, date, sha256 } with a 64-hex sha256" };
  }
  if (!Array.isArray(raw.pairs) || raw.pairs.length === 0) {
    return { ok: false, reason: "pairs is not a non-empty array" };
  }
  const sources = new Set<string>();
  const fromUpper: [string, string][] = [];
  const fold = new Map<string, string>();
  for (const [index, pair] of (raw.pairs as unknown[]).entries()) {
    const at = `pairs[${index}]`;
    if (!isPlainObject(pair) || unknownKey(pair, ["from", "to"])) {
      return { ok: false, reason: `${at} is not an object { from, to }` };
    }
    if (typeof pair.from !== "string" || !CODE_POINT_HEX.test(pair.from)) {
      return { ok: false, reason: `${at}: from is not an upper-case hexadecimal code point` };
    }
    const codePoint = Number.parseInt(pair.from, 16);
    const character = String.fromCodePoint(codePoint);
    if (!inConfusableRanges(codePoint) || !LETTER.test(character)) {
      return {
        ok: false,
        reason: `${at}: from is not a letter of the Latin, Greek or Cyrillic blocks`,
      };
    }
    if (typeof pair.to !== "string" || !ASCII_LETTER.test(pair.to)) {
      return { ok: false, reason: `${at}: to is not one ASCII letter` };
    }
    if (sources.has(character)) return { ok: false, reason: `${at}: duplicate source` };
    sources.add(character);
    const lowered = character.toLowerCase();
    if ([...lowered].length !== 1) {
      return { ok: false, reason: `${at}: from has no one-letter lower case` };
    }
    if (lowered === character) fold.set(character, pair.to.toLowerCase());
    else fromUpper.push([lowered, pair.to.toLowerCase()]);
  }
  // A lower-case letter's own pair wins over the one its capital brings.
  const own = fold.size;
  let shadowed = 0;
  for (const [lowered, target] of fromUpper) {
    if (fold.has(lowered)) shadowed += 1;
    else fold.set(lowered, target);
  }
  return {
    ok: true,
    table: { fold, own, derived: fold.size - own, shadowed },
    pairs: raw.pairs.length,
  };
}

/** Read and verify the delivered homoglyph table; absent or unreadable is a failure. */
export function loadConfusables(path: string): ConfusablesResult {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { ok: false, reason: "the homoglyph table is absent or unreadable" };
  }
  return parseConfusables(text);
}

let delivered: ConfusablesResult | null = null;

/** The delivered table, read once, on first use: importing the module reads nothing. */
export function deliveredConfusables(): ConfusablesResult {
  delivered ??= loadConfusables(join(import.meta.dir, "..", "..", CONFUSABLES_PATH));
  return delivered;
}

function deliveredTable(): ConfusableTable {
  const result = deliveredConfusables();
  // Never fold without the table: an unfolded fingerprint would be another
  // function, and the gate would compare two functions without saying so.
  if (!result.ok) throw new Error(`${CONFUSABLES_PATH}: ${result.reason}`);
  return result.table;
}

function mapEach(text: string, map: ReadonlyMap<string, string>): string {
  let mapped = "";
  for (const character of text) mapped += map.get(character) ?? character;
  return mapped;
}

/** The fold of the header: NFKD, marks removed, lower case, sigma, homoglyphs, NFC. */
export function foldWith(text: string, table: ConfusableTable): string {
  const bare = [...text.normalize("NFKD")].filter((character) => !MARK.test(character)).join("");
  const lowered = bare.toLowerCase().replace(FINAL_SIGMA, "\u{3C3}");
  return mapEach(lowered, table.fold).normalize("NFC");
}

/**
 * Map each code point of the folded line back to a 1-based column of the
 * original line. The line is cut into pieces that NFKC treats independently:
 * a new piece starts only at a character that is not a mark and does not
 * compose with the piece before it. Every code point a piece folds to takes
 * the column where the piece starts. Lower case maps each code point to a
 * fixed number of code points (the only contextual rule, final sigma, is
 * folded to one form), so the counts agree with the whole line. The map is
 * only for the printed column; the tokens always come from the whole line.
 */
function columnsOf(
  kept: readonly { character: string; column: number }[],
  table: ConfusableTable,
): number[] {
  const pieces: { text: string; column: number }[] = [];
  for (const { character, column } of kept) {
    const last = pieces[pieces.length - 1];
    const joins =
      last !== undefined &&
      (MARK.test(character) ||
        (last.text + character).normalize("NFKC") !==
          last.text.normalize("NFKC") + character.normalize("NFKC"));
    if (last !== undefined && joins) last.text += character;
    else pieces.push({ text: character, column });
  }
  const columns: number[] = [];
  for (const piece of pieces) {
    for (const _ of foldWith(piece.text, table)) columns.push(piece.column);
  }
  return columns;
}

/**
 * The tokens of one line, each with the 1-based column (in code points) where
 * it starts in the ORIGINAL line. Default-ignorable characters are removed
 * first, then the whole line is folded (header), then cut. Throws when the
 * delivered homoglyph table is absent or invalid.
 */
export function tokenize(line: string): { token: string; column: number }[] {
  return tokenizeWith(line, deliveredTable());
}

/** `tokenize` with a given homoglyph table. */
export function tokenizeWith(
  line: string,
  table: ConfusableTable,
): { token: string; column: number }[] {
  const kept: { character: string; column: number }[] = [];
  let position = 0;
  for (const character of line) {
    position += 1;
    if (!IGNORABLE.test(character)) kept.push({ character, column: position });
  }
  const text = foldWith(kept.map((item) => item.character).join(""), table);
  const columns = columnsOf(kept, table);
  const tokens: { token: string; column: number }[] = [];
  let current = "";
  let start = 0;
  let index = 0;
  for (const character of text) {
    if (TOKEN_CHARACTER.test(character)) {
      // Should the map ever come out shorter than the text, the last known
      // column stands in: the column is a pointer, the token stays exact.
      if (current === "") start = columns[index] ?? columns[columns.length - 1] ?? 1;
      current += character;
    } else if (current !== "") {
      tokens.push({ token: current, column: start });
      current = "";
    }
    index += 1;
  }
  if (current !== "") tokens.push({ token: current, column: start });
  return tokens;
}

export function fingerprintOfTokens(tokens: readonly string[]): string {
  return createHash("sha256").update(tokens.join(" "), "utf8").digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKey(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).some((key) => !allowed.includes(key));
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

type Parsed = { ok: true; data: FingerprintData } | { ok: false; reason: string };

/** Validate the data file. Reasons name a position, never a value. */
export function parseFingerprintData(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
  if (!isPlainObject(raw)) return { ok: false, reason: "the top level is not an object" };
  if (unknownKey(raw, ["because", "entries", "exemptPaths"])) {
    return { ok: false, reason: "unknown key at the top level" };
  }
  if (!isNonEmptyText(raw.because)) return { ok: false, reason: "because is missing or empty" };
  if (!Array.isArray(raw.entries)) return { ok: false, reason: "entries is not an array" };
  if (raw.entries.length === 0) return { ok: false, reason: "entries is empty" };
  if (!Array.isArray(raw.exemptPaths)) return { ok: false, reason: "exemptPaths is not an array" };

  const entries: FingerprintEntry[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of (raw.entries as unknown[]).entries()) {
    const at = `entries[${index}]`;
    if (!isPlainObject(entry)) return { ok: false, reason: `${at} is not an object` };
    if (unknownKey(entry, ["class", "tokens", "sha256"])) {
      return { ok: false, reason: `${at}: unknown key` };
    }
    if (!isIdentifierClass(entry.class)) return { ok: false, reason: `${at}: unknown class` };
    const tokens = entry.tokens;
    if (typeof tokens !== "number" || !Number.isInteger(tokens) || tokens < 1) {
      return { ok: false, reason: `${at}: tokens is not an integer of at least 1` };
    }
    if (typeof entry.sha256 !== "string" || !SHA256_HEX.test(entry.sha256)) {
      return { ok: false, reason: `${at}: sha256 is not 64 lower-case hexadecimal characters` };
    }
    if (seen.has(entry.sha256)) return { ok: false, reason: `${at}: duplicate fingerprint` };
    seen.add(entry.sha256);
    entries.push({ class: entry.class, tokens, sha256: entry.sha256 });
  }

  const exemptPaths: { path: string; because: string }[] = [];
  for (const [index, exemption] of (raw.exemptPaths as unknown[]).entries()) {
    const at = `exemptPaths[${index}]`;
    if (!isPlainObject(exemption)) return { ok: false, reason: `${at} is not an object` };
    if (unknownKey(exemption, ["path", "because"])) {
      return { ok: false, reason: `${at}: unknown key` };
    }
    if (typeof exemption.path !== "string") return { ok: false, reason: `${at}: path is missing` };
    if (!isNonEmptyText(exemption.because)) {
      return { ok: false, reason: `${at}: because is missing or empty` };
    }
    // The exemptions are checked as one allowlist line each (allowlist.ts): a
    // line break or the list separator would turn one exemption into another.
    if (CONTROL.test(exemption.path) || CONTROL.test(exemption.because)) {
      return { ok: false, reason: `${at}: control character` };
    }
    if (exemption.path.includes(" # ")) {
      return { ok: false, reason: `${at}: path holds the separator " # "` };
    }
    exemptPaths.push({ path: exemption.path, because: exemption.because });
  }
  return { ok: true, data: { because: raw.because, entries, exemptPaths } };
}

/**
 * Entries for a plain list, one identifier per line. `refused` holds the
 * 1-based line numbers of identifiers that are empty or total fewer than 4
 * characters once tokenized. A repeated identifier yields one entry.
 */
export function deriveEntries(
  identifierClass: IdentifierClass,
  lines: readonly string[],
): { entries: FingerprintEntry[]; refused: number[] } {
  const entries: FingerprintEntry[] = [];
  const refused: number[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const tokens = tokenize(line).map((token) => token.token);
    const characters = tokens.reduce((total, token) => total + [...token].length, 0);
    if (characters < MINIMUM_CHARACTERS) {
      refused.push(index + 1);
      continue;
    }
    const sha256 = fingerprintOfTokens(tokens);
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    entries.push({ class: identifierClass, tokens: tokens.length, sha256 });
  }
  return { entries, refused };
}

/** Every match of a listed fingerprint in `content`, outside marker lines. */
export function scanText(
  path: string,
  content: string,
  data: FingerprintData,
): { findings: FingerprintFinding[]; markerLines: number } {
  const byFingerprint = new Map(data.entries.map((entry) => [entry.sha256, entry.class]));
  const lengths = [...new Set(data.entries.map((entry) => entry.tokens))];
  const findings: FingerprintFinding[] = [];
  let markerLines = 0;
  for (const [index, rawLine] of content.split("\n").entries()) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.includes(LINE_MARKER)) {
      markerLines += 1;
      continue;
    }
    const tokens = tokenize(line);
    for (const length of lengths) {
      for (let start = 0; start + length <= tokens.length; start += 1) {
        const window = tokens.slice(start, start + length);
        const found = byFingerprint.get(fingerprintOfTokens(window.map((token) => token.token)));
        const first = window[0];
        if (found !== undefined && first !== undefined) {
          findings.push({ path, line: index + 1, column: first.column, class: found });
        }
      }
    }
  }
  return { findings, markerLines };
}

/** The check a finding records: position, class and action only. */
export function findingCheck(finding: FingerprintFinding): { item: string; note: string } {
  return {
    item: `${finding.path}:${finding.line}:${finding.column}`,
    note: `${finding.class} — ${IDENTIFIER_CLASSES[finding.class]}`,
  };
}

export type Counter = "examined" | "exempt" | "binary" | "symlink" | "other";

export type Classified =
  | { readonly path: string; readonly counter: "examined" | "symlink"; readonly text: string }
  | { readonly path: string; readonly counter: "exempt" | "binary" | "other" }
  | { readonly path: string; readonly counter: "unreadable" };

export interface TrackedReader {
  /** The bytes of a regular file, or null when it cannot be read. */
  readonly file: (path: string) => Uint8Array | null;
  /** The target of a symbolic link, or null when it cannot be read. */
  readonly link: (path: string) => string | null;
}

const REGULAR_MODES = new Set(["100644", "100755"]);

/**
 * Put every tracked entry in one counter. Exempt and `other` entries are never
 * read; a regular file is read once, and only a file without a NUL byte is
 * decoded. An entry that cannot be read is `unreadable`, which no counter
 * holds, so the sum check fails on it as well.
 */
export function classifyTracked(
  entries: readonly StagedEntry[],
  exemptPaths: readonly string[],
  reader: TrackedReader,
): Classified[] {
  const exempt = new Set(exemptPaths);
  const decoder = new TextDecoder();
  return entries.map((entry): Classified => {
    if (entry.mode === SYMLINK_MODE) {
      const target = reader.link(entry.path);
      return target === null
        ? { path: entry.path, counter: "unreadable" }
        : { path: entry.path, counter: "symlink", text: target };
    }
    if (!REGULAR_MODES.has(entry.mode)) return { path: entry.path, counter: "other" };
    if (exempt.has(entry.path)) return { path: entry.path, counter: "exempt" };
    const bytes = reader.file(entry.path);
    if (bytes === null) return { path: entry.path, counter: "unreadable" };
    if (bytes.includes(0)) return { path: entry.path, counter: "binary" };
    return { path: entry.path, counter: "examined", text: decoder.decode(bytes) };
  });
}

/**
 * The five counters of a classification, and whether they sum to the number
 * of classified entries. An `unreadable` entry is in no counter, so a single
 * one breaks the sum.
 */
export function tallyCounters(classified: readonly Classified[]): {
  counts: Record<Counter, number>;
  summed: number;
  sums: boolean;
} {
  const counts: Record<Counter, number> = {
    examined: 0,
    exempt: 0,
    binary: 0,
    symlink: 0,
    other: 0,
  };
  for (const item of classified) {
    if (item.counter !== "unreadable") counts[item.counter] += 1;
  }
  const summed = counts.examined + counts.exempt + counts.binary + counts.symlink + counts.other;
  return { counts, summed, sums: summed === classified.length };
}

function isRegular(entry: StagedEntry): boolean {
  return REGULAR_MODES.has(entry.mode);
}

function readOrNull<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** Check the tracked tree of the current repository. The table is a parameter for the tests. */
export function checkTree(report: GateReport, confusables: ConfusablesResult): void {
  // First: without its table the fold is another function, so nothing is read.
  if (!confusables.ok) {
    report.check(CONFUSABLES_PATH, false, confusables.reason);
    return;
  }
  const { own, derived, shadowed } = confusables.table;
  report.check(
    CONFUSABLES_PATH,
    true,
    `${confusables.pairs} homoglyph pair(s) read = ${own} own + ${derived} through a capital + ${shadowed} shadowed`,
  );
  const top = readGit(["rev-parse", "--show-toplevel"], "find the repository root");
  if (!top.ok) {
    report.check("repository", false, top.reason);
    return;
  }
  const root = top.stdout.trim();
  const listed = readGit(["-C", root, "ls-files", "-s", "-z"], "list the tracked files");
  if (!listed.ok) {
    report.check("tracked files", false, listed.reason);
    return;
  }
  const entries = parseStagedEntries(listed.stdout);
  if (entries === null) {
    report.check("tracked files", false, "`git ls-files -s -z` printed an unreadable record");
    return;
  }
  if (entries.length === 0) {
    report.check("tracked files", false, "git listed no file; an empty tree is not a clean one");
    return;
  }

  let dataText: string;
  try {
    dataText = readFileSync(join(root, DATA_PATH), "utf8");
  } catch (error) {
    const absent = (error as NodeJS.ErrnoException).code === "ENOENT";
    report.check(
      DATA_PATH,
      false,
      absent ? "the data file is absent" : "the data file is unreadable",
    );
    return;
  }
  const parsed = parseFingerprintData(dataText);
  if (!parsed.ok) {
    report.check(DATA_PATH, false, parsed.reason);
    return;
  }
  const data = parsed.data;

  // Data files only (no `admitCode`): a code line that must carry an
  // identifier takes the line marker. A link or a submodule is `not-a-file`.
  const exemptions = parseAllowlist(
    data.exemptPaths.map((exemption) => `${exemption.path} # ${exemption.because}\n`).join(""),
    new Set(entries.map((entry) => entry.path)),
    { notFiles: new Set(entries.filter((entry) => !isRegular(entry)).map((entry) => entry.path)) },
  );
  if (!exemptions.ok) {
    report.check(
      DATA_PATH,
      false,
      `exemptPaths[${exemptions.error.line - 1}]: ${exemptions.error.kind}`,
    );
    return;
  }
  report.check(DATA_PATH, true, `${data.entries.length} fingerprint(s) read`);

  const classified = classifyTracked(entries, [...exemptions.paths], {
    file: (path) => readOrNull(() => new Uint8Array(readFileSync(join(root, path)))),
    link: (path) => readOrNull(() => readlinkSync(join(root, path), "utf8")),
  });

  const tally = tallyCounters(classified);
  const counts = tally.counts;
  let markerLines = 0;
  for (const item of classified) {
    if (item.counter === "unreadable") {
      report.check(item.path, false, "a tracked file that cannot be read");
      continue;
    }
    if (item.counter !== "examined" && item.counter !== "symlink") continue;
    const scanned = scanText(item.path, item.text, data);
    markerLines += scanned.markerLines;
    for (const finding of scanned.findings) {
      const check = findingCheck(finding);
      report.check(check.item, false, check.note);
    }
    if (scanned.findings.length === 0) report.check(item.path, true, "no listed fingerprint");
  }

  report.check(
    "counters",
    tally.sums && classified.length === entries.length,
    `examined + exempt + binary + symlink + other = ${tally.summed}, tracked = ${entries.length}`,
  );
  const perClass = CLASS_NAMES.map(
    (name) => `${name}=${data.entries.filter((entry) => entry.class === name).length}`,
  ).join(", ");
  report.volume(
    `tracked=${entries.length} examined=${counts.examined} exempt=${counts.exempt} ` +
      `binary=${counts.binary} symlink=${counts.symlink} other=${counts.other}, ` +
      `marker lines=${markerLines}, fingerprints=${data.entries.length} (${perClass}), ` +
      `homoglyphs=${confusables.pairs} (own=${own}, capital=${derived}, shadowed=${shadowed})`,
  );
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** Exit codes: 0 entries printed, 1 refused, 2 usage. Refusals print nothing on stdout. */
export function derive(className: string, file: string, confusables: ConfusablesResult): number {
  if (!isIdentifierClass(className)) {
    console.error(`${GATE}: --derive: the class must be one of ${CLASS_NAMES.join(", ")}`);
    return 2;
  }
  if (!confusables.ok) {
    console.error(`${GATE}: --derive: ${CONFUSABLES_PATH}: ${confusables.reason}`);
    return 1;
  }
  const source = readOrNull(() => realpathSync(file));
  if (source === null) {
    console.error(`${GATE}: --derive: the source list cannot be read`);
    return 1;
  }
  // Two tests, either of which refuses: the list sits under this module's
  // repository, or git finds a repository from the list's own directory (any
  // repository, not only the current one).
  const moduleRoot = readOrNull(() => realpathSync(join(import.meta.dir, "..", "..")));
  const insideModuleRoot = moduleRoot !== null && isInside(moduleRoot, source);
  const listRepository = readGit(
    ["-C", dirname(source), "rev-parse", "--show-toplevel"],
    "find a repository around the source list",
  );
  if (insideModuleRoot || listRepository.ok) {
    console.error(
      `${GATE}: --derive refuses a source list inside a repository tree: keep the plain list outside, where it cannot be committed`,
    );
    return 1;
  }
  const text = readOrNull(() => readFileSync(source, "utf8"));
  if (text === null) {
    console.error(`${GATE}: --derive: the source list cannot be read`);
    return 1;
  }
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  const derived = deriveEntries(className, lines);
  if (derived.refused.length > 0) {
    for (const line of derived.refused) {
      console.error(
        `${GATE}: --derive: line ${line}: fewer than ${MINIMUM_CHARACTERS} characters once tokenized, not derivable`,
      );
    }
    return 1;
  }
  console.log(JSON.stringify(derived.entries, null, 2));
  return 0;
}

function main(argv: readonly string[]): number {
  if (argv.length === 0) {
    const report = new GateReport();
    checkTree(report, deliveredConfusables());
    concludeGate(GATE, report);
    return 0;
  }
  if (argv[0] === "--derive" && argv.length === 3) {
    return derive(argv[1] ?? "", argv[2] ?? "", deliveredConfusables());
  }
  console.error(
    `${GATE}: usage: bun tools/quality/check-identifier-fingerprints.ts [--derive <class> <file>]`,
  );
  return 2;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
