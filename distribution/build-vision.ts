/**
 * Vision page generator (ADR-0064 D6).
 *
 * The page is a projection of the brick map, never an authority: its counts,
 * statuses, layers and fiches come from `checkBriques`, the same evaluation
 * the gate runs, and none of them is typed here. Two things are not from the
 * map: the fixed text of the page (titles, legends, the meaning of each
 * status), written below, and the standing of ADR-0064, read from the status
 * line of that record. A map with a single violation gives no page: the
 * generator exits non-zero and prints the violations, because a page generated
 * from a red map would publish a status nobody derived.
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
import { join } from "node:path";
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
/** The variables by which git reads another repository, index or tree than the one it is run in. */
const GIT_REDIRECTIONS: readonly string[] = [
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
];

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
  en_cours:
    "au moins une preuve datée est citée et tient : un fichier suivi de ce dépôt, ou une citation épinglée, que le gate des citations résout de son côté ; cela ne dit pas que la brique fonctionne",
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

/** A count with its noun, agreed in number the French way: 0 and 1 are singular. */
function count(value: number, singular: string, plural: string): string {
  return `${value} ${value > 1 ? plural : singular}`;
}

/**
 * A table inside a named region that scrolls sideways on a narrow screen. The
 * table keeps its own display, so its rows and headers stay a table to a
 * screen reader. The region carries no `tabindex`: the linter of this
 * repository refuses one on a non-interactive element, so a browser that does
 * not focus a scrolling region by itself scrolls it only by pointer or touch.
 */
function scrollable(label: string, table: string): string {
  return `<section class="defilante" aria-label="${escapeHtml(label)}">${table}</section>`;
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
      return `<tr><th scope="row"><a href="#couche-${escapeHtml(layer.slug)}">${escapeHtml(layer.label)}</a></th>${cells}</tr>`;
    })
    .join("");
  return scrollable(
    "Matrice des dépendances entre couches",
    `<table class="matrice"><caption>Une ligne est une couche ; une colonne est une couche dont ses briques pourraient dépendre. ` +
      `Un nombre, zéro compris, dans une cellule encadrée : la dépendance est admise par la table d'ADR-0064 D1, et c'est le nombre de dépendances que les briques déclarent. ` +
      `Un tiret : la dépendance n'est pas admise, et aucune brique ne la déclare. ` +
      `Sur la diagonale, là où la ligne et la colonne portent le même nom, en italique : les dépendances entre briques d'une même couche, que la table ne borne pas.</caption>` +
      `<thead><tr><th scope="col">dépend de →</th>${head}</tr></thead><tbody>${rows}</tbody></table>`,
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
  // What the origin declares beyond its type: the source of an inspection, the date of an observation.
  const origin = [brick.origine.type, brick.origine.source, brick.origine.date]
    .filter((part) => part !== undefined)
    .map(escapeHtml)
    .join(" — ");
  return (
    `<details class="brique" id="${escapeHtml(brick.id)}">` +
    `<summary><span class="id">${escapeHtml(brick.id)}</span> <span class="nom">${escapeHtml(brick.nom)}</span> ` +
    `<span class="statut statut-${escapeHtml(brick.statut)}">${STATUS_LABEL[brick.statut]}</span></summary>` +
    `<p class="role">${inline(brick.role)}</p>` +
    `<dl class="champs">` +
    `<dt>Dépend de</dt><dd>${dependencies}</dd>` +
    `<dt>Invariants qui la lient</dt><dd>${list(brick.invariants, "aucun")}</dd>` +
    `<dt>Décisions</dt><dd>${list(brick.decisions, "aucune")}</dd>` +
    `<dt>Dépôts porteurs</dt><dd>${list(brick.depots, "aucun")}</dd>` +
    `<dt>Origine</dt><dd>${origin}</dd>` +
    `<dt>Autonomie d'un agent</dt><dd>${escapeHtml(brick.autonomie)}</dd>` +
    (brick.preuve_produite === undefined
      ? ""
      : `<dt>Preuve produite</dt><dd>${inline(brick.preuve_produite)}</dd>`) +
    (brick.jetable === undefined
      ? ""
      : `<dt>Transitoire</dt><dd>${escapeHtml(brick.jetable)}</dd>`) +
    (brick.retrait === undefined
      ? ""
      : `<dt>Retrait</dt><dd><code>${escapeHtml(brick.retrait.decision)}</code>, <time datetime="${escapeHtml(brick.retrait.date)}">${escapeHtml(brick.retrait.date)}</time></dd>`) +
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
    .map((layer) => {
      // A rule verified in part says which part: « verified » alone would claim the whole rule.
      const verification = !layer.ownRuleVerified
        ? "déclarative, non vérifiée"
        : layer.ownRuleVerifiedOnly === undefined
          ? "vérifiée par le gate"
          : `vérifiée par le gate ${layer.ownRuleVerifiedOnly}`;
      return (
        `<tr><th scope="row"><a href="#couche-${escapeHtml(layer.slug)}">${escapeHtml(layer.label)}</a></th>` +
        `<td>${escapeHtml(layer.role)}</td>` +
        `<td>${layer.mayDependOn.length === 0 ? "aucune" : layer.mayDependOn.map((slug) => escapeHtml(LAYERS.find((candidate) => candidate.slug === slug)?.label ?? slug)).join(", ")}</td>` +
        `<td>${inline(layer.ownRule)} <span class="regle">${escapeHtml(verification)}</span></td>` +
        `<td class="nombre">${layer.briques.length}</td></tr>`
      );
    })
    .join("");
  const layers = map.couches
    .map(
      (layer) =>
        `<section class="couche" id="couche-${escapeHtml(layer.slug)}"><h3>${escapeHtml(layer.label)} <span class="compte">${count(layer.briques.length, "brique", "briques")}</span></h3>` +
        // One brick per line of the file: two changes to two bricks do not touch the same line.
        `<p>${escapeHtml(layer.role)}.</p>\n${layer.briques.map(renderBrick).join("\n")}\n</section>`,
    )
    .join("\n");
  const unbound =
    counters.sans_invariant.length === 0
      ? "<p>Toutes les briques hors de la couche gouvernance citent au moins un invariant.</p>"
      : `<p>${count(counters.sans_invariant.length, "brique", "briques")} hors de la couche gouvernance ${counters.sans_invariant.length > 1 ? "ne sont liées" : "n'est liée"} par aucun invariant : ` +
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
    `<p class="chapeau">La vision Libre AI, en données : ${count(counters.briques, "brique", "briques")} en ${count(map.couches.length, "couche", "couches")}. Cette page est générée depuis <code>ecosystem/briques/</code> par <code>distribution/build-vision.ts</code>. Ni les comptes, ni les statuts, ni les fiches n'y sont saisis ; son texte fixe (titres, légendes, sens de chaque statut) est écrit dans le générateur.</p>`,
    `<p class="reserve">Elle applique ${DECISION}, ${standing === "accepted" ? "accepté" : "<strong>encore proposé</strong> : son acceptation est un acte du propriétaire"}.</p>`,
    "</header>",
    "<main>",
    '<section id="statuts"><h2>Statuts dérivés des preuves</h2>',
    scrollable(
      "Statuts dérivés des preuves",
      `<table><thead><tr><th scope="col">Statut</th><th scope="col">Briques</th><th scope="col">Ce qu'il veut dire</th></tr></thead><tbody>${statusRows}</tbody></table>`,
    ),
    `<p>Preuves tenues : ${counters.preuves_locales} dans ce dépôt, ${counters.preuves_epinglees} sous la forme d'une citation épinglée à un commit d'un dépôt porteur. ${count(counters.cibles_partagees, "cible", "cibles")} de preuve ${counters.cibles_partagees > 1 ? "sont citées" : "est citée"} par plus d'une brique. ${count(counters.sans_depot_porteur, "brique", "briques")} ${counters.sans_depot_porteur > 1 ? "n'ont" : "n'a"} aucun dépôt porteur.</p>`,
    "</section>",
    '<section id="couches"><h2>Les couches et leurs dépendances</h2>',
    renderLayerMatrix(map),
    scrollable(
      "Rôle et règle propre de chaque couche",
      `<table><thead><tr><th scope="col">Couche</th><th scope="col">Rôle</th><th scope="col">Peut dépendre de</th><th scope="col">Règle propre</th><th scope="col">Briques</th></tr></thead><tbody>${layerRows}</tbody></table>`,
    ),
    "</section>",
    '<section id="produits"><h2>Produits</h2>',
    `<p>Le catalogue d'ADR-0042 compte ${count(counters.catalogue_produits, "produit", "produits")} : ${counters.produits_en_brique === 0 ? "aucun n'est une brique" : counters.produits_en_brique === 1 ? "1 est une brique" : `${counters.produits_en_brique} sont des briques`}, ${outside} ${outside > 1 ? "restent" : "reste"} hors de la carte.</p>`,
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

/**
 * What the decision record says of itself: the first word of its one status
 * line (`- **Statut :** <word> …`), the form every record of `docs/adr` uses.
 * `null` when the record has no status line, several, or a status that is
 * neither of the two the page knows how to say: a deferred or superseded
 * record must not be printed as « encore proposé ».
 */
export function standingOf(adrText: string): AdrStanding | null {
  const statuses = adrText
    .split("\n")
    .map((line) => /^- \*\*Statut :\*\* (\p{L}+)/u.exec(line)?.[1])
    .filter((word) => word !== undefined);
  if (statuses.length !== 1) return null;
  if (statuses[0] === "accepted") return "accepted";
  return statuses[0] === "proposé" || statuses[0] === "proposed" ? "proposed" : null;
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
  if (standing === null) {
    return {
      ok: false,
      lines: [
        `Vision not generated: ${DECISION} does not carry exactly one status line whose first word is accepted, proposé or proposed, so the page cannot say its standing.`,
      ],
    };
  }
  return {
    ok: true,
    html: renderVisionHtml(outcome.map, standing),
    summary: `Vision generated: ${outcome.map.compteurs.briques} brick(s) in ${outcome.map.couches.length} layer(s), ${DECISION} ${standing}; wrote distribution/vision/index.html.`,
  };
}

/**
 * The text of every tracked file of `docs/adr` that carries the number of the
 * decision record, as the index holds it. The standing is read from the index,
 * like the map: an edit of the record that git does not track yet does not
 * change the page.
 */
export function readDecisionRecords(root: string): string[] {
  // A hook, or a command run from a linked worktree, exports variables that
  // point git at another repository than `root`: they are not passed on.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !GIT_REDIRECTIONS.includes(name)),
  );
  const git = (args: readonly string[]): string =>
    execFileSync("git", args, { encoding: "utf8", cwd: root, env });
  return git(["ls-files", "-z", "docs/adr"])
    .split("\0")
    .filter((path) => path.startsWith(`docs/adr/${DECISION.slice(4)}-`))
    .map((path) => git(["show", `:${path}`]));
}

if (import.meta.main) {
  // One root, the repository this script belongs to: the map is read there and
  // the page is written there, whatever the directory the script is run from.
  const root = fileURLToPath(new URL("..", import.meta.url));
  const projection = projectVision(checkBriques(root), readDecisionRecords(root));
  if (!projection.ok) {
    for (const line of projection.lines) console.error(line);
    process.exit(1);
  }
  await Bun.write(join(root, "distribution/vision/index.html"), projection.html);
  console.log(projection.summary);
}
