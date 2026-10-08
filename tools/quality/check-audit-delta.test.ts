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
 * probe must conclude BEFORE `bun audit` is reached; if one ever reaches it, the
 * audit cannot run and the probe goes red rather than quietly passing.
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

function git(cwd: string, argv: readonly string[]): Run {
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
  const run = {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
  if (run.exitCode !== 0) {
    throw new Error(`fixture setup failed: git ${argv.join(" ")} — ${run.stderr.trim()}`);
  }
  return run;
}

/** Run the gate in the fixture clone with exactly the variables a probe declares. */
function runGate(overrides: Readonly<Record<string, string>>): Run {
  const result = Bun.spawnSync(["bun", GATE], {
    cwd: clone,
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
  // `file://` and not a plain path: a local-path clone silently ignores
  // `--depth`, and the gate fetches shallow.
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
