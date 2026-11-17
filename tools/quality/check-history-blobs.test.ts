import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyzeBlobs,
  auditNames,
  type BlobEntry,
  DEFAULT_NAME_RULES,
  GIT_FLAGS,
  GIT_TIMEOUT_MS,
  gitEnvironment,
  listHistoryBlobs,
  parseNameRules,
  parseThreshold,
  printable,
  run,
  UNREACHABLE_PATH,
} from "./check-history-blobs";

/**
 * Read-only audits: blobs of history above a threshold, tool names in paths.
 *
 * Expectations come from the brief of the audit (whole-word match, strict
 * exit code, empty list for a repository without a large object, a lower
 * threshold lists more), not from the output of the code under test.
 */

const MIB = 1024 * 1024;
const RULES = { tools: ["terraform", "postgres", "rust"], exceptions: ["equipe/rust-legacy"] };

describe("auditNames — whole word, by segment", () => {
  test("a segment equal to a tool is flagged, a word containing it is not", () => {
    const report = auditNames(["equipe/terraform-modules", "equipe/terraformation"], RULES);
    expect(report.violations).toEqual([{ path: "equipe/terraform-modules", tool: "terraform" }]);
  });

  test("separators are slash, hyphen and underscore, case is ignored", () => {
    const report = auditNames(["a/My_Postgres_Backup", "b/Rust", "c/postgresql-ha"], RULES);
    expect(report.violations).toEqual([
      { path: "a/My_Postgres_Backup", tool: "postgres" },
      { path: "b/Rust", tool: "rust" },
    ]);
  });

  test("a dot separates segments too, a word containing the tool still does not match", () => {
    const report = auditNames(["infra/terraform.modules", "a/postgres.d", "b/rustacean.io"], RULES);
    expect(report.violations).toEqual([
      { path: "infra/terraform.modules", tool: "terraform" },
      { path: "a/postgres.d", tool: "postgres" },
    ]);
  });

  test("a path listed as an exception is not flagged, and is counted as exempted", () => {
    const report = auditNames(["equipe/rust-legacy", "equipe/rust-new"], RULES);
    expect(report.violations).toEqual([{ path: "equipe/rust-new", tool: "rust" }]);
    expect(report.exempted).toBe(1);
  });

  test("counters sum to the number of paths examined", () => {
    const report = auditNames(
      ["equipe/terraform-modules", "equipe/rust-legacy", "equipe/billing"],
      RULES,
    );
    expect(report.examined).toBe(3);
    expect(report.exempted + report.clean + report.flagged).toBe(report.examined);
    expect([report.exempted, report.clean, report.flagged]).toEqual([1, 1, 1]);
  });

  test("a path naming two tools yields one violation per tool", () => {
    const report = auditNames(["x/postgres-terraform"], RULES);
    expect(report.violations.map((v) => v.tool)).toEqual(["postgres", "terraform"]);
    expect(report.flagged).toBe(1);
  });
});

describe("parseNameRules — data validation", () => {
  test("accepts a well-formed rules document", () => {
    expect(parseNameRules({ tools: ["Terraform"], exceptions: ["a/b"] })).toEqual({
      tools: ["terraform"],
      exceptions: ["a/b"],
    });
  });

  test.each([
    ["not an object", 3],
    ["tools missing", { exceptions: [] }],
    ["empty tools", { tools: [], exceptions: [] }],
    ["tool with a separator", { tools: ["node-js"], exceptions: [] }],
    ["tool not a string", { tools: [1], exceptions: [] }],
    ["exceptions not an array", { tools: ["rust"], exceptions: "a" }],
  ])("rejects %s", (_name, value) => {
    expect(() => parseNameRules(value)).toThrow();
  });
});

describe("DEFAULT_NAME_RULES", () => {
  test("is a valid rules document and names the orchestrator, database and forge families", () => {
    const rules = parseNameRules(DEFAULT_NAME_RULES);
    for (const tool of ["kubernetes", "postgres", "gitlab", "rust", "grafana"]) {
      expect(rules.tools).toContain(tool);
    }
  });
});

describe("printable — nothing in a path may drive a terminal", () => {
  test.each([
    ["C0 escape", "a\u{1b}[31mb", "a?[31mb"],
    ["DEL", "a\u{7f}b", "a?b"],
    ["C1 CSI", "a\u{9b}31mb", "a?31mb"],
    ["C1 next line", "a\u{85}b", "a?b"],
    ["right-to-left override", "a\u{202e}b", "a?b"],
    ["left-to-right embedding", "a\u{202a}b", "a?b"],
    ["first strong isolate", "a\u{2068}b", "a?b"],
    ["pop directional isolate", "a\u{2069}b", "a?b"],
    ["right-to-left mark", "a\u{200f}b", "a?b"],
    ["left-to-right mark", "a\u{200e}b", "a?b"],
    ["arabic letter mark", "a\u{61c}b", "a?b"],
    ["zero-width space", "a\u{200b}b", "a?b"],
    ["line separator", "a\u{2028}b", "a?b"],
    ["paragraph separator", "a\u{2029}b", "a?b"],
  ])("replaces a %s", (_name, text, expected) => {
    expect(printable(text)).toBe(expected);
  });

  test("leaves letters, accents and punctuation of a path alone", () => {
    const path = "\u{e9}quipe/donn\u{e9}es_2024.v1-ok";
    expect(printable(path)).toBe(path);
  });
});

describe("parseThreshold", () => {
  test("defaults to 5 MiB", () => {
    expect(parseThreshold(undefined)).toBe(5 * MIB);
  });
  test("accepts a positive integer of bytes", () => {
    expect(parseThreshold("1000")).toBe(1000);
  });
  test.each(["0", "-5", "1.5", "abc", "", "1e6", "9999999999999999999999"])("rejects %p", (raw) => {
    expect(() => parseThreshold(raw)).toThrow();
  });
});

function blob(path: string, size: number, n = 0): BlobEntry {
  return { sha: n.toString(16).padStart(40, "0"), size, path };
}

describe("analyzeBlobs — report from entries", () => {
  test("keeps only blobs strictly above the threshold, largest first, 30 at most", () => {
    const entries = [
      blob("a.bin", 100, 1),
      blob("b.bin", 200, 2),
      blob("c.bin", 50, 3),
      ...Array.from({ length: 40 }, (_, i) => blob(`many/${i}.bin`, 1000 + i, 10 + i)),
    ];
    const report = analyzeBlobs(entries, 100);
    expect(report.total).toBe(41);
    expect(report.top).toHaveLength(30);
    expect(report.top[0]?.size).toBe(1039);
    expect(report.top.every((b) => b.size > 100)).toBe(true);
    expect(report.top.map((b) => b.size)).toEqual(
      [...report.top.map((b) => b.size)].sort((x, y) => y - x),
    );
  });

  test("distribution by first path segment, 10 at most, by bytes", () => {
    const entries = [
      blob("assets/a.png", 300, 1),
      blob("assets/b.png", 300, 2),
      blob("docs/x.pdf", 500, 3),
      blob("root.bin", 200, 4),
      ...Array.from({ length: 12 }, (_, i) => blob(`d${i}/f.bin`, 150, 20 + i)),
    ];
    const report = analyzeBlobs(entries, 100);
    expect(report.bySegment).toHaveLength(10);
    expect(report.bySegment[0]).toEqual({ segment: "assets", count: 2, bytes: 600 });
    expect(report.bySegment[1]).toEqual({ segment: "docs", count: 1, bytes: 500 });
    expect(report.bySegment.some((s) => s.segment === ".")).toBe(true);
  });

  test("above 50 MiB: history rewrite is recommended", () => {
    const report = analyzeBlobs([blob("big.bin", 51 * MIB)], MIB);
    expect(report.recommendations.join("\n")).toContain("history rewrite");
  });

  test("exactly 50 MiB: no rewrite recommendation", () => {
    const report = analyzeBlobs([blob("big.bin", 50 * MIB)], MIB);
    expect(report.recommendations.join("\n")).not.toContain("history rewrite");
  });

  test("a path with 50 versions above threshold: large file storage is recommended", () => {
    const versions = Array.from({ length: 50 }, (_, i) => blob("model.bin", 200, i));
    const report = analyzeBlobs(versions, 100);
    expect(report.recommendations.join("\n")).toContain("large file storage");
    const fewer = analyzeBlobs(versions.slice(0, 49), 100);
    expect(fewer.recommendations.join("\n")).not.toContain("large file storage");
  });

  test("static resources: object storage is recommended", () => {
    const report = analyzeBlobs([blob("site/hero.PNG", 200, 1)], 100);
    expect(report.recommendations.join("\n")).toContain("object storage");
    const none = analyzeBlobs([blob("src/data.bin", 200, 1)], 100);
    expect(none.recommendations.join("\n")).not.toContain("object storage");
  });

  test("no blob above the threshold: empty list, no recommendation", () => {
    const report = analyzeBlobs([blob("a", 10, 1)], 100);
    expect(report.total).toBe(0);
    expect(report.top).toEqual([]);
    expect(report.bySegment).toEqual([]);
    expect(report.recommendations).toEqual([]);
  });
});

function git(dir: string, ...args: string[]): void {
  const done = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  if (done.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${done.stderr.toString()}`);
}

describe("listHistoryBlobs — against a real repository", () => {
  let scratch: string;
  let repo: string;
  let work: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "history-blobs-test-"));
    repo = join(scratch, "source");
    work = join(scratch, "work");
    mkdirSync(repo);
    mkdirSync(work);
    git(repo, "init", "-q");
    git(repo, "config", "user.name", "t");
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "commit.gpgsign", "false");
    mkdirSync(join(repo, "assets"));
    writeFileSync(join(repo, "assets", "big.bin"), "a".repeat(3000));
    writeFileSync(join(repo, "small.txt"), "tiny");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "one");
    // The big file is rewritten and then deleted: history still holds both versions.
    writeFileSync(join(repo, "assets", "big.bin"), "b".repeat(4000));
    git(repo, "commit", "-q", "-am", "two");
    git(repo, "rm", "-q", "assets/big.bin");
    git(repo, "commit", "-q", "-m", "three");
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test("lists the objects of history above the threshold, deleted ones included", async () => {
    const report = await listHistoryBlobs(repo, 1000, work);
    expect(report.top.map((b) => [b.path, b.size])).toEqual([
      ["assets/big.bin", 4000],
      ["assets/big.bin", 3000],
    ]);
    expect(report.bySegment).toEqual([{ segment: "assets", count: 2, bytes: 7000 }]);
  });

  test("every object of the store is counted, and the counters sum", async () => {
    const { coverage } = await listHistoryBlobs(repo, 1000, work);
    // Blobs: two versions of assets/big.bin and small.txt.
    expect(coverage.examined).toBeGreaterThan(coverage.blobs);
    expect(coverage.reachable + coverage.unreachable).toBe(coverage.examined);
    expect(coverage.unreachable).toBe(0);
    expect(coverage.blobs).toBe(3);
    expect(coverage.lfsAttributes).toBe(0);
  });

  test("a blob that no ref reaches is examined and listed as unreachable", async () => {
    const source = join(scratch, "orphan-source");
    mkdirSync(source);
    git(source, "init", "-q");
    git(source, "config", "user.name", "t");
    git(source, "config", "user.email", "t@t");
    git(source, "config", "commit.gpgsign", "false");
    writeFileSync(join(source, "small.txt"), "tiny");
    git(source, "add", "-A");
    git(source, "commit", "-q", "-m", "one");
    const orphan = join(scratch, "orphan.bin");
    writeFileSync(orphan, "o".repeat(5000));
    git(source, "hash-object", "-w", orphan);

    const report = await listHistoryBlobs(source, 1000, work);
    expect(report.top.map((b) => [b.path, b.size])).toEqual([[UNREACHABLE_PATH, 5000]]);
    expect(report.bySegment).toEqual([{ segment: UNREACHABLE_PATH, count: 1, bytes: 5000 }]);
    expect(report.coverage.unreachable).toBe(1);
    expect(report.coverage.reachable + report.coverage.unreachable).toBe(report.coverage.examined);
  });

  test("a .gitattributes of history declaring filter=lfs is reported", async () => {
    const source = join(scratch, "lfs-source");
    mkdirSync(join(source, "design"), { recursive: true });
    git(source, "init", "-q");
    git(source, "config", "user.name", "t");
    git(source, "config", "user.email", "t@t");
    git(source, "config", "commit.gpgsign", "false");
    // The declaration lives in a deleted version of a nested file: history, not the tip.
    writeFileSync(
      join(source, "design", ".gitattributes"),
      "# art\n*.psd filter=lfs diff=lfs -text\n",
    );
    writeFileSync(join(source, ".gitattributes"), "# *.bin filter=lfs\n*.txt text\n");
    git(source, "add", "-A");
    git(source, "commit", "-q", "-m", "one");
    git(source, "rm", "-q", "design/.gitattributes");
    git(source, "commit", "-q", "-m", "two");

    const report = await listHistoryBlobs(source, 1000, work);
    // The commented-out line of the root file is not a declaration.
    expect(report.coverage.lfsAttributes).toBe(1);
  });

  test("a repository without a large object: empty list", async () => {
    const report = await listHistoryBlobs(repo, 10 * MIB, work);
    expect(report.top).toEqual([]);
    expect(report.total).toBe(0);
  });

  test("a lower threshold lists more blobs", async () => {
    const high = await listHistoryBlobs(repo, 3500, work);
    const low = await listHistoryBlobs(repo, 3, work);
    expect(high.total).toBe(1);
    expect(low.total).toBe(3);
  });

  test("the source repository is not modified", async () => {
    const before = readdirSync(repo, { recursive: true }).sort();
    await listHistoryBlobs(repo, 1000, work);
    expect(readdirSync(repo, { recursive: true }).sort()).toEqual(before);
  });

  test("the temporary directory is removed on success", async () => {
    await listHistoryBlobs(repo, 1000, work);
    expect(readdirSync(work)).toEqual([]);
  });

  test("the temporary directory is removed when the clone fails", async () => {
    await expect(listHistoryBlobs(join(scratch, "absent"), 1000, work)).rejects.toThrow();
    expect(readdirSync(work)).toEqual([]);
  });

  test("a repository argument that looks like an option is refused before git runs", async () => {
    await expect(listHistoryBlobs("--upload-pack=touch pwned", 1000, work)).rejects.toThrow(
      /repository/,
    );
  });

  test("a transport outside the allowed list is refused by the environment git receives", () => {
    // git:// is allowed by git's own defaults: only the list can refuse it.
    const env = gitEnvironment();
    expect(env.GIT_ALLOW_PROTOCOL).toBe("file:https:ssh");
    const done = Bun.spawnSync(["git", "ls-remote", "git://127.0.0.1:9/x"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(done.exitCode).not.toBe(0);
    expect(done.stderr.toString()).toContain("not allowed");
  });

  test("git is hardened: no user config, no hook, no credential helper, no prompt, no timeout-free clone", () => {
    const env = gitEnvironment();
    expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_SSH_COMMAND).toContain("BatchMode=yes");
    expect(GIT_FLAGS).toEqual(
      expect.arrayContaining(["core.hooksPath=/dev/null", "credential.helper="]),
    );
    expect(GIT_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test("the git that listHistoryBlobs runs receives the hardening flags and the hardened environment", async () => {
    // The two tests above read the values; this one reads what the clone path
    // actually hands to the process, through a stand-in `git` that records it.
    const bin = join(scratch, "recording-git");
    mkdirSync(bin);
    const standIn = join(bin, "git");
    writeFileSync(
      standIn,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$@" > '${bin}/argv'`,
        `export -p > '${bin}/env'`,
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(standIn, 0o755);
    const path = process.env.PATH ?? "";
    process.env.PATH = bin;
    process.env.HISTORY_BLOBS_AMBIENT = "must-not-reach-git";
    try {
      await expect(listHistoryBlobs(repo, 1000, work)).rejects.toThrow("git clone failed");
    } finally {
      process.env.PATH = path;
      process.env.HISTORY_BLOBS_AMBIENT = "";
    }
    const argv = readFileSync(join(bin, "argv"), "utf8").split("\n");
    expect(argv.slice(0, 5)).toEqual([
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "credential.helper=",
      "clone",
    ]);
    const env = readFileSync(join(bin, "env"), "utf8");
    expect(env).toMatch(/GIT_ALLOW_PROTOCOL=["']file:https:ssh["']/);
    expect(env).toMatch(/GIT_CONFIG_GLOBAL=["']\/dev\/null["']/);
    expect(env).toMatch(/GIT_CONFIG_NOSYSTEM=["']1["']/);
    expect(env).toMatch(/GIT_TERMINAL_PROMPT=["']0["']/);
    expect(env).not.toContain("must-not-reach-git");
  });
});

describe("as a process", () => {
  const script = join(import.meta.dir, "check-history-blobs.ts");

  test("--strict exits 1 on a violation, with the report on stdout", () => {
    const done = Bun.spawnSync(["bun", script, "names", "--strict"], {
      stdin: Buffer.from("equipe/terraform-modules\n"),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(done.exitCode).toBe(1);
    expect(done.stdout.toString()).toContain("equipe/terraform-modules: terraform");
  });

  test("a blobs report neutralises control characters of a path", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-blobs-ctl-"));
    try {
      git(dir, "init", "-q");
      git(dir, "config", "user.name", "t");
      git(dir, "config", "user.email", "t@t");
      git(dir, "config", "commit.gpgsign", "false");
      writeFileSync(join(dir, "esc\u001b[31mred.bin"), "x".repeat(50));
      writeFileSync(join(dir, "csi\u{9b}31mred.bin"), "y".repeat(50));
      writeFileSync(join(dir, "txt.\u{202e}exe.bin"), "z".repeat(50));
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "one");
      const done = Bun.spawnSync(["bun", script, "blobs", dir, "10"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(done.exitCode).toBe(0);
      const out = done.stdout.toString();
      expect(out).not.toContain("\u001b");
      expect(out).not.toContain("\u{9b}");
      expect(out).not.toContain("\u{202e}");
      expect(out).toContain("esc?[31mred.bin");
      expect(out).toContain("csi?31mred.bin");
      expect(out).toContain("txt.?exe.bin");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a blobs report prints the volume examined and the coverage of large file storage", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-blobs-cov-"));
    try {
      git(dir, "init", "-q");
      git(dir, "config", "user.name", "t");
      git(dir, "config", "user.email", "t@t");
      git(dir, "config", "commit.gpgsign", "false");
      writeFileSync(join(dir, ".gitattributes"), "*.psd filter=lfs diff=lfs merge=lfs -text\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "one");
      const done = Bun.spawnSync(["bun", script, "blobs", dir, "10"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(done.exitCode).toBe(0);
      const out = done.stdout.toString();
      // commit, tree, blob
      expect(out).toContain("objects examined=3 reachable=3 unreachable=0 blobs=1");
      expect(out).toContain("large file storage content is not covered");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a repository with no object is exit 2, never the green of a clean one", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-blobs-empty-"));
    try {
      git(dir, "init", "-q");
      const done = Bun.spawnSync(["bun", script, "blobs", dir], { stdout: "pipe", stderr: "pipe" });
      expect(done.exitCode).toBe(2);
      expect(done.stdout.toString()).toBe("");
      expect(done.stderr.toString()).toContain("objects examined=0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("run — command line", () => {
  const noStdin = async () => "";
  const inventory = async () => "equipe/terraform-modules\nequipe/terraformation\nequipe/billing\n";

  test("names, text mode: lists violations with counters, exit 0 without --strict", async () => {
    const result = await run(["names"], inventory);
    expect(result.code).toBe(0);
    expect(result.out).toContain("equipe/terraform-modules: terraform");
    expect(result.out).not.toContain("equipe/terraformation");
    expect(result.out).toContain("paths=3");
  });

  test("names --strict: exit 1 on a violation, 0 otherwise", async () => {
    expect((await run(["names", "--strict"], inventory)).code).toBe(1);
    const clean = await run(["names", "--strict"], async () => "equipe/billing\n");
    expect(clean.code).toBe(0);
  });

  test("names --json: an array of objects on stdout, counters elsewhere", async () => {
    const result = await run(["names", "--json"], inventory);
    expect(JSON.parse(result.out)).toEqual([
      { path: "equipe/terraform-modules", tool: "terraform" },
    ]);
    expect(result.err).toContain("paths=3");
  });

  test("names: an empty inventory is a failure, never a green", async () => {
    const result = await run(["names", "--strict"], noStdin);
    expect(result.code).toBe(2);
    expect(result.err).toContain("empty");
  });

  test("names: a path with an unexpected character is refused", async () => {
    const result = await run(["names"], async () => "ok/path\nbad path;rm\n");
    expect(result.code).toBe(2);
  });

  test("an unreadable inventory is exit 2, not the exit 1 of a violation", async () => {
    const result = await run(["names", "--strict"], async () => {
      throw new Error("stdin broke");
    });
    expect(result.code).toBe(2);
    expect(result.err).toContain("stdin broke");
  });

  test("usage errors exit 2", async () => {
    expect((await run([], noStdin)).code).toBe(2);
    expect((await run(["unknown"], noStdin)).code).toBe(2);
    expect((await run(["names", "--bogus"], noStdin)).code).toBe(2);
    expect((await run(["blobs"], noStdin)).code).toBe(2);
    expect((await run(["blobs", "repo", "abc"], noStdin)).code).toBe(2);
  });
});
