import { describe, expect, test } from "bun:test";

import { buildFleetStatus } from "./render-fleet-status";

function card(overrides: Record<string, unknown>): unknown {
  return {
    schema_version: "libre-ai.project.v1",
    project: "demo",
    repository: "libre-ai/demo",
    kind: "satellite",
    layer: "couche-4",
    statement: {
      for: "les projets de la constellation",
      who_faces: "des machineries recopiées",
      enables: "consommer une brique unique",
      producing: ["une brique testée"],
      without_depending_on: ["aucun service tiers"],
    },
    summary: "Brique de démonstration.",
    current_situation: "En service.",
    scope: ["démonstration"],
    non_goals: ["seconde implémentation"],
    dependencies: [],
    maturity: "usable",
    confidence: "medium",
    exposure: "spec-published",
    freshness: { last_verified_on: "2026-07-30" },
    scope_stability: "stable",
    phases: [
      {
        id: "service",
        title: "En service",
        exit_criteria: [
          {
            id: "consumed",
            text: "La brique est consommée épinglée.",
            weight: 1,
            status: "accepted",
            evidence: { date: "2026-07-29", reference: "gate-acceptance-log 2026-07-29" },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("buildFleetStatus", () => {
  test("computes the display per row and sorts by layer then repository", () => {
    const product = card({
      project: "produit",
      repository: "libre-ai/produit",
      kind: "product",
      layer: "couche-1",
      scope_stability: "unstable",
      hypothesis: "Un pari falsifiable à préciser.",
      evidence_required: ["une spécification acceptée"],
      promotion_criteria: [{ to: "spec-published", when: "une spécification est publiée" }],
      kill_predicates: [
        { id: "no-spec", predicate: "aucun périmètre clarifié", source: "revue propriétaire" },
      ],
      benchmark: { none: "aucun comparable retenu" },
      phases: [
        {
          id: "scoping",
          title: "Périmètre",
          exit_criteria: [{ id: "s", text: "Périmètre clarifié.", weight: 1, status: "pending" }],
        },
      ],
    });
    const status = buildFleetStatus([card({}), product]);
    expect(status.rows.map((r) => r.repository)).toEqual(["libre-ai/produit", "libre-ai/demo"]);
    expect(status.rows[1]?.display).toBe("100 % du périmètre actuellement déclaré");
    expect(status.rows[0]?.display).toBe("Avancement non calculable — périmètre à clarifier");
    expect(status.rows[0]?.maturity).toBe("usable");
    expect(status.rows[0]?.last_verified_on).toBe("2026-07-30");
  });
});
