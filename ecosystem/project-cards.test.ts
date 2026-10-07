import { describe, expect, test } from "bun:test";

import {
  aggregateProgress,
  checkStatusSection,
  collectPathReferences,
  renderStatusSection,
  STATUS_SECTION_BEGIN,
  STATUS_SECTION_END,
  validateCard,
} from "./project-cards";

/**
 * γ phase 3.2 — the project-card system (design §6, ADR-0020).
 * Progress is computed, never declared; maturity ≠ progress ≠ confidence ≠
 * freshness; a phase without an exit criterion is forbidden; an accepted
 * criterion without dated evidence is forbidden; unstable scope reports
 * « Avancement non calculable » instead of a ratio.
 */

function minimalCard(): Record<string, unknown> {
  return {
    schema_version: "libre-ai.project.v1",
    project: "envelope",
    repository: "libre-ai/envelope",
    kind: "satellite",
    layer: "couche-3",
    statement: {
      for: "les constructeurs d'applications de la constellation",
      who_faces: "du contenu non fiable injecté dans les prompts de leurs agents",
      enables: "marquer et vérifier l'intégrité de tout contenu non fiable",
      producing: ["une enveloppe signée vérifiable hors ligne"],
      without_depending_on: ["aucun service tiers"],
    },
    summary: "Enveloppe d'intégrité du contenu non fiable (noyau K3).",
    current_situation:
      "Contrat envelope-v1 verrouillé, consommé par le fan-out de revue de la forge.",
    scope: ["escape des délimiteurs", "MAC constant-time", "classes de sources fermées"],
    non_goals: ["le chiffrement du contenu", "la gestion de clés distribuée"],
    dependencies: [],
    maturity: "usable",
    confidence: "high",
    exposure: "usable-verifiable",
    freshness: { last_verified_on: "2026-07-29" },
    scope_stability: "stable",
    phases: [
      {
        id: "extraction",
        title: "Extraction en repo satellite",
        exit_criteria: [
          {
            id: "history-grafted",
            text: "L'histoire du package est portée par filter-repo dans le repo satellite.",
            weight: 3,
            status: "pending",
          },
          {
            id: "gates-green",
            text: "Le gabarit CI de governance est vert sur le contenu migré.",
            weight: 7,
            status: "pending",
          },
        ],
      },
    ],
  };
}

describe("validateCard", () => {
  test("accepts a minimal valid satellite card", () => {
    expect(validateCard(minimalCard())).toEqual([]);
  });

  test("rejects an accepted criterion without dated evidence", () => {
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any)[0].exit_criteria[0].status = "accepted";
    const errors = validateCard(card);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("evidence");
  });

  test("accepts an accepted criterion carrying dated evidence", () => {
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any)[0].exit_criteria[0] = {
      id: "history-grafted",
      text: "L'histoire du package est portée par filter-repo dans le repo satellite.",
      weight: 3,
      status: "accepted",
      evidence: { date: "2026-07-29", reference: "PR #999" },
    };
    expect(validateCard(card)).toEqual([]);
  });

  test("rejects a phase without exit criteria", () => {
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any)[0].exit_criteria = [];
    expect(validateCard(card).length).toBeGreaterThan(0);
  });

  test("rejects a zero or negative weight", () => {
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any)[0].exit_criteria[0].weight = 0;
    expect(validateCard(card).length).toBeGreaterThan(0);
  });

  test("rejects any manual percent-like field by closed shape", () => {
    const card = minimalCard();
    (card as Record<string, unknown>).progress_percent = 80;
    expect(validateCard(card).length).toBeGreaterThan(0);
  });

  test("rejects a product card without its falsifiability block", () => {
    const card = minimalCard();
    card.kind = "product";
    card.layer = "couche-1";
    const errors = validateCard(card);
    expect(errors.join("\n")).toMatch(/hypothesis|required/);
  });

  test("rejects a malformed evidence date", () => {
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any)[0].exit_criteria[0] = {
      id: "x-crit",
      text: "Un critère daté n'accepte que des dates ISO.",
      weight: 1,
      status: "accepted",
      evidence: { date: "29/07/2026", reference: "PR #1" },
    };
    expect(validateCard(card).length).toBeGreaterThan(0);
  });

  test("rejects calendar-impossible dates that match the ISO shape", () => {
    for (const date of ["2026-13-45", "0000-00-00", "2026-02-30"]) {
      const card = minimalCard();
      // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
      (card.phases as any)[0].exit_criteria[0] = {
        id: "x-crit",
        text: "Un critère daté n'accepte que des dates calendaires réelles.",
        weight: 1,
        status: "accepted",
        evidence: { date, reference: "PR #1" },
      };
      expect(validateCard(card).length).toBeGreaterThan(0);
    }
  });

  test("rejects evidence dated in the future", () => {
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any)[0].exit_criteria[0] = {
      id: "x-crit",
      text: "Une preuve ne peut pas être datée dans le futur.",
      weight: 1,
      status: "accepted",
      evidence: { date: "2099-01-01", reference: "PR #1" },
    };
    const errors = validateCard(card);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("futur");
  });

  test("rejects a freshness date in the future or calendar-impossible", () => {
    const future = minimalCard();
    (future.freshness as { last_verified_on: string }).last_verified_on = "2099-01-01";
    expect(validateCard(future).length).toBeGreaterThan(0);
    const impossible = minimalCard();
    (impossible.freshness as { last_verified_on: string }).last_verified_on = "2026-13-45";
    expect(validateCard(impossible).length).toBeGreaterThan(0);
  });

  test("tolerates tomorrow (timezone skew) but rejects the day after", () => {
    // The CI runs in UTC while cards are written in local time: a one-day
    // tolerance makes the gate deterministic wherever it executes, while
    // still refusing genuinely future-dated evidence.
    const isoDaysFromNow = (days: number): string => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${date.getFullYear()}-${month}-${day}`;
    };
    const tomorrow = minimalCard();
    (tomorrow.freshness as { last_verified_on: string }).last_verified_on = isoDaysFromNow(1);
    expect(validateCard(tomorrow)).toEqual([]);
    const dayAfter = minimalCard();
    (dayAfter.freshness as { last_verified_on: string }).last_verified_on = isoDaysFromNow(2);
    expect(validateCard(dayAfter).length).toBeGreaterThan(0);
  });

  test("rejects an incomplete mission statement", () => {
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    delete (card.statement as any).who_faces;
    expect(validateCard(card).length).toBeGreaterThan(0);
  });
});

describe("aggregateProgress", () => {
  test("computes per-phase and overall ratios from accepted weights only", () => {
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any)[0].exit_criteria[0] = {
      id: "history-grafted",
      text: "L'histoire du package est portée par filter-repo dans le repo satellite.",
      weight: 3,
      status: "accepted",
      evidence: { date: "2026-07-29", reference: "PR #999" },
    };
    const report = aggregateProgress(card);
    expect(report.computable).toBe(true);
    if (!report.computable) throw new Error("unreachable");
    expect(report.phases).toEqual([
      { id: "extraction", accepted_weight: 3, applicable_weight: 10, ratio: 0.3 },
    ]);
    expect(report.overall_ratio).toBe(0.3);
    expect(report.display).toBe("30 % du périmètre actuellement déclaré");
  });

  test("reports zero progress honestly", () => {
    const report = aggregateProgress(minimalCard());
    expect(report.computable).toBe(true);
    if (!report.computable) throw new Error("unreachable");
    expect(report.overall_ratio).toBe(0);
    expect(report.display).toBe("0 % du périmètre actuellement déclaré");
  });

  test("unstable scope is not computable and says so verbatim", () => {
    const card = minimalCard();
    card.scope_stability = "unstable";
    const report = aggregateProgress(card);
    expect(report.computable).toBe(false);
    if (report.computable) throw new Error("unreachable");
    expect(report.display).toBe("Avancement non calculable — périmètre à clarifier");
  });

  test("never displays 100 % while any criterion is still pending", () => {
    // 199 accepted over 200 applicable: Math.round would say 100 %.
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any)[0].exit_criteria = [
      {
        id: "big-one",
        text: "Le premier gros critère est accepté avec preuve datée.",
        weight: 100,
        status: "accepted",
        evidence: { date: "2026-07-29", reference: "PR #999" },
      },
      {
        id: "big-two",
        text: "Le second gros critère est accepté avec preuve datée.",
        weight: 99,
        status: "accepted",
        evidence: { date: "2026-07-29", reference: "PR #999" },
      },
      {
        id: "last-mile",
        text: "Le dernier critère reste ouvert.",
        weight: 1,
        status: "pending",
      },
    ];
    const report = aggregateProgress(card);
    expect(report.computable).toBe(true);
    if (!report.computable) throw new Error("unreachable");
    expect(report.overall_ratio).toBeLessThan(1);
    expect(report.display).toBe("99,5 % du périmètre actuellement déclaré");
  });

  test("displays the measured half exactly — owner arbitration of 2026-07-30", () => {
    // 5 accepted over 8 applicable = 62,5 %: the historic floor/round case.
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any)[0].exit_criteria = [
      {
        id: "five",
        text: "Cinq points de poids sont acceptés avec preuve datée.",
        weight: 5,
        status: "accepted",
        evidence: { date: "2026-07-29", reference: "PR #999" },
      },
      { id: "three", text: "Trois points restent ouverts.", weight: 3, status: "pending" },
    ];
    const report = aggregateProgress(card);
    expect(report.computable).toBe(true);
    if (!report.computable) throw new Error("unreachable");
    expect(report.display).toBe("62,5 % du périmètre actuellement déclaré");
  });

  test("never displays 0 % while any criterion is accepted", () => {
    // 1 accepted over 301 applicable: an integer floor would say 0 %.
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any)[0].exit_criteria = [
      {
        id: "tiny-win",
        text: "Un petit critère est réellement accepté avec preuve datée.",
        weight: 1,
        status: "accepted",
        evidence: { date: "2026-07-29", reference: "PR #999" },
      },
      { id: "big-a", text: "Un gros critère encore ouvert.", weight: 100, status: "pending" },
      { id: "big-b", text: "Un gros critère encore ouvert.", weight: 100, status: "pending" },
      { id: "big-c", text: "Un gros critère encore ouvert.", weight: 100, status: "pending" },
    ];
    const report = aggregateProgress(card);
    expect(report.computable).toBe(true);
    if (!report.computable) throw new Error("unreachable");
    expect(report.overall_ratio).toBeGreaterThan(0);
    expect(report.display).toBe("0,3 % du périmètre actuellement déclaré");
  });

  test("throws on a card the schema rejects instead of aggregating it", () => {
    const empty = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (empty.phases as any) = [];
    expect(() => aggregateProgress(empty)).toThrow(/invalid/);
    const negative = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (negative.phases as any)[0].exit_criteria[0].weight = -5;
    expect(() => aggregateProgress(negative)).toThrow(/invalid/);
    expect(() => aggregateProgress(null)).toThrow(/invalid/);
  });

  test("weights aggregate across phases", () => {
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any).push({
      id: "adoption",
      title: "Adoption par un consommateur réel",
      exit_criteria: [
        {
          id: "consumer",
          text: "Un repo de la constellation consomme la git-dep épinglée.",
          weight: 10,
          status: "accepted",
          evidence: { date: "2026-07-29", reference: "PR #1000" },
        },
      ],
    });
    const report = aggregateProgress(card);
    expect(report.computable).toBe(true);
    if (!report.computable) throw new Error("unreachable");
    // accepted 10 over applicable 20
    expect(report.overall_ratio).toBe(0.5);
  });
});

describe("renderStatusSection and its divergence check", () => {
  test("renders a deterministic sentinel-delimited section without any manual percent", () => {
    const card = minimalCard();
    const section = renderStatusSection(card);
    expect(section.startsWith(STATUS_SECTION_BEGIN)).toBe(true);
    expect(section.endsWith(STATUS_SECTION_END)).toBe(true);
    expect(section).toContain("Maturité : usable");
    expect(section).toContain("Exposition : usable-verifiable");
    expect(section).toContain("Confiance : high");
    expect(section).toContain("Preuves vérifiées le : 2026-07-29");
    expect(section).toContain("0 % du périmètre actuellement déclaré");
    expect(renderStatusSection(card)).toBe(section);
  });

  test("unstable scope renders the non-computable message, never a ratio", () => {
    const card = minimalCard();
    card.scope_stability = "unstable";
    const section = renderStatusSection(card);
    expect(section).toContain("Avancement non calculable — périmètre à clarifier");
    expect(section).not.toMatch(/\d+ %/);
  });

  test("checkStatusSection flags a README whose generated section diverges", () => {
    const card = minimalCard();
    const fresh = renderStatusSection(card);
    const readmeInSync = `# Envelope\n\nIntro.\n\n${fresh}\n\nSuite.\n`;
    expect(checkStatusSection(readmeInSync, card)).toEqual([]);
    const tampered = readmeInSync.replace("0 %", "80 %");
    const failures = checkStatusSection(tampered, card);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join("\n")).toContain("diverge");
  });

  test("checkStatusSection flags a README missing the generated section", () => {
    const card = minimalCard();
    const failures = checkStatusSection("# Envelope\n\nNo section here.\n", card);
    expect(failures.length).toBeGreaterThan(0);
  });

  test("checkStatusSection flags a duplicated section pasted after the fresh one", () => {
    const card = minimalCard();
    const fresh = renderStatusSection(card);
    const stale = fresh.replace("0 %", "99 %").replace("high", "low");
    const readme = `# Envelope\n\n${fresh}\n\nProse.\n\n${stale}\n`;
    const failures = checkStatusSection(readme, card);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join("\n")).toContain("dupliqu");
  });

  test("the rendered section carries the honest current situation", () => {
    const card = minimalCard();
    const section = renderStatusSection(card);
    expect(section).toContain("Situation actuelle :");
    expect(section).toContain("Contrat envelope-v1 verrouillé");
  });
});

describe("collectPathReferences", () => {
  function cardWithReference(reference: string): Record<string, unknown> {
    const card = minimalCard();
    // biome-ignore lint/suspicious/noExplicitAny: test mutates raw shapes
    (card.phases as any)[0].exit_criteria = [
      {
        id: "with-ref",
        text: "Un critère adossé à une référence d'évidence.",
        weight: 1,
        status: "accepted",
        evidence: { date: "2026-07-28", reference },
      },
    ];
    return card;
  }

  test("extracts a bare repo path", () => {
    expect(collectPathReferences(cardWithReference("distribution/evidence/some-proof.md"))).toEqual(
      ["distribution/evidence/some-proof.md"],
    );
  });

  test("extracts a path embedded in prose — the house citation style", () => {
    expect(
      collectPathReferences(
        cardWithReference("voir distribution/evidence/some-proof.md (ligne 3)"),
      ),
    ).toEqual(["distribution/evidence/some-proof.md"]);
  });

  test("extracts a ./-prefixed path, an uppercase extension and a directory", () => {
    expect(collectPathReferences(cardWithReference("./docs/adr/0020-act.MD"))).toEqual([
      "docs/adr/0020-act.MD",
    ]);
    expect(collectPathReferences(cardWithReference("docs/reviews/wp-g2-q01"))).toEqual([
      "docs/reviews/wp-g2-q01",
    ]);
  });

  test("strips trailing sentence punctuation from an embedded path", () => {
    expect(
      collectPathReferences(cardWithReference("la preuve vit sous docs/adr/0020-act.md.")),
    ).toEqual(["docs/adr/0020-act.md"]);
  });

  test("ignores PR-style references, fractions and URLs", () => {
    expect(
      collectPathReferences(
        cardWithReference("PR #273, gate-acceptance-log 2026-07-28 (ligne 3.1)"),
      ),
    ).toEqual([]);
    expect(collectPathReferences(cardWithReference("20/80 = 25 % du périmètre"))).toEqual([]);
    expect(
      collectPathReferences(cardWithReference("https://github.com/libre-ai/libre-ai/pull/273")),
    ).toEqual([]);
  });
});
