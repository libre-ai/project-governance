import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryEntry } from "./check-context-conformance";
import {
  ALLOWED_EVENTS,
  emptyTriggerTally,
  isWorkflowDefinition,
  reviewRepositoryTriggers,
  reviewTriggers,
  type ServedBranchResolver,
  servedBranchResolver,
  summarizeTriggerVolume,
  type TriggerTally,
} from "./check-workflow-triggers";
import type { BlobRead, FleetFileReader, TreeListing } from "./fleet-tree";

/** The branch the fixture repository serves; any name works, the gate resolves it. */
const SERVED = "trunk";
const OTHER = "legacy";

const JOBS = "jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: 'true'\n";

function workflow(on: string): string {
  return `name: sample\n${on}\n${JOBS}`;
}

describe("ALLOWED_EVENTS", () => {
  test("is exactly the six admitted events", () => {
    expect([...ALLOWED_EVENTS].sort()).toEqual([
      "pull_request",
      "pull_request_target",
      "push",
      "schedule",
      "workflow_call",
      "workflow_dispatch",
    ]);
  });
});

describe("isWorkflowDefinition", () => {
  test("selects workflow files at the top of .github/workflows only", () => {
    expect(isWorkflowDefinition(".github/workflows/ci.yml")).toBe(true);
    expect(isWorkflowDefinition(".github/workflows/ci.yaml")).toBe(true);
    expect(isWorkflowDefinition(".github/workflows/nested/ci.yml")).toBe(false);
    expect(isWorkflowDefinition(".github/actions/setup/action.yml")).toBe(false);
    expect(isWorkflowDefinition("docs/workflows/ci.yml")).toBe(false);
  });
});

describe("reviewTriggers: push without configuration", () => {
  test.each([
    ["string form", "on: push"],
    ["list form", "on: [push, pull_request]"],
    ["table form", "on: { push: null, pull_request: null }"],
    ["block table form", "on:\n  push:\n  pull_request:"],
    ["empty table form", "on:\n  push: {}\n  pull_request:"],
  ])("%s is rejected", (_label, on) => {
    const review = reviewTriggers(workflow(on), SERVED);
    expect(review.unreadable).toBeNull();
    expect(review.pushKind).toBe("rejected");
    expect(review.failures).toHaveLength(1);
    expect(review.failures[0]).toContain("carries no filter");
  });
});

describe("reviewTriggers: push.branches", () => {
  test("an extra literal next to the served branch is rejected, both named", () => {
    const review = reviewTriggers(
      workflow(`on:\n  push:\n    branches: [${SERVED}, ${OTHER}]\n  pull_request:`),
      SERVED,
    );
    expect(review.pushKind).toBe("rejected");
    expect(review.failures).toEqual([
      `\`push.branches\` entry \`${OTHER}\` is not the served branch \`${SERVED}\``,
    ]);
  });

  test("another literal alone is rejected", () => {
    const review = reviewTriggers(workflow(`on:\n  push:\n    branches: [${OTHER}]`), SERVED);
    expect(review.pushKind).toBe("rejected");
    expect(review.failures).toHaveLength(1);
    expect(review.failures[0]).toContain(`\`${OTHER}\``);
    expect(review.failures[0]).toContain(`\`${SERVED}\``);
  });

  test("the served branch listed twice is rejected: exactly one entry is admitted", () => {
    const review = reviewTriggers(
      workflow(`on:\n  push:\n    branches: [${SERVED}, ${SERVED}]`),
      SERVED,
    );
    expect(review.pushKind).toBe("rejected");
    expect(review.failures[0]).toContain("carries 2 entries");
  });

  test.each([
    ["without paths", ""],
    ["with paths", "\n    paths: ['docs/**']"],
    ["with paths-ignore and tags", "\n    paths-ignore: ['docs/**']\n    tags: ['v*']"],
  ])("the served branch alone, with pull_request, is admitted %s", (_label, extra) => {
    const review = reviewTriggers(
      workflow(`on:\n  push:\n    branches: [${SERVED}]${extra}\n  pull_request:`),
      SERVED,
    );
    expect(review).toEqual({
      events: ["push", "pull_request"],
      pushKind: "served-branch",
      failures: [],
      unreadable: null,
    });
  });

  test("the served branch written as a scalar is admitted", () => {
    const review = reviewTriggers(workflow(`on:\n  push:\n    branches: ${SERVED}`), SERVED);
    expect(review.pushKind).toBe("served-branch");
  });

  test("a glob is rejected and named", () => {
    const review = reviewTriggers(workflow("on:\n  push:\n    branches: ['**']"), SERVED);
    expect(review.pushKind).toBe("rejected");
    expect(review.failures).toHaveLength(1);
    expect(review.failures[0]).toContain("`**` is a glob pattern");
  });

  test.each([
    ["alone", ""],
    ["next to a tag filter", "\n    tags: ['v*']"],
  ])("branches-ignore is rejected %s", (_label, extra) => {
    const review = reviewTriggers(
      workflow(`on:\n  push:\n    branches-ignore: [${OTHER}]${extra}`),
      SERVED,
    );
    expect(review.pushKind).toBe("rejected");
    expect(review.failures).toHaveLength(1);
    expect(review.failures[0]).toContain("`push.branches-ignore` runs on every branch");
  });

  test("the served branch is compared byte for byte", () => {
    const review = reviewTriggers(
      workflow(`on:\n  push:\n    branches: [${SERVED.toUpperCase()}]`),
      SERVED,
    );
    expect(review.pushKind).toBe("rejected");
  });
});

describe("reviewTriggers: push without branches", () => {
  test("paths alone is rejected", () => {
    const review = reviewTriggers(workflow("on:\n  push:\n    paths: ['docs/**']"), SERVED);
    expect(review.pushKind).toBe("rejected");
    expect(review.failures).toHaveLength(1);
    expect(review.failures[0]).toContain("neither `branches` nor `tags`");
  });

  test.each([
    ["tags", "tags: ['v*']"],
    ["tags-ignore", "tags-ignore: ['nightly-*']"],
  ])("%s alone is admitted as tag-only", (_label, filter) => {
    const review = reviewTriggers(workflow(`on:\n  push:\n    ${filter}`), SERVED);
    expect(review.pushKind).toBe("tag-only");
    expect(review.failures).toEqual([]);
  });
});

describe("reviewTriggers: events", () => {
  test.each([["workflow_run"], ["create"]])("%s is rejected and named", (event) => {
    const review = reviewTriggers(workflow(`on: [pull_request, ${event}]`), SERVED);
    expect(review.pushKind).toBe("none");
    expect(review.failures).toHaveLength(1);
    expect(review.failures[0]).toContain(`event \`${event}\` is not admitted`);
  });

  test("every admitted event without a push is green", () => {
    const review = reviewTriggers(
      workflow(
        "on:\n  pull_request:\n  pull_request_target:\n  schedule:\n    - cron: '0 3 * * *'\n  workflow_dispatch:\n  workflow_call:",
      ),
      SERVED,
    );
    expect(review.failures).toEqual([]);
    expect(review.pushKind).toBe("none");
    expect(review.events).toHaveLength(5);
  });

  test("the keys on and 'on' give the same review", () => {
    const body = `:\n  push:\n    branches: [${SERVED}, ${OTHER}]\n  pull_request:\n  create:`;
    const bare = reviewTriggers(workflow(`on${body}`), SERVED);
    const quoted = reviewTriggers(workflow(`'on'${body}`), SERVED);
    expect(quoted).toEqual(bare);
    expect(bare.events).toEqual(["push", "pull_request", "create"]);
    expect(bare.failures).toHaveLength(2);
  });

  test("a document without on, a non-mapping and broken YAML are unreadable", () => {
    expect(reviewTriggers(`name: sample\n${JOBS}`, SERVED).unreadable).toContain("`on` is absent");
    expect(reviewTriggers("- a\n- b\n", SERVED).unreadable).toContain("not a YAML mapping");
    expect(reviewTriggers("on: [push\n", SERVED).unreadable).toContain("YAML parse failed");
    expect(reviewTriggers("on: []\n", SERVED).unreadable).toContain("declares no event");
  });
});

describe("reviewTriggers: job conditions", () => {
  const guarded = (indent: "job" | "step", expression: string, on: string): string =>
    indent === "job"
      ? `${on}\njobs:\n  build:\n    if: ${expression}\n    runs-on: ubuntu-latest\n    steps:\n      - run: 'true'\n`
      : `${on}\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - if: ${expression}\n        run: 'true'\n`;

  test.each([
    ["github.event_name", "github.event_name == 'push'"],
    ["github.ref", `github.ref == 'refs/heads/${SERVED}'`],
  ])("a job if: reading %s is rejected under pull_request", (name, expression) => {
    const review = reviewTriggers(guarded("job", expression, "on: pull_request"), SERVED);
    expect(review.failures).toHaveLength(1);
    expect(review.failures[0]).toContain("job `build`");
    expect(review.failures[0]).toContain(`\`${name}\``);
  });

  test("the same condition is rejected under pull_request_target", () => {
    const review = reviewTriggers(
      guarded("job", "github.event_name == 'push'", "on: pull_request_target"),
      SERVED,
    );
    expect(review.failures).toHaveLength(1);
  });

  test("the same condition on a step is not judged", () => {
    const review = reviewTriggers(
      guarded("step", "github.event_name == 'push'", "on: pull_request"),
      SERVED,
    );
    expect(review.failures).toEqual([]);
  });

  test("a job condition is not judged without a pull-request trigger", () => {
    const review = reviewTriggers(
      guarded("job", "github.event_name == 'push'", "on: workflow_dispatch"),
      SERVED,
    );
    expect(review.failures).toEqual([]);
  });

  test("a job condition reading another context is green", () => {
    const review = reviewTriggers(
      guarded(
        "job",
        "github.ref_name != 'x' && github.repository_owner == 'y'",
        "on: pull_request",
      ),
      SERVED,
    );
    expect(review.failures).toEqual([]);
  });
});

function reader(listing: TreeListing, files: Record<string, BlobRead>): FleetFileReader {
  return async () => ({ listing, files: new Map(Object.entries(files)) });
}

function countingReader(inner: FleetFileReader): { read: FleetFileReader; calls: () => number } {
  let calls = 0;
  return {
    read: async (repository, select) => {
      calls++;
      return inner(repository, select);
    },
    calls: () => calls,
  };
}

function countingResolver(inner: ServedBranchResolver): {
  resolve: ServedBranchResolver;
  calls: () => number;
} {
  let calls = 0;
  return {
    resolve: async (repository) => {
      calls++;
      return inner(repository);
    },
    calls: () => calls,
  };
}

const resolved: ServedBranchResolver = async () => ({ kind: "resolved", branch: SERVED });

const active: RegistryEntry = {
  repository: "example/sample",
  role: "satellite",
  layer: "couche-1",
  lifecycle: "active",
  visibility: "public",
};

const CI = ".github/workflows/ci.yml";
const GREEN = workflow(`on:\n  push:\n    branches: [${SERVED}]\n  pull_request:`);

describe("reviewRepositoryTriggers", () => {
  test("green: one line per workflow, events listed, counters filled", async () => {
    const tally = emptyTriggerTally();
    const checks = await reviewRepositoryTriggers(
      active,
      tally,
      reader(
        { kind: "listed", paths: [CI, ".github/workflows/release.yaml", "README.md"] },
        {
          [CI]: { kind: "text", text: GREEN },
          ".github/workflows/release.yaml": {
            kind: "text",
            text: workflow("on:\n  push:\n    tags: ['v*']"),
          },
        },
      ),
      resolved,
    );
    expect(checks).toEqual([
      {
        item: `example/sample:${CI}`,
        ok: true,
        note: `events: push, pull_request (served branch ${SERVED})`,
      },
      {
        item: "example/sample:.github/workflows/release.yaml",
        ok: true,
        note: `events: push (served branch ${SERVED})`,
      },
    ]);
    expect(tally).toEqual({
      repositories: 1,
      exempt: 0,
      unresolved: 0,
      filesTracked: 2,
      filesExamined: 2,
      filesUnreadable: 0,
      pushServed: 1,
      pushTagOnly: 1,
      pushRejected: 0,
      violations: 0,
    });
  });

  test("red: the resolved branch is the one compared, and the note names the gaps", async () => {
    const tally = emptyTriggerTally();
    const checks = await reviewRepositoryTriggers(
      active,
      tally,
      reader({ kind: "listed", paths: [CI] }, { [CI]: { kind: "text", text: GREEN } }),
      async () => ({ kind: "resolved", branch: OTHER }),
    );
    expect(checks).toEqual([
      {
        item: `example/sample:${CI}`,
        ok: false,
        note: `\`push.branches\` entry \`${SERVED}\` is not the served branch \`${OTHER}\``,
      },
    ]);
    expect(tally).toMatchObject({
      filesExamined: 1,
      pushRejected: 1,
      pushServed: 0,
      violations: 1,
    });
  });

  test("an unreadable served branch fails the repository and reads no file", async () => {
    const tally = emptyTriggerTally();
    const files = countingReader(
      reader({ kind: "listed", paths: [CI] }, { [CI]: { kind: "text", text: GREEN } }),
    );
    const checks = await reviewRepositoryTriggers(active, tally, files.read, async () => ({
      kind: "unreadable",
      reason: "remote hung up",
    }));
    expect(checks).toHaveLength(1);
    expect(checks[0]?.item).toBe("example/sample");
    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.note).toContain("remote hung up");
    expect(files.calls()).toBe(0);
    expect(tally).toMatchObject({ repositories: 1, unresolved: 1, filesTracked: 0 });
  });

  test("an unreadable tree fails", async () => {
    const checks = await reviewRepositoryTriggers(
      active,
      emptyTriggerTally(),
      reader({ kind: "unreadable", reason: "HTTP 502" }, {}),
      resolved,
    );
    expect(checks).toEqual([
      { item: "example/sample", ok: false, note: "tree unreadable at HEAD: HTTP 502" },
    ]);
  });

  test("an unreadable file, a missing read and unparsable YAML fail and are counted unreadable", async () => {
    const tally = emptyTriggerTally();
    const paths = [CI, ".github/workflows/b.yml", ".github/workflows/c.yml"];
    const checks = await reviewRepositoryTriggers(
      active,
      tally,
      reader(
        { kind: "listed", paths },
        {
          [CI]: { kind: "unreadable", reason: "truncated" },
          ".github/workflows/c.yml": { kind: "text", text: "on: [push\n" },
        },
      ),
      resolved,
    );
    expect(checks.map((check) => check.ok)).toEqual([false, false, false]);
    expect(checks[0]?.note).toBe("unreadable at HEAD: truncated");
    expect(checks[1]?.note).toBe("unreadable at HEAD: no read outcome recorded");
    expect(checks[2]?.note).toContain("unreadable: YAML parse failed");
    expect(tally).toMatchObject({ filesTracked: 3, filesExamined: 0, filesUnreadable: 3 });
  });

  test.each([
    ["private", { ...active, visibility: "private" as const }],
    ["archived", { ...active, lifecycle: "archived" }],
  ])("a %s entry is exempt, counted, and nothing is called", async (_label, entry) => {
    const tally = emptyTriggerTally();
    const files = countingReader(reader({ kind: "listed", paths: [] }, {}));
    const branch = countingResolver(resolved);
    const checks = await reviewRepositoryTriggers(entry, tally, files.read, branch.resolve);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.ok).toBe(true);
    expect(checks[0]?.note).toStartWith("exempt: ");
    expect(files.calls()).toBe(0);
    expect(branch.calls()).toBe(0);
    expect(tally).toMatchObject({ repositories: 0, exempt: 1 });
  });

  test("a repository without workflow is recorded, not skipped", async () => {
    const checks = await reviewRepositoryTriggers(
      active,
      emptyTriggerTally(),
      reader({ kind: "listed", paths: ["README.md"] }, {}),
      resolved,
    );
    expect(checks).toEqual([{ item: "example/sample", ok: true, note: "no workflow tracked" }]);
  });

  test("counters sum to the universe over a mixed fleet", async () => {
    const tally = emptyTriggerTally();
    const fleet: RegistryEntry[] = [
      { ...active, repository: "example/green" },
      { ...active, repository: "example/red" },
      { ...active, repository: "example/unresolved" },
      { ...active, repository: "example/private", visibility: "private" },
      { ...active, repository: "example/archived", lifecycle: "archived" },
    ];
    const trees: Record<string, Record<string, BlobRead>> = {
      "example/green": {
        [CI]: { kind: "text", text: GREEN },
        ".github/workflows/tag.yml": {
          kind: "text",
          text: workflow("on:\n  push:\n    tags: [v1]"),
        },
      },
      "example/red": {
        [CI]: { kind: "text", text: workflow("on: [push, create]") },
        ".github/workflows/b.yml": { kind: "unreadable", reason: "binary" },
        ".github/workflows/c.yml": { kind: "text", text: workflow("on: workflow_dispatch") },
      },
    };
    const read: FleetFileReader = async (repository) => {
      const files = trees[repository] ?? {};
      return {
        listing: { kind: "listed", paths: Object.keys(files) },
        files: new Map(Object.entries(files)),
      };
    };
    const resolve: ServedBranchResolver = async (repository) =>
      repository === "example/unresolved"
        ? { kind: "unreadable", reason: "no symbolic HEAD" }
        : { kind: "resolved", branch: SERVED };
    const checks = [];
    for (const entry of fleet) {
      checks.push(...(await reviewRepositoryTriggers(entry, tally, read, resolve)));
    }
    expect(tally).toEqual({
      repositories: 3,
      exempt: 2,
      unresolved: 1,
      filesTracked: 5,
      filesExamined: 4,
      filesUnreadable: 1,
      pushServed: 1,
      pushTagOnly: 1,
      pushRejected: 1,
      violations: 2,
    });
    expect(tally.repositories + tally.exempt).toBe(fleet.length);
    expect(tally.filesExamined + tally.filesUnreadable).toBe(tally.filesTracked);
    expect(checks.filter((check) => !check.ok)).toHaveLength(3);
  });
});

describe("summarizeTriggerVolume", () => {
  test("prints the ten counters and the three sums", () => {
    const tally: TriggerTally = {
      repositories: 19,
      exempt: 5,
      unresolved: 2,
      filesTracked: 113,
      filesExamined: 110,
      filesUnreadable: 3,
      pushServed: 41,
      pushTagOnly: 7,
      pushRejected: 13,
      violations: 17,
    };
    expect(summarizeTriggerVolume(tally)).toBe(
      "24 inventory entries (19 read, 5 exempt), 2 with an unreadable served branch: 113 tracked workflow(s) = 110 examined + 3 unreadable, 61 push trigger(s) = 41 on the served branch + 7 tag-only + 13 rejected, 17 rule violation(s)",
    );
  });
});

describe("served branch resolution against a local git repository", () => {
  let root = "";

  function git(directory: string, args: readonly string[], stdin = ""): string {
    const ran = Bun.spawnSync(["git", "-C", directory, ...args], {
      stdin: Buffer.from(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (ran.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${ran.stderr.toString()}`);
    }
    return ran.stdout.toString().trim();
  }

  function init(name: string): string {
    const directory = join(root, name);
    const made = Bun.spawnSync(["git", "init", "-q", directory]);
    if (made.exitCode !== 0) throw new Error(`git init failed: ${made.stderr.toString()}`);
    git(directory, ["config", "user.name", "t"]);
    git(directory, ["config", "user.email", "t@t"]);
    return directory;
  }

  /** A commit made by plumbing: no hook, no editor, no signing. */
  function commit(directory: string): string {
    const tree = git(directory, ["hash-object", "-t", "tree", "-w", "--stdin"]);
    return git(directory, ["commit-tree", tree, "-m", "fixture"]);
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "workflow-triggers-"));
    const serving = init("serving");
    git(serving, ["update-ref", `refs/heads/${SERVED}`, commit(serving)]);
    git(serving, ["symbolic-ref", "HEAD", `refs/heads/${SERVED}`]);
    const detached = init("detached");
    const sha = commit(detached);
    git(detached, ["update-ref", `refs/heads/${OTHER}`, sha]);
    git(detached, ["update-ref", "--no-deref", "HEAD", sha]);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const local = servedBranchResolver((repository) => join(root, repository));

  test("the symbolic HEAD of the remote is the served branch", async () => {
    expect(await local("serving")).toEqual({ kind: "resolved", branch: SERVED });
  });

  test("a remote without a symbolic HEAD is unreadable", async () => {
    const served = await local("detached");
    expect(served.kind).toBe("unreadable");
    expect(served.kind === "unreadable" ? served.reason : "").toContain("no symbolic HEAD");
  });

  test("a remote that cannot be reached is unreadable, with the exit code", async () => {
    const served = await local("absent");
    expect(served.kind).toBe("unreadable");
    expect(served.kind === "unreadable" ? served.reason : "").toMatch(/exited \d+/);
  });
});
