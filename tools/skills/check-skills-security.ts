/**
 * Skill content security gate (T4) — what the other skill gates do not read.
 *
 * T1 judges the structure of a skill, T2 its routing, T3 the non-cascade rule.
 * None of them reads what a skill tells the agent to run. This gate does: it
 * refuses every line, in every file under the skills root, that matches a
 * pattern of `skills-security-patterns.v1.json`.
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
 * "each line"; joining is stricter), and a finding names the line it starts on.
 *
 * There is no exemption mechanism, neither a line marker nor an allowlist: a
 * false positive is fixed by tightening the pattern in the data file or by
 * rewriting the skill.
 *
 * Limit: the gate is coarse by construction. It stops the obvious form of an
 * instruction, not a command rebuilt through an alias or an encoding.
 */

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PATTERNS_PATH = "tools/skills/skills-security-patterns.v1.json";

export const SECURITY_CATEGORIES = [
  "remote-execution",
  "secret-read",
  "environment-export",
  "gate-bypass",
  "write-outside-repository",
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
  readonly line: number;
  readonly patternId: string;
  readonly category: SecurityCategory;
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
  linesOf(content).forEach((line, index) => {
    if (parts.length === 0) start = index + 1;
    const trimmed = line.trimEnd();
    if (trimmed.endsWith("\\")) {
      parts.push(trimmed.slice(0, -1));
      return;
    }
    parts.push(line);
    logical.push({ start, text: parts.join(" ") });
    parts = [];
  });
  // A continuation on the last line has nothing to join: it stands alone.
  if (parts.length > 0) logical.push({ start, text: parts.join(" ") });
  return logical;
}

/**
 * One finding per (logical line, pattern) that matches, reported on the
 * physical line where the logical line starts. Pure.
 */
export function scanForSkillRisks(
  files: readonly ScannedFile[],
  patterns: readonly SecurityPattern[],
): SecurityFinding[] {
  const compiled = patterns.map((pattern) => ({
    pattern,
    expression: new RegExp(pattern.regex, "i"),
  }));
  const findings: SecurityFinding[] = [];
  for (const file of files) {
    for (const { start, text } of logicalLines(file.content)) {
      for (const { pattern, expression } of compiled) {
        if (expression.test(text)) {
          findings.push({
            path: file.path,
            line: start,
            patternId: pattern.id,
            category: pattern.category,
          });
        }
      }
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
    report.allowEmpty(`no ${root}/ directory in this repository`);
    concludeGate(gate, report);
    return;
  }
  const read = loadSkillTree(root);
  const lines = read.scanned.reduce((sum, file) => sum + linesOf(file.content).length, 0);
  const volume = formatSecurityVolume(read, lines, patterns.length);
  if (entriesMet(read) === 0) {
    report.allowEmpty(`${root}/ holds no file — nothing to scan`);
    concludeGate(gate, report);
    return;
  }

  const findings = scanForSkillRisks(read.scanned, patterns);
  for (const file of read.scanned) {
    const own = findings.filter((finding) => finding.path === file.path);
    if (own.length === 0) report.check(file.path, true, "no pattern matches");
  }
  for (const finding of findings) {
    report.check(
      `${finding.path}:${finding.line}`,
      false,
      `matches ${finding.patternId} (${finding.category})`,
    );
  }
  for (const path of read.undecodable) {
    report.check(
      path,
      false,
      "not valid UTF-8 text (invalid bytes, or a NUL): its content cannot be read, so it is refused",
    );
  }
  for (const path of read.symlinks) {
    report.check(path, false, "symbolic link, not followed: its target is not part of the tree");
  }
  for (const { path, reason } of read.unreadable) {
    report.check(path, false, reason);
  }
  // A failing run prints no volume line, so the counts ride on a check of
  // their own whenever an entry was left unread.
  if (read.scanned.length < entriesMet(read)) {
    report.check(root, false, `not every entry was read: ${volume}`);
  }
  report.volume(volume);
  concludeGate(gate, report);
}

if (import.meta.main) await main();
