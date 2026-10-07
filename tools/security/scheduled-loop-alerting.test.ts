import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every scheduled loop of this repository must surface its own failure and
// its own recovery through tools/security/repeat-failure-alert.ts. The
// 2026-09-07 finding this guards against: the alert step was wired into four
// scheduled workflows and forgotten in three others, and "Org README drift"
// stayed red for two consecutive weeks without a single issue opening —
// exactly the silence docs/method/AGENTIC-LOOP-INVENTORY.md names as a
// failure mode ("absence de ligne récente"). A workflow-by-workflow habit
// drifts; this test enumerates the `schedule` triggers itself so a new loop
// cannot be added without its alert.

const WORKFLOW_DIRECTORY = new URL("../../.github/workflows/", import.meta.url).pathname;
const ALERT_SCRIPT = "tools/security/repeat-failure-alert.ts";

interface Step {
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
  readonly env?: Record<string, string>;
}
interface Job {
  readonly steps?: readonly Step[];
}
interface Workflow {
  readonly name?: string;
  readonly on?: Record<string, unknown>;
  readonly permissions?: Record<string, string>;
  readonly jobs?: Record<string, Job>;
}

const parse = (name: string): Workflow =>
  Bun.YAML.parse(readFileSync(join(WORKFLOW_DIRECTORY, name), "utf8")) as Workflow;

const scheduled = readdirSync(WORKFLOW_DIRECTORY)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .filter((name) => parse(name).on?.schedule !== undefined)
  .sort();

const stepsOf = (workflow: Workflow): Step[] =>
  Object.values(workflow.jobs ?? {}).flatMap((job) => [...(job.steps ?? [])]);

const alertSteps = (workflow: Workflow): Step[] =>
  stepsOf(workflow).filter((step) => (step.run ?? "").includes(ALERT_SCRIPT));

// A loop's own runs are its scheduled ticks and manual dispatches. A `push`
// or `pull_request` run of a workflow that also has a schedule is the CI
// gate's business: a branch failing twice must never file a fleet issue, and
// a branch passing must never close one.
const LOOP_EVENT_GUARD =
  /github\.event_name\s*==\s*'schedule'\s*\|\|\s*github\.event_name\s*==\s*'workflow_dispatch'/;

describe("scheduled loops", () => {
  // A moved directory or a renamed trigger must turn this red, never make it
  // vacuously green.
  test("at least one workflow runs on a schedule", () => {
    expect(scheduled.length).toBeGreaterThan(0);
  });

  test.each(scheduled)("%s files an issue on a repeated failure", (name) => {
    const workflow = parse(name);
    const alerts = alertSteps(workflow).filter((step) => !(step.run ?? "").includes("--resolve"));
    expect(alerts).toHaveLength(1);
    const alert = alerts[0];
    expect(alert?.if).toMatch(/failure\(\)/);
    expect(alert?.if).toMatch(LOOP_EVENT_GUARD);
  });

  // The issue the alert opened must not outlive the failure it reports: an
  // open issue about a loop that is green again is one more line nobody
  // reads (governance#85 stayed unread for a week). The green run closes it,
  // with the run URL as the evidence.
  test.each(scheduled)("%s closes its issue once it is green again", (name) => {
    const workflow = parse(name);
    const resolves = alertSteps(workflow).filter((step) => (step.run ?? "").includes("--resolve"));
    expect(resolves).toHaveLength(1);
    const resolve = resolves[0];
    expect(resolve?.if).toMatch(/success\(\)/);
    expect(resolve?.if).toMatch(LOOP_EVENT_GUARD);
  });

  test.each(scheduled)("%s hands the alert the identity it reports under", (name) => {
    const workflow = parse(name);
    for (const step of alertSteps(workflow)) {
      // The workflow name is the issue's dedup key and the file name is what
      // `gh run list --workflow` resolves: both must be this file's, or the
      // alert reports about a different loop.
      expect(step.env?.WORKFLOW_NAME).toBe(workflow.name);
      expect(step.env?.WORKFLOW_FILE).toBe(name);
      expect(step.env?.CURRENT_RUN_URL).toContain("github.run_id");
      expect(step.env?.GH_TOKEN).toBeDefined();
    }
  });

  test.each(scheduled)("%s may write issues — the alert is otherwise a 403", (name) => {
    expect(parse(name).permissions?.issues).toBe("write");
  });
});
