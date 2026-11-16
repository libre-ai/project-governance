/**
 * Trust bench: generator and concordance check of a published measure.
 *
 * A measure of the seeded-defect bench is taken outside CI (it needs a working
 * copy of the measured repository and local models), so what this repository
 * holds is its record: the corpus, the raw measures and their synthesis under
 * `verification/trust-bench/`. This script projects that record into the two
 * surfaces a reader meets:
 *
 * - `distribution/index/trust-bench.v1.json`, the stable data file a site can
 *   read (contract: `ecosystem/schemas/trust-bench.v1.schema.json`);
 * - the generated blocks of the dated evidence report, between
 *   `<!-- trust-bench:begin <name> -->` and `<!-- trust-bench:end <name> -->`.
 *
 * It relays, it does not compute: every figure of the synthesis is copied from
 * `pi-evidence.synthese.json`, every verdict from `pi-evidence.mesures.json`
 * or from a raw line of the launcher. The only things derived here are
 * fingerprints of the source files, the list of verdicts that differ between
 * the two passes, and the counts of what was compared.
 *
 * The launcher and the review write JSONL. This repository refuses a `.jsonl`
 * file outside named exemptions (personal-data boundary, ADR-0012), so the raw
 * lines are versioned as JSON arrays of the same objects in the same order;
 * the fingerprints of the files as measured are in the provenance.
 *
 * Before projecting anything it cross-checks the record against itself, and
 * refuses to generate on a mismatch: each line of the normalised measures
 * against the raw line it comes from, and the synthesis against a fresh run of
 * `synthese.jq`. A source that is missing, empty or unparsable is a failure.
 *
 * With `--check` nothing is written: the data file and every block of the
 * report are compared with a fresh projection, and the comparison prints what
 * it compared. A figure edited by hand in a block, or a stale data file, is
 * a red.
 *
 * Usage: bun verification/trust-bench/build-evidence.ts [--check]
 * Writes: distribution/index/trust-bench.v1.json and the blocks of
 *         distribution/evidence/2026-11-16-trust-bench-first-measure.md
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";

import schema from "../../ecosystem/schemas/trust-bench.v1.schema.json";
import { concludeGate, GateReport } from "../../tools/quality/gate-report";

export const TRUST_BENCH_SCHEMA_VERSION = "libre-ai.trust-bench.v1";
export const TRUST_BENCH_DATA_PATH = "distribution/index/trust-bench.v1.json";
export const TRUST_BENCH_REPORT_PATH =
  "distribution/evidence/2026-11-16-trust-bench-first-measure.md";
const PROVENANCE_PATH = "verification/trust-bench/resultats/pi-evidence.provenance.json";
const SYNTHESIS_FILTER_PATH = "verification/trust-bench/synthese.jq";
const HEALTHY = "SAIN";

const validateDocument = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

// ---------------------------------------------------------------------------
// The record, as the bench wrote it.

interface CorpusLayer {
  readonly id: string;
  readonly cout: number;
  readonly commande: readonly string[];
}
interface CorpusCase {
  readonly id: string;
  readonly attendu: boolean;
  readonly nature: string;
  readonly origine?: string;
}
interface Corpus {
  readonly depot: string;
  readonly couches: readonly CorpusLayer[];
  readonly cas: readonly CorpusCase[];
}
/** One line of the normalised measures, the input of `synthese.jq`. */
interface Measure {
  readonly cas: string;
  readonly couche: string;
  readonly cout: number;
  readonly attendu: boolean;
  readonly rouge: boolean;
  readonly illisible: boolean;
  readonly ms: number;
}
/** One raw line of the launcher. */
interface LauncherLine {
  readonly depot: string;
  readonly revision: string;
  readonly cas: string;
  readonly attendu: boolean;
  readonly nature: string;
  readonly couche: string;
  readonly cout: number;
  readonly code: number;
  readonly attrape: boolean;
  readonly ms: number;
}
/** One raw line of the blind review. */
interface ReviewLine {
  readonly cas: string;
  readonly modele: string;
  readonly defaut: boolean | null;
  readonly illisible: boolean;
  readonly ms: number;
}
interface SynthesisLayer {
  readonly couche: string;
  readonly cout: number;
  readonly defauts_soumis: number;
  readonly defauts_attrapes: number;
  readonly apport_au_dela_du_moins_cher: number;
  readonly cas_de_l_apport: readonly string[];
  readonly sains_soumis: number;
  readonly faux_positifs: number;
  readonly cas_faux_positifs: readonly string[];
  readonly illisibles: number;
  readonly duree_totale_ms: number;
}
interface Synthesis {
  readonly corpus: { readonly defauts: number; readonly sains: number };
  readonly couches: readonly SynthesisLayer[];
  readonly defauts_attrapes_par_aucune_couche: readonly string[];
}
interface Model {
  readonly couche: string;
  readonly etiquette: string;
  readonly nom: string;
  readonly quantification: string;
  readonly fichier: string;
  readonly source_amont: string | null;
  readonly revision_amont: string | null;
  readonly sha256: string | null;
  readonly octets: number | null;
  readonly licence: string | null;
}
interface Provenance {
  readonly id: string;
  readonly date: string;
  readonly depot: string;
  readonly revision: string;
  readonly corpus: string;
  readonly mesures: string;
  readonly synthese: string;
  readonly reference: { readonly fichier: string; readonly condition: string };
  readonly second_passage: {
    readonly fichier: string;
    readonly condition: string;
    readonly statut: string;
  };
  readonly relecture: Readonly<Record<string, string | number>>;
  readonly modeles: readonly Model[];
  /** The files as the bench wrote them, before they were laid out for this repository. */
  readonly fichiers_d_origine: readonly { readonly fichier: string; readonly sha256: string }[];
  readonly limites: readonly string[];
}

export interface TrustBenchRecord {
  readonly provenance: Provenance;
  readonly corpus: Corpus;
  readonly measures: readonly Measure[];
  readonly synthesis: Synthesis;
  /** What `synthese.jq` gives on the measures today; compared with `synthesis`. */
  readonly synthesisReplayed: unknown;
  readonly reference: readonly LauncherLine[];
  readonly secondPass: readonly LauncherLine[];
  /** Review lines by model label. */
  readonly reviews: Readonly<Record<string, readonly ReviewLine[]>>;
  /** Fingerprint of every source file read, by repository-relative path. */
  readonly fingerprints: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// The projection.

interface CaseVerdict {
  readonly couche: string;
  readonly rouge: boolean;
  readonly illisible: boolean;
  readonly ms: number;
}
interface Flip {
  readonly cas: string;
  readonly couche: string;
  readonly reference: boolean;
  readonly second_passage: boolean;
}

function measureDocument(record: TrustBenchRecord) {
  const { provenance, corpus, synthesis } = record;
  const commands = new Map(corpus.couches.map((layer) => [layer.id, layer.commande]));
  const healthy: CorpusCase = {
    id: HEALTHY,
    attendu: false,
    nature: record.reference.find((line) => line.cas === HEALTHY)?.nature ?? "",
    origine: "référence",
  };
  const referenceVerdicts = new Map(
    record.reference.map((line) => [`${line.cas} ${line.couche}`, line.attrape]),
  );
  const flips: Flip[] = record.secondPass.flatMap((line) => {
    const reference = referenceVerdicts.get(`${line.cas} ${line.couche}`);
    return reference === undefined || reference === line.attrape
      ? []
      : [{ cas: line.cas, couche: line.couche, reference, second_passage: line.attrape }];
  });
  return {
    id: provenance.id,
    date: provenance.date,
    depot: provenance.depot,
    revision: provenance.revision,
    corpus: { fichier: provenance.corpus, ...synthesis.corpus },
    couches: synthesis.couches.map((layer) => ({
      ...layer,
      commande: commands.get(layer.couche) ?? null,
    })),
    defauts_attrapes_par_aucune_couche: synthesis.defauts_attrapes_par_aucune_couche,
    cas: [healthy, ...corpus.cas].map((cas) => ({
      id: cas.id,
      attendu: cas.attendu,
      nature: cas.nature,
      origine: cas.origine ?? null,
      verdicts: record.measures
        .filter((measure) => measure.cas === cas.id)
        .map(({ couche, rouge, illisible, ms }): CaseVerdict => ({ couche, rouge, illisible, ms })),
    })),
    relecture: provenance.relecture,
    modeles: provenance.modeles,
    reference: provenance.reference,
    second_passage: {
      ...provenance.second_passage,
      lignes_comparees: record.secondPass.length,
      verdicts: record.secondPass.map(({ cas, couche, attrape, code, ms }) => ({
        cas,
        couche,
        attrape,
        code,
        ms,
      })),
      bascules: flips,
    },
    limites: provenance.limites,
    fichiers_d_origine: provenance.fichiers_d_origine,
    sources: Object.entries(record.fingerprints)
      .map(([fichier, sha256]) => ({ fichier, sha256 }))
      .sort((a, b) => (a.fichier < b.fichier ? -1 : a.fichier > b.fichier ? 1 : 0)),
  };
}

type MeasureDocument = ReturnType<typeof measureDocument>;

interface TrustBenchDocument {
  readonly schema_version: typeof TRUST_BENCH_SCHEMA_VERSION;
  readonly source: string;
  readonly mesures: readonly MeasureDocument[];
}

// ---------------------------------------------------------------------------
// Cross-checks of the record against itself.

export interface CrossCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
}

/**
 * Every line of the normalised measures is confronted with the raw line it
 * was normalised from. The three counts must sum to the number of measures:
 * a line confronted with nothing is a failure, not a line left out.
 */
export function crossCheckRecord(record: TrustBenchRecord): CrossCheck[] {
  const { provenance, corpus, measures, reference, secondPass, reviews } = record;
  const checks: CrossCheck[] = [];
  const byKey = new Map(measures.map((measure) => [`${measure.cas} ${measure.couche}`, measure]));
  checks.push({
    item: provenance.mesures,
    ok: measures.length > 0 && byKey.size === measures.length,
    note: `${measures.length} measure(s), ${byKey.size} distinct (case, layer) pair(s)`,
  });

  const corpusCases = corpus.cas.map((cas) => cas.id);
  const measuredCases = [...new Set(measures.map((measure) => measure.cas))].filter(
    (cas) => cas !== HEALTHY,
  );
  const expectations = corpus.cas.filter((cas) =>
    measures.some((measure) => measure.cas === cas.id && measure.attendu !== cas.attendu),
  );
  checks.push({
    item: provenance.corpus,
    ok: corpusCases.length > 0 && sameSet(corpusCases, measuredCases) && expectations.length === 0,
    note: `${corpusCases.length} case(s) in the corpus, ${measuredCases.length} measured besides ${HEALTHY}, ${expectations.length} with a different expectation`,
  });

  const wrongRevision = [...reference, ...secondPass].filter(
    (line) =>
      line.revision !== provenance.revision || `libre-ai/${line.depot}` !== provenance.depot,
  );
  checks.push({
    item: "revision",
    ok: reference.length > 0 && wrongRevision.length === 0,
    note: `${reference.length + secondPass.length} raw line(s) read, ${wrongRevision.length} outside ${provenance.depot}@${provenance.revision}`,
  });

  let confronted = 0;
  const mismatches: string[] = [];
  const confront = (
    key: string,
    expected: Pick<Measure, "rouge" | "illisible" | "ms"> &
      Partial<Pick<Measure, "attendu" | "cout">>,
  ): void => {
    const measure = byKey.get(key);
    if (measure === undefined) {
      mismatches.push(`${key}: no measure`);
      return;
    }
    confronted += 1;
    for (const [field, value] of Object.entries(expected)) {
      const held = measure[field as keyof Measure];
      if (held !== value)
        mismatches.push(`${key}: ${field} is ${held}, the raw line gives ${value}`);
    }
  };

  for (const line of reference) {
    confront(`${line.cas} ${line.couche}`, {
      rouge: line.attrape,
      illisible: false,
      ms: line.ms,
      attendu: line.attendu,
      cout: line.cout,
    });
  }
  const afterLauncher = confronted;

  const labels = provenance.modeles.map((model) => model.etiquette);
  for (const model of provenance.modeles) {
    for (const line of reviews[model.etiquette] ?? []) {
      if (line.modele !== model.etiquette) mismatches.push(`${line.cas}: review by ${line.modele}`);
      confront(`${line.cas} ${model.couche}`, {
        rouge: line.defaut === true,
        illisible: line.illisible,
        ms: line.ms,
      });
    }
  }
  const afterReviews = confronted;

  // The two crossed layers are derived from the two reviews of the same diff.
  const [first, second] = labels.map((label) => reviews[label] ?? []);
  for (const a of first ?? []) {
    const b = (second ?? []).find((line) => line.cas === a.cas);
    if (b === undefined) {
      mismatches.push(`${a.cas}: reviewed by one model only`);
      continue;
    }
    const crossed = { illisible: a.illisible || b.illisible, ms: a.ms + b.ms };
    confront(`${a.cas} L6-croisee-accord-des-deux`, {
      ...crossed,
      rouge: a.defaut === true && b.defaut === true,
    });
    confront(`${a.cas} L6-croisee-au-moins-un-signale`, {
      ...crossed,
      rouge: a.defaut === true || b.defaut === true,
    });
  }
  checks.push({
    item: "measures against raw lines",
    ok: mismatches.length === 0 && confronted === measures.length,
    note:
      `${confronted} of ${measures.length} measure(s) confronted with a raw line ` +
      `(${afterLauncher} launcher, ${afterReviews - afterLauncher} review, ${confronted - afterReviews} crossed)` +
      (mismatches.length > 0 ? `; ${mismatches.join("; ")}` : ""),
  });

  const referenceKeys = reference.map((line) => `${line.cas} ${line.couche}`);
  const secondKeys = secondPass.map((line) => `${line.cas} ${line.couche}`);
  checks.push({
    item: provenance.second_passage.fichier,
    ok: secondPass.length > 0 && sameSet(referenceKeys, secondKeys),
    note: `${secondKeys.length} line(s) in the second pass, ${referenceKeys.length} in the reference, same (case, layer) pairs required`,
  });

  checks.push({
    item: provenance.synthese,
    ok: Bun.deepEquals(record.synthesis, record.synthesisReplayed, true),
    note: `the committed synthesis against ${SYNTHESIS_FILTER_PATH} replayed on ${measures.length} measure(s), ${record.synthesis.couches.length} layer(s)`,
  });
  return checks;
}

// ---------------------------------------------------------------------------
// The report blocks.

const yesNo = (value: boolean): string => (value ? "oui" : "non");
const orUnrecorded = (value: string | number | null): string =>
  value === null ? "non consigné" : `\`${value}\``;
const list = (values: readonly string[]): string => (values.length === 0 ? "—" : values.join(", "));

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

/** The generated blocks of the report, by name. Every figure comes from the document. */
export function renderBlocks(measure: MeasureDocument): Record<string, string> {
  const layers = measure.couches.map((layer) => layer.couche);
  const deterministic = [...new Set(measure.second_passage.verdicts.map((v) => v.couche))];
  return {
    mesure: [
      `- Dépôt mesuré : \`${measure.depot}\`, révision \`${measure.revision}\`.`,
      `- Date de la mesure : ${measure.date}.`,
      `- Corpus : \`${measure.corpus.fichier}\` — défauts semés : ${measure.corpus.defauts} ; cas sains : ${measure.corpus.sains}, révision d'origine comprise.`,
      `- Mesure de référence : \`${measure.reference.fichier}\` (${measure.reference.condition}).`,
      `- Relecture : température ${measure.relecture.temperature}, graine ${measure.relecture.seed}, ${measure.relecture.max_tokens} tokens de sortie au plus, ${measure.relecture.passages_par_modele} passage par modèle, consigne en ${measure.relecture.langue_de_la_consigne} (\`${measure.relecture.consigne}\`) ; serveur : ${measure.relecture.serveur}.`,
      "",
      table(
        [
          "Modèle",
          "Quantification",
          "Source amont",
          "Révision amont",
          "SHA-256 du fichier",
          "Octets",
          "Licence",
        ],
        measure.modeles.map((model) => [
          model.nom,
          model.quantification,
          orUnrecorded(model.source_amont),
          orUnrecorded(model.revision_amont),
          orUnrecorded(model.sha256),
          orUnrecorded(model.octets),
          orUnrecorded(model.licence),
        ]),
      ),
    ].join("\n"),
    synthese: [
      table(
        [
          "Couche",
          "Coût (ordre posé)",
          "Défauts attrapés",
          "Apport au-delà du moins cher",
          "Faux positifs",
          "Illisibles",
          "Durée totale (ms)",
        ],
        measure.couches.map((layer) => [
          `\`${layer.couche}\``,
          `${layer.cout}`,
          `${layer.defauts_attrapes} / ${layer.defauts_soumis}`,
          `${layer.apport_au_dela_du_moins_cher} (${list(layer.cas_de_l_apport)})`,
          `${layer.faux_positifs} / ${layer.sains_soumis} (${list(layer.cas_faux_positifs)})`,
          `${layer.illisibles}`,
          `${layer.duree_totale_ms}`,
        ]),
      ),
      "",
      `Défauts attrapés par aucune couche : ${list(measure.defauts_attrapes_par_aucune_couche)}.`,
    ].join("\n"),
    cas: table(
      ["Cas", "Défaut attendu", "Nature", ...layers.map((layer) => `\`${layer}\``)],
      measure.cas.map((cas) => [
        cas.id,
        yesNo(cas.attendu),
        cas.nature,
        ...layers.map((layer) => {
          const verdict = cas.verdicts.find((candidate) => candidate.couche === layer);
          if (verdict === undefined) return "non soumis";
          if (verdict.illisible) return verdict.rouge ? "rouge, illisible" : "illisible";
          return verdict.rouge ? "rouge" : "vert";
        }),
      ]),
    ),
    "second-passage": [
      `Fichier : \`${measure.second_passage.fichier}\` (${measure.second_passage.condition}) — ${measure.second_passage.statut}.`,
      "",
      `Lignes comparées à la référence : ${measure.second_passage.lignes_comparees} ; verdicts différents : ${measure.second_passage.bascules.length}.`,
      "",
      table(
        ["Cas", "Couche", "Référence", "Second passage"],
        measure.second_passage.bascules.map((flip) => [
          flip.cas,
          `\`${flip.couche}\``,
          flip.reference ? "rouge" : "vert",
          flip.second_passage ? "rouge" : "vert",
        ]),
      ),
      "",
      table(
        ["Cas", ...deterministic.map((layer) => `\`${layer}\``)],
        measure.cas.map((cas) => [
          cas.id,
          ...deterministic.map((layer) => {
            const verdict = measure.second_passage.verdicts.find(
              (candidate) => candidate.cas === cas.id && candidate.couche === layer,
            );
            if (verdict === undefined) return "non soumis";
            return verdict.attrape ? "rouge" : "vert";
          }),
        ]),
      ),
    ].join("\n"),
    limites: measure.limites.map((limit) => `- ${limit}`).join("\n"),
    sources: [
      table(
        ["Fichier versionné", "SHA-256"],
        measure.sources.map((source) => [`\`${source.fichier}\``, `\`${source.sha256}\``]),
      ),
      "",
      "Fichiers tels que le banc les a écrits, non publiés :",
      "",
      table(
        ["Fichier d'origine", "SHA-256"],
        measure.fichiers_d_origine.map((file) => [`\`${file.fichier}\``, `\`${file.sha256}\``]),
      ),
    ].join("\n"),
  };
}

const MARKER = /<!-- trust-bench:(begin|end) ([a-z0-9-]+) -->/g;

export type BlocksOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Replaces the content of every block of the report. A block the report does
 * not hold, holds twice or holds unclosed is an error, and so is a marker
 * naming a block that is not generated: a table nobody regenerates would sit
 * between markers and read as verified.
 */
export function applyBlocks(
  report: string,
  blocks: Readonly<Record<string, string>>,
): BlocksOutcome {
  const errors: string[] = [];
  const named = new Set([...report.matchAll(MARKER)].map((match) => match[2] ?? ""));
  for (const name of named) {
    if (!(name in blocks)) errors.push(`block ${name}: marked in the report, not generated`);
  }
  let text = report;
  for (const [name, content] of Object.entries(blocks)) {
    const begin = `<!-- trust-bench:begin ${name} -->`;
    const end = `<!-- trust-bench:end ${name} -->`;
    const start = text.indexOf(begin);
    const stop = text.indexOf(end);
    if (start === -1 || stop === -1 || stop < start) {
      errors.push(`block ${name}: begin and end markers not found in order`);
      continue;
    }
    if (text.indexOf(begin, start + 1) !== -1 || text.indexOf(end, stop + 1) !== -1) {
      errors.push(`block ${name}: marked more than once`);
      continue;
    }
    text = `${text.slice(0, start + begin.length)}\n\n${content}\n\n${text.slice(stop)}`;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, text };
}

/** The content the report holds for one block today, or null when it is not there. */
function heldBlock(report: string, name: string): string | null {
  const begin = `<!-- trust-bench:begin ${name} -->`;
  const start = report.indexOf(begin);
  const stop = report.indexOf(`<!-- trust-bench:end ${name} -->`);
  if (start === -1 || stop === -1 || stop < start) return null;
  return report.slice(start + begin.length, stop).trim();
}

const figures = (text: string): number => text.match(/\d+/g)?.length ?? 0;

export type TrustBenchProjection =
  | {
      readonly ok: true;
      readonly json: string;
      readonly report: string;
      readonly gate: GateReport;
    }
  | { readonly ok: false; readonly gate: GateReport };

/**
 * The whole judgement, pure: the record cross-checked, the document validated,
 * and the data file and the report as they are held compared with what the
 * record gives. `heldJson` is null when the data file does not exist yet.
 */
export function projectTrustBench(
  record: TrustBenchRecord,
  heldReport: string,
  heldJson: string | null,
): TrustBenchProjection {
  const gate = new GateReport();
  for (const check of crossCheckRecord(record)) gate.check(check.item, check.ok, check.note);
  if (gate.violations.length > 0) return { ok: false, gate };

  const measure = measureDocument(record);
  const document: TrustBenchDocument = {
    schema_version: TRUST_BENCH_SCHEMA_VERSION,
    source: "verification/trust-bench/build-evidence.ts",
    mesures: [measure],
  };
  const valid = validateDocument(document);
  gate.check(
    "ecosystem/schemas/trust-bench.v1.schema.json",
    valid,
    valid
      ? `the document is inside ${TRUST_BENCH_SCHEMA_VERSION}`
      : `the document is outside ${TRUST_BENCH_SCHEMA_VERSION} (${JSON.stringify(validateDocument.errors)})`,
  );
  if (!valid) return { ok: false, gate };

  const json = `${JSON.stringify(document, null, 2)}\n`;
  // Compared as values, not as text: the committed file is laid out by the
  // formatter of this repository, which a serializer does not reproduce.
  let held: unknown = null;
  let heldNote = "absent";
  if (heldJson !== null) {
    try {
      held = JSON.parse(heldJson);
      heldNote = "differs from the projection of the record";
    } catch (cause) {
      heldNote = `unparsable: ${String(cause)}`;
    }
  }
  const sameData = held !== null && Bun.deepEquals(held, JSON.parse(json), true);
  gate.check(
    TRUST_BENCH_DATA_PATH,
    sameData,
    sameData ? `${figures(json)} figure(s) identical to the projection of the record` : heldNote,
  );

  const blocks = renderBlocks(measure);
  const applied = applyBlocks(heldReport, blocks);
  if (!applied.ok) {
    for (const error of applied.errors) gate.check(TRUST_BENCH_REPORT_PATH, false, error);
    return { ok: false, gate };
  }
  let lines = 0;
  let compared = 0;
  for (const [name, content] of Object.entries(blocks)) {
    const same = heldBlock(heldReport, name) === content;
    lines += content.split("\n").length;
    compared += figures(content);
    gate.check(
      `${TRUST_BENCH_REPORT_PATH} block ${name}`,
      same,
      same
        ? `${content.split("\n").length} line(s) and ${figures(content)} figure(s) identical to the data`
        : "differs from what the data gives",
    );
  }
  gate.volume(
    `${record.measures.length} measure(s) of ${measure.cas.length} case(s) over ${measure.couches.length} layer(s) cross-checked with ` +
      `${record.reference.length + record.secondPass.length} launcher line(s) and ${Object.values(record.reviews).flat().length} review line(s); ` +
      `${Object.keys(blocks).length} report block(s), ${lines} line(s) and ${compared} figure(s) compared with the data; ` +
      `${Object.keys(record.fingerprints).length} source file(s) read`,
  );
  return { ok: true, json, report: applied.text, gate };
}

// ---------------------------------------------------------------------------
// Reads. A source that cannot be read, or is empty, is a failure of the run.

export function readRecord(root: string): TrustBenchRecord {
  const fingerprints: Record<string, string> = {};
  const read = (path: string): string => {
    const bytes = readFileSync(join(root, path));
    const text = bytes.toString("utf8");
    if (text.trim() === "") throw new Error(`${path}: empty`);
    fingerprints[path] = createHash("sha256").update(bytes).digest("hex");
    return text;
  };
  const json = <T>(path: string): T => {
    try {
      return JSON.parse(read(path)) as T;
    } catch (cause) {
      throw new Error(`${path}: ${String(cause)}`);
    }
  };
  // The raw lines of the launcher and of the review, one object per line as
  // they were written, versioned as a JSON array of the same objects.
  const lines = <T>(path: string): T[] => {
    const value = json<unknown>(path);
    if (!Array.isArray(value) || value.length === 0) throw new Error(`${path}: no raw line`);
    return value as T[];
  };

  const provenance = json<Provenance>(PROVENANCE_PATH);
  const measuresText = read(provenance.mesures);
  // Read for its fingerprint and its emptiness; jq reads the file itself.
  read(SYNTHESIS_FILTER_PATH);
  const replay = Bun.spawnSync(["jq", "-f", join(root, SYNTHESIS_FILTER_PATH)], {
    stdin: Buffer.from(measuresText),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (replay.exitCode !== 0) {
    throw new Error(`${SYNTHESIS_FILTER_PATH}: jq exited ${replay.exitCode}: ${replay.stderr}`);
  }
  return {
    provenance,
    corpus: json<Corpus>(provenance.corpus),
    measures: JSON.parse(measuresText) as Measure[],
    synthesis: json<Synthesis>(provenance.synthese),
    synthesisReplayed: JSON.parse(replay.stdout.toString()),
    reference: lines<LauncherLine>(provenance.reference.fichier),
    secondPass: lines<LauncherLine>(provenance.second_passage.fichier),
    reviews: Object.fromEntries(
      provenance.modeles.map((model) => [model.etiquette, lines<ReviewLine>(model.fichier)]),
    ),
    fingerprints,
  };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const check = process.argv.includes("--check");
  let record: TrustBenchRecord;
  let heldReport: string;
  try {
    record = readRecord(root);
    heldReport = readFileSync(join(root, TRUST_BENCH_REPORT_PATH), "utf8");
  } catch (cause) {
    console.error(`Trust bench: unreadable source — ${String(cause)}`);
    process.exit(1);
  }
  const dataFile = Bun.file(join(root, TRUST_BENCH_DATA_PATH));
  const heldJson = (await dataFile.exists()) ? await dataFile.text() : null;

  if (check) {
    concludeGate("Trust bench concordance", projectTrustBench(record, heldReport, heldJson).gate);
  } else {
    const projection = projectTrustBench(record, heldReport, heldJson);
    if (!projection.ok) {
      concludeGate("Trust bench", projection.gate);
      process.exit(1);
    }
    await Bun.write(join(root, TRUST_BENCH_DATA_PATH), projection.json);
    await Bun.write(join(root, TRUST_BENCH_REPORT_PATH), projection.report);
    // Judged again on what was just written: the summary is the one of a check.
    concludeGate(
      "Trust bench written",
      projectTrustBench(record, projection.report, projection.json).gate,
    );
  }
}
