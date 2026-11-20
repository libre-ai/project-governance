// SPDX-FileCopyrightText: 2026 Libre AI contributors
// SPDX-License-Identifier: EUPL-1.2

import { describe, expect, test } from "bun:test";
import { classifyReference, scanUsesLines } from "../../ecosystem/check-action-pins";
import { findUnreadableCharacter } from "./yaml-text-guard";

// Structure test of the reusable Rust mutation workflow, and of the tool
// declaration it copies its archive from (toolchains/cargo-mutants.json).
//
// What it proves, and what it cannot: the file parses, it is callable and only
// callable, it grants exactly `contents: read`, it runs only pinned actions, no
// input reaches a shell as text, the archives it downloads are the declared
// ones, and every step carries EXACTLY the lines reviewed. The decisions
// themselves (validation, thresholds, counters) are the script's, proved by
// tools/quality/check-mutation-rust.test.ts. A real `workflow_call` from a
// consumer remains the only proof of the wiring, and cannot be produced before
// this repository publishes the workflow.

const WORKFLOW_URL: URL = new URL(
  "../../.github/workflows/reusable-mutation-rust.yml",
  import.meta.url,
);
/** The template whose tooling and Bun steps this one repeats line for line. */
const TOOLING_SIBLING_URL: URL = new URL(
  "../../.github/workflows/reusable-work-package-link.yml",
  import.meta.url,
);
/** The template whose Rust toolchain action this one reuses. */
const RUST_SIBLING_URL: URL = new URL(
  "../../.github/workflows/reusable-dependency-policy.yml",
  import.meta.url,
);
const BUN_POLICY_URL: URL = new URL("../../toolchains/bun.json", import.meta.url);
const MUTANTS_POLICY_URL: URL = new URL("../../toolchains/cargo-mutants.json", import.meta.url);

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
  readonly steps?: readonly Step[];
}
interface Workflow {
  readonly name?: unknown;
  readonly on?: unknown;
  readonly permissions?: unknown;
  readonly jobs?: Record<string, Job>;
}
interface Input {
  readonly required?: unknown;
  readonly type?: unknown;
  readonly default?: unknown;
}
interface BunPolicy {
  readonly revision: string;
  readonly durableRelease: { readonly linuxX64Asset: string };
  readonly assets: Readonly<Record<string, { readonly sha256: string }>>;
}
interface MutantsPlatform {
  readonly triple?: unknown;
  readonly archiveName?: unknown;
  readonly archiveUrl?: unknown;
  readonly archiveSha256?: unknown;
  readonly executableRelativePath?: unknown;
  readonly executableSha256?: unknown;
}
interface MutantsPolicy {
  readonly tool?: unknown;
  readonly version?: unknown;
  readonly license?: unknown;
  readonly releaseUrl?: unknown;
  readonly observedAt?: unknown;
  readonly platforms?: Readonly<Record<string, MutantsPlatform>>;
  readonly provision?: unknown;
}

const text: string = await Bun.file(WORKFLOW_URL).text();
const workflow: Workflow = Bun.YAML.parse(text) as Workflow;
const toolingSibling: Workflow = Bun.YAML.parse(
  await Bun.file(TOOLING_SIBLING_URL).text(),
) as Workflow;
const rustSibling: Workflow = Bun.YAML.parse(await Bun.file(RUST_SIBLING_URL).text()) as Workflow;
const bunPolicy: BunPolicy = (await Bun.file(BUN_POLICY_URL).json()) as BunPolicy;
const mutantsPolicyText: string = await Bun.file(MUTANTS_POLICY_URL).text();
const mutantsPolicy: MutantsPolicy = JSON.parse(mutantsPolicyText) as MutantsPolicy;

const FORTY_HEX: RegExp = /^[0-9a-f]{40}$/;
const SHA256: RegExp = /^[0-9a-f]{64}$/;
/** The opening of a workflow expression, assembled so that no template-looking literal sits in this file. */
const EXPRESSION: string = ["$", "{{"].join("");
/** `${{ <inner> }}` as GitHub reads it. */
const expression = (inner: string): string => `${EXPRESSION} ${inner} }}`;

const RUNNER_TEMP_DIRECTORY: string = expression("runner.temp");
const TOOLING_WORKING_DIRECTORY: string = `${RUNNER_TEMP_DIRECTORY}/governance-tooling`;

const jobs: readonly [string, Job][] = Object.entries(workflow.jobs ?? {});
const job: Job = jobs[0]?.[1] ?? {};
const steps: readonly Step[] = job.steps ?? [];
const siblingSteps = (sibling: Workflow): readonly Step[] =>
  Object.values(sibling.jobs ?? {}).flatMap((siblingJob) => siblingJob.steps ?? []);

/** The trigger names, whether `on` is written as a string, a list or a mapping. */
function triggerNames(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  if (typeof on === "object" && on !== null) return Object.keys(on);
  return [];
}

const label = (step: Step, index: number): string =>
  `[${index}] ${step.name ?? step.uses ?? "unnamed"}`;

/** The trimmed, non-empty lines of a `run:` body. */
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
const rustStep: Step | null = steps[4] ?? null;
const mutantsInstallStep: Step | null = steps[5] ?? null;
const gateStep: Step | null = steps[6] ?? null;
const runSteps: readonly (Step | null)[] = [
  toolingStep,
  bunInstallStep,
  bunRevisionStep,
  mutantsInstallStep,
  gateStep,
];

const inputs: Record<string, Input> =
  (workflow.on as { workflow_call?: { inputs?: Record<string, Input> } } | undefined)?.workflow_call
    ?.inputs ?? {};

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
  // The trigger of a long gate belongs to the CALLER, manual or scheduled.
  test("workflow_call is the only trigger", () => {
    expect(triggerNames(workflow.on)).toEqual(["workflow_call"]);
  });

  test("the inputs are exactly the five reviewed ones, all strings", () => {
    expect(Object.keys(inputs)).toEqual([
      "tooling_ref",
      "crates",
      "max_missed",
      "max_missed_by_crate",
      "timeout_seconds",
    ]);
    for (const [name, input] of Object.entries(inputs)) {
      expect(input.type, name).toBe("string");
    }
  });

  test("tooling_ref and crates are required", () => {
    expect(inputs.tooling_ref?.required).toBe(true);
    expect(inputs.crates?.required).toBe(true);
  });

  // No default threshold lives in the workflow: an optional input left out
  // reaches the script empty, and the script refuses a crate without threshold.
  test.each([
    "max_missed",
    "max_missed_by_crate",
    "timeout_seconds",
  ])("%s is optional and its default is empty", (name) => {
    expect(inputs[name]?.required).toBe(false);
    expect(inputs[name]?.default).toBe("");
  });

  test("the workflow is named reusable-mutation-rust and declares the single job mutation-rust", () => {
    expect(workflow.name).toBe("reusable-mutation-rust");
    expect(jobs.map(([id]: [string, Job]): string => id)).toEqual(["mutation-rust"]);
    expect(job.name).toBe("Rust mutation");
  });
});

describe("authority of the job", () => {
  const EXACT: Record<string, string> = { contents: "read" };

  test("the workflow grants exactly contents: read", () => {
    expect(workflow.permissions).toEqual(EXACT);
  });

  test("the job grants exactly contents: read", () => {
    expect(job.permissions).toEqual(EXACT);
  });

  test("the runner is ubuntu-latest and the job stops after 120 minutes", () => {
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job["timeout-minutes"]).toBe(120);
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

  test("no token and no secret is read anywhere", () => {
    const uncommented: string = text.replace(/^\s*#.*$/gm, "");
    expect(uncommented).not.toMatch(/github\.token|secrets\.|GITHUB_TOKEN/);
  });
});

// A variable or a default declared above the steps reaches every step and none
// of the step-level assertions sees it: the inventory of keys is closed at
// every level, so that an unforeseen key is a red test and not a silent input.
describe("nothing is inherited by the steps", () => {
  test("the workflow holds exactly the reviewed top-level keys", () => {
    expect(keysOf(workflow)).toEqual(["jobs", "name", "on", "permissions"]);
  });

  test("the job holds exactly the reviewed keys", () => {
    expect(keysOf(job)).toEqual(["name", "permissions", "runs-on", "steps", "timeout-minutes"]);
  });

  test("the job has exactly seven steps, each with the reviewed keys", () => {
    expect(steps.length).toBe(7);
    expect(keysOf(checkoutStep)).toEqual(["uses", "with"]);
    expect(keysOf(toolingStep)).toEqual(["env", "name", "run", "shell", "working-directory"]);
    expect(keysOf(bunInstallStep)).toEqual(["env", "name", "run", "shell", "working-directory"]);
    expect(keysOf(bunRevisionStep)).toEqual(["name", "run", "shell", "working-directory"]);
    expect(keysOf(rustStep)).toEqual(["uses"]);
    expect(keysOf(mutantsInstallStep)).toEqual([
      "env",
      "name",
      "run",
      "shell",
      "working-directory",
    ]);
    expect(keysOf(gateStep)).toEqual(["env", "name", "run", "shell", "working-directory"]);
  });

  test("the env of every step is exactly the reviewed one", () => {
    expect(keysOf(toolingStep?.env)).toEqual(["TOOLING_REF"]);
    expect(keysOf(bunInstallStep?.env)).toEqual(["BUN_ARCHIVE_SHA256", "BUN_ARCHIVE_URL"]);
    expect(keysOf(mutantsInstallStep?.env)).toEqual([
      "CARGO_MUTANTS_ARCHIVE_SHA256",
      "CARGO_MUTANTS_ARCHIVE_URL",
    ]);
    expect(keysOf(gateStep?.env)).toEqual([
      "CRATES",
      "LIBRE_AI_CARGO_MUTANTS",
      "MAX_MISSED",
      "MAX_MISSED_BY_CRATE",
      "TIMEOUT_SECONDS",
    ]);
  });

  test("every step that runs a script says `shell: bash`", () => {
    for (const step of runSteps) {
      expect(step?.shell).toBe("bash");
    }
  });
});

describe("pinned actions", () => {
  test("every `uses:` is pinned to a full commit sha", () => {
    const uses = scanUsesLines(text);
    expect(uses.length).toBe(2);
    for (const use of uses) {
      expect(classifyReference(use.reference)).toBe("pinned");
      expect(use.reference.split("@")[1]).toMatch(FORTY_HEX);
    }
  });

  test("the checkout is the very one of reusable-work-package-link.yml, without credentials", () => {
    const siblingCheckout: Step | null = siblingSteps(toolingSibling)[0] ?? null;
    expect(siblingCheckout?.uses).toStartWith("actions/checkout@");
    expect(checkoutStep?.uses).toBe(siblingCheckout?.uses);
    expect(checkoutStep?.with).toEqual({ "persist-credentials": false });
  });

  test("the Rust toolchain action is the very one of reusable-dependency-policy.yml", () => {
    const siblingRust: Step | null =
      siblingSteps(rustSibling).find((step) =>
        (step.uses ?? "").startsWith("dtolnay/rust-toolchain@"),
      ) ?? null;
    expect(siblingRust).not.toBeNull();
    expect(rustStep?.uses).toBe(siblingRust?.uses);
  });
});

describe("no input reaches a shell as text", () => {
  // `${{ ... }}` in a `run:` is substituted into the script text before the
  // shell reads it, so an input becomes commands. Values travel through `env:`.
  test("no `run:` of any step holds an expression", () => {
    const interpolated: string[] = [];
    steps.forEach((step, index) => {
      if ((step.run ?? "").includes(EXPRESSION)) interpolated.push(label(step, index));
    });
    expect(interpolated).toEqual([]);
  });

  test("an input is named under `env:` only, and each of the five is", () => {
    for (const [index, step] of steps.entries()) {
      const outside: string = JSON.stringify(
        Object.fromEntries(Object.entries(step).filter(([key]) => key !== "env")),
      );
      expect(outside, label(step, index)).not.toContain("inputs.");
    }
    expect(toolingStep?.env?.TOOLING_REF).toBe(expression("inputs.tooling_ref"));
    expect(gateStep?.env?.CRATES).toBe(expression("inputs.crates"));
    expect(gateStep?.env?.MAX_MISSED).toBe(expression("inputs.max_missed"));
    expect(gateStep?.env?.MAX_MISSED_BY_CRATE).toBe(expression("inputs.max_missed_by_crate"));
    expect(gateStep?.env?.TIMEOUT_SECONDS).toBe(expression("inputs.timeout_seconds"));
  });

  test("no body swallows a failure, hides a line or writes the environment of later steps", () => {
    for (const [index, step] of runSteps.entries()) {
      const body: string = step?.run ?? "";
      expect(body, `step ${index} holds ||`).not.toContain("||");
      expect(body, `step ${index} holds &&`).not.toContain("&&");
      expect(body, `step ${index} holds #`).not.toContain("#");
      expect(body, `step ${index} holds the word true`).not.toMatch(/\btrue\b/);
      expect(body, `step ${index} holds set +e`).not.toMatch(/set \+e|exit 0/);
      expect(body, `step ${index} writes GITHUB_ENV`).not.toContain("GITHUB_ENV");
    }
  });
});

describe("the governance tooling", () => {
  test("the step is, key for key and line for line, the one of reusable-work-package-link.yml", () => {
    const siblingTooling: Step | null = siblingSteps(toolingSibling)[1] ?? null;
    expect(linesOf(siblingTooling)[0]).toBe('if [[ ! "$TOOLING_REF" =~ ^[0-9a-f]{40}$ ]]; then');
    expect(toolingStep).toEqual(siblingTooling as Step);
    expect(toolingStep?.["working-directory"]).toBe(RUNNER_TEMP_DIRECTORY);
  });

  // The reviewed lines are RUN: the block up to its `fi` is executed by bash on
  // accepted and refused values. Nothing leaves the machine: it is only the check.
  const block: string = (() => {
    const lines: string[] = linesOf(toolingStep);
    const end: number = lines.indexOf("fi");
    return end < 0 ? "exit 99" : lines.slice(0, end + 1).join("\n");
  })();

  async function verdict(value: string): Promise<number> {
    const child = Bun.spawn(["bash", "-c", block], {
      env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin", TOOLING_REF: value },
      stdout: "ignore",
      stderr: "ignore",
    });
    return await child.exited;
  }

  const SHA: string = "0123456789abcdef0123456789abcdef01234567";

  test("the format check is the first thing the step does, and a full lowercase commit passes it", async () => {
    expect(linesOf(toolingStep).indexOf("fi")).toBe(3);
    expect(await verdict(SHA)).toBe(0);
  });

  test.each([
    ["empty", ""],
    ["39 characters", SHA.slice(1)],
    ["uppercase", SHA.toUpperCase()],
    ["a branch name", "main"], // allow-hardcoded-ref: a refused value, the object of the case
    ["a command suffix", `${SHA};id`],
  ])("%s is refused before any fetch", async (_name, value) => {
    expect(await verdict(value)).not.toBe(0);
  });
});

describe("the Bun toolchain", () => {
  test("the archive and its sha256 are those of toolchains/bun.json", () => {
    expect(bunInstallStep?.env?.BUN_ARCHIVE_URL).toBe(bunPolicy.durableRelease.linuxX64Asset);
    expect(bunInstallStep?.env?.BUN_ARCHIVE_SHA256).toBe(bunPolicy.assets["linux-x64"]?.sha256);
    expect(String(bunInstallStep?.env?.BUN_ARCHIVE_SHA256)).toMatch(SHA256);
  });

  test("the install and revision steps are those of reusable-work-package-link.yml", () => {
    expect(bunInstallStep).toEqual(siblingSteps(toolingSibling)[2] as Step);
    expect(bunRevisionStep).toEqual(siblingSteps(toolingSibling)[3] as Step);
    expect(linesOf(bunInstallStep)).toContain(
      'echo "$BUN_ARCHIVE_SHA256  $RUNNER_TEMP/bun.zip" | sha256sum --check --strict',
    );
    expect(linesOf(bunRevisionStep)).toEqual([
      `test "$(bun --revision)" = "${bunPolicy.revision}"`,
    ]);
  });
});

describe("cargo-mutants", () => {
  const linux: MutantsPlatform = mutantsPolicy.platforms?.["linux-x64"] ?? {};

  test("the archive and its sha256 are those of toolchains/cargo-mutants.json for linux-x64", () => {
    expect(typeof linux.archiveUrl).toBe("string");
    expect(mutantsInstallStep?.env?.CARGO_MUTANTS_ARCHIVE_URL).toBe(linux.archiveUrl);
    expect(mutantsInstallStep?.env?.CARGO_MUTANTS_ARCHIVE_SHA256).toBe(linux.archiveSha256);
  });

  test("the archive is verified before it is extracted, outside the workspace", () => {
    expect(mutantsInstallStep?.["working-directory"]).toBe(RUNNER_TEMP_DIRECTORY);
    expect(linesOf(mutantsInstallStep)).toEqual([
      'curl --fail --location --retry 3 --output "$RUNNER_TEMP/cargo-mutants.tar.gz" "$CARGO_MUTANTS_ARCHIVE_URL"',
      'echo "$CARGO_MUTANTS_ARCHIVE_SHA256  $RUNNER_TEMP/cargo-mutants.tar.gz" | sha256sum --check --strict',
      'mkdir "$RUNNER_TEMP/cargo-mutants"',
      'tar -xzf "$RUNNER_TEMP/cargo-mutants.tar.gz" -C "$RUNNER_TEMP/cargo-mutants"',
    ]);
  });

  test("the gate is handed the extracted binary, at the declared path inside the archive", () => {
    expect(gateStep?.env?.LIBRE_AI_CARGO_MUTANTS).toBe(
      `${RUNNER_TEMP_DIRECTORY}/cargo-mutants/${String(linux.executableRelativePath)}`,
    );
  });

  test("no step builds or installs the tool from a registry", () => {
    for (const [index, step] of steps.entries()) {
      expect(step.run ?? "", label(step, index)).not.toMatch(/cargo\s+(install|binstall|build)/);
    }
  });
});

describe("the gate", () => {
  test("it is the last step and its single line is the reviewed one", () => {
    expect(steps.indexOf(gateStep as Step)).toBe(steps.length - 1);
    expect(linesOf(gateStep)).toEqual([
      'bun --no-env-file tools/quality/check-mutation-rust.ts --root="$GITHUB_WORKSPACE" --crates="$CRATES" --max-missed="$MAX_MISSED" --max-missed-by-crate="$MAX_MISSED_BY_CRATE" --timeout="$TIMEOUT_SECONDS"',
    ]);
  });

  // Bun reads `bunfig.toml` and `.env` from its working directory; in the
  // workspace both belong to the repository under test.
  test("it runs from the trusted tooling directory, where the tooling step put the tooling", () => {
    expect(gateStep?.["working-directory"]).toBe(TOOLING_WORKING_DIRECTORY);
    expect(linesOf(toolingStep)).toContain('TOOLING_DIR="$RUNNER_TEMP/governance-tooling"');
  });

  test("no other step reads the workspace by path or runs a package manager", () => {
    for (const [index, step] of steps.entries()) {
      const body: string = step.run ?? "";
      if (step !== gateStep) expect(body, label(step, index)).not.toContain("GITHUB_WORKSPACE");
      expect(body, label(step, index)).not.toMatch(
        /bun run |bun install|bunx |npm |npx |yarn |pnpm /,
      );
    }
  });
});

describe("toolchains/cargo-mutants.json", () => {
  const platforms: [string, MutantsPlatform][] = Object.entries(mutantsPolicy.platforms ?? {});

  test("it has the keys of toolchains/cargo-deny.json, without `checks`", () => {
    expect(Object.keys(mutantsPolicy)).toEqual([
      "tool",
      "version",
      "license",
      "releaseUrl",
      "observedAt",
      "platforms",
      "provision",
    ]);
    expect(mutantsPolicy.tool).toBe("cargo-mutants");
    expect(typeof mutantsPolicy.license).toBe("string");
    expect(String(mutantsPolicy.observedAt)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(mutantsPolicy.provision).length).toBeGreaterThan(0);
  });

  test("the version is exact, and the release page is the page of that version", () => {
    expect(String(mutantsPolicy.version)).toMatch(/^\d+\.\d+\.\d+$/);
    expect(mutantsPolicy.releaseUrl).toBe(
      `https://github.com/sourcefrog/cargo-mutants/releases/tag/v${String(mutantsPolicy.version)}`,
    );
  });

  test("linux-x64, the platform of the runner, is declared", () => {
    expect(platforms.map(([key]) => key)).toContain("linux-x64");
  });

  test("every declared platform carries an https archive of that version and two sha256 digests", () => {
    expect(platforms.length).toBeGreaterThan(0);
    for (const [key, platform] of platforms) {
      expect(keysOf(platform), key).toEqual([
        "archiveName",
        "archiveSha256",
        "archiveUrl",
        "executableRelativePath",
        "executableSha256",
        "triple",
      ]);
      expect(platform.archiveUrl, key).toBe(
        `https://github.com/sourcefrog/cargo-mutants/releases/download/v${String(mutantsPolicy.version)}/${String(platform.archiveName)}`,
      );
      expect(platform.archiveName, key).toBe(`cargo-mutants-${String(platform.triple)}.tar.gz`);
      expect(String(platform.archiveSha256), key).toMatch(SHA256);
      expect(String(platform.executableSha256), key).toMatch(SHA256);
      expect(platform.archiveSha256, key).not.toBe(platform.executableSha256);
    }
  });

  // The repository refuses a binary resolved against a mutable registry: the
  // declaration may say so in prose, but no key offers it as a way to provision.
  test("no key names a build from the registry", () => {
    const keys: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      for (const [key, nested] of Object.entries(value)) {
        keys.push(key);
        collect(nested);
      }
    };
    collect(mutantsPolicy);
    expect(keys.filter((key) => /install|build|compile|cargo/i.test(key))).toEqual([]);
    expect(mutantsPolicyText).not.toMatch(/cargo\s+install/);
  });
});
