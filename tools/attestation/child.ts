/**
 * The one way the attestation tests start a child process (issue #299).
 *
 * A child killed on a time budget, its own or the test's, has an exit code of `null`. Read
 * as a number, that `null` fails `expect(code).toBe(0)` like a real refusal would, and passes
 * `expect(code).not.toBe(0)` like a real refusal would too. neutralise-check.ts then counted a
 * mutant "caught" by the clock alone as proved by an assertion. Here a killed child never
 * returns an exit code: it throws `ChildKilled`, which names the signal, so the test that
 * started it fails as a crash, which the harness never counts as a proof.
 *
 * Each child also gets its own time budget. 60 s is far above the slowest test measured under
 * load (about 7 s with 96 parallel copies, PR #297) and below the 120 s per-test budget that
 * PR raises the attestation files to, so a hung child is killed and named before the test's
 * own budget runs out. Under a shorter test budget, Bun kills the child first; it still reads
 * as a signal.
 */

export const childTimeoutMs = 60_000;

export class ChildKilled extends Error {
  readonly command: string;
  readonly signalCode: string;

  constructor(command: string, signalCode: string, timeoutMs: number) {
    super(
      `${command} was killed by ${signalCode}: it ran past its ${timeoutMs} ms budget or the test's`,
    );
    this.name = "ChildKilled";
    this.command = command;
    this.signalCode = signalCode;
  }
}

export interface ChildOptions {
  readonly env?: Record<string, string | undefined>;
  readonly stdin?: "ignore" | Uint8Array;
  readonly cwd?: string;
  /** Only the tests of this module shorten it. */
  readonly timeoutMs?: number;
}

export interface ChildResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

/** Run a command to completion; throw `ChildKilled` if it ended on a signal. */
export function runChild(command: readonly string[], options: ChildOptions = {}): ChildResult {
  const timeoutMs = options.timeoutMs ?? childTimeoutMs;
  const result = Bun.spawnSync([...command], {
    env: options.env,
    stdin: options.stdin,
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  // The type says `number`; the runtime gives `null` for a killed child.
  const exitCode: number | null = result.exitCode;
  if (exitCode === null || (result.signalCode !== undefined && result.signalCode !== null))
    throw new ChildKilled(command[0] ?? "", result.signalCode ?? "an unknown signal", timeoutMs);
  return { exitCode, stdout: result.stdout, stderr: result.stderr };
}
