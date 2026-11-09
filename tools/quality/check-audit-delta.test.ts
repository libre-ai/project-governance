import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The push path of the D2 audit-delta gate, exercised as a process.
 *
 * WHY A PROCESS AND NOT A UNIT. The gate is a top-level script: it resolves its
 * base, fetches it and concludes in module scope, so there is nothing to import
 * and call. That shape is also why its push path stayed dead from the day it was
 * written — `pushBefore()` never awaited the event file, a double cast silenced
 * the compiler, `JSON.parse` choked on `[object Promise]` and a bare `catch`
 * returned null. NO TEST EXERCISED THE PUSH PATH, so the only observable effect
 * was a green taken against the served branch instead of against the tip the
 * push replaced. A promise nobody awaits breaks nothing; that is the defect
 * class, and the only thing that holds it closed is a probe that goes red when
 * the gate stops reading its event.
 *
 * WHY A FIXTURE REMOTE. Every probe below resolves a base and tries to fetch it,
 * so the gate needs an `origin`. It gets a throwaway repository reached over
 * `file://` — no network, no quota, and `uploadpack.allowAnySHA1InWant` so a
 * fetch BY SHA (what the push path does) is served exactly as GitHub serves it.
 * The fixture branch is deliberately not a default-branch name: nothing here may
 * pass because a written `main` happened to match.
 *
 * WHY A SCRUBBED ENVIRONMENT. On a pull-request run of this repository's own CI,
 * `GITHUB_EVENT_NAME`, `GITHUB_BASE_REF` and `GITHUB_EVENT_PATH` are all set. A
 * probe inheriting them would measure the ambient run, not the case it declares,
 * so each child gets only what it needs.
 *
 * WHAT THE FIXTURE CLONE DELIBERATELY LACKS: a manifest and a lockfile. Every
 * probe on the gate's verdict must conclude BEFORE `bun audit` is reached; if
 * one ever reaches it, the audit cannot run and the probe goes red rather than
 * quietly passing. The one probe that runs further, the moved base (#146),
 * judges the clone the gate leaves behind, never the gate's verdict.
 */

const GATE = join(import.meta.dir, "check-audit-delta.ts");
const FIXTURE_BRANCH = "probe/served";
/** 40 hex digits, well-formed and absent from the fixture: not an all-zero sha. */
const ABSENT_SHA = "0123456789abcdef0123456789abcdef01234567";

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A git call whose failure is an answer, not a broken fixture. */
function gitRun(cwd: string, argv: readonly string[]): Run {
  const result = Bun.spawnSync(["git", ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "Audit Delta Probe",
      GIT_AUTHOR_EMAIL: "probe@invalid",
      GIT_COMMITTER_NAME: "Audit Delta Probe",
      GIT_COMMITTER_EMAIL: "probe@invalid",
    },
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function git(cwd: string, argv: readonly string[]): Run {
  const run = gitRun(cwd, argv);
  if (run.exitCode !== 0) {
    throw new Error(`fixture setup failed: git ${argv.join(" ")} — ${run.stderr.trim()}`);
  }
  return run;
}

/** Run the gate in the fixture clone with exactly the variables a probe declares. */
function runGate(overrides: Readonly<Record<string, string>>, cwd: string = clone): Run {
  const result = Bun.spawnSync(["bun", GATE], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      ...overrides,
    },
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

/** Every verdict line the gate printed, on either stream. */
function conclusions(run: Run): string[] {
  return [...run.stdout.split("\n"), ...run.stderr.split("\n")].filter((line) =>
    /^Audit delta(:| )/.test(line),
  );
}

function eventFile(name: string, contents: string): string {
  const path = join(workspace, name);
  writeFileSync(path, contents);
  return path;
}

let workspace: string;
let upstream: string;
let clone: string;
let headSha: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "audit-delta-probe-"));
  upstream = join(workspace, "upstream");
  clone = join(workspace, "clone");

  git(workspace, ["init", "--quiet", "-b", FIXTURE_BRANCH, upstream]);
  // A fetch by raw sha is what the push path performs; upload-pack refuses it
  // unless the server allows it, exactly as GitHub's does.
  git(upstream, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
  writeFileSync(join(upstream, "README.md"), "fixture\n");
  git(upstream, ["add", "README.md"]);
  git(upstream, ["commit", "--quiet", "--no-gpg-sign", "-m", "fixture base"]);
  // `file://` and not a plain path: a local-path clone takes shortcuts a
  // remote never does (it silently ignores `--depth`, for one), and the gate
  // must be measured against a transport that behaves like GitHub's.
  git(workspace, ["clone", "--quiet", `file://${upstream}`, clone]);
  headSha = git(clone, ["rev-parse", "HEAD"]).stdout.trim();
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("the push event is read, and a push base is a base", () => {
  test("a push whose `before` IS the head fails: a delta against its own head measures nothing", () => {
    const path = eventFile("same.json", JSON.stringify({ before: headSha }));
    const run = runGate({ GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: path });

    // Red if the event is not read: `pushBefore()` returning null falls through
    // to the served-branch fallback, where base == head is ALLOWED to be empty
    // and the gate exits 0.
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("base and head are the same commit");
    expect(run.stderr).toContain("the tip this push replaced");
  });

  test("a push whose `before` names an unreachable commit fails on the fetch", () => {
    const path = eventFile("absent.json", JSON.stringify({ before: ABSENT_SHA }));
    const run = runGate({ GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: path });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("could not fetch the base");
    expect(run.stderr).toContain(ABSENT_SHA);
  });

  test("a branch creation reports an all-zero `before`, which is not a base", () => {
    const path = eventFile("creation.json", JSON.stringify({ before: "0".repeat(40) }));
    const run = runGate({ GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: path });

    // No previous tip exists, so the served-branch fallback is the right answer
    // and its empty delta is declared rather than failed.
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("verified nothing, as declared");
  });
});

describe("an event file that cannot be read is a failure, never a zero", () => {
  test("a GITHUB_EVENT_PATH that does not exist fails loudly", () => {
    const run = runGate({
      GITHUB_EVENT_NAME: "push",
      GITHUB_EVENT_PATH: join(workspace, "no-such-event.json"),
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("push event payload");
    expect(run.stderr).toContain("could not be read");
  });

  test("a GITHUB_EVENT_PATH holding something other than JSON fails loudly", () => {
    const path = eventFile("corrupt.json", "not json at all\n");
    const run = runGate({ GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: path });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("push event payload");
    expect(run.stderr).toContain("not parsable JSON");
  });

  test("a push event with no `before` key at all is an absent base, not an error", () => {
    const path = eventFile("no-before.json", JSON.stringify({ repository: { name: "fixture" } }));
    const run = runGate({ GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: path });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("verified nothing, as declared");
  });
});

describe("the declared-empty branch concludes once and stops", () => {
  test("no event hands a base: one verdict, exit 0, and nothing runs after it", () => {
    const run = runGate({});

    // The gate falls back to the served branch, where base == head, declares the
    // emptiness and must STOP. `concludeGate` returns on a green report instead
    // of exiting, so the branch used to fall through: the gate went on to audit
    // a base it had just declared it could not compare, and printed a second
    // verdict. This fixture clone carries no manifest, so that second pass
    // cannot audit and exits 1 — which is what makes this probe discriminating.
    expect(conclusions(run)).toHaveLength(1);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("verified nothing, as declared");
    expect(run.stderr).not.toContain("bun audit");
  });
});

describe("the base fetch never shortens the clone the next gates read (#146)", () => {
  // ci.yml checks out with `fetch-depth: 0`, then this gate fetches the base,
  // then check-review-evidence diffs `origin/<base>...HEAD`. When the served
  // branch moved between checkout and fetch, a `--depth=1` fetch brought the
  // new tip in as a shallow boundary without its parents, and that diff
  // answered "no merge base" (three red `Bun quality` runs, 2026-10-23/24).
  // Each probe builds its own fixture: the shared one must not see a moved
  // branch, and a shallow boundary left by one probe must not reach another.

  interface PullRequestClone {
    readonly upstream: string;
    readonly checkout: string;
    /** The base the pull request was checked out against. */
    readonly baseAtCheckout: string;
  }

  function emptyCommit(cwd: string, message: string): void {
    git(cwd, ["commit", "--quiet", "--allow-empty", "--no-gpg-sign", "-m", message]);
  }

  /** A full clone, as ci.yml makes it, sitting on a change over a two-commit base. */
  function pullRequestClone(prefix: string): PullRequestClone {
    const root = mkdtempSync(join(workspace, prefix));
    const upstream = join(root, "upstream");
    const checkout = join(root, "clone");
    git(root, ["init", "--quiet", "-b", FIXTURE_BRANCH, upstream]);
    // Two base commits, so there is history BELOW the base tip to lose.
    emptyCommit(upstream, "older base");
    emptyCommit(upstream, "base at checkout");
    git(root, ["clone", "--quiet", `file://${upstream}`, checkout]);
    const baseAtCheckout = git(checkout, ["rev-parse", "HEAD"]).stdout.trim();
    git(checkout, ["switch", "--quiet", "-c", "probe/change"]);
    emptyCommit(checkout, "the change");
    return { upstream, checkout, baseAtCheckout };
  }

  const pullRequestEvent = { GITHUB_EVENT_NAME: "pull_request", GITHUB_BASE_REF: FIXTURE_BRANCH };

  test("a base that does not move leaves the whole history readable", () => {
    const { checkout } = pullRequestClone("still-base-");
    const commitsBefore = git(checkout, ["rev-list", "--count", "HEAD"]).stdout.trim();

    const run = runGate(pullRequestEvent, checkout);

    expect(run.stderr).not.toContain("could not fetch the base");
    // `--depth=1` marks the base tip shallow even when it is already present,
    // and every commit below it vanishes from the gates that run next.
    expect(gitRun(checkout, ["rev-parse", "--is-shallow-repository"]).stdout.trim()).toBe("false");
    expect(git(checkout, ["rev-list", "--count", "HEAD"]).stdout.trim()).toBe(commitsBefore);
  });

  test("a base that moves after the checkout keeps its merge base with the head", () => {
    const { upstream, checkout, baseAtCheckout } = pullRequestClone("moved-base-");
    // The served branch moves while the run is in flight.
    emptyCommit(upstream, "merged meanwhile");
    const movedTip = git(upstream, ["rev-parse", "HEAD"]).stdout.trim();

    const run = runGate(pullRequestEvent, checkout);

    // The gate did fetch, and fetched the moved tip: without this the probe
    // below would judge a clone the gate never touched.
    expect(run.stderr).not.toContain("could not fetch the base");
    expect(gitRun(checkout, ["rev-parse", "FETCH_HEAD"]).stdout.trim()).toBe(movedTip);
    // The clone is still complete.
    expect(gitRun(checkout, ["rev-parse", "--is-shallow-repository"]).stdout.trim()).toBe("false");
    // What check-review-evidence does next: fetch the base, take the range.
    git(checkout, ["fetch", "--quiet", "origin", FIXTURE_BRANCH]);
    const mergeBase = gitRun(checkout, ["merge-base", `origin/${FIXTURE_BRANCH}`, "HEAD"]);
    expect(mergeBase.exitCode).toBe(0);
    expect(mergeBase.stdout.trim()).toBe(baseAtCheckout);
    const range = gitRun(checkout, ["diff", "--name-only", `origin/${FIXTURE_BRANCH}...HEAD`]);
    expect(range.stderr).not.toContain("no merge base");
    expect(range.exitCode).toBe(0);
  });
});
