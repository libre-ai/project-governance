import { describe, expect, test } from "bun:test";

import { findOrphans } from "./check-hub-orphans";

describe("findOrphans", () => {
  test("accounts a path through each register and flags the rest", () => {
    const report = findOrphans(
      [
        "README.md", // archive residual (exact)
        "LICENSES/EUPL-1.2.txt", // residual prefix
        "docs/adr/0001.md", // index prefix docs/
        "GOALS.md", // index exact
        "CONTRIBUTING.md", // replacements
        "experiments/dead-tree/x.ts", // forgotten
        "mystery/unaccounted.ts", // orphan
      ],
      ["docs/", "GOALS.md"],
      ["CONTRIBUTING.md"],
      ["experiments/dead-tree"],
    );
    expect(report.covered).toBe(6);
    expect(report.orphans).toEqual(["mystery/unaccounted.ts"]);
  });

  test("an exact index entry never covers by prefix", () => {
    const report = findOrphans(["GOALS.md.bak"], ["GOALS.md"], [], []);
    expect(report.orphans).toEqual(["GOALS.md.bak"]);
  });
});
