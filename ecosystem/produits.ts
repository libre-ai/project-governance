import Ajv2020, { type ErrorObject } from "ajv/dist/2020";

import { GateReport } from "../tools/quality/gate-report";
import { CONTROL_CHARACTERS, type TreeEntry } from "./briques";

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

export interface ProduitsInput {
  /** Every TRACKED entry under `PRODUITS_ROOT`, relative to it. An untracked file is not a fiche. */
  readonly entries: readonly TreeEntry[];
  /** Why the index could not be listed, or null when it was. */
  readonly listingError: string | null;
  /** The text of a file under `PRODUITS_ROOT`. */
  readonly read: (path: string) => ReadResult;
  /** `P01`…: the products of the catalogue of ADR-0042 §1. */
  readonly catalogue: ReadonlySet<string>;
  /** The domain label(s) the catalogue table gives each product (one, unless the table is wrong). */
  readonly domaines: ReadonlyMap<string, readonly string[]>;
  /** `owner/name` of the fleet inventory. */
  readonly repositories: ReadonlyMap<string, { readonly visibility: string }>;
  /** Repository-relative paths of the tracked files whose working copy is not the indexed content. */
  readonly unstaged: ReadonlySet<string>;
  /** Repository-relative paths of the files the collections above were read from. */
  readonly sources: readonly string[];
}

export interface ProduitsCounters {
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

/**
 * The domain of each product of ADR-0042 §1: the first cell of the row of the
 * catalogue table a `Pnn` is written in. Same section as `parseCatalogue` of
 * the brick map (the heading « Le catalogue d'applications », numbered or not,
 * up to the next heading). A product written in two rows gets two domains, and
 * the evaluation refuses it: the table decides, this reader does not choose.
 */
export function parseCatalogueDomains(adr0042: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  let inside = false;
  for (const line of adr0042.split("\n")) {
    if (/^#{2,6}\s/.test(line)) {
      inside = /^#{2,6}\s+(?:[0-9]+\.\s+)?Le catalogue d'applications\s*$/i.test(line);
      continue;
    }
    if (!inside || !line.startsWith("|")) continue;
    const cells = line.split("|");
    const domain = (cells[1] ?? "").trim();
    for (const match of cells
      .slice(2)
      .join("|")
      .matchAll(/(?<![A-Za-z0-9])P[0-9]{2}(?![A-Za-z0-9])/g)) {
      const known = found.get(match[0]) ?? [];
      if (!known.includes(domain)) found.set(match[0], [...known, domain]);
    }
  }
  return found;
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

/** The fields a fiche may carry, read from the schema: `a_relire` names them, nothing else. */
export const SCHEMA_FIELDS: ReadonlySet<string> = new Set(Object.keys(schema.properties));

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
    input.catalogue.size > 0,
    input.catalogue.size > 0
      ? `${input.catalogue.size} product(s) read from the catalogue table`
      : "no product read: the decision record is missing, or its catalogue table could not be parsed — unreadable is not zero products",
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
  const drifted = input.sources.filter((path) => input.unstaged.has(path));
  check(
    "sources",
    drifted.length === 0,
    drifted.length === 0
      ? `${input.sources.length} source file(s) read, each one as indexed`
      : `${drifted.join(", ")}: ${STAGE_FIRST}`,
  );

  // The universe: every tracked entry under the root falls in exactly one class.
  const fichePaths = new Map<string, string>();
  let readmes = 0;
  const strays: string[] = [];
  for (const entry of input.entries) {
    const fiche = /^(P[0-9]{2})\.v1\.yaml$/.exec(entry.path);
    if (entry.kind === "file" && entry.path === "README.md") readmes += 1;
    else if (entry.kind === "file" && fiche?.[1] !== undefined)
      fichePaths.set(fiche[1], entry.path);
    else strays.push(`${entry.path} (${entry.kind})`);
  }
  check(
    `${PRODUITS_ROOT}/`,
    input.listingError === null && strays.length === 0 && fichePaths.size > 0,
    input.listingError !== null
      ? `the index could not be listed (${input.listingError})`
      : strays.length > 0
        ? `tracked entry(ies) that are neither a fiche nor the README (a link is not followed): ${strays.join(", ")}`
        : fichePaths.size === 0
          ? "no fiche is tracked: an empty directory is not zero products (stage new files before running the gate)"
          : `${input.entries.length} tracked entry(ies), each one a fiche or the README`,
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
      `in the catalogue of ADR-0042 §1, and no fiche ${PRODUITS_ROOT}/${id}.v1.yaml is tracked — a missing fiche is not zero`,
    );
  }

  const valid = loaded.filter((fiche) => fiche.errors.length === 0);
  const decided = loaded.flatMap((fiche) => (fiche.data === null ? [] : [fiche.data]));
  const compteurs: ProduitsCounters = {
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
    `${input.entries.length} tracked entry(ies) under ${PRODUITS_ROOT}/ = ${fichePaths.size} fiche(s) + ${readmes} README + ${strays.length} refused`;
  gate.volume(volume);
  return { report: gate, compteurs, volume };
}
