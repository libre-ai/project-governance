import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
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

import { SCHEMA_VERSION } from "./produits";

/**
 * The product-catalogue gate run as a process, against a real repository.
 *
 * WHY A PROCESS. `produits.test.ts` judges a catalogue held in memory: it
 * proves the rules, and nothing about the half that reads git and the disk.
 * Whether a missing decision record, an unparsable catalogue table or an
 * absent inventory becomes a failure and not a zero, whether an untracked
 * fiche is left out, whether a link is seen as a link, and whether a violation
 * reaches the exit code are all decided in `check-produits.ts`. These probes
 * run that file.
 *
 * WHY A DECLARED ENVIRONMENT. A child inheriting `GIT_DIR`, `GIT_INDEX_FILE`
 * or a global git configuration would read another index than the fixture's,
 * and `GATE_VERBOSE` would change the output: each child gets only what is
 * declared here.
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

interface Run {
  readonly exitCode: number;
  readonly output: string;
}

function run(argv: readonly string[], cwd: string): Run {
  const result = Bun.spawnSync([...argv], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: ENVIRONMENT,
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

function fiche(id: string, categorie: string, depot: string | null): string {
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
  write(root, "ecosystem/produits/P01.v1.yaml", fiche("P01", "connaissance", SELF));
  write(root, "ecosystem/produits/P02.v1.yaml", fiche("P02", "connaissance", null));
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

const judge = (root: string): Run => run([process.execPath, GATE], root);

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "check-produits-"));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("check-produits as a process", () => {
  test("control: the planted tree is green, and the volume names what was read", () => {
    const outcome = judge(freshTree("control"));
    expect(outcome.output).toContain("Product catalogue verified: 8 assertion(s) hold");
    expect(outcome.output).toContain(
      "3 product(s) in the catalogue of ADR-0042 §1 = 3 with a fiche + 0 missing",
    );
    expect(outcome.output).toContain("3 fiche(s) read = 3 valid + 0 in violation");
    expect(outcome.output).toContain(
      "carrier: 1 with a depot + 2 without + 0 not decidable (schema not held) = 3",
    );
    expect(outcome.output).toContain("6 a_relire field(s) on 3 fiche(s)");
    expect(outcome.output).toContain(
      "4 tracked entry(ies) under ecosystem/produits/ = 3 fiche(s) + 1 README + 0 refused",
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

  test("a source changed on disk and not staged is refused", () => {
    const root = freshTree("source-drift");
    write(root, INVENTORY, `repositories:\n  - repository: ${SELF}\n    visibility: private\n`);
    const outcome = judge(root);
    expect(outcome.output).toContain(
      "sources: ecosystem/repositories.v1.yaml: its working copy differs from the index",
    );
    expect(outcome.exitCode).toBe(1);
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
    expect(outcome.output).toContain("1 README + 1 refused");
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
    expect(outcome.output).toContain("Product catalogue failed: 1 of 8 assertion(s) did not hold.");
    expect(outcome.exitCode).toBe(1);
  });
});
