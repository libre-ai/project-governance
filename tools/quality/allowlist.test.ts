import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AllowlistResult, parseAllowlist } from "./allowlist";

// The expected values below come from the exemption-list contract, not from the
// parser's output: one line = a tracked repository-relative path, then " # " and
// a mandatory non-empty reason; blank lines and lines starting with "#" are
// ignored; no wildcard, no duplicate; an error names a line number and nothing
// of the line's content.

const TRACKED: ReadonlySet<string> = new Set([
  "docs/a.md",
  "docs/b.yaml",
  "docs/issue#12.md",
  "ecosystem/données.json",
]);

function errorOf(result: AllowlistResult): { line: number; kind: string } {
  if (result.ok) throw new Error("expected a refusal, got an accepted list");
  return { line: result.error.line, kind: result.error.kind };
}

describe("parseAllowlist accepts", () => {
  test("tracked paths each followed by a reason", () => {
    const result = parseAllowlist("docs/a.md # fixture\ndocs/b.yaml # generated\n", TRACKED);
    expect(result).toEqual({ ok: true, paths: new Set(["docs/a.md", "docs/b.yaml"]), lines: 2 });
  });

  test("blank lines and comment lines, counted as lines but not as exemptions", () => {
    const result = parseAllowlist("# header\n\n   \ndocs/a.md # fixture\n", TRACKED);
    expect(result).toEqual({ ok: true, paths: new Set(["docs/a.md"]), lines: 4 });
  });

  test("an empty list exempts nothing", () => {
    expect(parseAllowlist("", TRACKED)).toEqual({ ok: true, paths: new Set(), lines: 0 });
  });

  test("a non-ASCII tracked name, exactly as git lists it", () => {
    const result = parseAllowlist("ecosystem/données.json # data\n", TRACKED);
    expect(result).toEqual({ ok: true, paths: new Set(["ecosystem/données.json"]), lines: 1 });
  });

  test("CRLF line endings", () => {
    const result = parseAllowlist("docs/a.md # fixture\r\ndocs/b.yaml # generated\r\n", TRACKED);
    expect(result).toEqual({ ok: true, paths: new Set(["docs/a.md", "docs/b.yaml"]), lines: 2 });
  });
});

describe("the separator is ' # ' with spaces", () => {
  test("the '#' of an identifier is part of the path, not the separator", () => {
    const result = parseAllowlist("docs/issue#12.md # tracked under its issue number\n", TRACKED);
    expect(result).toEqual({ ok: true, paths: new Set(["docs/issue#12.md"]), lines: 1 });
  });

  test("a '#' glued to the path is not a reason", () => {
    expect(errorOf(parseAllowlist("docs/a.md #anchor\n", TRACKED))).toEqual({
      line: 1,
      kind: "missing-reason",
    });
  });
});

describe("parseAllowlist refuses", () => {
  test("a line without ' # '", () => {
    expect(errorOf(parseAllowlist("docs/a.md\n", TRACKED))).toEqual({
      line: 1,
      kind: "missing-reason",
    });
  });

  test("a separator followed by a blank reason", () => {
    expect(errorOf(parseAllowlist("docs/a.md #    \n", TRACKED))).toEqual({
      line: 1,
      kind: "missing-reason",
    });
  });

  test.each([
    ["docs/*.md"],
    ["*"],
    ["docs/?.md"],
    ["docs/[ab].md"],
  ])("the wildcard path %p", (path) => {
    expect(errorOf(parseAllowlist(`${path} # all of them\n`, TRACKED))).toEqual({
      line: 1,
      kind: "wildcard",
    });
  });

  test("a path git does not track", () => {
    expect(errorOf(parseAllowlist("docs/c.md # not there\n", TRACKED))).toEqual({
      line: 1,
      kind: "untracked",
    });
  });

  test("an exemption that covers nothing any more: its file left the tracked tree", () => {
    const after = new Set([...TRACKED].filter((path) => path !== "docs/b.yaml"));
    const list = "docs/a.md # fixture\ndocs/b.yaml # generated\n";
    expect(parseAllowlist(list, TRACKED).ok).toBe(true);
    expect(errorOf(parseAllowlist(list, after))).toEqual({ line: 2, kind: "untracked" });
  });

  test("a duplicate, named at its second occurrence", () => {
    const list = "docs/a.md # fixture\ndocs/b.yaml # generated\ndocs/a.md # again\n";
    expect(errorOf(parseAllowlist(list, TRACKED))).toEqual({ line: 3, kind: "duplicate" });
  });

  test.each([
    ["/docs/a.md"],
    ["../docs/a.md"],
    ["docs/../docs/a.md"],
    ["./docs/a.md"],
    ["docs//a.md"],
    ["docs/"],
    ["docs\\a.md"],
    [" docs/a.md"],
    ["docs/a.md "],
    ["docs/a\tmd"],
  ])("the non-normalised path %p", (path) => {
    expect(errorOf(parseAllowlist(`${path} # reason\n`, TRACKED))).toEqual({
      line: 1,
      kind: "invalid-path",
    });
  });

  test("an empty path", () => {
    expect(errorOf(parseAllowlist(" # reason only\n", TRACKED))).toEqual({
      line: 1,
      kind: "invalid-path",
    });
  });
});

describe("errors name a line number and nothing else", () => {
  test("line numbers count blank and comment lines", () => {
    const list = "# header\n\ndocs/a.md # fixture\n# note\ndocs/c.md # gone\n";
    expect(errorOf(parseAllowlist(list, TRACKED))).toEqual({ line: 5, kind: "untracked" });
  });

  test("the error carries exactly a line and a kind, never the line's text", () => {
    const result = parseAllowlist("secret-name.md # reason\n", TRACKED);
    if (result.ok) throw new Error("expected a refusal");
    expect(Object.keys(result.error).sort()).toEqual(["kind", "line"]);
    expect(JSON.stringify(result.error)).not.toContain("secret-name");
  });
});

// The command half: git listing, counters, exit codes.

const MODULE = join(import.meta.dir, "allowlist.ts");
const created: string[] = [];

afterAll(() => {
  for (const directory of created) rmSync(directory, { recursive: true, force: true });
});

function scratchDirectory(prefix: string): string {
  const scratch = join(tmpdir(), "scratch");
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, prefix));
  created.push(directory);
  return directory;
}

function repository(files: Record<string, string>): string {
  const root = scratchDirectory("allowlist-");
  const init = Bun.spawnSync(["git", "-C", root, "init", "-q"], { env: cleanEnv() });
  if (init.exitCode !== 0) throw new Error("git init failed");
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content);
  }
  const add = Bun.spawnSync(["git", "-C", root, "add", "--", "."], { env: cleanEnv() });
  if (add.exitCode !== 0) throw new Error("git add failed");
  return root;
}

function cleanEnv(): Record<string, string> {
  // A git hook or a CI run exports GIT_DIR / GIT_INDEX_FILE; the probe must
  // measure its own repository, not the ambient one.
  return { PATH: process.env.PATH ?? "", HOME: tmpdir() };
}

function run(root: string, args: readonly string[]): { code: number; out: string; err: string } {
  const result = Bun.spawnSync([process.execPath, MODULE, ...args], { cwd: root, env: cleanEnv() });
  return {
    code: result.exitCode,
    out: new TextDecoder().decode(result.stdout),
    err: new TextDecoder().decode(result.stderr),
  };
}

describe("bun tools/quality/allowlist.ts <list>", () => {
  test("prints counters that sum to the lines read, a non-ASCII name included", () => {
    const root = repository({
      "data/données.json": "{}\n",
      "data/b.md": "b\n",
      "exempt.list": "# exemptions\n\ndata/données.json # fixture\ndata/b.md # generated\n",
    });
    const { code, out } = run(root, ["exempt.list"]);
    expect(code).toBe(0);
    expect(out).toContain("4 line(s) read = 2 exemption(s) + 2 blank or comment");
    expect(out).toContain("3 tracked file(s) listed");
  });

  test("exits 1 on a violation and names only the line", () => {
    const root = repository({
      "data/b.md": "b\n",
      "exempt.list": "data/b.md # generated\nprivate-thing.md # gone\n",
    });
    const { code, err } = run(root, ["exempt.list"]);
    expect(code).toBe(1);
    expect(err).toContain("line 2: untracked");
    expect(err).not.toContain("private-thing");
  });

  test("exits 2 when the list itself is not a tracked file of the repository", () => {
    const root = repository({ "data/b.md": "b\n" });
    writeFileSync(join(root, "loose.list"), "data/b.md # generated\n");
    expect(run(root, ["loose.list"]).code).toBe(2);
  });

  test("exits 2 on a list path that leaves the repository root", () => {
    const root = repository({ "data/b.md": "b\n" });
    expect(run(root, ["../outside.list"]).code).toBe(2);
    expect(run(root, ["/etc/hosts"]).code).toBe(2);
  });

  test("exits 2 on a wrong argument count", () => {
    const root = repository({ "data/b.md": "b\n" });
    expect(run(root, []).code).toBe(2);
    expect(run(root, ["a", "b"]).code).toBe(2);
  });

  test("exits 2 outside a git work tree: no listing is not an empty listing", () => {
    const bare = scratchDirectory("allowlist-nogit-");
    writeFileSync(join(bare, "exempt.list"), "a.md # x\n");
    const env = { ...cleanEnv(), GIT_CEILING_DIRECTORIES: join(tmpdir(), "scratch") };
    const result = Bun.spawnSync([process.execPath, MODULE, "exempt.list"], { cwd: bare, env });
    expect(result.exitCode).toBe(2);
  });
});
