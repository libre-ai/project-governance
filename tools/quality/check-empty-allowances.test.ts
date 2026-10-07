import { describe, expect, test } from "bun:test";
import { compareAllowances, DECLARED_ALLOWANCES } from "./check-empty-allowances";

// The failure this guard anticipates: allowEmpty() spreading from the one gate
// that legitimately lost its target to any gate someone finds inconvenient.

describe("compareAllowances", () => {
  const declared = [{ file: "tools/quality/check-retired-names.ts", because: "families left" }];

  test("a declared allowance that is in force passes", () => {
    const scan = compareAllowances(declared, ["tools/quality/check-retired-names.ts"]);
    expect(scan.undeclared).toEqual([]);
    expect(scan.stale).toEqual([]);
  });

  test("an undeclared allowEmpty is caught", () => {
    const scan = compareAllowances(declared, [
      "tools/quality/check-retired-names.ts",
      "tools/quality/check-secret-scan.ts",
    ]);
    expect(scan.undeclared).toEqual(["tools/quality/check-secret-scan.ts"]);
  });

  test("a declaration whose allowEmpty is gone is reported as stale", () => {
    // A standing permission outliving its reason is how the next silent
    // allowance gets covered without anyone deciding it.
    const scan = compareAllowances(declared, []);
    expect(scan.stale).toEqual(["tools/quality/check-retired-names.ts"]);
  });

  test("an empty repository with no declarations is consistent", () => {
    expect(compareAllowances([], [])).toEqual({
      declared: [],
      found: [],
      undeclared: [],
      stale: [],
    });
  });
});

describe("DECLARED_ALLOWANCES", () => {
  test("every declaration states a reason, never an empty string", () => {
    for (const entry of DECLARED_ALLOWANCES) {
      expect(entry.because.length).toBeGreaterThan(20);
      expect(entry.file).toMatch(/^(tools|ecosystem)\/.*\.ts$/);
    }
  });
});
