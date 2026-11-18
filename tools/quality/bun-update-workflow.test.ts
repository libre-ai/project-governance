import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The bounds ADR-0069 sets on the only workflow of this repository that writes
// with the job token. A real run is the other half of the proof, and it cannot
// happen before the owner accepts the ADR: these assertions hold the wiring.

interface Step {
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, string>;
}
interface Job {
  readonly if?: string;
  readonly needs?: string;
  readonly permissions?: Record<string, string>;
  readonly steps: readonly Step[];
}
interface Workflow {
  readonly on: Record<string, unknown>;
  readonly permissions: Record<string, string>;
  readonly jobs: Record<string, Job>;
}

const source = readFileSync(
  new URL("../../.github/workflows/bun-update.yml", import.meta.url),
  "utf8",
);
const workflow = Bun.YAML.parse(source) as Workflow;
const jobs = Object.values(workflow.jobs);
const steps = jobs.flatMap((job) => [...job.steps]);
const plan = workflow.jobs.plan as Job;
const propose = workflow.jobs.propose as Job;

/** `bun`, any options, then a subcommand that installs, spelled in full or by its alias. */
const INSTALLS = /\bbun\b[^\n;&|]*\s(?:install|i|add|a|update)(?:\s|$)/m;

describe("the bun update workflow", () => {
  test.each([
    "bun install",
    "bun i",
    "bun i --frozen-lockfile",
    "bun --cwd=tools i",
    "bun add left-pad",
    "bun a left-pad",
    "bun update",
  ])("recognises `%s` as an install", (command) => {
    expect(command).toMatch(INSTALLS);
  });

  test.each([
    'bun tools/fleet/plan-bun-update.ts --root "$GITHUB_WORKSPACE" --out "$RUNNER_TEMP/bun-update"',
    'test "$(bun --revision)" = "1.4.0"',
  ])("does not read `%s` as an install", (command) => {
    expect(command).not.toMatch(INSTALLS);
  });

  test("starts by hand only: no schedule until the ADR is accepted", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  });

  test("grants nothing at workflow level", () => {
    expect(workflow.permissions).toEqual({});
  });

  test("the job that resolves dependencies cannot write", () => {
    expect(plan.permissions).toEqual({ contents: "read" });
  });

  test("the one job that writes holds exactly its two permissions, after the plan", () => {
    expect(propose.permissions).toEqual({ contents: "write", "pull-requests": "write" });
    expect(propose.needs).toBe("plan");
  });

  test("no other job writes", () => {
    const writers = Object.entries(workflow.jobs)
      .filter(([, job]) => Object.values(job.permissions ?? {}).includes("write"))
      .map(([id]) => id);
    expect(writers).toEqual(["propose"]);
  });

  test("runs only from the served branch", () => {
    for (const job of jobs) expect(job.if).toContain("github.event.repository.default_branch");
  });

  test("holds no stored secret and no privileged trigger", () => {
    expect(source).not.toContain("secrets.");
    expect(source).not.toContain("pull_request_target");
  });

  test("every action is pinned to a full commit sha", () => {
    const actions = steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses]));
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  test("every checkout leaves no credential behind", () => {
    const checkouts = steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkouts).toHaveLength(2);
    for (const checkout of checkouts) expect(checkout.with?.["persist-credentials"]).toBe(false);
  });

  test("no step installs dependencies, forces a push or merges", () => {
    const commands = steps.flatMap((step) => (step.run === undefined ? [] : [step.run]));
    for (const command of commands) {
      expect(command).not.toMatch(INSTALLS);
      expect(command).not.toContain("--force");
      expect(command).not.toMatch(/\bgh pr merge\b/);
    }
  });

  test("the token reaches only the step that proposes", () => {
    const holders = steps.filter((step) =>
      Object.values(step.env ?? {}).some((value) => value.includes("github.token")),
    );
    expect(holders).toHaveLength(1);
    expect(holders[0]?.run).toContain("tools/fleet/propose-bun-update.ts");
    expect(plan.steps).not.toContain(holders[0] as Step);
  });
});
