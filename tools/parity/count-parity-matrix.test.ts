import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countMatrix, exitCode, renderCounts } from "./count-parity-matrix";

// Expected values come from the method (docs/method/PARITY-AUDIT-METHOD.md):
// four statuses, four verdicts, a proven absence, an exclusion that cites a
// decision and carries no source, a file that holds its table and nothing else.

const HEADER = [
  "| # | fonctionnalité | alpha @ v1 | beta @ v2 | verdict | décision | source | preuve |",
  "| - | -------------- | ---------- | --------- | ------- | -------- | ------ | ------ |",
];
const PROOF = "motifs: export\\|dump ; chemins: src/io, docs/";

function matrix(...rows: string[]): string {
  return `${[...HEADER, ...rows].join("\n")}\n`;
}

/** A conforming matrix of five rows: every status and every verdict at least once. */
const CONFORMING = matrix(
  "| 1 | import | natif | partiel | reprendre | | lib-x (MIT) | |",
  `| 2 | export | natif | absent | adapter | | lib-y (Apache-2.0) | ${PROOF} |`,
  "| 3 | recherche | non mesuré | natif | réécrire | | | |",
  "| 4 | partage public | natif | natif | exclure | D34 | | |",
  "| 5 | thèmes | partiel | partiel | reprendre | | lib-x (MIT) | |",
);

describe("countMatrix — counts", () => {
  test("a matrix of N numbered rows counts N, and the report prints it", () => {
    const counts = countMatrix(CONFORMING);
    expect(counts.rows).toBe(5);
    expect(renderCounts(counts).split("\n")).toContain("lignes=5");
  });

  test("each status and each verdict is counted under its own value", () => {
    const counts = countMatrix(CONFORMING);
    expect(counts.statuses).toEqual({ natif: 5, partiel: 3, absent: 1, "non mesuré": 1 });
    expect(counts.verdicts).toEqual({ reprendre: 2, adapter: 1, réécrire: 1, exclure: 1 });
    expect(counts.statusColumns).toBe(2);
    expect(exitCode(counts)).toBe(0);
  });

  test("a status outside the four values is counted under AUTRE, never dropped", () => {
    const counts = countMatrix(
      matrix(
        "| 1 | a | oui | natif | reprendre | | s | |",
        "| 2 | b | Natif | | reprendre | | s | |",
        "| 3 | c | partiel | non mesure | reprendre | | s | |",
      ),
    );
    // « oui », another case, an empty cell, a missing accent: four cells.
    expect(counts.otherStatuses).toBe(4);
    expect(counts.statuses).toEqual({ natif: 1, partiel: 1, absent: 0, "non mesuré": 0 });
    const known = Object.values(counts.statuses).reduce((sum, n) => sum + n, 0);
    expect(known + counts.otherStatuses).toBe(counts.rows * counts.statusColumns);
    expect(renderCounts(counts).split("\n")).toContain("AUTRE=4");
    expect(renderCounts(counts).split("\n")).toContain(
      "somme_statuts=6 lignes_x_colonnes_statut=6",
    );
    expect(exitCode(counts)).toBe(1);
  });

  test("a verdict outside the four values has its own counter and fails", () => {
    const counts = countMatrix(
      matrix("| 1 | a | natif | natif | copier | | s | |", "| 2 | b | natif | natif | | | s | |"),
    );
    expect(counts.otherVerdicts).toBe(2);
    expect(counts.verdicts).toEqual({ reprendre: 0, adapter: 0, réécrire: 0, exclure: 0 });
    expect(renderCounts(counts).split("\n")).toContain("verdict_autre=2");
    expect(exitCode(counts)).toBe(1);
  });
});

describe("countMatrix — exclusions", () => {
  test.each([
    ["an empty decision cell", ""],
    ["prose without an identifier", "décidé en revue"],
    ["an identifier of no register", "ADR-27"],
  ])("exclure with %s is an exclusion without decision", (_label, decision) => {
    const counts = countMatrix(matrix(`| 1 | a | natif | natif | exclure | ${decision} | | |`));
    expect(counts.excludeWithoutDecision).toBe(1);
    expect(exitCode(counts)).toBe(1);
  });

  test.each([
    "D34",
    "ADR-0027",
    "I-27",
    "sécurité (ADR-0027, D2)",
  ])("exclure citing %s is not counted", (decision) => {
    const counts = countMatrix(matrix(`| 1 | a | natif | natif | exclure | ${decision} | | |`));
    expect(counts.excludeWithoutDecision).toBe(0);
    expect(exitCode(counts)).toBe(0);
  });

  test("exclure carrying a source is counted and fails", () => {
    const counts = countMatrix(matrix("| 1 | a | natif | natif | exclure | D34 | lib-x (MIT) | |"));
    expect(counts.excludeWithSource).toBe(1);
    expect(counts.excludeWithoutDecision).toBe(0);
    expect(exitCode(counts)).toBe(1);
  });

  test("a source on another verdict is not an exclusion with source", () => {
    expect(countMatrix(CONFORMING).excludeWithSource).toBe(0);
  });
});

describe("countMatrix — proven absence", () => {
  test.each([
    ["an empty proof", ""],
    ["searched patterns only", "motifs: export"],
    ["searched paths only", "chemins: src/io"],
    ["labels naming nothing", "motifs: ; chemins: "],
    ["prose", "rien trouvé dans le dépôt"],
    ["an empty patterns label followed by the paths label", "motifs: chemins: src/"],
    ["an empty paths label followed by the patterns label", "chemins: motifs: x"],
    ["an empty label followed by the other, given again", "motifs: chemins: a ; chemins: src/"],
    ["both labels in one segment", "motifs: x chemins: src/"],
    ["punctuation only", "motifs: - ; chemins: -"],
    ["punctuation only on one side", "motifs: export ; chemins: ./"],
    ["the same label twice", "motifs: export ; chemins: ; chemins: src/"],
  ])("absent with %s is an absence without proof", (_label, proof) => {
    const counts = countMatrix(matrix(`| 1 | a | natif | absent | réécrire | | | ${proof} |`));
    expect(counts.absentWithoutProof).toBe(1);
    expect(exitCode(counts)).toBe(1);
  });

  test("absent naming searched patterns and searched paths is proven", () => {
    const counts = countMatrix(matrix(`| 1 | a | natif | absent | réécrire | | | ${PROOF} |`));
    expect(counts.absentWithoutProof).toBe(0);
    expect(counts.rows).toBe(1);
    expect(exitCode(counts)).toBe(0);
  });

  test.each([
    "chemins: src/io ; motifs: export",
    "motifs: a;b ; chemins: src/",
  ])("absent proven by %s, in either order or with a ; in a pattern, is proven", (proof) => {
    const counts = countMatrix(matrix(`| 1 | a | natif | absent | réécrire | | | ${proof} |`));
    expect(counts.absentWithoutProof).toBe(0);
    expect(exitCode(counts)).toBe(0);
  });

  test("a row without an absent status owes no proof", () => {
    const counts = countMatrix(matrix("| 1 | a | natif | partiel | reprendre | | s | |"));
    expect(counts.absentWithoutProof).toBe(0);
  });
});

describe("countMatrix — the file holds its table and nothing else", () => {
  const row = (n: number) => `| ${n} | f${n} | natif | natif | reprendre | | s | |`;

  test("a paragraph outside the table is refused", () => {
    const counts = countMatrix(`Matrice de parité.\n\n${matrix(row(1))}`);
    expect(counts.structure.length).toBeGreaterThan(0);
    expect(exitCode(counts)).toBe(1);
  });

  test("a duplicated row number is refused", () => {
    const counts = countMatrix(matrix(row(1), row(2), row(2)));
    expect(counts.rows).toBe(3);
    expect(counts.structure).toHaveLength(1);
    expect(exitCode(counts)).toBe(1);
  });

  test("a missing row number is refused", () => {
    const counts = countMatrix(matrix(row(1), row(3)));
    expect(counts.structure).toHaveLength(1);
    expect(exitCode(counts)).toBe(1);
  });

  test("a row of another width or without a number is set apart and counted", () => {
    const counts = countMatrix(
      matrix(row(1), "| 2 | court | natif |", "| x | f | natif | natif | reprendre | | s | |"),
    );
    expect(counts.rows).toBe(1);
    expect(counts.rejectedRows).toBe(2);
    expect(renderCounts(counts).split("\n")).toContain("lignes_ecartees=2");
    expect(exitCode(counts)).toBe(1);
  });

  test("a row whose closing pipe is escaped is not a table row", () => {
    const counts = countMatrix(
      matrix(row(1), "| 2 | b | natif | absent | réécrire | | | motifs: x ; chemins: y \\|"),
    );
    expect(counts.rows).toBe(1);
    expect(counts.structure).toHaveLength(1);
    expect(counts.structure[0]).toStartWith("line 4: not a table row");
    expect(exitCode(counts)).toBe(1);
  });

  test.each(["01", "0", "+1"])("a row number written %s is not a row number", (number) => {
    const counts = countMatrix(matrix(`| ${number} | f | natif | natif | reprendre | | s | |`));
    expect(counts.rows).toBe(0);
    expect(counts.rejectedRows).toBe(1);
    expect(exitCode(counts)).toBe(1);
  });

  test("a header without its fixed columns, or without a status column, is refused", () => {
    const noStatus =
      "| # | fonctionnalité | verdict | décision | source | preuve |\n| - | - | - | - | - | - |\n| 1 | a | reprendre | | s | |\n";
    const noSource =
      "| # | fonctionnalité | alpha | beta | verdict | décision | preuve |\n| - | - | - | - | - | - | - |\n| 1 | a | natif | natif | reprendre | | |\n";
    const noNumberColumn =
      "| fonctionnalité | nom | alpha | verdict | décision | source | preuve |\n| - | - | - | - | - | - | - |\n| 1 | a | natif | reprendre | | s | |\n";
    for (const text of [noStatus, noSource, noNumberColumn]) {
      const counts = countMatrix(text);
      expect(counts.rows).toBe(0);
      expect(exitCode(counts)).toBe(1);
    }
  });

  test("a table whose second row is not a separator is refused, and says so", () => {
    const counts = countMatrix(`${HEADER[0]}\n${row(1)}\n${row(2)}\n`);
    expect(counts.rows).toBe(0);
    expect(counts.structure).toEqual([
      "separator: the second row of the table is not a separator row",
    ]);
    expect(exitCode(counts)).toBe(1);
  });

  test("blank lines around the table are not content", () => {
    const counts = countMatrix(`\n\n${CONFORMING}\n\n`);
    expect(counts.rows).toBe(5);
    expect(counts.structure).toEqual([]);
  });

  test("a table without a row, and an empty text, are not a conforming zero", () => {
    for (const text of [matrix(), "", "\n\n"]) {
      const counts = countMatrix(text);
      expect(counts.rows).toBe(0);
      expect(exitCode(counts)).toBe(1);
    }
  });
});

describe("command line", () => {
  const script = join(import.meta.dir, "count-parity-matrix.ts");
  const directory = mkdtempSync(join(tmpdir(), "parity-matrix-"));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  function run(...args: string[]): { code: number; stdout: string; stderr: string } {
    const result = Bun.spawnSync([process.execPath, script, ...args]);
    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }

  function write(name: string, text: string): string {
    const path = join(directory, name);
    writeFileSync(path, text);
    return path;
  }

  test("a conforming matrix prints its counters and exits 0", () => {
    const result = run(write("conforming.md", CONFORMING));
    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toEqual([
      "lignes=5",
      "lignes_ecartees=0",
      "colonnes_statut=2",
      "statut natif=5",
      "statut partiel=3",
      "statut absent=1",
      "statut non mesuré=1",
      "AUTRE=0",
      "somme_statuts=10 lignes_x_colonnes_statut=10",
      "verdict reprendre=2",
      "verdict adapter=1",
      "verdict réécrire=1",
      "verdict exclure=1",
      "verdict_autre=0",
      "absent_sans_preuve=0",
      "exclure_sans_decision=0",
      "exclure_avec_source=0",
      "structure=0",
    ]);
  });

  test("a counted violation exits 1 and still prints the counters", () => {
    const result = run(write("violation.md", matrix("| 1 | a | natif | natif | exclure | | | |")));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("exclure_sans_decision=1");
  });

  test("a structure violation exits 1 and names its line", () => {
    const result = run(write("prose.md", `Titre\n${CONFORMING}`));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("structure: line 1");
  });

  test("an absent file exits 2 and prints no counter", () => {
    const result = run(join(directory, "absent.md"));
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
  });

  test("an unreadable path exits 2 and prints no counter", () => {
    // A directory exists and cannot be read as a matrix.
    const result = run(directory);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
  });

  test("no argument, or more than one, exits 2", () => {
    expect(run().code).toBe(2);
    const path = write("twice.md", CONFORMING);
    expect(run(path, path).code).toBe(2);
  });
});

describe("docs/method/PARITY-AUDIT-METHOD.md", () => {
  const method = readFileSync(
    join(import.meta.dir, "..", "..", "docs", "method", "PARITY-AUDIT-METHOD.md"),
    "utf8",
  );
  const sections = method
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());

  test("the seven sections are present, once each, in order", () => {
    const expected = [
      "Périmètre (union)",
      "Verdicts",
      "Statuts et preuve d'absence",
      "Présence et degré",
      "Versions figées",
      "Calibrage v1 et opposabilité (I-27)",
      "Comptage par commande",
    ];
    expect(sections.filter((title) => expected.includes(title))).toEqual(expected);
  });

  test("the four verdicts and the four statuses are named", () => {
    for (const name of ["reprendre", "adapter", "réécrire", "exclure"]) {
      expect(method).toContain(`| **${name}**`);
    }
    for (const name of ["natif", "partiel", "absent", "non mesuré"]) {
      expect(method).toContain(`| **${name}**`);
    }
  });

  test("I-27 and ADR-0027 are cited, and the v1 target stays the recommended MVP", () => {
    expect(method).toContain("I-27");
    expect(method).toContain("ADR-0027");
    expect(method).toContain("spec-baseline");
  });

  test("the count of one particular matrix is not a rule of the method", () => {
    expect(method).not.toContain("59 lignes");
  });

  test("the command the method quotes is the one this file tests", () => {
    expect(method).toContain("bun tools/parity/count-parity-matrix.ts <fichier-matrice>");
    for (const counter of [
      "AUTRE",
      "verdict_autre",
      "absent_sans_preuve",
      "exclure_sans_decision",
      "exclure_avec_source",
    ]) {
      expect(method).toContain(`\`${counter}\``);
      expect(renderCounts(countMatrix(CONFORMING))).toContain(`${counter}=`);
    }
  });
});
