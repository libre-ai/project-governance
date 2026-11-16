import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { CONTROL_CHARACTERS, type LocalTarget, parseCatalogue } from "./briques";
import {
  type CatalogueEntry,
  compileSchema,
  DOMAIN_CATEGORIES,
  evaluateProduits,
  HOSTED_OFFERS_PATH,
  PRODUITS_ROOT,
  type ProduitsInput,
  type ProduitsOutcome,
  parseCatalogueTable,
  type ReadResult,
  reconcileCatalogue,
  SCHEMA_PATH,
  SCHEMA_VERSION,
  type SourceFile,
} from "./produits";

/** The schema as the repository writes it: the one every rule below is judged under. */
const SCHEMA_TEXT = readFileSync(join(import.meta.dir, "..", SCHEMA_PATH), "utf8");
const COMPILED = compileSchema({ ok: true, text: SCHEMA_TEXT });
if (!COMPILED.ok) throw new Error(`${SCHEMA_PATH}: ${COMPILED.reason}`);
const { fields: SCHEMA_FIELDS, validate: validateFiche } = COMPILED;

/**
 * The rules of the product catalogue, judged on a catalogue held in memory.
 * Each rule has a test named after it: the mutation table of the change that
 * introduced the gate replaces the deciding line of a rule by a no-op and
 * runs the test of that name, which must turn red.
 */

type Fiche = Record<string, unknown>;

const SELF = "libre-ai/project-governance";

function fiche(id: string, changes: Fiche = {}): Fiche {
  return {
    schema_version: SCHEMA_VERSION,
    id,
    nom_public: null,
    nom_provisoire: `Produit ${id}`,
    intitule: `produit ${id}`,
    fonction: "Fait une chose",
    categorie: id === "P03" ? "collaboration" : "connaissance",
    promesse: "Faire une chose pour quelqu'un, de façon vérifiable.",
    accroche: "Faites une chose, vérifiez-la.",
    pour_qui: "une personne nommée",
    a_la_place_de: "votre outil en ligne par abonnement",
    capacites: ["Faire la chose annoncée."],
    ne_fait_pas: ["Faire autre chose que la chose annoncée."],
    depend_de: [],
    realisation: "projet autonome",
    depot: null,
    etiquettes: ["Une chose", "Deux choses", "Trois choses"],
    a_relire: ["a_la_place_de"],
    ...changes,
  };
}

interface Reference {
  /** File name under the root to its content, as text. */
  files: Map<string, string>;
  entries: CatalogueEntry[] | null;
  schema: ReadResult;
  offres: ReadResult;
  catalogue: Set<string>;
  domaines: Map<string, string[]>;
  catalogueUnread: string[];
  repositories: Map<string, { visibility: string }>;
  unstaged: Set<string>;
  sources: SourceFile[];
  listingError: string | null;
}

/** The four files the gate declares as its sources. */
const SOURCE_PATHS = [
  "docs/adr/0042-x.md",
  "ecosystem/repositories.v1.yaml",
  "ecosystem/schemas/produit.v1.schema.json",
  HOSTED_OFFERS_PATH,
] as const;

/** The text of a list of hosted offers: JSON is YAML. */
function offers(entries: readonly unknown[], changes: Fiche = {}): ReadResult {
  return {
    ok: true,
    text: JSON.stringify({
      schema_version: "libre-ai.hosted-offers.v1",
      offres_hebergees: entries,
      ...changes,
    }),
  };
}

/** A product with a decided hosted offer in the reference: P02, and no other. */
const LISTED = { produit: "P02", decision: "ADR-0054" };

/** The two texts of an offer, as a fiche writes them. */
const OFFRE = {
  sans_frais: "Le logiciel entier chez vous, sans limite.",
  payant: "Le service hébergé : synchronisation et sauvegardes.",
};

/** Three products over two domains, every fiche valid, one carrier in the inventory. */
function reference(): Reference {
  return {
    files: new Map(["P01", "P02", "P03"].map((id) => [`${id}.v1.yaml`, JSON.stringify(fiche(id))])),
    entries: null,
    schema: { ok: true, text: SCHEMA_TEXT },
    offres: offers([LISTED]),
    catalogue: new Set(["P01", "P02", "P03"]),
    domaines: new Map([
      ["P01", ["Connaissance"]],
      ["P02", ["Connaissance"]],
      ["P03", ["Collaboration"]],
    ]),
    catalogueUnread: [],
    repositories: new Map([[SELF, { visibility: "public" }]]),
    unstaged: new Set(),
    sources: SOURCE_PATHS.map((path): SourceFile => ({ path, standing: "regular" })),
    listingError: null,
  };
}

const asFiles = (state: Reference): CatalogueEntry[] =>
  [...state.files.keys()].map((path): CatalogueEntry => ({ path, kind: "file" }));

function judge(state: Reference): ProduitsOutcome {
  const input: ProduitsInput = {
    entries: state.entries ?? asFiles(state),
    listingError: state.listingError,
    read: (path) => {
      const text = state.files.get(path);
      return text === undefined ? { ok: false, reason: "ENOENT" } : { ok: true, text };
    },
    schema: state.schema,
    offresHebergees: state.offres,
    catalogue: state.catalogue,
    domaines: state.domaines,
    catalogueUnread: state.catalogueUnread,
    repositories: state.repositories,
    unstaged: state.unstaged,
    sources: state.sources,
  };
  return evaluateProduits(input);
}

/** The reference with one fiche rewritten. */
function withFiche(id: string, changes: Fiche, state: Reference = reference()): Reference {
  state.files.set(`${id}.v1.yaml`, JSON.stringify(fiche(id, changes)));
  return state;
}

/** The violation recorded for one item, or the empty string when it holds. */
function violationOf(outcome: ProduitsOutcome, item: string): string {
  return outcome.report.violations.find((line) => line.startsWith(`${item}: `)) ?? "";
}

const item = (id: string): string => `${PRODUITS_ROOT}/${id}.v1.yaml`;

/** The sums the gate promises, whatever the verdict. */
function expectSums(outcome: ProduitsOutcome): void {
  const c = outcome.compteurs;
  expect(c.couverts + c.manquants).toBe(c.catalogue);
  expect(c.valides + c.en_violation).toBe(c.fiches_lues);
  expect(c.avec_depot + c.sans_depot + c.depot_indecidable).toBe(c.fiches_lues);
  expect(c.avec_offre + c.sans_offre + c.offre_indecidable).toBe(c.fiches_lues);
  expect(c.couverts + c.hors_catalogue).toBe(c.fiches_lues);
  expect(c.fiches_lues + c.readmes + c.refuses + c.non_fusionnes).toBe(c.chemins_suivis);
}

describe("the reference catalogue", () => {
  test("control: it is green, and its counters sum", () => {
    const outcome = judge(reference());
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.compteurs).toEqual({
      chemins_suivis: 3,
      readmes: 0,
      refuses: 0,
      non_fusionnes: 0,
      catalogue: 3,
      couverts: 3,
      manquants: 0,
      fiches_lues: 3,
      valides: 3,
      en_violation: 0,
      hors_catalogue: 0,
      avec_depot: 0,
      sans_depot: 3,
      depot_indecidable: 0,
      avec_offre: 0,
      sans_offre: 3,
      offre_indecidable: 0,
      champs_a_relire: 3,
      fiches_a_relire: 3,
    });
    expectSums(outcome);
    expect(outcome.volume).toContain(
      "3 product(s) in the catalogue of ADR-0042 §1 = 3 with a fiche + 0 missing",
    );
    expect(outcome.volume).toContain("3 fiche(s) read = 3 valid + 0 in violation");
    expect(outcome.volume).toContain("carrier: 0 with a depot + 3 without + 0 not decidable");
    expect(outcome.volume).toContain(
      "hosted offer: 0 with an offre + 3 without + 0 not decidable (schema not held) = 3",
    );
    expect(outcome.volume).toContain("3 a_relire field(s) on 3 fiche(s)");
  });

  // What is held is the behaviour — the count of assertions follows the volume
  // examined — not the number of checks the gate makes on its sources, which a
  // refactor may regroup without changing a verdict.
  test("one assertion per fiche and per missing product: the count follows the volume examined", () => {
    const three = judge(reference()).report.asserted;
    const added = reference();
    added.catalogue.add("P04");
    added.domaines.set("P04", ["Connaissance"]);
    // A product of the catalogue without a fiche is one more assertion (a failed one)…
    expect(judge(added).report.asserted).toBe(three + 1);
    // …and its fiche replaces it: one assertion per product either way.
    added.files.set("P04.v1.yaml", JSON.stringify(fiche("P04")));
    const four = judge(added);
    expect(four.report.violations).toEqual([]);
    expect(four.report.asserted).toBe(three + 1);
  });
});

describe("rules of the gate", () => {
  test("rule schema: a fiche the schema refuses is in violation, and its carrier is not decidable", () => {
    const outcome = judge(withFiche("P02", { statut: "disponible" }));
    expect(violationOf(outcome, item("P02"))).toContain("« statut » (additionalProperties)");
    expect(outcome.compteurs.en_violation).toBe(1);
    expect(outcome.compteurs.depot_indecidable).toBe(1);
    expectSums(outcome);
  });

  test("rule yaml: a fiche that is not YAML is in violation", () => {
    const state = reference();
    state.files.set("P02.v1.yaml", "id: [P02\n");
    const outcome = judge(state);
    expect(violationOf(outcome, item("P02"))).toContain("invalid YAML");
    expectSums(outcome);
  });

  test("rule id: the identifier is the file name", () => {
    const state = reference();
    state.files.set("P02.v1.yaml", JSON.stringify(fiche("P09")));
    const outcome = judge(state);
    expect(violationOf(outcome, item("P02"))).toContain(
      "id is « P09 », the file name says « P02 »",
    );
  });

  test("rule missing: a product of the catalogue without a fiche is a failure, and is counted", () => {
    const state = reference();
    state.files.delete("P03.v1.yaml");
    const outcome = judge(state);
    expect(violationOf(outcome, "P03")).toContain("no fiche ecosystem/produits/P03.v1.yaml");
    expect(outcome.compteurs.manquants).toBe(1);
    expect(outcome.compteurs.couverts).toBe(2);
    expect(outcome.volume).toContain("= 2 with a fiche + 1 missing");
    expectSums(outcome);
  });

  test("rule outside: a fiche the catalogue does not list is a failure, and is counted", () => {
    const state = reference();
    state.files.set("P77.v1.yaml", JSON.stringify(fiche("P77")));
    const outcome = judge(state);
    expect(violationOf(outcome, item("P77"))).toContain(
      "P77 is not in the catalogue of ADR-0042 §1",
    );
    expect(outcome.compteurs.hors_catalogue).toBe(1);
    expect(outcome.volume).toContain("1 of them outside the catalogue");
    expectSums(outcome);
  });

  test("rule duplicate: an identifier declared by two files is refused on both", () => {
    const state = reference();
    state.files.set("P02.v1.yaml", JSON.stringify(fiche("P01")));
    const outcome = judge(state);
    expect(violationOf(outcome, item("P01"))).toContain("id P01 declared 2 times");
    expect(violationOf(outcome, item("P02"))).toContain("id P01 declared 2 times");
  });

  test("rule category: the category is the domain the ADR gives the product", () => {
    const outcome = judge(withFiche("P03", { categorie: "connaissance" }));
    expect(violationOf(outcome, item("P03"))).toContain(
      "categorie is « connaissance », ADR-0042 §1 lists P03 under « Collaboration » (collaboration)",
    );
  });

  test("rule domain: a product the table gives no single known domain cannot be held to one", () => {
    const two = reference();
    two.domaines.set("P03", ["Collaboration", "Connaissance"]);
    expect(violationOf(judge(two), item("P03"))).toContain(
      "the domain(s) « Collaboration », « Connaissance »",
    );
    const none = reference();
    none.domaines.delete("P03");
    expect(violationOf(judge(none), item("P03"))).toContain("gives P03 no domain");
  });

  test("rule names: exactly one of nom_public and nom_provisoire is set", () => {
    const both = judge(withFiche("P01", { nom_public: "Un", nom_provisoire: "Deux" }));
    expect(violationOf(both, item("P01"))).toContain("exactly one of nom_public");
    const none = judge(withFiche("P01", { nom_public: null, nom_provisoire: null }));
    expect(violationOf(none, item("P01"))).toContain("exactly one of nom_public");
    const decided = judge(withFiche("P01", { nom_public: "Un", nom_provisoire: null }));
    expect(decided.report.violations).toEqual([]);
  });

  test("rule dependency: a dependency names a fiche that exists", () => {
    const outcome = judge(withFiche("P01", { depend_de: ["P02", "P44"] }));
    expect(violationOf(outcome, item("P01"))).toContain("depends on P44, which no fiche declares");
    expect(violationOf(outcome, item("P01"))).not.toContain("P02");
  });

  test("rule self: a fiche does not depend on itself", () => {
    const outcome = judge(withFiche("P01", { depend_de: ["P01"] }));
    expect(violationOf(outcome, item("P01"))).toContain("depends on itself");
  });

  test("a cycle between products is admitted: these are links, not a build order", () => {
    const state = withFiche("P01", { depend_de: ["P02"] });
    const outcome = judge(withFiche("P02", { depend_de: ["P01"] }, state));
    expect(outcome.report.violations).toEqual([]);
  });

  test("rule carrier: a depot is a repository of the inventory", () => {
    const absent = judge(withFiche("P01", { depot: "libre-ai/information-watch" }));
    expect(violationOf(absent, item("P01"))).toContain(
      "depot libre-ai/information-watch is not in ecosystem/repositories.v1.yaml",
    );
    const held = judge(withFiche("P01", { depot: SELF }));
    expect(held.report.violations).toEqual([]);
    expect(held.compteurs.avec_depot).toBe(1);
    expect(held.compteurs.sans_depot).toBe(2);
  });

  test("rule etiquettes: a fiche carries exactly three", () => {
    const two = judge(withFiche("P01", { etiquettes: ["Une chose", "Deux choses"] }));
    expect(violationOf(two, item("P01"))).toContain("etiquettes counts 2 entry(ies)");
    const four = judge(
      withFiche("P01", { etiquettes: ["Une chose", "Deux choses", "Trois choses", "Quatre"] }),
    );
    expect(violationOf(four, item("P01"))).toContain("etiquettes counts 4 entry(ies)");
  });

  test("rule a_relire: every name is a field of the schema", () => {
    const outcome = judge(withFiche("P01", { a_relire: ["promesse", "code_proche"] }));
    expect(violationOf(outcome, item("P01"))).toContain(
      "a_relire names code_proche, which the schema does not declare",
    );
    expect(violationOf(outcome, item("P01"))).not.toContain("promesse,");
  });

  test.each([
    "schema_version",
    "id",
    "a_relire",
  ])("rule a_relire content: %s is not a field to reread", (field) => {
    const outcome = judge(withFiche("P01", { a_relire: ["promesse", field] }));
    expect(violationOf(outcome, item("P01"))).toContain(
      `a_relire names ${field}, which carries no content to reread`,
    );
  });

  test("rule a_relire content: every other field of the schema may be named", () => {
    const content = [...SCHEMA_FIELDS].filter(
      (field) => !["schema_version", "id", "a_relire"].includes(field),
    );
    expect(content.length).toBeGreaterThan(0);
    expect(judge(withFiche("P01", { a_relire: content })).report.violations).toEqual([]);
  });

  test("rule counters: a_relire is summed over the fiches the schema holds", () => {
    const state = withFiche("P01", { a_relire: [] });
    const outcome = judge(withFiche("P02", { a_relire: ["promesse", "capacites"] }, state));
    expect(outcome.compteurs.champs_a_relire).toBe(3);
    expect(outcome.compteurs.fiches_a_relire).toBe(2);
    expect(outcome.volume).toContain("3 a_relire field(s) on 2 fiche(s)");
  });

  test("rule offer pair: an offre with one of its two texts is refused, and is not counted as an offer", () => {
    for (const [written, absent] of [
      ["sans_frais", "payant"],
      ["payant", "sans_frais"],
    ] as const) {
      const outcome = judge(withFiche("P02", { offre: { [written]: OFFRE[written] } }));
      expect(violationOf(outcome, item("P02"))).toContain(
        `/offre: must have required property '${absent}'`,
      );
      expect(outcome.compteurs.avec_offre).toBe(0);
      expect(outcome.compteurs.offre_indecidable).toBe(1);
      expectSums(outcome);
    }
  });

  test("rule offer listed: only a product the list of hosted offers names carries an offre", () => {
    const listed = judge(withFiche("P02", { offre: OFFRE }));
    expect(listed.report.violations).toEqual([]);
    const outcome = judge(withFiche("P01", { offre: OFFRE }));
    expect(outcome.report.violations).toEqual([
      `${item("P01")}: offre is written, and ${HOSTED_OFFERS_PATH} does not list P01: a fiche describes a hosted offer once a decision admits one for its product (ADR-0066 D2)`,
    ]);
  });

  // The forms the owner named, in any case, and two ways of hiding the word
  // that print the same: a soft hyphen inside it, and full-width letters.
  const GRATUIT_FORMS = [
    "gratuit",
    "Gratuite",
    "GRATUITS",
    "gratuites",
    "gratuitement",
    "Gratuité",
    `gra${String.fromCharCode(0xad)}tuit`,
    [0xff47, 0xff52, 0xff41, 0xff54, 0xff55, 0xff49, 0xff54]
      .map((code) => String.fromCharCode(code))
      .join(""),
  ];

  test.each(
    GRATUIT_FORMS.flatMap((form) => [
      ["sans_frais", form],
      ["payant", form],
    ]),
  )("rule offer word: offre.%s does not say « %s »", (key, form) => {
    const offre = { ...OFFRE, [key]: `Le logiciel est ${form} chez vous.` };
    const outcome = judge(withFiche("P02", { offre }));
    expect(outcome.report.violations).toEqual([
      expect.stringContaining(`${item("P02")}: offre.${key} says « gratuit »`),
    ]);
    // The other text is not accused.
    expect(outcome.report.violations.join("\n").match(/says « gratuit »/g)).toHaveLength(1);
  });

  // The accroche is the text the card of the site prints: the most public text
  // of a fiche, and the word ADR-0033 refuses as an absolute claim is refused
  // there as in an offre.
  test.each(GRATUIT_FORMS)("rule accroche word: the accroche does not say « %s »", (form) => {
    const outcome = judge(withFiche("P01", { accroche: `Un outil ${form} pour vous.` }));
    expect(outcome.report.violations).toEqual([
      expect.stringContaining(`${item("P01")}: accroche says « gratuit »`),
    ]);
  });

  test("rule accroche word: an accroche without the word is admitted", () => {
    const accroche = "Retrouvez vos notes, sans frais chez vous.";
    expect(judge(withFiche("P01", { accroche })).report.violations).toEqual([]);
  });

  test("rule offer word: « sans frais », with its condition, is what an offre says", () => {
    const offre = { ...OFFRE, sans_frais: "Sans frais chez vous, tous filtres compris." };
    expect(judge(withFiche("P02", { offre })).report.violations).toEqual([]);
  });

  test("rule counters offer: fiches with an offre and fiches without sum to the fiches read", () => {
    const state = reference();
    state.offres = offers([LISTED, { produit: "P03", decision: "ADR-0066" }]);
    withFiche("P02", { offre: OFFRE }, state);
    withFiche("P03", { offre: OFFRE }, state);
    state.files.set("P01.v1.yaml", "not: [a fiche");
    const outcome = judge(state);
    expect(outcome.compteurs.avec_offre).toBe(2);
    expect(outcome.compteurs.sans_offre).toBe(0);
    expect(outcome.compteurs.offre_indecidable).toBe(1);
    expect(outcome.volume).toContain(
      "hosted offer: 2 with an offre + 0 without + 1 not decidable (schema not held) = 3",
    );
    expectSums(outcome);
  });
});

describe("a source that cannot be read is a failure, never a zero", () => {
  test("source catalogue: no product read from the decision record", () => {
    const state = reference();
    state.catalogue = new Set();
    state.domaines = new Map();
    const outcome = judge(state);
    expect(violationOf(outcome, "catalogue of ADR-0042 §1")).toContain("no product read");
    expect(violationOf(outcome, "domains of ADR-0042 §1")).toContain("no domain read");
    expectSums(outcome);
  });

  test("source catalogue lines: a line of the section the reader did not read is a failure", () => {
    const state = reference();
    state.catalogueUnread = ["line 12 « | Collaboration | P04 quatre | »"];
    expect(violationOf(judge(state), "catalogue of ADR-0042 §1")).toContain(
      "catalogue line(s) not read: line 12 « | Collaboration | P04 quatre | »",
    );
  });

  // The schema is a source: unreadable, it is named, no fiche is judged valid
  // and the counters are still summed and printed. It used to throw while the
  // module loaded, before the gate had printed a line.
  test.each<[string, ReadResult, string]>([
    ["that cannot be read", { ok: false, reason: "EISDIR" }, "unreadable (EISDIR)"],
    ["that is empty", { ok: true, text: "" }, "unreadable (the file is empty)"],
    ["made of blanks", { ok: true, text: " \n" }, "unreadable (the file is empty)"],
    ["that is not JSON", { ok: true, text: "{ type: object" }, "unreadable (not JSON ("],
    ["that is a list", { ok: true, text: "[]" }, "unreadable (it declares no properties)"],
    [
      "without a property",
      { ok: true, text: '{"type":"object","properties":{}}' },
      "unreadable (it declares no properties)",
    ],
    [
      "that does not compile",
      { ok: true, text: '{"type":"objet","properties":{"id":{"type":"string"}}}' },
      "unreadable (not a schema that compiles (",
    ],
  ])("source schema: a schema %s is a named failure, and the counters are printed", (_name, schema, expected) => {
    const state = reference();
    state.schema = schema;
    const outcome = judge(state);
    expect(violationOf(outcome, SCHEMA_PATH)).toContain(expected);
    // No fiche is valid under no schema, and each one says why.
    expect(violationOf(outcome, item("P01"))).toContain(`not judged: ${SCHEMA_PATH} is unreadable`);
    expect(outcome.compteurs).toMatchObject({
      catalogue: 3,
      couverts: 3,
      fiches_lues: 3,
      valides: 0,
      en_violation: 3,
      depot_indecidable: 3,
    });
    expect(outcome.volume).toContain("3 fiche(s) read = 0 valid + 3 in violation");
    expectSums(outcome);
  });

  test("source schema: the schema as written is read, and says how many fields it declares", () => {
    const check = judge(reference()).report.checks.find((entry) => entry.item === SCHEMA_PATH);
    expect(check).toEqual({
      item: SCHEMA_PATH,
      ok: true,
      note: `${SCHEMA_FIELDS.size} field(s) declared, compiled in strict mode`,
    });
  });

  test("source domains: a domain the category table does not map", () => {
    const state = reference();
    state.domaines.set("P03", ["Domaine nouveau"]);
    const outcome = judge(state);
    expect(violationOf(outcome, "domains of ADR-0042 §1")).toContain(
      "domain(s) the category table does not map: Domaine nouveau",
    );
  });

  test("source inventory: no repository read", () => {
    const state = reference();
    state.repositories = new Map();
    expect(violationOf(judge(state), "ecosystem/repositories.v1.yaml")).toContain(
      "no repository read",
    );
  });

  // The list of hosted offers is a source: unreadable or read in part, it is a
  // named failure, and a fiche that carries an offre is then refused too.
  test.each<[string, ReadResult, string]>([
    ["that cannot be read", { ok: false, reason: "ENOENT" }, "unreadable (ENOENT)"],
    ["that is not YAML", { ok: true, text: "offres_hebergees: [P02" }, "invalid YAML ("],
    ["that is empty", { ok: true, text: "" }, "not a « libre-ai.hosted-offers.v1 » record"],
    [
      "of another version",
      offers([LISTED], { schema_version: "libre-ai.hosted-offers.v2" }),
      "not a « libre-ai.hosted-offers.v1 » record",
    ],
    [
      "whose entries are not a list",
      offers([], { offres_hebergees: { P02: "ADR-0054" } }),
      "not a « libre-ai.hosted-offers.v1 » record",
    ],
    [
      "with a foreign key",
      offers([LISTED], { exemptions: ["P01"] }),
      "« exemptions » is not a key",
    ],
    ["with an entry that is a text", offers([LISTED, "P01"]), "entry 2 is not a product"],
    [
      "with an entry of another form of identifier",
      offers([LISTED, { produit: "P1", decision: "ADR-0066" }]),
      "entry 2 names no product",
    ],
    [
      "with an entry without its decision",
      offers([LISTED, { produit: "P01" }]),
      "entry 2 (P01) cites no decision record",
    ],
    [
      "with an entry that carries another key",
      offers([LISTED, { produit: "P01", decision: "ADR-0066", depuis: "2026-11-15" }]),
      "entry 2 (P01) carries depuis",
    ],
    ["with a product listed twice", offers([LISTED, LISTED]), "P02 is listed twice"],
    ["that lists no product", offers([]), "no product listed"],
    [
      "that lists a product outside the catalogue",
      offers([LISTED, { produit: "P09", decision: "ADR-0066" }]),
      "lists P09, which the catalogue of ADR-0042 §1 does not",
    ],
  ])("source hosted offers: a list %s is a named failure", (_name, list, expected) => {
    const state = reference();
    state.offres = list;
    const outcome = judge(state);
    expect(violationOf(outcome, HOSTED_OFFERS_PATH)).toContain(expected);
    expectSums(outcome);
  });

  test("source hosted offers: under a list that cannot be read, no fiche carries an offre", () => {
    const state = withFiche("P02", { offre: OFFRE });
    state.offres = { ok: false, reason: "ENOENT" };
    expect(violationOf(judge(state), item("P02"))).toContain(
      `${HOSTED_OFFERS_PATH} does not list P02`,
    );
  });

  test("source hosted offers: the list as written is read, and says how many products it names", () => {
    const check = judge(reference()).report.checks.find(
      (entry) => entry.item === HOSTED_OFFERS_PATH,
    );
    expect(check).toEqual({
      item: HOSTED_OFFERS_PATH,
      ok: true,
      note: "1 product(s) with a decided hosted offer, each one in the catalogue",
    });
  });

  test("source directory: no fiche tracked", () => {
    const state = reference();
    state.files = new Map();
    const outcome = judge(state);
    expect(violationOf(outcome, `${PRODUITS_ROOT}/`)).toContain("no fiche is tracked");
    expect(outcome.compteurs.manquants).toBe(3);
    expectSums(outcome);
  });

  test("source index: the index could not be listed", () => {
    // The fiches are left in place: the listing error alone must fail the
    // directory, not the emptiness that usually comes with it.
    const state = reference();
    state.listingError = "not a git repository";
    expect(violationOf(judge(state), `${PRODUITS_ROOT}/`)).toContain(
      "the index could not be listed (not a git repository)",
    );
  });

  test("source fiche: a tracked fiche that cannot be read", () => {
    const state = reference();
    state.entries = asFiles(state);
    state.files.delete("P02.v1.yaml");
    const outcome = judge(state);
    expect(violationOf(outcome, item("P02"))).toContain("unreadable (ENOENT)");
    expectSums(outcome);
  });

  test.each([...SOURCE_PATHS])("source drift: %s changed on disk and not staged", (source) => {
    const state = reference();
    state.unstaged.add(source);
    expect(violationOf(judge(state), "sources")).toContain(
      `${source}: its working copy differs from the index`,
    );
  });

  // A source is read on disk under the attestation « as indexed »: that holds
  // only for a file the index holds as a regular file.
  test.each<[LocalTarget, string]>([
    ["link", "is tracked as a symbolic link"],
    ["absent", "is not in the index"],
    ["empty", "is an empty file"],
    ["other", "is tracked as neither a regular file nor a link"],
  ])("source standing: a source that is %s in the index is refused", (standing, expected) => {
    for (const source of SOURCE_PATHS) {
      const state = reference();
      state.sources = state.sources.map((declared) =>
        declared.path === source ? { path: source, standing } : declared,
      );
      const violation = violationOf(judge(state), "sources");
      expect(violation).toContain(`${source} ${expected}`);
      // The two other sources are regular files: they are not named.
      for (const other of SOURCE_PATHS.filter((path) => path !== source)) {
        expect(violation).not.toContain(other);
      }
    }
  });

  test("source standing: no source declared is a failure, not zero file read as indexed", () => {
    const state = reference();
    state.sources = [];
    expect(violationOf(judge(state), "sources")).toContain("no source file declared");
  });

  test("fiche drift: a fiche changed on disk and not staged is not read", () => {
    const state = reference();
    state.unstaged.add(item("P02"));
    const outcome = judge(state);
    expect(violationOf(outcome, item("P02"))).toContain("its working copy differs from the index");
    expect(outcome.compteurs.depot_indecidable).toBe(1);
  });

  test("stray: a link or a foreign file under the root is refused, not read", () => {
    const state = reference();
    state.entries = [
      ...asFiles(state),
      { path: "P04.v1.yaml", kind: "link" },
      { path: "notes.txt", kind: "file" },
      { path: "README.md", kind: "file" },
    ];
    const outcome = judge(state);
    expect(violationOf(outcome, `${PRODUITS_ROOT}/`)).toContain(
      "P04.v1.yaml (link), notes.txt (file)",
    );
    expect(outcome.volume).toContain(
      "6 tracked path(s) under ecosystem/produits/ = 3 fiche(s) + 1 README + 2 refused + 0 unmerged",
    );
    expectSums(outcome);
  });

  test("unmerged: a path with no single indexed content is not read, and the paths still sum", () => {
    const state = reference();
    state.entries = [
      ...asFiles(state).filter((entry) => entry.path !== "P02.v1.yaml"),
      { path: "P02.v1.yaml", kind: "unmerged" },
      { path: "README.md", kind: "file" },
    ];
    const outcome = judge(state);
    expect(violationOf(outcome, `${PRODUITS_ROOT}/`)).toContain("unmerged path(s)");
    expect(violationOf(outcome, `${PRODUITS_ROOT}/`)).toContain("P02.v1.yaml");
    // Not read as a fiche: the product is missing, and says so.
    expect(violationOf(outcome, "P02")).toContain("no fiche ecosystem/produits/P02.v1.yaml");
    expect(outcome.compteurs).toMatchObject({
      chemins_suivis: 4,
      fiches_lues: 2,
      readmes: 1,
      refuses: 0,
      non_fusionnes: 1,
    });
    expect(outcome.volume).toContain(
      "4 tracked path(s) under ecosystem/produits/ = 2 fiche(s) + 1 README + 0 refused + 1 unmerged",
    );
    expectSums(outcome);
  });

  test("a control character in a file name is printed escaped", () => {
    const state = reference();
    state.entries = [...asFiles(state), { path: "x\nProduct catalogue verified", kind: "file" }];
    const lines = judge(state).report.violations.join("|");
    expect(lines).toContain("x\\u000aProduct catalogue verified");
    expect(lines).not.toContain("\n");
  });
});

describe("the domains of ADR-0042 §1", () => {
  const NOT_AT_FIRST_COLUMN = "a row of the catalogue table starts with « | » at the first column";
  const NOT_TWO_CELLS = "a row has two cells, a domain and its products, and ends with « | »";
  const notAnIdentifier = (item: string): string =>
    `« ${item} » does not start with a product identifier (P and two digits, then a blank or the end of the item)`;
  const notADomain = (domain: string): string =>
    `« ${domain} » is not a domain the category table maps`;

  test("the reader gives each product the first cell of its row", () => {
    const adr = [
      "## Décision",
      "",
      "### 1. Le catalogue d'applications",
      "",
      "| Domaine | Produits |",
      "| --- | --- |",
      "| Connaissance | P01 un (voir P9 et XP02) · P02 deux |",
      "| Poste de travail | P40 fenêtres |",
      "",
      "P02 et P40 sont cités hors du tableau.",
      "",
      "### 2. Autre",
      "",
      "| Collaboration | P15 |",
    ].join("\n");
    const table = parseCatalogueTable(adr);
    expect([...table.domains]).toEqual([
      ["P01", ["Connaissance"]],
      ["P02", ["Connaissance"]],
      ["P40", ["Poste de travail"]],
    ]);
    // Each product is tied to the row it was read in, by line number.
    expect(table.rows.get("P40")).toEqual(["line 8 « | Poste de travail | P40 fenêtres | »"]);
    // A sentence of the section that cites products of the table is prose.
    expect(table.unread).toEqual([]);
  });

  test("a product written in two rows gets both domains", () => {
    const adr =
      "### Le catalogue d'applications\n| Connaissance | P01 |\n| Collaboration | P01 · P02 |\n| Collaboration | P02 |\n";
    const table = parseCatalogueTable(adr);
    expect([...table.domains]).toEqual([
      ["P01", ["Connaissance", "Collaboration"]],
      ["P02", ["Collaboration"]],
    ]);
    expect(table.unread).toEqual([]);
  });

  test("no catalogue heading, no domain", () => {
    const table = parseCatalogueTable("| Connaissance | P01 |\n  | Connaissance | P02 |\n");
    expect(table.domains.size).toBe(0);
    // Outside the section nothing is a catalogue line, read or not.
    expect(table.unread).toEqual([]);
  });

  // The products come from the cell of products and from no other: an
  // identifier written in the cell of the domain is not a product of the row.
  test("cells: an identifier in the cell of the domain is not read as a product", () => {
    const adr = "### Le catalogue d'applications\n| Connaissance | P01 un |\n| P41 | P02 deux |\n";
    const table = parseCatalogueTable(adr);
    expect([...table.domains]).toEqual([["P01", ["Connaissance"]]]);
    expect(table.unread).toEqual([`line 3 « | P41 | P02 deux | »: ${notADomain("P41")}`]);
  });

  describe("section: it ends at the next heading of its depth or shallower, not at a sub-title", () => {
    const table = (depth: string, next: string): ReturnType<typeof parseCatalogueTable> =>
      parseCatalogueTable(
        `${depth} 1. Le catalogue d'applications\n\n| Connaissance | P01 un |\n\n${next} Ajouts\n\n| Poste de travail | P41 truc |\n`,
      );

    test.each([
      ["###", "####"],
      ["###", "######"],
      ["##", "###"],
    ])("a table under a « %s » section and a « %s » sub-title is part of the catalogue", (depth, next) => {
      const read = table(depth, next);
      expect([...read.domains]).toEqual([
        ["P01", ["Connaissance"]],
        ["P41", ["Poste de travail"]],
      ]);
      expect(read.rows.get("P41")).toEqual(["line 7 « | Poste de travail | P41 truc | »"]);
      expect(read.unread).toEqual([]);
    });

    test.each([
      ["###", "###"],
      ["###", "##"],
      ["###", "#"],
      ["####", "###"],
    ])("a « %s » section is closed by a « %s » heading", (depth, next) => {
      const read = table(depth, next);
      expect([...read.domains]).toEqual([["P01", ["Connaissance"]]]);
      expect(read.unread).toEqual([]);
    });

    test("a sub-title that names a product no row lists is unread, like any prose", () => {
      const adr = "### Le catalogue d'applications\n| Connaissance | P01 un |\n#### P41 arrive\n";
      expect(parseCatalogueTable(adr).unread).toEqual([
        "line 3 « #### P41 arrive »: names P41, which no row of the table lists",
      ]);
    });
  });

  describe("unread: a line of the section that is not read in full", () => {
    const SECTION = "### 1. Le catalogue d'applications\n\n| Connaissance | P01 un · P02 deux |\n";
    const unreadOf = (line: string): string[] =>
      parseCatalogueTable(`${SECTION}${line}\n\n### 2. Autre\n\n  | Hors section | P77 |\n`).unread;

    test.each([
      ["an indented row", "  | Collaboration | P03 trois |", NOT_AT_FIRST_COLUMN],
      ["a row indented by a tabulation", "\t| Collaboration | P03 trois |", NOT_AT_FIRST_COLUMN],
      ["a row without its leading bar", "Collaboration | P03 trois |", NOT_AT_FIRST_COLUMN],
      // The product is in the table: the row would give it a second domain.
      [
        "an indented row of a product the table lists",
        "  | Collaboration | P01 un |",
        NOT_AT_FIRST_COLUMN,
      ],
      [
        "a list item naming a product no row lists",
        "- P03 trois",
        "names P03, which no row of the table lists",
      ],
      [
        "a sentence naming a product no row lists",
        "P03 rejoint le catalogue.",
        "names P03, which no row of the table lists",
      ],
      // A line with a bar is a line of the table, with or without a product.
      ["a line with a bar and no product", "Collaboration | rien |", NOT_AT_FIRST_COLUMN],
      [
        "an indented row of identifiers of another form",
        "  | Collaboration | XP03 · P3 · P033 |",
        NOT_AT_FIRST_COLUMN,
      ],
      // The forms a reader of identifiers anywhere in the row let through.
      [
        "an identifier cut by a blank",
        "| Collaboration | P 41 truc |",
        notAnIdentifier("P 41 truc"),
      ],
      [
        "an identifier of three digits",
        "| Collaboration | P100 truc |",
        notAnIdentifier("P100 truc"),
      ],
      ["an identifier in lower case", "| Collaboration | p41 truc |", notAnIdentifier("p41 truc")],
      [
        "an identifier with a hyphen",
        "| Collaboration | P-41 truc |",
        notAnIdentifier("P-41 truc"),
      ],
      [
        "an identifier with a suffix",
        "| Collaboration | P41bis truc |",
        notAnIdentifier("P41bis truc"),
      ],
      ["an identifier of one digit", "| Collaboration | P4 truc |", notAnIdentifier("P4 truc")],
      [
        "an identifier with a prefix",
        "| Collaboration | XP03 truc |",
        notAnIdentifier("XP03 truc"),
      ],
      ["a row without an identifier", "| Collaboration | truc |", notAnIdentifier("truc")],
      ["a row with an empty cell of products", "| Collaboration | |", notAnIdentifier("")],
      [
        "a row whose second item has no identifier",
        "| Collaboration | P03 trois · quatre |",
        notAnIdentifier("quatre"),
      ],
      [
        "a row whose identifier does not open its item",
        "| Collaboration | le P03 trois |",
        notAnIdentifier("le P03 trois"),
      ],
      [
        "a new domain without an identifier",
        "| Domaine nouveau | truc |",
        notADomain("Domaine nouveau"),
      ],
      [
        "a new domain with an identifier",
        "| Domaine nouveau | P03 trois |",
        notADomain("Domaine nouveau"),
      ],
      ["a row without a domain", "| | P03 trois |", notADomain("")],
      ["a row of three cells", "| Collaboration | P03 trois | note |", NOT_TWO_CELLS],
      ["a row of one cell", "| P03 trois |", NOT_TWO_CELLS],
      ["a row that is not closed", "| Collaboration | P03 trois", NOT_TWO_CELLS],
    ])("%s is returned, with its line number and the reason", (_name, line, reason) => {
      expect(unreadOf(line)).toEqual([`line 4 « ${line.trim()} »: ${reason}`]);
      // The domains are those of the rows read in full: the line gave none.
      expect([...parseCatalogueTable(`${SECTION}${line}\n`).domains]).toEqual([
        ["P01", ["Connaissance"]],
        ["P02", ["Connaissance"]],
      ]);
    });

    test.each([
      ["a sentence citing products of the table", "P01 et P02 sortent du gel."],
      ["a list item citing a product of the table", "- Une capacité de **P02**."],
      ["a sentence without a product", "Les noms publics restent à fixer."],
      ["the header of the table", "| Domaine | Produits |"],
      ["the separator of the table", "| --- | --- |"],
      ["an aligned separator", "|:---|---:|"],
    ])("%s is not an unread line", (_name, line) => {
      expect(unreadOf(line)).toEqual([]);
    });

    test("a row read in full after the others is a row: its products are in the catalogue", () => {
      const table = parseCatalogueTable(`${SECTION}| Collaboration | P03 trois (bêta) · P04 |\n`);
      expect(table.unread).toEqual([]);
      expect(table.domains.get("P03")).toEqual(["Collaboration"]);
      expect(table.domains.get("P04")).toEqual(["Collaboration"]);
    });

    test("several unread lines are returned in the order of the section", () => {
      const table = parseCatalogueTable(
        `${SECTION}P09 arrive.\n| Collaboration | p41 truc |\n- P08 aussi\n`,
      );
      expect(table.unread.map((entry) => entry.slice(0, 6))).toEqual([
        "line 4",
        "line 5",
        "line 6",
      ]);
    });
  });

  // The catalogue is read by two parsers: where they differ, the gate fails on
  // the difference instead of counting one catalogue per gate.
  describe("reconcile: the reader of the brick map and this one are held together", () => {
    const SUB_TITLE =
      "### 1. Le catalogue d'applications\n\n| Connaissance | P01 un |\n\n#### Ajouts\n\n| Poste de travail | P41 truc |\n";

    test("control: the two readers agree, and nothing is added", () => {
      const adr = "### Le catalogue d'applications\n| Connaissance | P01 un · P02 deux |\n";
      const reconciled = reconcileCatalogue(parseCatalogueTable(adr), parseCatalogue(adr));
      expect([...reconciled.catalogue]).toEqual(["P01", "P02"]);
      expect(reconciled.unread).toEqual([]);
    });

    test("a product under a sub-title is in the catalogue, and its line is named", () => {
      // The reader of the brick map closes the section at the sub-title.
      expect([...parseCatalogue(SUB_TITLE)]).toEqual(["P01"]);
      const reconciled = reconcileCatalogue(
        parseCatalogueTable(SUB_TITLE),
        parseCatalogue(SUB_TITLE),
      );
      expect([...reconciled.catalogue]).toEqual(["P01", "P41"]);
      expect(reconciled.unread).toEqual([
        "line 7 « | Poste de travail | P41 truc | »: P41 is read by this gate and not by the reader of the brick map, which closes the section at any heading",
      ]);
    });

    test("a product only the reader of the brick map reads is in the catalogue, and is named", () => {
      const adr = "### Le catalogue d'applications\n| Connaissance | P01 un (avec P41) |\n";
      const table = parseCatalogueTable(adr);
      expect(table.unread).toEqual([]);
      const reconciled = reconcileCatalogue(table, parseCatalogue(adr));
      expect([...reconciled.catalogue]).toEqual(["P01", "P41"]);
      expect(reconciled.unread).toEqual([
        "P41: read by the reader of the brick map, and in no row this gate read in full",
      ]);
    });

    test("the unread lines of the table are kept", () => {
      const adr =
        "### Le catalogue d'applications\n| Connaissance | P01 un |\n| Connaissance | P 41 |\n";
      const table = parseCatalogueTable(adr);
      expect(reconcileCatalogue(table, parseCatalogue(adr)).unread).toEqual(table.unread);
      expect(table.unread.length).toBe(1);
    });
  });

  // The table of this module, the enumeration of the schema and the decision
  // record are three writings of the same eight domains: held to one another
  // on the real files, so that a domain added to the ADR turns this red.
  test("table: the category table, the schema and the decision record agree", async () => {
    const directory = join(import.meta.dir, "..", "docs", "adr");
    const names = readdirSync(directory).filter((name) => name.startsWith("0042-"));
    expect(names.length).toBe(1);
    const adr = readFileSync(join(directory, String(names[0])), "utf8");
    const { domains, unread } = parseCatalogueTable(adr);
    // The decision record as it is written: no line of its section is left unread.
    expect(unread).toEqual([]);

    const labels = new Set([...domains.values()].flat());
    expect([...labels].sort()).toEqual([...DOMAIN_CATEGORIES.keys()].sort());
    for (const [product, given] of domains) expect([product, given.length]).toEqual([product, 1]);
    // Same products as the reader of the brick map: one catalogue, two readers.
    expect([...domains.keys()].sort()).toEqual([...parseCatalogue(adr)].sort());

    const schema = (await Bun.file(
      join(import.meta.dir, "schemas", "produit.v1.schema.json"),
    ).json()) as { properties: { categorie: { enum: string[] } } };
    expect([...schema.properties.categorie.enum].sort()).toEqual(
      [...DOMAIN_CATEGORIES.values()].sort(),
    );
    expect(new Set(DOMAIN_CATEGORIES.values()).size).toBe(DOMAIN_CATEGORIES.size);
  });
});

describe("the schema", () => {
  // The order of the properties is a convention of writing, which the gate
  // does not check: only the set is held.
  test("its fields are the ones a fiche is written with", () => {
    expect([...SCHEMA_FIELDS].sort()).toEqual(Object.keys(fiche("P01", { offre: OFFRE })).sort());
  });

  // Every field is written, an absence as `null` or `[]`; `offre` alone is
  // left out, by the products that have no decided hosted offer.
  test("offre is the only field a fiche may omit", () => {
    const schema: unknown = JSON.parse(SCHEMA_TEXT);
    const required: unknown = isRecord(schema) ? schema.required : undefined;
    if (!Array.isArray(required)) throw new Error("the schema requires no field");
    expect([...SCHEMA_FIELDS].filter((field) => !required.includes(field))).toEqual(["offre"]);
    const verdict: unknown = validateFiche(fiche("P01"));
    expect(verdict).toEqual({ data: fiche("P01") });
  });

  // The enumeration of `realisation` is held to what the fiches write, read
  // from the files at each run: a value added to the schema that no fiche
  // employs turns this red, and so does a value a fiche employs outside it.
  // No value is written here.
  test("realisation: the enumeration is the set of values the fiches employ", () => {
    const directory = join(import.meta.dir, "..", PRODUITS_ROOT);
    const names = readdirSync(directory).filter((name) => /^P[0-9]{2}\.v1\.yaml$/.test(name));
    // An emptied directory would compare the enumeration to nothing.
    expect(names.length).toBeGreaterThan(0);
    const employed = new Set<string>();
    for (const name of names) {
      const parsed: unknown = Bun.YAML.parse(readFileSync(join(directory, name), "utf8"));
      const value = isRecord(parsed) ? parsed.realisation : undefined;
      if (typeof value !== "string") throw new Error(`${name} carries no realisation`);
      employed.add(value);
    }
    const schema: unknown = JSON.parse(SCHEMA_TEXT);
    const properties = isRecord(schema) ? schema.properties : undefined;
    const realisation = isRecord(properties) ? properties.realisation : undefined;
    const enumeration: unknown = isRecord(realisation) ? realisation.enum : undefined;
    if (!Array.isArray(enumeration)) throw new Error("realisation declares no enumeration");
    expect(enumeration.map(String).sort()).toEqual([...employed].sort());
  });
});

// An export nothing else reads is a surface with no consumer. The dead-code
// gate counts the names of exported values only: a type is held here.
describe("the exports of the module", () => {
  const read = (name: string): string => readFileSync(join(import.meta.dir, name), "utf8");
  const exported = [
    ...read("produits.ts").matchAll(
      /^export (?:async )?(?:const|function|interface|type|class) ([A-Za-z_][A-Za-z0-9_]*)/gm,
    ),
  ].flatMap((match) => match[1] ?? []);
  // What the gate and the two suites import from the module, by name: a
  // mention in a comment or in a string is not a consumer.
  const imported = new Set(
    ["check-produits.ts", "produits.test.ts", "check-produits.process.test.ts"].flatMap((name) =>
      [...read(name).matchAll(/import\s*\{([^}]*)\}\s*from "\.\/produits";/g)].flatMap((match) =>
        (match[1] ?? "")
          .split(",")
          .map((entry) => entry.trim().replace(/^type\s+/, ""))
          .filter((entry) => entry.length > 0),
      ),
    ),
  );

  test("control: the module exports something, and something is imported from it", () => {
    expect(exported.length).toBeGreaterThan(0);
    expect(imported.size).toBeGreaterThan(0);
  });

  test.each(exported)("%s is imported outside the module", (name) => {
    expect(imported.has(name)).toBe(true);
  });
});

/**
 * No string of a fiche carries a control character, and a text is not made of
 * blanks. The class is not copied from the schema: it is the one the gates
 * escape when they print (`CONTROL_CHARACTERS`), walked code point by code
 * point, so a pattern narrower than that class turns this red. The former
 * pattern excluded C0 and DEL only, and let exactly one control character
 * through: the one its `\S` consumed.
 */
describe("the text of a fiche", () => {
  const controls = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).filter(
    (character) => character.replace(CONTROL_CHARACTERS, "") === "",
  );
  // Built from code points: a source file does not carry these characters.
  const LINE_SEPARATOR = String.fromCharCode(0x2028);
  const NO_BREAK_SPACE = String.fromCharCode(0xa0);
  const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
  /** Every field written, so that every string of a fiche has a place to carry the character. */
  const full = fiche("P01", {
    nom_public: "Nom public",
    depot: SELF,
    depend_de: ["P02"],
    offre: OFFRE,
  });

  const inMiddle = (text: string, character: string): string => {
    const half = Math.floor(text.length / 2);
    return `${text.slice(0, half)}${character}${text.slice(half)}`;
  };

  /**
   * A place of a fiche that holds a text: a field, or one text of a field that
   * is an object, written `field.key` (`offre.payant`).
   */
  const partsOf = (place: string): [string, string | undefined] => {
    const [field = "", key] = place.split(".");
    return [field, key];
  };

  /** `full` with a text written at a place (as the only item, for a list). */
  function holding(place: string, text: string): Fiche {
    const [field, key] = partsOf(place);
    const value = full[field];
    if (key === undefined) return { ...full, [field]: Array.isArray(value) ? [text] : text };
    if (!isRecord(value)) throw new Error(`${field} is not an object in the reference fiche`);
    return { ...full, [field]: { ...value, [key]: text } };
  }

  /** `full` with the character written in the middle of one place (of its first item, for a list). */
  function carrying(place: string, character: string): Fiche {
    const [field, key] = partsOf(place);
    const value = full[field];
    if (Array.isArray(value) && typeof value[0] === "string") {
      return { ...full, [field]: [inMiddle(value[0], character), ...value.slice(1)] };
    }
    const held = key === undefined ? value : isRecord(value) ? value[key] : undefined;
    if (typeof held === "string") return holding(place, inMiddle(held, character));
    throw new Error(`${place} carries no string in the reference fiche`);
  }

  /** Every place of the reference fiche: its fields, and each text of a field that is an object. */
  const PLACES = Object.keys(full).flatMap((field) => {
    const value = full[field];
    return isRecord(value) ? Object.keys(value).map((key) => `${field}.${key}`) : [field];
  });

  test("control: the class walked is the one the gates escape, and the reference fiche holds", () => {
    expect(controls).toContain("\u001b");
    expect(controls).toContain("\u0085");
    expect(controls).toContain(LINE_SEPARATOR);
    expect(controls).not.toContain(NO_BREAK_SPACE);
    const verdict: unknown = validateFiche(full);
    expect(verdict).toEqual({ data: full });
  });

  test.each(PLACES)("no control character is admitted in %s", (field) => {
    const admitted = controls.filter(
      (character) => "data" in validateFiche(carrying(field, character)),
    );
    expect(admitted.map((character) => character.charCodeAt(0).toString(16))).toEqual([]);
  });

  const TEXT_FIELDS = [
    "nom_public",
    "nom_provisoire",
    "intitule",
    "fonction",
    "promesse",
    "accroche",
    "pour_qui",
    "a_la_place_de",
    "offre.sans_frais",
    "offre.payant",
    "capacites",
    "ne_fait_pas",
    "etiquettes",
  ];

  test.each(TEXT_FIELDS)("a no-break space and an accent are admitted in %s", (field) => {
    // The rule refuses control characters, not everything outside ASCII.
    const value = carrying(field, `${NO_BREAK_SPACE}é`);
    const verdict: unknown = validateFiche(value);
    expect(verdict).toEqual({ data: value });
  });

  test.each(TEXT_FIELDS)("blanks alone are not a value of %s", (field) => {
    for (const blank of [" ", NO_BREAK_SPACE, ZERO_WIDTH_SPACE]) {
      const value = holding(field, blank.repeat(12));
      expect(["errors" in validateFiche(value), JSON.stringify(blank)]).toEqual([
        true,
        JSON.stringify(blank),
      ]);
    }
  });

  // Five characters Unicode classes as a letter or a symbol print nothing: a
  // value made of them alone passed the rule « one visible character ». The
  // list is the one the schema declares; it is closed, not a class.
  const INVISIBLE_LETTERS_AND_SYMBOLS = [0x115f, 0x1160, 0x2800, 0x3164, 0xffa0];

  test.each(TEXT_FIELDS)("invisible letters and symbols alone are not a value of %s", (field) => {
    for (const code of INVISIBLE_LETTERS_AND_SYMBOLS) {
      // Three of them: long enough for every field, short enough for a name.
      const value = holding(field, String.fromCharCode(code).repeat(12));
      const verdict = validateFiche(value);
      expect([code.toString(16), "errors" in verdict ? verdict.errors.join("\n") : ""]).toEqual([
        code.toString(16),
        expect.stringContaining("must match pattern"),
      ]);
    }
  });

  test.each(
    TEXT_FIELDS,
  )("one visible character next to invisible ones is a value of %s", (field) => {
    const value = holding(field, `${String.fromCharCode(0x3164).repeat(11)}é`);
    const verdict: unknown = validateFiche(value);
    expect(verdict).toEqual({ data: value });
  });

  test("every field of the schema is a free text or a closed form", () => {
    // A field added to the schema is classified here, or this turns red: a
    // free text the two tests above do not walk would be held by nothing.
    const closed = [
      "schema_version",
      "id",
      "categorie",
      "depend_de",
      "realisation",
      "depot",
      "a_relire",
    ];
    const free = [...new Set(TEXT_FIELDS.map((place) => partsOf(place)[0]))];
    expect([...free, ...closed].sort()).toEqual([...SCHEMA_FIELDS].sort());
  });

  test("every text of offre the schema declares is walked as a free text", () => {
    const schema: unknown = JSON.parse(SCHEMA_TEXT);
    const properties = isRecord(schema) ? schema.properties : undefined;
    const offre = isRecord(properties) ? properties.offre : undefined;
    const texts =
      isRecord(offre) && isRecord(offre.properties) ? Object.keys(offre.properties) : [];
    expect(texts.length).toBeGreaterThan(0);
    expect(TEXT_FIELDS.filter((place) => place.startsWith("offre.")).sort()).toEqual(
      texts.map((key) => `offre.${key}`).sort(),
    );
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Change {
  /** One field of the fiche; empty for the fiche itself. */
  readonly path: readonly string[];
  readonly value?: unknown;
}

interface InvalidVector {
  readonly name: string;
  readonly set?: Change;
  readonly unset?: Change;
  readonly expect: string;
}

/** The first valid vector with the one change of an invalid vector. */
function changed(base: Fiche, vector: InvalidVector): unknown {
  // Exactly one change per vector: a vector with none would pass on nothing.
  const changes = [vector.set, vector.unset].filter((change) => change !== undefined);
  if (changes.length !== 1) throw new Error(`« ${vector.name} » carries ${changes.length} changes`);
  const [field, ...deeper] = (vector.set ?? vector.unset)?.path ?? [];
  // A deeper path was read as its first segment: refused, so that a vector
  // never changes another place than the one it names.
  if (deeper.length > 0) throw new Error(`« ${vector.name} »: a path names one field`);
  if (field === undefined) {
    if (vector.set === undefined) throw new Error(`« ${vector.name} » removes the fiche itself`);
    return vector.set.value;
  }
  const value: Fiche = structuredClone(base);
  if (vector.set !== undefined) value[field] = vector.set.value;
  else delete value[field];
  return value;
}

describe("the schema vectors", async () => {
  const vectors = (await Bun.file(
    join(import.meta.dir, "fixtures", "produits", "vectors.v1.json"),
  ).json()) as { valid: { name: string; value: Fiche }[]; invalid: InvalidVector[] };
  const base: Fiche = vectors.valid[0]?.value ?? {};

  // The tests below are generated from the file: an emptied list would
  // generate none, and nothing would turn red.
  test("the file holds valid vectors and invalid ones, each under its own name", () => {
    expect(vectors.valid.length).toBeGreaterThan(0);
    expect(vectors.invalid.length).toBeGreaterThan(0);
    const names = [...vectors.valid, ...vectors.invalid].map((vector) => vector.name);
    expect(names.filter((name, at) => names.indexOf(name) !== at)).toEqual([]);
  });

  for (const vector of vectors.valid) {
    test(`valid: ${vector.name}`, () => {
      const verdict: unknown = validateFiche(vector.value);
      expect(verdict).toEqual({ data: vector.value });
    });
  }

  for (const vector of vectors.invalid) {
    test(`invalid: ${vector.name}`, () => {
      const verdict = validateFiche(changed(base, vector));
      expect("errors" in verdict ? verdict.errors.join("\n") : "").toContain(vector.expect);
    });
  }

  /**
   * Every constraint of the schema is held by a vector.
   *
   * WHY. Eleven constraints out of twelve could be removed from the schema
   * with every suite green (review of 2026-11-15, C3): a constraint no vector
   * exercises is a sentence, not a rule. Here each constraint is removed in
   * turn — a keyword, or one entry of `required` — and the vectors are judged
   * again: one verdict at least must change. A constraint added to the schema
   * without a vector fails this test the day it is added, and a keyword this
   * walk does not know fails it too, rather than being skipped.
   *
   * WHAT IT DOES NOT SAY. That a vector is refused for the right reason: the
   * `expect` of each invalid vector, checked above, says that.
   */
  describe("every constraint is held by a vector", async () => {
    const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);
    const CONSTRAINTS = new Set([
      "type",
      "additionalProperties",
      "const",
      "enum",
      "pattern",
      "minLength",
      "maxLength",
      "minItems",
      "uniqueItems",
      "items",
      "oneOf",
      "allOf",
      "$ref",
    ]);
    /** Keywords whose value maps a name to a schema: walked, never removed as a whole. */
    const SCHEMA_MAPS = new Set(["properties", "$defs"]);

    const schema: unknown = await Bun.file(
      join(import.meta.dir, "schemas", "produit.v1.schema.json"),
    ).json();

    const child = (node: unknown, key: string): unknown => {
      if (Array.isArray(node)) return node[Number(key)];
      if (isRecord(node)) return node[key];
      throw new Error(`no ${key} under a scalar`);
    };

    /** The schema without what the pointer names. */
    function without(pointer: readonly string[]): unknown {
      const copy: unknown = structuredClone(schema);
      const parent = pointer.slice(0, -1).reduce(child, copy);
      const last = String(pointer.at(-1));
      if (Array.isArray(parent)) parent.splice(Number(last), 1);
      else if (isRecord(parent)) delete parent[last];
      else throw new Error(`nothing to remove at ${pointer.join("/")}`);
      return copy;
    }

    /** One pointer per constraint: a keyword, or one entry of `required`. */
    function constraintsOf(node: unknown, pointer: readonly string[]): string[][] {
      if (!isRecord(node)) throw new Error(`${pointer.join("/")} is not a schema`);
      return Object.entries(node).flatMap(([key, value]): string[][] => {
        const here = [...pointer, key];
        if (ANNOTATIONS.has(key)) return [];
        if (key === "required" && Array.isArray(value)) {
          return value.map((_entry, at) => [...here, String(at)]);
        }
        if (SCHEMA_MAPS.has(key) && isRecord(value)) {
          return Object.keys(value).flatMap((name) => constraintsOf(value[name], [...here, name]));
        }
        if (!CONSTRAINTS.has(key)) {
          throw new Error(`${here.join("/")}: a keyword this walk does not classify`);
        }
        const nested = Array.isArray(value)
          ? value.flatMap((entry, at) =>
              isRecord(entry) ? constraintsOf(entry, [...here, String(at)]) : [],
            )
          : isRecord(value)
            ? constraintsOf(value, here)
            : [];
        return [here, ...nested];
      });
    }

    const cases = [
      ...vectors.valid.map((vector) => ({ name: vector.name, value: vector.value as unknown })),
      ...vectors.invalid.map((vector) => ({ name: vector.name, value: changed(base, vector) })),
    ];
    /**
     * The verdict of each case under a schema. Not in strict mode: a mutant
     * that lost a `type` is refused by the strict compilation before it judges
     * anything; the schema as written is compiled strictly by the library.
     */
    function verdicts(candidate: unknown): boolean[] {
      if (!isRecord(candidate)) throw new Error("a schema is an object");
      const validate = new Ajv2020({ allErrors: true, strict: false }).compile(candidate);
      return cases.map((entry) => validate(entry.value) === true);
    }

    const pointers = constraintsOf(schema, []);
    const written = verdicts(schema);

    test("control: the schema as written accepts the valid vectors and refuses the invalid ones", () => {
      expect(written).toEqual([
        ...vectors.valid.map(() => true),
        ...vectors.invalid.map(() => false),
      ]);
      // The walk found the constraints: a walk that found none would hold nothing.
      expect(pointers.length).toBeGreaterThan(Object.keys(base).length);
    });

    test("removing any one constraint changes the verdict of a vector", () => {
      const unheld = pointers.filter((pointer) => {
        const mutated = verdicts(without(pointer));
        return mutated.every((verdict, at) => verdict === written[at]);
      });
      expect(unheld.map((pointer) => pointer.join("/"))).toEqual([]);
    });
  });
});
