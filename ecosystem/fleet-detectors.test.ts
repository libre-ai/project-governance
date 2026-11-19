import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { SqlAllowance } from "./check-sql-construction";
import { measureDefaultBranchRefs } from "./detect-default-branch-refs";
import { measureLocalPaths, scanLocalPaths } from "./detect-local-paths";
import { judgeSqlSites } from "./detect-sql-construction";
import { DetectorInputError, findingLine, readTrackedFiles } from "./fleet-detector-io";
import { type DetectorDescriptor, discoverDetectors, REGISTRY_PATH } from "./fleet-gates";
import { localFleetReader } from "./fleet-state";

/**
 * The first three fleet detectors (owner's decision of 2026-11-19: adapted
 * from the gates already in service). The expected findings come from the
 * rules those gates enforce, not from the detectors' output: a raw `.unsafe(`
 * call is a site of `check-sql-construction.ts`, a `?ref=` on a default branch
 * and a push filter without the served branch are refusals of
 * `check-resolved-refs.ts`, a home path without the marker is a refusal of
 * `check-context-hygiene.sh`. Each detector is run the way `fleet-state.ts`
 * runs it — its script, through `localFleetReader`, in a worktree laid out as
 * `<root>/<owner>/<name>` — so the protocol (one stdout line per finding,
 * `path:line:rule`, exit 0 for a measure, any other exit an error) is the one
 * under test, not an imitation of it.
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  // realpath: on macOS the temporary directory sits behind a /var link, and
  // `localFleetReader` refuses a worktree whose real path differs.
  const root = realpathSync(mkdtempSync(join(tmpdir(), `fleet-detectors-${prefix}-`)));
  roots.push(root);
  return root;
}

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

interface Fleet {
  readonly worktrees: string;
  readonly snapshot: string;
}

/** One repository `owner/name` with `files` added to its index, and its snapshot entry. */
function fleet(
  repository: string,
  files: Record<string, string | Uint8Array>,
  servedBranch: string | null = "trunk",
): Fleet {
  const root = scratch(repository.replace("/", "-"));
  const worktree = join(root, "worktrees", repository);
  mkdirSync(worktree, { recursive: true });
  git(worktree, "init", "-q");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(worktree, path)), { recursive: true });
    writeFileSync(join(worktree, path), content);
  }
  git(worktree, "add", "-A");
  const snapshot = join(root, "snapshot");
  mkdirSync(join(snapshot, dirname(repository)), { recursive: true });
  if (servedBranch !== null) {
    writeFileSync(
      join(snapshot, `${repository}.json`),
      JSON.stringify({ repository, default_branch: servedBranch }),
    );
  }
  return { worktrees: join(root, "worktrees"), snapshot };
}

const discovered = await discoverDetectors(join(import.meta.dir, "fleet-detectors"), REGISTRY_PATH);

function detectorOf(id: string): DetectorDescriptor {
  if (!discovered.ok) throw new Error(discovered.errors.join("\n"));
  const found = discovered.detectors.find((detector) => detector.id === id);
  if (found === undefined) throw new Error(`no detector ${id}`);
  return found;
}

async function run(id: string, at: Fleet, repository: string) {
  const reader = localFleetReader({
    worktrees: at.worktrees,
    snapshot: at.snapshot,
    environment: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
  });
  return reader.run(detectorOf(id), { scope: "repo", repository });
}

describe("the detectors directory", () => {
  test("holds the three registered detectors, each of repo scope with target 0", () => {
    expect(discovered.ok ? discovered.registered : discovered.errors).toBe(3);
    for (const id of ["sql-construction", "local-paths", "default-branch-ref"]) {
      const detector = detectorOf(id);
      expect([detector.scope, detector.target]).toEqual(["repo", 0]);
    }
  });
});

describe("sql-construction", () => {
  test("a raw `.unsafe(` call is one finding at its line", async () => {
    const at = fleet("fixture/sql", {
      "src/query.ts": "export const read = (db, id) =>\n  db.unsafe(`SELECT * FROM t`);\n",
    });
    const result = await run("sql-construction", at, "fixture/sql");
    expect(result).toEqual({ ok: true, lines: ["src/query.ts:2:unsafe-call"] });
  });

  test("a tagged template parameterizes: no finding", async () => {
    const at = fleet("fixture/sql-clean", {
      // `$` and `{` are concatenated: this is source text under test, and a
      // placeholder inside a plain string is what the linter refuses.
      "src/query.ts":
        "export const read = (sql, id) => sql`SELECT * FROM t WHERE id = $" + "{id}`;\n",
    });
    expect(await run("sql-construction", at, "fixture/sql-clean")).toEqual({ ok: true, lines: [] });
  });

  const allowance = (count: number): SqlAllowance => ({
    repository: "fixture/sql",
    path: "a.ts",
    rule: "unsafe-call",
    count,
    because: "reviewed",
  });
  const sites = new Map([
    [
      "a.ts",
      [
        { rule: "unsafe-call" as const, line: 3 },
        { rule: "unsafe-call" as const, line: 9 },
      ],
    ],
  ]);

  test("a group at its allowlisted count is reviewed, not a finding", () => {
    const judged = judgeSqlSites("fixture/sql", sites, [allowance(2)]);
    expect([judged.findings, judged.allowed, judged.sites]).toEqual([[], 2, 2]);
  });

  test("a count that moved reopens every site of the group", () => {
    const judged = judgeSqlSites("fixture/sql", sites, [allowance(1)]);
    expect(judged.findings).toEqual(["a.ts:3:unsafe-call", "a.ts:9:unsafe-call"]);
  });

  test("an allowance of another repository covers nothing here", () => {
    expect(judgeSqlSites("fixture/other", sites, [allowance(2)]).findings).toHaveLength(2);
  });
});

describe("local-paths", () => {
  test("a home path is one finding that does not repeat the user name", async () => {
    const at = fleet("fixture/paths", {
      "README.md": "# Setup\n\ncd /Users/alice/dev/project\n", // allow-local-path (fixture)
      "deploy.sh": "cp build /home/bob/www\n", // allow-local-path (fixture)
    });
    const result = await run("local-paths", at, "fixture/paths");
    expect(result).toEqual({
      ok: true,
      lines: ["README.md:3:local-path", "deploy.sh:1:local-path"],
    });
  });

  test("the marker, a web path, a relative path and a binary file are not findings", async () => {
    const at = fleet("fixture/paths-clean", {
      "a.md": "see /Users/alice/x allow-local-path\n", // allow-local-path (fixture)
      "b.md": "https://example.invalid/home/index.html and docs/home/x\n",
      "c.bin": new Uint8Array([0, ...new TextEncoder().encode("/home/carol/")]), // allow-local-path (fixture)
    });
    expect(await run("local-paths", at, "fixture/paths-clean")).toEqual({ ok: true, lines: [] });
  });

  test("a file URL and a drive letter are workstation paths", () => {
    const text = "file:///home/dan/x\nC:/Users/erin/x\n"; // allow-local-path (fixture)
    expect(scanLocalPaths([{ path: "n.txt", text }]).findings).toEqual([
      "n.txt:1:local-path",
      "n.txt:2:local-path",
    ]);
  });
});

describe("default-branch-ref", () => {
  test("a written ref and a filter without the served branch are findings", async () => {
    const at = fleet("fixture/refs", {
      "tools/fetch.ts": 'export const url = "repos/o/r/contents/card.yaml?ref=main";\n',
      ".github/workflows/ci.yml": "on:\n  push:\n    branches: [main]\n",
    });
    const result = await run("default-branch-ref", at, "fixture/refs");
    expect(result).toEqual({
      ok: true,
      lines: [
        "tools/fetch.ts:1:rest-ref-query",
        ".github/workflows/ci.yml:3:workflow-filter-omits-served-branch",
      ],
    });
  });

  test("a resolved ref and a filter listing the served branch are not", async () => {
    const at = fleet("fixture/refs-clean", {
      "tools/fetch.ts": 'export const expression = "HEAD:card.yaml";\n',
      ".github/workflows/ci.yml": "on:\n  push:\n    branches: [trunk]\n",
      "tools/fetch.test.ts": 'const refused = "contents/card.yaml?ref=main";\n',
    });
    expect(await run("default-branch-ref", at, "fixture/refs-clean")).toEqual({
      ok: true,
      lines: [],
    });
  });

  test("an absent snapshot is an error, never a zero", async () => {
    const at = fleet("fixture/refs-blind", { "a.ts": "x\n" }, null);
    const result = await run("default-branch-ref", at, "fixture/refs-blind");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toContain("forge snapshot of fixture/refs-blind");
  });

  test("a missing input variable is an input error", async () => {
    await expect(measureDefaultBranchRefs({})).rejects.toBeInstanceOf(DetectorInputError);
  });
});

describe("the tracked read", () => {
  test("a directory that is not a repository is an error, never zero files", async () => {
    const root = scratch("not-a-repository");
    await expect(measureLocalPaths({ FLEET_WORKTREE: root })).rejects.toBeInstanceOf(
      DetectorInputError,
    );
  });

  test("a tracked file missing from the working tree is an error", async () => {
    const at = fleet("fixture/gone", { "a.md": "x\n" });
    const worktree = join(at.worktrees, "fixture/gone");
    rmSync(join(worktree, "a.md"));
    await expect(readTrackedFiles(worktree, () => true)).rejects.toThrow("a.md");
  });

  test("its counters sum to the tracked files", async () => {
    const at = fleet("fixture/count", {
      "a.ts": "x\n",
      "b.md": "y\n",
      "c.bin": new Uint8Array([0, 1]),
    });
    const read = await readTrackedFiles(
      join(at.worktrees, "fixture/count"),
      (path) => !path.endsWith(".md"),
    );
    expect([read.tracked, read.outOfScope, read.binary, read.files.length]).toEqual([3, 1, 1, 1]);
  });

  test("a finding line escapes a line break in a path", () => {
    expect(findingLine("a\nb.ts", 4, "r")).toBe("a\\u000ab.ts:4:r");
  });
});
