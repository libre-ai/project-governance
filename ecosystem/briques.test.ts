import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  type BrickData,
  type BriquesInput,
  evaluateBriques,
  FICHE_SECTIONS,
  findCycle,
  LAYERS,
  type LayerSlug,
  parseCatalogue,
  parseFiche,
  parseInvariants,
  parseRegisterDecisions,
  parseRepositories,
  SCHEMA_VERSION,
  type TreeEntry,
  validateLayerFile,
} from "./briques";

/**
 * The brick map, judged on a map held in memory.
 *
 * Every red case is the green reference with ONE change, so the message it
 * expects is the verdict of that change and of nothing else. The reference
 * holds one brick per layer, which is the smallest map the gate accepts: all
 * eleven layer files are required.
 */

const SELF = "libre-ai/project-governance";
const SHA = "0123456789abcdef0123456789abcdef01234567";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Draft = Mutable<BrickData>;

function brick(id: string, overrides: Partial<Draft> = {}): Draft {
  return {
    id,
    nom: `Brique ${id}`,
    role: "Fait une chose, vérifiable par un tiers.",
    depend_de: [],
    invariants: ["I-08"],
    decisions: ["ADR-0064"],
    depots: [],
    origine: { type: "propre" },
    autonomie: "modify",
    preuve: [],
    ...overrides,
  };
}

const CHARTER = {
  valeur: "Suivre des sources depuis son poste, sans serveur tiers.",
  pour_qui: "Une personne qui veille des sources.",
  degel: "Trois surfaces construites sur le même cœur, sur une release signée.",
  abandon: "Le parseur isolé ne tient pas le seuil mémoire sur un corpus réel.",
  refus: ["Stocker une donnée de paiement."],
};

/** One brick per layer, with dependencies the table of ADR-0064 D1 admits. */
function referenceLayers(): Record<LayerSlug, Draft[]> {
  return {
    gouvernance: [brick("GOV-01", { invariants: [], autonomie: "discover" })],
    fabrique: [
      brick("FAB-01", {
        depend_de: ["GOV-01", "HAR-01", "PRV-01"],
        preuve_produite: "Le verdict des gates sur la tête fusionnée.",
      }),
    ],
    harness: [brick("HAR-01", { depend_de: ["GOV-01", "IDN-01", "EXE-01"] })],
    identite: [brick("IDN-01", { depend_de: ["GOV-01"] })],
    passerelle: [brick("PAS-01", { depend_de: ["IDN-01", "GOV-01"] })],
    execution: [brick("EXE-01", { depend_de: ["PAS-01", "IDN-01"] })],
    preuve: [
      brick("PRV-01", {
        depend_de: ["IDN-01"],
        depots: [SELF],
        preuve: [{ date: "2026-10-10", cible: "docs/security/THREAT-MODEL.md" }],
      }),
    ],
    plateforme: [brick("PLT-01", { depend_de: ["PRV-01", "EXE-01"] })],
    exploitation: [brick("EXP-01", { depend_de: ["PRV-01", "PAS-01"] })],
    publication: [brick("PUB-01", { depend_de: ["PRV-01", "GOV-01"] })],
    produit: [
      brick("PRD-02", {
        depend_de: ["PLT-01", "PAS-01", "EXE-01", "IDN-01"],
        charte: CHARTER,
      }),
    ],
  };
}

function ficheOf(draft: Draft): string {
  const sections = FICHE_SECTIONS.map((title) => `## ${title}\n\nTexte de la section.`);
  return `<!-- SPDX-License-Identifier: CC-BY-4.0 -->\n# ${draft.id} — ${draft.nom}\n\n${sections.join("\n\n")}\n`;
}

interface World {
  readonly layers: Record<LayerSlug, Draft[]>;
  /** Files under the briques root: path to text, or null for an unreadable file. */
  readonly files: Map<string, string | null>;
  readonly extraEntries: TreeEntry[];
  readonly input: Mutable<Omit<BriquesInput, "entries" | "read">>;
}

/** The green reference, as a world a test changes before judging it. */
function reference(): World {
  const layers = referenceLayers();
  const files = new Map<string, string | null>();
  for (const [slug, drafts] of Object.entries(layers)) {
    for (const draft of drafts) files.set(`${slug}/${draft.id}.md`, ficheOf(draft));
  }
  return {
    layers,
    files,
    extraEntries: [],
    input: {
      invariants: new Map([
        ["I-08", "en vigueur"],
        ["I-17", "en vigueur"],
        ["I-35", "retiré"],
      ]),
      adrNumbers: new Set(["0042", "0064"]),
      registerDecisions: new Set(["D01", "D103"]),
      repositories: new Map([
        [SELF, { visibility: "public" }],
        ["libre-ai/schemas-and-contracts", { visibility: "public" }],
        ["libre-ai/product-research", { visibility: "private" }],
      ]),
      catalogue: new Set(["P01", "P02", "P15"]),
      selfRepository: SELF,
      localTargetExists: (path) => path === "docs/security/THREAT-MODEL.md",
      citations: { organization: "libre-ai", scope: ["docs/", "ecosystem/briques/"] },
      latestDate: "2026-11-12",
    },
  };
}

function judge(world: World) {
  const files = new Map(world.files);
  for (const [slug, drafts] of Object.entries(world.layers)) {
    if (!files.has(`${slug}.v1.yaml`)) {
      files.set(
        `${slug}.v1.yaml`,
        JSON.stringify({ schema_version: SCHEMA_VERSION, couche: slug, briques: drafts }),
      );
    }
  }
  const directories = new Set(
    [...files.keys()].filter((path) => path.includes("/")).map((path) => path.split("/")[0]),
  );
  const entries: TreeEntry[] = [
    ...[...files.keys()].map((path) => ({ path, kind: "file" as const })),
    ...[...directories].map((path) => ({ path: path as string, kind: "directory" as const })),
    ...world.extraEntries,
  ];
  return evaluateBriques({
    ...world.input,
    entries,
    read: (path) => files.get(path) ?? null,
  });
}

/** The violations of a world, as one text a test searches. */
function violationsOf(world: World): string {
  return judge(world).report.violations.join("\n");
}

function first(world: World, slug: LayerSlug): Draft {
  return world.layers[slug][0] as Draft;
}

describe("the layer table", () => {
  test("is the table of ADR-0064 D1, read back from the decision record", async () => {
    // The expected value comes from the ADR, not from this code: a layer or a
    // dependency changed on one side only fails here.
    const directory = join(import.meta.dir, "..", "docs", "adr");
    const file = readdirSync(directory).find((name) => name.startsWith("0064-"));
    expect(file).toBeDefined();
    const adr = await Bun.file(join(directory, file as string)).text();
    const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "");
    const rows = adr
      .split("\n")
      .map((line) => /^\s*\| `([^`]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \|\s*$/.exec(line))
      .filter((row): row is RegExpExecArray => row !== null)
      .map((row) => ({
        slug: fold(row[1] as string),
        label: row[1] as string,
        role: (row[2] as string).trim(),
        mayDependOn:
          (row[3] as string).trim() === "aucune"
            ? []
            : (row[3] as string).split(",").map((name) => fold(name.trim())),
        ownRule: (row[4] as string).trim(),
      }));
    expect(rows.length).toBeGreaterThan(0);
    // Compared as plain values: the ADR side is text, the code side is typed slugs.
    const inCode: unknown = LAYERS.map(({ slug, label, role, mayDependOn, ownRule }) => ({
      slug,
      label,
      role,
      mayDependOn: [...mayDependOn],
      ownRule,
    }));
    expect(inCode).toEqual(rows);
  });

  test("gives every layer its own three-letter prefix", () => {
    expect(new Set(LAYERS.map((layer) => layer.prefix)).size).toBe(LAYERS.length);
  });
});

describe("the doctrine parsers", () => {
  test("invariants: a row whose text opens with « Retiré » is withdrawn", () => {
    const parsed = parseInvariants(
      "| ID | Invariant |\n| --- | --- |\n| I-08 | Aucun travail sans preuve |\n| I-35 | **Retiré le 2026-11-09 (D103).** Motif |\n",
    );
    expect([...parsed]).toEqual([
      ["I-08", "en vigueur"],
      ["I-35", "retiré"],
    ]);
  });

  test("register: identifiers as written, two digits or three", () => {
    expect([...parseRegisterDecisions("| D01 | a | b |\n| D103 | c | d |\n| Dx | e |\n")]).toEqual([
      "D01",
      "D103",
    ]);
  });

  test("catalogue: the products of the catalogue table, and of no other section", () => {
    const adr =
      "## Décision\n\n### 1. Le catalogue d'applications\n\n| Domaine | Produits |\n| --- | --- |\n| A | P01 sources · P02 veille |\n| B | P15 projets (voir P020) |\n\nProse citant P33.\n\n### 2. Autre\n\n| x | P40 |\n";
    expect([...parseCatalogue(adr)]).toEqual(["P01", "P02", "P15"]);
  });

  test("catalogue: the decision record of this repository lists its products", async () => {
    const directory = join(import.meta.dir, "..", "docs", "adr");
    const file = readdirSync(directory).find((name) => name.startsWith("0042-"));
    const catalogue = parseCatalogue(await Bun.file(join(directory, file as string)).text());
    // Not a count typed here: the first and the last product the record names.
    expect(catalogue.has("P01")).toBe(true);
    expect(catalogue.has("P40")).toBe(true);
    expect(catalogue.has("P41")).toBe(false);
  });

  test("repositories: name and visibility, an entry without a name is skipped", () => {
    const parsed = parseRepositories({
      repositories: [
        { repository: "libre-ai/a", visibility: "public" },
        { visibility: "private" },
        { repository: "libre-ai/b" },
      ],
    });
    expect([...parsed]).toEqual([
      ["libre-ai/a", { visibility: "public" }],
      ["libre-ai/b", { visibility: "" }],
    ]);
    expect(parseRepositories(null).size).toBe(0);
  });

  test("fiche: one title, then sections; a licence comment is not content", () => {
    const fiche = parseFiche(
      "<!-- SPDX -->\n# GOV-01 — Nom\n\n## Contexte\n\nUn.\n\n## Mesure\n\nDeux.\n",
    );
    expect(fiche.title).toBe("GOV-01 — Nom");
    expect(fiche.sections).toEqual([
      { title: "Contexte", body: "Un." },
      { title: "Mesure", body: "Deux." },
    ]);
  });
});

describe("the schema vectors", async () => {
  const vectors = (await Bun.file(
    join(import.meta.dir, "fixtures", "briques", "vectors.v1.json"),
  ).json()) as {
    valid: { name: string; value: unknown }[];
    invalid: {
      name: string;
      set: { path: (string | number)[]; value: unknown };
      expect: string;
    }[];
  };

  for (const vector of vectors.valid) {
    test(`valid: ${vector.name}`, () => {
      expect(validateLayerFile(vector.value)).toEqual([]);
    });
  }

  for (const vector of vectors.invalid) {
    test(`invalid: ${vector.name}`, () => {
      const value = structuredClone((vectors.valid[0] as { value: unknown }).value);
      let cursor = value as Record<string | number, unknown>;
      for (const key of vector.set.path.slice(0, -1)) {
        cursor = cursor[key] as Record<string | number, unknown>;
      }
      cursor[vector.set.path.at(-1) as string | number] = vector.set.value;
      const errors = validateLayerFile(value);
      expect(errors.join("\n")).toContain(vector.expect);
    });
  }
});

describe("the reference map", () => {
  test("is green, and its counters sum to what was read", () => {
    const outcome = judge(reference());
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.map).not.toBeNull();
    const counters = outcome.map?.compteurs;
    expect(counters?.briques).toBe(LAYERS.length);
    expect(Object.values(counters?.par_couche ?? {}).reduce((sum, n) => sum + n, 0)).toBe(
      counters?.briques ?? -1,
    );
    expect(Object.values(counters?.par_statut ?? {}).reduce((sum, n) => sum + n, 0)).toBe(
      counters?.briques ?? -1,
    );
    // 11 layer files + 11 layer directories + 11 fiches, nothing refused.
    expect(outcome.volume).toContain(
      "33 entry(ies) under ecosystem/briques/ = 11 layer file(s) + 11 layer directory(ies) + 11 fiche(s) + 0 README + 0 refused",
    );
    expect(outcome.volume).toContain("3 in the catalogue of ADR-0042 §1 = 1 as bricks + 2 outside");
  });

  test("derives the status from the proofs: one proof held, the rest described", () => {
    const counters = judge(reference()).map?.compteurs;
    expect(counters?.par_statut).toEqual({ decrite: 10, en_cours: 1, prototypee: 0, retiree: 0 });
    expect(counters?.preuves_locales).toBe(1);
  });

  test("a withdrawn brick is retiree, whatever its proofs", () => {
    const world = reference();
    first(world, "preuve").retrait = { decision: "D103", date: "2026-11-09" };
    const outcome = judge(world);
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.map?.compteurs.par_statut.retiree).toBe(1);
    expect(outcome.map?.compteurs.par_statut.en_cours).toBe(0);
  });

  test("a README at the root of the map is counted, not refused", () => {
    const world = reference();
    world.files.set("README.md", "# Carte des briques\n");
    const outcome = judge(world);
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.volume).toContain("+ 1 README + 0 refused");
  });
});

describe("the three probes ADR-0064 names", () => {
  test("a produit brick declared as the dependency of a harness brick is red", () => {
    const world = reference();
    first(world, "harness").depend_de = ["GOV-01", "PRD-02"];
    const violations = violationsOf(world);
    expect(violations).toContain("HAR-01: depends on PRD-02: ADR-0064 D1");
    expect(violations).toContain("PRD-02: ADR-0064 D1 — a produit brick is the dependency");
  });

  test("a typed status is red, under the name of its rule", () => {
    const world = reference();
    (first(world, "preuve") as Draft & { statut?: string }).statut = "prototypee";
    expect(violationsOf(world)).toContain("ADR-0064 D4 — the status is derived");
  });

  test("a proof whose target does not exist is red", () => {
    const world = reference();
    first(world, "preuve").preuve = [{ date: "2026-10-10", cible: "docs/security/ABSENT.md" }];
    expect(violationsOf(world)).toContain(
      "PRV-01: proof target docs/security/ABSENT.md does not exist",
    );
  });

  test("a red map gives no page model", () => {
    const world = reference();
    first(world, "preuve").preuve = [{ date: "2026-10-10", cible: "docs/security/ABSENT.md" }];
    expect(judge(world).map).toBeNull();
  });
});

describe("sources", () => {
  test("a missing layer file is a failure, not zero bricks", () => {
    const world = reference();
    world.files.set("identite.v1.yaml", null);
    world.layers.identite = [];
    const files = world.files;
    files.delete("identite/IDN-01.md");
    const outcome = evaluateBriques({
      ...world.input,
      entries: [...files.keys()]
        .filter((path) => path !== "identite.v1.yaml")
        .map((path) => ({ path, kind: "file" as const })),
      read: (path) => files.get(path) ?? null,
    });
    expect(outcome.report.violations.join("\n")).toContain(
      "ecosystem/briques/identite.v1.yaml: layer file missing",
    );
  });

  test("an unreadable layer file is a failure", () => {
    const world = reference();
    world.files.set("identite.v1.yaml", null);
    expect(violationsOf(world)).toContain("ecosystem/briques/identite.v1.yaml: unreadable");
  });

  test("a layer file that names another layer is a failure", () => {
    const world = reference();
    world.files.set(
      "identite.v1.yaml",
      JSON.stringify({
        schema_version: SCHEMA_VERSION,
        couche: "preuve",
        briques: world.layers.identite,
      }),
    );
    expect(violationsOf(world)).toContain(
      "the file declares « preuve », its name says « identite »",
    );
  });

  test.each([
    ["invariants", "docs/decisions/INVARIANTS.md"],
    ["registerDecisions", "docs/decisions/DECISION-REGISTER.md"],
    ["adrNumbers", "docs/adr/"],
    ["repositories", "ecosystem/repositories.v1.yaml"],
    ["catalogue", "catalogue of ADR-0042 §1"],
  ] as const)("an empty %s source is a failure by name", (field, item) => {
    const world = reference();
    (world.input[field] as unknown as { clear(): void }).clear();
    expect(violationsOf(world)).toContain(`${item}: 0 `);
  });

  test("a citations scope that does not list the map is a failure", () => {
    const world = reference();
    world.input.citations = { organization: "libre-ai", scope: ["docs/"] };
    expect(violationsOf(world)).toContain(
      "tools/quality/pinned-citations.v1.json: its scope does not list ecosystem/briques/",
    );
  });

  test.each([
    [{ path: "preuve/PRV-09.md", kind: "link" as const }, "preuve/PRV-09.md (link)"],
    [{ path: "notes.txt", kind: "file" as const }, "notes.txt (file)"],
    [{ path: "securite", kind: "directory" as const }, "securite (directory)"],
    [{ path: "preuve/prv-01.md", kind: "file" as const }, "preuve/prv-01.md (file)"],
  ])("an entry that is no part of the map is refused: %o", (entry, named) => {
    const world = reference();
    world.extraEntries.push(entry);
    expect(violationsOf(world)).toContain(named);
  });
});

describe("dependencies", () => {
  test("a dependency no layer file declares", () => {
    const world = reference();
    first(world, "identite").depend_de = ["GOV-09"];
    expect(violationsOf(world)).toContain(
      "IDN-01: depends on GOV-09, which no layer file declares",
    );
  });

  test("a dependency the layer table does not admit", () => {
    const world = reference();
    first(world, "identite").depend_de = ["PRV-01"];
    expect(violationsOf(world)).toContain(
      "IDN-01: depends on PRV-01 (preuve): ADR-0064 D1, layer identite may depend on gouvernance",
    );
  });

  test("the gouvernance layer depends on no other layer", () => {
    const world = reference();
    first(world, "gouvernance").depend_de = ["IDN-01"];
    expect(violationsOf(world)).toContain("layer gouvernance may depend on no other layer");
  });

  test("a brick may depend on a brick of its own layer", () => {
    const world = reference();
    world.layers.gouvernance.push(
      brick("GOV-02", { invariants: [], autonomie: "discover", depend_de: ["GOV-01"] }),
    );
    world.files.set("gouvernance/GOV-02.md", ficheOf(world.layers.gouvernance[1] as Draft));
    expect(judge(world).report.violations).toEqual([]);
  });

  test("a brick does not depend on itself, and a cycle is named", () => {
    const world = reference();
    first(world, "gouvernance").depend_de = ["GOV-01"];
    expect(violationsOf(world)).toContain("GOV-01: depends on itself");

    const cyclic = reference();
    cyclic.layers.gouvernance.push(
      brick("GOV-02", { invariants: [], autonomie: "discover", depend_de: ["GOV-01"] }),
    );
    cyclic.files.set("gouvernance/GOV-02.md", ficheOf(cyclic.layers.gouvernance[1] as Draft));
    first(cyclic, "gouvernance").depend_de = ["GOV-02"];
    expect(violationsOf(cyclic)).toContain("GOV-01: dependency cycle: GOV-01 → GOV-02 → GOV-01");
  });

  test("findCycle reports a cycle only for the bricks that are on it", () => {
    const graph = new Map([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["B"]],
    ]);
    expect(findCycle("A", graph)).toBeNull();
    expect(findCycle("B", graph)).toEqual(["B", "C", "B"]);
  });

  test("an identifier declared in two layers, or with the prefix of another layer", () => {
    const world = reference();
    first(world, "identite").id = "GOV-01";
    world.files.set("identite/GOV-01.md", ficheOf(first(world, "identite")));
    world.files.delete("identite/IDN-01.md");
    const violations = violationsOf(world);
    expect(violations).toContain("id prefix is not IDN, the prefix of layer identite");
    expect(violations).toContain("id declared 2 times (gouvernance, identite)");
  });
});

describe("doctrine citations", () => {
  test("a brick bound by no invariant is counted and named, not refused", () => {
    // Refused, it was satisfied by a filler: the gap is the information.
    const world = reference();
    first(world, "identite").invariants = [];
    const outcome = judge(world);
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.map?.compteurs.sans_invariant).toEqual(["IDN-01"]);
    expect(outcome.volume).toContain(
      "1 brick(s) outside the gouvernance layer bound by no invariant (IDN-01)",
    );
    // The gouvernance brick of the reference cites none either, and is not counted.
    expect(judge(reference()).map?.compteurs.sans_invariant).toEqual([]);
  });

  test("a proof target cited by two bricks is counted once as shared", () => {
    const world = reference();
    first(world, "publication").depots = [SELF];
    first(world, "publication").preuve = [
      { date: "2026-10-10", cible: "docs/security/THREAT-MODEL.md" },
    ];
    const outcome = judge(world);
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.map?.compteurs.cibles_partagees).toBe(1);
    expect(judge(reference()).map?.compteurs.cibles_partagees).toBe(0);
  });

  test("an invariant the register does not list, and a withdrawn one", () => {
    const world = reference();
    first(world, "identite").invariants = ["I-99", "I-35"];
    const violations = violationsOf(world);
    expect(violations).toContain("cites I-99, which INVARIANTS.md does not list");
    expect(violations).toContain("cites I-35, which is withdrawn");
  });

  test("an ADR or a register row that does not exist", () => {
    const world = reference();
    first(world, "identite").decisions = ["ADR-0999", "D999"];
    const violations = violationsOf(world);
    expect(violations).toContain("cites ADR-0999, which docs/adr/ does not hold");
    expect(violations).toContain("cites D999, which the decision register does not hold");
  });

  test("a carrier repository outside the inventory", () => {
    const world = reference();
    first(world, "identite").depots = ["libre-ai/absent"];
    expect(violationsOf(world)).toContain(
      "carrier libre-ai/absent is not in ecosystem/repositories",
    );
  });
});

describe("layer-conditional rules", () => {
  test("a fabrique brick declares the proof it produces, and only a fabrique brick", () => {
    const world = reference();
    delete first(world, "fabrique").preuve_produite;
    expect(violationsOf(world)).toContain("FAB-01: ADR-0064 D1 — a fabrique brick declares");

    const elsewhere = reference();
    first(elsewhere, "identite").preuve_produite = "Une preuve qui n'a pas sa place ici.";
    expect(violationsOf(elsewhere)).toContain("preuve_produite belongs to the fabrique layer only");
  });

  test("a produit brick carries a charter, and only a produit brick", () => {
    const world = reference();
    delete first(world, "produit").charte;
    expect(violationsOf(world)).toContain("PRD-02: a produit brick carries a charte");

    const elsewhere = reference();
    first(elsewhere, "identite").charte = CHARTER;
    expect(violationsOf(elsewhere)).toContain("charte belongs to the produit layer only");
  });

  test("a charter names a fact, not a delay — and « toujours » is not « jours »", () => {
    const world = reference();
    first(world, "produit").charte = { ...CHARTER, degel: "Une release signée dans six mois." };
    expect(violationsOf(world)).toContain("charte.degel names a delay (« mois »)");

    const fine = reference();
    first(fine, "produit").charte = {
      ...CHARTER,
      abandon: "Le parseur ne tient toujours pas le seuil sur un corpus réel.",
    };
    expect(judge(fine).report.violations).toEqual([]);
  });

  test("a product outside the catalogue of ADR-0042", () => {
    const world = reference();
    first(world, "produit").id = "PRD-41";
    world.files.set("produit/PRD-41.md", ficheOf(first(world, "produit")));
    world.files.delete("produit/PRD-02.md");
    expect(violationsOf(world)).toContain("PRD-41: P41 is not in the catalogue of ADR-0042 §1");
  });

  test("the gouvernance layer is the human-touch surface: an agent proposes there", () => {
    const world = reference();
    first(world, "gouvernance").autonomie = "modify";
    expect(violationsOf(world)).toContain("GOV-01: autonomie modify: I-17");
  });

  test("a withdrawal cites a decision of the register", () => {
    const world = reference();
    first(world, "identite").retrait = { decision: "D999", date: "2026-11-09" };
    expect(violationsOf(world)).toContain("retrait cites D999");
  });
});

describe("proofs", () => {
  test("a local proof needs this repository among the carriers", () => {
    const world = reference();
    first(world, "preuve").depots = [];
    expect(violationsOf(world)).toContain("which is not a carrier (depots) of the brick");
  });

  test("a local proof cannot be judged when this repository has no derivable name", () => {
    const world = reference();
    world.input.selfRepository = null;
    expect(violationsOf(world)).toContain("the name of this repository could not be derived");
  });

  test("a proof dated in the future is a claim", () => {
    const world = reference();
    first(world, "preuve").preuve = [
      { date: "2026-12-01", cible: "docs/security/THREAT-MODEL.md" },
    ];
    expect(violationsOf(world)).toContain("proof dated 2026-12-01 is in the future");
  });

  test("a path that climbs out of the tree is refused before the tree is asked", () => {
    const world = reference();
    world.input.localTargetExists = () => true;
    first(world, "preuve").preuve = [{ date: "2026-10-10", cible: "../outside.md" }];
    expect(violationsOf(world)).toContain("climbs out of the tree");
  });

  test("a pinned proof of a public carrier is held, and left to the citations gate", () => {
    const world = reference();
    first(world, "identite").depots = ["libre-ai/schemas-and-contracts"];
    first(world, "identite").preuve = [
      {
        date: "2026-10-24",
        cible: `libre-ai/schemas-and-contracts@${SHA}:contracts/catalog.v1.json`,
      },
    ];
    const outcome = judge(world);
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.map?.compteurs.preuves_epinglees).toBe(1);
    expect(outcome.map?.compteurs.par_statut.en_cours).toBe(2);
  });

  test.each([
    [
      "a private repository",
      "libre-ai/product-research",
      `libre-ai/product-research@${SHA}:README.md`,
      "is private, and only a public repository can be cited (I-15)",
    ],
    [
      "a repository that is not a carrier",
      "libre-ai/product-research",
      `libre-ai/schemas-and-contracts@${SHA}:README.md`,
      "libre-ai/schemas-and-contracts is not a carrier",
    ],
    [
      "a short sha",
      "libre-ai/schemas-and-contracts",
      "libre-ai/schemas-and-contracts@0123456:README.md",
      "the commit must be a full 40-hex sha",
    ],
    [
      "another owner",
      "libre-ai/schemas-and-contracts",
      `someone/schemas-and-contracts@${SHA}:README.md`,
      "owner « someone » is not the organisation",
    ],
    [
      "this repository, pinned instead of read on the tree",
      SELF,
      `${SELF}@${SHA}:README.md`,
      "names this repository: write the path alone",
    ],
    [
      "a pinned path with a line suffix",
      "libre-ai/schemas-and-contracts",
      `libre-ai/schemas-and-contracts@${SHA}:README.md:12`,
      "the path carries a colon",
    ],
  ])("a pinned proof of %s is refused", (_name, carrier, cible, expected) => {
    const world = reference();
    first(world, "identite").depots = [carrier];
    first(world, "identite").preuve = [{ date: "2026-10-24", cible }];
    expect(violationsOf(world)).toContain(expected);
  });
});

describe("fiches", () => {
  test("a brick without its fiche, and a fiche without its brick", () => {
    const world = reference();
    world.files.delete("identite/IDN-01.md");
    expect(violationsOf(world)).toContain("fiche ecosystem/briques/identite/IDN-01.md is missing");

    const orphan = reference();
    orphan.files.set("identite/IDN-09.md", "# IDN-09 — Orpheline\n");
    expect(violationsOf(orphan)).toContain(
      "fiche(s) no layer file declares (ADR-0064 D3): identite/IDN-09.md",
    );
  });

  test("a fiche titled otherwise than its brick", () => {
    const world = reference();
    first(world, "identite").nom = "Un autre nom";
    expect(violationsOf(world)).toContain(
      "fiche title is « IDN-01 — Brique IDN-01 », the YAML says « IDN-01 — Un autre nom »",
    );
  });

  test("a fiche missing a section, or holding an empty one", () => {
    const world = reference();
    world.files.set("identite/IDN-01.md", "# IDN-01 — Brique IDN-01\n\n## Contexte\n\nTexte.\n");
    expect(violationsOf(world)).toContain("fiche sections are « Contexte », expected");

    const empty = reference();
    empty.files.set(
      "identite/IDN-01.md",
      `# IDN-01 — Brique IDN-01\n\n${FICHE_SECTIONS.map((title) => `## ${title}\n`).join("\n")}`,
    );
    expect(violationsOf(empty)).toContain("fiche section(s) empty: Contexte");
  });

  test("a fiche that writes a status is refused: the status is derived", () => {
    const world = reference();
    world.files.set(
      "identite/IDN-01.md",
      ficheOf(first(world, "identite")).replace(
        "Texte de la section.",
        "Statut : `en_cours` depuis la dernière release.",
      ),
    );
    expect(violationsOf(world)).toContain("IDN-01: fiche states a status (« en_cours »)");
  });

  test("an unreadable fiche is a failure", () => {
    const world = reference();
    world.files.set("identite/IDN-01.md", null);
    expect(violationsOf(world)).toContain(
      "fiche ecosystem/briques/identite/IDN-01.md is unreadable",
    );
  });
});
