import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  changedSetProblem,
  childEnvironment,
  EXIT,
  gitEnvironment,
  type Manifest,
  originProblem,
  parseArguments,
  prBody,
  readManifest,
  signOffProblem,
  staleness,
} from "./apply";
import { MANIFEST_COLUMNS, renderManifest, replayCommand } from "./kit";

/**
 * Application of a remediation kit (lot L070). The expected values come from
 * the brief: codes 0 commit made or pull request opened, 2 usage, 3 input
 * unreadable, 4 kit stale, 5 patch refused, 6 forge unreadable, 7 forge write
 * refused; the stale message carries both sha cut to 8 characters; without
 * --apply the fake gh is never called and the branch never reaches the
 * remote. Every bench is real git on a local bare remote (`file://`) serving
 * a generated branch name; gh is a fixture script. The tool runs as a child
 * whose PATH holds one directory: a logging git wrapper and the fake gh.
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const TOOL = join(import.meta.dir, "apply.ts");
const REPOSITORY_ROOT = join(import.meta.dir, "..", "..", "..");
const REAL_GIT = Bun.which("git") ?? "/usr/bin/git";
const TICKET = "bad";
const REPOSITORY = "o/alpha";
const NAME = "Remediation Tester";
const EMAIL = "tester@example.invalid";

/** Environment of the bench's own git calls: no user or system configuration. */
function purged(home: string): Record<string, string> {
  return {
    PATH: `${dirname(REAL_GIT)}:/usr/bin:/bin`,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

interface Bench {
  readonly root: string;
  readonly home: string;
  readonly bin: string;
  readonly bare: string;
  readonly clone: string;
  readonly kits: string;
  readonly served: string;
  readonly base: string;
  readonly gitLog: string;
  readonly ghLog: string;
  readonly ghBody: string;
  /** Present: the git wrapper drops an untracked file right after `git apply`. */
  readonly parasiteFlag: string;
  /** Present: the fake gh exits 1. */
  readonly ghFailFlag: string;
  /** Present: the work branch appears at origin right before the tool's push. */
  readonly raceFlag: string;
  readonly git: (cwd: string, ...args: string[]) => string;
  readonly writeKit: (patch: string, line?: Partial<ManifestFields>) => void;
}

interface ManifestFields {
  readonly ticket: string;
  readonly servedBranch: string;
  readonly baseSha: string;
  readonly patch: string;
}

function script(path: string, lines: readonly string[]): void {
  writeFileSync(path, `${lines.join("\n")}\n`);
  chmodSync(path, 0o755);
}

function bench(): Bench {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "remediation-apply-test-")));
  roots.push(root);
  const home = join(root, "home");
  const bin = join(root, "bin");
  const kits = join(root, "kits");
  const clones = join(root, "clones");
  for (const directory of [home, bin, kits, clones, join(root, "tmp")]) mkdirSync(directory);
  const gitLog = join(root, "git.log");
  const ghLog = join(root, "gh.log");
  const ghBody = join(root, "gh-body.md");
  const parasiteFlag = join(root, "parasite.flag");
  const ghFailFlag = join(root, "gh-fail.flag");
  const raceFlag = join(root, "race.flag");
  // Only shell builtins: the child's PATH holds nothing but this directory.
  script(join(bin, "git"), [
    "#!/bin/sh",
    `printf '[%s]' "$@" >> '${gitLog}'`,
    `printf '\\n' >> '${gitLog}'`,
    `if [ "$1" = apply ] && [ "$2" != --check ] && [ "$2" != --numstat ] && [ "$2" != --summary ] && [ -f '${parasiteFlag}' ]; then`,
    `  '${REAL_GIT}' "$@" || exit $?`,
    "  : > parasite.txt",
    "  exit 0",
    "fi",
    // Someone creates the work branch at origin, on an ancestor of the commit,
    // between the tool's check and its push: a plain push would fast-forward it.
    `if [ "$1" = push ] && [ -f '${raceFlag}' ]; then`,
    `  '${REAL_GIT}' push --quiet origin 'HEAD~1:refs/heads/${BRANCH}' || exit 99`,
    "fi",
    `exec '${REAL_GIT}' "$@"`,
  ]);
  script(join(bin, "gh"), [
    "#!/bin/sh",
    `printf '[%s]' "$@" >> '${ghLog}'`,
    `printf '\\n' >> '${ghLog}'`,
    `printf '%s\\n' "$PATH" > '${join(root, "gh-path.txt")}'`,
    `if [ -f '${ghFailFlag}' ]; then exit 1; fi`,
    "previous=",
    'for argument in "$@"; do',
    '  if [ "$previous" = --body-file ]; then',
    `    while IFS= read -r line || [ -n "$line" ]; do printf '%s\\n' "$line"; done < "$argument" > '${ghBody}'`,
    "  fi",
    '  previous="$argument"',
    "done",
    "printf 'https://example.invalid/o/alpha/pull/1\\n'",
  ]);

  const git = (cwd: string, ...args: string[]): string => {
    const result = Bun.spawnSync([REAL_GIT, "-C", cwd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: purged(home),
    });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.toString();
  };

  // A served branch that is not main, named at run time.
  const served = `served-${Math.random().toString(36).slice(2, 10)}`;
  // `<owner>/<name>.git`: the origin of the clone designates REPOSITORY.
  const bare = join(root, "forge", "o", "alpha.git");
  mkdirSync(bare, { recursive: true });
  git(bare, "init", "--bare", "-q", `--initial-branch=${served}`);
  const seed = join(root, "seed");
  mkdirSync(seed);
  git(seed, "init", "-q", `--initial-branch=${served}`);
  git(seed, "config", "user.name", "seed");
  git(seed, "config", "user.email", "seed@example.invalid");
  writeFileSync(join(seed, "a.txt"), "one\nBAD\nthree\n");
  writeFileSync(join(seed, "b.txt"), "untouched\n");
  writeFileSync(join(seed, ".gitignore"), "generated/\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "seed");
  git(seed, "push", "-q", `file://${bare}`, `HEAD:refs/heads/${served}`);
  const base = git(seed, "rev-parse", "HEAD").trim();

  const clone = join(clones, "alpha");
  git(root, "clone", "-q", `file://${bare}`, clone);
  // The identity of the commit: the configuration of the test repository.
  git(clone, "config", "user.name", NAME);
  git(clone, "config", "user.email", EMAIL);
  // The clone's own working tree is dirty, and must stay exactly so.
  writeFileSync(join(clone, "operator-note.txt"), "mine\n");

  const writeKit = (patch: string, line: Partial<ManifestFields> = {}): void => {
    const directory = join(kits, TICKET);
    mkdirSync(join(directory, "o"), { recursive: true });
    writeFileSync(join(directory, "o", "alpha.patch"), patch);
    writeFileSync(
      join(directory, "manifest.tsv"),
      renderManifest([
        {
          ticket: line.ticket ?? TICKET,
          repository: REPOSITORY,
          servedBranch: line.servedBranch ?? served,
          baseSha: line.baseSha ?? base,
          patch: line.patch ?? `${REPOSITORY}.patch`,
          added: 2,
          removed: 1,
          kept: 0,
          replay: replayCommand(REPOSITORY, false),
          note: "edits=1 companions=0",
        },
      ]),
    );
  };

  return {
    root,
    home,
    bin,
    bare,
    clone,
    kits,
    served,
    base,
    gitLog,
    ghLog,
    ghBody,
    parasiteFlag,
    ghFailFlag,
    raceFlag,
    git,
    writeKit,
  };
}

/** A patch made by `edit` on a fresh clone of the base, everything staged by force. */
function patchFrom(b: Bench, edit: (work: string) => void): string {
  const work = join(b.root, `patch-${Math.random().toString(36).slice(2, 8)}`);
  b.git(b.root, "clone", "-q", `file://${b.bare}`, work);
  edit(work);
  b.git(work, "add", "-A", "-f");
  return b.git(work, "diff", "--cached", "--binary");
}

/** The patch of the kit: one line replaced in a.txt and a new file in a new directory. */
function remediationPatch(b: Bench): string {
  return patchFrom(b, (work) => {
    writeFileSync(join(work, "a.txt"), "one\nGOOD\nthree\n");
    mkdirSync(join(work, "dir"));
    writeFileSync(join(work, "dir", "new.txt"), "created\n");
  });
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runTool(b: Bench, args: readonly string[]): Run {
  const result = Bun.spawnSync([process.execPath, TOOL, ...args], {
    cwd: REPOSITORY_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: b.bin,
      HOME: b.home,
      TMPDIR: join(b.root, "tmp"),
      REMEDIATION_KIT_DIR: b.kits,
      REMEDIATION_CLONES_DIR: join(b.root, "clones"),
    },
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

const BRANCH = "work/remediation-bad";
const TITLE = "fix(bad): remediate the BAD lines";

const ghCalls = (b: Bench): string[] =>
  existsSync(b.ghLog)
    ? readFileSync(b.ghLog, "utf8")
        .split("\n")
        .filter((line) => line !== "")
    : [];

const remoteHeads = (b: Bench): string => b.git(b.root, "ls-remote", "--heads", `file://${b.bare}`);

function worktreeOf(stdout: string): string {
  const match = /worktree remove (\S+)$/m.exec(stdout);
  if (match?.[1] === undefined) throw new Error(`no cleanup line in:\n${stdout}`);
  return match[1];
}

// ------------------------------------------------------------------ end to end

describe("dry run (no --apply)", () => {
  test("commits on the work branch, writes nothing to the forge, prints the cleanup", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    const statusBefore = b.git(b.clone, "status", "--porcelain");

    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);

    expect(run.stderr).toBe("");
    expect(run.code).toBe(EXIT.ok);
    expect(run.stdout).toContain("worktree remove");
    expect(run.stdout).toContain(`branch -D ${BRANCH}`);
    const worktree = worktreeOf(run.stdout);
    expect(b.git(worktree, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(BRANCH);
    expect(b.git(worktree, "rev-parse", "HEAD~1").trim()).toBe(b.base);
    expect(ghCalls(b)).toEqual([]);
    expect(remoteHeads(b)).not.toContain(BRANCH);
    expect(remoteHeads(b)).toContain(`refs/heads/${b.served}`);
    // The clone's working tree, operator's untracked file included, is untouched.
    expect(b.git(b.clone, "status", "--porcelain")).toBe(statusBefore);
  });

  test("a file the patch creates is in the commit", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.code).toBe(EXIT.ok);
    const names = b
      .git(worktreeOf(run.stdout), "show", "--name-only", "--format=", "HEAD")
      .trim()
      .split("\n")
      .sort();
    expect(names).toEqual(["a.txt", "dir/new.txt"]);
  });

  test("the last line is the sign-off of the repository's configuration, and no -c user. is passed", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.code).toBe(EXIT.ok);
    const lines = b.git(worktreeOf(run.stdout), "log", "-1", "--format=%B").trimEnd().split("\n");
    expect(lines.at(-1)).toBe(`Signed-off-by: ${NAME} <${EMAIL}>`);
    expect(lines[0]).toBe(TITLE);
    const calls = readFileSync(b.gitLog, "utf8");
    expect(calls).toContain("[commit]");
    expect(calls).not.toContain("[-c]");
    // `git config user.name` reads the identity; nothing sets it.
    expect(calls).not.toMatch(/\[user\.[a-z]+=/);
    expect(calls).not.toContain("--force");
  });

  test("the PATH gh receives holds one directory: the fake gh and the git wrapper", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    expect(runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE, "--apply"]).code).toBe(EXIT.ok);
    expect(ghCalls(b)).toHaveLength(1);
    expect(readFileSync(join(b.root, "gh-path.txt"), "utf8")).toBe(`${b.bin}\n`);
    expect(readdirSync(b.bin).sort()).toEqual(["gh", "git"]);
  });
});

describe("stale kit", () => {
  test("served branch different from the manifest's: 4, no worktree created", () => {
    const b = bench();
    b.writeKit(remediationPatch(b), { servedBranch: "another-branch" });
    const before = b.git(b.clone, "worktree", "list", "--porcelain");
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.code).toBe(EXIT.stale);
    expect(b.git(b.clone, "worktree", "list", "--porcelain")).toBe(before);
  });

  test("a commit pushed on the served branch after the kit: 4, both sha cut to 8", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    const later = join(b.root, "later");
    b.git(b.root, "clone", "-q", `file://${b.bare}`, later);
    b.git(later, "config", "user.name", "later");
    b.git(later, "config", "user.email", "later@example.invalid");
    writeFileSync(join(later, "b.txt"), "moved\n");
    b.git(later, "commit", "-q", "-am", "later");
    b.git(later, "push", "-q", "origin", `HEAD:refs/heads/${b.served}`);
    const head = b.git(later, "rev-parse", "HEAD").trim();

    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.code).toBe(EXIT.stale);
    expect(run.stderr).toContain(b.base.slice(0, 8));
    expect(run.stderr).toContain(head.slice(0, 8));
  });
});

describe("patch refused", () => {
  test("an empty patch: 5, no commit", () => {
    const b = bench();
    b.writeKit("");
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.code).toBe(EXIT.patch);
    expect(b.git(b.clone, "rev-parse", `refs/heads/${BRANCH}`).trim()).toBe(b.base);
  });

  test("a patch already applied: 5, no commit", () => {
    const b = bench();
    const patch = remediationPatch(b);
    // The fix lands on the served branch, and the kit is computed on that head.
    const landed = join(b.root, "landed");
    b.git(b.root, "clone", "-q", `file://${b.bare}`, landed);
    writeFileSync(join(landed, "fix.patch"), patch);
    b.git(landed, "apply", "fix.patch");
    rmSync(join(landed, "fix.patch"));
    b.git(landed, "config", "user.name", "landed");
    b.git(landed, "config", "user.email", "landed@example.invalid");
    b.git(landed, "add", "-A");
    b.git(landed, "commit", "-q", "-m", "fixed by hand");
    b.git(landed, "push", "-q", "origin", `HEAD:refs/heads/${b.served}`);
    const head = b.git(landed, "rev-parse", "HEAD").trim();
    b.writeKit(patch, { baseSha: head });

    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.code).toBe(EXIT.patch);
    expect(b.git(b.clone, "rev-parse", `refs/heads/${BRANCH}`).trim()).toBe(head);
  });

  test("an untracked file appearing between apply and add: 5, not committed", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    writeFileSync(b.parasiteFlag, "");
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.code).toBe(EXIT.patch);
    expect(run.stderr).toContain("parasite.txt");
    expect(b.git(b.clone, "rev-parse", `refs/heads/${BRANCH}`).trim()).toBe(b.base);
    expect(b.git(b.clone, "ls-tree", "-r", "--name-only", BRANCH)).not.toContain("parasite.txt");
  });
});

describe("patch content refused (git apply --summary)", () => {
  test("a symbolic link created by the patch: 5, no commit", () => {
    const b = bench();
    b.writeKit(patchFrom(b, (work) => symlinkSync("../../etc/passwd", join(work, "link"))));
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.code).toBe(EXIT.patch);
    expect(run.stderr).toContain("120000");
    expect(b.git(b.clone, "rev-parse", `refs/heads/${BRANCH}`).trim()).toBe(b.base);
  });

  test("a rename: 5, no commit", () => {
    const b = bench();
    b.writeKit(
      patchFrom(b, (work) => {
        writeFileSync(join(work, "c.txt"), readFileSync(join(work, "b.txt")));
        rmSync(join(work, "b.txt"));
      }),
    );
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.code).toBe(EXIT.patch);
    expect(b.git(b.clone, "rev-parse", `refs/heads/${BRANCH}`).trim()).toBe(b.base);
  });
});

describe("ignored paths", () => {
  test("a file the patch creates under an ignored path is committed, and only it", () => {
    const b = bench();
    b.writeKit(
      patchFrom(b, (work) => {
        mkdirSync(join(work, "generated"));
        writeFileSync(join(work, "generated", "x.txt"), "kept\n");
      }),
    );
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(EXIT.ok);
    const names = b
      .git(worktreeOf(run.stdout), "show", "--name-only", "--format=", "HEAD")
      .trim()
      .split("\n");
    expect(names).toEqual(["generated/x.txt"]);
  });

  test("an ignored parasite appearing after apply is refused: 5", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    // The wrapper's parasite matches an exclude pattern of the clone.
    writeFileSync(join(b.clone, ".git", "info", "exclude"), "parasite.txt\n");
    writeFileSync(b.parasiteFlag, "");
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.code).toBe(EXIT.patch);
    expect(run.stderr).toContain("parasite.txt");
  });
});

describe("the clone's configuration and hooks", () => {
  /** Executable marker scripts: each writes its name into `<root>/ran/`. */
  function marker(b: Bench, path: string, name: string, extra: readonly string[] = []): void {
    mkdirSync(join(b.root, "ran"), { recursive: true });
    mkdirSync(dirname(path), { recursive: true });
    script(path, ["#!/bin/sh", `: > '${join(b.root, "ran", name)}'`, ...extra]);
  }
  const ran = (b: Bench): string[] =>
    existsSync(join(b.root, "ran")) ? readdirSync(join(b.root, "ran")).sort() : [];

  test("core.fsmonitor never runs; the clone's hooks run for the commit only", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    const hooks = join(b.clone, ".git", "hooks");
    marker(b, join(b.root, "fsmonitor.sh"), "fsmonitor", ["exit 1"]);
    b.git(b.clone, "config", "core.fsmonitor", join(b.root, "fsmonitor.sh"));
    // post-checkout runs on `worktree add` only; reference-transaction would
    // run for the commit as well, so it cannot tell the two apart.
    for (const hook of ["post-checkout", "pre-commit", "commit-msg"]) {
      marker(b, join(hooks, hook), hook);
    }
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(EXIT.ok);
    expect(ran(b)).toEqual(["commit-msg", "pre-commit"]);
  });

  test("a pre-commit hook adding a file: the commit is not the patch, 5", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    script(join(b.clone, ".git", "hooks", "pre-commit"), [
      "#!/bin/sh",
      ": > hooked.txt",
      "exec git add hooked.txt",
    ]);
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(run.code).toBe(EXIT.patch);
    expect(run.stderr).toContain("the commit is not the patch");
    expect(run.stderr).toContain("hooked.txt");
  });
});

describe("origin of the clone", () => {
  /** A second forge repository, o/beta, at the same base. */
  function beta(b: Bench): string {
    const other = join(b.root, "forge", "o", "beta.git");
    b.git(b.root, "clone", "-q", "--bare", `file://${b.bare}`, other);
    return other;
  }

  test("origin designating another repository: 3, nothing pushed anywhere, gh never called", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    const other = beta(b);
    b.git(b.clone, "remote", "set-url", "origin", `file://${other}`);
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE, "--apply"]);
    expect(run.code).toBe(EXIT.input);
    expect(run.stderr).toContain("does not designate o/alpha");
    expect(ghCalls(b)).toEqual([]);
    expect(b.git(b.root, "ls-remote", "--heads", `file://${other}`)).not.toContain(BRANCH);
  });

  test("a push URL designating another repository: 3, nothing pushed anywhere", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    const other = beta(b);
    b.git(b.clone, "remote", "set-url", "--push", "origin", `file://${other}`);
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE, "--apply"]);
    expect(run.code).toBe(EXIT.input);
    expect(ghCalls(b)).toEqual([]);
    expect(b.git(b.root, "ls-remote", "--heads", `file://${other}`)).not.toContain(BRANCH);
    expect(remoteHeads(b)).not.toContain(BRANCH);
  });
});

describe("input refused", () => {
  test("the work branch already exists at origin: 3, gh never called", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    b.git(b.clone, "push", "-q", "origin", `${b.base}:refs/heads/${BRANCH}`);
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE, "--apply"]);
    expect(run.code).toBe(EXIT.input);
    expect(ghCalls(b)).toEqual([]);
  });

  test("the work branch already exists in the clone: 3", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    b.git(b.clone, "branch", BRANCH, b.base);
    expect(runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]).code).toBe(EXIT.input);
  });

  test("a patch path ../x.patch or absolute in the manifest: 3", () => {
    for (const patch of ["../x.patch", "/tmp/x.patch"]) {
      const b = bench();
      b.writeKit(remediationPatch(b), { patch });
      writeFileSync(join(b.kits, "x.patch"), remediationPatch(b));
      expect(runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]).code).toBe(EXIT.input);
    }
  });

  test("a patch that is a symbolic link leaving the kit: 3", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    const outside = join(b.root, "outside.patch");
    writeFileSync(outside, remediationPatch(b));
    const inKit = join(b.kits, TICKET, "o", "alpha.patch");
    rmSync(inKit);
    symlinkSync(outside, inKit);
    expect(runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]).code).toBe(EXIT.input);
  });

  test("a manifest of another ticket: 3", () => {
    const b = bench();
    b.writeKit(remediationPatch(b), { ticket: "other" });
    expect(runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]).code).toBe(EXIT.input);
  });

  test("no identity in the configuration: 3", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    b.git(b.clone, "config", "--unset", "user.name");
    expect(runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE]).code).toBe(EXIT.input);
  });
});

describe("usage", () => {
  test("a 5th argument --dry: 2; a branch a..b: 2", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    expect(runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE, "--dry"]).code).toBe(EXIT.usage);
    expect(runTool(b, [TICKET, REPOSITORY, "work/a..b", TITLE]).code).toBe(EXIT.usage);
    expect(runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE, "--apply", "x"]).code).toBe(EXIT.usage);
    expect(runTool(b, [TICKET, "alpha", BRANCH, TITLE]).code).toBe(EXIT.usage);
    expect(ghCalls(b)).toEqual([]);
  });
});

describe("--apply", () => {
  test("exactly two forge writes: the branch on the remote, one pr create on the served branch", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE, "--apply"]);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(EXIT.ok);
    expect(remoteHeads(b)).toContain(`refs/heads/${BRANCH}`);
    const calls = ghCalls(b);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStartWith("[pr][create]");
    expect(calls[0]).toContain(`[--base][${b.served}]`);
    expect(calls[0]).toContain(`[--head][${BRANCH}]`);
    expect(calls[0]).toContain(`[--repo][${REPOSITORY}]`);
    const body = readFileSync(b.ghBody, "utf8");
    expect(body).toContain(TICKET);
    expect(body).toContain(b.base);
    expect(body).toContain("dir/new.txt");
    expect(body).toContain(replayCommand(REPOSITORY, false));
    const pushes = readFileSync(b.gitLog, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("[push]"));
    expect(pushes).toEqual([
      `[push][--quiet][--force-with-lease=refs/heads/${BRANCH}:][origin][HEAD:refs/heads/${BRANCH}]`,
    ]);
  });

  test("the work branch created at origin after the check: 7, the branch not moved, gh never called", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    writeFileSync(b.raceFlag, "");
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE, "--apply"]);
    expect(run.code).toBe(EXIT.write);
    expect(ghCalls(b)).toEqual([]);
    // The branch someone else created stays where they put it.
    expect(remoteHeads(b)).toContain(`${b.base}\trefs/heads/${BRANCH}`);
  });

  test("a remote refusing the push: 7, gh never called", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    script(join(b.bare, "hooks", "pre-receive"), ["#!/bin/sh", "exit 1"]);
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE, "--apply"]);
    expect(run.code).toBe(EXIT.write);
    expect(ghCalls(b)).toEqual([]);
  });

  test("a fake gh exiting non-zero: 7", () => {
    const b = bench();
    b.writeKit(remediationPatch(b));
    writeFileSync(b.ghFailFlag, "");
    const run = runTool(b, [TICKET, REPOSITORY, BRANCH, TITLE, "--apply"]);
    expect(run.code).toBe(EXIT.write);
    expect(ghCalls(b)).toHaveLength(1);
  });

  test("a variable absent: 2", () => {
    const b = bench();
    const result = Bun.spawnSync(
      [process.execPath, TOOL, TICKET, REPOSITORY, BRANCH, TITLE, "--apply"],
      {
        cwd: REPOSITORY_ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { PATH: b.bin, HOME: b.home, REMEDIATION_KIT_DIR: b.kits },
      },
    );
    expect(result.exitCode).toBe(EXIT.usage);
    expect(ghCalls(b)).toEqual([]);
  });
});

// ------------------------------------------------------------------ pure parts

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const MANIFEST: Manifest = {
  ticket: TICKET,
  repository: REPOSITORY,
  servedBranch: "served",
  baseSha: SHA_A,
  patch: "o/alpha.patch",
  replay: "bun ecosystem/fleet-state.ts state --repos o/alpha",
};

function manifestText(cells: Partial<Record<(typeof MANIFEST_COLUMNS)[number], string>>): string {
  const row = {
    ticket: TICKET,
    repository: REPOSITORY,
    served_branch: "served",
    base_sha: SHA_A,
    patch: "o/alpha.patch",
    added: "1",
    removed: "1",
    kept: "0",
    replay: "bun x",
    note: "",
    ...cells,
  };
  return `${MANIFEST_COLUMNS.join("\t")}\n${MANIFEST_COLUMNS.map((c) => row[c]).join("\t")}\n`;
}

describe("parseArguments", () => {
  test("4 positionals, optional --apply", () => {
    const dry = parseArguments([TICKET, REPOSITORY, BRANCH, TITLE]);
    expect(dry.ok && dry.value.apply).toBe(false);
    const apply = parseArguments([TICKET, REPOSITORY, BRANCH, TITLE, "--apply"]);
    expect(apply.ok && apply.value.apply).toBe(true);
  });

  test("refusals", () => {
    for (const argv of [
      [TICKET, REPOSITORY, BRANCH],
      [TICKET, REPOSITORY, BRANCH, TITLE, "--dry"],
      [TICKET, REPOSITORY, BRANCH, TITLE, "--apply", "x"],
      [TICKET, "o/../x", BRANCH, TITLE],
      [TICKET, "alpha", BRANCH, TITLE],
      ["../t", REPOSITORY, BRANCH, TITLE],
      [TICKET, REPOSITORY, "main", TITLE],
      [TICKET, REPOSITORY, "work/", TITLE],
      [TICKET, REPOSITORY, BRANCH, ""],
      [TICKET, REPOSITORY, BRANCH, "line\nbreak"],
    ]) {
      expect(parseArguments(argv).ok).toBe(false);
    }
  });
});

describe("readManifest", () => {
  test("reads the six consumed columns of the repository's line", () => {
    const read = readManifest(manifestText({}), TICKET, REPOSITORY);
    expect(read).toEqual({
      ok: true,
      value: { ...MANIFEST, replay: "bun x" },
    });
  });

  test("refusals", () => {
    for (const [text, ticket, repository] of [
      [manifestText({ patch: "../x.patch" }), TICKET, REPOSITORY],
      [manifestText({ patch: "/abs/x.patch" }), TICKET, REPOSITORY],
      [manifestText({ patch: "o/../../x.patch" }), TICKET, REPOSITORY],
      [manifestText({ ticket: "other" }), TICKET, REPOSITORY],
      [manifestText({}), TICKET, "o/beta"],
      [manifestText({ base_sha: "abc" }), TICKET, REPOSITORY],
      [manifestText({ served_branch: "-x" }), TICKET, REPOSITORY],
      [manifestText({ replay: "" }), TICKET, REPOSITORY],
      [manifestText({}).replace("ticket\t", "tickets\t"), TICKET, REPOSITORY],
      [`${manifestText({})}${manifestText({}).split("\n")[1]}\n`, TICKET, REPOSITORY],
    ] as const) {
      expect(readManifest(text, ticket, repository).ok).toBe(false);
    }
  });
});

describe("staleness", () => {
  test("null when the branch and the head are the manifest's", () => {
    expect(staleness("served", SHA_A, MANIFEST)).toBeNull();
  });
  test("another served branch", () => {
    expect(staleness("other", SHA_A, MANIFEST)).toContain("other");
  });
  test("another head: both sha cut to 8", () => {
    const message = staleness("served", SHA_B, MANIFEST) ?? "";
    expect(message).toContain(SHA_A.slice(0, 8));
    expect(message).toContain(SHA_B.slice(0, 8));
    expect(message).not.toContain(SHA_A.slice(0, 9));
  });
});

describe("changedSetProblem", () => {
  test("equal sets, in any order", () => {
    expect(changedSetProblem(["a", "b"], ["b", "a"])).toBeNull();
  });
  test("an empty patch, an extra file, a missing file", () => {
    expect(changedSetProblem([], [])).not.toBeNull();
    expect(changedSetProblem(["a"], ["a", "p"])).toContain("p");
    expect(changedSetProblem(["a", "b"], ["a"])).toContain("b");
  });
});

describe("signOffProblem", () => {
  const signed = `t\n\nbody\n\nSigned-off-by: ${NAME} <${EMAIL}>\n`;
  test("the sign-off as last line", () => {
    expect(signOffProblem(signed, NAME, EMAIL)).toBeNull();
  });
  test("absent, not last, or another identity", () => {
    expect(signOffProblem("t\n", NAME, EMAIL)).toContain("absent");
    expect(signOffProblem(`${signed}Other: x\n`, NAME, EMAIL)).toContain("not the last");
    expect(signOffProblem(signed, "Someone", EMAIL)).not.toBeNull();
  });
});

describe("prBody", () => {
  test("cites the ticket, the base sha, every file and the replay", () => {
    const body = prBody(MANIFEST, ["b.txt", "a.txt"]);
    expect(body).toContain(TICKET);
    expect(body).toContain(SHA_A);
    expect(body).toContain("- `a.txt`\n- `b.txt`");
    expect(body).toContain(MANIFEST.replay);
  });

  test("a path holding backticks keeps its code span: the fence is longer than its longest run", () => {
    const body = prBody(MANIFEST, ["a``b", "`c"]);
    expect(body).toContain("- ```a``b```");
    // A leading backtick is padded, the padding is stripped by the renderer.
    expect(body).toContain("- `` `c ``");
  });

  test("a replay holding a fence is closed by a longer fence", () => {
    const body = prBody({ ...MANIFEST, replay: "echo ``` && echo ````" }, ["a"]);
    expect(body).toContain("`````sh\necho ``` && echo ````\n`````");
  });
});

describe("readManifest refuses a control character in the replay", () => {
  for (const [label, character] of [
    ["carriage return", "\r"],
    ["escape", "\u{1b}"],
    ["delete", "\u{7f}"],
    ["C1 control", "\u{85}"],
    ["bidi override", "\u{202e}"],
    ["line separator", "\u{2028}"],
  ] as const) {
    test(label, () => {
      const read = readManifest(manifestText({ replay: `bun x${character}y` }), TICKET, REPOSITORY);
      expect(read.ok).toBe(false);
    });
  }
});

describe("originProblem", () => {
  test("the forms that designate o/alpha", () => {
    for (const url of [
      "https://github.com/o/alpha",
      "https://github.com/o/alpha.git",
      "https://github.com/O/Alpha.git",
      "ssh://git@github.com/o/alpha.git",
      "git@github.com:o/alpha.git",
      "git@github.com:o/alpha",
      "file:///srv/forge/o/alpha.git",
    ]) {
      expect([url, originProblem(url, REPOSITORY)]).toEqual([url, null]);
    }
  });

  test("the forms that do not", () => {
    for (const url of [
      "https://github.com/o/beta.git",
      "https://github.com/x/alpha.git",
      "https://github.com/x/o/alpha.git",
      "https://github.com/o/alpha.git/",
      "https://github.com/o/alpha.git?x=1",
      "https://github.com/o/%61lpha.git",
      "http://github.com/o/alpha.git",
      "git://github.com/o/alpha.git",
      "ext::sh -c touch% /tmp/x",
      "git@github.com:x/o/alpha.git",
      "git@github.com:/o/alpha.git",
      "/srv/forge/o/alpha.git",
      "file:///srv/forge/alpha.git",
      "",
    ]) {
      expect([url, originProblem(url, REPOSITORY)]).not.toEqual([url, null]);
    }
  });

  test("the refusal never prints the URL: it may hold a credential", () => {
    const problem = originProblem("https://user:s3cret@github.com/o/beta.git", REPOSITORY) ?? "";
    expect(problem).not.toContain("s3cret");
    expect(problem).toContain("does not designate o/alpha");
  });
});

describe("childEnvironment and gitEnvironment", () => {
  test("children receive PASSED_VARIABLES only, never a GIT_* variable or a token", () => {
    const built = childEnvironment({
      PATH: "/p",
      HOME: "/h",
      GIT_DIR: "/elsewhere",
      GIT_INDEX_FILE: "/i",
      GH_TOKEN: "secret",
      SSH_AUTH_SOCK: "/agent",
    });
    expect(built).toEqual({ PATH: "/p", HOME: "/h", GIT_TERMINAL_PROMPT: "0" });
  });

  test("git also receives SSH_AUTH_SOCK, fsmonitor off and, outside commit and push, an empty hooks path", () => {
    const environment = {
      PATH: "/p",
      GIT_CONFIG_PARAMETERS: "'core.fsmonitor'='x'",
      GH_TOKEN: "secret",
      SSH_AUTH_SOCK: "/agent",
    };
    expect(gitEnvironment(environment, "/empty", false)).toEqual({
      PATH: "/p",
      GIT_TERMINAL_PROMPT: "0",
      SSH_AUTH_SOCK: "/agent",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_VALUE_1: "/empty",
    });
    expect(gitEnvironment(environment, "/empty", true)).toEqual({
      PATH: "/p",
      GIT_TERMINAL_PROMPT: "0",
      SSH_AUTH_SOCK: "/agent",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_VALUE_0: "false",
    });
  });
});
