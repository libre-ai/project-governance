import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIONS,
  classifyEvidence,
  EMPTY_REGISTER_NOTE,
  type EvidenceExemption,
  EXEMPTIONS_PATH,
  evaluateRefusals,
  evaluateRefusalsFiles,
  ORIGINS,
  REGISTER_PATH,
  SCHEMA_VERSION,
  scanBlockLayout,
  validateExemptions,
} from "./check-refusals";

// Shape gate of `ecosystem/refusals.v1.yaml` (ADR-0056 D4). Every rule below
// has a red case built from a register that is green without the defect, so a
// red verdict can only come from the rule under test.

const ROOT = join(import.meta.dir, "..", "..");

type Fields = Record<string, string | undefined>;

/** A well-formed entry, in the block style the register is written in. */
const VALID: Fields = {
  id: "refusal.example-install",
  subject: ">-\n      Example, a tool installed on a workstation.",
  source: "https://github.com/example/tool",
  revision: "example/tool@0123456789abcdef0123456789abcdef01234567",
  action: "install",
  origin: "inspection",
  decided_on: "2026-10-22",
  reason: ">-\n      A finding the evidence establishes.",
  evidence:
    "\n      - example/tool@0123456:src/a.ts:12-14" +
    "\n      - https://example.org/report (consultée le 2026-10-23)",
  reexamine_when: "null",
};

/** One entry as YAML lines; `undefined` drops a key, a value starting with `\n` is a block. */
function entry(overrides: Fields = {}): string {
  const fields = Object.entries({ ...VALID, ...overrides }).filter(
    (pair): pair is [string, string] => pair[1] !== undefined,
  );
  return fields
    .map(([key, value], index) => {
      const lead = index === 0 ? "  - " : "    ";
      return value.startsWith("\n") ? `${lead}${key}:${value}` : `${lead}${key}: ${value}`;
    })
    .join("\n");
}

function register(entries: readonly string[], head = `schema_version: ${SCHEMA_VERSION}`): string {
  return [head, "# a comment line is never a key", "", "refusals:", ...entries, ""].join("\n");
}

/** A fixed clock: the gate reads the clock at its entry point only. */
const NOW = new Date("2026-10-23T12:00:00Z");

function judge(text: string, exemptions: readonly EvidenceExemption[] = []) {
  return evaluateRefusals(text, exemptions, NOW);
}

/** The violations of a register holding one entry built from `overrides`. */
function violationsOf(overrides: Fields): string[] {
  return judge(register([entry(overrides)])).violations;
}

describe("the register of the repository", () => {
  test("passes, and its volume matches an independent count of entries and evidence", async () => {
    // The real clock, as the entry point reads it: the register must hold today.
    const report = await evaluateRefusalsFiles(
      join(ROOT, REGISTER_PATH),
      join(ROOT, EXEMPTIONS_PATH),
      new Date(),
    );
    expect(report.violations).toEqual([]);
    expect(report.outcome).toBe("pass");
    const text = await Bun.file(join(ROOT, REGISTER_PATH)).text();
    const entries = text.split("\n").filter((line) => /^ {2}- id: refusal\./.test(line)).length;
    const evidence = text.split("\n").filter((line) => /^ {6}- /.test(line)).length;
    expect(entries).toBeGreaterThan(0);
    expect(report.volumeSummary).toContain(
      `${entries} entrée(s) examinée(s) = ${entries} conforme(s) + 0 en défaut ; ${evidence} preuve(s)`,
    );
  });

  test("is checked by `bun run check`", async () => {
    const manifest = (await Bun.file(join(ROOT, "package.json")).json()) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts.check?.split(" && ")).toContain("bun run check:refusals");
    expect(manifest.scripts["check:refusals"]).toContain("bun tools/quality/check-refusals.ts");
  });
});

describe("a well-formed register", () => {
  test("passes with one assertion per entry plus the schema version", () => {
    const report = judge(register([entry(), entry({ id: "refusal.other-install" })]));
    expect(report.violations).toEqual([]);
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(3);
    expect(report.volumeSummary).toBe(
      "2 entrée(s) examinée(s) = 2 conforme(s) + 0 en défaut ; 4 preuve(s) = 2 citation(s) " +
        "épinglée(s) + 2 URL datée(s) + 0 exemptée(s) + 0 hors forme",
    );
  });

  test("`revision` may be null or absent", () => {
    expect(violationsOf({ revision: "null" })).toEqual([]);
    expect(violationsOf({ revision: undefined })).toEqual([]);
  });

  test("`reexamine_when` may be a string", () => {
    expect(violationsOf({ reexamine_when: ">-\n      A dated failure." })).toEqual([]);
  });

  test("every action of the closed vocabulary is accepted", () => {
    expect(ACTIONS).toEqual(["install", "depend", "reuse-code", "use-service"]);
    for (const action of ACTIONS) expect(violationsOf({ action })).toEqual([]);
  });

  test("every origin of the closed vocabulary is accepted", () => {
    expect(ORIGINS).toEqual(["observed", "inspection", "synthetic", "proposal"]);
    for (const origin of ORIGINS) expect(violationsOf({ origin })).toEqual([]);
  });
});

describe("root", () => {
  test("a wrong schema_version fails", () => {
    const report = judge(register([entry()], "schema_version: libre-ai.refusals.v2"));
    expect(report.violations).toEqual([
      `${REGISTER_PATH}: schema_version doit valoir exactement ${SCHEMA_VERSION}`,
    ]);
  });

  test("a missing schema_version fails", () => {
    expect(judge(register([entry()], "")).violations).toEqual([
      `${REGISTER_PATH}: schema_version doit valoir exactement ${SCHEMA_VERSION}`,
    ]);
  });

  test("an unknown root key fails", () => {
    const head = `schema_version: ${SCHEMA_VERSION}\nowner: someone`;
    expect(judge(register([entry()], head)).violations).toEqual([
      `${REGISTER_PATH}: clé(s) racine inconnue(s) : owner`,
    ]);
  });

  test("a root key written twice fails, though the parser keeps the last silently", () => {
    const head = `schema_version: libre-ai.refusals.v0\nschema_version: ${SCHEMA_VERSION}`;
    expect(judge(register([entry()], head)).violations).toEqual([
      `${REGISTER_PATH}: clé(s) racine écrite(s) deux fois : schema_version`,
    ]);
  });

  test("a root that is not a mapping fails", () => {
    expect(judge("- a\n- b\n").violations).toEqual([
      `${REGISTER_PATH}: la racine du registre n'est pas une table`,
    ]);
  });

  test("`refusals` that is not a list fails", () => {
    // `refusals:` with nothing under it parses to null. A value on the same
    // line (`refusals: none`) is refused earlier, as a root outside the block style.
    expect(judge(`schema_version: ${SCHEMA_VERSION}\nrefusals:\n`).violations).toEqual([
      `${REGISTER_PATH}: \`refusals\` doit être une liste`,
    ]);
  });

  test("an empty register fails: it was seeded, so empty means emptied", () => {
    expect(judge(`schema_version: ${SCHEMA_VERSION}\nrefusals: []\n`).violations).toEqual([
      `${REGISTER_PATH}: ${EMPTY_REGISTER_NOTE}`,
    ]);
  });

  test("text that does not parse fails", () => {
    const [violation] = judge(`schema_version: ${SCHEMA_VERSION}\nrefusals: [\n`).violations;
    expect(violation).toStartWith(`${REGISTER_PATH}: YAML illisible : `);
  });

  test("a character the parser and a line scan read differently fails before parsing", () => {
    const text = register([entry({ subject: "Example\u0000 hidden" })]);
    expect(judge(text).violations).toEqual([
      `${REGISTER_PATH}: caractère U+0000 ligne 6 : le parseur YAML et une lecture par ligne n'y lisent pas le même document`,
    ]);
  });
});

describe("entry keys", () => {
  test("an entry that is not a mapping fails", () => {
    const violations = judge(register(["  - just a string"])).violations;
    expect(violations).toContain("refusals[0]: une entrée est une table");
  });

  test("an unknown key fails", () => {
    expect(violationsOf({ decided_by: "owner" })).toEqual([
      "refusal.example-install: clé(s) inconnue(s) : decided_by",
    ]);
  });

  test("each required field, when absent, fails under its own name", () => {
    const required = [
      "id",
      "subject",
      "source",
      "action",
      "origin",
      "decided_on",
      "reason",
      "evidence",
      "reexamine_when",
    ];
    for (const key of required) {
      const name = key === "id" ? "refusals[0]" : "refusal.example-install";
      expect(violationsOf({ [key]: undefined })).toContain(
        `${name}: champ(s) requis absent(s) : ${key}`,
      );
    }
  });

  test("a key written twice fails, though the parser keeps the last silently", () => {
    const text = register([`${entry()}\n    reason: A second motive.`]);
    expect(judge(text).violations).toEqual([
      "refusal.example-install: clé(s) écrite(s) deux fois, le parseur ne garde que la dernière : reason",
    ]);
  });

  const unread = (lines: string) =>
    `${REGISTER_PATH}: ligne(s) ${lines} hors du style bloc que ce gate relit (clé nue en colonne 0 ou 4, entrée ouverte par \`  - <clé>:\`, contenu imbriqué à cinq espaces ou plus) : une clé écrite deux fois sous une autre forme y échapperait à la lecture par ligne`;

  // Each of these writes `reason` a second time in a form a bare-key scan
  // would not see; the parser keeps the last value without a word.
  test.each([
    ["quoted", "    'reason': A second motive."],
    ["double-quoted with an escape", '    "re\\u0061son": A second motive.'],
    ["explicit", "    ? reason\n    : A second motive."],
  ])("a key written twice in %s form is refused rather than half read", (_label, line) => {
    const text = register([`${entry()}\n${line}`]);
    expect(Bun.YAML.parse(text)).toMatchObject({ refusals: [{ reason: "A second motive." }] });
    expect(judge(text).violations).toContain(unread(line.includes("\n") ? "19, 20" : "19"));
  });

  test("an entry written as a flow mapping is refused rather than half read", () => {
    const flow = "  - {id: refusal.flow-install, subject: x}";
    expect(judge(register([entry(), flow])).violations).toContain(unread("19"));
  });

  test("a root key written twice in explicit form is refused rather than half read", () => {
    const text = `${register([entry()])}? schema_version\n: ${SCHEMA_VERSION}\n`;
    expect(Bun.YAML.parse(text)).toMatchObject({ schema_version: SCHEMA_VERSION });
    expect(judge(text).violations).toEqual([unread("19, 20")]);
  });

  test("content in column 4 that is not a key is refused", () => {
    const text = register([entry({ evidence: "\n    - o/r@0123456:src/a.ts:1" })]);
    expect(Bun.YAML.parse(text)).toMatchObject({
      refusals: [{ evidence: ["o/r@0123456:src/a.ts:1"] }],
    });
    expect(judge(text).violations).toEqual([unread("16")]);
  });
});

describe("entry fields", () => {
  const ID_FORM =
    "`id` doit s'écrire `refusal.<mot>[-<mot>…]`, mots en minuscules ASCII et chiffres (^refusal\\.[a-z0-9]+(-[a-z0-9]+)*$)";

  // An id that fails its form never names the entry in the report: the entry
  // is named by its index, so an empty or multi-line id cannot blank or split
  // the report line (re-review of #142, N1).
  test("an id without the `refusal.` prefix fails, under the entry's index", () => {
    expect(violationsOf({ id: "archify-install" })).toEqual([`refusals[0]: ${ID_FORM}`]);
  });

  test("an id that is only the prefix fails, under the entry's index", () => {
    expect(violationsOf({ id: "refusal." })).toEqual([`refusals[0]: ${ID_FORM}`]);
  });

  test("an empty id fails under the entry's index, not under an empty name", () => {
    expect(violationsOf({ id: '""' })).toEqual([`refusals[0]: ${ID_FORM}`]);
  });

  test("an id carrying a line break fails under the entry's index, on one report line", () => {
    const violations = violationsOf({ id: '"refusal.a\\n"' });
    expect(violations).toEqual([`refusals[0]: ${ID_FORM}`]);
    expect(violations.every((violation) => !violation.includes("\n"))).toBe(true);
  });

  test("a duplicate id fails", () => {
    expect(judge(register([entry(), entry()])).violations).toEqual([
      "refusal.example-install: `id` en double : refusal.example-install",
    ]);
  });

  test("an empty subject fails", () => {
    expect(violationsOf({ subject: '""' })).toEqual([
      "refusal.example-install: `subject` doit être une chaîne non vide",
    ]);
  });

  test("a source that is http, or not a URL, fails", () => {
    for (const source of ["http://github.com/example/tool", "github.com/example/tool"]) {
      expect(violationsOf({ source })).toEqual([
        "refusal.example-install: `source` doit être une URL https absolue (`https://<hôte>/…`)",
      ]);
    }
  });

  test("a revision that is not <owner>/<repository>@<sha> fails", () => {
    for (const revision of ["example/tool", "example/tool@main", "tool@0123456", '""']) {
      expect(violationsOf({ revision })).toEqual([
        "refusal.example-install: `revision` doit être absent, null ou `<propriétaire>/<dépôt>@<sha>`, sha de 7 à 40 caractères hexadécimaux minuscules",
      ]);
    }
  });

  test("an action outside the vocabulary fails", () => {
    expect(violationsOf({ action: "use" })).toEqual([
      "refusal.example-install: `action` doit valoir l'un de : install, depend, reuse-code, use-service",
    ]);
  });

  test("an origin outside the vocabulary fails", () => {
    expect(violationsOf({ origin: "drill" })).toEqual([
      "refusal.example-install: `origin` doit valoir l'un de : observed, inspection, synthetic, proposal",
    ]);
  });

  test("a decided_on that is not a real ISO 8601 date fails", () => {
    const notIso = ["22/10/2026", "2026-02-30", "2026-1-5", "2026-10-22T10:00:00Z", "20261022"];
    for (const decided of notIso) {
      expect(violationsOf({ decided_on: decided })).toEqual([
        `refusal.example-install: \`decided_on\` '${decided}' n'est pas une date AAAA-MM-JJ réelle comprise entre 2026-01-01 et 2026-10-24`,
      ]);
    }
  });

  test("an empty reason fails", () => {
    expect(violationsOf({ reason: "''" })).toEqual([
      "refusal.example-install: `reason` doit être une chaîne non vide",
    ]);
  });

  test("an empty or scalar evidence fails", () => {
    for (const evidence of ["[]", "https://example.org (consultée le 2026-10-23)"]) {
      expect(violationsOf({ evidence })).toEqual([
        "refusal.example-install: `evidence` doit être une liste non vide",
      ]);
    }
  });

  test("an empty reexamine_when fails; it is a string or null", () => {
    for (const reexamine of ['""', "3"]) {
      expect(violationsOf({ reexamine_when: reexamine })).toEqual([
        "refusal.example-install: `reexamine_when` doit être une chaîne non vide ou null",
      ]);
    }
  });
});

describe("evidence", () => {
  const OUT_OF_FORM =
    "ni citation épinglée `<propriétaire>/<dépôt>@<sha>:<chemin>:<lignes>` (sha de 7 à 40 caractères hexadécimaux minuscules, lignes `N`, `N-M` ou leur liste séparée par des virgules), ni URL https suivie de « (consultée le AAAA-MM-JJ) »";
  const PATH_FORM =
    "attendu un chemin relatif à la racine du dépôt cité, sans segment vide, '.' ni '..'";
  const RANGE = (item: string) =>
    `l'intervalle '${item}' ne désigne aucune ligne : lignes numérotées à partir de 1, début inférieur ou égal à la fin`;

  test("the two admitted forms are recognised", () => {
    expect(classifyEvidence("tt-a1i/archify@25cf370:a/b.mjs:607-612", NOW)).toEqual({
      kind: "pinned",
    });
    expect(classifyEvidence("o/r@0123456:a.ts:1,3-4", NOW)).toEqual({ kind: "pinned" });
    expect(classifyEvidence("https://www.humanlayer.com/ (consultée le 2026-10-23)", NOW)).toEqual({
      kind: "dated-url",
    });
  });

  test.each([
    ["a citation without lines", "o/r@0123456:src/a.ts", OUT_OF_FORM],
    ["a citation of a directory", "o/r@0123456:.github/workflows/", OUT_OF_FORM],
    ["a citation pinned on a branch", "o/r@main:src/a.ts:1", OUT_OF_FORM],
    ["a citation with an upper-case sha", "o/r@ABCDEF0:src/a.ts:1", OUT_OF_FORM],
    ["a URL without its consultation date", "https://example.org/x", OUT_OF_FORM],
    ["a date before the URL", "(consultée le 2026-10-23) https://example.org/x", OUT_OF_FORM],
    ["line 0", "o/r@0123456:src/a.ts:0", RANGE("0")],
    ["a reversed range", "o/r@0123456:src/a.ts:9-3", RANGE("9-3")],
    [
      "a malformed line spec",
      "o/r@0123456:src/a.ts:1-",
      "'1-' n'est pas une spécification de lignes `N`, `N-M` ou leur liste séparée par des virgules",
    ],
    ["an absolute path", "o/r@0123456:/etc/passwd:1", `le chemin est absolu ; ${PATH_FORM}`],
    [
      "a path climbing out",
      "o/r@0123456:src/../x.ts:1",
      `le chemin porte un segment '..' ; ${PATH_FORM}`,
    ],
    ["a '.' segment", "o/r@0123456:./x.ts:1", `le chemin porte un segment '.' ; ${PATH_FORM}`],
    [
      "an empty segment",
      "o/r@0123456:src//x.ts:1",
      `le chemin porte un segment vide ; ${PATH_FORM}`,
    ],
    ["a '..' repository", "o/..@0123456:x.ts:1", "'..' n'est pas un nom de dépôt"],
    [
      "an http URL",
      "http://example.org/x (consultée le 2026-10-23)",
      "'http://example.org/x' n'est pas une URL https absolue (`https://<hôte>/…`)",
    ],
    [
      "an impossible consultation date",
      "https://example.org/x (consultée le 2026-13-01)",
      "la date de consultation '2026-13-01' n'est pas une date AAAA-MM-JJ réelle comprise entre 2026-01-01 et 2026-10-24",
    ],
  ])("%s is out of form", (_label, evidence, reason) => {
    expect(classifyEvidence(evidence, NOW)).toEqual({ kind: "invalid", reason });
    const violations = violationsOf({ evidence: `\n      - ${JSON.stringify(evidence)}` });
    expect(violations).toEqual([
      `refusal.example-install: preuve hors forme '${evidence}' : ${reason}`,
    ]);
  });

  test("a non-string evidence item is out of form", () => {
    expect(violationsOf({ evidence: "\n      - 42" })).toEqual([
      "refusal.example-install: preuve hors forme '42' : une preuve est une chaîne",
    ]);
  });
});

describe("exemptions", () => {
  const DIRECTORY = "o/r@0123456:.github/workflows/";
  const exemption: EvidenceExemption = {
    id: "refusal.example-install",
    evidence: DIRECTORY,
    because: "divergence left to the owner",
  };
  const withDirectory = register([
    entry({ evidence: `\n      - o/r@0123456:src/a.ts:1\n      - ${DIRECTORY}` }),
  ]);

  test("an exemption covers its out-of-form evidence and is printed on the success line", () => {
    const report = judge(withDirectory, [exemption]);
    expect(report.violations).toEqual([]);
    expect(report.volumeSummary).toContain(
      `1 exemptée(s) (refusal.example-install ← ${DIRECTORY}) + 0 hors forme`,
    );
  });

  test("without its exemption, the same evidence fails", () => {
    expect(judge(withDirectory).violations).toHaveLength(1);
  });

  test("an exemption of another entry does not cover the evidence", () => {
    const report = judge(withDirectory, [{ ...exemption, id: "refusal.other" }]);
    expect(report.violations).toContain(
      `refusal.example-install: preuve hors forme '${DIRECTORY}' : ni citation épinglée \`<propriétaire>/<dépôt>@<sha>:<chemin>:<lignes>\` (sha de 7 à 40 caractères hexadécimaux minuscules, lignes \`N\`, \`N-M\` ou leur liste séparée par des virgules), ni URL https suivie de « (consultée le AAAA-MM-JJ) »`,
    );
  });

  test("an unused exemption fails, including one naming a well-formed evidence", () => {
    const wellFormed = { ...exemption, evidence: "example/tool@0123456:src/a.ts:12-14" };
    expect(judge(register([entry()]), [wellFormed]).violations).toEqual([
      `${EXEMPTIONS_PATH}: exemption inutilisée : refusal.example-install ← example/tool@0123456:src/a.ts:12-14 ne couvre aucune preuve hors forme du registre ; la retirer`,
    ]);
  });

  test("the exemption file is validated strictly", () => {
    expect(validateExemptions({ exemptions: [exemption] })).toEqual([exemption]);
    expect(validateExemptions({ exemptions: [] })).toEqual([]);
    expect(() => validateExemptions([])).toThrow("attendu");
    expect(() => validateExemptions({ exemptions: [], note: "x" })).toThrow("clé(s) inconnue(s)");
    expect(() => validateExemptions({ exemptions: ["x"] })).toThrow("une exemption est un objet");
    expect(() => validateExemptions({ exemptions: [{ ...exemption, scope: "all" }] })).toThrow(
      "clé(s) inconnue(s) d'exemption",
    );
    expect(() => validateExemptions({ exemptions: [{ ...exemption, because: " " }] })).toThrow(
      "non vides",
    );
    expect(() => validateExemptions({ exemptions: [exemption, exemption] })).toThrow(
      "exemption en double",
    );
  });
});

describe("files", () => {
  const created: string[] = [];
  afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
  });

  function scratch(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "check-refusals-"));
    created.push(dir);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return dir;
  }

  // The exemption file is read as its own re-emission, so fixtures use that layout.
  const NO_EXEMPTION = '{\n  "exemptions": []\n}\n';

  test("an absent register fails, never reads as empty", async () => {
    const dir = scratch({ "x.json": NO_EXEMPTION });
    const report = await evaluateRefusalsFiles(join(dir, "absent.yaml"), join(dir, "x.json"), NOW);
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toStartWith(
      `${join(dir, "absent.yaml")}: registre absent ou illisible : `,
    );
  });

  test("an absent or malformed exemption file fails", async () => {
    const dir = scratch({
      "r.yaml": register([entry()]),
      "bad.json": "{",
      "compact.json": '{"exemptions": []}',
    });
    for (const name of ["absent.json", "bad.json", "compact.json"]) {
      const report = await evaluateRefusalsFiles(join(dir, "r.yaml"), join(dir, name), NOW);
      expect(report.violations[0]).toStartWith(
        `${join(dir, name)}: fichier d'exemptions absent ou illisible : `,
      );
    }
  });

  test("files that hold read through to the verdict", async () => {
    const dir = scratch({ "r.yaml": register([entry()]), "x.json": NO_EXEMPTION });
    const report = await evaluateRefusalsFiles(join(dir, "r.yaml"), join(dir, "x.json"), NOW);
    expect(report.outcome).toBe("pass");
  });
});

describe("scanBlockLayout", () => {
  test("reads root keys and the keys of each entry of `refusals` only, skipping comments", () => {
    const text = [
      "schema_version: x",
      "# refusals: commented",
      "other:",
      "  - id: not-an-entry",
      "refusals:",
      "  - id: refusal.a",
      "    # reason: commented",
      "    reason: >-",
      "      folded: text is not a key",
      "     five spaces is nested content",
      "    evidence:",
      "      - a",
      "  - id: refusal.b",
      "",
    ].join("\n");
    expect(scanBlockLayout(text)).toEqual({
      rootKeys: ["schema_version", "other", "refusals"],
      entryKeys: [["id", "reason", "evidence"], ["id"]],
      unreadLines: [],
      rootStyleLine: null,
    });
  });

  test("a key or nested content before any entry is unread", () => {
    const text = "refusals:\n    id: x\n      - y\n   three spaces\n";
    expect(scanBlockLayout(text).unreadLines).toEqual([2, 3, 4]);
  });
});

// Findings of the separate-role review of #142 at f23f6e9 (2026-10-23). Each
// case below passed the gate at that head; each is now refused by name.
describe("review findings of 2026-10-23", () => {
  const rootStyle = (line: number) =>
    `${REGISTER_PATH}: racine hors du style bloc en colonne 0 (ligne ${line}) : le registre s'écrit en clés nues \`schema_version:\` et \`refusals:\` en colonne 0, \`refusals:\` sans valeur sur sa ligne et suivi de ses entrées \`  - <clé>:\``;
  const indent = (text: string) =>
    text
      .split("\n")
      .map((line) => (line === "" ? line : ` ${line}`))
      .join("\n");
  const flowRegister = (fields: string) =>
    `schema_version: ${SCHEMA_VERSION}\nrefusals: [{id: refusal.flow-install, subject: s, source: "https://github.com/e/t", action: install, origin: inspection, decided_on: 2026-10-22, ${fields}, reexamine_when: null}]\n`;

  describe("1. the line reading and the parser must agree", () => {
    test("an indented root with `reason` written twice is refused by name", () => {
      const text = indent(register([`${entry()}\n    reason: A second motive.`]));
      expect(Bun.YAML.parse(text)).toMatchObject({ refusals: [{ reason: "A second motive." }] });
      expect(judge(text).violations).toEqual([rootStyle(1)]);
    });

    test("an indented root with `refusals` written twice is refused by name", () => {
      const text = indent(`${register([entry()])}refusals:\n${entry({ id: "refusal.b" })}\n`);
      expect(judge(text).violations).toEqual([rootStyle(1)]);
    });

    test("`refusals` written in flow on one line, with `reason` twice, is refused by name", () => {
      const text = flowRegister('reason: VISIBLE, reason: x, evidence: ["e/t@0123456:a.ts:1"]');
      expect(Bun.YAML.parse(text)).toMatchObject({ refusals: [{ reason: "x" }] });
      expect(judge(text).violations).toEqual([rootStyle(2)]);
    });

    test("`refusals` in flow with `evidence` twice is refused by name", () => {
      const text = flowRegister(
        "reason: r, evidence: ['private notes'], evidence: ['x/y@0123456:a:1']",
      );
      expect(Bun.YAML.parse(text)).toMatchObject({
        refusals: [{ evidence: ["x/y@0123456:a:1"] }],
      });
      expect(judge(text).violations).toEqual([rootStyle(2)]);
    });

    test("an entry count that differs between the two readings fails by name", () => {
      const flow = "  - {id: refusal.flow-install, subject: x}";
      const violations = judge(register([entry(), flow, entry({ id: "refusal.c" })])).violations;
      expect(violations).toContain(
        `${REGISTER_PATH}: 2 entrée(s) lue(s) ligne à ligne, 3 par le parseur : chaque entrée s'ouvre par \`  - <clé>:\` en colonne 2`,
      );
      // With the counts apart, an index names a different entry in each reading:
      // the keys of refusal.c must not be held against the flow entry.
      expect(violations.filter((violation) => violation.includes("clés lues"))).toEqual([]);
    });

    test("a root written in flow in column 0 is refused by name", () => {
      const text = `{schema_version: ${SCHEMA_VERSION}, refusals: [{id: refusal.a, reason: x, reason: y}]}\n`;
      expect(Bun.YAML.parse(text)).toMatchObject({ refusals: [{ reason: "y" }] });
      expect(judge(text).violations).toEqual([rootStyle(1)]);
    });

    test("entry keys that differ between the two readings fail by name", () => {
      const text = register([`${entry()}\n    'extra': y`]);
      expect(judge(text).violations).toContain(
        "refusal.example-install: clés lues ligne à ligne (action, decided_on, evidence, id, origin, reason, reexamine_when, revision, source, subject) et par le parseur (action, decided_on, evidence, extra, id, origin, reason, reexamine_when, revision, source, subject) différentes",
      );
    });

    test("root keys that differ between the two readings fail by name", () => {
      const text = `${register([entry()])}? extra\n: y\n`;
      expect(judge(text).violations).toContain(
        `${REGISTER_PATH}: clés racine lues ligne à ligne (refusals, schema_version) et par le parseur (extra, refusals, schema_version) différentes`,
      );
    });
  });

  describe("2. at least one public evidence per entry, one occurrence per exemption", () => {
    const DIRECTORY = "o/r@0123456:.github/workflows/";
    const exemption: EvidenceExemption = {
      id: "refusal.example-install",
      evidence: DIRECTORY,
      because: "divergence left to the owner",
    };

    test("an entry whose every evidence is exempted fails", () => {
      const text = register([entry({ evidence: `\n      - ${DIRECTORY}` })]);
      expect(judge(text, [exemption]).violations).toEqual([
        "refusal.example-install: aucune preuve publique conforme une fois les exemptions retirées : une entrée porte au moins une citation épinglée ou une URL datée (ADR-0056 D4)",
      ]);
    });

    test("one exemption does not cover two identical evidence items", () => {
      const evidence = `\n      - o/r@0123456:src/a.ts:1\n      - ${DIRECTORY}\n      - ${DIRECTORY}`;
      const violations = judge(register([entry({ evidence })]), [exemption]).violations;
      expect(violations).toHaveLength(1);
      expect(violations[0]).toStartWith(
        `refusal.example-install: preuve hors forme '${DIRECTORY}' : `,
      );
    });
  });

  describe("4. dates are bounded by a floor and by the injected clock", () => {
    const at = (iso: string) => new Date(iso);
    const decided = (value: string, now = NOW) =>
      evaluateRefusals(register([entry({ decided_on: value })]), [], now).violations;
    const consulted = (value: string, now = NOW) =>
      evaluateRefusals(
        register([
          entry({ evidence: `\n      - https://example.org/report (consultée le ${value})` }),
        ]),
        [],
        now,
      ).violations;

    test("decided_on after the day following now fails; that day passes", () => {
      expect(decided("2026-10-24")).toEqual([]);
      expect(decided("2026-10-25")).toEqual([
        "refusal.example-install: `decided_on` '2026-10-25' n'est pas une date AAAA-MM-JJ réelle comprise entre 2026-01-01 et 2026-10-24",
      ]);
    });

    test("decided_on before the 2026-01-01 floor fails; the floor passes", () => {
      expect(decided("2026-01-01")).toEqual([]);
      expect(decided("2025-12-31")).toEqual([
        "refusal.example-install: `decided_on` '2025-12-31' n'est pas une date AAAA-MM-JJ réelle comprise entre 2026-01-01 et 2026-10-24",
      ]);
    });

    test("a consultation date outside the same bounds fails", () => {
      expect(consulted("2026-10-24")).toEqual([]);
      for (const value of ["2026-10-25", "2025-12-31"]) {
        expect(consulted(value)).toEqual([
          `refusal.example-install: preuve hors forme 'https://example.org/report (consultée le ${value})' : la date de consultation '${value}' n'est pas une date AAAA-MM-JJ réelle comprise entre 2026-01-01 et 2026-10-24`,
        ]);
      }
    });

    test("the bound is the injected now, not the clock", () => {
      expect(decided("2029-06-01", at("2030-01-01T00:00:00Z"))).toEqual([]);
      expect(consulted("2029-06-01", at("2030-01-01T00:00:00Z"))).toEqual([]);
    });
  });

  describe("5. the exemption file refuses duplicate keys", () => {
    const created: string[] = [];
    afterAll(() => {
      for (const dir of created) rmSync(dir, { recursive: true, force: true });
    });

    test("a key written twice, which JSON.parse swallows, fails", async () => {
      const dir = mkdtempSync(join(tmpdir(), "check-refusals-"));
      created.push(dir);
      writeFileSync(join(dir, "r.yaml"), register([entry()]));
      const twice =
        '{\n  "exemptions": [\n    {\n      "id": "a",\n      "id": "refusal.example-install",\n      "evidence": "x",\n      "because": "y"\n    }\n  ]\n}\n';
      writeFileSync(join(dir, "x.json"), twice);
      const report = await evaluateRefusalsFiles(join(dir, "r.yaml"), join(dir, "x.json"), NOW);
      expect(report.violations).toEqual([
        `${join(dir, "x.json")}: fichier d'exemptions absent ou illisible : ${EXEMPTIONS_PATH}: le texte n'est pas sa réémission \`JSON.stringify(valeur, null, 2)\` suivie d'un saut de ligne ; une clé écrite deux fois, que JSON.parse garde en silence à sa dernière valeur, y diffère`,
      ]);
    });
  });

  describe("6. id is lowercase ASCII words joined by single hyphens", () => {
    test.each([
      ["a zero-width space", "refusal.a​"],
      ["a path", '"refusal.a/../<b>"'],
      ["an upper-case letter", "refusal.Archify"],
      ["a double hyphen", "refusal.a--b"],
      ["a leading hyphen", "refusal.-a"],
      ["an underscore", "refusal.a_b"],
    ])("an id with %s fails", (_label, id) => {
      const violations = violationsOf({ id });
      expect(violations).toHaveLength(1);
      expect(violations[0]).toEndWith(
        ": `id` doit s'écrire `refusal.<mot>[-<mot>…]`, mots en minuscules ASCII et chiffres (^refusal\\.[a-z0-9]+(-[a-z0-9]+)*$)",
      );
    });
  });

  describe("7. each failure states the exact form expected", () => {
    test("source, revision and evidence messages name their form", () => {
      expect(violationsOf({ source: "http://e.org" })).toEqual([
        "refusal.example-install: `source` doit être une URL https absolue (`https://<hôte>/…`)",
      ]);
      expect(violationsOf({ revision: "e/t@main" })).toEqual([
        "refusal.example-install: `revision` doit être absent, null ou `<propriétaire>/<dépôt>@<sha>`, sha de 7 à 40 caractères hexadécimaux minuscules",
      ]);
      expect(classifyEvidence("e/t@0123456:a.ts", NOW)).toEqual({
        kind: "invalid",
        reason:
          "ni citation épinglée `<propriétaire>/<dépôt>@<sha>:<chemin>:<lignes>` (sha de 7 à 40 caractères hexadécimaux minuscules, lignes `N`, `N-M` ou leur liste séparée par des virgules), ni URL https suivie de « (consultée le AAAA-MM-JJ) »",
      });
    });
  });
});
