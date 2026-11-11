/**
 * Vision page generator (ADR-0064 D6).
 *
 * The page is a projection of the brick map, never an authority: everything it
 * shows comes from `checkBriques`, the same evaluation the gate runs. Nothing
 * is typed here — no count, no status, no list of layers. A map with a single
 * violation gives no page: the generator exits non-zero and prints the
 * violations, because a page generated from a red map would publish a status
 * nobody derived.
 *
 * Determinism contract (same as `build-feeds.ts`): no execution timestamp,
 * the order is the order of the map, so the committed page changes only when
 * the map or this generator changes, and a regeneration diff in CI is a drift
 * signal.
 *
 * The page is static: no script, no inline style, one hand-written stylesheet
 * next to it (`vision.css`), so it can be served under a strict content
 * security policy. It is a file of this repository and no site serves it:
 * putting it on a site is a separate act. French first, by owner decision of
 * 2026-11-09.
 *
 * Usage: bun distribution/build-vision.ts
 * Writes: distribution/vision/index.html
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type Brick,
  type BrickMap,
  type BriquesOutcome,
  LAYERS,
  type LayerSlug,
  STATUSES,
  type Status,
} from "../ecosystem/briques";
import { checkBriques } from "../ecosystem/check-briques";

/** The decision record the map applies; its standing is read from its file. */
const DECISION = "ADR-0064";

/** What the page says of the decision record it applies, read from that record. */
export type AdrStanding = "accepted" | "proposed";

const STATUS_LABEL: Readonly<Record<Status, string>> = {
  decrite: "décrite",
  en_cours: "en cours",
  prototypee: "prototypée",
  retiree: "retirée",
};

const STATUS_MEANING: Readonly<Record<Status, string>> = {
  decrite: "une fiche et des données, aucune preuve",
  en_cours: "au moins un artefact daté existe ; cela ne dit pas que la brique fonctionne",
  prototypee:
    "une release signée liée à son évidence ; aucun instrument ne la vérifie encore, donc aucune brique ne peut l'être",
  retiree: "retirée par une décision du registre, fiche conservée",
};

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Escaped text, with `code spans` as the only inline form a fiche keeps. */
function inline(text: string): string {
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * The body of a fiche section: paragraphs and `- ` lists, everything escaped.
 * A fiche is Markdown, but the page renders none of it beyond these two
 * blocks: a link or a tag written in a fiche is shown as text, never emitted.
 */
export function renderBody(body: string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push(`<p>${inline(paragraph.join(" "))}</p>`);
    if (items.length > 0) {
      blocks.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
    }
    paragraph = [];
    items = [];
  };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) {
      flush();
    } else if (line.startsWith("- ")) {
      // No flush here: a pending paragraph always precedes the items, and `flush` emits it first.
      items.push(line.slice(2));
    } else if (items.length > 0 && raw.startsWith("  ")) {
      items[items.length - 1] = `${items.at(-1)} ${line}`;
    } else {
      if (items.length > 0) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks.join("");
}

/**
 * How many dependencies the bricks of one layer declare on the bricks of
 * another: `counts.get(from)?.get(to)`. Counted from the map, pair by pair.
 */
export function layerDependencies(map: BrickMap): Map<LayerSlug, Map<LayerSlug, number>> {
  const layerOf = new Map<string, LayerSlug>();
  for (const layer of map.couches) {
    for (const brick of layer.briques) layerOf.set(brick.id, layer.slug);
  }
  const counts = new Map<LayerSlug, Map<LayerSlug, number>>();
  for (const layer of map.couches) {
    const row = new Map<LayerSlug, number>();
    for (const brick of layer.briques) {
      for (const dependency of brick.depend_de) {
        const target = layerOf.get(dependency);
        if (target !== undefined) row.set(target, (row.get(target) ?? 0) + 1);
      }
    }
    counts.set(layer.slug, row);
  }
  return counts;
}

/**
 * The layer graph of ADR-0064 D1 as its adjacency matrix: a row is a layer, a
 * column is a layer it may depend on. Drawn as nodes and lines, the same graph
 * is a tangle nobody reads; as a matrix, each admitted dependency is one cell,
 * and the cell carries the number of dependencies the bricks declare.
 */
export function renderLayerMatrix(map: BrickMap): string {
  const counts = layerDependencies(map);
  const head = map.couches
    .map((layer) => `<th scope="col"><span>${escapeHtml(layer.label)}</span></th>`)
    .join("");
  const rows = map.couches
    .map((layer) => {
      const cells = map.couches
        .map((target) => {
          const declared = counts.get(layer.slug)?.get(target.slug) ?? 0;
          if (target.slug === layer.slug) return `<td class="interne">${declared}</td>`;
          return layer.mayDependOn.includes(target.slug)
            ? `<td class="admise">${declared}</td>`
            : `<td class="refusee">${declared === 0 ? "—" : declared}</td>`;
        })
        .join("");
      return `<tr><th scope="row"><a href="#couche-${layer.slug}">${escapeHtml(layer.label)}</a></th>${cells}</tr>`;
    })
    .join("");
  return (
    `<table class="matrice"><caption>Une ligne est une couche ; une colonne est une couche dont ses briques peuvent dépendre. ` +
    `Un nombre : la dépendance est admise par la table d'ADR-0064 D1, et c'est le nombre de dépendances que les briques déclarent. ` +
    `Un tiret : la dépendance n'est pas admise. Sur la diagonale : les dépendances entre briques d'une même couche, que la table ne borne pas.</caption>` +
    `<thead><tr><th scope="col">dépend de →</th>${head}</tr></thead><tbody>${rows}</tbody></table>`
  );
}

function list(values: readonly string[], empty: string): string {
  return values.length === 0
    ? empty
    : values.map((value) => `<code>${escapeHtml(value)}</code>`).join(", ");
}

function renderBrick(brick: Brick): string {
  const dependencies =
    brick.depend_de.length === 0
      ? "aucune"
      : brick.depend_de
          .map((id) => `<a href="#${escapeHtml(id)}"><code>${escapeHtml(id)}</code></a>`)
          .join(", ");
  const proofs =
    brick.preuve.length === 0
      ? "<p>Preuve citée : aucune.</p>"
      : `<ul>${brick.preuve
          .map(
            (proof) =>
              `<li><time datetime="${escapeHtml(proof.date)}">${escapeHtml(proof.date)}</time> — <code>${escapeHtml(proof.cible)}</code></li>`,
          )
          .join("")}</ul>`;
  const charter =
    brick.charte === undefined
      ? ""
      : `<h4>Charte</h4><dl>` +
        `<dt>Valeur</dt><dd>${inline(brick.charte.valeur)}</dd>` +
        `<dt>Pour qui</dt><dd>${inline(brick.charte.pour_qui)}</dd>` +
        `<dt>Fait de dégel</dt><dd>${inline(brick.charte.degel)}</dd>` +
        `<dt>Fait d'abandon</dt><dd>${inline(brick.charte.abandon)}</dd>` +
        `<dt>Refus</dt><dd><ul>${brick.charte.refus.map((refus) => `<li>${inline(refus)}</li>`).join("")}</ul></dd>` +
        `</dl>`;
  const sections = brick.fiche
    .map((section) => `<h4>${escapeHtml(section.title)}</h4>${renderBody(section.body)}`)
    .join("");
  return (
    `<details class="brique" id="${escapeHtml(brick.id)}">` +
    `<summary><span class="id">${escapeHtml(brick.id)}</span> <span class="nom">${escapeHtml(brick.nom)}</span> ` +
    `<span class="statut statut-${brick.statut}">${STATUS_LABEL[brick.statut]}</span></summary>` +
    `<p class="role">${inline(brick.role)}</p>` +
    `<dl class="champs">` +
    `<dt>Dépend de</dt><dd>${dependencies}</dd>` +
    `<dt>Invariants qui la lient</dt><dd>${list(brick.invariants, "aucun")}</dd>` +
    `<dt>Décisions</dt><dd>${list(brick.decisions, "aucune")}</dd>` +
    `<dt>Dépôts porteurs</dt><dd>${list(brick.depots, "aucun")}</dd>` +
    `<dt>Origine</dt><dd>${escapeHtml(brick.origine.type)}</dd>` +
    `<dt>Autonomie d'un agent</dt><dd>${escapeHtml(brick.autonomie)}</dd>` +
    (brick.preuve_produite === undefined
      ? ""
      : `<dt>Preuve produite</dt><dd>${inline(brick.preuve_produite)}</dd>`) +
    `</dl>` +
    `<h4>Preuves datées</h4>${proofs}${charter}${sections}` +
    `</details>`
  );
}

/** The whole page. `standing` is what ADR-0064 says of itself on the day of the generation. */
export function renderVisionHtml(map: BrickMap, standing: AdrStanding): string {
  const counters = map.compteurs;
  const statusRows = STATUSES.map(
    (status) =>
      `<tr><th scope="row"><span class="statut statut-${status}">${STATUS_LABEL[status]}</span></th>` +
      `<td class="nombre">${counters.par_statut[status]}</td><td>${escapeHtml(STATUS_MEANING[status])}</td></tr>`,
  ).join("");
  const layerRows = map.couches
    .map(
      (layer) =>
        `<tr><th scope="row"><a href="#couche-${layer.slug}">${escapeHtml(layer.label)}</a></th>` +
        `<td>${escapeHtml(layer.role)}</td>` +
        `<td>${layer.mayDependOn.length === 0 ? "aucune" : layer.mayDependOn.map((slug) => escapeHtml(LAYERS.find((candidate) => candidate.slug === slug)?.label ?? slug)).join(", ")}</td>` +
        `<td>${inline(layer.ownRule)} <span class="regle">${layer.ownRuleVerified ? "vérifiée par le gate" : "déclarative, non vérifiée"}</span></td>` +
        `<td class="nombre">${layer.briques.length}</td></tr>`,
    )
    .join("");
  const layers = map.couches
    .map(
      (layer) =>
        `<section class="couche" id="couche-${layer.slug}"><h3>${escapeHtml(layer.label)} <span class="compte">${layer.briques.length} brique${layer.briques.length > 1 ? "s" : ""}</span></h3>` +
        `<p>${escapeHtml(layer.role)}.</p>${layer.briques.map(renderBrick).join("")}</section>`,
    )
    .join("");
  const unbound =
    counters.sans_invariant.length === 0
      ? "<p>Toutes les briques hors de la couche gouvernance citent au moins un invariant.</p>"
      : `<p>${counters.sans_invariant.length} brique${counters.sans_invariant.length > 1 ? "s" : ""} hors de la couche gouvernance ${counters.sans_invariant.length > 1 ? "ne sont liées" : "n'est liée"} par aucun invariant : ` +
        `${counters.sans_invariant.map((id) => `<a href="#${escapeHtml(id)}"><code>${escapeHtml(id)}</code></a>`).join(", ")}. ` +
        `C'est la liste de ce que la doctrine ne porte pas encore.</p>`;
  const outside = counters.catalogue_produits - counters.produits_en_brique;
  return [
    "<!doctype html>",
    '<html lang="fr">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    "<title>Carte des briques — Libre AI</title>",
    '<link rel="stylesheet" href="vision.css">',
    "</head>",
    "<body>",
    "<header>",
    "<h1>Carte des briques</h1>",
    `<p class="chapeau">La vision Libre AI, en données : ${counters.briques} briques en ${map.couches.length} couches. Cette page est générée depuis <code>ecosystem/briques/</code> par <code>distribution/build-vision.ts</code>. Rien n'y est saisi : ni les comptes, ni les statuts.</p>`,
    `<p class="reserve">Elle applique ${DECISION}, ${standing === "accepted" ? "accepté" : "<strong>encore proposé</strong> : son acceptation est un acte du propriétaire"}.</p>`,
    "</header>",
    "<main>",
    '<section id="statuts"><h2>Statuts dérivés des preuves</h2>',
    `<table><thead><tr><th scope="col">Statut</th><th scope="col">Briques</th><th scope="col">Ce qu'il veut dire</th></tr></thead><tbody>${statusRows}</tbody></table>`,
    `<p>Preuves tenues : ${counters.preuves_locales} dans ce dépôt, ${counters.preuves_epinglees} épinglées à un commit d'un dépôt porteur public. ${counters.cibles_partagees} cible${counters.cibles_partagees > 1 ? "s" : ""} de preuve ${counters.cibles_partagees > 1 ? "sont citées" : "est citée"} par plus d'une brique. ${counters.sans_depot_porteur} brique${counters.sans_depot_porteur > 1 ? "s n'ont" : " n'a"} aucun dépôt porteur.</p>`,
    "</section>",
    '<section id="couches"><h2>Les couches et leurs dépendances</h2>',
    renderLayerMatrix(map),
    `<table><thead><tr><th scope="col">Couche</th><th scope="col">Rôle</th><th scope="col">Peut dépendre de</th><th scope="col">Règle propre</th><th scope="col">Briques</th></tr></thead><tbody>${layerRows}</tbody></table>`,
    "</section>",
    '<section id="produits"><h2>Produits</h2>',
    `<p>Le catalogue d'ADR-0042 compte ${counters.catalogue_produits} produits : ${counters.produits_en_brique === 0 ? "aucun n'est une brique" : counters.produits_en_brique === 1 ? "1 est une brique" : `${counters.produits_en_brique} sont des briques`}, ${outside} ${outside > 1 ? "restent" : "reste"} hors de la carte, faute de charte.</p>`,
    "</section>",
    '<section id="sans-invariant"><h2>Ce que la doctrine ne porte pas encore</h2>',
    unbound,
    "</section>",
    '<section id="briques"><h2>Les briques, couche par couche</h2>',
    layers,
    "</section>",
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Whether ADR-0064 is accepted, read the way the doctrine gate reads a status line. */
export function standingOf(adrText: string): AdrStanding {
  return adrText.split("\n").some((line) => /Statut.*accepted/i.test(line))
    ? "accepted"
    : "proposed";
}

export type Projection =
  | { readonly ok: true; readonly html: string; readonly summary: string }
  | { readonly ok: false; readonly lines: readonly string[] };

/**
 * The page, or the reason there is none. A map with a violation, or a
 * decision record that cannot be read as one file, gives no projection: the
 * decision is here, apart from the writing, so that it is tested.
 */
export function projectVision(
  outcome: Pick<BriquesOutcome, "map" | "report">,
  adrTexts: readonly string[],
): Projection {
  if (outcome.map === null) {
    return {
      ok: false,
      lines: [
        ...outcome.report.violations.map((violation) => `Vision: ${violation}`),
        `Vision not generated: the brick map has ${outcome.report.violations.length} violation(s), and a page is never generated from a red map.`,
      ],
    };
  }
  if (adrTexts.length !== 1) {
    return {
      ok: false,
      lines: [
        `Vision not generated: ${adrTexts.length} tracked file(s) carry the number of ${DECISION} in docs/adr, so its standing cannot be read.`,
      ],
    };
  }
  const standing = standingOf(adrTexts[0] as string);
  return {
    ok: true,
    html: renderVisionHtml(outcome.map, standing),
    summary: `Vision generated: ${outcome.map.compteurs.briques} brick(s) in ${outcome.map.couches.length} layer(s), ${DECISION} ${standing}; wrote distribution/vision/index.html.`,
  };
}

if (import.meta.main) {
  const root = process.cwd();
  // The tracked files only, like the gate: the standing is read from what git tracks.
  const adrFiles = execFileSync("git", ["ls-files", "-z", "docs/adr"], {
    encoding: "utf8",
    cwd: root,
  })
    .split("\0")
    .filter((path) => path.startsWith(`docs/adr/${DECISION.slice(4)}-`));
  const projection = projectVision(
    checkBriques(root),
    adrFiles.map((path) => readFileSync(`${root}/${path}`, "utf8")),
  );
  if (!projection.ok) {
    for (const line of projection.lines) console.error(line);
    process.exit(1);
  }
  await Bun.write(fileURLToPath(new URL("./vision/index.html", import.meta.url)), projection.html);
  console.log(projection.summary);
}
