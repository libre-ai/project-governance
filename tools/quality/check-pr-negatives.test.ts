import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BlobReader,
  type ChangesRead,
  dependencyEntries,
  evaluateNegatives,
  type NegativesConfig,
  readNegativesDeclaration,
  validateConfig,
} from "./check-pr-negatives";
import { renderGateReport } from "./gate-report";
import type { ChangedPath } from "./git-diff";

// Every expected verdict below is written from ADR-0056 D5 and the owner
// decisions of 2026-10-23 (one line, closed vocabulary, optional; a negative
// contradicted by the diff fails), never from the gate's current output.

const DATA = JSON.parse(readFileSync(join(import.meta.dir, "pr-negatives.v1.json"), "utf8"));

function realConfig(): NegativesConfig {
  const read = validateConfig(DATA);
  if (!read.ok) throw new Error(read.reason);
  return read.config;
}

const CONFIG = realConfig();

/** A diff reader that fails the test if the gate reads the diff at all. */
const NEVER_READ = (): ChangesRead => {
  throw new Error("the diff was read although no verifiable negative was declared");
};

/** A change set over in-memory blobs, keyed `base:<path>` / `head:<path>`. */
function changes(
  entries: readonly ChangedPath[],
  blobs: Readonly<Record<string, string>> = {},
): () => ChangesRead {
  const readBlob: BlobReader = (side, path) => {
    const text = blobs[`${side}:${path}`];
    return text === undefined
      ? { ok: false, reason: `no ${side} blob for ${path}` }
      : { ok: true, text };
  };
  return () => ({ ok: true, entries, readBlob });
}

/**
 * The verdict as CI prints it with GATE_VERBOSE (pr-negatives.yml sets it),
 * plus the volume, which a failing gate does not print but the report holds.
 */
function verdict(body: string, readChanges: () => ChangesRead = NEVER_READ) {
  const report = evaluateNegatives(body, "PR #0 description", readChanges, CONFIG);
  const lines = renderGateReport("PR negatives", report, true).lines;
  return { report, rendered: [...lines, report.volumeSummary ?? ""].join("\n") };
}

const PACKAGE_BASE = JSON.stringify({
  name: "probe",
  dependencies: { ajv: "8.20.0" },
  devDependencies: { typescript: "7.0.2" },
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
    ["not-added: schema", 'key "not-added:" — write it exactly "Not-added:"'],
    ["Not added: schema", 'key "Not added:" — write it exactly "Not-added:"'],
    ["Not-Added: schema", 'key "Not-Added:" — write it exactly "Not-added:"'],
  ])("%j is refused, named", (body, reason) => {
    const { report, rendered } = verdict(body);
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(reason);
    expect(rendered).toContain("diff not read: the declaration is refused");
  });

  test.each([
    ["a fenced code block", "```\nNot-added: workflow\n```"],
    ["an HTML comment", "<!-- Not-added: workflow -->"],
  ])("a line inside %s is not a declaration: ignored, and named as ignored", (_, block) => {
    const addsWorkflow = changes([{ status: "A", path: ".github/workflows/x.yml" }]);
    const { report, rendered } = verdict(`Door: two-way\n${block}\n`, addsWorkflow);
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain("1 Not-added mention(s) inside them ignored, not declarations");
    expect(rendered).toContain("0 Not-added line(s)");
  });

  test("a mention inside a sentence is not a declaration either", () => {
    const read = readNegativesDeclaration("The `Not-added:` line is optional.");
    expect(read.kind).toBe("absent");
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
      { status: "A", path: ".github/workflows/pr-negatives.yml" },
      { status: "A", path: "tools/quality/check-pr-negatives.ts" },
      { status: "M", path: "package.json" },
    ]);
    const { report, rendered } = verdict("Not-added: workflow", own);
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(
      "Not-added workflow: contradicted by the diff — workflow file added: .github/workflows/pr-negatives.yml",
    );
  });

  test("a modified or deleted workflow adds none", () => {
    const edits = changes([
      { status: "M", path: ".github/workflows/ci.yml" },
      { status: "D", path: ".github/workflows/old.yml" },
    ]);
    const { report, rendered } = verdict("Not-added: workflow", edits);
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain("2 changed path(s) examined (0 A, 1 M, 1 D, 0 T)");
  });

  test("a file added elsewhere under .github adds no workflow", () => {
    const { report } = verdict(
      "Not-added: workflow",
      changes([{ status: "A", path: ".github/actions/setup/action.yml" }]),
    );
    expect(report.outcome).toBe("pass");
  });
});

describe("schema", () => {
  test("a schema file added contradicts `schema`", () => {
    const { report, rendered } = verdict(
      "Not-added: schema",
      changes([{ status: "A", path: "ecosystem/schemas/refusal.v1.schema.json" }]),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("schema file added: ecosystem/schemas/refusal.v1.schema.json");
  });

  test("a schema modified, or a JSON file that is not a schema, adds none", () => {
    const { report } = verdict(
      "Not-added: schema",
      changes([
        { status: "M", path: "ecosystem/schemas/project.v1.schema.json" },
        { status: "A", path: "tools/quality/pr-negatives.v1.json" },
      ]),
    );
    expect(report.outcome).toBe("pass");
  });
});

describe("dependency", () => {
  const packageChange = (head: unknown) =>
    changes([{ status: "M", path: "package.json" }], {
      "base:package.json": PACKAGE_BASE,
      "head:package.json": JSON.stringify(head),
    });

  test("a new devDependency entry contradicts `dependency`, named with its section", () => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      packageChange({
        dependencies: { ajv: "8.20.0" },
        devDependencies: { typescript: "7.0.2", "left-pad": "1.3.0" },
      }),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("dependency entry added: package.json: devDependencies.left-pad");
  });

  test("a development dependency moved to runtime adds a runtime dependency", () => {
    const { rendered } = verdict(
      "Not-added: dependency",
      packageChange({ dependencies: { ajv: "8.20.0", typescript: "7.0.2" } }),
    );
    expect(rendered).toContain("dependency entry added: package.json: dependencies.typescript");
  });

  test("a version bump, a removal, a script and a reformatting add no dependency", () => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      changes(
        [
          { status: "M", path: "package.json" },
          { status: "M", path: "bun.lock" },
        ],
        {
          "base:package.json": PACKAGE_BASE,
          "head:package.json": JSON.stringify(
            { name: "probe", scripts: { x: "y" }, dependencies: { ajv: "8.21.0" } },
            null,
            4,
          ),
        },
      ),
    );
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain(
      "lockfile(s) modified without a manifest entry added, not judged an addition: bun.lock",
    );
    expect(rendered).toContain(
      "1 manifest(s) read, 0 lockfile(s) added, 1 lockfile(s) modified not judged",
    );
  });

  test("a manifest added is compared to an empty one", () => {
    const added = (text: string) =>
      verdict(
        "Not-added: dependency",
        changes([{ status: "A", path: "packages/new/package.json" }], {
          "head:packages/new/package.json": text,
        }),
      );
    expect(added(JSON.stringify({ name: "new" })).report.outcome).toBe("pass");
    expect(
      added(JSON.stringify({ name: "new", peerDependencies: { react: "*" } })).rendered,
    ).toContain("dependency entry added: packages/new/package.json: peerDependencies.react");
  });

  test("a lockfile added contradicts `dependency`", () => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      changes([{ status: "A", path: "crates/new/Cargo.lock" }]),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("lockfile added: crates/new/Cargo.lock");
  });

  test("a Cargo target dependency added contradicts `dependency`", () => {
    const { rendered } = verdict(
      "Not-added: dependency",
      changes([{ status: "M", path: "crates/x/Cargo.toml" }], {
        "base:crates/x/Cargo.toml": '[package]\nname = "x"\n\n[dependencies]\nserde = "1"\n',
        "head:crates/x/Cargo.toml":
          '[package]\nname = "x"\n\n[dependencies]\nserde = "1"\n\n[target.\'cfg(unix)\'.dependencies]\nlibc = "0.2"\n',
      }),
    );
    expect(rendered).toContain(
      "dependency entry added: crates/x/Cargo.toml: target.cfg(unix).dependencies.libc",
    );
  });

  test("a manifest of a format the gate does not read makes `dependency` unverifiable", () => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      changes([{ status: "M", path: "tools/licensing/requirements.txt" }]),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(
      "cannot verify — manifest of a format this gate does not read: tools/licensing/requirements.txt (M)",
    );
  });

  test.each([
    ["does not parse", "{ not json"],
    ["carries a section that is not a table", JSON.stringify({ dependencies: ["ajv"] })],
  ])("a read manifest that %s makes `dependency` unverifiable", (_, head) => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      changes([{ status: "M", path: "package.json" }], {
        "base:package.json": PACKAGE_BASE,
        "head:package.json": head,
      }),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("cannot verify — manifest unreadable: package.json (head)");
  });

  test("a manifest blob git cannot read makes `dependency` unverifiable", () => {
    const { report, rendered } = verdict(
      "Not-added: dependency",
      changes([{ status: "M", path: "package.json" }], { "head:package.json": PACKAGE_BASE }),
    );
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain(
      "manifest unreadable: package.json (base): no base blob for package.json",
    );
  });

  test("a deleted manifest is not read", () => {
    const { report } = verdict(
      "Not-added: dependency",
      changes([{ status: "D", path: "packages/old/package.json" }]),
    );
    expect(report.outcome).toBe("pass");
  });
});

describe("the diff", () => {
  test("an unreadable diff fails: nothing verified is not a negative held", () => {
    const { report, rendered } = verdict("Not-added: schema", () => ({
      ok: false,
      reason: "could not find the merge base of origin/x and HEAD: fatal",
    }));
    expect(report.outcome).toBe("violations");
    expect(rendered).toContain("diff: unreadable, nothing verified: could not find the merge base");
  });

  test("true negatives pass, with the volume examined", () => {
    const { report, rendered } = verdict(
      "Door: two-way\nNot-added: dependency, schema, hosted-service, telemetry",
      changes(
        [
          { status: "A", path: ".github/workflows/pr-negatives.yml" },
          { status: "A", path: "tools/quality/check-pr-negatives.ts" },
          { status: "M", path: "package.json" },
        ],
        {
          "base:package.json": PACKAGE_BASE,
          "head:package.json": JSON.stringify({ ...JSON.parse(PACKAGE_BASE), scripts: { x: "y" } }),
        },
      ),
    );
    expect(report.outcome).toBe("pass");
    expect(rendered).toContain(
      "negatives: 4 declared, 2 verified against the diff (dependency, schema), 2 declarative, not verified by this gate (hosted-service, telemetry)",
    );
    expect(rendered).toContain("diff: 3 changed path(s) examined (2 A, 1 M, 0 D, 0 T)");
  });
});

describe("dependencyEntries", () => {
  const cargo = CONFIG.manifests.find((format) => format.basename === "Cargo.toml");

  test("reads the workspace table and every dependency table of Cargo", () => {
    if (cargo === undefined) throw new Error("Cargo.toml format missing from the data");
    const read = dependencyEntries(
      cargo,
      [
        "[workspace.dependencies]",
        'serde = "1"',
        "[dev-dependencies]",
        'insta = "1"',
        "[build-dependencies.cc]",
        'version = "1"',
      ].join("\n"),
    );
    expect(read).toEqual({
      ok: true,
      entries: ["dev-dependencies.insta", "build-dependencies.cc", "workspace.dependencies.serde"],
    });
  });
});

describe("the data file", () => {
  test("the committed data validates", () => {
    expect(validateConfig(DATA).ok).toBe(true);
  });

  test.each([
    [
      "a pattern that does not compile",
      { ...DATA, schema: { addedPathPatterns: ["("] } },
      "is not a valid pattern",
    ],
    [
      "an empty workflow rule",
      { ...DATA, workflow: { addedPathPatterns: [] } },
      "workflow.addedPathPatterns",
    ],
    [
      "a manifest without a parser",
      {
        ...DATA,
        dependency: {
          ...DATA.dependency,
          manifests: [{ basename: "package.json", sections: ["x"] }],
        },
      },
      "json|toml parser",
    ],
    [
      "a name listed twice",
      { ...DATA, dependency: { ...DATA.dependency, lockfiles: ["package.json"] } },
      '"package.json" is listed twice',
    ],
  ])("%s is refused", (_, value, reason) => {
    const read = validateConfig(value);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain(reason);
  });
});
