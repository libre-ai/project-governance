import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";

import schema from "../../ecosystem/schemas/trust-bench.v1.schema.json";
import {
  applyBlocks,
  crossCheckRecord,
  projectTrustBench,
  readRecord,
  renderBlocks,
  TRUST_BENCH_DATA_PATH,
  TRUST_BENCH_REPORT_PATH,
  TRUST_BENCH_SCHEMA_VERSION,
  type TrustBenchRecord,
} from "./build-evidence";

/**
 * The report and the data file say what the record says, and the record
 * agrees with itself. Each test alters one of the three and expects the red
 * that names it; the control holds the committed state green, so none of
 * these reds is the red of a check that fails on everything.
 */

const root = fileURLToPath(new URL("../..", import.meta.url));
const record = readRecord(root);
const report = readFileSync(join(root, TRUST_BENCH_REPORT_PATH), "utf8");
const data = readFileSync(join(root, TRUST_BENCH_DATA_PATH), "utf8");
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const temporary: string[] = [];
afterAll(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

function violations(
  changed: Partial<TrustBenchRecord>,
  heldReport = report,
  heldData: string | null = data,
): string[] {
  return projectTrustBench({ ...record, ...changed }, heldReport, heldData).gate.violations;
}

describe("concordance of the report, the data file and the record", () => {
  test("control: the committed state holds, and says what it compared", () => {
    const projection = projectTrustBench(record, report, data);
    expect(projection.gate.violations).toEqual([]);
    expect(projection.gate.volumeSummary).toContain(
      `${record.measures.length} measure(s) of ${record.corpus.cas.length + 1} case(s)`,
    );
    expect(projection.gate.volumeSummary).toContain("6 report block(s)");
  });

  test("a figure changed in a table of the report is a red that names the block", () => {
    const row = "| `L2-tests` | 2 | 7 / 10 |";
    expect(report).toContain(row);
    const edited = report.replace(row, "| `L2-tests` | 2 | 8 / 10 |");
    expect(violations({}, edited)).toEqual([
      `${TRUST_BENCH_REPORT_PATH} block synthese: differs from what the data gives`,
    ]);
  });

  test("a verdict changed in the table by case is a red", () => {
    const row = "| D04 | oui | contrôle de dépôt neutralisé | vert | vert | vert | vert | vert |";
    expect(report).toContain(row);
    const edited = report.replace(row, row.replace("vert | vert |", "vert | rouge |"));
    expect(violations({}, edited)).toEqual([
      `${TRUST_BENCH_REPORT_PATH} block cas: differs from what the data gives`,
    ]);
  });

  test("a limit softened in the report is a red", () => {
    const edited = report.replace("ne se transposent pas", "se transposent mal");
    expect(edited).not.toBe(report);
    expect(violations({}, edited)).toEqual([
      `${TRUST_BENCH_REPORT_PATH} block limites: differs from what the data gives`,
    ]);
  });

  test("a figure changed in the data file, or a data file absent, is a red", () => {
    const edited = data.replace('"defauts_attrapes": 7', '"defauts_attrapes": 8');
    expect(edited).not.toBe(data);
    expect(violations({}, report, edited)).toEqual([
      `${TRUST_BENCH_DATA_PATH}: differs from the projection of the record`,
    ]);
    expect(violations({}, report, null)).toEqual([`${TRUST_BENCH_DATA_PATH}: absent`]);
  });

  test("a block marker removed, repeated or unknown is a red", () => {
    const blocks = { synthese: "x" };
    const held = "a\n<!-- trust-bench:begin synthese -->\n<!-- trust-bench:end synthese -->\n";
    expect(applyBlocks(held, blocks).ok).toBe(true);
    expect(applyBlocks(held.replace("<!-- trust-bench:end synthese -->", ""), blocks).ok).toBe(
      false,
    );
    expect(applyBlocks(held + held, blocks).ok).toBe(false);
    const unknown = `${held}<!-- trust-bench:begin autre -->\n<!-- trust-bench:end autre -->\n`;
    expect(applyBlocks(unknown, blocks)).toEqual({
      ok: false,
      errors: ["block autre: marked in the report, not generated"],
    });
  });

  test("regenerating the committed report changes nothing", () => {
    const projection = projectTrustBench(record, report, data);
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    expect(projection.report).toBe(report);
    expect(JSON.parse(projection.json)).toEqual(JSON.parse(data));
  });
});

describe("cross-check of the record against itself", () => {
  const failed = (changed: Partial<TrustBenchRecord>): string[] =>
    crossCheckRecord({ ...record, ...changed })
      .filter((check) => !check.ok)
      .map((check) => check.item);

  test("control: every measure is confronted with a raw line", () => {
    const checks = crossCheckRecord(record);
    expect(checks.filter((check) => !check.ok)).toEqual([]);
    expect(checks.find((check) => check.item === "measures against raw lines")?.note).toContain(
      `${record.measures.length} of ${record.measures.length} measure(s) confronted`,
    );
  });

  test("a verdict that the raw line does not give is a red, and nothing is generated", () => {
    const measures = record.measures.map((measure) =>
      measure.cas === "D04" && measure.couche === "L2-tests"
        ? { ...measure, rouge: true }
        : measure,
    );
    expect(failed({ measures })).toEqual(["measures against raw lines"]);
    expect(projectTrustBench({ ...record, measures }, report, data).ok).toBe(false);
  });

  test("a duration that the raw line does not give is a red", () => {
    const measures = record.measures.map((measure, index) =>
      index === 0 ? { ...measure, ms: measure.ms + 1 } : measure,
    );
    expect(failed({ measures })).toEqual(["measures against raw lines"]);
  });

  test("a measure no raw line accounts for, or a raw line with no measure, is a red", () => {
    const first = record.measures[0];
    if (first === undefined) throw new Error("no measure");
    const extra = [...record.measures, { ...first, couche: "L9-inconnue" }];
    // Nothing declares the layer of the extra measure either.
    expect(failed({ measures: extra })).toEqual(["layers", "measures against raw lines"]);
    expect(failed({ measures: record.measures.slice(1) })).toEqual(["measures against raw lines"]);
  });

  test("a synthesis that the filter does not give on the measures is a red", () => {
    const synthesis = {
      ...record.synthesis,
      corpus: { ...record.synthesis.corpus, defauts: record.synthesis.corpus.defauts + 1 },
    };
    expect(failed({ synthesis })).toEqual([record.provenance.synthese]);
  });

  test("a second pass over other cases than the reference is a red", () => {
    expect(failed({ secondPass: record.secondPass.slice(1) })).toEqual([
      record.provenance.second_passage.fichier,
    ]);
    expect(failed({ secondPass: [] })).toEqual([record.provenance.second_passage.fichier]);
  });

  test("a layer measured at two costs is a red that names the layer and its costs", () => {
    // A review layer: no launcher line carries its cost, so only the cost check can see it.
    const layer = record.provenance.modeles[0]?.couche ?? "";
    let changed = false;
    const measures = record.measures.map((measure) => {
      if (changed || measure.couche !== layer) return measure;
      changed = true;
      return { ...measure, cout: measure.cout + 5 };
    });
    expect(changed).toBe(true);
    expect(failed({ measures })).toEqual(["layer costs"]);
    const note = crossCheckRecord({ ...record, measures }).find(
      (check) => check.item === "layer costs",
    )?.note;
    expect(note).toContain(`${layer} (4, 9)`);
  });

  test("a case whose expectation in the corpus differs from its measures is a red", () => {
    // The raw lines and the measures agree with each other: only the corpus says otherwise.
    const corpus = {
      ...record.corpus,
      cas: record.corpus.cas.map((cas) => (cas.id === "D04" ? { ...cas, attendu: false } : cas)),
    };
    expect(failed({ corpus })).toEqual([record.provenance.corpus]);
    expect(
      crossCheckRecord({ ...record, corpus }).find((c) => c.item === record.provenance.corpus)
        ?.note,
    ).toContain("1 with a different expectation");
  });

  test("a review line written by another model than its label is a red", () => {
    const [model] = record.provenance.modeles;
    if (model === undefined) throw new Error("no model");
    const lines = (record.reviews[model.etiquette] ?? []).map((line, index) =>
      index === 0 ? { ...line, modele: "autre-modele" } : line,
    );
    const reviews = { ...record.reviews, [model.etiquette]: lines };
    expect(failed({ reviews })).toEqual(["measures against raw lines"]);
    expect(
      crossCheckRecord({ ...record, reviews }).find((c) => c.item === "measures against raw lines")
        ?.note,
    ).toContain("review by autre-modele");
  });

  test("a raw line of another revision is a red", () => {
    const reference = record.reference.map((line, index) =>
      index === 0 ? { ...line, revision: "0".repeat(40) } : line,
    );
    expect(failed({ reference })).toEqual(["revision"]);
  });

  test("a raw line read twice does not stand for a raw line that is missing", () => {
    const label = record.provenance.modeles[0]?.etiquette ?? "";
    const lines = record.reviews[label] ?? [];
    const t01 = lines.find((line) => line.cas === "T01");
    if (t01 === undefined) throw new Error("no review of T01");
    expect(lines.some((line) => line.cas === "T04")).toBe(true);
    // As many raw lines as before, and as many confrontations: T04 is gone, T01 is there twice.
    const duplicated = lines.map((line) => (line.cas === "T04" ? t01 : line));
    const checks = crossCheckRecord({
      ...record,
      reviews: { ...record.reviews, [label]: duplicated },
    });
    const check = checks.find((candidate) => candidate.item === "measures against raw lines");
    expect(check?.ok).toBe(false);
    expect(check?.note).toContain(
      `T01 ${record.provenance.modeles[0]?.couche}: more than one raw line`,
    );
    expect(check?.note).toContain(`T04 ${record.provenance.modeles[0]?.couche}: no raw line`);
  });

  test("a launcher line in delay or killed by a signal is never published green", () => {
    const interrupted = (change: { delai: boolean; signal?: string; code: number | null }) => {
      const reference = record.reference.map((line) =>
        line.cas === "D04" && line.couche === "L2-tests" ? { ...line, ...change } : line,
      );
      const measures = record.measures.map((measure) =>
        measure.cas === "D04" && measure.couche === "L2-tests"
          ? { ...measure, illisible: true }
          : measure,
      );
      const synthesis = {
        ...record.synthesis,
        couches: record.synthesis.couches.map((layer) =>
          layer.couche === "L2-tests" ? { ...layer, illisibles: layer.illisibles + 1 } : layer,
        ),
      };
      return { reference, measures, synthesis, synthesisReplayed: synthesis };
    };
    const row = (text: string) => text.split("\n").find((line) => line.startsWith("| D04 |")) ?? "";
    expect(row(report)).toBe(
      "| D04 | oui | contrôle de dépôt neutralisé | vert | vert | vert | vert | vert | rouge | rouge | rouge | rouge |",
    );

    // The measures still say green where the raw line says the layer did not finish: a red.
    const delayed = interrupted({ delai: true, code: 124 });
    expect(failed({ reference: delayed.reference })).toEqual(["measures against raw lines"]);

    // The measures agree with the raw line: the cell names the state, and is not a green.
    const afterDelay = projectTrustBench({ ...record, ...delayed }, report, data);
    expect(afterDelay.gate.violations.filter((v) => v.includes("raw"))).toEqual([]);
    if (!afterDelay.ok) throw new Error(afterDelay.gate.violations.join("\n"));
    expect(row(afterDelay.report)).toBe(
      "| D04 | oui | contrôle de dépôt neutralisé | vert | vert | délai dépassé | vert | vert | rouge | rouge | rouge | rouge |",
    );

    const afterSignal = projectTrustBench(
      { ...record, ...interrupted({ delai: false, signal: "SIGKILL", code: null }) },
      report,
      data,
    );
    if (!afterSignal.ok) throw new Error(afterSignal.gate.violations.join("\n"));
    expect(row(afterSignal.report)).toBe(
      "| D04 | oui | contrôle de dépôt neutralisé | vert | vert | tuée par signal (SIGKILL) | vert | vert | rouge | rouge | rouge | rouge |",
    );
  });

  test("a raw launcher line that contradicts itself is a red", () => {
    const altered = (change: Record<string, unknown>) =>
      record.reference.map((line, index) => (index === 0 ? { ...line, ...change } : line));
    // Caught without a non-zero exit, in delay and caught, in delay and killed, no `delai` at all.
    for (const change of [
      { attrape: true },
      { delai: true, attrape: true, code: 124 },
      { delai: true, signal: "SIGKILL", code: null },
      { delai: undefined },
    ]) {
      expect(failed({ reference: altered(change) }), JSON.stringify(change)).toContain(
        "raw launcher lines",
      );
    }
  });

  test("an interruption of the second pass is a difference with the reference", () => {
    const secondPass = record.secondPass.map((line) =>
      line.cas === "T01" && line.couche === "L1a-lint"
        ? { ...line, delai: true, code: null }
        : line,
    );
    const projection = projectTrustBench({ ...record, secondPass }, report, data);
    if (!projection.ok) throw new Error(projection.gate.violations.join("\n"));
    expect(projection.report).toContain("| T01 | `L1a-lint` | vert | délai dépassé |");
    expect(projection.report).toContain("| T01 | délai dépassé | vert | vert | vert | vert |");
  });

  test("the second pass is published apart: it changes no figure of the synthesis", () => {
    const all = record.secondPass.map((line) => ({
      ...line,
      attrape: !line.attrape,
      code: line.attrape ? 0 : 1,
    }));
    const projection = projectTrustBench({ ...record, secondPass: all }, report, data);
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    const [measure] = JSON.parse(projection.json).mesures;
    const blocks = renderBlocks(measure);
    const held = renderBlocks(JSON.parse(data).mesures[0]);
    expect(blocks.synthese).toBe(held.synthese as string);
    expect(blocks.cas).toBe(held.cas as string);
    expect(blocks["second-passage"]).not.toBe(held["second-passage"] as string);
  });
});

describe("a layer derived from other layers", () => {
  const derived = record.synthesis.couches.filter((layer) => layer.derivee_de !== null);
  const reviews = record.provenance.modeles.map((model) => model.couche);

  /** `synthese.jq` on measures of one's own, with the derived layers one declares. */
  function synthesise(
    measures: readonly Record<string, unknown>[],
    couches_derivees: unknown,
  ): { code: number; layers: Record<string, { apport: unknown; cas: unknown }>; stderr: string } {
    const directory = mkdtempSync(join(tmpdir(), "trust-bench-synthesis-"));
    temporary.push(directory);
    const provenance = join(directory, "provenance.json");
    writeFileSync(provenance, JSON.stringify({ couches_derivees }));
    const run = Bun.spawnSync(
      [
        "jq",
        "--slurpfile",
        "provenance",
        provenance,
        "-f",
        join(root, "verification/trust-bench/synthese.jq"),
      ],
      { stdin: Buffer.from(JSON.stringify(measures)), stdout: "pipe", stderr: "pipe" },
    );
    const layers: Record<string, { apport: unknown; cas: unknown }> = {};
    if (run.exitCode === 0) {
      for (const layer of JSON.parse(run.stdout.toString()).couches) {
        layers[layer.couche] = {
          apport: layer.apport_au_dela_du_moins_cher,
          cas: layer.cas_de_l_apport,
        };
      }
    }
    return { code: run.exitCode, layers, stderr: run.stderr.toString() };
  }
  const measure = (couche: string, cout: number, cas: string, rouge: boolean) => ({
    cas,
    couche,
    cout,
    attendu: true,
    rouge,
    illisible: false,
    ms: 1,
  });
  // Two layers of their own, and a third, dearer, red wherever one of them is.
  const MEASURES = [
    measure("A", 1, "D1", true),
    measure("A", 1, "D2", false),
    measure("B", 4, "D1", false),
    measure("B", 4, "D2", true),
    measure("X", 5, "D1", true),
    measure("X", 5, "D2", true),
  ];

  test("the committed synthesis declares the two crossed layers derived, with no contribution", () => {
    expect(derived.map((layer) => layer.couche)).toEqual([
      "L6-croisee-accord-des-deux",
      "L6-croisee-au-moins-un-signale",
    ]);
    for (const layer of derived) {
      expect(layer.derivee_de).toEqual(reviews);
      expect(layer.apport_au_dela_du_moins_cher).toBeNull();
      expect(layer.cas_de_l_apport).toBeNull();
    }
    const rows = report.split("\n").filter((line) => line.startsWith("| `L6-"));
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.split(" | ")[3]).toBe("non applicable (couche dérivée)");
  });

  test("the contribution of a derived layer is not applicable, whatever it caught", () => {
    // Not declared, X is a layer like another: cheaper layers already caught both of its
    // defects, and its contribution is a computed 0.
    expect(synthesise(MEASURES, []).layers).toEqual({
      A: { apport: 1, cas: ["D1"] },
      B: { apport: 1, cas: ["D2"] },
      X: { apport: 0, cas: [] },
    });
    // Declared derived from A and B, the same 0 is no measure: it could be nothing else.
    expect(synthesise(MEASURES, [{ couche: "X", derivee_de: ["A", "B"] }]).layers).toEqual({
      A: { apport: 1, cas: ["D1"] },
      B: { apport: 1, cas: ["D2"] },
      X: { apport: null, cas: null },
    });
  });

  test("a derived layer does not count as a cheaper layer for the others", () => {
    const cheapDerived = MEASURES.map((line) =>
      line.couche === "X" ? { ...line, cout: 2 } : line,
    );
    expect(synthesise(cheapDerived, [{ couche: "X", derivee_de: ["A", "B"] }]).layers.B).toEqual({
      apport: 1,
      cas: ["D2"],
    });
  });

  test("a declaration the measures do not bear, or no declaration, fails the synthesis", () => {
    const absent = synthesise(MEASURES, [{ couche: "Y", derivee_de: ["A", "B"] }]);
    expect(absent.code).not.toBe(0);
    expect(absent.stderr).toContain("Y");
    const unknownSource = synthesise(MEASURES, [{ couche: "X", derivee_de: ["A", "Z"] }]);
    expect(unknownSource.code).not.toBe(0);
    expect(unknownSource.stderr).toContain("Z");
    expect(synthesise(MEASURES, null).code).not.toBe(0);
  });

  test("a measured layer that nothing declares, launched, reviewed or derived, is a red", () => {
    const provenance = { ...record.provenance, couches_derivees: [] };
    const failures = crossCheckRecord({ ...record, provenance })
      .filter((check) => !check.ok)
      .map((check) => `${check.item}: ${check.note}`);
    expect(failures.join("\n")).toContain(
      "layers: 9 layer(s) measured, 5 launched, 2 reviewed, 0 derived, 2 declared by nothing (L6-croisee-accord-des-deux, L6-croisee-au-moins-un-signale)",
    );
  });

  test("a derived layer declared under a rule the check does not know is a red", () => {
    const provenance = {
      ...record.provenance,
      couches_derivees: record.provenance.couches_derivees.map((layer, index) =>
        index === 0 ? { ...layer, regle: "majorite" } : layer,
      ),
    };
    const check = crossCheckRecord({ ...record, provenance }).find(
      (candidate) => candidate.item === "measures against raw lines",
    );
    expect(check?.ok).toBe(false);
    expect(check?.note).toContain("unknown rule majorite");
  });

  // The prose of the report is outside the generated blocks, and nothing else
  // reads it: this holds the one sentence the measure cannot bear.
  test("the report does not state a contribution of the crossed review", () => {
    expect(report).not.toMatch(/apport[^.\n]*crois[ée]e?s?[^.\n]*(nul|zéro|\b0\b)/i);
    expect(report).toContain("ce corpus ne permet pas de dire ce qu'elle vaut");
  });
});

describe("what the check says it compared", () => {
  const projection = projectTrustBench(record, report, data);
  const note = (item: string): string =>
    projection.gate.checks.find((check) => check.item === item)?.note ?? "";

  test("the blocks are counted in lines and table cells, a fingerprint is one cell", () => {
    const measure = JSON.parse(data).mesures[0];
    // Two tables of two columns: a header row each, and one row per file.
    const cells = 2 * (measure.sources.length + measure.fichiers_d_origine.length + 2);
    expect(note(`${TRUST_BENCH_REPORT_PATH} block sources`)).toContain(
      ` line(s) and ${cells} table cell(s) identical to the data`,
    );
    expect(projection.gate.volumeSummary).toContain(" table cell(s) compared with the data");
    expect(projection.gate.volumeSummary).not.toContain("figure");
  });

  test("the data file is counted in values by kind, not in runs of digits", () => {
    const counts = { number: 0, boolean: 0, string: 0, null: 0 };
    const walk = (value: unknown): void => {
      if (value === null) counts.null += 1;
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === "object") Object.values(value).forEach(walk);
      else if (typeof value === "number") counts.number += 1;
      else if (typeof value === "boolean") counts.boolean += 1;
      else counts.string += 1;
    };
    walk(JSON.parse(data));
    expect(counts.number).toBeGreaterThan(0);
    expect(note(TRUST_BENCH_DATA_PATH)).toBe(
      `${counts.number} number(s), ${counts.boolean} boolean(s), ${counts.string} string(s) and ${counts.null} null(s) identical to the projection of the record`,
    );
  });
});

describe("sources", () => {
  test("a source missing or empty fails the read", () => {
    const empty = mkdtempSync(join(tmpdir(), "trust-bench-evidence-"));
    temporary.push(empty);
    expect(() => readRecord(empty)).toThrow();

    const copy = mkdtempSync(join(tmpdir(), "trust-bench-evidence-"));
    temporary.push(copy);
    cpSync(join(root, "verification/trust-bench"), join(copy, "verification/trust-bench"), {
      recursive: true,
    });
    expect(readRecord(copy).measures.length).toBe(record.measures.length);
    writeFileSync(join(copy, record.provenance.reference.fichier), "\n");
    expect(() => readRecord(copy)).toThrow(`${record.provenance.reference.fichier}: empty`);
  });

  test("the limit on reformatted files names the file kept to the byte", () => {
    // Derived from the fingerprints, not from the prose: an original whose fingerprint is the
    // one of the versioned file was not reformatted, and the limit must not say it was.
    const identical = record.provenance.fichiers_d_origine
      .filter(
        (file) => record.fingerprints[`verification/trust-bench/${file.fichier}`] === file.sha256,
      )
      .map((file) => file.fichier);
    expect(identical).toEqual(["resultats/pi-evidence.mesures.json"]);
    const limit = record.provenance.limites.find((text) => text.includes("remis en forme")) ?? "";
    expect(limit).not.toBe("");
    for (const file of identical) expect(limit).toContain(file);
  });

  test("no source carries a path of the machine that measured", () => {
    const sources = Object.keys(record.fingerprints);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      const text = readFileSync(join(root, source), "utf8");
      expect(text, source).not.toMatch(/\/(Users|home|var\/folders|private\/tmp)\//);
    }
  });
});

describe("trust-bench.v1 schema", () => {
  const committed = JSON.parse(data);
  const [measure] = committed.mesures;
  const withMeasure = (changes: Record<string, unknown>) => ({
    ...committed,
    mesures: [{ ...measure, ...changes }],
  });

  test("the committed file is valid", () => {
    expect(committed.schema_version).toBe(TRUST_BENCH_SCHEMA_VERSION);
    expect(validate(committed), JSON.stringify(validate.errors)).toBe(true);
  });

  // Each constraint named here has a document it refuses: removing the
  // constraint turns its case green, and this test red.
  test.each([
    ["another schema version", { ...committed, schema_version: "libre-ai.trust-bench.v2" }],
    ["another source", { ...committed, source: "hand-written" }],
    ["a field the contract does not have", { ...committed, note: "a sentence" }],
    ["no measure", { ...committed, mesures: [] }],
    ["a repository outside the organization", withMeasure({ depot: "other/pi-evidence" })],
    ["an abbreviated revision", withMeasure({ revision: "fd2dfac" })],
    ["a measure without its limits", withMeasure({ limites: [] })],
    ["a measure without its second pass kept apart", withMeasure({ second_passage: undefined })],
    [
      "a model identified by neither fingerprint nor upstream revision",
      withMeasure({ modeles: [{ ...measure.modeles[0], sha256: null, revision_amont: null }] }),
    ],
    [
      "a derived layer with a contribution, even of 0",
      withMeasure({
        couches: measure.couches.map((layer: { derivee_de: unknown }) =>
          layer.derivee_de === null ? layer : { ...layer, apport_au_dela_du_moins_cher: 0 },
        ),
      }),
    ],
    [
      "a layer of its own without a contribution",
      withMeasure({
        couches: measure.couches.map((layer: { derivee_de: unknown }) =>
          layer.derivee_de === null ? { ...layer, apport_au_dela_du_moins_cher: null } : layer,
        ),
      }),
    ],
    [
      "a layer derived from a single layer",
      withMeasure({
        couches: measure.couches.map((layer: { derivee_de: unknown }) =>
          layer.derivee_de === null ? layer : { ...layer, derivee_de: ["L5"] },
        ),
      }),
    ],
    [
      "a verdict with an interruption that is not named",
      withMeasure({
        cas: measure.cas.map((cas: { verdicts: object[] }) => ({
          ...cas,
          verdicts: cas.verdicts.map((verdict) => ({ ...verdict, interruption: "autre" })),
        })),
      }),
    ],
    [
      "a source file that leaves the repository",
      withMeasure({ sources: [{ fichier: "../outside", sha256: measure.sources[0].sha256 }] }),
    ],
  ])("refused: %s", (_name, document) => {
    expect(validate(JSON.parse(JSON.stringify(document)))).toBe(false);
  });
});
