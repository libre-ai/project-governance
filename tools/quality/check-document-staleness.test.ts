import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditDocuments,
  classifyDocument,
  compareArchiveParity,
  countLines,
  parseUsefulEditLog,
  readArchiveLayout,
  STALENESS_POLICY,
  type StalenessPolicy,
  validatePolicy,
} from "./check-document-staleness";
import type { GitRead } from "./git-diff";

// The thresholds below come from the brief, not from the code: "more than 500
// lines" and "no useful edit for more than 60 days", ADRs out of the policy.

const DAY = 86_400;
const NOW = Date.parse("2026-11-16T12:00:00Z") / 1000;
const POLICY: StalenessPolicy = {
  maxLines: 500,
  maxAgeDays: 60,
  documentPathspec: "*.md",
  excludedPrefixes: ["docs/adr/"],
  nonUsefulCommits: [],
  migrationIndexFileName: "migration-index.v1.yaml",
};

const scratch = mkdtempSync(join(tmpdir(), "document-staleness-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const gitEnvironment = {
  PATH: process.env.PATH ?? "",
  HOME: scratch,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

function git(dir: string, args: readonly string[], when?: number): string {
  const dated =
    when === undefined
      ? {}
      : { GIT_AUTHOR_DATE: `@${when} +0000`, GIT_COMMITTER_DATE: `@${when} +0000` };
  const result = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: { ...gitEnvironment, ...dated },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(result.stderr)}`);
  }
  return new TextDecoder().decode(result.stdout);
}

/**
 * The reader handed to auditDocuments: the purged environment above, never the
 * one this process inherited. Under a git hook, GIT_DIR is already set and
 * points at the hook's repository; `git -C <fixture>` would then read it, and
 * the test would measure the ambient run instead of its own case. Removing it
 * from `process.env` is not enough: measured on Bun 1.4.4, `Bun.spawnSync`
 * without `env` does not see a `delete process.env.X`.
 */
function fixtureGit(argv: readonly string[], what: string): GitRead {
  const result = Bun.spawnSync(["git", ...argv], {
    env: gitEnvironment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout);
  if (result.exitCode !== 0) {
    return {
      ok: false,
      reason: `could not ${what}: ${new TextDecoder().decode(result.stderr).trim()}`,
    };
  }
  return { ok: true, stdout };
}

let repositoryCount = 0;
function newRepository(): string {
  repositoryCount += 1;
  const dir = join(scratch, `repo-${repositoryCount}`);
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

function writeLines(dir: string, path: string, lines: number): void {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), "line\n".repeat(lines));
}

function commitAll(dir: string, message: string, when: number): string {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", message], when);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

describe("classifyDocument: both criteria must hold", () => {
  const at = (days: number) => NOW - days * DAY - 60;

  test("501 lines and 61 days without a useful edit: listed", () => {
    expect(
      classifyDocument({ path: "docs/x.md", lines: 501, lastUsefulEdit: at(61) }, POLICY, NOW),
    ).toBe("triggered");
  });

  test("500 lines and 61 days: not listed", () => {
    expect(
      classifyDocument({ path: "docs/x.md", lines: 500, lastUsefulEdit: at(61) }, POLICY, NOW),
    ).toBe("below");
  });

  test("501 lines and 59 days: not listed", () => {
    expect(
      classifyDocument({ path: "docs/x.md", lines: 501, lastUsefulEdit: at(59) }, POLICY, NOW),
    ).toBe("below");
  });

  test("501 lines and exactly 60 days: not listed (more than 60 is the rule)", () => {
    expect(
      classifyDocument({ path: "docs/x.md", lines: 501, lastUsefulEdit: at(60) }, POLICY, NOW),
    ).toBe("below");
  });

  test("a long and old ADR is not listed", () => {
    expect(
      classifyDocument(
        { path: "docs/adr/0001-old.md", lines: 5000, lastUsefulEdit: at(400) },
        POLICY,
        NOW,
      ),
    ).toBe("excluded");
  });

  test("a tracked document with no commit yet has no age: not listed, counted apart", () => {
    expect(
      classifyDocument({ path: "docs/x.md", lines: 900, lastUsefulEdit: null }, POLICY, NOW),
    ).toBe("uncommitted");
  });
});

describe("countLines", () => {
  test("counts a final line without a newline", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
  });
});

describe("parseUsefulEditLog", () => {
  const shaA = "a".repeat(40);
  const shaB = "b".repeat(40);
  const shaC = "c".repeat(40);
  const log = `\x01${shaA} 300\0\nx.md\0\x01${shaB} 200\0\nx.md\0y.md\0\x01${shaC} 100\0\ny.md\0`;

  test("keeps the newest commit per path", () => {
    const read = parseUsefulEditLog(log, new Set());
    expect(read.ok && Object.fromEntries(read.edits)).toEqual({ "x.md": 300, "y.md": 200 });
  });

  test("skips a commit declared not useful (formatting)", () => {
    const read = parseUsefulEditLog(log, new Set([shaA, shaB]));
    expect(read.ok && Object.fromEntries(read.edits)).toEqual({ "x.md": 200, "y.md": 100 });
  });

  test("a path touched only by non-useful commits keeps its oldest commit", () => {
    const read = parseUsefulEditLog(log, new Set([shaA, shaB, shaC]));
    expect(read.ok && Object.fromEntries(read.edits)).toEqual({ "x.md": 200, "y.md": 100 });
  });

  test("the newest useful date wins whatever the order of the log (a child dated before its parent)", () => {
    // git log walks the graph, not the dates: a commit can be listed before an
    // older-dated one and after a newer-dated one.
    const skewed = `\x01${shaA} 100\0\nx.md\0\x01${shaB} 300\0\nx.md\0\x01${shaC} 200\0\nx.md\0`;
    const read = parseUsefulEditLog(skewed, new Set());
    expect(read.ok && Object.fromEntries(read.edits)).toEqual({ "x.md": 300 });
    const onlyNonUseful = parseUsefulEditLog(skewed, new Set([shaA, shaB, shaC]));
    expect(onlyNonUseful.ok && Object.fromEntries(onlyNonUseful.edits)).toEqual({ "x.md": 100 });
  });

  test("an unexpected record is a failure, never an empty map", () => {
    expect(parseUsefulEditLog("\x01not-a-sha 1\0\nx.md\0", new Set()).ok).toBe(false);
  });
});

describe("validatePolicy", () => {
  test("the declared policy is valid", () => {
    expect(validatePolicy(STALENESS_POLICY)).toEqual([]);
  });

  test("the declared policy carries the thresholds of the brief and excludes ADRs", () => {
    expect(STALENESS_POLICY.maxLines).toBe(500);
    expect(STALENESS_POLICY.maxAgeDays).toBe(60);
    expect(STALENESS_POLICY.excludedPrefixes).toContain("docs/adr/");
  });

  test("a malformed policy is refused", () => {
    const problems = validatePolicy({
      ...POLICY,
      maxLines: 0,
      excludedPrefixes: ["../outside/"],
      nonUsefulCommits: [{ sha: "abc", because: "" }],
    });
    expect(problems).toEqual([
      "maxLines must be a positive integer, got 0",
      'excluded prefix "../outside/" must be a repository-relative directory ending with /',
      'non-useful commit "abc" is not a full commit id',
      'non-useful commit "abc" has no reason',
    ]);
  });
});

describe("auditDocuments on a real history", () => {
  test("lists the long and old document, not the short one, the recent one, nor the ADR", () => {
    const dir = newRepository();
    writeLines(dir, "docs/old-long.md", 501);
    writeLines(dir, "docs/old-short.md", 500);
    writeLines(dir, "docs/adr/0001-old-long.md", 2000);
    writeLines(dir, "docs/recent-long.md", 10);
    commitAll(dir, "old", NOW - 61 * DAY - 60);
    writeLines(dir, "docs/recent-long.md", 501);
    commitAll(dir, "recent", NOW - 59 * DAY);

    const audit = auditDocuments(dir, POLICY, NOW, fixtureGit);
    if (!audit.ok) throw new Error(audit.reason);
    expect(audit.triggered.map((entry) => entry.path)).toEqual(["docs/old-long.md"]);
    expect(audit.triggered[0]?.lines).toBe(501);
    expect(audit.triggered[0]?.ageDays).toBe(61);
    expect(audit.counts).toEqual({
      tracked: 4,
      excluded: 1,
      nonRegular: 0,
      triggered: 1,
      below: 2,
      uncommitted: 0,
    });
  });

  test("a formatting commit declared not useful does not reset the counter; any other commit does", () => {
    const dir = newRepository();
    writeLines(dir, "docs/old-long.md", 501);
    commitAll(dir, "old", NOW - 90 * DAY);
    writeFileSync(join(dir, "docs/old-long.md"), "line \n".repeat(501));
    const formatting = commitAll(dir, "reformat", NOW - 5 * DAY);

    const declared = auditDocuments(
      dir,
      { ...POLICY, nonUsefulCommits: [{ sha: formatting, because: "whitespace only" }] },
      NOW,
      fixtureGit,
    );
    if (!declared.ok) throw new Error(declared.reason);
    expect(declared.triggered.map((entry) => entry.path)).toEqual(["docs/old-long.md"]);

    const undeclared = auditDocuments(dir, POLICY, NOW, fixtureGit);
    if (!undeclared.ok) throw new Error(undeclared.reason);
    expect(undeclared.triggered).toEqual([]);
  });

  test("a tracked symlink is counted apart, never read through", () => {
    const dir = newRepository();
    writeLines(dir, "docs/a.md", 3);
    symlinkSync("a.md", join(dir, "docs/link.md"));
    commitAll(dir, "one", NOW - 100 * DAY);
    const audit = auditDocuments(dir, POLICY, NOW, fixtureGit);
    if (!audit.ok) throw new Error(audit.reason);
    expect(audit.counts.nonRegular).toBe(1);
    expect(audit.counts.tracked).toBe(2);
  });

  test("a shallow clone fails instead of returning an age", () => {
    const origin = newRepository();
    writeLines(origin, "docs/a.md", 501);
    commitAll(origin, "one", NOW - 100 * DAY);
    commitAll(origin, "two", NOW - 1 * DAY);
    const shallow = join(scratch, `shallow-${repositoryCount}`);
    git(scratch, ["clone", "-q", "--depth", "1", `file://${origin}`, shallow]);
    const audit = auditDocuments(shallow, POLICY, NOW, fixtureGit);
    expect(audit.ok).toBe(false);
    if (!audit.ok) expect(audit.reason).toContain("shallow");
  });

  test("a tracked document missing from the working tree is a failure, not a zero", () => {
    const dir = newRepository();
    writeLines(dir, "docs/a.md", 3);
    commitAll(dir, "one", NOW - 100 * DAY);
    rmSync(join(dir, "docs/a.md"));
    expect(auditDocuments(dir, POLICY, NOW, fixtureGit).ok).toBe(false);
  });

  test("a root below the top of the repository is refused, never a green over unmatched paths", () => {
    const dir = newRepository();
    writeLines(dir, "docs/old-long.md", 600);
    commitAll(dir, "old", NOW - 200 * DAY);
    const audit = auditDocuments(join(dir, "docs"), POLICY, NOW, fixtureGit);
    expect(audit.ok).toBe(false);
    if (!audit.ok) expect(audit.reason).toContain("not the top of its repository");
  });
});

describe("archive parity", () => {
  test("as many archive folders as migration indexes, each folder holding its own", () => {
    expect(
      compareArchiveParity(
        {
          quarters: ["2026-Q3", "2026-Q4"],
          folders: ["2026-Q3/2026-08-01-roadmap", "2026-Q4/2026-11-01-plan"],
          indexes: [
            "2026-Q3/2026-08-01-roadmap/migration-index.v1.yaml",
            "2026-Q4/2026-11-01-plan/migration-index.v1.yaml",
          ],
          loose: [],
          unexpected: [],
        },
        "migration-index.v1.yaml",
      ).problems,
    ).toEqual([]);
  });

  test("a folder without an index breaks parity", () => {
    const parity = compareArchiveParity(
      {
        quarters: ["2026-Q3", "2026-Q4"],
        folders: ["2026-Q3/2026-08-01-roadmap", "2026-Q4/2026-11-01-plan"],
        indexes: ["2026-Q3/2026-08-01-roadmap/migration-index.v1.yaml"],
        loose: [],
        unexpected: [],
      },
      "migration-index.v1.yaml",
    );
    expect(parity.problems).toEqual(["2026-Q4/2026-11-01-plan: archive without migration index"]);
  });

  test("an index outside any archive folder breaks parity", () => {
    const parity = compareArchiveParity(
      {
        quarters: ["2026-Q3"],
        folders: ["2026-Q3/2026-08-01-roadmap"],
        indexes: [
          "2026-Q3/2026-08-01-roadmap/migration-index.v1.yaml",
          "2026-Q3/migration-index.v1.yaml",
        ],
        loose: [],
        unexpected: [],
      },
      "migration-index.v1.yaml",
    );
    expect(parity.problems).toEqual([
      "2026-Q3/migration-index.v1.yaml: migration index outside an archive folder",
    ]);
  });

  test("a file laid directly in a quarter is an archive without a folder nor an index", () => {
    const parity = compareArchiveParity(
      {
        quarters: ["2026-Q3"],
        folders: [],
        indexes: [],
        loose: ["2026-Q3/2026-08-01-ROADMAP.md"],
        unexpected: [],
      },
      "migration-index.v1.yaml",
    );
    expect(parity.problems).toEqual([
      "2026-Q3/2026-08-01-ROADMAP.md: archived file outside an archive folder",
    ]);
  });

  test("readArchiveLayout counts a file laid directly in a quarter", () => {
    const root = join(scratch, "archives-loose");
    mkdirSync(join(root, "2026-Q3"), { recursive: true });
    writeFileSync(join(root, "2026-Q3/2026-08-01-ROADMAP.md"), "old\n");
    const layout = readArchiveLayout(root, "migration-index.v1.yaml");
    if (!layout.ok) throw new Error(layout.reason);
    expect(layout.layout.quarters).toEqual(["2026-Q3"]);
    expect(layout.layout.folders).toEqual([]);
    expect(layout.layout.loose).toEqual(["2026-Q3/2026-08-01-ROADMAP.md"]);
  });

  test("readArchiveLayout reads quarters, folders and indexes from disk", () => {
    const root = join(scratch, "archives-ok");
    mkdirSync(join(root, "2026-Q3/2026-08-01-roadmap"), { recursive: true });
    writeFileSync(join(root, "2026-Q3/2026-08-01-roadmap/migration-index.v1.yaml"), "x: 1\n");
    writeFileSync(join(root, "2026-Q3/2026-08-01-roadmap/ROADMAP.md"), "old\n");
    mkdirSync(join(root, "2026-Q4/2026-11-01-plan"), { recursive: true });
    const layout = readArchiveLayout(root, "migration-index.v1.yaml");
    if (!layout.ok) throw new Error(layout.reason);
    expect(layout.layout.folders).toEqual([
      "2026-Q3/2026-08-01-roadmap",
      "2026-Q4/2026-11-01-plan",
    ]);
    expect(layout.layout.indexes).toEqual(["2026-Q3/2026-08-01-roadmap/migration-index.v1.yaml"]);
    expect(compareArchiveParity(layout.layout, "migration-index.v1.yaml").problems).toEqual([
      "2026-Q4/2026-11-01-plan: archive without migration index",
    ]);
  });

  test("an entry that is not a quarter, and an unreadable root, are named", () => {
    const root = join(scratch, "archives-odd");
    mkdirSync(join(root, "misc"), { recursive: true });
    const layout = readArchiveLayout(root, "migration-index.v1.yaml");
    if (!layout.ok) throw new Error(layout.reason);
    expect(layout.layout.unexpected).toEqual(["misc"]);
    expect(compareArchiveParity(layout.layout, "migration-index.v1.yaml").problems).toEqual([
      "misc: not a quarter directory (YYYY-Qn)",
    ]);
    expect(readArchiveLayout(join(scratch, "absent"), "migration-index.v1.yaml").ok).toBe(false);
  });
});

describe("command", () => {
  const cli = join(import.meta.dir, "check-document-staleness.ts");
  function run(cwd: string, args: readonly string[] = []) {
    const result = Bun.spawnSync(["bun", cli, ...args], {
      cwd,
      env: gitEnvironment,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: result.exitCode,
      out: new TextDecoder().decode(result.stdout),
      err: new TextDecoder().decode(result.stderr),
    };
  }

  test("fails and names a long and old document with its lines and age", () => {
    const dir = newRepository();
    writeLines(dir, "docs/old-long.md", 600);
    commitAll(dir, "old", Math.floor(Date.now() / 1000) - 200 * DAY);
    const result = run(dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain("docs/old-long.md");
    expect(result.err).toContain("600 lines");
  });

  test("passes with its counters when nothing is due", () => {
    const dir = newRepository();
    writeLines(dir, "docs/short.md", 10);
    commitAll(dir, "one", Math.floor(Date.now() / 1000) - 200 * DAY);
    const result = run(dir);
    expect(result.code).toBe(0);
    expect(result.out).toContain("tracked=1");
  });

  test("a repository without any tracked document fails instead of passing over nothing", () => {
    const dir = newRepository();
    writeFileSync(join(dir, "notes.txt"), "x\n");
    commitAll(dir, "one", Math.floor(Date.now() / 1000) - 1 * DAY);
    const result = run(dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain("no tracked document matches");
  });

  test("a document whose extension is upper case is examined like any other", () => {
    const dir = newRepository();
    writeLines(dir, "docs/BIG.MD", 600);
    commitAll(dir, "old", Math.floor(Date.now() / 1000) - 200 * DAY);
    const result = run(dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain("docs/BIG.MD");
  });

  function archiveTree(name: string): string {
    const root = join(scratch, name);
    mkdirSync(join(root, "2026-Q3/2026-08-01-roadmap"), { recursive: true });
    writeFileSync(join(root, "2026-Q3/2026-08-01-roadmap/ROADMAP.md"), "old\n");
    return root;
  }

  function freshRepository(): string {
    const dir = newRepository();
    writeLines(dir, "docs/short.md", 10);
    commitAll(dir, "one", Math.floor(Date.now() / 1000) - 1 * DAY);
    return dir;
  }

  test("--archives: an archive folder without its migration index fails the command", () => {
    const root = archiveTree("cli-archives-no-index");
    const result = run(freshRepository(), ["--archives", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("2026-Q3/2026-08-01-roadmap: archive without migration index");
  });

  test("--archives: a file laid directly in a quarter fails the command", () => {
    const root = join(scratch, "cli-archives-loose");
    mkdirSync(join(root, "2026-Q3"), { recursive: true });
    writeFileSync(join(root, "2026-Q3/2026-08-01-ROADMAP.md"), "old\n");
    const result = run(freshRepository(), ["--archives", root]);
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      "2026-Q3/2026-08-01-ROADMAP.md: archived file outside an archive folder",
    );
  });

  test("--archives: parity passes and prints the archive counters on the success line", () => {
    const root = archiveTree("cli-archives-parity");
    writeFileSync(join(root, "2026-Q3/2026-08-01-roadmap/migration-index.v1.yaml"), "x: 1\n");
    const result = run(freshRepository(), ["--archives", root]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("archives: quarters=1 folders=1 indexes=1 loose=0 unexpected=0");
  });

  test("--archives: an empty archive tree passes and says so on the success line", () => {
    const root = join(scratch, "cli-archives-empty");
    mkdirSync(root, { recursive: true });
    const result = run(freshRepository(), ["--archives", root]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("archives: quarters=0 folders=0 indexes=0 loose=0 unexpected=0");
  });

  test("an unknown argument is refused", () => {
    const dir = newRepository();
    expect(run(dir, ["--bogus"]).code).toBe(2);
  });
});
