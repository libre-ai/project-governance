import { describe, expect, test } from "bun:test";
import {
  ALLOWED_STATUS,
  bodyLineCount,
  lintEvalFile,
  lintSkillMarkdown,
  parseFrontmatter,
  SPDX_LICENSE_LINE,
} from "./lint-skill";

const SPDX_BLOCK = `<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->\n<!-- ${SPDX_LICENSE_LINE} -->\n\n`;

function validSkill(
  overrides: Partial<Record<string, string>> = {},
  body = `${SPDX_BLOCK}# Title\n\nSome guidance.\n`,
): string {
  const fields: Record<string, string> = {
    name: "example",
    description: "Do the example thing. Use when examples are needed.",
    license: "Apache-2.0",
    status: "candidate",
    ...overrides,
  };
  const frontmatter = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `---\n${frontmatter}\n---\n\n${body}`;
}

describe("parseFrontmatter", () => {
  test("parses a well-formed frontmatter block and returns the body separately", () => {
    const parsed = parseFrontmatter("---\nname: foo\ndescription: bar\n---\n\n# Title\nBody.\n");
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.frontmatter).toEqual({ name: "foo", description: "bar" });
    expect(parsed.body).toBe("\n# Title\nBody.\n");
  });

  test("rejects a file that does not open with a frontmatter fence", () => {
    const parsed = parseFrontmatter("# Title\nNo frontmatter.\n");
    expect("error" in parsed).toBe(true);
  });

  test("rejects an unclosed frontmatter fence", () => {
    const parsed = parseFrontmatter("---\nname: foo\n# Title\n");
    expect("error" in parsed).toBe(true);
  });

  test("rejects a frontmatter line with no colon", () => {
    const parsed = parseFrontmatter("---\nname foo\n---\nBody\n");
    expect("error" in parsed).toBe(true);
  });

  test("a description containing a colon still parses on the first colon", () => {
    const parsed = parseFrontmatter(
      "---\nname: foo\ndescription: Use when: this happens.\n---\nBody\n",
    );
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.frontmatter.description).toBe("Use when: this happens.");
  });

  test("rejects a folded (multi-line) scalar instead of silently minting a bogus key", () => {
    // Reproduces the adversarial-review finding: a description wrapped onto
    // a second, indented line whose continuation happens to contain a colon
    // used to parse as its own top-level key ("Use when: ..."), silently
    // truncating the real description to its first line. It must now fail
    // loud instead.
    const parsed = parseFrontmatter(
      "---\nname: foo\ndescription: Point to the thing.\n  Use when: this happens.\n---\nBody\n",
    );
    expect("error" in parsed).toBe(true);
    if (!("error" in parsed)) return;
    expect(parsed.error).toContain("multi-line scalars are not supported");
  });

  test("rejects a tab-indented continuation line the same way", () => {
    const parsed = parseFrontmatter("---\nname: foo\n\tdescription: bar\n---\nBody\n");
    expect("error" in parsed).toBe(true);
  });
});

describe("bodyLineCount", () => {
  test("trims leading and trailing blank lines but keeps interior ones", () => {
    expect(bodyLineCount("\n\nline1\n\nline2\n\n")).toBe(3);
  });

  test("an empty body counts zero lines", () => {
    expect(bodyLineCount("\n\n")).toBe(0);
  });
});

describe("lintSkillMarkdown", () => {
  test("a well-formed skill passes every rule", () => {
    const findings = lintSkillMarkdown("example", validSkill());
    expect(findings.every((finding) => finding.ok)).toBe(true);
  });

  test("flags a name that does not match its directory", () => {
    const findings = lintSkillMarkdown("other-dir", validSkill({ name: "example" }));
    const finding = findings.find((f) => f.rule === "frontmatter-name-matches-directory");
    expect(finding?.ok).toBe(false);
  });

  test("flags a missing required field", () => {
    const source = `---\nname: example\ndescription: Do the thing.\n---\n\n${SPDX_BLOCK}# Title\nBody.\n`;
    const findings = lintSkillMarkdown("example", source);
    expect(findings.find((f) => f.rule === "frontmatter-field:license")?.ok).toBe(false);
    expect(findings.find((f) => f.rule === "frontmatter-field:status")?.ok).toBe(false);
  });

  test("rejects a status outside the allowed enum", () => {
    const findings = lintSkillMarkdown("example", validSkill({ status: "deprecated" }));
    expect(findings.find((f) => f.rule === "frontmatter-status")?.ok).toBe(false);
  });

  test("accepts both allowed status values", () => {
    for (const status of ALLOWED_STATUS) {
      const findings = lintSkillMarkdown("example", validSkill({ status }));
      expect(findings.find((f) => f.rule === "frontmatter-status")?.ok).toBe(true);
    }
  });

  test("rejects a license other than Apache-2.0", () => {
    const findings = lintSkillMarkdown("example", validSkill({ license: "MIT" }));
    expect(findings.find((f) => f.rule === "frontmatter-license")?.ok).toBe(false);
  });

  test("accepts disable-model-invocation: true, rejects a non-boolean value", () => {
    const okFindings = lintSkillMarkdown(
      "example",
      validSkill({ "disable-model-invocation": "true" }),
    );
    expect(okFindings.find((f) => f.rule === "frontmatter-disable-model-invocation")?.ok).toBe(
      true,
    );

    const badFindings = lintSkillMarkdown(
      "example",
      validSkill({ "disable-model-invocation": "yes" }),
    );
    expect(badFindings.find((f) => f.rule === "frontmatter-disable-model-invocation")?.ok).toBe(
      false,
    );
  });

  test("flags a missing SPDX header", () => {
    const withoutSpdx = validSkill({}, "# Title\n\nSome guidance.\n");
    expect(
      lintSkillMarkdown("example", withoutSpdx).find((f) => f.rule === "spdx-header")?.ok,
    ).toBe(false);
  });

  test("flags a body with no Markdown heading", () => {
    const findings = lintSkillMarkdown(
      "example",
      validSkill({}, `${SPDX_BLOCK}Just a paragraph, no heading.\n`),
    );
    expect(findings.find((f) => f.rule === "body-has-heading")?.ok).toBe(false);
  });

  test("stops at the frontmatter-fence finding when the file has no frontmatter at all", () => {
    const findings = lintSkillMarkdown("example", "# Title\nNo frontmatter.\n");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("frontmatter-fence");
    expect(findings[0]?.ok).toBe(false);
  });
});

describe("lintEvalFile", () => {
  const valid = {
    positive: ["a", "b", "c"],
    negative: ["d", "e"],
    behavioral: { scenario: "s", expected: "e" },
  };

  test("a well-formed eval file passes every rule", () => {
    const findings = lintEvalFile(valid);
    expect(findings.every((f) => f.ok)).toBe(true);
  });

  test("rejects a non-object payload", () => {
    expect(lintEvalFile(null).every((f) => f.ok)).toBe(false);
    expect(lintEvalFile("not an object").every((f) => f.ok)).toBe(false);
  });

  test("rejects fewer than 3 positive triggers", () => {
    const findings = lintEvalFile({ ...valid, positive: ["only", "two"] });
    expect(findings.find((f) => f.rule === "eval-positive-triggers")?.ok).toBe(false);
  });

  test("rejects fewer than 2 negative triggers", () => {
    const findings = lintEvalFile({ ...valid, negative: ["only-one"] });
    expect(findings.find((f) => f.rule === "eval-negative-triggers")?.ok).toBe(false);
  });

  test("rejects an empty-string trigger", () => {
    const findings = lintEvalFile({ ...valid, positive: ["a", "b", "   "] });
    expect(findings.find((f) => f.rule === "eval-positive-triggers")?.ok).toBe(false);
  });

  test("rejects a missing or incomplete behavioral case", () => {
    expect(
      lintEvalFile({ ...valid, behavioral: undefined }).find(
        (f) => f.rule === "eval-behavioral-case",
      )?.ok,
    ).toBe(false);
    expect(
      lintEvalFile({ ...valid, behavioral: { scenario: "s" } }).find(
        (f) => f.rule === "eval-behavioral-case",
      )?.ok,
    ).toBe(false);
  });
});
