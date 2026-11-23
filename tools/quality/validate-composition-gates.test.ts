import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The `if:` of each gate step of validate-composition.yml must select exactly
// the targets for which .github/composition/check-products.py plans that gate.
// A target missing from a step's condition is skipped, and a skipped step
// leaves the job green; a target listed for a gate the runner refuses turns
// its composition red. Review findings M1, N1 to N5 and D of
// docs/reviews/pkw-servers-retirement-2026-11-23/REVIEW.md.
//
// The workflow is read with Bun.YAML, the parser of the runtime, so a
// condition is judged on the value YAML loads: comments cut, continuation
// lines folded in. Bun.YAML keeps the last of two equal keys without a word
// (measured on Bun 1.4.0: `if: a` then `if: b` loads `b`), so duplicate keys
// are found by the dedicated scan `scanKeys` below, run on the same text.
//
// What the test holds: the loaded `if:` of each gate step, in one of two
// shapes, equals the runner's plan; the `run` of each gate step calls the
// runner for that gate and for `$INPUT_TARGET`, which the job sets to
// `inputs.target`; the job has no `if:` and neither the job nor a gate step
// has `continue-on-error`; the file has no duplicate key, no flow mapping, no
// explicit `?` key, and no line the scan cannot classify.
//
// Limits. This is not a parser of GitHub's semantics: it does not evaluate an
// expression, it only admits two literal shapes; it does not know how GitHub
// treats a duplicate key, a skipped job or `continue-on-error` (none
// measured); it reads only this workflow, not the caller's (`uses:` with its
// own `if:` or `continue-on-error` in a consumer is outside it); it reads the
// `run` script as text, so a gate call hidden behind a shell variable or a
// second script is not seen; and the key scan reads block-style YAML only,
// failing on any other form instead of reading it.

interface Step {
  readonly name?: string;
  readonly if?: unknown;
  readonly run?: string;
  readonly "continue-on-error"?: unknown;
}
interface Job {
  readonly if?: unknown;
  readonly "continue-on-error"?: unknown;
  readonly env?: Record<string, unknown>;
  readonly steps: readonly Step[];
}
interface Workflow {
  readonly jobs: { readonly validate: Job };
}

const WORKFLOW_URL = new URL("../../.github/workflows/validate-composition.yml", import.meta.url);
const RUNNER = new URL("../../.github/composition/check-products.py", import.meta.url).pathname;

const GATE_STEPS = {
  native: "Run native product tests",
  wasm: "Build and verify current product WASM",
  e2e: "Run selected browser suite sequentially",
} as const;
const BROWSER_INSTALL = "Install browsers for the selected product";

const TARGET = "[a-z][a-z0-9-]*";
/** The only two shapes a gate step condition may take, matched on the whole loaded value. */
const EQUALITIES = new RegExp(
  `^inputs\\.target == '${TARGET}'(?: \\|\\| inputs\\.target == '${TARGET}')*$`,
);
const MEMBERSHIP = new RegExp(
  `^contains\\(fromJSON\\('\\["${TARGET}"(?:,"${TARGET}")*\\]'\\), inputs\\.target\\)$`,
);

/** Targets a condition selects, or an error naming why it is not read. */
function conditionTargets(condition: unknown): string[] {
  if (typeof condition !== "string") {
    throw new Error(`condition is not a string: ${JSON.stringify(condition)}`);
  }
  if (!EQUALITIES.test(condition) && !MEMBERSHIP.test(condition)) {
    throw new Error(`condition ${JSON.stringify(condition)} has neither admitted shape`);
  }
  return [...condition.matchAll(new RegExp(`["'](${TARGET})["']`, "g"))]
    .map((m) => m[1] as string)
    .sort();
}

interface Scope {
  readonly indent: number;
  readonly keys: Set<string>;
}

/** What `scanKeys` read, line by line; the four line counters sum to `lines`. */
interface KeyScan {
  readonly lines: number;
  readonly blankOrComment: number;
  readonly blockScalarBody: number;
  readonly keyLines: number;
  /** Lines of none of the three classes above, as `line N`. */
  readonly unclassified: readonly string[];
  /** Keys written twice in the same block mapping, as `line N: key`. */
  readonly duplicates: readonly string[];
  /** Flow mappings and explicit `?` keys, as `line N`: forms the scan does not read. */
  readonly refusedForms: readonly string[];
}

/**
 * Classifies every line of a block-style YAML text and finds duplicate keys.
 *
 * A `- ` opens a new mapping two columns further, a key closes every deeper
 * mapping, and the body of a block scalar (`|`, `>`) is skipped. A line is a
 * blank or comment line, a block-scalar body line, or a `key:` line (after
 * any `- `); any other line is unclassified. A flow mapping (a value or an
 * item that starts with `{`, or a flow sequence holding one) and an explicit
 * `?` key are refused forms. The caller fails on any unclassified line and
 * any refused form, so what the scan cannot read is never passed silently.
 */
function scanKeys(text: string): KeyScan {
  const duplicates: string[] = [];
  const unclassified: string[] = [];
  const refusedForms: string[] = [];
  const scopes: Scope[] = [];
  let blankOrComment = 0;
  let blockScalarBody = 0;
  let keyLines = 0;
  let blockScalarIndent: number | null = null;
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const indent = raw.length - raw.trimStart().length;
    if (blockScalarIndent !== null && (raw.trim() === "" || indent > blockScalarIndent)) {
      blockScalarBody += 1;
      continue;
    }
    blockScalarIndent = null;
    if (/^\s*(?:#.*)?$/.test(raw)) {
      blankOrComment += 1;
      continue;
    }
    let column = indent;
    let rest = raw.slice(indent);
    while (rest.startsWith("- ")) {
      column += 2;
      rest = rest.slice(2);
      while (scopes.length > 0 && (scopes.at(-1) as Scope).indent >= column) scopes.pop();
      scopes.push({ indent: column, keys: new Set() });
    }
    if (rest.startsWith("{") || rest === "?" || rest.startsWith("? ")) {
      refusedForms.push(`line ${index + 1}`);
      unclassified.push(`line ${index + 1}`);
      continue;
    }
    const match = /^([A-Za-z0-9_.$-]+|"[^"]*"|'[^']*')[ \t]*:(?:[ \t]+(.*))?$/.exec(rest);
    if (match === null) {
      unclassified.push(`line ${index + 1}`);
      continue;
    }
    keyLines += 1;
    while (scopes.length > 0 && (scopes.at(-1) as Scope).indent > column) scopes.pop();
    if (scopes.length === 0 || (scopes.at(-1) as Scope).indent < column) {
      scopes.push({ indent: column, keys: new Set() });
    }
    const scope = scopes.at(-1) as Scope;
    const key = (match[1] as string).replace(/^["']|["']$/g, "");
    if (scope.keys.has(key)) duplicates.push(`line ${index + 1}: ${key}`);
    scope.keys.add(key);
    const value = (match[2] ?? "").replace(/\s+#.*$/, "").trim();
    if (value.startsWith("{") || (value.startsWith("[") && value.includes("{"))) {
      refusedForms.push(`line ${index + 1}`);
    }
    if (/^[|>][-+0-9]*$/.test(value)) blockScalarIndent = column;
  }
  return {
    lines: lines.length,
    blankOrComment,
    blockScalarBody,
    keyLines,
    unclassified,
    duplicates,
    refusedForms,
  };
}

/** Targets for which check-products.py plans `gate`: it exits non-zero when it plans none. */
function planned(gate: string, targets: readonly string[]): string[] {
  return targets
    .filter((target) => {
      const result = Bun.spawnSync(
        [
          "python3",
          "-B",
          RUNNER,
          "--root",
          ".",
          "--bun",
          "bun",
          "--node",
          "node",
          "--cargo",
          "cargo",
          "--target",
          target,
          "--gate",
          gate,
          "--plan",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (result.exitCode === 0) return true;
      const stderr = result.stderr.toString();
      if (!stderr.includes("No applicable gate")) {
        throw new Error(`check-products.py failed for ${target}/${gate}: ${stderr}`);
      }
      return false;
    })
    .sort();
}

/** The runner's TARGETS, read from its plan of every root gate. */
function runnerTargets(): string[] {
  const result = Bun.spawnSync(
    [
      "python3",
      "-B",
      RUNNER,
      "--root",
      ".",
      "--bun",
      "bun",
      "--node",
      "node",
      "--cargo",
      "cargo",
      "--target",
      "all",
      "--gate",
      "root",
      "--plan",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  const plan = JSON.parse(result.stdout.toString()) as { steps: { target: string }[] };
  return [...new Set(plan.steps.map((step) => step.target))].sort();
}

describe("scanKeys", () => {
  test("finds a key written twice in one step", () => {
    expect(
      scanKeys("steps:\n  - name: a\n    if: x\n    shell: bash\n    if: y\n").duplicates,
    ).toEqual(["line 5: if"]);
  });
  test("does not mix two steps, nor a nested mapping with its parent", () => {
    expect(
      scanKeys("steps:\n  - name: a\n    if: x\n    with:\n      if: z\n  - name: b\n    if: y\n")
        .duplicates,
    ).toEqual([]);
  });
  test("skips the body of a block scalar, and counts it", () => {
    const scan = scanKeys(
      "steps:\n  - name: a\n    run: |\n      if: 1\n\n      if: 2\n    if: y\n",
    );
    expect(scan.duplicates).toEqual([]);
    expect(scan.blockScalarBody).toBe(3);
    expect(scan.unclassified).toEqual([]);
  });
  test("reads quoted keys as their name", () => {
    expect(scanKeys("children:\n  'a': 1\n  a: 2\n").duplicates).toEqual(["line 3: a"]);
  });
  test.each([
    ["a flow-mapping item", "steps:\n  - {name: a, if: x, if: y}\n", ["line 2"]],
    ["a flow-mapping value", "with: {a: 1}\n", ["line 1"]],
    ["a flow sequence of mappings", "matrix: [{a: 1}]\n", ["line 1"]],
    ["an explicit key", "? if\n: x\n", ["line 1"]],
  ])("refuses %s", (_label, text, lines) => {
    expect(scanKeys(text).refusedForms).toEqual(lines);
  });
  test("leaves a plain-scalar continuation and a scalar item unclassified", () => {
    expect(scanKeys("a: b\n  c\nlist:\n  - x\n").unclassified).toEqual(["line 2", "line 4"]);
  });
  test("its line counters sum to the lines read", () => {
    const scan = scanKeys("# c\na: |\n  x\nb: 1\n  y\n");
    expect(
      scan.blankOrComment + scan.blockScalarBody + scan.keyLines + scan.unclassified.length,
    ).toBe(scan.lines);
  });
});

describe("conditionTargets", () => {
  test.each([
    ["inputs.target == 'a' || inputs.target == 'b-c'", ["a", "b-c"]],
    [`contains(fromJSON('["a","b"]'), inputs.target)`, ["a", "b"]],
  ])("reads %s", (condition, targets) => {
    expect(conditionTargets(condition)).toEqual(targets);
  });
  test.each([
    "inputs.target == 'a' || inputs.target == 'b' && false",
    "inputs.target == 'a' ||\tinputs.target == 'b'",
    'inputs.target == "a"',
    `contains(fromJSON('["a","b"]'), inputs.target`,
    "!(inputs.target == 'a')",
  ])("refuses %s", (condition) => {
    expect(() => conditionTargets(condition)).toThrow("neither admitted shape");
  });
});

describe("validate-composition gate steps match check-products.py", () => {
  const text = readFileSync(WORKFLOW_URL, "utf8");
  const job = (Bun.YAML.parse(text) as Workflow).jobs.validate;
  const steps = job.steps;
  const step = (name: string): Step => {
    const found = steps.filter((candidate) => candidate.name === name);
    expect(found).toHaveLength(1);
    return found[0] as Step;
  };
  const targets = runnerTargets();

  test("the key scan reads every line, and finds no duplicate key nor unread form", () => {
    const scan = scanKeys(text);
    // The volume the scan examined, printed on success too (gate-integrity §2).
    console.log(
      `scanKeys: ${scan.lines} lines = ${scan.keyLines} key + ${scan.blockScalarBody} block-scalar body + ` +
        `${scan.blankOrComment} blank or comment + ${scan.unclassified.length} unclassified; ` +
        `${scan.duplicates.length} duplicate key(s), ${scan.refusedForms.length} refused form(s)`,
    );
    expect(
      scan.keyLines + scan.blockScalarBody + scan.blankOrComment + scan.unclassified.length,
    ).toBe(scan.lines);
    expect(scan.keyLines).toBeGreaterThan(0);
    expect(scan.refusedForms).toEqual([]);
    expect(scan.unclassified).toEqual([]);
    expect(scan.duplicates).toEqual([]);
  });

  test("the runner names its targets", () => {
    expect(targets.length).toBeGreaterThan(0);
  });

  test("the job is never skipped nor allowed to fail, and sets INPUT_TARGET to inputs.target", () => {
    expect(Object.hasOwn(job, "if")).toBe(false);
    expect(Object.hasOwn(job, "continue-on-error")).toBe(false);
    expect(job.env?.INPUT_TARGET).toBe("${{ inputs.target }}");
  });

  test.each(
    Object.entries(GATE_STEPS),
  )("the %s step selects exactly the planned targets", (gate, name) => {
    const selected = conditionTargets(step(name).if);
    expect(selected.filter((target) => !targets.includes(target))).toEqual([]);
    expect(selected).toEqual(planned(gate, targets));
  });

  test.each(
    Object.entries(GATE_STEPS),
  )("the %s step runs that gate for the selected target and may not fail silently", (gate, name) => {
    const gateStep = step(name);
    expect(Object.hasOwn(gateStep, "continue-on-error")).toBe(false);
    const run = gateStep.run ?? "";
    expect(run.match(/check-products\.py/g)).toHaveLength(1);
    expect([...run.matchAll(/--gate\s+(\S+)/g)].map((m) => m[1])).toEqual([gate]);
    expect([...run.matchAll(/--target\s+(\S+)/g)].map((m) => m[1])).toEqual(['"$INPUT_TARGET"']);
  });

  test("the browser install selects the suite's targets and installs in their child directories", () => {
    const install = step(BROWSER_INSTALL);
    expect(conditionTargets(install.if)).toEqual(conditionTargets(step(GATE_STEPS.e2e).if));
    const children = Object.fromEntries(
      [...(install.run ?? "").matchAll(/^\s+'([a-z][a-z0-9-]*)': '([^']*)',$/gm)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    const plan = Bun.spawnSync(
      [
        "python3",
        "-B",
        RUNNER,
        "--root",
        ".",
        "--bun",
        "bun",
        "--node",
        "node",
        "--cargo",
        "cargo",
        "--target",
        "all",
        "--gate",
        "e2e",
        "--plan",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(plan.exitCode).toBe(0);
    const cwds = (
      JSON.parse(plan.stdout.toString()) as { steps: { target: string; cwd: string }[] }
    ).steps;
    const expected = Object.fromEntries(
      cwds.map((s) => [s.target, s.cwd === s.target ? "" : s.cwd.slice(s.target.length + 1)]),
    );
    expect(children).toEqual(expected);
  });
});
