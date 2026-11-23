import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type CorpusScore,
  decideAcceptance,
  parseReviewLines,
  renderScores,
  scoreCorpus,
} from "./score";

/**
 * The score of a review layer, corpus by corpus, and the rule that keeps or
 * rejects a change of the reviewer.
 *
 * The expected figures of the synthetic corpus are not written from this
 * module's output: they are read from the synthesis published on 2026-11-16
 * (`resultats/pi-evidence.synthese.json`), computed by `synthese.jq`. An
 * equivalent scorer keeps them green; a scorer that counts an unreadable reply
 * as a verdict, or a defect for a witness, turns them red.
 *
 * What each test would miss if it went away:
 * - two corpora summed into one figure would hide a fall on the observed
 *   corpus behind the seeded defects every model catches;
 * - a verdict for a case of another corpus would be scored against this one;
 * - a case nobody reviewed would read as a defect missed or a witness passed;
 * - a reviewer change would be kept on an incomplete run, or on the synthetic
 *   corpus, which the acceptance rule does not read.
 */

const ROOT = join(import.meta.dir, "../..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

const synthetic = JSON.parse(read("verification/trust-bench/corpus/pi-evidence.json")) as {
  cas: { id: string; attendu: boolean }[];
};
const published = JSON.parse(
  read("verification/trust-bench/resultats/pi-evidence.synthese.json"),
) as {
  couches: {
    couche: string;
    defauts_soumis: number;
    defauts_attrapes: number;
    sains_soumis: number;
    faux_positifs: number;
    cas_faux_positifs: string[];
    illisibles: number;
  }[];
};
const provenance = JSON.parse(
  read("verification/trust-bench/resultats/pi-evidence.provenance.json"),
) as { modeles: { couche: string; etiquette: string; fichier: string }[] };

const SMALL = {
  corpus: "petit",
  origine: "observed" as const,
  cas: [
    { id: "R01", attendu: true },
    { id: "R02", attendu: true },
    { id: "S01", attendu: false },
    { id: "S02", attendu: false },
  ],
};
const line = (cas: string, defaut: boolean | null, modele = "m") => ({
  cas,
  modele,
  defaut,
  illisible: defaut === null,
});
function score(lines: ReturnType<typeof line>[], corpus = SMALL): CorpusScore {
  return scoreCorpus({ ...corpus, resultats: "r.jsonl", lignes: lines });
}

describe("scoreCorpus", () => {
  test.each(
    provenance.modeles,
  )("reproduces the published synthesis of $etiquette on the synthetic corpus", (model) => {
    const layer = published.couches.find((candidate) => candidate.couche === model.couche);
    if (layer === undefined) throw new Error(`${model.couche} absent from the synthesis`);
    const result = scoreCorpus({
      corpus: "pi-evidence",
      origine: "synthetic",
      cas: synthetic.cas,
      resultats: model.fichier,
      lignes: parseReviewLines(read(model.fichier)),
    });
    expect(result.defauts.total).toBe(layer.defauts_soumis);
    expect(result.defauts.attrapes).toBe(layer.defauts_attrapes);
    expect(result.temoins.total).toBe(layer.sains_soumis);
    expect(result.temoins.fausses_alertes).toBe(layer.faux_positifs);
    expect(result.temoins.cas_fausses_alertes).toEqual(layer.cas_faux_positifs);
    expect(result.defauts.illisibles.length + result.temoins.illisibles.length).toBe(
      layer.illisibles,
    );
  });

  test("an unreadable reply and a missing verdict are neither caught nor clean, and keep the denominators", () => {
    const result = score([line("R01", true), line("R02", null), line("S01", false)]);
    expect(result.defauts).toMatchObject({ attrapes: 1, total: 2, illisibles: ["R02"] });
    expect(result.temoins).toMatchObject({ fausses_alertes: 0, total: 2, non_relus: ["S02"] });
    expect(result.defauts.manques).toEqual([]);
  });

  test("a verdict for a case outside the corpus is refused: results of two corpora do not mix", () => {
    expect(() => score([line("R01", true), line("D01", true)])).toThrow("D01");
  });

  test("two verdicts for one case, or two models in one run, are refused", () => {
    expect(() => score([line("R01", true), line("R01", false)])).toThrow("R01");
    expect(() => score([line("R01", true, "a"), line("R02", true, "b")])).toThrow("modèle");
  });

  test("an empty run is refused, not scored as zero", () => {
    expect(() => score([])).toThrow("aucune ligne");
  });
});

describe("parseReviewLines", () => {
  test("reads the JSONL the review writes and the JSON array this repository versions", () => {
    const lines = [line("R01", true), line("S01", null)];
    const jsonl = lines.map((entry) => JSON.stringify(entry)).join("\n");
    expect(parseReviewLines(`${jsonl}\n`)).toEqual(lines);
    expect(parseReviewLines(JSON.stringify(lines))).toEqual(lines);
  });

  test("a line without a boolean-or-null verdict is refused", () => {
    expect(() =>
      parseReviewLines(
        JSON.stringify([{ cas: "R01", modele: "m", defaut: "yes", illisible: false }]),
      ),
    ).toThrow();
  });
});

describe("renderScores", () => {
  const syntheticScore = scoreCorpus({
    corpus: "pi-evidence",
    origine: "synthetic",
    cas: synthetic.cas,
    resultats: "s.jsonl",
    lignes: synthetic.cas.map((cas) => line(cas.id, cas.attendu)),
  });
  const observedScore = score([
    line("R01", true),
    line("R02", false),
    line("S01", true),
    line("S02", false),
  ]);
  const text = renderScores([syntheticScore, observedScore]);

  test("prints one block per corpus, each with its own numerator and denominator", () => {
    expect(text).toContain("corpus pi-evidence (synthetic)");
    expect(text).toContain("corpus petit (observed)");
    expect(text).toContain("défauts attrapés : 10 / 10");
    expect(text).toContain("fausses alertes : 0 / 8");
    expect(text).toContain("défauts attrapés : 1 / 2 (manqués : R02)");
    expect(text).toContain("fausses alertes : 1 / 2 (S01)");
  });

  test("never prints a figure over both corpora", () => {
    expect(text.match(/défauts attrapés/g)?.length).toBe(2);
    expect(text).not.toMatch(/\b11 \/ 12\b/);
    expect(text).not.toMatch(/\btotal\b/i);
  });

  test("a corpus scored twice for the same model is refused", () => {
    expect(() => renderScores([observedScore, observedScore])).toThrow("petit");
  });
});

describe("decideAcceptance", () => {
  const before = score([
    line("R01", true),
    line("R02", false),
    line("S01", false),
    line("S02", true),
  ]);

  test("kept when the defects caught do not fall and the false alerts do not rise", () => {
    const same = score([
      line("R01", true),
      line("R02", false),
      line("S01", false),
      line("S02", true),
    ]);
    const better = score([
      line("R01", true),
      line("R02", true),
      line("S01", false),
      line("S02", false),
    ]);
    expect(decideAcceptance(before, same).decision).toBe("garde");
    expect(decideAcceptance(before, better).decision).toBe("garde");
  });

  test("rejected when one defect fewer is caught, even with fewer false alerts", () => {
    const after = score([
      line("R01", false),
      line("R02", false),
      line("S01", false),
      line("S02", false),
    ]);
    const outcome = decideAcceptance(before, after);
    expect(outcome.decision).toBe("rejete");
    expect(outcome.motifs.join("\n")).toContain("1 / 2 → 0 / 2");
  });

  test("rejected when one false alert more is raised, even with more defects caught", () => {
    const after = score([
      line("R01", true),
      line("R02", true),
      line("S01", true),
      line("S02", true),
    ]);
    expect(decideAcceptance(before, after).decision).toBe("rejete");
  });

  test("undecidable on an incomplete run, on another corpus, or on the synthetic corpus", () => {
    const incomplete = score([
      line("R01", true),
      line("R02", null),
      line("S01", false),
      line("S02", false),
    ]);
    expect(decideAcceptance(before, incomplete).decision).toBe("indecidable");
    const other = score(
      [line("R01", true), line("R02", true), line("S01", false), line("S02", false)],
      {
        ...SMALL,
        corpus: "autre",
      },
    );
    expect(decideAcceptance(before, other).decision).toBe("indecidable");
    const seeded = score(
      [line("R01", true), line("R02", true), line("S01", false), line("S02", false)],
      {
        ...SMALL,
        origine: "synthetic" as never,
      },
    );
    expect(decideAcceptance(seeded, seeded).decision).toBe("indecidable");
  });
});
