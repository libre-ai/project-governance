import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { EXEMPT_TRAILER, isCandidatePath } from "../fleet/bump-generation";
import {
  type CommitDeclarations,
  evaluateWorkPackageLink,
  type Fact,
  type LinkPorts,
  type PrFacts,
} from "./check-work-package-link";
import type { GateReport } from "./gate-report";
import { loadWorkPackagePolicy, type WorkPackagePolicy } from "./work-package-policy";

/**
 * The `fleet-bump` exemption class, judged against the policy file the gate
 * ships with (not a copy of it): a pull request that moves governance pins
 * touches only pin surfaces, so it has no work package to cite.
 *
 * The class proves WHERE a change landed, never WHAT it wrote: the ports of
 * the gate return changed paths, not lines. That limit is stated in
 * docs/specifications/WORK-PACKAGES.md and pinned below by the case of a
 * non-pin edit inside a pin file.
 */

const SHIPPED: string = join(
  import.meta.dir,
  "..",
  "..",
  "ecosystem",
  "work-package-policy.v1.yaml",
);

async function shippedPolicy(): Promise<WorkPackagePolicy> {
  const loaded = loadWorkPackagePolicy(await Bun.file(SHIPPED).text());
  if (!loaded.ok) {
    throw new Error(`the shipped policy must load: ${loaded.reason}`);
  }
  return loaded.value;
}

/** The globs of the shipped `fleet-bump` rule; a missing or non-paths rule fails the test. */
async function fleetBumpGlobs(): Promise<readonly string[]> {
  const rule = (await shippedPolicy()).exempt["fleet-bump"];
  if (rule === undefined || !("paths" in rule)) {
    throw new Error("the shipped policy must list fleet-bump as a paths rule");
  }
  return rule.paths;
}

const PR: PrFacts = {
  repo: "libre-ai/signalement",
  number: 7,
  title: "chore(pins): move governance pins to generation b0a5ff0c",
  author: "constantin-jais",
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
};

const unused =
  (name: string): (() => Promise<never>) =>
  async (): Promise<never> => {
    throw new Error(`port ${name} must not be called for an exemption`);
  };

function portsFor(
  commits: readonly CommitDeclarations[],
  changed: Fact<readonly string[]>,
): LinkPorts {
  return {
    readIssue: unused("readIssue"),
    readFileAt: unused("readFileAt"),
    isAncestorOfServedHead: unused("isAncestorOfServedHead"),
    commitTrailers: async (): Promise<Fact<readonly CommitDeclarations[]>> => ({
      ok: true,
      value: commits,
    }),
    changedFiles: async (): Promise<Fact<readonly string[]>> => changed,
  };
}

const DECLARES_FLEET_BUMP: readonly CommitDeclarations[] = [
  { sha: "c1", trailers: [{ key: "Exempt", value: "fleet-bump" }] },
];

async function report(
  changed: Fact<readonly string[]>,
  commits: readonly CommitDeclarations[] = DECLARES_FLEET_BUMP,
): Promise<GateReport> {
  return evaluateWorkPackageLink(PR, await shippedPolicy(), portsFor(commits, changed));
}

async function outcomeFor(changed: readonly string[]): Promise<string> {
  return (await report({ ok: true, value: changed })).outcome;
}

// Paths a real bump edited, measured by `bun tools/fleet/bump-generation.ts`
// (dry run) on 2026-10-20 against generation b0a5ff0c: 17 repositories to
// bump, 67 sites in 143 files read. Replay the measure before relying on this
// list; it is a dated observation, not an invariant.
const MEASURED_BUMP_PATHS: readonly string[] = [
  ".github/workflows/code-validation.yml",
  ".github/workflows/licensing.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/context-hygiene.yml",
  ".github/workflows/work-package-link.yml",
  ".github/workflows/notebook-webkit-macos.yml",
  "project.v1.yaml",
  "bun.lock",
  "package.json",
  "toolchains/github-actions.json",
  "README.md",
];

describe("the fleet-bump exemption class", () => {
  test("is listed in the shipped policy with a paths predicate", async () => {
    expect((await fleetBumpGlobs()).length).toBeGreaterThan(0);
  });

  test("exempts a pull request that changes every measured pin surface", async () => {
    const result: GateReport = await report({ ok: true, value: MEASURED_BUMP_PATHS });
    expect(result.outcome).toBe("pass");
    expect(result.violations).toEqual([]);
  });

  test("exempts a pull request that changes one pin surface", async () => {
    expect(await outcomeFor([".github/workflows/code-validation.yml"])).toBe("pass");
  });

  test("refuses a pull request that also changes a source file, and names it", async () => {
    const result: GateReport = await report({
      ok: true,
      value: ["project.v1.yaml", "src/index.ts"],
    });
    expect(result.outcome).toBe("violations");
    expect(result.violations.join("\n")).toContain("src/index.ts");
  });

  test.each([
    ["a nested package.json", "crates/x/package.json"],
    ["a workflow in a subdirectory", ".github/workflows/sub/ci.yml"],
    ["an action definition", ".github/actions/setup/action.yml"],
    ["the composition manifest", ".github/composition/manifest.json"],
    ["a Cargo manifest", "Cargo.toml"],
    // The bump tool can edit AGENTS.md, but it is read by agents as
    // instructions and no measured bump touched it: rewriting it is not a pin move.
    ["the agent instructions", "AGENTS.md"],
    ["a CODEOWNERS file", ".github/CODEOWNERS"],
    ["a non-workflow file under .github", ".github/dependabot.yml"],
    ["a toolchain file in a subdirectory", "toolchains/sub/x.json"],
    ["a TypeScript file", "tools/quality/gate.ts"],
    ["a file that merely starts like a surface", "package.json.bak"],
  ])("refuses %s", async (_label: string, path: string) => {
    expect(await outcomeFor([path])).toBe("violations");
  });

  test("refuses an empty diff: nothing changed is not a pin bump", async () => {
    expect(await outcomeFor([])).toBe("violations");
  });

  test("refuses an unreadable diff, never a pass", async () => {
    const result: GateReport = await report({ ok: false, reason: "shallow checkout" });
    expect(result.outcome).toBe("violations");
  });

  test("prints the class and the files examined on the volume line", async () => {
    const result: GateReport = await report({ ok: true, value: MEASURED_BUMP_PATHS });
    expect(result.volumeSummary).toContain("declaration read: Exempt: fleet-bump");
    expect(result.volumeSummary).toContain(`${MEASURED_BUMP_PATHS.length} file(s) examined`);
  });

  test("grants no implicit exemption: a bump with no trailer is refused", async () => {
    const result: GateReport = await report({ ok: true, value: ["project.v1.yaml"] }, [
      { sha: "c1", trailers: [] },
    ]);
    expect(result.outcome).toBe("violations");
  });

  test("limit: a non-pin edit inside a pin file passes, the paths are all it can see", async () => {
    // Pinned on purpose. The ports return paths; a `scripts` edit of
    // package.json is indistinguishable from a pin edit of package.json.
    // Upgrade trigger: a line-level port (the diff body) and a predicate on
    // the shape of the changed lines.
    expect(await outcomeFor(["package.json"])).toBe("pass");
  });
});

describe("the class the bump tool declares", () => {
  test("is a class the shipped policy lists", async () => {
    const declared: string = EXEMPT_TRAILER.replace(/^Exempt: /, "");
    expect(declared).not.toBe(EXEMPT_TRAILER);
    expect(Object.keys((await shippedPolicy()).exempt)).toContain(declared);
  });
});

describe("the fleet-bump globs against the bump tool", () => {
  test("admit only paths the bump tool reads as pin candidates", async () => {
    const globs: readonly string[] = await fleetBumpGlobs();
    // A `*` is instantiated with two letters, the shortest stem the tool's own
    // candidate test accepts everywhere (`README.<xx>.md`, workflows, toolchains).
    const probes: readonly string[] = globs.map((glob: string): string =>
      glob.replaceAll("*", "fr"),
    );
    const notCandidates: readonly string[] = probes.filter(
      (path: string): boolean => !isCandidatePath(path, "project.v1.yaml"),
    );
    expect(notCandidates).toEqual([]);
  });

  test("admit no nested variant of any glob: the depth restriction holds for every entry", async () => {
    const globs: readonly string[] = await fleetBumpGlobs();
    const nested: readonly string[] = globs.map(
      (glob: string): string => `deep/dir/${glob.replaceAll("*", "fr")}`,
    );
    const admitted: readonly string[] = nested.filter((path: string): boolean =>
      globs.some((glob: string): boolean => new Bun.Glob(glob).match(path)),
    );
    expect(admitted).toEqual([]);
  });

  test("cover every pin surface the dry run measured", async () => {
    const globs: readonly string[] = await fleetBumpGlobs();
    const uncovered: readonly string[] = MEASURED_BUMP_PATHS.filter(
      (path: string): boolean =>
        !globs.some((glob: string): boolean => new Bun.Glob(glob).match(path)),
    );
    expect(uncovered).toEqual([]);
  });
});
