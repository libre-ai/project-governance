import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { validateCitedPath } from "../tools/quality/check-pinned-citations";
import { GateReport } from "../tools/quality/gate-report";

/**
 * The brick map (ADR-0064): eleven layers, one schema, a derived status.
 *
 * WHY. The vision lived in three places that did not check one another:
 * `vision.md`, the catalogue of ADR-0042 §1 and the project cards. None said
 * what the method is made of, what each part depends on, or which part can show
 * a proof. The brick map is that statement, in data: one YAML file per layer
 * (`ecosystem/briques/<couche>.v1.yaml`) and one Markdown fiche per brick
 * (`ecosystem/briques/<couche>/<ID>.md`).
 *
 * WHAT THIS MODULE HOLDS. Everything pure: the layer table of ADR-0064 D1, the
 * parsers of the doctrine files a brick cites, the rules, and the derivation of
 * the status. `check-briques.ts` is the effectful half (files, exit code); the
 * page generator reads the same `BrickMap`, so nothing on the page is typed in.
 *
 * THE STATUS IS DERIVED, NEVER TYPED (D4). The YAML has no status field, and a
 * brick that carries one is refused by name before the schema is applied.
 *   - `retiree`: the brick carries a `retrait` whose decision is in the register;
 *   - `en_cours`: at least one dated proof whose target holds;
 *   - `decrite`: fiche and YAML present, no proof.
 * `prototypee` asks for a signed release of the carrier repository linked to
 * its published evidence. No instrument of this repository verifies a signed
 * release, so the v1 schema has no field to claim one and no brick can be
 * `prototypee`: the counter is printed as zero with that reason, not left out.
 * shortcut: no brick can reach `prototypee` in v1; upgrade trigger: the first
 * signed release linked to its evidence (ADR-0064 D8, PRD-02).
 *
 * PROOFS. A target is a path of this repository, checked on the tree, or a
 * pinned citation `<organisation>/<repository>@<40-hex sha>:<path>` of a PUBLIC
 * carrier repository. This module does not go to the network: it checks the
 * form, the carrier and the visibility, and asserts that the pinned-citations
 * gate reads `ecosystem/briques/` (its `scope`, in data), which is the gate
 * that resolves every such citation over git. A proof in a private repository
 * cannot be cited (I-15: nothing is exposed before something is verifiable),
 * so a brick carried only by a private repository stays `decrite`.
 *
 * LAYER RULES. Three rules of D1 are verified here (no dependency outside the
 * table; a fabrique brick declares the proof it produces; a produit brick is a
 * dependency of nothing). The eight others are statements about behaviour that
 * no data can show; they are printed as declarative, never counted as verified.
 */

export const SCHEMA_VERSION = "libre-ai.brique.v1";
/** Where the map lives, relative to the repository root. */
export const BRIQUES_ROOT = "ecosystem/briques";
/** The proof targets of another repository are resolved by this gate's scope. */
export const CITATIONS_SCOPE_ENTRY = `${BRIQUES_ROOT}/`;

export type LayerSlug =
  | "gouvernance"
  | "fabrique"
  | "harness"
  | "identite"
  | "passerelle"
  | "execution"
  | "preuve"
  | "plateforme"
  | "exploitation"
  | "publication"
  | "produit";

export interface LayerRule {
  readonly slug: LayerSlug;
  /** The name as ADR-0064 D1 writes it. */
  readonly label: string;
  readonly prefix: string;
  readonly role: string;
  /** The OTHER layers a brick of this layer may depend on (D1, normative). */
  readonly mayDependOn: readonly LayerSlug[];
  readonly ownRule: string;
  /** True when this module verifies `ownRule`; false when it only prints it. */
  readonly ownRuleVerified: boolean;
}

/**
 * ADR-0064 D1, row for row. The test suite reads the table back from the ADR
 * and compares, so the code cannot drift from the decision it implements.
 */
export const LAYERS: readonly LayerRule[] = [
  {
    slug: "gouvernance",
    label: "gouvernance",
    prefix: "GOV",
    role: "décider, admettre, retirer, rendre compte",
    mayDependOn: [],
    ownRule: "seule couche sans dépendance ; toute autre brique cite au moins un invariant",
    ownRuleVerified: true,
  },
  {
    slug: "fabrique",
    label: "fabrique",
    prefix: "FAB",
    role: "de l'idée à la remise du code",
    mayDependOn: ["gouvernance", "harness", "preuve"],
    ownRule: "une brique fabrique déclare la preuve qu'elle produit",
    ownRuleVerified: true,
  },
  {
    slug: "harness",
    label: "harness",
    prefix: "HAR",
    role: "conduire les agents",
    mayDependOn: ["gouvernance", "identite", "execution"],
    ownRule: "aucune brique harness ne lit du contenu hors `exécution`",
    ownRuleVerified: false,
  },
  {
    slug: "identite",
    label: "identité",
    prefix: "IDN",
    role: "qui agit, avec quel mandat",
    mayDependOn: ["gouvernance"],
    ownRule: "émet des jetons, n'en consomme jamais pour agir",
    ownRuleVerified: false,
  },
  {
    slug: "passerelle",
    label: "passerelle",
    prefix: "PAS",
    role: "plan de contrôle : classe, budget, routage, politique",
    mayDependOn: ["identite", "gouvernance"],
    ownRule: "ne voit que des métadonnées typées",
    ownRuleVerified: false,
  },
  {
    slug: "execution",
    label: "exécution",
    prefix: "EXE",
    role: "plan de données confiné",
    mayDependOn: ["passerelle", "identite"],
    ownRule: "tout ce qui traite du contenu est ici, et seulement ici",
    ownRuleVerified: false,
  },
  {
    slug: "preuve",
    label: "preuve",
    prefix: "PRV",
    role: "journal, provenance, signature, menace, audit",
    mayDependOn: ["identite"],
    ownRule: "toute brique d'une autre couche écrit dans le journal",
    ownRuleVerified: false,
  },
  {
    slug: "plateforme",
    label: "plateforme",
    prefix: "PLT",
    role: "cœur Rust, coquilles, canaux, build, compatibilité, fin de vie, accessibilité",
    mayDependOn: ["preuve", "execution"],
    ownRule: "une coquille n'a pas de logique métier",
    ownRuleVerified: false,
  },
  {
    slug: "exploitation",
    label: "exploitation",
    prefix: "EXP",
    role: "observer, évaluer, mesurer, répéter, sortir",
    mayDependOn: ["preuve", "passerelle"],
    ownRule: "toute mesure est reproductible par un tiers",
    ownRuleVerified: false,
  },
  {
    slug: "publication",
    label: "publication",
    prefix: "PUB",
    role: "page vision, catalogue, évidence publique, site, contributions",
    mayDependOn: ["preuve", "gouvernance"],
    ownRule: "ne publie que des faits dérivés, jamais saisis",
    ownRuleVerified: false,
  },
  {
    slug: "produit",
    label: "produit",
    prefix: "PRD",
    role: "P01 à P40",
    mayDependOn: ["plateforme", "passerelle", "execution", "identite"],
    ownRule: "jamais dépendance d'une brique de méthode",
    ownRuleVerified: true,
  },
];

const LAYER_BY_SLUG: ReadonlyMap<string, LayerRule> = new Map(
  LAYERS.map((layer) => [layer.slug, layer]),
);
const LAYER_BY_PREFIX: ReadonlyMap<string, LayerRule> = new Map(
  LAYERS.map((layer) => [layer.prefix, layer]),
);

/** The sections every fiche carries, in this order (ADR-0064 D3). */
export const FICHE_SECTIONS: readonly string[] = [
  "Contexte",
  "Ce que la brique ferme",
  "Ce qu'elle ne fait pas",
  "Mesure",
];

/**
 * A `degel` or an `abandon` names an observable fact, never a delay or an
 * effort (charter review of 2026-11-09). `\p{L}` on both sides, so that
 * « jours » is refused and « toujours » is not.
 */
const DELAY_WORDS = /(?<!\p{L})(bient[oô]t|rapidement|jours?|semaines?|mois)(?!\p{L})/iu;

export type Status = "decrite" | "en_cours" | "prototypee" | "retiree";
export const STATUSES: readonly Status[] = ["decrite", "en_cours", "prototypee", "retiree"];
/** The machine values of the status, which no fiche writes (D4). */
const TYPED_STATUS = /(?<![\p{L}_])(decrite|en_cours|prototypee|retiree)(?![\p{L}_])/u;

export interface Proof {
  readonly date: string;
  readonly cible: string;
}

export interface Charter {
  readonly valeur: string;
  readonly pour_qui: string;
  readonly degel: string;
  readonly abandon: string;
  readonly refus: readonly string[];
}

export interface Origin {
  readonly type: "inspection" | "observed" | "propre";
  readonly source?: string;
  readonly date?: string;
}

/** A brick as the YAML writes it (schema `brique.v1`). */
export interface BrickData {
  readonly id: string;
  readonly nom: string;
  readonly role: string;
  readonly depend_de: readonly string[];
  readonly invariants: readonly string[];
  readonly decisions: readonly string[];
  readonly depots: readonly string[];
  readonly origine: Origin;
  readonly autonomie: "discover" | "modify" | "govern";
  readonly preuve: readonly Proof[];
  readonly preuve_produite?: string;
  readonly charte?: Charter;
  readonly jetable?: string;
  readonly retrait?: { readonly decision: string; readonly date: string };
}

export interface FicheSection {
  readonly title: string;
  readonly body: string;
}

/** A brick as the page reads it: the data, the fiche, and what was derived. */
export interface Brick extends BrickData {
  readonly couche: LayerSlug;
  readonly statut: Status;
  readonly fiche: readonly FicheSection[];
  /** The proofs that hold, which is what the status is derived from. */
  readonly preuves_tenues: number;
}

export interface BrickMap {
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly couches: readonly (LayerRule & { readonly briques: readonly Brick[] })[];
  readonly compteurs: Counters;
}

export interface Counters {
  readonly briques: number;
  readonly par_couche: Readonly<Record<string, number>>;
  readonly par_statut: Readonly<Record<Status, number>>;
  readonly par_origine: Readonly<Record<Origin["type"], number>>;
  readonly par_autonomie: Readonly<Record<BrickData["autonomie"], number>>;
  readonly preuves_locales: number;
  readonly preuves_epinglees: number;
  readonly sans_depot_porteur: number;
  readonly jetables: number;
  readonly catalogue_produits: number;
  readonly produits_en_brique: number;
}

export type InvariantStanding = "en vigueur" | "retiré";

export type EntryKind = "file" | "directory" | "link" | "other";

export interface TreeEntry {
  /** Relative to `BRIQUES_ROOT`, with `/` separators. */
  readonly path: string;
  readonly kind: EntryKind;
}

export interface BriquesInput {
  /** Every entry under `BRIQUES_ROOT`, at any depth. Links are not followed. */
  readonly entries: readonly TreeEntry[];
  /** The text of a file under `BRIQUES_ROOT`, or null when it cannot be read. */
  readonly read: (path: string) => string | null;
  readonly invariants: ReadonlyMap<string, InvariantStanding>;
  /** Four-digit numbers of the files of `docs/adr/`. */
  readonly adrNumbers: ReadonlySet<string>;
  /** Identifiers of the rows of the decision register, as written (`D01`, `D103`). */
  readonly registerDecisions: ReadonlySet<string>;
  /** `owner/name` of the fleet inventory, with its visibility. */
  readonly repositories: ReadonlyMap<string, { readonly visibility: string }>;
  /** `P01`…: the products of the catalogue of ADR-0042 §1. */
  readonly catalogue: ReadonlySet<string>;
  /** `owner/name` of this checkout, or null when it could not be derived. */
  readonly selfRepository: string | null;
  /** Whether a repository-relative path exists in the tree under review. */
  readonly localTargetExists: (path: string) => boolean;
  /** The configuration of the pinned-citations gate, which resolves foreign proofs. */
  readonly citations: { readonly organization: string; readonly scope: readonly string[] };
  /** The latest acceptable proof date, ISO (tomorrow: the cards' tolerance). */
  readonly latestDate: string;
}

export interface BriquesOutcome {
  readonly report: GateReport;
  /** Null when a violation was found: a page is never generated from a red map. */
  readonly map: BrickMap | null;
  readonly volume: string;
}

// ---------------------------------------------------------------- parsers ---

/** `| I-NN | text … |` rows of INVARIANTS.md. A row whose text opens with « Retiré » is withdrawn. */
export function parseInvariants(markdown: string): Map<string, InvariantStanding> {
  const found = new Map<string, InvariantStanding>();
  for (const line of markdown.split("\n")) {
    const row = /^\|\s*(I-[0-9]{2})\s*\|\s*(.*)$/.exec(line);
    if (row === null) continue;
    const [, id, rest] = row as unknown as [string, string, string];
    found.set(id, /^\*{0,2}Retiré/.test(rest) ? "retiré" : "en vigueur");
  }
  return found;
}

/** `| Dnn | … |` rows of DECISION-REGISTER.md, identifiers as written. */
export function parseRegisterDecisions(markdown: string): Set<string> {
  const found = new Set<string>();
  for (const line of markdown.split("\n")) {
    const row = /^\|\s*(D[0-9]{1,4})\s*\|/.exec(line);
    if (row !== null) found.add(row[1] as string);
  }
  return found;
}

/**
 * The products of ADR-0042 §1: every `Pnn` of the table under the heading
 * « Le catalogue d'applications », up to the next heading. The count is never
 * written here; it is whatever the decision record lists.
 */
export function parseCatalogue(adr0042: string): Set<string> {
  const found = new Set<string>();
  let inside = false;
  for (const line of adr0042.split("\n")) {
    if (/^#{2,6}\s/.test(line)) {
      inside = /catalogue d'applications/i.test(line);
      continue;
    }
    if (!inside || !line.startsWith("|")) continue;
    for (const match of line.matchAll(/(?<![A-Za-z0-9])P[0-9]{2}(?![0-9])/g)) found.add(match[0]);
  }
  return found;
}

/** `repositories[].repository` and its visibility, from the fleet inventory. */
export function parseRepositories(value: unknown): Map<string, { visibility: string }> {
  const found = new Map<string, { visibility: string }>();
  const list = (value as { repositories?: unknown } | null)?.repositories;
  if (!Array.isArray(list)) return found;
  for (const entry of list) {
    const candidate = entry as { repository?: unknown; visibility?: unknown } | null;
    if (typeof candidate?.repository !== "string") continue;
    found.set(candidate.repository, {
      visibility: typeof candidate.visibility === "string" ? candidate.visibility : "",
    });
  }
  return found;
}

export interface ParsedFiche {
  /** The text of the first `# ` heading, or null. */
  readonly title: string | null;
  readonly sections: readonly FicheSection[];
}

/** A fiche: one `# ` title, then `## ` sections. HTML comments (licence headers) are ignored. */
export function parseFiche(text: string): ParsedFiche {
  let title: string | null = null;
  const sections: { title: string; lines: string[] }[] = [];
  for (const line of text.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const heading = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
    if (heading !== null && heading[1] === "#") {
      if (title === null) title = heading[2] as string;
      continue;
    }
    if (heading !== null) {
      sections.push({ title: heading[2] as string, lines: [] });
      continue;
    }
    sections.at(-1)?.lines.push(line);
  }
  return {
    title,
    sections: sections.map((section) => ({
      title: section.title,
      body: section.lines.join("\n").trim(),
    })),
  };
}

// ----------------------------------------------------------------- schema ---

const schema = (await Bun.file(
  new URL("./schemas/brique.v1.schema.json", import.meta.url).pathname,
).json()) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function renderSchemaError(error: ErrorObject): string {
  const detail =
    error.keyword === "additionalProperties"
      ? ` « ${String((error.params as { additionalProperty?: string }).additionalProperty)} »`
      : "";
  return `${error.instancePath || "/"}: ${error.message ?? "invalid"}${detail} (${error.keyword})`;
}

/** A typed-in status, at any depth of a brick: refused by name (ADR-0064 D4). */
function typedStatusPaths(value: unknown): string[] {
  const bricks = (value as { briques?: unknown } | null)?.briques;
  if (!Array.isArray(bricks)) return [];
  const paths: string[] = [];
  bricks.forEach((brick, index) => {
    if (brick === null || typeof brick !== "object") return;
    for (const key of Object.keys(brick)) {
      if (/^(statut|status|etat|état)$/i.test(key)) paths.push(`/briques/${index}/${key}`);
    }
  });
  return paths;
}

/** Schema errors of one layer file, the typed status first and under its own name. */
export function validateLayerFile(value: unknown): string[] {
  const typed = typedStatusPaths(value).map(
    (path) =>
      `${path}: ADR-0064 D4 — the status is derived from the proofs, never typed; remove the field`,
  );
  if (typed.length > 0) return typed;
  return validateSchema(value) ? [] : (validateSchema.errors ?? []).map(renderSchemaError);
}

// ------------------------------------------------------------------ rules ---

interface LoadedLayer {
  readonly rule: LayerRule;
  readonly bricks: readonly BrickData[];
}

function layerOfId(id: string): LayerRule | undefined {
  return LAYER_BY_PREFIX.get(id.slice(0, 3));
}

/** The first dependency cycle reachable from `start`, as the ids it goes through, or null. */
export function findCycle(
  start: string,
  dependencies: ReadonlyMap<string, readonly string[]>,
): string[] | null {
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    const seenAt = path.indexOf(id);
    if (seenAt !== -1) return [...path.slice(seenAt), id];
    path.push(id);
    for (const next of dependencies.get(id) ?? []) {
      const cycle = visit(next);
      if (cycle !== null) return cycle;
    }
    path.pop();
    return null;
  };
  const cycle = visit(start);
  // Only the cycles `start` is part of: a brick that merely leads to a cycle is
  // not reported once per ancestor.
  return cycle !== null && cycle[0] === start ? cycle : null;
}

interface ProofVerdict {
  readonly ok: boolean;
  readonly kind: "locale" | "epinglee";
  readonly note: string;
}

function judgeProof(brick: BrickData, proof: Proof, input: BriquesInput): ProofVerdict {
  const pinned = /^([^/@\s]+)\/([^/@\s]+)@([^:]*):(.*)$/.exec(proof.cible);
  if (proof.date > input.latestDate) {
    return {
      ok: false,
      kind: pinned === null ? "locale" : "epinglee",
      note: `proof dated ${proof.date} is in the future (bound: ${input.latestDate})`,
    };
  }
  if (pinned === null) {
    const invalid = validateCitedPath(proof.cible);
    if (invalid !== null) {
      return { ok: false, kind: "locale", note: `proof target ${proof.cible}: ${invalid}` };
    }
    if (input.selfRepository === null) {
      return {
        ok: false,
        kind: "locale",
        note: "the name of this repository could not be derived, so a local proof names no carrier",
      };
    }
    if (!brick.depots.includes(input.selfRepository)) {
      return {
        ok: false,
        kind: "locale",
        note: `proof target ${proof.cible} is a path of ${input.selfRepository}, which is not a carrier (depots) of the brick`,
      };
    }
    return input.localTargetExists(proof.cible)
      ? { ok: true, kind: "locale", note: proof.cible }
      : { ok: false, kind: "locale", note: `proof target ${proof.cible} does not exist` };
  }
  const [, owner, name, sha, path] = pinned as unknown as [string, string, string, string, string];
  const repository = `${owner}/${name}`;
  const fail = (note: string): ProofVerdict => ({ ok: false, kind: "epinglee", note });
  if (owner !== input.citations.organization) {
    return fail(
      `pinned proof ${proof.cible}: owner « ${owner} » is not the organisation the citations gate resolves (${input.citations.organization})`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    return fail(`pinned proof ${proof.cible}: the commit must be a full 40-hex sha`);
  }
  const invalid = validateCitedPath(path);
  if (invalid !== null) return fail(`pinned proof ${proof.cible}: ${invalid}`);
  if (repository === input.selfRepository) {
    return fail(
      `pinned proof ${proof.cible} names this repository: write the path alone, it is checked on the tree under review`,
    );
  }
  if (!brick.depots.includes(repository)) {
    return fail(
      `pinned proof ${proof.cible}: ${repository} is not a carrier (depots) of the brick`,
    );
  }
  const visibility = input.repositories.get(repository)?.visibility;
  if (visibility !== "public") {
    return fail(
      `pinned proof ${proof.cible}: ${repository} is ${visibility || "not in the inventory"}, and only a public repository can be cited (I-15)`,
    );
  }
  return { ok: true, kind: "epinglee", note: proof.cible };
}

function count<T extends string>(keys: readonly T[], values: readonly T[]): Record<T, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const value of values) counts[value] += 1;
  return counts;
}

// ------------------------------------------------------------- evaluation ---

/**
 * Read the whole map and judge it. One check per source file and per brick, so
 * the assertion count is the volume examined, and every counter printed is
 * summed from the same pass.
 */
export function evaluateBriques(input: BriquesInput): BriquesOutcome {
  const report = new GateReport();

  // The doctrine sources a brick cites. An empty one is unreadable, not empty.
  report.check(
    "docs/decisions/INVARIANTS.md",
    input.invariants.size > 0,
    `${input.invariants.size} invariant row(s) read`,
  );
  report.check(
    "docs/decisions/DECISION-REGISTER.md",
    input.registerDecisions.size > 0,
    `${input.registerDecisions.size} decision row(s) read`,
  );
  report.check("docs/adr/", input.adrNumbers.size > 0, `${input.adrNumbers.size} numbered ADR(s)`);
  report.check(
    "ecosystem/repositories.v1.yaml",
    input.repositories.size > 0,
    `${input.repositories.size} repository(ies) read`,
  );
  report.check(
    "catalogue of ADR-0042 §1",
    input.catalogue.size > 0,
    `${input.catalogue.size} product(s) read from the catalogue table`,
  );
  const delegated = input.citations.scope.includes(CITATIONS_SCOPE_ENTRY);
  report.check(
    "tools/quality/pinned-citations.v1.json",
    delegated,
    delegated
      ? `its scope lists ${CITATIONS_SCOPE_ENTRY}: pinned proofs are resolved over git by that gate`
      : `its scope does not list ${CITATIONS_SCOPE_ENTRY}: no gate would resolve a pinned proof`,
  );

  // The universe: every entry under the root falls in exactly one class.
  const layerFiles = new Map<string, TreeEntry>();
  const ficheEntries = new Map<string, TreeEntry>();
  let directories = 0;
  let readmes = 0;
  const strays: string[] = [];
  for (const entry of input.entries) {
    const layerFile = /^([a-z]+)\.v1\.yaml$/.exec(entry.path);
    const fiche = /^([a-z]+)\/([A-Z]{3}-[0-9]{2})\.md$/.exec(entry.path);
    if (entry.kind === "directory" && LAYER_BY_SLUG.has(entry.path)) directories += 1;
    else if (entry.kind === "file" && entry.path === "README.md") readmes += 1;
    else if (
      entry.kind === "file" &&
      layerFile !== null &&
      LAYER_BY_SLUG.has(layerFile[1] as string)
    )
      layerFiles.set(layerFile[1] as string, entry);
    else if (entry.kind === "file" && fiche !== null && LAYER_BY_SLUG.has(fiche[1] as string))
      ficheEntries.set(entry.path, entry);
    else strays.push(`${entry.path} (${entry.kind})`);
  }
  report.check(
    `${BRIQUES_ROOT}/`,
    strays.length === 0,
    strays.length === 0
      ? `${input.entries.length} entry(ies), each one a layer file, a layer directory, a fiche or the README`
      : `entry(ies) that are neither a layer file, a layer directory, a fiche nor the README (a link is not followed): ${strays.join(", ")}`,
  );

  // Layer files: all eleven, each readable and valid.
  const loaded: LoadedLayer[] = [];
  for (const rule of LAYERS) {
    const item = `${BRIQUES_ROOT}/${rule.slug}.v1.yaml`;
    if (!layerFiles.has(rule.slug)) {
      report.check(
        item,
        false,
        "layer file missing: ADR-0064 D1 names eleven layers, and a missing source is not zero bricks",
      );
      continue;
    }
    const text = input.read(`${rule.slug}.v1.yaml`);
    if (text === null) {
      report.check(item, false, "unreadable — unreadable is not zero bricks");
      continue;
    }
    let value: unknown;
    try {
      value = Bun.YAML.parse(text);
    } catch (error) {
      report.check(item, false, `invalid YAML (${(error as Error).message})`);
      continue;
    }
    const errors = validateLayerFile(value);
    const declared = (value as { couche?: unknown } | null)?.couche;
    if (errors.length === 0 && declared !== rule.slug) {
      errors.push(
        `/couche: the file declares « ${String(declared)} », its name says « ${rule.slug} »`,
      );
    }
    if (errors.length > 0) {
      report.check(item, false, errors.join("; "));
      continue;
    }
    const bricks = (value as { briques: BrickData[] }).briques;
    report.check(item, true, `${bricks.length} brick(s), schema ${SCHEMA_VERSION}`);
    loaded.push({ rule, bricks });
  }

  // Identifiers: one brick per id, across every layer.
  const owners = new Map<string, LayerSlug[]>();
  for (const layer of loaded) {
    for (const brick of layer.bricks) {
      owners.set(brick.id, [...(owners.get(brick.id) ?? []), layer.rule.slug]);
    }
  }
  const dependencies = new Map<string, readonly string[]>();
  for (const layer of loaded) {
    for (const brick of layer.bricks) dependencies.set(brick.id, brick.depend_de);
  }
  const dependedOn = new Set<string>([...dependencies.values()].flat());

  const built: Brick[] = [];
  const seenFiches = new Set<string>();
  let localProofs = 0;
  let pinnedProofs = 0;
  for (const layer of loaded) {
    for (const brick of layer.bricks) {
      const errors: string[] = [];
      const rule = layer.rule;

      if (!brick.id.startsWith(`${rule.prefix}-`)) {
        errors.push(`id prefix is not ${rule.prefix}, the prefix of layer ${rule.slug}`);
      }
      if ((owners.get(brick.id) ?? []).length > 1) {
        errors.push(
          `id declared ${(owners.get(brick.id) ?? []).length} times (${(owners.get(brick.id) ?? []).join(", ")})`,
        );
      }

      // Dependencies: resolved, admitted by the layer table, acyclic.
      for (const dependency of brick.depend_de) {
        const target = layerOfId(dependency);
        if (dependency === brick.id) {
          errors.push("depends on itself");
        } else if (!owners.has(dependency) || target === undefined) {
          errors.push(`depends on ${dependency}, which no layer file declares`);
        } else if (target.slug === "produit") {
          errors.push(
            `depends on ${dependency}: ADR-0064 D1, a produit brick is never a dependency`,
          );
        } else if (target.slug !== rule.slug && !rule.mayDependOn.includes(target.slug)) {
          errors.push(
            `depends on ${dependency} (${target.slug}): ADR-0064 D1, layer ${rule.slug} may depend on ${rule.mayDependOn.join(", ") || "no other layer"}`,
          );
        }
      }
      const cycle = findCycle(brick.id, dependencies);
      if (cycle !== null) errors.push(`dependency cycle: ${cycle.join(" → ")}`);

      // Doctrine citations.
      if (rule.slug !== "gouvernance" && brick.invariants.length === 0) {
        errors.push(
          "ADR-0064 D1 — a brick outside the gouvernance layer cites at least one invariant",
        );
      }
      for (const invariant of brick.invariants) {
        const standing = input.invariants.get(invariant);
        if (standing === undefined)
          errors.push(`cites ${invariant}, which INVARIANTS.md does not list`);
        else if (standing === "retiré") errors.push(`cites ${invariant}, which is withdrawn`);
      }
      for (const decision of brick.decisions) {
        const adr = /^ADR-([0-9]{4})$/.exec(decision);
        const known =
          adr === null
            ? input.registerDecisions.has(decision)
            : input.adrNumbers.has(adr[1] as string);
        if (!known) {
          errors.push(
            `cites ${decision}, which ${adr === null ? "the decision register" : "docs/adr/"} does not hold`,
          );
        }
      }
      for (const repository of brick.depots) {
        if (!input.repositories.has(repository)) {
          errors.push(`carrier ${repository} is not in ecosystem/repositories.v1.yaml`);
        }
      }

      // Layer-conditional fields, each under the name of its rule.
      if (rule.slug === "fabrique" && brick.preuve_produite === undefined) {
        errors.push(
          "ADR-0064 D1 — a fabrique brick declares the proof it produces (preuve_produite)",
        );
      }
      if (rule.slug !== "fabrique" && brick.preuve_produite !== undefined) {
        errors.push("preuve_produite belongs to the fabrique layer only");
      }
      if (rule.slug === "produit" && brick.charte === undefined) {
        errors.push("a produit brick carries a charte (valeur, pour_qui, degel, abandon, refus)");
      }
      if (rule.slug !== "produit" && brick.charte !== undefined) {
        errors.push("charte belongs to the produit layer only");
      }
      if (rule.slug === "gouvernance" && brick.autonomie !== "discover") {
        errors.push(
          `autonomie ${brick.autonomie}: I-17, the gouvernance layer is the human-touch surface, an agent proposes there (discover)`,
        );
      }
      if (rule.slug === "produit") {
        const product = `P${brick.id.slice(4)}`;
        if (!input.catalogue.has(product)) {
          errors.push(`${product} is not in the catalogue of ADR-0042 §1`);
        }
        for (const field of ["degel", "abandon"] as const) {
          const word = DELAY_WORDS.exec(brick.charte?.[field] ?? "");
          if (word !== null) {
            errors.push(
              `charte.${field} names a delay (« ${word[0]} »): it must name an observable fact`,
            );
          }
        }
      }
      if (dependedOn.has(brick.id) && rule.slug === "produit") {
        errors.push("ADR-0064 D1 — a produit brick is the dependency of another brick");
      }
      if (brick.retrait !== undefined) {
        if (!input.registerDecisions.has(brick.retrait.decision)) {
          errors.push(
            `retrait cites ${brick.retrait.decision}, which the decision register does not hold`,
          );
        }
        if (brick.retrait.date > input.latestDate) {
          errors.push(
            `retrait dated ${brick.retrait.date} is in the future (bound: ${input.latestDate})`,
          );
        }
      }
      if (brick.origine.date !== undefined && brick.origine.date > input.latestDate) {
        errors.push(
          `origine dated ${brick.origine.date} is in the future (bound: ${input.latestDate})`,
        );
      }

      // Proofs.
      let held = 0;
      for (const proof of brick.preuve) {
        const verdict = judgeProof(brick, proof, input);
        if (!verdict.ok) {
          errors.push(verdict.note);
          continue;
        }
        held += 1;
        if (verdict.kind === "locale") localProofs += 1;
        else pinnedProofs += 1;
      }

      // The fiche: present, titled like the brick, with its four sections.
      const fichePath = `${rule.slug}/${brick.id}.md`;
      let sections: readonly FicheSection[] = [];
      seenFiches.add(fichePath);
      if (!ficheEntries.has(fichePath)) {
        errors.push(`fiche ${BRIQUES_ROOT}/${fichePath} is missing (ADR-0064 D3)`);
      } else {
        const text = input.read(fichePath);
        if (text === null) {
          errors.push(`fiche ${BRIQUES_ROOT}/${fichePath} is unreadable`);
        } else {
          const fiche = parseFiche(text);
          const expected = `${brick.id} — ${brick.nom}`;
          if (fiche.title !== expected) {
            errors.push(`fiche title is « ${fiche.title ?? ""} », the YAML says « ${expected} »`);
          }
          const titles = fiche.sections.map((section) => section.title);
          if (titles.join(" | ") !== FICHE_SECTIONS.join(" | ")) {
            errors.push(
              `fiche sections are « ${titles.join(" | ")} », expected « ${FICHE_SECTIONS.join(" | ")} »`,
            );
          }
          const empty = fiche.sections.filter((section) => section.body.length === 0);
          if (empty.length > 0) {
            errors.push(
              `fiche section(s) empty: ${empty.map((section) => section.title).join(", ")}`,
            );
          }
          // A status written in prose goes stale the day a proof lands, and a
          // reader cannot tell it from the derived one. The machine values are
          // refused; the fiche says which proof exists and which one is awaited.
          const stated = TYPED_STATUS.exec(
            fiche.sections.map((section) => section.body).join("\n"),
          );
          if (stated !== null) {
            errors.push(
              `fiche states a status (« ${stated[0]} »): ADR-0064 D4, the status is derived, never typed`,
            );
          }
          sections = fiche.sections;
        }
      }

      const statut: Status =
        brick.retrait !== undefined ? "retiree" : held > 0 ? "en_cours" : "decrite";
      report.check(
        brick.id,
        errors.length === 0,
        errors.length === 0 ? `${statut}, ${held} proof(s) held` : errors.join("; "),
      );
      built.push({ ...brick, couche: rule.slug, statut, fiche: sections, preuves_tenues: held });
    }
  }

  // Fiches no brick declares.
  const orphans = [...ficheEntries.keys()].filter((path) => !seenFiches.has(path)).sort();
  if (ficheEntries.size > 0 || built.length > 0) {
    report.check(
      "fiches",
      orphans.length === 0,
      orphans.length === 0
        ? `${ficheEntries.size} fiche(s), each one declared by a brick`
        : `fiche(s) no layer file declares (ADR-0064 D3): ${orphans.join(", ")}`,
    );
  }

  const products = built.filter((brick) => brick.couche === "produit");
  const counters: Counters = {
    briques: built.length,
    par_couche: Object.fromEntries(
      LAYERS.map((layer) => [
        layer.slug,
        built.filter((brick) => brick.couche === layer.slug).length,
      ]),
    ),
    par_statut: count(
      STATUSES,
      built.map((brick) => brick.statut),
    ),
    par_origine: count(
      ["inspection", "observed", "propre"] as const,
      built.map((brick) => brick.origine.type),
    ),
    par_autonomie: count(
      ["discover", "modify", "govern"] as const,
      built.map((brick) => brick.autonomie),
    ),
    preuves_locales: localProofs,
    preuves_epinglees: pinnedProofs,
    sans_depot_porteur: built.filter((brick) => brick.depots.length === 0).length,
    jetables: built.filter((brick) => brick.jetable !== undefined).length,
    catalogue_produits: input.catalogue.size,
    produits_en_brique: products.length,
  };

  const verified = LAYERS.filter((layer) => layer.ownRuleVerified).map((layer) => layer.slug);
  const perLayer = LAYERS.map((layer) => `${layer.slug} ${counters.par_couche[layer.slug]}`).join(
    ", ",
  );
  const volume =
    `${counters.briques} brick(s) in ${loaded.length} of ${LAYERS.length} layer file(s) (${perLayer}); ` +
    `${input.entries.length} entry(ies) under ${BRIQUES_ROOT}/ = ${layerFiles.size} layer file(s) + ${directories} layer directory(ies) + ${ficheEntries.size} fiche(s) + ${readmes} README + ${strays.length} refused; ` +
    `status derived: ${STATUSES.map((status) => `${status} ${counters.par_statut[status]}`).join(", ")} (prototypee cannot be reached in v1: no instrument verifies a signed release); ` +
    `proofs held: ${localProofs} on this tree, ${pinnedProofs} pinned and left to the pinned-citations gate; ` +
    `products: ${counters.catalogue_produits} in the catalogue of ADR-0042 §1 = ${counters.produits_en_brique} as bricks + ${counters.catalogue_produits - counters.produits_en_brique} outside the map; ` +
    `layer rules: ${verified.length} verified (${verified.join(", ")}), ${LAYERS.length - verified.length} declarative, not verified by this gate; ` +
    `origin: ${counters.par_origine.inspection} inspection, ${counters.par_origine.observed} observed, ${counters.par_origine.propre} propre; ` +
    `autonomy: ${counters.par_autonomie.discover} discover, ${counters.par_autonomie.modify} modify, ${counters.par_autonomie.govern} govern; ` +
    `${counters.sans_depot_porteur} brick(s) without a carrier repository, ${counters.jetables} transitional`;
  report.volume(volume);

  const map: BrickMap | null =
    report.violations.length > 0
      ? null
      : {
          schema_version: SCHEMA_VERSION,
          couches: LAYERS.map((layer) => ({
            ...layer,
            briques: built.filter((brick) => brick.couche === layer.slug),
          })),
          compteurs: counters,
        };
  return { report, map, volume };
}
