import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The pre-push guard under a real `git push`.
//
// Every repository is a throwaway fixture under the system temporary directory:
// a bare "remote" on the same disk, whose served branch is deliberately NOT
// called main, and a work repository with a fixture identity in its own config.
// The hook is written in the fixture's own `.git/hooks`; the global and system
// git configs are neutralised, so no `core.hooksPath` of the machine applies and
// nothing is installed outside the fixture. Nothing reaches a forge.

const GUARD = join(import.meta.dir, "pre-push-artifact-lifecycle.ts");
const SERVED = "trunk-served";

const GIT_ENV = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  ARTIFACT_LIFECYCLE_TODAY: "2026-06-15",
};

interface Run {
  readonly exitCode: number;
  readonly stderr: string;
}

let workspace: string;
let fixtureCount = 0;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "pre-push-artifact-lifecycle-"));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function run(
  argv: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>> = {},
  stdin?: string,
): Run {
  const result = Bun.spawnSync([...argv], {
    cwd,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...GIT_ENV, ...env },
  });
  return { exitCode: result.exitCode ?? -1, stderr: result.stderr.toString() };
}

function git(repository: string, argv: readonly string[]): string {
  const result = Bun.spawnSync(["git", "-C", repository, ...argv], {
    stdout: "pipe",
    stderr: "pipe",
    env: GIT_ENV,
  });
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(`fixture setup failed: git ${argv.join(" ")}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function commit(repository: string, files: Readonly<Record<string, string>>): string {
  for (const [relative, text] of Object.entries(files)) {
    const path = join(repository, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  git(repository, ["add", "-A"]);
  git(repository, ["commit", "-q", "--no-gpg-sign", "-m", "fixture"]);
  return git(repository, ["rev-parse", "HEAD"]);
}

interface Fixture {
  readonly work: string;
  readonly remote: string;
}

/**
 * A remote serving `trunk-served`, whose history already holds an untested
 * script: a guard that judged the whole history, or looked for `main`, would
 * be red on every push. The hook is installed after the served branch is pushed.
 */
function fixture(): Fixture {
  fixtureCount += 1;
  const remote = join(workspace, `remote-${fixtureCount}.git`);
  const work = join(workspace, `work-${fixtureCount}`);
  mkdirSync(remote);
  mkdirSync(work);
  git(remote, ["init", "-q", "--bare"]);
  git(remote, ["symbolic-ref", "HEAD", `refs/heads/${SERVED}`]);
  git(work, ["init", "-q"]);
  git(work, ["config", "user.name", "t"]);
  git(work, ["config", "user.email", "t@t"]);
  git(work, ["switch", "-q", "-c", SERVED]);
  commit(work, { "legacy.sh": "echo legacy\n", "README.md": "x\n" });
  git(work, ["remote", "add", "origin", remote]);
  git(work, ["push", "-q", "origin", SERVED]);
  const hook = join(work, ".git", "hooks", "pre-push");
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(hook, `#!/bin/sh\nexec '${process.execPath}' '${GUARD}' "$@"\n`);
  chmodSync(hook, 0o755);
  return { work, remote };
}

const push = (
  f: Fixture,
  argv: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Run => run(["git", "-C", f.work, "push", "origin", ...argv], f.work, env);

const remoteTip = (f: Fixture, branch: string): string =>
  git(f.remote, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`]);

describe("pre-push under a real git push", () => {
  test("a new branch is measured from the merge base with the served branch, read from the remote", () => {
    const f = fixture();
    git(f.work, ["switch", "-q", "-c", "feature"]);
    commit(f.work, { "ok.sh": "echo ok\n", "ok.test.sh": "echo test\n" });
    const pushed = push(f, ["feature"]);
    expect(pushed.stderr).toContain(
      `refs/heads/feature: from the merge base with the served branch ${SERVED}`,
    );
    // The untested legacy.sh of the served branch is not in the interval.
    expect(pushed.stderr).toContain("code: checked=1 tested=1 ephemeral=0 exempted=0 untested=0");
    expect(pushed.stderr).not.toContain("legacy.sh");
    expect(pushed.exitCode).toBe(0);
    expect(remoteTip(f, "feature")).toBe(git(f.work, ["rev-parse", "HEAD"]));
  });

  test("an untested script pushed to an existing branch: refused, the file and the override named", () => {
    const f = fixture();
    commit(f.work, { "bad.sh": "echo bad\n" });
    const before = remoteTip(f, SERVED);
    const pushed = push(f, [SERVED]);
    expect(pushed.stderr).toContain(`refs/heads/${SERVED}: what the remote does not have`);
    expect(pushed.stderr).toContain("code without test: bad.sh");
    expect(pushed.stderr).toContain("push REFUSED (gate exit 1)");
    expect(pushed.stderr).toContain("ARTIFACT_LIFECYCLE_ALLOW_PUSH=1");
    expect(pushed.exitCode).not.toBe(0);
    expect(remoteTip(f, SERVED)).toBe(before);
  });

  test("with the override the same push passes and says the CI replays the gate", () => {
    const f = fixture();
    const head = commit(f.work, { "bad.sh": "echo bad\n" });
    const pushed = push(f, [SERVED], { ARTIFACT_LIFECYCLE_ALLOW_PUSH: "1" });
    expect(pushed.stderr).toContain("code without test: bad.sh");
    expect(pushed.stderr).toContain(
      "OVERRIDE ARTIFACT_LIFECYCLE_ALLOW_PUSH=1 active: push allowed despite exit 1; the CI job reusable-artifact-lifecycle.yml replays the same gate",
    );
    expect(pushed.exitCode).toBe(0);
    expect(remoteTip(f, SERVED)).toBe(head);
  });

  test("deleting a ref passes without running the gate", () => {
    const f = fixture();
    git(f.work, ["switch", "-q", "-c", "doomed"]);
    commit(f.work, { "bad.sh": "echo bad\n" });
    expect(push(f, ["doomed"], { ARTIFACT_LIFECYCLE_ALLOW_PUSH: "1" }).exitCode).toBe(0);
    const deleted = push(f, ["--delete", "doomed"]);
    expect(deleted.stderr).toContain("refs/heads/doomed: deleted, nothing to examine");
    expect(deleted.stderr).toContain("refs=1 examined=0: pass");
    expect(deleted.stderr).not.toContain("examined: tracked=");
    expect(deleted.exitCode).toBe(0);
    expect(() => remoteTip(f, "doomed")).toThrow();
  });
});

describe("the gate judges the tree of the pushed commit, not the index or the work tree", () => {
  const worktrees = (f: Fixture): number =>
    git(f.work, ["worktree", "list", "--porcelain"])
      .split("\n")
      .filter((line) => line.startsWith("worktree ")).length;

  test("a branch that is not checked out, adding an untested script: refused", () => {
    const f = fixture();
    git(f.work, ["switch", "-q", "-c", "side"]);
    commit(f.work, { "bad.sh": "echo bad\n" });
    git(f.work, ["switch", "-q", SERVED]);
    const pushed = push(f, ["side"]);
    expect(pushed.stderr).toContain("code without test: bad.sh");
    expect(pushed.stderr).toContain("push REFUSED (gate exit 1)");
    expect(pushed.exitCode).not.toBe(0);
    expect(() => remoteTip(f, "side")).toThrow();
    // The temporary worktree of the pushed commit is gone.
    expect(worktrees(f)).toBe(1);
  });

  test("a branch that is not checked out, with its test committed: passes", () => {
    const f = fixture();
    git(f.work, ["switch", "-q", "-c", "side"]);
    const tip = commit(f.work, { "ok.sh": "echo ok\n", "ok.test.sh": "echo test\n" });
    git(f.work, ["switch", "-q", SERVED]);
    const pushed = push(f, ["side"]);
    expect(pushed.stderr).toContain("code: checked=1 tested=1 ephemeral=0 exempted=0 untested=0");
    expect(pushed.exitCode).toBe(0);
    expect(remoteTip(f, "side")).toBe(tip);
    expect(worktrees(f)).toBe(1);
  });

  test("a push naming its repository by --git-dir judges the pushed commit, not this work tree", () => {
    const f = fixture();
    git(f.work, ["switch", "-q", "-c", "side"]);
    commit(f.work, { "bad.sh": "echo bad\n" });
    git(f.work, ["switch", "-q", SERVED]);
    const pushed = run(
      [
        "git",
        `--git-dir=${join(f.work, ".git")}`,
        `--work-tree=${f.work}`,
        "push",
        "origin",
        "side",
      ],
      f.work,
    );
    expect(pushed.stderr).toContain("code without test: bad.sh");
    expect(pushed.exitCode).not.toBe(0);
    expect(() => remoteTip(f, "side")).toThrow();
    expect(worktrees(f)).toBe(1);
  });

  test("a test only staged does not cover a committed untested script: refused", () => {
    const f = fixture();
    commit(f.work, { "bad2.sh": "echo bad\n" });
    const before = remoteTip(f, SERVED);
    writeFileSync(join(f.work, "bad2.test.sh"), "echo test\n");
    git(f.work, ["add", "bad2.test.sh"]);
    const pushed = push(f, [SERVED]);
    expect(pushed.stderr).toContain("code without test: bad2.sh");
    expect(pushed.stderr).toContain("push REFUSED (gate exit 1)");
    expect(pushed.exitCode).not.toBe(0);
    expect(remoteTip(f, SERVED)).toBe(before);
    expect(worktrees(f)).toBe(1);
  });

  test("an untracked file is examined with the checked-out commit of a clean tree", () => {
    const f = fixture();
    commit(f.work, { "ok.sh": "echo ok\n", "ok.test.sh": "echo test\n" });
    writeFileSync(join(f.work, "stray.txt"), "x\n");
    const pushed = push(f, [SERVED]);
    expect(pushed.stderr).toContain("untracked without marker: stray.txt");
    expect(pushed.exitCode).not.toBe(0);
  });

  test("a dirty tree: the untracked files are not examined, and that is printed", () => {
    const f = fixture();
    commit(f.work, { "ok.sh": "echo ok\n", "ok.test.sh": "echo test\n" });
    writeFileSync(join(f.work, "README.md"), "changed\n");
    writeFileSync(join(f.work, "stray.txt"), "x\n");
    const pushed = push(f, [SERVED]);
    expect(pushed.stderr).toContain("untracked files of the work tree NOT examined");
    expect(pushed.stderr).not.toContain("stray.txt");
    expect(pushed.exitCode).toBe(0);
  });
});

describe("pre-push called directly", () => {
  test("nothing new to push: passes without running the gate", () => {
    const f = fixture();
    const head = git(f.work, ["rev-parse", "HEAD"]);
    const line = `refs/heads/${SERVED} ${head} refs/heads/${SERVED} ${head}\n`;
    const result = run([process.execPath, GUARD, "origin", f.remote], f.work, {}, line);
    expect(result.stderr).toContain("the remote has it, nothing new");
    expect(result.stderr).toContain("refs=1 examined=0: pass");
    expect(result.exitCode).toBe(0);
  });

  test("a malformed standard input is refused with exit 2", () => {
    const f = fixture();
    const result = run([process.execPath, GUARD, "origin"], f.work, {}, "not a ref line\n");
    expect(result.stderr).toContain("unexpected line 1");
    expect(result.stderr).toContain("push REFUSED");
    expect(result.stderr).toContain("ARTIFACT_LIFECYCLE_ALLOW_PUSH=1");
    expect(result.exitCode).toBe(2);
  });

  test("a remote opening with a dash is a usage error, the override named", () => {
    const f = fixture();
    const result = run([process.execPath, GUARD, "--upload-pack=x"], f.work, {}, "");
    expect(result.stderr).toContain("ARTIFACT_LIFECYCLE_ALLOW_PUSH=1");
    expect(result.exitCode).toBe(2);
  });

  test("outside a work tree: refused, the override named", () => {
    const bare = join(workspace, `bare-${fixtureCount}.git`);
    mkdirSync(bare);
    git(bare, ["init", "-q", "--bare"]);
    const result = run([process.execPath, GUARD, "origin"], bare, {}, "");
    expect(result.stderr).toContain("not inside a git work tree");
    expect(result.stderr).toContain("ARTIFACT_LIFECYCLE_ALLOW_PUSH=1");
    expect(result.exitCode).toBe(2);
  });

  test("the override lets a refusal of the guard itself through, saying so", () => {
    const f = fixture();
    const result = run(
      [process.execPath, GUARD, "origin"],
      f.work,
      { ARTIFACT_LIFECYCLE_ALLOW_PUSH: "1" },
      "not a ref line\n",
    );
    expect(result.stderr).toContain("OVERRIDE ARTIFACT_LIFECYCLE_ALLOW_PUSH=1 active");
    expect(result.exitCode).toBe(0);
  });
});
