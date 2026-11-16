import { describe, expect, test } from "bun:test";

import type { TreeListing } from "./fleet-tree";
import {
  type CardSource,
  catalogueFromFiches,
  evaluateFleetVersions,
  type FleetVersionsInput,
  parseCatalogueListing,
  pathIsTracked,
  repositoriesToList,
} from "./fleet-versions";

/**
 * The fleet gate of products with code and phases as versions (owner's choices
 * of 2026-11-16). Each rule has a case that turns it red; the counters are held
 * to sum to the volume read.
 */

type Card = Record<string, unknown>;

function card(repository: string, changes: Card = {}): Card {
  return {
    schema_version: "libre-ai.project.v1",
    project: repository.slice("libre-ai/".length),
    repository,
    kind: "satellite",
    layer: "couche-3",
    statement: {
      for: "les personnes qui prennent des notes",
      who_faces: "des notes enfermées dans un format",
      enables: "garder ses notes en fichiers ouverts",
      producing: ["un coffre de notes"],
      without_depending_on: ["aucun service tiers"],
    },
    summary: "Un dépôt de la flotte, pour le test.",
    current_situation: "Rien n'est livré.",
    scope: ["les notes"],
    non_goals: ["le reste"],
    dependencies: [],
    maturity: "usable",
    confidence: "high",
    exposure: "usable-verifiable",
    freshness: { last_verified_on: "2026-11-01" },
    scope_stability: "stable",
    phases: [phase("socle", "accepted")],
    ...changes,
  };
}

function phase(id: string, status: "pending" | "accepted", changes: Card = {}): Card {
  return {
    id,
    title: `Phase ${id}`,
    exit_criteria: [
      {
        id: `${id}-done`,
        text: "Le critère de la phase est tenu.",
        weight: 1,
        status,
        ...(status === "accepted" ? { evidence: { date: "2026-11-01", reference: "PR #1" } } : {}),
      },
    ],
    ...changes,
  };
}

function version(
  id: string,
  status: "pending" | "accepted",
  product: string,
  dependsOn?: string[],
): Card {
  return phase(id, status, {
    product,
    delivers: "Ouvrir un coffre de notes existant tel quel.",
    ...(dependsOn === undefined ? {} : { depends_on: dependsOn }),
  });
}

/** JSON is YAML: a card is written without a YAML serialiser. */
function source(repository: string, value: Card | null, error: string | null = null): CardSource {
  return { repository, text: value === null ? null : JSON.stringify(value), error };
}

/**
 * Each fiche with the repository its `depot` names. P05 is carried by a
 * repository no test card is, and P06 by none (`depot: null`).
 */
const CATALOGUE = {
  ok: true as const,
  carriers: new Map<string, string | null>([
    ["P01", "libre-ai/a"],
    ["P02", "libre-ai/b"],
    ["P04", "libre-ai/notes"],
    ["P05", "libre-ai/autre"],
    ["P06", null],
  ]),
};

function input(
  cards: CardSource[],
  trees: [string, TreeListing][] = [],
  catalogue: FleetVersionsInput["catalogue"] = CATALOGUE,
  withoutCard: string[] = [],
): FleetVersionsInput {
  return { cards, trees: new Map(trees), catalogue, withoutCard };
}

const listed = (...paths: string[]): TreeListing => ({ kind: "listed", paths });

describe("parseCatalogueListing", () => {
  test("the identifiers of the fiches, and nothing else the directory tracks", () => {
    const listing = [
      "ecosystem/produits/P01.v1.yaml",
      "ecosystem/produits/P41.v1.yaml",
      "ecosystem/produits/README.md",
      "ecosystem/produits/P4.v1.yaml",
      "",
    ].join("\0");
    const catalogue = parseCatalogueListing(listing);
    expect(catalogue.ok && [...catalogue.ids]).toEqual(["P01", "P41"]);
  });

  test("no fiche is an unreadable catalogue, not an empty one", () => {
    expect(parseCatalogueListing("ecosystem/produits/README.md\0")).toEqual({
      ok: false,
      reason: "no fiche tracked under ecosystem/produits/",
    });
    expect(parseCatalogueListing("").ok).toBe(false);
  });
});

describe("catalogueFromFiches", () => {
  const fiche = (id: string, depot: string | null): string =>
    `schema_version: libre-ai.produit.v1\nid: ${id}\ndepot: ${depot === null ? "null" : depot}\n`;

  test("each fiche with the repository its depot names, or null", () => {
    const catalogue = catalogueFromFiches([
      { id: "P04", text: fiche("P04", "libre-ai/notes"), error: null },
      { id: "P02", text: fiche("P02", null), error: null },
    ]);
    expect(catalogue).toEqual({
      ok: true,
      carriers: new Map([
        ["P04", "libre-ai/notes"],
        ["P02", null],
      ]),
    });
  });

  test("a fiche that cannot be read makes the catalogue unreadable, never a product without carrier", () => {
    const catalogue = catalogueFromFiches([
      { id: "P04", text: fiche("P04", "libre-ai/notes"), error: null },
      { id: "P02", text: null, error: "ENOENT" },
    ]);
    expect(catalogue).toEqual({ ok: false, reason: "fiche P02 unreadable (ENOENT)" });
  });

  test("a fiche without a depot field, or with a depot that is not a repository, is unreadable", () => {
    expect(catalogueFromFiches([{ id: "P04", text: "id: P04\n", error: null }])).toEqual({
      ok: false,
      reason: "fiche P04 has no depot field",
    });
    expect(catalogueFromFiches([{ id: "P04", text: "id: P04\ndepot: 3\n", error: null }]).ok).toBe(
      false,
    );
    expect(catalogueFromFiches([{ id: "P04", text: "id: P04\ndepot: [\n", error: null }]).ok).toBe(
      false,
    );
  });

  test("a fiche whose id is not its file name is unreadable: the carrier would be attributed to the wrong product", () => {
    expect(
      catalogueFromFiches([{ id: "P04", text: fiche("P05", "libre-ai/notes"), error: null }]),
    ).toEqual({
      ok: false,
      reason: "fiche P04 declares id P05",
    });
  });

  test("no fiche is an unreadable catalogue, not an empty one", () => {
    expect(catalogueFromFiches([]).ok).toBe(false);
  });
});

describe("pathIsTracked", () => {
  test("a tracked file, or a directory that holds one", () => {
    const paths = ["src/notes/index.ts", "README.md"];
    expect(pathIsTracked("src/notes/index.ts", paths)).toBe(true);
    expect(pathIsTracked("src/notes", paths)).toBe(true);
    expect(pathIsTracked("src", paths)).toBe(true);
  });

  test("a prefix of a name is not a directory", () => {
    expect(pathIsTracked("src/note", ["src/notes/index.ts"])).toBe(false);
    expect(pathIsTracked("README", ["README.md"])).toBe(false);
  });
});

describe("repositoriesToList", () => {
  test("only the repositories whose valid card declares products", () => {
    const cards = [
      source("libre-ai/notes", card("libre-ai/notes", { products: [{ id: "P04", code: "src" }] })),
      source("libre-ai/socle", card("libre-ai/socle")),
      source("libre-ai/broken", null, "HTTP 502"),
    ];
    expect(repositoriesToList(cards)).toEqual(["libre-ai/notes"]);
  });
});

describe("evaluateFleetVersions", () => {
  const notes = (changes: Card = {}): CardSource =>
    source(
      "libre-ai/notes",
      card("libre-ai/notes", {
        products: [{ id: "P04", code: "src/notes" }],
        phases: [
          phase("socle", "accepted"),
          version("v1", "pending", "P04", ["libre-ai/socle#base"]),
        ],
        dependencies: [{ on: "libre-ai/socle", why: "Les briques communes." }],
        ...changes,
      }),
    );
  const socle = (status: "pending" | "accepted" = "accepted"): CardSource =>
    source("libre-ai/socle", card("libre-ai/socle", { phases: [phase("base", status)] }));
  const notesTree: [string, TreeListing] = ["libre-ai/notes", listed("src/notes/index.ts")];

  test("control: a coherent fleet is green, and its counters sum", () => {
    const outcome = evaluateFleetVersions(input([notes(), socle()], [notesTree]));
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.compteurs).toMatchObject({
      cards_declared: 2,
      cards_read: 2,
      cards_unreadable: 0,
      products_declared: 1,
      products_verified: 1,
      versions: 1,
      versions_ready: 1,
      dependencies_resolved: 1,
    });
    expect(outcome.volume).toContain("2 card(s) declared = 2 read + 0 unreadable");
    expect(outcome.volume).toContain("1 version(s) = 0 done + 1 ready + 0 blocked");
  });

  test("rule catalogue: a product the catalogue does not know is refused", () => {
    const outcome = evaluateFleetVersions(
      input([notes({ products: [{ id: "P09", code: "src/notes" }] }), socle()], [notesTree]),
    );
    expect(outcome.report.violations).toEqual([
      expect.stringContaining(
        "libre-ai/notes: products P09, which is not a fiche of the catalogue",
      ),
    ]);
    expect(outcome.compteurs.products_unknown).toBe(1);
  });

  test("rule catalogue: a version of a product the catalogue does not know is refused", () => {
    const outcome = evaluateFleetVersions(
      input([notes({ phases: [version("v1", "pending", "P09")] }), socle()], [notesTree]),
    );
    expect(outcome.report.violations).toEqual([
      expect.stringContaining(
        "libre-ai/notes: phase v1 is a version of P09, which is not a fiche of the catalogue",
      ),
    ]);
  });

  test("rule code: a path the served branch does not track is refused", () => {
    const outcome = evaluateFleetVersions(
      input([notes(), socle()], [["libre-ai/notes", listed("docs/README.md")]]),
    );
    expect(outcome.report.violations).toEqual([
      expect.stringContaining(
        "libre-ai/notes: products P04 names src/notes, which the served branch does not track",
      ),
    ]);
    expect(outcome.compteurs.products_path_absent).toBe(1);
  });

  test("rule code: an unreadable tree is a failure, never a verified path", () => {
    const outcome = evaluateFleetVersions(
      input([notes(), socle()], [["libre-ai/notes", { kind: "unreadable", reason: "HTTP 403" }]]),
    );
    expect(outcome.report.violations).toEqual([
      expect.stringContaining(
        "libre-ai/notes: the tree of the served branch is unreadable (HTTP 403)",
      ),
    ]);
    expect(outcome.compteurs.products_tree_unreadable).toBe(1);
    expect(outcome.compteurs.products_verified).toBe(0);
  });

  test("rule code: a tree never listed is a failure", () => {
    const outcome = evaluateFleetVersions(input([notes(), socle()]));
    expect(outcome.report.violations).toEqual([
      expect.stringContaining("libre-ai/notes: the tree of the served branch was not listed"),
    ]);
  });

  test("rule dependency: a target phase no card declares is refused, and the version is blocked", () => {
    const outcome = evaluateFleetVersions(
      input(
        [notes({ phases: [version("v1", "pending", "P04", ["libre-ai/socle#absent"])] }), socle()],
        [notesTree],
      ),
    );
    expect(outcome.report.violations).toEqual([
      expect.stringContaining(
        "libre-ai/notes: phase v1 depends on libre-ai/socle#absent, which no card read declares",
      ),
    ]);
    expect(outcome.compteurs.dependencies_unresolved).toBe(1);
    expect(outcome.compteurs.versions_blocked).toBe(1);
    expect(outcome.compteurs.versions_ready).toBe(0);
  });

  test("ready: a version waits until every target phase has all its criteria accepted", () => {
    const outcome = evaluateFleetVersions(input([notes(), socle("pending")], [notesTree]));
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.compteurs.versions_ready).toBe(0);
    expect(outcome.compteurs.versions_blocked).toBe(1);
    expect(outcome.ready).toEqual([]);
  });

  test("ready: the ready versions are named", () => {
    const outcome = evaluateFleetVersions(input([notes(), socle()], [notesTree]));
    expect(outcome.ready).toEqual(["libre-ai/notes#v1 (P04)"]);
  });

  test("done: a version whose criteria are all accepted is neither ready nor blocked", () => {
    const outcome = evaluateFleetVersions(
      input([notes({ phases: [version("v1", "accepted", "P04")] }), socle()], [notesTree]),
    );
    expect(outcome.compteurs).toMatchObject({ versions: 1, versions_done: 1, versions_ready: 0 });
  });

  test("source: an unreadable card is a failure, not a card without versions", () => {
    const outcome = evaluateFleetVersions(
      input([notes(), source("libre-ai/socle", null, "HTTP 502")], [notesTree]),
    );
    expect(outcome.report.violations).toContainEqual(
      expect.stringContaining("libre-ai/socle: card unreadable (HTTP 502)"),
    );
    expect(outcome.compteurs.cards_unreadable).toBe(1);
  });

  test("source: a card the schema refuses is unreadable for this gate", () => {
    const outcome = evaluateFleetVersions(
      input(
        [notes(), source("libre-ai/socle", card("libre-ai/socle", { phases: [] }))],
        [notesTree],
      ),
    );
    expect(outcome.report.violations).toContainEqual(
      expect.stringContaining("libre-ai/socle: card invalid"),
    );
  });

  test("source: an unreadable catalogue is a failure, and no product is held to it", () => {
    const outcome = evaluateFleetVersions(
      input([notes(), socle()], [notesTree], { ok: false, reason: "no fiche tracked" }),
    );
    expect(outcome.report.violations).toContainEqual(
      expect.stringContaining("catalogue of products: unreadable (no fiche tracked)"),
    );
  });

  test("source: no card declared is a failure, not an empty fleet", () => {
    const outcome = evaluateFleetVersions(input([]));
    expect(outcome.report.violations).toContainEqual(expect.stringContaining("no card declared"));
  });

  test("consumption: the consumers of a repository are read from the dependencies of the others", () => {
    const outcome = evaluateFleetVersions(input([notes(), socle()], [notesTree]));
    expect(outcome.consumers.get("libre-ai/socle")).toEqual(["libre-ai/notes"]);
    expect(outcome.withoutConsumer).toEqual(["libre-ai/notes"]);
    expect(outcome.volume).toContain("consumption: 1 card(s) with a consumer + 1 without = 2");
  });

  test("consumption: a repository without a consumer is information, not a failure", () => {
    const outcome = evaluateFleetVersions(input([socle()]));
    expect(outcome.report.violations).toEqual([]);
    expect(outcome.withoutConsumer).toEqual(["libre-ai/socle"]);
  });

  test("the counters sum to the volume read", () => {
    const outcome = evaluateFleetVersions(
      input(
        [
          notes({
            products: [
              { id: "P04", code: "src/notes" },
              { id: "P09", code: "src" },
              { id: "P05", code: "src" },
            ],
          }),
          socle("pending"),
          source("libre-ai/broken", null, "HTTP 502"),
        ],
        [notesTree],
        CATALOGUE,
        ["libre-ai/website"],
      ),
    );
    const c = outcome.compteurs;
    expect(c.cards_declared + c.index_without_card).toBe(c.index_repositories);
    expect(c.index_repositories).toBe(4);
    expect(c.cards_read + c.cards_unreadable).toBe(c.cards_declared);
    expect(
      c.products_verified +
        c.products_path_absent +
        c.products_tree_unreadable +
        c.products_unknown +
        c.products_other_carrier,
    ).toBe(c.products_declared);
    expect(c.products_other_carrier).toBe(1);
    expect(c.versions_done + c.versions_ready + c.versions_blocked).toBe(c.versions);
    expect(c.versions + c.foundation_phases).toBe(c.phases);
    expect(c.dependencies_resolved + c.dependencies_unresolved).toBe(c.dependencies);
    expect(c.consumed_entries_on_a_card + c.consumed_entries_elsewhere).toBe(c.consumed_entries);
    expect(c.cards_with_consumer + c.cards_without_consumer).toBe(c.cards_read);
  });

  test("source: a card absent at the served branch is unreadable, not a card without versions", () => {
    const outcome = evaluateFleetVersions(
      input([notes(), source("libre-ai/socle", null, null)], [notesTree]),
    );
    expect(outcome.report.violations).toContainEqual(
      expect.stringContaining("libre-ai/socle: card absent at the served branch"),
    );
  });

  // Review of 2026-11-16, finding 1: a card is read under the name the index
  // gives it, whatever repository it declares.
  test("identity: a card that declares another repository is refused and read under its own name", () => {
    const evil = source(
      "libre-ai/evil",
      card("libre-ai/socle", { phases: [phase("base", "accepted")] }),
    );
    // The impostor comes first: read under its declared name, it would be the
    // phase the version of notes waits on.
    const outcome = evaluateFleetVersions(input([evil, notes(), socle("pending")], [notesTree]));
    expect(outcome.report.violations).toEqual([
      expect.stringContaining(
        "libre-ai/evil: the card declares repository libre-ai/socle, the index names libre-ai/evil",
      ),
    ]);
    // The version of notes still waits on the phase of the real socle.
    expect(outcome.ready).toEqual([]);
    expect(outcome.compteurs.versions_blocked).toBe(1);
  });

  test("cycle: a phase that depends on itself is refused, and never ready", () => {
    const outcome = evaluateFleetVersions(
      input(
        [notes({ phases: [version("v1", "pending", "P04", ["libre-ai/notes#v1"])] }), socle()],
        [notesTree],
      ),
    );
    expect(outcome.report.violations).toEqual([
      expect.stringContaining(
        "libre-ai/notes: phase v1 waits on itself through its dependencies (libre-ai/notes#v1 → libre-ai/notes#v1)",
      ),
    ]);
    expect(outcome.compteurs.versions_blocked).toBe(1);
  });

  test("cycle: two phases that depend on each other are both refused", () => {
    const a = source(
      "libre-ai/a",
      card("libre-ai/a", { phases: [version("v1", "pending", "P01", ["libre-ai/b#v1"])] }),
    );
    const b = source(
      "libre-ai/b",
      card("libre-ai/b", { phases: [version("v1", "pending", "P02", ["libre-ai/a#v1"])] }),
    );
    const outcome = evaluateFleetVersions(input([a, b]));
    expect(outcome.report.violations).toEqual([
      expect.stringContaining("libre-ai/a: phase v1 waits on itself"),
      expect.stringContaining("libre-ai/b: phase v1 waits on itself"),
    ]);
  });

  test.each([
    ["accepted first", ["accepted", "pending"]],
    ["pending first", ["pending", "accepted"]],
  ] as const)("duplicate: a dependency on a doubled phase is unresolved (%s)", (_order, statuses) => {
    const doubled = source(
      "libre-ai/socle",
      card("libre-ai/socle", {
        phases: [phase("base", statuses[0]), phase("base", statuses[1])],
      }),
    );
    const outcome = evaluateFleetVersions(input([notes(), doubled], [notesTree]));
    expect(outcome.report.violations).toContainEqual(
      expect.stringContaining(
        "libre-ai/notes: phase v1 depends on libre-ai/socle#base, which its card declares twice",
      ),
    );
    expect(outcome.ready).toEqual([]);
  });

  test("violation: a version of a card in violation is not ready", () => {
    const outcome = evaluateFleetVersions(
      input([notes({ products: [{ id: "P04", code: "src/absent" }] }), socle()], [notesTree]),
    );
    expect(outcome.report.violations).toEqual([
      expect.stringContaining("libre-ai/notes: products P04 names src/absent"),
    ]);
    expect(outcome.ready).toEqual([]);
    expect(outcome.compteurs.versions_blocked).toBe(1);
  });

  test("duplicate: a phase identifier written twice in a card is refused", () => {
    const outcome = evaluateFleetVersions(
      input([
        source(
          "libre-ai/socle",
          card("libre-ai/socle", { phases: [phase("base", "accepted"), phase("base", "pending")] }),
        ),
      ]),
    );
    expect(outcome.report.violations).toEqual([
      expect.stringContaining("libre-ai/socle: phase base is declared twice"),
    ]);
  });

  test("catalogue: a version of a product the catalogue does not know is never ready", () => {
    const outcome = evaluateFleetVersions(
      input([notes({ phases: [version("v1", "pending", "P09")] }), socle()], [notesTree]),
    );
    expect(outcome.ready).toEqual([]);
    expect(outcome.compteurs.versions_blocked).toBe(1);
  });

  test("catalogue: an unreadable catalogue does not say a product is not in it", () => {
    const outcome = evaluateFleetVersions(
      input([notes(), socle()], [notesTree], { ok: false, reason: "no fiche tracked" }),
    );
    expect(outcome.report.violations).toContainEqual(
      expect.stringContaining(
        "libre-ai/notes: products P04, which cannot be held to the catalogue: it is unreadable",
      ),
    );
    expect(outcome.report.violations.join("\n")).not.toContain("is not a fiche of the catalogue");
    expect(outcome.compteurs.products_unknown).toBe(1);
  });

  test("carrier: a product whose fiche names another repository is refused, and its path not judged", () => {
    const outcome = evaluateFleetVersions(
      input([notes({ products: [{ id: "P05", code: "src/notes" }] }), socle()], [notesTree]),
    );
    expect(outcome.report.violations).toContainEqual(
      expect.stringContaining(
        "libre-ai/notes: products P05, whose fiche names libre-ai/autre as its carrier, not libre-ai/notes",
      ),
    );
    expect(outcome.compteurs).toMatchObject({
      products_declared: 1,
      products_other_carrier: 1,
      products_verified: 0,
    });
    expect(outcome.volume).toContain("+ 1 carried by another repository");
  });

  test("carrier: a product whose fiche names no carrier (depot: null) is refused", () => {
    const outcome = evaluateFleetVersions(
      input([notes({ products: [{ id: "P06", code: "src/notes" }] }), socle()], [notesTree]),
    );
    expect(outcome.report.violations).toContainEqual(
      expect.stringContaining(
        "libre-ai/notes: products P06, whose fiche names no carrier repository (depot: null), not libre-ai/notes",
      ),
    );
    expect(outcome.compteurs.products_other_carrier).toBe(1);
  });

  test("carrier: a version of a product carried elsewhere is refused and never ready", () => {
    const outcome = evaluateFleetVersions(
      input([notes({ phases: [version("v1", "pending", "P05")] }), socle()], [notesTree]),
    );
    expect(outcome.report.violations).toContainEqual(
      expect.stringContaining(
        "libre-ai/notes: phase v1 is a version of P05, whose fiche names libre-ai/autre as its carrier, not libre-ai/notes",
      ),
    );
    expect(outcome.ready).toEqual([]);
    expect(outcome.compteurs.versions_blocked).toBe(1);
  });

  test("carrier: a version done of a product carried elsewhere is still refused", () => {
    const outcome = evaluateFleetVersions(
      input([notes({ phases: [version("v1", "accepted", "P06")] }), socle()], [notesTree]),
    );
    expect(outcome.report.violations).toContainEqual(
      expect.stringContaining(
        "libre-ai/notes: phase v1 is a version of P06, whose fiche names no carrier",
      ),
    );
  });

  test("consumption: an entry that names no card read is counted elsewhere, never dropped", () => {
    const outcome = evaluateFleetVersions(
      input(
        [
          notes({
            dependencies: [
              { on: "libre-ai/socle", why: "Les briques communes." },
              { on: "biscuit-auth", why: "Une crate." },
            ],
          }),
          socle(),
        ],
        [notesTree],
      ),
    );
    expect(outcome.compteurs).toMatchObject({
      consumed_entries: 2,
      consumed_entries_on_a_card: 1,
      consumed_entries_elsewhere: 1,
      cards_with_consumer: 1,
      cards_without_consumer: 1,
    });
    expect(outcome.volume).toContain(
      "2 dependency entry(ies) of the cards read = 1 on a card read + 1 elsewhere",
    );
  });
});
