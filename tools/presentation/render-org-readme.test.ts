import { describe, expect, test } from "bun:test";

import { renderOrgSection, summarizeMigration } from "./render-org-readme";

const status = {
  schema_version: "libre-ai.fleet-status.v1" as const,
  source: "project.v1.yaml cards at each repository main" as const,
  rows: [
    {
      repository: "libre-ai/notebook",
      project: "notebook",
      kind: "product",
      layer: "couche-1",
      summary: "Espace de connaissances local.",
      display: "20 % du périmètre actuellement déclaré",
      maturity: "usable",
      confidence: "medium",
      exposure: "spec-published",
      last_verified_on: "2026-07-30",
    },
    {
      repository: "libre-ai/envelope",
      project: "envelope",
      kind: "satellite",
      layer: "couche-3",
      summary: "Enveloppe d'API canonique.",
      display: "100 % du périmètre actuellement déclaré",
      maturity: "usable",
      confidence: "medium",
      exposure: "spec-published",
      last_verified_on: "2026-07-30",
    },
  ],
};

describe("renderOrgSection", () => {
  test("groups by layer and always states the hub dismantling progress", () => {
    const migration = summarizeMigration(
      "hub_state: dismantling-in-progress\nentries:\n  - hub_removal_commit: pending\n  - hub_removal_commit: abc123\n",
    );
    const section = renderOrgSection(status, migration);
    expect(section).toContain("### Produits (couche 1)");
    expect(section).toContain("### Briques structurantes (couche 3)");
    expect(section).toContain("[notebook](https://github.com/libre-ai/notebook)");
    expect(section).toContain("1/2 chemins tracés à l'index de migration ont quitté le hub");
    expect(section).toContain("en démantèlement");
    // Never the lifecycle alone: the hub row is the dismantling sentence.
    expect(section).not.toContain("| hub |");
  });

  test("states the archived hub in French, never the raw lifecycle token", () => {
    const migration = summarizeMigration(
      "hub_state: archived\nentries:\n  - hub_removal_commit: pending\n  - hub_removal_commit: abc123\n",
    );
    const section = renderOrgSection(status, migration);
    expect(section).toContain("est archivé");
    // The public landing page is French prose: an untranslated enum leaks the
    // machine vocabulary into the shop window.
    expect(section).not.toContain("est archived");
  });
  test("the heading follows the state, not only the sentence", () => {
    // A mutation of the heading ternary survived the first version of this
    // test: it asserted the sentence and never looked at the section title.
    const archived = summarizeMigration(
      "hub_state: archived\nentries:\n  - hub_removal_commit: abc123\n",
    );
    expect(renderOrgSection(status, archived)).toContain("### Moyeu archivé");
    expect(renderOrgSection(status, archived)).not.toContain("### Moyeu en démantèlement");

    const open = summarizeMigration(
      "hub_state: dismantling-in-progress\nentries:\n  - hub_removal_commit: pending\n",
    );
    expect(renderOrgSection(status, open)).toContain("### Moyeu en démantèlement");
    expect(renderOrgSection(status, open)).not.toContain("### Moyeu archivé");
  });

  test("a lifecycle nobody wrote copy for is refused, never rendered raw", () => {
    // The previous fallback printed the machine token under the wrong heading:
    // the same defect the French label closed, moved one state along.
    const unknown = summarizeMigration(
      "hub_state: dismantled\nentries:\n  - hub_removal_commit: abc123\n",
    );
    expect(() => renderOrgSection(status, unknown)).toThrow(/dismantled/);
  });
});
