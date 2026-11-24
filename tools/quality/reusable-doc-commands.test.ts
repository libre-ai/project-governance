import { describe, expect, test } from "bun:test";
import { classifyReference, scanUsesLines } from "../../ecosystem/check-action-pins";
import { findUnreadableCharacter } from "./yaml-text-guard";

// Structure test of the reusable doc-commands workflow, on the model of
// reusable-artifact-lifecycle.test.ts.
//
// What it proves, and what it cannot: the file parses, it is callable, it
// grants the job the one permission the gate needs and nothing else, it runs
// only the pinned checkout, no author-controlled value reaches a shell, no
// token is handed to any step, and every step carries EXACTLY the reviewed
// lines. A real `workflow_call` from a consumer remains the only proof of the
// wiring, and cannot be produced before this repository publishes the workflow.
//
// The threat is the one of any pull request gate: the pull request is
// author-controlled input (its documents, its manifests AND its registry), so
// the gate comes from the governance checkout at a pinned revision, runs from
// that trusted directory, reads the pull request only as the absolute path it
// is given, and executes nothing it reads there.

const WORKFLOW_URL: URL = new URL(
  "../../.github/workflows/reusable-doc-commands.yml",
  import.meta.url,
);
const SIBLING_URL: URL = new URL("../../.github/workflows/pr-door.yml", import.meta.url);
const BUN_POLICY_URL: URL = new URL("../../toolchains/bun.json", import.meta.url);

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly shell?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
  readonly "working-directory"?: string;
}
interface Job {
  readonly name?: unknown;
  readonly "runs-on"?: unknown;
  readonly "timeout-minutes"?: unknown;
  readonly permissions?: unknown;
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
const siblingWorkflow: Workflow = Bun.YAML.parse(await Bun.file(SIBLING_URL).text()) as Workflow;
const siblingSteps: readonly Step[] = Object.values(siblingWorkflow.jobs ?? {}).flatMap(
  (siblingJob) => siblingJob.steps ?? [],
);
const bunPolicy: { readonly revision: string } = (await Bun.file(BUN_POLICY_URL).json()) as {
  readonly revision: string;
};

/** The opening of a workflow expression, assembled so that no template-looking literal sits in this file. */
const EXPRESSION: string = ["$", "{{"].join("");
const expression = (inner: string): string => `${EXPRESSION} ${inner} }}`;
const RUNNER_TEMP_DIRECTORY: string = expression("runner.temp");
const TOOLING_WORKING_DIRECTORY: string = `${RUNNER_TEMP_DIRECTORY}/governance-tooling`;

const jobs: readonly [string, Job][] = Object.entries(workflow.jobs ?? {});
const job: Job = jobs[0]?.[1] ?? {};
const steps: readonly Step[] = job.steps ?? [];

const linesOf = (step: Step | null): string[] =>
  (step?.run ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const keysOf = (value: unknown): string[] =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];

// The steps are taken by POSITION, never by what they contain: a step located
// by its content disappears from the assertions as soon as it is altered.
const checkoutStep: Step | null = steps[0] ?? null;
const toolingStep: Step | null = steps[1] ?? null;
const bunInstallStep: Step | null = steps[2] ?? null;
const bunRevisionStep: Step | null = steps[3] ?? null;
const gateStep: Step | null = steps[4] ?? null;
const runSteps: readonly (Step | null)[] = [toolingStep, bunInstallStep, bunRevisionStep, gateStep];

/** Comments are not part of the workflow: a line comment is dropped before any text scan. */
const uncommented: string = text.replace(/^\s*#.*$/gm, "");

describe("the file is read as one document", () => {
  test("it holds no character that a line scan and the YAML parser read differently", () => {
    expect(findUnreadableCharacter(text)).toBeNull();
  });
});

describe("trigger, input and names", () => {
  test("workflow_call is the only trigger", () => {
    expect(keysOf(workflow.on)).toEqual(["workflow_call"]);
  });

  test("tooling_ref is the only input, required, and a string", () => {
    const on = workflow.on as { workflow_call?: { inputs?: Record<string, unknown> } };
    expect(keysOf(on.workflow_call)).toEqual(["inputs"]);
    const inputs: Record<string, unknown> = on.workflow_call?.inputs ?? {};
    expect(Object.keys(inputs)).toEqual(["tooling_ref"]);
    const input = inputs.tooling_ref as { required?: unknown; type?: unknown };
    expect(input.required).toBe(true);
    expect(input.type).toBe("string");
  });

  // The name of the job is the name of the check a ruleset of a consuming
  // repository requires: renaming it leaves a required check no run reports.
  test("the only job is doc-commands, named Doc commands", () => {
    expect(workflow.name).toBe("reusable-doc-commands");
    expect(jobs.map(([id]) => id)).toEqual(["doc-commands"]);
    expect(job.name).toBe("Doc commands");
  });
});

describe("authority of the job", () => {
  const EXACT: Record<string, string> = { contents: "read" };

  test("the workflow and the job grant exactly contents: read", () => {
    expect(workflow.permissions).toEqual(EXACT);
    expect(job.permissions).toEqual(EXACT);
  });

  test("the runner is ubuntu-latest and the timeout is bounded between 1 and 30 minutes", () => {
    expect(job["runs-on"]).toBe("ubuntu-latest");
    const minutes: unknown = job["timeout-minutes"];
    expect(Number.isInteger(minutes)).toBe(true);
    expect(minutes as number).toBeGreaterThanOrEqual(1);
    expect(minutes as number).toBeLessThanOrEqual(30);
  });
});

// A key declared above the steps reaches every step without any step-level
// assertion seeing it (`env`, `defaults`), moves the job (`container`,
// `services`) or lets it not fail (`if`, `continue-on-error`). The inventory of
// keys is closed at every level, so an unforeseen key is a red test.
describe("nothing is inherited, skipped or tolerated", () => {
  test("the workflow holds exactly the reviewed top-level keys", () => {
    expect(keysOf(workflow)).toEqual(["jobs", "name", "on", "permissions"]);
  });

  test("the job holds exactly the reviewed keys", () => {
    expect(keysOf(job)).toEqual(["name", "permissions", "runs-on", "steps", "timeout-minutes"]);
  });

  test.each([
    "env",
    "defaults",
    "container",
    "services",
    "if",
    "continue-on-error",
  ])("`%s` is absent at the workflow level and at the job level", (key) => {
    expect(Object.hasOwn(workflow, key)).toBe(false);
    expect(Object.hasOwn(job, key)).toBe(false);
  });

  test("the job has exactly five steps, each with exactly the reviewed keys", () => {
    expect(steps.length).toBe(5);
    expect(keysOf(checkoutStep)).toEqual(["uses", "with"]);
    expect(keysOf(toolingStep)).toEqual(["env", "name", "run", "shell", "working-directory"]);
    expect(keysOf(bunInstallStep)).toEqual(["env", "name", "run", "shell", "working-directory"]);
    expect(keysOf(bunRevisionStep)).toEqual(["name", "run", "shell", "working-directory"]);
    expect(keysOf(gateStep)).toEqual(["name", "run", "shell", "working-directory"]);
  });

  // The gate reads files and nothing else: it is given no variable at all.
  test("the env of every step is exactly the reviewed one, and the gate step has none", () => {
    expect(keysOf(toolingStep?.env)).toEqual(["TOOLING_REF"]);
    expect(keysOf(bunInstallStep?.env)).toEqual(["BUN_ARCHIVE_SHA256", "BUN_ARCHIVE_URL"]);
    expect(Object.hasOwn(gateStep ?? {}, "env")).toBe(false);
  });
});

describe("the only action is the pinned checkout", () => {
  test("the line scanner and the YAML parse agree on a single `uses:`", () => {
    const fromLines: string[] = scanUsesLines(text).map((use) => use.reference);
    const fromSteps: string[] = steps
      .map((step) => step.uses)
      .filter((uses): uses is string => typeof uses === "string");
    expect(fromLines).toEqual(fromSteps);
    expect(fromLines.length).toBe(1);
  });

  test("it is pinned to a full commit, and is the very one of pr-door.yml", () => {
    const uses: string = checkoutStep?.uses ?? "";
    expect(classifyReference(uses)).toBe("pinned");
    expect(uses.split("@")[1]).toMatch(/^[0-9a-f]{40}$/);
    const siblingCheckout: Step | null =
      siblingSteps.find((step) => (step.uses ?? "").startsWith("actions/checkout@")) ?? null;
    expect(siblingCheckout).not.toBeNull();
    expect(uses).toBe(siblingCheckout?.uses ?? "");
  });

  // The gate reads the tree of one commit, so no history is fetched; no
  // credential stays in the git configuration of a workspace the gate then reads.
  test("it leaves no credential, and takes nothing else", () => {
    expect(checkoutStep?.with).toEqual({ "persist-credentials": false });
  });
});

describe("no author-controlled value reaches a shell", () => {
  // `${{ ... }}` in a `run:` is substituted into the script text before the
  // shell reads it. Values travel through `env:` and are read as variables.
  test("no `run:` of any step holds an expression", () => {
    for (const step of steps) expect(step.run ?? "").not.toContain(EXPRESSION);
  });

  test("an expression sits only in `env:`, or is the runner temporary directory of a step", () => {
    for (const step of steps) {
      const outside: string = JSON.stringify(
        Object.fromEntries(
          Object.entries(step).filter(([key]) => key !== "env" && key !== "working-directory"),
        ),
      );
      expect(outside).not.toContain(EXPRESSION);
    }
    expect(toolingStep?.["working-directory"]).toBe(RUNNER_TEMP_DIRECTORY);
    expect(bunInstallStep?.["working-directory"]).toBe(RUNNER_TEMP_DIRECTORY);
    expect(bunRevisionStep?.["working-directory"]).toBe(RUNNER_TEMP_DIRECTORY);
    expect(gateStep?.["working-directory"]).toBe(TOOLING_WORKING_DIRECTORY);
  });

  test("tooling_ref is written once, in an env, and nothing of the event is read", () => {
    expect(toolingStep?.env?.TOOLING_REF).toBe(expression("inputs.tooling_ref"));
    expect(uncommented.match(/inputs\./g)?.length).toBe(1);
    expect(uncommented).not.toMatch(/github\.event\./);
  });
});

// The steps are asserted line by line, exactly: a `|| true`, a commented-out
// block, an unanchored pattern or an extra fetch changes the lines.
describe("every step carries exactly the reviewed lines", () => {
  const TOOLING_LINES: readonly string[] = [
    'if [[ ! "$TOOLING_REF" =~ ^[0-9a-f]{40}$ ]]; then',
    'echo "::error::tooling_ref must be a full commit of 40 lowercase hexadecimal characters"',
    "exit 1",
    "fi",
    'TOOLING_DIR="$RUNNER_TEMP/governance-tooling"',
    'mkdir "$TOOLING_DIR"',
    'git init --quiet "$TOOLING_DIR"',
    'git -C "$TOOLING_DIR" fetch --quiet --depth=1 https://github.com/libre-ai/project-governance.git "$TOOLING_REF"',
    'git -C "$TOOLING_DIR" checkout --quiet --detach FETCH_HEAD',
    'test "$(git -C "$TOOLING_DIR" rev-parse HEAD)" = "$TOOLING_REF"',
  ];
  const INSTALL_LINES: readonly string[] = [
    'curl --fail --location --retry 3 --output "$RUNNER_TEMP/bun.zip" "$BUN_ARCHIVE_URL"',
    'echo "$BUN_ARCHIVE_SHA256  $RUNNER_TEMP/bun.zip" | sha256sum --check --strict',
    'unzip -q "$RUNNER_TEMP/bun.zip" -d "$RUNNER_TEMP"',
    'echo "$RUNNER_TEMP/bun-linux-x64" >> "$GITHUB_PATH"',
  ];
  const GATE_LINES: readonly string[] = [
    "bun --no-env-file tools/quality/check-bun-minimum.ts",
    'bun --no-env-file tools/quality/check-doc-commands.ts "$GITHUB_WORKSPACE"',
  ];

  test("the tooling step", () => {
    expect(linesOf(toolingStep)).toEqual([...TOOLING_LINES]);
  });

  test("the Bun install step, with the archive and the sha256 of pr-door.yml", () => {
    expect(linesOf(bunInstallStep)).toEqual([...INSTALL_LINES]);
    const siblingInstall: Step | null =
      siblingSteps.find((step) => (step.run ?? "").includes("sha256sum")) ?? null;
    expect(String(siblingInstall?.env?.BUN_ARCHIVE_SHA256)).toMatch(/^[0-9a-f]{64}$/);
    expect(bunInstallStep?.env).toEqual(siblingInstall?.env ?? {});
  });

  test("the Bun revision step, against toolchains/bun.json", () => {
    expect(linesOf(bunRevisionStep)).toEqual([
      `test "$(bun --revision)" = "${bunPolicy.revision}"`,
    ]);
  });

  test("the gate step is the last one and carries its two lines", () => {
    expect(steps.indexOf(gateStep as Step)).toBe(steps.length - 1);
    expect(linesOf(gateStep)).toEqual([...GATE_LINES]);
  });

  // `shell: bash` makes GitHub run `bash -eo pipefail`: a failing command, or a
  // failing stage of the `sha256sum` pipe, ends the step.
  test("every step that runs a script says `shell: bash`", () => {
    for (const step of runSteps) expect(step?.shell).toBe("bash");
  });

  test("no body swallows a failure, chains commands or writes the environment of later steps", () => {
    for (const step of runSteps) {
      const body: string = step?.run ?? "";
      expect(body).not.toContain("||");
      expect(body).not.toContain("&&");
      expect(body).not.toContain("#");
      expect(body).not.toMatch(/\btrue\b|set \+e|exit 0/);
      expect(body).not.toContain("GITHUB_ENV");
    }
  });

  // The pull request is read as an argument of the gate, never run, sourced or
  // installed: only the gate step names the workspace, and no step runs a
  // package manager or a relative path.
  test("only the gate names the workspace, and no step runs a package manager", () => {
    for (const step of steps) {
      const body: string = step.run ?? "";
      if (step !== gateStep) expect(body).not.toContain("GITHUB_WORKSPACE");
      expect(body).not.toMatch(/bun run |bun install|bunx |npm |npx |yarn |pnpm /);
      expect(body).not.toMatch(/(^|\s)\.\//m);
    }
    expect((gateStep?.run ?? "").match(/GITHUB_WORKSPACE/g)?.length).toBe(1);
  });
});

describe("the token", () => {
  test("no token and no secret is written anywhere in the file", () => {
    expect(uncommented).not.toMatch(/GITHUB_TOKEN|GH_TOKEN/);
    expect(uncommented).not.toMatch(/github\.token/);
    expect(uncommented).not.toMatch(/secrets\./);
  });

  test("nothing echoes, traces or lists the environment", () => {
    for (const step of steps) {
      expect(step.run ?? "").not.toMatch(/\bset -[a-z]*x|\bprintenv\b|(^|\s)env(\s|$)/m);
    }
  });
});
