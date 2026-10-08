import { describe, expect, test } from "bun:test";

import {
  ARCHIVED_EXCLUSIONS,
  buildWorkflowsTreeQuery,
  type CanonicalToolchain,
  extractDeclaredSources,
  parseWorkflowsTreeBatchResponse,
  parseWorkflowsTreeNode,
  readCanonical,
  selectToolchainTargets,
  verifyCanonical,
  verifySources,
} from "./check-toolchain-source";

test("selectToolchainTargets excludes private repositories before remote fetch", () => {
  expect(
    selectToolchainTargets([
      { repository: "libre-ai/public", visibility: "public" },
      { repository: "libre-ai/product-research", visibility: "private" },
    ]),
  ).toEqual(["libre-ai/public"]);
});

const canonical: CanonicalToolchain = {
  assetUrl:
    "https://github.com/libre-ai/project-governance/releases/download/toolchain-bun-1.4.0-canary.1-57f349f63/bun-linux-x64.zip",
  assetSha256: "83144e2542c33aaae541cf16b42f8cf1c55c3b94c5395fc776417fa27e95bcbf",
};

/** The install block every workflow of the fleet carries, verbatim in shape. */
function installBlock(url: string, sha256: string | null): string {
  return [
    "      - name: Install archived Bun toolchain",
    "        env:",
    `          BUN_ARCHIVE_URL: ${url}`,
    ...(sha256 === null ? [] : [`          BUN_ARCHIVE_SHA256: ${sha256}`]),
    "        run: |",
    '          curl --fail --location --retry 3 --output "$RUNNER_TEMP/bun.zip" "$BUN_ARCHIVE_URL"',
    '          echo "$BUN_ARCHIVE_SHA256  $RUNNER_TEMP/bun.zip" | sha256sum --check --strict',
  ].join("\n");
}

const HUB_URL =
  "https://github.com/libre-ai/libre-ai/releases/download/toolchain-bun-1.4.0-canary.1-57f349f63/bun-linux-x64.zip";

describe("extractDeclaredSources", () => {
  test("reads the URL and its paired digest out of an install block", () => {
    const sources = extractDeclaredSources(
      "libre-ai/contracts",
      ".github/workflows/ci.yml",
      installBlock(canonical.assetUrl, canonical.assetSha256),
    );
    expect(sources.length).toBe(1);
    expect(sources[0]?.url).toBe(canonical.assetUrl);
    expect(sources[0]?.sha256).toBe(canonical.assetSha256);
    expect(sources[0]?.repository).toBe("libre-ai/contracts");
    expect(sources[0]?.file).toBe(".github/workflows/ci.yml");
  });

  test("a workflow installing the toolchain twice declares two sources", () => {
    const workflow = [
      installBlock(canonical.assetUrl, canonical.assetSha256),
      "  second-job:",
      installBlock(HUB_URL, canonical.assetSha256),
    ].join("\n");
    const sources = extractDeclaredSources(
      "libre-ai/governance",
      ".github/workflows/ci.yml",
      workflow,
    );
    expect(sources.length).toBe(2);
    expect(sources[1]?.url).toBe(HUB_URL);
  });

  test("a URL declared without a digest is still reported, so the gate can refuse it", () => {
    const sources = extractDeclaredSources(
      "libre-ai/ui",
      ".github/workflows/ci.yml",
      installBlock(canonical.assetUrl, null),
    );
    expect(sources.length).toBe(1);
    expect(sources[0]?.sha256).toBeNull();
  });
});

describe("verifySources", () => {
  test("counter-proof: a workflow pointing at the archived hub release turns the gate red, naming repository and file", () => {
    const verdict = verifySources(
      [
        {
          repository: "libre-ai/sdk-ts",
          file: ".github/workflows/ci.yml",
          url: HUB_URL,
          sha256: canonical.assetSha256,
        },
      ],
      canonical,
    );
    expect(verdict.failures.length).toBe(1);
    expect(verdict.failures[0]).toContain("libre-ai/sdk-ts");
    expect(verdict.failures[0]).toContain(".github/workflows/ci.yml");
    expect(verdict.failures[0]).toContain("libre-ai/libre-ai");
  });

  test("counter-proof: a digest diverging from the canonical policy turns the gate red", () => {
    const verdict = verifySources(
      [
        {
          repository: "libre-ai/envelope",
          file: ".github/workflows/ci.yml",
          url: canonical.assetUrl,
          sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        },
      ],
      canonical,
    );
    expect(verdict.failures.length).toBe(1);
    expect(verdict.failures[0]).toContain("digest");
    expect(verdict.failures[0]).toContain("libre-ai/envelope");
  });

  test("counter-proof: a URL installed without any digest turns the gate red", () => {
    const verdict = verifySources(
      [
        {
          repository: "libre-ai/ui",
          file: ".github/workflows/ci.yml",
          url: canonical.assetUrl,
          sha256: null,
        },
      ],
      canonical,
    );
    expect(verdict.failures.length).toBe(1);
    expect(verdict.failures[0]).toContain("no BUN_ARCHIVE_SHA256");
  });

  test("the canonical pair is asserted, not merely tolerated", () => {
    const verdict = verifySources(
      [
        {
          repository: "libre-ai/contracts",
          file: ".github/workflows/ci.yml",
          url: canonical.assetUrl,
          sha256: canonical.assetSha256,
        },
      ],
      canonical,
    );
    expect(verdict.failures).toEqual([]);
    expect(verdict.asserted).toBe(1);
  });

  test("non-inertness: finding nothing to compare is a failure, never a pass", () => {
    const verdict = verifySources([], canonical);
    expect(verdict.asserted).toBe(0);
    expect(verdict.failures.length).toBe(1);
    expect(verdict.failures[0]).toContain("no BUN_ARCHIVE_URL");
  });
});

describe("verifyCanonical", () => {
  // Comparing every workflow to the canonical declaration is worthless if the
  // canonical declaration itself may name the archive: the whole fleet would
  // go uniformly green against a dead source. The gate checks its own oracle.
  test("counter-proof: a canonical policy naming the archived hub turns the gate red", () => {
    const failures = verifyCanonical({
      durableRelease: {
        url: "https://github.com/libre-ai/libre-ai/releases/tag/toolchain-bun-1.4.0-canary.1-57f349f63",
        linuxX64Asset: HUB_URL,
      },
      assets: { "linux-x64": { sha256: canonical.assetSha256 } },
    });
    expect(failures.length).toBe(2);
    expect(failures.every((failure) => failure.includes("libre-ai/libre-ai"))).toBe(true);
  });

  test("counter-proof: a canonical policy without an asset URL turns the gate red", () => {
    const failures = verifyCanonical({
      durableRelease: { url: canonical.assetUrl, linuxX64Asset: "" },
      assets: { "linux-x64": { sha256: canonical.assetSha256 } },
    });
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain("linuxX64Asset");
  });

  test("the live canonical policy of this repository passes its own check", async () => {
    expect(verifyCanonical(await readCanonical())).toEqual([]);
  });
});

describe("ARCHIVED_EXCLUSIONS", () => {
  test("the archived hub is excluded by name and carries its reason", () => {
    expect(ARCHIVED_EXCLUSIONS.get("libre-ai/libre-ai")).toContain("archived");
  });

  test("nothing else is excluded — every living repository is swept", () => {
    expect([...ARCHIVED_EXCLUSIONS.keys()]).toEqual(["libre-ai/libre-ai"]);
  });
});

describe("buildWorkflowsTreeQuery", () => {
  test("aliases by index and reads the .github/workflows tree only", () => {
    const query = buildWorkflowsTreeQuery(["libre-ai/authz-biscuit"]);
    expect(query).toContain('repo0: repository(owner: "libre-ai", name: "authz-biscuit")');
    expect(query).toContain('object(expression: "HEAD:.github/workflows")');
    // Never a branch name: a literal `main` read the documentary branch of the
    // twenty destinations, where the declared card does not exist. This
    // assertion is what would have caught it.
    expect(query).not.toContain("main:");

    expect(query).toContain(
      "... on Tree { entries { name type object { ... on Blob { text } } } }",
    );
  });
});

describe("parseWorkflowsTreeNode", () => {
  test("reads yaml workflow files, filtering out non-yaml entries and subdirectories", () => {
    const outcome = parseWorkflowsTreeNode({
      workflowsTree: {
        entries: [
          { name: "ci.yml", type: "blob", object: { text: "on: push\n" } },
          { name: "README.md", type: "blob", object: { text: "nope" } },
          { name: "reusable", type: "tree", object: null },
        ],
      },
    });
    expect(outcome.kind).toBe("found");
    expect(outcome.kind === "found" && outcome.files).toEqual([
      { name: "ci.yml", text: "on: push\n" },
    ]);
  });

  test("a structurally-present node with no tree is a real no-workflows-directory answer", () => {
    expect(parseWorkflowsTreeNode({ workflowsTree: null })).toEqual({
      kind: "no-workflows-directory",
    });
  });

  test("an absent repository node is unable-to-verify, never silently skipped", () => {
    const outcome = parseWorkflowsTreeNode(null);
    expect(outcome.kind).toBe("unable-to-verify");
  });
});

describe("parseWorkflowsTreeBatchResponse", () => {
  test("maps each repository to its own outcome by alias index", () => {
    const result = parseWorkflowsTreeBatchResponse(["libre-ai/governance", "libre-ai/gone"], {
      repo0: {
        workflowsTree: { entries: [{ name: "ci.yml", type: "blob", object: { text: "x" } }] },
      },
      repo1: null,
    });
    expect(result.get("libre-ai/governance")?.kind).toBe("found");
    expect(result.get("libre-ai/gone")?.kind).toBe("unable-to-verify");
  });
});

// `hasUsableGraphQLData` now lives in ecosystem/github-fleet.ts, asserted
// once for every gate: ecosystem/github-fleet.test.ts.
