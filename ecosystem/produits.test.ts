import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseCatalogue, type TreeEntry } from "./briques";
import {
  DOMAIN_CATEGORIES,
  evaluateProduits,
  PRODUITS_ROOT,
  type ProduitsInput,
  type ProduitsOutcome,
  parseCatalogueDomains,
  SCHEMA_FIELDS,
  SCHEMA_VERSION,
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
  entries: TreeEntry[] | null;
  catalogue: Set<string>;
  domaines: Map<string, string[]>;
  repositories: Map<string, { visibility: string }>;
  unstaged: Set<string>;
  listingError: string | null;
}

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
    repositories: new Map([[SELF, { visibility: "public" }]]),
    unstaged: new Set(),
    listingError: null,
  };
}

function judge(state: Reference): ProduitsOutcome {
  const input: ProduitsInput = {
    entries:
      state.entries ?? [...state.files.keys()].map((path): TreeEntry => ({ path, kind: "file" })),
    listingError: state.listingError,
    read: (path) => {
      const text = state.files.get(path);
      return text === undefined ? { ok: false, reason: "ENOENT" } : { ok: true, text };
    },
    catalogue: state.catalogue,
    domaines: state.domaines,
    repositories: state.repositories,
    unstaged: state.unstaged,
    sources: ["docs/adr/0042-x.md", "ecosystem/repositories.v1.yaml"],
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
}

describe("the reference catalogue", () => {
  test("control: it is green, and its counters sum", () => {
    const outcome = judge(reference());
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.compteurs).toEqual({
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

  test("one assertion per source and per fiche: the count is the volume examined", () => {
    // 4 sources + the directory + 3 fiches.
    expect(judge(reference()).report.asserted).toBe(8);
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
    state.entries = [...state.files.keys()].map((path): TreeEntry => ({ path, kind: "file" }));
    state.files.delete("P02.v1.yaml");
    const outcome = judge(state);
    expect(violationOf(outcome, item("P02"))).toContain("unreadable (ENOENT)");
    expectSums(outcome);
  });

  test("source drift: a source changed on disk and not staged", () => {
    const state = reference();
    state.unstaged.add("ecosystem/repositories.v1.yaml");
    expect(violationOf(judge(state), "sources")).toContain(
      "ecosystem/repositories.v1.yaml: its working copy differs from the index",
    );
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
      ...[...state.files.keys()].map((path): TreeEntry => ({ path, kind: "file" })),
      { path: "P04.v1.yaml", kind: "link" },
      { path: "notes.txt", kind: "file" },
      { path: "README.md", kind: "file" },
    ];
    const outcome = judge(state);
    expect(violationOf(outcome, `${PRODUITS_ROOT}/`)).toContain(
      "P04.v1.yaml (link), notes.txt (file)",
    );
    expect(outcome.volume).toContain(
      "6 tracked entry(ies) under ecosystem/produits/ = 3 fiche(s) + 1 README + 2 refused",
    );
  });

  test("a control character in a file name is printed escaped", () => {
    const state = reference();
    state.entries = [
      ...[...state.files.keys()].map((path): TreeEntry => ({ path, kind: "file" })),
      { path: "x\nProduct catalogue verified", kind: "file" },
    ];
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
    expect([...parseCatalogueDomains(adr)]).toEqual([
      ["P01", ["Connaissance"]],
      ["P02", ["Connaissance"]],
      ["P40", ["Poste de travail"]],
    ]);
  });

  test("a product written in two rows gets both domains", () => {
    const adr = "### Le catalogue d'applications\n| A | P01 |\n| B | P01 · P02 |\n| B | P02 |\n";
    expect([...parseCatalogueDomains(adr)]).toEqual([
      ["P01", ["A", "B"]],
      ["P02", ["B"]],
    ]);
  });

  test("no catalogue heading, no domain", () => {
    expect(parseCatalogueDomains("| Connaissance | P01 |\n").size).toBe(0);
  });

  // The table of this module, the enumeration of the schema and the decision
  // record are three writings of the same eight domains: held to one another
  // on the real files, so that a domain added to the ADR turns this red.
  test("table: the category table, the schema and the decision record agree", async () => {
    const directory = join(import.meta.dir, "..", "docs", "adr");
    const names = readdirSync(directory).filter((name) => name.startsWith("0042-"));
    expect(names.length).toBe(1);
    const adr = readFileSync(join(directory, String(names[0])), "utf8");
    const domains = parseCatalogueDomains(adr);

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
  test("its fields are the ones a fiche is written with", () => {
    expect([...SCHEMA_FIELDS]).toEqual(Object.keys(fiche("P01")));
  });
});

describe("the schema vectors", async () => {
  const vectors = (await Bun.file(
    join(import.meta.dir, "fixtures", "produits", "vectors.v1.json"),
  ).json()) as {
    valid: { name: string; value: Fiche }[];
    invalid: {
      name: string;
      set?: { path: string[]; value: unknown };
      unset?: { path: string[] };
      expect: string;
    }[];
  };

  for (const vector of vectors.valid) {
    test(`valid: ${vector.name}`, () => {
      const verdict: unknown = validateFiche(vector.value);
      expect(verdict).toEqual({ data: vector.value });
    });
  }

  for (const vector of vectors.invalid) {
    test(`invalid: ${vector.name}`, () => {
      const value: Fiche = structuredClone(vectors.valid[0]?.value ?? {});
      // Exactly one change per vector: a vector with none would pass on nothing.
      expect([vector.set, vector.unset].filter((change) => change !== undefined).length).toBe(1);
      if (vector.set !== undefined) value[String(vector.set.path[0])] = vector.set.value;
      if (vector.unset !== undefined) delete value[String(vector.unset.path[0])];
      const verdict = validateFiche(value);
      expect("errors" in verdict ? verdict.errors.join("\n") : "").toContain(vector.expect);
    });
  }
});
