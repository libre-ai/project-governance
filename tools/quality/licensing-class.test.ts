import { describe, expect, test } from "bun:test";
import { join } from "node:path";
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
 * The `licensing` exemption class, judged against the policy file the gate
 * ships with (not a copy of it): a pull request that moves the licence
 * declaration of a repository touches only its licence surfaces (the
 * human-readable LICENSE, the texts under LICENSES/, REUSE.toml), so it has
 * no work package to cite.
 *
 * Like every paths class it proves WHERE a change landed, never WHAT it
 * wrote; SPDX headers in other files stay outside it and follow in a
 * docs-only or fleet-bump pull request.
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

/** The globs of the shipped `licensing` rule; a missing or non-paths rule fails the test. */
async function licensingGlobs(): Promise<readonly string[]> {
  const rule = (await shippedPolicy()).exempt.licensing;
  if (rule === undefined || !("paths" in rule)) {
    throw new Error("the shipped policy must list licensing as a paths rule");
  }
  return rule.paths;
}

const PR: PrFacts = {
  repo: "libre-ai/pelote",
  number: 3,
  title: "chore(licence): make pelote proprietary",
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

const DECLARES_LICENSING: readonly CommitDeclarations[] = [
  { sha: "c1", trailers: [{ key: "Exempt", value: "licensing" }] },
];

async function report(
  changed: Fact<readonly string[]>,
  commits: readonly CommitDeclarations[] = DECLARES_LICENSING,
): Promise<GateReport> {
  return evaluateWorkPackageLink(PR, await shippedPolicy(), portsFor(commits, changed));
}

async function outcomeFor(changed: readonly string[]): Promise<string> {
  return (await report({ ok: true, value: changed })).outcome;
}

// The licence surfaces of a switch measured on libre-ai/pelote on 2026-11-15:
// with these files alone changed, `reuse lint` is compliant (45 of 45 files).
// A dated observation; replay it before relying on the list.
const MEASURED_SWITCH_PATHS: readonly string[] = [
  "LICENSE",
  "LICENSES/CC-BY-4.0.txt",
  "LICENSES/EUPL-1.2.txt",
  "LICENSES/LicenseRef-Pelote-Proprietary.txt",
  "REUSE.toml",
];

describe("the licensing exemption class", () => {
  test("is listed in the shipped policy with a paths predicate", async () => {
    expect((await licensingGlobs()).length).toBeGreaterThan(0);
  });

  test("exempts a pull request that changes every measured licence surface", async () => {
    const result: GateReport = await report({ ok: true, value: MEASURED_SWITCH_PATHS });
    expect(result.outcome).toBe("pass");
    expect(result.violations).toEqual([]);
  });

  test("exempts a pull request that changes REUSE.toml alone", async () => {
    expect(await outcomeFor(["REUSE.toml"])).toBe("pass");
  });

  test("refuses a pull request that also changes a source file, and names it", async () => {
    const result: GateReport = await report({
      ok: true,
      value: ["LICENSE", "src/index.ts"],
    });
    expect(result.outcome).toBe("violations");
    expect(result.violations.join("\n")).toContain("src/index.ts");
  });

  test.each([
    // SPDX headers move in their own docs-only or fleet-bump pull request.
    ["a file whose SPDX header changed", "AGENTS.md"],
    ["a workflow whose SPDX header changed", ".github/workflows/licensing.yml"],
    ["the package manifest", "package.json"],
    ["a nested licence text", "crates/core/LICENSES/MIT.txt"],
    ["a nested LICENSE", "crates/core/LICENSE"],
    ["a nested REUSE.toml", "assets/REUSE.toml"],
    ["a licence text that is not .txt", "LICENSES/MIT.md"],
    ["a file that merely starts like a surface", "LICENSE.bak"],
    ["a REUSE sidecar file", "art/logo.svg.license"],
  ])("refuses %s", async (_label: string, path: string) => {
    expect(await outcomeFor([path])).toBe("violations");
  });

  test("refuses an empty diff: nothing changed is not a licence switch", async () => {
    expect(await outcomeFor([])).toBe("violations");
  });

  test("refuses an unreadable diff, never a pass", async () => {
    const result: GateReport = await report({ ok: false, reason: "shallow checkout" });
    expect(result.outcome).toBe("violations");
  });

  test("prints the class and the files examined on the volume line", async () => {
    const result: GateReport = await report({ ok: true, value: MEASURED_SWITCH_PATHS });
    expect(result.volumeSummary).toContain("declaration read: Exempt: licensing");
    expect(result.volumeSummary).toContain(`${MEASURED_SWITCH_PATHS.length} file(s) examined`);
  });

  test("grants no implicit exemption: a switch with no trailer is refused", async () => {
    const result: GateReport = await report({ ok: true, value: ["LICENSE"] }, [
      { sha: "c1", trailers: [] },
    ]);
    expect(result.outcome).toBe("violations");
  });

  test("admits no nested variant of any glob: the depth restriction holds for every entry", async () => {
    const globs: readonly string[] = await licensingGlobs();
    const nested: readonly string[] = globs.map(
      (glob: string): string => `deep/dir/${glob.replaceAll("*", "fr")}`,
    );
    const admitted: readonly string[] = nested.filter((path: string): boolean =>
      globs.some((glob: string): boolean => new Bun.Glob(glob).match(path)),
    );
    expect(admitted).toEqual([]);
  });

  test("limit: a non-licence edit inside a licence file passes, the paths are all it can see", async () => {
    // Pinned on purpose. The ports return paths; any rewrite of LICENSE is
    // indistinguishable from a licence switch. Upgrade trigger: a
    // line-level port (the diff body) and a predicate on the changed lines.
    expect(await outcomeFor(["LICENSE"])).toBe("pass");
  });
});
