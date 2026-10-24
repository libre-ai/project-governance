import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  evaluateReviewEvidence,
  extractAddedLines,
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

  // ADR-0056 "Suites nommées" (2026-10-23): the refusals register enters the
  // surface — exactly that file, not a sibling version or a copy elsewhere.
  test("matches ecosystem/refusals.v1.yaml exactly, not a sibling", () => {
    expect(
      touchesGatedPaths([
        "ecosystem/refusals.v1.yaml",
        "ecosystem/refusals.v2.yaml",
        "ecosystem/refusals.v1.yaml.bak",
        "docs/ecosystem/refusals.v1.yaml",
      ]),
    ).toEqual(["ecosystem/refusals.v1.yaml"]);
  });

  // Review of #142 (2026-10-23): an exemption relaxes the refusals gate, so
  // its file is gated like the register — exactly that file. Its neighbour
  // pinned-citations.v1.json used to stand here as an ungated sibling; it
  // joined the surface with the rest of the loosening class (#153).
  test("matches tools/quality/refusals-exemptions.v1.json exactly, not a sibling", () => {
    expect(
      touchesGatedPaths([
        "tools/quality/refusals-exemptions.v1.json",
        "tools/quality/refusals-exemptions.v2.json",
        "tools/quality/refusals-exemptions.v1.json.bak",
        "tools/quality/check-refusals.ts",
      ]),
    ).toEqual(["tools/quality/refusals-exemptions.v1.json"]);
  });

  // #153: each file of the loosening class is gated exactly. The neighbours
  // are the near-misses a loose pattern would also catch: another version,
  // a backup, the same name in another directory, and the gate that reads it.
  const loosening: readonly (readonly [string, readonly string[]])[] = [
    [
      "tools/quality/pinned-citations.v1.json",
      [
        "tools/quality/pinned-citations.v2.json",
        "tools/quality/pinned-citations.v1.json.bak",
        "docs/tools/quality/pinned-citations.v1.json",
        "tools/quality/check-pinned-citations.ts",
      ],
    ],
    [
      "tools/quality/pr-negatives.v1.json",
      [
        "tools/quality/pr-negatives.v2.json",
        "tools/quality/pr-negatives.v1.json.bak",
        "docs/tools/quality/pr-negatives.v1.json",
        "tools/quality/check-pr-negatives.ts",
      ],
    ],
    [
      "tools/quality/threat-model-citations.v1.json",
      [
        "tools/quality/threat-model-citations.v2.json",
        "tools/quality/threat-model-citations.v1.json.bak",
        "docs/tools/quality/threat-model-citations.v1.json",
        "tools/quality/check-threat-model-citations.ts",
      ],
    ],
    [
      ".github/composition/ref-monotonicity-exemptions.json",
      [
        ".github/composition/ref-monotonicity-exemptions.json.bak",
        ".github/composition/ref-monotonicity-exemptions.v2.json",
        "x/.github/composition/ref-monotonicity-exemptions.json",
        ".github/composition/check-ref-monotonicity.py",
      ],
    ],
    [
      "ecosystem/release-age-exceptions.v1.yaml",
      [
        "ecosystem/release-age-exceptions.v2.yaml",
        "ecosystem/release-age-exceptions.v1.yaml.bak",
        "docs/ecosystem/release-age-exceptions.v1.yaml",
        "ecosystem/check-release-age.ts",
      ],
    ],
    [
      "ecosystem/sql-construction-allowlist.v1.yaml",
      [
        "ecosystem/sql-construction-allowlist.v2.yaml",
        "ecosystem/sql-construction-allowlist.v1.yaml.bak",
        "docs/ecosystem/sql-construction-allowlist.v1.yaml",
        "ecosystem/check-sql-construction.ts",
      ],
    ],
    [
      "ecosystem/web-headers-allowlist.v1.yaml",
      [
        "ecosystem/web-headers-allowlist.v2.yaml",
        "ecosystem/web-headers-allowlist.v1.yaml.bak",
        "docs/ecosystem/web-headers-allowlist.v1.yaml",
        "ecosystem/check-web-headers.ts",
      ],
    ],
    [
      "ecosystem/work-package-policy.v1.yaml",
      [
        "ecosystem/work-package-policy.v2.yaml",
        "ecosystem/work-package-policy.v1.yaml.bak",
        "docs/ecosystem/work-package-policy.v1.yaml",
        "tools/quality/work-package-policy.ts",
      ],
    ],
    [
      "tools/fleet/bump-generation.v1.yaml",
      [
        "tools/fleet/bump-generation.v2.yaml",
        "tools/fleet/bump-generation.v1.yaml.bak",
        "docs/tools/fleet/bump-generation.v1.yaml",
        "tools/fleet/bump-generation.ts",
      ],
    ],
    ["deny.toml", ["deny.toml.bak", "x/deny.toml", "Cargo.toml", "crates/other/deny.toml"]],
    [
      "crates/ecosystem-engine/deny.toml",
      [
        "crates/ecosystem-engine/deny.toml.bak",
        "crates/ecosystem-engine/sub/deny.toml",
        "crates/ecosystem-engine/Cargo.toml",
        "x/crates/ecosystem-engine/deny.toml",
      ],
    ],
    [
      "distribution/templates/langgraph-gates/langgraph-advisory-floor.v1.txt",
      [
        "distribution/templates/langgraph-gates/langgraph-advisory-floor.v2.txt",
        "distribution/templates/langgraph-gates/langgraph-advisory-floor.v1.txt.bak",
        "tools/quality/langgraph-advisory-floor.v1.txt",
        "distribution/templates/langgraph-gates/check-langgraph-advisory-floor.ts",
      ],
    ],
    [
      "ecosystem/schemas/project.v1.schema.json",
      [
        "ecosystem/schemas/project.v2.schema.json",
        "ecosystem/schemas/project.v1.schema.json.bak",
        "docs/ecosystem/schemas/project.v1.schema.json",
        "ecosystem/project-cards.ts",
      ],
    ],
    [
      "ecosystem/schemas/knowledge-object.schema.json",
      [
        "ecosystem/schemas/knowledge-object.v2.schema.json",
        "ecosystem/schemas/knowledge-object.schema.json.bak",
        "docs/ecosystem/schemas/knowledge-object.schema.json",
        "tools/quality/validate-knowledge-objects.ts",
      ],
    ],
    [
      "ecosystem/schemas/knowledge-projection.schema.json",
      [
        "ecosystem/schemas/knowledge-projection.v2.schema.json",
        "ecosystem/schemas/knowledge-projection.schema.json.bak",
        "docs/ecosystem/schemas/knowledge-projection.schema.json",
        "ecosystem/knowledge-projection.ts",
      ],
    ],
  ];
  for (const [path, neighbours] of loosening) {
    test(`matches ${path} exactly, not its neighbours`, () => {
      expect(touchesGatedPaths([path, ...neighbours])).toEqual([path]);
    });
  }

  // NB-1 of the review of #159: check-release-age.ts reads every tracked
  // bunfig.toml, so every one is gated, at any depth; a near-miss name is not.
  test("matches bunfig.toml at every depth, not a near-miss name", () => {
    expect(
      touchesGatedPaths([
        "bunfig.toml",
        "packages/x/bunfig.toml",
        "x/y/z/bunfig.toml",
        "bunfig.toml.bak",
        "xbunfig.toml",
        "packages/x/my-bunfig.toml",
        "bun.lock",
      ]),
    ).toEqual(["bunfig.toml", "packages/x/bunfig.toml", "x/y/z/bunfig.toml"]);
  });

  test("every gated pattern has a pathspec", () => {
    expect(GATED_PATHSPECS).toHaveLength(GATED_PATH_PATTERNS.length);
  });

  // The diff the evidence is searched in is selected by the pathspecs, the
  // verdict by the patterns. Asked to git itself, in a throwaway repository
  // holding every gated sample and every neighbour above, both must select
  // exactly the same files, or a gated change would have its diff unread.
  test("git selects with the pathspecs exactly the files the patterns gate", () => {
    const samples = [
      ...loosening.flatMap(([path, neighbours]) => [path, ...neighbours]),
      "docs/adr/0001-x.md",
      "docs/adrx/0001-x.md",
      "docs/decisions/INVARIANTS.md",
      "docs/decisions/DECISION-REGISTER.md",
      "docs/decisions/LEXICON.md",
      "docs/decisions/README.md",
      "ecosystem/FORGOTTEN.yaml",
      "ecosystem/refusals.v1.yaml",
      "tools/quality/refusals-exemptions.v1.json",
      "bunfig.toml",
      "packages/x/bunfig.toml",
      "x/y/z/bunfig.toml",
      "xbunfig.toml",
    ];
    const repository = mkdtempSync(join(tmpdir(), "review-evidence-pathspecs-"));
    try {
      const git = (...argv: string[]) =>
        Bun.spawnSync(["git", "-C", repository, ...argv], { stdout: "pipe", stderr: "pipe" });
      expect(git("init", "-q").exitCode).toBe(0);
      for (const path of samples) {
        mkdirSync(dirname(join(repository, path)), { recursive: true });
        writeFileSync(join(repository, path), "x\n");
      }
      expect(git("add", "--all").exitCode).toBe(0);
      const selected = git("ls-files", "-z", "--", ...GATED_PATHSPECS);
      expect(selected.exitCode).toBe(0);
      const byPathspec = new TextDecoder()
        .decode(selected.stdout)
        .split("\0")
        .filter((path) => path.length > 0)
        .sort();
      const tracked = new TextDecoder()
        .decode(git("ls-files", "-z").stdout)
        .split("\0")
        .filter((path) => path.length > 0);
      expect(tracked.length).toBe(new Set(samples).size);
      expect(byPathspec.length).toBeGreaterThan(0);
      expect(byPathspec).toEqual(touchesGatedPaths(tracked).sort());
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});

describe("findEvidenceSignals", () => {
  test("finds a docs/reviews/ artefact reference", () => {
    const signals = findEvidenceSignals(
      "pr-body",
      "see docs/reviews/domain-a/VERDICT.md for the dossier",
      null,
    );
    expect(signals).toEqual([
      {
        source: "pr-body",
        kind: "review-artifact",
        text: "docs/reviews/domain-a/VERDICT.md",
        file: null,
      },
    ]);
  });

  test("finds an Owner-arbitration marker, case-insensitively, attached to its file", () => {
    const signals = findEvidenceSignals(
      "diff",
      "owner-ARBITRATION: 2026-08-18 (ADR-0023)",
      "docs/adr/0023-x.md",
    );
    expect(signals).toEqual([
      {
        source: "diff",
        kind: "owner-arbitration-marker",
        text: "owner-ARBITRATION: 2026-08-18",
        file: "docs/adr/0023-x.md",
      },
    ]);
  });

  test("trailing sentence punctuation and slashes are not part of the cited path", () => {
    const signals = findEvidenceSignals(
      "pr-body",
      "see docs/reviews/a/VERDICT.md. Also docs/reviews/b/, and docs/reviews/c.md;",
      null,
    );
    expect(signals.map((signal) => signal.text)).toEqual([
      "docs/reviews/a/VERDICT.md",
      "docs/reviews/b",
      "docs/reviews/c.md",
    ]);
  });

  test("plain prose carries no signal", () => {
    expect(findEvidenceSignals("pr-body", "this PR fixes a typo", null)).toEqual([]);
  });

  test("a bare 'arbitrated by the owner' sentence with no date is not a marker", () => {
    // The form is deliberately narrow: a free-form claim of arbitration is
    // exactly what a trivial bypass would type. Requiring the literal token
    // plus an ISO date is what makes it non-trivial to fake by accident.
    expect(findEvidenceSignals("pr-body", "arbitrated by the owner today", null)).toEqual([]);
  });
});

/**
 * A one-file git diff in git's own shape. `body` lines carry their prefix
 * verbatim (`+` added, `-` removed, ` ` context), so every test says exactly
 * which side of the change a line is on.
 */
function gitDiff(file: string, body: readonly string[], hunkContext = ""): string {
  return [
    `diff --git a/${file} b/${file}`,
    "index 1111111..2222222 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,3 +1,3 @@${hunkContext}`,
    ...body,
    "",
  ].join("\n");
}

const REGISTER = "docs/decisions/DECISION-REGISTER.md";

describe("extractAddedLines", () => {
  test("a context line is not added, whatever it carries", () => {
    const scan = extractAddedLines(gitDiff(REGISTER, [" | D91 | Owner-arbitration: 2026-10-22 |"]));
    expect(scan.added).toEqual([]);
    expect(scan.context).toBe(1);
  });

  test("a removed line is not added", () => {
    const scan = extractAddedLines(gitDiff(REGISTER, ["-| D91 | Owner-arbitration: 2026-10-22 |"]));
    expect(scan.added).toEqual([]);
    expect(scan.removed).toBe(1);
  });

  test("the +++ header names the file and is not an added line", () => {
    const scan = extractAddedLines(gitDiff(REGISTER, ["+| D94 | new row |"]));
    expect(scan.added).toEqual([{ file: REGISTER, text: "| D94 | new row |" }]);
    // diff --git, index, ---, +++, @@
    expect(scan.header).toBe(5);
  });

  test("inside a hunk, a line starting +++ is added content beginning with ++", () => {
    const scan = extractAddedLines(gitDiff(REGISTER, ["+++ Owner-arbitration: 2026-10-23"]));
    expect(scan.added).toEqual([{ file: REGISTER, text: "++ Owner-arbitration: 2026-10-23" }]);
  });

  test("an added empty line is an added line with empty text", () => {
    const scan = extractAddedLines(gitDiff(REGISTER, ["+"]));
    expect(scan.added).toEqual([{ file: REGISTER, text: "" }]);
  });

  test("the function context of a hunk header is not an added line", () => {
    const scan = extractAddedLines(
      gitDiff(REGISTER, [" unchanged"], " | D93 | Owner-arbitration: 2026-10-22 |"),
    );
    expect(scan.added).toEqual([]);
  });

  test("each added line is attached to its own file across several files", () => {
    const diff =
      gitDiff("docs/adr/0055-x.md", ["+adr line", " adr context"]) +
      gitDiff(REGISTER, ["-old row", "+new row"]);
    const scan = extractAddedLines(diff);
    expect(scan.added).toEqual([
      { file: "docs/adr/0055-x.md", text: "adr line" },
      { file: REGISTER, text: "new row" },
    ]);
  });

  test("a deleted file adds nothing", () => {
    const diff = [
      "diff --git a/docs/adr/0001-x.md b/docs/adr/0001-x.md",
      "deleted file mode 100644",
      "index 1111111..0000000",
      "--- a/docs/adr/0001-x.md",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-Owner-arbitration: 2026-01-01",
      "",
    ].join("\n");
    const scan = extractAddedLines(diff);
    expect(scan.added).toEqual([]);
    expect(scan.removed).toBe(1);
  });

  test("a quoted destination path is unquoted", () => {
    const diff = [
      'diff --git "a/docs/adr/x y.md" "b/docs/adr/x y.md"',
      '--- "a/docs/adr/x y.md"',
      '+++ "b/docs/adr/x y.md"',
      "@@ -0,0 +1 @@",
      "+line",
      "",
    ].join("\n");
    expect(extractAddedLines(diff).added).toEqual([{ file: "docs/adr/x y.md", text: "line" }]);
  });

  // Two guards make malformed input fail closed, each tested alone: a line
  // outside any hunk is never content, and a hunk with no file header is not
  // attributable. A bare `+` line exercises both at once, so it proves neither.
  test("a + line outside any hunk is not added content: input that is not a git diff fails closed", () => {
    expect(extractAddedLines("+Owner-arbitration: 2026-08-18").added).toEqual([]);
  });

  test("a + line after a file header but before any hunk is not added content", () => {
    const diff = [
      `diff --git a/${REGISTER} b/${REGISTER}`,
      `--- a/${REGISTER}`,
      `+++ b/${REGISTER}`,
      "+Owner-arbitration: 2026-08-18",
      "",
    ].join("\n");
    expect(extractAddedLines(diff).added).toEqual([]);
  });

  test("a hunk with no file header adds nothing: its lines belong to no file", () => {
    expect(extractAddedLines("@@ -0,0 +1 @@\n+Owner-arbitration: 2026-08-18\n").added).toEqual([]);
  });

  test("the four counts sum to the number of lines of the diff", () => {
    const diff =
      gitDiff("docs/adr/0055-x.md", ["+a", " b", "-c", "\\ No newline at end of file"]) +
      gitDiff(REGISTER, ["+d", "+e"]);
    const scan = extractAddedLines(diff);
    const lineCount = diff.slice(0, -1).split("\n").length;
    expect(scan.added.length + scan.context + scan.removed + scan.header).toBe(lineCount);
    expect(extractAddedLines("")).toEqual({ added: [], context: 0, removed: 0, header: 0 });
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
    expect(report.volumeSummary).toBe(
      "0 added line(s) examined in the diff of the gated files (0 context, 0 removed and 0 header line(s) are not evidence); 2 candidate signal(s): 1 admissible, 1 rejected",
    );
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

  test("a gated change ADDING an Owner-arbitration marker passes, the marker attached to its file", () => {
    const report = evaluateReviewEvidence(
      [REGISTER],
      "",
      gitDiff(REGISTER, [" | D93 | context |", "+| D94 | Owner-arbitration: 2026-10-23 |"]),
      TREE,
    );
    expect(report.outcome).toBe("pass");
    expect(report.checks[0]?.note).toBe(
      `evidence found: owner-arbitration-marker (diff ${REGISTER}): Owner-arbitration: 2026-10-23`,
    );
    expect(report.volumeSummary).toBe(
      "1 added line(s) examined in the diff of the gated files (1 context, 0 removed and 5 header line(s) are not evidence); 1 candidate signal(s): 1 admissible, 0 rejected",
    );
  });

  // 2026-10-23, the #131 case: the four admitted signals were markers of
  // D91-D93, already in the register, printed as context around the added
  // D94 row. Evidence the pull request did not write is not its evidence.
  test("markers present only as context around the added line are not evidence", () => {
    const diff = gitDiff(
      REGISTER,
      [
        " | D91 | Amendment pull requests carry `Owner-arbitration: 2026-10-22` |",
        " | D92 | Owner-arbitration: 2026-10-22 |",
        " | D93 | Owner-arbitration: 2026-10-22 |",
        "+| D94 | Five method rules from the drill |",
        " ",
      ],
      " This register is the D0x sequence — Owner-arbitration: 2026-10-22",
    );
    const report = evaluateReviewEvidence([REGISTER], "docs(adr): ADR-0055", diff, TREE);
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toContain("1 added line(s) examined");
    expect(report.violations[0]).toContain("0 candidate signal(s) examined");
  });

  test("a marker on a line the pull request REMOVES is not evidence", () => {
    const report = evaluateReviewEvidence(
      [REGISTER],
      "",
      gitDiff(REGISTER, ["-| D91 | Owner-arbitration: 2026-10-22 |", "+| D91 | rewritten |"]),
      TREE,
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toContain("0 candidate signal(s) examined");
  });

  test("an existing docs/reviews/ reference on a context line is not evidence", () => {
    const report = evaluateReviewEvidence(
      ["docs/adr/0055-x.md"],
      "",
      gitDiff("docs/adr/0055-x.md", [` see ${REAL_VERDICT}`, "+a new sentence"]),
      TREE,
    );
    expect(report.outcome).toBe("violations");
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
    const diff = gitDiff("ecosystem/FORGOTTEN.yaml", [
      "+  - id: forgotten.example",
      "+    decided_by: owner",
      "+    decided_on: 2026-10-08",
    ]);
    const report = evaluateReviewEvidence(
      ["ecosystem/FORGOTTEN.yaml"],
      "chore: register an eviction",
      diff,
      TREE,
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations).toEqual([
      "ecosystem/FORGOTTEN.yaml: neither the pull request description nor a line the pull request adds to the gated files references an existing docs/reviews/** artefact or carries an 'Owner-arbitration: YYYY-MM-DD' marker (3 added line(s) examined in the diff of the gated files (0 context, 0 removed and 5 header line(s) are not evidence); 0 candidate signal(s) examined)",
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
      gitDiff("ecosystem/FORGOTTEN.yaml", [
        "+    review: docs/reviews/forgetting/eviction-2026-10-08.md",
      ]),
      treeWith("docs/reviews/forgetting/eviction-2026-10-08.md"),
    );
    expect(report.outcome).toBe("pass");
  });

  test("an added docs/reviews/ reference still has to exist", () => {
    const report = evaluateReviewEvidence(
      ["ecosystem/FORGOTTEN.yaml"],
      "",
      gitDiff("ecosystem/FORGOTTEN.yaml", ["+    review: docs/reviews/never-written.md"]),
      TREE,
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toContain(
      "docs/reviews/never-written.md (diff ecosystem/FORGOTTEN.yaml) does not exist in the tree under review",
    );
  });

  test("a refusals.v1.yaml change with neither signal fails", () => {
    const diff = gitDiff("ecosystem/refusals.v1.yaml", [
      "+  - id: refusal.example-install",
      "+    decided_on: 2026-10-23",
    ]);
    const report = evaluateReviewEvidence(
      ["ecosystem/refusals.v1.yaml"],
      "chore: register a refusal",
      diff,
      TREE,
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toStartWith(
      "ecosystem/refusals.v1.yaml: neither the pull request description nor a line the pull request adds",
    );
  });

  test("a refusals.v1.yaml change with an Owner-arbitration marker in the PR body passes", () => {
    const report = evaluateReviewEvidence(
      ["ecosystem/refusals.v1.yaml"],
      "Owner-arbitration: 2026-10-23",
      "",
      TREE,
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
