import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parseFinding } from "../tools/fleet/remediation/kit";
import type { SqlAllowance } from "./check-sql-construction";
import { measureDefaultBranchRefs } from "./detect-default-branch-refs";
import { measureLocalPaths, scanLocalPaths } from "./detect-local-paths";
import { judgeSqlSites } from "./detect-sql-construction";
import { DetectorInputError, findingLine, readTrackedFiles } from "./fleet-detector-io";
import { type DetectorDescriptor, discoverDetectors, REGISTRY_PATH } from "./fleet-gates";
import { type DetectorRun, localFleetReader } from "./fleet-state";
import { scanSource } from "./sql-construction-scanner";

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
 * `path:line:rule`, the volume as the last stderr line, exit 0 for a measure,
 * any other exit an error) is the one under test, not an imitation of it.
 *
 * The cases marked « review » come from the independent review of 2026-11-19
 * (B1, M1-M4, m1-m4); each was red before its correction.
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
  readonly root: string;
  readonly worktrees: string;
  readonly snapshot: string;
  readonly worktree: string;
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
  return { root, worktrees: join(root, "worktrees"), snapshot, worktree };
}

const discovered = await discoverDetectors(join(import.meta.dir, "fleet-detectors"), REGISTRY_PATH);

function detectorOf(id: string): DetectorDescriptor {
  if (!discovered.ok) throw new Error(discovered.errors.join("\n"));
  const found = discovered.detectors.find((detector) => detector.id === id);
  if (found === undefined) throw new Error(`no detector ${id}`);
  return found;
}

async function run(id: string, at: Fleet, repository: string): Promise<DetectorRun> {
  const reader = localFleetReader({
    worktrees: at.worktrees,
    snapshot: at.snapshot,
    environment: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
  });
  return reader.run(detectorOf(id), { scope: "repo", repository });
}

/** The finding lines of a run, or its error reason: one value to compare. */
function found(result: DetectorRun): readonly string[] | string {
  return result.ok ? result.lines : `error: ${result.reason}`;
}

function volumeOf(result: DetectorRun): string {
  return result.ok ? (result.volume ?? "(no volume)") : `error: ${result.reason}`;
}

describe("the detectors directory", () => {
  test("holds the three registered detectors, each of repo scope with target 0", () => {
    expect(discovered.ok ? discovered.registered : discovered.errors).toBe(3);
    for (const id of ["sql-construction", "local-paths", "default-branch-ref"]) {
      const detector = detectorOf(id);
      expect([detector.scope, detector.target]).toEqual(["repo", 0]);
    }
  });

  // Review B1: a fixture built by concatenation was itself a site of the
  // gate these detectors adapt, in this public repository.
  test("the detectors and this test hold no raw-SQL construction", () => {
    for (const name of [
      "fleet-detectors.test.ts",
      "fleet-detector-io.ts",
      "detect-sql-construction.ts",
      "detect-local-paths.ts",
      "detect-default-branch-refs.ts",
    ]) {
      const text = readFileSync(join(import.meta.dir, name), "utf8");
      expect(`${name}: ${scanSource(name, text).length}`).toBe(`${name}: 0`);
    }
  });
});

describe("sql-construction", () => {
  test("a raw `.unsafe(` call is one finding at its line", async () => {
    const at = fleet("fixture/sql", {
      "src/query.ts": "export const read = (db, id) =>\n  db.unsafe(`SELECT * FROM t`);\n",
    });
    expect(found(await run("sql-construction", at, "fixture/sql"))).toEqual([
      "src/query.ts:2:unsafe-call",
    ]);
  });

  test("a tagged template parameterizes: no finding", async () => {
    const at = fleet("fixture/sql-clean", {
      "src/query.ts": readFileSync(
        join(import.meta.dir, "fixtures/fleet-detectors/tagged-query.ts.txt"),
        "utf8",
      ),
    });
    expect(found(await run("sql-construction", at, "fixture/sql-clean"))).toEqual([]);
  });

  // Review M2: a NUL byte made the source « binary » and took it out of the
  // scan, while bun runs it and the gate reads it.
  test("a NUL byte in a source does not take it out of the scan", async () => {
    const at = fleet("fixture/sql-nul", {
      "src/query.ts": "/* \u0000 */\nexport const read = (db) => db.unsafe(`SELECT 1`);\n",
    });
    expect(found(await run("sql-construction", at, "fixture/sql-nul"))).toEqual([
      "src/query.ts:2:unsafe-call",
    ]);
  });

  const allowance = (count: number, path = "a.ts"): SqlAllowance => ({
    repository: "fixture/sql",
    path,
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

  // Review M4: `const stale = 0` survived.
  test("an allowance with no site left is counted stale", () => {
    const judged = judgeSqlSites("fixture/sql", sites, [allowance(2), allowance(1, "gone.ts")]);
    expect([judged.findings, judged.stale]).toEqual([[], 1]);
  });
});

describe("local-paths", () => {
  test("a home path is one finding that does not repeat the user name", async () => {
    const at = fleet("fixture/paths", {
      "README.md": "# Setup\n\ncd /Users/alice/dev/project\n", // allow-local-path (fixture)
      "deploy.sh": "cp build /home/bob/www\n", // allow-local-path (fixture)
    });
    expect(found(await run("local-paths", at, "fixture/paths"))).toEqual([
      "README.md:3:local-path",
      "deploy.sh:1:local-path",
    ]);
  });

  test("the marker, a web path, a relative path and a binary file are not findings", async () => {
    const at = fleet("fixture/paths-clean", {
      "a.md": "see /Users/alice/x allow-local-path\n", // allow-local-path (fixture)
      "b.md": "https://example.invalid/home/index.html and docs/home/x\n",
      "c.bin": new Uint8Array([0, ...new TextEncoder().encode("/home/carol/")]), // allow-local-path (fixture)
    });
    expect(found(await run("local-paths", at, "fixture/paths-clean"))).toEqual([]);
  });

  test("a file URL and a drive letter are workstation paths", () => {
    const text = "file:///home/dan/x\nC:/Users/erin/x\n"; // allow-local-path (fixture)
    expect(scanLocalPaths([{ path: "n.txt", text }]).findings).toEqual([
      "n.txt:1:local-path",
      "n.txt:2:local-path",
    ]);
  });

  // Review m2 (orchestrator's decision): the CI runner's home is not a
  // workstation; an immutable-system home is one.
  test("the CI runner's home is not a finding, an immutable-system home is", () => {
    const text = "cd /home/runner/work/r\nls /var/home/frank/x\n"; // allow-local-path (fixture)
    expect(scanLocalPaths([{ path: "n.txt", text }]).findings).toEqual(["n.txt:2:local-path"]);
  });

  // First fleet run, 2026-11-19: five findings of project-governance were
  // counts of Dependabot's build home quoted in a review of CI logs. That home
  // is a hosted build machine like the runner's; a name that only starts with
  // it is still a workstation home.
  test("Dependabot's build home is not a finding, a longer name is", () => {
    const text = "9 /home/dependabot/\ncd /home/dependabot-fan/x\n"; // allow-local-path (fixture)
    expect(scanLocalPaths([{ path: "n.txt", text }]).findings).toEqual(["n.txt:2:local-path"]);
  });

  // Review M4: `mode === "120000" && false` survived; the link was then read
  // through to its target outside the worktree.
  test("a tracked link is counted, never followed", async () => {
    const at = fleet("fixture/link", { "a.md": "x\n" });
    const outside = join(at.root, "outside.txt");
    writeFileSync(outside, "/home/grace/secret\n"); // allow-local-path (fixture)
    symlinkSync(outside, join(at.worktree, "link.md"));
    git(at.worktree, "add", "link.md");
    const result = await run("local-paths", at, "fixture/link");
    expect(found(result)).toEqual([]);
    expect(volumeOf(result)).toContain("1 link(s)");
  });
});

describe("default-branch-ref", () => {
  test("a written ref and a filter without the served branch are findings", async () => {
    const at = fleet("fixture/refs", {
      "tools/fetch.ts": 'export const url = "repos/o/r/contents/card.yaml?ref=main";\n',
      ".github/workflows/ci.yml": "on:\n  push:\n    branches: [main]\n",
    });
    expect(found(await run("default-branch-ref", at, "fixture/refs"))).toEqual([
      "tools/fetch.ts:1:rest-ref-query",
      ".github/workflows/ci.yml:3:workflow-filter-omits-served-branch",
    ]);
  });

  test("a resolved ref and a filter listing the served branch are not", async () => {
    const at = fleet("fixture/refs-clean", {
      "tools/fetch.ts": 'export const expression = "HEAD:card.yaml";\n',
      ".github/workflows/ci.yml": "on:\n  push:\n    branches: [trunk]\n",
      "tools/fetch.test.ts": 'const refused = "contents/card.yaml?ref=main";\n',
      "tests/fetch.ts": 'const refused = "contents/card.yaml?ref=main";\n',
    });
    expect(found(await run("default-branch-ref", at, "fixture/refs-clean"))).toEqual([]);
  });

  // Review m4: Rust sources make requests too.
  test("a written ref in a Rust source is a finding", async () => {
    const at = fleet("fixture/refs-rust", {
      "src/fetch.rs": 'const URL: &str = "repos/o/r/contents/card.yaml?ref=main";\n',
    });
    expect(found(await run("default-branch-ref", at, "fixture/refs-rust"))).toEqual([
      "src/fetch.rs:1:rest-ref-query",
    ]);
  });

  test("an absent snapshot is an error, never a zero", async () => {
    const at = fleet("fixture/refs-blind", { "a.ts": "x\n" }, null);
    expect(found(await run("default-branch-ref", at, "fixture/refs-blind"))).toContain(
      "forge snapshot of fixture/refs-blind",
    );
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

  // Review M1: an empty source is not a clean one.
  test("a repository with no tracked file is an error, for every detector", async () => {
    const at = fleet("fixture/empty", {});
    for (const id of ["sql-construction", "local-paths", "default-branch-ref"]) {
      expect(found(await run(id, at, "fixture/empty"))).toContain("no tracked file");
    }
  });

  // Review M1/M4: the volume reaches the state through the protocol; a
  // no-op in place of the line that writes it survived.
  test("a successful run reports its volume as its last stderr line", async () => {
    const at = fleet("fixture/volume", { "a.md": "x\n", "b.ts": "y\n" });
    expect(volumeOf(await run("local-paths", at, "fixture/volume"))).toBe(
      "local-paths: 0 finding(s); 2 tracked = 0 out of scope + 0 link(s) + 0 submodule(s) + 0 binary + 2 read text file(s); 0 line(s) exempted by « allow-local-path »",
    );
  });

  test("a tracked file missing from the working tree is an error", async () => {
    const at = fleet("fixture/gone", { "a.md": "x\n" });
    rmSync(join(at.worktree, "a.md"));
    await expect(readTrackedFiles(at.worktree, () => true)).rejects.toThrow("a.md");
  });

  test("its counters sum to the tracked files", async () => {
    const at = fleet("fixture/count", {
      "a.ts": "x\n",
      "b.md": "y\n",
      "c.bin": new Uint8Array([0, 1]),
    });
    const read = await readTrackedFiles(at.worktree, (path) => !path.endsWith(".md"));
    expect([read.tracked, read.outOfScope, read.binary, read.files.length]).toEqual([3, 1, 1, 1]);
  });

  test("a finding line escapes a line break in a path", () => {
    expect(findingLine("a\nb.ts", 4, "r")).toBe("a\\u000ab.ts:4:r");
  });

  // Review m1: the kit read `doc:12:x.md` as the path `doc` at line 12.
  test("a path holding a colon or a backslash survives the kit's parse", () => {
    for (const path of ["doc:12:x.md", "a\\u003ab.md", "c\nd.md"]) {
      expect(parseFinding(findingLine(path, 3, "r"))).toMatchObject({ path, line: 3 });
    }
  });
});
