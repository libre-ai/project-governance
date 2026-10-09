import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  CONFIG_PATH,
  evaluateCitations,
  findCitations,
  loadCitationsInput,
  parseRegister,
  resolveCitation,
  validateConfig,
} from "./check-threat-model-citations";

// A register with two live rows and one struck-through row, enough to exercise
// every resolution outcome without depending on the real register's content.
const REGISTER = [
  "| #    | Invariant | Source | Date |",
  "| ---- | --------- | ------ | ---- |",
  "| I-09 | Identité/authz | ADR | 2026-07-16 |",
  "| I-18 | Noyau de sécurité des boucles | ADR | 2026-07-19 |",
  "| I-30 | ~~Ancienne règle~~ | ADR | 2026-07-19 |",
].join("\n");

const register = { path: "docs/decisions/INVARIANTS.md", text: REGISTER };

describe("findCitations", () => {
  test("reads every I-xx token with its line, including several per line", () => {
    expect(findCitations("a\n| x | I-09, I-18 |\nsee I-17 gate")).toEqual([
      { id: "I-09", line: 2 },
      { id: "I-18", line: 2 },
      { id: "I-17", line: 3 },
    ]);
  });

  test("does not read identifiers that merely contain I-xx", () => {
    expect(findCitations("AI-01 WP-I-02 xI-03 placeholder I-xx")).toEqual([]);
  });
});

describe("parseRegister and resolveCitation", () => {
  test("a cited row that exists and is live resolves", () => {
    expect(resolveCitation("I-09", parseRegister(REGISTER)).ok).toBe(true);
  });

  test("a citation absent from the register fails", () => {
    const resolution = resolveCitation("I-99", parseRegister(REGISTER));
    expect(resolution.ok).toBe(false);
    expect(resolution.note).toContain("not a row");
  });

  test("a citation of a struck-through row fails as retired", () => {
    const resolution = resolveCitation("I-30", parseRegister(REGISTER));
    expect(resolution.ok).toBe(false);
    expect(resolution.note).toContain("retired");
  });

  test("duplicate register ids are reported", () => {
    expect(parseRegister(`${REGISTER}\n| I-09 | doublon | x | y |`).duplicates).toEqual(["I-09"]);
  });
});

describe("evaluateCitations", () => {
  test("an inexistent citation (I-99) turns the gate red", () => {
    const { report, volume } = evaluateCitations({
      register,
      declared: [{ path: "docs/security/THREAT-MODEL.md", text: "| t | I-09 |\n| u | I-99 |" }],
      undeclared: [],
    });
    expect(report.outcome).toBe("violations");
    expect(report.violations).toEqual([
      "docs/security/THREAT-MODEL.md:2 I-99: I-99 is not a row of the invariants register",
    ]);
    expect(volume).toMatchObject({ citations: 2, resolved: 1, failed: 1 });
  });

  test("a declared file that is missing turns the gate red, never a zero", () => {
    const { report, volume } = evaluateCitations({
      register,
      declared: [{ path: "docs/security/MISSING.md", text: null }],
      undeclared: [],
    });
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toContain("docs/security/MISSING.md");
    expect(volume.declaredUnreadable).toBe(1);
  });

  test("an unreadable register turns the gate red", () => {
    const { report } = evaluateCitations({
      register: { path: "docs/decisions/INVARIANTS.md", text: null },
      declared: [{ path: "docs/security/THREAT-MODEL.md", text: "I-09" }],
      undeclared: [],
    });
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("register could not be read");
  });

  test("an undeclared file under the scope that cites an invariant turns the gate red", () => {
    const { report, volume } = evaluateCitations({
      register,
      declared: [{ path: "docs/security/THREAT-MODEL.md", text: "I-09" }],
      undeclared: [
        { path: "docs/security/NEW.md", text: "covered by I-18" },
        { path: "docs/security/QUIET.md", text: "no citation here" },
      ],
    });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("docs/security/NEW.md");
    expect(volume).toMatchObject({ undeclaredScanned: 2, undeclaredCiting: 1 });
  });
});

describe("validateConfig", () => {
  test("refuses a declared file outside the scope", () => {
    expect(() =>
      validateConfig({
        register: "docs/decisions/INVARIANTS.md",
        scope: "docs/security/",
        files: [{ path: "docs/adr/0001.md", because: "x" }],
      }),
    ).toThrow("outside");
  });

  test("refuses an empty file list", () => {
    expect(() => validateConfig({ register: "r", scope: "docs/security/", files: [] })).toThrow();
  });
});

describe("the real corpus", () => {
  test("every declared file is read and every citation resolves against the real register", async () => {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    const config = validateConfig(await Bun.file(join(root, CONFIG_PATH)).json());
    const tracked = execSync(`git ls-files -- ${config.scope}`, { encoding: "utf8", cwd: root })
      .split("\n")
      .filter(Boolean);
    const { report, volume } = evaluateCitations(await loadCitationsInput(root, config, tracked));
    expect(report.violations).toEqual([]);
    expect(volume.declaredRead).toBe(config.files.length);
    expect(volume.citations).toBeGreaterThan(0);
    expect(volume.resolved).toBe(volume.citations);
  });
});
