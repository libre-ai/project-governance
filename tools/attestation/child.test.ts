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

describe("the attestation tests", () => {
  test("start every child through runChild, so none can read a kill as an exit code", () => {
    const direct = /\bBun\.spawn(?:Sync)?\(|["'](?:node:)?child_process["']/;
    const files = readdirSync(import.meta.dir).filter((name) => name.endsWith(".test.ts"));
    const offenders = files.filter((name) =>
      readFileSync(join(import.meta.dir, name), "utf8")
        .split("\n")
        .some((line) => direct.test(line)),
    );
    expect(files.length).toBeGreaterThan(1);
    expect(offenders).toEqual([]);
  });
});
