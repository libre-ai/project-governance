import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The negatives gate run as a process, against a real repository.
 *
 * WHY A PROCESS. The pure tests hand the gate a change set; these show that
 * the change set git actually produces — merge base, `--no-renames` path
 * list, `cat-file` blobs — is the one the verdict is about, whatever the
 * repository config says.
 *
 * WHY A FIXTURE REMOTE. The gate fetches `origin <base>`: a throwaway
 * repository over `file://`, no network. The base branch is deliberately not
 * a default-branch name. The gate reads its data file from the working
 * directory, so the fixture carries a copy of the committed one.
 *
 * WHY A SCRUBBED ENVIRONMENT. On a pull-request run of this repository's own
 * CI, `GITHUB_EVENT_NAME`, `GITHUB_BASE_REF` and `GITHUB_EVENT_PATH` are set; a
 * probe inheriting them would measure the ambient run.
 */

const GATE = join(import.meta.dir, "check-pr-negatives.ts");
const DATA = join(import.meta.dir, "pr-negatives.v1.json");
const BASE_BRANCH = "probe/served";

const BASE_PACKAGE = `${JSON.stringify(
  { name: "probe", dependencies: { ajv: "8.20.0" }, devDependencies: { typescript: "7.0.2" } },
  null,
  2,
)}\n`;

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const GIT_ENV = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Negatives Probe",
  GIT_AUTHOR_EMAIL: "probe@invalid",
  GIT_COMMITTER_NAME: "Negatives Probe",
  GIT_COMMITTER_EMAIL: "probe@invalid",
};

function git(cwd: string, argv: readonly string[]): void {
  const result = Bun.spawnSync(["git", ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: GIT_ENV,
  });
  if ((result.exitCode ?? 1) !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`fixture setup failed: git ${argv.join(" ")} — ${stderr}`);
  }
}

let workspace: string;
let upstream: string;
let clone: string;

function write(relative: string, text: string): void {
  const path = join(clone, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** A pull-request branch off the base whose change is whatever `change` does to the clone. */
function branchWith(name: string, change: () => void): void {
  git(clone, ["switch", "--quiet", "-c", name, `origin/${BASE_BRANCH}`]);
  change();
  git(clone, ["add", "-A"]);
  git(clone, ["commit", "--quiet", "--no-gpg-sign", "-m", name]);
}

/** Set repository config for one probe, and unset it whatever the probe's outcome. */
function withConfig(entries: Readonly<Record<string, string>>, probe: () => void): void {
  for (const [key, value] of Object.entries(entries)) git(clone, ["config", key, value]);
  try {
    probe();
  } finally {
    for (const key of Object.keys(entries)) git(clone, ["config", "--unset", key]);
  }
}

/**
 * Run the gate on the checked-out branch as a pull_request against the fixture
 * base. `override` replaces or, with `undefined`, removes a GitHub variable.
 */
function runGate(body: string, override: Readonly<Record<string, string | undefined>> = {}): Run {
  const eventPath = join(workspace, "event.json");
  writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7, body } }));
  const github: Record<string, string | undefined> = {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_BASE_REF: BASE_BRANCH,
    GITHUB_EVENT_PATH: eventPath,
    ...override,
  };
  const declared = Object.entries(github).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  const result = Bun.spawnSync(["bun", GATE], {
    cwd: clone,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      GATE_VERBOSE: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      ...Object.fromEntries(declared),
    },
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "pr-negatives-probe-"));
  upstream = join(workspace, "upstream");
  clone = join(workspace, "clone");
  git(workspace, ["init", "--quiet", "-b", BASE_BRANCH, upstream]);
  mkdirSync(join(upstream, "tools/quality"), { recursive: true });
  copyFileSync(DATA, join(upstream, "tools/quality/pr-negatives.v1.json"));
  mkdirSync(join(upstream, ".github/workflows"), { recursive: true });
  writeFileSync(join(upstream, ".github/workflows/ci.yml"), "name: ci\n");
  writeFileSync(join(upstream, "package.json"), BASE_PACKAGE);
  writeFileSync(join(upstream, "bun.lock"), '{ "lockfileVersion": 1 }\n');
  git(upstream, ["add", "-A"]);
  git(upstream, ["commit", "--quiet", "--no-gpg-sign", "-m", "fixture base"]);
  git(workspace, ["clone", "--quiet", `file://${upstream}`, clone]);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("this pull request's own shape", () => {
  test("it adds a workflow, so it cannot declare `workflow`", () => {
    branchWith("probe/own-shape", () => {
      write(".github/workflows/pr-negatives.yml", "name: pr-negatives\n");
      write("tools/quality/check-pr-negatives.ts", "export {};\n");
      const manifest = JSON.parse(readFileSync(join(clone, "package.json"), "utf8"));
      write("package.json", `${JSON.stringify({ ...manifest, scripts: { x: "y" } }, null, 2)}\n`);
    });
    const declared = runGate("Door: two-way\nNot-added: workflow");
    expect(declared.exitCode).toBe(1);
    expect(declared.stderr).toContain(
      "PR #7 description — Not-added workflow: contradicted by the diff — workflow file added: .github/workflows/pr-negatives.yml",
    );

    const truthful = runGate(
      "Door: two-way\nNot-added: dependency, schema, hosted-service, telemetry",
    );
    expect(truthful.exitCode).toBe(0);
    expect(truthful.stdout).toContain("diff: 3 changed path(s) examined (2 A, 1 M, 0 D, 0 T)");
    expect(truthful.stdout).toContain(
      "PR #7 description — Not-added dependency — no dependency entry added in 1 manifest(s) read",
    );
    expect(truthful.stdout).toContain(
      "PR #7 description — Not-added schema — no schema file added among 3 changed path(s)",
    );
  });
});

describe("the change set is git's own", () => {
  test("a devDependency added in package.json contradicts `dependency`", () => {
    branchWith("probe/dev-dependency", () => {
      const manifest = JSON.parse(readFileSync(join(clone, "package.json"), "utf8"));
      manifest.devDependencies["left-pad"] = "1.3.0";
      write("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
    });
    const run = runGate("Not-added: dependency");
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("dependency entry added: package.json: devDependencies.left-pad");
  });

  test("a textconv driver cannot hide the entry: contents are read as blobs", () => {
    // `git checkout` of the previous probe's branch is not needed: the head is
    // still probe/dev-dependency. The driver drops every line naming the new
    // entry, as a tool rewriting what git shows would.
    const driver = join(workspace, "hide-left-pad.sh");
    writeFileSync(driver, '#!/bin/sh\ngrep -v left-pad "$1"\n', { mode: 0o755 });
    write(".git/info/attributes", "package.json diff=hide\n");
    try {
      withConfig({ "diff.hide.textconv": driver }, () => {
        const run = runGate("Not-added: dependency");
        expect(run.exitCode).toBe(1);
        expect(run.stderr).toContain(
          "dependency entry added: package.json: devDependencies.left-pad",
        );
      });
    } finally {
      write(".git/info/attributes", "");
    }
  });

  test("only a lockfile modified: not an addition, and named", () => {
    branchWith("probe/lockfile-only", () => {
      write("bun.lock", '{ "lockfileVersion": 1, "packages": {} }\n');
    });
    const run = runGate("Not-added: dependency");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(
      "lockfile(s) modified without a manifest entry added, not judged an addition: bun.lock",
    );
  });

  test("a workflow renamed in, with rename detection configured, is still added", () => {
    branchWith("probe/renamed-workflow", () => {
      git(clone, ["mv", ".github/workflows/ci.yml", ".github/workflows/build.yml"]);
    });
    withConfig({ "diff.renames": "true" }, () => {
      const run = runGate("Not-added: workflow");
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("workflow file added: .github/workflows/build.yml");
    });
  });

  test("a head with no merge base fails instead of reading as an empty change", () => {
    git(clone, ["switch", "--quiet", "--orphan", "probe/orphan"]);
    write("README.md", "unrelated history\n");
    write("tools/quality/pr-negatives.v1.json", readFileSync(DATA, "utf8"));
    git(clone, ["add", "-A"]);
    git(clone, ["commit", "--quiet", "--no-gpg-sign", "-m", "orphan"]);
    const run = runGate("Not-added: schema");
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      `diff: unreadable, nothing verified: could not find the merge base of origin/${BASE_BRANCH} and HEAD`,
    );
  });

  test("no declaration: the diff is not needed, and the gate passes on the orphan head too", () => {
    const run = runGate("Door: two-way");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("diff not read: no negative declared");
  });
});

describe("the event", () => {
  test("a pull_request run without its event payload fails instead of reading an empty body", () => {
    const run = runGate("Not-added: schema", { GITHUB_EVENT_PATH: undefined });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("GITHUB_EVENT_PATH is unset on a pull_request run");
  });

  test("outside a pull_request run, the gate declares that it judged nothing", () => {
    const run = runGate("Not-added: schema", { GITHUB_EVENT_NAME: "push" });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(
      "PR negatives verified nothing, as declared: not a pull_request run",
    );
  });
});
