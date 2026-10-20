import { describe, expect, test } from "bun:test";
import { classifyReference, scanUsesLines } from "../../ecosystem/check-action-pins";
import { findUnreadableCharacter } from "./yaml-text-guard";

// Structure test of the reusable work-package-link workflow (design §6).
//
// What it proves, and what it cannot: the file parses, it is callable, it
// grants the job the two permissions the gate needs and nothing else, it runs
// only pinned actions, and no author-controlled value reaches a shell. A real
// `workflow_call` from a consumer remains the only proof of the wiring, and
// cannot be produced before this repository publishes the workflow.
//
// The threat this guards is the one of a pull request gate: the pull request
// is author-controlled input, so the gate must come from the governance
// checkout at a pinned revision, never from the workspace of the pull
// request, and nothing of the pull request may run before it.

const WORKFLOW_URL: URL = new URL(
  "../../.github/workflows/reusable-work-package-link.yml",
  import.meta.url,
);
const SIBLING_URL: URL = new URL("../../.github/workflows/pr-door.yml", import.meta.url);
const BUN_POLICY_URL: URL = new URL("../../toolchains/bun.json", import.meta.url);

interface Step {
  readonly name?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
  readonly "working-directory"?: string;
  readonly "continue-on-error"?: unknown;
}
interface Job {
  readonly "runs-on"?: unknown;
  readonly "timeout-minutes"?: unknown;
  readonly permissions?: unknown;
  readonly container?: unknown;
  readonly services?: unknown;
  readonly steps?: readonly Step[];
}
interface Workflow {
  readonly on?: unknown;
  readonly permissions?: unknown;
  readonly container?: unknown;
  readonly services?: unknown;
  readonly jobs?: Record<string, Job>;
}

const text: string = await Bun.file(WORKFLOW_URL).text();
const workflow: Workflow = Bun.YAML.parse(text) as Workflow;
const siblingWorkflow: Workflow = Bun.YAML.parse(await Bun.file(SIBLING_URL).text()) as Workflow;
const bunPolicy: { readonly revision: string } = (await Bun.file(BUN_POLICY_URL).json()) as {
  readonly revision: string;
};

const FORTY_HEX: RegExp = /^[0-9a-f]{40}$/;
/** The opening of a workflow expression, assembled so that no template-looking literal sits in this file. */
const EXPRESSION: string = ["$", "{{"].join("");
/** `${{ <inner> }}` as GitHub reads it. */
const expression = (inner: string): string => `${EXPRESSION} ${inner} }}`;

const jobs: readonly [string, Job][] = Object.entries(workflow.jobs ?? {});
const job: Job = jobs[0]?.[1] ?? {};
const steps: readonly Step[] = job.steps ?? [];

/** The trigger names, whether `on` is written as a string, a list or a mapping. */
function triggerNames(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  if (typeof on === "object" && on !== null) return Object.keys(on);
  return [];
}

const label = (step: Step, index: number): string =>
  `[${index}] ${step.name ?? step.uses ?? step.run?.split("\n")[0] ?? "unnamed"}`;

/** The step without its `env` block: where a value may reach a shell, a flag or a log. */
const serializedWithout = (step: Step, omitted: readonly string[]): string =>
  JSON.stringify(
    Object.fromEntries(Object.entries(step).filter(([key]) => !omitted.includes(key))),
  );
const withoutEnv = (step: Step): string => serializedWithout(step, ["env"]);

/** A step that is not there is `null`: the assertions below name what is missing. */
const findStep = (predicate: (step: Step) => boolean): Step | null => steps.find(predicate) ?? null;
const gateStep: Step | null = findStep((step) =>
  (step.run ?? "").includes("check-work-package-link.ts"),
);
const toolingStep: Step | null = findStep((step) => Object.hasOwn(step.env ?? {}, "TOOLING_REF"));
// `git -C "$TOOLING_DIR" fetch ...`: the verbs are located by their surrounding spaces.
const FETCH: string = " fetch ";
const CHECKOUT: string = " checkout ";
const bunInstallStep: Step | null = findStep((step) => (step.run ?? "").includes("sha256sum"));
const bunRevisionStep: Step | null = findStep((step) =>
  (step.run ?? "").includes("bun --revision"),
);
const checkoutStep: Step | null = findStep((step) =>
  (step.uses ?? "").startsWith("actions/checkout@"),
);

const indexOfStep = (step: Step | null): number => (step === null ? -1 : steps.indexOf(step));

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

describe("trigger and input", () => {
  test("workflow_call is the only trigger", () => {
    expect(triggerNames(workflow.on)).toEqual(["workflow_call"]);
  });

  // The trigger of a pull request gate belongs to the CALLER. `pull_request_target`
  // would hand the called job a write-capable token and the secrets of the base
  // repository while it reads a head that its author controls.
  test.each([
    "pull_request_target",
    "pull_request",
    "push",
  ])("%s is not a trigger of the reusable workflow", (name) => {
    expect(triggerNames(workflow.on)).not.toContain(name);
  });

  test("tooling_ref is the only input, required, and a string", () => {
    const on: { workflow_call?: { inputs?: Record<string, unknown> } } = workflow.on as {
      workflow_call?: { inputs?: Record<string, unknown> };
    };
    const inputs: Record<string, unknown> = on.workflow_call?.inputs ?? {};
    expect(Object.keys(inputs)).toEqual(["tooling_ref"]);
    const input: { required?: unknown; type?: unknown } = inputs.tooling_ref as {
      required?: unknown;
      type?: unknown;
    };
    expect(input.required).toBe(true);
    expect(input.type).toBe("string");
  });

  test("the workflow declares exactly one job", () => {
    expect(jobs.length).toBe(1);
  });
});

describe("authority of the job", () => {
  const EXACT: Record<string, string> = { contents: "read", issues: "read" };

  test("the workflow grants exactly contents: read and issues: read", () => {
    expect(workflow.permissions).toEqual(EXACT);
  });

  test("the job grants exactly contents: read and issues: read", () => {
    expect(job.permissions).toEqual(EXACT);
  });

  // The gate refuses a repository whose owner differs from the user running it
  // and `safe.directory` cannot be supplied inside a container: a container
  // job would turn every run into that refusal. Services have no use here.
  test("there is no container and no service, at either level", () => {
    expect(Object.hasOwn(workflow, "container")).toBe(false);
    expect(Object.hasOwn(workflow, "services")).toBe(false);
    expect(Object.hasOwn(job, "container")).toBe(false);
    expect(Object.hasOwn(job, "services")).toBe(false);
  });

  test("the runner is the fixed runner of the sibling workflows", () => {
    expect(job["runs-on"]).toBe("ubuntu-latest");
    const siblingJob: Job | null = Object.values(siblingWorkflow.jobs ?? {})[0] ?? null;
    expect(job["runs-on"]).toBe(siblingJob?.["runs-on"]);
  });

  test("the job has a bounded timeout", () => {
    const minutes: unknown = job["timeout-minutes"];
    expect(typeof minutes).toBe("number");
    expect(Number.isInteger(minutes)).toBe(true);
    expect(minutes as number).toBeGreaterThanOrEqual(1);
    expect(minutes as number).toBeLessThanOrEqual(30);
  });

  // A skipped or tolerated gate step is a gate that cannot fail.
  test("no step is conditional or allowed to fail", () => {
    const tolerated: string[] = [];
    steps.forEach((step, index) => {
      if (Object.hasOwn(step, "if") || Object.hasOwn(step, "continue-on-error"))
        tolerated.push(label(step, index));
    });
    expect(tolerated).toEqual([]);
  });
});

describe("pinned actions", () => {
  test("the job runs at least one action", () => {
    expect(scanUsesLines(text).length).toBeGreaterThan(0);
  });

  test("every `uses:` is pinned to a full commit sha", () => {
    const unpinned = scanUsesLines(text).filter(
      (use) => classifyReference(use.reference) !== "pinned",
    );
    expect(unpinned).toEqual([]);
    for (const use of scanUsesLines(text)) {
      expect(use.reference.split("@")[1]).toMatch(FORTY_HEX);
    }
  });

  test("the checkout is the very one of pr-door.yml", () => {
    const siblingCheckout: Step | null =
      Object.values(siblingWorkflow.jobs ?? {})
        .flatMap((siblingJob) => siblingJob.steps ?? [])
        .find((step) => (step.uses ?? "").startsWith("actions/checkout@")) ?? null;
    expect(siblingCheckout).not.toBeNull();
    expect(checkoutStep?.uses).toBe(siblingCheckout?.uses);
  });
});

describe("no author-controlled value reaches a shell", () => {
  // Injection: `${{ ... }}` in a `run:` is substituted into the script text
  // before the shell reads it, so a pull request title or branch name becomes
  // commands. Values travel through `env:` and are read as variables.
  test("no `run:` of any step holds an expression", () => {
    const interpolated: string[] = [];
    steps.forEach((step, index) => {
      if ((step.run ?? "").includes(EXPRESSION)) interpolated.push(label(step, index));
    });
    expect(interpolated).toEqual([]);
  });

  // `working-directory` is the one other place an expression is tolerated, and
  // only as the constant `${{ runner.temp }}` (asserted with the toolchain).
  test("no expression sits outside `env:`, `with:`, `working-directory:` and the step name", () => {
    const loose: string[] = [];
    steps.forEach((step, index) => {
      const outside: string = serializedWithout(step, ["env", "with", "name", "working-directory"]);
      if (outside.includes(EXPRESSION)) loose.push(label(step, index));
    });
    expect(loose).toEqual([]);
  });

  test("tooling_ref reaches the shell only through an env variable", () => {
    const carriers = steps.filter((step) =>
      Object.values(step.env ?? {}).some((value) => String(value).includes("inputs.tooling_ref")),
    );
    expect(carriers.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(withoutEnv(step)).not.toContain("inputs.tooling_ref");
    }
  });

  test("the event is not read from a `github.event` expression anywhere", () => {
    expect(text.replace(/^\s*#.*$/gm, "")).not.toContain("github.event.");
  });
});

describe("the pull request checkout", () => {
  test("it is the first step", () => {
    expect(indexOfStep(checkoutStep)).toBe(0);
  });

  // Hard prerequisite: the gate refuses any shallow repository, with the message
  // "the checkout is shallow ... (fetch-depth: 0)".
  test("it fetches the full history", () => {
    expect(checkoutStep?.with?.["fetch-depth"]).toBe(0);
  });

  test("it leaves no credential in the git configuration", () => {
    expect(checkoutStep?.with?.["persist-credentials"]).toBe(false);
  });

  test("it takes the repository and the ref of the event, nothing else", () => {
    expect(Object.keys(checkoutStep?.with ?? {}).sort()).toEqual([
      "fetch-depth",
      "persist-credentials",
    ]);
  });
});

describe("the governance tooling", () => {
  test("a step fetches it, and it exists", () => {
    expect(toolingStep).not.toBeNull();
  });

  test("the fetch step reads tooling_ref from env and checks its format first", () => {
    const run: string = toolingStep?.run ?? "";
    expect(toolingStep?.env?.TOOLING_REF).toBe(expression("inputs.tooling_ref"));
    expect(run).toContain("[0-9a-f]{40}");
    expect(run).toContain(FETCH);
    expect(run.indexOf("[0-9a-f]{40}")).toBeLessThan(run.indexOf(FETCH));
    // The refusal must stop the step, not merely print.
    expect(run.slice(0, run.indexOf(FETCH))).toContain("exit 1");
  });

  test("the fetched revision is checked to be exactly tooling_ref", () => {
    const run: string = toolingStep?.run ?? "";
    expect(run).toContain("rev-parse HEAD");
    expect(run).toContain(CHECKOUT);
    expect(run.indexOf("rev-parse HEAD")).toBeGreaterThan(run.indexOf(CHECKOUT));
    expect(run).toMatch(/test "\$\(git -C "\$TOOLING_DIR" rev-parse HEAD\)" = "\$TOOLING_REF"/);
  });

  // `actions/checkout` refuses a path outside the workspace, and a path inside
  // it would put governance files into the tree being judged.
  test("it lives under RUNNER_TEMP, outside the workspace of the pull request", () => {
    const run: string = toolingStep?.run ?? "";
    expect(run).toContain('TOOLING_DIR="$RUNNER_TEMP/');
    expect(run).toContain('>> "$GITHUB_ENV"');
    expect(run).not.toContain("GITHUB_WORKSPACE");
    expect(run).not.toContain(".governance-tooling");
  });

  test("it is fetched anonymously from the governance repository", () => {
    const run: string = toolingStep?.run ?? "";
    expect(run).toContain("https://github.com/libre-ai/project-governance.git");
    expect(JSON.stringify(toolingStep?.env ?? {})).not.toMatch(/token|secret/i);
  });
});

describe("the Bun toolchain", () => {
  const siblingInstall: Step | null =
    Object.values(siblingWorkflow.jobs ?? {})
      .flatMap((siblingJob) => siblingJob.steps ?? [])
      .find((step) => (step.run ?? "").includes("sha256sum")) ?? null;

  test("the archive and its sha256 are those of pr-door.yml", () => {
    expect(typeof siblingInstall?.env?.BUN_ARCHIVE_URL).toBe("string");
    expect(bunInstallStep).not.toBeNull();
    expect(bunInstallStep?.env?.BUN_ARCHIVE_URL).toBe(siblingInstall?.env?.BUN_ARCHIVE_URL);
    expect(bunInstallStep?.env?.BUN_ARCHIVE_SHA256).toBe(siblingInstall?.env?.BUN_ARCHIVE_SHA256);
    expect(String(bunInstallStep?.env?.BUN_ARCHIVE_SHA256)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the archive is verified before it is unpacked, and Bun goes on PATH", () => {
    const run: string = bunInstallStep?.run ?? "";
    expect(run).toContain("sha256sum --check --strict");
    expect(run.indexOf("sha256sum")).toBeLessThan(run.indexOf("unzip"));
    expect(run).toContain('>> "$GITHUB_PATH"');
  });

  test("the exact revision of toolchains/bun.json is verified", () => {
    expect(bunRevisionStep?.run).toContain(`test "$(bun --revision)" = "${bunPolicy.revision}"`);
  });

  // Bun reads `bunfig.toml` and `.env` from the working directory before it
  // runs a script. In the workspace of the pull request both are author
  // controlled: a `preload` entry executes the author's code before the gate.
  test("neither toolchain step runs in the workspace of the pull request", () => {
    expect(bunInstallStep?.["working-directory"]).toBe(expression("runner.temp"));
    expect(bunRevisionStep?.["working-directory"]).toBe(expression("runner.temp"));
  });
});

describe("the gate", () => {
  const run: string = gateStep?.run ?? "";
  const bunLines: string[] = run.split("\n").filter((line) => line.trim().startsWith("bun "));

  test("one step runs it", () => {
    expect(gateStep).not.toBeNull();
  });

  test("it is the last step", () => {
    expect(indexOfStep(gateStep)).toBe(steps.length - 1);
  });

  test("it runs the minimum-version check, then the gate, both from the tooling directory", () => {
    expect(bunLines.length).toBe(2);
    expect(bunLines[0]).toContain('"$TOOLING_DIR/tools/quality/check-bun-minimum.ts"');
    expect(bunLines[1]).toContain('"$TOOLING_DIR/tools/quality/check-work-package-link.ts"');
  });

  test("Bun is told to ignore the configuration and the .env files of the workspace", () => {
    for (const line of bunLines) {
      expect(line).toContain('--config="$TOOLING_DIR/bunfig.toml"');
      expect(line).toContain("--no-env-file");
    }
  });

  test("it never runs from the workspace of the pull request", () => {
    expect(gateStep).not.toBeNull();
    expect(Object.hasOwn(gateStep ?? {}, "working-directory")).toBe(false);
    for (const [index, step] of steps.entries()) {
      const body: string = step.run ?? "";
      expect(body, label(step, index)).not.toContain("GITHUB_WORKSPACE");
      expect(body, label(step, index)).not.toMatch(
        /bun run |bun install|bunx |npm |npx |yarn |pnpm /,
      );
      expect(body, label(step, index)).not.toMatch(/(^|\s)\.\/|(^|\s)tools\//m);
    }
  });

  test("no step but the checkout is placed before the tooling, and none runs workspace code", () => {
    const toolingIndex: number = indexOfStep(toolingStep);
    expect(toolingIndex).toBe(1);
    const order: number[] = [bunInstallStep, bunRevisionStep, gateStep].map(indexOfStep);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(toolingIndex);
    // checkout, tooling, install, revision, gate: five steps and no other.
    expect(steps.length).toBe(5);
  });
});

describe("the token", () => {
  const TOKEN: RegExp = /github\.token|secrets\.|GITHUB_TOKEN/;

  test("it appears under `env:` of the gate step only", () => {
    expect(gateStep?.env?.GITHUB_TOKEN).toBe(expression("github.token"));
    for (const [index, step] of steps.entries()) {
      if (step === gateStep) continue;
      expect(JSON.stringify(step), label(step, index)).not.toMatch(TOKEN);
    }
  });

  test("it is not in the script, the arguments or the name of any step", () => {
    for (const [index, step] of steps.entries()) {
      expect(withoutEnv(step), label(step, index)).not.toMatch(TOKEN);
    }
  });

  test("the gate step has no other secret-bearing variable", () => {
    expect(Object.keys(gateStep?.env ?? {})).toEqual(["GITHUB_TOKEN"]);
  });

  test("nothing echoes, traces or writes a variable of the environment", () => {
    for (const [index, step] of steps.entries()) {
      const body: string = step.run ?? "";
      expect(body, label(step, index)).not.toMatch(/\bset -[a-z]*x|\bprintenv\b|(^|\s)env(\s|$)/m);
    }
  });

  test("the workflow file never writes the token into a file", () => {
    for (const [index, step] of steps.entries()) {
      expect(step.run ?? "", label(step, index)).not.toMatch(/GITHUB_TOKEN/);
    }
  });
});
