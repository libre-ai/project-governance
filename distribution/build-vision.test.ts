import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Brick,
  type BrickMap,
  type Counters,
  LAYERS,
  SCHEMA_VERSION,
} from "../ecosystem/briques";
import { GateReport } from "../tools/quality/gate-report";
import {
  escapeHtml,
  layerDependencies,
  projectVision,
  readDecisionRecords,
  renderBody,
  renderLayerMatrix,
  renderVisionHtml,
  standingOf,
} from "./build-vision";

/**
 * The vision page is a projection: these tests hold it to what the map says,
 * and to nothing typed in the generator. Every count is asserted on a value no
 * template would carry, and every field of a brick on a marker of its own, so
 * a count written in the page or a field dropped from it turns a test red.
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

function mapOf(bricks: readonly Brick[], counters: Partial<Counters> = {}): BrickMap {
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
      cibles_partagees: 2,
      jetables: 0,
      catalogue_produits: 40,
      produits_en_brique: bricks.filter((candidate) => candidate.couche === "produit").length,
      ...counters,
    },
  };
}

const SMALL = mapOf([
  brick("GOV-01", "gouvernance"),
  brick("IDN-01", "identite", { statut: "en_cours", depend_de: ["GOV-01"] }),
]);

/** A value that is markup if it is printed raw, and that names the field it was put in. */
const marker = (field: string) => `<x-${field} a="1">`;
const escaped = (field: string) => `&lt;x-${field} a=&quot;1&quot;&gt;`;

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

  test("every field of a brick is printed, and none of them becomes markup", () => {
    const fields = [
      "id",
      "nom",
      "role",
      "depend",
      "invariant",
      "decision",
      "depot",
      "origine-type",
      "origine-source",
      "origine-date",
      "autonomie",
      "preuve-date",
      "preuve-cible",
      "preuve-produite",
      "valeur",
      "pour-qui",
      "degel",
      "abandon",
      "refus",
      "jetable",
      "retrait-decision",
      "retrait-date",
      "fiche-titre",
      "fiche-paragraphe",
      "fiche-item",
      "sans-invariant",
    ];
    const hostile = brick(marker("id"), "gouvernance", {
      nom: marker("nom"),
      role: marker("role"),
      depend_de: [marker("depend")],
      invariants: [marker("invariant")],
      decisions: [marker("decision")],
      depots: [marker("depot")],
      // The schema bounds these two to a few words; the page must not rely on it.
      origine: {
        type: marker("origine-type") as Brick["origine"]["type"],
        source: marker("origine-source"),
        date: marker("origine-date"),
      },
      autonomie: marker("autonomie") as Brick["autonomie"],
      preuve: [{ date: marker("preuve-date"), cible: marker("preuve-cible") }],
      preuve_produite: marker("preuve-produite"),
      charte: {
        valeur: marker("valeur"),
        pour_qui: marker("pour-qui"),
        degel: marker("degel"),
        abandon: marker("abandon"),
        refus: [marker("refus")],
      },
      jetable: marker("jetable"),
      retrait: { decision: marker("retrait-decision"), date: marker("retrait-date") },
      fiche: [
        {
          title: marker("fiche-titre"),
          body: `${marker("fiche-paragraphe")}\n\n- ${marker("fiche-item")}`,
        },
      ],
    });
    const html = renderVisionHtml(
      mapOf([hostile], { sans_invariant: [marker("sans-invariant")] }),
      "proposed",
    );
    expect(html).not.toContain("<x-");
    for (const field of fields) {
      expect({ field, printed: html.includes(escaped(field)) }).toEqual({ field, printed: true });
    }
  });

  test("a layer slug or a status that is not one of the known values does not become markup", () => {
    const map = mapOf([brick("GOV-01", "gouvernance", { statut: marker("statut") as never })]);
    const hostile: BrickMap = {
      ...map,
      couches: map.couches.map((layer) =>
        layer.slug === "gouvernance"
          ? { ...layer, slug: marker("slug") as never, ownRuleVerifiedOnly: marker("part") }
          : layer,
      ),
    };
    const html = renderVisionHtml(hostile, "proposed");
    expect(html).not.toContain("<x-");
    expect(html).toContain(`href="#couche-${escaped("slug")}"`);
    expect(html).toContain(`id="couche-${escaped("slug")}"`);
    expect(html).toContain(`statut-${escaped("statut")}`);
    expect(html).toContain(`vérifiée par le gate ${escaped("part")}</span>`);
  });

  test("a blank line separates two paragraphs, and two lines of one paragraph are joined", () => {
    expect(renderBody("Une ligne\nsa suite.\n\nUn autre paragraphe.")).toBe(
      "<p>Une ligne sa suite.</p><p>Un autre paragraphe.</p>",
    );
  });

  test("a paragraph that follows a list without a blank line is a paragraph, after the list", () => {
    expect(renderBody("Avant.\n- un point\nAprès.")).toBe(
      "<p>Avant.</p><ul><li>un point</li></ul><p>Après.</p>",
    );
  });
});

describe("the page", () => {
  test("carries no script and no inline style: it can be served under a strict policy", () => {
    const html = renderVisionHtml(SMALL, "proposed");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).toContain('<link rel="stylesheet" href="vision.css">');
    expect(html).toContain('<html lang="fr">');
  });

  test("prints every count of the map it was given, on values no template carries", () => {
    const html = renderVisionHtml(
      mapOf(
        [
          brick("GOV-01", "gouvernance"),
          brick("GOV-02", "gouvernance"),
          brick("GOV-03", "gouvernance"),
        ],
        {
          briques: 131,
          par_statut: { decrite: 141, en_cours: 142, prototypee: 143, retiree: 144 },
          preuves_locales: 151,
          preuves_epinglees: 152,
          cibles_partagees: 153,
          sans_depot_porteur: 154,
          catalogue_produits: 160,
          produits_en_brique: 7,
        },
      ),
      "proposed",
    );
    expect(html).toContain("131 briques en 11 couches");
    for (const [status, value] of [
      ["decrite", 141],
      ["en_cours", 142],
      ["prototypee", 143],
      ["retiree", 144],
    ]) {
      expect(html).toMatch(
        new RegExp(`statut-${status}">[^<]+</span></th><td class="nombre">${value}</td>`),
      );
    }
    expect(html).toContain(
      "Preuves tenues : 151 dans ce dépôt, 152 sous la forme d'une citation épinglée",
    );
    expect(html).toContain("153 cibles de preuve sont citées par plus d'une brique");
    expect(html).toContain("154 briques n'ont aucun dépôt porteur");
    expect(html).toContain(
      "Le catalogue d'ADR-0042 compte 160 produits : 7 sont des briques, 153 restent hors de la carte",
    );
    // The count of a layer is the number of its bricks, in its heading and in its row.
    expect(html).toContain('gouvernance <span class="compte">3 briques</span>');
    expect(html).toMatch(
      /<a href="#couche-gouvernance">gouvernance<\/a><\/th>(<td>[^\n]*?<\/td>){3}<td class="nombre">3<\/td>/,
    );
    expect(html).toContain('fabrique <span class="compte">0 brique</span>');
  });

  test("agrees a count of one in the singular", () => {
    const html = renderVisionHtml(
      mapOf([brick("PRD-02", "produit")], {
        cibles_partagees: 1,
        sans_depot_porteur: 1,
        catalogue_produits: 1,
      }),
      "proposed",
    );
    expect(html).toContain("1 brique en 11 couches");
    expect(html).toContain("1 cible de preuve est citée par plus d'une brique");
    expect(html).toContain("1 brique n'a aucun dépôt porteur");
    expect(html).toContain("compte 1 produit : 1 est une brique, 0 reste hors de la carte");
    expect(html).toContain("1 brique hors de la couche gouvernance n'est liée par aucun invariant");
    expect(renderVisionHtml(mapOf([]), "proposed")).toContain(
      "40 produits : aucun n'est une brique, 40 restent",
    );
  });

  test("shows the status the map derived, and says what each status means", () => {
    const html = renderVisionHtml(SMALL, "proposed");
    expect(html).toContain('<span class="statut statut-en_cours">en cours</span></summary>');
    expect(html).toContain('<span class="statut statut-decrite">décrite</span></summary>');
    expect(html).toContain("cela ne dit pas que la brique fonctionne");
    expect(html).toContain("aucune brique ne peut l&#39;être");
  });

  test("says of each layer rule what the gate does with it, and which part when it is a part", () => {
    const html = renderVisionHtml(SMALL, "proposed");
    const rule = (slug: string) =>
      /<span class="regle">([^<]*)<\/span>/.exec(
        html.slice(html.lastIndexOf(`<tr><th scope="row"><a href="#couche-${slug}">`)),
      )?.[1];
    // ecosystem/briques.ts: gouvernance is verified for its first half only, fabrique whole, harness not.
    expect(rule("gouvernance")).toBe(
      "vérifiée par le gate pour sa première moitié seulement ; la seconde est comptée et ne bloque pas",
    );
    expect(rule("fabrique")).toBe("vérifiée par le gate");
    expect(rule("harness")).toBe("déclarative, non vérifiée");
    for (const layer of LAYERS) {
      expect({ slug: layer.slug, verified: rule(layer.slug)?.startsWith("vérifiée") }).toEqual({
        slug: layer.slug,
        verified: layer.ownRuleVerified,
      });
    }
  });

  test("says what ADR-0064 says of itself, in both standings", () => {
    expect(renderVisionHtml(SMALL, "proposed")).toContain("<strong>encore proposé</strong>");
    const accepted = renderVisionHtml(SMALL, "accepted");
    expect(accepted).toContain("Elle applique ADR-0064, accepté.");
    expect(accepted).not.toContain("encore proposé");
  });

  test("names the bricks no invariant binds, or says there are none", () => {
    expect(renderVisionHtml(SMALL, "proposed")).toContain(
      '1 brique hors de la couche gouvernance n\'est liée par aucun invariant : <a href="#IDN-01">',
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

  test("keeps every table a table, inside a named region that scrolls", () => {
    const html = renderVisionHtml(SMALL, "proposed");
    const tables = html.split("<table").length - 1;
    expect(tables).toBe(3);
    expect(html.match(/<section class="defilante" aria-label="[^"]+"><table/g)?.length).toBe(
      tables,
    );
  });

  test("is the same text for the same map", () => {
    expect(renderVisionHtml(SMALL, "proposed")).toBe(renderVisionHtml(SMALL, "proposed"));
  });

  test("counts the layers of the map it was given", () => {
    const two: BrickMap = { ...SMALL, couches: SMALL.couches.slice(0, 2) };
    expect(renderVisionHtml(two, "proposed")).toContain("en 2 couches");
  });

  test("agrees the bricks no invariant binds in the plural when there are several", () => {
    const html = renderVisionHtml(
      mapOf([brick("IDN-01", "identite"), brick("IDN-02", "identite")]),
      "proposed",
    );
    expect(html).toContain(
      '2 briques hors de la couche gouvernance ne sont liées par aucun invariant : <a href="#IDN-01"><code>IDN-01</code></a>, <a href="#IDN-02">',
    );
  });

  test("says of an empty field that it is empty", () => {
    const html = renderVisionHtml(mapOf([brick("GOV-01", "gouvernance")]), "proposed");
    expect(html).toContain("<dt>Dépend de</dt><dd>aucune</dd>");
    expect(html).toContain("<dt>Invariants qui la lient</dt><dd>aucun</dd>");
    expect(html).toContain("<dt>Décisions</dt><dd>aucune</dd>");
    expect(html).toContain("<dt>Dépôts porteurs</dt><dd>aucun</dd>");
    expect(html).toContain("<h4>Preuves datées</h4><p>Preuve citée : aucune.</p>");
  });

  test("gives each layer its role, the layers it may depend on by their name, and its rule", () => {
    const html = renderVisionHtml(SMALL, "proposed");
    const labelOf = (slug: string) => LAYERS.find((layer) => layer.slug === slug)?.label ?? "";
    for (const layer of LAYERS) {
      const row =
        html
          .slice(html.lastIndexOf(`<tr><th scope="row"><a href="#couche-${layer.slug}">`))
          .split("</tr>")[0] ?? "";
      const allowed =
        layer.mayDependOn.length === 0 ? "aucune" : layer.mayDependOn.map(labelOf).join(", ");
      // A rule is written with code spans, like a fiche: `exécution` is shown as code.
      const rule = escapeHtml(layer.ownRule).replace(/`([^`]+)`/g, "<code>$1</code>");
      expect(row).toContain(
        `${escapeHtml(layer.label)}</a></th><td>${escapeHtml(layer.role)}</td><td>${escapeHtml(allowed)}</td><td>${rule} <span class="regle">`,
      );
    }
    // The name of ADR-0064 D1, not the ASCII slug of the file: « identité », « exécution ».
    expect(html).toContain("<td>identité, gouvernance</td>");
  });

  test("gives every header cell its scope", () => {
    const html = renderVisionHtml(SMALL, "proposed");
    // `<th ` or `<th>`, never `<thead>`.
    const headers = html.match(/<th[ >]/g)?.length ?? 0;
    expect(headers).toBeGreaterThan(40);
    expect(html.match(/<th scope="(?:col|row)">/g)?.length).toBe(headers);
  });

  test("puts each brick on a line of its own, so two changes do not meet on one line", () => {
    const html = renderVisionHtml(
      mapOf([brick("GOV-01", "gouvernance"), brick("GOV-02", "gouvernance")]),
      "proposed",
    );
    const lines = html.split("\n").filter((line) => line.includes('<details class="brique"'));
    expect(lines.length).toBe(2);
    expect(lines.every((line) => line.startsWith("<details") && line.endsWith("</details>"))).toBe(
      true,
    );
  });

  test("carries its fixed text: what a status means, what the matrix shows, who decides", () => {
    const html = renderVisionHtml(SMALL, "proposed");
    for (const sentence of [
      '<meta name="robots" content="noindex">',
      "Ni les comptes, ni les statuts, ni les fiches n'y sont saisis",
      "son texte fixe (titres, légendes, sens de chaque statut) est écrit dans le générateur",
      "son acceptation est un acte du propriétaire",
      '<span class="statut statut-decrite">décrite</span></th><td class="nombre">1</td><td>une fiche et des données, aucune preuve</td>',
      '<span class="statut statut-en_cours">en cours</span></th><td class="nombre">1</td><td>au moins une preuve datée est citée et tient : un fichier suivi de ce dépôt, ou une citation épinglée, que le gate des citations résout de son côté ; cela ne dit pas que la brique fonctionne</td>',
      '<span class="statut statut-prototypee">prototypée</span></th><td class="nombre">0</td><td>une release signée liée à son évidence ; aucun instrument ne la vérifie encore, donc aucune brique ne peut l&#39;être</td>',
      '<span class="statut statut-retiree">retirée</span></th><td class="nombre">0</td><td>retirée par une décision du registre, fiche conservée</td>',
      "<caption>Une ligne est une couche ; une colonne est une couche dont ses briques pourraient dépendre. " +
        "Un nombre, zéro compris, dans une cellule encadrée : la dépendance est admise par la table d'ADR-0064 D1, et c'est le nombre de dépendances que les briques déclarent. " +
        "Un tiret : la dépendance n'est pas admise, et aucune brique ne la déclare. " +
        "Sur la diagonale, là où la ligne et la colonne portent le même nom, en italique : les dépendances entre briques d'une même couche, que la table ne borne pas.</caption>",
      "C'est la liste de ce que la doctrine ne porte pas encore.",
    ]) {
      expect({ sentence, printed: html.includes(sentence) }).toEqual({ sentence, printed: true });
    }
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
    const html = renderLayerMatrix(SMALL);
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

  test("prints on the diagonal the dependencies between bricks of one layer", () => {
    const html = renderLayerMatrix(
      mapOf([
        brick("GOV-01", "gouvernance"),
        brick("GOV-02", "gouvernance", { depend_de: ["GOV-01"] }),
        brick("GOV-03", "gouvernance", { depend_de: ["GOV-01"] }),
      ]),
    );
    expect(html).toContain(
      '<a href="#couche-gouvernance">gouvernance</a></th><td class="interne">2</td>',
    );
  });

  test("gives its header cells a scope, and its columns the name of the layer", () => {
    const html = renderLayerMatrix(SMALL);
    expect(html).toContain(
      '<th scope="col">dépend de →</th><th scope="col"><span>gouvernance</span></th>',
    );
    expect(html).toContain('<th scope="col"><span>identité</span></th>');
    expect(html.split('<tr><th scope="row"><a href="#couche-').length - 1).toBe(LAYERS.length);
  });
});

describe("the standing of the decision record", () => {
  test("is the first word of its one status line", () => {
    expect(standingOf("- **Statut :** proposé — l'acceptation est un acte du propriétaire.")).toBe(
      "proposed",
    );
    expect(standingOf("# ADR\n\n- **Statut :** accepted — arbitrage du 2026-12-01.\n")).toBe(
      "accepted",
    );
    expect(standingOf("- **Statut :** accepted, superseded in part by ADR-0006")).toBe("accepted");
  });

  test("is not read from a line that only names the word", () => {
    // The status line of ADR-0064 itself says « de proposé à en vigueur »; a note may say « accepted ».
    expect(
      standingOf(
        "- **Statut :** proposé — le propriétaire fait passer ce statut de proposé à accepted.\n\nCet ADR ne sera accepted qu'après la revue.",
      ),
    ).toBe("proposed");
    expect(standingOf("- **Statut :** proposé, not yet accepted")).toBe("proposed");
  });

  test("is unknown when the record says anything else, nothing, or twice", () => {
    expect(standingOf("- **Statut :** deferred (2026-08-18)")).toBeNull();
    expect(standingOf("- **Statut :** en vigueur")).toBeNull();
    expect(standingOf("- **Statut :** retiré par D120")).toBeNull();
    expect(standingOf("Le statut passera de proposé à accepted.")).toBeNull();
    expect(standingOf("- **Statut :** proposé\n- **Statut :** accepted")).toBeNull();
    expect(standingOf("- **Statut :** Accepted")).toBeNull();
    expect(standingOf("- **Statut :** accepté")).toBeNull();
    expect(standingOf("- **Statut :** acceptedly")).toBeNull();
  });

  test("reads the English word of a proposed record too", () => {
    expect(standingOf("- **Statut :** proposed — awaiting the owner.")).toBe("proposed");
  });

  test("is read at the start of a line only: a quoted status line is not the status", () => {
    expect(standingOf("> - **Statut :** accepted")).toBeNull();
    expect(
      standingOf("- **Statut :** proposé\n\nL'ancienne ligne disait : - **Statut :** accepted"),
    ).toBe("proposed");
  });
});

describe("the decision record is read from the index", () => {
  let root: string;
  const git = (...args: string[]) => {
    const done = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (done.exitCode !== 0) throw new Error(new TextDecoder().decode(done.stderr));
  };
  const record = (name: string) => join(root, "docs/adr", name);

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "build-vision-"));
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    git("init", "--quiet");
    writeFileSync(record("0064-brick-map.md"), "- **Statut :** proposé\n");
    writeFileSync(record("0063-other.md"), "- **Statut :** accepted\n");
    writeFileSync(record("10064-not-this-one.md"), "- **Statut :** accepted\n");
    git("add", "--all");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("only the record that carries the number, and as git tracks it", () => {
    expect(readDecisionRecords(root)).toEqual(["- **Statut :** proposé\n"]);
  });

  test("an edit that is not staged does not change what is read; staged, it does", () => {
    writeFileSync(record("0064-brick-map.md"), "- **Statut :** accepted\n");
    expect(readDecisionRecords(root)).toEqual(["- **Statut :** proposé\n"]);
    git("add", "--all");
    expect(readDecisionRecords(root)).toEqual(["- **Statut :** accepted\n"]);
  });

  test("an untracked file with the number is not read; tracked, both are returned", () => {
    writeFileSync(record("0064-a-second-one.md"), "- **Statut :** proposé\n");
    expect(readDecisionRecords(root).length).toBe(1);
    git("add", "--all");
    expect(readDecisionRecords(root).length).toBe(2);
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
    for (const texts of [[], ["- **Statut :** proposé", "- **Statut :** proposé"]]) {
      const projection = projectVision({ map: SMALL, report }, texts);
      expect(projection.ok).toBe(false);
      if (!projection.ok) {
        expect(projection.lines[0]).toContain(`${texts.length} tracked file(s) carry the number`);
      }
    }
  });

  test("a decision record whose standing the page cannot say gives no page", () => {
    const report = new GateReport().check("GOV-01", true, "decrite, 0 proof(s) held");
    const projection = projectVision({ map: SMALL, report }, ["- **Statut :** deferred"]);
    expect(projection.ok).toBe(false);
    if (!projection.ok) {
      expect(projection.lines[0]).toContain("does not carry exactly one status line");
    }
  });

  test("a green map and one decision record give the page", () => {
    const report = new GateReport().check("GOV-01", true, "decrite, 0 proof(s) held");
    for (const [line, standing] of [
      ["- **Statut :** proposé", "proposed"],
      ["- **Statut :** accepted", "accepted"],
    ] as const) {
      const projection = projectVision({ map: SMALL, report }, [line]);
      expect(projection.ok).toBe(true);
      if (projection.ok) {
        expect(projection.html).toBe(renderVisionHtml(SMALL, standing));
        expect(projection.summary).toContain(`2 brick(s) in 11 layer(s), ADR-0064 ${standing}`);
      }
    }
  });
});
