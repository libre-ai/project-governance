import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadWorkPackagePolicy } from "./work-package-policy";

const SHIPPED = join(import.meta.dir, "..", "..", "ecosystem", "work-package-policy.v1.yaml");

const VALID = [
  "approvedFrom: décision",
  "exempt:",
  "  dependabot:",
  '    author: "dependabot[bot]"',
  "owners:",
  "  - constantin-jais",
  "",
].join("\n");

function reason(text: string): string {
  const result = loadWorkPackagePolicy(text);
  if (result.ok) {
    throw new Error(`expected ok:false, got ${JSON.stringify(result.value)}`);
  }
  return result.reason;
}

describe("loadWorkPackagePolicy", () => {
  test("loads the shipped file", async () => {
    const result = loadWorkPackagePolicy(await Bun.file(SHIPPED).text());
    expect(result).toEqual({
      ok: true,
      value: {
        approvedFrom: "décision",
        exempt: {
          dependabot: { author: "dependabot[bot]" },
          "docs-only": { paths: ["**/*.md", "docs/**"] },
          revert: { titlePrefix: "Revert " },
        },
        owners: ["constantin-jais"],
      },
    });
  });

  test("accepts a minimal valid policy", () => {
    expect(loadWorkPackagePolicy(VALID)).toEqual({
      ok: true,
      value: {
        approvedFrom: "décision",
        exempt: { dependabot: { author: "dependabot[bot]" } },
        owners: ["constantin-jais"],
      },
    });
  });

  test("approvedFrom outside the ladder is ok:false", () => {
    expect(reason(VALID.replace("décision", "approved"))).toContain("approvedFrom");
  });

  test("an exempt rule with two kinds of predicate is ok:false", () => {
    const text = VALID.replace(
      '    author: "dependabot[bot]"',
      '    author: "dependabot[bot]"\n    titlePrefix: "Bump "',
    );
    expect(reason(text)).toContain("dependabot");
  });

  test("an empty owners list is ok:false", () => {
    expect(
      reason(VALID.replace("  - constantin-jais\n", "").replace("owners:", "owners: []")),
    ).toContain("owners");
  });

  test("invalid YAML is ok:false", () => {
    expect(reason("approvedFrom: [unterminated\n")).toContain("YAML");
  });

  test("a non-object root is ok:false", () => {
    expect(reason("- a\n- b\n")).toContain("root");
    expect(reason("just a string\n")).toContain("root");
    expect(reason("")).toContain("root");
  });

  test("an unknown root key is ok:false and names the key", () => {
    expect(reason(`${VALID}approvers: [x]\n`)).toContain("approvers");
  });

  test("a missing root key is ok:false and names the key", () => {
    expect(reason("approvedFrom: décision\nowners: [a]\n")).toContain("exempt");
    expect(reason("exempt: {}\nowners: [a]\n")).toContain("approvedFrom");
    expect(reason("approvedFrom: décision\nexempt: {}\n")).toContain("owners");
  });

  test("owners that is not an array is ok:false", () => {
    expect(reason("approvedFrom: décision\nexempt: {}\nowners: constantin-jais\n")).toContain(
      "owners",
    );
  });

  test("owners containing a non-string or empty entry is ok:false", () => {
    expect(reason("approvedFrom: décision\nexempt: {}\nowners: [a, 3]\n")).toContain("owners");
    expect(reason('approvedFrom: décision\nexempt: {}\nowners: [a, ""]\n')).toContain("owners");
    expect(reason("approvedFrom: décision\nexempt: {}\nowners: [a, null]\n")).toContain("owners");
  });

  test("an exempt that is not an object is ok:false", () => {
    expect(reason("approvedFrom: décision\nexempt: [a]\nowners: [a]\n")).toContain("exempt");
    expect(reason("approvedFrom: décision\nexempt: nope\nowners: [a]\n")).toContain("exempt");
  });

  test("an exempt rule with no predicate is ok:false", () => {
    expect(reason("approvedFrom: décision\nexempt:\n  empty: {}\nowners: [a]\n")).toContain(
      "empty",
    );
  });

  test("an exempt rule with an unknown predicate key is ok:false and names the key", () => {
    const text = "approvedFrom: décision\nexempt:\n  r:\n    branch: main\nowners: [a]\n";
    const why = reason(text);
    expect(why).toContain("branch");
    expect(why).toContain("r");
  });

  test("an exempt rule that is not an object is ok:false", () => {
    expect(reason("approvedFrom: décision\nexempt:\n  r: dependabot\nowners: [a]\n")).toContain(
      "r",
    );
  });

  test("an empty predicate string is ok:false", () => {
    for (const body of ['author: ""', 'titlePrefix: ""', "author: 7", "titlePrefix: [x]"]) {
      const text = `approvedFrom: décision\nexempt:\n  r:\n    ${body}\nowners: [a]\n`;
      expect(reason(text)).toContain("r");
    }
  });

  test("paths must be a non-empty array of non-empty strings", () => {
    for (const body of [
      "paths: []",
      "paths: docs/**",
      'paths: [""]',
      "paths: [1]",
      "paths: [a, null]",
    ]) {
      const text = `approvedFrom: décision\nexempt:\n  r:\n    ${body}\nowners: [a]\n`;
      expect(reason(text)).toContain("paths");
    }
  });

  test("an empty exempt object is valid (no exemption)", () => {
    expect(loadWorkPackagePolicy("approvedFrom: proposition\nexempt: {}\nowners: [a]\n")).toEqual({
      ok: true,
      value: { approvedFrom: "proposition", exempt: {}, owners: ["a"] },
    });
  });
});
