import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArguments } from "./check-advisory-waivers";

// End-to-end: the gate as a consumer's workflow runs it, on a real git work
// tree, judged at a passed clock.

const GATE = join(import.meta.dir, "check-advisory-waivers.ts");
const REF = "docs/adr/0005-dependency-advisory-waivers.md";
const roots: string[] = [];

function git(root: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}

function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "waiver-gate-"));
  roots.push(root);
  git(root, "init", "--quiet");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, "add", "--all");
  return root;
}

function run(root: string, today: string) {
  const result = Bun.spawnSync(["bun", GATE, `--root=${root}`, `--today=${today}`], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GATE_VERBOSE: "" },
  });
  return {
    exitCode: result.exitCode,
    output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const DATED = `# waiver-review-anchor: 2026-07-26
[advisories]
ignore = [
  "RUSTSEC-2026-0174", # http-types via optional stripe; expires=2026-09-30; ref=${REF}
]
`;

describe("check-advisory-waivers", () => {
  test("a clean repository passes and states its volume", () => {
    const root = repository({ ".cargo/audit.toml": DATED, [REF]: "# ADR\n", "package.json": "{}" });
    const { exitCode, output } = run(root, "2026-08-15");
    expect(exitCode).toBe(0);
    expect(output).toContain("1 waiver(s) read across 2 file(s), 0 expiring within 30 days");
  });

  test("inside the warning window it warns and passes", () => {
    const root = repository({ ".cargo/audit.toml": DATED, [REF]: "# ADR\n" });
    const { exitCode, output } = run(root, "2026-09-20");
    expect(exitCode).toBe(0);
    expect(output).toContain("1 expiring within 30 days");
    expect(output).toContain("WARN .cargo/audit.toml:4 RUSTSEC-2026-0174 expires on 2026-09-30");
  });

  test("past the expiry it fails", () => {
    const root = repository({ ".cargo/audit.toml": DATED, [REF]: "# ADR\n" });
    const { exitCode, output } = run(root, "2026-10-09");
    expect(exitCode).toBe(1);
    expect(output).toContain("EXPIRED .cargo/audit.toml:4 RUSTSEC-2026-0174");
  });

  test("a ref to an untracked record fails", () => {
    const root = repository({ ".cargo/audit.toml": DATED });
    writeFileSync(join(root, "untracked.md"), "");
    const { exitCode, output } = run(root, "2026-08-15");
    expect(exitCode).toBe(1);
    expect(output).toContain("UNRESOLVED-REF");
  });

  test("a tracked waiver source missing from the work tree fails, not zero", () => {
    const root = repository({ "deny.toml": "[advisories]\n", [REF]: "# ADR\n" });
    rmSync(join(root, "deny.toml"));
    const { exitCode, output } = run(root, "2026-08-15");
    expect(exitCode).toBe(1);
    expect(output).toContain("UNREADABLE deny.toml");
  });

  test("a waiver source that is not valid TOML fails", () => {
    const root = repository({ "deny.toml": "[advisories\n" });
    const { exitCode, output } = run(root, "2026-08-15");
    expect(exitCode).toBe(1);
    expect(output).toContain("UNPARSEABLE deny.toml");
  });

  test("a manifest that is not valid JSON fails", () => {
    const root = repository({ "package.json": "{ not json" });
    const { exitCode, output } = run(root, "2026-08-15");
    expect(exitCode).toBe(1);
    expect(output).toContain("UNPARSEABLE package.json");
  });

  test("a repository with no waiver-capable source asserted nothing, and fails", () => {
    const root = repository({ "README.md": "# x\n" });
    const { exitCode, output } = run(root, "2026-08-15");
    expect(exitCode).toBe(1);
    expect(output).toContain("asserted nothing");
  });

  test("a root that is not a git work tree is an error, not an empty inventory", () => {
    const root = mkdtempSync(join(tmpdir(), "waiver-gate-"));
    roots.push(root);
    const { exitCode, output } = run(root, "2026-08-15");
    expect(exitCode).not.toBe(0);
    expect(output).toContain("git ls-files failed");
  });
});

describe("parseArguments", () => {
  test("defaults the clock to the UTC date and accepts an explicit one", () => {
    const now = new Date("2026-10-09T23:30:00-02:00");
    expect(parseArguments([], now).today).toBe("2026-10-10");
    expect(parseArguments(["--today=2026-08-15"], now).today).toBe("2026-08-15");
  });

  test("refuses an unknown argument", () => {
    expect(() => parseArguments(["--roots=x"], new Date())).toThrow();
  });
});
