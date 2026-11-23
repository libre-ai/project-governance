import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The `if:` of each gate step of validate-composition.yml must select exactly
// the targets for which .github/composition/check-products.py plans that gate.
// A target missing from a step's condition is skipped, and a skipped step
// leaves the job green; a target listed for a gate the runner refuses turns
// its composition red. Review findings M1, N1, N2 and D of
// docs/reviews/pkw-servers-retirement-2026-11-23/REVIEW.md.
//
// The workflow is read with Bun.YAML, the parser of the runtime, so a
// condition is judged on the value YAML loads: comments cut, continuation
// lines folded in. Bun.YAML keeps the last of two equal keys without a word
// (measured on Bun 1.4.0: `if: a` then `if: b` loads `b`), so duplicate keys
// are found by the dedicated scan `duplicateKeys` below, run on the same text.

interface Step {
  readonly name?: string;
  readonly if?: unknown;
  readonly run?: string;
}
interface Workflow {
  readonly jobs: { readonly validate: { readonly steps: readonly Step[] } };
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

/**
 * Keys written twice in the same block mapping, as `line N: key`.
 *
 * Block-style YAML only, which is how the workflows of this repository are
 * written: a `- ` opens a new mapping two columns further, a key closes every
 * deeper mapping, and the body of a block scalar (`|`, `>`) is skipped. Flow
 * mappings (`{ … }`) and keys spread over several lines are not read; a line
 * that is not `key:` (a plain-scalar continuation, a list scalar) is passed.
 */
function duplicateKeys(text: string): string[] {
  const findings: string[] = [];
  const scopes: Scope[] = [];
  let blockScalarIndent: number | null = null;
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    if (/^\s*(?:#.*)?$/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    let column = indent;
    let rest = raw.slice(indent);
    while (rest.startsWith("- ")) {
      column += 2;
      rest = rest.slice(2);
      while (scopes.length > 0 && (scopes.at(-1) as Scope).indent >= column) scopes.pop();
      scopes.push({ indent: column, keys: new Set() });
    }
    const match = /^([A-Za-z0-9_.$-]+|"[^"]*"|'[^']*')[ \t]*:(?:[ \t]+(.*))?$/.exec(rest);
    if (match === null) continue;
    while (scopes.length > 0 && (scopes.at(-1) as Scope).indent > column) scopes.pop();
    if (scopes.length === 0 || (scopes.at(-1) as Scope).indent < column) {
      scopes.push({ indent: column, keys: new Set() });
    }
    const scope = scopes.at(-1) as Scope;
    const key = (match[1] as string).replace(/^["']|["']$/g, "");
    if (scope.keys.has(key)) findings.push(`line ${index + 1}: ${key}`);
    scope.keys.add(key);
    const value = (match[2] ?? "").replace(/\s+#.*$/, "").trim();
    if (/^[|>][-+0-9]*$/.test(value)) blockScalarIndent = column;
  }
  return findings;
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

describe("duplicateKeys", () => {
  test("finds a key written twice in one step", () => {
    expect(duplicateKeys("steps:\n  - name: a\n    if: x\n    shell: bash\n    if: y\n")).toEqual([
      "line 5: if",
    ]);
  });
  test("does not mix two steps, nor a nested mapping with its parent", () => {
    expect(
      duplicateKeys(
        "steps:\n  - name: a\n    if: x\n    with:\n      if: z\n  - name: b\n    if: y\n",
      ),
    ).toEqual([]);
  });
  test("skips the body of a block scalar", () => {
    expect(
      duplicateKeys("steps:\n  - name: a\n    run: |\n      if: 1\n      if: 2\n    if: y\n"),
    ).toEqual([]);
  });
  test("reads quoted keys as their name", () => {
    expect(duplicateKeys("children:\n  'a': 1\n  a: 2\n")).toEqual(["line 3: a"]);
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
  const steps = (Bun.YAML.parse(text) as Workflow).jobs.validate.steps;
  const step = (name: string): Step => {
    const found = steps.filter((candidate) => candidate.name === name);
    expect(found).toHaveLength(1);
    return found[0] as Step;
  };
  const targets = runnerTargets();

  test("the workflow writes no key twice in the same mapping", () => {
    expect(duplicateKeys(text)).toEqual([]);
  });

  test("the runner names its targets", () => {
    expect(targets.length).toBeGreaterThan(0);
  });

  test.each(
    Object.entries(GATE_STEPS),
  )("the %s step selects exactly the planned targets", (gate, name) => {
    const selected = conditionTargets(step(name).if);
    expect(selected.filter((target) => !targets.includes(target))).toEqual([]);
    expect(selected).toEqual(planned(gate, targets));
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
