import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateDoor, readDeclarationBlocks } from "./check-pr-door";
import {
  type BlobReader,
  type ChangeContext,
  type ContextRead,
  dependencyContacts as dependencyScan,
  evaluateNegatives,
  type NegativesConfig,
  readDeclarationLines,
  readNegativesDeclaration,
  renderedLineStart,
  schemaContacts as schemaScan,
  validateConfig,
  workflowContacts as workflowScan,
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

/** A blob value the test reader refuses to read, as git would on a missing object. */
const UNREADABLE = "<<unreadable blob>>";

function context(
  entries: readonly ChangedPath[],
  blobs: Readonly<Record<string, string>> = {},
  trees: { base?: readonly TreeEntry[]; head?: readonly TreeEntry[] } = {},
): ChangeContext {
  // Keyed by path for the head, `base:<path>` for the merge base. A path with
  // no entry reads as an empty file; UNREADABLE makes git fail on it.
  const readBlob: BlobReader = (path, side = "head") => {
    const text = blobs[side === "base" ? `base:${path}` : path] ?? "";
    return text === UNREADABLE ? { ok: false, reason: `no blob for ${path}` } : { ok: true, text };
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

// The surface checks return a scan (contacts and the content they read); most
// assertions are about the contacts alone.
const dependencyContacts = (change: ChangeContext) => dependencyScan(change).contacts;
const workflowContacts = (change: ChangeContext) => workflowScan(change).contacts;
const schemaContacts = (change: ChangeContext) => schemaScan(change).contacts;

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
    // After the block and its blank line, as the contract wants (owner, 2026-10-24).
    const { report, rendered } = verdict(`Door: two-way\n\n${line}`);
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("line 3 ");
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
    const { report, rendered } = verdict(`Door: two-way\n\n${line}`);
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain("0 Not-added line(s), 0 misplaced key(s)");
  });

  test.each([
    ["a comment that creates the key once removed", "Not<!-- x -->-added: dependency", 0],
    ["a key hidden in a comment", "<!-- Not-added: x -->", 1],
    [
      "a mention that stays visible in prose",
      "Door: two-way\n\nThe Not-added: line is optional.\n",
      0,
    ],
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
      `Door: two-way\n\n${block}\n`,
      changes([file("A", ".github/workflows/x.yml")]),
    );
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain(
      "1 line(s) mentioning Not-added inside them ignored, not declarations",
    );
  });

  test("declarative negatives are validated, said unverified, and the diff is not read", () => {
    const { report, rendered } = verdict("Not-added: hosted-service, telemetry, public-surface");
    expect(report.outcome).toBe("pass");
    expect(report.checks.filter((check) => check.note.startsWith("declarative:")).length).toBe(3);
    expect(rendered).toContain("diff not read: no verifiable negative declared");
  });
});

describe("the seam with the declaration block (readDeclarationLines, #141)", () => {
  test("it admits the block's Not-added line, and only it", () => {
    const read = readDeclarationLines(
      "Door: two-way\nNot-added: schema\n\n<!--\nNot-added: x\n-->\n",
    );
    expect([read.admitted, read.leftToDoor, [...read.doorRefusedLines]]).toEqual([
      ["schema"],
      0,
      [],
    ]);
  });

  test("the values come from what the block admits, not from a second parse of the text", () => {
    const read = readNegativesDeclaration("Not-added: schema", () => ({
      raw: ["Not-added: schema"],
      visible: ["Not-added: schema"],
      insideClean: [false],
      inside: [false],
      block: { first: 1, last: 1 },
      admitted: [" workflow"],
      leftToDoor: 0,
      leftToDoorLines: new Set<number>(),
      doorRefusedLines: new Set<number>(),
      totalLines: 1,
      linesExamined: 1,
      removedLines: 0,
      removedBlocks: 0,
    }));
    expect(read.kind === "declared" && read.values).toEqual(["workflow"]);
  });

  test.each([
    ["refused by T2' in the block (a `[`)", "Door: two-way\nNot-added: schema [x](y)\n\nbody\n"],
    ["refused by T2' (a `$`)", "Not-added: $schema$\n\nbody\n"],
    ["refused by T2' (HTML)", "Not-added: <b>schema</b>\n\nbody\n"],
    ["a key line outside the block (T3)", "Door: two-way\n\nNot-added: schema\n"],
    [
      "a key line after the block, no blank line (T3)",
      "Door: two-way\nOrigin: proposal\nx\nNot-added: schema\n",
    ],
  ])("a Not-added line %s is left to the Door gate: counted, never refused twice", (_, body) => {
    const read = readNegativesDeclaration(body);
    expect([read.kind, read.leftToDoor, read.misplacedLines]).toEqual(["absent", 1, 0]);
  });

  test("a line that ends the block without a blank line is the Door gate's (T1): not refused here", () => {
    const read = readNegativesDeclaration("Door: two-way\n> Not-added: schema\n");
    expect([read.kind, read.misplacedLines]).toEqual(["absent", 0]);
  });

  test("the same misplaced line after the blank line is refused here, by name", () => {
    const read = readNegativesDeclaration("Door: two-way\n\n> Not-added: schema\n");
    expect([read.kind, read.misplacedLines]).toEqual(["refused", 1]);
  });

  test("a Not-added line in a comment opened at column 0 after a blank line is exempt (not T3)", () => {
    const read = readNegativesDeclaration("Door: two-way\n\n<!--\nNot-added: x\n-->\n");
    expect([read.kind, read.leftToDoor, read.ignoredInBlocks]).toEqual(["absent", 0, 1]);
  });

  test.each([
    ["Door: two-way\n", 1],
    ["Door: two-way\n\nbody", 3],
    ["Door: two-way\n\nbody\n", 3],
  ])("%j has %i line(s), counted as the Door gate counts them", (body, lines) => {
    expect(readNegativesDeclaration(body).linesExamined).toBe(lines);
  });

  test("the count left to the Door gate is printed", () => {
    const { rendered } = verdict("Door: two-way\n\nNot-added: schema\n");
    expect(rendered).toContain("1 Not-added line(s) left to the Door gate (T2', T3)");
  });
});

describe("renderedLineStart", () => {
  test.each([
    ["Not\\-added:", "not-added:"],
    ["&#x4E;ot-added:", "not-added:"],
    ["**<i>Not</i>&nbsp;added**:", `not${cp(0x00a0)}added:`],
    [`> 1. __Not${cp(0x2014)}added:__`, "not-added:"],
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
      { path: "linked/package.json", status: "head", why: "a symlink", present: ["head"] },
    ]);
  });

  test("a link in the diff and in a tree is one contact, the changed one (C6)", () => {
    // A path ON the surface (`.cargo`), so the tree pass would add a second
    // contact if it did not skip what the diff already named.
    const contacts = dependencyContacts(
      context(
        [file("A", ".cargo", "000000", "120000")],
        {},
        { head: [{ mode: "120000", path: ".cargo" }] },
      ),
    );
    expect(contacts).toEqual([{ path: ".cargo", status: "A", why: "symlink" }]);
  });

  test("a link present in both trees is one contact, named with both trees (C6)", () => {
    const link = { mode: "120000", path: "linked/package.json" };
    const contacts = dependencyContacts(
      context([file("M", "linked/real.json")], {}, { base: [link], head: [link] }),
    );
    expect(contacts).toEqual([
      {
        path: "linked/package.json",
        status: "base+head",
        why: "a symlink",
        present: ["base", "head"],
      },
    ]);
  });

  test.each([
    "scripts/run",
    "scripts/run.pyw",
    "tools/x.sh",
    "docs/notes.md",
  ])("a PEP 723 block makes %s a contact, whatever its extension (C4)", (path) => {
    const contacts = dependencyContacts(
      context([file("A", path)], {
        [path]: "#!/usr/bin/env -S uv run --script\n# /// script\n# ///\n",
      }),
    );
    expect(contacts).toEqual([{ path, status: "A", why: "content carries # /// script" }]);
  });

  test("the dependency scan counts the blobs it read for content (C6)", () => {
    const scan = dependencyScan(
      context([file("M", "package.json"), file("M", "docs/a.md"), file("D", "docs/b.md")]),
    );
    expect(scan.blobsRead).toBe(1);
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
    expect(contacts).toEqual([{ path, status: "base", why: "a symlink", present: ["base"] }]);
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
    expect(dependencyContacts(context([file("M", "x.py")], { "x.py": UNREADABLE }))[0]?.why).toBe(
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

  test("a workflow modified or deleted, an action added: no contact", () => {
    const entries = [
      file("M", ".github/workflows/ci.yml"),
      file("D", ".github/workflows/old.yml"),
      file("A", ".github/actions/setup/action.yml"),
    ];
    expect(workflowContacts(context(entries))).toEqual([]);
  });

  test("a symlink removed under .github is a contact: it was present at the base", () => {
    const contacts = workflowContacts(context([file("D", ".github/link", "120000", "000000")]));
    expect(contacts).toEqual([{ path: ".github/link", status: "D", why: "symlink under .github" }]);
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
    expect(contacts[0]?.why).toBe(`content carries ${JSON.stringify(marker)}`);
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
      context([file("A", "a.jsonc", "000000", "120000"), file("M", "b.yml")], {
        "b.yml": UNREADABLE,
      }),
    );
    expect(contacts.map((contact) => contact.why)).toEqual([
      "a link, whose content cannot be read",
      "unreadable: no blob for b.yml",
    ]);
  });

  test.each([
    // The marker each case must be caught by, as raw characters.
    ["a backslash before LF (a YAML fold)", "data/x.yaml", '"$sch\\\nema": x', "\\\n"],
    ["a backslash before CR", "data/x.yaml", '"$sch\\\rema": x', "\\\r"],
    [
      "any backslash in a .json5 (identity escape)",
      "data/x.json5",
      '{ "$\\s\\c\\h\\e\\m\\a": 1 }',
      "\\",
    ],
  ])("C2: %s is a contact", (_, path, text, marker) => {
    const contacts = schemaContacts(context([file("M", path)], { [path]: text }));
    expect(contacts).toEqual([
      { path, status: "M", why: `content carries ${JSON.stringify(marker)}` },
    ]);
  });

  test("C2: a backslash in a .json that escapes no letter is not a contact", () => {
    expect(
      schemaContacts(context([file("M", "a.json")], { "a.json": '{"a": "\\"q\\""}' })),
    ).toEqual([]);
  });

  test.each([
    [
      "named as a schema directory",
      "contracts/schemas",
      "elsewhere",
      "a link named as a schema directory",
    ],
    [
      // A DIRECTORY target: no file-name rule matches `../schemas`, only the
      // schema-directory test does.
      "pointing into a schemas/ directory",
      "data/defs",
      "../schemas",
      'a link into a schema location ("../schemas")',
    ],
    [
      "pointing at a schema file",
      "data/link",
      "../a.schema.yaml",
      'a link into a schema location ("../a.schema.yaml")',
    ],
  ])("C5: a tree symlink %s is a contact, present in the tree", (_, path, target, why) => {
    const contacts = schemaContacts(
      context([], { [`base:${path}`]: target }, { base: [{ mode: "120000", path }] }),
    );
    expect(contacts).toEqual([{ path, status: "base", why, present: ["base"] }]);
  });

  test("C5: a symlink added in the diff, pointing into schemas/, is a contact that changed", () => {
    // Present in the head tree as well: one contact, the changed one.
    const contacts = schemaContacts(
      context(
        [file("A", "data/pointer", "000000", "120000")],
        { "data/pointer": "../schemas/x.json" },
        { head: [{ mode: "120000", path: "data/pointer" }] },
      ),
    );
    expect(contacts).toEqual([
      {
        path: "data/pointer",
        status: "A",
        why: 'a link into a schema location ("../schemas/x.json")',
      },
    ]);
  });

  test("C5: a tree symlink elsewhere is not a contact", () => {
    expect(
      schemaContacts(
        context(
          [],
          { "base:docs/l": "../readme.md" },
          { base: [{ mode: "120000", path: "docs/l" }] },
        ),
      ),
    ).toEqual([]);
  });

  test("C6: the schema scan counts blobs read and files skipped by extension", () => {
    const scan = schemaScan(context([file("M", "a.json"), file("M", "b.md"), file("M", "c.ts")]));
    expect([scan.blobsRead, scan.skippedByExtension]).toEqual([1, 2]);
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
      "rules read at the merge base; diff: 2 changed path(s) examined, 1 tree entries read for symlinks; " +
        "dependency: 0 contact(s), 2 blob(s) read for content, 0 file(s) skipped by extension, 0 deleted path(s), 0 link(s) judged by name or target, " +
        "schema: 0 contact(s), 0 blob(s) read for content, 2 file(s) skipped by extension, 0 deleted path(s), 0 link(s) judged by name or target, " +
        "workflow: 0 contact(s), 0 blob(s) read for content, 0 file(s) skipped by extension, 0 deleted path(s), 0 link(s) judged by name or target",
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

// Fifth review: the verdict that matters is the COMBINED one — the Door gate,
// then this gate. A line GitHub displays (outside a comment or fence the Door
// gate exempts) must never leave both gates green with "absent".
describe("the combined verdict (evaluateDoor, then this gate)", () => {
  const BLOCK = "Door: two-way\nOrigin: proposal\n\n";
  const combined = (body: string) => ({
    // A fixed date: `Origin: proposal` carries none, so the date changes nothing here.
    door: evaluateDoor(body, "PR #0 description", null, new Date("2026-10-24T00:00:00Z")).outcome,
    negatives: readNegativesDeclaration(body),
  });
  const neverBothSilent = (body: string) => {
    const { door, negatives } = combined(body);
    expect(door === "violations" || negatives.kind !== "absent").toBe(true);
  };

  // Fifth review, point 1: a removed comment makes the key appear at column 0.
  test.each([
    `${BLOCK}<!-- c -->Not-added: dependency\n`,
    `${BLOCK}Not<!-- c -->-added: dependency\n`,
    `${BLOCK}<!---->Not-added: dependency\n`,
  ])("point 1: %j is refused here, Door passing", (body) => {
    const { door, negatives } = combined(body);
    expect([door, negatives.kind]).toEqual(["pass", "refused"]);
  });

  test("point 1: the Not<!-- x -->-added line is refused, its ignored counter at zero", () => {
    const read = readNegativesDeclaration(`${BLOCK}Not<!-- x -->-added: dependency\n`);
    expect([read.kind, read.ignoredInBlocks]).toEqual(["refused", 0]);
  });

  // Point 2: a U+2028 inside the line; Door's KEY_LINE has the `s` flag.
  test("point 2: a key line outside the block, with U+2028, is the Door gate's only", () => {
    const body = `${BLOCK}Not-added: dependency${cp(0x2028)}\n`;
    const { door, negatives } = combined(body);
    expect([door, negatives.kind, negatives.leftToDoor]).toEqual(["violations", "absent", 1]);
  });

  test("point 2: a block line with U+2028 is admitted by both, and no count goes below zero", () => {
    const body = `Door: two-way\nOrigin: proposal\nNot-added: dependency${cp(0x2028)}\n\n`;
    const { door, negatives } = combined(body);
    expect([door, negatives.kind, negatives.leftToDoor]).toEqual(["pass", "declared", 0]);
  });

  // Point 3: the misplaced forms are judged on RAW lines; only a clean
  // comment or fence (column 0, after a blank line) hides them.
  const OPENERS: readonly (readonly [string, string])[] = [
    ["no opener", ""],
    ["an opener in a code span", "text `<!--`\n"],
    ["an opener mid-line", "text <!--\n"],
    ["an opener indented four spaces", "    <!--\n\n"],
  ];
  const LINES: readonly string[] = [
    "> Not-added: dependency",
    "# Not-added: dependency",
    "- Not-added: dependency",
    "**Not-added:** dependency",
    "<!-- c -->Not-added: dependency",
    "Not<!-- c -->-added: dependency",
    `${cp(0x2800)}Not-added: dependency`,
    `${cp(0x3164)}Not-added: dependency`,
    `${cp(0x115f)}${cp(0x1160)}${cp(0xffa0)}Not-added: dependency`,
  ];
  const corpus = OPENERS.flatMap(([name, opener]) =>
    LINES.map(
      (line) =>
        [`${name}, then ${JSON.stringify(line)}`, `${BLOCK}${opener}${line}\n-->\n`] as const,
    ),
  );

  test("the corpus holds 36 displayed lines", () => {
    expect(corpus.length).toBe(36);
  });

  test.each(corpus)("point 3: %s is never silent", (_, body) => {
    neverBothSilent(body);
  });

  test("control: the same line in a clean comment (column 0, after a blank line) is hidden, and absent", () => {
    const { door, negatives } = combined(`${BLOCK}<!--\n> Not-added: dependency\n-->\n`);
    expect([door, negatives.kind]).toEqual(["pass", "absent"]);
  });

  // Point 4: one BOM, as the Door gate removes it, never two.
  test("point 4: two BOMs: this gate reads the block Door reads, i.e. none", () => {
    const body = `${cp(0xfeff)}${cp(0xfeff)}Door: two-way\nOrigin: proposal\nNot-added: dependency\n\n`;
    const read = readNegativesDeclaration(body);
    expect(read.declarationLines).toBe(readDeclarationBlocks(body).values["Not-added"].length);
    expect(read.kind).not.toBe("declared");
  });

  test("point 4: the line partition is the Door gate's, in its words", () => {
    const body = `${BLOCK}<!--\nhidden\n-->\nshown\n`;
    const blocks = readDeclarationBlocks(body);
    const { rendered } = verdict(body);
    expect(rendered).toContain(
      `${blocks.totalLines} description line(s) = ${blocks.linesExamined} examined + ${blocks.removedLines} removed in ${blocks.removedBlocks} comment/code block(s)`,
    );
  });

  // Point 6: letters that render as blank, before the key.
  test.each([
    0x2800, 0x3164, 0x115f, 0x1160, 0xffa0,
  ])("point 6: U+%s before the key is removed", (codePoint) => {
    expect(renderedLineStart(`${cp(codePoint)}Not-added: x`)).toBe("not-added: x");
  });
});

describe("the schema partition counts deleted paths (fifth review, point 5)", () => {
  test("a deleted path is counted, not read", () => {
    const scan = schemaScan(context([file("D", "a.json"), file("M", "b.json")]));
    expect([scan.deleted, scan.blobsRead]).toEqual([1, 1]);
  });
});

// Sixth review (2026-10-24). Every expected verdict is the orchestrator's:
// a line GitHub displays and whose start reads as the key, once the listed
// normalisation is applied, is refused here while the Door gate passes.
describe("sixth review, on the combined verdict", () => {
  const B = "Door: two-way\nOrigin: proposal\n\n";
  const NOW = new Date("2026-10-24T00:00:00Z");
  const combined = (body: string) => [
    evaluateDoor(body, "PR #0 description", null, NOW).outcome,
    readNegativesDeclaration(body).kind,
  ];

  // N1: a line that starts inside a clean comment shows what follows the close.
  test.each([
    `${B}<!--\nx -->Not-added: dependency\n`,
    `${B}<!--\n<!-- c -->Not-added: dependency\n`,
    `${B}<!--\nx --!>Not-added: dependency\n`,
    `${B}<!--\nx\n-->Not-added: dependency\n`,
  ])("N1: %j is refused here, Door passing", (body) => {
    expect(combined(body)).toEqual(["pass", "refused"]);
  });

  test("N1 control: a key wholly inside a clean comment is not displayed, and absent", () => {
    expect(combined(`${B}<!--\nNot-added: x\n-->\n`)).toEqual(["pass", "absent"]);
  });

  // N2: every default-ignorable code point, and comments removed before tags.
  test.each([
    `Not${cp(0x034f)}-added: dependency`,
    `Not${cp(0xfe0f)}-added: dependency`,
    `Not${cp(0x17b4)}-added: dependency`,
    `Not${cp(0x180b)}-added: dependency`,
    "Not&#x34F;-added: dependency",
    "Not&#8203;-added: dependency",
    "<!-- a > b -->Not-added: dependency",
    '<span title=">">Not-added: dependency',
  ])("N2: %j is refused here, Door passing", (line) => {
    expect(combined(`${B}${line}\n`)).toEqual(["pass", "refused"]);
  });

  // N3: task boxes as a prefix, emphasis and code markers wherever they sit.
  test.each([
    "- [ ] Not-added: dependency",
    "- [x] Not-added: dependency",
    "* [ ] Not-added: dependency",
    "> - [ ] Not-added: dependency",
    "N*ot*-added: dependency",
    "**Not**-added: dependency",
    "Not-`added`: dependency",
  ])("N3: %j is refused here, Door passing", (line) => {
    expect(combined(`${B}${line}\n`)).toEqual(["pass", "refused"]);
  });

  // N4: the three counters are disjoint; their sum never exceeds the lines.
  test.each([
    [
      "a key in a comment opened mid-line: left to Door",
      `${B}text <!--\nNot-added: x\n-->\n`,
      [0, 0, 1],
    ],
    ["a misplaced key in it: refused here", `${B}text <!--\n> Not-added: x\n-->\n`, [0, 1, 0]],
    ["a key in a clean comment: ignored", `${B}<!--\nNot-added: x\n-->\n`, [1, 0, 0]],
  ])("N4: %s, counted once", (_, body, counts) => {
    const read = readNegativesDeclaration(body);
    expect([read.ignoredInBlocks, read.misplacedLines, read.leftToDoor]).toEqual(counts);
    expect(read.ignoredInBlocks + read.misplacedLines + read.leftToDoor).toBeLessThanOrEqual(
      readDeclarationBlocks(body).totalLines,
    );
  });

  test("N4: the schema partition sums to the diff, symlinks counted", () => {
    const entries = [
      file("D", "gone.json"),
      file("A", "x.schema.json"),
      file("A", "docs/link", "000000", "120000"),
      file("A", "data/defs", "000000", "120000"),
      file("M", "README.md"),
      file("A", "vendor/lib", "000000", "160000"),
      file("M", "a.json"),
    ];
    const scan = schemaScan(
      context(entries, { "docs/link": "../readme.md", "data/defs": "../schemas" }),
    );
    const byName = scan.contacts.filter((contact) => contact.why === "schema file name").length;
    const gitlinks = scan.contacts.filter((contact) => contact.why.includes("gitlink")).length;
    expect(scan.links).toBe(2);
    expect(
      scan.deleted + byName + scan.links + scan.skippedByExtension + gitlinks + scan.blobsRead,
    ).toBe(entries.length);
  });
});

// Seventh review (2026-10-24). Every expected verdict below is GitHub's
// rendering of the body (POST /markdown, mode gfm): "refused" where GitHub
// displays the key at the start of a line, "absent" where it does not.
describe("seventh review, against GitHub's rendering", () => {
  const B = "Door: two-way\nOrigin: proposal\n\n";
  const NOW = new Date("2026-10-24T00:00:00Z");
  const combined = (body: string) => [
    evaluateDoor(body, "PR #0 description", null, NOW).outcome,
    readNegativesDeclaration(body).kind,
  ];

  // minor-2: every way HTML5 closes a comment, and the short forms.
  test.each([
    `${B}<!-- a --!>Not-added: dependency\n`,
    `${B}<!-->Not-added: dependency\n`,
    `${B}<!--->Not-added: dependency\n`,
  ])("minor-2: %j shows the key, refused here, Door passing", (body) => {
    expect(combined(body)).toEqual(["pass", "refused"]);
  });

  // minor-1: a comment that is not the Door gate's exempt kind, closed on
  // the line, shows what follows the close.
  test.each([
    ["b7, after a paragraph", `${B}para\n<!--\nx -->Not-added: dependency\n`],
    ["b9, an indented opener", `${B}  <!--\nx -->Not-added: dependency\n`],
    ["b14, after a <pre> block", `${B}<pre>\nx\n</pre>\n\n<!--\nx -->Not-added: dependency\n`],
  ])("minor-1: %s shows the key, refused here, Door passing", (_, body) => {
    expect(combined(body)).toEqual(["pass", "refused"]);
  });

  test("minor-1 control: b3, the key after prose and a comment, is prose", () => {
    expect(combined(`${B}<!--\nx -->prose <!-- c -->Not-added: dependency\n`)).toEqual([
      "pass",
      "absent",
    ]);
  });

  // An underscore inside a word is displayed; at a word's edge it is emphasis.
  const UNDERSCORES: readonly (readonly [string, "absent" | "refused"])[] = [
    ["Not_added: dependency", "absent"],
    ["not_added: is a variable name", "absent"],
    ["not_added: names a snake_case field", "absent"],
    ["__Not-added:__ dependency", "refused"],
    ["_Not-added:_ dependency", "refused"],
    ["_Not_-added: dependency", "refused"],
    ["Not_-added: dependency", "absent"],
  ];
  test.each(UNDERSCORES)("underscore: %j is %s", (line, kind) => {
    expect(combined(`${B}${line}\n`)).toEqual(["pass", kind]);
  });

  test("minor-3: a block line is never ignored, so the counters sum on the block", () => {
    const body =
      "Door: two-way\nOrigin: proposal\nOwner-arbitration: see `<!--` below\nNot-added: hosted-service\n\nbody\n";
    const read = readNegativesDeclaration(body);
    expect([read.kind, read.declarationLines, read.ignoredInBlocks]).toEqual(["declared", 1, 0]);
    expect(
      read.declarationLines + read.ignoredInBlocks + read.misplacedLines + read.leftToDoor,
    ).toBe(1);
  });
});

// Eighth review (2026-10-26, docs/reviews/pr-negatives-161/5e16fab…). Every
// expected verdict is GitHub's rendering of the body (POST /markdown, gfm,
// sent with `-F text=@<file>`): "refused" where the key is displayed at the
// start of a line, "absent" where it is not.
describe("eighth review, against GitHub's rendering", () => {
  const B = "Door: two-way\nOrigin: proposal\n\n";
  const NOW = new Date("2026-10-24T00:00:00Z");
  const combined = (body: string) => [
    evaluateDoor(body, "PR #0 description", null, NOW).outcome,
    readNegativesDeclaration(body).kind,
  ];

  // F1: single-line constructs GitHub renders as nothing before the key.
  test.each([
    ["P01, an empty link", "[](https://example.com)Not-added: dependency"],
    ["P02, an empty link without target", "[]()Not-added: dependency"],
    ["P03, an empty image", "![]()Not-added: dependency"],
    ["P46, an empty link in a list item", "- [](#x)Not-added: dependency"],
    ["P09, a processing instruction", "<?x ?>Not-added: dependency"],
    ["P10, a declaration", "<!DOCTYPE x>Not-added: dependency"],
    ["P11, a CDATA section", "<![CDATA[x]]>Not-added: dependency"],
  ])("F1: %s shows the key, refused here, Door passing", (_, probe) => {
    expect(combined(`${B}${probe}\n`)).toEqual(["pass", "refused"]);
  });

  test("F1 control: an escaped empty link is literal text, absent", () => {
    expect(combined(`${B}\\[](x)Not-added: dependency\n`)).toEqual(["pass", "absent"]);
  });

  // F2: constructs that span a line break, read over the paragraph.
  test.each([
    ["P04, a tag over two lines", '<span\ntitle="x">Not-added: dependency'],
    ["P05, the key split by a tag over two lines", 'Not<span\nid="a">-added: dependency'],
    ["P06, the key split by a comment over two lines", "Not<!--\n-->-added: dependency"],
    ["P07, a _ pair over two lines", "_Not-added: dependency\nmore_"],
    ["P43, a __ pair over two lines", "__Not-added:\ndependency__"],
    ["P08, an HTML block that joins its lines", "<div>\nNot\nadded: dependency\n</div>"],
    [
      "P39, an empty link whose title holds a line break",
      '[](https://example.com "a\nb")Not-added: dependency',
    ],
  ])("F2: %s shows the key, refused here, Door passing", (_, probe) => {
    expect(combined(`${B}${probe}\n`)).toEqual(["pass", "refused"]);
  });

  test.each([
    ["a blank line ends the paragraph", '<span\n\ntitle="x">Not-added: dependency'],
    ["a lone _ over two lines does not pair", "_Not-added: dependency\nmore"],
  ])("F2 control: %s, absent", (_, probe) => {
    expect(combined(`${B}${probe}\n`)).toEqual(["pass", "absent"]);
  });
});
