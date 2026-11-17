/**
 * A volatile value in a root document is derived, never typed by hand.
 *
 * A version, a review date or a count written into README.md, README.<lang>.md,
 * AGENTS.md or CLAUDE.md stays frozen when the reality it describes moves, and
 * nothing says so: these are the files a reader opens first and the ones no
 * gate read for that. This guard matches each line of the tracked root
 * documents against the patterns below and reports every hit, unless the line
 * declares where its value comes from.
 *
 * THE DECLARATION, and its form: a line may carry `<!-- derived: <command> -->`,
 * an HTML comment that renders as nothing. The command is required, because a
 * marker without one says "trust me" where the point is to name what
 * regenerates the value. Every `derived:` on a line must open such a comment
 * with a non-empty command: a bare marker, an empty comment or the word in
 * prose ("derived: from the manifest") is an error (exit 2), not a finding and
 * not an exemption — prose would otherwise exempt its whole line. This is
 * stricter than the brief, which accepted `derived: <command>` anywhere on the
 * line. Derived lines are counted and printed on every run, never hidden.
 *
 * MARKDOWN does not hide a value: emphasis and code spans (`*`, `_`, a
 * backtick) around the parts of a version or a count, and a hyphen or an
 * underscore between the words of a review phrase, still match.
 *
 * SCOPE is narrow on purpose: root level of the repository (resolved by
 * `git rev-parse --show-toplevel`, whatever the working directory), tracked
 * files only. A document under a directory has other owners and other gates,
 * and an untracked file is not what the repository ships. A root document that
 * is a symbolic link is an error and is never followed: the repository ships
 * the link, not its target.
 *
 * Exit codes: 0 no finding, 1 finding(s), 2 error (malformed marker, tracked
 * root document unreadable or a symbolic link, usage).
 */

import { closeSync, constants, lstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface VolatilePattern {
  readonly id: string;
  readonly pattern: RegExp;
  readonly says: string;
}

export const DERIVATION_MARKER = "derived:";

/**
 * The nouns a hand-typed count is read against. Data, so the test is driven by
 * this list and a unit added here is covered without a second edit.
 */
export const COUNTED_UNITS = [
  "commit",
  "commits",
  "fichier",
  "fichiers",
  "file",
  "files",
  "test",
  "tests",
  "dépôt",
  "dépôts",
  "repository",
  "repositories",
  "page",
  "pages",
  "décision",
  "décisions",
  "decision",
  "decisions",
  "job",
  "jobs",
  "script",
  "scripts",
  "projet",
  "projets",
  "project",
  "projects",
] as const;

const REVIEW_PHRASES = [
  "last reviewed",
  "last updated",
  "updated on",
  "dernière revue",
  "dernière mise à jour",
  "mis à jour le",
] as const;

/** Markdown emphasis and code-span delimiters, tolerated around the parts of a value. */
const MARKUP = "[*_`]*";

/**
 * Case-insensitive and Unicode-aware. The left boundaries are the argument of
 * each pattern: without them "conversion : 3.2.1" reads as a version and
 * "1.24 files" or "ADR 0043 pages" as a count.
 */
export const VOLATILE_PATTERNS: readonly VolatilePattern[] = [
  {
    id: "version-literal",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])version${MARKUP}\s*:[\s*_${"`"}]*v?\d+\.\d+\.\d+`,
      "iu",
    ),
    says: "a version number is read from the manifest that carries it",
  },
  {
    id: "review-date",
    pattern: new RegExp(
      String.raw`(?:${REVIEW_PHRASES.map((phrase) => phrase.split(" ").join(String.raw`[\s_-]+`)).join("|")})[^\d]{0,20}\d{4}-\d{2}-\d{2}`,
      "iu",
    ),
    says: "a review date is read from the history of the file",
  },
  {
    id: "hand-count",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}.,])\d+${MARKUP}\s+${MARKUP}(?:${COUNTED_UNITS.join("|")})(?![\p{L}])`,
      "iu",
    ),
    says: "a count is produced by the command that enumerates what it counts",
  },
] as const;

export interface VolatileFinding {
  readonly file: string;
  readonly line: number;
  readonly id: string;
  readonly text: string;
}

export interface VolatileScan {
  readonly filesScanned: number;
  readonly linesRead: number;
  readonly findings: readonly VolatileFinding[];
  /** Lines that matched but declare their derivation — counted, never hidden. */
  readonly derived: readonly VolatileFinding[];
  readonly malformedMarkers: readonly { readonly file: string; readonly line: number }[];
}

/** README.md, README.<two-letter language>.md, AGENTS.md or CLAUDE.md, at root level only. */
export function isRootDocument(path: string): boolean {
  return /^(?:README(?:\.[a-z]{2})?|AGENTS|CLAUDE)\.md$/.test(path);
}

type MarkerState = "absent" | "declared" | "malformed";

/** `<!-- derived: <command> -->`; the command is bounded by the comment that carries it. */
const DECLARATION = new RegExp(String.raw`<!--\s*${DERIVATION_MARKER}(.*?)-->`, "gu");

function markerState(line: string): MarkerState {
  const occurrences = line.split(DERIVATION_MARKER).length - 1;
  if (occurrences === 0) return "absent";
  let declarations = 0;
  for (const [, command = ""] of line.matchAll(DECLARATION)) {
    if (command.trim().length === 0) return "malformed";
    declarations += 1;
  }
  // A marker outside its comment (bare, in prose, or in a comment left open)
  // would otherwise ride on a well-formed one elsewhere on the line.
  return declarations === occurrences ? "declared" : "malformed";
}

function linesOf(text: string): string[] {
  const lines = text.split("\n");
  // A final newline terminates the last line; it does not open another one.
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** The whole decision as a pure function, so every branch is tested without a filesystem. */
export function scanForVolatileValues(
  files: readonly { readonly path: string; readonly text: string }[],
): VolatileScan {
  const findings: VolatileFinding[] = [];
  const derived: VolatileFinding[] = [];
  const malformedMarkers: { file: string; line: number }[] = [];
  let filesScanned = 0;
  let linesRead = 0;
  for (const file of files) {
    if (!isRootDocument(file.path)) continue;
    filesScanned += 1;
    for (const [index, line] of linesOf(file.text).entries()) {
      linesRead += 1;
      const marker = markerState(line);
      if (marker === "malformed") malformedMarkers.push({ file: file.path, line: index + 1 });
      for (const { id, pattern } of VOLATILE_PATTERNS) {
        const match = pattern.exec(line);
        if (match === null) continue;
        const finding: VolatileFinding = {
          file: file.path,
          line: index + 1,
          id,
          text: match[0],
        };
        if (marker === "declared") derived.push(finding);
        else findings.push(finding);
      }
    }
  }
  return { filesScanned, linesRead, findings, derived, malformedMarkers };
}

const GATE = "Volatile values";

function fail(messages: readonly string[]): never {
  for (const message of messages) console.error(`${GATE}: ${message}`);
  process.exit(2);
}

if (import.meta.main) {
  if (process.argv.length > 2) {
    fail(["usage: bun tools/quality/check-volatile-values.ts (no argument)"]);
  }

  // From a subdirectory, `git ls-files` lists that subdirectory only, and the
  // root documents would vanish into an empty-but-declared green.
  const toplevel = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (toplevel.exitCode !== 0) {
    fail([
      `git rev-parse --show-toplevel failed: ${new TextDecoder().decode(toplevel.stderr).trim()}`,
    ]);
  }
  const root = new TextDecoder().decode(toplevel.stdout).trim();

  const listed = Bun.spawnSync(["git", "ls-files", "-z"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (listed.exitCode !== 0) {
    fail([`git ls-files failed: ${new TextDecoder().decode(listed.stderr).trim()}`]);
  }
  const tracked = new TextDecoder().decode(listed.stdout).split("\0").filter(Boolean);

  // A tracked root document that cannot be read is an error, never a file with
  // zero lines: both would otherwise print the same green.
  const files: { path: string; text: string }[] = [];
  const unreadable: string[] = [];
  for (const path of tracked.filter(isRootDocument)) {
    const absolute = join(root, path);
    try {
      if (lstatSync(absolute).isSymbolicLink()) {
        unreadable.push(`${path}: tracked root document is a symbolic link — not followed`);
        continue;
      }
      // O_NOFOLLOW closes the window between the lstat and the read.
      const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        files.push({ path, text: readFileSync(descriptor, "utf8") });
      } finally {
        closeSync(descriptor);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      unreadable.push(`${path}: tracked root document is unreadable — ${reason}`);
    }
  }
  if (unreadable.length > 0) fail(unreadable);

  const scan = scanForVolatileValues(files);
  if (scan.malformedMarkers.length > 0) {
    fail(
      scan.malformedMarkers.map(
        ({ file, line }) =>
          `${file}:${line}: \`${DERIVATION_MARKER}\` names no command in its own comment — write \`<!-- ${DERIVATION_MARKER} <command> -->\``,
      ),
    );
  }

  const { concludeGate, GateReport } = await import("./gate-report");
  const report = new GateReport();
  const says = new Map(VOLATILE_PATTERNS.map(({ id, says: advice }) => [id, advice]));
  for (const finding of scan.findings) {
    report.check(
      `${finding.file}:${finding.line}`,
      false,
      `${finding.id}: ${finding.text} — ${says.get(finding.id) ?? ""} (or annotate the line \`<!-- ${DERIVATION_MARKER} <command> -->\`)`,
    );
  }
  if (scan.findings.length === 0) {
    for (const file of files) {
      report.check(file.path, true, `no hand-written volatile value outside a derived line`);
    }
  }
  if (files.length === 0) {
    report.allowEmpty(
      `none of the ${tracked.length} tracked file(s) is a root document (README.md, README.<lang>.md, AGENTS.md, CLAUDE.md)`,
    );
  }

  const derivedLines = new Set(scan.derived.map(({ file, line }) => `${file}:${line}`));
  const volume = `${scan.filesScanned} root document(s), ${scan.linesRead} line(s), ${derivedLines.size} derived line(s)`;
  report.volume(volume);
  for (const finding of scan.derived) {
    console.log(`  derived  ${finding.file}:${finding.line}  ${finding.id}`);
  }
  // The failure path of the shared report prints no volume; say it there too.
  if (scan.findings.length > 0) console.error(`${GATE}: ${volume}`);
  concludeGate(GATE, report);
}
