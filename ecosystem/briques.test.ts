import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { exemptionKey } from "../tools/quality/check-pinned-citations";
import {
  type BrickData,
  type BriquesInput,
  CONTROL_CHARACTERS,
  type EntryKind,
  evaluateBriques,
  FICHE_SECTIONS,
  findCycles,
  LAYERS,
  type LayerSlug,
  type LocalTarget,
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
const PROOF = "docs/security/THREAT-MODEL.md";

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
        preuve: [{ date: "2026-10-10", cible: PROOF }],
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

/** A fiche that names everything its brick cites, as the gate requires. */
function ficheOf(draft: Draft): string {
  const cited = [...draft.depend_de, ...draft.invariants, ...draft.decisions].join(", ");
  const sections = FICHE_SECTIONS.map((title) => `## ${title}\n\nTexte de la section.`);
  return `<!-- SPDX-License-Identifier: CC-BY-4.0 -->\n# ${draft.id} — ${draft.nom}\n\n${sections.join("\n\n")}\n\nCite : ${cited}.\n`;
}

interface World {
  readonly layers: Record<LayerSlug, Draft[]>;
  /** Tracked files under the briques root: path to text, or null for an unreadable file. */
  readonly files: Map<string, string | null>;
  /** Fiches a test wrote itself: `judge` does not regenerate them. */
  readonly pinnedFiches: Set<string>;
  readonly kinds: Map<string, EntryKind>;
  readonly extraEntries: TreeEntry[];
  readonly input: Mutable<Omit<BriquesInput, "entries" | "read">>;
}

/** The green reference, as a world a test changes before judging it. */
function reference(): World {
  return {
    layers: referenceLayers(),
    files: new Map(),
    pinnedFiches: new Set(),
    kinds: new Map(),
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
      localTarget: (path): LocalTarget => (path === PROOF ? "regular" : "absent"),
      unstaged: new Set(),
      doctrineSources: [
        "docs/decisions/INVARIANTS.md",
        "docs/decisions/DECISION-REGISTER.md",
        "ecosystem/repositories.v1.yaml",
      ],
      citations: {
        organization: "libre-ai",
        scope: ["docs/", "ecosystem/briques/"],
        exemptions: new Set(),
      },
      latestDate: "2026-11-12",
    },
  };
}

/** Write a fiche by hand: it is kept as written. `null` makes it unreadable. */
function setFiche(world: World, path: string, text: string | null): void {
  world.files.set(path, text);
  world.pinnedFiches.add(path);
}

function judge(world: World) {
  const files = new Map(world.files);
  for (const [slug, drafts] of Object.entries(world.layers)) {
    if (!files.has(`${slug}.v1.yaml`)) {
      // Indented, so that each citation is a token of its own, as in the YAML
      // of the repository: the citations reader splits on whitespace.
      files.set(
        `${slug}.v1.yaml`,
        JSON.stringify({ schema_version: SCHEMA_VERSION, couche: slug, briques: drafts }, null, 2),
      );
    }
    // A fiche follows its brick unless the test wrote it or removed it.
    for (const draft of drafts) {
      const path = `${slug}/${draft.id}.md`;
      if (!world.pinnedFiches.has(path)) files.set(path, ficheOf(draft));
    }
  }
  const entries: TreeEntry[] = [
    ...[...files.keys()].map((path) => ({ path, kind: world.kinds.get(path) ?? "file" })),
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

  test("declares as verified the three rules this gate checks, and no other", () => {
    expect(LAYERS.filter((layer) => layer.ownRuleVerified).map((layer) => layer.slug)).toEqual([
      "gouvernance",
      "fabrique",
      "produit",
    ]);
    expect(judge(reference()).volume).toContain(
      "layer rules: 3 verified (gouvernance, fabrique, produit; for gouvernance, its dependency half), 8 declarative",
    );
  });
});

describe("the doctrine parsers", () => {
  test("invariants: a row whose text opens with « Retiré » is withdrawn, whatever its emphasis", () => {
    const parsed = parseInvariants(
      [
        "| ID | Invariant |",
        "| --- | --- |",
        "| I-08 | Aucun travail sans preuve |",
        "| I-35 | **Retiré le 2026-11-09 (D103).** Motif |",
        "| I-36 | _Retiré_ le 2026-11-10 |",
        "| I-37 | ~~Ancien texte~~ RETIRÉ |",
        "| I-38 | Un invariant retiré ailleurs ne retire pas celui-ci |",
        "| I-100 | Trois chiffres |",
      ].join("\n"),
    );
    expect([...parsed]).toEqual([
      ["I-08", "en vigueur"],
      ["I-35", "retiré"],
      ["I-36", "retiré"],
      ["I-37", "en vigueur"],
      ["I-38", "en vigueur"],
      ["I-100", "en vigueur"],
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
      "## Décision\n\n### 1. Le catalogue d'applications\n\n| Domaine | Produits |\n| --- | --- |\n| A | P01 sources · P02 veille |\n| B | P15 projets (voir P020 et P06bis) |\n\nProse citant P33.\n\n### 2. Hors catalogue d'applications\n\n| x | P40 |\n";
    expect([...parseCatalogue(adr)]).toEqual(["P01", "P02", "P15"]);
    expect([...parseCatalogue("## Le catalogue d'applications\n\n| a | P07 |\n")]).toEqual(["P07"]);
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

  test("fiche: titles, preamble and sections; a licence comment is not content", () => {
    const fiche = parseFiche(
      "<!-- SPDX -->\n# GOV-01 — Nom\n\nAvant.\n\n## Contexte ##\n\nUn.\n\n## Mesure\n\nDeux.\n",
    );
    expect(fiche.titles).toEqual(["GOV-01 — Nom"]);
    expect(fiche.preamble).toBe("Avant.");
    expect(fiche.sections).toEqual([
      { title: "Contexte", body: "Un." },
      { title: "Mesure", body: "Deux." },
    ]);
  });

  test("fiche: a heading inside a fenced code block is not a heading", () => {
    const fiche = parseFiche(
      "# A\n\n## Contexte\n\n```bash\n## un commentaire\n# autre\n```\n\n## Mesure\n\nx\n",
    );
    expect(fiche.titles).toEqual(["A"]);
    expect(fiche.sections.map((section) => section.title)).toEqual(["Contexte", "Mesure"]);
  });

  test("fiche: an unterminated comment is text, and a long one costs linear time", () => {
    expect(parseFiche("# A\n\n## Contexte\n\n<!-- jamais fermé\n").sections[0]?.body).toBe(
      "<!-- jamais fermé",
    );
    const started = performance.now();
    parseFiche(`# A\n\n## Contexte\n\n${"<!--".repeat(200_000)}\n`);
    expect(performance.now() - started).toBeLessThan(2_000);
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
    expect(outcome.volume).toContain(
      "22 tracked entry(ies) under ecosystem/briques/ = 11 layer file(s) + 11 fiche(s) + 0 README + 0 refused",
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
    first(world, "publication").retrait = { decision: "D103", date: "2026-11-09" };
    first(world, "publication").depots = [SELF];
    first(world, "publication").preuve = [{ date: "2026-10-10", cible: PROOF }];
    const outcome = judge(world);
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.map?.compteurs.par_statut).toEqual({
      decrite: 9,
      en_cours: 1,
      prototypee: 0,
      retiree: 1,
    });
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
      "PRV-01: proof target docs/security/ABSENT.md is not a tracked file of this repository",
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
    world.layers.identite = [];
    world.files.set("identite.v1.yaml", null);
    const outcome = judge(world);
    // Removed from the index, not merely unreadable.
    const entries = [...LAYERS.map((layer) => layer.slug)]
      .filter((slug) => slug !== "identite")
      .map((slug) => ({ path: `${slug}.v1.yaml`, kind: "file" as const }));
    const removed = evaluateBriques({
      ...world.input,
      entries,
      read: (path) =>
        JSON.stringify({
          schema_version: SCHEMA_VERSION,
          couche: path.replace(".v1.yaml", ""),
          briques: world.layers[path.replace(".v1.yaml", "") as LayerSlug],
        }),
    });
    expect(removed.report.violations.join("\n")).toContain(
      "ecosystem/briques/identite.v1.yaml: layer file missing",
    );
    expect(outcome.report.violations.join("\n")).toContain(
      "ecosystem/briques/identite.v1.yaml: unreadable",
    );
  });

  test("a layer file that is not valid YAML is a failure", () => {
    const world = reference();
    world.files.set("identite.v1.yaml", "briques: [\n  - id: IDN-01\n");
    expect(violationsOf(world)).toContain("ecosystem/briques/identite.v1.yaml: invalid YAML");
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
    ["identite.v1.yaml", "link" as const, "identite.v1.yaml (link)"],
    ["identite.v1.yaml", "other" as const, "identite.v1.yaml (other)"],
    ["identite/IDN-01.md", "link" as const, "identite/IDN-01.md (link)"],
    ["README.md", "link" as const, "README.md (link)"],
  ])("%s tracked as a %s is refused, not read", (path, kind, named) => {
    const world = reference();
    if (path === "README.md") world.files.set(path, "# Carte\n");
    world.kinds.set(path, kind);
    expect(violationsOf(world)).toContain(named);
  });

  test("the root of the map tracked as a symbolic link is refused", () => {
    const world = reference();
    world.extraEntries.push({ path: ".", kind: "link" });
    expect(violationsOf(world)).toContain(". (link)");
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
    world.input.citations = { ...world.input.citations, scope: ["docs/"] };
    expect(violationsOf(world)).toContain(
      "tools/quality/pinned-citations.v1.json: its scope does not list ecosystem/briques/",
    );
  });

  test.each([
    [{ path: "notes.txt", kind: "file" as const }, "notes.txt (file)"],
    [{ path: "securite/SEC-01.md", kind: "file" as const }, "securite/SEC-01.md (file)"],
    [{ path: "preuve/prv-01.md", kind: "file" as const }, "preuve/prv-01.md (file)"],
    [{ path: "preuve/notes/PRV-01.md", kind: "file" as const }, "preuve/notes/PRV-01.md (file)"],
  ])("a tracked entry that is no part of the map is refused: %o", (entry, named) => {
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
    expect(judge(world).report.violations).toEqual([]);
  });

  test("a brick does not depend on a withdrawn brick", () => {
    const world = reference();
    first(world, "identite").retrait = { decision: "D103", date: "2026-11-09" };
    expect(violationsOf(world)).toContain("PAS-01: depends on IDN-01, which is withdrawn");
  });

  test("a brick does not depend on itself, and a cycle is named from each brick on it", () => {
    const world = reference();
    first(world, "gouvernance").depend_de = ["GOV-01"];
    const self = violationsOf(world);
    expect(self).toContain("GOV-01: depends on itself");
    expect(self).not.toContain("dependency cycle");

    const cyclic = reference();
    cyclic.layers.gouvernance.push(
      brick("GOV-02", { invariants: [], autonomie: "discover", depend_de: ["GOV-01"] }),
    );
    first(cyclic, "gouvernance").depend_de = ["GOV-02"];
    const violations = violationsOf(cyclic);
    expect(violations).toContain("GOV-01: dependency cycle: GOV-01 → GOV-02 → GOV-01");
    expect(violations).toContain("GOV-02: dependency cycle: GOV-02 → GOV-01 → GOV-02");
  });

  test("findCycles names only the bricks that are on a cycle, in linear time", () => {
    const graph = new Map([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["B"]],
      ["D", []],
    ]);
    const cycles = findCycles(graph);
    expect([...cycles.keys()].sort()).toEqual(["B", "C"]);
    expect(cycles.get("B")).toEqual(["B", "C", "B"]);

    // A dense acyclic layer: every brick depends on every later one. The first
    // version walked every path, which doubles with each brick.
    const dense = new Map<string, string[]>();
    for (let i = 0; i < 60; i += 1) {
      dense.set(
        `N${i}`,
        Array.from({ length: 59 - i }, (_, k) => `N${i + 1 + k}`),
      );
    }
    const started = performance.now();
    expect(findCycles(dense).size).toBe(0);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("an identifier declared in two layers, or with the prefix of another layer", () => {
    const world = reference();
    first(world, "identite").id = "GOV-01";
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
    first(world, "publication").preuve = [{ date: "2026-10-10", cible: PROOF }];
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

  test("what the YAML cites, the fiche names — a dependency, an invariant, a decision", () => {
    const world = reference();
    const draft = first(world, "identite");
    draft.invariants = ["I-08", "I-17"];
    draft.decisions = ["ADR-0064", "D103", "D01"];
    // The fiche names D103 but neither D01 nor I-17, and « D10 » is not « D103 ».
    setFiche(
      world,
      "identite/IDN-01.md",
      ficheOf({ ...draft, invariants: ["I-08"], decisions: ["ADR-0064", "D103"] }),
    );
    expect(violationsOf(world)).toContain(
      "IDN-01: the YAML cites I-17, D01, which the fiche never names",
    );

    const prefix = reference();
    first(prefix, "identite").decisions = ["D01"];
    setFiche(
      prefix,
      "identite/IDN-01.md",
      ficheOf({ ...first(prefix, "identite"), decisions: ["D013"] }),
    );
    expect(violationsOf(prefix)).toContain("the YAML cites D01, which the fiche never names");
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

  test.each([
    ["degel", "Une release signée dans six mois.", "mois"],
    ["degel", "Une release signée sous trente jours.", "jours"],
    ["abandon", "Aucun relais réel après deux semaines.", "semaines"],
    ["abandon", "Le seuil sera bientôt tenu.", "bientôt"],
    ["abandon", "Le seuil sera rapidement tenu.", "rapidement"],
  ] as const)("charte.%s « %s » names a delay", (field, text, word) => {
    const world = reference();
    first(world, "produit").charte = { ...CHARTER, [field]: text };
    expect(violationsOf(world)).toContain(`charte.${field} names a delay (« ${word} »)`);
  });

  test.each([
    "Le parseur ne tient toujours pas le seuil sur un corpus réel.",
    "Une mise à jour signée du contrat est publiée avec son évidence.",
    "Le jour où la release signée porte son évidence publiée.",
  ])("a fact that only resembles a delay is accepted: « %s »", (text) => {
    const world = reference();
    first(world, "produit").charte = { ...CHARTER, abandon: text, degel: text };
    expect(judge(world).report.violations).toEqual([]);
  });

  test("a product outside the catalogue of ADR-0042", () => {
    const world = reference();
    first(world, "produit").id = "PRD-41";
    expect(violationsOf(world)).toContain("PRD-41: P41 is not in the catalogue of ADR-0042 §1");
  });

  test("the gouvernance layer is the human-touch surface: an agent proposes there", () => {
    const world = reference();
    first(world, "gouvernance").autonomie = "modify";
    expect(violationsOf(world)).toContain("GOV-01: autonomie modify: I-17");
  });

  test("a withdrawal cites a decision of the register, and is not dated in the future", () => {
    const world = reference();
    first(world, "publication").retrait = { decision: "D999", date: "2026-11-09" };
    expect(violationsOf(world)).toContain("retrait cites D999");

    const future = reference();
    first(future, "publication").retrait = { decision: "D103", date: "2027-01-01" };
    expect(violationsOf(future)).toContain("retrait dated 2027-01-01 is in the future");
  });

  test("an origin observed in the future is a claim; the bound itself is accepted", () => {
    const world = reference();
    first(world, "identite").origine = { type: "observed", date: "2026-11-13" };
    expect(violationsOf(world)).toContain("origine dated 2026-11-13 is in the future");

    const bound = reference();
    first(bound, "identite").origine = { type: "observed", date: "2026-11-12" };
    expect(judge(bound).report.violations).toEqual([]);
  });

  test.each([
    ["role", "Atteint l'état prototypee à la première release."],
    ["nom", "Brique EN_COURS"],
    ["jetable", "until=la brique est Retiree du registre"],
  ] as const)("a status written in the %s of the YAML is refused", (field, text) => {
    const world = reference();
    (first(world, "identite") as Record<string, unknown>)[field] = text;
    expect(violationsOf(world)).toContain("IDN-01: a field states a status");
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

  test("a proof dated in the future is a claim; the bound itself is accepted", () => {
    const world = reference();
    first(world, "preuve").preuve = [{ date: "2026-11-13", cible: PROOF }];
    expect(violationsOf(world)).toContain("proof dated 2026-11-13 is in the future");

    const bound = reference();
    first(bound, "preuve").preuve = [{ date: "2026-11-12", cible: PROOF }];
    expect(judge(bound).report.violations).toEqual([]);
  });

  test.each([
    ["link", "is a symbolic link, and a link is not followed"],
    ["empty", "is an empty file"],
    ["other", "is not a regular file"],
    ["absent", "is not a tracked file of this repository"],
  ] as const)("a local target that is %s in the index is refused", (kind, expected) => {
    const world = reference();
    world.input.localTarget = () => kind;
    expect(violationsOf(world)).toContain(`PRV-01: proof target ${PROOF} ${expected}`);
  });

  test.each([
    ["../outside.md", "climbs out of the tree"],
    ["/etc/hosts", "the path is absolute"],
    ["ecosystem/briques/preuve/PRV-01.md", "is part of the map itself"],
    ["ecosystem/briques", "is part of the map itself"],
  ])("the path %s is refused before the index is asked", (cible, expected) => {
    const world = reference();
    world.input.localTarget = () => "regular";
    first(world, "preuve").preuve = [{ date: "2026-10-10", cible }];
    expect(violationsOf(world)).toContain(expected);
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
      // Refused one step earlier, by the citations reader, on the layer file.
      "a sha in upper case",
      "libre-ai/schemas-and-contracts",
      `libre-ai/schemas-and-contracts@${SHA.toUpperCase()}:README.md`,
      "a pinned sha is 7 to 40 lowercase hexadecimal characters",
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

  test.each([
    ["an escaped slash", String.raw`"libre-ai\/schemas-and-contracts@${SHA}:README.md"`],
    ["an escaped at sign", String.raw`"libre-ai/schemas-and-contracts\x40${SHA}:README.md"`],
    // The letter « a » of the organisation, written as a four-digit code point.
    [
      "an escaped letter",
      `"libre-${["\\", "u0061"].join("")}i/schemas-and-contracts@${SHA}:README.md"`,
    ],
  ])("a pinned proof the citations reader cannot see (%s) is refused", (_name, written) => {
    expect(written).toContain("\\");
    // The YAML decoder rebuilds the citation; the citations gate reads the raw
    // text and never finds it, so nobody would resolve it.
    const world = reference();
    const cible = `libre-ai/schemas-and-contracts@${SHA}:README.md`;
    world.files.set(
      "identite.v1.yaml",
      [
        `schema_version: ${SCHEMA_VERSION}`,
        "couche: identite",
        "briques:",
        "  - id: IDN-01",
        "    nom: Brique IDN-01",
        "    role: Fait une chose, vérifiable par un tiers.",
        "    depend_de: [GOV-01]",
        "    invariants: [I-08]",
        "    decisions: [ADR-0064]",
        "    depots: [libre-ai/schemas-and-contracts]",
        "    origine: { type: propre }",
        "    autonomie: modify",
        "    preuve:",
        '      - date: "2026-10-24"',
        `        cible: ${written}`,
        "",
      ].join("\n"),
    );
    // Where the decoder rebuilds the citation, only the raw text differs and
    // the delegation check is what refuses it. A decoder that keeps the escape
    // gives another string, refused as a malformed proof: red either way.
    let decoded: unknown = null;
    try {
      decoded = (Bun.YAML.parse(`v: ${written}`) as { v?: unknown }).v;
    } catch {
      decoded = null;
    }
    const violations = violationsOf(world);
    if (decoded === cible) {
      expect(violations).toContain(
        "the pinned-citations gate does not read this citation in the text of the layer file",
      );
    } else {
      expect(violations).toMatch(/IDN-01: |identite\.v1\.yaml: /);
    }
  });

  test("the escape forms above are decoded by the YAML reader of this runtime", () => {
    // If this fails, the test above no longer exercises the delegation check.
    expect(
      Bun.YAML.parse(String.raw`v: "libre-ai/schemas-and-contracts\x40${SHA}:README.md"`),
    ).toEqual({ v: `libre-ai/schemas-and-contracts@${SHA}:README.md` });
  });

  test("a citation the citations gate would refuse fails the layer file", () => {
    const world = reference();
    world.files.set(
      "identite.v1.yaml",
      `# voir libre-ai/schemas-and-contracts@${SHA}:\n${JSON.stringify(
        { schema_version: SCHEMA_VERSION, couche: "identite", briques: world.layers.identite },
        null,
        2,
      )}`,
    );
    expect(violationsOf(world)).toContain(
      "ecosystem/briques/identite.v1.yaml: line 1: the pinned-citations gate refuses",
    );
  });

  test("an exempted citation is not resolved, so it proves nothing", () => {
    const world = reference();
    const cible = `libre-ai/schemas-and-contracts@${SHA}:README.md`;
    first(world, "identite").depots = ["libre-ai/schemas-and-contracts"];
    first(world, "identite").preuve = [{ date: "2026-10-24", cible }];
    world.input.citations = {
      ...world.input.citations,
      exemptions: new Set([exemptionKey("ecosystem/briques/identite.v1.yaml", cible)]),
    };
    expect(violationsOf(world)).toContain("is exempted in the pinned-citations configuration");
  });
});

describe("fiches", () => {
  test("a brick without its fiche, and a fiche without its brick", () => {
    const world = reference();
    world.pinnedFiches.add("identite/IDN-01.md");
    expect(violationsOf(world)).toContain("fiche ecosystem/briques/identite/IDN-01.md is missing");

    const orphan = reference();
    setFiche(orphan, "identite/IDN-09.md", "# IDN-09 — Orpheline\n");
    expect(violationsOf(orphan)).toContain(
      "fiche(s) no layer file declares (ADR-0064 D3): identite/IDN-09.md",
    );
  });

  test("a fiche titled otherwise than its brick, or titled twice", () => {
    const world = reference();
    setFiche(world, "identite/IDN-01.md", ficheOf({ ...first(world, "identite"), nom: "Autre" }));
    expect(violationsOf(world)).toContain(
      "fiche title is « IDN-01 — Autre », the YAML says « IDN-01 — Brique IDN-01 », once",
    );

    const twice = reference();
    setFiche(
      twice,
      "identite/IDN-01.md",
      `${ficheOf(first(twice, "identite"))}\n# Statut de la brique\n`,
    );
    expect(violationsOf(twice)).toContain(
      "fiche title is « IDN-01 — Brique IDN-01 » then « Statut de la brique »",
    );
  });

  test("a fiche carries nothing between its title and its first section", () => {
    const world = reference();
    setFiche(
      world,
      "identite/IDN-01.md",
      ficheOf(first(world, "identite")).replace("\n\n## Contexte", "\n\nUne ligne.\n\n## Contexte"),
    );
    expect(violationsOf(world)).toContain(
      "IDN-01: fiche carries text between its title and its first section",
    );
  });

  test("a fiche missing a section, or holding an empty one", () => {
    const world = reference();
    setFiche(world, "identite/IDN-01.md", "# IDN-01 — Brique IDN-01\n\n## Contexte\n\nTexte.\n");
    expect(violationsOf(world)).toContain("fiche sections are « Contexte », expected");

    const empty = reference();
    setFiche(
      empty,
      "identite/IDN-01.md",
      `# IDN-01 — Brique IDN-01\n\n${FICHE_SECTIONS.map((title) => `## ${title}\n`).join("\n")}`,
    );
    expect(violationsOf(empty)).toContain("fiche section(s) empty: Contexte");
  });

  test.each([
    ["in a section", "## Mesure\n\nTexte de la section.", "## Mesure\n\nStatut : `en_cours`."],
    ["in another case", "## Mesure\n\nTexte de la section.", "## Mesure\n\nBrique Prototypee."],
    ["behind a Markdown escape", "## Mesure\n\nTexte de la section.", "## Mesure\n\nen\\_cours."],
    ["before the first section", "\n\n## Contexte", "\n\n**decrite**\n\n## Contexte"],
  ])("a fiche that writes a status %s is refused: the status is derived", (_name, from, to) => {
    const world = reference();
    const text = ficheOf(first(world, "identite")).replace(from, to);
    expect(text).toContain(to);
    setFiche(world, "identite/IDN-01.md", text);
    const violations = violationsOf(world);
    expect(violations).toContain("IDN-01: ");
    expect(violations).toContain("fiche states a status (« ");
  });

  test("the words of ordinary French are not machine values", () => {
    const world = reference();
    setFiche(
      world,
      "identite/IDN-01.md",
      ficheOf(first(world, "identite")).replace(
        "Texte de la section.",
        "La brique est décrite ici ; une mission est en cours ; elle sera prototypée puis retirée.",
      ),
    );
    expect(judge(world).report.violations).toEqual([]);
  });

  test("an unreadable fiche is a failure", () => {
    const world = reference();
    setFiche(world, "identite/IDN-01.md", null);
    expect(violationsOf(world)).toContain(
      "fiche ecosystem/briques/identite/IDN-01.md is unreadable",
    );
  });
});

describe("the index and the working copy (second review, G1)", () => {
  const STAGE = "its working copy differs from the index: stage it before running the gate";

  test("a layer file changed on disk and not staged is refused, not judged", () => {
    const world = reference();
    world.input.unstaged = new Set(["ecosystem/briques/identite.v1.yaml"]);
    expect(violationsOf(world)).toContain(`ecosystem/briques/identite.v1.yaml: ${STAGE}`);
  });

  test("a fiche changed on disk and not staged is refused", () => {
    const world = reference();
    world.input.unstaged = new Set(["ecosystem/briques/identite/IDN-01.md"]);
    expect(violationsOf(world)).toContain(
      `IDN-01: fiche ecosystem/briques/identite/IDN-01.md: ${STAGE}`,
    );
  });

  test("a proof target changed on disk and not staged does not hold", () => {
    const world = reference();
    world.input.unstaged = new Set([PROOF]);
    expect(violationsOf(world)).toContain(`PRV-01: proof target ${PROOF}: ${STAGE}`);
  });

  test("an unstaged file that no brick reads changes nothing", () => {
    const world = reference();
    world.input.unstaged = new Set(["docs/elsewhere.md"]);
    expect(judge(world).report.violations).toEqual([]);
  });
});

describe("what a reader sees (second review, G3 to G10)", () => {
  /** A fiche whose only mention of what the brick cites is `hidden`. */
  function ficheHiding(world: World, hidden: (cited: string) => string): void {
    const draft = first(world, "identite");
    const cited = [...draft.depend_de, ...draft.invariants, ...draft.decisions].join(" ");
    const sections = FICHE_SECTIONS.map((title) => `## ${title}\n\nTexte de la section.`);
    setFiche(
      world,
      "identite/IDN-01.md",
      `# ${draft.id} — ${draft.nom}\n\n${sections.join("\n\n")}\n\n${hidden(cited)}\n`,
    );
  }

  test.each([
    ["nowhere", (_cited: string) => "Rien."],
    ["in a closed comment", (cited: string) => `<!-- ${cited} -->`],
    ["in a comment that is never closed", (cited: string) => `<!-- ${cited}`],
    ["in a link definition", (cited: string) => `[//]: # (${cited})`],
    ["in the attribute of an HTML tag", (cited: string) => `<span title="${cited}"></span>`],
    ["in a heading", (cited: string) => `## ${cited}`],
  ])("an identifier named %s is not named for a reader", (_name, hidden) => {
    const world = reference();
    ficheHiding(world, hidden);
    expect(violationsOf(world)).toContain(
      "the YAML cites GOV-01, I-08, ADR-0064, which the fiche never names",
    );
  });

  test("named in a sentence, each identifier is named; a longer one does not name it", () => {
    const world = reference();
    ficheHiding(world, (cited) => `La brique cite ${cited}.`);
    expect(judge(world).report.violations).toEqual([]);

    const longer = reference();
    ficheHiding(longer, () => "La brique cite XGOV-01, GOV-010, I-081, XI-08 et ADR-00640.");
    expect(violationsOf(longer)).toContain(
      "the YAML cites GOV-01, I-08, ADR-0064, which the fiche never names",
    );
  });

  test.each([
    ["degel", "Bientôt, une release signée."],
    ["abandon", "Aucun relais réel après deux SEMAINES."],
  ] as const)("a delay word is refused in any case: charte.%s « %s »", (field, text) => {
    const world = reference();
    first(world, "produit").charte = { ...CHARTER, [field]: text };
    expect(violationsOf(world)).toContain(`charte.${field} names a delay`);
  });

  test("a word that only contains a delay word is not one", () => {
    const world = reference();
    first(world, "produit").charte = {
      ...CHARTER,
      degel: "Le pain moisi, les séjours et les semainiers ne sont pas des délais.",
    };
    expect(judge(world).report.violations).toEqual([]);
  });

  test("a status value is a whole word: a longer word is not one", () => {
    const world = reference();
    setFiche(
      world,
      "identite/IDN-01.md",
      ficheOf(first(world, "identite")).replace(
        "Texte de la section.",
        "Les mots indecrite, en_cours_de et retireeX ne sont pas des valeurs.",
      ),
    );
    expect(judge(world).report.violations).toEqual([]);
  });

  test("a path or a carrier is not prose: it may hold the letters of a status", () => {
    const world = reference();
    world.input.localTarget = () => "regular";
    world.input.repositories = new Map([
      ...world.input.repositories,
      ["libre-ai/retiree", { visibility: "public" }],
    ]);
    first(world, "preuve").depots = [SELF, "libre-ai/retiree"];
    first(world, "preuve").preuve = [{ date: "2026-10-10", cible: "docs/en_cours/x.md" }];
    expect(judge(world).report.violations).toEqual([]);
  });

  test("a status inside a list of the charter is refused", () => {
    const world = reference();
    first(world, "produit").charte = { ...CHARTER, refus: ["Rester decrite sans preuve."] };
    expect(violationsOf(world)).toContain("PRD-02: a field states a status (« decrite »)");
  });

  test("one artefact is one proof: the same target under two dates is refused", () => {
    const world = reference();
    first(world, "preuve").preuve = [
      { date: "2026-10-10", cible: PROOF },
      { date: "2026-10-11", cible: PROOF },
    ];
    expect(violationsOf(world)).toContain(
      `PRV-01: proof target cited twice by the same brick: ${PROOF}`,
    );
  });

  test("a withdrawn brick may still depend on a withdrawn brick", () => {
    const world = reference();
    first(world, "identite").retrait = { decision: "D103", date: "2026-11-09" };
    for (const slug of ["harness", "passerelle", "execution", "preuve", "produit"] as const) {
      first(world, slug).retrait = { decision: "D103", date: "2026-11-09" };
    }
    const violations = violationsOf(world);
    expect(violations).not.toContain("depends on IDN-01, which is withdrawn");
  });

  test("a fence closes with the fence that opened it", () => {
    const fiche = parseFiche(
      "# A\n\n## Contexte\n\n```\n~~~\n## pas un titre\n```\n\n## Mesure\n\nx\n",
    );
    expect(fiche.sections.map((section) => section.title)).toEqual(["Contexte", "Mesure"]);
  });

  test("a heading is read in linear time, and `##` alone is not a heading", () => {
    expect(parseFiche("# A ##\n\n## C#\n\nx\n\n##\n").titles).toEqual(["A"]);
    expect(parseFiche("# A\n\n## C#\n\nx\n").sections[0]?.title).toBe("C#");
    const started = performance.now();
    parseFiche(`# x${" ".repeat(400_000)}x\n`);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test.each([
    [
      "the path of a tracked entry",
      (world: World) =>
        world.extraEntries.push({ path: "x\n::error title=forged::y", kind: "file" }),
    ],
    [
      "an unknown key of a brick",
      (world: World) => {
        (first(world, "identite") as Record<string, unknown>)["x\n::error title=forged::y"] = 1;
      },
    ],
    [
      "a section title of a fiche",
      (world: World) =>
        setFiche(
          world,
          "identite/IDN-01.md",
          "# IDN-01 — Brique IDN-01\n\n## A\r::error::y\n\nx\n",
        ),
    ],
  ])("%s cannot print a line of its own", (_name, plant) => {
    const world = reference();
    plant(world);
    const violations = judge(world).report.violations;
    expect(violations.length).toBeGreaterThan(0);
    for (const violation of violations) {
      expect(violation.replace(CONTROL_CHARACTERS, "")).toBe(violation);
    }
    expect(violations.join(" ")).toContain("\\u000");
  });

  test.each([
    ["DEL", 0x7f],
    ["ESC", 0x1b],
    ["TAB", 0x09],
    ["NUL", 0x00],
    ["NEL", 0x85],
    ["LINE SEPARATOR", 0x2028],
  ])("%s in the name of a tracked entry is printed as an escape", (_name, code) => {
    const world = reference();
    const character = String.fromCharCode(code);
    world.extraEntries.push({ path: `a${character}b`, kind: "file" });
    const violations = judge(world).report.violations.join("\n");
    expect(violations).not.toContain(character);
    expect(violations).toContain(`a\\u${code.toString(16).padStart(4, "0")}b (file)`);
  });

  test.each([
    ["preuve_produite", "fabrique"],
    ["origine.source", "identite"],
    ["charte.valeur", "produit"],
    ["charte.pour_qui", "produit"],
    ["charte.degel", "produit"],
    ["charte.abandon", "produit"],
  ] as const)("a status written in %s is refused", (field, slug) => {
    const world = reference();
    const draft = first(world, slug);
    const text = "Une phrase qui écrit prototypee en toutes lettres.";
    if (field === "preuve_produite") draft.preuve_produite = text;
    else if (field === "origine.source") draft.origine = { type: "inspection", source: text };
    else {
      const key = field.slice("charte.".length) as "valeur" | "pour_qui" | "degel" | "abandon";
      draft.charte = { ...CHARTER, [key]: text };
    }
    expect(violationsOf(world)).toContain(`${draft.id}: a field states a status (« prototypee »)`);
  });

  test.each([
    ["#mot", [] as string[]],
    ["### Niveau trois", [] as string[]],
    ["#\tTitre", ["Titre"]],
    ["# #", [] as string[]],
  ])("the heading reader on %j", (line, titles) => {
    expect(parseFiche(`${line}\n`).titles).toEqual(titles);
  });

  test("a section title after a tab is a section", () => {
    expect(parseFiche("# A\n\n##\tContexte\n\nx\n").sections[0]?.title).toBe("Contexte");
  });

  test("a line of opening brackets is read in linear time", () => {
    const world = reference();
    const draft = first(world, "identite");
    setFiche(world, "identite/IDN-01.md", `${ficheOf(draft)}\n${"<".repeat(300_000)}\n`);
    const started = performance.now();
    judge(world);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("the doctrine sources (third review, H2)", () => {
  test.each([
    "docs/decisions/INVARIANTS.md",
    "docs/decisions/DECISION-REGISTER.md",
    "ecosystem/repositories.v1.yaml",
    "ecosystem/briques/README.md",
  ])("%s changed on disk and not staged is refused", (source) => {
    const world = reference();
    world.input.unstaged = new Set([source]);
    expect(violationsOf(world)).toContain(
      `doctrine sources: ${source}: its working copy differs from the index`,
    );
  });

  test("the sources read as indexed are counted", () => {
    const outcome = judge(reference());
    expect(outcome.report.checks.find((check) => check.item === "doctrine sources")?.note).toBe(
      "3 doctrine file(s) read, each one as indexed",
    );
  });
});
