import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  auditInventory,
  covers,
  NOT_GATED,
  type NotGated,
  OUTSIDE_THE_UNIVERSE,
  reportInventory,
} from "./check-data-inventory";
import { GATED_PATHSPECS } from "./check-review-evidence";

// #153, and the review of #159 (MAJOR-1): the guarded surface rests on a
// closed world. Every tracked file that is neither code nor Markdown is gated
// or declared, and a new one fails until it is one or the other.

const root: string = join(import.meta.dir, "..", "..");

function lsFiles(...pathspecs: string[]): { exitCode: number; paths: string[] } {
  const run = Bun.spawnSync(["git", "ls-files", "-z", "--", ...pathspecs], { cwd: root });
  return {
    exitCode: run.exitCode ?? 1,
    paths: new TextDecoder()
      .decode(run.stdout)
      .split("\0")
      .filter((path) => path.length > 0),
  };
}

describe("the inventory of this tree", () => {
  const listed = lsFiles();

  test("every data file is gated or declared, and the counts partition the tree", () => {
    expect(listed.exitCode).toBe(0);
    const audit = auditInventory(listed.paths);
    // An empty universe passes every assertion below: it is the tree that was not read.
    expect(audit.universe.length).toBeGreaterThan(0);
    expect(audit.undeclared).toEqual([]);
    expect(audit.contradictory).toEqual([]);
    expect(audit.stale).toEqual([]);
    expect(audit.overlapping).toEqual([]);
    expect(audit.malformed).toEqual([]);
    expect(audit.gated.length + audit.declared.length + audit.undeclared.length).toBe(
      audit.universe.length,
    );
    expect(audit.universe.length + audit.outside).toBe(listed.paths.length);
    expect(new Set([...audit.gated, ...audit.declared]).size).toBe(audit.universe.length);
  });

  // The review of #159: both delimit a gate, so both are members; guarding
  // them waits for the owner, and the inventory says so by name.
  test("biome.json and tsconfig.json are declared, awaiting owner arbitration", () => {
    const audit = auditInventory(listed.paths);
    expect(audit.awaiting).toContain("biome.json");
    expect(audit.awaiting).toContain("tsconfig.json");
    for (const path of audit.awaiting) expect(audit.declared).toContain(path);
  });

  test("every gated pathspec selects a tracked file, so no pattern guards a file that is gone", () => {
    for (const pathspec of GATED_PATHSPECS) {
      const selected = lsFiles(pathspec);
      expect(selected.exitCode).toBe(0);
      expect({ pathspec, count: selected.paths.length }).not.toEqual({ pathspec, count: 0 });
    }
  });

  test("the gate prints the partition and passes on this tree", () => {
    const audit = auditInventory(listed.paths);
    const report = reportInventory(listed.paths, audit);
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(NOT_GATED.length);
    expect(report.volumeSummary).toContain(
      `${audit.universe.length} data file(s) = ${audit.gated.length} gated + ${audit.declared.length} declared`,
    );
    expect(report.volumeSummary).toContain("+ 0 undeclared");
  });
});

describe("the universe", () => {
  // Each extension of the exclusion, alone: dropping one from the pattern
  // turns its probe red even where no such file is tracked today.
  for (const extension of [
    "md",
    "ts",
    "tsx",
    "mts",
    "cts",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "py",
    "rs",
    "sh",
    "jq",
  ]) {
    test(`a .${extension} file is source or prose, outside the universe`, () => {
      expect(auditInventory([`x/y.${extension}`], []).universe).toEqual([]);
    });
  }

  test("everything else is in the universe, whatever its name", () => {
    const paths = [
      "x/y.json",
      "x/y.jsonc",
      "x/y.json5",
      "x/y.toml",
      "x/y.txt",
      "x/y.mdx",
      "x/README.md.fixture",
      "x/y.ts.bak",
      ".gitleaksignore",
      "CODEOWNERS",
    ];
    expect(auditInventory(paths, []).universe).toEqual(paths);
  });
});

describe("constructed loosening files", () => {
  // The 25 constructions of the review of #159 fold into these paths: the
  // content of a file does not matter any more, only that it is a data file
  // nobody gated or declared. Each one fails against the real declarations.
  const constructed = [
    "config/gitleaks.toml",
    "ecosystem/minified.v1.json",
    "ecosystem/single-quoted.v1.yaml",
    "ecosystem/list-item.v1.yaml",
    "ecosystem/exempt-classes.v1.yaml",
    "ecosystem/skip.v1.yaml",
    "ecosystem/ignored-paths.v1.yaml",
    "ecosystem/trusted.v1.yaml",
    "ecosystem/suppressions.toml",
    "ecosystem/threshold.json",
    "ecosystem/Exemptions.yaml",
    "ecosystem/array-of-tables.toml",
    ".github/codeql/codeql-config.yml",
    ".gitleaksignore",
    ".trivyignore",
    "tools/quality/config/surface.v1.json",
    "x/biome.json",
    "tools/quality/surface.json5",
    "tools/quality/surface.jsonc",
    ".npmrc",
    "packages/classification/tsconfig.json",
    "docs/reviewsX/allowlist.json",
  ];
  test("every one is undeclared until it is gated or declared", () => {
    expect(auditInventory(constructed).undeclared).toEqual(constructed);
  });
});

describe("the partition", () => {
  const declarations: readonly NotGated[] = [
    { path: "docs/reviews/", because: "frozen evidence" },
    { path: "biome.json", because: "configuration" },
  ];

  test("a directory covers what is under it, not a name that only starts the same", () => {
    expect(covers(declarations[0] as NotGated, "docs/reviews/a/b.json")).toBeTrue();
    expect(covers(declarations[0] as NotGated, "docs/reviewsX/b.json")).toBeFalse();
    expect(covers(declarations[1] as NotGated, "biome.json")).toBeTrue();
    expect(covers(declarations[1] as NotGated, "x/biome.json")).toBeFalse();
  });

  test("each data file lands in exactly one place, and a gated one is never declared", () => {
    const audit = auditInventory(
      ["deny.toml", "docs/reviews/a/b.json", "biome.json", "ecosystem/new.v1.yaml", "README.md"],
      declarations,
    );
    expect(audit.gated).toEqual(["deny.toml"]);
    expect(audit.declared).toEqual(["docs/reviews/a/b.json", "biome.json"]);
    expect(audit.undeclared).toEqual(["ecosystem/new.v1.yaml"]);
    expect(audit.outside).toBe(1);
  });

  test("awaiting files are the declared ones whose declaration waits for the owner", () => {
    const audit = auditInventory(
      ["biome.json", "docs/reviews/a.json"],
      [
        { path: "biome.json", because: "configuration", awaitingOwnerArbitration: true },
        { path: "docs/reviews/", because: "frozen evidence" },
      ],
    );
    expect(audit.awaiting).toEqual(["biome.json"]);
  });
});

describe("defects of the list", () => {
  test("a declaration that covers a gated file is contradictory", () => {
    const audit = auditInventory(
      ["ecosystem/sql-construction-allowlist.v1.yaml", "ecosystem/x.yaml"],
      [{ path: "ecosystem/", because: "too wide" }],
    );
    expect(audit.contradictory).toEqual(["ecosystem/"]);
    // The gated file stays gated: the partition does not move.
    expect(audit.gated).toEqual(["ecosystem/sql-construction-allowlist.v1.yaml"]);
  });

  test("a declaration that covers no data file is stale, even when it names code", () => {
    const audit = auditInventory(
      ["tools/quality/check-x.ts", "a.json"],
      [
        { path: "gone.json", because: "removed" },
        { path: "tools/quality/check-x.ts", because: "code is outside the universe" },
        { path: "a.json", because: "data" },
      ],
    );
    expect(audit.stale).toEqual(["gone.json", "tools/quality/check-x.ts"]);
  });

  test("a file covered by two declarations is overlapping", () => {
    const audit = auditInventory(
      ["docs/reviews/a.json"],
      [
        { path: "docs/reviews/", because: "frozen evidence" },
        { path: "docs/reviews/a.json", because: "the same file" },
      ],
    );
    expect(audit.overlapping).toEqual(["docs/reviews/a.json (docs/reviews/, docs/reviews/a.json)"]);
  });

  test("a declaration without a reason, or with an absolute or empty path, is malformed", () => {
    const audit = auditInventory(
      ["a.json", "/b.json"],
      [
        { path: "a.json", because: "  " },
        { path: "/b.json", because: "absolute" },
        { path: "", because: "empty" },
      ],
    );
    expect(audit.malformed).toEqual(["a.json", "/b.json", ""]);
  });

  test("every defect and every undeclared file fails the gate, by name", () => {
    const declarations: readonly NotGated[] = [
      { path: "gone.json", because: "removed" },
      { path: "ecosystem/", because: "too wide" },
    ];
    const tracked = ["ecosystem/web-headers-allowlist.v1.yaml", "ecosystem/x.yaml", "new.json"];
    const report = reportInventory(tracked, auditInventory(tracked, declarations), declarations);
    expect(report.outcome).toBe("violations");
    const failed = report.checks.filter((check) => !check.ok).map((check) => check.item);
    expect(failed).toEqual(["new.json", "ecosystem/", "gone.json"]);
  });
});

describe("the exclusion pattern", () => {
  test("is anchored at the end of the path", () => {
    expect(OUTSIDE_THE_UNIVERSE.test("x.ts")).toBeTrue();
    expect(OUTSIDE_THE_UNIVERSE.test("x.ts.fixture")).toBeFalse();
    expect(OUTSIDE_THE_UNIVERSE.test("x.mdx")).toBeFalse();
  });
});
