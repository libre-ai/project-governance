import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex } from "./build-index";
import {
  buildOrgRepositoriesQuery,
  type DeclaredRepository,
  fetchLiveRepositories,
  type LiveRepository,
  parseOrgRepositoriesPage,
  readOrgRepositoriesResponse,
  reconcileInventory,
} from "./check-inventory-drift";

// The reconciliation is fail-closed in both directions except one deliberate
// case: a declared-private repository invisible to the token is consistent
// (the default CI token cannot list private repositories), so it must produce
// a note, never a drift — otherwise every public CI run would false-positive.

const declared = (...entries: [string, DeclaredRepository["visibility"]][]): DeclaredRepository[] =>
  entries.map(([name, visibility]) => ({ name, visibility, lifecycle: "active" }));

const live = (...entries: [string, boolean][]): LiveRepository[] =>
  entries.map(([name, isPrivate]) => ({ name, isPrivate, isArchived: false }));

const declaredWithLifecycle = (
  ...entries: [string, DeclaredRepository["visibility"], DeclaredRepository["lifecycle"]][]
): DeclaredRepository[] =>
  entries.map(([name, visibility, lifecycle]) => ({ name, visibility, lifecycle }));

const liveWithArchive = (...entries: [string, boolean, boolean][]): LiveRepository[] =>
  entries.map(([name, isPrivate, isArchived]) => ({ name, isPrivate, isArchived }));

describe("reconcileInventory", () => {
  test("a matching inventory produces no drift", () => {
    const result = reconcileInventory(
      declared(["hub", "public"], ["tool", "public"]),
      live(["hub", false], ["tool", false]),
    );
    expect(result.drifts).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  test("an observable repository absent from the inventory is drift", () => {
    const result = reconcileInventory(
      declared(["hub", "public"]),
      live(["hub", false], ["rogue", false]),
    );
    expect(result.drifts).toEqual([
      "DRIFT: repository 'rogue' is observable on GitHub but absent from the inventory",
    ]);
  });

  test("a declared public repository that is not observable is drift", () => {
    const result = reconcileInventory(
      declared(["hub", "public"], ["ghost", "public"]),
      live(["hub", false]),
    );
    expect(result.drifts).toEqual([
      "DRIFT: inventory declares 'ghost' public but it is not observable (deleted, renamed, or made private)",
    ]);
  });

  test("a visibility mismatch is drift in both directions", () => {
    const leaked = reconcileInventory(declared(["secret", "private"]), live(["secret", false]));
    expect(leaked.drifts).toEqual([
      "DRIFT: repository 'secret' declared private but observable as public",
    ]);
    const hidden = reconcileInventory(declared(["hub", "public"]), live(["hub", true]));
    expect(hidden.drifts).toEqual([
      "DRIFT: repository 'hub' declared public but observable as private",
    ]);
  });

  test("a declared private repository invisible to the token is a note, not drift", () => {
    const result = reconcileInventory(
      declared(["hub", "public"], ["secret", "private"]),
      live(["hub", false]),
    );
    expect(result.drifts).toEqual([]);
    expect(result.notes).toEqual([
      "NOTE: 'secret' declared private and not observable with this token — presence, visibility and archived state unverifiable here (token scope); an owner-scoped GH_TOKEN reconciles it",
    ]);
    expect(result.partition.unverifiable).toEqual(["secret"]);
  });

  test("a renamed repository surfaces as drift on both names", () => {
    const result = reconcileInventory(declared(["old-name", "public"]), live(["new-name", false]));
    expect(result.drifts).toEqual([
      "DRIFT: repository 'new-name' is observable on GitHub but absent from the inventory",
      "DRIFT: inventory declares 'old-name' public but it is not observable (deleted, renamed, or made private)",
    ]);
  });
});

// ADR-0042 §7, act 3: lifecycle is compared with GitHub's archived state in
// both directions, each declared-archived entry yields exactly one assertion,
// and an archived claim that cannot be read is a drift, never a zero.
describe("reconcileInventory — lifecycle against the archived state", () => {
  test("declared archived and observable as archived: one holding assertion, no drift", () => {
    const result = reconcileInventory(
      declaredWithLifecycle(["hub", "public", "archived"], ["tool", "public", "active"]),
      liveWithArchive(["hub", false, true], ["tool", false, false]),
    );
    expect(result.drifts).toEqual([]);
    expect(result.archived).toEqual([
      { name: "hub", holds: true, evidence: "declared archived and observable as archived" },
    ]);
  });

  test("declared archived but observable as active is drift and a failing assertion", () => {
    const result = reconcileInventory(
      declaredWithLifecycle(["old", "public", "archived"]),
      liveWithArchive(["old", false, false]),
    );
    expect(result.drifts).toEqual(["DRIFT: 'old' declared archived but observable as active"]);
    expect(result.archived).toEqual([
      {
        name: "old",
        holds: false,
        evidence: "DRIFT: 'old' declared archived but observable as active",
      },
    ]);
  });

  test("archived on GitHub but declared active is drift", () => {
    const result = reconcileInventory(
      declaredWithLifecycle(["tool", "public", "active"]),
      liveWithArchive(["tool", false, true]),
    );
    expect(result.drifts).toEqual(["DRIFT: 'tool' is archived on GitHub but declared active"]);
    expect(result.archived).toEqual([]);
  });

  // The state below — a private repository declared archived — cannot be
  // loaded today: build-index.ts admits exactly one private entry, and only
  // with `lifecycle: active`. That constraint is what keeps the archived state
  // of a private repository out of the CI blind spot (the default token cannot
  // see it). The refusal is asserted first, so lifting the constraint turns this
  // test red and forces the coupling to be reconsidered; the reconciliation is
  // then exercised on that state anyway, because its branch order (archived
  // before the private fail-open) is what would hold once the constraint goes.
  test("buildIndex refuses a declared-archived private entry (the coupling with the CI blind spot)", () => {
    const yaml = [
      "schema_version: v",
      "updated_on: 2026-10-09",
      "repositories:",
      "  - repository: libre-ai/product-research",
      "    role: administrative-private",
      "    layer: transverse",
      "    visibility: private",
      "    lifecycle: archived",
    ].join("\n");
    expect(() => buildIndex(yaml)).toThrow("the exact private administrative repository shape");
  });

  test("if that refusal were lifted, an invisible declared-archived private entry would be drift, not a note", () => {
    const result = reconcileInventory(
      declaredWithLifecycle(["hub", "public", "active"], ["vault", "private", "archived"]),
      liveWithArchive(["hub", false, false]),
    );
    const drift =
      "DRIFT: 'vault' declared archived but not observable — its archived state cannot be verified";
    expect(result.drifts).toEqual([drift]);
    expect(result.notes).toEqual([]);
    expect(result.archived).toEqual([{ name: "vault", holds: false, evidence: drift }]);
  });

  test("a declared-archived public entry that is not observable is the same drift", () => {
    const result = reconcileInventory(declaredWithLifecycle(["gone", "public", "archived"]), []);
    expect(result.drifts).toEqual([
      "DRIFT: 'gone' declared archived but not observable — its archived state cannot be verified",
    ]);
    expect(result.archived).toHaveLength(1);
  });

  test("one assertion per declared-archived entry, whatever their outcomes", () => {
    const result = reconcileInventory(
      declaredWithLifecycle(
        ["a", "public", "archived"],
        ["b", "public", "archived"],
        ["c", "public", "archived"],
        ["d", "public", "active"],
      ),
      liveWithArchive(["a", false, true], ["b", false, false], ["d", false, false]),
    );
    expect(result.archived.map((assertion) => [assertion.name, assertion.holds])).toEqual([
      ["a", true],
      ["b", false],
      ["c", false],
    ]);
  });
});

describe("buildOrgRepositoriesQuery", () => {
  test("omits the after argument on the first page", () => {
    const query = buildOrgRepositoriesQuery("libre-ai", null);
    expect(query).toContain('organization(login: "libre-ai")');
    expect(query).toContain("repositories(first: 100)");
    expect(query).not.toContain("after:");
  });

  test("asks for the archived state of every node", () => {
    expect(buildOrgRepositoriesQuery("libre-ai", null)).toContain(
      "nodes { name isPrivate isArchived }",
    );
  });

  test("carries the cursor for a subsequent page", () => {
    const query = buildOrgRepositoriesQuery("libre-ai", "cursor-abc");
    expect(query).toContain('repositories(first: 100, after: "cursor-abc")');
  });
});

describe("parseOrgRepositoriesPage", () => {
  test("reads nodes and pagination info from a well-formed page", () => {
    const page = parseOrgRepositoriesPage({
      organization: {
        repositories: {
          totalCount: 1,
          pageInfo: { hasNextPage: true, endCursor: "next" },
          nodes: [{ name: "governance", isPrivate: false, isArchived: true }],
        },
      },
    });
    expect(page).toEqual({
      nodes: [{ name: "governance", isPrivate: false, isArchived: true }],
      hasNextPage: true,
      endCursor: "next",
      totalCount: 1,
    });
  });

  test("returns null when the response lacks the expected shape, distinct from a real empty page", () => {
    expect(parseOrgRepositoriesPage({ organization: null })).toBeNull();
    expect(parseOrgRepositoriesPage({})).toBeNull();
  });

  test("reads a real empty last page as zero repositories, not null", () => {
    const page = parseOrgRepositoriesPage({
      organization: {
        repositories: {
          totalCount: 0,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      },
    });
    expect(page).toEqual({ nodes: [], hasNextPage: false, endCursor: null, totalCount: 0 });
  });

  // Inverted on 2026-10-09: dropping the malformed nodes is what let a
  // FORBIDDEN node and an undeclared repository missing isArchived vanish from
  // the reconciliation. One malformed node now makes the page unreadable.
  test("a malformed node makes the page unreadable instead of being dropped", () => {
    const page = parseOrgRepositoriesPage({
      organization: {
        repositories: {
          totalCount: 4,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { name: "ok", isPrivate: true, isArchived: false },
            null,
            { name: "bad" },
            { name: "no-archive-field", isPrivate: false },
          ],
        },
      },
    });
    expect(page).toBeNull();
  });
});

// --- Adversarial review of PR #48 (2026-10-09). Each forged input below made
// the gate exit 0 with "0 drift(s)" on the code it reviewed. The pure-shape
// cases are tested on the parser; the response-level case (exit code and
// `errors` ignored when `data` was present) on the response reader; the four
// end-to-end cases by running the gate itself against a fake `gh` whose
// answer is derived from the committed inventory, so the fixtures cannot go
// stale when the inventory changes.

const wellFormedNode = (name: string) => ({ name, isPrivate: false, isArchived: false });

const pageData = (
  nodes: unknown[],
  extra: { pageInfo?: unknown; totalCount?: unknown; omit?: "pageInfo" | "totalCount" } = {},
) => {
  const repositories: Record<string, unknown> = {
    pageInfo: extra.pageInfo ?? { hasNextPage: false, endCursor: null },
    totalCount: extra.totalCount ?? nodes.length,
    nodes,
  };
  if (extra.omit !== undefined) delete repositories[extra.omit];
  return { organization: { repositories } };
};

describe("parseOrgRepositoriesPage — a page that lost information is unreadable", () => {
  test("s1: a null node (FORBIDDEN on one repository) makes the whole page unreadable", () => {
    expect(parseOrgRepositoriesPage(pageData([wellFormedNode("hub"), null]))).toBeNull();
  });

  test("s2: a node without isArchived makes the whole page unreadable, not one repository fewer", () => {
    expect(
      parseOrgRepositoriesPage(
        pageData([wellFormedNode("hub"), { name: "shadow-repo", isPrivate: false }]),
      ),
    ).toBeNull();
  });

  test("s4: a page without pageInfo is unreadable, never a last page", () => {
    expect(
      parseOrgRepositoriesPage(pageData([wellFormedNode("hub")], { omit: "pageInfo" })),
    ).toBeNull();
  });

  test("a page without a numeric totalCount is unreadable", () => {
    expect(
      parseOrgRepositoriesPage(pageData([wellFormedNode("hub")], { omit: "totalCount" })),
    ).toBeNull();
    expect(
      parseOrgRepositoriesPage(pageData([wellFormedNode("hub")], { totalCount: "1" })),
    ).toBeNull();
  });

  test("a next page announced without a cursor is unreadable", () => {
    expect(
      parseOrgRepositoriesPage(
        pageData([wellFormedNode("hub")], { pageInfo: { hasNextPage: true, endCursor: null } }),
      ),
    ).toBeNull();
  });

  test("a well-formed page carries its totalCount", () => {
    expect(parseOrgRepositoriesPage(pageData([wellFormedNode("hub")], { totalCount: 7 }))).toEqual({
      nodes: [wellFormedNode("hub")],
      hasNextPage: false,
      endCursor: null,
      totalCount: 7,
    });
  });
});

describe("readOrgRepositoriesResponse — exit code and errors are part of the answer", () => {
  const complete = JSON.stringify({ data: pageData([wellFormedNode("hub")]) });

  test("a complete page with exit 0 and no errors is read", () => {
    const reading = readOrgRepositoriesResponse({ exitCode: 0, stdout: complete, stderr: "" });
    expect(reading.ok).toBe(true);
  });

  test("s1: data present but gh exited non-zero is rejected", () => {
    const reading = readOrgRepositoriesResponse({ exitCode: 1, stdout: complete, stderr: "" });
    expect(reading.ok).toBe(false);
  });

  test("s1: data present alongside a non-empty errors array is rejected, even on exit 0", () => {
    const stdout = JSON.stringify({
      data: pageData([wellFormedNode("hub")]),
      errors: [
        { type: "FORBIDDEN", message: "Resource protected by organization SAML enforcement" },
      ],
    });
    const reading = readOrgRepositoriesResponse({ exitCode: 0, stdout, stderr: "" });
    expect(reading).toEqual({
      ok: false,
      reason: "GraphQL errors: FORBIDDEN: Resource protected by organization SAML enforcement",
    });
  });

  test("an empty errors array is not an error", () => {
    const stdout = JSON.stringify({ data: pageData([wellFormedNode("hub")]), errors: [] });
    expect(readOrgRepositoriesResponse({ exitCode: 0, stdout, stderr: "" }).ok).toBe(true);
  });

  test("a body that is not JSON is rejected", () => {
    expect(readOrgRepositoriesResponse({ exitCode: 0, stdout: "<html>", stderr: "" }).ok).toBe(
      false,
    );
  });
});

describe("fetchLiveRepositories — the collected listing must equal the announced total", () => {
  const noDelay = [] as const;
  const restMustNotRun = async (): Promise<LiveRepository[]> => {
    throw new Error("REST fallback reached");
  };
  const answering =
    (...bodies: unknown[]) =>
    async () => {
      const body = bodies.length > 1 ? bodies.shift() : bodies[0];
      return { exitCode: 0, stdout: JSON.stringify({ data: body }), stderr: "" };
    };

  test("a consistent single page is returned as is", async () => {
    const live = await fetchLiveRepositories({
      graphql: answering(pageData([wellFormedNode("a"), wellFormedNode("b")])),
      rest: restMustNotRun,
      retryDelaysMs: noDelay,
    });
    expect(live.map((repository) => repository.name)).toEqual(["a", "b"]);
  });

  test("fewer repositories than totalCount fails closed", async () => {
    await expect(
      fetchLiveRepositories({
        graphql: answering(pageData([wellFormedNode("a")], { totalCount: 2 })),
        rest: restMustNotRun,
        retryDelaysMs: noDelay,
      }),
    ).rejects.toThrow("collected 1 repositories but the organization announced 2");
  });

  test("a repository listed twice fails closed, even when the count matches", async () => {
    await expect(
      fetchLiveRepositories({
        graphql: answering(
          pageData([wellFormedNode("a")], {
            pageInfo: { hasNextPage: true, endCursor: "c1" },
            totalCount: 2,
          }),
          pageData([wellFormedNode("a")], { totalCount: 2 }),
        ),
        rest: restMustNotRun,
        retryDelaysMs: noDelay,
      }),
    ).rejects.toThrow("listed twice");
  });

  test("an exhausted page budget fails closed instead of returning a prefix", async () => {
    await expect(
      fetchLiveRepositories({
        graphql: async (query: string) => ({
          exitCode: 0,
          stdout: JSON.stringify({
            data: pageData([wellFormedNode(`r${query.length}-${Math.random()}`)], {
              pageInfo: { hasNextPage: true, endCursor: "next" },
              totalCount: 5000,
            }),
          }),
          stderr: "",
        }),
        rest: restMustNotRun,
        retryDelaysMs: noDelay,
      }),
    ).rejects.toThrow("page budget exhausted");
  });

  test("an unreadable GraphQL answer falls back to REST, never to a partial listing", async () => {
    const live = await fetchLiveRepositories({
      graphql: async () => ({
        exitCode: 1,
        stdout: JSON.stringify({ data: pageData([wellFormedNode("partial")]) }),
        stderr: "",
      }),
      rest: async () => [wellFormedNode("from-rest")],
      retryDelaysMs: noDelay,
    });
    expect(live.map((repository) => repository.name)).toEqual(["from-rest"]);
  });
});

describe("reconcileInventory — every comparison is an assertion and the partition is counted", () => {
  test("presence, visibility and lifecycle are three comparisons per observed declared repository", () => {
    const result = reconcileInventory(declared(["hub", "public"]), live(["hub", false]));
    expect(result.comparisons.map((comparison) => [comparison.kind, comparison.holds])).toEqual([
      ["presence", true],
      ["visibility", true],
      ["lifecycle", true],
    ]);
  });

  test("the drifts are exactly the failing comparisons", () => {
    const result = reconcileInventory(
      declared(["hub", "public"], ["ghost", "public"]),
      live(["hub", true], ["rogue", false]),
    );
    expect(result.drifts).toEqual(
      result.comparisons.filter((comparison) => !comparison.holds).map((c) => c.evidence),
    );
    expect(result.drifts).toHaveLength(3);
  });

  test("s3: a declared-private repository invisible to the token is counted as unverifiable", () => {
    const result = reconcileInventory(
      declared(["hub", "public"], ["product-research", "private"]),
      live(["hub", false]),
    );
    expect(result.partition).toEqual({
      reconciled: 1,
      unverifiable: ["product-research"],
      missing: 0,
      declared: 2,
    });
  });
});

describe("the gate end to end, against a fake gh (forged inputs s1-s4)", () => {
  const repoRoot = new URL("..", import.meta.url).pathname;

  async function declaredNodes(): Promise<
    { name: string; isPrivate: boolean; isArchived: boolean }[]
  > {
    const yaml = await Bun.file(new URL("repositories.v1.yaml", import.meta.url)).text();
    return buildIndex(yaml).repositories.map((entry) => ({
      name: entry.repository.split("/")[1] as string,
      isPrivate: entry.visibility === "private",
      isArchived: entry.lifecycle === "archived",
    }));
  }

  async function runGate(
    graphqlBody: unknown,
    graphqlExit: number,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const dir = mkdtempSync(join(tmpdir(), "invdrift-fake-gh-"));
    try {
      const response = join(dir, "graphql.json");
      writeFileSync(response, JSON.stringify(graphqlBody));
      const gh = join(dir, "gh");
      // GraphQL answers the forged body; REST fails like the 2026-08-19 quota
      // exhaustion, so a gate that rejects the forged page cannot be rescued
      // by a fallback and must say it could not verify.
      writeFileSync(
        gh,
        [
          "#!/bin/sh",
          'if [ "$2" = "graphql" ]; then cat >/dev/null; cat "$FAKE_GH_GRAPHQL"; exit "$FAKE_GH_GRAPHQL_EXIT"; fi',
          'echo "HTTP 403: API rate limit exceeded" >&2',
          "exit 1",
        ].join("\n"),
      );
      chmodSync(gh, 0o755);
      const proc = Bun.spawn(["bun", "ecosystem/check-inventory-drift.ts"], {
        cwd: repoRoot,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH ?? ""}`,
          FAKE_GH_GRAPHQL: response,
          FAKE_GH_GRAPHQL_EXIT: String(graphqlExit),
          GATE_VERBOSE: "",
        },
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { exitCode, stdout, stderr };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const GATE_TIMEOUT_MS = 30_000;

  test.concurrent(
    "s1: a partial page served with FORBIDDEN and exit 1 fails the gate",
    async () => {
      const nodes = await declaredNodes();
      const result = await runGate(
        {
          data: pageData([...nodes, null], { totalCount: nodes.length + 1 }),
          errors: [
            { type: "FORBIDDEN", path: ["organization", "repositories", "nodes", nodes.length] },
          ],
        },
        1,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("unable to verify");
    },
    GATE_TIMEOUT_MS,
  );

  test.concurrent(
    "s2: an undeclared repository served without isArchived fails the gate",
    async () => {
      const nodes = await declaredNodes();
      const result = await runGate(
        {
          data: pageData([...nodes, { name: "shadow-repo", isPrivate: false }], {
            totalCount: nodes.length + 1,
          }),
        },
        0,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("0 drift(s)");
    },
    GATE_TIMEOUT_MS,
  );

  test.concurrent(
    "s4: a page without pageInfo fails the gate",
    async () => {
      const nodes = await declaredNodes();
      const result = await runGate({ data: pageData(nodes, { omit: "pageInfo" }) }, 0);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("0 drift(s)");
    },
    GATE_TIMEOUT_MS,
  );

  test.concurrent(
    "s3: the CI token view states reconciled + unverifiable = declared",
    async () => {
      const nodes = await declaredNodes();
      const visible = nodes.filter((node) => !node.isPrivate);
      const hidden = nodes.length - visible.length;
      const result = await runGate({ data: pageData(visible) }, 0);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        `${visible.length} reconciled + ${hidden} unverifiable (private, token scope) = ${nodes.length} declared`,
      );
      // One presence, one visibility and one lifecycle assertion per
      // reconciled repository, plus the partition check.
      expect(result.stdout).toContain(`verified: ${visible.length * 3 + 1} assertion(s) hold`);
    },
    GATE_TIMEOUT_MS,
  );
});
