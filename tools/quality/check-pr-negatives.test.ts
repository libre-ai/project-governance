import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BlobReader,
  type ContextRead,
  dependencyEntries,
  evaluateNegatives,
  jsonProvenance,
  type NegativesConfig,
  readNegativesDeclaration,
  tomlProvenance,
  usesOf,
  usesProvenance,
  validateConfig,
} from "./check-pr-negatives";
import { renderGateReport } from "./gate-report";
import type { ChangedPath, TreeEntry } from "./git-diff";

// Every expected verdict below is written from ADR-0056 D5, the owner
// decisions of 2026-10-23 (one line, closed vocabulary, optional; a negative
// contradicted by the diff fails) and the role-separated review of the same
// day (provenance, unread formats, misplaced keys, schema conventions, rules
// at the base, workflow case and symlinks, partition, symlinked manifests),
// never from the gate's current output.

const DATA = JSON.parse(readFileSync(join(import.meta.dir, "pr-negatives.v1.json"), "utf8"));

function realConfig(): NegativesConfig {
  const read = validateConfig(DATA);
  if (!read.ok) throw new Error(read.reason);
  return read.config;
}

const CONFIG = realConfig();
const PACKAGE_JSON = CONFIG.manifests.find((format) => format.basename === "package.json");
const CARGO_TOML = CONFIG.manifests.find((format) => format.basename === "Cargo.toml");
if (PACKAGE_JSON === undefined || CARGO_TOML === undefined)
  throw new Error("manifest formats missing");

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

/** A change set over in-memory blobs, keyed `base:<path>` / `head:<path>`. */
function changes(
  entries: readonly ChangedPath[],
  blobs: Readonly<Record<string, string>> = {},
  trees: { base?: readonly TreeEntry[]; head?: readonly TreeEntry[] } = {},
): () => ContextRead {
  const readBlob: BlobReader = (side, path) => {
    const text = blobs[`${side}:${path}`];
    return text === undefined
      ? { ok: false, reason: `no ${side} blob for ${path}` }
      : { ok: true, text };
  };
  return () => ({
    ok: true,
    entries,
    readBlob,
    trees: { base: trees.base ?? [], head: trees.head ?? [] },
    config: CONFIG,
  });
}

/**
 * The verdict as CI prints it with GATE_VERBOSE (pr-negatives.yml sets it),
 * plus the volume, which a failing gate does not print but the report holds.
 */
function verdict(body: string, readContext: () => ContextRead = NEVER_READ) {
  const report = evaluateNegatives(body, "PR #0 description", readContext);
  const lines = renderGateReport("PR negatives", report, true).lines;
  return { report, rendered: [...lines, report.volumeSummary ?? ""].join("\n") };
}

const PACKAGE_BASE = JSON.stringify({
  name: "probe",
  dependencies: { ajv: "8.20.0" },
  devDependencies: { typescript: "7.0.2" },
});

const packageChange = (head: unknown, base = PACKAGE_BASE) =>
  changes([file("M", "package.json")], {
    "base:package.json": base,
    "head:package.json": JSON.stringify(head),
  });

describe("the declaration", () => {
  test("absent: the gate passes, says so, and does not read the diff", () => {
    const { report, rendered } = verdict("Door: two-way\n\nA change.");
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain("no Not-added line: nothing declared");
    expect(rendered).toContain("diff not read: no negative declared");
  });

  test("one line, comma-separated values of the vocabulary, spaces around commas allowed", () => {
    const read = readNegativesDeclaration("Not-added: dependency , schema,telemetry");
    expect(read.kind).toBe("declared");
    if (read.kind === "declared")
      expect(read.values).toEqual(["dependency", "schema", "telemetry"]);
  });

  test("a leading byte-order mark is removed before reading", () => {
    expect(readNegativesDeclaration("\uFEFFNot-added: schema").kind).toBe("declared");
  });

  test.each([
    ["Not-added: dependencies", '"dependencies" is not in the vocabulary'],
    ["Not-added: Workflow", '"Workflow" is not in the vocabulary'],
    ["Not-added: schema, schema", '"schema" is declared twice'],
    ["Not-added: dependency; schema", '"dependency; schema" — values are separated by commas only'],
    ["Not-added: dependency schema", '"dependency schema" — values are separated by commas only'],
    [
      "Not-added: dependency | schema | workflow",
      '"dependency | schema | workflow" — values are separated by commas only',
    ],
    ["Not-added: dependency,", "empty value (a doubled, leading or trailing comma)"],
    ["Not-added: dependency,,schema", "empty value (a doubled, leading or trailing comma)"],
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
    ["Not added: schema"],
    ["NOT-ADDED: schema"],
    ["> Not-added: schema"],
    ["- Not-added: schema"],
    ["* Not-added: schema"],
    ["**Not-added:** schema"],
    ["## Not-added: schema"],
    ["Not\u2011added: schema"],
    ["Not\u2013added: schema"],
    ["Not\u2014added: schema"],
    ["Not\u00a0added: schema"],
    ["The `Not-added:` line is optional."],
  ])("a visible mention that is not a declaration, %j, is refused by name", (body) => {
    const { report, rendered } = verdict(`Door: two-way\n${body}`);
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("line 2 ");
    expect(rendered).toContain('write it as "Not-added:" at the start of its own line');
  });

  test("a misplaced mention is refused even beside a valid declaration", () => {
    const { report, rendered } = verdict("Not-added: schema\n> Not-added: workflow");
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("1 Not-added line(s), 1 misplaced mention(s)");
  });

  test("author text in a refusal is escaped onto one line", () => {
    const { rendered } = verdict('- Not-added: x "::stop-commands::y"');
    expect(rendered).toContain('"- Not-added: x \\"::stop-commands::y\\""');
  });

  test.each([
    ["a fenced code block", "```\nNot-added: workflow\n```"],
    ["an HTML comment", "<!-- Not-added: workflow -->"],
  ])("a line inside %s is not a declaration: ignored, and named as ignored", (_, block) => {
    const addsWorkflow = changes([file("A", ".github/workflows/x.yml")]);
    const { report, rendered } = verdict(`Door: two-way\n${block}\n`, addsWorkflow);
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain("1 Not-added mention(s) inside them ignored, not declarations");
    expect(rendered).toContain("0 Not-added line(s), 0 misplaced mention(s)");
  });

  test("declarative negatives are validated, said unverified, and the diff is not read", () => {
    const { report, rendered } = verdict("Not-added: hosted-service, telemetry, public-surface");
    expect(report.outcome).toBe("pass");
    expect(report.checks.filter((check) => check.note.startsWith("declarative:")).length).toBe(3);
    expect(rendered).toContain(
      "0 verified against the diff, 3 declarative, not verified by this gate",
    );
    expect(rendered).toContain("diff not read: no verifiable negative declared");
  });
});

describe("workflow", () => {
  test("this pull request's own shape: adding .github/workflows/pr-negatives.yml contradicts `workflow`", () => {
    const own = changes([
      file("A", ".github/workflows/pr-negatives.yml"),
      file("A", "tools/quality/check-pr-negatives.ts"),
      file("M", "package.json"),
    ]);
    const { report, rendered } = verdict("Not-added: workflow", own);
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(
      "Not-added workflow: contradicted by the diff — workflow file added: .github/workflows/pr-negatives.yml",
    );
  });

  test("a modified or deleted workflow adds none, nor a file elsewhere under .github", () => {
    const { report, rendered } = verdict(
      "Not-added: workflow",
      changes([
        file("M", ".github/workflows/ci.yml"),
        file("D", ".github/workflows/old.yml"),
        file("A", ".github/actions/setup/action.yml"),
      ]),
    );
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain("3 changed path(s) examined (1 A, 1 M, 1 D, 0 T)");
  });

  test.each([
    [file("A", ".GitHub/WORKFLOWS/x.yml"), ".GitHub/WORKFLOWS/x.yml"],
    [
      file("M", ".github/workflows/ci.yml", "120000", "120000"),
      ".github/workflows/ci.yml (symlink)",
    ],
    [
      file("T", ".github/workflows/ci.yml", "100644", "120000"),
      ".github/workflows/ci.yml (symlink)",
    ],
    [
      file("T", ".github/workflows/ci.yml", "100644", "160000"),
      ".github/workflows/ci.yml (type changed)",
    ],
    [file("A", ".github/workflows", "000000", "120000"), ".github/workflows (symlink)"],
    [file("A", ".github", "000000", "120000"), ".github (symlink over .github/workflows)"],
  ])("%o contradicts `workflow`", (entry, named) => {
    const { report, rendered } = verdict("Not-added: workflow", changes([entry]));
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(`workflow file added: ${named}`);
  });
});

describe("schema", () => {
  test.each([
    "ecosystem/schemas/refusal.v1.schema.json",
    "a.SCHEMA.JSON",
    "x.schema.yml",
    "x.schema.yaml",
    "schema.json",
    "deep/Schema.YAML",
    "schemas/foo.json",
    "contracts/schema/deep/x.yml",
  ])("%s added contradicts `schema` by its name", (path) => {
    const { report, rendered } = verdict("Not-added: schema", changes([file("A", path)]));
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(`schema file added: ${path}`);
  });

  test("a .json added whose root $schema names a JSON Schema meta-schema contradicts `schema`", () => {
    const { report, rendered } = verdict(
      "Not-added: schema",
      changes([file("A", "data/x.json")], {
        "head:data/x.json": '{"$schema":"http://json-schema.org/draft-07/schema#"}',
      }),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(
      'schema file added: data/x.json ($schema "http://json-schema.org/draft-07/schema#")',
    );
  });

  test("a schema modified, data with another $schema, or plain JSON adds none", () => {
    const { report, rendered } = verdict(
      "Not-added: schema",
      changes(
        [
          file("M", "ecosystem/schemas/project.v1.schema.json"),
          file("A", "tools/quality/pr-negatives.v1.json"),
          file("A", "data/config.json"),
          file("A", "data/list.json"),
        ],
        {
          "head:tools/quality/pr-negatives.v1.json": '{"because":"x"}',
          "head:data/config.json": '{"$schema":"https://biomejs.dev/schemas/2.0/schema.json"}',
          "head:data/list.json": "[1, 2]",
        },
      ),
    );
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain(
      "schema: 0 added path(s) matched by name, 3 added .json file(s) read for $schema, 0 unreadable",
    );
  });

  test("an added .json that does not parse, or is a symlink, cannot be told apart: unverifiable", () => {
    const { report, rendered } = verdict(
      "Not-added: schema",
      changes([file("A", "a.json"), file("A", "b.json", "000000", "120000")], {
        "head:a.json": "{ not json",
        "head:b.json": "elsewhere.json",
      }),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("cannot verify — a.json: does not parse as JSON");
    expect(rendered).toContain("b.json: a symlink");
  });
});

describe("dependency provenance", () => {
  const rule = PACKAGE_JSON.json;

  test.each([
    ["8.20.0", "registry"],
    ["^8.20.0", "registry"],
    ["latest", "registry"],
    ["npm:evil-pkg@1.0.0", "npm:evil-pkg"],
    ["npm:@scope/evil@^1", "npm:@scope/evil"],
    ["NPM:evil", "npm:evil"],
    ["workspace:^", "workspace:"],
    ["workspace:*", "workspace:"],
    ["github:evil/ajv#main", "github:evil/ajv#main"],
    ["git+https://example.invalid/a.git", "git+https://example.invalid/a.git"],
    ["https://example.invalid/a.tgz", "https://example.invalid/a.tgz"],
    ["file:../a", "file:../a"],
    ["link:../a", "link:../a"],
    ["portal:../a", "portal:../a"],
    ["evil/ajv", "evil/ajv"],
  ])("package.json %j comes from %j", (spec, provenance) => {
    expect(jsonProvenance(spec, rule)).toBe(provenance);
  });

  test("a version change keeps the provenance; an alias does not", () => {
    expect(jsonProvenance("8.20.0", rule)).toBe(jsonProvenance("9.0.0", rule));
    expect(jsonProvenance("npm:a@1", rule)).toBe(jsonProvenance("npm:a@2", rule));
    expect(jsonProvenance("npm:a@1", rule)).not.toBe(jsonProvenance("npm:b@1", rule));
  });

  test.each([
    ['"1"', "registry"],
    ['{ version = "1.1", features = ["derive"] }', "registry"],
    ['{ version = "1", package = "evil" }', '{"package":"evil"}'],
    [
      '{ git = "https://example.invalid/a", rev = "abc" }',
      '{"git":"https://example.invalid/a","rev":"abc"}',
    ],
    ['{ path = "../a" }', '{"path":"../a"}'],
    ['{ version = "1", registry = "evil" }', '{"registry":"evil"}'],
    ["{ workspace = true }", '{"workspace":true}'],
  ])("Cargo %s comes from %s", (spec, provenance) => {
    const value = (Bun.TOML.parse(`x = ${spec}`) as { x: unknown }).x;
    expect(tomlProvenance(value, CARGO_TOML.tomlKeys)).toBe(provenance);
  });

  test.each([
    ["actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "actions/checkout"],
    ["Actions/Checkout@v4", "actions/checkout"],
    ["github/codeql-action/init@v3", "github/codeql-action/init"],
    ["./.github/actions/setup", "./.github/actions/setup"],
    ["docker://alpine:3.20", "docker://alpine"],
    ["docker://ghcr.io/o/i@sha256:abcdef", "docker://ghcr.io/o/i"],
    [
      "libre-ai/project-governance/.github/workflows/x.yml@abc",
      "libre-ai/project-governance/.github/workflows/x.yml",
    ],
  ])("uses %j is %j without its ref", (value, provenance) => {
    expect(usesProvenance(value)).toBe(provenance);
  });

  test("uses are read in block and flow style, never from a comment", () => {
    const read = usesOf(
      "jobs:\n  a:\n    uses: o/reusable.yml@v1\n  b:\n    steps:\n      - { uses: o/flow@v2 }\n      # uses: o/comment@v3\n",
    );
    expect(read.ok && [...read.uses].sort()).toEqual(["o/flow", "o/reusable.yml"]);
  });
});

describe("dependency", () => {
  test("a new devDependency entry contradicts `dependency`, named with its section", () => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      packageChange({
        dependencies: { ajv: "8.20.0" },
        devDependencies: { typescript: "7.0.2", "left-pad": "1.3.0" },
      }),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("entry added: package.json: devDependencies.left-pad");
  });

  test("a development dependency moved to runtime adds a runtime dependency", () => {
    const { rendered } = verdict(
      "Not-added: dependency",
      packageChange({ dependencies: { ajv: "8.20.0", typescript: "7.0.2" } }),
    );
    expect(rendered).toContain("entry added: package.json: dependencies.typescript");
  });

  test("a provenance change is named with both provenances", () => {
    const { rendered } = verdict(
      "Not-added: dependency",
      packageChange({
        dependencies: { ajv: "npm:evil-pkg@1.0.0" },
        devDependencies: { typescript: "7.0.2" },
      }),
    );
    expect(rendered).toContain(
      'provenance changed: package.json: dependencies.ajv ("registry" → "npm:evil-pkg")',
    );
  });

  test.each([
    [{ catalog: { react: "19" } }, "catalog.react"],
    [{ catalogs: { legacy: { react: "18" } } }, "catalogs.legacy.react"],
    [{ workspaces: { packages: ["a"], catalog: { react: "19" } } }, "workspaces.catalog.react"],
    [{ bundleDependencies: true }, "bundleDependencies.(all)"],
    [{ overrides: { foo: { bar: "1" } } }, "overrides.foo"],
  ])("%o adds %s", (extra, entry) => {
    const base = JSON.parse(PACKAGE_BASE);
    const { rendered } = verdict("Not-added: dependency", packageChange({ ...base, ...extra }));
    expect(rendered).toContain(`entry added: package.json: ${entry}`);
  });

  test("a version bump, a removal, a script, a reformatting and a list of workspaces add no dependency", () => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      changes([file("M", "package.json"), file("M", "bun.lock")], {
        "base:package.json": PACKAGE_BASE,
        "head:package.json": JSON.stringify(
          {
            name: "probe",
            workspaces: ["packages/*"],
            scripts: { x: "y" },
            dependencies: { ajv: "8.21.0" },
          },
          null,
          4,
        ),
      }),
    );
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain(
      "lockfile(s) modified without a manifest entry added, not judged an addition: bun.lock",
    );
    expect(rendered).toContain("dependency partition of 2 changed path(s):");
    expect(rendered).toContain(
      "1 manifest read, 0 manifest unreadable, 0 lockfile added, 1 lockfile modified, not judged",
    );
  });

  test.each([
    [file("A", "packages/new/package.json"), "manifest added: packages/new/package.json"],
    [file("A", "crates/new/Cargo.lock"), "lockfile added: crates/new/Cargo.lock"],
    [file("A", "tools/x/requirements.txt"), "manifest added: tools/x/requirements.txt"],
    [file("A", "vendor/lib", "000000", "160000"), "submodule added: vendor/lib"],
    [file("T", "vendor/lib", "040000", "160000"), "submodule added: vendor/lib"],
    [file("A", ".gitmodules"), ".gitmodules added: submodule list or URLs"],
  ])("%o contradicts `dependency`", (entry, named) => {
    const { report, rendered } = verdict("Not-added: dependency", changes([entry]));
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(`contradicted by the diff — ${named}`);
  });

  test("a workflow added brings all its uses; a submodule moved is a version change", () => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      changes(
        [file("A", ".github/workflows/new.yml"), file("M", "vendor/lib", "160000", "160000")],
        {
          "head:.github/workflows/new.yml":
            "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: docker://alpine:3\n",
        },
      ),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("uses added: .github/workflows/new.yml: actions/checkout");
    expect(rendered).toContain("uses added: .github/workflows/new.yml: docker://alpine");
    expect(rendered).toContain("1 submodule moved, not judged");
  });

  test.each([
    [
      file("M", "tools/licensing/requirements.txt"),
      "manifest of a format this gate does not read: tools/licensing/requirements.txt (M)",
    ],
    [
      file("M", "py/requirements/base.in"),
      "manifest of a format this gate does not read: py/requirements/base.in (M)",
    ],
    [
      file("M", "Constraints-dev.txt"),
      "manifest of a format this gate does not read: Constraints-dev.txt (M)",
    ],
    [
      file("M", "env/environment.yaml"),
      "manifest of a format this gate does not read: env/environment.yaml (M)",
    ],
    [
      file("T", "package.json", "100644", "120000"),
      "package.json is a symlink: its target can change without its path changing",
    ],
    [file("M", "bun.lock", "120000", "120000"), "bun.lock is a symlink"],
    [
      file("M", ".github/workflows/ci.yml", "120000", "120000"),
      ".github/workflows/ci.yml is a symlink",
    ],
  ])("%o makes `dependency` unverifiable, named", (entry, named) => {
    const { report, rendered } = verdict("Not-added: dependency", changes([entry]));
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(`cannot verify — ${named}`);
  });

  test("a symlinked manifest outside the diff, at the head, makes `dependency` unverifiable", () => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      changes(
        [file("M", "linked/real.json")],
        {},
        { head: [{ mode: "120000", path: "linked/package.json" }] },
      ),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("linked/package.json is a symlink at the head");
    expect(rendered).toContain("1 symlinked dependency file(s) outside the diff");
  });

  test.each([
    ["does not parse", "{ not json", "does not parse as json"],
    [
      "carries a section that is neither a table, a list nor a boolean",
      JSON.stringify({ dependencies: 3 }),
      "dependencies is neither a table",
    ],
  ])("a read manifest that %s makes `dependency` unverifiable", (_, head, reason) => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      changes([file("M", "package.json")], {
        "base:package.json": PACKAGE_BASE,
        "head:package.json": head,
      }),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("cannot verify — manifest unreadable: package.json (head)");
    expect(rendered).toContain(reason);
  });

  test("a workflow file that does not parse makes `dependency` unverifiable", () => {
    const { rendered } = verdict(
      "Not-added: dependency",
      changes([file("M", ".github/workflows/ci.yml")], {
        "base:.github/workflows/ci.yml": "jobs: {}\n",
        "head:.github/workflows/ci.yml": "jobs: [\n",
      }),
    );
    expect(rendered).toContain("workflow/action file unreadable: .github/workflows/ci.yml");
  });

  test("the partition sums to the paths examined: every path in exactly one part", () => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      changes(
        [
          file("D", "Cargo.toml"),
          file("D", "vendor/lib", "160000", "000000"),
          file("M", "package.json"),
          file("M", "README.md"),
          file("A", "docs/x.md"),
        ],
        { "base:package.json": PACKAGE_BASE, "head:package.json": PACKAGE_BASE },
      ),
    );
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain("dependency partition of 5 changed path(s):");
    expect(rendered).toContain("1 manifest read,");
    expect(rendered).toContain("2 dependency file deleted, 2 other");
  });

  test("Cargo: the workspace table, every dependency table, [patch] and [replace] are read", () => {
    const read = dependencyEntries(
      CARGO_TOML,
      [
        "[workspace.dependencies]",
        'serde = "1"',
        "[dev-dependencies]",
        'insta = "1"',
        "[build-dependencies.cc]",
        'version = "1"',
        "[target.'cfg(unix)'.dependencies]",
        'libc = "0.2"',
        "[patch.crates-io]",
        'serde = { path = "../serde" }',
        "[replace]",
        '"a:1.0.0" = { path = "a" }',
      ].join("\n"),
    );
    expect(read.ok && [...read.entries.keys()].sort()).toEqual([
      "build-dependencies.cc",
      "dev-dependencies.insta",
      "patch.crates-io.serde",
      "replace.a:1.0.0",
      "target.cfg(unix).dependencies.libc",
      "workspace.dependencies.serde",
    ]);
  });
});

describe("the diff", () => {
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

  test("true negatives pass, with the volume examined", () => {
    const { report, rendered } = verdict(
      "Door: two-way\nNot-added: dependency, schema, hosted-service, telemetry",
      changes([file("A", "tools/quality/check-pr-negatives.ts"), file("M", "package.json")], {
        "base:package.json": PACKAGE_BASE,
        "head:package.json": JSON.stringify({ ...JSON.parse(PACKAGE_BASE), scripts: { x: "y" } }),
      }),
    );
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain(
      "negatives: 4 declared, 2 verified against the diff (dependency, schema), 2 declarative, not verified by this gate (hosted-service, telemetry)",
    );
    expect(rendered).toContain(
      "rules read at the merge base; diff: 2 changed path(s) examined (1 A, 1 M, 0 D, 0 T)",
    );
  });
});

describe("the data file", () => {
  test("the committed data validates", () => {
    expect(validateConfig(DATA).ok).toBe(true);
  });

  test("every pattern of the data is case-insensitive", () => {
    expect(
      [...CONFIG.schemaPatterns, ...CONFIG.unreadManifests, ...CONFIG.usesFiles].every((p) =>
        p.flags.includes("i"),
      ),
    ).toBe(true);
  });

  test.each([
    [
      "a pattern that does not compile",
      { ...DATA, schema: { ...DATA.schema, addedPathPatterns: ["("] } },
      "is not a valid pattern",
    ],
    ["no workflow directory", { ...DATA, workflow: {} }, "workflow.directory"],
    ["no schema content rule", { ...DATA, schema: { addedPathPatterns: ["x"] } }, "schema.content"],
    [
      "a manifest without a provenance rule",
      {
        ...DATA,
        dependency: {
          ...DATA.dependency,
          manifests: [{ ...DATA.dependency.manifests[0], provenance: undefined }],
        },
      },
      "provenance rule",
    ],
    [
      "a name listed twice",
      { ...DATA, dependency: { ...DATA.dependency, lockfiles: ["package.json"] } },
      '"package.json" is listed twice',
    ],
    [
      "no uses file pattern",
      { ...DATA, dependency: { ...DATA.dependency, usesFilePatterns: [] } },
      "usesFilePatterns",
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

  test("the checkout persists no credential (review 2026-10-23, finding 9)", () => {
    const checkouts = Object.values(workflow.jobs).flatMap((job) =>
      job.steps.filter((step) => step.uses?.startsWith("actions/checkout@")),
    );
    expect(checkouts.length).toBe(1);
    expect(checkouts[0]?.with?.["persist-credentials"]).toBe(false);
  });
});
