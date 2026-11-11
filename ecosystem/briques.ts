import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { exemptionKey, scanText, validateCitedPath } from "../tools/quality/check-pinned-citations";
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
 * PROOFS. A target is a path of this repository or a pinned citation
 * `<organisation>/<repository>@<40-hex sha>:<path>` of a PUBLIC carrier
 * repository.
 *   - A local target holds on a TRACKED, regular, non-empty file outside the
 *     map itself. « It exists on disk » was the first rule, and a directory, a
 *     link to a file outside the tree, an untracked file and the brick's own
 *     fiche all satisfied it (review of 2026-11-11, F1).
 *   - A pinned target is not resolved here: this module does not go to the
 *     network. It checks the form, the carrier and the visibility, then holds
 *     the delegation to the pinned-citations gate to three facts: that gate's
 *     scope lists `ecosystem/briques/`; its own reader (`scanText`) finds this
 *     very citation in the raw text of the layer file, since a value the YAML
 *     decoder rebuilds from an escape is a citation nobody resolves (F2); and
 *     the citation is not exempted there, an exemption meaning « not resolved ».
 * A proof in a private repository cannot be cited: this module refuses it, on
 * the reading that nothing is exposed before something is verifiable (I-15).
 * A brick carried only by a private repository stays `decrite`.
 *
 * THE MAP IS WHAT GIT TRACKS. The entries under `ecosystem/briques/` are read
 * from the index, with their mode: a symbolic link is refused, at the root as
 * anywhere below it, and an untracked file is not part of the map.
 *
 * WHAT THE YAML CITES, THE FICHE NAMES. Every dependency, invariant and
 * decision of the YAML must be named in the fiche: a citation whose reason
 * nobody can read was the common form of a filler in the first map.
 *
 * LAYER RULES. Three rules of D1 are verified here (no dependency outside the
 * table; a fabrique brick declares the proof it produces; a produit brick is a
 * dependency of nothing). The eight others are statements about behaviour that
 * no data can show; they are printed as declarative, never counted as verified.
 * The second half of the gouvernance rule (« every other brick cites at least
 * one invariant ») is counted, not enforced: the bricks it would refuse are
 * named in the volume, so the gap is read instead of being papered over.
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
  /**
   * When only a part of `ownRule` is verified: which part, and what becomes of
   * the rest. A reader of the page must not read « verified » on the whole rule.
   */
  readonly ownRuleVerifiedOnly?: string;
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
    ownRuleVerifiedOnly:
      "pour sa première moitié seulement ; la seconde est comptée et ne bloque pas",
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
 * effort. The list is the one the charter review of 2026-11-09 fixed, word for
 * word, and nothing more: `\p{L}` on both sides, so that « jours » is refused
 * and « toujours » or « mise à jour » are not. It is a floor, not a grammar of
 * delays: « dans un an » passes it, and a reader still has to read the charter.
 */
const DELAY_WORDS = /(?<!\p{L})(bient[oô]t|rapidement|jours|semaines|mois)(?!\p{L})/iu;

export type Status = "decrite" | "en_cours" | "prototypee" | "retiree";
export const STATUSES: readonly Status[] = ["decrite", "en_cours", "prototypee", "retiree"];
/** The machine values of the status, which neither a fiche nor a YAML text writes (D4). */
const TYPED_STATUS = /(?<![\p{L}_])(decrite|en_cours|prototypee|retiree)(?![\p{L}_])/iu;

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
  /** Identifiers of the bricks outside the gouvernance layer that cite no invariant. */
  readonly sans_invariant: readonly string[];
  /** Proof targets cited by more than one brick: one artefact, several bricks. */
  readonly cibles_partagees: number;
  readonly jetables: number;
  readonly catalogue_produits: number;
  readonly produits_en_brique: number;
}

export type InvariantStanding = "en vigueur" | "retiré";

/** What a tracked path is, from its git mode: a link is never followed. */
export type EntryKind = "file" | "link" | "other";

export interface TreeEntry {
  /** Relative to `BRIQUES_ROOT`, with `/` separators; `.` for the root itself. */
  readonly path: string;
  readonly kind: EntryKind;
}

/** What a repository-relative path is in the tree under review. */
export type LocalTarget = "regular" | "absent" | "link" | "empty" | "other";

export interface BriquesInput {
  /** Every TRACKED entry under `BRIQUES_ROOT`. An untracked file is not part of the map. */
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
  /** What a repository-relative path is: a proof holds on a tracked, regular, non-empty file. */
  readonly localTarget: (path: string) => LocalTarget;
  /**
   * Repository-relative paths of the tracked files whose working copy differs
   * from the index (modified, deleted, or changed of type). The names and the
   * modes come from the index and the contents from the disk: a file in this
   * set was judged on a content git does not track, so it is refused (G1).
   */
  readonly unstaged: ReadonlySet<string>;
  /**
   * Repository-relative paths of the doctrine files the collections above were
   * read from: one of them changed on disk and not staged is refused like a
   * file of the map (third review, H2).
   */
  readonly doctrineSources: readonly string[];
  /** The configuration of the pinned-citations gate, which resolves foreign proofs. */
  readonly citations: {
    readonly organization: string;
    readonly scope: readonly string[];
    /** `exemptionKey(file, citation)` of every exemption: an exempted citation is not resolved. */
    readonly exemptions: ReadonlySet<string>;
  };
  /** The latest acceptable date, ISO (tomorrow: the cards' tolerance). */
  readonly latestDate: string;
}

export interface BriquesOutcome {
  readonly report: GateReport;
  /** Null when a violation was found: a page is never generated from a red map. */
  readonly map: BrickMap | null;
  readonly volume: string;
}

// ---------------------------------------------------------------- parsers ---

/**
 * `| I-NN | text … |` rows of INVARIANTS.md. A row whose text opens with
 * « Retiré », whatever the emphasis or the case around it, is withdrawn.
 */
export function parseInvariants(markdown: string): Map<string, InvariantStanding> {
  const found = new Map<string, InvariantStanding>();
  for (const line of markdown.split("\n")) {
    const row = /^\|\s*(I-[0-9]{2,3})\s*\|\s*(.*)$/.exec(line);
    if (row === null) continue;
    const [, id, rest] = row as unknown as [string, string, string];
    found.set(id, /^[\s*_~]*retir[ée]/i.test(rest) ? "retiré" : "en vigueur");
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
 * « Le catalogue d'applications » (numbered or not), up to the next heading.
 * The count is never written here; it is whatever the decision record lists.
 */
export function parseCatalogue(adr0042: string): Set<string> {
  const found = new Set<string>();
  let inside = false;
  for (const line of adr0042.split("\n")) {
    if (/^#{2,6}\s/.test(line)) {
      inside = /^#{2,6}\s+(?:[0-9]+\.\s+)?Le catalogue d'applications\s*$/i.test(line);
      continue;
    }
    if (!inside || !line.startsWith("|")) continue;
    for (const match of line.matchAll(/(?<![A-Za-z0-9])P[0-9]{2}(?![A-Za-z0-9])/g)) {
      found.add(match[0]);
    }
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
  /** The `# ` headings, in order: a fiche has exactly one. */
  readonly titles: readonly string[];
  /** The text between the title and the first section: a fiche has none. */
  readonly preamble: string;
  readonly sections: readonly FicheSection[];
}

/** `<!-- … -->` spans removed in one pass; an unterminated comment is kept as text. */
function withoutComments(text: string): string {
  let out = "";
  let cursor = 0;
  for (;;) {
    const open = text.indexOf("<!--", cursor);
    if (open === -1) break;
    const close = text.indexOf("-->", open + 4);
    if (close === -1) break;
    out += text.slice(cursor, open);
    cursor = close + 3;
  }
  return out + text.slice(cursor);
}

/**
 * A `# ` or `## ` heading at column 0, its closing `#`s removed. Read by index,
 * not by one expression: a title followed by a long run of spaces made the
 * expression backtrack quadratically (review of 2026-11-11, G8).
 */
function headingOf(line: string): { level: 1 | 2; text: string } | null {
  // One or two `#`, then a space or a tab: `#mot` and `### x` are not read.
  const level = line.startsWith("##") ? 2 : line.startsWith("#") ? 1 : null;
  if (level === null || (line[level] !== " " && line[level] !== "\t")) return null;
  let text = line.slice(level + 1).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  // `## Contexte ##` closes; `## C#` does not: the closing run follows a space.
  if (end < text.length && (end === 0 || /\s/.test(text[end - 1] as string))) {
    text = text.slice(0, end).trimEnd();
  }
  return text.length === 0 ? null : { level, text };
}

/**
 * The prose a reader of the rendered fiche sees, for the rule « the fiche
 * names what the YAML cites »: headings, comments (closed or not), link
 * definitions and HTML tags are removed, so an identifier hidden in one of
 * them does not count as named (G3). A floor, not a Markdown renderer.
 */
function readableProse(text: string): string {
  const closed = withoutComments(text);
  // What is left of a comment marker is an unterminated comment: hidden to the end.
  const unterminated = closed.indexOf("<!--");
  const visible = unterminated === -1 ? closed : closed.slice(0, unterminated);
  return (
    visible
      .split("\n")
      .filter((line) => headingOf(line) === null && !/^\s*\[[^\]]*\]:\s/.test(line))
      .join("\n")
      // `[^<>\n]`, not `[^>\n]`: on a line of `<<<<…` the wider class rescanned
      // the line from every `<` (third review, H7).
      .replace(/<[^<>\n]*>/g, " ")
  );
}

/**
 * C0, DEL, C1, and the two Unicode line separators a terminal or a runner may
 * break on. Built from code points: a source file must not carry these
 * characters, and two of them end a line inside a regular-expression literal.
 */
export const CONTROL_CHARACTERS = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x2028, 0x2029],
  ]
    .map(
      ([from, to]) => `${String.fromCharCode(from as number)}-${String.fromCharCode(to as number)}`,
    )
    .join("")}]`,
  "g",
);

/** Control characters made visible: a value of the data never forges a line of the output. */
function printable(text: string): string {
  return text.replace(CONTROL_CHARACTERS, (character) => {
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

/**
 * A fiche: one `# ` title, then `## ` sections. Licence comments are not
 * content, and a `#` inside a fenced code block is not a heading.
 */
export function parseFiche(text: string): ParsedFiche {
  const titles: string[] = [];
  const preamble: string[] = [];
  const sections: { title: string; lines: string[] }[] = [];
  let fence: string | null = null;
  for (const line of withoutComments(text).split("\n")) {
    const fenced = /^\s*(```|~~~)/.exec(line);
    if (fenced !== null) {
      if (fence === null) fence = fenced[1] as string;
      else if (fence === fenced[1]) fence = null;
    }
    const heading = fence === null && fenced === null ? headingOf(line) : null;
    if (heading !== null && heading.level === 1) {
      titles.push(heading.text);
      continue;
    }
    if (heading !== null) {
      sections.push({ title: heading.text, lines: [] });
      continue;
    }
    const current = sections.at(-1);
    if (current === undefined) preamble.push(line);
    else current.lines.push(line);
  }
  return {
    titles,
    preamble: preamble.join("\n").trim(),
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

/**
 * A typed-in status among the fields of a brick: refused under the name of its
 * rule (ADR-0064 D4), before the schema would refuse it as an unknown field.
 * A status field nested deeper is refused by the closed schema.
 */
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
  /** The pinned citations the citations gate reads in the raw text of the file. */
  readonly pinned: ReadonlySet<string>;
}

function layerOfId(id: string): LayerRule | undefined {
  return LAYER_BY_PREFIX.get(id.slice(0, 3));
}

/**
 * Every brick that is on a dependency cycle, with one cycle it is on, written
 * from that brick. One depth-first pass with three colours: linear in the
 * number of bricks and dependencies, whatever the shape of the graph.
 */
export function findCycles(
  dependencies: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
  const cycles = new Map<string, string[]>();
  const done = new Set<string>();
  const path: string[] = [];
  const onPath = new Set<string>();
  const visit = (id: string): void => {
    if (done.has(id)) return;
    if (onPath.has(id)) {
      const loop = path.slice(path.indexOf(id));
      loop.forEach((member, index) => {
        if (!cycles.has(member)) {
          cycles.set(member, [...loop.slice(index), ...loop.slice(0, index), member]);
        }
      });
      return;
    }
    path.push(id);
    onPath.add(id);
    for (const next of dependencies.get(id) ?? []) visit(next);
    path.pop();
    onPath.delete(id);
    done.add(id);
  };
  for (const id of dependencies.keys()) visit(id);
  return cycles;
}

/**
 * The prose a brick carries in its YAML, for the check that no text states a
 * status. Identifiers, carriers and proof targets are not prose: a path named
 * `docs/en_cours/x.md` is a path (G10).
 */
function proseOf(brick: BrickData): string[] {
  const charter = brick.charte;
  return [
    brick.nom,
    brick.role,
    brick.preuve_produite ?? "",
    brick.jetable ?? "",
    brick.origine.source ?? "",
    ...(charter === undefined
      ? []
      : [charter.valeur, charter.pour_qui, charter.degel, charter.abandon, ...charter.refus]),
  ];
}

/** Whether `text` names `identifier` as a whole token (`D10` is not named by `D103`). */
function names(text: string, identifier: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(identifier, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : (text[at - 1] as string);
    const after = text[at + identifier.length] ?? "";
    if (!/[A-Za-z0-9-]/.test(before) && !/[A-Za-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

interface ProofVerdict {
  readonly ok: boolean;
  readonly kind: "locale" | "epinglee";
  readonly note: string;
}

const STAGE_FIRST =
  "its working copy differs from the index: stage it before running the gate, which judges what git tracks";

const LOCAL_TARGET_REFUSAL: Readonly<Record<Exclude<LocalTarget, "regular">, string>> = {
  absent: "is not a tracked file of this repository (stage a new file before running the gate)",
  link: "is a symbolic link, and a link is not followed",
  empty: "is an empty file",
  other: "is not a regular file",
};

function judgeProof(
  brick: BrickData,
  proof: Proof,
  layer: LoadedLayer,
  input: BriquesInput,
): ProofVerdict {
  const pinned = /^([^/@\s]+)\/([^/@\s]+)@([^:]*):(.*)$/.exec(proof.cible);
  if (proof.date > input.latestDate) {
    return {
      ok: false,
      kind: pinned === null ? "locale" : "epinglee",
      note: `proof dated ${proof.date} is in the future (bound: ${input.latestDate})`,
    };
  }
  if (pinned === null) {
    const refuse = (note: string): ProofVerdict => ({ ok: false, kind: "locale", note });
    const invalid = validateCitedPath(proof.cible);
    if (invalid !== null) return refuse(`proof target ${proof.cible}: ${invalid}`);
    if (proof.cible === BRIQUES_ROOT || proof.cible.startsWith(`${BRIQUES_ROOT}/`)) {
      return refuse(
        `proof target ${proof.cible} is part of the map itself: a brick is not proved by its own description`,
      );
    }
    if (input.selfRepository === null) {
      return refuse(
        "the name of this repository could not be derived, so a local proof names no carrier",
      );
    }
    if (!brick.depots.includes(input.selfRepository)) {
      return refuse(
        `proof target ${proof.cible} is a path of ${input.selfRepository}, which is not a carrier (depots) of the brick`,
      );
    }
    if (input.unstaged.has(proof.cible)) {
      return refuse(`proof target ${proof.cible}: ${STAGE_FIRST}`);
    }
    const target = input.localTarget(proof.cible);
    return target === "regular"
      ? { ok: true, kind: "locale", note: proof.cible }
      : refuse(`proof target ${proof.cible} ${LOCAL_TARGET_REFUSAL[target]}`);
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
    return fail(`pinned proof ${proof.cible}: the commit must be a full 40-hex sha, in lower case`);
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
  // The delegation is checked, not assumed: the citations gate reads the raw
  // text of the file, so the proof holds only if that reader finds this very
  // citation there. A value the YAML decoder rebuilds from an escape, or one
  // followed by a character the reader strips, is a citation nobody resolves.
  if (!layer.pinned.has(proof.cible)) {
    return fail(
      `pinned proof ${proof.cible}: the pinned-citations gate does not read this citation in the text of the layer file; write it plainly, unquoted or in double quotes, with nothing after it`,
    );
  }
  const file = `${BRIQUES_ROOT}/${layer.rule.slug}.v1.yaml`;
  if (input.citations.exemptions.has(exemptionKey(file, proof.cible))) {
    return fail(
      `pinned proof ${proof.cible} is exempted in the pinned-citations configuration: an exempted citation is not resolved, so it proves nothing`,
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
  const gate = new GateReport();
  // Every item and every note goes through one point where control characters
  // are made visible: a file name, a YAML key or a title of the data cannot
  // print a line of its own in the output of the gate (G4).
  const report = {
    check: (item: string, ok: boolean, note: string) =>
      gate.check(printable(item), ok, printable(note)),
  };

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
  // The doctrine was read on disk: a source changed there and not staged is a
  // doctrine git does not track. Checked for each one, so the volume says how
  // many sources the verdict rests on.
  const driftedSources = [...input.doctrineSources, `${BRIQUES_ROOT}/README.md`].filter((path) =>
    input.unstaged.has(path),
  );
  report.check(
    "doctrine sources",
    driftedSources.length === 0,
    driftedSources.length === 0
      ? `${input.doctrineSources.length} doctrine file(s) read, each one as indexed`
      : `${driftedSources.join(", ")}: ${STAGE_FIRST}`,
  );

  // The universe: every tracked entry under the root falls in exactly one class.
  const layerFiles = new Map<string, TreeEntry>();
  const ficheEntries = new Map<string, TreeEntry>();
  let readmes = 0;
  const strays: string[] = [];
  for (const entry of input.entries) {
    const layerFile = /^([a-z]+)\.v1\.yaml$/.exec(entry.path);
    const fiche = /^([a-z]+)\/([A-Z]{3}-[0-9]{2})\.md$/.exec(entry.path);
    if (entry.kind === "file" && entry.path === "README.md") readmes += 1;
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
      ? `${input.entries.length} tracked entry(ies), each one a layer file, a fiche or the README`
      : `tracked entry(ies) that are neither a layer file, a fiche nor the README (a link is not followed): ${strays.join(", ")}`,
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
    if (input.unstaged.has(item)) {
      report.check(item, false, STAGE_FIRST);
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
    // What the citations gate reads in this file, by its own reader.
    const scanned = scanText(text, input.citations.organization, []);
    for (const rejected of scanned.rejected) {
      errors.push(
        `line ${rejected.line}: the pinned-citations gate refuses « ${rejected.text} » (${rejected.reason})`,
      );
    }
    if (errors.length > 0) {
      report.check(item, false, errors.join("; "));
      continue;
    }
    const bricks = (value as { briques: BrickData[] }).briques;
    report.check(item, true, `${bricks.length} brick(s), schema ${SCHEMA_VERSION}`);
    loaded.push({
      rule,
      bricks,
      pinned: new Set(
        scanned.pinned
          .filter((citation) => citation.path !== null && citation.lines === null)
          .map((citation) => citation.text),
      ),
    });
  }

  // Identifiers: one brick per id, across every layer.
  const owners = new Map<string, LayerSlug[]>();
  const dependencies = new Map<string, readonly string[]>();
  const withdrawn = new Set<string>();
  for (const layer of loaded) {
    for (const brick of layer.bricks) {
      owners.set(brick.id, [...(owners.get(brick.id) ?? []), layer.rule.slug]);
      dependencies.set(brick.id, brick.depend_de);
      if (brick.retrait !== undefined) withdrawn.add(brick.id);
    }
  }
  const dependedOn = new Set<string>([...dependencies.values()].flat());
  const cycles = findCycles(dependencies);

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

      // Dependencies: resolved, admitted by the layer table, standing, acyclic.
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
        } else if (withdrawn.has(dependency) && brick.retrait === undefined) {
          errors.push(`depends on ${dependency}, which is withdrawn`);
        }
      }
      const cycle = cycles.get(brick.id);
      if (cycle !== undefined && !brick.depend_de.includes(brick.id)) {
        errors.push(`dependency cycle: ${cycle.join(" → ")}`);
      }

      // Doctrine citations. A brick outside the gouvernance layer that cites no
      // invariant is COUNTED and named in the volume, not refused: refused, the
      // first complete map came back with invariants cited from afar to satisfy
      // the rule, and a filler cannot be told from a citation that binds. The
      // gap is the information (ADR-0064, implementation notes of 2026-11-11).
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
      const typedInData = TYPED_STATUS.exec(proseOf(brick).join("\n"));
      if (typedInData !== null) {
        errors.push(
          `a field states a status (« ${typedInData[0]} »): ADR-0064 D4, the status is derived, never typed`,
        );
      }

      // Proofs. One artefact is one proof: the same target under two dates
      // would be held twice (G9).
      const targets = brick.preuve.map((proof) => proof.cible);
      const repeated = [...new Set(targets.filter((target, at) => targets.indexOf(target) !== at))];
      if (repeated.length > 0) {
        errors.push(`proof target cited twice by the same brick: ${repeated.join(", ")}`);
      }
      let held = 0;
      for (const proof of brick.preuve) {
        const verdict = judgeProof(brick, proof, layer, input);
        if (!verdict.ok) {
          errors.push(verdict.note);
          continue;
        }
        held += 1;
        if (verdict.kind === "locale") localProofs += 1;
        else pinnedProofs += 1;
      }

      // The fiche: present, titled like the brick, with its four sections, and
      // naming everything the YAML cites — a citation the fiche never names is
      // a citation nobody can read the reason of.
      const fichePath = `${rule.slug}/${brick.id}.md`;
      let sections: readonly FicheSection[] = [];
      seenFiches.add(fichePath);
      if (!ficheEntries.has(fichePath)) {
        errors.push(`fiche ${BRIQUES_ROOT}/${fichePath} is missing (ADR-0064 D3)`);
      } else {
        const text = input.read(fichePath);
        if (input.unstaged.has(`${BRIQUES_ROOT}/${fichePath}`)) {
          errors.push(`fiche ${BRIQUES_ROOT}/${fichePath}: ${STAGE_FIRST}`);
        } else if (text === null) {
          errors.push(`fiche ${BRIQUES_ROOT}/${fichePath} is unreadable`);
        } else {
          const fiche = parseFiche(text);
          const expected = `${brick.id} — ${brick.nom}`;
          if (fiche.titles.length !== 1 || fiche.titles[0] !== expected) {
            errors.push(
              `fiche title is « ${fiche.titles.join(" » then « ")} », the YAML says « ${expected} », once`,
            );
          }
          if (fiche.preamble.length > 0) {
            errors.push("fiche carries text between its title and its first section");
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
          // refused wherever they are written in the fiche, in any case, and
          // with or without a Markdown escape.
          const prose = withoutComments(text).replaceAll("\\", "");
          const readable = readableProse(text);
          const stated = TYPED_STATUS.exec(prose);
          if (stated !== null) {
            errors.push(
              `fiche states a status (« ${stated[0]} »): ADR-0064 D4, the status is derived, never typed`,
            );
          }
          const unnamed = [...brick.depend_de, ...brick.invariants, ...brick.decisions].filter(
            (identifier) => !names(readable, identifier),
          );
          if (unnamed.length > 0) {
            errors.push(
              `the YAML cites ${unnamed.join(", ")}, which the fiche never names: say in the fiche what each one binds, or remove it`,
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
  const unbound = built
    .filter((brick) => brick.couche !== "gouvernance" && brick.invariants.length === 0)
    .map((brick) => brick.id);
  const citedBy = new Map<string, number>();
  for (const brick of built) {
    for (const target of new Set(brick.preuve.map((proof) => proof.cible))) {
      citedBy.set(target, (citedBy.get(target) ?? 0) + 1);
    }
  }
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
    sans_invariant: unbound,
    cibles_partagees: [...citedBy.values()].filter((bricks) => bricks > 1).length,
    jetables: built.filter((brick) => brick.jetable !== undefined).length,
    catalogue_produits: input.catalogue.size,
    produits_en_brique: products.length,
  };

  const verified = LAYERS.filter((layer) => layer.ownRuleVerified).map((layer) => layer.slug);
  // The partial rule is named from the field the page prints. The sentence below describes the
  // gouvernance rule only: the test suite holds the field to that one layer, on a verified rule.
  const partly = LAYERS.filter((layer) => layer.ownRuleVerifiedOnly !== undefined).map(
    (layer) => layer.slug,
  );
  const perLayer = LAYERS.map((layer) => `${layer.slug} ${counters.par_couche[layer.slug]}`).join(
    ", ",
  );
  const volume =
    `${counters.briques} brick(s) in ${loaded.length} of ${LAYERS.length} layer file(s) (${perLayer}); ` +
    `${input.entries.length} tracked entry(ies) under ${BRIQUES_ROOT}/ = ${layerFiles.size} layer file(s) + ${ficheEntries.size} fiche(s) + ${readmes} README + ${strays.length} refused; ` +
    `status derived: ${STATUSES.map((status) => `${status} ${counters.par_statut[status]}`).join(", ")} (prototypee cannot be reached in v1: no instrument verifies a signed release); ` +
    `proofs held: ${localProofs} on this tree, ${pinnedProofs} pinned, each read by the pinned-citations gate and left to it to resolve; ` +
    `products: ${counters.catalogue_produits} in the catalogue of ADR-0042 §1 = ${counters.produits_en_brique} as bricks + ${counters.catalogue_produits - counters.produits_en_brique} outside the map; ` +
    `layer rules: ${verified.length} verified (${verified.join(", ")}; for ${partly.join(", ")}, its dependency half), ${LAYERS.length - verified.length} declarative, not verified by this gate; ` +
    `origin: ${counters.par_origine.inspection} inspection, ${counters.par_origine.observed} observed, ${counters.par_origine.propre} propre; ` +
    `autonomy: ${counters.par_autonomie.discover} discover, ${counters.par_autonomie.modify} modify, ${counters.par_autonomie.govern} govern; ` +
    `${counters.sans_depot_porteur} brick(s) without a carrier repository, ${counters.jetables} transitional; ` +
    `${unbound.length} brick(s) outside the gouvernance layer bound by no invariant${unbound.length > 0 ? ` (${unbound.join(", ")})` : ""}; ` +
    `${counters.cibles_partagees} proof target(s) cited by more than one brick`;
  gate.volume(volume);

  const map: BrickMap | null =
    gate.violations.length > 0
      ? null
      : {
          schema_version: SCHEMA_VERSION,
          couches: LAYERS.map((layer) => ({
            ...layer,
            briques: built.filter((brick) => brick.couche === layer.slug),
          })),
          compteurs: counters,
        };
  return { report: gate, map, volume };
}
