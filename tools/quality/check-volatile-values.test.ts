import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  COUNTED_UNITS,
  DERIVATION_MARKER,
  isRootDocument,
  scanForVolatileValues,
  VOLATILE_PATTERNS,
  type VolatileFinding,
  type VolatilePattern,
  type VolatileScan,
} from "./check-volatile-values";

function scan(path: string, text: string): VolatileScan {
  return scanForVolatileValues([{ path, text }]);
}

function ids(findings: readonly VolatileFinding[]): string[] {
  return findings.map((finding) => finding.id);
}

describe("the patterns, as data", () => {
  test("three patterns, each with an id, a case-insensitive Unicode expression and an advice", () => {
    const patterns: readonly VolatilePattern[] = VOLATILE_PATTERNS;
    expect(patterns.map((pattern) => pattern.id)).toEqual([
      "version-literal",
      "review-date",
      "hand-count",
    ]);
    for (const pattern of patterns) {
      expect(pattern.pattern.flags).toBe("iu");
      expect(pattern.says.length).toBeGreaterThan(0);
    }
  });

  test("the marker is the substring the brief names", () => {
    expect(DERIVATION_MARKER).toBe("derived:");
  });
});

describe("which files are root documents", () => {
  test.each(["README.md", "README.fr.md", "AGENTS.md", "CLAUDE.md"])("%s is one", (path) => {
    expect(isRootDocument(path)).toBe(true);
  });

  test.each([
    "docs/x.md",
    "a/README.md",
    "docs/AGENTS.md",
    "README.txt",
    "README.fra.md",
    "README.FR.md",
    "CHANGELOG.md",
  ])("%s is not", (path) => {
    expect(isRootDocument(path)).toBe(false);
  });

  test.each(["docs/x.md", "a/README.md"])("a volatile value under %s is not read", (path) => {
    const result = scan(path, "Version : 1.2.3\n24 dépôts déclarés\n");
    expect(result.findings).toEqual([]);
    expect(result.filesScanned).toBe(0);
    expect(result.linesRead).toBe(0);
  });
});

describe("version-literal", () => {
  test("a version written in README.md is one finding on line 1", () => {
    const result = scan("README.md", "Version : 1.2.3");
    expect(result.findings).toEqual([
      { file: "README.md", line: 1, id: "version-literal", text: "Version : 1.2.3" },
    ]);
    expect(result.filesScanned).toBe(1);
    expect(result.linesRead).toBe(1);
  });

  test.each([
    "**Version** : 1.2.3",
    "**Version :** 1.2.3",
    "Version : `1.2.3`",
    "_Version_: v1.2.3",
    "Version: **`v1.2.3`**",
  ])("markdown emphasis or code around the parts does not hide a version: %p", (line) => {
    expect(ids(scan("README.md", line).findings)).toEqual(["version-literal"]);
  });

  test("a word that merely ends in `version` is not a version", () => {
    expect(scan("README.md", "conversion 3.2.1").findings).toEqual([]);
    expect(scan("README.md", "conversion : 3.2.1").findings).toEqual([]);
  });
});

describe("the derivation marker", () => {
  test("a line that names its command is exempt, and counted", () => {
    const result = scan("README.md", "Version : 1.2.3 <!-- derived: bun x -->");
    expect(result.findings).toEqual([]);
    expect(result.derived).toEqual([
      { file: "README.md", line: 1, id: "version-literal", text: "Version : 1.2.3" },
    ]);
    expect(result.malformedMarkers).toEqual([]);
  });

  test("the marker exempts its own line only", () => {
    const result = scan("README.md", "Version : 1.2.3 <!-- derived: bun x -->\nVersion : 4.5.6\n");
    expect(result.findings.map((finding) => finding.line)).toEqual([2]);
    expect(result.derived.map((finding) => finding.line)).toEqual([1]);
    expect(result.linesRead).toBe(2);
  });

  test.each([
    "see below derived:",
    "see below derived:   ",
    "Version : 1.2.3 <!-- derived: -->",
    // The closing token is not a command, wherever the line goes on after it.
    "Version : 1.2.3 <!-- derived: --> voir la doc",
    "Version : 1.2.3 <!-- derived:--> <!-- other -->",
    "Version : 1.2.3 <!--derived:   -->.",
    // Outside an HTML comment, prose after the marker is not a declaration.
    "Version : 1.2.3, derived: from the manifest",
    "Version : 1.2.3 <!-- derived: bun x",
    // One declared marker does not cover a second, bare one on the same line.
    "Version : 1.2.3 <!-- derived: bun x --> 24 dépôts derived:",
  ])("a marker without a command is malformed: %p", (line) => {
    const result = scan("AGENTS.md", `first line\n${line}`);
    expect(result.malformedMarkers).toEqual([{ file: "AGENTS.md", line: 2 }]);
    expect(result.derived).toEqual([]);
  });

  test("a bare marker does not exempt the value on its line", () => {
    const result = scan("README.md", "Version : 1.2.3 derived:");
    expect(ids(result.findings)).toEqual(["version-literal"]);
  });

  test("a marker in prose, outside its comment form, exempts nothing", () => {
    const result = scan("README.md", "Version : 1.2.3, derived: from the manifest");
    expect(ids(result.findings)).toEqual(["version-literal"]);
    expect(result.derived).toEqual([]);
  });

  test("text after a well-formed comment does not undo the declaration", () => {
    const result = scan("README.md", "Version : 1.2.3 <!-- derived: bun x --> see the manifest");
    expect(result.findings).toEqual([]);
    expect(ids(result.derived)).toEqual(["version-literal"]);
    expect(result.malformedMarkers).toEqual([]);
  });
});

describe("review-date", () => {
  test("a French review date in AGENTS.md is one finding", () => {
    const result = scan("AGENTS.md", "Dernière mise à jour : 2026-10-08");
    expect(ids(result.findings)).toEqual(["review-date"]);
  });

  test.each([
    "Last reviewed 2026-10-08",
    "last updated: 2026-10-08",
    "Updated on 2026-10-08",
    "Dernière revue : 2026-10-08",
    "Mis à jour le 2026-10-08",
  ])("%p is one finding", (line) => {
    expect(ids(scan("README.md", line).findings)).toEqual(["review-date"]);
  });

  test.each([
    "Last-updated: 2026-10-08",
    "last_reviewed: 2026-10-08",
    "**Last updated**: `2026-10-08`",
    "Dernière-mise-à-jour : 2026-10-08",
  ])("a hyphen, underscore or emphasis in the phrase does not hide a date: %p", (line) => {
    expect(ids(scan("README.md", line).findings)).toEqual(["review-date"]);
  });

  test("a date more than twenty characters after the phrase is not attached to it", () => {
    const line = `last updated ${"x".repeat(21)} 2026-10-08`;
    expect(scan("README.md", line).findings).toEqual([]);
  });

  test("a date without a review phrase is not a finding", () => {
    expect(scan("README.md", "ADR accepted on 2026-10-08").findings).toEqual([]);
  });
});

describe("hand-count", () => {
  test("a count of repositories in README.fr.md is one finding", () => {
    const result = scan("README.fr.md", "24 dépôts déclarés");
    expect(result.findings).toEqual([
      { file: "README.fr.md", line: 1, id: "hand-count", text: "24 dépôts" },
    ]);
  });

  test("a number that counts no listed unit is not a finding", () => {
    expect(scan("README.fr.md", "1 sur 24").findings).toEqual([]);
    expect(scan("README.fr.md", "ADR 0001 à 0043").findings).toEqual([]);
  });

  test("the units are the ones the specification enumerates, written out here", () => {
    // Written out rather than derived: the parameterised test below follows the
    // exported list, so a unit dropped from it would otherwise drop its own test.
    expect<readonly string[]>([...COUNTED_UNITS]).toEqual(
      "commit commits fichier fichiers file files test tests dépôt dépôts repository repositories page pages décision décisions decision decisions job jobs script scripts projet projets project projects".split(
        " ",
      ),
    );
  });

  test.each([...COUNTED_UNITS])("« 3 %s » is one finding", (unit) => {
    const result = scan("README.md", `3 ${unit}`);
    expect(result.findings).toEqual([
      { file: "README.md", line: 1, id: "hand-count", text: `3 ${unit}` },
    ]);
  });

  test.each([
    "**24** dépôts",
    "`24` files",
    "24 **dépôts**",
    "_24_ `tests`",
  ])("markdown emphasis or code around the parts does not hide a count: %p", (line) => {
    expect(ids(scan("README.md", line).findings)).toEqual(["hand-count"]);
  });

  test("a longer word that starts with a unit is not that unit", () => {
    expect(scan("README.md", "3 testeurs").findings).toEqual([]);
  });

  test("a number glued to a letter, a digit group or a decimal is not a count", () => {
    expect(scan("README.md", "v3 files").findings).toEqual([]);
    expect(scan("README.md", "1.3 files").findings).toEqual([]);
    expect(scan("README.md", "1,3 fichiers").findings).toEqual([]);
  });
});

// ── The command, run as a process on a tracked fixture ─────────────────────

const GATE = join(import.meta.dir, "check-volatile-values.ts");

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

// A child inheriting GIT_DIR, a global git config or GATE_VERBOSE would read
// another index or print another output than the fixture's.
const CHILD_ENV = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, argv: readonly string[]): void {
  const result = Bun.spawnSync(["git", ...argv], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: CHILD_ENV,
  });
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(
      `fixture setup failed: git ${argv.join(" ")} — ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
}

let workspace: string;

/** A repository whose index tracks exactly `files`. */
function fixture(name: string, files: Readonly<Record<string, string>>): string {
  const repository = join(workspace, name);
  mkdirSync(repository);
  git(repository, ["init", "--quiet"]);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repository, path)), { recursive: true });
    writeFileSync(join(repository, path), text);
    git(repository, ["add", "--", path]);
  }
  return repository;
}

function runGate(cwd: string, argv: readonly string[] = []): Run {
  const result = Bun.spawnSync(["bun", GATE, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: CHILD_ENV,
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "volatile-values-probe-"));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("the command", () => {
  test("a clean fixture exits 0 and prints its volume", () => {
    const repository = fixture("clean", {
      "README.md": "# Title\n\nVersion : 1.2.3 <!-- derived: bun x -->\n",
      "AGENTS.md": "Rules.\n",
      "docs/x.md": "24 dépôts déclarés\n",
    });
    const run = runGate(repository);
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("2 root document(s), 4 line(s), 1 derived line(s)");
    expect(run.stdout).toContain("derived  README.md:3  version-literal");
  });

  test("a single finding exits 1 and is printed as path:line: id: excerpt", () => {
    const repository = fixture("finding", {
      "README.md": "# Title\n\nThe fleet holds 24 dépôts déclarés.\n",
    });
    const run = runGate(repository);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("README.md:3: hand-count: 24 dépôts");
    expect(run.stderr).toContain("1 root document(s), 3 line(s), 0 derived line(s)");
  });

  test("a bare marker exits 2 and names file and line", () => {
    const repository = fixture("malformed", {
      "README.md": "# Title\nVersion : 1.2.3 <!-- derived: -->\n",
    });
    const run = runGate(repository);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("README.md:2:");
    expect(run.stderr).toContain("names no command");
  });

  test("a tracked root document that cannot be read exits 2 and names it", () => {
    const repository = fixture("unreadable", {
      "README.md": "# Title\n",
      "AGENTS.md": "Rules.\n",
    });
    unlinkSync(join(repository, "AGENTS.md"));
    const run = runGate(repository);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("AGENTS.md: tracked root document is unreadable");
  });

  test("run from a subdirectory, the command still reads the root documents", () => {
    const repository = fixture("from-subdirectory", {
      "README.md": "# Title\n\nThe fleet holds 24 dépôts déclarés.\n",
      "docs/x.md": "Notes.\n",
    });
    const run = runGate(join(repository, "docs"));
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("README.md:3: hand-count: 24 dépôts");
    expect(run.stdout).not.toContain("verified nothing");
  });

  test("a tracked root document that is a symbolic link exits 2, unfollowed", () => {
    const outsideFile = join(workspace, "outside-target.md");
    writeFileSync(outsideFile, "Version : 9.9.9 outside-secret\n");
    const repository = fixture("symlink", { "AGENTS.md": "Rules.\n" });
    symlinkSync(outsideFile, join(repository, "README.md"));
    git(repository, ["add", "--", "README.md"]);
    const run = runGate(repository);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("README.md: tracked root document is a symbolic link");
    expect(`${run.stdout}${run.stderr}`).not.toContain("outside-secret");
    expect(`${run.stdout}${run.stderr}`).not.toContain("9.9.9");
  });

  test("no root document is declared empty with its reason, never a silent green", () => {
    const repository = fixture("empty", { "docs/x.md": "Version : 1.2.3\n" });
    const run = runGate(repository);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("verified nothing, as declared");
    expect(run.stdout).toContain("none of the 1 tracked file(s) is a root document");
  });

  test("any argument is a usage error", () => {
    const repository = fixture("usage", { "README.md": "# Title\n" });
    const run = runGate(repository, ["--fix"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("usage:");
  });

  test("outside a repository the root cannot be resolved, and the command fails", () => {
    const outside = join(workspace, "not-a-repository");
    mkdirSync(outside);
    const run = runGate(outside);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("git rev-parse --show-toplevel failed");
  });
});
