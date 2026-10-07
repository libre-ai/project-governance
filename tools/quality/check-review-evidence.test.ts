import { describe, expect, test } from "bun:test";
import {
  evaluateReviewEvidence,
  findEvidenceSignals,
  touchesGatedPaths,
} from "./check-review-evidence";

// K4 redefinition (Domain A re-ratification, 2026-08-18, ADR-0023): "documented
// adversarial review + owner merge = signature", applied mechanically. A pull
// request cannot silently mutate the closed human-touch surface (I-17) without
// pointing at either a review dossier or a dated owner-arbitration marker.

describe("touchesGatedPaths", () => {
  test("matches docs/adr/** files", () => {
    expect(touchesGatedPaths(["docs/adr/0023-x.md", "README.md"])).toEqual(["docs/adr/0023-x.md"]);
  });

  test("matches INVARIANTS.md and DECISION-REGISTER.md exactly, not a sibling", () => {
    expect(
      touchesGatedPaths([
        "docs/decisions/INVARIANTS.md",
        "docs/decisions/DECISION-REGISTER.md",
        "docs/decisions/LEXICON.md",
      ]),
    ).toEqual(["docs/decisions/INVARIANTS.md", "docs/decisions/DECISION-REGISTER.md"]);
  });

  test("an unrelated path change is not gated", () => {
    expect(touchesGatedPaths(["ecosystem/repositories.v1.yaml", "README.md"])).toEqual([]);
  });
});

describe("findEvidenceSignals", () => {
  test("finds a docs/reviews/ artefact reference", () => {
    const signals = findEvidenceSignals(
      "pr-body",
      "see docs/reviews/domain-a/VERDICT.md for the dossier",
    );
    expect(signals).toEqual([
      { source: "pr-body", kind: "review-artifact", text: "docs/reviews/domain-a/VERDICT.md" },
    ]);
  });

  test("finds an Owner-arbitration marker, case-insensitively", () => {
    const signals = findEvidenceSignals("diff", "owner-ARBITRATION: 2026-08-18 (ADR-0023)");
    expect(signals).toEqual([
      { source: "diff", kind: "owner-arbitration-marker", text: "owner-ARBITRATION: 2026-08-18" },
    ]);
  });

  test("plain prose carries no signal", () => {
    expect(findEvidenceSignals("pr-body", "this PR fixes a typo")).toEqual([]);
  });

  test("a bare 'arbitrated by the owner' sentence with no date is not a marker", () => {
    // The form is deliberately narrow: a free-form claim of arbitration is
    // exactly what a trivial bypass would type. Requiring the literal token
    // plus an ISO date is what makes it non-trivial to fake by accident.
    expect(findEvidenceSignals("pr-body", "arbitrated by the owner today")).toEqual([]);
  });
});

describe("evaluateReviewEvidence", () => {
  test("a change outside the gated paths asserts nothing, declared", () => {
    const report = evaluateReviewEvidence(["README.md"], "", "");
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(0);
    expect(report.emptyReason).not.toBeNull();
  });

  test("a gated change with a docs/reviews/ reference in the PR body passes", () => {
    const report = evaluateReviewEvidence(
      ["docs/adr/0023-x.md"],
      "see docs/reviews/domain-a/VERDICT.md",
      "",
    );
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(1);
  });

  test("a gated change with an Owner-arbitration marker in the diff passes", () => {
    const report = evaluateReviewEvidence(
      ["docs/decisions/DECISION-REGISTER.md"],
      "",
      "+Owner-arbitration: 2026-08-18",
    );
    expect(report.outcome).toBe("pass");
  });

  test("a gated change with neither signal fails", () => {
    const report = evaluateReviewEvidence(["docs/decisions/INVARIANTS.md"], "bump a typo", "");
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toContain("neither the pull request description");
  });

  test("several gated paths in one run are reported as a single item", () => {
    const report = evaluateReviewEvidence(
      ["docs/adr/0023-x.md", "docs/decisions/DECISION-REGISTER.md"],
      "Owner-arbitration: 2026-08-18",
      "",
    );
    expect(report.checks[0]?.item).toBe("docs/adr/0023-x.md, docs/decisions/DECISION-REGISTER.md");
  });
});
