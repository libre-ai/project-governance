import { describe, expect, test } from "bun:test";

import {
  buildFleetPresentationQuery,
  type FetchOutcome,
  hasUsableGraphQLData,
  parseFleet,
  parseFleetPresentationBatchResponse,
  reviewRepository,
} from "./check-fleet-presentation";
import { renderStatusSection } from "./project-cards";

/** A confirmed answer — found (text) or confirmed absent (null) — never the unable-to-verify case. */
function found(text: string | null): FetchOutcome {
  return { text, error: null };
}

const card = `schema_version: libre-ai.project.v1
project: demo
repository: libre-ai/demo
kind: satellite
layer: couche-4
statement:
  for: "les projets de la constellation"
  who_faces: "des machineries recopiées"
  enables: "consommer une brique unique"
  producing:
    - "une brique testée"
  without_depending_on:
    - "aucun service tiers"
summary: "Brique de démonstration du gate."
current_situation: >-
  En service.
scope:
  - "démonstration"
non_goals:
  - "seconde implémentation"
dependencies: []
maturity: usable
confidence: medium
exposure: spec-published
freshness:
  last_verified_on: "2026-07-30"
scope_stability: stable
phases:
  - id: service
    title: En service
    exit_criteria:
      - id: consumed
        text: "La brique est consommée épinglée."
        weight: 1
        status: accepted
        evidence:
          date: "2026-07-29"
          reference: "gate-acceptance-log 2026-07-29 (ligne 3.4)"
`;

function readmeFor(text: string): string {
  const section = renderStatusSection(
    (Bun as unknown as { YAML: { parse(t: string): unknown } }).YAML.parse(text),
  );
  return `# Demo\n\n## État du projet\n\n${section}\n`;
}

describe("reviewRepository", () => {
  test("accepts a valid card with a coherent README status section", () => {
    const entry = { repository: "libre-ai/demo", role: "satellite", card: "project.v1.yaml" };
    const files = new Map([
      ["libre-ai/demo:project.v1.yaml", card],
      ["libre-ai/demo:README.md", readmeFor(card)],
    ]);
    const review = reviewRepository(entry, (r, p) => found(files.get(`${r}:${p}`) ?? null));
    expect(review.skipped).toBe(false);
    expect(review.failures).toEqual([]);
  });

  test("fails on a README whose generated section diverges from the card", () => {
    const entry = { repository: "libre-ai/demo", role: "satellite", card: "project.v1.yaml" };
    const stale = readmeFor(card).replace("usable", "proven");
    const files = new Map([
      ["libre-ai/demo:project.v1.yaml", card],
      ["libre-ai/demo:README.md", stale],
    ]);
    const review = reviewRepository(entry, (r, p) => found(files.get(`${r}:${p}`) ?? null));
    expect(review.failures.length).toBeGreaterThan(0);
    expect(review.failures[0]).toContain("diverges");
  });

  test("fails on a declared card that is missing at main", () => {
    const entry = { repository: "libre-ai/demo", role: "satellite", card: "project.v1.yaml" };
    const review = reviewRepository(entry, () => found(null));
    expect(review.failures).toEqual([
      "libre-ai/demo: declared card project.v1.yaml is missing at main",
    ]);
  });

  test("reports a card fetch error as unable-to-verify, never as missing", () => {
    // The exact regression this type exists to prevent: a rate-limited or
    // otherwise unreachable gh api call must never be reported the same way
    // as a confirmed absence.
    const entry = { repository: "libre-ai/demo", role: "satellite", card: "project.v1.yaml" };
    const review = reviewRepository(entry, () => ({
      text: null,
      error: "API rate limit exceeded (HTTP 403)",
    }));
    expect(review.failures.length).toBe(1);
    expect(review.failures[0]).toContain("unable to verify");
    expect(review.failures.some((f) => f.includes("missing"))).toBe(false);
  });

  test("fails on an invalid card before ever reading the README", () => {
    const entry = { repository: "libre-ai/demo", role: "satellite", card: "project.v1.yaml" };
    const broken = card.replace("kind: satellite", "kind: spaceship");
    const review = reviewRepository(entry, (_r, p) =>
      found(p === "project.v1.yaml" ? broken : null),
    );
    expect(review.failures.length).toBeGreaterThan(0);
    expect(review.failures[0]).toContain("invalid card");
  });

  test("skips an entry without a declared card, and says so", () => {
    const entry = { repository: "libre-ai/.github", role: "org-profile" };
    const review = reviewRepository(entry, () => found(null));
    expect(review.skipped).toBe(true);
    expect(review.failures).toEqual([]);
  });

  test("accepts the strictly validated cardless private administrative entry", () => {
    const fleet = parseFleet(`schema_version: v
updated_on: 2026-09-11
repositories:
  - repository: libre-ai/product-research
    role: administrative-private
    layer: transverse
    visibility: private
    lifecycle: active
`);
    expect(fleet).toHaveLength(1);
    const entry = fleet[0];
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error("expected one parsed fleet entry");
    expect(reviewRepository(entry, () => found(null))).toEqual({
      failures: [],
      skipped: true,
    });
  });

  test("rejects a permissive private presentation entry during inventory parsing", () => {
    expect(() =>
      parseFleet(`schema_version: v
updated_on: 2026-09-11
repositories:
  - repository: libre-ai/other-private
    role: satellite
    layer: couche-4
    visibility: private
    lifecycle: active
`),
    ).toThrow();
  });

  test("hub role validates the card but exempts the README check", () => {
    const entry = { repository: "libre-ai/libre-ai", role: "hub", card: "ecosystem/cards/x.yaml" };
    const review = reviewRepository(entry, (_r, p) =>
      found(p === "ecosystem/cards/x.yaml" ? card : null),
    );
    expect(review.skipped).toBe(false);
    expect(review.failures).toEqual([]);
  });
});

describe("parseFleet", () => {
  test("keeps the card pointer only when declared", () => {
    const fleet = parseFleet(
      "schema_version: v\nupdated_on: 2026-09-11\nrepositories:\n  - repository: libre-ai/a\n    role: satellite\n    layer: couche-4\n    visibility: public\n    lifecycle: active\n    card: project.v1.yaml\n  - repository: libre-ai/b\n    role: org-profile\n    layer: transverse\n    visibility: public\n    lifecycle: active\n",
    );
    expect(fleet[0]?.card).toBe("project.v1.yaml");
    expect(fleet[1]?.card).toBeUndefined();
  });
});

describe("buildFleetPresentationQuery", () => {
  test("aliases by index and reads the declared card path plus README.md", () => {
    const query = buildFleetPresentationQuery([
      { repository: "libre-ai/authz-biscuit", card: "project.v1.yaml" },
    ]);
    expect(query).toContain('repo0: repository(owner: "libre-ai", name: "authz-biscuit")');
    expect(query).toContain('object(expression: "main:project.v1.yaml")');
    expect(query).toContain('object(expression: "main:README.md")');
  });

  test("reads a non-default card path verbatim", () => {
    const query = buildFleetPresentationQuery([
      { repository: "libre-ai/libre-ai", card: "ecosystem/cards/x.yaml" },
    ]);
    expect(query).toContain('object(expression: "main:ecosystem/cards/x.yaml")');
  });
});

describe("parseFleetPresentationBatchResponse", () => {
  const targets = [
    { repository: "libre-ai/governance", card: "project.v1.yaml" },
    { repository: "libre-ai/gone", card: "project.v1.yaml" },
  ];

  test("resolves a found repository's card and README", () => {
    const result = parseFleetPresentationBatchResponse(targets, {
      repo0: { card: { text: "kind: satellite\n" }, readme: { text: "# Demo\n" } },
      repo1: null,
    });
    expect(result.get("libre-ai/governance")).toEqual({
      card: { text: "kind: satellite\n", error: null },
      readme: { text: "# Demo\n", error: null },
    });
  });

  test("reports an unresolved repository as unable-to-verify on both card and readme, never as missing", () => {
    const result = parseFleetPresentationBatchResponse(targets, {
      repo0: { card: { text: "kind: satellite\n" }, readme: { text: "# Demo\n" } },
      repo1: null,
    });
    const gone = result.get("libre-ai/gone");
    expect(gone?.card.text).toBeNull();
    expect(gone?.card.error).not.toBeNull();
    expect(gone?.readme.error).not.toBeNull();
  });

  test("reads a confirmed-absent card (real 404) as a genuine null, not an error", () => {
    const result = parseFleetPresentationBatchResponse(
      [{ repository: "libre-ai/demo", card: "project.v1.yaml" }],
      { repo0: { card: null, readme: { text: "# Demo\n" } } },
    );
    expect(result.get("libre-ai/demo")?.card).toEqual({ text: null, error: null });
  });
});

describe("hasUsableGraphQLData", () => {
  test("rejects a top-level rate-limit rejection — data: null alongside errors[]", () => {
    expect(hasUsableGraphQLData({ data: null, errors: [{ type: "RATE_LIMITED" }] })).toBe(false);
  });

  test("rejects a response with no data key at all", () => {
    expect(hasUsableGraphQLData({ errors: [{ type: "SOME_ERROR" }] })).toBe(false);
    expect(hasUsableGraphQLData({})).toBe(false);
  });

  test("rejects a non-object body", () => {
    expect(hasUsableGraphQLData(null)).toBe(false);
    expect(hasUsableGraphQLData(undefined)).toBe(false);
  });

  test("accepts a real data payload", () => {
    expect(hasUsableGraphQLData({ data: { repo0: {} } })).toBe(true);
  });
});
