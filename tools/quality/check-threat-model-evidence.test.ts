import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  HARDENING_FLAGS,
  hardenedGitEnvironment,
  CONFIG_PATH as PINNED_CONFIG_PATH,
  scanText,
  validateConfig as validatePinnedConfig,
} from "./check-pinned-citations";
import { findCitations } from "./check-threat-model-citations";
import {
  type EvidenceInput,
  type EvidenceOutcome,
  type EvidenceTarget,
  evaluateEvidence,
  findNamedTest,
  LEDGER_PATH,
  loadResolver,
  MODEL_PATH,
  parseEvidenceCell,
  parseLedger,
  parseModelThreats,
} from "./check-threat-model-evidence";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const TOOL = join(ROOT, "tools/quality/check-threat-model-evidence.ts");

// ---------------------------------------------------------------- fixtures ---

const TABLE_HEAD = [
  "| Threat | STRIDE | Control | Residual Risk | Invariant |",
  "| --- | --- | --- | --- | --- |",
];
/** Two surfaces, three threats; a table after the section that must not be read. */
const MODEL = [
  "# Model",
  "",
  "## STRIDE + LINDDUN per surface",
  "",
  "### Alpha",
  "",
  ...TABLE_HEAD,
  "| first threat | Tampering | a control | a residual | none |",
  "| second threat | Spoofing | a control | a residual | none |",
  "",
  "### Beta",
  "",
  ...TABLE_HEAD,
  "| third threat | Elevation | a control | a residual | none |",
  "",
  "## Residual-risk register",
  "",
  "| ID | Risk |",
  "| --- | --- |",
  "| R1 | not a threat row |",
].join("\n");

const THREATS_HEAD = [
  "## Threat evidence",
  "",
  "| ID | Threat | Evidence |",
  "| --- | --- | --- |",
];
const RISKS_HEAD = [
  "## Agentic risks",
  "",
  "| ID | Risk | Barrier | Detection | Criterion |",
  "| --- | --- | --- | --- | --- |",
];
const RESIDUAL = "residual: held elsewhere";
const RISK_RESIDUAL = `| AR-01 | a risk | ${RESIDUAL} | ${RESIDUAL} | detection or judgment |`;

function ledgerOf(threatRows: readonly string[], riskRows: readonly string[] = [RISK_RESIDUAL]) {
  return ["# Ledger", "", ...THREATS_HEAD, ...threatRows, "", ...RISKS_HEAD, ...riskRows].join(
    "\n",
  );
}

/** The three threats of MODEL, each with the given Evidence cell (residual by default). */
function threatRows(evidence: Partial<Record<1 | 2 | 3, string>> = {}): string[] {
  return [
    `| T-S1-01 | first threat | ${evidence[1] ?? RESIDUAL} |`,
    `| T-S1-02 | second threat | ${evidence[2] ?? RESIDUAL} |`,
    `| T-S2-01 | third threat | ${evidence[3] ?? RESIDUAL} |`,
  ];
}

const TS_TEST = 'test("refuses the write", () => {});\n';
const FILES: Readonly<Record<string, string>> = {
  "src/guard.ts": "export const guard = 1;\n",
  "src/guard.test.ts": TS_TEST,
  "src/guard.sh": TS_TEST,
  "docs/INVENTORY.md": TS_TEST,
};

/** Local paths of FILES are found, `locked/…` is unreadable, a pinned target is unavailable. */
const resolve: EvidenceInput["resolve"] = (target) => {
  if (target.kind === "pinned") return { state: "unavailable", reason: "not supplied" };
  if (target.path.startsWith("locked/")) return { state: "unreadable", reason: "EACCES" };
  const text = FILES[target.path];
  return text === undefined
    ? { state: "missing", reason: "not tracked" }
    : { state: "found", text };
};

const SHA = "0123456789abcdef0123456789abcdef01234567";
const PINNED = `\`acme/widgets@${SHA}:src/guard.ts\``;

/** The three sums of the brief hold for every outcome, whatever its exit code. */
function expectSums(outcome: EvidenceOutcome): void {
  const { threats, risks, evidence } = outcome;
  expect(threats.total).toBe(threats.mitigated + threats.residual + threats.unmapped);
  expect(risks.total).toBe(risks.barred + risks.residual + risks.red);
  expect(evidence.cited).toBe(
    evidence.found + evidence.missing + evidence.unavailable + evidence.unreadable,
  );
  for (const surface of outcome.surfaces) {
    expect(surface.threats).toBe(surface.mitigated + surface.residual + surface.unmapped);
  }
}

function evaluate(ledger: string, model: string = MODEL): EvidenceOutcome {
  const outcome = evaluateEvidence({ model, ledger, resolve });
  expectSums(outcome);
  return outcome;
}

// ------------------------------------------------------------------ threats ---

describe("threats", () => {
  test("every threat residual or backed by a found file: nothing to report", () => {
    const outcome = evaluate(ledgerOf(threatRows({ 1: "`src/guard.ts`" })));
    expect(outcome.exitCode).toBe(0);
    expect(outcome.threats).toEqual({
      total: 3,
      mitigated: 1,
      residual: 2,
      unmapped: 0,
      orphans: 0,
    });
    expect(outcome.surfaces.map((surface) => [surface.title, surface.threats])).toEqual([
      ["Alpha", 2],
      ["Beta", 1],
    ]);
    expect(outcome.lines.at(-2)).toBe("threats=3 mitigated=1 residual=2 unmapped=0 orphans=0");
    expect(outcome.lines.at(-1)).toBe("risks=1 barred=0 residual=1 red=0");
  });

  test("evidence naming an absent file: unmapped, counted missing, exit 1", () => {
    const outcome = evaluate(ledgerOf(threatRows({ 1: "`src/absent.ts`" })));
    expect(outcome.threats.unmapped).toBe(1);
    expect(outcome.evidence).toMatchObject({ cited: 1, missing: 1 });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.lines.join("\n")).toContain("T-S1-01: src/absent.ts: missing");
  });

  test("pinned evidence whose repository is not supplied: unavailable, unmapped, exit 3", () => {
    const outcome = evaluate(ledgerOf(threatRows({ 1: PINNED })));
    expect(outcome.evidence).toMatchObject({ cited: 1, unavailable: 1, missing: 0 });
    expect(outcome.threats.unmapped).toBe(1);
    expect(outcome.exitCode).toBe(3);
  });

  test("an unavailable piece of evidence beside a missing one elsewhere: exit 1", () => {
    const outcome = evaluate(ledgerOf(threatRows({ 1: PINNED, 2: "`src/absent.ts`" })));
    expect(outcome.evidence).toMatchObject({ cited: 2, unavailable: 1, missing: 1 });
    expect(outcome.threats.unmapped).toBe(2);
    expect(outcome.exitCode).toBe(1);
  });

  test("an unreadable piece of evidence is counted apart and is not an unavailable one", () => {
    const outcome = evaluate(ledgerOf(threatRows({ 1: "`locked/guard.ts`" })));
    expect(outcome.evidence).toMatchObject({ cited: 1, unreadable: 1, unavailable: 0 });
    expect(outcome.exitCode).toBe(1);
  });

  test("a named test that the file holds is found; another name is missing", () => {
    const held = evaluate(
      ledgerOf(threatRows({ 1: "`src/guard.test.ts` :: `refuses the write`" })),
    );
    expect(held.threats.mitigated).toBe(1);
    expect(held.exitCode).toBe(0);
    const other = evaluate(
      ledgerOf(threatRows({ 1: "`src/guard.test.ts` :: `refuses the read`" })),
    );
    expect(other.evidence.missing).toBe(1);
    expect(other.exitCode).toBe(1);
  });

  test.each([
    "src/guard.sh",
    "docs/INVENTORY.md",
  ])("a named test cited in %s is not found: the extension is not recognised", (path) => {
    const outcome = evaluate(ledgerOf(threatRows({ 1: `\`${path}\` :: \`refuses the write\`` })));
    expect(outcome.evidence.missing).toBe(1);
    expect(outcome.threats.unmapped).toBe(1);
    expect(outcome.lines.join("\n")).toContain("extension not recognised");
  });

  test.each([
    ["a climb out of the tree", "`../outside/guard.ts`"],
    ["an absolute path", "`/etc/passwd`"],
    ["a character no cited path is written with", "`src/guard*.ts`"],
    ["a short sha", "`acme/widgets@0123456:src/guard.ts`"],
  ])("a target with %s is outside the grammar: unmapped", (_label, cell) => {
    expect(parseEvidenceCell(cell).kind).toBe("invalid");
    const outcome = evaluate(ledgerOf(threatRows({ 1: cell })));
    expect(outcome.threats.unmapped).toBe(1);
    expect(outcome.evidence.cited).toBe(0);
    expect(outcome.exitCode).toBe(1);
  });

  test.each([
    ["text outside the code spans", "see `src/guard.ts`"],
    ["text after the code spans", "`src/guard.ts` and friends"],
    ["a trailing comma", "`src/guard.ts`,"],
    ["a test name glued to its target", "`src/guard.test.ts`::`refuses the write`"],
    ["`residual:` without a reason", "residual:"],
    ["`residual:` followed by spaces only", "residual:   "],
    ["an empty cell", ""],
  ])("%s: unmapped", (_label, cell) => {
    expect(parseEvidenceCell(cell).kind).toBe("invalid");
    const outcome = evaluate(ledgerOf(threatRows({ 1: cell })));
    expect(outcome.threats.unmapped).toBe(1);
    expect(outcome.threats.mitigated).toBe(0);
    expect(outcome.exitCode).toBe(1);
  });

  test("an empty cell and a `residual:` without reason say which they are", () => {
    expect(parseEvidenceCell("  ")).toEqual({ kind: "invalid", reason: "the cell is empty" });
    expect(parseEvidenceCell("residual:")).toEqual({
      kind: "invalid",
      reason: "`residual:` carries no reason",
    });
    expect(parseEvidenceCell("residual: held elsewhere")).toEqual({
      kind: "residual",
      reason: "held elsewhere",
    });
  });

  test("a cell lists several pieces of evidence, a comma inside a test name included", () => {
    const cell = parseEvidenceCell("`a.ts`, `b.test.ts` :: `refused, by token`");
    expect(cell).toEqual({
      kind: "evidence",
      items: [
        { text: "a.ts", target: { kind: "local", path: "a.ts" }, test: null },
        {
          text: "b.test.ts",
          target: { kind: "local", path: "b.test.ts" },
          test: "refused, by token",
        },
      ],
    });
    expect(parseEvidenceCell(PINNED)).toEqual({
      kind: "evidence",
      items: [
        {
          text: `acme/widgets@${SHA}:src/guard.ts`,
          target: {
            kind: "pinned",
            owner: "acme",
            repository: "widgets",
            sha: SHA,
            path: "src/guard.ts",
          },
          test: null,
        },
      ],
    });
  });

  test("a threat of the model without a ledger row: unmapped, exit 1", () => {
    const outcome = evaluate(ledgerOf(threatRows().slice(0, 2)));
    expect(outcome.threats).toMatchObject({ total: 3, residual: 2, unmapped: 1, orphans: 0 });
    expect(outcome.exitCode).toBe(1);
  });

  test("a ledger row whose text is not a threat of the surface of its id: orphan, exit 1", () => {
    const reworded = evaluate(
      ledgerOf([...threatRows(), `| T-S1-03 | a threat nobody wrote | ${RESIDUAL} |`]),
    );
    expect(reworded.threats).toMatchObject({ total: 3, unmapped: 0, orphans: 1 });
    expect(reworded.exitCode).toBe(1);
    // "third threat" is a threat of surface 2: under an id of surface 1 it joins nothing.
    const misplaced = evaluate(
      ledgerOf([...threatRows().slice(0, 2), `| T-S1-03 | third threat | ${RESIDUAL} |`]),
    );
    expect(misplaced.threats).toMatchObject({ total: 3, unmapped: 1, orphans: 1 });
    expect(misplaced.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------- malformed ---

describe("malformed input: exit 4, nothing judged", () => {
  function expectMalformed(outcome: EvidenceOutcome, fragment: string): void {
    expect(outcome.exitCode).toBe(4);
    expect(outcome.defects.join("\n")).toContain(fragment);
    expect(outcome.threats.total).toBe(0);
    expect(outcome.lines.join("\n")).not.toContain("threats=");
  }

  test.each([
    ["two cells", "| T-S1-01 | first threat |"],
    ["four cells", `| T-S1-01 | first threat | ${RESIDUAL} | extra |`],
  ])("a threat row with %s", (_label, row) => {
    expectMalformed(evaluate(ledgerOf([row, ...threatRows().slice(1)])), "3 columns");
  });

  test("a risk row with four cells", () => {
    const row = `| AR-01 | a risk | ${RESIDUAL} | detection or judgment |`;
    expectMalformed(evaluate(ledgerOf(threatRows(), [row])), "5 columns");
  });

  test("a ledger without a table, and a table without a row", () => {
    expectMalformed(evaluate("# Ledger\n\nNo table here.\n"), '"## Threat evidence"');
    expectMalformed(evaluate("# Ledger\n\nNo table here.\n"), '"## Agentic risks"');
    expectMalformed(evaluate(ledgerOf([])), 'the "## Threat evidence" table has no row');
    expectMalformed(
      evaluate(ledgerOf(threatRows(), [])),
      'the "## Agentic risks" table has no row',
    );
  });

  test("an id used twice, in one table or across the two", () => {
    const twice = [...threatRows(), `| T-S1-01 | another text | ${RESIDUAL} |`];
    expectMalformed(evaluate(ledgerOf(twice)), "T-S1-01 is used twice");
    expectMalformed(
      evaluate(ledgerOf(threatRows(), [RISK_RESIDUAL, RISK_RESIDUAL])),
      "AR-01 is used twice",
    );
  });

  test("an id outside its form, or naming a surface the model does not have", () => {
    expectMalformed(
      evaluate(ledgerOf([...threatRows(), `| T-S3-01 | a threat | ${RESIDUAL} |`])),
      "T-S3-01 names surface 3, the model has 2",
    );
    for (const id of ["T-1-01", "T-S0-01", "T-S1-1", "AR-01"]) {
      expectMalformed(
        evaluate(ledgerOf([...threatRows(), `| ${id} | a threat | ${RESIDUAL} |`])),
        "is not T-S<k>-<nn>",
      );
    }
    const risk = `| AR-1 | a risk | ${RESIDUAL} | ${RESIDUAL} | detection or judgment |`;
    expectMalformed(evaluate(ledgerOf(threatRows(), [risk])), "is not AR-<nn>");
  });

  test("a Criterion outside the two values, an empty Threat, Risk or Criterion", () => {
    const withCriterion = (criterion: string) =>
      ledgerOf(threatRows(), [`| AR-01 | a risk | ${RESIDUAL} | ${RESIDUAL} | ${criterion} |`]);
    expectMalformed(evaluate(withCriterion("refusal")), 'Criterion "refusal"');
    expectMalformed(evaluate(withCriterion("")), 'Criterion ""');
    expectMalformed(
      evaluate(ledgerOf([`| T-S1-01 |  | ${RESIDUAL} |`, ...threatRows().slice(1)])),
      "empty Threat cell",
    );
    const noRisk = `| AR-01 |  | ${RESIDUAL} | ${RESIDUAL} | detection or judgment |`;
    expectMalformed(evaluate(ledgerOf(threatRows(), [noRisk])), "empty Risk cell");
  });

  test("a defect names the line of the ledger it sits on", () => {
    const ledger = ledgerOf(["| T-S1-01 | first threat |", ...threatRows().slice(1)]);
    // "# Ledger", "", heading, "", header, separator: the first row is line 7.
    expect(parseLedger(ledger).defects).toEqual([
      'line 7: 2 cell(s), the "## Threat evidence" table has 3 columns',
    ]);
  });

  test("a model without the section, without a threat row, or with a threat written twice", () => {
    const ledger = ledgerOf(threatRows());
    expectMalformed(evaluate(ledger, "# Model\n\n### Alpha\n"), "STRIDE + LINDDUN per surface");
    expectMalformed(
      evaluate(
        ledger,
        ["## STRIDE + LINDDUN per surface", "", "### Alpha", ...TABLE_HEAD].join("\n"),
      ),
      "holds no threat row",
    );
    const twice = MODEL.replace("| second threat |", "| first threat |");
    expectMalformed(evaluate(ledger, twice), 'lists "first threat" twice under "Alpha"');
  });

  test("the model is read by surface, in order, and stops at the next section", () => {
    expect(parseModelThreats(MODEL)).toEqual({
      surfaces: [
        { rank: 1, title: "Alpha", threats: ["first threat", "second threat"] },
        { rank: 2, title: "Beta", threats: ["third threat"] },
      ],
      defects: [],
    });
  });
});

// -------------------------------------------------------------------- risks ---

describe("agentic risks", () => {
  const FILE = "`src/guard.ts`";
  const NAMED = "`src/guard.test.ts` :: `refuses the write`";
  function risk(barrier: string, detection: string, criterion: string): EvidenceOutcome {
    return evaluate(
      ledgerOf(threatRows(), [`| AR-01 | a risk | ${barrier} | ${detection} | ${criterion} |`]),
    );
  }

  test("an empty Barrier: red, exit 1", () => {
    const outcome = risk("", RESIDUAL, "detection or judgment");
    expect(outcome.risks).toEqual({ total: 1, barred: 0, residual: 0, red: 1 });
    expect(outcome.exitCode).toBe(1);
  });

  test("a Barrier `residual:` with a reason: residual, not red", () => {
    const outcome = risk(RESIDUAL, FILE, "detection or judgment");
    expect(outcome.risks).toEqual({ total: 1, barred: 0, residual: 1, red: 0 });
    expect(outcome.exitCode).toBe(0);
  });

  test("a barrier and a detection that exist: barred", () => {
    const outcome = risk(FILE, NAMED, "detection or judgment");
    expect(outcome.risks).toEqual({ total: 1, barred: 1, residual: 0, red: 0 });
    expect(outcome.evidence).toMatchObject({ cited: 2, found: 2 });
    expect(outcome.exitCode).toBe(0);
  });

  test("a barrier whose target ends in .md is refused: red", () => {
    const outcome = risk("`docs/INVENTORY.md`", RESIDUAL, "detection or judgment");
    expect(outcome.risks).toMatchObject({ barred: 0, red: 1 });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.lines.join("\n")).toContain("an inventory, not a barrier");
    // The same document is accepted as a detection.
    expect(risk(FILE, "`docs/INVENTORY.md`", "detection or judgment").risks.barred).toBe(1);
  });

  test("`refusal before execution` backed by files only: red; by a named test found: barred", () => {
    const filesOnly = risk(FILE, RESIDUAL, "refusal before execution");
    expect(filesOnly.risks).toMatchObject({ barred: 0, red: 1 });
    expect(filesOnly.exitCode).toBe(1);
    // The named test must be a barrier: one in the Detection cell does not make a refusal.
    expect(risk(FILE, NAMED, "refusal before execution").risks.red).toBe(1);
    const named = risk(`${FILE}, ${NAMED}`, RESIDUAL, "refusal before execution");
    expect(named.risks).toMatchObject({ barred: 1, red: 0 });
    expect(named.exitCode).toBe(0);
  });

  test("a missing detection, or a Detection outside the grammar: red", () => {
    expect(risk(FILE, "`src/absent.ts`", "detection or judgment").risks.red).toBe(1);
    expect(risk(FILE, "", "detection or judgment").risks.red).toBe(1);
  });

  test("a risk red only through an unavailable barrier: exit 3", () => {
    const outcome = risk(PINNED, RESIDUAL, "detection or judgment");
    expect(outcome.risks.red).toBe(1);
    expect(outcome.exitCode).toBe(3);
  });
});

// -------------------------------------------------------------- named tests ---

describe("findNamedTest, TypeScript", () => {
  const found = (source: string) => findNamedTest(source, "ts", "refuses the write");

  test("a call of test( or it( is found, whatever its quotes", () => {
    expect(found('test("refuses the write", () => {});')).toBe(true);
    expect(found("  it('refuses the write', () => {});")).toBe(true);
    expect(found("test(\n  `refuses the write`,\n  () => {},\n);")).toBe(true);
    expect(found('describe("x", () => {\n  test("refuses the write", () => {});\n});')).toBe(true);
  });

  test("a call present only in a line or block comment is not found", () => {
    expect(found('// test("refuses the write", () => {});')).toBe(false);
    expect(found('const x = 1; // test("refuses the write", () => {});')).toBe(false);
    expect(found('/*\n test("refuses the write", () => {});\n*/')).toBe(false);
    expect(found('/** it("refuses the write") */ test("another", () => {});')).toBe(false);
  });

  test.each([
    "skip",
    "todo",
    "skipIf(true)",
    "if(false)",
    "failing",
    "each([1])",
    "only",
  ])("the same name under test.%s is not found", (modifier) => {
    expect(found(`test.${modifier}("refuses the write", () => {});`)).toBe(false);
    expect(found(`it.${modifier}("refuses the write", () => {});`)).toBe(false);
  });

  test("a call written inside a string, a method named test and another name are not found", () => {
    expect(found(`const fixture = 'test("refuses the write", () => {});';`)).toBe(false);
    expect(found('pattern.test("refuses the write");')).toBe(false);
    expect(found('const pattern = /test("refuses the write"/;')).toBe(false);
    expect(found('contest("refuses the write");')).toBe(false);
    expect(found('test("refuses the write, twice", () => {});')).toBe(false);
  });

  test("a comment marker inside a string or a regular expression hides nothing", () => {
    expect(
      found('const url = "https://example.test/*";\ntest("refuses the write", () => {});'),
    ).toBe(true);
    expect(found('const quote = /["\']/;\ntest("refuses the write", () => {});')).toBe(true);
    expect(found('const ratio = total / 2; // "\ntest("refuses the write", () => {});')).toBe(true);
  });
});

describe("findNamedTest, Rust", () => {
  const found = (source: string) => findNamedTest(source, "rs", "refuses_the_write");

  test("a function under #[test] is found", () => {
    expect(found("#[test]\nfn refuses_the_write() {}")).toBe(true);
    expect(found('#[test]\n#[should_panic(expected = "no")]\npub fn refuses_the_write() {}')).toBe(
      true,
    );
  });

  test("a function under #[test] and #[ignore] is not found, in either order", () => {
    expect(found("#[test]\n#[ignore]\nfn refuses_the_write() {}")).toBe(false);
    expect(found('#[ignore = "slow"]\n#[test]\nfn refuses_the_write() {}')).toBe(false);
  });

  test("a function without attribute, or under another function's #[test], is not found", () => {
    expect(found("fn refuses_the_write() {}")).toBe(false);
    expect(found("#[test]\nfn another() {}\n\nfn refuses_the_write() {}")).toBe(false);
    expect(found("#[test]\nfn refuses_the_write_twice() {}")).toBe(false);
  });

  test("a commented-out function, or one written in a string, is not found", () => {
    expect(found("// #[test]\n// fn refuses_the_write() {}")).toBe(false);
    expect(found("/* #[test]\nfn refuses_the_write() {} */")).toBe(false);
    expect(found('const S: &str = "#[test]\nfn refuses_the_write() {}";')).toBe(false);
    expect(found("#[test]\n// #[ignore]\nfn refuses_the_write() {}")).toBe(true);
  });
});

// ------------------------------------------------------------------ effects ---

describe("loadResolver, on repositories created by the test", () => {
  let base = "";
  let root = "";
  let sibling = "";
  let commit = "";
  const ABSENT_COMMIT = "1".repeat(40);

  function git(directory: string, ...args: string[]): string {
    return execFileSync("git", [...HARDENING_FLAGS, "-C", directory, ...args], {
      encoding: "utf8",
      env: hardenedGitEnvironment(directory, "file"),
    }).trim();
  }

  function write(directory: string, path: string, text: string): void {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  }

  function initialise(directory: string): void {
    mkdirSync(directory, { recursive: true });
    git(directory, "init", "-q");
    git(directory, "config", "user.name", "t");
    git(directory, "config", "user.email", "t@t");
  }

  const pinned = (repository: string, sha: string, path: string): EvidenceTarget => ({
    kind: "pinned",
    owner: "acme",
    repository,
    sha,
    path,
  });
  const cited = (target: EvidenceTarget): string =>
    target.kind === "local"
      ? target.path
      : `${target.owner}/${target.repository}@${target.sha}:${target.path}`;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "threat-evidence-test-"));
    root = join(base, "root");
    sibling = join(base, "widgets");

    initialise(sibling);
    write(sibling, "src/guard.ts", "export const guard = 1;\n");
    write(sibling, "src/empty.ts", "");
    symlinkSync("guard.ts", join(sibling, "src/link.ts"));
    git(sibling, "add", "src/guard.ts", "src/empty.ts", "src/link.ts");
    git(sibling, "commit", "-q", "-m", "guard");
    commit = git(sibling, "rev-parse", "HEAD");

    initialise(root);
    write(root, "kept.ts", "export const kept = 1;\n");
    write(root, "empty.ts", "");
    write(root, "now-link.ts", "export const swapped = 1;\n");
    symlinkSync("kept.ts", join(root, "link.ts"));
    symlinkSync("kept.ts", join(root, "was-link.ts"));
    git(root, "add", "kept.ts", "empty.ts", "now-link.ts", "link.ts", "was-link.ts");
    git(root, "commit", "-q", "-m", "tracked");
    write(root, "loose.ts", "export const loose = 1;\n");
    // The index and the working tree disagree, each way: neither reading alone sees both.
    rmSync(join(root, "was-link.ts"));
    write(root, "was-link.ts", "export const regular = 1;\n");
    rmSync(join(root, "now-link.ts"));
    symlinkSync("kept.ts", join(root, "now-link.ts"));

    const targets = [
      "kept.ts",
      "empty.ts",
      "link.ts",
      "was-link.ts",
      "now-link.ts",
      "loose.ts",
      "absent.ts",
      cited(pinned("widgets", commit, "src/guard.ts")),
      cited(pinned("widgets", commit, "src/absent.ts")),
      cited(pinned("widgets", commit, "src/empty.ts")),
      cited(pinned("widgets", commit, "src/link.ts")),
      cited(pinned("widgets", commit, "src")),
      cited(pinned("widgets", ABSENT_COMMIT, "src/guard.ts")),
      cited(pinned("gadgets", commit, "src/guard.ts")),
    ];
    const rows = targets.map(
      (target, index) =>
        `| T-S1-${String(index + 1).padStart(2, "0")} | threat ${index} | \`${target}\` |`,
    );
    write(root, LEDGER_PATH, ledgerOf(rows));
  });

  afterAll(() => {
    if (base !== "") rmSync(base, { recursive: true, force: true });
  });

  const load = () => loadResolver(root, new Map([["acme/widgets", sibling]]));

  test("a tracked regular file is found, with its text", async () => {
    const resolveTarget = await load();
    expect(resolveTarget({ kind: "local", path: "kept.ts" })).toEqual({
      state: "found",
      text: "export const kept = 1;\n",
    });
  });

  test.each([
    ["a tracked symbolic link", "link.ts", "a link is never followed"],
    ["a link in the index, a regular file on disk", "was-link.ts", "a link is never followed"],
    ["a regular file in the index, a link on disk", "now-link.ts", "not a regular file in the"],
    ["a file present but untracked", "loose.ts", "not a file tracked by git"],
    ["an absent file", "absent.ts", "not a file tracked by git"],
    ["a tracked empty file", "empty.ts", "the file is empty"],
  ])("%s is missing", async (_label, path, reason) => {
    const resolved = (await load())({ kind: "local", path });
    expect(resolved.state).toBe("missing");
    expect(resolved).toMatchObject({ reason: expect.stringContaining(reason) });
  });

  test("a pinned file present at its commit in the supplied clone is found", async () => {
    const resolveTarget = await load();
    expect(resolveTarget(pinned("widgets", commit, "src/guard.ts"))).toEqual({
      state: "found",
      text: "export const guard = 1;\n",
    });
    // GitHub answers a repository in any case: the supplied name is matched folded.
    expect(resolveTarget(pinned("Widgets", commit, "src/guard.ts")).state).toBe("found");
  });

  test("a commit absent from the supplied clone is unavailable; a repository not supplied too", async () => {
    const resolveTarget = await load();
    expect(resolveTarget(pinned("widgets", ABSENT_COMMIT, "src/guard.ts")).state).toBe(
      "unavailable",
    );
    expect(resolveTarget(pinned("gadgets", commit, "src/guard.ts")).state).toBe("unavailable");
  });

  test.each([
    ["absent", "src/absent.ts", "does not exist"],
    ["a directory", "src", "not a regular file"],
    ["a symbolic link", "src/link.ts", "not a regular file"],
    ["an empty file", "src/empty.ts", "the file is empty"],
  ])("a commit present whose path is %s is missing", async (_label, path, reason) => {
    const resolved = (await load())(pinned("widgets", commit, path));
    expect(resolved.state).toBe("missing");
    expect(resolved).toMatchObject({ reason: expect.stringContaining(reason) });
  });

  test("a target the ledger does not cite was never read: unreadable, never found", async () => {
    const resolveTarget = await load();
    expect(resolveTarget({ kind: "local", path: "docs/other.ts" }).state).toBe("unreadable");
  });

  test("the command exits 2 when the model or the ledger cannot be read", () => {
    // The fixture root holds a ledger and no model.
    const run = Bun.spawnSync([process.execPath, TOOL], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toContain(`${MODEL_PATH} cannot be read`);
  });
});

describe("the command line", () => {
  test.each([
    "widgets",
    "acme/widgets",
    "=directory",
    "acme/widgets=",
    "--model=x",
  ])("an argument that is not <owner>/<repository>=<directory> exits 2: %s", (argument) => {
    const run = Bun.spawnSync([process.execPath, TOOL, argument], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toContain("usage:");
  });
});

// -------------------------------------------------------------- real corpus ---

describe("the real corpus", () => {
  const read = (path: string) => Bun.file(join(ROOT, path)).text();

  test("no defect of form, no orphan, no missing or unreadable evidence, and the sums hold", async () => {
    const outcome = evaluateEvidence({
      model: await read(MODEL_PATH),
      ledger: await read(LEDGER_PATH),
      resolve: await loadResolver(ROOT, new Map()),
    });
    expectSums(outcome);
    expect(outcome.defects).toEqual([]);
    expect(outcome.threats.total).toBeGreaterThan(0);
    expect(outcome.threats.orphans).toBe(0);
    expect(outcome.evidence.missing).toBe(0);
    expect(outcome.evidence.unreadable).toBe(0);
    expect([0, 3]).toContain(outcome.exitCode);
  });

  test("the risk table carries AR-01 to AR-10, each once", async () => {
    const ledger = parseLedger(await read(LEDGER_PATH));
    expect(ledger.risks.map((row) => row.id)).toEqual([
      "AR-01",
      "AR-02",
      "AR-03",
      "AR-04",
      "AR-05",
      "AR-06",
      "AR-07",
      "AR-08",
      "AR-09",
      "AR-10",
    ]);
  });

  test("the ledger holds no token the two citation gates read", async () => {
    const ledger = await read(LEDGER_PATH);
    expect(findCitations(ledger)).toEqual([]);
    const config = validatePinnedConfig(await Bun.file(join(ROOT, PINNED_CONFIG_PATH)).json());
    const scanned = scanText(ledger, config.organization, []);
    expect(scanned.rejected).toEqual([]);
    expect(scanned.candidates).toEqual([]);
  });

  test("the script exists and the `check` chain does not name it", async () => {
    const manifest = (await Bun.file(join(ROOT, "package.json")).json()) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["check:threat-model-evidence"]).toBe(
      "bun run check:bun:runtime && bun tools/quality/check-threat-model-evidence.ts",
    );
    expect(manifest.scripts.check).not.toContain("threat-model-evidence");
    expect(manifest.scripts.check).toContain("check:threat-model-citations");
  });
});
