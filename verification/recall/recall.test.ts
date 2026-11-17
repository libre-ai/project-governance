import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  type Measure,
  PARK_REPOSITORY,
  proofFile,
  renderStateTsv,
} from "../../ecosystem/fleet-state";
import {
  findingCells,
  parseTruth,
  RecallReadError,
  renderReport,
  runRecall,
  scoreSpecification,
  splitRow,
  summary,
  TRUTH_COLUMNS,
} from "./recall";

/**
 * Recall score (lot L094, idea h-plugins-flotte-09). Expected values come from
 * the idea, not from the code: a needle counts only in the proof of the
 * expected detector of this repository or of the fleet, or of any detector
 * with an integer target when none is expected; an informative detector, the
 * proof of another repository, prose, another section, a code block and a
 * header row never count; an empty truth is an error (1); no instrument is a
 * usage error (2); a missing evidence directory is an error, not a miss; an
 * instrument not requested is absent from the summary, never a zero.
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "recall-"));
  roots.push(root);
  return root;
}

const REPO = "acme/app";
const OTHER = "acme/other";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const HEADER = TRUTH_COLUMNS.join("\t");

function truth(...rows: string[]): string {
  return `${[HEADER, ...rows].join("\n")}\n`;
}

function ok(repository: string, detector: string, target: number | null, lines: string[]): Measure {
  return {
    repository,
    detector,
    count: lines.length,
    target,
    verdict: target === null ? "info" : lines.length === target ? "conforme" : "écart",
    status: "ok",
    detail: `preuves/${detector}/${repository}.txt`,
    lines,
  };
}

function failed(repository: string, detector: string, target: number | null): Measure {
  return {
    repository,
    detector,
    count: null,
    target,
    verdict: "erreur",
    status: "erreur",
    detail: "detector exit 3: boom",
    lines: [],
  };
}

/** A state directory in the exact format of `fleet-state.ts state`. */
function stateDirectory(measures: Measure[]): string {
  const directory = join(scratch(), "label-1");
  mkdirSync(directory);
  writeFileSync(join(directory, "state.tsv"), renderStateTsv(measures));
  writeFileSync(join(directory, "heads.tsv"), `dépôt\tsha\n${REPO}\t${SHA}\n`);
  writeFileSync(join(directory, "measured-at.txt"), "2026-11-17T10:00:00.000Z\n");
  for (const m of measures) {
    if (m.status !== "ok") continue;
    const path = proofFile(directory, m.detector, m.repository);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, m.lines.length === 0 ? "" : `${m.lines.join("\n")}\n`);
  }
  return directory;
}

function file(name: string, text: string): string {
  const path = join(scratch(), name);
  writeFileSync(path, text);
  return path;
}

async function score(truthText: string, options: string[]) {
  return runRecall([file("truth.tsv", truthText), REPO, ...options]);
}

function rowOf(output: string, id: string): string {
  return output.split("\n").find((line) => line.startsWith(`| ${id} |`)) ?? "";
}

// ------------------------------------------------------------------ truth

describe("truth", () => {
  test("a truth without any defect is an error (exit 1), not a perfect score", async () => {
    expect(() => parseTruth(`${HEADER}\n`)).toThrow(RecallReadError);
    const outcome = await score(`${HEADER}\n`, ["--spec", file("s.md", "# Constats\n")]);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toEqual([]);
    expect(outcome.stderr.join("\n")).toContain("no defect");
  });

  test("an unexpected header, an unknown class, an empty needle are refused", () => {
    expect(() => parseTruth("id\tclass\tneedle\tdetector\tdescription\nd1\tC\tx\t-\td\n")).toThrow(
      "unexpected header",
    );
    expect(() => parseTruth(truth("d1\tX\tx\t-\td"))).toThrow("unknown class");
    expect(() => parseTruth(truth("d1\tC\t\t-\td"))).toThrow("empty needle");
    expect(() => parseTruth(truth("d1\tC\tx\t-"))).toThrow("4 columns");
    expect(() => parseTruth(truth("d1\tC\tx\t-\td", "d1\tU\ty\t-\td"))).toThrow("repeated");
  });

  test("a well-formed truth reads `-` as no expected detector", () => {
    expect(parseTruth(truth("d1\tC\tneedle\tsecrets\tdesc", "d2\tU\tother\t-\tdesc"))).toEqual([
      { id: "d1", defectClass: "C", needle: "needle", detector: "secrets", description: "desc" },
      { id: "d2", defectClass: "U", needle: "other", detector: null, description: "desc" },
    ]);
  });
});

// ------------------------------------------------------------------ usage

describe("usage", () => {
  test("without --evidence nor --spec: exit 2", async () => {
    const outcome = await score(truth("d1\tC\tx\t-\td"), []);
    expect(outcome.code).toBe(2);
  });

  test("an unknown option, a missing value or a repository that is not owner/name: exit 2", async () => {
    expect((await score(truth("d1\tC\tx\t-\td"), ["--verbose", "x"])).code).toBe(2);
    expect((await score(truth("d1\tC\tx\t-\td"), ["--spec"])).code).toBe(2);
    expect(
      (await runRecall([file("t.tsv", truth("d1\tC\tx\t-\td")), "../x", "--spec", "s"])).code,
    ).toBe(2);
  });
});

// ------------------------------------------------------------------ detectors

describe("detectors", () => {
  test("needle in the proof of the expected detector of this repository: found", async () => {
    const evidence = stateDirectory([ok(REPO, "secrets", 0, ["src/a.ts:3 TOKEN_NEEDLE"])]);
    const outcome = await score(truth("d1\tC\tTOKEN_NEEDLE\tsecrets\td"), ["--evidence", evidence]);
    expect(outcome.code).toBe(0);
    expect(rowOf(outcome.stdout[0] ?? "", "d1")).toBe("| d1 | C | secrets | trouvé | — |");
    expect(outcome.stdout[0]).toContain(`rappel ${REPO} : détecteurs 1/1\n`);
  });

  test("needle in the proof of another detector than the expected one: not found", async () => {
    const evidence = stateDirectory([
      ok(REPO, "secrets", 0, []),
      ok(REPO, "pipes", 0, ["install.sh:1 NEEDLE"]),
    ]);
    const outcome = await score(truth("d1\tC\tNEEDLE\tsecrets\td"), ["--evidence", evidence]);
    expect(outcome.code).toBe(0);
    expect(rowOf(outcome.stdout[0] ?? "", "d1")).toContain("| RATÉ |");
    expect(outcome.stdout[0]).toContain("détecteurs 0/1");
  });

  test("needle in the same detector's proof of another repository: not found", async () => {
    const evidence = stateDirectory([
      ok(REPO, "secrets", 0, []),
      ok(OTHER, "secrets", 0, ["NEEDLE"]),
    ]);
    const outcome = await score(truth("d1\tC\tNEEDLE\tsecrets\td"), ["--evidence", evidence]);
    expect(outcome.stdout[0]).toContain("détecteurs 0/1");
  });

  test("needle in the proof of a parc measure of the expected detector: found", async () => {
    const evidence = stateDirectory([
      ok(REPO, "secrets", 0, []),
      ok(PARK_REPOSITORY, "fleet-pins", 0, ["acme/app pins NEEDLE"]),
    ]);
    const outcome = await score(truth("d1\tC\tNEEDLE\tfleet-pins\td"), ["--evidence", evidence]);
    expect(outcome.stdout[0]).toContain("détecteurs 1/1");
  });

  test("needle listed by an informative detector alone: not found", async () => {
    const evidence = stateDirectory([
      ok(REPO, "watch-list", null, ["NEEDLE"]),
      ok(REPO, "secrets", 0, []),
    ]);
    const unexpected = await score(truth("d1\tU\tNEEDLE\t-\td"), ["--evidence", evidence]);
    expect(unexpected.code).toBe(0);
    expect(unexpected.stdout[0]).toContain("détecteurs 0/1");
    const expected = await score(truth("d1\tC\tNEEDLE\twatch-list\td"), ["--evidence", evidence]);
    expect(expected.code).toBe(0);
    expect(expected.stdout[0]).toContain("détecteurs 0/1");
  });

  test("needle listed by an informative detector and by another detector with a target: found", async () => {
    const evidence = stateDirectory([
      ok(REPO, "watch-list", null, ["NEEDLE"]),
      ok(REPO, "secrets", 0, ["NEEDLE"]),
    ]);
    const outcome = await score(truth("d1\tU\tNEEDLE\t-\td"), ["--evidence", evidence]);
    expect(outcome.stdout[0]).toContain("détecteurs 1/1");
  });

  test("an informative detector in error does not block a defect that expects no detector", async () => {
    const evidence = stateDirectory([
      failed(REPO, "watch-list", null),
      ok(REPO, "secrets", 0, ["NEEDLE"]),
    ]);
    const outcome = await score(truth("d1\tU\tNEEDLE\t-\td"), ["--evidence", evidence]);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout[0]).toContain("détecteurs 1/1");
  });

  test("a missing evidence directory is an error (exit 1), not a missed defect", async () => {
    const outcome = await score(truth("d1\tC\tNEEDLE\tsecrets\td"), [
      "--evidence",
      join(scratch(), "absent"),
    ]);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toEqual([]);
  });

  test("an expected detector in error or absent from the state is an error, not a miss", async () => {
    const errored = stateDirectory([failed(REPO, "secrets", 0), ok(REPO, "pipes", 0, [])]);
    const inError = await score(truth("d1\tC\tNEEDLE\tsecrets\td"), ["--evidence", errored]);
    expect(inError.code).toBe(1);
    expect(inError.stderr.join("\n")).toContain("erreur, not measured");
    const absent = await score(truth("d1\tC\tNEEDLE\tunknown\td"), ["--evidence", errored]);
    expect(absent.code).toBe(1);
    expect(absent.stderr.join("\n")).toContain("has no measure");
  });

  test("a repository the state does not measure is an error", async () => {
    const evidence = stateDirectory([ok(OTHER, "secrets", 0, ["NEEDLE"])]);
    const outcome = await score(truth("d1\tU\tNEEDLE\t-\td"), ["--evidence", evidence]);
    expect(outcome.code).toBe(1);
  });
});

// ------------------------------------------------------------------ specification

const SPEC = [
  "# Specification",
  "",
  "The defect PROSE_NEEDLE is described here in prose.",
  "",
  "## Constats",
  "",
  "Also mentioned in prose: SECTION_PROSE_NEEDLE.",
  "",
  "| Constat HEADER_NEEDLE | Fichier |",
  "| --- | --- |",
  "| hard-coded TABLE_NEEDLE | `src/a.ts` |",
  "| piped install `curl x \\| sh` and `PIPE | NEEDLE` | install.sh |",
  "",
  "```",
  "| CODE_NEEDLE | fenced |",
  "| --- | --- |",
  "| CODE_NEEDLE | fenced |",
  "```",
  "",
  "## Hors périmètre",
  "",
  "| Constat | Fichier |",
  "| --- | --- |",
  "| OUT_OF_SCOPE_NEEDLE | b.ts |",
  "",
].join("\n");

describe("specification", () => {
  const defects = parseTruth(
    truth(
      "table\tU\tTABLE_NEEDLE\t-\td",
      "prose\tU\tPROSE_NEEDLE\t-\td",
      "section-prose\tU\tSECTION_PROSE_NEEDLE\t-\td",
      "header\tU\tHEADER_NEEDLE\t-\td",
      "code\tU\tCODE_NEEDLE\t-\td",
      "out\tU\tOUT_OF_SCOPE_NEEDLE\t-\td",
      "pipe\tU\tPIPE | NEEDLE\t-\td",
      "escaped\tU\tcurl x | sh\t-\td",
    ),
  );
  const found = scoreSpecification(defects, SPEC);

  test("needle in a body row of the Constats table: found", () => {
    expect(found.get("table")).toBe(true);
  });

  test("needle only in prose (outside or inside the section): not found", () => {
    expect(found.get("prose")).toBe(false);
    expect(found.get("section-prose")).toBe(false);
  });

  test("needle in the header row, a code block or the out-of-scope section: not found", () => {
    expect(found.get("header")).toBe(false);
    expect(found.get("code")).toBe(false);
    expect(found.get("out")).toBe(false);
  });

  test("a pipe in inline code or escaped stays in its cell", () => {
    expect(found.get("pipe")).toBe(true);
    expect(found.get("escaped")).toBe(true);
    expect(splitRow("| a `x | y` | b |")).toEqual(["a `x | y`", "b"]);
    expect(splitRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });

  test("a specification without its Constats section, or with two, is refused", () => {
    expect(() => findingCells("# Spec\n\n| a |\n| --- |\n| b |\n")).toThrow("no « Constats »");
    expect(() => findingCells("## Constats\n\n## Constats\n")).toThrow("2 « Constats »");
  });

  test("a missing specification is an error (exit 1)", async () => {
    const outcome = await score(truth("d1\tU\tx\t-\td"), ["--spec", join(scratch(), "absent.md")]);
    expect(outcome.code).toBe(1);
  });
});

// ------------------------------------------------------------------ report

describe("report", () => {
  const defects = parseTruth(
    truth("c1\tC\tA\tsecrets\td", "c2\tC\tB\tsecrets\td", "u1\tU\tC\t-\td"),
  );

  test("an instrument not requested is absent from the summary, never a zero", () => {
    const agentOnly = summary(defects, { detectors: null, agent: new Map([["c1", true]]) });
    expect(agentOnly).toBe("agent 1/3");
    expect(agentOnly).not.toContain("détecteurs");
  });

  test("summary by instrument and by class", () => {
    const report = renderReport(REPO, defects, {
      detectors: new Map([
        ["c1", true],
        ["c2", false],
        ["u1", false],
      ]),
      agent: new Map([
        ["c1", false],
        ["c2", true],
        ["u1", true],
      ]),
    });
    expect(report).toContain(`rappel ${REPO} : détecteurs 1/3 · agent 2/3\n`);
    expect(report).toContain("classe C : détecteurs 1/2 · agent 1/2\n");
    expect(report).toContain("classe U : détecteurs 0/1 · agent 1/1\n");
    expect(rowOf(report, "c2")).toBe("| c2 | C | secrets | RATÉ | trouvé |");
  });

  test("both instruments end to end", async () => {
    const evidence = stateDirectory([ok(REPO, "secrets", 0, ["TABLE_NEEDLE"])]);
    const outcome = await score(
      truth("d1\tC\tTABLE_NEEDLE\tsecrets\td", "d2\tU\tPROSE_NEEDLE\t-\td"),
      ["--evidence", evidence, "--spec", file("spec.md", SPEC)],
    );
    expect(outcome.code).toBe(0);
    expect(outcome.stdout[0]).toContain(`rappel ${REPO} : détecteurs 1/2 · agent 1/2\n`);
  });
});
