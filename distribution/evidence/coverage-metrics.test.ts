import { describe, expect, test } from "bun:test";
import { aggregateFleet, classifyCommits } from "./coverage-metrics";

describe("classifyCommits", () => {
  test("counts commits carrying the maintainer sign-off trailer", () => {
    const coverage = classifyCommits("libre-ai/x", "last 3 commit(s) inspected", [
      { parentCount: 1, message: "docs: fix typo\n\nSigned-off-by: Constantin Jais <cjais@pm.me>" },
      { parentCount: 1, message: "fix: bug\n\nSigned-off-by: Constantin Jais <cjais@pm.me>" },
      { parentCount: 2, message: "Merge branch 'main' into feature" },
    ]);
    expect(coverage).toEqual({
      repository: "libre-ai/x",
      window: "last 3 commit(s) inspected",
      merges_with_maintainer_signoff: 2,
      merges_without_signoff_trailer: 1,
    });
  });

  test("an empty commit list is an honest zero, not an omission", () => {
    expect(classifyCommits("libre-ai/y", "last 0 commit(s) inspected", [])).toEqual({
      repository: "libre-ai/y",
      window: "last 0 commit(s) inspected",
      merges_with_maintainer_signoff: 0,
      merges_without_signoff_trailer: 0,
    });
  });

  test("classifies every commit reaching main, not only 2-parent merges", () => {
    // The regression this guards against: squash-merge is the enforced
    // convention (git-push-merge-guard denies non-squash), so ordinary PR
    // review produces 1-parent commits. Filtering to parents.length > 1, as
    // the pre-2026-08-18 instrument did, would silently zero out every
    // squash-merge repository.
    const coverage = classifyCommits("libre-ai/notebook", "last 1 commit(s) inspected", [
      { parentCount: 1, message: "feat: x (#19)\n\nSigned-off-by: Constantin Jais <cjais@pm.me>" },
    ]);
    expect(coverage.merges_with_maintainer_signoff).toBe(1);
  });
});

describe("aggregateFleet", () => {
  test("sums totals across reachable repositories only", () => {
    const snapshot = aggregateFleet("2026-08-18", "last 100 commit(s) inspected per repository", [
      {
        repository: "libre-ai/a",
        window: "last 2 commit(s) inspected",
        merges_with_maintainer_signoff: 2,
        merges_without_signoff_trailer: 0,
      },
      {
        repository: "libre-ai/b",
        window: "unreachable",
        merges_with_maintainer_signoff: 0,
        merges_without_signoff_trailer: 0,
        error: "HTTP 404",
      },
      {
        repository: "libre-ai/c",
        window: "last 1 commit(s) inspected",
        merges_with_maintainer_signoff: 0,
        merges_without_signoff_trailer: 1,
      },
    ]);
    expect(snapshot.repositories_inspected).toBe(2);
    expect(snapshot.repositories_unreachable).toBe(1);
    expect(snapshot.fleet_totals).toEqual({
      merges_with_maintainer_signoff: 2,
      merges_without_signoff_trailer: 1,
      total_commits: 3,
    });
    // Honest by construction, not estimated: the fleet has no agent-loop
    // merges yet regardless of what the trailer split shows.
    expect(snapshot.genuine_automation_coverage_pct).toBe(0);
  });

  test("carries the schema fields the evidence-feed builder requires", () => {
    // distribution/build-feeds.ts#parseCoverage reads exactly these two
    // top-level fields from every distribution/evidence/coverage-*.json —
    // losing either silently breaks feed regeneration.
    const snapshot = aggregateFleet("2026-08-18", "some window", []);
    expect(typeof snapshot.window).toBe("string");
    expect(typeof snapshot.genuine_automation_coverage_pct).toBe("number");
  });

  test("an empty fleet is a legitimate, honest zero", () => {
    const snapshot = aggregateFleet("2026-08-18", "empty", []);
    expect(snapshot.repositories_inspected).toBe(0);
    expect(snapshot.fleet_totals.total_commits).toBe(0);
  });
});
