import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The guard run as a process against a throwaway repository: exit code, stream
// and wording are part of its contract (codes 0 and 1; file:line, pattern and a
// bounded excerpt on failure; the examined volume on success).

const SCRIPT = join(import.meta.dir, "check-product-coupling.ts");
const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: readonly string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}

const CONFIG = {
  roots: ["packages/shared"],
  patterns: [{ name: "product-name", regex: "\\bwidgetor\\b", why: "a consumer product" }],
};

function repository(files: Record<string, string | Uint8Array>): string {
  const root = mkdtempSync(join(tmpdir(), "product-coupling-"));
  created.push(root);
  const all: Record<string, string | Uint8Array> = {
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "tools/quality/product-coupling.v1.json": JSON.stringify(CONFIG),
    "tools/quality/product-coupling-exemptions.txt": "# path # reason\n",
    "packages/shared/package.json": "{}\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  return root;
}

function run(cwd: string): { code: number; stdout: string; stderr: string } {
  // A minimal environment: the probe must measure its own repository, not the
  // variables of the run that launched it.
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: cwd };
  const result = Bun.spawnSync([process.execPath, SCRIPT], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("check-product-coupling as a process", () => {
  test("a clean tree exits 0 and prints the examined volume", () => {
    const root = repository({ "packages/shared/src/a.ts": "export const a = 1;\n" });
    const outcome = run(root);
    expect(outcome.stderr).toBe("");
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain("2 file(s) scanned");
  });

  test("a forbidden pattern exits 1 with file:line and the pattern name", () => {
    const root = repository({ "packages/shared/src/a.ts": "ok\nconst p = 'widgetor';\n" });
    const outcome = run(root);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain("packages/shared/src/a.ts:2: product-name");
  });

  test("a renamed declared tree exits 1", () => {
    const root = repository({ "packages/shared/src/a.ts": "export const a = 1;\n" });
    renameSync(join(root, "packages/shared"), join(root, "packages/renamed"));
    git(root, ["add", "-A"]);
    const outcome = run(root);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain("packages/shared");
  });

  test("a listed exemption exits 0 and the tolerated match is printed and counted", () => {
    const root = repository({
      "packages/shared/src/a.ts": "const p = 'widgetor';\n",
      "tools/quality/product-coupling-exemptions.txt":
        "packages/shared/src/a.ts # migration to the consumer in progress\n",
    });
    const outcome = run(root);
    expect(outcome.code).toBe(0);
    expect(outcome.stderr).toContain("tolerated: packages/shared/src/a.ts:1: product-name");
    // A code file: admitted because the guard declares code (owner decision of 2026-11-17).
    expect(outcome.stdout).toContain(
      "1 tolerated match(es) in 1 exempted file(s) (0 data + 1 code)",
    );
  });

  test("an exemption naming a tracked symbolic link exits 1: not-a-file", () => {
    const root = repository({
      "packages/shared/src/a.ts": "const p = 'widgetor';\n",
      "tools/quality/product-coupling-exemptions.txt": "packages/shared/src/link.ts # a link\n",
    });
    symlinkSync("a.ts", join(root, "packages/shared/src/link.ts"));
    git(root, ["add", "-A"]);
    const outcome = run(root);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain(
      "product-coupling: tools/quality/product-coupling-exemptions.txt line 1: not-a-file",
    );
  });

  test("an exemption without a reason exits 1", () => {
    const root = repository({
      "packages/shared/src/a.ts": "const p = 'widgetor';\n",
      "tools/quality/product-coupling-exemptions.txt": "packages/shared/src/a.ts\n",
    });
    const outcome = run(root);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain("missing-reason");
  });

  // The manifest -> scanned trees wiring: a hard-coded list of trees once
  // omitted three packages out of nine, one of which carried a product name.
  test("a workspace package of the root manifest outside every declared tree exits 1", () => {
    const root = repository({
      "packages/shared/src/a.ts": "export const a = 1;\n",
      "packages/forms/package.json": "{}\n",
    });
    const outcome = run(root);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain(
      "workspace package packages/forms lies outside every declared tree",
    );
  });

  test("a workspace entry the guard cannot expand exactly exits 1", () => {
    const root = repository({
      "package.json": JSON.stringify({ workspaces: ["packages/**"] }),
      "packages/shared/src/a.ts": "export const a = 1;\n",
    });
    const outcome = run(root);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('workspace "packages/**" cannot be expanded exactly');
  });

  test("a tracked source that is not UTF-8 exits 1, never zero findings", () => {
    const root = repository({
      "packages/shared/src/a.ts": "export const a = 1;\n",
      "packages/shared/src/bin.dat": new Uint8Array([0xff, 0xfe, 0x77]),
    });
    const outcome = run(root);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain("packages/shared/src/bin.dat cannot be read as UTF-8 text");
  });

  test("a tracked source deleted from the disk exits 1", () => {
    const root = repository({
      "packages/shared/src/a.ts": "export const a = 1;\n",
      "packages/shared/src/gone.ts": "export const gone = 1;\n",
    });
    rmSync(join(root, "packages/shared/src/gone.ts"));
    const outcome = run(root);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain("packages/shared/src/gone.ts cannot be read as UTF-8 text");
  });

  test("a tracked symbolic link is counted, never followed out of the tree", () => {
    const root = repository({
      "packages/shared/src/a.ts": "export const a = 1;\n",
      "outside/x.txt": "secret widgetor outside\n",
    });
    symlinkSync("../../../outside/x.txt", join(root, "packages/shared/src/link.txt"));
    git(root, ["add", "-A"]);
    const outcome = run(root);
    expect(outcome.stderr).toBe("");
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain(
      "3 tracked file(s) under the shared trees = 2 file(s) scanned + 0 test file(s) excluded " +
        "+ 0 unreadable + 1 link(s) or submodule(s) not followed",
    );
  });

  test("an unreadable configuration exits 1", () => {
    const root = repository({ "tools/quality/product-coupling.v1.json": "{" });
    const outcome = run(root);
    expect(outcome.code).toBe(1);
  });
});
