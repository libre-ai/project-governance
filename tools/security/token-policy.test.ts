import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { containsCredentialMarker } from "../quality/public-source-scanner";

// docs/security/TOKEN-POLICY.md carries an inventory of the stored secrets
// the workflows of this repository read. An inventory nobody compares with
// the workflows drifts on the first `secrets.<NAME>` added in a hurry, and a
// stale inventory is worse than none: it is read as the list. This test
// enumerates the workflows itself and fails when the two diverge. Its verdict
// is a function of the tracked files: no clock, no network.
//
// A test file alone, with its analysis functions local: a module only its
// test imports is dead code for tools/quality/check-dead-code.ts.

const REPOSITORY_ROOT = new URL("../../", import.meta.url).pathname;
const POLICY_PATH = "docs/security/TOKEN-POLICY.md";
const WORKFLOW_DIRECTORY = ".github/workflows/";
const MAXIMUM_LIFETIME_DAYS = 90;

const SECTIONS: readonly string[] = [
  "The policy",
  "Order of preference",
  "Inventory",
  "Rotation and exposure",
  "What this policy does not verify",
];

const COLUMNS: readonly string[] = [
  "Secret name",
  "Service",
  "Consumer",
  "Scope",
  "Maximum lifetime (days)",
  "Functional owner",
  "Decision (dated)",
];

interface WorkflowSource {
  readonly path: string;
  readonly text: string;
}

interface Inventory {
  /** Blocks of consecutive table lines under the section; one is expected. */
  readonly tables: number;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

// The two spellings of a read that names one secret: `secrets.NAME` and
// `secrets['NAME']` (double quotes accepted too). Matched over the raw text,
// comments included, so a name is never missed for sitting in an odd place.
const NAMED_READ =
  /\bsecrets(?:\.([A-Za-z_][A-Za-z0-9_]*)|\s*\[\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2\s*\])/g;

// The job's own token, which the policy's rank 1 spells `github.token`.
const JOB_TOKEN = "GITHUB_TOKEN";

const secretNames = (workflowText: string): string[] =>
  [
    ...new Set([...workflowText.matchAll(NAMED_READ)].map((match) => match[1] ?? match[3] ?? "")),
  ].sort();

// Every expression GitHub evaluates: the `${{ … }}` spans of any key or
// value, and an `if:` value written without delimiters, which GitHub reads as
// an expression all the same. Comments are gone once the YAML is parsed.
function expressionsOf(node: unknown, key: string | null, out: string[]): string[] {
  const spans = (text: string): string[] =>
    [...text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((match) => match[1] ?? "");
  if (typeof node === "string") {
    const found = spans(node);
    out.push(...(found.length === 0 && key === "if" ? [node] : found));
  } else if (Array.isArray(node)) {
    for (const item of node) expressionsOf(item, null, out);
  } else if (typeof node === "object" && node !== null) {
    for (const [childKey, child] of Object.entries(node)) {
      out.push(...spans(childKey));
      expressionsOf(child, childKey, out);
    }
  }
  return out;
}

// What is left of `secrets` once the named reads and the string literals are
// removed reads the context as a whole (`toJSON(secrets)`, `secrets`, a
// computed key): it hands every stored secret over and names none of them.
const readsWholeContext = (expression: string): boolean =>
  /(?<![\w.-])secrets(?![\w-])/.test(
    expression.replace(NAMED_READ, "").replace(/'(?:[^']|'')*'/g, "''"),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Findings on one workflow that do not involve the inventory. */
function workflowFindings(workflow: WorkflowSource): string[] {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(workflow.text);
  } catch {
    // An unreadable source is a failure, never an empty workflow.
    return [`workflow ${workflow.path} is not parseable YAML`];
  }
  const findings: string[] = [];
  const jobs = isRecord(parsed) ? parsed.jobs : undefined;
  for (const [job, definition] of Object.entries(isRecord(jobs) ? jobs : {})) {
    const secrets = isRecord(definition) ? definition.secrets : undefined;
    if (typeof secrets === "string" && secrets.trim().toLowerCase() === "inherit")
      findings.push(`workflow ${workflow.path}: job ${job} passes "secrets: inherit"`);
  }
  if (expressionsOf(parsed, null, []).some(readsWholeContext))
    findings.push(`workflow ${workflow.path} reads the secrets context without naming a secret`);
  if (secretNames(workflow.text).some((name) => name.toUpperCase() === JOB_TOKEN))
    findings.push(
      `workflow ${workflow.path} reads the job token as secrets.${JOB_TOKEN}; use github.token`,
    );
  return findings;
}

/** Names of stored secrets, the job token excluded: it is refused apart. */
const storedSecretNames = (workflowText: string): string[] =>
  secretNames(workflowText).filter((name) => name.toUpperCase() !== JOB_TOKEN);

const sectionHeadings = (document: string): string[] =>
  document
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());

const cellsOf = (tableLine: string): string[] =>
  tableLine
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

function readInventory(document: string): Inventory {
  const lines = document.split("\n");
  const start = lines.indexOf("## Inventory");
  if (start === -1) return { tables: 0, header: [], rows: [] };
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => line.startsWith("## "));
  const section = next === -1 ? rest : rest.slice(0, next);
  const isTableLine = (line: string | undefined): boolean =>
    line?.trimStart().startsWith("|") === true;
  const tables = section.filter(
    (line, index) => isTableLine(line) && !isTableLine(section[index - 1]),
  ).length;
  const tableLines = section.filter(isTableLine);
  // The second line is the Markdown delimiter row; it carries no data.
  return {
    tables,
    header: cellsOf(tableLines[0] ?? ""),
    rows: tableLines.slice(2).map(cellsOf),
  };
}

const backticked = (text: string): string[] =>
  [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");

const isRepositoryPath = (span: string): boolean =>
  /^\.?[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+\/?$/.test(span) ||
  /^[A-Za-z0-9_-]+\.(?:md|ya?ml|ts|json)$/.test(span);

const citedPaths = (document: string): string[] =>
  [...new Set(backticked(document).filter(isRepositoryPath))].sort();

function headerFindings(document: string): string[] {
  const findings: string[] = [];
  const lines = document.split("\n");
  if (!(lines[0] ?? "").startsWith("# "))
    findings.push("the document does not open with a level-1 title");
  const firstSection = lines.findIndex((line) => line.startsWith("## "));
  const preamble = firstSection === -1 ? lines : lines.slice(0, firstSection);
  const status = preamble.find((line) => line.startsWith("- **Status:**"));
  if (status === undefined) findings.push('bullet "Status" is missing before the first section');
  else if (!/^- \*\*Status:\*\* proposed\b/.test(status))
    findings.push('bullet "Status" does not start with "proposed"');
  if (!preamble.some((line) => line.startsWith("- **Scope:**")))
    findings.push('bullet "Scope" is missing before the first section');
  return findings;
}

function sectionFindings(document: string): string[] {
  const found = sectionHeadings(document);
  const findings: string[] = [];
  for (const section of SECTIONS) {
    const count = found.filter((heading) => heading === section).length;
    if (count === 0) findings.push(`section "${section}" is missing`);
    if (count > 1) findings.push(`section "${section}" appears ${count} times`);
  }
  for (const heading of found) {
    if (!SECTIONS.includes(heading))
      findings.push(`section "${heading}" is not one of the ${SECTIONS.length}`);
  }
  if (findings.length > 0) return findings;
  const misplaced = found.findIndex((heading, index) => heading !== SECTIONS[index]);
  if (misplaced !== -1)
    findings.push(
      `section "${found[misplaced]}" is out of order: position ${misplaced + 1} belongs to "${SECTIONS[misplaced]}"`,
    );
  return findings;
}

/**
 * Every refusal names the faulty element (secret name, file, section, column)
 * and never the content of a cell: a cell that fails may be failing because it
 * holds a value.
 */
function inventoryFindings(document: string, workflows: readonly WorkflowSource[]): string[] {
  const findings: string[] = [];
  const inventory = readInventory(document);

  if (inventory.tables !== 1)
    findings.push(`section "Inventory" holds ${inventory.tables} table(s), expected 1`);
  if (inventory.header.join("|") !== COLUMNS.join("|"))
    findings.push(`the inventory header is not the ${COLUMNS.length} fixed columns in order`);
  if (inventory.rows.length === 0) findings.push("the inventory has no row");

  const consumersOf = new Map<string, string[]>();
  for (const workflow of workflows) {
    findings.push(...workflowFindings(workflow));
    for (const name of storedSecretNames(workflow.text)) {
      consumersOf.set(name, [...(consumersOf.get(name) ?? []), workflow.path]);
    }
  }
  if (workflows.length === 0) findings.push("no workflow file was read");
  else if (consumersOf.size === 0 && inventory.rows.length > 0)
    findings.push(
      `no secret name was extracted from ${workflows.length} workflow(s) while the inventory has ${inventory.rows.length} row(s)`,
    );

  const inventoried = new Set<string>();
  inventory.rows.forEach((row, index) => {
    const position = `inventory row ${index + 1}`;
    if (row.length !== COLUMNS.length) {
      findings.push(`${position} has ${row.length} cell(s), expected ${COLUMNS.length}`);
      return;
    }
    const tainted = COLUMNS.filter((_, column) => containsCredentialMarker(row[column] ?? ""));
    if (tainted.length > 0) {
      for (const column of tainted)
        findings.push(`${position}: cell "${column}" carries a credential-shaped value`);
      return;
    }
    const name = /^`([A-Z][A-Z0-9_]*)`$/.exec(row[0] ?? "")?.[1];
    if (name === undefined) {
      findings.push(`${position}: "Secret name" is not one backticked upper-case name`);
      return;
    }
    if (inventoried.has(name)) findings.push(`secret ${name} has more than one inventory row`);
    inventoried.add(name);

    const lifetime = row[4] ?? "";
    if (!/^[1-9][0-9]*$/.test(lifetime) || Number(lifetime) > MAXIMUM_LIFETIME_DAYS)
      findings.push(
        `secret ${name}: "Maximum lifetime (days)" is not an integer between 1 and ${MAXIMUM_LIFETIME_DAYS}`,
      );

    const decision = row[6] ?? "";
    if (!/\b\d{4}-\d{2}-\d{2}\b/.test(decision) || !backticked(decision).some(isRepositoryPath))
      findings.push(
        `secret ${name}: "Decision (dated)" lacks an ISO 8601 date or the path of its record`,
      );

    const consumers = consumersOf.get(name) ?? [];
    if (consumers.length === 0)
      findings.push(`secret ${name} has an inventory row and no workflow consumes it`);
    if (consumers.length > 1)
      findings.push(
        `secret ${name} is consumed by ${consumers.length} workflows: ${consumers.join(", ")}`,
      );

    const consumer = /^`(\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml)`$/.exec(row[2] ?? "")?.[1];
    if (consumer === undefined)
      findings.push(
        `secret ${name}: "Consumer" is not one backticked workflow path under ${WORKFLOW_DIRECTORY}`,
      );
    else if (!workflows.some((workflow) => workflow.path === consumer))
      findings.push(`secret ${name}: consumer ${consumer} is not a workflow file of this tree`);
    else if (consumers.length > 0 && !consumers.includes(consumer))
      findings.push(`secret ${name}: consumer ${consumer} does not reference secrets.${name}`);
  });

  for (const [name, consumers] of [...consumersOf].sort(([a], [b]) => a.localeCompare(b))) {
    if (!inventoried.has(name))
      findings.push(
        `secret ${name} is referenced by ${consumers.join(", ")} and has no inventory row`,
      );
  }
  return findings;
}

const policyFindings = (document: string, workflows: readonly WorkflowSource[]): string[] => [
  ...headerFindings(document),
  ...sectionFindings(document),
  ...inventoryFindings(document, workflows),
];

const pathFindings = (document: string, isFile: (path: string) => boolean): string[] =>
  citedPaths(document)
    .filter((path) => path.split("/").includes("..") || !isFile(path))
    .map((path) => `cited path ${path} is not a file of this tree`);

// ---------------------------------------------------------------------------
// The tree as delivered.
// ---------------------------------------------------------------------------

// An unreadable policy or workflow throws here and fails the file: a source
// that cannot be read is never an empty one.
const policy = readFileSync(join(REPOSITORY_ROOT, POLICY_PATH), "utf8");
const workflows: WorkflowSource[] = readdirSync(join(REPOSITORY_ROOT, WORKFLOW_DIRECTORY))
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .sort()
  .map((name) => ({
    path: `${WORKFLOW_DIRECTORY}${name}`,
    text: readFileSync(join(REPOSITORY_ROOT, WORKFLOW_DIRECTORY, name), "utf8"),
  }));

// Present in the checked-out tree; tracked-ness is the business of the gates
// driven by `git ls-files`, which run after staging.
const isFileOfTree = (path: string): boolean => {
  try {
    return statSync(join(REPOSITORY_ROOT, path)).isFile();
  } catch {
    return false;
  }
};

describe("token policy against this tree", () => {
  // A moved directory must turn this red, never make the comparison vacuous.
  test("at least one workflow is read", () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  test("header, sections and inventory hold against the workflows", () => {
    const referenced = new Set(workflows.flatMap((workflow) => storedSecretNames(workflow.text)));
    const inventory = readInventory(policy);
    console.log(
      `token-policy: ${workflows.length} workflow(s) read, ${referenced.size} secret name(s) referenced, ` +
        `${inventory.rows.length} inventory row(s) compared, ${sectionHeadings(policy).length} section(s)`,
    );
    expect(policyFindings(policy, workflows)).toEqual([]);
  });

  test("every repository path cited in backticks is a file of the tree", () => {
    const cited = citedPaths(policy);
    console.log(`token-policy: ${cited.length} cited path(s) checked`);
    expect(cited.length).toBeGreaterThan(0);
    expect(pathFindings(policy, isFileOfTree)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The refusals, each on inline data. The expected lists come from the policy
// (five sections, seven columns, one consumer, 90 days), not from a run.
// ---------------------------------------------------------------------------

const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

const BUMP_ROW: readonly string[] = [
  "`BUMP_TOKEN`",
  "Bump",
  "`.github/workflows/bump.yml`",
  "One repository, Contents write (push the branch)",
  "90",
  "Repository owner",
  "Not created: decision of 2026-01-02, traced in `docs/bump.md`",
];

const document = (
  rows: readonly (readonly string[])[],
  sections: readonly string[] = SECTIONS,
): string =>
  [
    "# Fleet policy — stored workflow tokens",
    "",
    "- **Status:** proposed — nothing carries it yet.",
    "- **Scope:** stored workflow tokens.",
    "",
    ...sections.flatMap((section) =>
      section === "Inventory"
        ? ["## Inventory", "", row(COLUMNS), row(COLUMNS.map(() => "---")), ...rows.map(row), ""]
        : [`## ${section}`, "", "Text.", ""],
    ),
  ].join("\n");

const workflow = (name: string, body: string): WorkflowSource => ({
  path: `${WORKFLOW_DIRECTORY}${name}`,
  text: `name: ${name}\njobs:\n  run:\n    steps:\n${body}\n`,
});

const BUMP_WORKFLOW = workflow(
  "bump.yml",
  "      - env:\n          TOKEN: $" + "{{ secrets.BUMP_TOKEN }}",
);
const PLAIN_WORKFLOW = workflow("ci.yml", "      - run: bun test");
/** A workflow whose one step passes `expression` to an environment variable. */
const envWorkflow = (name: string, expression: string): WorkflowSource =>
  workflow(name, `      - env:\n          VALUE: \${{ ${expression} }}`);
const withCell = (column: string, value: string): string[] =>
  BUMP_ROW.map((cell, index) => (COLUMNS[index] === column ? value : cell));

describe("token policy refusals", () => {
  test("a consistent document and its workflows raise nothing", () => {
    expect(policyFindings(document([BUMP_ROW]), [BUMP_WORKFLOW, PLAIN_WORKFLOW])).toEqual([]);
  });

  test("a name a workflow references and the inventory lacks", () => {
    const heal = workflow(
      "heal.yml",
      "      - env:\n          TOKEN: $" + "{{ secrets.HEAL_TOKEN }}",
    );
    expect(policyFindings(document([BUMP_ROW]), [BUMP_WORKFLOW, heal])).toEqual([
      "secret HEAL_TOKEN is referenced by .github/workflows/heal.yml and has no inventory row",
    ]);
  });

  test("an inventory row no workflow consumes", () => {
    const orphan = BUMP_ROW.map((cell, index) => (index === 0 ? "`ORPHAN_TOKEN`" : cell));
    expect(policyFindings(document([BUMP_ROW, orphan]), [BUMP_WORKFLOW])).toEqual([
      "secret ORPHAN_TOKEN has an inventory row and no workflow consumes it",
    ]);
  });

  test("no name extracted at all while the inventory has rows", () => {
    expect(policyFindings(document([BUMP_ROW]), [PLAIN_WORKFLOW])).toEqual([
      "no secret name was extracted from 1 workflow(s) while the inventory has 1 row(s)",
      "secret BUMP_TOKEN has an inventory row and no workflow consumes it",
      "secret BUMP_TOKEN: consumer .github/workflows/bump.yml is not a workflow file of this tree",
    ]);
  });

  test("an empty workflow directory", () => {
    expect(policyFindings(document([BUMP_ROW]), [])).toContain("no workflow file was read");
  });

  test("a name two workflow files consume", () => {
    const second = workflow(
      "second.yml",
      "      - env:\n          TOKEN: $" + "{{ secrets.BUMP_TOKEN }}",
    );
    expect(policyFindings(document([BUMP_ROW]), [BUMP_WORKFLOW, second])).toEqual([
      "secret BUMP_TOKEN is consumed by 2 workflows: .github/workflows/bump.yml, .github/workflows/second.yml",
    ]);
  });

  test("a consumer column that names a workflow which does not read the secret", () => {
    const moved = withCell("Consumer", "`.github/workflows/ci.yml`");
    expect(policyFindings(document([moved]), [BUMP_WORKFLOW, PLAIN_WORKFLOW])).toEqual([
      "secret BUMP_TOKEN: consumer .github/workflows/ci.yml does not reference secrets.BUMP_TOKEN",
    ]);
  });

  test("secrets: inherit in a workflow", () => {
    const caller = workflow("caller.yml", "      - run: true\n    secrets: inherit");
    expect(policyFindings(document([BUMP_ROW]), [BUMP_WORKFLOW, caller])).toEqual([
      'workflow .github/workflows/caller.yml: job run passes "secrets: inherit"',
    ]);
  });

  // The same mapping in every spelling YAML allows: a line-anchored pattern
  // sees one of them.
  test.each([
    ["quoted", 'jobs:\n  call:\n    uses: ./.github/workflows/r.yml\n    secrets: "inherit"\n'],
    [
      "single-quoted",
      "jobs:\n  call:\n    uses: ./.github/workflows/r.yml\n    secrets: 'inherit'\n",
    ],
    ["in a flow mapping", "jobs:\n  call: { uses: ./.github/workflows/r.yml, secrets: inherit }\n"],
    ["after a comment", "jobs:\n  call:\n    uses: ./r.yml\n    secrets: inherit # all of them\n"],
  ])("secrets: inherit %s", (_, text) => {
    const caller: WorkflowSource = { path: `${WORKFLOW_DIRECTORY}caller.yml`, text };
    expect(policyFindings(document([BUMP_ROW]), [BUMP_WORKFLOW, caller])).toEqual([
      'workflow .github/workflows/caller.yml: job call passes "secrets: inherit"',
    ]);
  });

  test("a workflow that is not YAML is a finding, never an empty workflow", () => {
    const broken: WorkflowSource = { path: `${WORKFLOW_DIRECTORY}broken.yml`, text: "jobs: [\n" };
    expect(policyFindings(document([BUMP_ROW]), [BUMP_WORKFLOW, broken])).toEqual([
      "workflow .github/workflows/broken.yml is not parseable YAML",
    ]);
  });

  test.each([
    ["single quotes", "secrets['HIDDEN_BRACKET']"],
    ["double quotes", 'secrets["HIDDEN_BRACKET"]'],
    ["spaces", "secrets[ 'HIDDEN_BRACKET' ]"],
  ])("a name read with the bracket form, %s", (_, expression) => {
    const hidden = envWorkflow("hidden.yml", expression);
    expect(policyFindings(document([BUMP_ROW]), [BUMP_WORKFLOW, hidden])).toEqual([
      "secret HIDDEN_BRACKET is referenced by .github/workflows/hidden.yml and has no inventory row",
    ]);
  });

  // A read of the context that names no secret cannot be inventoried: it
  // hands every stored secret to the step.
  test.each([
    ["toJSON(secrets)", "toJSON(secrets)"],
    ["the bare context", "secrets"],
    ["a computed key", "secrets[matrix.name]"],
    ["a formatted key", "secrets[format('{0}_TOKEN', 'BUMP')]"],
  ])("a read of %s", (_, expression) => {
    const dump = envWorkflow("dump.yml", expression);
    expect(policyFindings(document([BUMP_ROW]), [BUMP_WORKFLOW, dump])).toEqual([
      "workflow .github/workflows/dump.yml reads the secrets context without naming a secret",
    ]);
  });

  test("a read in an if condition, which takes an expression without delimiters", () => {
    const guarded = workflow(
      "guarded.yml",
      "      - if: toJSON(secrets) != '{}'\n        run: true",
    );
    expect(policyFindings(document([BUMP_ROW]), [BUMP_WORKFLOW, guarded])).toEqual([
      "workflow .github/workflows/guarded.yml reads the secrets context without naming a secret",
    ]);
  });

  test("the word secrets in a comment, a run script or a string literal is not a read", () => {
    const prose = workflow(
      "prose.yml",
      "      # never pass the secrets to this job\n" +
        "      - run: echo 'no secrets here'\n" +
        "        if: $" +
        "{{ contains(github.event.head_commit.message, 'secrets') }}",
    );
    expect(policyFindings(document([BUMP_ROW]), [BUMP_WORKFLOW, prose])).toEqual([]);
  });

  // docs/security/TOKEN-POLICY.md, rank 1: the job's own token is
  // `github.token`. Spelling it as a stored secret hides it among the
  // inventoried ones, so the check refuses it instead of exempting it.
  test.each([
    ["secrets.GITHUB_TOKEN"],
    ["secrets.github_token"],
    ["secrets['GITHUB_TOKEN']"],
  ])("%s instead of github.token", (expression) => {
    const job = envWorkflow("job.yml", expression);
    expect(policyFindings(document([BUMP_ROW]), [BUMP_WORKFLOW, job])).toEqual([
      "workflow .github/workflows/job.yml reads the job token as secrets.GITHUB_TOKEN; use github.token",
    ]);
  });

  test.each([
    ["absent", ""],
    ["not an integer", "90.5"],
    ["text", "ninety"],
    ["zero", "0"],
    ["above the ceiling", "91"],
  ])("a maximum lifetime that is %s", (_, lifetime) => {
    expect(
      policyFindings(document([withCell("Maximum lifetime (days)", lifetime)]), [BUMP_WORKFLOW]),
    ).toEqual(['secret BUMP_TOKEN: "Maximum lifetime (days)" is not an integer between 1 and 90']);
  });

  test.each([["1"], ["90"]])("a maximum lifetime of %s is accepted", (lifetime) => {
    expect(
      policyFindings(document([withCell("Maximum lifetime (days)", lifetime)]), [BUMP_WORKFLOW]),
    ).toEqual([]);
  });

  test("a cell that carries a value is named by row and column, never printed", () => {
    // Assembled at run time: a literal here would be a finding of
    // check:secret-scan, whose exemption list is closed.
    const value = ["gh", "p_", "A".repeat(24)].join("");
    const findings = policyFindings(document([withCell("Scope", `One repository ${value}`)]), [
      BUMP_WORKFLOW,
    ]);
    expect(findings).toEqual([
      'inventory row 1: cell "Scope" carries a credential-shaped value',
      "secret BUMP_TOKEN is referenced by .github/workflows/bump.yml and has no inventory row",
    ]);
    expect(findings.join("\n")).not.toContain(value);
  });

  test("a value in the name column is not echoed as a name", () => {
    const value = ["AKIA", "A".repeat(16)].join("");
    const findings = policyFindings(document([withCell("Secret name", `\`${value}\``)]), [
      BUMP_WORKFLOW,
    ]);
    expect(findings).toContain(
      'inventory row 1: cell "Secret name" carries a credential-shaped value',
    );
    expect(findings.join("\n")).not.toContain(value);
  });

  test("a missing section", () => {
    const sections = SECTIONS.filter((section) => section !== "Rotation and exposure");
    expect(policyFindings(document([BUMP_ROW], sections), [BUMP_WORKFLOW])).toEqual([
      'section "Rotation and exposure" is missing',
    ]);
  });

  test("a section out of the fixed order", () => {
    const sections = ["Order of preference", "The policy", ...SECTIONS.slice(2)];
    expect(policyFindings(document([BUMP_ROW], sections), [BUMP_WORKFLOW])).toEqual([
      'section "Order of preference" is out of order: position 1 belongs to "The policy"',
    ]);
  });

  test("a section the policy does not fix", () => {
    expect(
      policyFindings(document([BUMP_ROW], [...SECTIONS, "Appendix"]), [BUMP_WORKFLOW]),
    ).toEqual(['section "Appendix" is not one of the 5']);
  });

  test("a status other than proposed, and a missing scope", () => {
    const text = document([BUMP_ROW])
      .replace("- **Status:** proposed", "- **Status:** doctrine")
      .replace("- **Scope:** stored workflow tokens.\n", "");
    expect(policyFindings(text, [BUMP_WORKFLOW])).toEqual([
      'bullet "Status" does not start with "proposed"',
      'bullet "Scope" is missing before the first section',
    ]);
  });

  test("a document that does not open with a level-1 title", () => {
    expect(
      policyFindings(document([BUMP_ROW]).replace("# Fleet", "Fleet"), [BUMP_WORKFLOW]),
    ).toEqual(["the document does not open with a level-1 title"]);
  });

  test("a header that is not the seven columns, a short row, no row", () => {
    const renamed = document([BUMP_ROW]).replace("| Secret name |", "| Name |");
    expect(policyFindings(renamed, [BUMP_WORKFLOW])).toEqual([
      "the inventory header is not the 7 fixed columns in order",
    ]);
    expect(policyFindings(document([BUMP_ROW.slice(0, 6)]), [BUMP_WORKFLOW])).toEqual([
      "inventory row 1 has 6 cell(s), expected 7",
      "secret BUMP_TOKEN is referenced by .github/workflows/bump.yml and has no inventory row",
    ]);
    expect(policyFindings(document([]), [PLAIN_WORKFLOW])).toEqual(["the inventory has no row"]);
  });

  test("a decision without a date or without its record", () => {
    for (const decision of ["Not created, traced in `docs/bump.md`", "Not created on 2026-01-02"]) {
      expect(
        policyFindings(document([withCell("Decision (dated)", decision)]), [BUMP_WORKFLOW]),
      ).toEqual([
        'secret BUMP_TOKEN: "Decision (dated)" lacks an ISO 8601 date or the path of its record',
      ]);
    }
  });

  test("a cited path that is not a file of the tree", () => {
    const text =
      "See `docs/present.md`, `docs/absent.md`, `STATUS.md`, `github.token` and `secrets.<NAME>`.";
    expect(citedPaths(text)).toEqual(["STATUS.md", "docs/absent.md", "docs/present.md"]);
    expect(pathFindings(text, (path) => path !== "docs/absent.md")).toEqual([
      "cited path docs/absent.md is not a file of this tree",
    ]);
  });
});
