import { describe, expect, test } from "bun:test";

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runChild } from "./child";
import {
  census,
  judge,
  markers,
  neutralise,
  neutraliseJq,
  neutralisePython,
  summarise,
} from "./neutralise-check";

/** Run one throwaway test file with the Bun under test, and return its report. */
function bunTest(source: readonly string[]): { output: string; exitCode: number } {
  const directory = mkdtempSync(join(tmpdir(), "neutralise-probe-"));
  try {
    writeFileSync(join(directory, "probe.test.ts"), `${source.join("\n")}\n`);
    const run = runChild([process.execPath, "test", "./probe.test.ts"], {
      cwd: directory,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: directory, NO_COLOR: "1" },
    });
    return { output: `${run.stdout}${run.stderr}`, exitCode: run.exitCode };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("neutralise", () => {
  test("forces the whole condition to false, `||` included, and leaves the rest alone", () => {
    const source = ["// neutralise:a", "if (x === 1 || y(2)) flag();", "if (z) other();", ""].join(
      "\n",
    );
    expect(neutralise(source, "a")).toBe(
      ["// neutralise:a", "if (false && (x === 1 || y(2))) flag();", "if (z) other();", ""].join(
        "\n",
      ),
    );
  });

  test("handles an `else if` and a condition that spans lines", () => {
    const source = ["// neutralise:b", "} else if (", "  p ||", "  q", ") r();", ""].join("\n");
    expect(neutralise(source, "b")).toBe(
      ["// neutralise:b", "} else if (false && (", "  p ||", "  q", ")) r();", ""].join("\n"),
    );
    // The condition must open on the line below the marker. Here a later line holds an `if`,
    // and mutating it would silently neutralise an unrelated check, so nothing is mutated.
    expect(
      neutralise(["// neutralise:e", "plain();", "if (x) y();", ""].join("\n"), "e"),
    ).toBeNull();
    const direct = ["// neutralise:c", "} else if (p || (q && r)) s();", ""].join("\n");
    expect(neutralise(direct, "c")).toBe(
      ["// neutralise:c", "} else if (false && (p || (q && r))) s();", ""].join("\n"),
    );
  });

  test("drops the finding, not the condition, when the block refuses and returns", () => {
    const source = [
      "// neutralise:f",
      "if (text === null) {",
      '  add("s", "k", oid);',
      "  return;",
      "}",
      "",
    ].join("\n");
    const mutant = neutralise(source, "f") ?? "";
    expect(mutant).toContain("if (text === null) {");
    expect(mutant).toContain('discard("s", "k", oid);');
    expect(mutant).toContain("  return;");
  });

  test("routes a bare add(...) call to a discarding function", () => {
    const source = ["// neutralise:d", '  add("s", "k", oid);', ""].join("\n");
    const mutant = neutralise(source, "d");
    expect(mutant).toContain('discard("s", "k", oid);');
    expect(mutant).toContain("function discard(");
  });

  test("an unknown marker yields nothing, and markers() lists every id", () => {
    expect(neutralise("// neutralise:a\nif (x) y();\n", "zzz")).toBeNull();
    expect(markers("// neutralise:a\n// neutralise:b-c\n")).toEqual(["a", "b-c"]);
  });
});

describe("census", () => {
  const covered = [
    "// neutralise:a",
    'if (x) add("s", "k", oid);',
    "// neutralise:none the contract guarantees it",
    'throw new GitFailure("x");',
    "",
  ].join("\n");

  test("counts sites with its own pattern and says how each is covered", () => {
    const result = census(covered);
    expect(result).toMatchObject({ sites: 2, marked: 1, exempt: 1, uncovered: [], duplicates: [] });
    expect(result.ids).toEqual(["a"]);
  });

  test("a refusal site without a marker within eight lines, or sharing one, is uncovered", () => {
    const filler = ["a();", "b();", "c();", "d();", "e();", "f();", "g();", "h();"];
    const source = ["// neutralise:a", ...filler, 'throw new Refusal("late");', ""].join("\n");
    expect(census(source).uncovered).toEqual([10]);
    const shared = ["// neutralise:a", 'add("s", "k", o);', 'add("s", "k2", o);', ""].join("\n");
    expect(census(shared).uncovered).toEqual([3]);
    expect(census('add("s", "k", o);\n').uncovered).toEqual([1]);
  });

  test('a set.add(...) call and a comment mentioning add(" are not sites', () => {
    const source = [
      'classes.add("x");',
      '// add("y") in a comment',
      ' * throw new Error("z")',
      "",
    ].join("\n");
    expect(census(source).sites).toBe(0);
  });

  test("a marker id used twice is reported as a duplicate", () => {
    const source = [
      "// neutralise:a",
      'if (x) add("s", "k", o);',
      "// neutralise:a",
      'if (y) add("s", "k", o);',
      "",
    ].join("\n");
    expect(census(source).duplicates).toEqual(["a"]);
  });

  test("the real tool has no uncovered site and no duplicate id", () => {
    const result = census(readFileSync(join(import.meta.dir, "git-attestation.ts"), "utf8"));
    expect(result.uncovered).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.sites).toBe(result.marked + result.exempt);
    expect(result.exempt).toBeGreaterThan(0);
  });
});

describe("judge", () => {
  const assertionFailure = [
    "error: expect(received).toBe(expected)",
    "Expected: true",
    "(fail) group > red:a something [1.00ms]",
    "",
  ].join("\n");
  const crashFailure = [
    "error: Cannot read properties of undefined",
    "      at scan (x.ts:1:1)",
    "(fail) group > red:a something [1.00ms]",
    "",
  ].join("\n");

  // Bun prints the timeout notice on the line AFTER the `(fail)` line, and the assertion that
  // read the killed child's `null` exit code before it (issue #299).
  const timedOut = [
    "error: expect(received).toBe(expected)",
    "Expected: 0",
    "Received: null",
    "(fail) group > red:a something [503.44ms]",
    "  ^ this test timed out after 500ms.",
    "",
  ].join("\n");

  test("a failure with an assertion message is RED", () => {
    expect(judge(assertionFailure, "a", 1)).toEqual({
      label: "RED",
      assertions: 1,
      crashes: 0,
      timeouts: 0,
    });
  });

  test("a failure that only crashed is reported as such, not as caught", () => {
    expect(judge(crashFailure, "a", 1)).toEqual({
      label: "RED (crash only)",
      assertions: 0,
      crashes: 1,
      timeouts: 0,
    });
  });

  test("a test ended by its time budget is BLOCKED, never RED, whatever assertion it failed", () => {
    expect(judge(timedOut, "a", 1)).toEqual({
      label: "BLOCKED (timed out)",
      assertions: 0,
      crashes: 0,
      timeouts: 1,
    });
    // A timeout of another id is not this id's business, and does not leak into the next test.
    expect(judge(`${timedOut.replace("red:a", "red:b")}${assertionFailure}`, "a", 1)).toEqual({
      label: "RED",
      assertions: 1,
      crashes: 0,
      timeouts: 0,
    });
  });

  test("a timeout does not hide another red: test of the same id that failed by assertion", () => {
    expect(judge(`${timedOut}${assertionFailure}`, "a", 1)).toEqual({
      label: "RED",
      assertions: 1,
      crashes: 0,
      timeouts: 1,
    });
    expect(judge(`${timedOut}${crashFailure}`, "a", 1).label).toBe("BLOCKED (timed out)");
  });

  test("the timeout notice is read from a real Bun run, not from a transcription of it", () => {
    // The shape of issue #299: an assertion fails, then Bun reports the test's budget as spent.
    // There the assertion read the `null` exit code of a child Bun killed; here the test blocks
    // past its budget, which yields the same report without a child.
    const run = bunTest([
      'import { expect, test } from "bun:test";',
      'test("red:probe-id blocks past its budget, then fails an assertion", () => {',
      "  Bun.sleepSync(600);",
      "  expect(1).toBe(0);",
      "}, 300);",
    ]);
    expect(run.output).toContain("this test timed out after");
    expect(run.output).toContain("error: expect(");
    expect(judge(run.output, "probe-id", run.exitCode)).toEqual({
      label: "BLOCKED (timed out)",
      assertions: 0,
      crashes: 0,
      timeouts: 1,
    });
  });

  test("a test stopped by its beforeEach or afterEach hook budget is BLOCKED (real Bun run)", () => {
    const run = bunTest([
      'import { beforeEach, describe, expect, test } from "bun:test";',
      'describe("hooked", () => {',
      "  beforeEach(async () => {",
      "    await Bun.sleep(1000);",
      "  }, 100);",
      '  test("red:hook-id never starts", () => {',
      "    expect(1).toBe(0);",
      "  });",
      "});",
    ]);
    expect(run.output).toContain("hook timed out for this test");
    expect(judge(run.output, "hook-id", run.exitCode)).toEqual({
      label: "BLOCKED (timed out)",
      assertions: 0,
      crashes: 0,
      timeouts: 1,
    });
  });

  test("an unhandled error between tests is no test's assertion (real Bun run)", () => {
    // The first test leaves a timer that fails an assertion after it ended; Bun prints that
    // error under `# Unhandled error between tests`, right before the next `(fail)` line.
    const run = bunTest([
      'import { beforeAll, describe, expect, test } from "bun:test";',
      'test("red:leak-id ends before its timer fires", async () => {',
      "  setTimeout(() => {",
      "    expect(1).toBe(2);",
      "  }, 50);",
      "});",
      'describe("later", () => {',
      "  beforeAll(async () => {",
      "    await Bun.sleep(200);",
      "  });",
      '  test("red:next-id crashes without an assertion", () => {',
      '    throw new Error("crash");',
      "  });",
      "});",
    ]);
    expect(run.output).toContain("# Unhandled error between tests");
    expect(judge(run.output, "next-id", run.exitCode)).toEqual({
      label: "RED (crash only)",
      assertions: 0,
      crashes: 1,
      timeouts: 0,
    });
    expect(judge(run.output, "leak-id", run.exitCode).label).toBe("STILL GREEN");
  });

  test("an exit code 0, or failures of other ids, are STILL GREEN", () => {
    expect(judge("", "a", 0).label).toBe("STILL GREEN");
    expect(judge(assertionFailure.replace("red:a", "red:b"), "a", 1).label).toBe("STILL GREEN");
  });

  test("a pass line resets the error context", () => {
    const output = [
      "error: expect(received).toBe(expected)",
      "(pass) other test",
      crashFailure,
    ].join("\n");
    expect(judge(output, "a", 1).label).toBe("RED (crash only)");
  });
});

describe("summarise", () => {
  test("every mutant that is not RED is a problem, and one problem fails the run", () => {
    const summary = summarise(
      [
        { file: "a.ts", label: "RED" },
        { file: "a.ts", label: "BLOCKED (timed out)" },
        { file: "b.sh", label: "RED (crash only)" },
        { file: "b.sh", label: "STILL GREEN" },
        { file: "b.sh", label: "RED" },
      ],
      0,
    );
    expect(summary.problems).toBe(3);
    expect(summary.exitCode).toBe(1);
  });

  test("all RED and no structural problem pass; a structural problem alone fails", () => {
    const red = [
      { file: "a.ts", label: "RED" as const },
      { file: "b.sh", label: "RED" as const },
    ];
    expect(summarise(red, 0)).toMatchObject({ problems: 0, exitCode: 0, mutated: 2 });
    expect(summarise(red, 1)).toMatchObject({ problems: 1, exitCode: 1 });
    expect(summarise([], 0)).toMatchObject({ problems: 0, exitCode: 0, mutated: 0 });
  });

  test("the per-file lines sum to the mutants, in the order red, crash only, timed out, still green", () => {
    const summary = summarise(
      [
        { file: "a.ts", label: "STILL GREEN" },
        { file: "a.ts", label: "RED" },
        { file: "a.ts", label: "BLOCKED (timed out)" },
        { file: "b.sh", label: "RED (crash only)" },
      ],
      0,
    );
    expect(summary.lines).toEqual(["  a.ts: 3 = 1 + 0 + 1 + 1", "  b.sh: 1 = 0 + 1 + 0 + 0"]);
    expect(summary.mutated).toBe(4);
  });
});

describe("the other instruments", () => {
  test("every instrument of the tool has no uncovered site and no duplicate id", () => {
    for (const [file, language] of [
      ["manifest.sh", "sh"],
      ["provider-policy.sh", "sh"],
      ["canonicalize.py", "py"],
      ["provider-policy.frozen-check.jq", "jq"],
    ] as const) {
      const result = census(readFileSync(join(import.meta.dir, file), "utf8"), language);
      expect([file, result.uncovered, result.duplicates]).toEqual([file, [], []]);
      expect(result.sites).toBe(result.marked + result.exempt);
      expect(result.sites).toBeGreaterThan(0);
    }
  });

  test("the shell pattern counts return 1 and readback decisions; the jq pattern counts blockers and clauses", () => {
    expect(census("x || return 1\n", "sh").sites).toBe(1);
    expect(census("printf 'null'\n", "sh").sites).toBe(1);
    expect(census("# return 1 in a comment\n", "sh").sites).toBe(0);
    expect(census('(if a then "m" else empty end),\n', "jq").sites).toBe(1);
    expect(census("  and (.x == 1)\n", "jq").sites).toBe(1);
    expect(census("    refuse('x')\n", "py").sites).toBe(1);
    expect(census("def refuse(message):\n", "py").sites).toBe(0);
    expect(census("    raise ValueError('x')\n", "py").sites).toBe(1);
  });

  test("neutralisePython turns the condition below the marker into False", () => {
    const source = [
      "# neutralise:p",
      "if not value.isascii():",
      '    raise ValueError("x")',
      "",
    ].join("\n");
    expect(neutralisePython(source, "p")).toBe(
      ["# neutralise:p", "if False:", '    raise ValueError("x")', ""].join("\n"),
    );
    const chain = ["# neutralise:q", "elif type(v) is not int:", "    pass", ""].join("\n");
    expect(neutralisePython(chain, "q")).toContain("elif False:");
    expect(neutralisePython("# neutralise:r\nx = 1\n", "r")).toBeNull();
  });

  test("neutraliseJq makes a blocker condition false, also over several lines, and a clause true", () => {
    const blocker = [
      "# neutralise:b",
      "(if (.a // 1) != 0 and .b",
      '  then "m" else empty end),',
      "",
    ].join("\n");
    expect(neutraliseJq(blocker, "b")).toBe(
      ["# neutralise:b", '(if false then "m" else empty end),', ""].join("\n"),
    );
    const clause = ["# neutralise:c", "  and (.x == 1", "       and .y)", "  and (.z)", ""].join(
      "\n",
    );
    expect(neutraliseJq(clause, "c")).toBe(
      ["# neutralise:c", "  and (true)", "  and (.z)", ""].join("\n"),
    );
    expect(neutraliseJq("# neutralise:d\nplain\n", "d")).toBeNull();
  });
});
