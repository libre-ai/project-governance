import { describe, expect, test } from "bun:test";
import {
  evaluateReviewEvidence,
  findEvidenceSignals,
  GATED_PATH_PATTERNS,
  GATED_PATHSPECS,
  type PathExists,
  STANDING_REVIEW_PATHS,
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

  test("matches INVARIANTS.md, DECISION-REGISTER.md and LEXICON.md exactly, not a sibling", () => {
    expect(
      touchesGatedPaths([
        "docs/decisions/INVARIANTS.md",
        "docs/decisions/DECISION-REGISTER.md",
        "docs/decisions/LEXICON.md",
        "docs/decisions/README.md",
        "docs/decisions/LEXICON.md.bak",
      ]),
    ).toEqual([
      "docs/decisions/INVARIANTS.md",
      "docs/decisions/DECISION-REGISTER.md",
      "docs/decisions/LEXICON.md",
    ]);
  });

  test("an unrelated path change is not gated", () => {
    expect(touchesGatedPaths(["ecosystem/repositories.v1.yaml", "README.md"])).toEqual([]);
  });

  // Owner decision 2026-10-08 (Y13): ADR-0019 §2 requires a dated owner
  // arbitration per eviction, so the forgetting register is gated like the
  // doctrine registers — exactly that file, not its neighbours.
  test("matches ecosystem/FORGOTTEN.yaml exactly, not a sibling", () => {
    expect(
      touchesGatedPaths([
        "ecosystem/FORGOTTEN.yaml",
        "ecosystem/FORGOTTEN.yaml.bak",
        "ecosystem/repositories.v1.yaml",
        "docs/ecosystem/FORGOTTEN.yaml",
      ]),
    ).toEqual(["ecosystem/FORGOTTEN.yaml"]);
  });

  test("every gated pattern has a pathspec whose diff is searched for evidence", () => {
    expect(GATED_PATHSPECS).toHaveLength(GATED_PATH_PATTERNS.length);
    for (const pathspec of GATED_PATHSPECS) {
      const sample =
        pathspec.endsWith(".md") || pathspec.endsWith(".yaml") ? pathspec : `${pathspec}/x.md`;
      expect(touchesGatedPaths([sample])).toEqual([sample]);
    }
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

  test("trailing sentence punctuation and slashes are not part of the cited path", () => {
    const signals = findEvidenceSignals(
      "pr-body",
      "see docs/reviews/a/VERDICT.md. Also docs/reviews/b/, and docs/reviews/c.md;",
    );
    expect(signals.map((signal) => signal.text)).toEqual([
      "docs/reviews/a/VERDICT.md",
      "docs/reviews/b",
      "docs/reviews/c.md",
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

/** A tree holding exactly these paths (the files and every directory above them). */
function treeWith(...paths: string[]): PathExists {
  const present = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let depth = 1; depth <= parts.length; depth += 1) {
      present.add(parts.slice(0, depth).join("/"));
    }
  }
  return (path) => present.has(path);
}

const REAL_VERDICT = "docs/reviews/domain-a/VERDICT.md";
const TREE = treeWith(REAL_VERDICT, ...STANDING_REVIEW_PATHS);

describe("evaluateReviewEvidence", () => {
  test("a change outside the gated paths asserts nothing, declared", () => {
    const report = evaluateReviewEvidence(["README.md"], "", "", TREE);
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(0);
    expect(report.emptyReason).not.toBeNull();
  });

  test("a gated change with a docs/reviews/ reference in the PR body passes", () => {
    const report = evaluateReviewEvidence(
      ["docs/adr/0023-x.md"],
      "see docs/reviews/domain-a/VERDICT.md",
      "",
      TREE,
    );
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(1);
  });

  // 2026-10-14: #102's first run went green on a reference to a dossier that
  // was never written. A citation is evidence only if it resolves.
  test("a reference to a docs/reviews/ path absent from the tree is not evidence", () => {
    const report = evaluateReviewEvidence(
      ["docs/adr/0050-x.md"],
      "see docs/reviews/never-written/VERDICT.md",
      "",
      TREE,
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toContain(
      "docs/reviews/never-written/VERDICT.md (pr-body) does not exist in the tree under review",
    );
    expect(report.violations[0]).toContain("1 candidate signal(s) examined");
  });

  test("citing a standing file of docs/reviews/ is not evidence", () => {
    for (const standing of STANDING_REVIEW_PATHS) {
      const report = evaluateReviewEvidence(["docs/adr/0050-x.md"], `see ${standing}`, "", TREE);
      expect(report.outcome).toBe("violations");
      expect(report.violations[0]).toContain(`${standing} (pr-body) is a standing file`);
    }
  });

  test("an existing dossier directory counts as evidence", () => {
    const report = evaluateReviewEvidence(
      ["docs/adr/0050-x.md"],
      "dossier: docs/reviews/domain-a/",
      "",
      TREE,
    );
    expect(report.outcome).toBe("pass");
  });

  test("one real reference passes and the dangling one is still named", () => {
    const report = evaluateReviewEvidence(
      ["docs/adr/0050-x.md"],
      `see ${REAL_VERDICT} and docs/reviews/ghost.md`,
      "",
      TREE,
    );
    expect(report.outcome).toBe("pass");
    expect(report.checks[0]?.note).toContain("docs/reviews/ghost.md (pr-body) does not exist");
    expect(report.volumeSummary).toBe("2 candidate signal(s): 1 admissible, 1 rejected");
  });

  test("a LEXICON.md change with neither signal fails", () => {
    const report = evaluateReviewEvidence(
      ["docs/decisions/LEXICON.md"],
      "redefine a term",
      "",
      TREE,
    );
    expect(report.outcome).toBe("violations");
  });

  test("a gated change with an Owner-arbitration marker in the diff passes", () => {
    const report = evaluateReviewEvidence(
      ["docs/decisions/DECISION-REGISTER.md"],
      "",
      "+Owner-arbitration: 2026-08-18",
      TREE,
    );
    expect(report.outcome).toBe("pass");
  });

  test("a gated change with neither signal fails", () => {
    const report = evaluateReviewEvidence(
      ["docs/decisions/INVARIANTS.md"],
      "bump a typo",
      "",
      TREE,
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toContain("neither the pull request description");
  });

  test("a FORGOTTEN.yaml change with neither signal fails", () => {
    const diff = [
      "+  - id: forgotten.example",
      "+    decided_by: owner",
      "+    decided_on: 2026-10-08",
    ].join("\n");
    const report = evaluateReviewEvidence(
      ["ecosystem/FORGOTTEN.yaml"],
      "chore: register an eviction",
      diff,
      TREE,
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations).toEqual([
      "ecosystem/FORGOTTEN.yaml: neither the pull request description nor the diff of the gated files references an existing docs/reviews/** artefact or carries an 'Owner-arbitration: YYYY-MM-DD' marker (0 candidate signal(s) examined)",
    ]);
  });

  test("a FORGOTTEN.yaml change with an Owner-arbitration marker in the PR body passes", () => {
    const report = evaluateReviewEvidence(
      ["ecosystem/FORGOTTEN.yaml"],
      "Owner-arbitration: 2026-10-08",
      "",
      TREE,
    );
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(1);
  });

  test("a FORGOTTEN.yaml change citing a docs/reviews/ artefact passes", () => {
    const report = evaluateReviewEvidence(
      ["ecosystem/FORGOTTEN.yaml"],
      "",
      "+    review: docs/reviews/forgetting/eviction-2026-10-08.md",
      treeWith("docs/reviews/forgetting/eviction-2026-10-08.md"),
    );
    expect(report.outcome).toBe("pass");
  });

  test("several gated paths in one run are reported as a single item", () => {
    const report = evaluateReviewEvidence(
      ["docs/adr/0023-x.md", "docs/decisions/DECISION-REGISTER.md"],
      "Owner-arbitration: 2026-08-18",
      "",
      TREE,
    );
    expect(report.checks[0]?.item).toBe("docs/adr/0023-x.md, docs/decisions/DECISION-REGISTER.md");
  });
});
