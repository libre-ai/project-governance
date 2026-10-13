import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateNonCascade,
  findReferences,
  formatCascadeVolume,
  loadSkillTexts,
  type SkillText,
} from "./check-skills-cascade";

function skill(
  name: string,
  userInvoked: boolean,
  body: string,
  references: Record<string, string> = {},
): SkillText {
  const flag = userInvoked ? "\ndisable-model-invocation: true" : "";
  return {
    name,
    skillMarkdown: `---\nname: ${name}\ndescription: Example.\nlicense: Apache-2.0\nstatus: candidate${flag}\n---\n\n# ${name}\n\n${body}\n`,
    references,
  };
}

describe("findReferences", () => {
  test.each([
    'Then use the Skill tool with "deploy-clever".',
    "Then use the Skill tool with `deploy-clever`.",
    "Finish with /deploy-clever.",
    "(/deploy-clever) closes the flow.",
    "Invoke the deploy-clever skill once green.",
    "invoke `deploy-clever` afterwards",
    "Run the deploy-clever skill.",
  ])("recognises a reference: %s", (line) => {
    expect(findReferences("a", "deploy-clever", "f.md", line)).toHaveLength(1);
  });

  test.each([
    "See skills/deploy-clever/SKILL.md for the pre-flight.",
    "The deploy-clever-legacy notes are archived.",
    "Run /deploy-clever-legacy instead.",
    "a deployment to Clever Cloud",
  ])("ignores a non-reference: %s", (line) => {
    expect(findReferences("a", "deploy-clever", "f.md", line)).toHaveLength(0);
  });
});

describe("evaluateNonCascade", () => {
  test("a user-invoked skill referencing another user-invoked skill fails, with file and line", () => {
    const result = evaluateNonCascade([
      skill("wizard", true, "Step one.\nWhen done, invoke the deploy-clever skill."),
      skill("deploy-clever", true, "Pre-flight only."),
    ]);
    const failed = result.checks.filter((check) => !check.ok);
    expect(failed).toHaveLength(1);
    // Line 12 of the file: 7 frontmatter lines, a blank, the heading, a
    // blank, "Step one.", then the reference.
    expect(failed[0]?.item).toBe("skills/wizard/SKILL.md:12");
    expect(failed[0]?.note).toContain('"wizard" references user-invoked "deploy-clever"');
  });

  test("a reference found in references/ fails the same way", () => {
    const result = evaluateNonCascade([
      skill("wizard", true, "Step one.", {
        "skills/wizard/references/next.md": "Then /deploy-clever",
      }),
      skill("deploy-clever", true, "Pre-flight only."),
    ]);
    expect(result.checks.filter((check) => !check.ok).map((check) => check.item)).toEqual([
      "skills/wizard/references/next.md:1",
    ]);
  });

  test("referencing a model-invoked skill, or itself, is allowed", () => {
    const result = evaluateNonCascade([
      skill("wizard", true, 'Use the Skill tool with "verify-runtime". Re-run /wizard if needed.'),
      skill("verify-runtime", false, "Model-invoked."),
      skill("deploy-clever", true, "Pre-flight only."),
    ]);
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(result.userInvoked).toBe(2);
    expect(result.pairsExamined).toBe(2);
  });

  test("a model-invoked skill referencing a user-invoked one is outside the rule", () => {
    const result = evaluateNonCascade([
      skill("helper", false, "Suggest /deploy-clever to the user."),
      skill("deploy-clever", true, "Pre-flight only."),
    ]);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  test("an unreadable frontmatter is a failure, never a skip", () => {
    const result = evaluateNonCascade([
      { name: "broken", skillMarkdown: "no frontmatter", references: {} },
    ]);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.ok).toBe(false);
  });

  test("the volume names every counter", () => {
    const result = evaluateNonCascade([
      skill("wizard", true, "x"),
      skill("deploy-clever", true, "y"),
      skill("helper", false, "z"),
    ]);
    expect(formatCascadeVolume(result)).toBe(
      "3 skill(s) read, 2 user-invoked, 2 instruction file(s) scanned, 2 (caller, callee) pair(s) examined (corpus: this repository's skills/ only)",
    );
  });
});

describe("loadSkillTexts + CLI on a violating fixture tree", () => {
  test("the gate process exits non-zero and names the offending line", async () => {
    const root = mkdtempSync(join(tmpdir(), "cascade-fixture-"));
    for (const [name, body] of [
      ["alpha", "Then invoke the beta skill."],
      ["beta", "Nothing."],
    ] as const) {
      mkdirSync(join(root, name));
      writeFileSync(
        join(root, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: Example.\nlicense: Apache-2.0\nstatus: candidate\ndisable-model-invocation: true\n---\n\n# ${name}\n\n${body}\n`,
      );
    }
    expect((await loadSkillTexts(root)).map((text) => text.name)).toEqual(["alpha", "beta"]);
    const run = Bun.spawnSync(["bun", `${import.meta.dir}/check-skills-cascade.ts`, root], {
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(run.exitCode).toBe(1);
    expect(new TextDecoder().decode(run.stderr)).toContain(
      'user-invoked "alpha" references user-invoked "beta"',
    );
  });
});

describe("real corpus", () => {
  test("no user-invoked skill under skills/ references another one", async () => {
    const result = evaluateNonCascade(await loadSkillTexts(`${import.meta.dir}/../../skills`));
    expect(result.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result.userInvoked).toBeGreaterThan(0);
  });
});
