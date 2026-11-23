import { describe, expect, spyOn, test } from "bun:test";

import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildManifest,
  type ScanOptions,
  scanRepository,
  setGitOutputLimit,
} from "./git-attestation";

// These tests replace Bun.spawnSync with the results Bun 1.4.0 was measured to return, because
// the shape that matters here comes out of a race: when git overruns maxBuffer, Bun kills it, and
// whether git has already exited decides the exit code. Measured on 2026-11-23 with git 2.56.1
// and a 64-byte cap on `cat-file --batch-all-objects --batch-check`, 300 sequential runs: 293
// returned exit code 0 (success true) and 7 returned exit code null with signal SIGTERM (success
// false), all 300 with exitedDueToMaxBuffer true. Through the real-git test in
// git-attestation.test.ts, the null shape failed 4 of 600 runs at 28 in parallel (issue #298); a
// double makes it appear on every run.

type SyncResult = ReturnType<typeof Bun.spawnSync>;

interface Shape {
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  readonly exitedDueToMaxBuffer: boolean;
  readonly stdout: string;
}

function result(shape: Shape): SyncResult {
  return {
    exitCode: shape.exitCode,
    signalCode: shape.signalCode,
    exitedDueToMaxBuffer: shape.exitedDueToMaxBuffer,
    success: shape.exitCode === 0,
    stdout: Buffer.from(shape.stdout),
    stderr: Buffer.alloc(0),
    pid: 0,
  } as unknown as SyncResult;
}

/** Run `body` with every Bun.spawnSync answering `shape`; return how many calls it answered. */
function withSpawnResult(shape: Shape, body: () => void): number {
  const spy = spyOn(Bun, "spawnSync").mockImplementation(() => result(shape));
  try {
    body();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

const options: ScanOptions = {
  identities: [{ name: "Owner", address: "owner@example.org", scope: "anywhere" }],
};
// Never created. The doubled tests never reach git; the real-git test needs git to fail on it.
const dir = join(tmpdir(), "git-read-classification-never-read");

// Partial `--batch-check` output, as a truncated read returns it.
const truncated = `${"a".repeat(40)} blob 12\n${"b".repeat(20)}`;

describe("git read classification", () => {
  for (const shape of [
    { exitCode: 0, signalCode: null, exitedDueToMaxBuffer: true, stdout: truncated },
    { exitCode: null, signalCode: "SIGTERM", exitedDueToMaxBuffer: true, stdout: truncated },
  ] satisfies Shape[]) {
    test(`red:git-output-limit a git cut at the read limit is refused under its own kind (exit code ${shape.exitCode})`, () => {
      let report: ReturnType<typeof scanRepository> | undefined;
      const calls = withSpawnResult(shape, () => {
        report = scanRepository(dir, options);
        expect(() => buildManifest(dir, "fixture/repo")).toThrow("read limit");
      });
      expect(calls).toBeGreaterThan(0);
      expect(report?.findings).toEqual([{ surface: "read", kind: "git-output-limit", oid: "" }]);
    });
  }

  test("red:git-exit a git killed by a signal for another reason is a git failure, never read", () => {
    let report: ReturnType<typeof scanRepository> | undefined;
    const calls = withSpawnResult(
      { exitCode: null, signalCode: "SIGKILL", exitedDueToMaxBuffer: false, stdout: "" },
      () => {
        report = scanRepository(dir, options);
      },
    );
    expect(calls).toBeGreaterThan(0);
    expect(report?.findings).toEqual([{ surface: "read", kind: "git-failure", oid: "" }]);
  });

  // Real git, no double. A failing git writes its error to stderr and nothing to stdout. Were
  // stderr piped, it would count against maxBuffer: an error longer than the read limit would
  // set exitedDueToMaxBuffer and be reported as `git-output-limit` (measured in the review of
  // PR #300: 100 of 100 runs at a 64-byte cap). The limit is set below the length of git's
  // message, which names the missing directory.
  test("red:git-stderr-ignored a git error longer than the read limit is a git failure, not an output overrun", () => {
    setGitOutputLimit(16);
    try {
      expect(scanRepository(dir, options).findings).toEqual([
        { surface: "read", kind: "git-failure", oid: "" },
      ]);
    } finally {
      setGitOutputLimit(1 << 30);
    }
  });
});
