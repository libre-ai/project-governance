import { describe, expect, test } from "bun:test";

// Structure test of the `bun-quality` job of ci.yml (issue #299): it carries its own bound,
// so a hung run fails with a readable message instead of running to the 360-minute default.

const WORKFLOW_URL: URL = new URL("../../.github/workflows/ci.yml", import.meta.url);

interface Job {
  readonly name?: unknown;
  readonly "timeout-minutes"?: unknown;
}
interface Workflow {
  readonly jobs?: Record<string, Job>;
}

const workflow: Workflow = Bun.YAML.parse(await Bun.file(WORKFLOW_URL).text()) as Workflow;

describe("the bun-quality job", () => {
  test("has a bounded timeout, well under the 360-minute default", () => {
    const job: Job | undefined = workflow.jobs?.["bun-quality"];
    expect(job?.name).toBe("Bun quality");
    const minutes: unknown = job?.["timeout-minutes"];
    expect(Number.isInteger(minutes)).toBe(true);
    // The floor keeps room above the slowest run measured when the bound was set (295 s,
    // 2026-11-23); the ceiling keeps a hang from holding a runner for long.
    expect(minutes as number).toBeGreaterThanOrEqual(10);
    expect(minutes as number).toBeLessThanOrEqual(30);
  });
});
