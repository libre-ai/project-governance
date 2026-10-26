import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The data-file inventory gate run as a process, against a real index.
 *
 * WHY A PROCESS. The refusal of a gated symbolic link has two halves: the
 * effectful one in `main` keeps the entries whose mode is 120000, the pure one
 * in `auditInventory` refuses those on the gated surface. A unit test that
 * filters the entries itself proves the pure half only: a mode compare broken
 * in `main` (the second review of #159 measured `"120755"`) left every test
 * green. These probes run the gate itself.
 *
 * WHY A COPY OF THIS INDEX. The gate fails on any stale declaration, so a tiny
 * fixture tree would fail once per declaration and an exit code of 1 would prove
 * nothing about the link. The fixture carries the index of this checkout
 * instead (`git ls-files` reads the index only, so no object is needed), and
 * the control probe shows it passes as is: the link is then the only
 * difference, and the exit code is its verdict.
 *
 * WHY A SCRUBBED ENVIRONMENT. A child inheriting `GIT_DIR`, `GIT_INDEX_FILE`
 * or a global git config would read another index than the fixture's, and
 * `GATE_VERBOSE` would change the output, so each child gets only what it
 * declares.
 */

const GATE = join(import.meta.dir, "check-data-inventory.ts");
const ROOT = join(import.meta.dir, "..", "..");
/** A gated file of this tree (`check-review-evidence`), turned into a link. */
const LINKED = "deny.toml";
const GATE_NAME = "Data-file inventory";

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const GIT_ENV = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

/** Run git for the fixture setup, raw bytes out; any failure is a setup failure, not a verdict. */
function git(cwd: string, argv: readonly string[], stdin?: Uint8Array): Uint8Array {
  const result = Bun.spawnSync(["git", ...argv], {
    cwd,
    stdin: stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: GIT_ENV,
  });
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(
      `fixture setup failed: git ${argv.join(" ")} — ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return result.stdout;
}

/** A repository whose index is a copy of the index of this checkout. */
function copyOfThisIndex(repository: string, index: Uint8Array): void {
  git(workspace, ["init", "--quiet", repository]);
  git(repository, ["update-index", "-z", "--index-info"], index);
}

function runGate(cwd: string): Run {
  const result = Bun.spawnSync(["bun", GATE], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

let workspace: string;
let unchanged: string;
let linked: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "data-inventory-probe-"));
  unchanged = join(workspace, "unchanged");
  linked = join(workspace, "linked");
  const index = git(ROOT, ["ls-files", "-s", "-z"]);

  copyOfThisIndex(unchanged, index);

  copyOfThisIndex(linked, index);
  symlinkSync("elsewhere.toml", join(linked, LINKED));
  git(linked, ["add", "--", LINKED]);
  // The probe is about a link: a fixture that failed to make one is a setup failure.
  const mode = new TextDecoder().decode(git(linked, ["ls-files", "-s", "--", LINKED])).slice(0, 6);
  if (mode !== "120000") throw new Error(`fixture setup failed: ${LINKED} has mode ${mode}`);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("a gated path tracked as a symbolic link", () => {
  test("control: the copy of this index passes, so the link is the only difference", () => {
    const run = runGate(unchanged);
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`${GATE_NAME} verified:`);
    expect(run.stdout).toContain("+ 0 undeclared;");
    expect(run.stdout).toContain("0 gated symbolic link(s)");
  });

  test("the gate run on an index where a gated file became a link exits 1 and names it", () => {
    const run = runGate(linked);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      `${GATE_NAME}: ${LINKED}: a gated path tracked as a symbolic link: the gate would read its target, which is not on the surface`,
    );
    // The link is the one violation: nothing else of the copied index fails.
    expect(run.stderr).toMatch(
      new RegExp(`${GATE_NAME} failed: 1 of \\d+ assertion\\(s\\) did not hold\\.`),
    );
  });
});
