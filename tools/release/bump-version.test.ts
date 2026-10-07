import { describe, expect, test } from "bun:test";
import { computeNextVersion, planLinkedBump } from "./bump-version";

// Linked versioning for the wave-1 satellites: one shared version, bumped
// together; any pre-existing drift refuses the bump (fail-closed).

describe("computeNextVersion", () => {
  test("bumps patch, minor and major", () => {
    expect(computeNextVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(computeNextVersion("0.1.9", "minor")).toBe("0.2.0");
    expect(computeNextVersion("1.2.3", "major")).toBe("2.0.0");
  });

  test("accepts an explicit semver and refuses a malformed one", () => {
    expect(computeNextVersion("0.1.0", "1.0.0")).toBe("1.0.0");
    expect(() => computeNextVersion("0.1.0", "not-semver")).toThrow();
    expect(() => computeNextVersion("weird", "patch")).toThrow();
  });
});

describe("planLinkedBump", () => {
  const manifests = [
    { path: "a/package.json", name: "a", version: "0.1.0" },
    { path: "b/package.json", name: "b", version: "0.1.0" },
  ];

  test("plans the same next version for every satellite", () => {
    const plan = planLinkedBump(manifests, "minor");
    expect(plan.nextVersion).toBe("0.2.0");
    expect(plan.updates).toHaveLength(2);
    expect(plan.updates.every((update) => update.nextVersion === "0.2.0")).toBe(true);
  });

  test("refuses to bump a drifted set", () => {
    expect(() =>
      planLinkedBump(
        [...manifests, { path: "c/package.json", name: "c", version: "0.3.0" }],
        "patch",
      ),
    ).toThrow(/drift/);
  });
});
