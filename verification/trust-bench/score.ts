// Score of the review layer, corpus by corpus, and the acceptance rule of a reviewer change.
//
// A run of relecture.ts writes one verdict per diff. This module confronts those verdicts with the
// corpus they were taken on, and prints, for each corpus apart:
//   défauts attrapés : <caught> / <defects of the corpus>
//   fausses alertes  : <alerts on witnesses> / <witnesses of the corpus>
// with the unreadable replies and the cases nobody reviewed named apart: they are neither caught
// nor clean, and they never shrink a denominator. Two corpora are never summed: the seeded defects
// of the synthetic corpus are caught by every model measured so far, and a total would hide a fall
// on the observed one.
//
// Acceptance rule (EXP-02). A change of the reviewer — its instructions, its tools or its model —
// is kept only if, on the observed corpus, the defects caught do not fall and the false alerts do
// not rise, the two runs being complete (no unreadable reply, no case unreviewed) and taken on the
// same corpus. Otherwise it is rejected; on an incomplete run, on another corpus, or on the
// synthetic corpus, the rule is undecidable and nothing is kept. The rule is not run in CI: a
// review needs a local model server (relecture.ts refuses any other address), which CI does not
// have. It is run where the review is run.
//
// Usage: bun verification/trust-bench/score.ts <corpus.json> <résultats> [<corpus.json> <résultats> ...]
//        bun verification/trust-bench/score.ts accepte <corpus.json> <résultats avant> <résultats après>
// <résultats> is the JSONL written by relecture.ts, or the JSON array this repository versions.
// The origin of each corpus is read from corpus/index.json.
// Exit codes of `accepte`: 0 kept, 1 rejected, 3 undecidable; 2 usage or unreadable input.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS_DIRECTORY, type CorpusOrigin, parseCorpusIndex } from "./corpora";

export interface ReviewLine {
  readonly cas: string;
  readonly modele: string;
  readonly defaut: boolean | null;
  readonly illisible: boolean;
}
export interface ScoreInput {
  readonly corpus: string;
  readonly origine: CorpusOrigin;
  readonly cas: readonly { readonly id: string; readonly attendu: boolean }[];
  /** Where the lines come from, printed with the score. */
  readonly resultats: string;
  readonly lignes: readonly ReviewLine[];
}
export interface CorpusScore {
  readonly corpus: string;
  readonly origine: CorpusOrigin;
  readonly modele: string;
  readonly resultats: string;
  readonly defauts: {
    readonly attrapes: number;
    readonly total: number;
    readonly manques: readonly string[];
    readonly illisibles: readonly string[];
    readonly non_relus: readonly string[];
  };
  readonly temoins: {
    readonly fausses_alertes: number;
    readonly total: number;
    readonly cas_fausses_alertes: readonly string[];
    readonly illisibles: readonly string[];
    readonly non_relus: readonly string[];
  };
}

/** Reads the review lines, as JSONL or as a JSON array; a line that is not a review line is an error. */
export function parseReviewLines(text: string): ReviewLine[] {
  const trimmed = text.trim();
  if (trimmed === "") throw new Error("résultats vides");
  const values: unknown[] = trimmed.startsWith("[")
    ? (JSON.parse(trimmed) as unknown[])
    : trimmed.split("\n").map((line) => JSON.parse(line) as unknown);
  return values.map((value, position) => {
    const line = value as Partial<ReviewLine>;
    if (
      typeof line !== "object" ||
      line === null ||
      typeof line.cas !== "string" ||
      typeof line.modele !== "string" ||
      !(typeof line.defaut === "boolean" || line.defaut === null) ||
      typeof line.illisible !== "boolean" ||
      line.illisible !== (line.defaut === null)
    ) {
      throw new Error(
        `ligne ${position + 1} : pas une ligne de relecture (cas, modele, defaut, illisible)`,
      );
    }
    return { cas: line.cas, modele: line.modele, defaut: line.defaut, illisible: line.illisible };
  });
}

export function scoreCorpus(input: ScoreInput): CorpusScore {
  const { lignes } = input;
  if (lignes.length === 0) throw new Error(`${input.resultats} : aucune ligne de relecture`);
  const models = [...new Set(lignes.map((line) => line.modele))];
  if (models.length !== 1)
    throw new Error(
      `${input.resultats} : un passage porte un seul modèle, reçu ${models.join(", ")}`,
    );
  const known = new Set(input.cas.map((cas) => cas.id));
  const byCase = new Map<string, ReviewLine>();
  for (const line of lignes) {
    if (!known.has(line.cas))
      throw new Error(
        `${input.resultats} : ${line.cas} n'est pas un cas du corpus ${input.corpus}`,
      );
    if (byCase.has(line.cas))
      throw new Error(`${input.resultats} : ${line.cas} relu plus d'une fois`);
    byCase.set(line.cas, line);
  }
  const of = (attendu: boolean) =>
    input.cas.filter((cas) => cas.attendu === attendu).map((cas) => cas.id);
  const defects = of(true);
  const witnesses = of(false);
  const where = (ids: readonly string[], keep: (line: ReviewLine | undefined) => boolean) =>
    ids.filter((id) => keep(byCase.get(id)));
  const caught = where(defects, (line) => line?.defaut === true);
  const alerts = where(witnesses, (line) => line?.defaut === true);
  return {
    corpus: input.corpus,
    origine: input.origine,
    modele: models[0] ?? "",
    resultats: input.resultats,
    defauts: {
      attrapes: caught.length,
      total: defects.length,
      manques: where(defects, (line) => line?.defaut === false),
      illisibles: where(defects, (line) => line?.illisible === true),
      non_relus: where(defects, (line) => line === undefined),
    },
    temoins: {
      fausses_alertes: alerts.length,
      total: witnesses.length,
      cas_fausses_alertes: alerts,
      illisibles: where(witnesses, (line) => line?.illisible === true),
      non_relus: where(witnesses, (line) => line === undefined),
    },
  };
}

const named = (ids: readonly string[]): string => (ids.length === 0 ? "—" : ids.join(", "));

/** One block per corpus and model; no line over two corpora. */
export function renderScores(scores: readonly CorpusScore[]): string {
  const keys = scores.map((score) => `${score.corpus} ${score.modele}`);
  const twice = keys.filter((key, position) => keys.indexOf(key) !== position);
  if (twice.length > 0)
    throw new Error(`corpus noté deux fois pour le même modèle : ${twice.join(", ")}`);
  return scores
    .map((score) => {
      const missed =
        score.defauts.manques.length > 0 ? ` (manqués : ${named(score.defauts.manques)})` : "";
      return [
        `corpus ${score.corpus} (${score.origine}), modèle ${score.modele}, résultats ${score.resultats}`,
        `  défauts attrapés : ${score.defauts.attrapes} / ${score.defauts.total}${missed}`,
        `  fausses alertes : ${score.temoins.fausses_alertes} / ${score.temoins.total} (${named(score.temoins.cas_fausses_alertes)})`,
        `  illisibles : ${named([...score.defauts.illisibles, ...score.temoins.illisibles])} ; non relus : ${named([...score.defauts.non_relus, ...score.temoins.non_relus])}`,
      ].join("\n");
    })
    .join("\n\n");
}

export type AcceptanceDecision = "garde" | "rejete" | "indecidable";
export interface Acceptance {
  readonly decision: AcceptanceDecision;
  readonly motifs: readonly string[];
}

const incomplete = (score: CorpusScore): string[] => [
  ...score.defauts.illisibles,
  ...score.temoins.illisibles,
  ...score.defauts.non_relus,
  ...score.temoins.non_relus,
];

/** The acceptance rule of a reviewer change, judged on two runs of the observed corpus. */
export function decideAcceptance(before: CorpusScore, after: CorpusScore): Acceptance {
  const undecidable: string[] = [];
  for (const [name, score] of [
    ["avant", before],
    ["après", after],
  ] as const) {
    if (score.origine !== "observed")
      undecidable.push(
        `${name} : corpus ${score.corpus} (${score.origine}), la règle ne lit que le corpus observé`,
      );
    const gaps = incomplete(score);
    if (gaps.length > 0)
      undecidable.push(`${name} : passage incomplet, illisibles ou non relus : ${gaps.join(", ")}`);
  }
  if (
    before.corpus !== after.corpus ||
    before.defauts.total !== after.defauts.total ||
    before.temoins.total !== after.temoins.total
  )
    undecidable.push(
      `les deux passages ne portent pas sur le même corpus (${before.corpus}, ${after.corpus})`,
    );
  if (undecidable.length > 0) return { decision: "indecidable", motifs: undecidable };

  const caught = `défauts attrapés ${before.defauts.attrapes} / ${before.defauts.total} → ${after.defauts.attrapes} / ${after.defauts.total}`;
  const alerts = `fausses alertes ${before.temoins.fausses_alertes} / ${before.temoins.total} → ${after.temoins.fausses_alertes} / ${after.temoins.total}`;
  const reasons: string[] = [];
  if (after.defauts.attrapes < before.defauts.attrapes) reasons.push(`baisse : ${caught}`);
  if (after.temoins.fausses_alertes > before.temoins.fausses_alertes)
    reasons.push(`hausse : ${alerts}`);
  return reasons.length > 0
    ? { decision: "rejete", motifs: reasons }
    : { decision: "garde", motifs: [caught, alerts] };
}

// ---------------------------------------------------------------------------
// Command line.

function loadCorpus(root: string, path: string): Omit<ScoreInput, "resultats" | "lignes"> {
  const index = parseCorpusIndex(readFileSync(join(root, CORPUS_DIRECTORY, "index.json"), "utf8"));
  if (!index.ok) throw new Error(index.errors.join("\n"));
  const declared = relative(root, join(process.cwd(), path));
  const entry = index.value.find((candidate) => candidate.fichier === declared);
  if (entry === undefined)
    throw new Error(`${path} : corpus absent de ${CORPUS_DIRECTORY}/index.json`);
  const corpus = JSON.parse(readFileSync(path, "utf8")) as {
    corpus?: string;
    depot?: string;
    cas: { id: string; attendu: boolean }[];
  };
  return {
    corpus: corpus.corpus ?? corpus.depot ?? declared,
    origine: entry.origine,
    cas: corpus.cas.map((cas) => ({ id: cas.id, attendu: cas.attendu })),
  };
}
function scoreFile(root: string, corpusPath: string, results: string): CorpusScore {
  return scoreCorpus({
    ...loadCorpus(root, corpusPath),
    resultats: results,
    lignes: parseReviewLines(readFileSync(results, "utf8")),
  });
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const args = process.argv.slice(2);
  const USAGE =
    "usage: bun verification/trust-bench/score.ts <corpus.json> <résultats> [<corpus.json> <résultats> ...]\n" +
    "       bun verification/trust-bench/score.ts accepte <corpus.json> <résultats avant> <résultats après>";
  try {
    if (args[0] === "accepte") {
      const [, corpusPath, beforePath, afterPath] = args;
      if (
        corpusPath === undefined ||
        beforePath === undefined ||
        afterPath === undefined ||
        args.length !== 4
      ) {
        console.error(USAGE);
        process.exit(2);
      }
      const before = scoreFile(root, corpusPath, beforePath);
      const after = scoreFile(root, corpusPath, afterPath);
      console.log(
        renderScores(
          [before, after].map((score, i) => ({
            ...score,
            modele: `${score.modele} (${i === 0 ? "avant" : "après"})`,
          })),
        ),
      );
      const outcome = decideAcceptance(before, after);
      console.log(
        `\nchangement du relecteur : ${outcome.decision}\n${outcome.motifs.map((motif) => `  ${motif}`).join("\n")}`,
      );
      process.exit(outcome.decision === "garde" ? 0 : outcome.decision === "rejete" ? 1 : 3);
    }
    if (args.length === 0 || args.length % 2 !== 0) {
      console.error(USAGE);
      process.exit(2);
    }
    const scores: CorpusScore[] = [];
    for (let i = 0; i < args.length; i += 2)
      scores.push(scoreFile(root, args[i] as string, args[i + 1] as string));
    console.log(renderScores(scores));
  } catch (cause) {
    console.error(`score : ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(2);
  }
}
