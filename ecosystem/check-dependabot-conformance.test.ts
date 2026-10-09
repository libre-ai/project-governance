import { describe, expect, test } from "bun:test";
import type { RepoDependabotState } from "./check-dependabot-conformance";
import {
  attachEcosystemScans,
  buildBatchQuery,
  fetchPublicFleetDependabot,
  findEcosystemManifests,
  firstDifference,
  loadTemplates,
  parseBatchResponse,
  parseTreeResponse,
  reviewDependabot,
  scanTree,
  selectVariant,
  splitTemplate,
  summarizeVolume,
  TEMPLATE_VARIANTS,
} from "./check-dependabot-conformance";

const templates = await loadTemplates();
const driftedFixture = await Bun.file(
  new URL("fixtures/dependabot/drifted.yml", import.meta.url),
).text();
const graphqlFixture = JSON.parse(
  await Bun.file(new URL("fixtures/dependabot/graphql-response.json", import.meta.url)).text(),
) as { readonly data: Record<string, unknown> };

const active = (repository: string) => ({
  repository,
  role: "satellite",
  layer: "couche-4",
  lifecycle: "active",
});

describe("template variants (distribution/templates/dependabot)", () => {
  test("exactly two variants are published and non-empty", () => {
    expect([...TEMPLATE_VARIANTS]).toEqual(["github-actions", "cargo"]);
    for (const variant of TEMPLATE_VARIANTS) {
      expect(templates[variant].length).toBeGreaterThan(0);
      expect(templates[variant].endsWith("\n")).toBe(true);
    }
  });

  test("the template directory holds nothing but the published variants", async () => {
    const directory = new URL("../distribution/templates/dependabot/", import.meta.url);
    const files = (
      await Array.fromAsync(new Bun.Glob("*").scan({ cwd: Bun.fileURLToPath(directory) }))
    ).sort();
    expect(files).toEqual(TEMPLATE_VARIANTS.map((variant) => `${variant}.yml`).sort());
  });

  test("every variant declares exactly the ecosystems its name promises, in order", () => {
    expect(splitTemplate(templates["github-actions"]).ecosystems).toEqual(["github-actions"]);
    expect(splitTemplate(templates.cargo).ecosystems).toEqual(["github-actions", "cargo"]);
  });

  // Owner decision 2026-09-08: the bun ecosystem is suspended, not forgotten.
  // Dependabot's updater reads bun.lock lockfileVersion 1 only and every
  // fleet lockfile is version 2 (bun 1.4), so a `bun` entry is a job that
  // fails on every run and opens no pull request — a guard that cannot prove
  // it ran. Reintroducing it is an owner decision, taken when
  // dependabot-core#16026 closes; this test is the lock on the door.
  test("no variant declares the bun ecosystem (suspended 2026-09-08, dependabot-core#16026)", () => {
    for (const variant of TEMPLATE_VARIANTS) {
      expect(templates[variant]).not.toContain("package-ecosystem: bun");
      expect(splitTemplate(templates[variant]).ecosystems).not.toContain("bun");
    }
  });

  test("the header is byte-identical across variants", () => {
    const headers = new Set(TEMPLATE_VARIANTS.map((v) => splitTemplate(templates[v]).header));
    expect(headers.size).toBe(1);
  });

  test("an ecosystem block is byte-identical wherever it appears", () => {
    const blocksByEcosystem = new Map<string, Set<string>>();
    for (const variant of TEMPLATE_VARIANTS) {
      for (const [ecosystem, block] of splitTemplate(templates[variant]).blocks) {
        const set = blocksByEcosystem.get(ecosystem) ?? new Set<string>();
        set.add(block);
        blocksByEcosystem.set(ecosystem, set);
      }
    }
    for (const [ecosystem, blocks] of blocksByEcosystem) {
      expect(`${ecosystem}: ${blocks.size} distinct block(s)`).toBe(
        `${ecosystem}: 1 distinct block(s)`,
      );
    }
  });

  test("the header names the release-age guard and the DCO generation", () => {
    const { header } = splitTemplate(templates.cargo);
    expect(header).toContain("minimumReleaseAge");
    expect(header).toContain("259200");
    expect(header).toContain("767ee84a");
  });

  test("the header states why bun is absent, the return condition and the real bun net", () => {
    const { header } = splitTemplate(templates["github-actions"]);
    // The exact Dependabot error, so the next reader does not have to find the run.
    expect(header).toContain("Dependabot::DependencyFileNotSupported");
    expect(header).toContain("Unsupported bun.lock 'lockfileVersion' 2");
    expect(header).toContain("2026-09-08");
    expect(header).toContain("https://github.com/dependabot/dependabot-core/issues/16026");
    expect(header).toContain("lockfileVersion 2");
    // What actually watches bun dependencies while Dependabot cannot.
    expect(header).toContain("Fleet advisories");
    expect(header).toContain("bun audit");
  });

  test("every block carries the fleet conventions", () => {
    for (const [, block] of splitTemplate(templates.cargo).blocks) {
      expect(block).toContain('directory: "/"');
      expect(block).toContain("interval: weekly");
      expect(block).toContain("open-pull-requests-limit:");
      expect(block).toContain('prefix: "chore(deps)"');
      expect(block).toContain("default-days: 3");
      expect(block).toContain("groups:");
    }
  });

  test("the authority itself carries the variant its manifest set selects, byte-exact", async () => {
    // It carries `cargo` since ADR-0041 absorbed the projection engine as a
    // workspace member: a root Cargo.toml is exactly what selectVariant reads,
    // and the cargo variant is what makes the engine's 181 locked crates
    // watchable. Asserting `github-actions` here would have frozen the gate on
    // the shape the repository had before it held a crate.
    const own = await Bun.file(new URL("../.github/dependabot.yml", import.meta.url)).text();
    const root = await Bun.file(new URL("../Cargo.toml", import.meta.url)).exists();
    expect(selectVariant({ workflows: true, cargoToml: root })).toBe("cargo");
    expect(firstDifference(templates.cargo, own)).toBeNull();
  });

  test("every variant parses as a version-2 Dependabot configuration", () => {
    for (const variant of TEMPLATE_VARIANTS) {
      const parsed = Bun.YAML.parse(templates[variant]) as {
        readonly version: number;
        readonly updates: readonly { readonly "package-ecosystem": string }[];
      };
      expect(parsed.version).toBe(2);
      expect(parsed.updates.length).toBeGreaterThan(0);
    }
  });
});

describe("selectVariant", () => {
  test("maps the manifest set to a variant on Cargo.toml alone", () => {
    expect(selectVariant({ workflows: true, cargoToml: false })).toBe("github-actions");
    expect(selectVariant({ workflows: true, cargoToml: true })).toBe("cargo");
  });

  test("returns null when no variant is published for the manifest set", () => {
    expect(selectVariant({ workflows: false, cargoToml: true })).toBeNull();
    expect(selectVariant({ workflows: false, cargoToml: false })).toBeNull();
  });
});

describe("firstDifference", () => {
  test("null for identical texts", () => {
    expect(firstDifference("a\nb\n", "a\nb\n")).toBeNull();
  });

  test("names the first differing line, 1-based", () => {
    expect(firstDifference("a\nb\nc\n", "a\nB\nc\n")).toEqual({
      line: 2,
      expected: "b",
      actual: "B",
    });
  });

  test("a missing trailing newline is a difference", () => {
    expect(firstDifference("a\n", "a")).toEqual({ line: 2, expected: "", actual: "<end of file>" });
  });

  test("extra trailing content is a difference", () => {
    // The segment after the expected text's final newline is empty, not
    // absent: line 2 exists on both sides and differs.
    expect(firstDifference("a\n", "a\nb\n")).toEqual({ line: 2, expected: "", actual: "b" });
  });
});

describe("reviewDependabot", () => {
  test("exempts a private repository before inspecting fetched state", () => {
    const outcome = reviewDependabot(
      { ...active("libre-ai/product-research"), visibility: "private" },
      {
        config: { text: null, error: "must not be observed" },
        manifests: null,
        fetchError: "must not be observed",
        ecosystemScan: null,
      },
      templates,
    );
    expect(outcome).toEqual({
      failures: [],
      notes: [
        "private repository — content gates run in-repository; no cross-repository read token granted",
      ],
      exempt: true,
    });
  });

  test("archived entries are exempt, asserted rather than skipped", () => {
    const outcome = reviewDependabot(
      { ...active("libre-ai/libre-ai"), lifecycle: "archived" },
      {
        config: { text: null, error: null },
        manifests: null,
        fetchError: null,
        ecosystemScan: null,
      },
      templates,
    );
    expect(outcome.failures).toEqual([]);
    expect(outcome.exempt).toBe(true);
    expect(outcome.notes[0]).toContain("archived");
  });

  test("a byte-exact copy of the selected variant conforms", () => {
    const outcome = reviewDependabot(
      active("libre-ai/sdk-ts"),
      {
        config: { text: templates["github-actions"], error: null },
        manifests: { workflows: true, cargoToml: false },
        fetchError: null,
        ecosystemScan: null,
      },
      templates,
    );
    expect(outcome.failures).toEqual([]);
    expect(outcome.notes).toEqual(["byte-exact copy of the github-actions variant"]);
  });

  test("a confirmed absence is reported as missing, naming the expected variant", () => {
    const outcome = reviewDependabot(
      active("libre-ai/db-inspect"),
      {
        config: { text: null, error: null },
        manifests: { workflows: true, cargoToml: true },
        fetchError: null,
        ecosystemScan: null,
      },
      templates,
    );
    expect(outcome.failures).toEqual([
      ".github/dependabot.yml is missing on the default branch — expected the cargo variant (distribution/templates/dependabot/cargo.yml)",
    ]);
  });

  test("a drifted copy names the variant and the first differing line", () => {
    const outcome = reviewDependabot(
      active("libre-ai/notebook"),
      {
        config: { text: driftedFixture, error: null },
        manifests: { workflows: true, cargoToml: true },
        fetchError: null,
        ecosystemScan: null,
      },
      templates,
    );
    expect(outcome.failures.length).toBe(1);
    expect(outcome.failures[0]).toContain("differs from the cargo variant");
    expect(outcome.failures[0]).toContain("first difference at line 1");
  });

  test("a wrong variant is a drift, not a pass", () => {
    const outcome = reviewDependabot(
      active("libre-ai/harness"),
      {
        config: { text: templates["github-actions"], error: null },
        manifests: { workflows: true, cargoToml: true },
        fetchError: null,
        ecosystemScan: null,
      },
      templates,
    );
    expect(outcome.failures.length).toBe(1);
    expect(outcome.failures[0]).toContain("differs from the cargo variant");
  });

  test("a copy of the withdrawn bun variant is a drift against github-actions", async () => {
    // What every repository converged on during the 2026-09-07 wave: the
    // former bun variant. Its first difference is in the header, so the
    // report already points the next wave at the template change.
    const withdrawn = await Bun.file(
      new URL("fixtures/dependabot/withdrawn-bun-variant.yml", import.meta.url),
    ).text();
    const outcome = reviewDependabot(
      active("libre-ai/sdk-ts"),
      {
        config: { text: withdrawn, error: null },
        manifests: { workflows: true, cargoToml: false },
        fetchError: null,
        ecosystemScan: null,
      },
      templates,
    );
    expect(outcome.failures.length).toBe(1);
    expect(outcome.failures[0]).toContain("differs from the github-actions variant");
  });

  test("an unreachable repository is unable-to-verify, never missing", () => {
    const outcome = reviewDependabot(
      active("libre-ai/auth"),
      {
        config: { text: null, error: "rate limited" },
        manifests: null,
        fetchError: "rate limited",
        ecosystemScan: null,
      },
      templates,
    );
    expect(outcome.failures).toEqual([
      "unable to verify .github/dependabot.yml on the default branch: rate limited",
    ]);
  });

  test("a manifest set with no published variant fails loudly", () => {
    const outcome = reviewDependabot(
      active("libre-ai/odd"),
      {
        config: { text: null, error: null },
        manifests: { workflows: false, cargoToml: true },
        fetchError: null,
        ecosystemScan: scanTree(["Cargo.toml"]),
      },
      templates,
    );
    expect(outcome.failures.length).toBe(1);
    expect(outcome.failures[0]).toContain("no template variant published for manifest set");
  });
});

test("dependabot transport never receives a private repository target", async () => {
  const received: string[][] = [];
  await fetchPublicFleetDependabot(
    [
      { ...active("libre-ai/public"), visibility: "public" },
      { ...active("libre-ai/product-research"), visibility: "private" },
    ],
    async (repositories) => {
      received.push([...repositories]);
      return new Map();
    },
  );
  expect(received).toEqual([["libre-ai/public"]]);
});

describe("GraphQL fleet batch", () => {
  const repositories = [
    "libre-ai/sdk-ts",
    "libre-ai/db-inspect",
    "libre-ai/notebook",
    "libre-ai/gone",
  ];

  test("buildBatchQuery aliases by index and asks for the config and the two manifests", () => {
    const query = buildBatchQuery(repositories);
    expect(query).toContain('repo0: repository(owner: "libre-ai", name: "sdk-ts")');
    expect(query).toContain('repo3: repository(owner: "libre-ai", name: "gone")');
    expect(query).toContain('config: object(expression: "HEAD:.github/dependabot.yml")');
    // The default branch, never a literal `main`: the consolidated
    // destinations serve `migrate/recover-code`, whose documentary ancestor
    // carries neither workflows nor a Cargo manifest.
    expect(query).not.toContain('expression: "main:');
    expect(query).toContain('cargoToml: object(expression: "HEAD:Cargo.toml")');
    expect(query).toContain('workflows: object(expression: "HEAD:.github/workflows")');
    // package.json no longer selects anything: asking for it would be a
    // field the gate reads and ignores.
    expect(query).not.toContain("package.json");
  });

  test("buildBatchQuery rejects a malformed repository entry", () => {
    expect(() => buildBatchQuery(["no-slash"])).toThrow(/malformed repository entry/);
  });

  test("parseBatchResponse maps the fixture into per-repository states", () => {
    const data = JSON.parse(
      JSON.stringify(graphqlFixture.data)
        .replace(
          "<TEMPLATE:github-actions>",
          JSON.stringify(templates["github-actions"]).slice(1, -1),
        )
        .replace("<FIXTURE:drifted>", JSON.stringify(driftedFixture).slice(1, -1)),
    ) as Record<string, unknown>;
    const states = parseBatchResponse(repositories, data);

    expect(states.get("libre-ai/sdk-ts")).toEqual({
      config: { text: templates["github-actions"], error: null },
      manifests: { workflows: true, cargoToml: false },
      fetchError: null,
      ecosystemScan: null,
    });
    expect(states.get("libre-ai/db-inspect")).toEqual({
      config: { text: null, error: null },
      manifests: { workflows: true, cargoToml: true },
      fetchError: null,
      ecosystemScan: null,
    });
    expect(states.get("libre-ai/notebook")?.config.text).toBe(driftedFixture);
    const gone = states.get("libre-ai/gone");
    expect(gone?.manifests).toBeNull();
    expect(gone?.fetchError).toContain("not resolvable via GraphQL");
    expect(gone?.config.error).toContain("not resolvable via GraphQL");
  });

  test("parseBatchResponse with no data marks every repository unable-to-verify", () => {
    const states = parseBatchResponse(repositories, undefined);
    for (const repository of repositories) {
      expect(states.get(repository)?.fetchError).not.toBeNull();
    }
  });
});

describe("findEcosystemManifests", () => {
  test("names every manifest Dependabot could watch, anywhere in the tree", () => {
    expect(
      findEcosystemManifests([
        "README.md",
        ".github/workflows/ci.yml",
        "crates/core/Cargo.toml",
        "apps/web/package.json",
        "apps/web/bun.lock",
        "tools/licensing/requirements.txt",
        "pyproject.toml",
        "deploy/Dockerfile",
        "actions/setup/action.yml",
        ".gitmodules",
        "go.mod",
      ]),
    ).toEqual([
      { path: ".github/workflows/ci.yml", ecosystem: "github-actions" },
      { path: "crates/core/Cargo.toml", ecosystem: "cargo" },
      { path: "apps/web/package.json", ecosystem: "npm/bun" },
      { path: "apps/web/bun.lock", ecosystem: "npm/bun" },
      { path: "tools/licensing/requirements.txt", ecosystem: "pip/uv" },
      { path: "pyproject.toml", ecosystem: "pip/uv" },
      { path: "deploy/Dockerfile", ecosystem: "docker" },
      { path: "actions/setup/action.yml", ecosystem: "github-actions" },
      { path: ".gitmodules", ecosystem: "gitsubmodule" },
      { path: "go.mod", ecosystem: "gomod" },
    ]);
  });

  test("the measured tree of libre-ai/.github (main, 2026-10-08) holds no manifest", () => {
    expect(
      findEcosystemManifests([
        "CONTRIBUTING.md",
        "LICENSES/CC-BY-4.0.txt",
        "SECURITY.md",
        "docs/portfolio-material.json",
        "llms.txt",
        "profile/README.fr.md",
        "profile/README.md",
      ]),
    ).toEqual([]);
  });

  test("a workflow directory entry that is not YAML is not a workflow", () => {
    expect(findEcosystemManifests([".github/workflows/README.md"])).toEqual([]);
  });

  test("every ecosystem present in the fleet on 2026-10-08 is detected", () => {
    // The manifest kinds the 22 public trees actually carried when this gate
    // learned the empty case. If one of them stopped being detected, a
    // repository carrying only that kind would read as "nothing to watch".
    for (const path of [
      ".github/workflows/ci.yml",
      "Cargo.toml",
      "package.json",
      "bun.lock",
      "tools/licensing/requirements.txt",
    ]) {
      expect(`${path}: ${findEcosystemManifests([path]).length}`).toBe(`${path}: 1`);
    }
  });
});

describe("reviewDependabot — repositories with no workflow and no Cargo.toml", () => {
  const empty = { workflows: false, cargoToml: false };
  const dotGithubTree = [
    "CONTRIBUTING.md",
    "LICENSES/CC-BY-4.0.txt",
    "SECURITY.md",
    "docs/portfolio-material.json",
    "llms.txt",
    "profile/README.fr.md",
    "profile/README.md",
  ];

  test("libre-ai/.github as measured: no ecosystem to watch is a counted success", () => {
    const outcome = reviewDependabot(
      active("libre-ai/.github"),
      {
        config: { text: null, error: null },
        manifests: empty,
        fetchError: null,
        ecosystemScan: scanTree(dotGithubTree),
      },
      templates,
    );
    expect(outcome).toEqual({
      failures: [],
      notes: [
        "no ecosystem to watch — 7 file(s) scanned at the default branch, none is a manifest Dependabot can watch",
      ],
      exempt: false,
    });
  });

  test("a manifest the variants do not cover stays red and names it", () => {
    const outcome = reviewDependabot(
      active("libre-ai/odd"),
      {
        config: { text: null, error: null },
        manifests: empty,
        fetchError: null,
        ecosystemScan: scanTree(["README.md", "package.json", "bun.lock"]),
      },
      templates,
    );
    expect(outcome.failures.length).toBe(1);
    expect(outcome.failures[0]).toContain("no template variant published for manifest set");
    expect(outcome.failures[0]).toContain("package.json (npm/bun)");
    expect(outcome.failures[0]).toContain("bun.lock (npm/bun)");
  });

  test("a nested Cargo.toml without workflows stays red", () => {
    const outcome = reviewDependabot(
      active("libre-ai/odd"),
      {
        config: { text: null, error: null },
        manifests: empty,
        fetchError: null,
        ecosystemScan: scanTree(["crates/core/Cargo.toml"]),
      },
      templates,
    );
    expect(outcome.failures[0]).toContain("crates/core/Cargo.toml (cargo)");
  });

  test("a configuration on a repository with nothing to watch is a failure", () => {
    const outcome = reviewDependabot(
      active("libre-ai/.github"),
      {
        config: { text: templates["github-actions"], error: null },
        manifests: empty,
        fetchError: null,
        ecosystemScan: scanTree(dotGithubTree),
      },
      templates,
    );
    expect(outcome.failures).toEqual([
      ".github/dependabot.yml is present but the repository has no ecosystem to watch — every `updates` entry would be a job error; remove the file",
    ]);
  });

  test("an unreadable tree is unable-to-verify, never nothing-to-watch", () => {
    const outcome = reviewDependabot(
      active("libre-ai/.github"),
      {
        config: { text: null, error: null },
        manifests: empty,
        fetchError: null,
        ecosystemScan: { kind: "unreadable", reason: "rate limited" },
      },
      templates,
    );
    expect(outcome.failures).toEqual([
      "unable to prove the repository has no ecosystem to watch: rate limited",
    ]);
  });

  test("a missing scan is a failure, never nothing-to-watch", () => {
    const outcome = reviewDependabot(
      active("libre-ai/.github"),
      {
        config: { text: null, error: null },
        manifests: empty,
        fetchError: null,
        ecosystemScan: null,
      },
      templates,
    );
    expect(outcome.failures.length).toBe(1);
    expect(outcome.failures[0]).toContain("no tree scan recorded");
  });
});

describe("parseTreeResponse", () => {
  test("keeps blob paths and counts them", () => {
    const scan = parseTreeResponse(
      JSON.stringify({
        truncated: false,
        tree: [
          { path: "profile", type: "tree" },
          { path: "profile/README.md", type: "blob" },
          { path: "llms.txt", type: "blob" },
        ],
      }),
    );
    expect(scan).toEqual({ kind: "scanned", files: 2, manifests: [] });
  });

  test("a truncated tree cannot prove emptiness", () => {
    const scan = parseTreeResponse(JSON.stringify({ truncated: true, tree: [] }));
    expect(scan.kind).toBe("unreadable");
  });

  test("an unparseable response is unreadable", () => {
    expect(parseTreeResponse("not json").kind).toBe("unreadable");
  });
});

describe("summarizeVolume", () => {
  test("states how many repositories were graded, empty, exempt", () => {
    expect(summarizeVolume({ graded: 20, nothingToWatch: 1, exempt: 2, failed: 1 })).toBe(
      "24 inventory entries examined: 20 graded against a variant, 1 with no ecosystem to watch, 2 exempt, 1 failing",
    );
  });
});

test("attachEcosystemScans scans only reachable repositories that select no variant", async () => {
  const base = { config: { text: null, error: null }, fetchError: null, ecosystemScan: null };
  const states = new Map<string, RepoDependabotState>([
    ["libre-ai/graded", { ...base, manifests: { workflows: true, cargoToml: false } }],
    ["libre-ai/.github", { ...base, manifests: { workflows: false, cargoToml: false } }],
    ["libre-ai/gone", { ...base, manifests: null, fetchError: "unreachable" }],
  ]);
  const scanned: string[] = [];
  await attachEcosystemScans(states, async (repository) => {
    scanned.push(repository);
    return scanTree(["README.md"]);
  });
  expect(scanned).toEqual(["libre-ai/.github"]);
  expect(states.get("libre-ai/.github")?.ecosystemScan).toEqual({
    kind: "scanned",
    files: 1,
    manifests: [],
  });
  expect(states.get("libre-ai/graded")?.ecosystemScan).toBeNull();
  expect(states.get("libre-ai/gone")?.ecosystemScan).toBeNull();
});
