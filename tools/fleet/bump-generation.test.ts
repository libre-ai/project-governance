import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAuthorityQuery,
  buildSourcesQuery,
  coherenceEnvironment,
  coherenceSpawner,
  commitArgs,
  commitMessage,
  EXEMPT_TRAILER,
  isCandidatePath,
  messageProblem,
  parseBumpData,
  parseOptions,
  parseSourcesResponse,
  ROOT_SURFACES,
  renderPlanTable,
  replayCoherence,
  runApply,
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

  test("the commit message ends with the fleet-bump declaration as its own paragraph", () => {
    const { body } = commitMessage(plan);
    const paragraphs: string[] = body.split("\n\n");
    expect(paragraphs[paragraphs.length - 1]).toBe(EXEMPT_TRAILER);
    expect(EXEMPT_TRAILER).toBe("Exempt: fleet-bump");
  });

  test("the plan table has one row per repository", () => {
    expect(renderPlanTable([plan])).toEqual([
      "| Repository | From | Files | Sites | Would change | Left | Verdict |",
      "| --- | --- | ---: | ---: | ---: | ---: | --- |",
      "| libre-ai/x | 7c2238d6 | 1 | 1 | 1 | 0 | bump |",
    ]);
  });
});

describe("the commit message the gate and signalement read", () => {
  const identity: { readonly name: string; readonly email: string } = parseBumpData(DATA).identity;
  const signOff: string = `Signed-off-by: ${identity.name} <${identity.email}>`;
  const message = (...paragraphs: string[]): string => `${paragraphs.join("\n\n")}\n`;

  test("a message with the declaration and the sign-off in one trailer block is accepted", () => {
    expect(
      messageProblem(message("title", "body", `${EXEMPT_TRAILER}\n${signOff}`), identity),
    ).toBe(null);
  });

  test("a missing declaration is refused", () => {
    expect(messageProblem(message("title", "body", signOff), identity)).toContain("Exempt");
  });

  test("a declaration in the free body, outside the trailer block, is refused", () => {
    expect(
      messageProblem(message("title", EXEMPT_TRAILER, "closing prose", signOff), identity),
    ).toContain("Exempt");
  });

  test("a sign-off that is not the last line is refused", () => {
    expect(
      messageProblem(message("title", `${EXEMPT_TRAILER}\n${signOff}\nCo-thing: x`), identity),
    ).toContain("sign-off");
  });

  test("a second, different declaration is refused", () => {
    expect(
      messageProblem(
        message("title", `${EXEMPT_TRAILER}\nExempt: docs-only\n${signOff}`),
        identity,
      ),
    ).toContain("Exempt");
  });

  test("a real git commit built from the same arguments passes the same check", () => {
    const directory: string = mkdtempSync(join(tmpdir(), "bump-commit-"));
    try {
      // Nothing inherited: a global or system config must not change what git writes.
      const environment: Record<string, string> = {
        PATH: process.env.PATH ?? "",
        HOME: directory,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      };
      const run = (argv: readonly string[]): string => {
        const result = Bun.spawnSync(["git", ...argv], { cwd: directory, env: environment });
        if (result.exitCode !== 0) {
          throw new Error(`git ${argv[0]} failed: ${result.stderr.toString()}`);
        }
        return result.stdout.toString();
      };
      run(["init", "--quiet"]);
      writeFileSync(join(directory, "ci.yml"), "uses: x\n");
      run(["add", "--", "ci.yml"]);
      const { title, body } = commitMessage({
        repository: "libre-ai/x",
        status: "bump",
        from: M,
        to: P,
        sites: [],
        edits: [{ path: "ci.yml", before: "", after: "", sites: 1 }],
        left: [],
        refusals: [],
        notes: [],
      });
      run([...commitArgs(identity, title, body)]);
      const written: string = run(["log", "-1", "--format=%B"]);
      expect(messageProblem(written, identity)).toBe(null);
      // The gate reads the trailer block through git, not through a pattern.
      const trailers: string[] = Bun.spawnSync(["git", "interpret-trailers", "--parse"], {
        cwd: directory,
        env: environment,
        stdin: new TextEncoder().encode(written),
      })
        .stdout.toString()
        .split("\n")
        .filter((line: string): boolean => line !== "");
      expect(trailers).toEqual([EXEMPT_TRAILER, signOff]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("generation coherence before apply", () => {
  const manifest = '{"schemaVersion":"libre-ai.ci-composition.v1"}';

  test("the guard is replayed on the manifest of the target generation, in a scratch root", () => {
    const seen: string[][] = [];
    const written: string[] = [];
    const verdict = replayCoherence(manifest, (argv) => {
      seen.push([...argv]);
      written.push(readFileSync(argv[argv.indexOf("--manifest") + 1] as string, "utf8"));
      return { code: 0, output: "Generation coherence verified — 16 target(s) declared" };
    });
    expect(verdict).toEqual({
      ok: true,
      detail: "Generation coherence verified — 16 target(s) declared",
    });
    expect(written).toEqual([manifest]);
    expect(seen[0]?.slice(0, 2)).toEqual(["python3", "-B"]);
    expect(seen[0]?.[2]).toEndWith(".github/composition/check-generation-coherence.py");
    expect(seen[0]?.[seen[0].indexOf("--root") + 1]).toEndWith("/root");
  });

  test("a red guard refuses, with its last lines as the reason", () => {
    const verdict = replayCoherence(manifest, () => ({
      code: 1,
      output:
        "Generation coherence: libre-ai/application-development-toolkit@9e817e73: packages/ui: prepublishOnly\nGeneration coherence failed — 16 target(s) declared",
    }));
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("application-development-toolkit@9e817e73");
  });

  test("a manifest that could not be read refuses and never starts the guard", () => {
    let started = false;
    const verdict = replayCoherence(null, () => {
      started = true;
      return { code: 0, output: "" };
    });
    expect(verdict.ok).toBe(false);
    expect(started).toBe(false);
  });

  test("the guard never receives the write token the bump holds", () => {
    const environment = coherenceEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/runner",
      GH_TOKEN: "secret",
      BUMP_TOKEN: "secret",
      FLEET_BUMP_TOKEN: "secret",
    });
    expect(environment).toEqual({ PATH: "/usr/bin", HOME: "/home/runner" });
  });

  test("the process that is actually spawned receives the scrubbed environment, not the caller's", () => {
    const seen: Record<string, string>[] = [];
    const spawn = coherenceSpawner(
      { PATH: "/usr/bin", HOME: "/h", GH_TOKEN: "secret", BUMP_TOKEN: "secret" },
      (_argv, options) => {
        seen.push({ ...options.env });
        return { exitCode: 0, stdout: new TextEncoder().encode("out"), stderr: new Uint8Array() };
      },
    );
    expect(spawn(["python3", "guard.py"])).toEqual({ code: 0, output: "out\n" });
    expect(seen).toEqual([{ PATH: "/usr/bin", HOME: "/h" }]);
  });
});

describe("apply decision", () => {
  const opened: string[] = [];
  const open = async (plan: string) => {
    opened.push(plan);
    return { repository: plan, ok: true, detail: "opened" };
  };

  test("a red guard opens no consumer pull request and fails", async () => {
    opened.length = 0;
    const lines: string[] = [];
    const failed = await runApply({
      target: P,
      coherence: { ok: false, detail: "application-development-toolkit@9e817e73" },
      plans: ["libre-ai/a", "libre-ai/b"],
      say: (line) => lines.push(line),
      open,
    });
    expect(failed).toBe(true);
    expect(opened).toEqual([]);
    expect(lines.join("\n")).toContain("apply refused");
    expect(lines.join("\n")).toContain("application-development-toolkit@9e817e73");
  });

  test("a green guard opens every pull request, and a failed one fails the run", async () => {
    opened.length = 0;
    const lines: string[] = [];
    const failed = await runApply({
      target: P,
      coherence: { ok: true, detail: "verified" },
      plans: ["libre-ai/a", "libre-ai/b"],
      say: (line) => lines.push(line),
      open: async (plan) => {
        opened.push(plan);
        return { repository: plan, ok: plan !== "libre-ai/b", detail: "x" };
      },
    });
    expect(opened).toEqual(["libre-ai/a", "libre-ai/b"]);
    expect(failed).toBe(true);
    expect(lines).toContain("- apply libre-ai/b: FAILED — x");
  });
});
