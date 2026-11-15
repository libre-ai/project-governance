import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { CONTROL_CHARACTERS, type LocalTarget, parseCatalogue } from "./briques";
import {
  type CatalogueEntry,
  DOMAIN_CATEGORIES,
  evaluateProduits,
  PRODUITS_ROOT,
  type ProduitsInput,
  type ProduitsOutcome,
  parseCatalogueTable,
  SCHEMA_FIELDS,
  SCHEMA_VERSION,
  type SourceFile,
  validateFiche,
} from "./produits";

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
  catalogue: Set<string>;
  domaines: Map<string, string[]>;
  catalogueUnread: string[];
  repositories: Map<string, { visibility: string }>;
  unstaged: Set<string>;
  sources: SourceFile[];
  listingError: string | null;
}

/** The three files the gate declares as its sources. */
const SOURCE_PATHS = [
  "docs/adr/0042-x.md",
  "ecosystem/repositories.v1.yaml",
  "ecosystem/schemas/produit.v1.schema.json",
] as const;

/** Three products over two domains, every fiche valid, one carrier in the inventory. */
function reference(): Reference {
  return {
    files: new Map(["P01", "P02", "P03"].map((id) => [`${id}.v1.yaml`, JSON.stringify(fiche(id))])),
    entries: null,
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
      champs_a_relire: 3,
      fiches_a_relire: 3,
    });
    expectSums(outcome);
    expect(outcome.volume).toContain(
      "3 product(s) in the catalogue of ADR-0042 §1 = 3 with a fiche + 0 missing",
    );
    expect(outcome.volume).toContain("3 fiche(s) read = 3 valid + 0 in violation");
    expect(outcome.volume).toContain("carrier: 0 with a depot + 3 without + 0 not decidable");
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
    // A sentence of the section that cites products of the table is prose.
    expect(table.unread).toEqual([]);
  });

  test("a product written in two rows gets both domains", () => {
    const adr = "### Le catalogue d'applications\n| A | P01 |\n| B | P01 · P02 |\n| B | P02 |\n";
    expect([...parseCatalogueTable(adr).domains]).toEqual([
      ["P01", ["A", "B"]],
      ["P02", ["B"]],
    ]);
  });

  test("no catalogue heading, no domain", () => {
    const table = parseCatalogueTable("| Connaissance | P01 |\n  | Connaissance | P02 |\n");
    expect(table.domains.size).toBe(0);
    // Outside the section nothing is a catalogue line, read or not.
    expect(table.unread).toEqual([]);
  });

  describe("unread: a line of the section that carries a product and is not a row", () => {
    const SECTION = "### 1. Le catalogue d'applications\n\n| Connaissance | P01 un · P02 deux |\n";
    const unreadOf = (line: string): string[] =>
      parseCatalogueTable(`${SECTION}${line}\n\n### 2. Autre\n\n  | Hors section | P77 |\n`).unread;

    test.each([
      ["an indented row", "  | Collaboration | P03 trois |"],
      ["a row indented by a tabulation", "\t| Collaboration | P03 trois |"],
      ["a row without its leading bar", "Collaboration | P03 trois |"],
      // The product is in the table: the row would give it a second domain.
      ["an indented row of a product the table lists", "  | Collaboration | P01 un |"],
      ["a list item naming a product no row lists", "- P03 trois"],
      ["a sentence naming a product no row lists", "P03 rejoint le catalogue."],
    ])("%s is returned, with its line number", (_name, line) => {
      expect(unreadOf(line)).toEqual([`line 4 « ${line.trim()} »`]);
      // The domains are those of the rows read: the line gave none.
      expect([...parseCatalogueTable(`${SECTION}${line}\n`).domains]).toEqual([
        ["P01", ["Connaissance"]],
        ["P02", ["Connaissance"]],
      ]);
    });

    test.each([
      ["a sentence citing products of the table", "P01 et P02 sortent du gel."],
      ["a list item citing a product of the table", "- Une capacité de **P02**."],
      ["a line without a product", "Collaboration | rien |"],
      ["an identifier of another form", "  | Collaboration | XP03 · P3 · P033 |"],
    ])("%s is not a catalogue line", (_name, line) => {
      expect(unreadOf(line)).toEqual([]);
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
    expect([...SCHEMA_FIELDS].sort()).toEqual(Object.keys(fiche("P01")).sort());
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
  const full = fiche("P01", { nom_public: "Nom public", depot: SELF, depend_de: ["P02"] });

  const inMiddle = (text: string, character: string): string => {
    const half = Math.floor(text.length / 2);
    return `${text.slice(0, half)}${character}${text.slice(half)}`;
  };

  /** `full` with the character written in the middle of one field (of its first item, for a list). */
  function carrying(field: string, character: string): Fiche {
    const value = full[field];
    if (typeof value === "string") return { ...full, [field]: inMiddle(value, character) };
    if (Array.isArray(value) && typeof value[0] === "string") {
      return { ...full, [field]: [inMiddle(value[0], character), ...value.slice(1)] };
    }
    throw new Error(`${field} carries no string in the reference fiche`);
  }

  test("control: the class walked is the one the gates escape, and the reference fiche holds", () => {
    expect(controls).toContain("\u001b");
    expect(controls).toContain("\u0085");
    expect(controls).toContain(LINE_SEPARATOR);
    expect(controls).not.toContain(NO_BREAK_SPACE);
    const verdict: unknown = validateFiche(full);
    expect(verdict).toEqual({ data: full });
  });

  test.each(Object.keys(full))("no control character is admitted in %s", (field) => {
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
    "pour_qui",
    "a_la_place_de",
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
      const text = blank.repeat(12);
      const value = { ...full, [field]: Array.isArray(full[field]) ? [text] : text };
      expect(["errors" in validateFiche(value), JSON.stringify(blank)]).toEqual([
        true,
        JSON.stringify(blank),
      ]);
    }
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
    expect([...TEXT_FIELDS, ...closed].sort()).toEqual([...SCHEMA_FIELDS].sort());
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
