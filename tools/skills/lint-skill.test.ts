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

/**
 * A valid skill. `status` is written under `metadata:` (ADR-0052) unless
 * `statusAt` says otherwise; `null` omits it.
 */
function validSkill(
  overrides: Partial<Record<string, string>> = {},
  body = `${SPDX_BLOCK}# Title\n\nSome guidance.\n`,
  status: string | null = "candidate",
  statusAt: "metadata" | "top-level" = "metadata",
): string {
  const fields: Record<string, string> = {
    name: "example",
    description: "Do the example thing. Use when examples are needed.",
    license: "Apache-2.0",
    ...overrides,
  };
  if (status !== null && statusAt === "top-level") fields.status = status;
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  if (status !== null && statusAt === "metadata") lines.push("metadata:", `  status: ${status}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

describe("parseFrontmatter", () => {
  test("parses a well-formed frontmatter block and returns the body separately", () => {
    const parsed = parseFrontmatter("---\nname: foo\ndescription: bar\n---\n\n# Title\nBody.\n");
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.frontmatter).toEqual({ name: "foo", description: "bar" });
    expect(parsed.metadata).toEqual({});
    expect(parsed.body).toBe("\n# Title\nBody.\n");
  });

  // ADR-0052: metadata is the one block mapping, in the only form the Agent
  // Skills reference validator accepts.
  test("reads a metadata block mapping apart from the flat fields", () => {
    const parsed = parseFrontmatter(
      "---\nname: foo\nmetadata:\n  status: candidate\n  owner: x\ndescription: bar\n---\nBody\n",
    );
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.frontmatter).toEqual({ name: "foo", description: "bar" });
    expect(parsed.metadata).toEqual({ status: "candidate", owner: "x" });
  });

  test.each([
    [
      "the inline flow form",
      "---\nname: foo\nmetadata: { status: candidate }\n---\nBody\n",
      "block mapping",
    ],
    [
      "a four-space entry",
      "---\nname: foo\nmetadata:\n    status: candidate\n---\nBody\n",
      "exactly two spaces",
    ],
    [
      "a nested mapping",
      "---\nname: foo\nmetadata:\n  status:\n    deep: x\n---\nBody\n",
      "exactly two spaces",
    ],
    [
      "an indented line outside metadata",
      "---\nname: foo\n  status: candidate\n---\nBody\n",
      "multi-line scalars",
    ],
  ])("rejects %s", (_label, source, message) => {
    const parsed = parseFrontmatter(source);
    expect("error" in parsed).toBe(true);
    if (!("error" in parsed)) return;
    expect(parsed.error).toContain(message);
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

  // A harness that loads the skill reads this block as YAML, where an
  // unquoted ": " inside a plain scalar is a syntax error: the skill would
  // lint green here and fail to load there. The frontmatter must be valid
  // YAML, not merely splittable on its first colon.
  test("rejects an unquoted description containing ': ' (invalid YAML)", () => {
    const parsed = parseFrontmatter(
      "---\nname: foo\ndescription: Use when: this happens.\n---\nBody\n",
    );
    expect("error" in parsed).toBe(true);
    if (!("error" in parsed)) return;
    expect(parsed.error).toContain("not valid YAML");
  });

  test("a quoted description containing ': ' parses to its unquoted value", () => {
    const parsed = parseFrontmatter(
      '---\nname: foo\ndescription: "Use when: this happens."\n---\nBody\n',
    );
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.frontmatter.description).toBe("Use when: this happens.");
  });

  test("rejects a non-scalar value (flow list)", () => {
    const parsed = parseFrontmatter("---\nname: foo\ndescription: [a, b]\n---\nBody\n");
    expect("error" in parsed).toBe(true);
  });

  test("rejects a duplicated key (YAML parsers keep the last one silently)", () => {
    const parsed = parseFrontmatter("---\nname: foo\nname: bar\n---\nBody\n");
    expect("error" in parsed).toBe(true);
  });

  test("a boolean scalar is read back as its YAML text", () => {
    const parsed = parseFrontmatter("---\nname: foo\ndisable-model-invocation: true\n---\nBody\n");
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.frontmatter["disable-model-invocation"]).toBe("true");
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
    expect(findings.find((f) => f.rule === "frontmatter-status")?.ok).toBe(false);
  });

  test("rejects a status outside the allowed enum", () => {
    const findings = lintSkillMarkdown("example", validSkill({}, undefined, "deprecated"));
    expect(findings.find((f) => f.rule === "frontmatter-status")?.ok).toBe(false);
  });

  test("accepts both allowed status values under metadata", () => {
    for (const status of ALLOWED_STATUS) {
      const findings = lintSkillMarkdown("example", validSkill({}, undefined, status));
      expect(findings.find((f) => f.rule === "frontmatter-status")?.ok).toBe(true);
    }
  });

  // 2026-10-14: the Agent Skills reference validator refused a skill of this
  // collection with "Unexpected fields in frontmatter: status".
  test("a top-level status is refused and points to metadata.status", () => {
    const findings = lintSkillMarkdown(
      "example",
      validSkill({}, undefined, "candidate", "top-level"),
    );
    const keys = findings.find((f) => f.rule === "frontmatter-keys");
    expect(keys?.ok).toBe(false);
    expect(keys?.note).toContain("status lives in metadata.status since ADR-0052");
    expect(findings.find((f) => f.rule === "frontmatter-status")?.ok).toBe(false);
  });

  test("any top-level key outside the Agent Skills fields is refused", () => {
    const findings = lintSkillMarkdown("example", validSkill({ owner: "x" }));
    expect(findings.find((f) => f.rule === "frontmatter-keys")?.note).toContain(
      "outside the Agent Skills fields: owner",
    );
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

  // ADR-0050 D3: working_if carries the observable signs a promotion is
  // pronounced on. Form only; optional on a candidate, required once promoted.
  const workingIf = (raw: unknown, status?: string) =>
    lintEvalFile(raw, status).find((f) => f.rule === "eval-working-if");

  test("working_if absent: accepted on a candidate, refused on a promoted skill", () => {
    expect(workingIf(valid, "candidate")?.ok).toBe(true);
    expect(workingIf(valid, "candidate")?.note).toContain("required before promotion");
    expect(workingIf(valid, "promoted")?.ok).toBe(false);
  });

  test("working_if with two distinct signs passes, promoted or not", () => {
    const signs = { ...valid, working_if: ["the output cites each gate", "no question is asked"] };
    expect(workingIf(signs, "promoted")).toEqual({
      rule: "eval-working-if",
      ok: true,
      note: "2 working sign(s)",
    });
    expect(workingIf(signs, "candidate")?.ok).toBe(true);
  });

  test.each([
    ["a single sign", ["only one"]],
    ["a string instead of a list", "the output cites each gate"],
    ["an empty sign", ["a sign", "  "]],
    ["a non-string sign", ["a sign", 3]],
    ["a repeated sign", ["same", "same "]],
  ])("working_if is refused when it is %s", (_label, value) => {
    expect(workingIf({ ...valid, working_if: value }, "candidate")?.ok).toBe(false);
  });
});
