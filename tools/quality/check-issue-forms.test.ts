import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runIssueFormCheck, validateIssueForm } from "./check-issue-forms";

const KNOWN_LABELS: ReadonlySet<string> = new Set([
  "kind:work-package",
  "kind:decision-request",
  "kind:idea",
  "kind:question",
  "ready",
]);

const WORK_PACKAGE = `name: Work package
description: A work package of an approved product requirements document.
title: "[Work package]: "
labels:
  - kind:work-package
body:
  - type: markdown
    attributes:
      value: |
        Scope and verification live in the PRD, not in this issue.
  - type: input
    id: prd-ref
    attributes:
      label: PRD-ref
      description: "Form: <owner>/<repo>@<40 hex>:<path>"
    validations:
      required: true
  - type: input
    id: wp
    attributes:
      label: WP
      description: "Row of the PRD table, for example WP-1."
    validations:
      required: true
`;

const DECISION_REQUEST = `name: Decision request
description: A decision only the owner can take.
title: "[Decision]: "
labels:
  - kind:decision-request
body:
  - type: markdown
    attributes:
      value: Only the owner answers.
  - type: textarea
    id: context
    attributes:
      label: Context
    validations:
      required: true
  - type: textarea
    id: option-a
    attributes:
      label: Option A
    validations:
      required: true
  - type: textarea
    id: option-b
    attributes:
      label: Option B
    validations:
      required: true
  - type: textarea
    id: option-c
    attributes:
      label: Option C
    validations:
      required: false
  - type: textarea
    id: option-d
    attributes:
      label: Option D
  - type: textarea
    id: recommendation
    attributes:
      label: Recommendation
`;

const IDEA = `name: Idea
description: A deferred idea.
labels:
  - kind:idea
body:
  - type: textarea
    id: statement
    attributes:
      label: Statement
    validations:
      required: true
  - type: textarea
    id: why-deferred
    attributes:
      label: Why deferred
    validations:
      required: true
`;

const QUESTION = `name: Question
description: An open question.
labels:
  - kind:question
body:
  - type: textarea
    id: statement
    attributes:
      label: Statement
    validations:
      required: true
  - type: input
    id: document
    attributes:
      label: Document carrying the missing fact
    validations:
      required: true
`;

/** Replaces exactly one occurrence, so a mutant that no longer differs fails the suite. */
function mutate(source: string, from: string, to: string): string {
  const first = source.indexOf(from);
  if (first === -1 || source.indexOf(from, first + 1) !== -1) {
    throw new Error(`fixture mutation needs exactly one occurrence of: ${from}`);
  }
  return source.replace(from, to);
}

const mentions = (violations: readonly string[], needle: string): boolean =>
  violations.some((violation) => violation.includes(needle));

describe("validateIssueForm: valid forms", () => {
  test("a valid work-package form has no violation", () => {
    expect(validateIssueForm(WORK_PACKAGE, KNOWN_LABELS)).toEqual([]);
  });

  test("a valid decision-request form has no violation", () => {
    expect(validateIssueForm(DECISION_REQUEST, KNOWN_LABELS)).toEqual([]);
  });

  test("a valid idea form has no violation", () => {
    expect(validateIssueForm(IDEA, KNOWN_LABELS)).toEqual([]);
  });

  test("a valid question form has no violation", () => {
    expect(validateIssueForm(QUESTION, KNOWN_LABELS)).toEqual([]);
  });
});

describe("validateIssueForm: work-package", () => {
  test("work-package requires the PRD-ref and WP fields", () => {
    const withoutWp = mutate(
      WORK_PACKAGE,
      `  - type: input
    id: wp
    attributes:
      label: WP
      description: "Row of the PRD table, for example WP-1."
    validations:
      required: true
`,
      "",
    );
    expect(mentions(validateIssueForm(withoutWp, KNOWN_LABELS), "WP")).toBe(true);

    const withoutPrdRef = mutate(WORK_PACKAGE, "label: PRD-ref", "label: Reference");
    const violations = validateIssueForm(withoutPrdRef, KNOWN_LABELS);
    expect(mentions(violations, "PRD-ref")).toBe(true);
    expect(mentions(violations, "Reference")).toBe(true);
  });

  test("a work-package field that is not required is a violation", () => {
    const optional = mutate(
      WORK_PACKAGE,
      `      label: WP
      description: "Row of the PRD table, for example WP-1."
    validations:
      required: true`,
      `      label: WP
      description: "Row of the PRD table, for example WP-1."
    validations:
      required: false`,
    );
    expect(mentions(validateIssueForm(optional, KNOWN_LABELS), "WP")).toBe(true);
  });

  test("a work-package field of another type is a violation", () => {
    const wrongType = mutate(
      WORK_PACKAGE,
      `  - type: input
    id: prd-ref`,
      `  - type: textarea
    id: prd-ref`,
    );
    expect(mentions(validateIssueForm(wrongType, KNOWN_LABELS), "PRD-ref")).toBe(true);
  });

  test("a work-package form carries no field besides PRD-ref and WP", () => {
    const extra = `${WORK_PACKAGE}  - type: textarea
    id: scope
    attributes:
      label: Scope
`;
    expect(mentions(validateIssueForm(extra, KNOWN_LABELS), "Scope")).toBe(true);
  });
});

describe("validateIssueForm: decision-request", () => {
  const optionBlock = (letter: string, required: boolean): string => `  - type: textarea
    id: option-${letter.toLowerCase()}
    attributes:
      label: Option ${letter}
    validations:
      required: ${required}
`;

  test("decision-request needs 2 to 4 options", () => {
    const oneOption = mutate(
      mutate(DECISION_REQUEST, optionBlock("B", true), ""),
      optionBlock("C", false),
      "",
    ).replace(/ {2}- type: textarea\n {4}id: option-d\n {4}attributes:\n {6}label: Option D\n/, "");
    expect(mentions(validateIssueForm(oneOption, KNOWN_LABELS), "option")).toBe(true);

    const fiveOptions = `${DECISION_REQUEST}${optionBlock("E", false)}`;
    expect(mentions(validateIssueForm(fiveOptions, KNOWN_LABELS), "option")).toBe(true);
  });

  test("the first two options must be required", () => {
    const optionalB = mutate(
      DECISION_REQUEST,
      `      label: Option B
    validations:
      required: true`,
      `      label: Option B
    validations:
      required: false`,
    );
    expect(mentions(validateIssueForm(optionalB, KNOWN_LABELS), "Option B")).toBe(true);
  });

  test("the options after the second must be optional", () => {
    const requiredC = mutate(
      DECISION_REQUEST,
      `      label: Option C
    validations:
      required: false`,
      `      label: Option C
    validations:
      required: true`,
    );
    expect(mentions(validateIssueForm(requiredC, KNOWN_LABELS), "Option C")).toBe(true);
  });

  test("the Context field is required", () => {
    const optionalContext = mutate(
      DECISION_REQUEST,
      `      label: Context
    validations:
      required: true`,
      `      label: Context`,
    );
    expect(mentions(validateIssueForm(optionalContext, KNOWN_LABELS), "Context")).toBe(true);
  });

  test("a required Recommendation is a violation: it exists only when the author has one", () => {
    const requiredRecommendation = mutate(
      DECISION_REQUEST,
      `      label: Recommendation
`,
      `      label: Recommendation
    validations:
      required: true
`,
    );
    expect(
      mentions(validateIssueForm(requiredRecommendation, KNOWN_LABELS), "Recommendation"),
    ).toBe(true);
  });
});

describe("validateIssueForm: idea and question", () => {
  test("an idea without Why deferred is a violation", () => {
    const missing = mutate(IDEA, "label: Why deferred", "label: Reason");
    expect(mentions(validateIssueForm(missing, KNOWN_LABELS), "Why deferred")).toBe(true);
  });

  test("an optional idea Statement is a violation", () => {
    const optional = mutate(
      IDEA,
      `      label: Statement
    validations:
      required: true`,
      "      label: Statement",
    );
    expect(mentions(validateIssueForm(optional, KNOWN_LABELS), "Statement")).toBe(true);
  });

  test("a question must name the document carrying the missing fact", () => {
    const missing = mutate(
      QUESTION,
      "label: Document carrying the missing fact",
      "label: Document",
    );
    expect(
      mentions(validateIssueForm(missing, KNOWN_LABELS), "Document carrying the missing fact"),
    ).toBe(true);
  });

  test("the question document field is an input, not a textarea", () => {
    const wrongType = mutate(
      QUESTION,
      `  - type: input
    id: document`,
      `  - type: textarea
    id: document`,
    );
    expect(
      mentions(validateIssueForm(wrongType, KNOWN_LABELS), "Document carrying the missing fact"),
    ).toBe(true);
  });
});

describe("validateIssueForm: labels and form kind", () => {
  test("a label absent from knownLabels is a violation", () => {
    const known = new Set([...KNOWN_LABELS].filter((label) => label !== "kind:idea"));
    const violations = validateIssueForm(IDEA, known);
    expect(mentions(violations, "kind:idea")).toBe(true);
  });

  test("a label other than the kind is checked against knownLabels too", () => {
    const extra = mutate(IDEA, "  - kind:idea\n", "  - kind:idea\n  - urgent\n");
    expect(mentions(validateIssueForm(extra, KNOWN_LABELS), "urgent")).toBe(true);
  });

  test("labels that are not a list of strings are a violation", () => {
    expect(
      validateIssueForm(mutate(IDEA, "labels:\n  - kind:idea", "labels: kind:idea"), KNOWN_LABELS),
    ).not.toEqual([]);
    expect(
      validateIssueForm(mutate(IDEA, "labels:\n  - kind:idea", "labels:\n  - 3"), KNOWN_LABELS),
    ).not.toEqual([]);
    expect(
      validateIssueForm(mutate(IDEA, "labels:\n  - kind:idea", "labels: []"), KNOWN_LABELS),
    ).not.toEqual([]);
  });

  test("a form without labels cannot be identified and is a violation", () => {
    const noLabels = mutate(IDEA, "labels:\n  - kind:idea\n", "");
    expect(mentions(validateIssueForm(noLabels, KNOWN_LABELS), "labels")).toBe(true);
  });

  test("a form with two kind labels is ambiguous", () => {
    const two = mutate(IDEA, "  - kind:idea\n", "  - kind:idea\n  - kind:question\n");
    expect(mentions(validateIssueForm(two, KNOWN_LABELS), "kind")).toBe(true);
  });

  test("a form with no kind label is a violation", () => {
    const none = mutate(IDEA, "  - kind:idea\n", "  - ready\n");
    expect(mentions(validateIssueForm(none, KNOWN_LABELS), "kind")).toBe(true);
  });

  test("an unknown kind is a violation even when the label is known", () => {
    const known = new Set([...KNOWN_LABELS, "kind:rumour"]);
    const unknown = mutate(IDEA, "kind:idea", "kind:rumour");
    expect(mentions(validateIssueForm(unknown, known), "kind:rumour")).toBe(true);
  });

  test("the kind comes from the labels, not from the file name or the title", () => {
    const retitled = mutate(IDEA, "name: Idea", "name: Work package");
    expect(validateIssueForm(retitled, KNOWN_LABELS)).toEqual([]);
  });
});

describe("validateIssueForm: structure", () => {
  test("a field id used twice is a violation", () => {
    const twice = mutate(IDEA, "id: why-deferred", "id: statement");
    expect(mentions(validateIssueForm(twice, KNOWN_LABELS), "statement")).toBe(true);
  });

  test("two fields with the same label are a violation", () => {
    const twice = mutate(IDEA, "label: Why deferred", "label: Statement");
    expect(mentions(validateIssueForm(twice, KNOWN_LABELS), "Statement")).toBe(true);
  });

  test("invalid YAML is a violation", () => {
    expect(validateIssueForm("name: [unclosed\n", KNOWN_LABELS)).not.toEqual([]);
  });

  test("an empty document is a violation", () => {
    expect(validateIssueForm("", KNOWN_LABELS)).not.toEqual([]);
    expect(validateIssueForm("# only a comment\n", KNOWN_LABELS)).not.toEqual([]);
  });

  test("a root that is not a mapping is a violation", () => {
    expect(validateIssueForm("- a\n- b\n", KNOWN_LABELS)).not.toEqual([]);
    expect(validateIssueForm("just a string\n", KNOWN_LABELS)).not.toEqual([]);
  });

  test("an unknown root key is a violation", () => {
    const unknown = mutate(IDEA, "name: Idea\n", "name: Idea\nsurprise: yes\n");
    expect(mentions(validateIssueForm(unknown, KNOWN_LABELS), "surprise")).toBe(true);
  });

  test("a missing name or description is a violation", () => {
    expect(
      mentions(validateIssueForm(mutate(IDEA, "name: Idea\n", ""), KNOWN_LABELS), "name"),
    ).toBe(true);
    expect(
      mentions(
        validateIssueForm(mutate(IDEA, "description: A deferred idea.\n", ""), KNOWN_LABELS),
        "description",
      ),
    ).toBe(true);
  });

  test("a title that is not a string is a violation", () => {
    const numeric = mutate(IDEA, "name: Idea\n", "name: Idea\ntitle: 3\n");
    expect(mentions(validateIssueForm(numeric, KNOWN_LABELS), "title")).toBe(true);
  });

  test("an absent body is a violation", () => {
    const start = IDEA.indexOf("body:");
    expect(mentions(validateIssueForm(IDEA.slice(0, start), KNOWN_LABELS), "body")).toBe(true);
  });

  test("an empty or non-list body is a violation", () => {
    const start = IDEA.indexOf("body:");
    expect(
      mentions(validateIssueForm(`${IDEA.slice(0, start)}body: []\n`, KNOWN_LABELS), "body"),
    ).toBe(true);
    expect(
      mentions(validateIssueForm(`${IDEA.slice(0, start)}body: text\n`, KNOWN_LABELS), "body"),
    ).toBe(true);
  });

  test("a body element of an unknown type is a violation", () => {
    const unknown = mutate(
      IDEA,
      "type: textarea\n    id: why-deferred",
      "type: slider\n    id: why-deferred",
    );
    expect(mentions(validateIssueForm(unknown, KNOWN_LABELS), "slider")).toBe(true);
  });

  test("a body element that is not a mapping is a violation", () => {
    const scalar = `${IDEA}  - just text\n`;
    expect(validateIssueForm(scalar, KNOWN_LABELS)).not.toEqual([]);
  });

  test("a fillable field without attributes.label is a violation", () => {
    const unlabelled = mutate(IDEA, "      label: Why deferred\n", "      description: no label\n");
    expect(mentions(validateIssueForm(unlabelled, KNOWN_LABELS), "label")).toBe(true);
    const blank = mutate(IDEA, "label: Why deferred", 'label: "  "');
    expect(mentions(validateIssueForm(blank, KNOWN_LABELS), "label")).toBe(true);
  });

  test("a markdown element without a value is a violation", () => {
    const empty = mutate(
      WORK_PACKAGE,
      `    attributes:
      value: |
        Scope and verification live in the PRD, not in this issue.
`,
      "    attributes:\n      other: x\n",
    );
    expect(mentions(validateIssueForm(empty, KNOWN_LABELS), "markdown")).toBe(true);
  });

  test("validations.required that is not a boolean is a violation", () => {
    const text = mutate(
      IDEA,
      `      label: Why deferred
    validations:
      required: true`,
      `      label: Why deferred
    validations:
      required: "yes"`,
    );
    expect(mentions(validateIssueForm(text, KNOWN_LABELS), "required")).toBe(true);
  });

  test("an id that GitHub would refuse is a violation", () => {
    const bad = mutate(IDEA, "id: why-deferred", 'id: "why deferred"');
    expect(mentions(validateIssueForm(bad, KNOWN_LABELS), "id")).toBe(true);
  });
});

describe("validateIssueForm: ambiguous YAML fails closed", () => {
  test("a repeated key is a violation, not a silent last-wins", () => {
    const repeated = mutate(IDEA, "name: Idea\n", "name: Idea\nname: Other\n");
    expect(mentions(validateIssueForm(repeated, KNOWN_LABELS), "name")).toBe(true);
  });

  test("a repeated key inside a field is a violation", () => {
    const repeated = mutate(
      IDEA,
      `      label: Why deferred
    validations:
      required: true`,
      `      label: Why deferred
    validations:
      required: false
      required: true`,
    );
    expect(mentions(validateIssueForm(repeated, KNOWN_LABELS), "required")).toBe(true);
  });

  test("the same key in two different list items is not a repeat", () => {
    expect(validateIssueForm(IDEA, KNOWN_LABELS)).toEqual([]);
  });

  test("text inside a block scalar that looks like a key is not a repeat", () => {
    const quoted = mutate(
      WORK_PACKAGE,
      "        Scope and verification live in the PRD, not in this issue.\n",
      "        Door: one-way\n        Door: two-way\n",
    );
    expect(validateIssueForm(quoted, KNOWN_LABELS)).toEqual([]);
  });

  test("an alias is a violation", () => {
    const aliased = mutate(
      IDEA,
      "      label: Why deferred\n",
      "      label: &reason Why deferred\n",
    );
    expect(validateIssueForm(aliased, KNOWN_LABELS)).not.toEqual([]);
  });

  test("a merge key is a violation", () => {
    const merged = mutate(IDEA, "name: Idea\n", "name: Idea\n<<: {x: 1}\n");
    expect(validateIssueForm(merged, KNOWN_LABELS)).not.toEqual([]);
  });

  test("a flow mapping, whose repeated keys cannot be seen, is a violation", () => {
    const flow = mutate(
      IDEA,
      "    attributes:\n      label: Why deferred",
      "    attributes: {label: Why deferred}",
    );
    expect(validateIssueForm(flow, KNOWN_LABELS)).not.toEqual([]);
  });

  /** A work-package form whose two fields are written as the given body items. */
  const workPackageWithItems = (first: string, second: string): string => `name: Work package
description: A work package.
labels:
  - kind:work-package
body:
  ${first}
  ${second}
`;
  const WP_FIELD =
    "- {type: input, id: wp, attributes: {label: WP}, validations: {required: true}}";

  test("a flow mapping as a list item with a repeated type is a violation", () => {
    const text = workPackageWithItems(
      "- {type: textarea, type: input, id: a, attributes: {label: PRD-ref}, validations: {required: true}}",
      WP_FIELD,
    );
    expect(mentions(validateIssueForm(text, KNOWN_LABELS), "flow")).toBe(true);
  });

  test("a flow mapping as a list item with a repeated required is a violation", () => {
    const text = workPackageWithItems(
      "- {type: input, id: a, attributes: {label: PRD-ref}, validations: {required: false, required: true}}",
      WP_FIELD,
    );
    expect(mentions(validateIssueForm(text, KNOWN_LABELS), "flow")).toBe(true);
  });

  test("a flow mapping as a list item is refused even without a repeat", () => {
    const text = workPackageWithItems(
      "- {type: input, id: a, attributes: {label: PRD-ref}, validations: {required: true}}",
      WP_FIELD,
    );
    expect(mentions(validateIssueForm(text, KNOWN_LABELS), "flow")).toBe(true);
  });

  test("a flow mapping inside a flow sequence value is a violation", () => {
    const text = mutate(IDEA, "name: Idea\n", "name: Idea\nextra: [{a: 1, a: 2}]\n");
    expect(mentions(validateIssueForm(text, KNOWN_LABELS), "flow")).toBe(true);
  });

  test("a flow mapping behind a nested dash is a violation", () => {
    const text = `${IDEA}  - - {a: 1}\n`;
    expect(mentions(validateIssueForm(text, KNOWN_LABELS), "flow")).toBe(true);
  });

  test("a flow sequence as a list item is a violation", () => {
    const text = `${IDEA}  - [a, b]\n`;
    expect(mentions(validateIssueForm(text, KNOWN_LABELS), "flow")).toBe(true);
  });

  test("plain scalar items, block lists and a flow sequence of strings stay valid", () => {
    expect(validateIssueForm(IDEA, KNOWN_LABELS)).toEqual([]);
    const inline = mutate(IDEA, "labels:\n  - kind:idea", 'labels: ["kind:idea"]');
    expect(validateIssueForm(inline, KNOWN_LABELS)).toEqual([]);
    const plainItem = mutate(IDEA, "  - kind:idea\n", "  - kind:idea\n  - ready\n");
    expect(validateIssueForm(plainItem, KNOWN_LABELS)).toEqual([]);
  });
});

describe("runIssueFormCheck", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function workspace(forms: Readonly<Record<string, string>>): {
    readonly formsDir: string;
    readonly labelsPath: string;
  } {
    const root = mkdtempSync(join(tmpdir(), "issue-forms-"));
    roots.push(root);
    const formsDir = join(root, "ISSUE_TEMPLATE");
    mkdirSync(formsDir);
    for (const [name, text] of Object.entries(forms)) writeFileSync(join(formsDir, name), text);
    const labelsPath = join(root, "labels.yml");
    writeFileSync(
      labelsPath,
      [...KNOWN_LABELS]
        .map((name) => `- name: "${name}"\n  color: "0e8a16"\n  description: "A label."\n`)
        .join("\n"),
    );
    return { formsDir, labelsPath };
  }

  async function run(
    formsDir: string,
    labelsPath: string,
  ): Promise<{ readonly code: number; readonly output: string }> {
    const lines: string[] = [];
    const code = await runIssueFormCheck(["--forms", formsDir, "--labels", labelsPath], (line) =>
      lines.push(line),
    );
    return { code, output: lines.join("\n") };
  }

  const ALL_FORMS = {
    "work-package.yml": WORK_PACKAGE,
    "decision-request.yml": DECISION_REQUEST,
    "idea.yml": IDEA,
    "question.yml": QUESTION,
  };

  test("four valid forms pass and the volume is printed", async () => {
    const { formsDir, labelsPath } = workspace(ALL_FORMS);
    const { code, output } = await run(formsDir, labelsPath);
    expect(code).toBe(0);
    expect(output).toContain("4 formulaires examinés, 0 violations");
  });

  test("a violation names the file and fails the run", async () => {
    const { formsDir, labelsPath } = workspace({
      ...ALL_FORMS,
      "idea.yml": mutate(IDEA, "label: Why deferred", "label: Reason"),
    });
    const { code, output } = await run(formsDir, labelsPath);
    expect(code).not.toBe(0);
    expect(output).toContain("idea.yml");
    // The renamed field is both a missing "Why deferred" and an unexpected "Reason".
    expect(output).toContain("4 formulaires examinés, 2 violations");
  });

  test("an empty directory is not a success", async () => {
    const { formsDir, labelsPath } = workspace({});
    const { code, output } = await run(formsDir, labelsPath);
    expect(code).not.toBe(0);
    expect(output).toContain("0 formulaires examinés");
  });

  test("a directory holding only a config file is not a success", async () => {
    const { formsDir, labelsPath } = workspace({ "config.yml": "blank_issues_enabled: false\n" });
    const { code } = await run(formsDir, labelsPath);
    expect(code).not.toBe(0);
  });

  test("config.yml is not a form: it is counted apart and never validated", async () => {
    const { formsDir, labelsPath } = workspace({
      ...ALL_FORMS,
      "config.yml": "blank_issues_enabled: false\n",
    });
    const { code, output } = await run(formsDir, labelsPath);
    expect(code).toBe(0);
    expect(output).toContain("4 formulaires examinés, 0 violations");
    expect(output).toContain("1 ignoré");
  });

  test("a missing forms directory fails", async () => {
    const { formsDir, labelsPath } = workspace(ALL_FORMS);
    const { code, output } = await run(`${formsDir}-absent`, labelsPath);
    expect(code).not.toBe(0);
    expect(output).toContain("cannot read");
  });

  test("a missing or invalid labels file fails", async () => {
    const { formsDir, labelsPath } = workspace(ALL_FORMS);
    expect((await run(formsDir, `${labelsPath}-absent`)).code).not.toBe(0);
    writeFileSync(labelsPath, "not: a sequence\n");
    expect((await run(formsDir, labelsPath)).code).not.toBe(0);
  });

  test("a missing option is a usage error", async () => {
    const lines: string[] = [];
    expect(await runIssueFormCheck(["--forms", "x"], (line) => lines.push(line))).toBe(2);
    expect(await runIssueFormCheck([], (line) => lines.push(line))).toBe(2);
    expect(await runIssueFormCheck(["--forms", "x", "--labels", "y", "--z"], () => {})).toBe(2);
  });

  test("an unparseable form is counted and reported, never skipped", async () => {
    const { formsDir, labelsPath } = workspace(ALL_FORMS);
    writeFileSync(join(formsDir, "broken.yml"), "name: [unclosed\n");
    const { code, output } = await run(formsDir, labelsPath);
    expect(code).not.toBe(0);
    expect(output).toContain("broken.yml");
    expect(output).toContain("5 formulaires examinés, 1 violation");
  });
});
