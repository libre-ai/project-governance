import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  CONFIG_PATH,
  type CoverageConfig,
  type CoverageEntry,
  evaluateCoverage,
  isGatePath,
  loadCoverageInput,
  threatRowsOf,
  validateCoverageConfig,
} from "./check-threat-model-coverage";

const DOC = "docs/security/THREAT-MODEL.md";
const MODEL = [
  "# Model",
  "| ID  | Risk |",
  "| --- | ---- |",
  "| R1  | a risk |",
  "| R7  | a collusion risk |",
  "| U1  | a gap |",
].join("\n");
const TRACKED = ["tools/quality/check-a.ts", "tools/quality/check-b.sh"];

function entry(path: string, covers: readonly string[] = [], because = "a reason"): CoverageEntry {
  return { path, covers, because };
}

/** Runs the gate over injected inputs: no git, no filesystem. */
function judge(
  gates: readonly CoverageEntry[],
  tracked: readonly string[] = TRACKED,
  text: string | null = MODEL,
) {
  const config: CoverageConfig = { threatModel: DOC, gateGlob: "tools/quality/check-*", gates };
  return evaluateCoverage({ threatModel: { path: DOC, text }, tracked, config });
}

describe("threatRowsOf", () => {
  test("reads the R and U identifiers of the tables, in order, and nothing else", () => {
    expect(threatRowsOf(MODEL)).toEqual(["R1", "R7", "U1"]);
    expect(threatRowsOf("| X1 | no |\nR9 without a bar\n| r2 | lower case |")).toEqual([]);
  });
});

describe("isGatePath", () => {
  test("a tracked check-* script of .ts or .sh, not a test, is a gate", () => {
    const glob = "tools/quality/check-*";
    expect(isGatePath("tools/quality/check-a.ts", glob)).toBe(true);
    expect(isGatePath("tools/quality/check-a.sh", glob)).toBe(true);
    expect(isGatePath("tools/quality/check-a.test.ts", glob)).toBe(false);
    expect(isGatePath("tools/quality/check-a.md", glob)).toBe(false);
    expect(isGatePath("tools/quality/gate-report.ts", glob)).toBe(false);
    expect(isGatePath("tools/other/check-a.ts", glob)).toBe(false);
  });
});

describe("evaluateCoverage", () => {
  test("a complete ledger passes, and its counters are printed", () => {
    const { report, volume, summary } = judge([
      entry("tools/quality/check-a.ts", ["R7"], "guards the collusion case"),
      entry("tools/quality/check-b.sh", [], "no threat row: checks the tree"),
    ]);
    expect(report.outcome).toBe("pass");
    expect(report.violations).toEqual([]);
    expect(volume).toMatchObject({
      tracked: 2,
      listed: 2,
      unlisted: 0,
      entries: 2,
      orphans: 0,
      threatRows: 3,
      covered: 1,
      uncovered: 2,
      uncoveredIds: ["R1", "U1"],
    });
    expect(summary).toBe(
      "2 gate(s) tracked = 2 listed + 0 unlisted; 2 entr(ies) declared = 1 covering a row + 1 covering none, 0 orphan; " +
        "3 threat row(s) = 1 covered + 2 uncovered; uncovered (information, not a failure): R1, U1",
    );
  });

  test("a tracked gate without an entry turns the gate red", () => {
    const { report, volume } = judge([entry("tools/quality/check-a.ts", ["R1"], "x")]);
    expect(report.outcome).toBe("violations");
    expect(report.violations).toEqual([
      "tools/quality/check-b.sh: tracked gate has no entry in tools/quality/threat-model-coverage.v1.json — add one, with covers (possibly []) and because",
    ]);
    expect(volume).toMatchObject({ tracked: 2, listed: 1, unlisted: 1 });
  });

  test("an entry whose file is not a tracked gate turns the gate red", () => {
    const { report, volume } = judge([
      entry("tools/quality/check-a.ts", [], "x"),
      entry("tools/quality/check-b.sh", [], "x"),
      entry("tools/quality/check-gone.ts", [], "x"),
    ]);
    expect(report.violations).toEqual([
      "tools/quality/check-gone.ts: no tracked gate at this path (the file is missing, or gateGlob does not match it)",
    ]);
    expect(volume).toMatchObject({ entries: 3, orphans: 1, listed: 2, unlisted: 0 });
  });

  test("an identifier that is not a row of the threat model turns the gate red", () => {
    const { report, volume } = judge([
      entry("tools/quality/check-a.ts", ["R99"], "x"),
      entry("tools/quality/check-b.sh", [], "x"),
    ]);
    expect(report.violations).toEqual([
      "tools/quality/check-a.ts: R99 is not a R<n> or U<n> row of the threat model",
    ]);
    expect(volume).toMatchObject({ threatRows: 3, covered: 0, uncovered: 3 });
  });

  test("a threat model that cannot be read turns the gate red, never a zero", () => {
    const { report, volume } = judge(
      [entry("tools/quality/check-a.ts", ["R1"], "x")],
      TRACKED,
      null,
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations).toContain(
      `${DOC}: the threat model could not be read — a missing model is not zero threat rows`,
    );
    expect(report.violations).toContain(
      "tools/quality/check-a.ts: R1 is not a R<n> or U<n> row of the threat model",
    );
    expect(volume).toMatchObject({ tracked: 2, threatRows: 0, covered: 0, uncovered: 0 });
  });

  test("an empty because turns the gate red", () => {
    const { report } = judge([
      entry("tools/quality/check-a.ts", [], "   "),
      entry("tools/quality/check-b.sh", [], "x"),
    ]);
    expect(report.violations).toEqual(["tools/quality/check-a.ts: because is empty"]);
  });

  test("a second entry for the same gate turns the gate red", () => {
    const { report, volume } = judge([
      entry("tools/quality/check-a.ts", [], "x"),
      entry("tools/quality/check-a.ts", [], "y"),
      entry("tools/quality/check-b.sh", [], "x"),
    ]);
    expect(report.violations).toEqual(["tools/quality/check-a.ts: duplicate entry for this gate"]);
    expect(volume).toMatchObject({ listed: 2, unlisted: 0 });
  });

  test("the counters sum on a mixed ledger: gates and threat rows", () => {
    const { volume } = judge(
      [
        entry("tools/quality/check-a.ts", ["R7", "U1"], "x"),
        entry("tools/quality/check-gone.ts", [], "x"),
      ],
      [...TRACKED, "tools/quality/check-c.ts"],
    );
    expect(volume.listed + volume.unlisted).toBe(volume.tracked);
    expect(volume.covered + volume.uncovered).toBe(volume.threatRows);
    expect(volume).toMatchObject({ tracked: 3, listed: 1, unlisted: 2, orphans: 1 });
    expect(volume).toMatchObject({ threatRows: 3, covered: 2, uncoveredIds: ["R1"] });
  });
});

describe("validateCoverageConfig", () => {
  const valid = {
    threatModel: DOC,
    gateGlob: "tools/quality/check-*",
    gates: [{ path: "tools/quality/check-a.ts", covers: [], because: "x" }],
  };

  test("accepts a ledger of the declared shape", () => {
    expect(validateCoverageConfig(valid).gates).toHaveLength(1);
  });

  test("refuses a ledger without a gates list, or an entry without covers", () => {
    expect(() => validateCoverageConfig({ ...valid, gates: undefined })).toThrow("expected");
    expect(() =>
      validateCoverageConfig({
        ...valid,
        gates: [{ path: "tools/quality/check-a.ts", because: "x" }],
      }),
    ).toThrow("covers");
  });
});

describe("the real corpus", () => {
  test("every tracked gate has one entry, and every covers names a threat row", async () => {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    const config = validateCoverageConfig(await Bun.file(join(root, CONFIG_PATH)).json());
    const tracked = execSync("git ls-files", { encoding: "utf8", cwd: root })
      .split("\n")
      .filter(Boolean);
    const { report, volume } = evaluateCoverage(await loadCoverageInput(root, config, tracked));
    expect(report.violations).toEqual([]);
    expect(volume.tracked).toBeGreaterThan(0);
    expect(volume.orphans).toBe(0);
    expect(volume.listed + volume.unlisted).toBe(volume.tracked);
    expect(volume.covered + volume.uncovered).toBe(volume.threatRows);
  });
});
