import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BlobReader,
  type ChangeContext,
  type ContextRead,
  dependencyContacts,
  evaluateNegatives,
  type NegativesConfig,
  readDeclarationLines,
  readNegativesDeclaration,
  renderedLineStart,
  schemaContacts,
  validateConfig,
  workflowContacts,
} from "./check-pr-negatives";
import { renderGateReport } from "./gate-report";
import type { ChangedPath, TreeEntry } from "./git-diff";

// Every expected verdict below is written from ADR-0056 D5, the owner
// decisions of 2026-10-23 (one line, closed vocabulary, optional) and the
// surface design decided after the second review of the same day (a negative
// holds only when the diff touches none of its surface), never from the
// gate's current output.

const DATA = JSON.parse(readFileSync(join(import.meta.dir, "pr-negatives.v1.json"), "utf8"));

function realConfig(): NegativesConfig {
  const read = validateConfig(DATA);
  if (!read.ok) throw new Error(read.reason);
  return read.config;
}

const CONFIG = realConfig();

/** A context reader that fails the test if the gate reads the diff at all. */
const NEVER_READ = (): ContextRead => {
  throw new Error("the diff was read although no verifiable negative was declared");
};

const file = (
  status: ChangedPath["status"],
  path: string,
  oldMode = "100644",
  newMode = "100644",
): ChangedPath => ({
  status,
  path,
  oldMode: status === "A" ? "000000" : oldMode,
  newMode: status === "D" ? "000000" : newMode,
});

function context(
  entries: readonly ChangedPath[],
  blobs: Readonly<Record<string, string>> = {},
  trees: { base?: readonly TreeEntry[]; head?: readonly TreeEntry[] } = {},
): ChangeContext {
  const readBlob: BlobReader = (path) => {
    const text = blobs[path];
    return text === undefined ? { ok: false, reason: `no blob for ${path}` } : { ok: true, text };
  };
  return {
    entries,
    readBlob,
    trees: { base: trees.base ?? [], head: trees.head ?? [] },
    config: CONFIG,
  };
}

const changes =
  (...args: Parameters<typeof context>) =>
  (): ContextRead => ({ ok: true, ...context(...args) });

/**
 * The verdict as CI prints it with GATE_VERBOSE (pr-negatives.yml sets it),
 * plus the volume, which a failing gate does not print but the report holds.
 */
function verdict(body: string, readContext: () => ContextRead = NEVER_READ) {
  const report = evaluateNegatives(body, "PR #0 description", readContext);
  const lines = renderGateReport("PR negatives", report, true).lines;
  return { report, rendered: [...lines, report.volumeSummary ?? ""].join("\n") };
}

const paths = (contacts: readonly { path: string }[]) => contacts.map((contact) => contact.path);

/** A character by code point: an escape a formatter could inline would leave it invisible in the source. */
const cp = (codePoint: number): string => String.fromCodePoint(codePoint);

describe("the declaration", () => {
  test("absent: the gate passes, says so, and does not read the diff", () => {
    const { report, rendered } = verdict("Door: two-way\n\nA change.");
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain("no Not-added line: nothing declared");
    expect(rendered).toContain("diff not read: no negative declared");
  });

  test("one line at column 0, comma-separated values of the vocabulary", () => {
    const read = readNegativesDeclaration("Not-added: dependency , schema,telemetry");
    expect(read.kind === "declared" && read.values).toEqual(["dependency", "schema", "telemetry"]);
  });

  test("a byte-order mark at the head of the body is removed before reading", () => {
    expect(readNegativesDeclaration(`${cp(0xfeff)}Not-added: schema`).kind).toBe("declared");
  });

  test.each([
    ["Not-added: dependencies", '"dependencies" is not in the vocabulary'],
    ["Not-added: Workflow", '"Workflow" is not in the vocabulary'],
    ["Not-added: schema, schema", '"schema" is declared twice'],
    ["Not-added: dependency; schema", '"dependency; schema" — values are separated by commas only'],
    ["Not-added: dependency schema", '"dependency schema" — values are separated by commas only'],
    ["Not-added: dependency,", "empty value (a doubled, leading or trailing comma)"],
    ["Not-added:", "empty Not-added line"],
    ["Not-added: schema\nNot-added: workflow", "2 Not-added lines — declare at most one"],
  ])("%j is refused, named", (body, reason) => {
    const { report, rendered } = verdict(body);
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(reason);
    expect(rendered).toContain("diff not read: the declaration is refused");
  });

  test.each([
    ["not-added: schema"],
    ["NOT ADDED: schema"],
    ["  Not-added: schema"],
    ["> Not-added: schema"],
    ["- Not-added: schema"],
    ["* Not-added: schema"],
    ["+ Not-added: schema"],
    ["## Not-added: schema"],
    ["**Not-added:** schema"],
    ["__Not-added:__ schema"],
    ["1. Not-added: schema"],
    ["2) Not-added: schema"],
    ["> - **Not-added:** schema"],
    ["Not\\-added: schema"],
    ["Not&#45;added: schema"],
    ["Not&hyphen;added: schema"],
    ["Not-<b></b>added: schema"],
    ["<span>Not-added:</span> schema"],
    ["[Not-added:](#) dependency"],
    ["`Not-added:` dependency"],
    ["~~Not-added:~~ dependency"],
    ["`Not-added:` is optional."],
    [`Not${cp(0x2011)}added: schema`],
    [`Not${cp(0x2013)}added: schema`],
    [`Not${cp(0x00ad)}added: schema`],
    [`Not${cp(0x200b)}-added: schema`],
    [`${cp(0xfeff)}Not-added: schema`],
  ])("a visible line whose start renders as the key, %j, is refused by name", (line) => {
    const { report, rendered } = verdict(`Door: two-way\n${line}`);
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("line 2 ");
    expect(rendered).toContain('write it as "Not-added:" at the start of its own line');
  });

  test.each([
    [
      "the sentence #143 and #145 were refused for",
      "lists. Not added: the gate refuses exactly the list",
    ],
    ["inline code mid-line", "The `Not-added:` line is optional."],
    ["a homoglyph, out of reach and declared so", `N${cp(0x043e)}t-added: schema`],
  ])("%s is not refused", (_, line) => {
    const { report, rendered } = verdict(`Door: two-way\n${line}`);
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain("0 Not-added line(s), 0 misplaced key(s)");
  });

  test.each([
    ["a comment that creates the key once removed", "Not<!-- x -->-added: dependency", 0],
    ["a key hidden in a comment", "<!-- Not-added: x -->", 1],
    [
      "a key hidden in a comment beside a visible one",
      "Not-added: schema <!-- Not-added: x -->",
      0,
    ],
    ["two lines hidden in a code block", "```\nNot-added: a\nNot-added: b\n```", 2],
  ])("the ignored-mention counter never goes below zero: %s", (_, body, expected) => {
    expect(readNegativesDeclaration(body).ignoredInBlocks).toBe(expected);
  });

  test("author text in a refusal is escaped onto one line", () => {
    const { rendered } = verdict('- Not-added: x "::stop-commands::y"');
    expect(rendered).toContain('"- Not-added: x \\"::stop-commands::y\\""');
  });

  test.each([
    ["a fenced code block", "```\nNot-added: workflow\n```"],
    ["an HTML comment", "<!-- Not-added: workflow -->"],
  ])("a line inside %s is not a declaration: ignored, and named as ignored", (_, block) => {
    const { report, rendered } = verdict(
      `Door: two-way\n${block}\n`,
      changes([file("A", ".github/workflows/x.yml")]),
    );
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain("1 Not-added mention(s) inside them ignored, not declarations");
  });

  test("declarative negatives are validated, said unverified, and the diff is not read", () => {
    const { report, rendered } = verdict("Not-added: hosted-service, telemetry, public-surface");
    expect(report.outcome).toBe("pass");
    expect(report.checks.filter((check) => check.note.startsWith("declarative:")).length).toBe(3);
    expect(rendered).toContain("diff not read: no verifiable negative declared");
  });
});

describe("the seam with the declaration grammar (readDeclarationLines)", () => {
  test("today it admits every key line at column 0 of the visible text", () => {
    expect(readDeclarationLines("Door: two-way\nNot-added: schema\n<!-- Not-added: x -->")).toEqual(
      {
        text: "Door: two-way\nNot-added: schema\n",
        removedBlocks: 1,
        admitted: [" schema"],
      },
    );
  });

  test("the values come from what the grammar admits, not from a second parse of the text", () => {
    const read = readNegativesDeclaration("Not-added: schema", () => ({
      text: "Not-added: schema",
      removedBlocks: 0,
      admitted: [" workflow"],
    }));
    expect(read.kind === "declared" && read.values).toEqual(["workflow"]);
  });

  test("a key line the grammar does not admit is refused, never silently absent", () => {
    // The shape #141's grammar refuses: a value carrying `<`.
    const read = readNegativesDeclaration("Not-added: schema <b>", () => ({
      text: "Not-added: schema <b>",
      removedBlocks: 0,
      admitted: [],
    }));
    expect(read.kind === "refused" && read.reasons).toEqual([
      "1 Not-added line(s) not admitted by the declaration grammar — see check-pr-door",
    ]);
  });
});

describe("renderedLineStart", () => {
  test.each([
    ["Not\\-added:", "not-added:"],
    ["&#x4E;ot-added:", "not-added:"],
    ["**<i>Not</i>&nbsp;added**:", `not${cp(0x00a0)}added**:`],
    [`> 1. __Not${cp(0x2014)}added:__`, "not-added:__"],
  ])("%j renders as %j", (line, rendered) => {
    expect(renderedLineStart(line)).toBe(rendered);
  });
});

describe("the dependency surface", () => {
  test.each(
    DATA.dependency.basenames as string[],
  )("%s, in any case and at any depth, is a contact", (name) => {
    const entries = [file("M", name), file("A", `deep/dir/${name.toUpperCase()}`)];
    expect(paths(dependencyContacts(context(entries)))).toEqual(entries.map((entry) => entry.path));
  });

  test.each([
    "requirements.txt",
    "py/requirements-dev.txt",
    "requirements/base.in",
    "Constraints.txt",
    ".cargo/config.toml",
    "crates/x/.cargo/config",
    ".github/workflows/ci.yml",
    ".GitHub/Actions/setup/action.yml",
  ])("%s is a contact by path", (path) => {
    expect(paths(dependencyContacts(context([file("M", path)])))).toEqual([path]);
  });

  test.each([
    ["deleted", file("D", "package.json")],
    ["a gitlink added", file("A", "vendor/lib", "000000", "160000")],
    ["a gitlink moved", file("M", "vendor/lib", "160000", "160000")],
    ["a gitlink by type change", file("T", "vendor/lib", "100644", "160000")],
    ["a symlink added anywhere", file("A", "packages/evil", "000000", "120000")],
    ["a symlink deleted", file("D", "docs/link", "120000", "000000")],
  ])("%s is a contact", (_, entry) => {
    expect(paths(dependencyContacts(context([entry])))).toEqual([entry.path]);
  });

  test("a symlink at a surface path in either tree, outside the diff, is a contact", () => {
    const contacts = dependencyContacts(
      context(
        [file("M", "linked/real.json")],
        {},
        { head: [{ mode: "120000", path: "linked/package.json" }] },
      ),
    );
    expect(contacts).toEqual([
      { path: "linked/package.json", status: "head", why: "a symlink in the head tree" },
    ]);
  });

  test.each([
    ".cargo",
    "deep/requirements",
    ".github/actions",
    "x/node_modules",
    "toolchains",
  ])("a DIRECTORY symlink %s in a tree, outside the diff, is a contact", (path) => {
    const contacts = dependencyContacts(
      context([file("M", "docs/readme.md")], {}, { base: [{ mode: "120000", path }] }),
    );
    expect(contacts).toEqual([{ path, status: "base", why: "a symlink in the base tree" }]);
  });

  test("a .py carrying a PEP 723 block is a contact by content; one without it is not", () => {
    const contacts = dependencyContacts(
      context([file("A", "a.py"), file("M", "b.py"), file("D", "c.py")], {
        "a.py": "# /// SCRIPT\n# dependencies = []\n# ///\n",
        "b.py": "print('no block')\n",
      }),
    );
    expect(contacts).toEqual([{ path: "a.py", status: "A", why: "content carries # /// script" }]);
  });

  test("an unreadable .py is a contact: its content cannot be told apart", () => {
    expect(dependencyContacts(context([file("M", "x.py")]))[0]?.why).toBe(
      "unreadable: no blob for x.py",
    );
  });

  test("paths off the surface are not contacts", () => {
    const entries = [
      file("M", "docs/readme.md"),
      file("A", "tools/quality/check-pr-negatives.ts"),
      file("A", "packages/x/src/package.ts"),
    ];
    expect(
      dependencyContacts(context(entries, {}, { head: [{ mode: "120000", path: "docs/link" }] })),
    ).toEqual([]);
  });
});

describe("the workflow surface", () => {
  test.each([
    file("A", ".github/workflows/x.yml"),
    file("A", ".GitHub/WORKFLOWS/x.yml"),
    file("T", ".github/workflows/ci.yml", "100644", "120000"),
    file("A", ".github/workflows", "000000", "120000"),
    file("A", ".github", "000000", "120000"),
    file("M", ".github/actions/setup", "120000", "120000"),
  ])("%o is a contact", (entry) => {
    expect(paths(workflowContacts(context([entry])))).toEqual([entry.path]);
  });

  test.each([
    ["base", ".github/workflows/shared.yml"],
    ["head", ".github"],
    ["base", ".github/actions/setup"],
  ])("a symlink in the %s tree at %s is a contact", (side, path) => {
    const contacts = workflowContacts(context([], {}, { [side]: [{ mode: "120000", path }] }));
    expect(paths(contacts)).toEqual([path]);
  });

  test("a symlink both in the diff and in a tree is named once", () => {
    const entry = file("A", ".github/workflows/x.yml", "000000", "120000");
    const contacts = workflowContacts(
      context([entry], {}, { head: [{ mode: "120000", path: ".github/workflows/x.yml" }] }),
    );
    expect(paths(contacts)).toEqual([".github/workflows/x.yml"]);
  });

  test("a workflow modified or deleted, an action added, a symlink removed: no contact", () => {
    const entries = [
      file("M", ".github/workflows/ci.yml"),
      file("D", ".github/workflows/old.yml"),
      file("A", ".github/actions/setup/action.yml"),
      file("D", ".github/link", "120000", "000000"),
    ];
    expect(workflowContacts(context(entries))).toEqual([]);
  });
});

describe("the schema surface", () => {
  test.each([
    file("A", "ecosystem/schemas/x.v1.schema.json"),
    file("M", "a.SCHEMA.JSON"),
    file("T", "schema.yml", "100644", "120000"),
    file("A", "contracts/schema/deep/x.yaml"),
  ])("%o is a contact by name", (entry) => {
    expect(schemaContacts(context([entry]))[0]?.why).toBe("schema file name");
  });

  test.each([
    ["schema", '{"$schema":"x"}'],
    ["schema", '{"schemaVersion": 1}'],
    ["\\u", '{"\\u0024\\u0073chema":"x"}'],
    ["\\u", '{"\\U00000024x":"x"}'],
    ["\\x", '"\\x24\\x73chema": x'],
  ])("content carrying %s is a contact, in any case (%s)", (marker, text) => {
    const contacts = schemaContacts(
      context([file("M", "data/x.yaml")], { "data/x.yaml": text.toUpperCase() }),
    );
    expect(contacts[0]?.why).toBe(`content carries ${marker}`);
  });

  test("a deleted schema, a JSON without the marker, a markdown file: no contact", () => {
    const entries = [
      file("D", "x.schema.json"),
      file("A", "data/plain.json"),
      file("A", "docs/$schema.md"),
    ];
    expect(schemaContacts(context(entries, { "data/plain.json": '{"a":1}' }))).toEqual([]);
  });

  test("a linked or unreadable JSON is a contact: its content cannot be read", () => {
    const contacts = schemaContacts(
      context([file("A", "a.jsonc", "000000", "120000"), file("M", "b.yml")]),
    );
    expect(contacts.map((contact) => contact.why)).toEqual([
      "a link, whose content cannot be read",
      "unreadable: no blob for b.yml",
    ]);
  });
});

describe("the verdict", () => {
  test("a contact is named with its path, status, reason and the value to remove", () => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      changes([file("M", "package.json"), file("M", "docs/readme.md")]),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(
      'cannot verify: package.json (M, manifest, lockfile or registry configuration) changed — remove "dependency" from Not-added:',
    );
  });

  test("an untouched surface passes, with the volume examined", () => {
    const { report, rendered } = verdict(
      "Door: two-way\nNot-added: dependency, schema, workflow, telemetry",
      changes(
        [file("M", "docs/readme.md"), file("A", "tools/x.ts")],
        {},
        { head: [{ mode: "100644", path: "a" }] },
      ),
    );
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain(
      "rules read at the merge base; diff: 2 changed path(s) examined, 1 tree entries read for symlinks; dependency: 0 contact(s), schema: 0 contact(s), workflow: 0 contact(s)",
    );
  });

  test("an unreadable diff or absent rules fail: nothing verified is not a negative held", () => {
    const { report, rendered } = verdict("Not-added: schema", () => ({
      ok: false,
      reason: "the rules are read at the merge base, never from the head: could not read",
    }));
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(
      "diff: unreadable, nothing verified: the rules are read at the merge base",
    );
  });
});

describe("the data file", () => {
  test("the committed data validates", () => {
    expect(validateConfig(DATA).ok).toBe(true);
  });

  test("every pattern of the data is case-insensitive", () => {
    expect(
      [...CONFIG.schemaPatterns, ...CONFIG.dependencyPatterns].every((pattern) =>
        pattern.flags.includes("i"),
      ),
    ).toBe(true);
  });

  test.each([
    [
      "a pattern that does not compile",
      { ...DATA, schema: { ...DATA.schema, pathPatterns: ["("] } },
      "is not a valid pattern",
    ],
    [
      "no workflow symlink root",
      { ...DATA, workflow: { directory: ".github/workflows" } },
      "symlinkRoot",
    ],
    [
      "no schema content markers",
      { ...DATA, schema: { ...DATA.schema, contentMarkers: [] } },
      "contentMarkers",
    ],
    [
      "no dependency basenames",
      { ...DATA, dependency: { ...DATA.dependency, basenames: [] } },
      "basenames",
    ],
  ])("%s is refused", (_, value, reason) => {
    const read = validateConfig(value);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain(reason);
  });
});

describe("the workflow", () => {
  interface Step {
    readonly uses?: string;
    readonly with?: Record<string, unknown>;
  }
  const workflow = Bun.YAML.parse(
    readFileSync(join(import.meta.dir, "../../.github/workflows/pr-negatives.yml"), "utf8"),
  ) as { jobs: Record<string, { steps: Step[] }> };

  test("the checkout persists no credential", () => {
    const checkouts = Object.values(workflow.jobs).flatMap((job) =>
      job.steps.filter((step) => step.uses?.startsWith("actions/checkout@")),
    );
    expect(checkouts.length).toBe(1);
    expect(checkouts[0]?.with?.["persist-credentials"]).toBe(false);
  });
});
