import { describe, expect, test } from "bun:test";

import { type Brick, type BrickMap, LAYERS, SCHEMA_VERSION } from "../ecosystem/briques";
import { GateReport } from "../tools/quality/gate-report";
import {
  escapeHtml,
  layerDependencies,
  projectVision,
  renderBody,
  renderLayerMatrix,
  renderVisionHtml,
  standingOf,
} from "./build-vision";

/**
 * The vision page is a projection: these tests hold it to what the map says,
 * and to nothing typed in the generator. Each number asserted is read back
 * after the map was changed, so a count written in the template would fail.
 */

function brick(id: string, couche: Brick["couche"], overrides: Partial<Brick> = {}): Brick {
  return {
    id,
    nom: `Brique ${id}`,
    role: "Fait une chose, vérifiable par un tiers.",
    depend_de: [],
    invariants: [],
    decisions: [],
    depots: [],
    origine: { type: "propre" },
    autonomie: "modify",
    preuve: [],
    couche,
    statut: "decrite",
    fiche: [{ title: "Contexte", body: "Un paragraphe.\n\n- un point\n- un autre" }],
    preuves_tenues: 0,
    ...overrides,
  };
}

function mapOf(bricks: readonly Brick[]): BrickMap {
  return {
    schema_version: SCHEMA_VERSION,
    couches: LAYERS.map((layer) => ({
      ...layer,
      briques: bricks.filter((candidate) => candidate.couche === layer.slug),
    })),
    compteurs: {
      briques: bricks.length,
      par_couche: Object.fromEntries(
        LAYERS.map((layer) => [
          layer.slug,
          bricks.filter((candidate) => candidate.couche === layer.slug).length,
        ]),
      ),
      par_statut: {
        decrite: bricks.filter((candidate) => candidate.statut === "decrite").length,
        en_cours: bricks.filter((candidate) => candidate.statut === "en_cours").length,
        prototypee: 0,
        retiree: bricks.filter((candidate) => candidate.statut === "retiree").length,
      },
      par_origine: { inspection: 0, observed: 0, propre: bricks.length },
      par_autonomie: { discover: 0, modify: bricks.length, govern: 0 },
      preuves_locales: 3,
      preuves_epinglees: 5,
      sans_depot_porteur: bricks.length,
      sans_invariant: bricks
        .filter((candidate) => candidate.couche !== "gouvernance")
        .map((candidate) => candidate.id),
      cibles_partagees: 1,
      jetables: 0,
      catalogue_produits: 40,
      produits_en_brique: bricks.filter((candidate) => candidate.couche === "produit").length,
    },
  };
}

const SMALL = mapOf([
  brick("GOV-01", "gouvernance"),
  brick("PRV-01", "preuve", { statut: "en_cours", depend_de: ["GOV-01"] }),
]);

describe("escaping", () => {
  test("every character that opens markup is escaped", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  test("a fiche body is paragraphs and lists; anything else is shown as text", () => {
    const html = renderBody(
      "Un `code` et un <script>alert(1)</script>.\n\n- premier [lien](https://example.org)\n- second\n  suite du second\n\nFin.",
    );
    expect(html).toBe(
      "<p>Un <code>code</code> et un &lt;script&gt;alert(1)&lt;/script&gt;.</p>" +
        "<ul><li>premier [lien](https://example.org)</li><li>second suite du second</li></ul>" +
        "<p>Fin.</p>",
    );
  });

  test("a value of the data never becomes markup, wherever the page prints it", () => {
    const hostile = `"><img src=x onerror=alert(1)>`;
    const map = mapOf([
      brick("GOV-01", "gouvernance", {
        nom: hostile,
        role: `${hostile} dans le rôle, assez long.`,
        depend_de: [hostile],
        invariants: [hostile],
        decisions: [hostile],
        depots: [hostile],
        preuve: [{ date: hostile, cible: hostile }],
        preuve_produite: hostile,
        charte: {
          valeur: hostile,
          pour_qui: hostile,
          degel: hostile,
          abandon: hostile,
          refus: [hostile],
        },
        fiche: [{ title: hostile, body: `${hostile}\n\n- ${hostile}` }],
      }),
    ]);
    const html = renderVisionHtml(map, "proposed");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror=alert(1)>");
    expect(html.split("&quot;&gt;&lt;img").length - 1).toBeGreaterThanOrEqual(12);
  });
});

describe("the page", () => {
  test("carries no script and no inline style: it can be served under a strict policy", () => {
    const html = renderVisionHtml(SMALL, "proposed");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).toContain('<link rel="stylesheet" href="vision.css">');
    expect(html).toContain('<html lang="fr">');
  });

  test("prints the counts of the map it was given, not counts of its own", () => {
    const html = renderVisionHtml(SMALL, "proposed");
    expect(html).toContain("2 briques en 11 couches");
    expect(html).toContain("Preuves tenues : 3 dans ce dépôt, 5 épinglées");
    expect(html).toContain(
      "Le catalogue d'ADR-0042 compte 40 produits : aucun n'est une brique, 40 restent",
    );

    const larger = mapOf([
      brick("GOV-01", "gouvernance"),
      brick("GOV-02", "gouvernance"),
      brick("PRD-02", "produit"),
    ]);
    const other = renderVisionHtml(larger, "proposed");
    expect(other).toContain("3 briques en 11 couches");
    expect(other).toContain("40 produits : 1 est une brique, 39 restent");
  });

  test("shows the status the map derived, and says what each status means", () => {
    const html = renderVisionHtml(SMALL, "proposed");
    expect(html).toContain('<span class="statut statut-en_cours">en cours</span></summary>');
    expect(html).toContain('<span class="statut statut-decrite">décrite</span></summary>');
    expect(html).toContain("cela ne dit pas que la brique fonctionne");
    expect(html).toContain("aucune brique ne peut l&#39;être");
  });

  test("says what ADR-0064 says of itself, in both standings", () => {
    expect(renderVisionHtml(SMALL, "proposed")).toContain("<strong>encore proposé</strong>");
    const accepted = renderVisionHtml(SMALL, "accepted");
    expect(accepted).toContain("Elle applique ADR-0064, accepté.");
    expect(accepted).not.toContain("encore proposé");
  });

  test("names the bricks no invariant binds, or says there are none", () => {
    expect(renderVisionHtml(SMALL, "proposed")).toContain(
      '1 brique hors de la couche gouvernance n\'est liée par aucun invariant : <a href="#PRV-01">',
    );
    const bound = mapOf([brick("GOV-01", "gouvernance")]);
    expect(renderVisionHtml(bound, "proposed")).toContain(
      "Toutes les briques hors de la couche gouvernance citent au moins un invariant.",
    );
  });

  test("links a dependency to the brick it names", () => {
    expect(renderVisionHtml(SMALL, "proposed")).toContain(
      '<dt>Dépend de</dt><dd><a href="#GOV-01"><code>GOV-01</code></a></dd>',
    );
  });

  test("is the same text for the same map", () => {
    expect(renderVisionHtml(SMALL, "proposed")).toBe(renderVisionHtml(SMALL, "proposed"));
  });
});

describe("the layer matrix", () => {
  test("counts the dependencies the bricks declare, layer to layer", () => {
    const map = mapOf([
      brick("GOV-01", "gouvernance"),
      brick("GOV-02", "gouvernance", { depend_de: ["GOV-01"] }),
      brick("PRV-01", "preuve", { depend_de: ["GOV-01", "GOV-02"] }),
      brick("PRV-02", "preuve", { depend_de: ["GOV-01", "PRV-01", "ABSENT-01"] }),
    ]);
    const counts = layerDependencies(map);
    expect(counts.get("preuve")?.get("gouvernance")).toBe(3);
    expect(counts.get("preuve")?.get("preuve")).toBe(1);
    expect(counts.get("gouvernance")?.get("gouvernance")).toBe(1);
    expect(counts.get("gouvernance")?.get("preuve")).toBeUndefined();
  });

  test("has one cell per admitted dependency of ADR-0064 D1, one per layer on the diagonal", () => {
    const html = renderLayerMatrix(SMALL);
    const admitted = LAYERS.reduce((sum, layer) => sum + layer.mayDependOn.length, 0);
    expect(html.split('<td class="admise">').length - 1).toBe(admitted);
    expect(html.split('<td class="interne">').length - 1).toBe(LAYERS.length);
    expect(html.split('<td class="refusee">').length - 1).toBe(
      LAYERS.length * LAYERS.length - LAYERS.length - admitted,
    );
  });

  test("prints the declared count in the cell of its two layers, and a dash where D1 admits none", () => {
    // ADR-0064 D1: identite and passerelle may depend on gouvernance, the first column.
    const html = renderLayerMatrix(
      mapOf([
        brick("GOV-01", "gouvernance"),
        brick("IDN-01", "identite", { depend_de: ["GOV-01"] }),
      ]),
    );
    const row = (slug: string) =>
      html.slice(html.indexOf(`<a href="#couche-${slug}">`)).split("</tr>")[0] ?? "";
    expect(row("identite")).toContain(`</th><td class="admise">1</td>`);
    expect(row("passerelle")).toContain(`</th><td class="admise">0</td>`);
    // gouvernance may depend on no layer.
    expect(row("gouvernance")).toContain(
      `</th><td class="interne">0</td><td class="refusee">—</td>`,
    );
  });

  test("a declared dependency that D1 does not admit is shown as a number, not hidden", () => {
    const map = mapOf([
      brick("GOV-01", "gouvernance", { depend_de: ["PRV-01"] }),
      brick("PRV-01", "preuve"),
    ]);
    expect(renderLayerMatrix(map)).toContain('<td class="refusee">1</td>');
  });
});

describe("the standing of the decision record", () => {
  test("is read from its status line, the way the doctrine gate reads it", () => {
    expect(standingOf("- **Statut :** proposé — l'acceptation est un acte du propriétaire.")).toBe(
      "proposed",
    );
    expect(standingOf("# ADR\n\n- **Statut :** accepted — arbitrage du 2026-12-01.\n")).toBe(
      "accepted",
    );
    expect(standingOf("Le statut passera de proposé à en vigueur.")).toBe("proposed");
  });
});

describe("no page from a red map", () => {
  test("a map with a violation gives no page, and the violations are printed", () => {
    const report = new GateReport().check("PRV-01", false, "proof target x does not exist");
    const projection = projectVision({ map: null, report }, ["- **Statut :** proposé"]);
    expect(projection.ok).toBe(false);
    if (!projection.ok) {
      expect(projection.lines).toEqual([
        "Vision: PRV-01: proof target x does not exist",
        "Vision not generated: the brick map has 1 violation(s), and a page is never generated from a red map.",
      ]);
    }
  });

  test("a decision record that is not exactly one tracked file gives no page", () => {
    const report = new GateReport().check("GOV-01", true, "decrite, 0 proof(s) held");
    for (const texts of [[], ["a", "b"]]) {
      const projection = projectVision({ map: SMALL, report }, texts);
      expect(projection.ok).toBe(false);
      if (!projection.ok) {
        expect(projection.lines[0]).toContain(`${texts.length} tracked file(s) carry the number`);
      }
    }
  });

  test("a green map and one decision record give the page", () => {
    const report = new GateReport().check("GOV-01", true, "decrite, 0 proof(s) held");
    const projection = projectVision({ map: SMALL, report }, ["- **Statut :** proposé"]);
    expect(projection.ok).toBe(true);
    if (projection.ok) {
      expect(projection.html).toBe(renderVisionHtml(SMALL, "proposed"));
      expect(projection.summary).toContain("2 brick(s) in 11 layer(s), ADR-0064 proposed");
    }
  });
});
