/**
 * Skill content security gate (T4) — what the other skill gates do not read.
 *
 * T1 judges the structure of a skill, T2 its routing, T3 the non-cascade rule.
 * None of them reads what a skill tells the agent to run. This gate does: it
 * refuses every line, in every file under the skills root, that matches a
 * pattern of `skills-security-patterns.v1.json`.
 *
 * Universe: every file entry met while walking the root recursively, whatever
 * its name or extension (SKILL.md, references, eval.json, a script, a hook, a
 * binary). Each entry falls in exactly one of three counts, and the three sum
 * to the entries met:
 *
 * - `scanned`: valid UTF-8, read line by line;
 * - `undecodable`: bytes that are not valid UTF-8. A named failure: this is
 *   how a binary is refused, since its instructions cannot be read;
 * - `symlinks`: a symbolic link, never followed. A named failure: the
 *   repository versions the link, not what it points to.
 *
 * The patterns are data. No detection expression is written in this file, so
 * that reading the data file is reading everything the gate refuses. Each one
 * is compiled case-insensitive and applied to each line.
 *
 * There is no exemption mechanism, neither a line marker nor an allowlist: a
 * false positive is fixed by tightening the pattern in the data file or by
 * rewriting the skill.
 *
 * Limit: the gate is coarse by construction. It stops the obvious form of an
 * instruction, not a command rebuilt through an alias or an encoding.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
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

/** One finding per (line, pattern) that matches. Pure. */
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
    linesOf(file.content).forEach((text, index) => {
      for (const { pattern, expression } of compiled) {
        if (expression.test(text)) {
          findings.push({
            path: file.path,
            line: index + 1,
            patternId: pattern.id,
            category: pattern.category,
          });
        }
      }
    });
  }
  return findings;
}

export interface SkillTreeRead {
  readonly scanned: readonly ScannedFile[];
  /** Paths whose bytes are not valid UTF-8. */
  readonly undecodable: readonly string[];
  /** Paths that are symbolic links; their targets are not read. */
  readonly symlinks: readonly string[];
}

/** Every file entry under `root`, each in exactly one of the three lists. */
export function loadSkillTree(root: string): SkillTreeRead {
  const scanned: ScannedFile[] = [];
  const undecodable: string[] = [];
  const symlinks: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      // lstat, not stat: a link is counted as a link, whatever it points to.
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) {
        symlinks.push(path);
      } else if (stats.isDirectory()) {
        walk(path);
      } else {
        const bytes = readFileSync(path);
        try {
          // Strict decoding: a tolerant one would turn a binary into text
          // made of replacement characters, and the scan would call it clean.
          scanned.push({ path, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) });
        } catch {
          undecodable.push(path);
        }
      }
    }
  };
  walk(root);
  return { scanned, undecodable, symlinks };
}

export function formatSecurityVolume(read: SkillTreeRead, lines: number, patterns: number): string {
  const entries = read.scanned.length + read.undecodable.length + read.symlinks.length;
  return (
    `entries=${entries} (scanned=${read.scanned.length} undecodable=${read.undecodable.length} ` +
    `symlinks=${read.symlinks.length}), lines=${lines}, patterns=${patterns}`
  );
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

  if (!existsSync(root)) {
    report.allowEmpty(`no ${root}/ directory in this repository`);
    concludeGate(gate, report);
    return;
  }
  const read = loadSkillTree(root);
  const lines = read.scanned.reduce((sum, file) => sum + linesOf(file.content).length, 0);
  const volume = formatSecurityVolume(read, lines, patterns.length);
  if (read.scanned.length + read.undecodable.length + read.symlinks.length === 0) {
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
    report.check(path, false, "not valid UTF-8: its content cannot be read, so it is refused");
  }
  for (const path of read.symlinks) {
    report.check(path, false, "symbolic link, not followed: its target is not part of the tree");
  }
  // A failing run prints no volume line, so the counts ride on a check of
  // their own whenever an entry was left unread.
  if (read.undecodable.length + read.symlinks.length > 0) {
    report.check(root, false, `not every entry was read: ${volume}`);
  }
  report.volume(volume);
  concludeGate(gate, report);
}

if (import.meta.main) await main();
