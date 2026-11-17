import { describe, expect, test } from "bun:test";
import { classifyReference, scanUsesLines } from "../../ecosystem/check-action-pins";
import { findUnreadableCharacter } from "./yaml-text-guard";

// Structure test of the reusable shell-lint workflow.
//
// What it proves, and what it cannot: the file parses, it is callable without
// any parameter, it grants read access to the contents and nothing else, it
// runs only pinned actions, its single script step is EXACTLY the reviewed call
// and the shellcheck image is referenced by digest. The behaviour of the call
// is proved by check-shell-lint.test.ts. A real `workflow_call` from a consumer
// and the verdict of the real shellcheck image are proved on a runner only.

const WORKFLOW_URL: URL = new URL(
  "../../.github/workflows/reusable-shell-lint.yml",
  import.meta.url,
);

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly shell?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
}
interface Job {
  readonly name?: unknown;
  readonly "runs-on"?: unknown;
  readonly "timeout-minutes"?: unknown;
  readonly steps?: readonly Step[];
}
interface Workflow {
  readonly name?: unknown;
  readonly on?: unknown;
  readonly permissions?: unknown;
  readonly jobs?: Record<string, Job>;
}

const text: string = await Bun.file(WORKFLOW_URL).text();
const workflow: Workflow = Bun.YAML.parse(text) as Workflow;

const jobs: readonly [string, Job][] = Object.entries(workflow.jobs ?? {});
const job: Job = jobs[0]?.[1] ?? {};
const steps: readonly Step[] = job.steps ?? [];

// The steps are taken by POSITION, never by what they contain: a step located
// by its content disappears from the assertions as soon as it is altered.
const checkoutStep: Step | null = steps[0] ?? null;
const lintStep: Step | null = steps[1] ?? null;

/** Comments are not part of the workflow: a line comment is dropped before any text scan. */
const uncommented: string = text.replace(/^\s*#.*$/gm, "");

/** The keys of a mapping, sorted; a value that is not a mapping has none. */
const keysOf = (value: unknown): string[] =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];

describe("the file is read as one document", () => {
  test("it holds no character that a line scan and the YAML parser read differently", () => {
    expect(findUnreadableCharacter(text)).toBeNull();
  });

  test("the line scanner and the YAML parse agree on every `uses:`", () => {
    const fromLines: string[] = scanUsesLines(text)
      .map((use) => use.reference)
      .sort();
    const fromSteps: string[] = steps
      .map((step) => step.uses)
      .filter((uses): uses is string => typeof uses === "string")
      .sort();
    expect(fromLines).toEqual(fromSteps);
  });
});

describe("trigger: callable, and without any parameter", () => {
  test("`on` holds workflow_call and nothing else", () => {
    expect(keysOf(workflow.on)).toEqual(["workflow_call"]);
  });

  test("workflow_call declares no input, no secret and no output", () => {
    const call: unknown = (workflow.on as { workflow_call?: unknown }).workflow_call;
    expect(keysOf(call)).toEqual([]);
    expect(uncommented).not.toMatch(/\binputs\b|\bsecrets\b/);
  });
});

describe("authority of the job", () => {
  test("the workflow grants exactly contents: read", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  test("the workflow holds exactly the reviewed top-level keys", () => {
    expect(keysOf(workflow)).toEqual(["jobs", "name", "on", "permissions"]);
  });

  test("there is one job, shell-lint, with exactly the reviewed keys", () => {
    expect(jobs.map(([id]: [string, Job]): string => id)).toEqual(["shell-lint"]);
    // No `permissions`, `env`, `defaults`, `container`, `services`, `if` or
    // `continue-on-error` at job level: the inventory of keys is closed.
    expect(keysOf(job)).toEqual(["name", "runs-on", "steps", "timeout-minutes"]);
    expect(job["runs-on"]).toBe("ubuntu-latest");
  });

  test("there is no container and no service anywhere", () => {
    expect(uncommented).not.toMatch(/^\s*(container|services)\s*:/m);
  });

  test("the job has a bounded timeout", () => {
    const minutes: unknown = job["timeout-minutes"];
    expect(Number.isInteger(minutes)).toBe(true);
    expect(minutes as number).toBeGreaterThanOrEqual(1);
    expect(minutes as number).toBeLessThanOrEqual(30);
  });
});

describe("a blocking job", () => {
  // A skipped or tolerated gate step is a gate that cannot fail.
  test("nothing is tolerated: no continue-on-error, no `|| true`, no condition", () => {
    expect(uncommented).not.toContain("continue-on-error");
    expect(uncommented).not.toMatch(/\|\|\s*true/);
    expect(uncommented).not.toMatch(/^\s*(-\s+)?if\s*:/m);
  });
});

describe("pinned actions", () => {
  test("the only action is the checkout, pinned to a full commit sha", () => {
    const uses = scanUsesLines(text);
    expect(uses.length).toBe(1);
    for (const use of uses) {
      expect(classifyReference(use.reference)).toBe("pinned");
      expect(use.reference).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
    }
    expect(checkoutStep?.uses).toBe(uses[0]?.reference);
  });

  test("the checkout leaves no credential in the git configuration, and takes nothing else", () => {
    expect(keysOf(checkoutStep)).toEqual(["uses", "with"]);
    expect(checkoutStep?.with).toEqual({ "persist-credentials": false });
  });
});

describe("the single script step", () => {
  test("the job has exactly two steps: checkout, then the lint", () => {
    expect(steps.length).toBe(2);
    expect(steps.filter((step) => Object.hasOwn(step, "run")).length).toBe(1);
  });

  test("its `run` is exactly the call of the script", () => {
    expect(lintStep?.run).toBe("bash tools/quality/check-shell-lint.sh");
    expect(lintStep?.shell).toBe("bash");
    expect(keysOf(lintStep)).toEqual(["env", "name", "run", "shell"]);
  });

  test("SHELLCHECK_IMAGE is its only variable, set at step level, by digest", () => {
    expect(keysOf(lintStep?.env)).toEqual(["SHELLCHECK_IMAGE"]);
    expect(String(lintStep?.env?.SHELLCHECK_IMAGE)).toMatch(
      /^[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/,
    );
    expect(uncommented.match(/SHELLCHECK_IMAGE/g)?.length).toBe(1);
  });

  test("the launcher is never substituted in the workflow", () => {
    expect(text).not.toContain("SHELLCHECK_BIN");
  });
});

describe("no volatile or machine-local fact", () => {
  test("no hardcoded branch name", () => {
    expect(text).not.toMatch(/\b(main|master|develop|trunk)\b/);
    expect(uncommented).not.toMatch(/\b(branches|ref)\s*:/);
  });

  test("no machine-local path", () => {
    expect(text).not.toContain(["", "Users", ""].join("/"));
    expect(text).not.toContain(["", "home", ""].join("/"));
  });
});
