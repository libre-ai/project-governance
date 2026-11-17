import { describe, expect, test } from "bun:test";
import {
  CLONE_CATEGORIES,
  type CloneCategory,
  type CloneState,
  classifyClone,
} from "./clone-state";

const PATH = "/work/alpha";

/** A clean clone on a branch, level with its upstream; each test changes what its row reads. */
const state = (change: Partial<CloneState> = {}): CloneState => ({
  head: "branch",
  branch: "topic",
  upstream: true,
  behind: 0,
  ahead: 0,
  dirty: false,
  ...change,
});

describe("classifyClone, one test per row of the table", () => {
  test("row 1: an unreadable head is unreadable and has no command", () => {
    expect(classifyClone(state({ head: "unreadable", branch: null }), PATH)).toEqual({
      category: "unreadable",
      command: null,
    });
  });

  test("row 2: a detached head gets the switch template", () => {
    expect(classifyClone(state({ head: "detached", branch: null }), PATH)).toEqual({
      category: "detached",
      command: "git -C /work/alpha switch <branch>",
    });
  });

  test("row 3: a branch without upstream gets the set-upstream command for that branch", () => {
    expect(classifyClone(state({ upstream: false }), PATH)).toEqual({
      category: "no-upstream",
      command: "git -C /work/alpha branch --set-upstream-to=origin/topic",
    });
  });

  test("row 1: a branch name holding a control character (C0, DEL or C1) is unreadable", () => {
    for (const branch of ["a\u{9b}b", "a\u{1b}[31mb", "a\u{7f}b", "a\nb"]) {
      expect(classifyClone(state({ branch, upstream: false }), PATH)).toEqual({
        category: "unreadable",
        command: null,
      });
    }
  });

  test("row 4: behind = 0 is up to date and has no command", () => {
    expect(classifyClone(state(), PATH)).toEqual({ category: "up-to-date", command: null });
  });

  test("row 5: behind with local changes is behind-dirty and suggests status only", () => {
    expect(classifyClone(state({ behind: 2, dirty: true }), PATH)).toEqual({
      category: "behind-dirty",
      command: "git -C /work/alpha status --short",
    });
  });

  test("row 6: behind, clean and ahead is diverged", () => {
    expect(classifyClone(state({ behind: 1, ahead: 3 }), PATH)).toEqual({
      category: "diverged",
      command: "git -C /work/alpha log --oneline @{upstream}..HEAD",
    });
  });

  test("row 7: behind, clean and not ahead is fast-forwardable", () => {
    expect(classifyClone(state({ behind: 4 }), PATH)).toEqual({
      category: "fast-forwardable",
      command: "git -C /work/alpha merge --ff-only @{upstream}",
    });
  });
});

describe("classifyClone, order of the rows", () => {
  test("behind, dirty and ahead is behind-dirty, not diverged", () => {
    const verdict = classifyClone(state({ behind: 1, ahead: 1, dirty: true }), PATH);
    expect(verdict.category).toBe("behind-dirty");
  });

  test("behind = 0 with local changes and commits ahead is up to date", () => {
    const verdict = classifyClone(state({ behind: 0, ahead: 1, dirty: true }), PATH);
    expect(verdict).toEqual({ category: "up-to-date", command: null });
  });

  test("an unreadable head wins over every other field", () => {
    const verdict = classifyClone(
      state({ head: "unreadable", upstream: false, behind: 1, dirty: true }),
      PATH,
    );
    expect(verdict.category).toBe("unreadable");
  });

  test("a detached head wins over a missing upstream", () => {
    const verdict = classifyClone(state({ head: "detached", branch: null, upstream: false }), PATH);
    expect(verdict.category).toBe("detached");
  });
});

describe("classifyClone, sweep of the whole product", () => {
  const WITH_COMMAND: readonly CloneCategory[] = [
    "detached",
    "no-upstream",
    "behind-dirty",
    "diverged",
    "fast-forwardable",
  ];

  test("every combination has exactly one category, and a command where the table gives one", () => {
    const seen = new Map<string, number>();
    let combinations = 0;
    for (const head of ["branch", "detached", "unreadable"] as const) {
      for (const upstream of [false, true]) {
        for (const behind of [0, 1]) {
          for (const ahead of [0, 1]) {
            for (const dirty of [false, true]) {
              combinations += 1;
              const verdict = classifyClone(
                {
                  head,
                  branch: head === "branch" ? "topic" : null,
                  upstream,
                  behind,
                  ahead,
                  dirty,
                },
                PATH,
              );
              const matching = CLONE_CATEGORIES.filter((name) => name === verdict.category);
              expect(matching).toHaveLength(1);
              expect(verdict.command !== null).toBe(WITH_COMMAND.includes(verdict.category));
              seen.set(verdict.category, (seen.get(verdict.category) ?? 0) + 1);
            }
          }
        }
      }
    }
    expect(combinations).toBe(48);
    // Counted from the table, not from the code: 16 combinations per head; on a
    // branch, 8 have no upstream, 4 are level, and of the 4 behind, 2 are dirty.
    expect(Object.fromEntries(seen)).toEqual({
      unreadable: 16,
      detached: 16,
      "no-upstream": 8,
      "up-to-date": 4,
      "behind-dirty": 2,
      diverged: 1,
      "fast-forwardable": 1,
    });
  });
});

describe("classifyClone, what a copied command may run", () => {
  test("a path with a space is quoted", () => {
    const verdict = classifyClone(state({ behind: 1 }), "/work/my clones/alpha");
    expect(verdict.command).toBe("git -C '/work/my clones/alpha' merge --ff-only @{upstream}");
  });

  test("a branch name holding shell syntax cannot end the git command", () => {
    const verdict = classifyClone(state({ branch: "x;touch$IFS'p", upstream: false }), PATH);
    expect(verdict.command).toBe(
      "git -C /work/alpha branch '--set-upstream-to=origin/x;touch$IFS'\\''p'",
    );
  });

  test("a branch head without a name, or a count that is not a whole number, is unreadable", () => {
    expect(classifyClone(state({ branch: null, upstream: false }), PATH).category).toBe(
      "unreadable",
    );
    expect(classifyClone(state({ behind: Number.NaN }), PATH).category).toBe("unreadable");
    expect(classifyClone(state({ behind: 1, ahead: -1 }), PATH).category).toBe("unreadable");
  });
});
