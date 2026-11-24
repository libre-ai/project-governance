import { describe, expect, test } from "bun:test";

// Behaviour test of ci.yml (issue #299): whatever job runs `bun run check` stops on a finite time
// bound of its own, set on the job or on the step that runs the command. Without one, the job
// falls back to the 360-minute default, and a hung run is cancelled instead of failing.

const WORKFLOW_URL: URL = new URL("../../.github/workflows/ci.yml", import.meta.url);

interface Step {
  readonly run?: unknown;
  readonly "timeout-minutes"?: unknown;
}
interface Job {
  readonly steps?: readonly Step[];
  readonly "timeout-minutes"?: unknown;
}
interface Workflow {
  readonly jobs?: Record<string, Job>;
}

/**
 * The slowest `Bun quality` job of the 10 latest completed runs of ci.yml, measured on
 * 2026-11-23 (`gh run list --workflow ci.yml`, then `gh run view <id> --json jobs`): 223 s to
 * 295 s. Re-measure before moving the bounds below.
 */
const slowestMeasuredSeconds = 295;
/** The bound must let the slowest measured run finish. */
const floorMinutes: number = Math.ceil(slowestMeasuredSeconds / 60);
/** And stop a hung run within four times that run, so a hang costs minutes, not hours. */
const ceilingMinutes: number = Math.ceil((4 * slowestMeasuredSeconds) / 60);

const runsCheck = /(?:^|[\s;&|(])bun run check(?=$|[\s;&|)])/m;

const workflow: Workflow = Bun.YAML.parse(await Bun.file(WORKFLOW_URL).text()) as Workflow;

/** For each step that runs `bun run check`: the bound that applies to it, step first. */
function checkBounds(source: Workflow): unknown[] {
  const bounds: unknown[] = [];
  for (const job of Object.values(source.jobs ?? {}))
    for (const step of job.steps ?? [])
      if (typeof step.run === "string" && runsCheck.test(step.run))
        bounds.push(step["timeout-minutes"] ?? job["timeout-minutes"]);
  return bounds;
}

describe("the job that runs bun run check", () => {
  test("is found, and every step that runs it has a finite bound within the measured range", () => {
    const bounds = checkBounds(workflow);
    expect(bounds.length).toBeGreaterThan(0);
    for (const minutes of bounds) {
      expect(Number.isInteger(minutes)).toBe(true);
      expect(minutes as number).toBeGreaterThan(floorMinutes);
      expect(minutes as number).toBeLessThanOrEqual(ceilingMinutes);
    }
  });

  test("the bound is read on the job or on the step, and only for that exact command", () => {
    const step = { run: "bun run check" };
    expect(checkBounds({ jobs: { a: { steps: [step], "timeout-minutes": 20 } } })).toEqual([20]);
    expect(checkBounds({ jobs: { a: { steps: [{ ...step, "timeout-minutes": 15 }] } } })).toEqual([
      15,
    ]);
    expect(checkBounds({ jobs: { a: { steps: [step] } } })).toEqual([undefined]);
    expect(checkBounds({ jobs: { a: { steps: [{ run: "bun run check:attestation" }] } } })).toEqual(
      [],
    );
  });
});
