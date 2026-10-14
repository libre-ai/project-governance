import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Json = Record<string, unknown>;
// The readback is a deliberately loose tree that each test edits at an arbitrary depth.
// biome-ignore lint/suspicious/noExplicitAny: fixture mutation, not production typing
type Mutable = Record<string, any>;

const here = import.meta.dir;
const filter = join(here, "provider-policy.frozen-check.jq");
const readback = JSON.parse(
  readFileSync(join(here, "fixtures", "frozen-readback.json"), "utf8"),
) as Json;

interface Verdict {
  frozen: boolean;
  blockers: string[];
  residual_risks: string[];
}

/** Run the verdict program on a modified copy of the frozen readback. */
function verdict(change: (copy: Mutable) => void): Verdict {
  const copy = structuredClone(readback) as Mutable;
  change(copy);
  const result = Bun.spawnSync(
    ["jq", "-c", "--arg", "expected_collaborator", "constantin-jais", "-f", filter],
    { stdin: Buffer.from(JSON.stringify(copy)), stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(`jq exited ${result.exitCode}`);
  return (JSON.parse(result.stdout.toString()) as { frozen_check: Verdict }).frozen_check;
}

function expectBlocked(change: (copy: Mutable) => void, fragment: string): void {
  const result = verdict(change);
  expect(result.frozen).toBe(false);
  expect(result.blockers.some((blocker) => blocker.includes(fragment))).toBe(true);
}

describe("frozen_check", () => {
  test("control: the readback taken after the owner freeze derives frozen with no blocker", () => {
    const result = verdict(() => {});
    expect(result.frozen).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("residual risks stay named when frozen is true", () => {
    const result = verdict(() => {});
    expect(result.residual_risks.some((risk) => risk.includes("Dependabot"))).toBe(true);
    expect(result.residual_risks.some((risk) => risk.includes("open pull request"))).toBe(true);
    expect(result.residual_risks.some((risk) => risk.includes("pull requests are enabled"))).toBe(
      true,
    );
    expect(result.residual_risks.some((risk) => risk.includes("administrative authority"))).toBe(
      true,
    );
  });

  test("red:frozen-ruleset-bypass a ruleset whose bypass list is missing or not empty is not frozen", () => {
    expectBlocked((copy) => delete copy.rulesets[0].bypass_actors, "no active ruleset");
    expectBlocked((copy) => {
      copy.rulesets[0].bypass_actors = [{ actor_id: 1, actor_type: "RepositoryRole" }];
    }, "no active ruleset");
  });

  test("red:frozen-ruleset-exclude a ruleset that excludes a ref pattern is not frozen", () => {
    expectBlocked((copy) => {
      copy.rulesets[0].conditions.ref_name.exclude = ["refs/heads/dependabot/**/*"];
    }, "no active ruleset");
    expectBlocked(
      (copy) => delete copy.rulesets[0].conditions.ref_name.exclude,
      "no active ruleset",
    );
  });

  test("red:frozen-ruleset-can-bypass a ruleset the reader can bypass is not frozen", () => {
    expectBlocked((copy) => {
      copy.rulesets[0].current_user_can_bypass = "always";
    }, "no active ruleset");
    expectBlocked((copy) => delete copy.rulesets[0].current_user_can_bypass, "no active ruleset");
  });

  test("a ruleset that is evaluate-only, not branch-wide, or missing a rule is not frozen", () => {
    expectBlocked((copy) => {
      copy.rulesets[0].enforcement = "evaluate";
    }, "no active ruleset");
    expectBlocked((copy) => {
      copy.rulesets[0].conditions.ref_name.include = ["refs/heads/main"];
    }, "no active ruleset");
    expectBlocked((copy) => {
      copy.rulesets[0].rules = copy.rulesets[0].rules.filter(
        (rule: { type: string }) => rule.type !== "update",
      );
    }, "no active ruleset");
  });

  test("red:frozen-wiki an enabled wiki is not frozen", () => {
    expectBlocked((copy) => {
      copy.settings.has_wiki = true;
    }, "wiki");
  });

  test("red:frozen-pages enabled Pages are not frozen", () => {
    expectBlocked((copy) => {
      copy.settings.has_pages = true;
    }, "Pages");
  });

  test("red:frozen-discussions enabled discussions are not frozen", () => {
    expectBlocked((copy) => {
      copy.settings.has_discussions = true;
    }, "discussions");
  });

  test("red:frozen-vulnerability-alerts enabled vulnerability alerts are not frozen", () => {
    expectBlocked((copy) => {
      copy.security.vulnerability_alerts = true;
    }, "vulnerability alerts");
  });

  test("red:frozen-security-fixes enabled automated security fixes are not frozen", () => {
    expectBlocked((copy) => {
      copy.security.automated_security_fixes = true;
    }, "automated security fixes");
  });

  test("red:frozen-collaborator a collaborator other than the owner is not frozen", () => {
    expectBlocked((copy) => {
      copy.access.collaborators[0].login = "someone-else";
    }, "collaborators");
    expectBlocked((copy) => {
      copy.access.collaborators.push({ login: "second" });
    }, "collaborators");
  });

  test("red:frozen-unreadable a control that could not be read is a blocker, never an empty one", () => {
    for (const change of [
      (copy: Mutable) => {
        copy.rulesets = null;
      },
      (copy: Mutable) => {
        copy.access.webhooks = null;
      },
      (copy: Mutable) => {
        copy.access.collaborators = null;
      },
      (copy: Mutable) => {
        copy.dependabot.config_file.present = null;
      },
      (copy: Mutable) => {
        copy.security.vulnerability_alerts = null;
      },
    ]) {
      const result = verdict(change);
      expect(result.frozen).toBe(false);
      expect(result.blockers[0]).toContain("could not be read");
    }
  });

  test("Actions, the workflow token, lock, issues and Dependabot with Actions on each block", () => {
    expectBlocked((copy) => {
      copy.actions.permissions.enabled = true;
    }, "Actions are not disabled");
    expectBlocked((copy) => {
      copy.actions.workflow_token.default_workflow_permissions = "write";
    }, "workflow token");
    expectBlocked((copy) => {
      copy.branch_protection = null;
    }, "not locked");
    expectBlocked((copy) => {
      copy.settings.has_issues = true;
    }, "issues");
    expectBlocked((copy) => {
      copy.settings.visibility = "public";
    }, "not private");
    expectBlocked((copy) => {
      copy.actions.runs_queued = 1;
    }, "workflow runs");
  });
});
