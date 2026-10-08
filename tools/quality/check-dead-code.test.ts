import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Behavioural tests for the dead-code gate.
 *
 * The gate is a top-level script with no pure seam — it derives everything from
 * `git ls-files` at its own repository root — so it is exercised the way a
 * consumer runs it: against a throwaway git repository whose contents are
 * planted per case. That also keeps every fixture out of this repository's
 * tracked tree, where a planted "dead" module would be a real finding.
 *
 * Each case locks ONE of the two rules corrected on 2026-10-08, stated as the
 * behaviour rather than as the literal that was removed:
 *
 *   - a test is a HARNESS, not an entry point: a module reachable only from its
 *     own test is named, and the test itself is not;
 *   - a self-mention is not an invocation: a file naming its own command line
 *     is named, while a module that DECLARES itself a command is not.
 *
 * Before the correction both cases passed green: `tools/convergence/` (4 files,
 * 579 lines, importers = its own two test files) was reported reachable, and the
 * usage block in a gate's header kept that gate alive by itself.
 */
describe("check-dead-code gate", () => {
  const SCRIPT = join(import.meta.dir, "check-dead-code.ts");

  interface Run {
    readonly exitCode: number;
    readonly output: string;
  }

  // The gate fails any check that examined zero entries, so a fixture must carry
  // at least one exported value and one declared dependency or it goes red for a
  // reason that has nothing to do with the case under test. These two files
  // supply both, and are themselves reachable and referenced.
  const BASE: Record<string, string> = {
    "package.json": JSON.stringify({ name: "fixture", dependencies: { ajv: "8.20.0" } }),
    "lib/used.ts": "export const used = 1;\n",
    "run.ts":
      'import Ajv from "ajv";\nimport { used } from "./lib/used";\n' +
      "if (import.meta.main) {\n  console.log(used, Ajv, process.argv[2]);\n}\n",
  };

  /** Plants a git repository, runs the real gate in it, returns verdict + output. */
  function runOn(files: Record<string, string>): Run {
    const cwd = mkdtempSync(join(tmpdir(), "dead-code-"));
    for (const [path, content] of Object.entries({ ...BASE, ...files })) {
      const full = join(cwd, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content);
    }
    // The gate only needs a tree and an index, never a commit.
    execFileSync("git", ["init", "--quiet"], { cwd });
    execFileSync("git", ["add", "--all"], { cwd });
    const result = Bun.spawnSync(["bun", SCRIPT], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", GATE_VERBOSE: "" },
    });
    const decode = new TextDecoder();
    return {
      exitCode: result.exitCode ?? 1,
      output: `${decode.decode(result.stdout)}${decode.decode(result.stderr)}`,
    };
  }

  test("a clean tree passes and prints the volume of all three checks", () => {
    const run = runOn({});
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("entry points discovered:");
    expect(run.output).toContain("examined 2 source files reachable from an entry point");
    expect(run.output).toContain("examined 1 exported values");
    expect(run.output).toContain("examined 1 declared dependencies");
  });

  test("names a module reachable only from its own test, and never the test", () => {
    const run = runOn({
      "lib/anchor.ts": "export function anchor(x: string) {\n  return x.length;\n}\n",
      "lib/anchor.test.ts": 'import { anchor } from "./anchor";\nconsole.log(anchor("x"));\n',
    });
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("lib/anchor.ts: unreached source");
    // The harness is discovered by the runner: it keeps nothing alive, and it is
    // not dead either. Reporting it would make the rule unusable.
    expect(run.output).not.toContain("lib/anchor.test.ts: unreached source");
  });

  test("names a module whose only mention is its own usage line", () => {
    // The file documents `bun lib/orphan.ts` in its own header and declares no
    // `import.meta.main`. Both string-path sweeps match that header line, so a
    // self-exclusion applied to only one of them would change nothing — which is
    // why this case asserts the verdict rather than one pattern.
    const run = runOn({
      "lib/orphan.ts": "/**\n * Usage: bun lib/orphan.ts --flag\n */\nexport const orphan = 1;\n",
    });
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("lib/orphan.ts: unreached source");
  });

  test("leaves a module that declares itself a command alone", () => {
    const run = runOn({
      "lib/gate.ts":
        "export const scan = (s: string) => s.length;\n" +
        'if (import.meta.main) {\n  console.log(scan(process.argv[2] ?? ""));\n}\n',
      "lib/gate.test.ts": 'import { scan } from "./gate";\nconsole.log(scan("x"));\n',
    });
    expect(run.exitCode).toBe(0);
    expect(run.output).not.toContain("lib/gate.ts: unreached source");
  });
});
