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

export type Categorie =
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
export interface ProduitData {
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly id: string;
  readonly nom_public: string | null;
  readonly nom_provisoire: string | null;
  readonly intitule: string;
  readonly fonction: string;
  readonly categorie: Categorie;
  readonly promesse: string;
  readonly pour_qui: string;
  readonly a_la_place_de: string;
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
  /** `P01`…: the products of the catalogue of ADR-0042 §1. */
  readonly catalogue: ReadonlySet<string>;
  /** The domain label(s) the catalogue table gives each product (one, unless the table is wrong). */
  readonly domaines: ReadonlyMap<string, readonly string[]>;
  /** Lines of the catalogue section that carry a product and that the reader did not read. */
  readonly catalogueUnread: readonly string[];
  /** `owner/name` of the fleet inventory. */
  readonly repositories: ReadonlyMap<string, { readonly visibility: string }>;
  /** Repository-relative paths of the tracked files whose working copy is not the indexed content. */
  readonly unstaged: ReadonlySet<string>;
  /** The files the collections above were read from, each with its standing in the index. */
  readonly sources: readonly SourceFile[];
}

export interface ProduitsCounters {
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

export interface CatalogueTable {
  /** Product to the domain label(s) of the row(s) it is written in. */
  readonly domains: Map<string, string[]>;
  /** `line N « text »` for each line of the section that carries a product and was not read. */
  readonly unread: string[];
}

/**
 * The domain of each product of ADR-0042 §1: the first cell of the row of the
 * catalogue table a `Pnn` is written in. Same section as `parseCatalogue` of
 * the brick map (the heading « Le catalogue d'applications », numbered or not,
 * up to the next heading). A product written in two rows gets two domains, and
 * the evaluation refuses it: the table decides, this reader does not choose.
 *
 * WHAT IS NOT READ IS SAID. A row is a line that starts with `|` at the first
 * column. An indented row, or one written without its leading bar, was skipped
 * in silence, so a product added that way required no fiche. Such a line is
 * returned in `unread`, and the evaluation fails on it. Two cases are unread:
 * a line that carries a product and a `|` without being a row, and a line that
 * names a product no row lists. A sentence of the section that cites a product
 * of the table is prose, and is left alone: the decision record has several.
 */
export function parseCatalogueTable(adr0042: string): CatalogueTable {
  const domains = new Map<string, string[]>();
  const outside: { number: number; text: string; products: string[] }[] = [];
  let inside = false;
  adr0042.split("\n").forEach((line, at) => {
    if (/^#{2,6}\s/.test(line)) {
      inside = /^#{2,6}\s+(?:[0-9]+\.\s+)?Le catalogue d'applications\s*$/i.test(line);
      return;
    }
    if (!inside) return;
    if (!line.startsWith("|")) {
      const products = [...line.matchAll(PRODUCT_IDENTIFIER)].map((match) => match[0]);
      if (products.length > 0) outside.push({ number: at + 1, text: line.trim(), products });
      return;
    }
    const cells = line.split("|");
    const domain = (cells[1] ?? "").trim();
    for (const match of cells.slice(2).join("|").matchAll(PRODUCT_IDENTIFIER)) {
      const known = domains.get(match[0]) ?? [];
      if (!known.includes(domain)) domains.set(match[0], [...known, domain]);
    }
  });
  const unread = outside
    .filter((line) => line.text.includes("|") || line.products.some((id) => !domains.has(id)))
    .map((line) => `line ${line.number} « ${line.text} »`);
  return { domains, unread };
}

// ----------------------------------------------------------------- schema ---

const schema: unknown = await Bun.file(
  new URL("./schemas/produit.v1.schema.json", import.meta.url).pathname,
).json();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (!isRecord(schema) || !isRecord(schema.properties)) {
  throw new Error("ecosystem/schemas/produit.v1.schema.json declares no properties");
}

/** The fields a fiche may carry, read from the schema. */
export const SCHEMA_FIELDS: ReadonlySet<string> = new Set(Object.keys(schema.properties));

/**
 * The fields `a_relire` may not name. The version of the schema and the
 * identifier are held by the gate to a constant and to the file name, and
 * `a_relire` is the list itself: none of the three carries a content an agent
 * proposed, so « to reread » says nothing of them.
 */
const NOT_A_CONTENT_FIELD: ReadonlySet<string> = new Set(["schema_version", "id", "a_relire"]);

const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile<ProduitData>(schema);

function renderSchemaError(error: ErrorObject): string {
  const extra: unknown = error.params.additionalProperty;
  const detail = error.keyword === "additionalProperties" ? ` « ${String(extra)} »` : "";
  return `${error.instancePath || "/"}: ${error.message ?? "invalid"}${detail} (${error.keyword})`;
}

/** The fiche when the schema holds, or the schema errors. */
export function validateFiche(
  value: unknown,
): { readonly data: ProduitData } | { readonly errors: readonly string[] } {
  if (validateSchema(value)) return { data: value };
  return { errors: (validateSchema.errors ?? []).map(renderSchemaError) };
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
        ? `catalogue line(s) not read: ${input.catalogueUnread.join(", ")} — a row of the catalogue table starts with « | » at the first column, and a product written anywhere else in the section would require no fiche`
        : `${input.catalogue.size} product(s) read from the catalogue table, no line of the section left unread`,
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
    else {
      try {
        const verdict = validateFiche(Bun.YAML.parse(file.text));
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

      if (data.etiquettes.length !== 3) {
        errors.push(
          `etiquettes counts ${data.etiquettes.length} entry(ies), exactly three expected`,
        );
      }

      const strangers = data.a_relire.filter((field) => !SCHEMA_FIELDS.has(field));
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
    champs_a_relire: decided.reduce((sum, data) => sum + data.a_relire.length, 0),
    fiches_a_relire: decided.filter((data) => data.a_relire.length > 0).length,
  };
  const volume =
    `${compteurs.catalogue} product(s) in the catalogue of ADR-0042 §1 = ${compteurs.couverts} with a fiche + ${compteurs.manquants} missing; ` +
    `${compteurs.fiches_lues} fiche(s) read = ${compteurs.valides} valid + ${compteurs.en_violation} in violation, ${compteurs.hors_catalogue} of them outside the catalogue; ` +
    `carrier: ${compteurs.avec_depot} with a depot + ${compteurs.sans_depot} without + ${compteurs.depot_indecidable} not decidable (schema not held) = ${compteurs.fiches_lues}; ` +
    `${compteurs.champs_a_relire} a_relire field(s) on ${compteurs.fiches_a_relire} fiche(s), not reread by the owner; ` +
    `${compteurs.chemins_suivis} tracked path(s) under ${PRODUITS_ROOT}/ = ${compteurs.fiches_lues} fiche(s) + ${compteurs.readmes} README + ${compteurs.refuses} refused + ${compteurs.non_fusionnes} unmerged`;
  gate.volume(volume);
  return { report: gate, compteurs, volume };
}
