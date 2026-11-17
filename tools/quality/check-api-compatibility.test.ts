import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type ApiCompatDeps,
  EXIT,
  main,
  PROVIDED_BINARY_ENV,
  type ToolRun,
  type WorkspacePackage,
} from "./check-api-compatibility";

// The gate is exercised on real git repositories built in a temporary
// directory, with the tool and the workspace reader injected: no Rust
// toolchain is needed, and no network. The tool outputs below are the ones
// cargo-semver-checks 0.51.0 printed on a two-function crate (2026-11-17);
// what the real tool prints on a runner is a criterion of the calling
// repository, not of this file.

const SUITE_ROOT: string = realpathSync(mkdtempSync(join(tmpdir(), "api-compat-test-")));
afterAll(() => rmSync(SUITE_ROOT, { recursive: true, force: true }));

const GIT_ENV: Record<string, string> = {
  PATH: Bun.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

function git(repository: string, ...argv: string[]): string {
  const result = Bun.spawnSync(["git", "-C", repository, ...argv], {
    env: GIT_ENV,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${argv.join(" ")}: ${new TextDecoder().decode(result.stderr)}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function fresh(name: string): string {
  return mkdtempSync(join(SUITE_ROOT, `${name}-`));
}

function repositoryAt(name: string): string {
  const repository = fresh(name);
  git(repository, "init", "--quiet");
  return repository;
}

function manifest(name: string, version: string): string {
  return `[package]\nname = "${name}"\nversion = "${version}"\nedition = "2021"\n`;
}

/** Writes the files, commits them, and returns the commit. */
function commit(repository: string, files: Readonly<Record<string, string>>): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repository, path)), { recursive: true });
    writeFileSync(join(repository, path), content);
  }
  git(repository, "add", "--all");
  git(repository, "commit", "--quiet", "--allow-empty", "--message", "fixture");
  return git(repository, "rev-parse", "HEAD");
}

const CRATE = "libre-ai-engine";
const SIBLING = "engine";

/** A workspace with the crate under crates/a and a sibling named by its suffix under crates/b. */
function twoCrates(version = "1.0.0"): Readonly<Record<string, string>> {
  return {
    "Cargo.toml": '[workspace]\nmembers = ["crates/a", "crates/b"]\n',
    "crates/a/Cargo.toml": manifest(CRATE, version),
    "crates/a/src/lib.rs": "pub fn kept() {}\n",
    "crates/b/Cargo.toml": manifest(SIBLING, "0.1.0"),
    "crates/b/src/lib.rs": "pub fn other() {}\n",
  };
}

const packagesOf = (repository: string, version = "1.0.0"): WorkspacePackage[] => [
  { name: CRATE, version, manifestPath: join(repository, "crates/a/Cargo.toml") },
  { name: SIBLING, version: "0.1.0", manifestPath: join(repository, "crates/b/Cargo.toml") },
];

// Stand-ins for the two binaries: found by the lookup, never executed.
const BIN: string = fresh("bin");
for (const name of ["cargo", "cargo-semver-checks"]) {
  writeFileSync(join(BIN, name), "");
  chmodSync(join(BIN, name), 0o755);
}
const CARGO_ONLY: string = fresh("cargo-only");
writeFileSync(join(CARGO_ONLY, "cargo"), "");
chmodSync(join(CARGO_ONLY, "cargo"), 0o755);

const PASS: ToolRun = {
  exitCode: 0,
  stdout: "",
  stderr:
    "    Checking libre-ai-engine v1.0.0 -> v1.1.0 (minor change)\n" +
    "     Checked [   0.005s] 229 checks: 229 pass, 31 skip\n" +
    "     Summary no semver update required\n",
};
const BREAK_LINE = "--- failure function_missing: pub fn removed or renamed ---";
const SECOND_BREAK_LINE =
  "--- failure struct_pub_field_missing: pub struct's pub field removed or renamed ---";
const BREAK: ToolRun = {
  exitCode: 100,
  stdout:
    `\n${BREAK_LINE}\n\nDescription:\nA publicly-visible function cannot be imported by its prior path.\n\n` +
    "Failed in:\n  function libre_ai_engine::gone, previously in file src/lib.rs:2\n" +
    `\n${SECOND_BREAK_LINE}\n\nFailed in:\n  field x of struct S, previously in file src/lib.rs:3\n`,
  stderr:
    "     Checked [   0.004s] 229 checks: 227 pass, 2 fail, 0 warn, 31 skip\n\n" +
    "     Summary semver requires new major version: 2 major and 0 minor checks failed\n",
};
const ZERO_CHECKS: ToolRun = {
  exitCode: 0,
  stdout: "",
  stderr: "     Checked [   0.000s] 0 checks: 0 pass, 0 skip\n",
};
const TOOL_ERROR: ToolRun = {
  exitCode: 101,
  stdout: "",
  stderr: "error: no crates with library targets selected, nothing to semver-check\n",
};

interface Outcome {
  readonly code: number;
  readonly lines: readonly string[];
  /** Every call of the tool that is not its version query. */
  readonly calls: readonly (readonly string[])[];
  readonly temporaryRoot: string;
  /** What `--baseline-root` held while the tool ran. */
  readonly baselineSeen: readonly boolean[];
}

interface Scenario {
  readonly repository: string;
  readonly argv?: readonly string[];
  readonly tool?: ToolRun | (() => ToolRun);
  readonly packages?: readonly WorkspacePackage[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly crate?: string;
}

async function gate(scenario: Scenario): Promise<Outcome> {
  const lines: string[] = [];
  const calls: (readonly string[])[] = [];
  const baselineSeen: boolean[] = [];
  const temporaryRoot = fresh("scratch");
  const tool = scenario.tool ?? PASS;
  const deps: ApiCompatDeps = {
    runTool: (argv: readonly string[]): ToolRun => {
      if (argv.includes("--version")) {
        return { exitCode: 0, stdout: "cargo-semver-checks 0.51.0\n", stderr: "" };
      }
      calls.push(argv);
      const root = argv[argv.indexOf("--baseline-root") + 1] ?? "";
      baselineSeen.push(
        root.startsWith(temporaryRoot) && existsSync(join(root, "crates/a/Cargo.toml")),
      );
      return typeof tool === "function" ? tool() : tool;
    },
    readWorkspace: () => scenario.packages ?? packagesOf(scenario.repository),
    temporaryRoot,
    environment: scenario.environment ?? { PATH: BIN },
    write: (line: string): void => {
      lines.push(line);
    },
  };
  const argv = scenario.argv ?? [
    "--repository",
    scenario.repository,
    "--crate",
    scenario.crate ?? CRATE,
  ];
  const code = await main(argv, deps);
  return { code, lines, calls, temporaryRoot, baselineSeen };
}

const last = (outcome: Outcome): string => outcome.lines.at(-1) ?? "";
const tagsLine = (outcome: Outcome): string =>
  outcome.lines.find((line) => line.startsWith("tags: ")) ?? "";
const header = (outcome: Outcome): Record<string, string> =>
  Object.fromEntries(
    (outcome.lines[0] ?? "")
      .split(" ")
      .slice(1)
      .map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
  );

/** A repository tagged at its first commit, with a second commit on top. */
function taggedThenMoved(tag: string, baseVersion = "1.0.0"): string {
  const repository = repositoryAt("tagged");
  commit(repository, twoCrates(baseVersion));
  git(repository, "tag", tag);
  commit(repository, { "crates/a/src/lib.rs": "pub fn kept() {}\npub fn added() {}\n" });
  return repository;
}

describe("choice of the baseline", () => {
  test("no tag at all: 12, and the tool is never called", async () => {
    const repository = repositoryAt("untagged");
    commit(repository, twoCrates());
    const outcome = await gate({ repository });
    expect(outcome.code).toBe(12);
    expect(outcome.code).toBe(EXIT.noBaseline);
    expect(outcome.calls).toEqual([]);
    expect(tagsLine(outcome)).toBe("tags: candidates=0 exact=0 suffix=0 discarded=0");
  });

  test("a suffix tag whose tree carries a sibling crate of that name is discarded: 12", async () => {
    // The tag `engine-v1.0.0` sits on a tree where `engine` is crates/b and
    // crates/a does not exist yet: it is the sibling's release, not this crate's.
    const repository = repositoryAt("sibling");
    commit(repository, {
      "Cargo.toml": '[workspace]\nmembers = ["crates/b"]\n',
      "crates/b/Cargo.toml": manifest(SIBLING, "1.0.0"),
      "crates/b/src/lib.rs": "pub fn other() {}\n",
    });
    git(repository, "tag", "engine-v1.0.0");
    commit(repository, twoCrates());
    const outcome = await gate({ repository });
    expect(tagsLine(outcome)).toBe("tags: candidates=1 exact=0 suffix=1 discarded=1");
    expect(outcome.code).toBe(12);
    expect(outcome.calls).toEqual([]);
  });

  test("a suffix tag whose tree carries the crate at its path is the baseline", async () => {
    const outcome = await gate({ repository: taggedThenMoved("engine-v1.0.0") });
    expect(outcome.code).toBe(0);
    expect(header(outcome).baseline).toBe("engine-v1.0.0");
    expect(tagsLine(outcome)).toBe("tags: candidates=1 exact=0 suffix=1 discarded=0");
  });

  test("an exact tag wins over a higher suffix tag", async () => {
    const repository = repositoryAt("exact");
    commit(repository, twoCrates("0.9.0"));
    git(repository, "tag", "libre-ai-engine-v0.9.0");
    commit(repository, twoCrates("1.0.0"));
    git(repository, "tag", "engine-v1.0.0");
    const outcome = await gate({ repository });
    expect(header(outcome).baseline).toBe("libre-ai-engine-v0.9.0");
    expect(tagsLine(outcome)).toBe("tags: candidates=2 exact=1 suffix=1 discarded=0");
  });

  test("exact tags are ordered as versions, not as text: v1.10.0 is above v1.2.0", async () => {
    const repository = repositoryAt("order");
    const files = { "Cargo.toml": manifest("x", "1.2.0"), "src/lib.rs": "pub fn a() {}\n" };
    commit(repository, files);
    git(repository, "tag", "x-v1.2.0");
    commit(repository, { "Cargo.toml": manifest("x", "1.10.0") });
    git(repository, "tag", "x-v1.10.0");
    const outcome = await gate({
      repository,
      crate: "x",
      packages: [{ name: "x", version: "1.10.0", manifestPath: join(repository, "Cargo.toml") }],
    });
    expect(header(outcome).baseline).toBe("x-v1.10.0");
    expect(header(outcome).path).toBe(".");
    expect(tagsLine(outcome)).toBe("tags: candidates=2 exact=2 suffix=0 discarded=0");
  });

  test("tags that are not <prefix>-vX.Y.Z of this crate are not candidates", async () => {
    const repository = repositoryAt("shape");
    commit(repository, twoCrates());
    for (const tag of [
      "libre-ai-engine-v1.0.0-rc.1",
      "libre-ai-engine-v01.0.0",
      "libre-ai-engine-1.0.0",
      "other-engine-v1.0.0",
      "i-engine-v1.0.0",
      "v1.0.0",
    ]) {
      git(repository, "tag", tag);
    }
    const outcome = await gate({ repository });
    expect(tagsLine(outcome)).toBe("tags: candidates=0 exact=0 suffix=0 discarded=0");
    expect(outcome.code).toBe(12);
  });

  test("the highest exact tag without the crate in its tree: 18", async () => {
    const repository = repositoryAt("absent");
    commit(repository, { "README.md": "nothing yet\n" });
    git(repository, "tag", "libre-ai-engine-v1.0.0");
    commit(repository, twoCrates());
    const outcome = await gate({ repository });
    expect(outcome.code).toBe(18);
    expect(last(outcome)).toContain("is absent from baseline libre-ai-engine-v1.0.0");
    expect(outcome.calls).toEqual([]);
  });

  test("a suffix tag whose tree holds another package at the crate's path is discarded", async () => {
    const repository = repositoryAt("renamed");
    commit(repository, { ...twoCrates(), "crates/a/Cargo.toml": manifest("former-name", "1.0.0") });
    git(repository, "tag", "engine-v1.0.0");
    commit(repository, twoCrates());
    const outcome = await gate({ repository });
    expect(tagsLine(outcome)).toBe("tags: candidates=1 exact=0 suffix=1 discarded=1");
    expect(outcome.code).toBe(12);
  });
});

describe("an explicit baseline revision", () => {
  test("a revision that does not exist: 13", async () => {
    const repository = taggedThenMoved("libre-ai-engine-v1.0.0");
    const outcome = await gate({
      repository,
      argv: ["--repository", repository, "--crate", CRATE, "--baseline-rev", "no-such-rev"],
    });
    expect(outcome.code).toBe(13);
    expect(outcome.calls).toEqual([]);
  });

  // The revision is printed in the machine-readable first line: one that git
  // resolves but that holds a blank would add a field to it.
  test("a revision holding a blank is refused even when git resolves it: 13", async () => {
    const repository = taggedThenMoved("libre-ai-engine-v1.0.0");
    const rev = "HEAD@{0 seconds ago}";
    expect(git(repository, "rev-parse", "--verify", `${rev}^{commit}`)).toMatch(/^[0-9a-f]{40}$/);
    const outcome = await gate({
      repository,
      argv: ["--repository", repository, "--crate", CRATE, "--baseline-rev", rev],
    });
    expect(outcome.code).toBe(13);
  });

  test("a commit without the crate: 18", async () => {
    const repository = repositoryAt("rev-absent");
    const empty = commit(repository, { "README.md": "nothing yet\n" });
    commit(repository, twoCrates());
    const outcome = await gate({
      repository,
      argv: ["--repository", repository, "--crate", CRATE, "--baseline-rev", empty],
    });
    expect(outcome.code).toBe(18);
    expect(last(outcome)).toContain(`is absent from baseline ${empty}`);
  });

  test("a commit with the crate is the baseline, whatever the tags say", async () => {
    const repository = repositoryAt("rev");
    const first = commit(repository, twoCrates());
    commit(repository, { "crates/a/src/lib.rs": "pub fn kept() {}\npub fn added() {}\n" });
    git(repository, "tag", "libre-ai-engine-v1.0.0");
    const outcome = await gate({
      repository,
      argv: ["--repository", repository, "--crate", CRATE, "--baseline-rev", "HEAD~1"],
    });
    expect(outcome.code).toBe(0);
    expect(header(outcome).baseline).toBe("HEAD~1");
    expect(header(outcome)["baseline-sha"]).toBe(first);
  });
});

describe("what the gate refuses to read", () => {
  test("a path that is not a git repository: 19", async () => {
    const outcome = await gate({ repository: fresh("not-a-repository") });
    expect(outcome.code).toBe(19);
    expect(last(outcome)).toContain("is not a git repository");
  });

  test("a shallow clone: 19", async () => {
    const origin = taggedThenMoved("libre-ai-engine-v1.0.0");
    const clone = join(fresh("shallow"), "clone");
    git(SUITE_ROOT, "clone", "--quiet", "--depth=1", `file://${origin}`, clone);
    expect(git(clone, "rev-parse", "--is-shallow-repository")).toBe("true");
    const outcome = await gate({ repository: clone });
    expect(outcome.code).toBe(19);
    expect(last(outcome)).toContain("shallow");
  });

  test.each([
    [
      "the variable names an absent path and PATH is empty",
      { [PROVIDED_BINARY_ENV]: join(SUITE_ROOT, "absent"), PATH: "" },
      "tool missing: cargo",
    ],
    [
      "the variable names an absent path and PATH holds both binaries",
      { [PROVIDED_BINARY_ENV]: join(SUITE_ROOT, "absent"), PATH: BIN },
      `tool missing: cargo-semver-checks (${PROVIDED_BINARY_ENV} names a path that does not exist)`,
    ],
    ["PATH holds cargo alone", { PATH: CARGO_ONLY }, "tool missing: cargo-semver-checks"],
    ["PATH is empty", { PATH: "" }, "tool missing: cargo"],
  ])("a binary that cannot be found (%s): 10", async (_name, environment, cause) => {
    const repository = taggedThenMoved("libre-ai-engine-v1.0.0");
    const outcome = await gate({ repository, environment });
    expect(outcome.code).toBe(10);
    expect(last(outcome)).toBe(cause);
    expect(outcome.calls).toEqual([]);
  });

  test("the provided binary is used when it exists", async () => {
    const repository = taggedThenMoved("libre-ai-engine-v1.0.0");
    const provided = join(BIN, "cargo-semver-checks");
    const outcome = await gate({
      repository,
      environment: { [PROVIDED_BINARY_ENV]: provided, PATH: CARGO_ONLY },
    });
    expect(outcome.code).toBe(0);
    expect(outcome.calls[0]?.[0]).toBe(provided);
  });

  test("a crate the workspace does not list: 11", async () => {
    const repository = taggedThenMoved("libre-ai-engine-v1.0.0");
    const outcome = await gate({ repository, crate: "unlisted" });
    expect(outcome.code).toBe(11);
  });

  test.each([
    ["--crate is missing", ["--repository", "."]],
    ["an unknown argument", ["--crate", CRATE, "--release-type", "major"]],
    ["a flag without its value", ["--crate"]],
    ["an empty baseline revision", ["--crate", CRATE, "--baseline-rev", ""]],
    ["a crate that is not a package name", ["--crate", "--workspace"]],
  ])("usage, %s: 2", async (_name, argv) => {
    const outcome = await gate({ repository: SUITE_ROOT, argv });
    expect(outcome.code).toBe(2);
  });
});

describe("verdicts read from the tool", () => {
  test("a compatible addition: 0, and the last line is OK", async () => {
    const outcome = await gate({ repository: taggedThenMoved("libre-ai-engine-v1.0.0") });
    expect(outcome.code).toBe(0);
    expect(last(outcome)).toBe("OK");
    expect(outcome.lines).toContain("checks=229 passed=229 skipped=31 breaks=0");
  });

  test("a break at the version of the baseline: 16, each break printed", async () => {
    const outcome = await gate({
      repository: taggedThenMoved("libre-ai-engine-v1.0.0"),
      tool: BREAK,
    });
    expect(outcome.code).toBe(16);
    expect(outcome.lines).toContain("checks=229 passed=227 skipped=31 breaks=2");
    expect(outcome.lines.filter((line) => line.startsWith("break: "))).toEqual([
      `break: ${BREAK_LINE}`,
      `break: ${SECOND_BREAK_LINE}`,
    ]);
    expect(last(outcome)).toContain("version not incremented");
  });

  test("a break below the version of the baseline: 16", async () => {
    const repository = taggedThenMoved("libre-ai-engine-v1.0.0");
    const outcome = await gate({
      repository,
      tool: BREAK,
      packages: packagesOf(repository, "0.9.9"),
    });
    expect(outcome.code).toBe(16);
  });

  test("a break with a higher major version than the baseline: 14", async () => {
    const repository = taggedThenMoved("libre-ai-engine-v1.0.0");
    const outcome = await gate({
      repository,
      tool: BREAK,
      packages: packagesOf(repository, "2.0.0"),
    });
    expect(outcome.code).toBe(14);
    expect(last(outcome)).toContain("API break");
  });

  test("the version of the baseline is read on its tree, not in its tag name", async () => {
    // The tag says 1.0.0, its manifest says 3.0.0: a break at 2.0.0 is not an increment.
    const repository = taggedThenMoved("libre-ai-engine-v1.0.0", "3.0.0");
    const outcome = await gate({
      repository,
      tool: BREAK,
      packages: packagesOf(repository, "2.0.0"),
    });
    expect(outcome.code).toBe(16);
  });

  test("zero check run: 15", async () => {
    const outcome = await gate({
      repository: taggedThenMoved("libre-ai-engine-v1.0.0"),
      tool: ZERO_CHECKS,
    });
    expect(outcome.code).toBe(15);
    expect(outcome.lines).toContain("checks=0 passed=0 skipped=0 breaks=0");
  });

  test("the tool fails without a summary: 17", async () => {
    const outcome = await gate({
      repository: taggedThenMoved("libre-ai-engine-v1.0.0"),
      tool: TOOL_ERROR,
    });
    expect(outcome.code).toBe(17);
  });

  test.each([
    ["exit 0 while a check failed", { ...BREAK, exitCode: 0 }],
    ["a failure exit with no failed check", { ...PASS, exitCode: 100 }],
    ["more failed checks counted than reported", { ...BREAK, stdout: `${BREAK_LINE}\n` }],
    [
      "counts that do not sum",
      { ...PASS, stderr: "     Checked [   0.005s] 229 checks: 200 pass, 31 skip\n" },
    ],
    ["two summaries", { ...PASS, stderr: `${PASS.stderr}${PASS.stderr}` }],
  ])("an output that is not the tool's own (%s): 17", async (_name, tool) => {
    const outcome = await gate({ repository: taggedThenMoved("libre-ai-engine-v1.0.0"), tool });
    expect(outcome.code).toBe(17);
  });
});

describe("what is printed", () => {
  test("the first line carries the six keys in order, and the commit of an annotated tag", async () => {
    const repository = repositoryAt("annotated");
    commit(repository, twoCrates());
    git(repository, "tag", "--annotate", "--message", "release", "libre-ai-engine-v1.0.0");
    commit(repository, twoCrates("1.1.0"));
    const outcome = await gate({ repository, packages: packagesOf(repository, "1.1.0") });
    const first = outcome.lines[0] ?? "";
    expect(first.startsWith("api-compat ")).toBe(true);
    expect(Object.keys(header(outcome))).toEqual([
      "tool",
      "crate",
      "path",
      "version",
      "baseline",
      "baseline-sha",
    ]);
    const tagCommit = git(repository, "rev-parse", "libre-ai-engine-v1.0.0^{commit}");
    expect(tagCommit).not.toBe(git(repository, "rev-parse", "libre-ai-engine-v1.0.0"));
    expect(header(outcome)).toEqual({
      tool: "cargo-semver-checks@0.51.0",
      crate: CRATE,
      path: "crates/a",
      version: "1.1.0",
      baseline: "libre-ai-engine-v1.0.0",
      "baseline-sha": tagCommit,
    });
    expect(header(outcome)["baseline-sha"]).toMatch(/^[0-9a-f]{40}$/);
    expect(outcome.lines[1]).toBe("tags: candidates=1 exact=1 suffix=0 discarded=0");
  });

  const RETURN_TYPE = /^limit: a changed return type \(u32 to u64\)/;
  const TRIVIAL = /^limit: the head is the baseline commit/;
  const limits = (outcome: Outcome): string[] =>
    outcome.lines.filter((line) => line.startsWith("limit: "));

  test("the return-type limit is printed on every run that reaches the tool", async () => {
    for (const tool of [PASS, BREAK, ZERO_CHECKS, TOOL_ERROR]) {
      const outcome = await gate({ repository: taggedThenMoved("libre-ai-engine-v1.0.0"), tool });
      expect(limits(outcome).length).toBe(1);
      expect(limits(outcome)[0]).toMatch(RETURN_TYPE);
    }
  });

  test("the trivial-pass limit is added when the head is the baseline commit", async () => {
    const repository = repositoryAt("trivial");
    commit(repository, twoCrates());
    git(repository, "tag", "libre-ai-engine-v1.0.0");
    const outcome = await gate({ repository });
    expect(limits(outcome).length).toBe(2);
    expect(limits(outcome)[0]).toMatch(RETURN_TYPE);
    expect(limits(outcome)[1]).toMatch(TRIVIAL);
    expect(outcome.code).toBe(0);
  });
});

describe("the baseline extraction", () => {
  test("the tool receives the extracted baseline as --baseline-root, never --baseline-rev", async () => {
    const outcome = await gate({ repository: taggedThenMoved("libre-ai-engine-v1.0.0") });
    expect(outcome.calls.length).toBe(1);
    const argv = outcome.calls[0] ?? [];
    expect(argv).toContain("--baseline-root");
    expect(argv).not.toContain("--baseline-rev");
    expect(argv.slice(argv.indexOf("--package"), argv.indexOf("--package") + 2)).toEqual([
      "--package",
      CRATE,
    ]);
    expect(outcome.baselineSeen).toEqual([true]);
  });

  test.each([
    ["0", PASS, 0],
    ["14", BREAK, 14],
    ["17", TOOL_ERROR, 17],
    [
      "an exception raised by the tool",
      (): ToolRun => {
        throw new Error("the tool could not be started");
      },
      17,
    ],
  ])("the temporary directory is gone after %s", async (_name, tool, code) => {
    const repository = taggedThenMoved("libre-ai-engine-v1.0.0");
    const outcome = await gate({ repository, tool, packages: packagesOf(repository, "2.0.0") });
    expect(outcome.code).toBe(code);
    expect(outcome.baselineSeen).toEqual([true]);
    expect(readdirSync(outcome.temporaryRoot)).toEqual([]);
  });
});
