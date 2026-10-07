import { describe, expect, test } from "bun:test";
import {
  type CuratedItem,
  type Proposal,
  survivingRate,
  verifyProposalBatch,
} from "./verify-proposals";

// The batch verifier is what makes C3 measurable: it takes the curated items a
// Radar export carries, the proposals made against them, and reports how many
// survive anchoring — plus the refusal breakdown, so a low rate says WHY.

const ITEMS: readonly CuratedItem[] = [
  {
    id: "urn:libre-ai:item:cnil-2026-07-20",
    title: "Recommandations sur les systèmes d'IA générative en milieu professionnel",
    decision: "retain",
  },
  {
    id: "urn:libre-ai:item:edpb-2026-07-18",
    title: "Lignes directrices sur la minimisation des données dans les traitements automatisés",
    decision: "retain",
  },
  {
    id: "urn:libre-ai:item:noise-2026-07-19",
    title: "Un titre rejeté par les règles de curation",
    decision: "reject",
  },
];

const ARTEFACTS: ReadonlySet<string> = new Set(["urn:libre-ai:capability:data-subject-rights"]);

const GOOD: Proposal = {
  itemId: "urn:libre-ai:item:cnil-2026-07-20",
  quote: "les systèmes d'IA générative en milieu professionnel",
  assertions: ["IA générative en milieu professionnel"],
  artefactId: "urn:libre-ai:capability:data-subject-rights",
};

describe("verifyProposalBatch", () => {
  test("anchors a proposal quoting a retained item's title", () => {
    const report = verifyProposalBatch(ITEMS, [GOOD], ARTEFACTS);
    expect(report.total).toBe(1);
    expect(report.anchored).toBe(1);
    expect(report.refusals).toEqual({});
    expect(report.verdicts[0]?.verdict.anchored).toBeTrue();
  });

  test("counts refusals by reason so a low rate says why", () => {
    // The point of the breakdown: "12/20 survived" is not actionable, whereas
    // "8 refused, all quote_not_in_source" says the proposals are paraphrasing.
    const report = verifyProposalBatch(
      ITEMS,
      [
        GOOD,
        { ...GOOD, quote: "une paraphrase absente du titre original" },
        { ...GOOD, quote: "un autre texte totalement inventé ici" },
        { ...GOOD, artefactId: "urn:libre-ai:capability:invented" },
      ],
      ARTEFACTS,
    );
    expect(report.total).toBe(4);
    expect(report.anchored).toBe(1);
    expect(report.refusals["anchor.quote_not_in_source"]).toBe(2);
    expect(report.refusals["anchor.artefact_unresolved"]).toBe(1);
  });

  test("refuses a proposal against an item the export does not carry", () => {
    // Not an anchoring refusal: the item is absent, so there is nothing to
    // anchor against. It must not be silently dropped from the total either.
    const report = verifyProposalBatch(
      ITEMS,
      [{ ...GOOD, itemId: "urn:libre-ai:item:absent" }],
      ARTEFACTS,
    );
    expect(report.total).toBe(1);
    expect(report.anchored).toBe(0);
    expect(report.refusals["anchor.item_not_in_export"]).toBe(1);
  });

  test("refuses a proposal against a rejected item", () => {
    // A curation-rejected item is not a candidate for contribution: proposing
    // against it means the proposer ignored the curation decision.
    const report = verifyProposalBatch(
      ITEMS,
      [
        {
          itemId: "urn:libre-ai:item:noise-2026-07-19",
          quote: "Un titre rejeté par les règles de curation",
          assertions: ["rejeté par les règles"],
          artefactId: "urn:libre-ai:capability:data-subject-rights",
        },
      ],
      ARTEFACTS,
    );
    expect(report.refusals["anchor.item_not_retained"]).toBe(1);
    expect(report.anchored).toBe(0);
  });

  test("reports an empty batch without dividing by zero", () => {
    const report = verifyProposalBatch(ITEMS, [], ARTEFACTS);
    expect(report).toEqual({ total: 0, anchored: 0, refusals: {}, verdicts: [] });
  });

  test("rates a batch, and gives an empty one no rate at all", () => {
    // Null rather than 0 %: an empty batch has no rate, and reporting zero would
    // read as a total failure of proposals that were never made.
    expect(survivingRate(verifyProposalBatch(ITEMS, [], ARTEFACTS))).toBeNull();
    expect(survivingRate(verifyProposalBatch(ITEMS, [GOOD], ARTEFACTS))).toBe(100);
    expect(
      survivingRate(verifyProposalBatch(ITEMS, [GOOD, { ...GOOD, quote: "absent" }], ARTEFACTS)),
    ).toBe(50);
  });

  test("keeps one verdict per proposal, in order", () => {
    // The report is evidence, so it must stay traceable back to each proposal
    // rather than collapsing into counters.
    const report = verifyProposalBatch(ITEMS, [GOOD, { ...GOOD, quote: "absent" }], ARTEFACTS);
    expect(report.verdicts).toHaveLength(2);
    expect(report.verdicts[0]?.itemId).toBe(GOOD.itemId);
    expect(report.verdicts[1]?.verdict.anchored).toBeFalse();
  });
});
