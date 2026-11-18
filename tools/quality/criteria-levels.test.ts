import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  const run = Bun.spawnSync([process.execPath, COMMAND, ...args], { env: {} });
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

describe("the norm", () => {
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
