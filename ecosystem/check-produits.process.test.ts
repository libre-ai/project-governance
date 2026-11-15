import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { HOSTED_OFFERS_PATH, SCHEMA_VERSION } from "./produits";

/**
 * The product-catalogue gate run as a process, against a real repository.
 *
 * WHY A PROCESS. `produits.test.ts` judges a catalogue held in memory: it
 * proves the rules, and nothing about the half that reads git and the disk.
 * Whether a missing decision record, an unparsable catalogue table or an
 * absent inventory becomes a failure and not a zero, whether an untracked
 * fiche is left out, whether a link is seen as a link — for a fiche and for a
 * source —, whether a source git does not track is refused, whether an
 * unmerged path is counted once, and whether a violation reaches the exit
 * code are all decided in `check-produits.ts`. These probes run that file.
 *
 * WHY A DECLARED ENVIRONMENT. A child inheriting `GIT_DIR`, `GIT_INDEX_FILE`
 * or a global git configuration would read another index than the fixture's,
 * and `GATE_VERBOSE` would change the output: each child gets only what is
 * declared here. The two probes that set `GIT_DIR` and `GIT_INDEX_FILE` on
 * purpose say so: the gate must not follow them.
 */

const GATE = join(import.meta.dir, "check-produits.ts");
const SELF = "libre-ai/project-governance";

const ENVIRONMENT = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

const CATALOGUE_ADR = "docs/adr/0042-catalogue.md";
const INVENTORY = "ecosystem/repositories.v1.yaml";
const SCHEMA = "ecosystem/schemas/produit.v1.schema.json";
/** The four files the gate declares as its sources. */
const SOURCES: string[] = [CATALOGUE_ADR, INVENTORY, SCHEMA, HOSTED_OFFERS_PATH];

/** The two texts of an offer, as a fiche writes them. */
const OFFRE = {
  sans_frais: "Le logiciel entier chez vous, sans limite.",
  payant: "Le service hébergé : synchronisation et sauvegardes.",
};

interface Run {
  readonly exitCode: number;
  readonly output: string;
}

interface RunOptions {
  /** Variables added to the declared environment, for the probes that redirect git. */
  readonly env?: Readonly<Record<string, string>>;
  /** What the child reads on its standard input. */
  readonly input?: string;
}

function run(argv: readonly string[], cwd: string, options: RunOptions = {}): Run {
  const result = Bun.spawnSync([...argv], {
    cwd,
    stdin: options.input === undefined ? "ignore" : new TextEncoder().encode(options.input),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...ENVIRONMENT, ...options.env },
  });
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return {
    exitCode: result.exitCode ?? 1,
    output: `${decode(result.stdout)}${decode(result.stderr)}`,
  };
}

/** Run git for the fixture; a failure is a setup failure, not a verdict. */
function git(cwd: string, ...argv: string[]): void {
  const outcome = run(["git", ...argv], cwd);
  if (outcome.exitCode !== 0) {
    throw new Error(`fixture setup failed: git ${argv.join(" ")} — ${outcome.output.trim()}`);
  }
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function fiche(
  id: string,
  categorie: string,
  depot: string | null,
  offre?: Readonly<Record<string, string>>,
): string {
  // JSON is YAML: the fiche is written without a YAML serialiser.
  return JSON.stringify(
    {
      schema_version: SCHEMA_VERSION,
      id,
      nom_public: null,
      nom_provisoire: `Produit ${id}`,
      intitule: `produit ${id}`,
      fonction: "Fait une chose",
      categorie,
      promesse: "Faire une chose pour quelqu'un, de façon vérifiable.",
      pour_qui: "une personne nommée",
      a_la_place_de: "votre outil en ligne par abonnement",
      // Left out when undefined: a product without a hosted offer does not carry the field.
      offre,
      capacites: ["Faire la chose annoncée."],
      ne_fait_pas: ["Faire autre chose que la chose annoncée."],
      depend_de: [],
      realisation: "projet autonome",
      depot,
      etiquettes: ["Une chose", "Deux choses", "Trois choses"],
      a_relire: ["a_la_place_de", "depend_de"],
    },
    null,
    2,
  );
}

/** A tree the gate accepts: three products over two domains, and the sources it reads. */
function plantTree(root: string): void {
  write(
    root,
    CATALOGUE_ADR,
    "## Décision\n\n### 1. Le catalogue d'applications\n\n| Domaine | Produits |\n| --- | --- |\n| Connaissance | P01 un · P02 deux |\n| Collaboration | P03 trois |\n",
  );
  write(root, INVENTORY, `repositories:\n  - repository: ${SELF}\n    visibility: public\n`);
  // The schema is a source the gate attests: the fixture tracks it like the
  // repository does, or the attestation would bear on a file git does not hold.
  mkdirSync(dirname(join(root, SCHEMA)), { recursive: true });
  copyFileSync(join(import.meta.dir, "schemas", "produit.v1.schema.json"), join(root, SCHEMA));
  write(root, "ecosystem/produits/P01.v1.yaml", fiche("P01", "connaissance", SELF));
  // One product has a decided hosted offer, and its fiche says what it is.
  write(
    root,
    HOSTED_OFFERS_PATH,
    "schema_version: libre-ai.hosted-offers.v1\noffres_hebergees:\n  - produit: P02\n    decision: ADR-0054\n",
  );
  write(root, "ecosystem/produits/P02.v1.yaml", fiche("P02", "connaissance", null, OFFRE));
  write(root, "ecosystem/produits/P03.v1.yaml", fiche("P03", "collaboration", null));
  write(root, "ecosystem/produits/README.md", "# Catalogue\n");
}

let workspace: string;

/** A staged fixture: the gate reads what git tracks. */
function freshTree(name: string): string {
  const root = join(workspace, name);
  mkdirSync(root);
  plantTree(root);
  git(root, "init", "--quiet");
  git(root, "add", "--all");
  return root;
}

const judge = (root: string, env?: Readonly<Record<string, string>>): Run =>
  run([process.execPath, GATE], root, { env });

/** A tracked file replaced by a tracked link to a copy of itself: same bytes, another mode. */
function replaceByTrackedLink(root: string, path: string): void {
  const target = join(root, `${path.replaceAll("/", "-")}.cible`);
  copyFileSync(join(root, path), target);
  unlinkSync(join(root, path));
  symlinkSync(target, join(root, path));
  git(root, "add", "--all");
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "check-produits-"));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("check-produits as a process", () => {
  test("control: the planted tree is green, and the volume names what was read", () => {
    const outcome = judge(freshTree("control"));
    // The number of assertions is not held here: it follows the number of
    // checks the gate makes on its sources, which a refactor may regroup.
    expect(outcome.output).toMatch(/Product catalogue verified: [0-9]+ assertion\(s\) hold/);
    expect(outcome.output).toContain(
      "3 product(s) in the catalogue of ADR-0042 §1 = 3 with a fiche + 0 missing",
    );
    expect(outcome.output).toContain("3 fiche(s) read = 3 valid + 0 in violation");
    expect(outcome.output).toContain(
      "carrier: 1 with a depot + 2 without + 0 not decidable (schema not held) = 3",
    );
    expect(outcome.output).toContain(
      "hosted offer: 1 with an offre + 2 without + 0 not decidable (schema not held) = 3",
    );
    expect(outcome.output).toContain("6 a_relire field(s) on 3 fiche(s)");
    expect(outcome.output).toContain(
      "4 tracked path(s) under ecosystem/produits/ = 3 fiche(s) + 1 README + 0 refused + 0 unmerged",
    );
    expect(outcome.exitCode).toBe(0);
  });

  test("the catalogue is derived: a product added to the decision record has no fiche, and that is a failure", () => {
    const root = freshTree("derived");
    write(
      root,
      CATALOGUE_ADR,
      "### 1. Le catalogue d'applications\n\n| Domaine | Produits |\n| --- | --- |\n| Connaissance | P01 un · P02 deux |\n| Collaboration | P03 trois · P04 quatre |\n",
    );
    git(root, "add", "--all");
    const outcome = judge(root);
    expect(outcome.output).toContain(
      "Product catalogue: P04: in the catalogue of ADR-0042 §1, and no fiche",
    );
    expect(outcome.output).toContain(
      "4 product(s) in the catalogue of ADR-0042 §1 = 3 with a fiche + 1 missing",
    );
    expect(outcome.exitCode).toBe(1);
  });

  test("source: the decision record is absent", () => {
    const root = freshTree("no-adr");
    git(root, "rm", "--quiet", "-f", CATALOGUE_ADR);
    const outcome = judge(root);
    expect(outcome.output).toContain("catalogue of ADR-0042 §1: no product read");
    expect(outcome.output).toContain("domains of ADR-0042 §1: no domain read");
    expect(outcome.output).toContain("Product catalogue volume: 0 product(s) in the catalogue");
    expect(outcome.exitCode).toBe(1);
  });

  test("source: the catalogue table cannot be parsed", () => {
    const root = freshTree("no-table");
    write(
      root,
      CATALOGUE_ADR,
      "## Décision\n\n### 1. Une autre section\n\n| A | P01 · P02 · P03 |\n",
    );
    git(root, "add", "--all");
    const outcome = judge(root);
    expect(outcome.output).toContain("catalogue of ADR-0042 §1: no product read");
    expect(outcome.exitCode).toBe(1);
  });

  test("source: the inventory is absent", () => {
    const root = freshTree("no-inventory");
    git(root, "rm", "--quiet", "-f", INVENTORY);
    const outcome = judge(root);
    expect(outcome.output).toContain("ecosystem/repositories.v1.yaml: no repository read");
    // The carrier of P01 cannot be held to an inventory that was not read.
    expect(outcome.output).toContain(`depot ${SELF} is not in ecosystem/repositories.v1.yaml`);
    expect(outcome.exitCode).toBe(1);
  });

  test("source: nothing staged, so the directory is empty, and that is a failure", () => {
    const root = join(workspace, "unstaged");
    mkdirSync(root);
    plantTree(root);
    git(root, "init", "--quiet");
    const outcome = judge(root);
    expect(outcome.output).toContain("ecosystem/produits/: no fiche is tracked");
    expect(outcome.exitCode).toBe(1);
  });

  test("source: not a git repository", () => {
    const root = join(workspace, "no-git");
    mkdirSync(root);
    plantTree(root);
    const outcome = judge(root);
    expect(outcome.output).toContain("ecosystem/produits/: the index could not be listed");
    expect(outcome.exitCode).toBe(1);
  });

  test("an untracked file under the root is not part of the catalogue", () => {
    const root = freshTree("untracked");
    write(root, "ecosystem/produits/P09.v1.yaml", fiche("P09", "connaissance", null));
    write(root, "ecosystem/produits/.DS_Store", "x");
    const outcome = judge(root);
    expect(outcome.output).toContain("Product catalogue verified:");
    expect(outcome.output).toContain("3 fiche(s) read");
    expect(outcome.exitCode).toBe(0);
  });

  test("a fiche removed from the index is a missing product, and the counters still sum", () => {
    const root = freshTree("missing");
    git(root, "rm", "--quiet", "--cached", "ecosystem/produits/P02.v1.yaml");
    const outcome = judge(root);
    expect(outcome.output).toContain("Product catalogue: P02: in the catalogue of ADR-0042 §1");
    expect(outcome.output).toContain("= 2 with a fiche + 1 missing; 2 fiche(s) read = 2 valid + 0");
    expect(outcome.exitCode).toBe(1);
  });

  test("a fiche changed on disk and not staged is refused: the gate judges what git tracks", () => {
    const root = freshTree("drift");
    write(root, "ecosystem/produits/P02.v1.yaml", fiche("P02", "connaissance", SELF));
    const outcome = judge(root);
    expect(outcome.output).toContain(
      "ecosystem/produits/P02.v1.yaml: its working copy differs from the index",
    );
    expect(outcome.exitCode).toBe(1);
  });

  test("an offre on a product the list of hosted offers does not name reaches the exit code", () => {
    const root = freshTree("offer-unlisted");
    write(root, "ecosystem/produits/P03.v1.yaml", fiche("P03", "collaboration", null, OFFRE));
    git(root, "add", "--all");
    const outcome = judge(root);
    expect(outcome.output).toContain(
      `ecosystem/produits/P03.v1.yaml: offre is written, and ${HOSTED_OFFERS_PATH} does not list P03`,
    );
    expect(outcome.output).toMatch(/Product catalogue failed: 1 of [0-9]+ assertion/);
    expect(outcome.exitCode).toBe(1);
  });

  test("« gratuit » in a text of an offre reaches the exit code", () => {
    const root = freshTree("offer-word");
    write(
      root,
      "ecosystem/produits/P02.v1.yaml",
      fiche("P02", "connaissance", null, { ...OFFRE, sans_frais: "Le logiciel est gratuit." }),
    );
    git(root, "add", "--all");
    const outcome = judge(root);
    expect(outcome.output).toContain(
      "ecosystem/produits/P02.v1.yaml: offre.sans_frais says « gratuit »",
    );
    expect(outcome.exitCode).toBe(1);
  });

  // The list is read from the tree judged: removed, no product has a hosted
  // offer the gate can name, and that is a failure, not an empty list.
  test("the list of hosted offers removed is a named failure, not zero product listed", () => {
    const root = freshTree("offer-list-removed");
    // Staged and never committed: git removes it from the index and the disk only when forced.
    git(root, "rm", "--quiet", "--force", HOSTED_OFFERS_PATH);
    const outcome = judge(root);
    expect(outcome.output).toContain(`${HOSTED_OFFERS_PATH}: unreadable (`);
    expect(outcome.output).toContain(`sources: ${HOSTED_OFFERS_PATH} is not in the index`);
    expect(outcome.output).toContain(`${HOSTED_OFFERS_PATH} does not list P02`);
    expect(outcome.exitCode).toBe(1);
  });

  // One probe per declared source: a list of sources that forgot one of them
  // would leave that one read on disk and attested as indexed.
  test.each(SOURCES)("the source %s changed on disk and not staged is refused", (source) => {
    const root = freshTree(`source-drift-${SOURCES.indexOf(source)}`);
    // A line break at the end: the content differs, and nothing else fails.
    appendFileSync(join(root, source), "\n");
    const outcome = judge(root);
    expect(outcome.output).toContain(`${source}: its working copy differs from the index`);
    expect(outcome.output).toMatch(/Product catalogue failed: 1 of [0-9]+ assertion/);
    expect(outcome.exitCode).toBe(1);
  });

  test.each(
    SOURCES,
  )("the source %s tracked as a symbolic link is refused, not read through the link", (source) => {
    const root = freshTree(`source-link-${SOURCES.indexOf(source)}`);
    replaceByTrackedLink(root, source);
    const outcome = judge(root);
    expect(outcome.output).toContain(`sources: ${source} is tracked as a symbolic link`);
    expect(outcome.exitCode).toBe(1);
  });

  test.each([
    INVENTORY,
    SCHEMA,
    HOSTED_OFFERS_PATH,
  ])("the source %s on disk and absent from the index is refused", (source) => {
    const root = freshTree(`source-untracked-${SOURCES.indexOf(source)}`);
    git(root, "rm", "--quiet", "--cached", source);
    const outcome = judge(root);
    expect(outcome.output).toContain(`sources: ${source} is not in the index`);
    expect(outcome.exitCode).toBe(1);
  });

  test.each([
    ["indented", "  | Collaboration | P04 quatre |"],
    ["written without its leading bar", "Collaboration | P04 quatre |"],
    ["a list item naming a product no row lists", "- P04 quatre"],
  ])("a catalogue line that is %s is a failure, not a product left out", (_name, line) => {
    const root = freshTree(`unread-${_name.replaceAll(/[^a-z]+/g, "-")}`);
    write(
      root,
      CATALOGUE_ADR,
      `### 1. Le catalogue d'applications\n\n| Domaine | Produits |\n| --- | --- |\n| Connaissance | P01 un · P02 deux |\n| Collaboration | P03 trois |\n${line}\n`,
    );
    git(root, "add", "--all");
    const outcome = judge(root);
    expect(outcome.output).toContain(
      `catalogue of ADR-0042 §1: catalogue line(s) not read: line 7 « ${line.trim()} »`,
    );
    expect(outcome.exitCode).toBe(1);
  });

  test("an unmerged fiche is counted apart, and the tracked paths still sum", () => {
    const root = freshTree("unmerged");
    const path = "ecosystem/produits/P02.v1.yaml";
    const blob = run(["git", "hash-object", "-w", path], root).output.trim();
    expect(blob).toMatch(/^[0-9a-f]{40,64}$/);
    // The merged entry is removed, then the three stages of a conflict are written.
    const stages = [1, 2, 3].map((stage) => `100644 ${blob} ${stage}\t${path}\n`).join("");
    const written = run(["git", "update-index", "--index-info"], root, {
      input: `0 ${"0".repeat(blob.length)}\t${path}\n${stages}`,
    });
    expect(written).toEqual({ exitCode: 0, output: "" });
    const outcome = judge(root);
    expect(outcome.output).toContain("ecosystem/produits/: unmerged path(s)");
    expect(outcome.output).toContain("P02.v1.yaml");
    expect(outcome.output).toContain(
      "4 tracked path(s) under ecosystem/produits/ = 2 fiche(s) + 1 README + 0 refused + 1 unmerged",
    );
    expect(outcome.exitCode).toBe(1);
  });

  describe("the repository judged is the one the gate is run in", () => {
    const redirectedTo = (other: string): Record<string, string> => ({
      GIT_DIR: join(other, ".git"),
      GIT_INDEX_FILE: join(other, ".git", "index"),
    });

    test("GIT_DIR and GIT_INDEX_FILE set to an empty repository do not turn a green tree red", () => {
      const root = freshTree("redirect-from-green");
      const other = join(workspace, "redirect-empty");
      mkdirSync(other);
      git(other, "init", "--quiet");
      const outcome = judge(root, redirectedTo(other));
      expect(outcome.output).toContain("Product catalogue verified:");
      expect(outcome.exitCode).toBe(0);
    });

    test("GIT_DIR and GIT_INDEX_FILE set to a complete repository do not turn a red tree green", () => {
      // Same bytes on disk in both trees; only the index of the judged one lacks a fiche.
      const root = freshTree("redirect-from-red");
      git(root, "rm", "--quiet", "--cached", "ecosystem/produits/P02.v1.yaml");
      const complete = freshTree("redirect-complete");
      const outcome = judge(root, redirectedTo(complete));
      expect(outcome.output).toContain("Product catalogue: P02: in the catalogue of ADR-0042 §1");
      expect(outcome.exitCode).toBe(1);
    });

    // `GIT_WORK_TREE` alone keeps the index of the tree judged and moves the
    // root git resolves paths from. Set to the directory above, every path of
    // the index falls outside the prefix git computes for the tree judged:
    // the listing came back empty, and a green tree had no fiche.
    test("GIT_WORK_TREE set to the directory above does not empty the listing of a green tree", () => {
      const root = freshTree("worktree-from-green");
      const outcome = judge(root, { GIT_WORK_TREE: workspace });
      expect(outcome.output).toContain("Product catalogue verified:");
      expect(outcome.output).toContain("3 fiche(s) read = 3 valid + 0 in violation");
      expect(outcome.exitCode).toBe(0);
    });
  });

  // The promise « a line of the catalogue the reader cannot read is a failure »,
  // on the forms that were green: each one added a product without a fiche.
  describe("a line of the catalogue section that is not read in full is a failure", () => {
    const HEAD =
      "### 1. Le catalogue d'applications\n\n| Domaine | Produits |\n| --- | --- |\n| Connaissance | P01 un · P02 deux |\n| Collaboration | P03 trois |\n";
    const judged = (name: string, tail: string): Run => {
      const root = freshTree(`f1-${name}`);
      write(root, CATALOGUE_ADR, `${HEAD}${tail}`);
      git(root, "add", "--all");
      return judge(root);
    };

    test("a table under a sub-title of the section adds its product to the catalogue", () => {
      const outcome = judged("sub-title", "\n#### Ajouts\n\n| Collaboration | P41 truc |\n");
      // The product needs a fiche…
      expect(outcome.output).toContain(
        "Product catalogue: P41: in the catalogue of ADR-0042 §1, and no fiche",
      );
      expect(outcome.output).toContain(
        "4 product(s) in the catalogue of ADR-0042 §1 = 3 with a fiche + 1 missing",
      );
      // …and the reader of the brick map, which stops at the sub-title, is named with the line.
      expect(outcome.output).toContain(
        "catalogue line(s) not read: line 10 « | Collaboration | P41 truc | »: P41 is read by this gate and not by the reader of the brick map",
      );
      expect(outcome.exitCode).toBe(1);
    });

    test.each([
      ["blank", "| Collaboration | P 41 truc |"],
      ["three-digits", "| Collaboration | P100 truc |"],
      ["lower-case", "| Collaboration | p41 truc |"],
      ["hyphen", "| Collaboration | P-41 truc |"],
      ["suffix", "| Collaboration | P41bis truc |"],
      ["one-digit", "| Collaboration | P4 truc |"],
      ["no-identifier", "| Collaboration | truc sans identifiant |"],
      ["new-domain", "| Domaine nouveau | truc sans identifiant |"],
    ])("an identifier or a row of another form (%s) is named with its line", (name, line) => {
      const outcome = judged(name, `${line}\n`);
      expect(outcome.output).toContain(
        `catalogue of ADR-0042 §1: catalogue line(s) not read: line 7 « ${line} »: `,
      );
      // The three products read in full are still counted: the volume is printed.
      expect(outcome.output).toContain(
        "Product catalogue volume: 3 product(s) in the catalogue of ADR-0042 §1 = 3 with a fiche + 0 missing",
      );
      expect(outcome.output).toMatch(/Product catalogue failed: 1 of [0-9]+ assertion/);
      expect(outcome.exitCode).toBe(1);
    });

    // The row is refused for its domain, whatever its cell of products holds;
    // the reader of the brick map still reads the identifier, so the product
    // is in the catalogue and has no fiche.
    test("a row of a new domain with a well-formed identifier is named with its line", () => {
      const line = "| Domaine nouveau | P41 truc |";
      const outcome = judged("new-domain-identifier", `${line}\n`);
      expect(outcome.output).toContain(
        `catalogue line(s) not read: line 7 « ${line} »: « Domaine nouveau » is not a domain the category table maps`,
      );
      expect(outcome.output).toContain(
        "P41: read by the reader of the brick map, and in no row this gate read in full",
      );
      expect(outcome.output).toContain(
        "Product catalogue: P41: in the catalogue of ADR-0042 §1, and no fiche",
      );
      expect(outcome.exitCode).toBe(1);
    });
  });

  // The schema is read from the tree judged. It was compiled while the module
  // loaded: unreadable, the process died on an exception, without a line of
  // the gate and without a counter.
  describe("a schema that cannot be read is a failure the gate names, with its counters", () => {
    const expectNamed = (outcome: Run, reason: string): void => {
      expect(outcome.output).toContain(`Product catalogue: ${SCHEMA}: unreadable (${reason}`);
      expect(outcome.output).toContain(
        `ecosystem/produits/P01.v1.yaml: not judged: ${SCHEMA} is unreadable`,
      );
      expect(outcome.output).toContain(
        "Product catalogue volume: 3 product(s) in the catalogue of ADR-0042 §1 = 3 with a fiche + 0 missing; 3 fiche(s) read = 0 valid + 3 in violation",
      );
      expect(outcome.output).toContain(
        "carrier: 0 with a depot + 0 without + 3 not decidable (schema not held) = 3",
      );
      expect(outcome.output).toMatch(/Product catalogue failed: [0-9]+ of [0-9]+ assertion/);
      expect(outcome.exitCode).toBe(1);
    };

    test("an empty schema", () => {
      const root = freshTree("schema-empty");
      write(root, SCHEMA, "");
      git(root, "add", "--all");
      expectNamed(judge(root), "the file is empty)");
    });

    test("a schema that is not JSON", () => {
      const root = freshTree("schema-not-json");
      write(root, SCHEMA, "{ type: object\n");
      git(root, "add", "--all");
      expectNamed(judge(root), "not JSON (");
    });

    test("a directory in place of the schema", () => {
      const root = freshTree("schema-directory");
      unlinkSync(join(root, SCHEMA));
      write(root, `${SCHEMA}/inside.json`, "{}\n");
      git(root, "add", "--all");
      const outcome = judge(root);
      expectNamed(outcome, "EISDIR");
      expect(outcome.output).toContain(`sources: ${SCHEMA} is not in the index`);
    });
  });

  test("a fiche that is a symbolic link is refused as a link, not read as its target", () => {
    const root = freshTree("link");
    const path = join(root, "ecosystem/produits/P03.v1.yaml");
    const target = join(root, "P03.v1.yaml");
    copyFileSync(path, target);
    unlinkSync(path);
    symlinkSync(target, path);
    git(root, "add", "--all");
    const outcome = judge(root);
    expect(outcome.output).toContain("P03.v1.yaml (link)");
    expect(outcome.output).toContain("Product catalogue: P03: in the catalogue");
    expect(outcome.output).toContain("1 README + 1 refused + 0 unmerged");
    expect(outcome.exitCode).toBe(1);
  });

  test("a rule violation reaches the exit code, with the volume it was found in", () => {
    const root = freshTree("violation");
    write(root, "ecosystem/produits/P03.v1.yaml", fiche("P03", "connaissance", null));
    git(root, "add", "--all");
    const outcome = judge(root);
    expect(outcome.output).toContain(
      "categorie is « connaissance », ADR-0042 §1 lists P03 under « Collaboration » (collaboration)",
    );
    expect(outcome.output).toContain("3 fiche(s) read = 2 valid + 1 in violation");
    expect(outcome.output).toMatch(
      /Product catalogue failed: 1 of [0-9]+ assertion\(s\) did not hold\./,
    );
    expect(outcome.exitCode).toBe(1);
  });
});
