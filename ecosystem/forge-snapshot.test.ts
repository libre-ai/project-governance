import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex } from "./build-index";
import {
  countSchedules,
  type ForgeResult,
  type ForgeRunner,
  mergePages,
  runSnapshot,
  type SnapshotDependencies,
  type SnapshotOutcome,
} from "./forge-snapshot";

/**
 * Every expectation below is read from the lot brief, not from the module's
 * output: pages of arrays concatenate, protected branches come out sorted
 * whatever the API order, a single failing repository among three leaves the
 * output directory empty, a forge-tool failure exits 1 and cites the tool's
 * exit code, a response without a default branch interrupts, and an
 * out-of-perimeter repository is refused (exit 3) before any network call.
 */

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "forge-snapshot-"));
  created.push(dir);
  return dir;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

const ok = (body: unknown): ForgeResult => ({
  exitCode: 0,
  stdout: JSON.stringify(body),
  stderr: "",
});

const WORKFLOW_WITH_TWO_CRONS = [
  "on:",
  "  push:",
  "  schedule:",
  "    - cron: '0 3 * * *'",
  "    - cron: '0 4 * * 1'",
  "jobs: {}",
].join("\n");

interface FakeRepository {
  readonly info: ForgeResult;
  readonly branches: ForgeResult;
  readonly workflows: ForgeResult;
}

function healthy(defaultBranch: string): FakeRepository {
  return {
    info: ok([{ default_branch: defaultBranch }]),
    branches: ok([[{ name: "zeta" }, { name: "alpha" }], [{ name: defaultBranch }]]),
    workflows: ok({
      data: {
        repository: {
          object: {
            entries: [
              {
                name: "ci.yml",
                type: "blob",
                object: { text: WORKFLOW_WITH_TWO_CRONS, isBinary: false, isTruncated: false },
              },
              {
                name: "README.md",
                type: "blob",
                object: { text: "not a workflow", isBinary: false, isTruncated: false },
              },
            ],
          },
        },
      },
    }),
  };
}

/** A forge double keyed on the repository each call names; records every call. */
function fakeForge(repositories: Readonly<Record<string, FakeRepository>>): {
  readonly run: ForgeRunner;
  readonly calls: string[][];
} {
  const calls: string[][] = [];
  const run: ForgeRunner = async (args) => {
    calls.push([...args]);
    if (args[1] === "graphql") {
      const owner = args.find((arg) => arg.startsWith("owner="))?.slice("owner=".length);
      const name = args.find((arg) => arg.startsWith("name="))?.slice("name=".length);
      const repository = repositories[`${owner}/${name}`];
      if (repository === undefined) throw new Error(`unexpected graphql call: ${args.join(" ")}`);
      return repository.workflows;
    }
    const endpoint = args.find((arg) => arg.startsWith("repos/"));
    if (endpoint === undefined) throw new Error(`unexpected call: ${args.join(" ")}`);
    const [, owner, name, rest] = endpoint.split(/[/?]/);
    const repository = repositories[`${owner}/${name}`];
    if (repository === undefined) throw new Error(`unexpected repository: ${endpoint}`);
    return rest === "branches" ? repository.branches : repository.info;
  };
  return { run, calls };
}

const PERIMETER = new Map([
  ["org/one", "public"],
  ["org/two", "public"],
  ["org/three", "public"],
  ["org/hidden", "private"],
] as const);

function dependencies(run: ForgeRunner): SnapshotDependencies {
  return {
    run,
    perimeter: PERIMETER,
    now: () => new Date("2026-11-16T10:00:00.000Z"),
  };
}

describe("mergePages", () => {
  test("two pages of arrays are concatenated into one array", () => {
    expect(mergePages(JSON.stringify([[1, 2], [3]]))).toEqual([1, 2, 3]);
  });

  test("a single object page is returned as is", () => {
    expect(mergePages(JSON.stringify([{ default_branch: "x" }]))).toEqual({
      default_branch: "x",
    });
  });

  test("an empty response is an error, not an empty answer", () => {
    expect(() => mergePages("")).toThrow();
    expect(() => mergePages("[]")).toThrow();
  });

  test("an unexpected shape is an error", () => {
    expect(() => mergePages(JSON.stringify({ not: "pages" }))).toThrow();
    expect(() => mergePages(JSON.stringify([[1], { a: 1 }]))).toThrow();
    expect(() => mergePages(JSON.stringify([{ a: 1 }, { b: 2 }]))).toThrow();
    expect(() => mergePages("not json")).toThrow();
  });
});

describe("countSchedules", () => {
  test("counts every cron entry of a schedule trigger", () => {
    expect(countSchedules(WORKFLOW_WITH_TWO_CRONS)).toBe(2);
  });

  test("a workflow without schedule has none", () => {
    expect(countSchedules("on: push\njobs: {}\n")).toBe(0);
    expect(countSchedules("on: [push, pull_request]\njobs: {}\n")).toBe(0);
    expect(countSchedules("on:\n  push:\njobs: {}\n")).toBe(0);
  });

  test("an unexpected type is an error", () => {
    expect(() => countSchedules("on:\n  schedule: daily\n")).toThrow();
    expect(() => countSchedules("jobs: {}\n")).toThrow();
    expect(() => countSchedules("- just\n- a list\n")).toThrow();
    expect(() => countSchedules("on: [unclosed\n")).toThrow();
  });

  test("a duplicated `on` or `on.schedule` key is an error, not the last one read", () => {
    // Bun.YAML.parse keeps the last of two equal keys: the crons of the first would go uncounted.
    const twice = [
      "on:\n  schedule:\n    - cron: '0 1 * * *'\n  schedule:\n    - cron: '0 2 * * *'\njobs: {}\n",
      "on:\n  schedule:\n    - cron: '0 1 * * *'\n  'schedule':\n    - cron: '0 2 * * *'\n",
      "on:\n    \"schedule\":\n      - cron: '0 1 * * *'\n    schedule: []\n",
      "on:\n  schedule:\n    - cron: '0 1 * * *'\njobs: {}\non: push\n",
      "on: push\n\"on\":\n  schedule:\n    - cron: '0 1 * * *'\n",
    ];
    for (const text of twice) {
      expect(() => countSchedules(text)).toThrow(/duplicated/);
    }
  });

  test("a `schedule` key outside `on` is not a duplicate", () => {
    const text = [
      "on:",
      "  schedule:",
      "    - cron: '0 1 * * *'",
      "  workflow_dispatch:",
      "    inputs:",
      "      schedule:",
      "        description: x",
      "jobs:",
      "  schedule:",
      "    runs-on: x",
    ].join("\n");
    expect(countSchedules(text)).toBe(1);
  });
});

describe("runSnapshot", () => {
  test("writes one dated JSON per repository, protected branches sorted", async () => {
    const out = await scratch();
    const forge = fakeForge({ "org/one": healthy("served") });
    const result = await runSnapshot([out, "org/one"], dependencies(forge.run));
    expect(result.code).toBe(0);
    const written = JSON.parse(await readFile(join(out, "org", "one.json"), "utf8"));
    expect(written).toEqual({
      repository: "org/one",
      collected_at: "2026-11-16T10:00:00.000Z",
      default_branch: "served",
      protected_branches: ["alpha", "served", "zeta"],
      schedules: 2,
    });
    expect(result.stdout.join("\n")).toContain("requested=1 collected=1 written=1");
  });

  test("the workflow listing is read at the default branch the API reported", async () => {
    const out = await scratch();
    const forge = fakeForge({ "org/one": healthy("served") });
    await runSnapshot([out, "org/one"], dependencies(forge.run));
    const graphql = forge.calls.find((call) => call[1] === "graphql");
    expect(graphql).toContain("expression=served:.github/workflows");
  });

  test("one failing repository among three: no file appears", async () => {
    const out = await scratch();
    const forge = fakeForge({
      "org/one": healthy("served"),
      "org/two": {
        ...healthy("served"),
        branches: { exitCode: 1, stdout: "", stderr: "HTTP 502: Bad Gateway" },
      },
      "org/three": healthy("served"),
    });
    const result = await runSnapshot(
      [out, "org/one", "org/two", "org/three"],
      dependencies(forge.run),
    );
    expect(result.code).toBe(1);
    expect(await listFiles(out)).toEqual([]);
    expect(result.stdout.join("\n")).toContain(
      "requested=3 collected=1 failed=1 not_attempted=1 written=0",
    );
  });

  test("a forge-tool failure exits 1 and cites the tool's exit code", async () => {
    const out = await scratch();
    const forge = fakeForge({
      "org/one": {
        ...healthy("served"),
        info: { exitCode: 4, stdout: "", stderr: "authentication required" },
      },
    });
    const result = await runSnapshot([out, "org/one"], dependencies(forge.run));
    expect(result.code).toBe(1);
    expect(result.stderr.join("\n")).toContain("exit 4");
    expect(result.stderr.join("\n")).toContain("org/one");
  });

  test("a response without a default branch interrupts", async () => {
    const out = await scratch();
    const forge = fakeForge({
      "org/one": { ...healthy("served"), info: ok([{ name: "one" }]) },
      "org/two": healthy("served"),
    });
    const result = await runSnapshot([out, "org/one", "org/two"], dependencies(forge.run));
    expect(result.code).toBe(1);
    expect(await listFiles(out)).toEqual([]);
    expect(forge.calls.some((call) => call.some((arg) => arg.includes("two")))).toBe(false);
  });

  /** A workflow listing whose single `ci.yml` blob carries the given object. */
  function listingWith(blob: Record<string, unknown>): ForgeResult {
    return ok({
      data: {
        repository: {
          object: { entries: [{ name: "ci.yml", type: "blob", object: blob }] },
        },
      },
    });
  }

  async function interrupts(workflows: ForgeResult): Promise<SnapshotOutcome> {
    const out = await scratch();
    const forge = fakeForge({ "org/one": { ...healthy("served"), workflows } });
    const result = await runSnapshot([out, "org/one"], dependencies(forge.run));
    expect(result.code).toBe(1);
    expect(await listFiles(out)).toEqual([]);
    return result;
  }

  test("a partial GraphQL answer carrying errors interrupts, even with data present", async () => {
    // The data alone reads as "no workflow directory": only the errors say it was not read.
    await interrupts(
      ok({ data: { repository: { object: null } }, errors: [{ message: "partial" }] }),
    );
  });

  test("a truncated workflow interrupts, even when its text is otherwise complete", async () => {
    await interrupts(
      listingWith({ text: WORKFLOW_WITH_TWO_CRONS, isBinary: false, isTruncated: true }),
    );
  });

  test("a binary workflow interrupts", async () => {
    await interrupts(listingWith({ text: null, isBinary: true, isTruncated: false }));
  });

  test("a workflow holding a NUL interrupts and names the character", async () => {
    // Bun.YAML.parse may stop at a NUL without saying so: the cron after it would go uncounted.
    const text = `on:\n  schedule:\n    - cron: '0 3 * * *'\u0000\n    - cron: '0 4 * * 1'\n`;
    const result = await interrupts(listingWith({ text, isBinary: false, isTruncated: false }));
    expect(result.stderr.join("\n")).toContain("U+0000");
  });

  test("a malformed protected-branch or default-branch answer interrupts", async () => {
    for (const repository of [
      { ...healthy("served"), branches: ok([[{ name: "a" }, { protected: true }]]) },
      { ...healthy("served"), branches: ok([{ message: "x" }]) },
      { ...healthy("served"), info: ok([{ default_branch: "" }]) },
    ]) {
      const out = await scratch();
      const forge = fakeForge({ "org/one": repository });
      const result = await runSnapshot([out, "org/one"], dependencies(forge.run));
      expect(result.code).toBe(1);
      expect(await listFiles(out)).toEqual([]);
    }
  });

  /**
   * A write that fails after the first file: a name longer than any file
   * system accepts (ENAMETOOLONG), requested after one that writes fine.
   */
  async function failingMidWrite(out: string): Promise<SnapshotOutcome> {
    const tooLong = `org/${"a".repeat(300)}`;
    const forge = fakeForge({ "org/one": healthy("served"), [tooLong]: healthy("served") });
    return runSnapshot([out, "org/one", tooLong], {
      ...dependencies(forge.run),
      perimeter: new Map([
        ["org/one", "public"],
        [tooLong, "public"],
      ]),
    });
  }

  test("a write failure mid-way leaves a previous snapshot exactly as it was", async () => {
    const parent = await scratch();
    const out = join(parent, "snapshot");
    await mkdir(join(out, "org"), { recursive: true });
    await writeFile(join(out, "org", "old.json"), "previous\n");
    const result = await failingMidWrite(out);
    expect(result.code).toBe(1);
    expect(result.stdout.join("\n")).toContain("requested=2 collected=2 written=0");
    expect(await listFiles(out)).toEqual(["old.json"]);
    expect(await readFile(join(out, "org", "old.json"), "utf8")).toBe("previous\n");
    // No staging directory is left beside the output either.
    expect(await readdir(parent)).toEqual(["snapshot"]);
  });

  test("a write failure mid-way leaves an absent output absent", async () => {
    const parent = await scratch();
    const result = await failingMidWrite(join(parent, "snapshot"));
    expect(result.code).toBe(1);
    expect(await readdir(parent)).toEqual([]);
  });

  test("a new snapshot replaces the previous one whole", async () => {
    const parent = await scratch();
    const out = join(parent, "snapshot");
    await mkdir(join(out, "gone"), { recursive: true });
    await writeFile(join(out, "gone", "old.json"), "previous\n");
    const forge = fakeForge({ "org/one": healthy("served") });
    const result = await runSnapshot([out, "org/one"], dependencies(forge.run));
    expect(result.code).toBe(0);
    expect(await listFiles(out)).toEqual(["one.json"]);
    expect(await readdir(parent)).toEqual(["snapshot"]);
  });

  test("a link at or below the output directory is refused with 2 before any network call", async () => {
    const cases: Array<(out: string, outside: string) => Promise<void>> = [
      // The output directory itself is a link.
      async (out, outside) => symlink(outside, out),
      // An owner directory is a link.
      async (out, outside) => {
        await mkdir(out);
        await symlink(outside, join(out, "org"));
      },
      // A previous snapshot file is a link.
      async (out, outside) => {
        await mkdir(join(out, "org"), { recursive: true });
        await symlink(join(outside, "victim"), join(out, "org", "one.json"));
      },
    ];
    for (const plant of cases) {
      const parent = await scratch();
      const outside = await scratch();
      await writeFile(join(outside, "victim"), "untouched\n");
      const out = join(parent, "snapshot");
      await plant(out, outside);
      const forge = fakeForge({ "org/one": healthy("served") });
      const result = await runSnapshot([out, "org/one"], dependencies(forge.run));
      expect(result.code).toBe(2);
      expect(result.stderr.join("\n")).toContain("symbolic link");
      expect(forge.calls).toEqual([]);
      expect(await readdir(outside)).toEqual(["victim"]);
      expect(await readFile(join(outside, "victim"), "utf8")).toBe("untouched\n");
    }
  });

  test("an output directory holding anything but a previous snapshot is refused with 2", async () => {
    for (const plant of [
      (out: string) => writeFile(join(out, "notes.txt"), "mine\n"),
      async (out: string) => {
        await mkdir(join(out, "org"));
        await writeFile(join(out, "org", "notes.txt"), "mine\n");
      },
    ]) {
      const out = await scratch();
      await plant(out);
      const before = await listFiles(out);
      const forge = fakeForge({ "org/one": healthy("served") });
      const result = await runSnapshot([out, "org/one"], dependencies(forge.run));
      expect(result.code).toBe(2);
      expect(forge.calls).toEqual([]);
      expect(await listFiles(out)).toEqual(before);
    }
  });

  test("a confirmed absent workflow directory is zero schedules", async () => {
    const out = await scratch();
    const forge = fakeForge({
      "org/one": {
        ...healthy("served"),
        workflows: ok({ data: { repository: { object: null } } }),
      },
    });
    const result = await runSnapshot([out, "org/one"], dependencies(forge.run));
    expect(result.code).toBe(0);
    const written = JSON.parse(await readFile(join(out, "org", "one.json"), "utf8"));
    expect(written.schedules).toBe(0);
  });

  test("a private or unknown repository is refused with 3 before any network call", async () => {
    for (const repository of ["org/hidden", "org/elsewhere"]) {
      const out = await scratch();
      const forge = fakeForge({ "org/one": healthy("served") });
      const result = await runSnapshot([out, "org/one", repository], dependencies(forge.run));
      expect(result.code).toBe(3);
      expect(forge.calls).toEqual([]);
      expect(await listFiles(out)).toEqual([]);
    }
  });

  test("usage errors exit 2 without any network call", async () => {
    const out = await scratch();
    for (const argv of [
      [],
      [out],
      [out, "no-slash"],
      [out, "org/../escape"],
      [out, "../org/one"],
      [out, "org/one", "org/one"],
    ]) {
      const forge = fakeForge({ "org/one": healthy("served") });
      const result = await runSnapshot(argv, dependencies(forge.run));
      expect(result.code).toBe(2);
      expect(forge.calls).toEqual([]);
    }
  });
});

describe("forge-snapshot as a process", () => {
  /**
   * The command line, the real inventory and the exit code are decided in the
   * module's main block. A fake `gh` on a scrubbed PATH leaves a marker when it
   * is called: a refused repository must leave no marker.
   */
  async function runProcess(args: readonly string[]): Promise<{ code: number; marker: boolean }> {
    const bin = await scratch();
    const marker = join(bin, "gh-was-called");
    const fakeGh = join(bin, "gh");
    await writeFile(fakeGh, `#!/bin/sh\n: > '${marker}'\nexit 9\n`);
    await chmod(fakeGh, 0o755);
    const proc = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, "forge-snapshot.ts"), ...args],
      { env: { PATH: `${bin}:/usr/bin:/bin` }, stdout: "pipe", stderr: "pipe" },
    );
    const called = await readFile(marker).then(
      () => true,
      () => false,
    );
    return { code: proc.exitCode, marker: called };
  }

  test("a repository outside the inventory exits 3 and calls no forge", async () => {
    const out = await scratch();
    expect(await runProcess([out, "not-an-org/not-a-repo"])).toEqual({ code: 3, marker: false });
  });

  test("a private inventory repository exits 3 and calls no forge", async () => {
    const inventory = buildIndex(
      await readFile(join(import.meta.dir, "repositories.v1.yaml"), "utf8"),
    );
    const privateEntry = inventory.repositories.find((entry) => entry.visibility === "private");
    expect(privateEntry).toBeDefined();
    const out = await scratch();
    expect(await runProcess([out, String(privateEntry?.repository)])).toEqual({
      code: 3,
      marker: false,
    });
  });

  test("a forge failure on an inventory repository exits 1", async () => {
    const inventory = buildIndex(
      await readFile(join(import.meta.dir, "repositories.v1.yaml"), "utf8"),
    );
    const publicEntry = inventory.repositories.find((entry) => entry.visibility === "public");
    expect(publicEntry).toBeDefined();
    const out = await scratch();
    const result = await runProcess([out, String(publicEntry?.repository)]);
    expect(result).toEqual({ code: 1, marker: true });
    expect(await listFiles(out)).toEqual([]);
  });

  test("a missing argument exits 2", async () => {
    expect(await runProcess([])).toEqual({ code: 2, marker: false });
  });
});
