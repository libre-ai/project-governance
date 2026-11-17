import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The opaque-secret-fields instrument run as a process.
 *
 * WHY A PROCESS. The pure scan is unit-tested next door; what only a process
 * shows is the command: its exit code, the refusal to conclude on no file, the
 * failure on a file it could not read, and an output that names the path and
 * the label without repeating the value.
 *
 * WHY A SCRUBBED ENVIRONMENT. `GATE_VERBOSE` changes the output and a colour
 * variable changes its bytes, so each child gets only what it declares.
 */

const COMMAND = join(import.meta.dir, "check-opaque-secret-fields.ts");
const GATE_NAME = "Opaque secret fields";

/** Assembled at run time: no line of this file has the shape of a secret. */
const hex64 = "0123456789abcdef".repeat(4);

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(paths: readonly string[]): Run {
  const result = Bun.spawnSync(["bun", COMMAND, ...paths], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

let workspace: string;
let clean: string;
let alsoClean: string;
let faulty: string;
let missing: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "opaque-secret-fields-probe-"));
  clean = join(workspace, "clean.json");
  alsoClean = join(workspace, "also-clean.json");
  faulty = join(workspace, "faulty.json");
  missing = join(workspace, "missing.json");
  writeFileSync(clean, '{ "description": "nothing to see" }\n');
  writeFileSync(alsoClean, '{ "name": "service" }\n');
  writeFileSync(faulty, `{ "apiKey": "${hex64}" }\n`);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("check-opaque-secret-fields as a command", () => {
  test("without a file it fails and says it examined nothing", () => {
    const result = run([]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`${GATE_NAME} asserted nothing`);
    expect(result.stdout).toBe("");
  });

  test("clean files pass and the number of files read is printed", () => {
    const result = run([clean, alsoClean]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${GATE_NAME} verified`);
    expect(result.stdout).toContain("2 file(s) read of 2 given, 0 unreadable, 0 finding(s)");
  });

  test("a faulty file fails, naming the path and the label, never the value", () => {
    const result = run([clean, faulty]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`${GATE_NAME}: ${faulty}: opaque-hex-field`);
    expect(result.stderr).toContain("2 file(s) read of 2 given, 0 unreadable, 1 finding(s)");
    expect(result.stderr).not.toContain(clean);
    expect(`${result.stdout}${result.stderr}`).not.toContain(hex64);
    expect(`${result.stdout}${result.stderr}`).not.toContain("apiKey");
  });

  test("a path that does not exist fails, even next to a clean file", () => {
    const result = run([clean, missing]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`${GATE_NAME}: ${missing}: unreadable file`);
    expect(result.stderr).toContain("1 file(s) read of 2 given, 1 unreadable, 0 finding(s)");
    expect(result.stdout).toBe("");
  });
});
