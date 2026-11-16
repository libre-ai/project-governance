import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { parseInvariants } from "../../ecosystem/briques";
import {
  type AdmittedMention,
  CONFIG_PATH,
  evaluateCitations,
  findCitations,
  loadCitationsInput,
  standingOf,
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
  test("reads every I-xx token with its line and its place on the line", () => {
    expect(findCitations("a\n| x | I-09, I-18 |\nsee I-17 gate")).toEqual([
      { id: "I-09", line: 2, text: "| x | I-09, I-18 |", start: 6 },
      { id: "I-18", line: 2, text: "| x | I-09, I-18 |", start: 12 },
      { id: "I-17", line: 3, text: "see I-17 gate", start: 4 },
    ]);
  });

  test("does not read identifiers that merely contain I-xx", () => {
    expect(findCitations("AI-01 WP-I-02 xI-03 placeholder I-xx")).toEqual([]);
  });
});

describe("standingOf", () => {
  test("a row that exists and is live, a struck-through row, an absent row", () => {
    const parsed = parseRegister(REGISTER);
    expect(standingOf("I-09", parsed)).toBe("live");
    expect(standingOf("I-30", parsed)).toBe("retired");
    expect(standingOf("I-99", parsed)).toBe("unknown");
  });

  test("duplicate register ids are reported", () => {
    expect(parseRegister(`${REGISTER}\n| I-09 | doublon | x | y |`).duplicates).toEqual(["I-09"]);
  });
});

const DOC = "docs/security/THREAT-MODEL.md";
// The real row of the register, as written on 2026-11-09 (D103).
const I35 = "| I-35 | **Retiré le 2026-11-09 (D103, amende ADR-0049).** Motif | ADR | 2026-11-09 |";

/** Runs the gate over one document, with I-35 retired and the given admitted mentions. */
function judge(
  text: string,
  admitted: readonly Omit<AdmittedMention, "because" | "file">[] = [],
  extraRows: readonly string[] = [],
) {
  return evaluateCitations({
    register: { path: register.path, text: [REGISTER, I35, ...extraRows].join("\n") },
    declared: [{ path: DOC, text }],
    undeclared: [],
    admitted: admitted.map((entry) => ({ ...entry, file: DOC, because: "test" })),
  });
}

describe("evaluateCitations", () => {
  test("an inexistent citation (I-99) turns the gate red", () => {
    const { report, volume } = evaluateCitations({
      register,
      declared: [{ path: DOC, text: "| t | I-09 |\n| u | I-99 |" }],
      undeclared: [],
      admitted: [],
    });
    expect(report.outcome).toBe("violations");
    expect(report.violations).toEqual([
      "docs/security/THREAT-MODEL.md:2 I-99: I-99 is not a row of the invariants register",
    ]);
    expect(volume).toMatchObject({ citations: 2, resolved: 1, unknown: 1, failed: 1 });
  });

  test("a declared file that is missing turns the gate red, never a zero", () => {
    const { report, volume } = evaluateCitations({
      register,
      declared: [{ path: "docs/security/MISSING.md", text: null }],
      undeclared: [],
      admitted: [],
    });
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toContain("docs/security/MISSING.md");
    expect(volume.declaredUnreadable).toBe(1);
  });

  test("an unreadable register turns the gate red", () => {
    const { report } = evaluateCitations({
      register: { path: "docs/decisions/INVARIANTS.md", text: null },
      declared: [{ path: DOC, text: "I-09" }],
      undeclared: [],
      admitted: [],
    });
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("register could not be read");
  });

  test("an undeclared file under the scope that cites an invariant turns the gate red", () => {
    const { report, volume } = evaluateCitations({
      register,
      declared: [{ path: DOC, text: "I-09" }],
      undeclared: [
        { path: "docs/security/NEW.md", text: "covered by I-18" },
        { path: "docs/security/QUIET.md", text: "no citation here" },
      ],
      admitted: [],
    });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("docs/security/NEW.md");
    expect(volume).toMatchObject({ undeclaredScanned: 2, undeclaredCiting: 1 });
  });
});

describe("mentions of a retired invariant", () => {
  test("a citation of a row retired in words fails as retired", () => {
    const { report, volume } = judge("| t | I-09, I-35 |");
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith(
      "docs/security/THREAT-MODEL.md:1 I-35: I-35 is retired in the invariants register",
    );
    expect(volume).toMatchObject({
      registerRetired: 2,
      resolved: 1,
      retiredMentions: 1,
      retiredAdmitted: 0,
      retiredRefused: 1,
      failed: 1,
    });
  });

  // Review finding 1: no wording excuses a mention. Each of these lines carried
  // a withdrawal word and passed when the gate guessed at the sentence.
  test("no wording of the line admits a mention that is not declared", () => {
    for (const line of [
      "| x | I-35 (retired tokens are refused) |",
      "A retired key is never accepted; the quorum of I-35 carries the collusion case.",
      "I-35 was never withdrawn and carries the collusion case.",
      "I-17 (I-35 withdrawn by D103)",
      "I-35, retiré par D103",
    ]) {
      const { volume } = judge(line);
      expect(volume).toMatchObject({ retiredMentions: 1, retiredAdmitted: 0, retiredRefused: 1 });
    }
  });

  // Review finding 5: a notice is admitted in whatever words it is written,
  // because it is declared and not recognised.
  test("a declared mention is admitted, whatever its wording", () => {
    for (const [text, anchor] of [
      ["The collusion case was carried by I-35 until D103\nwithdrew it", "carried by I-35 until"],
      ["since the withdrawal of I-35 (D103)", "withdrawal of I-35 (D103)"],
      ["depuis le retrait de I-35", "retrait de I-35"],
      ["I-35 is no longer in force", "I-35 is no longer in force"],
      ["I-35, retiré par D103".normalize("NFD"), "I-35, retiré par D103"],
      ["I-35, retiré par D103", "I-35, retiré par D103".normalize("NFD")],
    ] as const) {
      const { report, volume } = judge(text, [{ id: "I-35", anchor }]);
      expect(report.violations).toEqual([]);
      expect(volume).toMatchObject({ retiredMentions: 1, retiredAdmitted: 1, retiredRefused: 0 });
    }
  });

  // Review finding 2: an entry is bound to its identifier, even when its
  // anchor spans another retired invariant.
  test("an entry for one retired invariant never admits another on the same line", () => {
    const { report, volume } = judge(
      "| x | I-35, I-09 (I-36 withdrawn, D104) |",
      [{ id: "I-36", anchor: "I-35, I-09 (I-36 withdrawn, D104)" }],
      ["| I-36 | Retiré le 2026-11-10 (D104) | ADR | 2026-11-10 |"],
    );
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith("docs/security/THREAT-MODEL.md:1 I-35: ");
    expect(volume).toMatchObject({
      citations: 3,
      resolved: 1,
      retiredMentions: 2,
      retiredAdmitted: 1,
      retiredRefused: 1,
    });
  });

  test("an entry admits the occurrence its anchor holds, not its neighbour on the line", () => {
    const { report, volume } = judge(
      "| collusion | I-09, I-35 (a quorum) | I-09 (I-35 withdrawn, D103) |",
      [{ id: "I-35", anchor: "I-35 withdrawn, D103" }],
    );
    expect(report.violations).toHaveLength(1);
    expect(volume).toMatchObject({
      citations: 4,
      resolved: 2,
      retiredMentions: 2,
      retiredAdmitted: 1,
      retiredRefused: 1,
      failed: 1,
    });
  });

  // Review finding 6: a vertical bar is a character of the line like another.
  test("a vertical bar in code, in prose or escaped changes nothing", () => {
    const code = "I-35 was withdrawn by D103; the probe is `git ls-files | grep I-35`.";
    expect(
      judge(code, [
        { id: "I-35", anchor: "I-35 was withdrawn by D103" },
        { id: "I-35", anchor: "`git ls-files | grep I-35`" },
      ]).volume,
    ).toMatchObject({ retiredMentions: 2, retiredAdmitted: 2, retiredRefused: 0 });
    expect(
      judge(code, [{ id: "I-35", anchor: "I-35 was withdrawn by D103" }]).volume,
    ).toMatchObject({ retiredMentions: 2, retiredAdmitted: 1, retiredRefused: 1 });
    expect(
      judge("| x | I-09 (withdrawn: I-35 \\| D103) then I-35 |", [
        { id: "I-35", anchor: "withdrawn: I-35 \\| D103" },
      ]).volume,
    ).toMatchObject({ retiredMentions: 2, retiredAdmitted: 1, retiredRefused: 1 });
  });

  test("an entry that matches nothing fails, and names what it looked for", () => {
    const { report, volume } = judge("| t | I-09 |", [{ id: "I-35", anchor: "I-35 withdrawn" }]);
    expect(report.violations).toEqual([
      'docs/security/THREAT-MODEL.md admitted mention I-35 "I-35 withdrawn": no line of the file holds this anchor around a mention of I-35 — the entry admits nothing, remove it or re-anchor it',
    ]);
    expect(volume).toMatchObject({ admittedEntries: 1, admittedEntriesStale: 1 });
  });

  test("an entry whose anchor holds on two lines fails, and admits neither", () => {
    const { report, volume } = judge("I-35 withdrawn\n\nagain: I-35 withdrawn", [
      { id: "I-35", anchor: "I-35 withdrawn" },
    ]);
    expect(report.violations).toHaveLength(3);
    expect(report.violations.join("\n")).toContain("holds on 2 lines (1, 3)");
    expect(volume).toMatchObject({
      retiredMentions: 2,
      retiredAdmitted: 0,
      retiredRefused: 2,
      admittedEntriesStale: 1,
    });
  });

  test("an entry for an invariant that is in force, or absent, fails", () => {
    const live = judge("I-09 withdrawn", [{ id: "I-09", anchor: "I-09 withdrawn" }]);
    expect(live.report.violations).toHaveLength(1);
    expect(live.report.violations[0]).toContain("I-09 is not a retired row");
    expect(live.volume).toMatchObject({ resolved: 1, retiredMentions: 0, admittedEntriesStale: 1 });
    const absent = judge("x", [{ id: "I-77", anchor: "I-77 withdrawn" }]);
    expect(absent.report.violations[0]).toContain("I-77 is not a retired row");
  });

  test("an entry for a file that could not be read fails with it, never admitted unseen", () => {
    const { report } = evaluateCitations({
      register: { path: register.path, text: `${REGISTER}\n${I35}` },
      declared: [{ path: DOC, text: null }],
      undeclared: [],
      admitted: [{ file: DOC, id: "I-35", anchor: "I-35 withdrawn", because: "test" }],
    });
    expect(report.violations).toHaveLength(2);
  });

  test("the counters sum: mentions of retired rows = admitted + refused", () => {
    const { volume } = judge(
      "I-09 and I-18\nI-35 withdrawn by D103\nI-35 as a carrier\nI-99\nI-30",
      [{ id: "I-35", anchor: "I-35 withdrawn by D103" }],
    );
    expect(volume).toMatchObject({
      citations: 6,
      resolved: 2,
      retiredMentions: 3,
      retiredAdmitted: 1,
      retiredRefused: 2,
      unknown: 1,
      failed: 3,
    });
    expect(volume.retiredAdmitted + volume.retiredRefused).toBe(volume.retiredMentions);
    expect(volume.resolved + volume.retiredMentions + volume.unknown).toBe(volume.citations);
  });

  test("the success line prints the mentions of retired rows and their split", () => {
    const { report } = judge("I-09\nI-35 withdrawn by D103", [
      { id: "I-35", anchor: "I-35 withdrawn by D103" },
    ]);
    expect(report.violations).toEqual([]);
    expect(report.volumeSummary).toContain(
      "1 mention(s) of a retired row = 1 admitted + 0 refused",
    );
    expect(report.volumeSummary).toContain("1 admitted-mention entr(ies) declared, 0 stale");
  });
});

const BASE_CONFIG = {
  register: "docs/decisions/INVARIANTS.md",
  scope: "docs/security/",
  files: [{ path: DOC, because: "x" }],
};

describe("validateConfig", () => {
  test("refuses a declared file outside the scope", () => {
    expect(() =>
      validateConfig({ ...BASE_CONFIG, files: [{ path: "docs/adr/0001.md", because: "x" }] }),
    ).toThrow("outside");
  });

  test("refuses an empty file list", () => {
    expect(() => validateConfig({ register: "r", scope: "docs/security/", files: [] })).toThrow();
  });

  test("a configuration without admitted mentions is refused: an empty list is written", () => {
    expect(() => validateConfig(BASE_CONFIG)).toThrow("retiredMentions");
    expect(validateConfig({ ...BASE_CONFIG, retiredMentions: [] }).retiredMentions).toEqual([]);
  });

  test("an admitted mention needs a declared file, an id, an anchor naming the id, a reason", () => {
    const entry = { file: DOC, id: "I-35", anchor: "I-35 withdrawn by D103", because: "notice" };
    const withEntry = (patch: object) => ({
      ...BASE_CONFIG,
      retiredMentions: [{ ...entry, ...patch }],
    });
    expect(validateConfig(withEntry({})).retiredMentions).toEqual([entry]);
    expect(() => validateConfig(withEntry({ file: "docs/security/OTHER.md" }))).toThrow(
      "not a declared file",
    );
    expect(() => validateConfig(withEntry({ id: "35" }))).toThrow("I-NN");
    expect(() => validateConfig(withEntry({ anchor: "withdrawn by D103" }))).toThrow(
      "does not name I-35",
    );
    expect(() => validateConfig(withEntry({ anchor: "AI-35 withdrawn" }))).toThrow(
      "does not name I-35",
    );
    expect(() => validateConfig(withEntry({ anchor: "I-35\nwithdrawn" }))).toThrow("one line");
    expect(() => validateConfig(withEntry({ because: " " }))).toThrow("because");
    expect(() =>
      validateConfig({ ...BASE_CONFIG, retiredMentions: [entry, { ...entry, because: "twice" }] }),
    ).toThrow("duplicate");
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
    expect(volume.retiredAdmitted).toBe(volume.retiredMentions);
    expect(volume.resolved + volume.retiredMentions).toBe(volume.citations);
    expect(volume.admittedEntries).toBe(config.retiredMentions.length);
    expect(volume.admittedEntriesStale).toBe(0);
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
  // Read retired before the two readers were merged, and to stay so: the
  // accent dropped, and the accent written as a combining mark (NFD).
  "**Retire le 2026-11-09 (D103)**",
  "RETIRE (D104)",
  "Retiré le 2026-11-10".normalize("NFD"),
  "**RETIRÉE** (D104)".normalize("NFD"),
  // The word the gate's own messages use for a retirement.
  "**Withdrawn on 2026-11-10 (D104).**",
  "withdrawn (D104)",
];
// Rows that merely speak of retirement, and stay in force.
const LIVE_FORMS = [
  "Un invariant retiré ailleurs ne retire pas celui-ci",
  "Retirer une installation live n'est jamais autorisé par une revue",
  "Retirement of a name is final",
  "Withdrawnness is not a word",
  // The accent as a combining mark must not end the word: without the NFC
  // comparison the mark, which is no letter, reads as the end of « Retire ».
  "Retiréification n'est pas un mot".normalize("NFD"),
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
  return ["retire", "retiree", "retires", "retirees", "retired", "withdrawn"].includes(word);
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

  test("the reader and the route written without it agree on every form", () => {
    for (const cell of [...RETIRED_FORMS, ...LIVE_FORMS]) {
      if (cell.startsWith("~~")) continue; // a strike is not a word
      const parsed = parseRegister(`| I-01 | ${cell} | ADR | 2026-11-09 |`);
      expect([cell, parsed.entries.get("I-01")?.retired]).toEqual([
        cell,
        announcesRetirement(cell),
      ]);
    }
  });

  // A row is `| I-NN | cell |`: two or three digits, as the brick schema writes
  // an invariant (`^I-[0-9]{2,3}$`), and a cell that is closed. Anything else is
  // not a row for either gate, so a citation of it fails as unknown.
  test("what is a row of the register, and what is not", () => {
    const parsed = parseRegister(
      [
        "| I-08 | deux chiffres |",
        "| I-100 | trois chiffres |",
        "| I-7 | un chiffre |",
        "| I-1000 | quatre chiffres |",
        "| I-40 | no closing pipe",
        "  | I-41 | indented |",
      ].join("\n"),
    );
    expect([...parsed.entries.keys()]).toEqual(["I-08", "I-100"]);
    expect([
      ...parseInvariants("| I-7 | x |\n| I-1000 | x |\n| I-40 | no closing pipe\n| I-08 | x |"),
    ]).toEqual([["I-08", "en vigueur"]]);
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
    // A register read to zero rows would make both lists empty and equal. The
    // row count is taken by another route than the reader's expression, so a
    // row the reader does not take for one (one digit, an unclosed cell) is red
    // here instead of silently absent.
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
