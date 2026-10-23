import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
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

function judge(text: string, exemptions: readonly EvidenceExemption[] = []) {
  return evaluateRefusals(text, exemptions);
}

/** The violations of a register holding one entry built from `overrides`. */
function violationsOf(overrides: Fields): string[] {
  return judge(register([entry(overrides)])).violations;
}

describe("the register of the repository", () => {
  test("passes, and its volume matches an independent count of entries and evidence", async () => {
    const report = await evaluateRefusalsFiles(
      join(ROOT, REGISTER_PATH),
      join(ROOT, EXEMPTIONS_PATH),
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
    expect(judge(`schema_version: ${SCHEMA_VERSION}\nrefusals: none\n`).violations).toEqual([
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
  test("an id without the `refusal.` prefix fails", () => {
    expect(violationsOf({ id: "archify-install" })).toEqual([
      "archify-install: `id` doit être préfixé `refusal.` et sans espace",
    ]);
  });

  test("an id that is only the prefix fails", () => {
    expect(violationsOf({ id: "refusal." })).toEqual([
      "refusal.: `id` doit être préfixé `refusal.` et sans espace",
    ]);
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
        "refusal.example-install: `source` doit être une URL https",
      ]);
    }
  });

  test("a revision that is not <owner>/<repository>@<sha> fails", () => {
    for (const revision of ["example/tool", "example/tool@main", "tool@0123456", '""']) {
      expect(violationsOf({ revision })).toEqual([
        "refusal.example-install: `revision` doit être absent, null ou `<propriétaire>/<dépôt>@<sha>`",
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
        "refusal.example-install: `decided_on` doit être une date ISO 8601 valide (AAAA-MM-JJ)",
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
    "ni citation épinglée `<propriétaire>/<dépôt>@<sha>:<chemin>:<lignes>`, ni URL https suivie de « (consultée le AAAA-MM-JJ) »";

  test("the two admitted forms are recognised", () => {
    expect(classifyEvidence("tt-a1i/archify@25cf370:a/b.mjs:607-612")).toEqual({
      kind: "pinned",
    });
    expect(classifyEvidence("o/r@0123456:a.ts:1,3-4")).toEqual({ kind: "pinned" });
    expect(classifyEvidence("https://www.humanlayer.com/ (consultée le 2026-10-23)")).toEqual({
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
    ["line 0", "o/r@0123456:src/a.ts:0", "l'intervalle '0' ne désigne aucune ligne"],
    ["a reversed range", "o/r@0123456:src/a.ts:9-3", "l'intervalle '9-3' ne désigne aucune ligne"],
    [
      "a malformed line spec",
      "o/r@0123456:src/a.ts:1-",
      "'1-' n'est pas une spécification de lignes",
    ],
    ["an absolute path", "o/r@0123456:/etc/passwd:1", "le chemin est absolu"],
    ["a path climbing out", "o/r@0123456:src/../x.ts:1", "le chemin porte un segment '..'"],
    ["a '.' segment", "o/r@0123456:./x.ts:1", "le chemin porte un segment '.'"],
    ["an empty segment", "o/r@0123456:src//x.ts:1", "le chemin porte un segment vide"],
    ["a '..' repository", "o/..@0123456:x.ts:1", "'..' n'est pas un nom de dépôt"],
    [
      "an http URL",
      "http://example.org/x (consultée le 2026-10-23)",
      "'http://example.org/x' n'est pas une URL https",
    ],
    [
      "an impossible consultation date",
      "https://example.org/x (consultée le 2026-13-01)",
      "la date de consultation '2026-13-01' n'est pas une date ISO 8601 valide",
    ],
  ])("%s is out of form", (_label, evidence, reason) => {
    expect(classifyEvidence(evidence)).toEqual({ kind: "invalid", reason });
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
      `refusal.example-install: preuve hors forme '${DIRECTORY}' : ni citation épinglée \`<propriétaire>/<dépôt>@<sha>:<chemin>:<lignes>\`, ni URL https suivie de « (consultée le AAAA-MM-JJ) »`,
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
  function scratch(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "check-refusals-"));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return dir;
  }

  test("an absent register fails, never reads as empty", async () => {
    const dir = scratch({ "x.json": '{"exemptions": []}' });
    const report = await evaluateRefusalsFiles(join(dir, "absent.yaml"), join(dir, "x.json"));
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toStartWith(
      `${join(dir, "absent.yaml")}: registre absent ou illisible : `,
    );
  });

  test("an absent or malformed exemption file fails", async () => {
    const dir = scratch({ "r.yaml": register([entry()]), "bad.json": "{" });
    for (const name of ["absent.json", "bad.json"]) {
      const report = await evaluateRefusalsFiles(join(dir, "r.yaml"), join(dir, name));
      expect(report.violations[0]).toStartWith(
        `${join(dir, name)}: fichier d'exemptions absent ou illisible : `,
      );
    }
  });

  test("files that hold read through to the verdict", async () => {
    const dir = scratch({ "r.yaml": register([entry()]), "x.json": '{"exemptions": []}' });
    const report = await evaluateRefusalsFiles(join(dir, "r.yaml"), join(dir, "x.json"));
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
    });
  });

  test("a key or nested content before any entry is unread", () => {
    const text = "refusals:\n    id: x\n      - y\n   three spaces\n";
    expect(scanBlockLayout(text).unreadLines).toEqual([2, 3, 4]);
  });
});
