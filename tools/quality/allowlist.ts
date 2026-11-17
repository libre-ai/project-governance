import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

// Exemption lists as verified data.
//
// Usage: bun tools/quality/allowlist.ts <list>
//
//   <list>  the exemption list, a tracked file named by its path relative to
//           the root of the repository holding the current directory.
//
// Format, one exemption per line:
//
//   <repository-relative path> # <reason>
//
// Blank lines and lines starting with "#" are ignored. The separator is " # "
// WITH its spaces, so the "#" of an identifier (`docs/issue#12.md`) stays in
// the path. Every rule below exists because an exemption list is where findings
// go to hide:
//
//   - the reason is mandatory: an exemption that cannot say why is a silenced
//     check, not a decision;
//   - the path is nominative: no wildcard, and normalised (relative, no "." or
//     ".." segment, no empty segment, no backslash, no surrounding blank), so
//     one line exempts one file and a reviewer sees which;
//   - the path must be a TRACKED file. An exemption whose file left the tree
//     covers nothing any more, and an exemption that covers nothing is an
//     error: otherwise stale entries accumulate silently and wait for the next
//     file to reuse the name;
//   - a tracked entry that is not a regular file (a symbolic link, git mode
//     120000, whose target may sit outside the repository; a submodule, mode
//     160000) is refused as `not-a-file`: the exemption would name a file the
//     reviewer cannot read in the tree. Callers pass these entries as
//     `notFiles`; without it, every tracked entry counts as a file;
//   - a duplicate is refused, so removing one line really removes the
//     exemption;
//   - an error names a line number and a kind, never the line's text: a list
//     may name paths that must not be echoed into a CI log.
//
// The tracked set comes from `git ls-files -s -z`: NUL-separated output is
// never quoted, so a non-ASCII name arrives exactly as written in the list,
// neither escaped nor split, and each entry carries its mode.
//
// The list itself must be a regular tracked file (mode 100644 or 100755) that
// is still a regular file on disk with no symbolic link on its way from the
// root; otherwise it is an unreadable source (exit 2), since reading it would
// read a link's target, outside the repository.
//
// Scope, on purpose:
//   - any regular tracked file may be exempted, code included: the consumers of
//     `parseAllowlist` exempt code files. Narrowing to data files (yaml, json,
//     md) is an open decision left to the owner;
//   - the specialised line forms `l1-field` and `suspect` are not parsed here.

export type AllowlistErrorKind =
  | "missing-reason"
  | "invalid-path"
  | "wildcard"
  | "untracked"
  | "not-a-file"
  | "duplicate";

export interface AllowlistError {
  /** 1-based, counting blank and comment lines. */
  readonly line: number;
  readonly kind: AllowlistErrorKind;
}

export type AllowlistResult =
  | {
      readonly ok: true;
      readonly paths: ReadonlySet<string>;
      /** Lines read; `lines - paths.size` were blank or comment lines. */
      readonly lines: number;
    }
  | { readonly ok: false; readonly error: AllowlistError };

const SEPARATOR = " # ";
const REGULAR_MODES: ReadonlySet<string> = new Set(["100644", "100755"]);
const WILDCARD = /[*?[]/;
// Control characters and surrounding blanks make two different files look the
// same to a reviewer; a path holding them is refused rather than trusted.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Why `path` is not a nominative repository-relative file path, or null. */
function pathDefect(path: string): AllowlistErrorKind | null {
  if (WILDCARD.test(path)) return "wildcard";
  if (path === "" || path !== path.trim() || CONTROL.test(path)) return "invalid-path";
  if (path.includes("\\") || path.startsWith("/")) return "invalid-path";
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return "invalid-path";
  }
  return null;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  // A final newline terminates the last line; it does not open a new one.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Parse an exemption list against the repository's tracked entries. `notFiles`
 * holds the tracked entries that are not regular files (symbolic links,
 * submodules). Stops at the first error.
 */
export function parseAllowlist(
  text: string,
  tracked: ReadonlySet<string>,
  notFiles: ReadonlySet<string> = new Set(),
): AllowlistResult {
  const lines = splitLines(text);
  const paths = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    if (line.trim() === "" || line.startsWith("#")) continue;
    const separator = line.indexOf(SEPARATOR);
    if (separator === -1 || line.slice(separator + SEPARATOR.length).trim() === "") {
      return { ok: false, error: { line: number, kind: "missing-reason" } };
    }
    const path = line.slice(0, separator);
    const defect = pathDefect(path);
    if (defect !== null) return { ok: false, error: { line: number, kind: defect } };
    if (paths.has(path)) return { ok: false, error: { line: number, kind: "duplicate" } };
    if (!tracked.has(path)) return { ok: false, error: { line: number, kind: "untracked" } };
    if (notFiles.has(path)) return { ok: false, error: { line: number, kind: "not-a-file" } };
    paths.add(path);
  }
  return { ok: true, paths, lines: lines.length };
}

function git(args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args[0] ?? ""} failed: ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(result.stdout);
}

/** Exit codes: 0 pass, 1 the list breaks a rule, 2 usage or an unreadable source. */
function main(argv: readonly string[]): number {
  const gate = "allowlist";
  const listPath = argv.length === 1 ? argv[0] : undefined;
  if (listPath === undefined) {
    console.error(`${gate}: usage: bun tools/quality/allowlist.ts <list>`);
    return 2;
  }
  let root: string;
  const tracked = new Set<string>();
  const notFiles = new Set<string>();
  try {
    root = git(["rev-parse", "--show-toplevel"]).trim();
    for (const record of git(["-C", root, "ls-files", "-s", "-z"]).split("\0")) {
      if (record === "") continue;
      // `<mode> <object> <stage>\t<path>`; the path may hold any byte but NUL.
      const match = /^(\d{6}) [0-9a-f]+ \d\t(.+)$/s.exec(record);
      if (match === null) throw new Error("git ls-files printed a record it does not document");
      const [, mode = "", path = ""] = match;
      tracked.add(path);
      if (!REGULAR_MODES.has(mode)) notFiles.add(path);
    }
  } catch (error) {
    console.error(`${gate}: ${(error as Error).message}`);
    return 2;
  }
  if (tracked.size === 0) {
    // Not "nothing to exempt": an empty listing cannot tell a stale entry from a live one.
    console.error(`${gate}: git listed no tracked file; the list cannot be verified`);
    return 2;
  }
  // The list itself obeys the rule it enforces: a regular tracked file inside the root.
  if (pathDefect(listPath) !== null || !tracked.has(listPath) || notFiles.has(listPath)) {
    console.error(
      `${gate}: the list must be a regular tracked file, named relative to the repository root`,
    );
    return 2;
  }
  let text: string;
  try {
    // The index says what was committed, not what is on disk now: a working
    // tree may have swapped the file, or a directory on its way, for a link.
    const absolute = join(root, listPath);
    if (realpathSync(absolute) !== join(realpathSync(root), listPath)) {
      throw new Error("a symbolic link lies on its way from the repository root");
    }
    if (!lstatSync(absolute).isFile()) throw new Error("it is not a regular file on disk");
    text = readFileSync(absolute, "utf8");
  } catch (error) {
    console.error(`${gate}: ${listPath} is unreadable: ${(error as Error).message}`);
    return 2;
  }
  const result = parseAllowlist(text, tracked, notFiles);
  if (!result.ok) {
    console.error(`${gate}: ${listPath} line ${result.error.line}: ${result.error.kind}`);
    return 1;
  }
  const ignored = result.lines - result.paths.size;
  console.log(
    `${gate} verified ${listPath}: ${result.lines} line(s) read = ${result.paths.size} exemption(s) + ` +
      `${ignored} blank or comment; every exemption names a tracked file (${tracked.size} tracked file(s) listed)`,
  );
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
