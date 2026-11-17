import { createHash } from "node:crypto";
import { readFileSync, readlinkSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
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
 * - a text is normalised NFKC, then lower-cased; a token is a maximal run of
 *   `\p{L}` or `\p{N}` characters, and any other character separates;
 * - the fingerprint of n tokens is the SHA-256, lower-case hexadecimal over 64
 *   characters, of the UTF-8 bytes of the tokens joined by one space (U+0020);
 * - window: for each line of a file, and for each token count n present in the
 *   data file, every run of n consecutive tokens of that line. A run never
 *   crosses a line end;
 * - an identifier whose tokens total fewer than 4 characters is not derivable:
 *   it would match everywhere. Derivation refuses it and names it by its line
 *   number in the source list, never by its text.
 *
 * Normalisation runs cluster by cluster (a base character with its combining
 * marks) so that a column can be given in the original line. It is the same
 * function for derivation and for the scan, so the two always agree.
 *
 * DATA, `identifier-fingerprints.v1.json`: `because`, `entries` (objects
 * `{ class, tokens, sha256 }`) and `exemptPaths` (objects `{ path, because }`,
 * exact tracked paths of regular files, checked with the rules of
 * `allowlist.ts`: nominative, no wildcard, reason mandatory, no duplicate,
 * tracked). Any other key, an unknown class, a malformed fingerprint, a
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
 * - file paths are not searched, only contents and symlink targets;
 * - a binary file is not read;
 * - the scan reads the working tree for the paths the index lists.
 *
 * Not wired into `bun run check` nor into a workflow: run it with
 * `bun run check:identifier-fingerprints`. Derive entries with
 * `bun tools/quality/check-identifier-fingerprints.ts --derive <class> <file>`,
 * from a plain list kept OUTSIDE this repository (one identifier per line);
 * a list inside the repository tree is refused, so it cannot be committed by
 * mistake.
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
const LINE_MARKER = "allow-identifier-fingerprint";
const MINIMUM_CHARACTERS = 4;
const SHA256_HEX = /^[0-9a-f]{64}$/;
// A base character with its combining marks, or marks with no base.
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;
const TOKEN_CHARACTER = /^[\p{L}\p{N}]$/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The tokens of one line, normalised, each with the 1-based column (in code
 * points) where it starts in the ORIGINAL line.
 */
export function tokenize(line: string): { token: string; column: number }[] {
  const tokens: { token: string; column: number }[] = [];
  let current = "";
  let start = 0;
  let column = 1;
  for (const match of line.matchAll(CLUSTER)) {
    const cluster = match[0];
    for (const character of cluster.normalize("NFKC").toLowerCase()) {
      if (TOKEN_CHARACTER.test(character)) {
        if (current === "") start = column;
        current += character;
      } else if (current !== "") {
        tokens.push({ token: current, column: start });
        current = "";
      }
    }
    column += [...cluster].length;
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

function checkTree(report: GateReport): void {
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

  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const exemptions = parseAllowlist(
    data.exemptPaths.map((exemption) => `${exemption.path} # ${exemption.because}\n`).join(""),
    new Set(byPath.keys()),
  );
  if (!exemptions.ok) {
    report.check(
      DATA_PATH,
      false,
      `exemptPaths[${exemptions.error.line - 1}]: ${exemptions.error.kind}`,
    );
    return;
  }
  for (const [index, exemption] of data.exemptPaths.entries()) {
    const entry = byPath.get(exemption.path);
    if (entry !== undefined && !isRegular(entry)) {
      report.check(DATA_PATH, false, `exemptPaths[${index}]: not a regular file`);
      return;
    }
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
      `marker lines=${markerLines}, fingerprints=${data.entries.length} (${perClass})`,
  );
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** Exit codes: 0 entries printed, 1 refused, 2 usage. Refusals print nothing on stdout. */
function derive(className: string, file: string): number {
  if (!isIdentifierClass(className)) {
    console.error(`${GATE}: --derive: the class must be one of ${CLASS_NAMES.join(", ")}`);
    return 2;
  }
  const source = readOrNull(() => realpathSync(file));
  if (source === null) {
    console.error(`${GATE}: --derive: the source list cannot be read`);
    return 1;
  }
  const roots = [readOrNull(() => realpathSync(join(import.meta.dir, "..", "..")))];
  const top = readGit(["rev-parse", "--show-toplevel"], "find the repository root");
  if (top.ok) roots.push(readOrNull(() => realpathSync(top.stdout.trim())));
  if (roots.some((root) => root !== null && isInside(root, source))) {
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
    checkTree(report);
    concludeGate(GATE, report);
    return 0;
  }
  if (argv[0] === "--derive" && argv.length === 3) return derive(argv[1] ?? "", argv[2] ?? "");
  console.error(
    `${GATE}: usage: bun tools/quality/check-identifier-fingerprints.ts [--derive <class> <file>]`,
  );
  return 2;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
