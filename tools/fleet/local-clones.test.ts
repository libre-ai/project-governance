import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIndex } from "../../ecosystem/build-index";
import type { GitResult, LocalClonesIo } from "./local-clones";
import { runGitProcess, runLocalClones } from "./local-clones";

// ---------------------------------------------------------------- fixtures

const scratch: string[] = [];

/** A fresh canonical directory: the tool refuses a root reached through a link. */
function freshDirectory(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "local-clones-")));
  scratch.push(directory);
  return directory;
}

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

interface Declared {
  readonly slug: string;
  readonly lifecycle?: "active" | "archived";
  readonly isPrivate?: boolean;
}

/** The one private shape the inventory reader admits. */
const PRIVATE_ENTRY: Declared = { slug: "libre-ai/product-research", isPrivate: true };

function inventory(entries: readonly Declared[]): string {
  const lines = ["schema_version: test.v1", "updated_on: 2026-01-01", "repositories:"];
  for (const entry of entries) {
    lines.push(
      `  - repository: ${JSON.stringify(entry.slug)}`,
      `    role: ${entry.isPrivate ? "administrative-private" : "satellite"}`,
      "    layer: transverse",
      `    visibility: ${entry.isPrivate ? "private" : "public"}`,
      `    lifecycle: ${entry.lifecycle ?? "active"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

interface Call {
  readonly args: readonly string[];
  readonly cwd: string | null;
}

interface Run {
  readonly code: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
  readonly calls: readonly Call[];
  readonly inventoryReads: number;
}

type Git = LocalClonesIo["runGit"];

const succeed: Git = async () => ({ code: 0, stdout: "", stderr: "" });

const counters = (line: string): Map<string, number> =>
  new Map(
    [...line.matchAll(/([a-z-]+)=(\d+)/g)].map((match) => [match[1] as string, Number(match[2])]),
  );

const sumOf = (values: Map<string, number>, skip: string): number =>
  [...values].reduce((sum, [key, value]) => (key === skip ? sum : sum + value), 0);

/**
 * Runs the command with recording doors. Whenever a counter line was printed,
 * its parts must sum to `declared`, and the categories to `examined`: the
 * property holds for every run of this file, not for one dedicated test.
 */
async function run(
  argv: readonly string[],
  text: string | (() => string),
  git: Git = succeed,
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Call[] = [];
  let inventoryReads = 0;
  const code = await runLocalClones(argv, {
    runGit: async (args, cwd) => {
      calls.push({ args, cwd });
      return git(args, cwd);
    },
    remoteUrl: (slug) => `test://remote/${slug}`,
    readInventory: () => {
      inventoryReads += 1;
      return typeof text === "string" ? text : text();
    },
    say: (line) => out.push(line),
    warn: (line) => err.push(line),
  });
  const total = out.find((line) => line.startsWith("declared="));
  if (total !== undefined) {
    const parts = counters(total);
    expect(sumOf(parts, "declared")).toBe(parts.get("declared") as number);
    const categories = out.find((line) => line.startsWith("categories: "));
    if (categories !== undefined) {
      expect(sumOf(counters(categories), "")).toBe(parts.get("examined") as number);
    }
  }
  return { code, out, err, calls, inventoryReads };
}

/** Every path under a directory with a digest of its content, `.git` included. */
function snapshot(directory: string): Map<string, string> {
  const seen = new Map<string, string>();
  const walk = (current: string, relative: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const key = relative === "" ? name : `${relative}/${name}`;
      const entry = lstatSync(path);
      if (entry.isSymbolicLink()) {
        seen.set(key, `link:${readlinkSync(path)}`);
      } else if (entry.isDirectory()) {
        seen.set(key, "directory");
        walk(path, key);
      } else {
        seen.set(key, createHash("sha256").update(readFileSync(path)).digest("hex"));
      }
    }
  };
  walk(directory, "");
  return seen;
}

/** A directory that looks like a clone to the tool: it carries its own `.git` directory. */
function fakeClone(root: string, name: string): void {
  mkdirSync(join(root, name, ".git"), { recursive: true });
}

/** Git for building fixtures, away from the configuration of the machine. */
function fixtureGit(cwd: string, ...args: string[]): string {
  const env: Record<string, string> = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  const child = Bun.spawnSync(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (child.exitCode !== 0) {
    throw new Error(`fixture git ${args.join(" ")} failed: ${child.stderr.toString()}`);
  }
  return child.stdout.toString().trim();
}

function identify(repository: string): void {
  fixtureGit(repository, "config", "user.name", "t");
  fixtureGit(repository, "config", "user.email", "t@t");
}

function commitFile(repository: string, file: string, content: string): void {
  writeFileSync(join(repository, file), content);
  fixtureGit(repository, "add", file);
  fixtureGit(repository, "commit", "-q", "-m", `add ${file}`);
}

// ------------------------------------------------------------------- usage

describe("usage and root", () => {
  const text = inventory([{ slug: "t/alpha" }]);

  const refused = async (argv: readonly string[], cause: string): Promise<void> => {
    const result = await run(argv, text);
    expect(result.code).toBe(2);
    expect(result.err[0]).toStartWith(`cause=${cause} `);
    expect(result.calls).toEqual([]);
    expect(result.inventoryReads).toBe(0);
    expect(result.out).toEqual([]);
  };

  test("--root is required and has no default", async () => {
    await refused(["clone"], "usage");
    await refused(["audit"], "usage");
    await refused(["clone", "--root"], "usage");
  });

  test("an unknown verb, an unknown flag and audit --dry-run are usage errors", async () => {
    const root = freshDirectory();
    await refused([], "usage");
    await refused(["update", "--root", root], "usage");
    await refused(["clone", "--root", root, "--force"], "usage");
    await refused(["clone", `--root=${root}`], "usage");
    await refused(["audit", "--root", root, "--dry-run"], "usage");
    await refused(["clone", "--root", root, "--root", root], "usage");
    expect(readdirSync(root)).toEqual([]);
  });

  test("a relative, missing, non-directory or non-canonical root is refused", async () => {
    const root = freshDirectory();
    writeFileSync(join(root, "file"), "");
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "link"));
    await refused(
      ["clone", "--root", "relative/root"],
      "invalid-root the root must be an absolute",
    );
    await refused(["clone", "--root", join(root, "missing")], "invalid-root");
    await refused(["audit", "--root", join(root, "file")], "invalid-root");
    await refused(["clone", "--root", join(root, "link")], "invalid-root");
    await refused(["clone", "--root", `${root}/real/`], "invalid-root");
    await refused(["clone", "--root", `${root}/real/../real`], "invalid-root");
    expect(readdirSync(join(root, "real"))).toEqual([]);
  });

  test("flags are accepted in any order after the verb", async () => {
    const root = freshDirectory();
    const result = await run(["clone", "--dry-run", "--root", root], text);
    expect(result.code).toBe(0);
    expect(result.out).toContain("+ would-clone t/alpha -> alpha");
  });

  test("a root carrying the composition receipt is neither read nor written", async () => {
    for (const verb of ["clone", "audit"]) {
      const root = freshDirectory();
      writeFileSync(join(root, ".composition-state.json"), "{}");
      fakeClone(root, "alpha");
      const before = snapshot(root);
      const result = await run([verb, "--root", root], text);
      expect(result.code).toBe(1);
      expect(result.err[0]).toStartWith("cause=composition-root ");
      expect(result.calls).toEqual([]);
      expect(result.out).toEqual([]);
      expect(snapshot(root)).toEqual(before);
    }
  });
});

describe("inventory", () => {
  const unreadable = async (text: string | (() => string)): Promise<void> => {
    for (const verb of ["clone", "audit"]) {
      const root = freshDirectory();
      const result = await run([verb, "--root", root], text);
      expect(result.code).toBe(1);
      expect(result.err).toHaveLength(1);
      expect(result.err[0]).toStartWith("cause=inventory-unreadable ");
      expect(result.calls).toEqual([]);
      expect(result.out.filter((line) => line.startsWith("declared="))).toEqual([]);
      expect(readdirSync(root)).toEqual([]);
    }
  };

  test("invalid YAML is a failure, not an empty list", async () => {
    await unreadable("repositories: [\n");
  });

  test("an empty sequence is a failure", async () => {
    await unreadable("schema_version: test.v1\nupdated_on: 2026-01-01\nrepositories: []\n");
  });

  test("a read that throws is a failure", async () => {
    await unreadable(() => {
      throw new Error("no such file");
    });
  });

  test("a NUL that would cut the list short is a failure", async () => {
    const whole = inventory([{ slug: "t/alpha" }, { slug: "t/beta" }]);
    await unreadable(whole.replace("lifecycle: active\n", "lifecycle: active\0\n"));
  });
});

// ------------------------------------------------------------------- clone

describe("clone", () => {
  test("three targets, one present: two clones, no branch named", async () => {
    const root = freshDirectory();
    fakeClone(root, "beta");
    const result = await run(
      ["clone", "--root", root],
      inventory([{ slug: "t/alpha" }, { slug: "t/beta" }, { slug: "t/gamma" }]),
    );
    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      "+ clone t/alpha -> alpha",
      "= beta present",
      "+ clone t/gamma -> gamma",
      "declared=3 cloned=2 present=1 occupied=0 archived=0 private=0 unsafe=0 failed=0",
    ]);
    expect(result.calls).toEqual([
      { args: ["clone", "--", "test://remote/t/alpha", join(root, "alpha")], cwd: null },
      { args: ["clone", "--", "test://remote/t/gamma", join(root, "gamma")], cwd: null },
    ]);
    expect(snapshot(join(root, "beta"))).toEqual(new Map([[".git", "directory"]]));
  });

  test("an entry named .github is a valid target under the root", async () => {
    const root = freshDirectory();
    const result = await run(["clone", "--root", root], inventory([{ slug: "t/.github" }]));
    expect(result.code).toBe(0);
    expect(result.calls.map((call) => call.args.at(-1))).toEqual([join(root, ".github")]);
    expect(result.out).toContain("+ clone t/.github -> .github");
  });

  test("a slug with a dot segment is unsafe: never cloned, nothing leaves the root", async () => {
    const base = freshDirectory();
    const root = join(base, "root");
    mkdirSync(root);
    const before = snapshot(base);
    const result = await run(
      ["clone", "--root", root],
      inventory([{ slug: "g/../x" }, { slug: "t/alpha" }]),
    );
    expect(result.code).toBe(1);
    expect(result.err).toEqual(['cause=unsafe-path "g/../x" is not two plain segments']);
    expect(result.calls.map((call) => call.args.at(-1))).toEqual([join(root, "alpha")]);
    expect(result.out.at(-1)).toBe(
      "declared=2 cloned=1 present=0 occupied=0 archived=0 private=0 unsafe=1 failed=0",
    );
    expect(snapshot(base)).toEqual(before);
  });

  test("every slug that is not two plain segments is unsafe", async () => {
    const root = freshDirectory();
    const slugs = ["a", "a/b/c", "a/..", "a/.", "a/.git", "../a", "a/b c", "/b", "a/b\\c"];
    const result = await run(["clone", "--root", root], inventory(slugs.map((slug) => ({ slug }))));
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.out.at(-1)).toBe(
      `declared=${slugs.length} cloned=0 present=0 occupied=0 archived=0 private=0 unsafe=${slugs.length} failed=0`,
    );
  });

  test("a path holding a .git file (a worktree) is occupied and left as it is", async () => {
    const root = freshDirectory();
    mkdirSync(join(root, "alpha"));
    writeFileSync(join(root, "alpha", ".git"), "gitdir: elsewhere\n");
    const before = snapshot(root);
    const result = await run(["clone", "--root", root], inventory([{ slug: "t/alpha" }]));
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.out).toEqual([
      "! alpha occupied",
      "declared=1 cloned=0 present=0 occupied=1 archived=0 private=0 unsafe=0 failed=0",
    ]);
    expect(result.err[0]).toStartWith("cause=occupied-path alpha ");
    expect(snapshot(root)).toEqual(before);
  });

  test("a file, a link and a directory without .git are occupied, by clone and by audit", async () => {
    const root = freshDirectory();
    writeFileSync(join(root, "alpha"), "");
    fakeClone(root, "elsewhere");
    symlinkSync(join(root, "elsewhere"), join(root, "beta"));
    mkdirSync(join(root, "gamma"));
    const text = inventory([{ slug: "t/alpha" }, { slug: "t/beta" }, { slug: "t/gamma" }]);
    const before = snapshot(root);
    const cloned = await run(["clone", "--root", root], text);
    expect(cloned.code).toBe(1);
    expect(cloned.out.at(-1)).toBe(
      "declared=3 cloned=0 present=0 occupied=3 archived=0 private=0 unsafe=0 failed=0",
    );
    const audited = await run(["audit", "--root", root], text);
    expect(audited.code).toBe(1);
    expect(audited.out).toContain(
      "declared=3 examined=0 absent=0 occupied=3 archived=0 private=0 unsafe=0",
    );
    expect(cloned.calls.concat(audited.calls)).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  test("two slugs ending in one name: the second is occupied, not a second clone", async () => {
    const root = freshDirectory();
    const result = await run(
      ["clone", "--root", root],
      inventory([{ slug: "t/alpha" }, { slug: "u/Alpha" }]),
    );
    expect(result.code).toBe(1);
    expect(result.calls).toHaveLength(1);
    expect(result.out.at(-1)).toBe(
      "declared=2 cloned=1 present=0 occupied=1 archived=0 private=0 unsafe=0 failed=0",
    );
  });

  test("a clone that fails is counted and the next targets are still tried", async () => {
    const root = freshDirectory();
    let attempt = 0;
    const result = await run(
      ["clone", "--root", root],
      inventory([{ slug: "t/alpha" }, { slug: "t/beta" }, { slug: "t/gamma" }]),
      async () => {
        attempt += 1;
        if (attempt === 1)
          return { code: 128, stdout: "", stderr: "fatal: no\u0007 such remote\n" };
        if (attempt === 2) throw new Error("git is not installed");
        return { code: 0, stdout: "", stderr: "" };
      },
    );
    expect(result.code).toBe(1);
    expect(result.calls).toHaveLength(3);
    expect(result.out).toEqual([
      "! alpha failed",
      "! beta failed",
      "+ clone t/gamma -> gamma",
      "declared=3 cloned=1 present=0 occupied=0 archived=0 private=0 unsafe=0 failed=2",
    ]);
    expect(result.err).toEqual([
      "cause=clone-failed alpha: git exited 128: fatal: no? such remote",
      "cause=clone-failed beta: git is not installed",
    ]);
  });

  test("a single failed clone gives failed=1 and exit 1", async () => {
    const root = freshDirectory();
    const result = await run(
      ["clone", "--root", root],
      inventory([{ slug: "t/alpha" }]),
      async () => ({ code: 1, stdout: "", stderr: "" }),
    );
    expect(result.code).toBe(1);
    expect(result.out.at(-1)).toBe(
      "declared=1 cloned=0 present=0 occupied=0 archived=0 private=0 unsafe=0 failed=1",
    );
  });

  test("--dry-run calls no git, creates nothing and reports would-clone", async () => {
    const root = freshDirectory();
    fakeClone(root, "beta");
    const before = snapshot(root);
    const result = await run(
      ["clone", "--root", root, "--dry-run"],
      inventory([{ slug: "t/alpha" }, { slug: "t/beta" }, { slug: "t/gamma" }]),
    );
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([]);
    expect(result.out).toEqual([
      "+ would-clone t/alpha -> alpha",
      "= beta present",
      "+ would-clone t/gamma -> gamma",
      "declared=3 would-clone=2 present=1 occupied=0 archived=0 private=0 unsafe=0 failed=0",
    ]);
    expect(snapshot(root)).toEqual(before);
  });

  test("archived and private entries are counted and never reach git", async () => {
    const root = freshDirectory();
    const result = await run(
      ["clone", "--root", root],
      inventory([{ slug: "t/old", lifecycle: "archived" }, PRIVATE_ENTRY, { slug: "t/alpha" }]),
    );
    expect(result.code).toBe(0);
    expect(result.calls.map((call) => call.args.at(-1))).toEqual([join(root, "alpha")]);
    expect(result.out.at(-1)).toBe(
      "declared=3 cloned=1 present=0 occupied=0 archived=1 private=1 unsafe=0 failed=0",
    );
  });

  test("a door that answers neither success nor failure: counters-mismatch, no report", async () => {
    const root = freshDirectory();
    const result = await run(
      ["clone", "--root", root],
      inventory([{ slug: "t/alpha" }, { slug: "t/beta" }]),
      async (args) => ({
        code: args.at(-1)?.endsWith("beta") ? Number.NaN : 0,
        stdout: "",
        stderr: "",
      }),
    );
    expect(result.code).toBe(1);
    expect(result.err.at(-1)).toStartWith("cause=counters-mismatch ");
    expect(result.out).toEqual(["+ clone t/alpha -> alpha"]);
  });

  test("the real door clones from the URL the second door gives, with no prompt", async () => {
    const base = freshDirectory();
    const seed = join(base, "seed");
    mkdirSync(seed);
    fixtureGit(seed, "init", "-q", "--initial-branch=served");
    identify(seed);
    commitFile(seed, "a.txt", "one\n");
    const root = join(base, "root");
    mkdirSync(root);
    const out: string[] = [];
    const code = await runLocalClones(["clone", "--root", root], {
      runGit: runGitProcess,
      remoteUrl: () => `file://${seed}`,
      readInventory: () => inventory([{ slug: "t/.github" }]),
      say: (line) => out.push(line),
      warn: () => undefined,
    });
    expect(code).toBe(0);
    expect(out.at(-1)).toBe(
      "declared=1 cloned=1 present=0 occupied=0 archived=0 private=0 unsafe=0 failed=0",
    );
    expect(lstatSync(join(root, ".github", ".git")).isDirectory()).toBe(true);
    expect(fixtureGit(join(root, ".github"), "rev-parse", "--abbrev-ref", "HEAD")).toBe("served");
  });
});

// ------------------------------------------------------------------- audit

const STATUS_HEAD = "# branch.oid 0000000000000000000000000000000000000000\n";

describe("audit through a fake door", () => {
  test("a missing target is absent and does not fail the run", async () => {
    const root = freshDirectory();
    const result = await run(["audit", "--root", root], inventory([{ slug: "t/alpha" }]));
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([]);
    expect(result.out.slice(1)).toEqual([
      "- alpha absent",
      "declared=1 examined=0 absent=1 occupied=0 archived=0 private=0 unsafe=0",
      "categories: unreadable=0 detached=0 no-upstream=0 up-to-date=0 behind-dirty=0 diverged=0 fast-forwardable=0",
      "outside-inventory=0",
    ]);
  });

  test("the first line says where ahead and behind come from", async () => {
    const root = freshDirectory();
    const result = await run(["audit", "--root", root], inventory([{ slug: "t/alpha" }]));
    expect(result.out[0]).toMatch(/^# ahead and behind reflect the last fetch the user ran/);
  });

  test("archived, private and unsafe entries are never examined, even when a clone sits there", async () => {
    const root = freshDirectory();
    fakeClone(root, "old");
    fakeClone(root, "product-research");
    fakeClone(root, "x");
    const result = await run(
      ["audit", "--root", root],
      inventory([{ slug: "t/old", lifecycle: "archived" }, PRIVATE_ENTRY, { slug: "g/../x" }]),
    );
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.err).toEqual(['cause=unsafe-path "g/../x" is not two plain segments']);
    expect(result.out).toContain(
      "declared=3 examined=0 absent=0 occupied=0 archived=1 private=1 unsafe=1",
    );
    // `x` is the last segment of the unsafe slug, not the name of an entry.
    expect(result.out.at(-1)).toBe("outside-inventory=1");
  });

  test("a clone whose state cannot be read is unreadable and fails the run", async () => {
    const root = freshDirectory();
    fakeClone(root, "alpha");
    fakeClone(root, "beta");
    fakeClone(root, "gamma");
    const result = await run(
      ["audit", "--root", root],
      inventory([{ slug: "t/alpha" }, { slug: "t/beta" }, { slug: "t/gamma" }]),
      async (_args, cwd) => {
        if (cwd?.endsWith("alpha")) return { code: 128, stdout: "", stderr: "fatal: not a repo\n" };
        if (cwd?.endsWith("beta")) throw new Error("spawn failed");
        return { code: 0, stdout: "nothing git would print\n", stderr: "" };
      },
    );
    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      "cause=unreadable-state alpha: git exited 128: fatal: not a repo",
      "cause=unreadable-state beta: spawn failed",
      "cause=unreadable-state gamma: git status gave no readable head",
    ]);
    expect(result.out).toContain(
      "alpha\t(unreadable)\tmodified=0\tuntracked=0\tahead=0\tbehind=0\tunreadable\t-",
    );
    expect(result.out).toContain(
      "categories: unreadable=3 detached=0 no-upstream=0 up-to-date=0 behind-dirty=0 diverged=0 fast-forwardable=0",
    );
  });

  test("a detached head is reported with the switch template", async () => {
    const root = freshDirectory();
    fakeClone(root, "alpha");
    const result = await run(
      ["audit", "--root", root],
      inventory([{ slug: "t/alpha" }]),
      async () => ({ code: 0, stdout: `${STATUS_HEAD}# branch.head (detached)\n`, stderr: "" }),
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      `alpha\t(detached)\tmodified=0\tuntracked=0\tahead=0\tbehind=0\tdetached\tgit -C ${join(root, "alpha")} switch <branch>`,
    );
  });

  test("ahead and behind are read from the status header", async () => {
    const root = freshDirectory();
    fakeClone(root, "alpha");
    const stdout = `${STATUS_HEAD}# branch.head topic\n# branch.upstream origin/topic\n# branch.ab +2 -3\n`;
    const result = await run(
      ["audit", "--root", root],
      inventory([{ slug: "t/alpha" }]),
      async () => ({ code: 0, stdout, stderr: "" }),
    );
    expect(result.out).toContain(
      `alpha\ttopic\tmodified=0\tuntracked=0\tahead=2\tbehind=3\tdiverged\tgit -C ${join(root, "alpha")} log --oneline @{upstream}..HEAD`,
    );
  });

  test("a door that answers neither success nor failure: counters-mismatch, no report", async () => {
    const root = freshDirectory();
    fakeClone(root, "alpha");
    const result = await run(
      ["audit", "--root", root],
      inventory([{ slug: "t/alpha" }]),
      async () => ({ code: Number.NaN, stdout: "", stderr: "" }),
    );
    expect(result.code).toBe(1);
    expect(result.err.at(-1)).toStartWith("cause=counters-mismatch ");
    expect(result.out.filter((line) => /^(declared|categories|outside)/.test(line))).toEqual([]);
  });
});

describe("audit on real repositories", () => {
  const FORBIDDEN = [
    "fetch",
    "pull",
    "merge",
    "rebase",
    "reset",
    "stash",
    "checkout",
    "switch",
    "commit",
    "clean",
    "worktree",
    "add",
    "clone",
  ];
  const NAMES = ["behind", "changed", "split", "lonely", "fresh"];
  let root = "";
  let result: Run;
  let before = new Map<string, string>();
  let after = new Map<string, string>();
  let headBefore = "";

  const line = (name: string): string[] =>
    (result.out.find((entry) => entry.startsWith(`${name}\t`)) ?? "").split("\t");

  beforeAll(async () => {
    const base = freshDirectory();
    const seed = join(base, "seed");
    const upstream = join(base, "upstream.git");
    root = join(base, "root");
    mkdirSync(seed);
    mkdirSync(root);
    fixtureGit(seed, "init", "-q", "--initial-branch=served");
    identify(seed);
    commitFile(seed, "a.txt", "one\n");
    fixtureGit(base, "clone", "-q", "--bare", seed, upstream);
    for (const name of [...NAMES, "stranger"]) {
      fixtureGit(root, "clone", "-q", `file://${upstream}`, name);
      identify(join(root, name));
    }
    commitFile(seed, "b.txt", "two\n");
    fixtureGit(seed, "push", "-q", upstream, "served");
    // The fetch is the user's act, done here by the fixture: the audit never does it.
    for (const name of ["behind", "changed", "split"]) fixtureGit(join(root, name), "fetch", "-q");
    writeFileSync(join(root, "changed", "a.txt"), "edited\n");
    commitFile(join(root, "split"), "local.txt", "mine\n");
    fixtureGit(join(root, "lonely"), "switch", "-q", "-c", "side");
    // Two files in one untracked directory: files are counted, not the directory.
    mkdirSync(join(root, "lonely", "notes"));
    writeFileSync(join(root, "lonely", "notes", "one.txt"), "1\n");
    writeFileSync(join(root, "lonely", "notes", "two.txt"), "2\n");
    writeFileSync(join(root, "fresh", "new.txt"), "untracked\n");
    // Children of the root that are not clones: outside the inventory, and not counted.
    mkdirSync(join(root, "plain"));
    writeFileSync(join(root, "README"), "");
    // A tracked file whose timestamp moved, content unchanged: `git status`
    // would refresh the index on disk here unless it is told not to.
    utimesSync(
      join(root, "behind", "a.txt"),
      new Date(1_000_000_000_000),
      new Date(1_000_000_000_000),
    );

    headBefore = fixtureGit(join(root, "behind"), "rev-parse", "HEAD");
    before = snapshot(root);
    result = await run(
      ["audit", "--root", root],
      inventory([...NAMES, "missing"].map((name) => ({ slug: `t/${name}` }))),
      runGitProcess,
    );
    after = snapshot(root);
  });

  test("a clean clone that is behind is fast-forwardable and its HEAD does not move", () => {
    expect(line("behind")).toEqual([
      "behind",
      "served",
      "modified=0",
      "untracked=0",
      "ahead=0",
      "behind=1",
      "fast-forwardable",
      `git -C ${join(root, "behind")} merge --ff-only @{upstream}`,
    ]);
    expect(fixtureGit(join(root, "behind"), "rev-parse", "HEAD")).toBe(headBefore);
  });

  test("a clone that is behind with a modified tracked file is behind-dirty", () => {
    expect(line("changed").slice(2)).toEqual([
      "modified=1",
      "untracked=0",
      "ahead=0",
      "behind=1",
      "behind-dirty",
      `git -C ${join(root, "changed")} status --short`,
    ]);
  });

  test("a clone with its own commit and a late upstream is diverged", () => {
    expect(line("split").slice(4, 7)).toEqual(["ahead=1", "behind=1", "diverged"]);
  });

  test("a branch without upstream is no-upstream, with no fatal error", () => {
    expect(line("lonely")).toEqual([
      "lonely",
      "side",
      "modified=0",
      "untracked=2",
      "ahead=0",
      "behind=0",
      "no-upstream",
      `git -C ${join(root, "lonely")} branch --set-upstream-to=origin/side`,
    ]);
    expect(result.err).toEqual([]);
  });

  test("an untracked file counts 0 modified and 1 untracked", () => {
    expect(line("fresh").slice(2, 7)).toEqual([
      "modified=0",
      "untracked=1",
      "ahead=0",
      "behind=0",
      "up-to-date",
    ]);
  });

  test("the counters, the categories and the exit status", () => {
    expect(result.code).toBe(0);
    expect(result.out.slice(-3)).toEqual([
      "declared=6 examined=5 absent=1 occupied=0 archived=0 private=0 unsafe=0",
      "categories: unreadable=0 detached=0 no-upstream=1 up-to-date=1 behind-dirty=1 diverged=1 fast-forwardable=1",
      "outside-inventory=1",
    ]);
  });

  test("a clone outside the inventory is counted and never named", () => {
    expect(result.out.at(-1)).toBe("outside-inventory=1");
    expect(result.out.concat(result.err).join("\n")).not.toContain("stranger");
  });

  test("read-only: no writing git verb is called and the tree is identical", () => {
    expect(result.calls).toHaveLength(NAMES.length);
    for (const call of result.calls) {
      expect(call.args.filter((argument) => FORBIDDEN.includes(argument))).toEqual([]);
      expect(call.args).toContain("status");
    }
    expect(after.size).toBeGreaterThan(NAMES.length * 10);
    expect(after).toEqual(before);
  });

  test("reading a state does not run the command a clone's configuration names", async () => {
    const base = freshDirectory();
    const auditRoot = join(base, "root");
    const clone = join(auditRoot, "alpha");
    const marker = join(base, "marker");
    const hook = join(base, "hook.sh");
    mkdirSync(clone, { recursive: true });
    writeFileSync(hook, `#!/bin/sh\n: > '${marker}'\n`, { mode: 0o755 });
    fixtureGit(clone, "init", "-q", "--initial-branch=served");
    identify(clone);
    commitFile(clone, "a.txt", "one\n");
    fixtureGit(clone, "config", "core.fsmonitor", hook);
    const audited = await run(
      ["audit", "--root", auditRoot],
      inventory([{ slug: "t/alpha" }]),
      runGitProcess,
    );
    expect(audited.out).toContain(
      "categories: unreadable=0 detached=0 no-upstream=1 up-to-date=0 behind-dirty=0 diverged=0 fast-forwardable=0",
    );
    expect(readdirSync(base).sort()).toEqual(["hook.sh", "root"]);
  });
});

// ----------------------------------------------------------- the real door

describe("runGitProcess", () => {
  test("reads the repository of its directory, not the one a hook exports", async () => {
    const base = freshDirectory();
    const here = join(base, "here");
    const other = join(base, "other");
    for (const [repository, branch] of [
      [here, "here-branch"],
      [other, "other-branch"],
    ] as const) {
      mkdirSync(repository);
      fixtureGit(repository, "init", "-q", `--initial-branch=${branch}`);
    }
    const inherited = process.env.GIT_DIR;
    process.env.GIT_DIR = join(other, ".git");
    let reading: GitResult;
    try {
      reading = await runGitProcess(["symbolic-ref", "--short", "HEAD"], here);
    } finally {
      if (inherited === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = inherited;
    }
    expect(reading).toEqual({ code: 0, stdout: "here-branch\n", stderr: "" });
  });

  test("turns the credential prompt off", async () => {
    const base = freshDirectory();
    const probe = await runGitProcess(
      ["-c", 'alias.env=!printf %s "$GIT_TERMINAL_PROMPT"', "env"],
      base,
    );
    expect(probe.stdout).toBe("0");
  });
});

// ------------------------------------------------------------- source text

describe("source of the tool", () => {
  const sources = ["local-clones.ts", "clone-state.ts"].map((file) =>
    readFileSync(new URL(file, import.meta.url), "utf8"),
  );
  const entries = buildIndex(
    readFileSync(new URL("../../ecosystem/repositories.v1.yaml", import.meta.url), "utf8"),
  ).repositories;

  test("names no repository of the inventory", () => {
    expect(entries.length).toBeGreaterThan(0);
    const owners = new Set(entries.map((entry) => entry.repository.split("/")[0] as string));
    for (const source of sources) {
      for (const entry of entries) expect(source).not.toContain(entry.repository);
      for (const owner of owners) expect(source).not.toContain(`${owner}/`);
    }
  });

  test("names no branch", () => {
    for (const source of sources) {
      const text = source.replaceAll("import.meta.main", "");
      expect(text.match(/\b(?:main|master|trunk|develop|migrate\/[\w-]+)\b/g)).toBeNull();
      expect(text).not.toContain("refs/heads/");
      expect(source).toContain("classifyClone");
    }
  });
});
