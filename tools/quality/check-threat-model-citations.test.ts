import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { parseInvariants } from "../../ecosystem/briques";
import {
  CONFIG_PATH,
  evaluateCitations,
  findCitations,
  loadCitationsInput,
  resolveCitation,
  validateConfig,
} from "./check-threat-model-citations";
import { parseInvariantsRegister as parseRegister } from "./invariants-register";

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
      { id: "I-09", line: 2, cell: " I-09, I-18 " },
      { id: "I-18", line: 2, cell: " I-09, I-18 " },
      { id: "I-17", line: 3, cell: "see I-17 gate" },
    ]);
  });

  test("a citation carries its own table cell, not its neighbours'", () => {
    expect(findCitations("| I-09 | I-35 withdrawn |").map((citation) => citation.cell)).toEqual([
      " I-09 ",
      " I-35 withdrawn ",
    ]);
  });

  test("does not read identifiers that merely contain I-xx", () => {
    expect(findCitations("AI-01 WP-I-02 xI-03 placeholder I-xx")).toEqual([]);
  });
});

/** A citation as it stands alone in a cell that says nothing else. */
function bare(id: string): { id: string; line: number; cell: string } {
  return { id, line: 1, cell: ` ${id} ` };
}

describe("parseRegister and resolveCitation", () => {
  test("a cited row that exists and is live resolves", () => {
    expect(resolveCitation(bare("I-09"), parseRegister(REGISTER)).ok).toBe(true);
  });

  test("a citation absent from the register fails", () => {
    const resolution = resolveCitation(bare("I-99"), parseRegister(REGISTER));
    expect(resolution.ok).toBe(false);
    expect(resolution.note).toContain("not a row");
  });

  test("a citation of a struck-through row fails as retired", () => {
    const resolution = resolveCitation(bare("I-30"), parseRegister(REGISTER));
    expect(resolution.ok).toBe(false);
    expect(resolution.note).toContain("retired");
  });

  test("a mention of a retired row is a withdrawal notice when its cell says so", () => {
    for (const cell of [
      "I-17 (I-30 withdrawn, D103)",
      "I-30 carried the case until D103 withdrew it",
      "I-30, retired by D103",
      "I-30, retiré par D103",
      "I-30, RETIRÉE (D103)",
    ]) {
      const resolution = resolveCitation({ id: "I-30", line: 1, cell }, parseRegister(REGISTER));
      expect(resolution).toMatchObject({ ok: true, withdrawalNotice: true });
    }
  });

  test("a cell that only resembles a withdrawal does not excuse the citation", () => {
    for (const cell of [
      "I-30 (an old rule)",
      "I-30 — retirer une installation",
      "I-30, on retirement of a name",
      "I-30 unretired",
    ]) {
      const resolution = resolveCitation({ id: "I-30", line: 1, cell }, parseRegister(REGISTER));
      expect(resolution.ok).toBe(false);
    }
  });

  test("a withdrawal word never turns a live row into a notice", () => {
    const resolution = resolveCitation(
      { id: "I-09", line: 1, cell: "I-09 (I-30 withdrawn)" },
      parseRegister(REGISTER),
    );
    expect(resolution).toMatchObject({ ok: true, withdrawalNotice: false });
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
    expect(volume.failed).toBe(0);
    expect(volume.resolved + volume.withdrawalNotices).toBe(volume.citations);
  });
});

// The forms a retirement takes. The first is the row of the real register, as
// written on 2026-11-09 (D103): bold, accented, followed by a space.
const RETIRED_FORMS = [
  "**Retiré le 2026-11-09 (D103, amende ADR-0049).** Motif : garde-fou muet",
  "Retiré le 2026-11-10",
  "_Retiré_ le 2026-11-10",
  "**RETIRÉ** (D104)",
  "Retirée le 2026-11-10",
  "**Retired on 2026-11-10.**",
  "~~Ancienne règle~~",
  "~~Ancien texte~~ RETIRÉ",
];
// Rows that merely speak of retirement, and stay in force.
const LIVE_FORMS = [
  "Un invariant retiré ailleurs ne retire pas celui-ci",
  "Retirer une installation live n'est jamais autorisé par une revue",
  "Retirement of a name is final",
  "Aucun travail sans preuve",
];

/**
 * Whether a register cell announces a retirement, read WITHOUT a regular
 * expression over accented text: emphasis marks dropped, accents folded, then a
 * plain prefix. Deliberately another route than the reader under test — the
 * defect this guards was a `\b` after an accented letter, which no test written
 * with the same expression could see.
 */
function announcesRetirement(cell: string): boolean {
  const folded = cell
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^[\s*_~]+/, "")
    .toLowerCase();
  const word = /^[a-z]*/.exec(folded)?.[0] ?? "";
  return ["retire", "retiree", "retires", "retirees", "retired"].includes(word);
}

describe("retirement, as the register writes it", () => {
  test("every form of a retired row is read retired, and a live row stays live", () => {
    const rows = [...RETIRED_FORMS, ...LIVE_FORMS].map(
      (cell, index) => `| I-${String(index + 1).padStart(2, "0")} | ${cell} | ADR | 2026-11-09 |`,
    );
    const parsed = parseRegister(rows.join("\n"));
    const retired = [...parsed.entries.values()].filter((entry) => entry.retired);
    expect(retired.map((entry) => entry.id)).toEqual(
      RETIRED_FORMS.map((_, index) => `I-${String(index + 1).padStart(2, "0")}`),
    );
    expect(parsed.entries.size).toBe(rows.length);
  });

  test("a citation of a row retired in words fails as retired", () => {
    const { report, volume } = evaluateCitations({
      register: {
        path: "docs/decisions/INVARIANTS.md",
        text: `${REGISTER}\n| I-35 | ${RETIRED_FORMS[0]} | ADR | 2026-11-09 |`,
      },
      declared: [{ path: "docs/security/THREAT-MODEL.md", text: "| t | I-09, I-35 |" }],
      undeclared: [],
    });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith(
      "docs/security/THREAT-MODEL.md:1 I-35: I-35 is retired in the invariants register",
    );
    expect(volume).toMatchObject({ registerRetired: 2, resolved: 1, failed: 1 });
  });

  test("a table row that cites a retired invariant as a carrier is red even when another cell is a notice", () => {
    const { report, volume } = evaluateCitations({
      register: {
        path: "docs/decisions/INVARIANTS.md",
        text: `${REGISTER}\n| I-35 | ${RETIRED_FORMS[0]} | ADR | 2026-11-09 |`,
      },
      declared: [
        {
          path: "docs/security/THREAT-MODEL.md",
          text: "| collusion | I-09, I-35 (a quorum) | I-09 (I-35 withdrawn, D103) |",
        },
      ],
      undeclared: [],
    });
    expect(report.violations).toHaveLength(1);
    expect(volume).toMatchObject({
      citations: 4,
      resolved: 2,
      withdrawalNotices: 1,
      failed: 1,
    });
    expect(volume.resolved + volume.withdrawalNotices + volume.failed).toBe(volume.citations);
  });
});

describe("the real register", () => {
  async function realRegister(): Promise<string> {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    const config = validateConfig(await Bun.file(join(root, CONFIG_PATH)).json());
    return await Bun.file(join(root, config.register)).text();
  }

  test("every row that announces its retirement is read retired", async () => {
    const text = await realRegister();
    const announced: string[] = [];
    let rows = 0;
    for (const line of text.split("\n")) {
      const cells = line.split("|");
      const id = (cells[1] ?? "").trim();
      if (!/^I-\d+$/.test(id)) continue;
      rows += 1;
      if (announcesRetirement(cells[2] ?? "")) announced.push(id);
    }
    const parsed = parseRegister(text);
    const retired = [...parsed.entries.values()]
      .filter((entry) => entry.retired)
      .map((entry) => entry.id);
    // A register read to zero rows would make both lists empty and equal.
    expect(rows).toBeGreaterThan(0);
    expect(parsed.entries.size).toBe(rows);
    expect(announced.filter((id) => !retired.includes(id))).toEqual([]);
  });

  test("the citations gate and the brick map read the same rows, with the same standing", async () => {
    const text = await realRegister();
    const gate = [...parseRegister(text).entries.values()].map(
      (entry) => [entry.id, entry.retired ? "retiré" : "en vigueur"] as const,
    );
    expect(gate.length).toBeGreaterThan(0);
    expect(gate).toEqual([...parseInvariants(text)]);
  });
});
