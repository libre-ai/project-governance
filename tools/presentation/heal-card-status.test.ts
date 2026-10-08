import { describe, expect, test } from "bun:test";
import {
  renderStatusSection,
  STATUS_SECTION_BEGIN,
  STATUS_SECTION_END,
} from "../../ecosystem/project-cards";
import { healCardStatus, insertUnderHeading } from "./heal-card-status";

// Forme reprise de `ecosystem/check-fleet-presentation.test.ts` : `project` est un
// slug et `statement` un objet, deux contraintes que le schéma porte et qu'une
// fixture inventée rate — `aggregateProgress` l'a refusée.
const CARD_YAML = `schema_version: libre-ai.project.v1
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
summary: "Brique de démonstration du guérisseur."
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

const card = Bun.YAML.parse(CARD_YAML);

const section = renderStatusSection(card);

describe("healCardStatus — replacing is a pure function of the card", () => {
  test("a stale section is replaced byte for byte with the render", () => {
    const readme = `# Titre\n\n## État\n\n${STATUS_SECTION_BEGIN}\nstale\n${STATUS_SECTION_END}\n\n## Suite\n`;
    const outcome = healCardStatus(readme, card);
    expect(outcome.kind).toBe("replaced");
    if (outcome.kind !== "replaced") return;
    expect(outcome.readme).toContain(section);
    // Everything outside the sentinels is untouched.
    expect(outcome.readme.startsWith("# Titre\n\n## État\n\n")).toBe(true);
    expect(outcome.readme.endsWith("\n\n## Suite\n")).toBe(true);
  });

  test("a section already equal to the render is unchanged, so --check can prove a no-op", () => {
    const readme = `# Titre\n\n## État\n\n${section}\n\n## Suite\n`;
    const outcome = healCardStatus(readme, card);
    expect(outcome.kind).toBe("unchanged");
  });
});

describe("healCardStatus — where a FIRST section goes is not a function of the card", () => {
  // The three repositories that already carry one chose their own heading:
  // `## État vérifié` in signalement, `## État du projet` in carriere. Guessing
  // it would be this tool deciding how a repository presents itself.
  test("no sentinel pair and no --under is refused, and the message says what is needed", () => {
    const outcome = healCardStatus("# Titre\n\n## État du projet\n\nProse.\n", card);
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toMatch(/--under/);
    expect(outcome.reason).toMatch(/presentation choice this tool will not make/);
  });

  test("with --under naming an existing heading, the section is inserted after it", () => {
    const readme = "# Titre\n\n## État du projet\n\nProse.\n\n## Suite\n";
    const outcome = healCardStatus(readme, card, "## État du projet");
    expect(outcome.kind).toBe("inserted");
    if (outcome.kind !== "inserted") return;
    const lines = outcome.readme.split("\n");
    expect(lines[2]).toBe("## État du projet");
    expect(lines[4]).toBe(STATUS_SECTION_BEGIN);
    expect(outcome.readme).toContain("Prose.");
    expect(outcome.readme).toContain("## Suite");
  });

  test("a heading that is absent is refused rather than appended somewhere", () => {
    const outcome = healCardStatus("# Titre\n\n## Autre\n", card, "## État du projet");
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toMatch(/exactly once/);
  });

  test("a heading that repeats is refused: two candidates is a choice", () => {
    const readme = "# Titre\n\n## État\n\na\n\n## État\n\nb\n";
    const outcome = healCardStatus(readme, card, "## État");
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toMatch(/exactly once/);
  });
});

describe("healCardStatus — refusals that protect the gate's own rules", () => {
  test("a duplicated sentinel pair is refused, never silently reduced to one", () => {
    const readme = `${STATUS_SECTION_BEGIN}\na\n${STATUS_SECTION_END}\n${STATUS_SECTION_BEGIN}\nb\n${STATUS_SECTION_END}\n`;
    const outcome = healCardStatus(readme, card);
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toMatch(/one pair is admitted/);
  });

  test("a card that cannot render is refused with the render's own message", () => {
    const outcome = healCardStatus("# Titre\n", { schema_version: "libre-ai.project.v1" });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toMatch(/does not render/);
  });
});

describe("insertUnderHeading", () => {
  test("collapses the blank lines that followed the heading, leaving exactly one each side", () => {
    const out = insertUnderHeading("## H\n\n\n\nbody\n", "SECTION", "## H");
    expect(out).toBe("## H\n\nSECTION\n\nbody\n");
  });

  test("matches a whole line, never a heading that merely contains the text", () => {
    expect(
      insertUnderHeading("## État du projet bis\n\nbody\n", "S", "## État du projet"),
    ).toBeNull();
  });
});
