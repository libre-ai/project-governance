import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CommitDeclarations, Fact, IssueRead, LinkPorts } from "./check-work-package-link";
import {
  decodeGitOutput,
  type GitInvocation,
  type GitResult,
  type RealPortsOptions,
  type RunGit,
  realPorts,
  SHALLOW_CUT_REASON,
  spawnGit,
} from "./work-package-ports";

// ---------------------------------------------------------------------------
// Real git repositories, built in temporary directories. Every git call of the
// fixtures runs in an environment of its own: the developer's global config
// (signing, hooks, default branch) must not change what the tests build.
// ---------------------------------------------------------------------------

const scratchDirectories: string[] = [];

function scratch(prefix: string): string {
  const directory: string = mkdtempSync(join(tmpdir(), prefix));
  scratchDirectories.push(directory);
  return directory;
}

afterAll((): void => {
  for (const directory of scratchDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const FIXTURE_HOME: string = scratch("wp-ports-home-");

const FIXTURE_ENV: Record<string, string> = {
  PATH: process.env.PATH ?? "",
  HOME: FIXTURE_HOME,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: FIXTURE_ENV,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function initRepository(path: string, branch: string): string {
  mkdirSync(path, { recursive: true });
  git(path, "init", "--quiet", "-b", branch);
  return path;
}

function writeAt(root: string, path: string, content: string): void {
  const full: string = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commitAll(cwd: string, message: string): string {
  git(cwd, "add", "--all");
  git(cwd, "commit", "--quiet", "--allow-empty", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

/** A RunGit that records every invocation, then runs the real git. */
function recordingRun(): { readonly run: RunGit; readonly calls: GitInvocation[] } {
  const calls: GitInvocation[] = [];
  const run: RunGit = async (invocation: GitInvocation): Promise<GitResult> => {
    calls.push(invocation);
    return spawnGit(invocation);
  };
  return { run, calls };
}

const NO_FETCH: typeof fetch = (async (): Promise<Response> => {
  throw new Error("no network in the git tests");
}) as unknown as typeof fetch;

function portsFor(workspace: string, extra: Partial<RealPortsOptions> = {}): LinkPorts {
  return realPorts({
    token: null,
    workspace,
    serverUrl: "file:///nonexistent-server",
    fetch: NO_FETCH,
    env: { PATH: process.env.PATH ?? "" },
    ...extra,
  });
}

const ZERO_SHA = "0000000000000000000000000000000000000001";

function expectFailure<T>(fact: Fact<T>): string {
  expect(fact.ok).toBe(false);
  return fact.ok ? "" : fact.reason;
}

function valueFrom<T>(fact: Fact<T>): T {
  if (!fact.ok) {
    throw new Error(`expected a value, got the failure: ${fact.reason}`);
  }
  return fact.value;
}

// ---------------------------------------------------------------------------
// commitTrailers
// ---------------------------------------------------------------------------

describe("commitTrailers", () => {
  const repo: string = initRepository(join(scratch("wp-trailers-"), "work"), "main");
  const base: string = commitAll(repo, "base");
  const declared: string = commitAll(
    repo,
    [
      "feat: declared",
      "",
      "Work-package: libre-ai/body#1 WP-9 is written in the free body",
      "",
      "Work-package:   libre-ai/gov#12 WP-3",
      "Signed-off-by: Fixture <fixture@example.invalid>",
    ].join("\n"),
  );
  const plain: string = commitAll(repo, "chore: no trailer at all");
  const lower: string = commitAll(
    repo,
    ["fix: lower-case key", "", "work-package: libre-ai/gov#12 WP-3"].join("\n"),
  );
  const spaced: string = commitAll(
    repo,
    ["fix: key with a space", "", "Work package: libre-ai/gov#12 WP-3"].join("\n"),
  );

  test("one entry per commit of base..head, oldest first, with the trailers git parsed", async () => {
    const commits: readonly CommitDeclarations[] = valueFrom(
      await portsFor(repo).commitTrailers(base, spaced),
    );
    expect(commits.map((commit) => commit.sha)).toEqual([declared, plain, lower, spaced]);
    expect(commits[0]?.trailers).toEqual([
      { key: "Work-package", value: "libre-ai/gov#12 WP-3" },
      { key: "Signed-off-by", value: "Fixture <fixture@example.invalid>" },
    ]);
  });

  test("a Work-package line of the free body, outside the trailer block, is not a trailer", async () => {
    const commits = valueFrom(await portsFor(repo).commitTrailers(base, declared));
    const values: string[] = commits.flatMap((commit) => commit.trailers.map((t) => t.value));
    expect(values.some((value) => value.includes("libre-ai/body#1"))).toBe(false);
  });

  test("a commit without trailer has an empty list; a key keeps its case", async () => {
    const commits = valueFrom(await portsFor(repo).commitTrailers(declared, lower));
    expect(commits).toEqual([
      { sha: plain, trailers: [] },
      { sha: lower, trailers: [{ key: "work-package", value: "libre-ai/gov#12 WP-3" }] },
    ]);
  });

  test("a key holding a space is not a trailer for git, so none is returned", async () => {
    const commits = valueFrom(await portsFor(repo).commitTrailers(lower, spaced));
    expect(commits).toEqual([{ sha: spaced, trailers: [] }]);
  });

  test("base equal to head is a readable, empty range: ok with no commit (the gate refuses it)", async () => {
    const commits = valueFrom(await portsFor(repo).commitTrailers(plain, plain));
    expect(commits).toEqual([]);
  });

  test("an unknown base is a named failure, never an empty list", async () => {
    const reason: string = expectFailure(await portsFor(repo).commitTrailers(ZERO_SHA, plain));
    expect(reason).toContain(ZERO_SHA);
  });

  test.each([
    ["short", "abc1234"],
    ["upper case", "ABCDEF0123456789ABCDEF0123456789ABCDEF01"],
    ["symbolic", "HEAD"],
    ["option-like", "--output=/tmp/x"],
  ])("a %s revision is refused before git is called", async (_label: string, revision: string) => {
    const recorder = recordingRun();
    const ports: LinkPorts = portsFor(repo, { run: recorder.run });
    expectFailure(await ports.commitTrailers(revision, plain));
    expectFailure(await ports.commitTrailers(base, revision));
    expect(recorder.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// changedFiles
// ---------------------------------------------------------------------------

describe("changedFiles", () => {
  const repo: string = initRepository(join(scratch("wp-diff-"), "work"), "main");
  // Enough identical content for git's rename detection to pair the two paths.
  const body: string = Array.from({ length: 40 }, (_, line) => `export const v${line} = ${line};`)
    .join("\n")
    .concat("\n");
  writeAt(repo, "src/a.ts", body);
  const base: string = commitAll(repo, "base");
  mkdirSync(join(repo, "docs"));
  git(repo, "mv", "src/a.ts", "docs/a.md");
  const renamed: string = commitAll(repo, "move a source into the documentation");
  const awkward = 'notes/a b"é\nc.md';
  writeAt(repo, awkward, "awkward\n");
  const awkwardHead: string = commitAll(repo, "an awkward path");

  test("a rename lists BOTH sides: the source path and the destination path", async () => {
    const files: readonly string[] = valueFrom(await portsFor(repo).changedFiles(base, renamed));
    expect([...files].sort()).toEqual(["docs/a.md", "src/a.ts"]);
  });

  test("a path with a space, a quote, an accent and a line feed is returned raw, never quoted", async () => {
    const files: readonly string[] = valueFrom(
      await portsFor(repo).changedFiles(renamed, awkwardHead),
    );
    expect(files).toEqual([awkward]);
  });

  test("an empty diff is an empty list", async () => {
    expect(valueFrom(await portsFor(repo).changedFiles(renamed, renamed))).toEqual([]);
  });

  test("an unknown head is a named failure", async () => {
    expectFailure(await portsFor(repo).changedFiles(base, ZERO_SHA));
  });

  test("an output whose last path has no NUL terminator is a truncated read", async () => {
    const truncated: RunGit = async (invocation: GitInvocation): Promise<GitResult> =>
      invocation.args.includes("diff")
        ? { exitCode: 0, stdout: new TextEncoder().encode("docs/a.md\u0000src/a"), stderr: "" }
        : spawnGit(invocation);
    const reason: string = expectFailure(
      await portsFor(repo, { run: truncated }).changedFiles(base, renamed),
    );
    expect(reason).toContain("truncated");
  });

  test("a revision that is not 40 lowercase hex is refused before git is called", async () => {
    const recorder = recordingRun();
    expectFailure(await portsFor(repo, { run: recorder.run }).changedFiles(base, "HEAD"));
    expect(recorder.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readFileAt and isAncestorOfServedHead, against a local "server": the URL of
// a repository is <serverUrl>/<owner>/<name>.git, as on GitHub.
// ---------------------------------------------------------------------------

const SERVER_ROOT: string = scratch("wp-server-");
const SERVER_URL = `file://${SERVER_ROOT}`;
const REMOTE: string = initRepository(join(SERVER_ROOT, "libre-ai", "product.git"), "trunk");
writeAt(REMOTE, "docs/prd.md", "# PRD at the first commit\n");
const FIRST: string = commitAll(REMOTE, "first");
writeAt(REMOTE, "docs/cahier-des-charges.md", "# Criteria\n");
const SECOND: string = commitAll(REMOTE, "second");
git(REMOTE, "switch", "--quiet", "-c", "unmerged");
writeAt(REMOTE, "docs/prd.md", "# PRD on an unmerged branch\n");
const UNMERGED: string = commitAll(REMOTE, "unmerged");
git(REMOTE, "switch", "--quiet", "trunk");

const remotePorts = (extra: Partial<RealPortsOptions> = {}): LinkPorts =>
  realPorts({
    token: null,
    workspace: scratch("wp-empty-workspace-"),
    serverUrl: SERVER_URL,
    fetch: NO_FETCH,
    env: { PATH: process.env.PATH ?? "" },
    ...extra,
  });

describe("readFileAt", () => {
  test("reads the file at the cited commit from the remote repository", async () => {
    expect(
      valueFrom(await remotePorts().readFileAt("libre-ai/product", FIRST, "docs/prd.md")),
    ).toBe("# PRD at the first commit\n");
    expect(
      valueFrom(
        await remotePorts().readFileAt("libre-ai/product", SECOND, "docs/cahier-des-charges.md"),
      ),
    ).toBe("# Criteria\n");
  });

  test("a file absent at the cited commit is a named failure", async () => {
    const reason: string = expectFailure(
      await remotePorts().readFileAt("libre-ai/product", FIRST, "docs/cahier-des-charges.md"),
    );
    expect(reason).toContain("docs/cahier-des-charges.md");
  });

  test("a commit the server does not hold is a named failure", async () => {
    expectFailure(await remotePorts().readFileAt("libre-ai/product", ZERO_SHA, "docs/prd.md"));
  });

  test("the repository of the pull request is read from the checkout when it holds the commit", async () => {
    const workspace: string = initRepository(join(scratch("wp-local-"), "work"), "main");
    writeAt(workspace, "docs/prd.md", "# Local PRD\n");
    const local: string = commitAll(workspace, "local");
    const recorder = recordingRun();
    const ports: LinkPorts = realPorts({
      token: null,
      workspace,
      prRepo: "Libre-AI/Work",
      serverUrl: "file:///nonexistent-server",
      fetch: NO_FETCH,
      run: recorder.run,
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(valueFrom(await ports.readFileAt("libre-ai/work", local, "docs/prd.md"))).toBe(
      "# Local PRD\n",
    );
    expect(recorder.calls.some((call) => call.args.includes("fetch"))).toBe(false);
  });

  test.each([
    ["a path outside the two documents", "libre-ai/product", "README.md"],
    ["a traversal", "libre-ai/product", "docs/../docs/prd.md"],
    ["a repository without owner", "product", "docs/prd.md"],
    ["a dot-dot repository name", "libre-ai/..", "docs/prd.md"],
    ["an option-like repository", "-x/product", "docs/prd.md"],
  ])("%s is refused before git is called", async (_label: string, repo: string, path: string) => {
    const recorder = recordingRun();
    expectFailure(await remotePorts({ run: recorder.run }).readFileAt(repo, FIRST, path));
    expect(recorder.calls).toEqual([]);
  });

  test("a short commit is refused before git is called", async () => {
    const recorder = recordingRun();
    expectFailure(
      await remotePorts({ run: recorder.run }).readFileAt(
        "libre-ai/product",
        FIRST.slice(0, 12),
        "docs/prd.md",
      ),
    );
    expect(recorder.calls).toEqual([]);
  });
});

describe("isAncestorOfServedHead", () => {
  test("a commit of the served branch (named trunk, resolved from the remote) is an ancestor", async () => {
    expect(valueFrom(await remotePorts().isAncestorOfServedHead("libre-ai/product", FIRST))).toBe(
      true,
    );
    expect(valueFrom(await remotePorts().isAncestorOfServedHead("libre-ai/product", SECOND))).toBe(
      true,
    );
  });

  test("a commit of an unmerged branch is not an ancestor", async () => {
    expect(
      valueFrom(await remotePorts().isAncestorOfServedHead("libre-ai/product", UNMERGED)),
    ).toBe(false);
  });

  test("a commit the server does not hold is a named failure", async () => {
    expectFailure(await remotePorts().isAncestorOfServedHead("libre-ai/product", ZERO_SHA));
  });

  test("an unknown repository is a named failure", async () => {
    expectFailure(await remotePorts().isAncestorOfServedHead("libre-ai/missing", FIRST));
  });

  test("the served branch is resolved, never written down: no git argument names it before ls-remote", async () => {
    const recorder = recordingRun();
    await remotePorts({ run: recorder.run }).isAncestorOfServedHead("libre-ai/product", FIRST);
    const first: GitInvocation | undefined = recorder.calls[0];
    expect(first?.args[0]).toBe("ls-remote");
    expect(first?.args.some((arg) => arg.includes("trunk") || arg.includes("main"))).toBe(false);
  });

  test("a short commit is refused before git is called", async () => {
    const recorder = recordingRun();
    expectFailure(
      await remotePorts({ run: recorder.run }).isAncestorOfServedHead("libre-ai/product", "HEAD"),
    );
    expect(recorder.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The token and the environment of git
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// A shallow checkout (C1): the range must never be read short.
// ---------------------------------------------------------------------------

describe("commitTrailers in a shallow checkout", () => {
  const root: string = scratch("wp-shallow-");
  const origin: string = initRepository(join(root, "origin"), "main");
  for (const index of [0, 1, 2, 3]) {
    commitAll(origin, `m${index}`);
  }
  const base: string = git(origin, "rev-parse", "HEAD");
  git(origin, "switch", "--quiet", "-c", "feature");
  commitAll(origin, ["c1", "", "Work-package: libre-ai/gov#1 WP-1"].join("\n"));
  commitAll(origin, "c2");
  const head: string = commitAll(
    origin,
    ["c3", "", "Work-package: libre-ai/gov#1 WP-2"].join("\n"),
  );
  git(origin, "switch", "--quiet", "main");
  git(origin, "merge", "--quiet", "--no-ff", "-m", "merge", "feature");
  git(origin, "branch", "merged");

  const clone = (name: string, ...extra: string[]): string => {
    git(root, "clone", "--quiet", ...extra, `file://${origin}`, name);
    return join(root, name);
  };
  const values = (commits: readonly CommitDeclarations[]): string[] =>
    commits.flatMap((commit) => commit.trailers.map((trailer) => trailer.value));

  test("a full clone reads the three commits of the range", async () => {
    const commits = valueFrom(await portsFor(clone("full")).commitTrailers(base, head));
    expect(commits.length).toBe(3);
    expect(values(commits)).toEqual(["libre-ai/gov#1 WP-1", "libre-ai/gov#1 WP-2"]);
  });

  test("a clone of depth 1 of head cuts the range: refused, never read short", async () => {
    const workspace: string = clone("cut", "--depth=1", "--branch", "feature");
    const reason: string = expectFailure(await portsFor(workspace).commitTrailers(base, head));
    expect(reason).toContain(SHALLOW_CUT_REASON);
    expect(reason).toContain(head);
  });

  test("a shallow boundary below base only cuts nothing of the range", async () => {
    const workspace: string = clone("below", "--depth=5", "--branch", "feature");
    expect(git(workspace, "rev-parse", "--is-shallow-repository")).toBe("true");
    const commits = valueFrom(await portsFor(workspace).commitTrailers(base, head));
    expect(commits.length).toBe(3);
  });

  test("a clone of depth 1 of the merge commit reads the whole range once both ends are fetched", async () => {
    const workspace: string = clone("merge", "--depth=1", "--branch", "merged");
    const commits = valueFrom(await portsFor(workspace).commitTrailers(base, head));
    expect(commits.length).toBe(3);
    expect(values(commits)).toEqual(["libre-ai/gov#1 WP-1", "libre-ai/gov#1 WP-2"]);
  });
});

// ---------------------------------------------------------------------------
// The bytes git prints are kept (C2), failures are failures (I2, b), and the
// workspace is the repository root (c).
// ---------------------------------------------------------------------------

const BOM: string = String.fromCodePoint(0xfeff);

describe("the bytes git prints are kept", () => {
  test("the decoder keeps a leading byte order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x64, 0x6f, 0x63, 0x73]);
    expect(decodeGitOutput(bytes)).toBe(`${BOM}docs`);
  });

  test("a changed path that starts with a byte order mark comes back with it", async () => {
    const repo: string = initRepository(join(scratch("wp-bom-path-"), "work"), "main");
    const base: string = commitAll(repo, "base");
    const name = `${BOM}notes.md`;
    try {
      writeAt(repo, name, "x\n");
    } catch (error) {
      console.log(`skipped: the filesystem refuses a name starting with U+FEFF (${String(error)})`);
      return;
    }
    const head: string = commitAll(repo, "a path with a byte order mark");
    expect(valueFrom(await portsFor(repo).changedFiles(base, head))).toEqual([name]);
  });

  test("a blob that starts with a byte order mark comes back with it", async () => {
    const repo: string = initRepository(join(scratch("wp-bom-blob-"), "work"), "main");
    writeAt(repo, "docs/prd.md", `${BOM}# PRD\n`);
    const sha: string = commitAll(repo, "prd");
    const ports: LinkPorts = portsFor(repo, { prRepo: "libre-ai/work" });
    expect(valueFrom(await ports.readFileAt("libre-ai/work", sha, "docs/prd.md"))).toBe(
      `${BOM}# PRD\n`,
    );
  });

  test("a trailer value that starts with a byte order mark keeps it", async () => {
    const repo: string = initRepository(join(scratch("wp-bom-trailer-"), "work"), "main");
    const base: string = commitAll(repo, "base");
    const head: string = commitAll(
      repo,
      ["s", "", `Work-package: ${BOM}libre-ai/gov#1 WP-1`].join("\n"),
    );
    const commits = valueFrom(await portsFor(repo).commitTrailers(base, head));
    expect(commits[0]?.trailers).toEqual([
      { key: "Work-package", value: `${BOM}libre-ai/gov#1 WP-1` },
    ]);
  });
});

describe("a failure is never read as a value", () => {
  const repo: string = initRepository(join(scratch("wp-fail-"), "work"), "main");
  writeAt(repo, "shared.txt", "root\n");
  const rootCommit: string = commitAll(repo, "root");
  git(repo, "switch", "--quiet", "-c", "pr");
  writeAt(repo, "pr.txt", "pr\n");
  const head: string = commitAll(repo, "the pull request changes pr.txt");
  git(repo, "switch", "--quiet", "main");
  writeAt(repo, "main-only.txt", "main\n");
  const base: string = commitAll(repo, "the base branch moves on");

  const failingOn =
    (command: string, answer: GitResult): RunGit =>
    async (invocation: GitInvocation): Promise<GitResult> =>
      invocation.args[0] === command ? answer : spawnGit(invocation);

  test("a diff git fails to compute is a failure, never an empty list", async () => {
    const run: RunGit = failingOn("diff", {
      exitCode: 128,
      stdout: new Uint8Array(),
      stderr: "boom",
    });
    expectFailure(await portsFor(repo, { run }).changedFiles(rootCommit, head));
  });

  test("the diff is taken from the merge base: a file only the base branch changed is not listed", async () => {
    expect(valueFrom(await portsFor(repo).changedFiles(base, head))).toEqual(["pr.txt"]);
  });

  test("undecodable log output is a named failure, never an empty range", async () => {
    const run: RunGit = failingOn("log", {
      exitCode: 0,
      stdout: new Uint8Array([0xff, 0xfe]),
      stderr: "",
    });
    const reason: string = expectFailure(
      await portsFor(repo, { run }).commitTrailers(rootCommit, head),
    );
    expect(reason).toContain("not valid UTF-8");
  });

  test("undecodable ls-remote output is a named failure", async () => {
    const run: RunGit = failingOn("ls-remote", {
      exitCode: 0,
      stdout: new Uint8Array([0xff, 0xfe]),
      stderr: "",
    });
    const reason: string = expectFailure(
      await remotePorts({ run }).isAncestorOfServedHead("libre-ai/product", FIRST),
    );
    expect(reason).toContain("not valid UTF-8");
  });
});

describe("temporary directories are removed", () => {
  test("after remote reads that succeed and that fail, no directory git ran in is left", async () => {
    const recorder = recordingRun();
    const ports: LinkPorts = remotePorts({ run: recorder.run });
    valueFrom(await ports.readFileAt("libre-ai/product", FIRST, "docs/prd.md"));
    expectFailure(await ports.readFileAt("libre-ai/product", ZERO_SHA, "docs/prd.md"));
    valueFrom(await ports.isAncestorOfServedHead("libre-ai/product", FIRST));
    expectFailure(await ports.isAncestorOfServedHead("libre-ai/product", ZERO_SHA));
    const bares: string[] = recorder.calls
      .filter((call) => call.args[0] === "init")
      .map((call) => call.args[call.args.length - 1] as string);
    expect(bares.length).toBe(4);
    const homes: string[] = [...new Set(recorder.calls.map((call) => call.env.HOME as string))];
    expect(homes.length).toBe(4);
    for (const directory of [...bares, ...homes]) {
      expect(existsSync(directory)).toBe(false);
    }
  });
});

describe("the workspace is the root of its repository", () => {
  const repo: string = initRepository(join(scratch("wp-root-"), "work"), "main");
  const base: string = commitAll(repo, "base");
  const head: string = commitAll(repo, "head");
  const subdirectory: string = join(repo, "sub");
  mkdirSync(subdirectory);

  test("a subdirectory of a repository is not read as that repository", async () => {
    expectFailure(await portsFor(subdirectory).commitTrailers(base, head));
    expectFailure(await portsFor(subdirectory).changedFiles(base, head));
  });

  test("a relative workspace is refused", async () => {
    const reason: string = expectFailure(await portsFor("work").commitTrailers(base, head));
    expect(reason).toContain("absolute");
  });

  test("the root itself is read", async () => {
    expect(valueFrom(await portsFor(repo).commitTrailers(base, head)).length).toBe(1);
  });
});

describe("one walk of the range", () => {
  test("300 commits are read with ONE git log call", async () => {
    const repo: string = initRepository(join(scratch("wp-many-"), "work"), "main");
    const stream: string[] = [];
    for (let mark = 1; mark <= 300; mark += 1) {
      const message = `c${mark}\n\nWork-package: libre-ai/gov#1 WP-1\n`;
      stream.push(
        "commit refs/heads/main",
        `mark :${mark}`,
        "committer Fixture <fixture@example.invalid> 1700000000 +0000",
        `data ${Buffer.byteLength(message)}`,
        message,
      );
      if (mark > 1) {
        stream.push(`from :${mark - 1}`);
      }
      stream.push("");
    }
    const imported = Bun.spawnSync(["git", "fast-import", "--quiet"], {
      cwd: repo,
      env: FIXTURE_ENV,
      stdin: Buffer.from(stream.join("\n")),
    });
    expect(imported.exitCode).toBe(0);
    const base: string = git(repo, "rev-parse", "main~299");
    const head: string = git(repo, "rev-parse", "main");
    const recorder = recordingRun();
    const commits = valueFrom(
      await portsFor(repo, { run: recorder.run }).commitTrailers(base, head),
    );
    expect(commits.length).toBe(299);
    expect(recorder.calls.filter((call) => call.args[0] === "log").length).toBe(1);
  });
});

describe("the token never reaches argv or a message", () => {
  // Not shaped like a real credential, so the secret scan has nothing to flag.
  const TOKEN = "fake-token-for-the-port-tests-1";
  const HEADER: string = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");

  test("remote reads carry the token in the environment of git only", async () => {
    const recorder = recordingRun();
    const ports: LinkPorts = remotePorts({ token: TOKEN, run: recorder.run });
    const reasons: string[] = [];
    const facts: Fact<unknown>[] = [
      await ports.readFileAt("libre-ai/product", FIRST, "docs/prd.md"),
      await ports.readFileAt("libre-ai/product", FIRST, "docs/cahier-des-charges.md"),
      await ports.readFileAt("libre-ai/missing", FIRST, "docs/prd.md"),
      await ports.isAncestorOfServedHead("libre-ai/product", UNMERGED),
      await ports.isAncestorOfServedHead("libre-ai/missing", FIRST),
    ];
    for (const fact of facts) {
      if (!fact.ok) reasons.push(fact.reason);
    }
    // The absent file and the two reads of a missing repository fail; the
    // successful reads prove the credential in the environment does not break git.
    expect(reasons.length).toBe(3);
    expect(facts[0]).toEqual({ ok: true, value: "# PRD at the first commit\n" });
    expect(facts[3]).toEqual({ ok: true, value: false });
    expect(recorder.calls.length).toBeGreaterThan(0);
    for (const call of recorder.calls) {
      for (const arg of call.args) {
        expect(arg).not.toContain(TOKEN);
        expect(arg).not.toContain(HEADER);
      }
    }
    for (const reason of reasons) {
      expect(reason).not.toContain(TOKEN);
      expect(reason).not.toContain(HEADER);
    }
    const fetches: GitInvocation[] = recorder.calls.filter(
      (call) => call.args[0] === "fetch" || call.args[0] === "ls-remote",
    );
    expect(fetches.length).toBeGreaterThan(0);
    for (const call of fetches) {
      expect(call.env.GIT_CONFIG_COUNT).toBe("1");
      expect(call.env.GIT_CONFIG_KEY_0).toBe(`http.${SERVER_URL}/.extraheader`);
      expect(call.env.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${HEADER}`);
    }
  });

  test("git runs in a minimal environment: nothing is inherited but PATH", async () => {
    const recorder = recordingRun();
    await realPorts({
      token: null,
      workspace: scratch("wp-env-"),
      serverUrl: SERVER_URL,
      fetch: NO_FETCH,
      run: recorder.run,
      env: { PATH: process.env.PATH ?? "", HOME: "/home/inherited", SECRET_OF_THE_RUNNER: "x" },
    }).isAncestorOfServedHead("libre-ai/product", FIRST);
    expect(recorder.calls.length).toBeGreaterThan(0);
    for (const call of recorder.calls) {
      expect(Object.keys(call.env).sort()).toEqual([
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_NOSYSTEM",
        "GIT_TERMINAL_PROMPT",
        "HOME",
        "PATH",
      ]);
      expect(call.env.HOME).not.toBe("/home/inherited");
      expect(call.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
      expect(call.env.GIT_CONFIG_NOSYSTEM).toBe("1");
      expect(call.env.GIT_TERMINAL_PROMPT).toBe("0");
    }
  });
});

// ---------------------------------------------------------------------------
// readIssue, through a fake fetch: no network.
// ---------------------------------------------------------------------------

const OWNER = "constantin-jais";
const OTHER = "someone-else";
const TOKEN_FOR_ISSUES = "fake-token-for-the-issue-tests-2";

interface TimelineEvent {
  readonly kind: "LabeledEvent" | "UnlabeledEvent";
  readonly label: string;
  readonly actor: string | null;
  readonly at: string;
  /** The GraphQL type of the actor; `null` leaves `__typename` out. Default: `User`. */
  readonly actorType?: string | null;
}

interface IssueShape {
  readonly body?: string;
  readonly lastEditedAt?: string | null;
  readonly labels?: readonly string[];
  readonly labelsHasNextPage?: boolean;
  readonly events?: readonly TimelineEvent[];
  readonly timelineHasNextPage?: boolean;
}

function graphqlIssue(shape: IssueShape): unknown {
  return {
    data: {
      repository: {
        issue: {
          body: shape.body ?? "the body",
          lastEditedAt: shape.lastEditedAt ?? null,
          labels: {
            nodes: (shape.labels ?? []).map((name) => ({ name })),
            pageInfo: { hasNextPage: shape.labelsHasNextPage ?? false },
          },
          timelineItems: {
            nodes: (shape.events ?? []).map((event) => ({
              __typename: event.kind,
              createdAt: event.at,
              label: { name: event.label },
              actor:
                event.actor === null
                  ? null
                  : event.actorType === null
                    ? { login: event.actor }
                    : { __typename: event.actorType ?? "User", login: event.actor },
            })),
            pageInfo: { hasNextPage: shape.timelineHasNextPage ?? false },
          },
        },
      },
    },
  };
}

interface Captured {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(respond: () => Response, captured: Captured[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    captured.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as unknown as typeof fetch;
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function issuePorts(respond: () => Response, captured: Captured[] = []): LinkPorts {
  return realPorts({
    token: TOKEN_FOR_ISSUES,
    workspace: "/nonexistent-workspace",
    fetch: fakeFetch(respond, captured),
    env: { PATH: "" },
  });
}

async function readShape(shape: IssueShape): Promise<IssueRead> {
  return valueFrom(await issuePorts(() => json(graphqlIssue(shape))).readIssue("libre-ai/gov", 7));
}

const labeled = (
  actor: string | null,
  at: string,
  label = "ready",
  actorType: string | null = "User",
): TimelineEvent => ({
  kind: "LabeledEvent",
  label,
  actor,
  at,
  actorType,
});
const unlabeled = (actor: string | null, at: string, label = "ready"): TimelineEvent => ({
  kind: "UnlabeledEvent",
  label,
  actor,
  at,
});

describe("readIssue", () => {
  test("returns the body as is and the label names", async () => {
    const read: IssueRead = await readShape({
      body: "### PRD-ref\r\n\r\nx",
      labels: ["kind:work-package", "ready"],
      events: [labeled(OWNER, "2026-10-19T10:00:00Z")],
    });
    expect(read).toEqual({
      body: "### PRD-ref\r\n\r\nx",
      labels: ["kind:work-package", "ready"],
      readyLabeledBy: OWNER,
      bodyEditedAfterReady: false,
    });
  });

  test("ready set by the owner then removed: no actor", async () => {
    const read: IssueRead = await readShape({
      labels: [],
      events: [labeled(OWNER, "2026-10-19T10:00:00Z"), unlabeled(OWNER, "2026-10-19T11:00:00Z")],
    });
    expect(read.readyLabeledBy).toBeNull();
    expect(read.bodyEditedAfterReady).toBe(false);
  });

  test("ready set, removed, then set again by another: the actor of the LAST labeled event", async () => {
    const read: IssueRead = await readShape({
      labels: ["ready"],
      events: [
        labeled(OWNER, "2026-10-19T10:00:00Z"),
        unlabeled(OWNER, "2026-10-19T11:00:00Z"),
        labeled(OTHER, "2026-10-19T12:00:00Z"),
      ],
    });
    expect(read.readyLabeledBy).toBe(OTHER);
  });

  // Two labeled events with no unlabeled between them (the label set again
  // under another case, or recorded twice): only the LAST one holds, so the
  // owner's earlier event cannot vouch for a later one by someone else.
  test("ready labeled twice in a row: the actor and the date of the LAST labeled event", async () => {
    const read: IssueRead = await readShape({
      labels: ["ready"],
      lastEditedAt: "2026-10-19T11:00:00Z",
      events: [
        labeled(OWNER, "2026-10-19T10:00:00Z"),
        labeled(OTHER, "2026-10-19T12:00:00Z", "Ready"),
      ],
    });
    expect(read.readyLabeledBy).toBe(OTHER);
    expect(read.bodyEditedAfterReady).toBe(false);
  });

  test("the label name compares ASCII case-insensitively; other labels are ignored", async () => {
    const read: IssueRead = await readShape({
      labels: ["Ready"],
      events: [
        labeled(OWNER, "2026-10-19T10:00:00Z", "Ready"),
        labeled(OTHER, "2026-10-19T11:00:00Z", "ready-for-review"),
        unlabeled(OTHER, "2026-10-19T12:00:00Z", "kind:idea"),
      ],
    });
    expect(read.readyLabeledBy).toBe(OWNER);
  });

  test("an edit of the body after the ready label is reported; one before it is not", async () => {
    const events: TimelineEvent[] = [labeled(OWNER, "2026-10-19T10:00:00Z")];
    expect(
      (await readShape({ labels: ["ready"], events, lastEditedAt: "2026-10-19T10:00:01Z" }))
        .bodyEditedAfterReady,
    ).toBe(true);
    expect(
      (await readShape({ labels: ["ready"], events, lastEditedAt: "2026-10-19T09:59:59Z" }))
        .bodyEditedAfterReady,
    ).toBe(false);
  });

  // One-second precision, failing closed: an edit in the SAME second as the
  // label counts as after it (an issue author can edit without write access).
  test("an edit in the same second as the ready label cancels it", async () => {
    const read: IssueRead = await readShape({
      labels: ["ready"],
      lastEditedAt: "2026-10-19T10:00:00Z",
      events: [labeled(OWNER, "2026-10-19T10:00:00Z")],
    });
    expect(read.bodyEditedAfterReady).toBe(true);
  });

  test("a ready actor typed User gives its login", async () => {
    const read: IssueRead = await readShape({
      labels: ["ready"],
      events: [labeled(OWNER, "2026-10-19T10:00:00Z", "ready", "User")],
    });
    expect(read.readyLabeledBy).toBe(OWNER);
  });

  test.each([
    ["a Bot", "Bot"],
    ["a Mannequin", "Mannequin"],
    ["an actor without __typename", null],
  ])("%s carrying the owner's login is an unknown actor; the label stays", async (_label: string, actorType:
    | string
    | null) => {
    const read: IssueRead = await readShape({
      labels: ["ready"],
      events: [labeled(OWNER, "2026-10-19T10:00:00Z", "ready", actorType)],
    });
    expect(read.readyLabeledBy).toBeNull();
    expect(read.labels).toEqual(["ready"]);
  });

  test("the timeline holds ready but the issue no longer carries it: no actor", async () => {
    const read: IssueRead = await readShape({
      labels: ["kind:work-package"],
      lastEditedAt: "2026-10-19T11:00:00Z",
      events: [labeled(OWNER, "2026-10-19T10:00:00Z")],
    });
    expect(read).toMatchObject({ readyLabeledBy: null, bodyEditedAfterReady: false });
  });

  test("the query asks for the type of every label actor", async () => {
    const captured: Captured[] = [];
    await issuePorts(() => json(graphqlIssue({})), captured).readIssue("libre-ai/gov", 7);
    const sent = JSON.parse(String(captured[0]?.init.body)) as { query: string };
    expect(sent.query.match(/actor \{ __typename login \}/g)?.length).toBe(2);
  });

  test("setting the label again restarts the comparison from the new event", async () => {
    const read: IssueRead = await readShape({
      labels: ["ready"],
      lastEditedAt: "2026-10-19T11:30:00Z",
      events: [
        labeled(OWNER, "2026-10-19T10:00:00Z"),
        unlabeled(OWNER, "2026-10-19T11:00:00Z"),
        labeled(OWNER, "2026-10-19T12:00:00Z"),
      ],
    });
    expect(read.bodyEditedAfterReady).toBe(false);
  });

  test("an edit with no ready event is not 'edited after ready'", async () => {
    const read: IssueRead = await readShape({ lastEditedAt: "2026-10-19T10:00:00Z" });
    expect(read).toMatchObject({ readyLabeledBy: null, bodyEditedAfterReady: false });
  });

  test("a deleted actor gives a null actor while the label stays: the gate sees the inconsistency", async () => {
    const read: IssueRead = await readShape({
      labels: ["ready"],
      events: [labeled(null, "2026-10-19T10:00:00Z")],
    });
    expect(read.labels).toEqual(["ready"]);
    expect(read.readyLabeledBy).toBeNull();
  });

  test.each([
    ["labels", { labelsHasNextPage: true }],
    ["timeline items", { timelineHasNextPage: true }],
  ])("a further page of %s is a named failure, never a truncated read", async (_label: string, shape: IssueShape) => {
    const reason: string = expectFailure(
      await issuePorts(() => json(graphqlIssue(shape))).readIssue("libre-ai/gov", 7),
    );
    expect(reason).toContain("too many");
  });

  test.each([
    ["an HTTP error", (): Response => json({ message: "Bad credentials" }, 401)],
    ["GraphQL errors", (): Response => json({ errors: [{ message: "Could not resolve" }] })],
    ["invalid JSON", (): Response => new Response("<html>", { status: 200 })],
    ["a null issue", (): Response => json({ data: { repository: { issue: null } } })],
    ["a null repository", (): Response => json({ data: { repository: null } })],
    [
      "an unknown timeline item",
      (): Response =>
        json({
          data: {
            repository: {
              issue: {
                body: "",
                lastEditedAt: null,
                labels: { nodes: [], pageInfo: { hasNextPage: false } },
                timelineItems: {
                  nodes: [{ __typename: "ClosedEvent" }],
                  pageInfo: { hasNextPage: false },
                },
              },
            },
          },
        }),
    ],
    [
      "a body that is not a string",
      (): Response => json(graphqlIssue({ body: 3 as unknown as string })),
    ],
  ])("%s is a named failure", async (_label: string, respond: () => Response) => {
    const reason: string = expectFailure(await issuePorts(respond).readIssue("libre-ai/gov", 7));
    expect(reason).not.toContain(TOKEN_FOR_ISSUES);
  });

  test("a fetch that throws a message holding the token is a failure whose reason hides it", async () => {
    const ports: LinkPorts = realPorts({
      token: TOKEN_FOR_ISSUES,
      workspace: "/nonexistent-workspace",
      fetch: (async (): Promise<Response> => {
        throw new Error(`connection refused for ${TOKEN_FOR_ISSUES}`);
      }) as unknown as typeof fetch,
      env: { PATH: "" },
    });
    const reason: string = expectFailure(await ports.readIssue("libre-ai/gov", 7));
    expect(reason).not.toContain(TOKEN_FOR_ISSUES);
  });

  test("one query, its values as GraphQL variables, the token in the Authorization header", async () => {
    const captured: Captured[] = [];
    await issuePorts(() => json(graphqlIssue({})), captured).readIssue("libre-ai/gov", 7);
    expect(captured.length).toBe(1);
    const request: Captured = captured[0] as Captured;
    expect(request.url).toBe("https://api.github.com/graphql");
    expect(request.init.method).toBe("POST");
    const headers = new Headers(request.init.headers);
    expect(headers.get("authorization")).toBe(`bearer ${TOKEN_FOR_ISSUES}`);
    const sent = JSON.parse(String(request.init.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    expect(sent.variables).toEqual({ owner: "libre-ai", name: "gov", number: 7 });
    expect(sent.query).not.toContain("libre-ai");
    expect(sent.query).not.toContain("gov");
    expect(sent.query).toContain("LABELED_EVENT");
  });

  test("without a token, nothing is sent and the failure says why", async () => {
    const captured: Captured[] = [];
    const ports: LinkPorts = realPorts({
      token: null,
      workspace: "/nonexistent-workspace",
      fetch: fakeFetch(() => json(graphqlIssue({})), captured),
      env: { PATH: "" },
    });
    expect(expectFailure(await ports.readIssue("libre-ai/gov", 7))).toContain("token");
    expect(captured).toEqual([]);
  });

  test.each([
    ["a repository without owner", "gov", 7],
    ["a zero issue number", "libre-ai/gov", 0],
    ["a fractional issue number", "libre-ai/gov", 1.5],
  ])("%s is refused before anything is sent", async (_label: string, repo: string, number: number) => {
    const captured: Captured[] = [];
    expectFailure(await issuePorts(() => json(graphqlIssue({})), captured).readIssue(repo, number));
    expect(captured).toEqual([]);
  });
});
