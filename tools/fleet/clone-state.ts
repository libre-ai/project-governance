/**
 * Decision table for a local clone facing its upstream. Pure: no I/O, no git.
 *
 * `tools/fleet/local-clones.ts audit` reads the state of a clone and prints the
 * category this module gives it, with the command a person may copy. Nothing
 * here, and nothing in the audit, runs that command.
 *
 * The table is evaluated top to bottom and the first true row wins, so the
 * seven categories are exclusive and exhaustive:
 *
 *   1. head unreadable                    -> unreadable        (no command)
 *   2. head detached                      -> detached          switch <branch>
 *   3. no upstream                        -> no-upstream       branch --set-upstream-to=...
 *   4. behind = 0                         -> up-to-date        (no command)
 *   5. behind > 0, dirty                  -> behind-dirty      status --short
 *   6. behind > 0, clean, ahead > 0       -> diverged          log --oneline @{upstream}..HEAD
 *   7. behind > 0, clean, ahead = 0       -> fast-forwardable  merge --ff-only @{upstream}
 *
 * Row 5 comes before row 6 on purpose: a clone that is behind with local changes
 * is an arbitration whether or not it is also ahead, and no stash is suggested.
 */

export interface CloneState {
  readonly head: "branch" | "detached" | "unreadable";
  readonly branch: string | null;
  readonly upstream: boolean;
  readonly behind: number;
  readonly ahead: number;
  /** `git status --porcelain` is not empty: untracked files count, ignored ones do not. */
  readonly dirty: boolean;
}

export const CLONE_CATEGORIES = [
  "unreadable",
  "detached",
  "no-upstream",
  "up-to-date",
  "behind-dirty",
  "diverged",
  "fast-forwardable",
] as const;

export type CloneCategory = (typeof CLONE_CATEGORIES)[number];

export interface CloneVerdict {
  readonly category: CloneCategory;
  readonly command: string | null;
}

const SHELL_PLAIN = /^[A-Za-z0-9_./@%+=:,-]+$/;

/**
 * The commands are printed to be copied into a shell, and both the path and the
 * branch name come from the disk: a git reference may hold `;`, `$` or a quote.
 * Anything outside a plain class is single-quoted, so a copied line cannot run
 * more than the one git command it shows.
 */
function shellWord(text: string): string {
  return SHELL_PLAIN.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0;

/** C0, DEL and C1 (U+009B is a one-byte CSI): quoting does not keep them off a terminal. */
const CONTROL = /\p{Cc}/u;

export function classifyClone(state: CloneState, path: string): CloneVerdict {
  const git = `git -C ${shellWord(path)}`;
  // A state the table cannot read is row 1, not a guess: a branch head without
  // a name, a name holding a control character, or a count that is not a whole
  // number, would otherwise fall through to a row that prints a command. A
  // command is refused rather than rewritten: a rewritten name is another branch.
  if (
    state.head === "unreadable" ||
    (state.head === "branch" &&
      (state.branch === null || state.branch === "" || CONTROL.test(state.branch))) ||
    !isCount(state.behind) ||
    !isCount(state.ahead)
  ) {
    return { category: "unreadable", command: null };
  }
  if (state.head === "detached") {
    // The only template: the branch the person wants cannot be deduced.
    return { category: "detached", command: `${git} switch <branch>` };
  }
  if (!state.upstream) {
    return {
      category: "no-upstream",
      command: `${git} branch ${shellWord(`--set-upstream-to=origin/${state.branch}`)}`,
    };
  }
  if (state.behind === 0) return { category: "up-to-date", command: null };
  if (state.dirty) return { category: "behind-dirty", command: `${git} status --short` };
  if (state.ahead > 0) {
    return { category: "diverged", command: `${git} log --oneline @{upstream}..HEAD` };
  }
  return { category: "fast-forwardable", command: `${git} merge --ff-only @{upstream}` };
}
