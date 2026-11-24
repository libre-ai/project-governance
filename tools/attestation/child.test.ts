import { describe, expect, test } from "bun:test";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ChildKilled, runChild } from "./child";

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("runChild", () => {
  test("control: a child that exits returns its code and its output", () => {
    const result = runChild(["sh", "-c", "printf out; printf err >&2; exit 3"]);
    expect(result.exitCode).toBe(3);
    expect(result.stdout.toString()).toBe("out");
    expect(result.stderr.toString()).toBe("err");
  });

  test("red:child-signal a child killed on its budget throws and names the signal, never returns null", () => {
    const error = thrownBy(() => runChild(["sleep", "5"], { timeoutMs: 200 }));
    expect(error).toBeInstanceOf(ChildKilled);
    expect((error as ChildKilled).signalCode).toBe("SIGTERM");
    expect((error as ChildKilled).message).toContain("sleep was killed by SIGTERM");
  });

  test("red:child-timeout the budget reaches the child: a 2 s child is stopped at 200 ms", () => {
    const started = performance.now();
    const error = thrownBy(() => runChild(["sleep", "2"], { timeoutMs: 200 }));
    expect(error).toBeInstanceOf(ChildKilled);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

/**
 * A guard of convention, not of security: it reads the source text for the usual ways to start
 * a child without runChild, and a determined author can still get past it (a computed property
 * name, `import * as b from "bun"` then `b.spawn`, `globalThis["Bun"]`). What it catches: any
 * access to `spawn`, `spawnSync` or `$` on `Bun` (dot, optional chaining or a quoted bracket,
 * with spaces or line breaks anywhere, so an alias `const s = Bun.spawnSync` too), the same
 * names destructured from `Bun` or imported from "bun", and any `child_process` module name in
 * quotes or backticks (import, require, dynamic import). Lines that are only a comment are
 * not read, and neither is a type query (`typeof Bun.spawnSync`): it names a type and starts
 * nothing, as in a test that replaces spawnSync and types the results it returns.
 */
const directForms: readonly RegExp[] = [
  /(?<!\btypeof\s+)\bBun\s*(?:\??\.\s*|\[\s*["'`]\s*)(?:spawnSync|spawn|\$)(?![\w$])/,
  /\{[^{}]*(?<![\w$])(?:spawnSync|spawn|\$)(?![\w$])[^{}]*\}\s*=\s*Bun\b/,
  /\bimport\s*\{[^{}]*(?<![\w$])(?:spawnSync|spawn|\$)(?![\w$])[^{}]*\}\s*from\s*["']bun["']/,
  /["'`](?:node:)?child_process["'`]/,
];

function startsChildrenDirectly(source: string): boolean {
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join("\n");
  return directForms.some((form) => form.test(code));
}

describe("the attestation tests", () => {
  test("the guard reads the usual direct forms, and not a comment", () => {
    const direct = [
      'Bun.spawnSync(["git"]);',
      'Bun["spawnSync"](["git"]);',
      "Bun['spawn'](['git']);",
      "Bun?.spawn(['git']);",
      "const run = Bun.spawnSync;",
      'Bun.spawnSync (["git"]);',
      'Bun.spawnSync\n  (["git"]);',
      "Bun\n  .spawnSync(['git']);",
      "const { spawnSync } = Bun;",
      "const { file, spawn: s } = Bun;",
      'import { $ } from "bun";',
      "await Bun.$`git status`;",
      'import { spawnSync } from "node:child_process";',
      'const cp = require("child_process");',
      "const cp = await import(`node:child_process`);",
      'if (typeof cwd === "string") Bun.spawnSync(["git"]);',
    ];
    const missed = direct.filter((source) => !startsChildrenDirectly(source));
    expect(missed).toEqual([]);
    const clean = [
      "// Bun.spawnSync( was the old way",
      " * Bun.spawnSync( in a block comment",
      'runChild(["git"]);',
      "Bun.sleepSync(10);",
      "const spawned = Bun.file(path);",
      'import { expect, test } from "bun:test";',
      "type SyncResult = ReturnType<typeof Bun.spawnSync>;",
      "let shape: ReturnType<typeof\n  Bun.spawn>;",
    ];
    expect(clean.filter(startsChildrenDirectly)).toEqual([]);
  });

  test("start every child through runChild, so none can read a kill as an exit code", () => {
    const files = readdirSync(import.meta.dir).filter((name) => name.endsWith(".test.ts"));
    // This file is left out: its fixtures above are the forms it refuses.
    const offenders = files.filter(
      (name) =>
        name !== "child.test.ts" &&
        startsChildrenDirectly(readFileSync(join(import.meta.dir, name), "utf8")),
    );
    expect(files.length).toBeGreaterThan(2);
    expect(offenders).toEqual([]);
  });
});
