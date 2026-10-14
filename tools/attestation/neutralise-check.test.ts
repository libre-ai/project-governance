import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  census,
  judge,
  markers,
  neutralise,
  neutraliseJq,
  neutralisePython,
} from "./neutralise-check";

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

  test("a failure with an assertion message is RED", () => {
    expect(judge(assertionFailure, "a", 1)).toEqual({ label: "RED", assertions: 1, crashes: 0 });
  });

  test("a failure that only crashed is reported as such, not as caught", () => {
    expect(judge(crashFailure, "a", 1)).toEqual({
      label: "RED (crash only)",
      assertions: 0,
      crashes: 1,
    });
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
