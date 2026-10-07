import { describe, expect, test } from "bun:test";
import { bareIdentifier, RETIRED_TOOLING_NAMES, scanForRetiredNames } from "./check-retired-names";

// ADR-0008 §3 retires seven tooling repositories and forbids reusing their names
// as a repository, package or crate. The rename that closed the I-04 drift
// (`packages/design-system` -> `packages/ui`, LEXICON §7 action 1) left an
// untracked orphan directory behind, which kept reading as a live package.

describe("scanForRetiredNames", () => {
  test("flags a directory carrying a retired tooling name", () => {
    const findings = scanForRetiredNames([
      { location: "packages/design-system", identifier: "design-system" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.retired).toBe("design-system");
  });

  test("flags a retired name declared in a scoped package manifest", () => {
    const findings = scanForRetiredNames([
      { location: "packages/ui/package.json", identifier: "@libre-ai/design-system" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.retired).toBe("design-system");
  });

  test("accepts the live identifiers that replaced the retired ones", () => {
    expect(
      scanForRetiredNames([
        { location: "packages/ui", identifier: "@libre-ai/ui" },
        { location: "crates/artifact", identifier: "artifact" },
        { location: "crates/agent-orchestrator", identifier: "agent-orchestrator" },
      ]),
    ).toEqual([]);
  });

  test("website stays legitimate (ADR-0020 §2.4 regularisation), benchmarks is enforced", () => {
    // ADR-0020 nominatively regularises the `website` activation (the name left
    // the dead list), while `benchmarks` joined the guard: the in-hub
    // destinations that once justified its absence no longer exist in the tree.
    expect(scanForRetiredNames([{ location: "apps/website", identifier: "website" }])).toEqual([]);
    expect(
      scanForRetiredNames([{ location: "verification/benchmarks", identifier: "benchmarks" }]),
    ).toEqual([
      { location: "verification/benchmarks", identifier: "benchmarks", retired: "benchmarks" },
    ]);
  });

  test("matches whole identifiers, never substrings", () => {
    expect(
      scanForRetiredNames([
        { location: "crates/artifact", identifier: "artifact" },
        { location: "packages/gear-ratio", identifier: "gear-ratio" },
      ]),
    ).toEqual([]);
  });

  test("reports every retired name it is given", () => {
    const findings = scanForRetiredNames(
      RETIRED_TOOLING_NAMES.map((name) => ({ location: `packages/${name}`, identifier: name })),
    );
    expect(findings).toHaveLength(RETIRED_TOOLING_NAMES.length);
  });
});

describe("bareIdentifier", () => {
  test("strips an npm scope and leaves a bare name untouched", () => {
    expect(bareIdentifier("@libre-ai/ui")).toBe("ui");
    expect(bareIdentifier("ui")).toBe("ui");
  });
});
