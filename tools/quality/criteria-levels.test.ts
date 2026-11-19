import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CriterionLevel, formatCriterionLevels, readCriterionLevels } from "./criteria-levels";
import type { Parsed } from "./prd-model";

const COMMAND: string = join(import.meta.dir, "criteria-levels.ts");
const NORM_PATH: string = join(import.meta.dir, "../../docs/specifications/WORK-PACKAGES.md");
const scratch: string = mkdtempSync(join(tmpdir(), "criteria-levels-test-"));

afterAll((): void => {
  rmSync(scratch, { recursive: true, force: true });
});

function levelsOf(markdown: string): readonly CriterionLevel[] {
  const read: Parsed<readonly CriterionLevel[]> = readCriterionLevels(markdown);
  if (!read.ok) throw new Error(`unexpected refusal: ${read.reason}`);
  return read.value;
}

function problemsOf(clause: string): readonly string[] {
  return levelsOf(`- CA-1 Un critère. ${clause}`)[0]?.problems ?? ["no criterion read"];
}

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCommand(...args: readonly string[]): CommandResult {
  // The timeout turns a command blocked on a FIFO into a failure of the test.
  const run = Bun.spawnSync([process.execPath, COMMAND, ...args], { env: {}, timeout: 4000 });
  return {
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

function specification(name: string, markdown: string): string {
  const path: string = join(scratch, name);
  writeFileSync(path, markdown);
  return path;
}

describe("the Validation clause", () => {
  test.each([
    ["Validation : à définir"],
    ["Validation : [TODO]"],
    ["Validation : 1. TODO"],
    ["Validation : N/A"],
    ["Validation : ..."],
    ["Validation : ?"],
    ["Validation : -"],
    ["Validation : <à définir>"],
  ])("%s is a placeholder", (clause: string) => {
    expect(problemsOf(clause)).toEqual(["validation-placeholder"]);
  });

  test("a command whose name starts with a placeholder word is not a placeholder", () => {
    expect(problemsOf("Validation : `todo-cli list`")).toEqual([]);
    expect(problemsOf("Validation : todo-cli list")).toEqual([]);
  });

  test.each([["Validation :"], ["Validation : ***"]])("%s is empty", (clause: string) => {
    expect(problemsOf(clause)).toEqual(["validation-empty"]);
  });

  test("a level clause is not the text of the validation", () => {
    expect(problemsOf("Validation : Niveau : 1")).toEqual(["validation-empty"]);
  });

  test("a criterion without the clause is reported as empty", () => {
    expect(problemsOf("Sans clause.")).toEqual(["validation-empty"]);
  });

  test("the clause is read on an indented continuation line", () => {
    const levels = levelsOf("- CA-1 Un critère.\n  Validation : à définir");
    expect(levels[0]?.problems).toEqual(["validation-placeholder"]);
  });

  test("a zero-width character is refused by the alphabet, with the reason of the model", () => {
    const path: string = specification("zero-width.md", "- CA-1 Un critère. Validation : \u{200B}");
    const run: CommandResult = runCommand(path);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("U+200B (Cf): outside the alphabet of a PRD");
    expect(run.stdout).toBe("");
  });
});

describe("a claim", () => {
  test("a claim without judgement is reported", () => {
    expect(problemsOf("Validation : revue passée")).toEqual(["claim-without-judgement"]);
  });

  test("a claim under a judgement level is accepted", () => {
    expect(problemsOf("Validation : revue passée, Niveau : 3 jugement")).toEqual([]);
  });

  test("the verb is not the participle", () => {
    expect(problemsOf("Validation : `bun test` le gate vérifie le code")).toEqual([]);
  });

  test("a code span is a means of replay", () => {
    expect(problemsOf("Validation : `bun test` testé")).toEqual([]);
  });
});

describe("the Niveau clause", () => {
  test("level 2 requires an ISO date", () => {
    expect(problemsOf("Validation : `gh api x` Niveau : 2")).toEqual(["volatile-without-date"]);
    expect(problemsOf("Validation : `gh api x` relevé le 2026-11-16, Niveau : 2")).toEqual([]);
  });

  test("a date that is not on the calendar is not a date", () => {
    expect(problemsOf("Validation : `gh api x` relevé le 2026-13-45, Niveau : 2")).toEqual([
      "volatile-without-date",
    ]);
  });

  test.each([
    ["Validation : `x` Niveau : 3"],
    ["Validation : `x` Niveau : 4"],
    ["Validation : `x` Niveau : 1 jugement"],
  ])("%s mismatches its judgement mark", (clause: string) => {
    expect(problemsOf(clause)).toEqual(["judgement-level-mismatch"]);
  });

  test.each([
    ["Validation : `x` Niveau : 5"],
    ["Validation : `x` Niveau : deux"],
    ["Validation : `x` Niveau :"],
    ["Validation : `x` Niveau : 1, Niveau : 2"],
  ])("%s is malformed and the rest of the document is still read", (clause: string) => {
    const levels = levelsOf(`- CA-1 Un critère. ${clause}\n- CA-2 Autre. Validation : \`y\``);
    expect(levels[0]?.problems).toEqual(["level-malformed"]);
    expect(levels[0]?.level).toBeNull();
    expect(levels[1]?.problems).toEqual([]);
  });

  test("the declared level and its mark are returned", () => {
    expect(levelsOf("- CA-1 C. Validation : avis, Niveau : 4 jugement")[0]).toEqual({
      id: "CA-1",
      line: 1,
      level: 4,
      judgement: true,
      problems: [],
    });
  });
});

describe("the report", () => {
  const MARKER: string = "phrase-marqueur-confidentielle";
  const MIXED: string = [
    `- CA-1 ${MARKER}. Validation : \`bun test\` Niveau : 1`,
    "- CA-2 Sans niveau. Validation : `bun test`",
    "- CA-3 Attente. Validation : à définir",
    "- CA-4 Mal formé. Validation : `bun test` Niveau : 9",
  ].join("\n");

  test("the counters sum to the criteria read", () => {
    const report: string = formatCriterionLevels(levelsOf(MIXED));
    expect(report).toContain("criteria: read=4 conforming=2 violating=2");
    expect(report).toContain("levels: read=4 1=1 2=0 3=0 4=0 undeclared=2 malformed=1");
  });

  test("a criterion without a level is undeclared and is not a violation", () => {
    const report: string = formatCriterionLevels(levelsOf(MIXED));
    expect(report).toContain("CA-2 line=2 level=undeclared problems=none");
  });

  test("the command exits 0 on violations and never prints the text of a criterion", () => {
    const run: CommandResult = runCommand(specification("mixed.md", MIXED));
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("CA-3 line=3 level=undeclared problems=validation-placeholder");
    expect(run.stdout).toContain("CA-4 line=4 level=malformed problems=level-malformed");
    expect(run.stdout).not.toContain(MARKER);
  });

  test("a missing file and a wrong usage exit 2", () => {
    expect(runCommand(join(scratch, "absent.md")).exitCode).toBe(2);
    expect(runCommand().exitCode).toBe(2);
    const readable: string = specification("usage.md", "- CA-1 C. Validation : `x`");
    expect(runCommand(readable, readable).exitCode).toBe(2);
  });
});

// The closed lists of the brief of this command, written here and not imported:
// a list read from the code under test could not notice an entry dropped from it.
const PLACEHOLDER_WORDS: readonly string[] = [
  "à définir",
  "a definir",
  "à déterminer",
  "a determiner",
  "à préciser",
  "a preciser",
  "à venir",
  "a venir",
  "en attente",
  "en cours",
  "néant",
  "neant",
  "todo",
  "tbd",
  "tba",
  "fixme",
  "wip",
  "xxx",
  "n/a",
  "na",
  "none",
];
const PLACEHOLDER_SYMBOLS: readonly string[] = ["?", "...", "…", "-"];
const CLAIMS: readonly string[] = [
  "testé",
  "testée",
  "testés",
  "testées",
  "vérifié",
  "vérifiée",
  "vérifiés",
  "vérifiées",
  "validé",
  "validée",
  "validés",
  "validées",
  "revu",
  "revue",
  "revus",
  "revues",
  "relu",
  "relue",
  "relus",
  "relues",
  "contrôlé",
  "contrôlée",
  "contrôlés",
  "contrôlées",
  "approuvé",
  "approuvée",
  "approuvés",
  "approuvées",
  "fonctionnel",
  "fonctionnelle",
  "fonctionnels",
  "fonctionnelles",
  "fonctionne",
  "revue passée",
  "tests passés",
  "ça marche",
];

describe("the closed list of placeholders", () => {
  describe.each(PLACEHOLDER_WORDS.map((word: string): [string] => [word]))("%s", (word: string) => {
    test.each([
      [word],
      [word.toUpperCase()],
      [`[${word}]`],
      [`1. ${word}`],
      [`1) ${word}`],
      [`**${word}**`],
      [`${word}.`],
      [`${word} plus tard`],
    ])("Validation : %s is a placeholder", (text: string) => {
      expect(problemsOf(`Validation : ${text}`)).toEqual(["validation-placeholder"]);
    });

    test("glued to a letter it is another word", () => {
      expect(problemsOf(`Validation : ${word}x run`)).toEqual([]);
    });
  });

  describe.each(
    PLACEHOLDER_SYMBOLS.map((symbol: string): [string] => [symbol]),
  )("%s", (symbol: string) => {
    test.each([
      [symbol],
      [`[${symbol}]`],
      [`1. ${symbol}`],
      [`**${symbol}**`],
      [`${symbol} plus tard`],
    ])("Validation : %s is a placeholder", (text: string) => {
      expect(problemsOf(`Validation : ${text}`)).toEqual(["validation-placeholder"]);
    });
  });
});

describe("the end of a placeholder word", () => {
  test.each([
    ["**TODO**"],
    ["*à définir*"],
    ["_TBD_"],
    ['"TODO"'],
    ["«TODO»"],
    ["« TODO »"],
    ["“TODO”"],
    ["‹TODO›"],
    ["‘TODO’"],
    ["'TODO'"],
    ["„TODO"],
    ["‚TODO"],
    ["TODO'"],
    ["TODO„"],
    ["TODO‚"],
    ["{TODO}"],
    ["(TODO)"],
    ["TODO(owner): plus tard"],
    ["TODO/plus tard"],
    ["TODO, plus tard"],
    ["TODO; plus tard"],
    ["TODO! plus tard"],
    ["TODO? plus tard"],
    ["TODO: plus tard"],
    ["TODO:"],
    ["TODO."],
    ["TODO..."],
    ["**TODO.**"],
    ["TODO - plus tard"],
    ["TODO-"],
    ["TODO_"],
  ])("Validation : %s is a placeholder", (text: string) => {
    expect(problemsOf(`Validation : ${text}`)).toEqual(["validation-placeholder"]);
  });

  test.each([
    ["todo.sh --check"],
    ["todo:list --all"],
    ["todo_list --all"],
    ["todo-cli list"],
    ["none.sh --check"],
    ["1.todo run"],
    ["`TODO`"],
  ])("Validation : %s names a command", (text: string) => {
    expect(problemsOf(`Validation : ${text}`)).toEqual([]);
  });

  test.each([
    ["**<à définir>**"],
    ["<à définir> Niveau : 1"],
  ])("Validation : %s is a template", (text: string) => {
    expect(problemsOf(`Validation : ${text}`)).toEqual(["validation-placeholder"]);
  });
});

describe("a placeholder symbol followed by text", () => {
  test.each([
    ["? plus tard"],
    ["?? plus tard"],
    ["[?] plus tard"],
    ["1. ? plus tard"],
    ["... à compléter"],
    ["… à compléter"],
    ["⋯ à compléter"],
    ["- à voir"],
    ["-- à voir"],
    ["— à voir"],
    ["– à voir"],
  ])("Validation : %s is a placeholder", (text: string) => {
    expect(problemsOf(`Validation : ${text}`)).toEqual(["validation-placeholder"]);
  });

  test.each([
    ["--help affiche la liste"],
    ["-x run"],
    ["?x run"],
  ])("Validation : %s starts with a word", (text: string) => {
    expect(problemsOf(`Validation : ${text}`)).toEqual([]);
  });

  test.each([
    ["é"],
    ["éàü"],
    ["« é »"],
    ["œ"],
  ])("Validation : %s holds no ASCII alphanumeric character", (text: string) => {
    expect(problemsOf(`Validation : ${text}`)).toEqual(["validation-empty"]);
  });
});

describe("the closed list of claims", () => {
  describe.each(CLAIMS.map((claim: string): [string] => [claim]))("%s", (claim: string) => {
    test("is reported without a judgement mark", () => {
      expect(problemsOf(`Validation : le lot est ${claim}`)).toEqual(["claim-without-judgement"]);
    });

    test("is reported whatever its case", () => {
      expect(problemsOf(`Validation : le lot est ${claim.toUpperCase()}`)).toEqual([
        "claim-without-judgement",
      ]);
    });

    test("is accepted under a judgement mark", () => {
      expect(problemsOf(`Validation : le lot est ${claim}, Niveau : 3 jugement`)).toEqual([]);
    });
  });

  test.each([
    ["le gate teste le code"],
    ["le gate vérifie le code"],
    ["le gate valide le code"],
    ["le gate contrôle le code"],
    ["le gate approuve le code"],
    ["le relevé est attesté"],
    ["la clause est retestée"],
    ["le relument du texte"],
  ])("Validation : %s is not a participle of the list", (text: string) => {
    expect(problemsOf(`Validation : ${text}`)).toEqual([]);
  });
});

describe("the means of replay", () => {
  test.each([
    ["`bun test` testé"],
    ["``bun test`` testé"],
    ["``echo ` x`` testé"],
    ["`./run.sh` testé"],
    ["`../run.sh` testé"],
    ["`FOO=1 bun test` testé"],
    ["`FOO=1 ./run.sh` testé"],
  ])("Validation : %s holds a command", (text: string) => {
    expect(problemsOf(`Validation : ${text}`)).toEqual([]);
  });

  test.each([
    ["` testé"],
    ["testé `"],
    ["` ` testé"],
    ["`README.md` testé"],
    ["`docs/a.md` testé"],
    ["`bun` testé"],
    ["`FOO=1` testé"],
    ["`FOO=1 bun` testé"],
    ["`--help x` testé"],
  ])("Validation : %s holds no command", (text: string) => {
    expect(problemsOf(`Validation : ${text}`)).toEqual(["claim-without-judgement"]);
  });

  test("a participle inside a code span is not a claim", () => {
    expect(problemsOf("Validation : `testé`")).toEqual([]);
  });
});

describe("where the Niveau clause is read", () => {
  test.each([
    ["- CA-1 C. Validation : `echo Niveau : 5`"],
    ["- CA-1 Le Niveau : 5 du service. Validation : `bun test`"],
    ["- CA-1 Niveau : 3. Validation : `bun test`"],
    ["- CA-1 C. Validation : `bun test`\n\n  Niveau : 5"],
    ["- CA-1 C. Validation : `bun test` sous-niveau : 5"],
    ["- CA-1 C. Validation : `bun test` sousniveau : 5"],
    ["- CA-1 C. Validation : `bun test` 2niveau : 5"],
    ["- CA-1 C. Validation : `bun test`\n  - `Niveau : 5`"],
    ["- CA-1 C. Validation : `bun test`\n  - sous-puce\n   \n  Niveau : 5"],
    ["- CA-1 C. Validation : `bun test`\n  - sous-puce\nNiveau : 5"],
  ])("%s declares no level", (markdown: string) => {
    expect(levelsOf(markdown)[0]).toEqual({
      id: "CA-1",
      line: 1,
      level: null,
      judgement: false,
      problems: [],
    });
  });

  test("the word after a malformed clause stays in the validation", () => {
    expect(problemsOf("Validation : Niveau : testé")).toEqual([
      "claim-without-judgement",
      "level-malformed",
    ]);
    expect(problemsOf("Validation : Niveau : le gate")).toEqual(["level-malformed"]);
  });

  test("the number of a clause spelled with a no-break space is not the validation", () => {
    expect(problemsOf("Validation : Niveau :\u{A0}1")).toEqual([
      "validation-empty",
      "level-malformed",
    ]);
  });

  test("a clause nested under the bullet makes the declared level malformed", () => {
    const criterion: CriterionLevel | undefined = levelsOf(
      "- CA-1 C. Validation : `x y` Niveau : 1\n  - Niveau : 2",
    )[0];
    expect(criterion?.level).toBeNull();
    expect(criterion?.problems).toEqual(["level-malformed"]);
  });

  test.each([
    ["Validation : `x y` niveau : 1"],
    ["Validation : `x y` NIVEAU : 1"],
    ["Validation : `x y` Niveaux : 1"],
    ["Validation : `x y` Niveau\u{A0}: 1"],
    ["Validation : `x y` Niveau\u{202F}: 1"],
    ["Validation : `x y` Niveau\u{2009}: 1"],
    ["Validation : `x y` Niveau :\u{A0}1"],
    ["Validation : `x y` **Niveau** : 1"],
    ["Validation : `x y` Niveau : 3 Jugement"],
    ["Validation : `x y` Niveau : 1.."],
    ["Validation : `x y` Niveau : 2.5"],
    ["Validation : `x y` Niveau : 01"],
    ["Validation : `x y`\n  - Niveau : 1"],
    ["Validation : `x y`\n  - niveau : 1"],
    ["Validation : `x y`\n  * sous-puce\n  - Niveau : 1"],
    ["Sans clause.\n  - Niveau : 1"],
  ])("%s is malformed", (clause: string) => {
    const criterion: CriterionLevel | undefined = levelsOf(`- CA-1 C. ${clause}`)[0];
    expect(criterion?.problems.at(-1)).toBe("level-malformed");
    expect(criterion?.level).toBeNull();
  });

  test.each([
    ["Validation : `x y` Niveau : 1", 1],
    ["Validation : `x y` Niveau: 1", 1],
    ["Validation : `x y` Niveau : 1.", 1],
    ["Validation : `x y` (Niveau : 1)", 1],
    ["Validation : `x y` **Niveau : 1**", 1],
    ["Validation : `x y` **Niveau :** 1", 1],
    ["Validation : `x y` Niveau : **1**", 1],
    ["Validation : `x y` _Niveau : 1_", 1],
    ["Validation : `x y`\n  Niveau : 1", 1],
  ] as const)("%s declares the level %d", (clause: string, level: number) => {
    const criterion: CriterionLevel | undefined = levelsOf(`- CA-1 C. ${clause}`)[0];
    expect(criterion?.level).toBe(level as CriterionLevel["level"]);
    expect(criterion?.problems).toEqual([]);
  });

  test("the clause of the next criterion is not read as a sub-bullet", () => {
    const levels = levelsOf(
      "- CA-1 C. Validation : `x y`\n  - CA-2 D. Validation : `x y` Niveau : 1",
    );
    expect(levels.map((criterion: CriterionLevel) => criterion.level)).toEqual([null, 1]);
    expect(levels.flatMap((criterion: CriterionLevel) => criterion.problems)).toEqual([]);
  });

  test.each([
    ["Validation : avis, Niveau : 3 jugement"],
    ["Validation : avis, Niveau : 3, jugement"],
    ["Validation : avis, Niveau : 3. jugement"],
    ["Validation : avis, Niveau : 3 *jugement*"],
    ["Validation : avis, Niveau : 3 **jugement**"],
    ["Validation : avis (Niveau : 3 jugement)"],
  ])("%s carries the judgement mark", (clause: string) => {
    const criterion: CriterionLevel | undefined = levelsOf(`- CA-1 C. ${clause}`)[0];
    expect(criterion?.judgement).toBe(true);
    expect(criterion?.problems).toEqual([]);
  });

  test.each([
    ["jugements"],
    ["jugementé"],
    ["sans jugement"],
  ])("Niveau : 3 %s carries no judgement mark", (mark: string) => {
    expect(problemsOf(`Validation : avis, Niveau : 3 ${mark}`)).toEqual([
      "judgement-level-mismatch",
    ]);
  });

  test.each([["1"], ["2"]])("level %s refuses the judgement mark", (level: string) => {
    expect(problemsOf(`Validation : \`x y\` 2026-11-16, Niveau : ${level} jugement`)).toEqual([
      "judgement-level-mismatch",
    ]);
  });
});

describe("the date of a level 2", () => {
  test.each([
    ["2026-11-16"],
    ["2024-02-29"],
    ["`gh api x` 2026-11-16"],
  ])("%s is a date", (date: string) => {
    expect(problemsOf(`Validation : \`x y\` ${date}, Niveau : 2`)).toEqual([]);
  });

  test.each([
    ["2026-02-30"],
    ["2026-02-29"],
    ["2026-00-10"],
    ["2026-11-5"],
    ["12026-11-16"],
    ["2026-11-161"],
    ["2026-11-16-1"],
    ["1-2026-11-16"],
  ])("%s is not a date", (date: string) => {
    expect(problemsOf(`Validation : \`x y\` ${date}, Niveau : 2`)).toEqual([
      "volatile-without-date",
    ]);
  });

  test("levels 1, 3 and 4 need no date", () => {
    expect(problemsOf("Validation : `x y` Niveau : 1")).toEqual([]);
    expect(problemsOf("Validation : avis, Niveau : 3 jugement")).toEqual([]);
    expect(problemsOf("Validation : avis, Niveau : 4 jugement")).toEqual([]);
  });
});

describe("the extent of a bullet", () => {
  test.each([
    ["* CA-1 C. Validation : à définir"],
    ["+ CA-1 C. Validation : à définir"],
    ["- **CA-1** C. Validation : à définir"],
    ["   - CA-1 C. Validation : à définir"],
    ["- CA-1 C.\n\tValidation : à définir"],
  ])("%s is read", (markdown: string) => {
    expect(levelsOf(markdown)[0]?.problems).toEqual(["validation-placeholder"]);
  });

  test.each([
    ["- CA-1 C. Validation : à\n  définir"],
    ["- CA-1 C. Validation : à   définir"],
    ["- CA-1 C. Validation : à\tdéfinir"],
    ["- CA-1 C. Validation : à\u{A0}définir"],
  ])("white space folds in %s", (markdown: string) => {
    expect(levelsOf(markdown)[0]?.problems).toEqual(["validation-placeholder"]);
  });

  test.each([
    ["- CA-1 C.\n\n  Validation : `bun test`"],
    ["- CA-1 C.\n   \n  Validation : `bun test`"],
    ["- CA-1 C.\n- Validation : `bun test`"],
    ["- CA-1 C.\nValidation : `bun test`"],
    ["- CA-1 C.\n  - Validation : `bun test`"],
  ])("the clause outside the bullet is not read in %s", (markdown: string) => {
    expect(levelsOf(markdown)[0]?.problems).toEqual(["validation-empty"]);
  });
});

describe("the advisory exit", () => {
  test("a report with violations says that it exits 0", () => {
    const path: string = specification(
      "advisory.md",
      "- CA-1 C. Validation : à définir\n- CA-2 D. Validation : TODO\n- CA-3 E. Validation : `x y`",
    );
    const run: CommandResult = runCommand(path);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("advisory: exit 0 despite 2 violating");
  });

  test("a conforming report does not", () => {
    const run: CommandResult = runCommand(
      specification("conforming.md", "- CA-1 C. Validation : `x y`"),
    );
    expect(run.exitCode).toBe(0);
    expect(run.stdout).not.toContain("advisory:");
  });
});

describe("the path of the specification", () => {
  test("a symbolic link to a readable specification exits 2", () => {
    const target: string = specification("link-target.md", "- CA-1 C. Validation : `x y`");
    const link: string = join(scratch, "link.md");
    symlinkSync(target, link);
    const run: CommandResult = runCommand(link);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("not a regular file");
    expect(run.stdout).toBe("");
  });

  test("a directory exits 2", () => {
    const directory: string = join(scratch, "directory.md");
    mkdirSync(directory);
    const run: CommandResult = runCommand(directory);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("not a regular file");
  });

  test("a FIFO exits 2 without blocking", () => {
    const fifo: string = join(scratch, "fifo.md");
    expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
    const run: CommandResult = runCommand(fifo);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("not a regular file");
  });
});

describe("the norm", () => {
  test("the section names every label the report prints in place of a level", async () => {
    const norm: string = await Bun.file(NORM_PATH).text();
    const section: string = norm.split("## Verification level (advisory)")[1] ?? "";
    const sentence: string =
      section.split("\n").find((line) => line.includes("one line per")) ?? "";
    expect(sentence).toContain("`undeclared`");
    expect(sentence).toContain("`malformed`");
  });

  function advisoryExample(norm: string): string {
    const blocks: readonly RegExpMatchArray[] = [
      ...norm.matchAll(/^```markdown criteria-level-example advisory\n([\s\S]*?)\n```$/gm),
    ];
    expect(blocks).toHaveLength(1);
    return blocks[0]?.[1] ?? "";
  }

  test("the labelled example gives the levels the section states", async () => {
    const norm: string = await Bun.file(NORM_PATH).text();
    const levels = levelsOf(advisoryExample(norm));
    expect(levels.map((criterion: CriterionLevel) => [criterion.id, criterion.level])).toEqual([
      ["CA-21", 1],
      ["CA-22", 2],
      ["CA-23", 3],
      ["CA-24", 4],
      ["CA-25", null],
    ]);
    expect(levels.flatMap((criterion: CriterionLevel) => criterion.problems)).toEqual([]);
  });

  test("the criteria example of the grammar stays free of problems", async () => {
    const norm: string = await Bun.file(NORM_PATH).text();
    const block: RegExpMatchArray | null = norm.match(
      /^```markdown criteria-example\n([\s\S]*?)\n```$/m,
    );
    const levels = levelsOf(block?.[1] ?? "");
    expect(levels).toHaveLength(3);
    expect(levels.flatMap((criterion: CriterionLevel) => criterion.problems)).toEqual([]);
  });
});
