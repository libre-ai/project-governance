import { describe, expect, test } from "bun:test";
import {
  ACTION_PIN,
  classifyReference,
  collectUsesValues,
  emptyTally,
  isActionDefinition,
  reviewDefinition,
  reviewRepository,
  scanUsesLines,
  summarizeVolume,
} from "./check-action-pins";
import type { BlobRead, FleetFileReader, TreeListing } from "./fleet-tree";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

describe("ACTION_PIN", () => {
  test("is the rule check-workflows.test.ts applies to this repository, byte for byte", async () => {
    const source = await Bun.file(
      new URL("../tools/quality/check-workflows.test.ts", import.meta.url),
    ).text();
    expect(source).toContain(`const ACTION_PIN = ${ACTION_PIN.toString()};`);
  });
});

describe("classifyReference", () => {
  test.each([
    [`actions/checkout@${SHA}`, "pinned"],
    [`libre-ai/project-governance/.github/workflows/reusable-licensing.yml@${SHA}`, "pinned"],
    ["./.github/workflows/validate-composition.yml", "local"],
    [`docker://alpine@sha256:${"a".repeat(64)}`, "docker-digest"],
    ["docker://alpine:3.20", "unpinned"],
    ["actions/checkout@v4", "unpinned"],
    ["actions/checkout@main", "unpinned"],
    [`actions/checkout@${SHA.slice(0, 7)}`, "unpinned"],
    [`actions/checkout@${SHA.toUpperCase()}`, "unpinned"],
  ])("%s is %s", (reference, kind) => {
    expect(classifyReference(reference)).toBe(kind as ReturnType<typeof classifyReference>);
  });
});

describe("readers", () => {
  const workflow = [
    "jobs:",
    "  build:",
    "    uses: ./.github/workflows/x.yml",
    "  test:",
    "    steps:",
    `      - uses: actions/checkout@${SHA} # v7.0.1`,
    `      - uses: "actions/setup-node@v4"`,
    "      - name: no uses here",
    "        run: |",
    "          echo the word uses: inside a script is not a key",
    "",
  ].join("\n");

  test("the line scanner strips comments and quotes", () => {
    expect(scanUsesLines(workflow).map((r) => r.reference)).toEqual([
      "./.github/workflows/x.yml",
      `actions/checkout@${SHA}`,
      "actions/setup-node@v4",
    ]);
  });

  test("the YAML walk finds the same values", () => {
    expect(collectUsesValues(Bun.YAML.parse(workflow)).sort()).toEqual(
      scanUsesLines(workflow)
        .map((r) => r.reference)
        .sort(),
    );
  });

  test("an unpinned reference fails with its line", () => {
    const review = reviewDefinition(workflow);
    expect(review.unreadable).toBeNull();
    expect(review.failures).toHaveLength(1);
    expect(review.failures[0]).toStartWith("line 7: `uses: actions/setup-node@v4`");
  });

  test("a flow-mapping uses: escapes the line scanner, so the file is unreadable", () => {
    const flow = "jobs:\n  a:\n    steps:\n      - { uses: actions/checkout@v4 }\n";
    const review = reviewDefinition(flow);
    expect(review.unreadable).toContain("one reader is blind");
  });

  test("invalid YAML is unreadable", () => {
    expect(reviewDefinition("jobs: [\n").unreadable).toContain("YAML parse failed");
  });
});

describe("isActionDefinition", () => {
  test("workflows at the top of .github/workflows and composite actions at any depth", () => {
    expect(isActionDefinition(".github/workflows/ci.yml")).toBe(true);
    expect(isActionDefinition(".github/workflows/nested/ci.yml")).toBe(false);
    expect(isActionDefinition(".github/actions/setup/action.yaml")).toBe(true);
    expect(isActionDefinition("docs/workflow.yml")).toBe(false);
  });
});

function reader(listing: TreeListing, files: Record<string, BlobRead>): FleetFileReader {
  return async () => ({ listing, files: new Map(Object.entries(files)) });
}

const active = {
  repository: "libre-ai/sample",
  role: "satellite",
  layer: "couche-1",
  lifecycle: "active",
  visibility: "public" as const,
};

describe("reviewRepository", () => {
  test("green: counters sum to the references read", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      active,
      tally,
      reader(
        { kind: "listed", paths: [".github/workflows/ci.yml", "README.md"] },
        {
          ".github/workflows/ci.yml": {
            kind: "text",
            text: `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA}\n  b:\n    uses: ./.github/workflows/x.yml\n`,
          },
        },
      ),
    );
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(summarizeVolume(tally)).toBe(
      "1 inventory entries (1 read, 0 exempt): 1 of 1 tracked workflow/action file(s) examined, 2 `uses:` = 1 pinned by commit + 1 local + 0 docker by digest + 0 unpinned",
    );
  });

  test("red: a tag reference fails", async () => {
    const checks = await reviewRepository(
      active,
      emptyTally(),
      reader(
        { kind: "listed", paths: [".github/workflows/ci.yml"] },
        {
          ".github/workflows/ci.yml": {
            kind: "text",
            text: "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n",
          },
        },
      ),
    );
    expect(checks[0]?.ok).toBe(false);
  });

  test("an unreadable tree fails", async () => {
    const checks = await reviewRepository(
      active,
      emptyTally(),
      reader({ kind: "unreadable", reason: "HTTP 502" }, {}),
    );
    expect(checks).toEqual([
      { item: "libre-ai/sample", ok: false, note: "tree unreadable at HEAD: HTTP 502" },
    ]);
  });

  test("an unreadable workflow fails and is not counted as examined", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      active,
      tally,
      reader(
        { kind: "listed", paths: [".github/workflows/ci.yml"] },
        { ".github/workflows/ci.yml": { kind: "unreadable", reason: "truncated" } },
      ),
    );
    expect(checks[0]?.ok).toBe(false);
    expect(tally).toMatchObject({ filesTracked: 1, filesExamined: 0 });
  });
});
