import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditInventory,
  covers,
  extensionOf,
  NOT_GATED,
  type NotGated,
  OUTSIDE_THE_UNIVERSE,
  parseStagedEntries,
  reportInventory,
  SYMLINK_MODE,
} from "./check-data-inventory";
import { GATED_PATHSPECS } from "./check-review-evidence";

// #153, and the reviews of #159: the guarded surface rests on a closed world.
// Every tracked file that is neither code nor Markdown is gated or declared,
// and a new one fails until it is one or the other.

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
    expect(audit.staleExtensions).toEqual([]);
    expect(audit.gated.length + audit.declared.length + audit.undeclared.length).toBe(
      audit.universe.length,
    );
    expect(audit.universe.length + audit.outside).toBe(listed.paths.length);
    expect(new Set([...audit.gated, ...audit.declared]).size).toBe(audit.universe.length);
  });

  // Reviews of #159: each of these delimits a gate (lint scope, compiler
  // strictness, the aggregate's steps, licence annotations, lint levels), so
  // guarding them waits for the owner, and the inventory names them.
  test("the configuration files that delimit a gate are declared, awaiting owner arbitration", () => {
    const audit = auditInventory(listed.paths);
    expect([...audit.awaiting].sort()).toEqual([
      "Cargo.toml",
      "REUSE.toml",
      "biome.json",
      "crates/ecosystem-engine/Cargo.toml",
      "package.json",
      "tsconfig.json",
    ]);
    for (const path of audit.awaiting) expect(audit.declared).toContain(path);
  });

  test("every gated pathspec selects a tracked file, so no pattern guards a file that is gone", () => {
    for (const pathspec of GATED_PATHSPECS) {
      const selected = lsFiles(pathspec);
      expect(selected.exitCode).toBe(0);
      expect({ pathspec, count: selected.paths.length }).not.toEqual({ pathspec, count: 0 });
    }
  });

  test("no gated path of this tree is a symbolic link", () => {
    const run = Bun.spawnSync(["git", "ls-files", "-s", "-z"], { cwd: root });
    expect(run.exitCode).toBe(0);
    const entries = parseStagedEntries(new TextDecoder().decode(run.stdout));
    expect(entries).not.toBeNull();
    expect(entries?.length).toBe(listed.paths.length);
    const symlinks = (entries ?? []).filter((entry) => entry.mode === SYMLINK_MODE);
    expect(
      auditInventory(
        listed.paths,
        NOT_GATED,
        symlinks.map((entry) => entry.path),
      ).gatedSymlinks,
    ).toEqual([]);
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

  test("an extension is the last one of the file name, or none", () => {
    expect(extensionOf("a/b.v1.json")).toBe(".json");
    expect(extensionOf("a/b.yml.fixture")).toBe(".fixture");
    expect(extensionOf("a.b/LICENSE")).toBe("");
    expect(extensionOf("a/.gitignore")).toBe("");
  });
});

describe("constructed loosening files", () => {
  // The 25 constructions of the first review of #159 fold into these paths:
  // the content of a file does not matter, only that it is a data file nobody
  // gated or declared. The last ones sit under a declared directory with an
  // extension it is not declared to hold (F2 of the second review).
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
    "skills/x/allowlist.yaml",
    "docs/reviews/x/policy.toml",
    ".github/workflows/allowlist.json",
    "toolchains/notices/x.json",
  ];
  test("every one is undeclared until it is gated or declared", () => {
    expect(auditInventory(constructed).undeclared).toEqual(constructed);
  });
});

describe("the partition", () => {
  const directory: NotGated = {
    path: "docs/reviews/",
    extensions: [".json"],
    because: "frozen evidence",
  };
  const file: NotGated = { path: "biome.json", because: "configuration" };

  test("a directory covers what is under it with a declared extension, nothing else", () => {
    expect(covers(directory, "docs/reviews/a/b.json")).toBeTrue();
    expect(covers(directory, "docs/reviews/a/b.yaml")).toBeFalse();
    expect(covers(directory, "docs/reviewsX/b.json")).toBeFalse();
    expect(covers(file, "biome.json")).toBeTrue();
    expect(covers(file, "x/biome.json")).toBeFalse();
  });

  test("a directory declared for files without an extension covers those only", () => {
    const notices: NotGated = { path: "n/", extensions: [""], because: "notices" };
    expect(covers(notices, "n/SHA256SUMS")).toBeTrue();
    expect(covers(notices, "n/x.json")).toBeFalse();
  });

  test("each data file lands in exactly one place, and a gated one is never declared", () => {
    const audit = auditInventory(
      ["deny.toml", "docs/reviews/a/b.json", "biome.json", "ecosystem/new.v1.yaml", "README.md"],
      [directory, file],
    );
    expect(audit.gated).toEqual(["deny.toml"]);
    expect(audit.declared).toEqual(["docs/reviews/a/b.json", "biome.json"]);
    expect(audit.undeclared).toEqual(["ecosystem/new.v1.yaml"]);
    expect(audit.outside).toBe(1);
  });

  test("awaiting files are the declared ones whose declaration waits for the owner", () => {
    const audit = auditInventory(
      ["biome.json", "docs/reviews/a.json"],
      [{ ...file, awaitingOwnerArbitration: true }, directory],
    );
    expect(audit.awaiting).toEqual(["biome.json"]);
  });

  // F7 of the second review: bunfig.toml is gated at every depth, so a fixture
  // tree may hold a gated file. It is gated, and the directory is no defect.
  test("a gated file under a declared directory is gated, and the directory is not a defect", () => {
    const fixtures: NotGated = {
      path: "tools/fleet/fixtures/",
      extensions: [".fixture", ".toml"],
      because: "fixtures",
    };
    const audit = auditInventory(
      [
        "tools/fleet/fixtures/a/bunfig.toml",
        "tools/fleet/fixtures/a/b.fixture",
        "tools/fleet/fixtures/a/c.toml",
      ],
      [fixtures],
    );
    expect(audit.gated).toEqual(["tools/fleet/fixtures/a/bunfig.toml"]);
    expect(audit.declared).toEqual([
      "tools/fleet/fixtures/a/b.fixture",
      "tools/fleet/fixtures/a/c.toml",
    ]);
    expect(audit.contradictory).toEqual([]);
    expect(audit.stale).toEqual([]);
    expect(audit.staleExtensions).toEqual([]);
  });
});

describe("defects of the list", () => {
  // F4 of the second review, first survivor.
  test("an exact declaration of a gated file is contradictory", () => {
    const audit = auditInventory(
      ["ecosystem/sql-construction-allowlist.v1.yaml"],
      [{ path: "ecosystem/sql-construction-allowlist.v1.yaml", because: "says not gated" }],
    );
    expect(audit.contradictory).toEqual(["ecosystem/sql-construction-allowlist.v1.yaml"]);
    // The gated file stays gated: the partition does not move.
    expect(audit.gated).toEqual(["ecosystem/sql-construction-allowlist.v1.yaml"]);
    expect(audit.declared).toEqual([]);
  });

  test("an exact declaration that covers no data file is stale, even when it names code", () => {
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

  // F4 of the second review, second survivor.
  test("a directory declaration that declares no file any more is stale", () => {
    const audit = auditInventory(
      ["a.json", "fixtures/bunfig.toml"],
      [
        { path: "a.json", because: "data" },
        { path: "gone/", extensions: [".json"], because: "removed" },
        { path: "fixtures/", extensions: [".toml"], because: "only a gated file left" },
      ],
    );
    expect(audit.stale).toEqual(["gone/", "fixtures/"]);
  });

  test("a declared extension that no file of the directory carries is stale", () => {
    const audit = auditInventory(
      ["d/a.json"],
      [{ path: "d/", extensions: [".json", ".yaml"], because: "data" }],
    );
    expect(audit.staleExtensions).toEqual(['d/ ".yaml"']);
  });

  test("a file covered by two declarations is overlapping", () => {
    const audit = auditInventory(
      ["docs/reviews/a.json"],
      [
        { path: "docs/reviews/", extensions: [".json"], because: "frozen evidence" },
        { path: "docs/reviews/a.json", because: "the same file" },
      ],
    );
    expect(audit.overlapping).toEqual(["docs/reviews/a.json (docs/reviews/, docs/reviews/a.json)"]);
  });

  test("a declaration without a reason, with a bad path, or with misplaced extensions is malformed", () => {
    const audit = auditInventory(
      ["a.json", "/b.json", "c.json", "d/e.json"],
      [
        { path: "a.json", because: "  " },
        { path: "/b.json", because: "absolute" },
        { path: "", because: "empty" },
        { path: "c.json", extensions: [".json"], because: "a file with extensions" },
        { path: "d/", because: "a directory without extensions" },
      ],
    );
    expect(audit.malformed).toEqual(["a.json", "/b.json", "", "c.json", "d/"]);
  });

  test("a gated path tracked as a symbolic link is refused, an ungated one is not", () => {
    const audit = auditInventory(
      ["ecosystem/sql-construction-allowlist.v1.yaml", "docs/adr/0001-x.md", "x.json"],
      [{ path: "x.json", because: "data" }],
      ["ecosystem/sql-construction-allowlist.v1.yaml", "docs/adr/0001-x.md", "x.json"],
    );
    expect(audit.gatedSymlinks).toEqual([
      "ecosystem/sql-construction-allowlist.v1.yaml",
      "docs/adr/0001-x.md",
    ]);
  });

  test("every defect and every undeclared file fails the gate, by name", () => {
    const declarations: readonly NotGated[] = [
      { path: "gone.json", because: "removed" },
      { path: "ecosystem/web-headers-allowlist.v1.yaml", because: "says not gated" },
      { path: "d/", extensions: [".json", ".yaml"], because: "data" },
    ];
    const tracked = [
      "ecosystem/web-headers-allowlist.v1.yaml",
      "d/x.json",
      "new.json",
      "deny.toml",
    ];
    const report = reportInventory(
      tracked,
      auditInventory(tracked, declarations, ["deny.toml"]),
      declarations,
    );
    expect(report.outcome).toBe("violations");
    const failed = report.checks.filter((check) => !check.ok).map((check) => check.item);
    expect(failed).toEqual([
      "new.json",
      "ecosystem/web-headers-allowlist.v1.yaml",
      "gone.json",
      'd/ ".yaml"',
      "deny.toml",
    ]);
  });

  // F4 of the second review, third survivor: the volume is not only right at zero.
  test("the volume counts the undeclared files when there are some", () => {
    const tracked = ["new.json", "other.yaml", "a.json"];
    const declarations: readonly NotGated[] = [{ path: "a.json", because: "data" }];
    const report = reportInventory(tracked, auditInventory(tracked, declarations), declarations);
    expect(report.volumeSummary).toContain("3 data file(s) = 0 gated + 1 declared");
    expect(report.volumeSummary).toContain("+ 2 undeclared");
  });
});

describe("the staged entries", () => {
  test("parses the mode and the path of each record, a path with a space or a tab included", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    // NUL written as \u0000: `\0` followed by a digit would read as an octal escape.
    const stdout = `100644 ${sha} 0\ta b.json\u0000120000 ${sha} 0\tx\ty.json\u0000`;
    expect(parseStagedEntries(stdout)).toEqual([
      { mode: "100644", path: "a b.json" },
      { mode: "120000", path: "x\ty.json" },
    ]);
  });

  test("refuses a record it does not recognise instead of skipping it", () => {
    expect(parseStagedEntries("a.json\0")).toBeNull();
  });

  test("git reports a symbolic link as 120000, and the gate refuses it on a gated path", () => {
    const repository = mkdtempSync(join(tmpdir(), "data-inventory-symlink-"));
    try {
      const git = (...argv: string[]) =>
        Bun.spawnSync(["git", "-C", repository, ...argv], { stdout: "pipe", stderr: "pipe" });
      expect(git("init", "-q").exitCode).toBe(0);
      writeFileSync(join(repository, "elsewhere.yaml"), "allowances: []\n");
      symlinkSync("elsewhere.yaml", join(repository, "bunfig.toml"));
      expect(git("add", "--all").exitCode).toBe(0);
      const entries = parseStagedEntries(
        new TextDecoder().decode(git("ls-files", "-s", "-z").stdout),
      );
      expect(entries).not.toBeNull();
      const symlinks = (entries ?? [])
        .filter((entry) => entry.mode === SYMLINK_MODE)
        .map((entry) => entry.path);
      expect(symlinks).toEqual(["bunfig.toml"]);
      const tracked = (entries ?? []).map((entry) => entry.path);
      expect(auditInventory(tracked, [], symlinks).gatedSymlinks).toEqual(["bunfig.toml"]);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});

describe("the exclusion pattern", () => {
  test("is anchored at the end of the path", () => {
    expect(OUTSIDE_THE_UNIVERSE.test("x.ts")).toBeTrue();
    expect(OUTSIDE_THE_UNIVERSE.test("x.ts.fixture")).toBeFalse();
    expect(OUTSIDE_THE_UNIVERSE.test("x.mdx")).toBeFalse();
  });
});
