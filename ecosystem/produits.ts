import Ajv2020, { type ErrorObject } from "ajv/dist/2020";

import { GateReport } from "../tools/quality/gate-report";
import { CONTROL_CHARACTERS, type EntryKind, type LocalTarget } from "./briques";

/**
 * The product catalogue in data: one fiche per product of ADR-0042 §1.
 *
 * WHY. The catalogue existed only as a table of titles in the decision record,
 * and the brick map carries the few products that have a charter. Nothing said
 * what a product does, for whom, what it does not do, or which other products
 * it relies on. `ecosystem/produits/Pnn.v1.yaml` is that statement, one file
 * per product, and the single source later readers (the site, the brick map)
 * are meant to read. No reader is wired here.
 *
 * WHAT THIS MODULE HOLDS. Everything pure: the reader of the domains of the
 * catalogue table, the table that maps a domain to a category identifier, the
 * rules and the counters. `check-produits.ts` is the effectful half.
 *
 * THE CATALOGUE IS DERIVED. The set of products, and the domain of each, are
 * read from the decision record at each run. No count and no list of
 * identifiers is written here: a product added to the ADR without a fiche is a
 * failure the day it is added.
 *
 * NO STATE. A fiche has no field for an advancement: the state of a product is
 * read in the `project.v1.yaml` card of its carrier repository.
 */

export const SCHEMA_VERSION = "libre-ai.produit.v1";
/** Where the fiches live, relative to the repository root. */
export const PRODUITS_ROOT = "ecosystem/produits";
/** The schema a fiche is held to, relative to the repository root: a source of the gate. */
export const SCHEMA_PATH = "ecosystem/schemas/produit.v1.schema.json";
/**
 * The products that have a decided hosted offer, relative to the repository
 * root: a source of the gate, in data. ADR-0066 D2 names them in a sentence
 * and sends each later product to its own decision record, so no versioned
 * source carries the list in a form a reader can hold; it is not written in
 * this code either.
 */
export const HOSTED_OFFERS_PATH = "ecosystem/hosted-offers.v1.yaml";
const HOSTED_OFFERS_VERSION = "libre-ai.hosted-offers.v1";

type Categorie =
  | "connaissance"
  | "bureautique-donnees"
  | "collaboration"
  | "creation-publication"
  | "medias-jeu"
  | "outils-acces"
  | "pedagogie"
  | "poste-de-travail";

/**
 * A domain as ADR-0042 §1 writes it, to the identifier a fiche carries. Written
 * once: the test suite reads the domains back from the ADR and holds this table
 * and the enumeration of the schema to them, so none of the three can drift.
 */
export const DOMAIN_CATEGORIES: ReadonlyMap<string, Categorie> = new Map<string, Categorie>([
  ["Connaissance", "connaissance"],
  ["Bureautique et données", "bureautique-donnees"],
  ["Collaboration", "collaboration"],
  ["Création et publication", "creation-publication"],
  ["Médias et jeu", "medias-jeu"],
  ["Maîtrise des outils et des accès", "outils-acces"],
  ["Pédagogie collective", "pedagogie"],
  ["Poste de travail", "poste-de-travail"],
]);

/** A fiche as the YAML writes it (schema `produit.v1`). */
interface ProduitData {
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly id: string;
  readonly nom_public: string | null;
  readonly nom_provisoire: string | null;
  readonly intitule: string;
  readonly fonction: string;
  readonly categorie: Categorie;
  readonly promesse: string;
  /** The short line the card of the site prints: the fiche is its source, the site projects it. */
  readonly accroche: string;
  readonly pour_qui: string;
  readonly a_la_place_de: string;
  /** The only optional field: written by a product that has a decided hosted offer, by no other. */
  readonly offre?: { readonly sans_frais: string; readonly payant: string };
  readonly capacites: readonly string[];
  readonly ne_fait_pas: readonly string[];
  readonly depend_de: readonly string[];
  readonly realisation: string;
  readonly depot: string | null;
  readonly etiquettes: readonly string[];
  readonly a_relire: readonly string[];
}

/** The text of a file, or the reason it could not be read: a reason is printed, never dropped. */
export type ReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/**
 * One tracked path under `PRODUITS_ROOT`. `unmerged` is a path the index holds
 * at several stages: there is no single indexed content to read, so it is a
 * class of its own and is counted once, whatever the number of its stages.
 */
export interface CatalogueEntry {
  /** Relative to `PRODUITS_ROOT`, with `/` separators; `.` for the root itself. */
  readonly path: string;
  readonly kind: EntryKind | "unmerged";
}

/** A file the gate reads its collections from, and what the index says it is. */
export interface SourceFile {
  /** Repository-relative. */
  readonly path: string;
  /** `regular` is the only standing a source is read under. */
  readonly standing: LocalTarget;
}

export interface ProduitsInput {
  /** Every TRACKED path under `PRODUITS_ROOT`, once. An untracked file is not a fiche. */
  readonly entries: readonly CatalogueEntry[];
  /** Why the index could not be listed, or null when it was. */
  readonly listingError: string | null;
  /** The text of a file under `PRODUITS_ROOT`. */
  readonly read: (path: string) => ReadResult;
  /** The text of the schema (`SCHEMA_PATH`) of the tree judged, or why it could not be read. */
  readonly schema: ReadResult;
  /** The text of the list of hosted offers (`HOSTED_OFFERS_PATH`) of the tree judged, or why it could not be read. */
  readonly offresHebergees: ReadResult;
  /** `P01`…: the products of the catalogue of ADR-0042 §1. */
  readonly catalogue: ReadonlySet<string>;
  /** The domain label(s) the catalogue table gives each product (one, unless the table is wrong). */
  readonly domaines: ReadonlyMap<string, readonly string[]>;
  /** Lines of the catalogue section that were not read in full, each with its reason. */
  readonly catalogueUnread: readonly string[];
  /** `owner/name` of the fleet inventory. */
  readonly repositories: ReadonlyMap<string, { readonly visibility: string }>;
  /** Repository-relative paths of the tracked files whose working copy is not the indexed content. */
  readonly unstaged: ReadonlySet<string>;
  /** The files the collections above were read from, each with its standing in the index. */
  readonly sources: readonly SourceFile[];
}

interface ProduitsCounters {
  /** Tracked paths under the root: fiches read + READMEs + refused + unmerged. */
  readonly chemins_suivis: number;
  readonly readmes: number;
  readonly refuses: number;
  readonly non_fusionnes: number;
  readonly catalogue: number;
  /** Products of the catalogue that have a fiche. */
  readonly couverts: number;
  readonly manquants: number;
  readonly fiches_lues: number;
  readonly valides: number;
  readonly en_violation: number;
  readonly hors_catalogue: number;
  readonly avec_depot: number;
  readonly sans_depot: number;
  /** Fiches the schema did not hold: whether they name a carrier is not known. */
  readonly depot_indecidable: number;
  /** Fiches that carry `offre`. */
  readonly avec_offre: number;
  readonly sans_offre: number;
  /** Fiches the schema did not hold: whether they carry an offer is not known. */
  readonly offre_indecidable: number;
  readonly champs_a_relire: number;
  readonly fiches_a_relire: number;
}

export interface ProduitsOutcome {
  readonly report: GateReport;
  readonly compteurs: ProduitsCounters;
  readonly volume: string;
}

// ---------------------------------------------------------------- parsers ---

const PRODUCT_IDENTIFIER = /(?<![A-Za-z0-9])P[0-9]{2}(?![A-Za-z0-9])/g;

/** The heading of the catalogue section, numbered or not; its depth is what closes the section. */
const CATALOGUE_HEADING = /^#{2,6}\s+(?:[0-9]+\.\s+)?Le catalogue d'applications\s*$/i;
/** The header row of the catalogue table, as the decision record writes it. */
const HEADER_CELLS: readonly [string, string] = ["Domaine", "Produits"];
const SEPARATOR_CELL = /^:?-+:?$/;
/** What separates two products in the cell of a row (U+00B7, as the decision record writes it). */
const ITEM_SEPARATOR = "·";
/**
 * One product of a row: the identifier, exactly, then the end of the item or a
 * blank. `P41bis`, `P100`, `P 41`, `P-41`, `P4` and `p41` are not identifiers.
 */
const ROW_ITEM = /^(P[0-9]{2})(?:\s.*)?$/;

interface CatalogueTable {
  /** Product to the domain label(s) of the row(s) it is written in. */
  readonly domains: Map<string, string[]>;
  /** Product to the `line N « text »` of the row(s) it is written in. */
  readonly rows: Map<string, string[]>;
  /** `line N « text »: reason` for each line of the section that was not read in full. */
  readonly unread: string[];
}

type Row =
  | { readonly kind: "layout" }
  | { readonly kind: "products"; readonly domain: string; readonly products: readonly string[] }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * One line of the section that carries a `|`. It is the header, the separator
 * or a row read IN FULL: a domain the category table knows, and a cell of
 * products where every item starts with an identifier. Anything else is
 * refused with its reason, never read in part: a row read in part is how
 * « P 41 », « P100 » or a product without an identifier required no fiche.
 */
function readRow(line: string): Row {
  const refused = (reason: string): Row => ({ kind: "refused", reason });
  if (!line.startsWith("|")) {
    return refused("a row of the catalogue table starts with « | » at the first column");
  }
  // `| a | b |` splits in four: nothing before the first bar, nothing after the last.
  const [, first = "", second = "", after, ...beyond] = line.trimEnd().split("|");
  if (after !== "" || beyond.length > 0) {
    return refused("a row has two cells, a domain and its products, and ends with « | »");
  }
  const domain = first.trim();
  const cell = second.trim();
  if (domain === HEADER_CELLS[0] && cell === HEADER_CELLS[1]) return { kind: "layout" };
  if (SEPARATOR_CELL.test(domain) && SEPARATOR_CELL.test(cell)) return { kind: "layout" };
  if (!DOMAIN_CATEGORIES.has(domain)) {
    return refused(`« ${domain} » is not a domain the category table maps`);
  }
  const products: string[] = [];
  for (const item of cell.split(ITEM_SEPARATOR).map((text) => text.trim())) {
    const identifier = ROW_ITEM.exec(item)?.[1];
    if (identifier === undefined) {
      return refused(
        `« ${item} » does not start with a product identifier (P and two digits, then a blank or the end of the item)`,
      );
    }
    products.push(identifier);
  }
  return { kind: "products", domain, products };
}

/**
 * The domain of each product of ADR-0042 §1: the first cell of the row of the
 * catalogue table a `Pnn` is written in. A product written in two rows gets
 * two domains, and the evaluation refuses it: the table decides, this reader
 * does not choose.
 *
 * THE SECTION. From the heading « Le catalogue d'applications », numbered or
 * not, to the next heading of the same depth or of a shallower one. A deeper
 * heading is a sub-title of the section and does not close it: when any
 * heading closed it, a table written under « #### Ajouts » added products
 * that required no fiche (second review of 2026-11-15, F1a).
 *
 * WHAT IS NOT READ IS SAID. Every line of the section that carries a `|` is a
 * line of the table, and is the header, the separator or a row read in full
 * (`readRow`); any other is returned in `unread` with its reason, and the
 * evaluation fails on it. A line without a `|` is prose: it is unread only
 * when it names a product no row lists. A sentence that cites a product of the
 * table is left alone: the decision record has several.
 */
export function parseCatalogueTable(adr0042: string): CatalogueTable {
  const domains = new Map<string, string[]>();
  const rows = new Map<string, string[]>();
  const refused: { number: number; entry: string }[] = [];
  const prose: { number: number; cited: string; products: string[] }[] = [];
  let depth: number | null = null;
  adr0042.split("\n").forEach((line, at) => {
    const heading = /^(#{1,6})\s/.exec(line)?.[1]?.length;
    if (heading !== undefined && (depth === null || heading <= depth)) {
      depth = CATALOGUE_HEADING.test(line) ? heading : null;
      return;
    }
    if (depth === null) return;
    const cited = `line ${at + 1} « ${line.trim()} »`;
    if (!line.includes("|")) {
      const products = [...line.matchAll(PRODUCT_IDENTIFIER)].map((match) => match[0]);
      if (products.length > 0) prose.push({ number: at + 1, cited, products });
      return;
    }
    const row = readRow(line);
    if (row.kind === "refused") refused.push({ number: at + 1, entry: `${cited}: ${row.reason}` });
    if (row.kind !== "products") return;
    for (const product of row.products) {
      const known = domains.get(product) ?? [];
      if (!known.includes(row.domain)) domains.set(product, [...known, row.domain]);
      rows.set(product, [...(rows.get(product) ?? []), cited]);
    }
  });
  for (const line of prose) {
    const unlisted = line.products.filter((id) => !domains.has(id));
    if (unlisted.length === 0) continue;
    refused.push({
      number: line.number,
      entry: `${line.cited}: names ${[...new Set(unlisted)].join(", ")}, which no row of the table lists`,
    });
  }
  const unread = refused
    .sort((left, right) => left.number - right.number)
    .map((line) => line.entry);
  return { domains, rows, unread };
}

/**
 * The catalogue this gate judges, from its own reader of the table and from
 * the reader the brick map shares (`parseCatalogue`).
 *
 * WHY BOTH. The set of products is read by two parsers of the same decision
 * record, and the shared one closes the section at ANY heading and reads any
 * `Pnn` of a row. Where they differ, the two gates count two catalogues: the
 * difference is returned as unread lines, so the gate fails by naming them,
 * and the catalogue is the union, so a product either reader sees needs a
 * fiche. On the decision record as it is written the two agree.
 */
export function reconcileCatalogue(
  table: CatalogueTable,
  shared: ReadonlySet<string>,
): { readonly catalogue: Set<string>; readonly unread: string[] } {
  const unread = [...table.unread];
  for (const [product, lines] of table.rows) {
    if (shared.has(product)) continue;
    for (const line of lines) {
      unread.push(
        `${line}: ${product} is read by this gate and not by the reader of the brick map, which closes the section at any heading`,
      );
    }
  }
  const alone = [...shared].filter((product) => !table.domains.has(product)).sort();
  if (alone.length > 0) {
    unread.push(
      `${alone.join(", ")}: read by the reader of the brick map, and in no row this gate read in full`,
    );
  }
  return { catalogue: new Set([...shared, ...table.domains.keys()].sort()), unread };
}

// ----------------------------------------------------------------- schema ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The fields `a_relire` may not name. The version of the schema and the
 * identifier are held by the gate to a constant and to the file name, and
 * `a_relire` is the list itself: none of the three carries a content an agent
 * proposed, so « to reread » says nothing of them.
 */
const NOT_A_CONTENT_FIELD: ReadonlySet<string> = new Set(["schema_version", "id", "a_relire"]);

function renderSchemaError(error: ErrorObject): string {
  const extra: unknown = error.params.additionalProperty;
  const detail = error.keyword === "additionalProperties" ? ` « ${String(extra)} »` : "";
  return `${error.instancePath || "/"}: ${error.message ?? "invalid"}${detail} (${error.keyword})`;
}

type FicheVerdict = { readonly data: ProduitData } | { readonly errors: readonly string[] };

/** The schema once compiled, or why there is none: a reason is printed, never thrown. */
type CompiledSchema =
  | {
      readonly ok: true;
      /** The fields a fiche may carry, read from the schema. */
      readonly fields: ReadonlySet<string>;
      /** The fiche when the schema holds, or the schema errors. */
      readonly validate: (value: unknown) => FicheVerdict;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Compile the schema from its text.
 *
 * WHY A RESULT AND NOT A MODULE CONSTANT. The schema was read and compiled
 * when this module loaded: an empty file, a file that is not JSON or a
 * directory in its place threw before the gate had printed a line — exit 1,
 * no source named, no counter (second review of 2026-11-15, F4). It is a
 * source like the two others: read by the effectful half from the tree
 * judged, and an unreadable one is a named failure of the evaluation.
 */
export function compileSchema(source: ReadResult): CompiledSchema {
  if (!source.ok) return { ok: false, reason: source.reason };
  if (source.text.trim() === "") return { ok: false, reason: "the file is empty" };
  let schema: unknown;
  try {
    schema = JSON.parse(source.text);
  } catch (error) {
    return {
      ok: false,
      reason: `not JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return { ok: false, reason: "it declares no properties" };
  }
  const fields = new Set(Object.keys(schema.properties));
  if (fields.size === 0) return { ok: false, reason: "it declares no properties" };
  try {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile<ProduitData>(schema);
    return {
      ok: true,
      fields,
      validate: (value) =>
        validate(value)
          ? { data: value }
          : { errors: (validate.errors ?? []).map(renderSchemaError) },
    };
  } catch (error) {
    return {
      ok: false,
      reason: `not a schema that compiles (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

// ---------------------------------------------------------- hosted offers ---

interface HostedOffers {
  /** The products the list names. */
  readonly products: ReadonlySet<string>;
  /** Why the list, or one of its entries, was not read: a reason is printed, never dropped. */
  readonly errors: readonly string[];
}

const HOSTED_OFFERS_KEYS: ReadonlySet<string> = new Set(["schema_version", "offres_hebergees"]);
const HOSTED_OFFER_KEYS: ReadonlySet<string> = new Set(["produit", "decision"]);

/**
 * The products that have a decided hosted offer, from the text of the list.
 *
 * Read in full or refused: an entry that names no product, cites no decision
 * record, carries another key or repeats a product is an error the evaluation
 * fails on, never an entry skipped. An entry skipped would be a product whose
 * offer is refused for a reason nothing prints.
 */
function readHostedOffers(source: ReadResult): HostedOffers {
  const refused = (reason: string): HostedOffers => ({ products: new Set(), errors: [reason] });
  if (!source.ok) return refused(`unreadable (${source.reason})`);
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(source.text);
  } catch (error) {
    return refused(`invalid YAML (${error instanceof Error ? error.message : String(error)})`);
  }
  if (
    !isRecord(parsed) ||
    parsed.schema_version !== HOSTED_OFFERS_VERSION ||
    !Array.isArray(parsed.offres_hebergees)
  ) {
    return refused(
      `not a « ${HOSTED_OFFERS_VERSION} » record with a list « offres_hebergees »: nothing says which products have a hosted offer`,
    );
  }
  const products = new Set<string>();
  const errors = Object.keys(parsed)
    .filter((key) => !HOSTED_OFFERS_KEYS.has(key))
    .map((key) => `« ${key} » is not a key of the record`);
  const entries: readonly unknown[] = parsed.offres_hebergees;
  entries.forEach((entry, at) => {
    const place = `entry ${at + 1}`;
    if (!isRecord(entry)) {
      errors.push(`${place} is not a product and its decision`);
      return;
    }
    const { produit, decision } = entry;
    const strangers = Object.keys(entry).filter((key) => !HOSTED_OFFER_KEYS.has(key));
    if (typeof produit !== "string" || !/^P[0-9]{2}$/.test(produit)) {
      errors.push(`${place} names no product (« produit »: P and two digits)`);
    } else if (typeof decision !== "string" || !/^ADR-[0-9]{4}$/.test(decision)) {
      errors.push(
        `${place} (${produit}) cites no decision record (« decision »: ADR and four digits)`,
      );
    } else if (strangers.length > 0) {
      errors.push(
        `${place} (${produit}) carries ${strangers.join(", ")}, which is not a key of an entry`,
      );
    } else if (products.has(produit)) {
      errors.push(`${produit} is listed twice`);
    } else products.add(produit);
  });
  return { products, errors };
}

/**
 * Whether a text says « gratuit », in any case and any form built on the word
 * (gratuite, gratuits, gratuitement, gratuité).
 *
 * WHY THE STEM, NOT A LIST OF FORMS. Every French form of the word contains
 * it, and no other French word does. The text is brought to its compatibility
 * form and its invisible format characters (soft hyphen, zero-width space) are
 * removed first, so that a full-width letter or a hyphenation point does not
 * hide the word. A letter of another alphabet that looks like a Latin one is
 * not caught.
 */
function saysGratuit(text: string): boolean {
  return /gratuit/i.test(text.normalize("NFKC").replace(/\p{Cf}/gu, ""));
}

// ------------------------------------------------------------- evaluation ---

const STAGE_FIRST =
  "its working copy differs from the index: stage it before running the gate, which judges what git tracks";

/** Control characters made visible: a file name or a value never forges a line of the output. */
function printable(text: string): string {
  return text.replace(
    CONTROL_CHARACTERS,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Why a source is not read as one, from its standing in the index; null when it is a regular file. */
function sourceRefusal(source: SourceFile): string | null {
  switch (source.standing) {
    case "regular":
      return null;
    case "link":
      return `${source.path} is tracked as a symbolic link: a source is a regular file, and a link is not followed`;
    case "absent":
      return `${source.path} is not in the index: a source is a tracked file, and a file git does not track is not read as one`;
    case "empty":
      return `${source.path} is an empty file — empty is not a source read`;
    case "other":
      return `${source.path} is tracked as neither a regular file nor a link`;
  }
}

interface LoadedFiche {
  /** The identifier the file name carries. */
  readonly id: string;
  readonly item: string;
  readonly errors: string[];
  readonly data: ProduitData | null;
}

/**
 * Read every fiche and judge the catalogue. One check per source and one per
 * product or fiche, so the assertion count is the volume examined, and every
 * counter printed is summed from the same pass.
 */
export function evaluateProduits(input: ProduitsInput): ProduitsOutcome {
  const gate = new GateReport();
  const check = (item: string, ok: boolean, note: string): void => {
    gate.check(printable(item), ok, printable(note));
  };

  // The sources. An empty one is unreadable, not empty.
  check(
    "catalogue of ADR-0042 §1",
    input.catalogue.size > 0 && input.catalogueUnread.length === 0,
    input.catalogue.size === 0
      ? "no product read: the decision record is missing, or its catalogue table could not be parsed — unreadable is not zero products"
      : input.catalogueUnread.length > 0
        ? `catalogue line(s) not read: ${input.catalogueUnread.join("; ")} — every line of the section that carries « | » is the header, the separator or a row read in full, and a product written any other way would require no fiche`
        : `${input.catalogue.size} product(s) read from the catalogue table, no line of the section left unread`,
  );
  // The schema is a source: unreadable, it is named here and no fiche is judged
  // valid, so the counters below are still printed.
  const compiled = compileSchema(input.schema);
  check(
    SCHEMA_PATH,
    compiled.ok,
    compiled.ok
      ? `${compiled.fields.size} field(s) declared, compiled in strict mode`
      : `unreadable (${compiled.reason}) — unreadable is not a schema every fiche holds`,
  );
  const labels = [...new Set([...input.domaines.values()].flat())];
  const unknownDomains = labels.filter((label) => !DOMAIN_CATEGORIES.has(label));
  check(
    "domains of ADR-0042 §1",
    labels.length > 0 && unknownDomains.length === 0,
    labels.length === 0
      ? "no domain read from the catalogue table"
      : unknownDomains.length === 0
        ? `${labels.length} domain(s) read, each one mapped to a category`
        : `domain(s) the category table does not map: ${unknownDomains.join(", ")}`,
  );
  check(
    "ecosystem/repositories.v1.yaml",
    input.repositories.size > 0,
    input.repositories.size > 0
      ? `${input.repositories.size} repository(ies) read`
      : "no repository read: the inventory is missing or could not be parsed — unreadable is not zero repositories",
  );
  // The list of hosted offers is a source: unreadable or read in part, it is
  // named here, and no fiche is then allowed an offer.
  const offers = readHostedOffers(input.offresHebergees);
  const unlisted = [...offers.products].filter((id) => !input.catalogue.has(id)).sort();
  check(
    HOSTED_OFFERS_PATH,
    offers.errors.length === 0 && offers.products.size > 0 && unlisted.length === 0,
    offers.errors.length > 0
      ? `${offers.errors.join("; ")} — a list not read in full is not a list of the products that have a hosted offer`
      : offers.products.size === 0
        ? "no product listed: an empty list is not read as « no product has a hosted offer »"
        : unlisted.length > 0
          ? `lists ${unlisted.join(", ")}, which the catalogue of ADR-0042 §1 does not`
          : `${offers.products.size} product(s) with a decided hosted offer, each one in the catalogue`,
  );
  // A source is read on disk, so the attestation « as indexed » needs two
  // things of each one: the index holds it as a regular file, and the bytes on
  // disk are the indexed ones. A tracked link was followed, and a file absent
  // from the index was read, both under that attestation.
  const refusedSources = input.sources.flatMap((source) => {
    const refusal = input.unstaged.has(source.path)
      ? `${source.path}: ${STAGE_FIRST}`
      : sourceRefusal(source);
    return refusal === null ? [] : [refusal];
  });
  check(
    "sources",
    input.sources.length > 0 && refusedSources.length === 0,
    input.sources.length === 0
      ? "no source file declared: nothing says what the catalogue was read from"
      : refusedSources.length === 0
        ? `${input.sources.length} source file(s) read, each one a tracked regular file and as indexed`
        : refusedSources.join("; "),
  );

  // The universe: every tracked path under the root falls in exactly one class.
  const fichePaths = new Map<string, string>();
  let readmes = 0;
  const strays: string[] = [];
  const unmerged: string[] = [];
  for (const entry of input.entries) {
    const fiche = /^(P[0-9]{2})\.v1\.yaml$/.exec(entry.path);
    if (entry.kind === "unmerged") unmerged.push(entry.path);
    else if (entry.kind === "file" && entry.path === "README.md") readmes += 1;
    else if (entry.kind === "file" && fiche?.[1] !== undefined)
      fichePaths.set(fiche[1], entry.path);
    else strays.push(`${entry.path} (${entry.kind})`);
  }
  check(
    `${PRODUITS_ROOT}/`,
    input.listingError === null &&
      strays.length === 0 &&
      unmerged.length === 0 &&
      fichePaths.size > 0,
    input.listingError !== null
      ? `the index could not be listed (${input.listingError})`
      : unmerged.length > 0
        ? `unmerged path(s), which have no single indexed content and are not read: ${unmerged.join(", ")}`
        : strays.length > 0
          ? `tracked path(s) that are neither a fiche nor the README (a link is not followed): ${strays.join(", ")}`
          : fichePaths.size === 0
            ? "no fiche is tracked: an empty directory is not zero products (stage new files before running the gate)"
            : `${input.entries.length} tracked path(s), each one a fiche or the README`,
  );

  // First pass: read every fiche and hold it to the schema.
  const loaded: LoadedFiche[] = [];
  for (const [id, path] of [...fichePaths].sort(([left], [right]) => left.localeCompare(right))) {
    const item = `${PRODUITS_ROOT}/${path}`;
    const errors: string[] = [];
    let data: ProduitData | null = null;
    const file = input.unstaged.has(item) ? null : input.read(path);
    if (file === null) errors.push(STAGE_FIRST);
    else if (!file.ok) errors.push(`unreadable (${file.reason}) — unreadable is not a valid fiche`);
    else if (!compiled.ok) {
      errors.push(`not judged: ${SCHEMA_PATH} is unreadable, and no fiche holds without a schema`);
    } else {
      try {
        const verdict = compiled.validate(Bun.YAML.parse(file.text));
        if ("data" in verdict) data = verdict.data;
        else errors.push(...verdict.errors);
      } catch (error) {
        errors.push(`invalid YAML (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    loaded.push({ id, item, errors, data });
  }

  // Who declares which identifier: a second file claiming `P01` is a duplicate of it.
  const declaredBy = new Map<string, string[]>();
  for (const fiche of loaded) {
    if (fiche.data === null) continue;
    declaredBy.set(fiche.data.id, [...(declaredBy.get(fiche.data.id) ?? []), fiche.item]);
  }

  // Second pass: the rules that need another source than the fiche itself.
  for (const fiche of loaded) {
    const { data, errors } = fiche;
    if (!input.catalogue.has(fiche.id)) {
      errors.push(`${fiche.id} is not in the catalogue of ADR-0042 §1`);
    }
    if (data !== null) {
      if (data.id !== fiche.id) {
        errors.push(`id is « ${data.id} », the file name says « ${fiche.id} »`);
      }
      const claimants = declaredBy.get(data.id) ?? [];
      if (claimants.length > 1) {
        errors.push(`id ${data.id} declared ${claimants.length} times (${claimants.join(", ")})`);
      }

      const domains = input.domaines.get(fiche.id) ?? [];
      const [domain] = domains;
      const expected = domain === undefined ? undefined : DOMAIN_CATEGORIES.get(domain);
      if (input.catalogue.has(fiche.id) && (domains.length !== 1 || expected === undefined)) {
        errors.push(
          `the catalogue table gives ${fiche.id} ${domains.length === 0 ? "no domain" : `the domain(s) « ${domains.join(" », « ")} »`}, so its category cannot be held to one known domain`,
        );
      } else if (expected !== undefined && data.categorie !== expected) {
        errors.push(
          `categorie is « ${data.categorie} », ADR-0042 §1 lists ${fiche.id} under « ${String(domain)} » (${expected})`,
        );
      }

      if ((data.nom_public === null) === (data.nom_provisoire === null)) {
        errors.push(
          "exactly one of nom_public and nom_provisoire is set: a product has a decided name or a working one, not both and not none",
        );
      }

      for (const dependency of data.depend_de) {
        if (dependency === data.id) errors.push("depends on itself");
        else if (!fichePaths.has(dependency)) {
          errors.push(`depends on ${dependency}, which no fiche declares`);
        }
      }

      if (data.depot !== null && !input.repositories.has(data.depot)) {
        errors.push(`depot ${data.depot} is not in ecosystem/repositories.v1.yaml`);
      }

      // `offre` with one text only is refused by the schema. What the schema
      // cannot say is held here: who may carry the field, and the word
      // ADR-0033 refuses as an absolute claim (ADR-0066 D3).
      if (data.offre !== undefined) {
        if (!offers.products.has(fiche.id)) {
          errors.push(
            `offre is written, and ${HOSTED_OFFERS_PATH} does not list ${fiche.id}: a fiche describes a hosted offer once a decision admits one for its product (ADR-0066 D2)`,
          );
        }
        for (const key of ["sans_frais", "payant"] as const) {
          if (saysGratuit(data.offre[key])) {
            errors.push(
              `offre.${key} says « gratuit »: the word stays refused as an absolute claim (ADR-0033, ADR-0066 D3) — say what is without charge, and under which condition`,
            );
          }
        }
      }

      // The accroche is the most public text of a fiche: the card of the site
      // prints it. The word is refused there for the reason it is refused in
      // an offre.
      if (saysGratuit(data.accroche)) {
        errors.push(
          "accroche says « gratuit »: the word stays refused as an absolute claim (ADR-0033, ADR-0066 D3) — the card says what the product does",
        );
      }

      if (data.etiquettes.length !== 3) {
        errors.push(
          `etiquettes counts ${data.etiquettes.length} entry(ies), exactly three expected`,
        );
      }

      // `data` is set only under a compiled schema: the fallback is never reached with a fiche to judge.
      const declared = compiled.ok ? compiled.fields : new Set<string>();
      const strangers = data.a_relire.filter((field) => !declared.has(field));
      if (strangers.length > 0) {
        errors.push(`a_relire names ${strangers.join(", ")}, which the schema does not declare`);
      }
      const notContent = data.a_relire.filter((field) => NOT_A_CONTENT_FIELD.has(field));
      if (notContent.length > 0) {
        errors.push(
          `a_relire names ${notContent.join(", ")}, which carries no content to reread: the version, the identifier and this list are not content fields`,
        );
      }
    }
    check(
      fiche.item,
      errors.length === 0,
      errors.length === 0
        ? `${data?.categorie ?? ""}, ${data?.depend_de.length ?? 0} dependency(ies), ${data?.a_relire.length ?? 0} field(s) to reread`
        : errors.join("; "),
    );
  }

  // Products of the catalogue no fiche describes.
  const missing = [...input.catalogue].filter((id) => !fichePaths.has(id)).sort();
  for (const id of missing) {
    check(
      id,
      false,
      `in the catalogue of ADR-0042 §1, and no fiche ${PRODUITS_ROOT}/${id}.v1.yaml is tracked as a merged regular file — a missing fiche is not zero`,
    );
  }

  const valid = loaded.filter((fiche) => fiche.errors.length === 0);
  const decided = loaded.flatMap((fiche) => (fiche.data === null ? [] : [fiche.data]));
  const compteurs: ProduitsCounters = {
    chemins_suivis: input.entries.length,
    readmes,
    refuses: strays.length,
    non_fusionnes: unmerged.length,
    catalogue: input.catalogue.size,
    couverts: input.catalogue.size - missing.length,
    manquants: missing.length,
    fiches_lues: loaded.length,
    valides: valid.length,
    en_violation: loaded.length - valid.length,
    hors_catalogue: loaded.filter((fiche) => !input.catalogue.has(fiche.id)).length,
    avec_depot: decided.filter((data) => data.depot !== null).length,
    sans_depot: decided.filter((data) => data.depot === null).length,
    depot_indecidable: loaded.length - decided.length,
    avec_offre: decided.filter((data) => data.offre !== undefined).length,
    sans_offre: decided.filter((data) => data.offre === undefined).length,
    offre_indecidable: loaded.length - decided.length,
    champs_a_relire: decided.reduce((sum, data) => sum + data.a_relire.length, 0),
    fiches_a_relire: decided.filter((data) => data.a_relire.length > 0).length,
  };
  const volume =
    `${compteurs.catalogue} product(s) in the catalogue of ADR-0042 §1 = ${compteurs.couverts} with a fiche + ${compteurs.manquants} missing; ` +
    `${compteurs.fiches_lues} fiche(s) read = ${compteurs.valides} valid + ${compteurs.en_violation} in violation, ${compteurs.hors_catalogue} of them outside the catalogue; ` +
    `carrier: ${compteurs.avec_depot} with a depot + ${compteurs.sans_depot} without + ${compteurs.depot_indecidable} not decidable (schema not held) = ${compteurs.fiches_lues}; ` +
    `hosted offer: ${compteurs.avec_offre} with an offre + ${compteurs.sans_offre} without + ${compteurs.offre_indecidable} not decidable (schema not held) = ${compteurs.fiches_lues}; ` +
    `${compteurs.champs_a_relire} a_relire field(s) on ${compteurs.fiches_a_relire} fiche(s), not reread by the owner; ` +
    `${compteurs.chemins_suivis} tracked path(s) under ${PRODUITS_ROOT}/ = ${compteurs.fiches_lues} fiche(s) + ${compteurs.readmes} README + ${compteurs.refuses} refused + ${compteurs.non_fusionnes} unmerged`;
  gate.volume(volume);
  return { report: gate, compteurs, volume };
}
