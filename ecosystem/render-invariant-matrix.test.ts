import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildInvariantMatrix,
  type InvariantMatrix,
  MAPPING_PATH,
  MAPPING_SCHEMA,
  PROJECTION_PATH,
  REGISTER_PATH,
  renderInvariantMatrix,
  type TrackedTree,
} from "./render-invariant-matrix";

/**
 * The matrix generator, judged twice: as pure functions over inputs held in
 * memory (every rule), and as a process over a real git repository (what reads
 * the index and the disk, what reaches the exit code).
 *
 * Every expected value below is written from the brief of the gate — the three
 * `application` values, the two `etat` values, the exit codes — never copied
 * from what the code prints.
 */

const GATE = "tools/check-thing.ts";
const TEST = "tools/check-thing.test.ts";

const REGISTER = [
  "| ID | Invariant | Source | Date |",
  "| --- | --- | --- | --- |",
  "| I-01 | Une règle | ADR-0001 | 2026-01-01 |",
  "| I-02 | **Retiré le 2026-02-02.** Motif | D01 | 2026-01-01 |",
  "| I-03 | Une autre règle | ADR-0002 | 2026-01-01 |",
  "",
].join("\n");

interface Pair {
  readonly gate: string;
  readonly test: string | null;
}

function mappingText(entries: readonly (readonly [string, readonly Pair[]])[]): string {
  const lines = [`schema_version: ${MAPPING_SCHEMA}`, "entries:"];
  for (const [invariant, gates] of entries) {
    lines.push(`  - invariant: ${invariant}`);
    if (gates.length === 0) {
      lines.push("    gates: []");
      continue;
    }
    lines.push("    gates:");
    for (const pair of gates) {
      lines.push(`      - gate: ${pair.gate}`, `        test: ${pair.test ?? "null"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function tree(files: Readonly<Record<string, string | null>>): TrackedTree {
  return { paths: new Set(Object.keys(files)), text: (path) => files[path] ?? null };
}

const TREE = tree({
  [GATE]: "// the gate\n",
  [TEST]: 'import { thing } from "./check-thing";\n',
});

function build(
  mapping: string | null,
  options: { register?: string | null; tracked?: TrackedTree } = {},
) {
  return buildInvariantMatrix(
    { path: REGISTER_PATH, text: options.register === undefined ? REGISTER : options.register },
    { path: MAPPING_PATH, text: mapping },
    options.tracked ?? TREE,
  );
}

/** The one violation a red build is expected to carry, so a second, unrelated red cannot hide. */
function soleViolation(result: ReturnType<typeof build>): string {
  expect(result.matrix).toBeNull();
  expect(result.report.violations).toHaveLength(1);
  return result.report.violations[0] ?? "";
}

const GREEN = mappingText([
  ["I-01", [{ gate: GATE, test: TEST }]],
  ["I-03", []],
]);

describe("buildInvariantMatrix — a conforming correspondence", () => {
  test("yields one row per register row, in register order, and no violation", () => {
    const { report, matrix } = build(GREEN);
    expect(report.violations).toEqual([]);
    expect(matrix?.rows.map((row) => row.invariant)).toEqual(["I-01", "I-02", "I-03"]);
    expect(matrix?.schema_version).toBe("libre-ai.invariant-matrix.v1");
    expect(matrix?.source).toBe("docs/decisions/INVARIANTS.md + ecosystem/invariant-gates.v1.yaml");
  });

  test("an entry with `gates: []` is shown « sans gate », neither dropped nor enforced", () => {
    const row = build(GREEN).matrix?.rows.find((candidate) => candidate.invariant === "I-03");
    expect(row).toEqual({
      invariant: "I-03",
      etat: "en vigueur",
      application: "sans gate",
      gates: [],
    });
  });

  test("a gate with a null test is « imposé, non testé »", () => {
    const { matrix } = build(
      mappingText([
        ["I-01", [{ gate: GATE, test: null }]],
        ["I-03", []],
      ]),
    );
    expect(matrix?.rows[0]).toEqual({
      invariant: "I-01",
      etat: "en vigueur",
      application: "imposé, non testé",
      gates: [{ gate: GATE, test: null }],
    });
  });

  test("a gate with a test is « imposé et testé »", () => {
    expect(build(GREEN).matrix?.rows[0]).toEqual({
      invariant: "I-01",
      etat: "en vigueur",
      application: "imposé et testé",
      gates: [{ gate: GATE, test: TEST }],
    });
  });

  test("a retired register row appears with etat « retiré » and no gate", () => {
    expect(build(GREEN).matrix?.rows[1]).toEqual({
      invariant: "I-02",
      etat: "retiré",
      application: "sans gate",
      gates: [],
    });
  });

  test("the volume says what was read, and the in-force count sums", () => {
    expect(build(GREEN).report.volumeSummary).toBe(
      "register: 3 row(s) read, 2 in force, 1 retired; correspondence: 2 entr(ies); " +
        "1 gate(s) and 1 test(s) verified; in force: 1 without gate, 0 enforced untested, " +
        "1 enforced and tested, 0 unresolved",
    );
  });
});

describe("buildInvariantMatrix — gates and tests are tracked files", () => {
  test("a gate absent from the tracked files is a violation naming its path", () => {
    const violation = soleViolation(
      build(
        mappingText([
          ["I-01", [{ gate: "tools/check-ghost.ts", test: null }]],
          ["I-03", []],
        ]),
      ),
    );
    expect(violation).toContain("tools/check-ghost.ts");
    expect(violation).toContain("not a file tracked by git");
  });

  test("a test absent from the tracked files is a violation naming its path", () => {
    const violation = soleViolation(
      build(
        mappingText([
          ["I-01", [{ gate: GATE, test: "tools/check-ghost.test.ts" }]],
          ["I-03", []],
        ]),
      ),
    );
    expect(violation).toContain("tools/check-ghost.test.ts");
    expect(violation).toContain("not a file tracked by git");
  });

  test("a test that does not cite the base name of its gate is a violation", () => {
    const violation = soleViolation(
      build(GREEN, {
        tracked: tree({ [GATE]: "// the gate\n", [TEST]: "// tests something else\n" }),
      }),
    );
    expect(violation).toContain(TEST);
    expect(violation).toContain("does not cite `check-thing`");
  });

  test("a tracked test that cannot be read is a violation, not a citation", () => {
    const violation = soleViolation(
      build(GREEN, { tracked: tree({ [GATE]: "// the gate\n", [TEST]: null }) }),
    );
    expect(violation).toContain(TEST);
    expect(violation).toContain("could not be read");
  });

  test("the same gate/test pair listed twice for one invariant is a violation", () => {
    const pair = { gate: GATE, test: TEST };
    const violation = soleViolation(
      build(
        mappingText([
          ["I-01", [pair, pair]],
          ["I-03", []],
        ]),
      ),
    );
    expect(violation).toContain("I-01");
    expect(violation).toContain("listed twice");
  });

  test("an index git could not list is a violation", () => {
    const violation = soleViolation(build(GREEN, { tracked: { paths: null, text: () => null } }));
    expect(violation).toContain("git index could not be listed");
  });
});

describe("buildInvariantMatrix — one entry per invariant in force", () => {
  test("an invariant in force without an entry is named", () => {
    const violation = soleViolation(build(mappingText([["I-01", []]])));
    expect(violation).toStartWith("I-03:");
    expect(violation).toContain("no entry");
  });

  test("an invariant with two entries is named", () => {
    const violation = soleViolation(
      build(
        mappingText([
          ["I-01", []],
          ["I-03", []],
          ["I-03", []],
        ]),
      ),
    );
    expect(violation).toStartWith("I-03:");
    expect(violation).toContain("2 entries");
  });

  test("an entry naming an invariant absent from the register is named", () => {
    const violation = soleViolation(
      build(
        mappingText([
          ["I-01", []],
          ["I-03", []],
          ["I-99", []],
        ]),
      ),
    );
    expect(violation).toStartWith("I-99:");
    expect(violation).toContain("absent from the register");
  });

  test("an entry naming a retired invariant is named", () => {
    const violation = soleViolation(
      build(
        mappingText([
          ["I-01", []],
          ["I-02", []],
          ["I-03", []],
        ]),
      ),
    );
    expect(violation).toStartWith("I-02:");
    expect(violation).toContain("retired in the register");
  });
});

describe("buildInvariantMatrix — a register that says nothing is red, never an empty green", () => {
  test("an unreadable register", () => {
    const result = build(GREEN, { register: null });
    expect(result.matrix).toBeNull();
    expect(result.report.violations.join("\n")).toContain("register could not be read");
  });

  test("an empty register", () => {
    const result = build(mappingText([]), { register: "" });
    expect(result.matrix).toBeNull();
    expect(result.report.violations.join("\n")).toContain("zero `| I-nn |` rows");
  });

  test("a register without an I-nn row", () => {
    const result = build(mappingText([]), {
      register: "| ID | Invariant |\n| --- | --- |\n| D01 | Une décision |\n",
    });
    expect(result.matrix).toBeNull();
    expect(result.report.violations.join("\n")).toContain("zero `| I-nn |` rows");
  });

  test("a register carrying a duplicate id names it", () => {
    const result = build(GREEN, { register: `${REGISTER}| I-03 | Encore | ADR-0003 | x |\n` });
    expect(result.matrix).toBeNull();
    expect(result.report.violations.join("\n")).toContain("duplicate register id(s): I-03");
  });
});

describe("buildInvariantMatrix — the correspondence is read whole or not at all", () => {
  const cases: readonly (readonly [string, string | null, string])[] = [
    ["an unreadable file", null, "could not be read"],
    ["invalid YAML", "entries: [", "YAML parse failed"],
    [
      "an unexpected schema_version",
      GREEN.replace(MAPPING_SCHEMA, "libre-ai.invariant-gates.v2"),
      `schema_version must be ${MAPPING_SCHEMA}`,
    ],
    ["a NUL byte", `${GREEN}\0`, "NUL byte"],
    [
      "rule text carried next to the correspondence",
      GREEN.replace("    gates: []", "    gates: []\n    texte: une règle"),
      "unexpected key(s) texte",
    ],
    ["an id that is not an I-nn", GREEN.replace("I-03", "J-03"), "must be an I-nn id"],
    ["a test that is neither a path nor null", GREEN.replace(TEST, "3"), "must be a path or null"],
  ];
  for (const [name, text, reason] of cases) {
    test(name, () => {
      const violation = soleViolation(build(text));
      expect(violation).toStartWith(`${MAPPING_PATH}:`);
      expect(violation).toContain(reason);
    });
  }
});

describe("renderInvariantMatrix", () => {
  const matrix = build(GREEN).matrix as InvariantMatrix;

  test("two renderings of the same inputs are byte-identical", () => {
    const again = build(GREEN).matrix as InvariantMatrix;
    expect(renderInvariantMatrix(again)).toBe(renderInvariantMatrix(matrix));
  });

  test("is indented JSON with one trailing newline, rows in register order", () => {
    const rendered = renderInvariantMatrix(matrix);
    expect(rendered.endsWith("}\n")).toBe(true);
    expect(rendered.endsWith("\n\n")).toBe(false);
    expect(rendered).toContain('\n  "rows": [\n    {\n      "invariant": "I-01",');
    expect(JSON.parse(rendered)).toEqual(matrix);
  });

  test("carries no timestamp: only the four declared row keys and three top-level keys", () => {
    const parsed = JSON.parse(renderInvariantMatrix(matrix)) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["schema_version", "source", "rows"]);
    for (const row of parsed.rows as Record<string, unknown>[]) {
      expect(Object.keys(row)).toEqual(["invariant", "etat", "application", "gates"]);
    }
  });
});

// The process half. A child inheriting GIT_DIR or a global git configuration
// would read another index than the fixture's: each child gets only what is
// declared here.
const SCRIPT = join(import.meta.dir, "render-invariant-matrix.ts");
const ENVIRONMENT = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

interface Run {
  readonly exitCode: number;
  readonly output: string;
}

function run(argv: readonly string[], cwd: string): Run {
  const result = Bun.spawnSync([...argv], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: ENVIRONMENT,
  });
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return {
    exitCode: result.exitCode ?? 1,
    output: `${decode(result.stdout)}${decode(result.stderr)}`,
  };
}

function git(cwd: string, ...argv: string[]): void {
  const outcome = run(["git", ...argv], cwd);
  if (outcome.exitCode !== 0) {
    throw new Error(`fixture setup failed: git ${argv.join(" ")} — ${outcome.output.trim()}`);
  }
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

describe("render-invariant-matrix as a process", () => {
  let root = "";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "invariant-matrix-"));
    git(root, "init", "-q");
    write(root, REGISTER_PATH, REGISTER);
    write(root, MAPPING_PATH, GREEN);
    write(root, GATE, "// the gate\n");
    write(root, TEST, 'import { thing } from "./check-thing";\n');
    mkdirSync(join(root, dirname(PROJECTION_PATH)), { recursive: true });
    git(root, "add", "-A");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("an unknown argument exits 2 and writes nothing", () => {
    const outcome = run(["bun", SCRIPT, "--chek"], root);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.output).toContain("usage:");
    expect(() => readFileSync(join(root, PROJECTION_PATH))).toThrow();
  });

  test("--check on a tree without the projection exits 1, names it, and writes nothing", () => {
    const outcome = run(["bun", SCRIPT, "--check"], root);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.output).toContain(`${PROJECTION_PATH}: absent`);
    expect(() => readFileSync(join(root, PROJECTION_PATH))).toThrow();
  });

  test("generation writes the projection, then --check exits 0 and prints the volume", () => {
    const generated = run(["bun", SCRIPT], root);
    expect(generated.exitCode).toBe(0);
    const written = readFileSync(join(root, PROJECTION_PATH), "utf8");
    expect(JSON.parse(written).rows).toHaveLength(3);

    const checked = run(["bun", SCRIPT, "--check"], root);
    expect(checked.exitCode).toBe(0);
    expect(checked.output).toContain("register: 3 row(s) read, 2 in force, 1 retired");
    expect(checked.output).toContain("1 gate(s) and 1 test(s) verified");
    expect(checked.output).toContain("in force: 1 without gate");
  });

  test("--check on a projection differing from the regeneration exits 1 and names the file", () => {
    const path = join(root, PROJECTION_PATH);
    const conforming = readFileSync(path, "utf8");
    writeFileSync(path, conforming.replace("imposé et testé", "sans gate"));
    const outcome = run(["bun", SCRIPT, "--check"], root);
    writeFileSync(path, conforming);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.output).toContain(`${PROJECTION_PATH}: differs from the regeneration`);
  });

  test("a gate present on disk but not tracked is a violation, and nothing is generated", () => {
    const path = join(root, PROJECTION_PATH);
    const before = readFileSync(path, "utf8");
    git(root, "rm", "-q", "--cached", GATE);
    const outcome = run(["bun", SCRIPT], root);
    git(root, "add", GATE);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.output).toContain(`${GATE}: gate is not a file tracked by git`);
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});
