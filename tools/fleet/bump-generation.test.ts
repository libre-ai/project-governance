import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAuthorityQuery,
  buildSourcesQuery,
  commitMessage,
  isCandidatePath,
  parseBumpData,
  parseOptions,
  parseSourcesResponse,
  ROOT_SURFACES,
  renderPlanTable,
  selectTargets,
} from "./bump-generation";
import type { RepositoryPlan } from "./bump-plan";

const M = "7c2238d6185e59d446586688ca7db32e6a17d3e0";
const P = "1c8b37c80beb41f640982768ec27304a911e0b8e";
const DATA = readFileSync(join(import.meta.dir, "bump-generation.v1.yaml"), "utf8");

describe("bump-generation.v1.yaml", () => {
  test("the committed data parses, with the historical ADT site", () => {
    const data = parseBumpData(DATA);
    expect(data.tokenSecret).toBe("FLEET_BUMP_TOKEN");
    expect(data.identity.email).toEndWith("@users.noreply.github.com");
    expect(data.historical.map((entry) => entry.sha.slice(0, 8))).toEqual(["8a27b8f5"]);
  });

  test("a historical site that is not a full sha is refused", () => {
    expect(() => parseBumpData(DATA.replace(/sha: [0-9a-f]{40}/, "sha: 8a27b8f5"))).toThrow(
      "historical_sites[0].sha is not a full sha",
    );
  });

  test("a wrong schema version is refused", () => {
    expect(() => parseBumpData(DATA.replace("libre-ai.fleet-bump.v1", "x"))).toThrow(
      "schema_version",
    );
  });
});

describe("options", () => {
  test("dry run is the default", () => {
    expect(parseOptions([])).toEqual({
      apply: false,
      to: null,
      publicOnly: false,
      only: null,
      summary: null,
    });
  });

  test("a target that is not a full sha is refused", () => {
    expect(() => parseOptions(["--to", "1c8b37c8"])).toThrow("not a 40-character sha");
  });

  test("an unknown argument is refused, never ignored", () => {
    expect(() => parseOptions(["--aply"])).toThrow("unknown argument --aply");
  });

  test("--only splits on commas", () => {
    expect(parseOptions(["--only", "libre-ai/a,libre-ai/b", "--to", P]).only).toEqual([
      "libre-ai/a",
      "libre-ai/b",
    ]);
  });
});

describe("target selection", () => {
  const inventory = [
    { repository: "libre-ai/project-governance", visibility: "public", lifecycle: "active" },
    { repository: "libre-ai/old", visibility: "public", lifecycle: "archived" },
    { repository: "libre-ai/product-research", visibility: "private", lifecycle: "active" },
    {
      repository: "libre-ai/signalement",
      visibility: "public",
      lifecycle: "active",
      card: "x.project.v1.yaml",
    },
  ] as const;

  test("the authority and archived repositories are not targets", () => {
    const { targets, excluded } = selectTargets(inventory, { publicOnly: false, only: null });
    expect(targets.map((t) => t.repository)).toEqual([
      "libre-ai/product-research",
      "libre-ai/signalement",
    ]);
    expect(excluded).toEqual([]);
    expect(targets[1]).toEqual({
      repository: "libre-ai/signalement",
      card: "x.project.v1.yaml",
      cardDeclared: true,
    });
  });

  test("--public-only names each private repository it leaves out", () => {
    const { targets, excluded } = selectTargets(inventory, { publicOnly: true, only: null });
    expect(targets.map((t) => t.repository)).toEqual(["libre-ai/signalement"]);
    expect(excluded.map((e) => e.repository)).toEqual(["libre-ai/product-research"]);
  });
});

describe("GraphQL reads", () => {
  const targets = [
    { repository: "libre-ai/signalement", card: "project.v1.yaml", cardDeclared: false },
  ];

  test("every expression reads the served branch through HEAD, never a branch name", () => {
    const query = buildSourcesQuery(targets);
    const expressions = [...query.matchAll(/expression: "([^"]+)"/g)].map((m) => m[1] as string);
    expect(expressions.length).toBe(ROOT_SURFACES.length + 2);
    for (const expression of expressions) expect(expression).toStartWith("HEAD:");
  });

  test("the authority query reads generations by sha only", () => {
    const query = buildAuthorityQuery(P, [M, P], ["docs/x.md"]);
    expect(query).toContain(`"${M}:.github/composition/manifest.json"`);
    expect(query).toContain(`"${P}:docs/x.md"`);
    expect(() => buildAuthorityQuery("HEAD", [M], [])).toThrow("full commit sha");
  });

  test("an unresolved repository is unreadable, never an empty snapshot", () => {
    const [outcome] = parseSourcesResponse(targets, { repo0: null });
    expect(outcome).toEqual({
      repository: "libre-ai/signalement",
      error: "repository not resolvable via GraphQL",
    });
  });

  test("a missing response is unreadable for every target", () => {
    const [outcome] = parseSourcesResponse(targets, undefined);
    expect("error" in (outcome as object)).toBe(true);
  });

  test("a declared card with nothing readable is unreadable", () => {
    const declared = [{ ...targets[0], cardDeclared: true }] as typeof targets;
    const [outcome] = parseSourcesResponse(declared, { repo0: { workflows: null } });
    expect(outcome).toEqual({
      repository: "libre-ai/signalement",
      error: "no workflow, card or root surface could be read on the served branch",
    });
  });

  test("workflows and root files land at their repository paths", () => {
    const [outcome] = parseSourcesResponse(targets, {
      repo0: {
        workflows: {
          entries: [
            { name: "ci.yml", type: "blob", object: { text: "a" } },
            { name: "notes.txt", type: "blob", object: { text: "b" } },
            { name: "nested", type: "tree", object: null },
          ],
        },
        f0: { text: "card" },
        f1: null,
      },
    });
    if (outcome === undefined || "error" in outcome) throw new Error("expected a snapshot");
    expect([...outcome.files.entries()]).toEqual([
      [".github/workflows/ci.yml", "a"],
      ["project.v1.yaml", "card"],
    ]);
  });
});

describe("apply helpers", () => {
  test("clone candidates are the pin-bearing files only", () => {
    expect(isCandidatePath(".github/workflows/ci.yml", "project.v1.yaml")).toBe(true);
    expect(isCandidatePath("packages/a/package.json", "project.v1.yaml")).toBe(true);
    expect(isCandidatePath("toolchains/github-actions.json", "project.v1.yaml")).toBe(true);
    expect(isCandidatePath("src/main.ts", "project.v1.yaml")).toBe(false);
    expect(isCandidatePath(".github/workflows/sub/x.yml", "project.v1.yaml")).toBe(false);
  });

  const plan: RepositoryPlan = {
    repository: "libre-ai/x",
    status: "bump",
    from: M,
    to: P,
    sites: [{ path: ".github/workflows/ci.yml", line: 1, form: "uses", ref: M }],
    edits: [{ path: ".github/workflows/ci.yml", before: "", after: "", sites: 1 }],
    left: [],
    refusals: [],
    notes: [],
  };

  test("the commit message names both generations and carries no sign-off of its own", () => {
    const { title, body } = commitMessage(plan);
    expect(title).toBe("chore(pins): move governance pins to generation 1c8b37c8");
    expect(body).toContain(`7c2238d6 to ${P}`);
    expect(body).not.toContain("Signed-off-by");
  });

  test("the plan table has one row per repository", () => {
    expect(renderPlanTable([plan])).toEqual([
      "| Repository | From | Files | Sites | Would change | Left | Verdict |",
      "| --- | --- | ---: | ---: | ---: | ---: | --- |",
      "| libre-ai/x | 7c2238d6 | 1 | 1 | 1 | 0 | bump |",
    ]);
  });
});
