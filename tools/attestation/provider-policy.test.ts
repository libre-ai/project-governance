import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The readback is a deliberately loose tree that each test edits at an arbitrary depth.
// biome-ignore lint/suspicious/noExplicitAny: fixture mutation, not production typing
type Mutable = Record<string, any>;

const here = import.meta.dir;
const filter = join(here, "provider-policy.frozen-check.jq");
const script = join(here, "provider-policy.sh");
const readback = JSON.parse(
  readFileSync(join(here, "fixtures", "frozen-readback.json"), "utf8"),
) as Mutable;
const owner = "constantin-jais";

const root = mkdtempSync(join(tmpdir(), "provider-policy-test-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

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
    ["jq", "-c", "--arg", "expected_collaborator", owner, "-f", filter],
    {
      stdin: Buffer.from(JSON.stringify(copy)),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (result.exitCode !== 0) throw new Error(`jq exited ${result.exitCode}`);
  return (JSON.parse(result.stdout.toString()) as { frozen_check: Verdict }).frozen_check;
}

function expectBlocked(change: (copy: Mutable) => void, fragment: string): void {
  const result = verdict(change);
  expect(result.frozen).toBe(false);
  expect(result.blockers.some((blocker) => blocker.includes(fragment))).toBe(true);
}

function expectNotBlocked(change: (copy: Mutable) => void, fragment: string): void {
  expect(verdict(change).blockers.some((blocker) => blocker.includes(fragment))).toBe(false);
}

describe("frozen_check", () => {
  test("control: the readback taken after the owner freeze derives frozen with no blocker", () => {
    const result = verdict(() => {});
    expect(result.frozen).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("red:frozen-residual-dependabot a configured Dependabot stays a named residual risk", () => {
    const risks = (present: boolean) =>
      verdict((copy) => {
        copy.dependabot.config_file.present = present;
      }).residual_risks;
    expect(risks(true).some((risk) => risk.includes("Dependabot"))).toBe(true);
    expect(risks(false).some((risk) => risk.includes("Dependabot"))).toBe(false);
  });

  test("red:frozen-residual-open-pr an open pull request stays a named residual risk", () => {
    const risks = (pulls: unknown[]) =>
      verdict((copy) => {
        copy.dependabot.open_pull_requests = pulls;
      }).residual_risks;
    expect(risks([{ number: 1 }]).some((risk) => risk.includes("open pull request"))).toBe(true);
    expect(risks([]).some((risk) => risk.includes("open pull request"))).toBe(false);
  });

  test("red:frozen-residual-pull-requests enabled pull requests stay a named residual risk", () => {
    const risks = (enabled: boolean) =>
      verdict((copy) => {
        copy.settings.has_pull_requests = enabled;
      }).residual_risks;
    expect(risks(true).some((risk) => risk.includes("pull requests are enabled"))).toBe(true);
    expect(risks(false).some((risk) => risk.includes("pull requests are enabled"))).toBe(false);
  });

  test("red:frozen-residual-tags the absence of a tag ruleset stays a named residual risk", () => {
    const risks = (change: (copy: Mutable) => void) => verdict(change).residual_risks;
    expect(risks(() => {}).some((risk) => risk.includes("no tag ruleset"))).toBe(true);
    expect(
      risks((copy) => {
        copy.rulesets.push({ ...copy.rulesets[0], target: "tag" });
      }).some((risk) => risk.includes("no tag ruleset")),
    ).toBe(false);
  });

  test("the owner's administrative authority is always named", () => {
    expect(verdict(() => {}).residual_risks.at(-1)).toContain("administrative authority");
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

  test("red:frozen-ruleset-enforcement an evaluate-only ruleset is not frozen", () => {
    expectBlocked((copy) => {
      copy.rulesets[0].enforcement = "evaluate";
    }, "no active ruleset");
  });

  test("red:frozen-ruleset-target a ruleset that is not about branches is not frozen", () => {
    expectBlocked((copy) => {
      copy.rulesets[0].target = "tag";
    }, "no active ruleset");
  });

  test("red:frozen-ruleset-include a ruleset that does not cover every branch is not frozen", () => {
    expectBlocked((copy) => {
      copy.rulesets[0].conditions.ref_name.include = ["refs/heads/main"];
    }, "no active ruleset");
  });

  test("red:frozen-ruleset-rules a ruleset missing one of the four rules is not frozen", () => {
    for (const missing of ["creation", "update", "deletion", "non_fast_forward"])
      expectBlocked((copy) => {
        copy.rulesets[0].rules = copy.rulesets[0].rules.filter(
          (rule: { type: string }) => rule.type !== missing,
        );
      }, "no active ruleset");
  });

  test("red:frozen-ruleset no ruleset at all is not frozen", () => {
    expectBlocked((copy) => {
      copy.rulesets = [];
    }, "no active ruleset");
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
      (copy: Mutable) => {
        copy.actions.runs_queued = null;
      },
    ]) {
      const result = verdict(change);
      expect(result.frozen).toBe(false);
      expect(result.blockers[0]).toContain("could not be read");
    }
  });

  const blockers: ReadonlyArray<readonly [string, (copy: Mutable) => void, string]> = [
    ["visibility", (copy) => (copy.settings.visibility = "public"), "not private"],
    ["actions", (copy) => (copy.actions.permissions.enabled = true), "Actions are not disabled"],
    [
      "token",
      (copy) => (copy.actions.workflow_token.default_workflow_permissions = "write"),
      "workflow token",
    ],
    ["runs-in-progress", (copy) => (copy.actions.runs_in_progress = 1), "runs in progress"],
    ["runs-queued", (copy) => (copy.actions.runs_queued = 1), "runs queued"],
    ["lock", (copy) => (copy.branch_protection.lock_branch.enabled = false), "is not locked"],
    ["lock", (copy) => (copy.branch_protection = null), "is not locked"],
    [
      "enforce-admins",
      (copy) => (copy.branch_protection.enforce_admins.enabled = false),
      "not enforced on administrators",
    ],
    [
      "dependabot-actions",
      (copy) => (copy.actions.permissions.enabled = true),
      "Dependabot version updates are configured",
    ],
    [
      "collaborator",
      (copy) => (copy.access.collaborators[0].login = "someone-else"),
      "collaborators",
    ],
    [
      "collaborator",
      (copy) => copy.access.collaborators.push({ login: "second" }),
      "collaborators",
    ],
    ["invitations", (copy) => (copy.access.pending_invitations = 1), "pending invitations"],
    ["teams", (copy) => (copy.access.teams = 1), "teams present"],
    ["webhooks", (copy) => (copy.access.webhooks = 1), "webhooks present"],
    ["deploy-keys", (copy) => (copy.access.deploy_keys = 1), "deploy keys present"],
    ["secrets", (copy) => (copy.actions.secrets = 1), "Actions secrets"],
    ["variables", (copy) => (copy.actions.variables = 1), "Actions variables"],
    ["environments", (copy) => (copy.actions.environments = 1), "Actions environments"],
    ["issues", (copy) => (copy.settings.has_issues = true), "issues are enabled"],
    ["wiki", (copy) => (copy.settings.has_wiki = true), "wiki"],
    ["pages", (copy) => (copy.settings.has_pages = true), "Pages"],
    ["discussions", (copy) => (copy.settings.has_discussions = true), "discussions"],
    ["projects", (copy) => (copy.settings.has_projects = true), "projects"],
    [
      "vulnerability-alerts",
      (copy) => (copy.security.vulnerability_alerts = true),
      "vulnerability alerts",
    ],
    [
      "security-fixes",
      (copy) => (copy.security.automated_security_fixes = true),
      "automated security fixes",
    ],
  ];
  for (const [id, change, fragment] of blockers)
    test(`red:frozen-${id} ${fragment} blocks`, () => {
      expectBlocked(change, fragment);
    });

  test("red:frozen-counts an unreadable count is never read as zero, whichever count it is", () => {
    const counts: Array<(copy: Mutable) => void> = [
      (copy) => (copy.actions.secrets = null),
      (copy) => (copy.actions.variables = null),
      (copy) => (copy.actions.environments = null),
      (copy) => (copy.actions.runs_in_progress = null),
      (copy) => (copy.actions.runs_queued = null),
      (copy) => (copy.access.pending_invitations = null),
      (copy) => (copy.access.teams = null),
      (copy) => (copy.access.webhooks = null),
      (copy) => (copy.access.deploy_keys = null),
    ];
    for (const change of counts) {
      const result = verdict(change);
      expect(result.frozen).toBe(false);
      expect(result.blockers[0]).toContain("could not be read");
      expect(result.blockers.length).toBeGreaterThan(1);
    }
  });

  test("each blocker is independent: the others stay quiet", () => {
    expectNotBlocked((copy) => (copy.access.webhooks = 1), "teams present");
    expectNotBlocked((copy) => (copy.actions.secrets = 1), "Actions variables");
    expectNotBlocked(
      (copy) => (copy.branch_protection.lock_branch.enabled = false),
      "administrators",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// provider-policy.sh itself, run against a stub `gh` that answers from files.
// ---------------------------------------------------------------------------------------------

type Reply = { status: 200; body: unknown } | { status: 403 | 404 };

function endpointKey(endpoint: string): string {
  return endpoint.replace(/[^A-Za-z0-9]/g, "_");
}

/** Replies the stub gives for the frozen fixture, keyed by the path after `repos/<repo>`. */
function frozenReplies(): Record<string, Reply> {
  const r = readback;
  return {
    "": { status: 200, body: { ...r.settings } },
    "/rulesets?includes_parents=true": { status: 200, body: [{ id: 1 }] },
    "/rulesets/1": { status: 200, body: r.rulesets[0] },
    "/branches/main/protection": { status: 200, body: r.branch_protection },
    "/actions/permissions": { status: 200, body: r.actions.permissions },
    "/actions/permissions/workflow": { status: 200, body: r.actions.workflow_token },
    "/actions/permissions/selected-actions": { status: 403 },
    "/actions/workflows": { status: 200, body: { workflows: r.actions.workflows } },
    "/collaborators": { status: 200, body: r.access.collaborators },
    "/invitations": { status: 200, body: [] },
    "/teams": { status: 200, body: [] },
    "/hooks": { status: 200, body: [] },
    "/keys": { status: 200, body: [] },
    "/actions/secrets": { status: 200, body: { total_count: 0 } },
    "/actions/variables": { status: 200, body: { total_count: 0 } },
    "/environments": { status: 200, body: { total_count: 0 } },
    "/branches?per_page=100": { status: 200, body: r.branches },
    "/pulls?state=open&per_page=100": {
      status: 200,
      body: r.dependabot.open_pull_requests.map((pull: Mutable) => ({
        number: pull.number,
        user: { login: pull.user },
        head: { ref: pull.head, sha: pull.head_sha },
      })),
    },
    "/contents/.github/dependabot.yml": { status: 200, body: { sha: "abc123" } },
    "/actions/runs?status=in_progress": { status: 200, body: { total_count: 0 } },
    "/actions/runs?status=queued": { status: 200, body: { total_count: 0 } },
    "/vulnerability-alerts": { status: 404 },
    "/automated-security-fixes": { status: 200, body: { enabled: false, paused: false } },
    "/private-vulnerability-reporting": { status: 403 },
  };
}

let stubCounter = 0;

/** Run provider-policy.sh with a stub gh; returns the parsed readback. */
function readbackWith(change: (replies: Record<string, Reply>) => void): Mutable {
  const replies = frozenReplies();
  change(replies);
  stubCounter += 1;
  const directory = join(root, `stub-${stubCounter}`);
  mkdirSync(join(directory, "bin"), { recursive: true });
  for (const [endpoint, reply] of Object.entries(replies)) {
    const key = endpointKey(`repos/fixture/repo${endpoint}`);
    if (reply.status === 200)
      writeFileSync(join(directory, `${key}.200`), JSON.stringify(reply.body));
    else if (reply.status === 404) writeFileSync(join(directory, `${key}.404`), "");
    else writeFileSync(join(directory, `${key}.403`), "");
  }
  const gh = join(directory, "bin", "gh");
  writeFileSync(
    gh,
    `#!/bin/sh
# Stub gh: "gh api <endpoint> [--silent]" answers from $STUB_DIR/<endpoint>.<status>.
key="$(printf '%s' "$2" | tr -c 'A-Za-z0-9' '_')"
if [ -f "$STUB_DIR/$key.200" ]; then
  [ "$3" = "--silent" ] || cat "$STUB_DIR/$key.200"
  exit 0
fi
if [ -f "$STUB_DIR/$key.404" ]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
echo "gh: Forbidden (HTTP 403)" >&2
exit 1
`,
  );
  chmodSync(gh, 0o755);
  const result = Bun.spawnSync(["sh", script, "fixture/repo", owner], {
    env: {
      PATH: `${join(directory, "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      STUB_DIR: directory,
      HOME: root,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`provider-policy.sh exited ${result.exitCode}`);
  return JSON.parse(result.stdout.toString()) as Mutable;
}

describe("provider-policy.sh against a stub gh", () => {
  test("control: every endpoint answers, the script derives frozen and keeps the fixture shape", () => {
    const out = readbackWith(() => {});
    expect(out.frozen_check.frozen).toBe(true);
    expect(out.frozen_check.blockers).toEqual([]);
    expect(out.dependabot.config_file).toEqual({ present: true, sha: "abc123" });
    expect(out.security.vulnerability_alerts).toBe(false);
    expect(out.security.private_vulnerability_reporting).toBeNull();
    expect(out.rulesets).toHaveLength(1);
    expect(out.access.collaborators.map((entry: Mutable) => entry.login)).toEqual([owner]);
  });

  test("red:readback-404 an HTTP 404 on a status endpoint reads as absent, not unreadable", () => {
    const out = readbackWith((replies) => {
      replies["/contents/.github/dependabot.yml"] = { status: 404 };
    });
    expect(out.dependabot.config_file.present).toBe(false);
    expect(out.frozen_check.blockers).toEqual([]);
  });

  test("red:readback-other any other failure on a status endpoint reads as unreadable, not absent", () => {
    const out = readbackWith((replies) => {
      replies["/vulnerability-alerts"] = { status: 403 };
      replies["/contents/.github/dependabot.yml"] = { status: 403 };
    });
    expect(out.security.vulnerability_alerts).toBeNull();
    expect(out.dependabot.config_file.present).toBeNull();
    expect(out.frozen_check.frozen).toBe(false);
    expect(out.frozen_check.blockers[0]).toContain("could not be read");
  });

  test("red:readback-probe an endpoint that cannot be read stays null, never an empty list", () => {
    const out = readbackWith((replies) => {
      replies["/hooks"] = { status: 403 };
      replies["/collaborators"] = { status: 403 };
    });
    expect(out.access.webhooks).toBeNull();
    expect(out.access.collaborators).toBeNull();
    expect(out.frozen_check.frozen).toBe(false);
  });

  test("red:readback-rulesets an unreadable ruleset list stays null, not an empty list", () => {
    const out = readbackWith((replies) => {
      replies["/rulesets?includes_parents=true"] = { status: 403 };
    });
    expect(out.rulesets).toBeNull();
    expect(out.frozen_check.blockers[0]).toContain("rulesets");
  });

  test("red:readback-protection without a readable default branch there is no protection to ask about", () => {
    const out = readbackWith((replies) => {
      replies[""] = { status: 403 };
    });
    expect(out.branch_protection).toBeNull();
    expect(out.settings).toBeNull();
    expect(out.frozen_check.frozen).toBe(false);
  });

  test("red:readback-secrets an unreadable count endpoint stays null in the readback, whichever count it is", () => {
    for (const endpoint of [
      "/actions/secrets",
      "/actions/variables",
      "/environments",
      "/actions/runs?status=in_progress",
      "/actions/runs?status=queued",
    ]) {
      const out = readbackWith((replies) => {
        replies[endpoint] = { status: 403 };
      });
      expect(out.frozen_check.frozen).toBe(false);
      expect(out.frozen_check.blockers[0]).toContain("could not be read");
    }
  });

  test("red:readback-queued the queued-run count is read from the provider and unreadable stays null", () => {
    const out = readbackWith((replies) => {
      replies["/actions/runs?status=queued"] = { status: 403 };
    });
    expect(out.actions.runs_queued).toBeNull();
    expect(out.actions.runs_in_progress).toBe(0);
  });

  test("both arguments are required: no default repository, no default owner login", () => {
    const run = (...args: string[]) =>
      Bun.spawnSync(["sh", script, ...args], {
        env: { PATH: process.env.PATH ?? "" },
        stdout: "pipe",
        stderr: "pipe",
      });
    expect(run().exitCode).not.toBe(0);
    expect(run("fixture/repo").exitCode).not.toBe(0);
  });
});
