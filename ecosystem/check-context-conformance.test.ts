import { describe, expect, test } from "bun:test";

import {
  buildBatchQuery,
  checkFreshness,
  claudeAdapterIssue,
  countLines,
  extractSections,
  fetchPublicFleetContext,
  hasAuthorityPointer,
  hasUsableGraphQLData,
  lastLifecycleTransition,
  layerMarkerOk,
  missingSections,
  parseBatchResponse,
  parseHistoricalRegistry,
  parseRegistry,
  resolveLayerSpec,
  reviewContext,
} from "./check-context-conformance";

const POINTER = "https://raw.githubusercontent.com/libre-ai/governance/main/docs/README.md";

function agentsFixture(opts: {
  sections: readonly string[];
  layerMention: string;
  pointer?: string;
  padLines?: number;
}): string {
  const body = opts.sections
    .map((section) => `## ${section}\n\nContent for ${section}.\n`)
    .join("\n");
  const pad = opts.padLines ? "\n".repeat(opts.padLines) : "";
  return `# demo Canonical Agent Rules (${opts.layerMention})\n\n${body}\n${opts.pointer ?? POINTER}\n${pad}`;
}

describe("resolveLayerSpec", () => {
  test("couche-4 requires the base sections under a 40-line cap", () => {
    const spec = resolveLayerSpec({ layer: "couche-4", role: "satellite", lifecycle: "active" });
    expect(spec).toEqual({
      requiredSections: ["Authority", "Boundaries", "Quality gates", "Agents"],
      maxLines: 40,
    });
  });

  test("couche-3 and couche-2 share the base sections under a 45-line cap", () => {
    expect(resolveLayerSpec({ layer: "couche-3", role: "satellite", lifecycle: "active" })).toEqual(
      {
        requiredSections: ["Authority", "Boundaries", "Quality gates", "Agents"],
        maxLines: 45,
      },
    );
    expect(resolveLayerSpec({ layer: "couche-2", role: "satellite", lifecycle: "active" })).toEqual(
      {
        requiredSections: ["Authority", "Boundaries", "Quality gates", "Agents"],
        maxLines: 45,
      },
    );
  });

  test("transverse non-authority gets the 45-line base template", () => {
    expect(
      resolveLayerSpec({ layer: "transverse", role: "standalone-tool", lifecycle: "active" }),
    ).toEqual({
      requiredSections: ["Authority", "Boundaries", "Quality gates", "Agents"],
      maxLines: 45,
    });
  });

  test("transverse authority (governance, contracts) gets an 80-line cap", () => {
    expect(
      resolveLayerSpec({ layer: "transverse", role: "authority", lifecycle: "active" }),
    ).toEqual({
      requiredSections: ["Authority", "Boundaries", "Quality gates", "Agents"],
      maxLines: 80,
    });
  });

  test("couche-1 active gets the product template under a 60-line cap", () => {
    expect(
      resolveLayerSpec({ layer: "couche-1", role: "reserved-product-home", lifecycle: "active" }),
    ).toEqual({
      requiredSections: ["Purpose", "Domain doctrine", "Commands", "Working here"],
      maxLines: 60,
    });
  });

  test("an unmapped combination is reported, never guessed", () => {
    expect(
      resolveLayerSpec({ layer: "couche-1", role: "reserved-product-home", lifecycle: "archived" }),
    ).toBeNull();
    expect(resolveLayerSpec({ layer: "moyeu", role: "hub", lifecycle: "active" })).toBeNull();
  });

  test("moyeu has no named template — its one member is archived, fully exempted upstream", () => {
    expect(resolveLayerSpec({ layer: "moyeu", role: "hub", lifecycle: "archived" })).toBeNull();
  });
});

describe("extractSections / missingSections", () => {
  test("reads top-level ## headings only, not ### subsections", () => {
    const text = "# Title\n\n## Authority\n\n### Sub\n\n## Boundaries\n";
    expect(extractSections(text)).toEqual(["Authority", "Boundaries"]);
  });

  test("reports what is absent from the required list", () => {
    expect(
      missingSections(["Authority", "Boundaries", "Agents"], "## Authority\n## Agents\n"),
    ).toEqual(["Boundaries"]);
  });
});

describe("countLines", () => {
  test("counts lines without penalising a single trailing newline", () => {
    expect(countLines("a\nb\nc\n")).toBe(3);
    expect(countLines("a\nb\nc")).toBe(3);
  });
});

describe("hasAuthorityPointer", () => {
  test("accepts the raw.githubusercontent.com form", () => {
    expect(
      hasAuthorityPointer("see https://raw.githubusercontent.com/libre-ai/governance/main/x"),
    ).toBe(true);
  });

  test("accepts the github.com blob form for contracts", () => {
    expect(
      hasAuthorityPointer("see https://github.com/libre-ai/contracts/blob/main/README.md"),
    ).toBe(true);
  });

  test("rejects a prose-only mention with no URL", () => {
    expect(hasAuthorityPointer("doctrine lives in the governance repository")).toBe(false);
  });

  test("rejects a URL to an unrelated org or repo", () => {
    expect(
      hasAuthorityPointer("https://raw.githubusercontent.com/other-org/governance/main/x"),
    ).toBe(false);
    expect(hasAuthorityPointer("https://github.com/libre-ai/notebook/blob/main/x")).toBe(false);
  });
});

describe("layerMarkerOk", () => {
  test("matches couche-4 to a 'couche 4' mention", () => {
    expect(layerMarkerOk("couche-4", "this is a couche 4 brick")).toBe(true);
    expect(layerMarkerOk("couche-4", "this is a couche-4 brick")).toBe(true);
  });

  test("rejects a mismatched couche number", () => {
    expect(layerMarkerOk("couche-4", "this is a couche 3 brick")).toBe(false);
  });

  test("matches transverse and moyeu literally", () => {
    expect(layerMarkerOk("transverse", "a transverse concern")).toBe(true);
    expect(layerMarkerOk("moyeu", "the moyeu of the constellation")).toBe(true);
    expect(layerMarkerOk("moyeu", "the hub of the constellation")).toBe(false);
  });

  test("rejects when no marker is present at all", () => {
    expect(layerMarkerOk("couche-4", "no marker here")).toBe(false);
  });
});

describe("claudeAdapterIssue", () => {
  test("passes when AGENTS.md exists and CLAUDE.md is the byte-exact adapter", () => {
    expect(claudeAdapterIssue(true, "@AGENTS.md\n")).toBeNull();
  });

  test("fails when AGENTS.md exists but CLAUDE.md is missing", () => {
    expect(claudeAdapterIssue(true, null)).toContain("missing");
  });

  test("fails when CLAUDE.md diverges from the byte-exact adapter", () => {
    expect(claudeAdapterIssue(true, "@AGENTS.md")).toContain("byte-exact");
    expect(claudeAdapterIssue(true, "@AGENTS.md\n\n")).toContain("byte-exact");
  });

  test("passes when neither file exists", () => {
    expect(claudeAdapterIssue(false, null)).toBeNull();
  });

  test("fails when CLAUDE.md exists without AGENTS.md", () => {
    expect(claudeAdapterIssue(false, "@AGENTS.md\n")).toContain("without an AGENTS.md");
  });
});

describe("lastLifecycleTransition", () => {
  test("returns null when the value never changed since the entry existed", () => {
    const history = [
      { date: "2026-01-01", lifecycle: "active" },
      { date: "2026-02-01", lifecycle: "active" },
    ];
    expect(lastLifecycleTransition(history)).toBeNull();
  });

  test("returns the date of the most recent real value change", () => {
    const history = [
      { date: "2026-01-01", lifecycle: "active" },
      { date: "2026-02-01", lifecycle: "archived" },
      { date: "2026-03-01", lifecycle: "archived" },
    ];
    expect(lastLifecycleTransition(history)).toBe("2026-02-01");
  });

  test("ignores commits where the entry does not exist yet", () => {
    const history = [
      { date: "2026-01-01", lifecycle: undefined },
      { date: "2026-02-01", lifecycle: "active" },
    ];
    expect(lastLifecycleTransition(history)).toBeNull();
  });
});

describe("checkFreshness", () => {
  test("is purely informative when there is no recorded transition", () => {
    const outcome = checkFreshness(null, "2026-01-01");
    expect(outcome.blocking).toBe(false);
  });

  test("blocks when AGENTS.md predates the last lifecycle transition", () => {
    const outcome = checkFreshness("2026-08-01", "2026-01-01");
    expect(outcome.blocking).toBe(true);
    expect(outcome.note).toContain("2026-08-01");
  });

  test("does not block when AGENTS.md was touched at or after the transition", () => {
    expect(checkFreshness("2026-01-01", "2026-01-01").blocking).toBe(false);
    expect(checkFreshness("2026-01-01", "2026-08-01").blocking).toBe(false);
  });

  test("does not block when AGENTS.md modification date is unavailable", () => {
    expect(checkFreshness("2026-08-01", null).blocking).toBe(false);
  });
});

describe("parseRegistry", () => {
  test("extracts repository, role, layer and lifecycle", () => {
    const entries = parseRegistry(
      "schema_version: v\nupdated_on: 2026-09-11\nrepositories:\n  - repository: libre-ai/a\n    role: satellite\n    layer: couche-4\n    visibility: public\n    lifecycle: active\n",
    );
    expect(entries).toEqual([
      {
        repository: "libre-ai/a",
        role: "satellite",
        layer: "couche-4",
        visibility: "public",
        lifecycle: "active",
      },
    ]);
  });

  test("historical parsing preserves retired lifecycle values for transition chronology", () => {
    expect(
      parseHistoricalRegistry(
        "repositories:\n  - repository: libre-ai/legacy\n    lifecycle: frozen-until-wave-4\n",
      ),
    ).toEqual([
      {
        repository: "libre-ai/legacy",
        role: "historical-unknown",
        layer: "historical-unknown",
        lifecycle: "frozen-until-wave-4",
      },
    ]);
  });
});

describe("reviewContext", () => {
  const entry = {
    repository: "libre-ai/demo",
    role: "satellite",
    layer: "couche-4",
    lifecycle: "active",
    visibility: "public" as const,
  };
  const freshness = { transitionedOn: null, agentsLastModifiedOn: null };

  test("exempts a private repository before inspecting fetched documents", () => {
    const outcome = reviewContext(
      {
        repository: "libre-ai/product-research",
        role: "administrative-private",
        layer: "transverse",
        visibility: "private",
        lifecycle: "active",
      },
      { agents: null, claude: null, agentsFetchError: "must not be observed" },
      freshness,
    );
    expect(outcome).toEqual({
      failures: [],
      notes: [
        "private repository — content gates run in-repository; no cross-repository read token granted",
      ],
      exempt: true,
    });
  });

  test("exempts libre-ai/.github explicitly, without silence", () => {
    const outcome = reviewContext(
      {
        repository: "libre-ai/.github",
        role: "org-profile",
        layer: "transverse",
        lifecycle: "active",
      },
      { agents: null, claude: null },
      freshness,
    );
    expect(outcome.exempt).toBe(true);
    expect(outcome.failures).toEqual([]);
    expect(outcome.notes.length).toBeGreaterThan(0);
  });

  test("asserts a non-active, non-archived absence as a pass, not a skip", () => {
    // No such lifecycle value exists in the registry today (only active and
    // archived) — this exercises the defensive branch for a future value the
    // template has not yet named, distinct from the archived exemption below.
    const outcome = reviewContext(
      { ...entry, lifecycle: "draft" },
      { agents: null, claude: null },
      freshness,
    );
    expect(outcome.exempt).toBe(false);
    expect(outcome.failures).toEqual([]);
    expect(outcome.notes.join(" ")).toContain("lifecycle=draft");
  });

  test("exempts an archived entry entirely, even with no AGENTS.md", () => {
    const outcome = reviewContext(
      { ...entry, lifecycle: "archived" },
      { agents: null, claude: null },
      freshness,
    );
    expect(outcome.exempt).toBe(true);
    expect(outcome.failures).toEqual([]);
    expect(outcome.notes.join(" ")).toContain("archived");
  });

  test("exempts an archived entry entirely, even when its AGENTS.md is non-conformant", () => {
    // The real case this guards: libre-ai/libre-ai carries an AGENTS.md that
    // predates the template (no required sections, no fetchable pointer, no
    // layer marker) and is read-only by construction — a cap or a required
    // section cannot bind content that can no longer be edited.
    const agents = "# Hub archive\n\nSome prose with no sections and no pointer.\n";
    const outcome = reviewContext(
      { ...entry, layer: "moyeu", lifecycle: "archived" },
      { agents, claude: null },
      freshness,
    );
    expect(outcome.exempt).toBe(true);
    expect(outcome.failures).toEqual([]);
  });

  test("fails when an active entry has no AGENTS.md", () => {
    const outcome = reviewContext(entry, { agents: null, claude: null }, freshness);
    expect(outcome.failures.length).toBeGreaterThan(0);
    expect(outcome.failures[0]).toContain("missing");
  });

  test("reports an AGENTS.md fetch error as unable-to-verify, never as missing", () => {
    // The exact regression this type exists to prevent: a rate-limited or
    // otherwise unreachable gh api call must never be reported the same way
    // as a confirmed absence — the required check would then fail every
    // pull request on a transient condition unrelated to any repository's
    // real AGENTS.md.
    const outcome = reviewContext(
      entry,
      { agents: null, claude: null, agentsFetchError: "API rate limit exceeded (HTTP 403)" },
      freshness,
    );
    expect(outcome.failures.length).toBe(1);
    expect(outcome.failures[0]).toContain("unable to verify");
    expect(outcome.failures[0]).toContain("rate limit");
    expect(outcome.failures.some((f) => f.includes("missing"))).toBe(false);
  });

  test("reports a CLAUDE.md fetch error as unable-to-verify, distinct from a missing adapter", () => {
    const agents = agentsFixture({
      sections: ["Authority", "Boundaries", "Quality gates", "Agents"],
      layerMention: "couche 4",
    });
    const outcome = reviewContext(
      entry,
      { agents, claude: null, claudeFetchError: "gh api ... failed (HTTP 500)" },
      freshness,
    );
    expect(outcome.failures.some((f) => f.includes("unable to verify CLAUDE.md"))).toBe(true);
    expect(outcome.failures.some((f) => f.includes("is not the byte-exact"))).toBe(false);
    expect(outcome.failures.some((f) => f.includes("is missing while"))).toBe(false);
  });

  test("passes a fully conformant couche-4 AGENTS.md", () => {
    const agents = agentsFixture({
      sections: ["Authority", "Boundaries", "Quality gates", "Agents"],
      layerMention: "couche 4",
    });
    const outcome = reviewContext(entry, { agents, claude: "@AGENTS.md\n" }, freshness);
    expect(outcome.failures).toEqual([]);
  });

  test("accumulates every violation instead of stopping at the first", () => {
    const agents = agentsFixture({
      sections: ["Authority", "Agents"],
      layerMention: "couche 3",
      pointer: "no url here",
    });
    const outcome = reviewContext(entry, { agents, claude: null }, freshness);
    expect(outcome.failures.some((f) => f.includes("Boundaries"))).toBe(true);
    expect(outcome.failures.some((f) => f.includes("layer marker"))).toBe(true);
    expect(outcome.failures.some((f) => f.includes("URL"))).toBe(true);
    expect(outcome.failures.some((f) => f.includes("missing"))).toBe(true);
  });

  test("fails over the line cap", () => {
    const agents = agentsFixture({
      sections: ["Authority", "Boundaries", "Quality gates", "Agents"],
      layerMention: "couche 4",
      padLines: 45,
    });
    const outcome = reviewContext(entry, { agents, claude: "@AGENTS.md\n" }, freshness);
    expect(outcome.failures.some((f) => f.includes("line cap"))).toBe(true);
  });

  test("reports an unmapped layer/role/lifecycle combination as a failure", () => {
    // moyeu + active is unmapped (the template's one moyeu row was archived,
    // now fully exempted upstream — see resolveLayerSpec's own tests); this
    // combination reaches resolveLayerSpec because it is not archived.
    const agents = agentsFixture({ sections: [], layerMention: "moyeu" });
    const outcome = reviewContext(
      {
        repository: "libre-ai/x",
        role: "hub",
        layer: "moyeu",
        lifecycle: "active",
      },
      { agents, claude: "@AGENTS.md\n" },
      freshness,
    );
    expect(outcome.failures.some((f) => f.includes("no context template"))).toBe(true);
  });

  test("blocks on a lifecycle transition not followed by an AGENTS.md update", () => {
    const agents = agentsFixture({
      sections: ["Authority", "Boundaries", "Quality gates", "Agents"],
      layerMention: "couche 4",
    });
    const outcome = reviewContext(
      entry,
      { agents, claude: "@AGENTS.md\n" },
      { transitionedOn: "2026-08-18", agentsLastModifiedOn: "2026-01-01" },
    );
    expect(outcome.failures.some((f) => f.includes("transitioned"))).toBe(true);
  });

  test("keeps a stale-but-untransitioned repository green (informative note only)", () => {
    const agents = agentsFixture({
      sections: ["Authority", "Boundaries", "Quality gates", "Agents"],
      layerMention: "couche 4",
    });
    const outcome = reviewContext(
      entry,
      { agents, claude: "@AGENTS.md\n" },
      { transitionedOn: null, agentsLastModifiedOn: "2026-01-01" },
    );
    expect(outcome.failures).toEqual([]);
    expect(outcome.notes.length).toBeGreaterThan(0);
  });
});

test("context transport never receives a private repository target", async () => {
  const received: string[][] = [];
  await fetchPublicFleetContext(
    [
      {
        repository: "libre-ai/public",
        role: "satellite",
        layer: "couche-4",
        visibility: "public",
        lifecycle: "active",
      },
      {
        repository: "libre-ai/product-research",
        role: "administrative-private",
        layer: "transverse",
        visibility: "private",
        lifecycle: "active",
      },
    ],
    async (repositories) => {
      received.push([...repositories]);
      return new Map();
    },
  );
  expect(received).toEqual([["libre-ai/public"]]);
});

describe("buildBatchQuery", () => {
  test("aliases by index, never by repository name (hyphens are not valid GraphQL alias characters)", () => {
    const query = buildBatchQuery(["libre-ai/governance", "libre-ai/authz-biscuit"]);
    expect(query).toContain('repo0: repository(owner: "libre-ai", name: "governance")');
    expect(query).toContain('repo1: repository(owner: "libre-ai", name: "authz-biscuit")');
    expect(query).not.toContain("repo-authz-biscuit:");
  });

  test("requests AGENTS.md, CLAUDE.md and the AGENTS.md commit history in one block", () => {
    const query = buildBatchQuery(["libre-ai/demo"]);
    expect(query).toContain('object(expression: "main:AGENTS.md")');
    expect(query).toContain('object(expression: "main:CLAUDE.md")');
    expect(query).toContain('history(first: 1, path: "AGENTS.md")');
  });

  test("rejects a malformed registry entry instead of guessing an owner", () => {
    expect(() => buildBatchQuery(["not-a-repo-slug"])).toThrow(/owner\/name/);
  });
});

describe("parseBatchResponse", () => {
  const repositories = ["libre-ai/governance", "libre-ai/gone"];

  test("reads a found repository's blobs and last-commit date", () => {
    const result = parseBatchResponse(repositories, {
      repo0: {
        agents: { text: "# demo\n" },
        claude: { text: "@AGENTS.md\n" },
        defaultBranchRef: {
          target: { history: { nodes: [{ committedDate: "2026-08-18T12:00:00Z" }] } },
        },
      },
      repo1: null,
    });
    const governance = result.get("libre-ai/governance");
    expect(governance?.agents).toEqual({ text: "# demo\n", error: null });
    expect(governance?.claude).toEqual({ text: "@AGENTS.md\n", error: null });
    expect(governance?.agentsLastModifiedOn).toBe("2026-08-18");
  });

  test("reports a null repository node as unable-to-verify, never as a missing file", () => {
    const result = parseBatchResponse(repositories, {
      repo0: { agents: { text: "# demo\n" }, claude: null, defaultBranchRef: null },
      repo1: null,
    });
    const gone = result.get("libre-ai/gone");
    expect(gone?.agents.text).toBeNull();
    expect(gone?.agents.error).not.toBeNull();
    expect(gone?.agents.error).toContain("not resolvable");
  });

  test("reads a genuinely absent AGENTS.md object as a confirmed absence, not an error", () => {
    const result = parseBatchResponse(["libre-ai/demo"], {
      repo0: { agents: null, claude: null, defaultBranchRef: null },
    });
    const demo = result.get("libre-ai/demo");
    expect(demo?.agents).toEqual({ text: null, error: null });
  });

  test("degrades to no fetch outcome only when the alias itself is entirely absent from data", () => {
    const result = parseBatchResponse(["libre-ai/demo"], {});
    expect(result.get("libre-ai/demo")?.agents.error).not.toBeNull();
  });
});

describe("hasUsableGraphQLData", () => {
  test("rejects a top-level rate-limit rejection — data: null alongside errors[]", () => {
    // The exact regression: this is the documented shape of a
    // rate-limited/quota-exhausted gh api graphql response. `data` is
    // present (not undefined) but explicitly null — accepting it as
    // success used to mark every repository "unable to verify" in one
    // pass, with no retry and no REST fallback.
    expect(hasUsableGraphQLData({ data: null, errors: [{ type: "RATE_LIMITED" }] })).toBe(false);
  });

  test("rejects a response with no data key at all", () => {
    expect(hasUsableGraphQLData({ errors: [{ type: "SOME_ERROR" }] })).toBe(false);
    expect(hasUsableGraphQLData({})).toBe(false);
  });

  test("rejects a non-object body", () => {
    expect(hasUsableGraphQLData(null)).toBe(false);
    expect(hasUsableGraphQLData(undefined)).toBe(false);
    expect(hasUsableGraphQLData("not json shaped")).toBe(false);
  });

  test("accepts a real data payload", () => {
    expect(hasUsableGraphQLData({ data: { repo0: { agents: null } } })).toBe(true);
  });
});
