import { describe, expect, test } from "bun:test";
import { classifyReference, scanUsesLines } from "../../ecosystem/check-action-pins";
import { findUnreadableCharacter } from "./yaml-text-guard";

// Structure test of the reusable work-package-link workflow (design §6).
//
// What it proves, and what it cannot: the file parses, it is callable, it
// grants the job the two permissions the gate needs and nothing else, it runs
// only pinned actions, no author-controlled value reaches a shell, and every
// step that decides something carries EXACTLY the lines reviewed (a substring
// check passed six neutralisations, such as a `|| true` appended to a check).
// A real `workflow_call` from a consumer remains the only proof of the wiring,
// and cannot be produced before this repository publishes the workflow.
//
// The threat this guards is the one of a pull request gate: the pull request
// is author-controlled input, so the gate must come from the governance
// checkout at a pinned revision, run from that trusted directory, and nothing
// of the pull request may run before it. The gate reads the pull request only
// through the absolute GITHUB_WORKSPACE, never through its working directory.

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
  readonly shell?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
  readonly "working-directory"?: string;
  readonly "continue-on-error"?: unknown;
}
interface Job {
  readonly name?: unknown;
  readonly "runs-on"?: unknown;
  readonly "timeout-minutes"?: unknown;
  readonly permissions?: unknown;
  readonly container?: unknown;
  readonly services?: unknown;
  readonly steps?: readonly Step[];
}
interface Workflow {
  readonly name?: unknown;
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

/** The trusted directory the gate runs from: under the runner temporary directory, outside the workspace. */
const TOOLING_WORKING_DIRECTORY: string = `${expression("runner.temp")}/governance-tooling`;
const RUNNER_TEMP_DIRECTORY: string = expression("runner.temp");

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

/** The step without some keys: where a value may reach a shell, a flag or a log. */
const serializedWithout = (step: Step, omitted: readonly string[]): string =>
  JSON.stringify(
    Object.fromEntries(Object.entries(step).filter(([key]) => !omitted.includes(key))),
  );
const withoutEnv = (step: Step): string => serializedWithout(step, ["env"]);

/** The trimmed, non-empty lines of a `run:` body: what the shell is asked to do, line by line. */
const linesOf = (step: Step | null): string[] =>
  (step?.run ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** The keys of a mapping, sorted; a value that is not a mapping has none. */
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

// The name of the job is the name of the check that the rulesets of the
// consuming repositories REQUIRE: renaming it leaves a required check that no
// run ever reports, so every pull request waits forever. Both names are
// pinned by exact equality; a change is a reviewed edit of this test and of
// every ruleset that requires the check.
describe("the names a ruleset requires", () => {
  test("the workflow is named reusable-work-package-link", () => {
    expect(workflow.name).toBe("reusable-work-package-link");
  });

  test("the only job is work-package-link, named Work package link", () => {
    expect(jobs.map(([id]: [string, Job]): string => id)).toEqual(["work-package-link"]);
    expect(job.name).toBe("Work package link");
  });
});

// The header is the contract read by the author of a calling workflow: it
// states the grant the caller owes, and what was measured about Bun's flags
// rather than a general claim.
describe("the header states the caller's prerequisites as measured", () => {
  const header: string = text
    .split("\n")
    .filter((line: string): boolean => line.startsWith("#"))
    .map((line: string): string => line.replace(/^#\s*/, ""))
    .join(" ");

  test("it says the calling job must grant issues: read and contents: read", () => {
    expect(header).toContain(
      "the calling job must grant `issues: read` and `contents: read` (the called workflow cannot exceed the caller's grant; an under-granted caller makes the gate fail closed)",
    );
  });

  test("it states the measured behaviour of each flag, and no general claim", () => {
    expect(header).not.toContain("no flag is a reliable protection");
    for (const measured of [
      "an unknown flag is ignored silently",
      "an empty `--config=` falls back to the bunfig of the working directory",
      "`--no-env-file` alone does not stop the preload",
      "a non-empty `--config` does stop it",
    ]) {
      expect(header).toContain(measured);
    }
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

// An environment variable or a default declared above the steps reaches every
// step, the gate included, and none of the step-level assertions below sees it:
// `BUN_OPTIONS=--preload=./evil.ts` at job level would run the author's file in
// the gate, `defaults.run.working-directory` would move the gate into the
// workspace of the pull request. The inventory of keys is therefore closed at
// every level, so that an unforeseen key is a red test and not a silent input.
describe("nothing is inherited by the steps", () => {
  test("`env` and `defaults` are absent at the workflow level and at the job level", () => {
    for (const key of ["env", "defaults"]) {
      expect(Object.hasOwn(workflow, key), `workflow ${key}`).toBe(false);
      expect(Object.hasOwn(job, key), `job ${key}`).toBe(false);
    }
  });

  test("the workflow holds exactly the reviewed top-level keys", () => {
    expect(keysOf(workflow)).toEqual(["jobs", "name", "on", "permissions"]);
  });

  test("the job holds exactly the reviewed keys", () => {
    expect(keysOf(job)).toEqual(["name", "permissions", "runs-on", "steps", "timeout-minutes"]);
  });

  test("each step holds exactly the reviewed keys", () => {
    expect(keysOf(checkoutStep)).toEqual(["uses", "with"]);
    expect(keysOf(toolingStep)).toEqual(["env", "name", "run", "shell", "working-directory"]);
    expect(keysOf(bunInstallStep)).toEqual(["env", "name", "run", "shell", "working-directory"]);
    expect(keysOf(bunRevisionStep)).toEqual(["name", "run", "shell", "working-directory"]);
    expect(keysOf(gateStep)).toEqual(["env", "name", "run", "shell", "working-directory"]);
  });

  test("the job has exactly five steps: checkout, tooling, Bun install, Bun revision, gate", () => {
    expect(steps.length).toBe(5);
  });

  // Variables that change what a process loads or where it looks; the Bun
  // archive variables are the two names of pr-door.yml and are allowed by name.
  test("no step but the gate sets a loader, runtime or git variable, and none the token", () => {
    const allowed: readonly string[] = ["TOOLING_REF", "BUN_ARCHIVE_URL", "BUN_ARCHIVE_SHA256"];
    const risky: RegExp =
      /^(BUN_|NODE_|GIT_|LD_|DYLD_|NPM_|XDG_|BASH_ENV$|ENV$|PATH$|HOME$|SHELL$|GITHUB_|RUNNER_)/;
    steps.forEach((step, index) => {
      for (const key of Object.keys(step.env ?? {})) {
        if (step === gateStep) continue;
        expect(allowed.includes(key) || !risky.test(key), `${label(step, index)} sets ${key}`).toBe(
          true,
        );
      }
    });
  });

  test("the env of every step is exactly the reviewed one", () => {
    expect(Object.hasOwn(checkoutStep ?? {}, "env")).toBe(false);
    expect(keysOf(toolingStep?.env)).toEqual(["TOOLING_REF"]);
    expect(keysOf(bunInstallStep?.env)).toEqual(["BUN_ARCHIVE_SHA256", "BUN_ARCHIVE_URL"]);
    expect(Object.hasOwn(bunRevisionStep ?? {}, "env")).toBe(false);
    expect(keysOf(gateStep?.env)).toEqual(["GITHUB_TOKEN"]);
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

  test("the only action is the checkout, and it is the very one of pr-door.yml", () => {
    expect(scanUsesLines(text).length).toBe(1);
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
  // only as a constant of the runner temporary directory (asserted per step).
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
    expect(carriers).toEqual([toolingStep as Step]);
    for (const step of steps) {
      expect(withoutEnv(step)).not.toContain("inputs.tooling_ref");
    }
  });

  test("the event is not read from a `github.event` expression anywhere", () => {
    expect(uncommented).not.toContain("github.event.");
  });
});

describe("the pull request checkout", () => {
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

// The steps that decide are asserted line by line, exactly. A neutralisation
// (a `|| true`, a commented-out block, an unanchored pattern, an extra fetch
// from another repository) changes the lines and turns the test red.
describe("the steps that decide carry exactly the reviewed lines", () => {
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
  const REVISION_LINES: readonly string[] = [`test "$(bun --revision)" = "${bunPolicy.revision}"`];
  const GATE_LINES: readonly string[] = [
    "bun --no-env-file tools/quality/check-bun-minimum.ts",
    "bun --no-env-file tools/quality/check-work-package-link.ts",
  ];

  test("the tooling step", () => {
    expect(linesOf(toolingStep)).toEqual([...TOOLING_LINES]);
  });

  test("the Bun install step", () => {
    expect(linesOf(bunInstallStep)).toEqual([...INSTALL_LINES]);
  });

  test("the Bun revision step, against toolchains/bun.json", () => {
    expect(linesOf(bunRevisionStep)).toEqual([...REVISION_LINES]);
  });

  test("the gate step", () => {
    expect(linesOf(gateStep)).toEqual([...GATE_LINES]);
  });

  // The shell is fixed: `shell: bash` makes GitHub run `bash -eo pipefail`, so
  // a failing command, or a failing stage of the `sha256sum` pipe, ends the step.
  test("every step that runs a script says `shell: bash`", () => {
    for (const step of runSteps) {
      expect(step?.shell).toBe("bash");
    }
  });

  // Defence beside the exact lines: nothing that swallows a failure or hides a
  // line may appear in the bodies, whatever the exact lines become.
  test("no body swallows a failure, chains commands or hides a line", () => {
    for (const [index, step] of runSteps.entries()) {
      const body: string = step?.run ?? "";
      expect(body, `step ${index} holds an expression`).not.toContain(EXPRESSION);
      expect(body, `step ${index} holds ||`).not.toContain("||");
      expect(body, `step ${index} holds &&`).not.toContain("&&");
      expect(body, `step ${index} holds #`).not.toContain("#");
      expect(body, `step ${index} holds the word true`).not.toMatch(/\btrue\b/);
      expect(body, `step ${index} holds set +e`).not.toMatch(/set \+e|exit 0/);
      for (const line of linesOf(step)) {
        // The single `;` of the reviewed `if ...; then` line is the only one.
        if (line === TOOLING_LINES[0]) continue;
        expect(line, `step ${index}: ${line}`).not.toContain(";");
      }
    }
  });

  test("no body writes the environment of later steps", () => {
    for (const step of runSteps) {
      expect(step?.run ?? "").not.toContain("GITHUB_ENV");
    }
  });
});

describe("the format check of tooling_ref works", () => {
  // The reviewed lines are RUN: the block up to its `fi` is executed by bash on
  // accepted and refused values. Nothing leaves the machine: it is only the check.
  const block: string = (() => {
    const lines: string[] = linesOf(toolingStep);
    const end: number = lines.indexOf("fi");
    return end < 0 ? "exit 99" : lines.slice(0, end + 1).join("\n");
  })();

  async function verdict(value: string): Promise<number> {
    const process = Bun.spawn(["bash", "-c", block], {
      env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin", TOOLING_REF: value },
      stdout: "ignore",
      stderr: "ignore",
    });
    return await process.exited;
  }

  const SHA: string = "0123456789abcdef0123456789abcdef01234567";

  test("a full lowercase commit passes", async () => {
    expect(await verdict(SHA)).toBe(0);
  });

  test.each([
    ["empty", ""],
    ["39 characters", SHA.slice(1)],
    ["41 characters", `${SHA}0`],
    ["uppercase", SHA.toUpperCase()],
    ["a branch name", "main"],
    ["a trailing newline", `${SHA}\n`],
    ["a valid first line and a second line", `${SHA}\nanything`],
    ["a valid last line after another line", `anything\n${SHA}`],
    ["a leading space", ` ${SHA}`],
    ["a command suffix", `${SHA};id`],
  ])("%s is refused", async (_name, value) => {
    expect(await verdict(value)).not.toBe(0);
  });
});

describe("the governance tooling", () => {
  test("it is fetched anonymously from the governance repository, into the runner temporary directory", () => {
    expect(toolingStep?.["working-directory"]).toBe(RUNNER_TEMP_DIRECTORY);
    expect(toolingStep?.env?.TOOLING_REF).toBe(expression("inputs.tooling_ref"));
    const run: string = toolingStep?.run ?? "";
    expect(run).toContain("https://github.com/libre-ai/project-governance.git");
    expect(run).toContain('TOOLING_DIR="$RUNNER_TEMP/governance-tooling"');
    expect(run).not.toContain("GITHUB_WORKSPACE");
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
    expect(bunInstallStep?.env?.BUN_ARCHIVE_URL).toBe(siblingInstall?.env?.BUN_ARCHIVE_URL);
    expect(bunInstallStep?.env?.BUN_ARCHIVE_SHA256).toBe(siblingInstall?.env?.BUN_ARCHIVE_SHA256);
    expect(String(bunInstallStep?.env?.BUN_ARCHIVE_SHA256)).toMatch(/^[0-9a-f]{64}$/);
  });

  // Bun reads `bunfig.toml` and `.env` from the working directory before it
  // runs a script. In the workspace of the pull request both are author
  // controlled: a `preload` entry executes the author's code before the gate.
  test("neither toolchain step runs in the workspace of the pull request", () => {
    expect(bunInstallStep?.["working-directory"]).toBe(RUNNER_TEMP_DIRECTORY);
    expect(bunRevisionStep?.["working-directory"]).toBe(RUNNER_TEMP_DIRECTORY);
  });
});

describe("the gate", () => {
  test("it is the last step", () => {
    expect(gateStep?.run).toContain("check-work-package-link.ts");
    expect(steps.indexOf(gateStep as Step)).toBe(steps.length - 1);
  });

  // Measured on the pinned Bun revision: from the workspace of the pull request,
  // `bun <script>` runs the author's `preload` and loads `.env`; `--no-env-file`
  // alone does not stop the preload; an unknown flag is ignored silently and an
  // empty `--config=` falls back to the cwd bunfig. No flag is a reliable
  // protection, so the working directory is the trusted tooling directory. The
  // gate reads the pull request through the absolute GITHUB_WORKSPACE only.
  test("it runs from the trusted tooling directory, not from the workspace", () => {
    expect(gateStep?.["working-directory"]).toBe(TOOLING_WORKING_DIRECTORY);
    expect(TOOLING_WORKING_DIRECTORY).toBe(`${EXPRESSION} runner.temp }}/governance-tooling`);
  });

  test("the working directory of the gate is where the tooling step put the tooling", () => {
    expect(linesOf(toolingStep)).toContain('TOOLING_DIR="$RUNNER_TEMP/governance-tooling"');
  });

  test("no step reads the workspace by path or runs a package manager", () => {
    for (const [index, step] of steps.entries()) {
      const body: string = step.run ?? "";
      expect(body, label(step, index)).not.toContain("GITHUB_WORKSPACE");
      expect(body, label(step, index)).not.toMatch(
        /bun run |bun install|bunx |npm |npx |yarn |pnpm /,
      );
      expect(body, label(step, index)).not.toMatch(/(^|\s)\.\//m);
    }
  });
});

describe("the token", () => {
  // The token is written once in the whole file, under the `env:` of the gate
  // step, which also makes a job-level or a workflow-level copy a red test.
  test("it is written once, under `env:` of the gate step", () => {
    expect(gateStep?.env?.GITHUB_TOKEN).toBe(expression("github.token"));
    expect(uncommented.match(/GITHUB_TOKEN/g)?.length).toBe(1);
    expect(uncommented.match(/github\.token/g)?.length).toBe(1);
    expect(uncommented).not.toMatch(/secrets\./);
  });

  test("it is in no other step", () => {
    for (const [index, step] of steps.entries()) {
      if (step === gateStep) continue;
      expect(JSON.stringify(step), label(step, index)).not.toMatch(
        /github\.token|secrets\.|GITHUB_TOKEN/,
      );
    }
  });

  test("it is not in the script, the arguments or the name of any step", () => {
    for (const [index, step] of steps.entries()) {
      expect(withoutEnv(step), label(step, index)).not.toMatch(
        /github\.token|secrets\.|GITHUB_TOKEN/,
      );
    }
  });

  test("the gate step has no other variable", () => {
    expect(Object.keys(gateStep?.env ?? {})).toEqual(["GITHUB_TOKEN"]);
  });

  test("nothing echoes, traces or lists the environment", () => {
    for (const [index, step] of steps.entries()) {
      const body: string = step.run ?? "";
      expect(body, label(step, index)).not.toMatch(/\bset -[a-z]*x|\bprintenv\b|(^|\s)env(\s|$)/m);
    }
  });
});
