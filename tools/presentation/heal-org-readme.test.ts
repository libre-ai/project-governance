import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { STATUS_SECTION_BEGIN, STATUS_SECTION_END } from "../../ecosystem/project-cards";
import {
  findOpenPullRequest,
  HEAL_BRANCH,
  HEAL_SECRET,
  healCommitMessage,
  skipMessage,
  spliceStatusSection,
} from "./heal-org-readme";

const wrap = (body: string) => `${STATUS_SECTION_BEGIN}\n${body}\n${STATUS_SECTION_END}`;

describe("spliceStatusSection", () => {
  test("replaces exactly the sentinel-delimited section and nothing around it", () => {
    const live = `# Libre AI\n\nProse before.\n\n${wrap("| Radar | stale |")}\n\nProse after.\n`;
    const fresh = wrap("| Radar | fresh |");
    expect(spliceStatusSection(live, fresh)).toBe(
      `# Libre AI\n\nProse before.\n\n${fresh}\n\nProse after.\n`,
    );
  });

  test("is a fixed point once healed — a second splice changes nothing", () => {
    const fresh = wrap("| Radar | fresh |");
    const healed = spliceStatusSection(`a\n${wrap("x")}\nb`, fresh);
    expect(healed).not.toBeNull();
    expect(spliceStatusSection(healed ?? "", fresh)).toBe(healed);
  });

  test("refuses a README without sentinels — that is not a mechanical fix", () => {
    expect(spliceStatusSection("# No section here\n", wrap("x"))).toBeNull();
  });

  test("refuses a README with a duplicated sentinel pair", () => {
    const section = wrap("x");
    expect(spliceStatusSection(`${section}\n${section}`, wrap("y"))).toBeNull();
  });
});

describe("skipMessage", () => {
  test("names the absent secret in the exact 'skipped:' form the inventory documents", () => {
    const message = skipMessage("/tmp/healed/README.md");
    expect(message).toStartWith(`skipped: secret ${HEAL_SECRET} absent`);
    expect(message).toContain("/tmp/healed/README.md");
  });
});

describe("healCommitMessage", () => {
  test("carries the run URL and a Signed-off-by trailer for the token identity", () => {
    const message = healCommitMessage("https://x/runs/7", {
      name: "someone",
      email: "1+someone@users.noreply.github.com",
    });
    expect(message).toContain("https://x/runs/7");
    expect(message.trimEnd().split("\n").at(-1)).toBe(
      "Signed-off-by: someone <1+someone@users.noreply.github.com>",
    );
  });
});

// The heal is only worth anything if the red run actually reaches it, with
// the secret it is gated on wired through — a missing `secrets.` reference
// would make every run print "skipped" forever, even after the owner
// configures the token.
describe("org-readme-drift.yml runs the heal on a red run", () => {
  interface Step {
    readonly if?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly env?: Record<string, string>;
  }
  const workflow = Bun.YAML.parse(
    readFileSync(new URL("../../.github/workflows/org-readme-drift.yml", import.meta.url), "utf8"),
  ) as { jobs: Record<string, { steps: readonly Step[] }> };
  const steps = Object.values(workflow.jobs).flatMap((job) => [...job.steps]);
  const heal = steps.find((step) => (step.run ?? "").includes("heal-org-readme.ts"));

  test("the heal step exists, gated on failure()", () => {
    expect(heal).toBeDefined();
    expect(heal?.if).toMatch(/failure\(\)/);
  });

  test("the heal step receives the secret under the documented name", () => {
    expect(heal?.env?.[HEAL_SECRET]).toBe(`\${{ secrets.${HEAL_SECRET} }}`);
  });

  test("the healed README is published as an artifact on the red run", () => {
    const upload = steps.find((step) => (step.uses ?? "").startsWith("actions/upload-artifact@"));
    expect(upload?.if).toMatch(/failure\(\)/);
  });
});

describe("findOpenPullRequest", () => {
  const pulls = [
    { number: 3, headRefName: "feature/other" },
    { number: 9, headRefName: HEAL_BRANCH },
  ];

  test("finds the pull request opened from the heal branch", () => {
    expect(findOpenPullRequest(pulls)).toBe(9);
  });

  test("returns null when no open pull request comes from the heal branch", () => {
    expect(findOpenPullRequest([{ number: 3, headRefName: "feature/other" }])).toBeNull();
    expect(findOpenPullRequest([])).toBeNull();
  });
});
