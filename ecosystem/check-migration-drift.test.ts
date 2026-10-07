import { describe, expect, test } from "bun:test";

import { ADAPTED_FILES, compareTrees, driftVerdict } from "./check-migration-drift";

describe("compareTrees", () => {
  const entry = {
    hub_path: "packages/thing/",
    destination: "libre-ai/thing",
    hub_removal_commit: "pending",
    destination_path: ".",
  };

  test("counter-proof: a divergent fingerprint must turn the gate red", () => {
    const hub = new Map([["packages/thing/src/a.ts", "aaaa1111"]]);
    const dest = new Map([["src/a.ts", "bbbb2222"]]);
    const result = compareTrees(entry, hub, dest);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]).toContain("diverges");
  });

  test("counter-proof: a missing destination file must turn the gate red", () => {
    const hub = new Map([["packages/thing/src/a.ts", "aaaa1111"]]);
    const result = compareTrees(entry, hub, new Map());
    expect(result.failures[0]).toContain("missing at destination");
  });

  test("identical fingerprints are asserted, not excluded", () => {
    const hub = new Map([["packages/thing/src/a.ts", "aaaa1111"]]);
    const dest = new Map([["src/a.ts", "aaaa1111"]]);
    const result = compareTrees(entry, hub, dest);
    expect(result.failures).toEqual([]);
    expect(result.asserted).toBe(1);
  });

  test("bootstrap manifests and listed adaptations are counted apart, never asserted", () => {
    const hub = new Map([
      ["packages/thing/package.json", "cccc3333"],
      ["packages/thing/src/adapted.ts", "dddd4444"],
    ]);
    const dest = new Map([
      ["package.json", "eeee5555"],
      ["src/adapted.ts", "ffff6666"],
    ]);
    const withAdaptation = {
      ...entry,
      destination: "libre-ai/sdk-ts",
    };
    const hub2 = new Map([["packages/thing/scripts/generate-types.ts", "dddd4444"]]);
    const dest2 = new Map([["scripts/generate-types.ts", "ffff6666"]]);
    const r1 = compareTrees(entry, hub, dest);
    expect(r1.excludedBootstrap).toBe(1);
    const r2 = compareTrees(withAdaptation, hub2, dest2);
    expect(r2.excludedAdapted).toBe(1);
    expect(r2.failures).toEqual([]);
  });

  test("the adaptation list is the reviewed 34 plus the two hub gates the γ 3.7 dismantling adjusts plus the re-hosted toolchain policy (38)", () => {
    expect(ADAPTED_FILES.size).toBe(38);
  });
});

describe("driftVerdict", () => {
  const open = { windowClosed: false, adaptations: 3, bootstrap: 0 };

  test("a divergence is red whatever the window state", () => {
    expect(driftVerdict({ ...open, asserted: 12, failures: ["x"] }).ok).toBe(false);
    expect(driftVerdict({ ...open, windowClosed: true, asserted: 12, failures: ["x"] }).ok).toBe(
      false,
    );
  });

  test("while the window is open, asserting nothing is red, not green", () => {
    // The defect this control exists for: the gate reported success while its
    // skip list covered every family still present on both sides, so "no
    // divergence found" and "nothing was compared" printed the same line and
    // exited the same way.
    const verdict = driftVerdict({ ...open, asserted: 0, failures: [] });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("asserted no path");
  });

  test("declared adaptations alone never make a run meaningful", () => {
    // Adaptations are paths the gate agreed NOT to compare: counting them as
    // work done is how an empty run passes for a full one.
    const verdict = driftVerdict({ ...open, asserted: 0, adaptations: 38, failures: [] });
    expect(verdict.ok).toBe(false);
  });

  test("an archived hub closes the window: the gate says so instead of claiming a check", () => {
    const verdict = driftVerdict({
      windowClosed: true,
      asserted: 0,
      adaptations: 0,
      bootstrap: 0,
      failures: [],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toContain("window is closed");
    expect(verdict.message).not.toContain("asserted byte-identical");
  });

  test("an open window with assertions is green and says how many", () => {
    const verdict = driftVerdict({ ...open, asserted: 25, failures: [] });
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toContain("25");
  });
  test("a failure with the window closed is not announced as a divergence", () => {
    // A phantom adaptation and an unreadable tree both land on the failure
    // path. Saying "diverge during the pending window" when the window is shut
    // is the same untruth this gate exists to remove, one branch along.
    const verdict = driftVerdict({
      windowClosed: true,
      asserted: 0,
      adaptations: 0,
      bootstrap: 0,
      failures: ["adaptation x matches no hub path"],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).not.toContain("diverge during the pending window");
    expect(verdict.message).toContain("window closed");
  });
});
