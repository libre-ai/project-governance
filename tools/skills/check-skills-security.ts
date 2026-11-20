/**
 * Skill content security gate (T4) — what the other skill gates do not read.
 *
 * T1 judges the structure of a skill, T2 its routing, T3 the non-cascade rule.
 * None of them reads what a skill tells the agent to run. This gate does: it
 * refuses every line, in every file under the skills root, that matches a
 * pattern of `skills-security-patterns.v1.json`.
 *
 * A step of `bun run check` since 2026-11-20 (`check:skills-security`, owner
 * decision of that day). Its patterns file is on the guarded surface of
 * check-review-evidence: removing a pattern lifts a refusal of the aggregate.
 *
 * Universe: every entry met while walking the root recursively, the root
 * included, whatever its name or extension (SKILL.md, references, eval.json, a
 * script, a hook, a binary). Each entry falls in exactly one of four counts,
 * and the four sum to the entries met:
 *
 * - `scanned`: valid UTF-8 text, read line by line;
 * - `undecodable`: bytes that are not valid UTF-8, or text holding a NUL
 *   (UTF-16 without a byte-order mark). A named failure: this is how a binary
 *   is refused, since its instructions cannot be read;
 * - `symlinks`: a symbolic link, the root included, never followed. A named
 *   failure: the repository versions the link, not what it points to;
 * - `unreadable`: an entry that cannot be read (permission) or is not a
 *   regular file (FIFO, socket, device; never opened). A named failure.
 *
 * The brief named three counts; `unreadable` is a fourth, added so that a
 * permission or a FIFO is a named failure rather than a crash or a hang.
 *
 * The patterns are data. No detection expression is written in this file, so
 * that reading the data file is reading everything the gate refuses. Each one
 * is compiled case-insensitive and applied to each logical line: a line ending
 * in a backslash is joined to the next, as a shell joins it (the brief said
 * "each line"; joining is stricter). A finding names the line the logical line
 * starts on, and the last one too when a continuation joined several
 * (`SKILL.md:4-6`): the match is somewhere in that range, the gate does not
 * say on which of its lines.
 *
 * Invisible characters (category `invisible-character`, 2026-11-20) are
 * patterns like the others: the Unicode Tags block, the zero-width characters
 * and the bidirectional controls, each family one entry of the data file. A
 * skill is read by a model and reviewed by a person; these characters are what
 * the first reads and the second does not see. The line shows nothing, so the
 * finding carries what it hides, in printable ASCII: a Tags run decoded to the
 * ASCII it shadows, any other character named by its code point and counted.
 * The no-break space (U+00A0), the narrow no-break space (U+202F) and the
 * guillemets belong to none of the three families: French prose passes.
 *
 * The same three entries are applied to the name of every entry met, as its
 * path relative to the root: a name is read by the model that is told to open
 * the file, and a character hidden in it is hidden from the reviewer the same
 * way. The other categories are not applied to names: a name is not a line an
 * agent runs.
 *
 * What is printed. A path, a decoded payload, a reason: everything that comes
 * from the scanned tree goes through `asciiOnly` before it is printed, so a
 * name or a payload can neither forge a line of the report, nor repaint the
 * terminal, nor carry an invisible character into the log. A finding prints
 * at most RUNS_SHOWN Tags runs, each cut at PAYLOAD_SHOWN characters; a run
 * prints at most FINDINGS_SHOWN findings. Whatever is left out is counted: in
 * the finding itself, and, as soon as a finding is cut or not printed, on a
 * line of its own (`findings=… (printed=… not-printed=…)`). No such line means
 * every finding was printed whole. Entries that could not be read are not
 * findings: each prints its own line, and their number is the one of the
 * volume line.
 *
 * A byte-order mark that opens a file is tolerated: it is an encoding
 * signature, a single fixed character that carries nothing, and the strict
 * decoder below removes it before the scan. Any other U+FEFF, a second one
 * right after the first included, is a zero-width character and is refused.
 *
 * There is no exemption mechanism, neither a line marker nor an allowlist: a
 * false positive is fixed by tightening the pattern in the data file or by
 * rewriting the skill.
 * shortcut: no waiver mechanism, upgrade at the first legitimate finding
 *
 * Limits. The gate is coarse by construction: it stops the obvious form of an
 * instruction, not a command rebuilt through an alias or an encoding. A
 * directory that holds no entry is not met by the walk (git does not version
 * it either), so its name is not read. No pattern looks for the wording of an
 * injected instruction.
 *
 * "Invisible" here means the 150 code points of the three families, and no
 * other: U+E0000 to U+E007F; U+180E, U+200B to U+200D, U+2060 to U+2064,
 * U+FEFF; U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069. Other
 * characters that display nothing, or change what is displayed, pass (measured
 * 2026-11-20 against the Unicode properties of the pinned Bun: of the 4174
 * Default_Ignorable_Code_Point, 150 are refused):
 *
 * - the variation selectors (U+FE00 to U+FE0F, which emoji use, and U+E0100 to
 *   U+E01EF), which can encode a text byte by byte, and the rest of the
 *   default-ignorable range that holds the second set (U+E0080 to U+E0FFF);
 * - the soft hyphen (U+00AD), the combining grapheme joiner (U+034F), the
 *   Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), the Khmer inherent vowels
 *   (U+17B4, U+17B5), the Mongolian free variation selectors (U+180B to
 *   U+180D, U+180F), the braille blank (U+2800);
 * - the deprecated format characters (U+206A to U+206F), U+2065, the
 *   interlinear annotation marks (U+FFF9 to U+FFFB), U+FFF0 to U+FFF8, the
 *   shorthand format controls (U+1BCA0 to U+1BCA3), the musical format
 *   characters (U+1D173 to U+1D17A);
 * - every control character but NUL, which makes the file undecodable, and
 *   the line feed, which ends a line: escape (U+001B), backspace, carriage
 *   return, delete, the C1 controls;
 * - every space that is not a zero-width one (U+00A0, U+1680, U+2000 to
 *   U+200A, U+202F, U+205F, U+3000) and the line and paragraph separators
 *   (U+2028, U+2029).
 *
 * `tools/quality/check-pr-negatives.ts` treats every default-ignorable code
 * point as invisible; this gate does not, and widening its families is a
 * change of the data file, not of this text.
 */

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const PATTERNS_PATH = "tools/skills/skills-security-patterns.v1.json";

export const SECURITY_CATEGORIES = [
  "remote-execution",
  "secret-read",
  "environment-export",
  "gate-bypass",
  "write-outside-repository",
  "invisible-character",
] as const;

type SecurityCategory = (typeof SECURITY_CATEGORIES)[number];

export interface SecurityPattern {
  readonly id: string;
  readonly category: SecurityCategory;
  /** Source of the expression, without flags. */
  readonly regex: string;
  readonly because: string;
}

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCategory(value: unknown): value is SecurityCategory {
  return SECURITY_CATEGORIES.some((category) => category === value);
}

function compiles(source: string): boolean {
  try {
    new RegExp(source, "i");
    return true;
  } catch {
    return false;
  }
}

/**
 * The patterns of an already-parsed data file, or an Error naming the file and
 * the defect. `undefined` is what the loader passes for a file it could not
 * read or parse: an unreadable source is a failure, never an empty list.
 */
export function validatePatterns(value: unknown): readonly SecurityPattern[] {
  const refuse = (defect: string): never => {
    throw new Error(`${PATTERNS_PATH}: ${defect}`);
  };
  if (value === undefined) return refuse("unreadable, or not valid JSON");
  if (!isRecord(value) || !Array.isArray(value.patterns)) {
    return refuse("expected an object carrying a `patterns` list");
  }
  const entries: readonly unknown[] = value.patterns;
  if (entries.length === 0) return refuse("`patterns` is empty: the gate would refuse nothing");
  const patterns: SecurityPattern[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry)) return refuse(`pattern #${index + 1} is not an object`);
    const { id, category, regex, because } = entry;
    if (typeof id !== "string" || !KEBAB_CASE.test(id)) {
      return refuse(`pattern #${index + 1} needs a kebab-case \`id\``);
    }
    if (seen.has(id)) return refuse(`duplicate id "${id}"`);
    seen.add(id);
    if (!isCategory(category)) {
      return refuse(`"${id}": \`category\` must be one of ${SECURITY_CATEGORIES.join(", ")}`);
    }
    if (typeof regex !== "string" || regex.length === 0 || !compiles(regex)) {
      return refuse(`"${id}": \`regex\` does not compile`);
    }
    if (typeof because !== "string" || because.trim().length === 0) {
      return refuse(`"${id}": \`because\` is missing or empty`);
    }
    patterns.push({ id, category, regex, because });
  }
  return patterns;
}

export interface ScannedFile {
  readonly path: string;
  readonly content: string;
}

export interface SecurityFinding {
  readonly path: string;
  /** The physical line the logical line starts on. */
  readonly line: number;
  /**
   * The last physical line of the logical line, when a continuation joined
   * several: the match is somewhere in `line`..`lastLine`.
   */
  readonly lastLine?: number;
  readonly patternId: string;
  readonly category: SecurityCategory;
  /**
   * For an invisible character only: what the line hides, in printable ASCII.
   * The line shows nothing to whoever opens the file, so the finding has to.
   */
  readonly evidence?: string;
  /** Present when `evidence` shows only a part of what is hidden, the rest counted. */
  readonly evidenceCut?: true;
}

/** An invisible character in the name of an entry: there is no line to name. */
export interface NameFinding {
  readonly path: string;
  readonly patternId: string;
  readonly category: SecurityCategory;
  readonly evidence: string;
  readonly evidenceCut?: true;
}

/**
 * A text that comes from the scanned tree, as it is printed: printable ASCII
 * and nothing else. A line break in a name would forge a line of the report,
 * an escape sequence would repaint the terminal, and a character that displays
 * nothing would be as invisible in the log as in the file. Every other
 * character is written as its code point (`\u001b`, `\u{e0041}`); a backslash
 * is escaped first, so what is printed reads one way.
 *
 * `printable` of ecosystem/fleet-gates.ts is not reused: it leaves the
 * zero-width characters and the Tags block as they are.
 */
export function asciiOnly(text: string): string {
  return text.replaceAll("\\", "\\u005c").replace(/[^\x20-\x7e]/gu, (character) => {
    const point = (character.codePointAt(0) ?? 0).toString(16);
    return point.length > 4 ? `\\u{${point}}` : `\\u${point.padStart(4, "0")}`;
  });
}

/** The lines of a text; the empty segment after a final newline is not a line. */
function linesOf(content: string): string[] {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

interface LogicalLine {
  /** Number of the physical line the logical line starts on. */
  readonly start: number;
  /** Number of the physical line it ends on: `start`, unless lines were joined. */
  readonly end: number;
  readonly text: string;
}

/**
 * The lines as a shell reads them: a physical line ending in a backslash
 * (trailing blanks allowed) is joined to the next one. Without this, a
 * download split as `curl … \` then `| sh` on the next line would match no
 * pattern, since each half is harmless on its own.
 */
function logicalLines(content: string): LogicalLine[] {
  const logical: LogicalLine[] = [];
  let parts: string[] = [];
  let start = 1;
  const lines = linesOf(content);
  lines.forEach((line, index) => {
    if (parts.length === 0) start = index + 1;
    const trimmed = line.trimEnd();
    if (trimmed.endsWith("\\")) {
      // Only the backslash is dropped. What follows it stays in the text:
      // trimEnd counts U+FEFF as a blank, and a character removed here would
      // never be scanned.
      parts.push(trimmed.slice(0, -1) + line.slice(trimmed.length));
      return;
    }
    parts.push(line);
    logical.push({ start, end: index + 1, text: parts.join(" ") });
    parts = [];
  });
  // A continuation on the last line has nothing to join: it stands alone.
  if (parts.length > 0) logical.push({ start, end: lines.length, text: parts.join(" ") });
  return logical;
}

/**
 * The Unicode Tags block: each of its characters shadows the ASCII one
 * 0xE0000 below it. Used to decode a match for display, never to find one:
 * detection stays in the data file.
 */
const TAGS_FIRST = 0xe0000;
const TAGS_LAST = 0xe007f;

/** Decoded characters printed for one Tags run; the rest of the run is counted. */
const PAYLOAD_SHOWN = 120;

/** Tags runs printed for one finding; the other runs are counted, with their characters. */
const RUNS_SHOWN = 3;

/** Findings printed by one run of the gate; the others are counted. */
const FINDINGS_SHOWN = 100;

interface Hidden {
  readonly text: string;
  /** Whether `text` leaves a part of a run, or whole runs, counted but not shown. */
  readonly cut: boolean;
}

/**
 * What the matches of an invisible-character pattern hide on one line or in
 * one name, in printable ASCII only: the characters themselves never reach
 * the log, where they would be as invisible as in the file.
 *
 * - A run of the Tags block is decoded to the ASCII it shadows, between
 *   double quotes, through `asciiOnly`; a double quote is escaped too, so the
 *   quoted text reads one way. The payload is text a stranger wrote for a
 *   model to obey: it is printed as a quotation, cut at PAYLOAD_SHOWN
 *   characters, and only the first RUNS_SHOWN runs are printed. A line can
 *   hold any number of runs: without that bound the message has none.
 * - Any other character is named by its code point and counted: at most one
 *   name per code point of the families.
 */
function describeHidden(matched: readonly string[]): Hidden {
  const payloads: string[] = [];
  const counts = new Map<string, number>();
  let cut = false;
  let runsNotShown = 0;
  let charactersNotShown = 0;
  for (const text of matched) {
    const points = Array.from(text, (character) => character.codePointAt(0) ?? 0);
    if (points.every((point) => point >= TAGS_FIRST && point <= TAGS_LAST)) {
      if (payloads.length >= RUNS_SHOWN) {
        runsNotShown += 1;
        charactersNotShown += points.length;
        continue;
      }
      // Only the part that is printed is decoded: a run can be any length.
      const shown = points.slice(0, PAYLOAD_SHOWN).map((point) => point - TAGS_FIRST);
      const quoted = asciiOnly(String.fromCodePoint(...shown)).replaceAll('"', "\\u0022");
      const rest = points.length - shown.length;
      if (rest > 0) cut = true;
      payloads.push(
        `${points.length} tag character(s) spelling "${quoted}"${rest > 0 ? ` and ${rest} more` : ""}`,
      );
      continue;
    }
    for (const point of points) {
      const name = `U+${point.toString(16).toUpperCase().padStart(4, "0")}`;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (runsNotShown > 0) {
    payloads.push(
      `${runsNotShown} more run(s) not shown, of ${charactersNotShown} tag character(s) in all`,
    );
  }
  return {
    text: [...payloads, ...[...counts].map(([name, count]) => `${name} x${count}`)].join(", "),
    cut: cut || runsNotShown > 0,
  };
}

/** The fields of a finding that say what a line or a name hides. */
function evidenceOf(matched: readonly string[]): { evidence: string; evidenceCut?: true } {
  const hidden = describeHidden(matched);
  return { evidence: hidden.text, ...(hidden.cut ? { evidenceCut: true } : {}) };
}

/**
 * One finding per (logical line, pattern) that matches, reported on the
 * physical line where the logical line starts, with the line it ends on when
 * a continuation joined several. Pure.
 */
export function scanForSkillRisks(
  files: readonly ScannedFile[],
  patterns: readonly SecurityPattern[],
): SecurityFinding[] {
  const compiled = patterns.map((pattern) => ({
    pattern,
    // `g`: `match` then returns every occurrence on the line, which is what
    // an invisible-character finding describes, and keeps no state between lines.
    expression: new RegExp(pattern.regex, "gi"),
  }));
  const findings: SecurityFinding[] = [];
  for (const file of files) {
    for (const { start, end, text } of logicalLines(file.content)) {
      for (const { pattern, expression } of compiled) {
        const matched = text.match(expression);
        if (matched === null) continue;
        findings.push({
          path: file.path,
          line: start,
          ...(end > start ? { lastLine: end } : {}),
          patternId: pattern.id,
          category: pattern.category,
          ...(pattern.category === "invisible-character" ? evidenceOf(matched) : {}),
        });
      }
    }
  }
  return findings;
}

/**
 * One finding per (entry, invisible-character pattern) whose name matches.
 * The name is the path relative to `root`, every segment of it: the root
 * itself is what the operator typed, not something the tree brought. Pure.
 */
export function scanEntryNames(
  root: string,
  paths: readonly string[],
  patterns: readonly SecurityPattern[],
): NameFinding[] {
  const compiled = patterns
    .filter((pattern) => pattern.category === "invisible-character")
    .map((pattern) => ({ pattern, expression: new RegExp(pattern.regex, "gi") }));
  const findings: NameFinding[] = [];
  for (const path of paths) {
    const name = relative(root, path);
    for (const { pattern, expression } of compiled) {
      const matched = name.match(expression);
      if (matched === null) continue;
      findings.push({
        path,
        patternId: pattern.id,
        category: pattern.category,
        ...evidenceOf(matched),
      });
    }
  }
  return findings;
}

/** An entry the walk met but could not read, with the reason it names. */
export interface UnreadEntry {
  readonly path: string;
  readonly reason: string;
}

export interface SkillTreeRead {
  readonly scanned: readonly ScannedFile[];
  /** Paths whose bytes are not valid UTF-8 text (invalid bytes, or a NUL). */
  readonly undecodable: readonly string[];
  /** Paths that are symbolic links, the root included; their targets are not read. */
  readonly symlinks: readonly string[];
  /** Entries that could not be read: permission, or not a regular file. */
  readonly unreadable: readonly UnreadEntry[];
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The total of the four counts: every entry the walk met. */
function entriesMet(read: SkillTreeRead): number {
  return (
    read.scanned.length + read.undecodable.length + read.symlinks.length + read.unreadable.length
  );
}

/**
 * Every entry under `root`, the root itself included, each in exactly one of
 * the four lists. A root that is a link is a link like any other: following
 * it would scan a tree the repository does not version.
 */
export function loadSkillTree(root: string): SkillTreeRead {
  const scanned: ScannedFile[] = [];
  const undecodable: string[] = [];
  const symlinks: string[] = [];
  const unreadable: UnreadEntry[] = [];
  const visit = (path: string): void => {
    let stats: ReturnType<typeof lstatSync>;
    try {
      // lstat, not stat: a link is counted as a link, whatever it points to.
      stats = lstatSync(path);
    } catch (error) {
      unreadable.push({ path, reason: `cannot be inspected (${errorCode(error)})` });
      return;
    }
    if (stats.isSymbolicLink()) {
      symlinks.push(path);
      return;
    }
    if (stats.isDirectory()) {
      let entries: string[];
      try {
        entries = readdirSync(path).sort();
      } catch (error) {
        unreadable.push({ path, reason: `directory cannot be listed (${errorCode(error)})` });
        return;
      }
      for (const entry of entries) visit(join(path, entry));
      return;
    }
    if (!stats.isFile()) {
      // Opening a FIFO blocks until a writer comes; a device or a socket has
      // no content to scan. Never opened, always refused.
      unreadable.push({
        path,
        reason: "not a regular file (FIFO, socket or device), never opened",
      });
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      unreadable.push({ path, reason: `cannot be read (${errorCode(error)})` });
      return;
    }
    let content: string;
    try {
      // Strict decoding: a tolerant one would turn a binary into text
      // made of replacement characters, and the scan would call it clean.
      // `ignoreBOM` is left at its default: the decoder removes one leading
      // byte-order mark, which is how that mark, and only that one, is tolerated.
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      undecodable.push(path);
      return;
    }
    // NUL is valid UTF-8, so UTF-16 text without a byte-order mark decodes:
    // one NUL between every letter, and no pattern can match it.
    if (content.includes("\u{0}")) {
      undecodable.push(path);
      return;
    }
    scanned.push({ path, content });
  };
  visit(root);
  return { scanned, undecodable, symlinks, unreadable };
}

export function formatSecurityVolume(read: SkillTreeRead, lines: number, patterns: number): string {
  return (
    `entries=${entriesMet(read)} (scanned=${read.scanned.length} undecodable=${read.undecodable.length} ` +
    `symlinks=${read.symlinks.length} unreadable=${read.unreadable.length}), ` +
    `lines=${lines}, patterns=${patterns}`
  );
}

/** Whether the root entry exists, without following it if it is a link. */
function rootIsPresent(root: string): boolean {
  try {
    lstatSync(root);
    return true;
  } catch (error) {
    // Any other failure (a permission, say) is left to the walk, which
    // counts it as unreadable instead of declaring the tree empty.
    return errorCode(error) !== "ENOENT";
  }
}

async function main(): Promise<void> {
  const { concludeGate, GateReport } = await import("../quality/gate-report");
  const gate = "Skills security (T4)";
  // The root is an argument so the gate can be run against a fixture tree and
  // be seen to fail; the script passes none and reads skills/.
  const root = process.argv[2] ?? "skills";
  const report = new GateReport();

  let patterns: readonly SecurityPattern[];
  try {
    const parsed: unknown = await Bun.file(PATTERNS_PATH)
      .json()
      .catch(() => undefined);
    patterns = validatePatterns(parsed);
  } catch (error) {
    // Without its patterns the gate would match nothing and call the tree clean.
    report.check("patterns", false, error instanceof Error ? error.message : String(error));
    concludeGate(gate, report);
    return;
  }

  // lstat, not existsSync: existsSync follows a link, so a dangling link as
  // root would read as "no directory" and pass as declared empty.
  if (!rootIsPresent(root)) {
    report.allowEmpty(`no ${asciiOnly(root)}/ directory in this repository`);
    concludeGate(gate, report);
    return;
  }
  const read = loadSkillTree(root);
  const lines = read.scanned.reduce((sum, file) => sum + linesOf(file.content).length, 0);
  const volume = formatSecurityVolume(read, lines, patterns.length);
  if (entriesMet(read) === 0) {
    report.allowEmpty(`${asciiOnly(root)}/ holds no file — nothing to scan`);
    concludeGate(gate, report);
    return;
  }

  // Every item below names something the tree brought: a path is never
  // printed as it is, whatever the check that names it.
  const record = (path: string, ok: boolean, note: string, place = ""): void => {
    report.check(`${asciiOnly(path)}${place}`, ok, note);
  };

  const entries: readonly string[] = [
    ...read.scanned.map((file) => file.path),
    ...read.undecodable,
    ...read.symlinks,
    ...read.unreadable.map((entry) => entry.path),
  ];
  const named = scanEntryNames(root, entries, patterns);
  const findings = scanForSkillRisks(read.scanned, patterns);
  const refused = new Set([...named, ...findings].map((finding) => finding.path));
  for (const file of read.scanned) {
    if (!refused.has(file.path)) record(file.path, true, "no pattern matches");
  }

  const printed = [
    ...named.map((finding) => ({
      path: finding.path,
      place: "",
      note: `its name matches ${finding.patternId} (${finding.category}): ${finding.evidence}`,
      cut: finding.evidenceCut === true,
    })),
    ...findings.map((finding) => ({
      path: finding.path,
      place: `:${finding.line}${finding.lastLine === undefined ? "" : `-${finding.lastLine}`}`,
      note:
        `matches ${finding.patternId} (${finding.category})` +
        (finding.evidence === undefined ? "" : `: ${finding.evidence}`),
      cut: finding.evidenceCut === true,
    })),
  ];
  const shown = printed.slice(0, FINDINGS_SHOWN);
  for (const { path, place, note } of shown) record(path, false, note, place);
  // What is left out is counted, on a line of its own: no such line means
  // every finding was printed, and printed whole.
  const cut = shown.filter((finding) => finding.cut).length;
  if (printed.length > shown.length || cut > 0) {
    record(
      root,
      false,
      `findings=${printed.length} (printed=${shown.length} not-printed=${printed.length - shown.length}), ` +
        `evidence cut on ${cut} of the printed`,
    );
  }

  for (const path of read.undecodable) {
    record(
      path,
      false,
      "not valid UTF-8 text (invalid bytes, or a NUL): its content cannot be read, so it is refused",
    );
  }
  for (const path of read.symlinks) {
    record(path, false, "symbolic link, not followed: its target is not part of the tree");
  }
  for (const { path, reason } of read.unreadable) {
    record(path, false, asciiOnly(reason));
  }
  // A failing run prints no volume line, so the counts ride on a check of
  // their own whenever an entry was left unread.
  if (read.scanned.length < entriesMet(read)) {
    record(root, false, `not every entry was read: ${volume}`);
  }
  report.volume(volume);
  concludeGate(gate, report);
}

if (import.meta.main) await main();
