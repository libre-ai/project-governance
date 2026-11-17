import { describe, expect, test } from "bun:test";
import { classifyReference, scanUsesLines } from "../../ecosystem/check-action-pins";
import { findUnreadableCharacter } from "./yaml-text-guard";

// Structure test of the reusable API-compatibility workflow, on the model of
// reusable-work-package-link.test.ts.
//
// What it proves: the file parses, it is callable and nothing else, it grants
// `contents: read` alone, it runs only pinned actions, no input reaches a
// shell as text, and every step that decides carries EXACTLY the reviewed
// lines. What it cannot prove: that the pinned archive is the tool, and that a
// consumer's `workflow_call` resolves. Both need a runner.

const WORKFLOW_URL: URL = new URL(
  "../../.github/workflows/reusable-api-compat.yml",
  import.meta.url,
);
const LINK_URL: URL = new URL(
  "../../.github/workflows/reusable-work-package-link.yml",
  import.meta.url,
);
const DEPENDENCY_URL: URL = new URL(
  "../../.github/workflows/reusable-dependency-policy.yml",
  import.meta.url,
);
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
const linkWorkflow: Workflow = Bun.YAML.parse(await Bun.file(LINK_URL).text()) as Workflow;
const dependencyWorkflow: Workflow = Bun.YAML.parse(
  await Bun.file(DEPENDENCY_URL).text(),
) as Workflow;
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
const stepsOf = (other: Workflow): readonly Step[] =>
  Object.values(other.jobs ?? {}).flatMap((otherJob) => otherJob.steps ?? []);

const keysOf = (value: unknown): string[] =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
const linesOf = (step: Step | null): string[] =>
  (step?.run ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

// The steps are taken by POSITION, never by what they contain: a step located
// by its content disappears from the assertions as soon as it is altered.
const [
  checkoutStep = null,
  toolingStep = null,
  bunInstallStep = null,
  bunRevisionStep = null,
  rustStep = null,
  toolInstallStep = null,
  versionsStep = null,
  gateStep = null,
] = steps;
const runSteps: readonly (Step | null)[] = [
  toolingStep,
  bunInstallStep,
  bunRevisionStep,
  toolInstallStep,
  versionsStep,
  gateStep,
];

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

describe("trigger and inputs", () => {
  test("workflow_call is the only trigger", () => {
    expect(keysOf(workflow.on)).toEqual(["workflow_call"]);
  });

  test("the inputs are crate (required), baseline_rev (default '') and tooling_ref (required)", () => {
    const on = workflow.on as { workflow_call?: { inputs?: Record<string, unknown> } };
    expect(keysOf(on.workflow_call)).toEqual(["inputs"]);
    const inputs: Record<string, unknown> = on.workflow_call?.inputs ?? {};
    expect(Object.keys(inputs)).toEqual(["crate", "baseline_rev", "tooling_ref"]);
    const shape = (name: string): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(inputs[name] as Record<string, unknown>).filter(
          ([key]) => key !== "description",
        ),
      );
    expect(shape("crate")).toEqual({ required: true, type: "string" });
    expect(shape("baseline_rev")).toEqual({ required: false, default: "", type: "string" });
    expect(shape("tooling_ref")).toEqual({ required: true, type: "string" });
  });

  test("the workflow and its only job carry the names a ruleset would require", () => {
    expect(workflow.name).toBe("reusable-api-compat");
    expect(jobs.map(([id]) => id)).toEqual(["api-compat"]);
    expect(job.name).toBe("API compatibility");
  });
});

describe("authority of the job", () => {
  test("contents: read alone, at the workflow level and at the job level", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.permissions).toEqual({ contents: "read" });
  });

  // A closed inventory of keys: `container`, `services`, `env` or `defaults`
  // above the steps would reach the gate without any step-level assertion
  // seeing it, so an unforeseen key is a red test.
  test("the workflow and the job hold exactly the reviewed keys", () => {
    expect(keysOf(workflow)).toEqual(["jobs", "name", "on", "permissions"]);
    expect(keysOf(job)).toEqual(["name", "permissions", "runs-on", "steps", "timeout-minutes"]);
    for (const key of ["container", "services", "env", "defaults"]) {
      expect(Object.hasOwn(workflow, key), `workflow ${key}`).toBe(false);
      expect(Object.hasOwn(job, key), `job ${key}`).toBe(false);
    }
  });

  test("the runner is ubuntu-latest and the job has a bounded timeout", () => {
    expect(job["runs-on"]).toBe("ubuntu-latest");
    const minutes: unknown = job["timeout-minutes"];
    expect(Number.isInteger(minutes)).toBe(true);
    expect(minutes as number).toBeGreaterThanOrEqual(1);
    expect(minutes as number).toBeLessThanOrEqual(60);
  });

  test("each step holds exactly the reviewed keys: none is conditional or allowed to fail", () => {
    expect(steps.length).toBe(8);
    expect(keysOf(checkoutStep)).toEqual(["uses", "with"]);
    expect(keysOf(rustStep)).toEqual(["uses"]);
    const scripted = ["name", "run", "shell", "working-directory"];
    const scriptedWithEnv = ["env", ...scripted];
    expect(keysOf(toolingStep)).toEqual(scriptedWithEnv);
    expect(keysOf(bunInstallStep)).toEqual(scriptedWithEnv);
    expect(keysOf(bunRevisionStep)).toEqual(scripted);
    expect(keysOf(toolInstallStep)).toEqual(scriptedWithEnv);
    expect(keysOf(versionsStep)).toEqual(scripted);
    expect(keysOf(gateStep)).toEqual(scriptedWithEnv);
  });

  test("no token and no secret is written anywhere", () => {
    expect(uncommented).not.toMatch(/github\.token|secrets\.|GITHUB_TOKEN/);
  });
});

describe("pinned actions", () => {
  test("every `uses:` is pinned to a full commit sha", () => {
    const uses = scanUsesLines(text);
    expect(uses.length).toBe(2);
    expect(uses.filter((use) => classifyReference(use.reference) !== "pinned")).toEqual([]);
    for (const use of uses) expect(use.reference.split("@")[1]).toMatch(/^[0-9a-f]{40}$/);
  });

  test("the checkout and the Rust toolchain are the very actions of the sibling templates", () => {
    expect(checkoutStep?.uses).toBe(stepsOf(linkWorkflow)[0]?.uses);
    const siblingRust = stepsOf(dependencyWorkflow).find((step) =>
      (step.uses ?? "").startsWith("dtolnay/rust-toolchain@"),
    );
    expect(typeof siblingRust?.uses).toBe("string");
    expect(rustStep?.uses).toBe(siblingRust?.uses);
  });

  test("the checkout fetches the full history and persists no credential, nothing else", () => {
    expect(checkoutStep?.with).toEqual({ "fetch-depth": 0, "persist-credentials": false });
  });
});

describe("no input reaches a shell as text", () => {
  test("no `run:` holds an expression", () => {
    for (const step of steps) expect(step.run ?? "").not.toContain(EXPRESSION);
  });

  test("no `inputs.` expression sits outside an `env:` value", () => {
    for (const step of steps) {
      const outside = Object.fromEntries(Object.entries(step).filter(([key]) => key !== "env"));
      expect(JSON.stringify(outside)).not.toContain("inputs.");
    }
    expect(uncommented.match(/inputs\.[a-z_]+/g)).toEqual([
      "inputs.tooling_ref",
      "inputs.crate",
      "inputs.baseline_rev",
    ]);
  });

  test("the env of every step is exactly the reviewed one", () => {
    expect(toolingStep?.env).toEqual({ TOOLING_REF: expression("inputs.tooling_ref") });
    expect(keysOf(bunInstallStep?.env)).toEqual(["BUN_ARCHIVE_SHA256", "BUN_ARCHIVE_URL"]);
    expect(keysOf(toolInstallStep?.env)).toEqual([
      "CARGO_SEMVER_CHECKS_ARCHIVE_SHA256",
      "CARGO_SEMVER_CHECKS_ARCHIVE_URL",
      "CARGO_SEMVER_CHECKS_VERSION",
    ]);
    expect(gateStep?.env).toEqual({
      CRATE: expression("inputs.crate"),
      BASELINE_REV: expression("inputs.baseline_rev"),
    });
  });

  test("the only other expressions are the runner temporary directory of a working-directory", () => {
    const expressions: string[] = uncommented.match(/\$\{\{[^}]*\}\}/g) ?? [];
    expect(expressions.filter((found) => !found.includes("inputs."))).toEqual(
      runSteps.map(() => RUNNER_TEMP_DIRECTORY),
    );
  });
});

// The steps that decide are asserted line by line, exactly: a `|| true`, a
// commented-out check or an extra download changes the lines.
describe("the steps that decide carry exactly the reviewed lines", () => {
  test("the tooling and Bun steps are those of reusable-work-package-link.yml", () => {
    const link = stepsOf(linkWorkflow);
    expect(toolingStep).toEqual(link[1] as Step);
    expect(bunInstallStep).toEqual(link[2] as Step);
    expect(bunRevisionStep).toEqual(link[3] as Step);
    expect(linesOf(toolingStep).length).toBe(10);
  });

  test("the Bun revision verified is the one of toolchains/bun.json", () => {
    expect(linesOf(bunRevisionStep)).toEqual([
      `test "$(bun --revision)" = "${bunPolicy.revision}"`,
    ]);
  });

  test("cargo-semver-checks comes from a release archive verified by sha256", () => {
    expect(linesOf(toolInstallStep)).toEqual([
      'curl --fail --location --retry 3 --output "$RUNNER_TEMP/cargo-semver-checks.tar.gz" "$CARGO_SEMVER_CHECKS_ARCHIVE_URL"',
      'echo "$CARGO_SEMVER_CHECKS_ARCHIVE_SHA256  $RUNNER_TEMP/cargo-semver-checks.tar.gz" | sha256sum --check --strict',
      'mkdir "$RUNNER_TEMP/cargo-semver-checks"',
      'tar -xzf "$RUNNER_TEMP/cargo-semver-checks.tar.gz" -C "$RUNNER_TEMP/cargo-semver-checks"',
      'echo "$RUNNER_TEMP/cargo-semver-checks" >> "$GITHUB_PATH"',
      'test "$("$RUNNER_TEMP/cargo-semver-checks/cargo-semver-checks" --version)" = "cargo-semver-checks $CARGO_SEMVER_CHECKS_VERSION"',
    ]);
  });

  test("the archive is the release asset of the version named, with a full digest", () => {
    const env: Record<string, unknown> = toolInstallStep?.env ?? {};
    const version = String(env.CARGO_SEMVER_CHECKS_VERSION);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(env.CARGO_SEMVER_CHECKS_ARCHIVE_URL).toBe(
      `https://github.com/obi1kenobi/cargo-semver-checks/releases/download/v${version}/cargo-semver-checks-x86_64-unknown-linux-musl.tar.gz`,
    );
    expect(String(env.CARGO_SEMVER_CHECKS_ARCHIVE_SHA256)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the tool is never built from a registry", () => {
    expect(uncommented).not.toMatch(/cargo\s+(b?install|binstall)/);
  });

  test("the versions step states the three binaries", () => {
    expect(linesOf(versionsStep)).toEqual([
      "cargo --version",
      "rustc --version",
      "cargo-semver-checks --version",
    ]);
  });

  test("the gate step", () => {
    const gate = "bun --no-env-file tools/quality/check-api-compatibility.ts";
    expect(linesOf(gateStep)).toEqual([
      "bun --no-env-file tools/quality/check-bun-minimum.ts",
      'if [[ -n "$BASELINE_REV" ]]; then',
      `${gate} --repository "$GITHUB_WORKSPACE" --crate "$CRATE" --baseline-rev "$BASELINE_REV"`,
      "else",
      `${gate} --repository "$GITHUB_WORKSPACE" --crate "$CRATE"`,
      "fi",
    ]);
  });

  test("every scripted step says `shell: bash`, and none swallows a failure", () => {
    for (const [index, step] of runSteps.entries()) {
      expect(step?.shell, `step ${index}`).toBe("bash");
      const body: string = step?.run ?? "";
      expect(body, `step ${index} holds ||`).not.toContain("||");
      expect(body, `step ${index} holds &&`).not.toContain("&&");
      expect(body, `step ${index} holds #`).not.toContain("#");
      expect(body, `step ${index}`).not.toMatch(/\btrue\b|set \+e|exit 0|GITHUB_ENV/);
    }
  });
});

describe("where each step runs", () => {
  test("the gate is the last step and runs from the trusted tooling directory", () => {
    expect(steps.indexOf(gateStep as Step)).toBe(steps.length - 1);
    expect(gateStep?.["working-directory"]).toBe(TOOLING_WORKING_DIRECTORY);
    expect(linesOf(toolingStep)).toContain('TOOLING_DIR="$RUNNER_TEMP/governance-tooling"');
  });

  test("no other scripted step runs in the workspace", () => {
    for (const step of runSteps) {
      if (step === gateStep) continue;
      expect(step?.["working-directory"]).toBe(RUNNER_TEMP_DIRECTORY);
    }
  });

  test("the workspace is named only as the argument of the gate", () => {
    for (const step of steps) {
      if (step === gateStep) continue;
      expect(step.run ?? "").not.toContain("GITHUB_WORKSPACE");
    }
    expect(uncommented.match(/GITHUB_WORKSPACE/g)?.length).toBe(2);
  });
});
