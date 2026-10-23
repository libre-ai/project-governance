/**
 * The git reads shared by the gates that judge a pull request's diff.
 *
 * Extracted on 2026-10-23 from `check-review-evidence.ts`, where it lived
 * inside the command block and could not be imported, when the negatives gate
 * (`check-pr-negatives.ts`, ADR-0056 D5) needed the same path list. Two gates
 * listing the paths of a change two different ways would be two answers to
 * one question; one function gives one answer.
 *
 * Two properties every caller inherits:
 *
 * - **An unreadable read is a failure, never an empty one.** A failed
 *   `git diff` returns a reason, not an empty stdout: an empty path list reads
 *   as "touches nothing" and passes, which is how a gate goes green on a head
 *   with no merge base.
 * - **The path list is git's own, whatever the repository config says.**
 *   `--no-renames`: with rename detection (`diff.renames`), a file moved out
 *   of a watched directory is listed under its new name only, and a file moved
 *   into one is not listed as added. Without it, a rename is a deletion plus an
 *   addition. `-z`: paths come NUL-terminated and unquoted, so `core.quotePath`
 *   cannot turn a non-ASCII name into its quoted octal form
 *   (`"docs/adr/0004-na\303\257ve.md"` for U+00EF), which no path pattern
 *   matches. Colour is not pinned: measured on 2026-10-23, `color.ui=always`
 *   and `color.diff=always` leave `--name-status -z` byte-identical, so a
 *   `--no-color` here would be an equivalent mutant.
 *
 * The unified-diff flags (`--no-color`, `--no-ext-diff`, `--no-textconv`,
 * fixed prefixes) stay at their single consumer, `check-review-evidence.ts`:
 * the negatives gate reads file contents with `git cat-file blob`, which
 * applies no textconv, no filter and no diff driver by construction.
 */

export interface GitRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run git with an argument vector, never through a shell. */
export function runGit(argv: readonly string[]): GitRun {
  const result = Bun.spawnSync(["git", ...argv], { stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

export type GitRead =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: string };

/** Run git and return its stdout, or the reason it could not: `could not <what>: <stderr>`. */
export function readGit(argv: readonly string[], what: string): GitRead {
  const run = runGit(argv);
  if (run.exitCode !== 0) return { ok: false, reason: `could not ${what}: ${run.stderr.trim()}` };
  return { ok: true, stdout: run.stdout };
}

/**
 * The statuses `git diff --name-status --no-renames` prints for two commits:
 * added, deleted, modified, type changed (a file became a symlink or back).
 * Rename and copy (`R`, `C`) cannot appear with `--no-renames`; unmerged and
 * unknown (`U`, `X`) cannot appear between two commits. Anything else is not
 * the output this parser was written for.
 */
export type ChangeStatus = "A" | "D" | "M" | "T";

export interface ChangedPath {
  readonly status: ChangeStatus;
  readonly path: string;
}

export type ChangedPathsRead =
  | { readonly ok: true; readonly entries: readonly ChangedPath[] }
  | { readonly ok: false; readonly reason: string };

const CHANGE_STATUSES: ReadonlySet<string> = new Set(["A", "D", "M", "T"]);

/** Pure parse of `git diff --name-status -z --no-renames`: `<status>\0<path>\0`, repeated. */
export function parseNameStatus(output: string): ChangedPathsRead {
  if (output === "") return { ok: true, entries: [] };
  if (!output.endsWith("\0")) {
    return { ok: false, reason: "name-status output does not end with a NUL: truncated" };
  }
  const fields = output.slice(0, -1).split("\0");
  if (fields.length % 2 !== 0) {
    return { ok: false, reason: `name-status output has an odd field count (${fields.length})` };
  }
  const entries: ChangedPath[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index] ?? "";
    const path = fields[index + 1] ?? "";
    if (!CHANGE_STATUSES.has(status)) {
      return { ok: false, reason: `unexpected name-status "${status}" for path "${path}"` };
    }
    if (path === "") return { ok: false, reason: `empty path after status "${status}"` };
    entries.push({ status: status as ChangeStatus, path });
  }
  return { ok: true, entries };
}

/**
 * Every path a range changes, with its status. `range` is passed to git as
 * is: `["origin/<base>...HEAD"]`, or `[<base sha>, "HEAD"]`.
 */
export function listChangedPaths(range: readonly string[]): ChangedPathsRead {
  const read = readGit(
    ["diff", "--name-status", "-z", "--no-renames", ...range],
    `list the paths changed in ${range.join(" ")}`,
  );
  if (!read.ok) return read;
  return parseNameStatus(read.stdout);
}
