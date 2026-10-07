/**
 * Batch verification of convergence proposals against a curated Radar export.
 *
 * This is what makes hypothesis C3 measurable. `verifyAnchor` judges one
 * proposal; this judges a batch and reports the surviving rate WITH its refusal
 * breakdown — because "12 of 20 survived" is not actionable, whereas "8 refused,
 * all quote_not_in_source" says the proposer is paraphrasing rather than quoting.
 *
 * ANCHORING IS ON THE TITLE, and that is a consequence of the contract, not a
 * shortcut. `curated-item-export.v2` carries `id`, `sourceUrl`, `title`,
 * `normalizedDigest` and the curation decision — never the body, because Radar
 * destroys raw response bodies after normalisation and refuses to be a full-text
 * archive. So a proposal can be anchored against an item's title and nothing
 * else; anything deeper is for a human opening `sourceUrl`.
 *
 * Two refusals live here rather than in the anchor because they are about the
 * export, not about the quote: a proposal against an item the export does not
 * carry, and a proposal against an item curation REJECTED. Both are counted, never
 * silently dropped — a batch whose total shrinks is a batch that lies about its
 * rate.
 */
import { type AnchorRefusal, type AnchorVerdict, verifyAnchor } from "./anchor";

export interface CuratedItem {
  readonly id: string;
  readonly title: string;
  readonly decision: "retain" | "reject";
}

export interface Proposal {
  readonly itemId: string;
  readonly quote: string;
  readonly assertions: readonly string[];
  readonly artefactId: string;
}

/** Refusals owned by the batch layer, disjoint from the anchor's own set. */
export type BatchRefusal = "anchor.item_not_in_export" | "anchor.item_not_retained";

export interface ProposalVerdict {
  readonly itemId: string;
  readonly verdict: AnchorVerdict;
}

export interface BatchReport {
  readonly total: number;
  readonly anchored: number;
  readonly refusals: Readonly<Record<string, number>>;
  readonly verdicts: readonly ProposalVerdict[];
}

function refused(refusal: AnchorRefusal | BatchRefusal): AnchorVerdict {
  return { anchored: false, refusal: refusal as AnchorRefusal };
}

export function verifyProposalBatch(
  items: readonly CuratedItem[],
  proposals: readonly Proposal[],
  artefacts: ReadonlySet<string>,
): BatchReport {
  const byId = new Map(items.map((item) => [item.id, item]));
  const refusals: Record<string, number> = {};
  const verdicts: ProposalVerdict[] = [];
  let anchored = 0;

  for (const proposal of proposals) {
    const item = byId.get(proposal.itemId);
    let verdict: AnchorVerdict;
    if (item === undefined) {
      verdict = refused("anchor.item_not_in_export");
    } else if (item.decision !== "retain") {
      verdict = refused("anchor.item_not_retained");
    } else {
      verdict = verifyAnchor(
        { id: item.id, text: item.title },
        {
          sourceId: proposal.itemId,
          quote: proposal.quote,
          assertions: proposal.assertions,
          artefactId: proposal.artefactId,
        },
        artefacts,
      );
    }

    if (verdict.anchored) anchored += 1;
    else refusals[verdict.refusal] = (refusals[verdict.refusal] ?? 0) + 1;
    verdicts.push({ itemId: proposal.itemId, verdict });
  }

  return { total: proposals.length, anchored, refusals, verdicts };
}

/**
 * Surviving rate as a percentage, or null for an empty batch.
 *
 * Null rather than zero: an empty batch has no rate, and reporting 0 % would read
 * as a total failure of proposals that were never made.
 */
export function survivingRate(report: BatchReport): number | null {
  return report.total === 0 ? null : (report.anchored / report.total) * 100;
}
