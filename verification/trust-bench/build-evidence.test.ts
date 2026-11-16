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
    expect(failed({ measures: extra })).toEqual(["measures against raw lines"]);
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

  test("a raw line of another revision is a red", () => {
    const reference = record.reference.map((line, index) =>
      index === 0 ? { ...line, revision: "0".repeat(40) } : line,
    );
    expect(failed({ reference })).toEqual(["revision"]);
  });

  test("the second pass is published apart: it changes no figure of the synthesis", () => {
    const all = record.secondPass.map((line) => ({ ...line, attrape: !line.attrape }));
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
      "a source file that leaves the repository",
      withMeasure({ sources: [{ fichier: "../outside", sha256: measure.sources[0].sha256 }] }),
    ],
  ])("refused: %s", (_name, document) => {
    expect(validate(JSON.parse(JSON.stringify(document)))).toBe(false);
  });
});
