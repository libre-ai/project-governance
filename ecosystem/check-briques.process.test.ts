import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { FICHE_SECTIONS, LAYERS, SCHEMA_VERSION } from "./briques";

/**
 * The brick-map gate run as a process, against a real repository.
 *
 * WHY A PROCESS. `briques.test.ts` judges a map held in memory: it proves the
 * rules, and nothing about the half that reads git and the disk. Whether a
 * symbolic link is seen as a link, whether a proof target is a tracked file
 * and not merely something `existsSync` finds, whether an unreadable doctrine
 * file becomes a failure, whether the name of the repository is derived from
 * the remote, and whether a violation reaches the exit code are all decided in
 * `check-briques.ts`. These probes run that file.
 *
 * WHY A SCRUBBED ENVIRONMENT. A child inheriting `GIT_DIR`, `GIT_INDEX_FILE`
 * or a global git configuration would read another index or another remote
 * than the fixture's, and `GATE_VERBOSE` would change the output: each child
 * gets only what it declares.
 */

const GATE = join(import.meta.dir, "check-briques.ts");
const REPOSITORY_ROOT = join(import.meta.dir, "..");
const ORIGIN = "https://github.com/libre-ai/project-governance";
const SELF = "libre-ai/project-governance";

const ENVIRONMENT = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

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

/** The first other layer a layer may depend on, so every table row is exercised once. */
function dependencyOf(slug: string): string[] {
  const layer = LAYERS.find((candidate) => candidate.slug === slug);
  const target = LAYERS.find((candidate) => candidate.slug === layer?.mayDependOn[0]);
  return target === undefined ? [] : [`${target.prefix}-01`];
}

/** A tree the gate accepts: one brick per layer, and the doctrine files it cites. */
function plantTree(root: string): void {
  write(
    root,
    "docs/decisions/INVARIANTS.md",
    "| ID | Invariant |\n| --- | --- |\n| I-08 | Preuve |\n",
  );
  write(
    root,
    "docs/decisions/DECISION-REGISTER.md",
    "| ID | Decision |\n| --- | --- |\n| D01 | Une |\n",
  );
  write(
    root,
    "docs/adr/0042-catalogue.md",
    "## Décision\n\n### 1. Le catalogue d'applications\n\n| Domaine | Produits |\n| --- | --- |\n| A | P01 un · P02 deux |\n",
  );
  write(root, "docs/adr/0064-carte.md", "# ADR-0064\n");
  write(
    root,
    "ecosystem/repositories.v1.yaml",
    `repositories:\n  - repository: ${SELF}\n    visibility: public\n`,
  );
  write(root, "docs/proof.md", "# Une preuve\n");
  // The real configuration of the citations gate: its reader validates the
  // whole file, so a hand-made one would test this fixture, not the gate.
  mkdirSync(join(root, "tools/quality"), { recursive: true });
  copyFileSync(
    join(REPOSITORY_ROOT, "tools/quality/pinned-citations.v1.json"),
    join(root, "tools/quality/pinned-citations.v1.json"),
  );

  for (const layer of LAYERS) {
    const id = `${layer.prefix}-01`;
    const brick: Record<string, unknown> = {
      id,
      nom: `Brique ${id}`,
      role: "Fait une chose, vérifiable par un tiers.",
      depend_de: dependencyOf(layer.slug),
      invariants: ["I-08"],
      decisions: ["ADR-0064", "D01"],
      depots: [SELF],
      origine: { type: "propre" },
      autonomie: layer.slug === "gouvernance" ? "discover" : "modify",
      preuve: [{ date: "2026-10-10", cible: "docs/proof.md" }],
    };
    if (layer.slug === "fabrique") brick.preuve_produite = "Le verdict des gates sur la tête.";
    if (layer.slug === "produit") {
      brick.charte = {
        valeur: "Faire une chose pour quelqu'un.",
        pour_qui: "Une personne nommée.",
        degel: "Une release signée liée à son évidence.",
        abandon: "Le seuil fixé n'est pas tenu sur un corpus réel.",
        refus: ["Stocker une donnée de paiement."],
      };
    }
    // JSON is YAML: the layer file is written without a YAML serialiser.
    write(
      root,
      `ecosystem/briques/${layer.slug}.v1.yaml`,
      JSON.stringify(
        { schema_version: SCHEMA_VERSION, couche: layer.slug, briques: [brick] },
        null,
        2,
      ),
    );
    const sections = FICHE_SECTIONS.map((title) => `## ${title}\n\nTexte.`).join("\n\n");
    const cited = [...dependencyOf(layer.slug), "I-08", "ADR-0064", "D01"].join(", ");
    write(
      root,
      `ecosystem/briques/${layer.slug}/${id}.md`,
      `# ${id} — Brique ${id}\n\n${sections}\n\nCite : ${cited}.\n`,
    );
  }
}

/** Point the proof of one layer at another target, in the working copy. */
function retarget(root: string, slug: string, cible: string): void {
  const path = join(root, `ecosystem/briques/${slug}.v1.yaml`);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace('"cible": "docs/proof.md"', `"cible": "${cible}"`));
}

let workspace: string;

/** A committed-to-the-index fixture: the gate reads what git tracks. */
function freshTree(name: string, origin: string | null = ORIGIN): string {
  const root = join(workspace, name);
  mkdirSync(root);
  plantTree(root);
  git(root, "init", "--quiet");
  if (origin !== null) git(root, "remote", "add", "origin", origin);
  git(root, "add", "--all");
  return root;
}

const judge = (root: string): Run => run([process.execPath, GATE], root);

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "check-briques-"));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("check-briques as a process", () => {
  test("control: the planted tree is green, and the volume names what was read", () => {
    const outcome = judge(freshTree("control"));
    expect(outcome.output).toContain("Brick map verified:");
    expect(outcome.output).toContain(
      `${LAYERS.length} brick(s) in ${LAYERS.length} of ${LAYERS.length} layer file(s)`,
    );
    expect(outcome.output).toContain(
      `${LAYERS.length * 2} tracked entry(ies) under ecosystem/briques/ = ${LAYERS.length} layer file(s) + ${LAYERS.length} fiche(s) + 0 README + 0 refused`,
    );
    expect(outcome.output).toContain(`${LAYERS.length} on this tree, 0 pinned`);
    expect(outcome.output).toContain(
      "2 in the catalogue of ADR-0042 §1 = 1 as bricks + 1 outside the map",
    );
    expect(outcome.exitCode).toBe(0);
  });

  test("an untracked file under the map is not part of the map", () => {
    const root = freshTree("untracked");
    write(root, "ecosystem/briques/.DS_Store", "x");
    write(root, "ecosystem/briques/preuve/notes.txt", "x");
    const outcome = judge(root);
    expect(outcome.output).toContain("Brick map verified:");
    expect(outcome.exitCode).toBe(0);
  });

  test("nothing staged: the map is empty, and that is a failure", () => {
    const root = join(workspace, "unstaged");
    mkdirSync(root);
    plantTree(root);
    git(root, "init", "--quiet");
    git(root, "remote", "add", "origin", ORIGIN);
    const outcome = judge(root);
    expect(outcome.output).toContain("ecosystem/briques/gouvernance.v1.yaml: layer file missing");
    expect(outcome.output).toContain("0 tracked entry(ies) under ecosystem/briques/");
    expect(outcome.exitCode).toBe(1);
  });

  test("a fiche that is a symbolic link is refused as a link, not read as its target", () => {
    const root = freshTree("link");
    const fiche = join(root, "ecosystem/briques/preuve/PRV-01.md");
    const target = join(root, "PRV-01.md");
    copyFileSync(fiche, target);
    unlinkSync(fiche);
    symlinkSync(target, fiche);
    git(root, "add", "--all");
    const outcome = judge(root);
    expect(outcome.output).toContain("preuve/PRV-01.md (link)");
    expect(outcome.output).toContain("Brick map volume:");
    expect(outcome.exitCode).toBe(1);
  });

  test("the map itself tracked as a symbolic link is refused, not followed", () => {
    const root = freshTree("root-link");
    renameSync(join(root, "ecosystem/briques"), join(root, "ecosystem/briques-real"));
    symlinkSync("briques-real", join(root, "ecosystem/briques"));
    git(root, "add", "--all");
    const outcome = judge(root);
    expect(outcome.output).toContain(". (link)");
    expect(outcome.output).toContain("ecosystem/briques/gouvernance.v1.yaml: layer file missing");
    expect(outcome.exitCode).toBe(1);
  });

  test("a layer file removed from the index is a failure, with the volume it was found in", () => {
    const root = freshTree("missing");
    git(root, "rm", "--quiet", "--cached", "ecosystem/briques/identite.v1.yaml");
    const outcome = judge(root);
    expect(outcome.output).toContain("ecosystem/briques/identite.v1.yaml: layer file missing");
    expect(outcome.output).toContain(`in ${LAYERS.length - 1} of ${LAYERS.length} layer file(s)`);
    expect(outcome.exitCode).toBe(1);
  });

  test("a doctrine file that cannot be read fails by name, it is not zero invariants", () => {
    const root = freshTree("doctrine");
    unlinkSync(join(root, "docs/decisions/INVARIANTS.md"));
    const outcome = judge(root);
    expect(outcome.output).toContain("docs/decisions/INVARIANTS.md: 0 invariant row(s) read");
    expect(outcome.exitCode).toBe(1);
  });

  test("an unreadable decision register fails by name", () => {
    const root = freshTree("register");
    unlinkSync(join(root, "docs/decisions/DECISION-REGISTER.md"));
    const outcome = judge(root);
    expect(outcome.output).toContain("docs/decisions/DECISION-REGISTER.md: 0 decision row(s) read");
    expect(outcome.exitCode).toBe(1);
  });

  test("two files carrying the catalogue number: neither is chosen by directory order", () => {
    const root = freshTree("two-catalogues");
    write(root, "docs/adr/0042-autre.md", "### 1. Le catalogue d'applications\n\n| A | P09 |\n");
    git(root, "add", "docs/adr/0042-autre.md");
    const outcome = judge(root);
    expect(outcome.output).toContain("catalogue of ADR-0042 §1: 0 product(s) read");
    expect(outcome.exitCode).toBe(1);
  });

  test("an untracked decision record is not an ADR a brick may cite", () => {
    const root = freshTree("untracked-adr");
    write(root, "docs/adr/9999-fantome.md", "# ADR-9999\n");
    const layer = join(root, "ecosystem/briques/identite.v1.yaml");
    writeFileSync(layer, readFileSync(layer, "utf8").replace('"ADR-0064"', '"ADR-9999"'));
    const fiche = join(root, "ecosystem/briques/identite/IDN-01.md");
    writeFileSync(fiche, readFileSync(fiche, "utf8").replace("ADR-0064", "ADR-9999"));
    git(root, "add", "ecosystem/briques");
    const outcome = judge(root);
    expect(outcome.output).toContain("IDN-01: cites ADR-9999, which docs/adr/ does not hold");
    expect(outcome.exitCode).toBe(1);
  });

  test("a fiche corrected on disk and not staged is not judged green", () => {
    const root = freshTree("unstaged-fiche");
    const fiche = join(root, "ecosystem/briques/identite/IDN-01.md");
    const staged = readFileSync(fiche, "utf8");
    // Staged with a status, then corrected on disk only: the disk is clean,
    // the index is not, and the gate must not answer for the disk.
    writeFileSync(fiche, staged.replace("Texte.", "Statut : `en_cours`."));
    git(root, "add", "ecosystem/briques");
    writeFileSync(fiche, staged);
    const outcome = judge(root);
    expect(outcome.output).toContain(
      "IDN-01: fiche ecosystem/briques/identite/IDN-01.md: its working copy differs from the index",
    );
    expect(outcome.exitCode).toBe(1);
  });

  test("the map replaced on disk by a link that is not staged is not followed", () => {
    const root = freshTree("root-link-unstaged");
    renameSync(join(root, "ecosystem/briques"), join(root, "ecosystem/briques-real"));
    symlinkSync("briques-real", join(root, "ecosystem/briques"));
    const outcome = judge(root);
    expect(outcome.output).toContain("its working copy differs from the index");
    expect(outcome.exitCode).toBe(1);
  });

  test("a file whose bytes did not change is not refused for its timestamps", () => {
    // The comparison is by content: a touched file, or a tree copied with new
    // timestamps, holds the indexed bytes and is judged.
    const root = freshTree("touched");
    const past = new Date("2020-01-01T00:00:00Z");
    for (const path of [
      "ecosystem/briques/identite/IDN-01.md",
      "ecosystem/briques/identite.v1.yaml",
      "docs/proof.md",
      "docs/decisions/INVARIANTS.md",
    ]) {
      utimesSync(join(root, path), past, past);
    }
    const outcome = judge(root);
    expect(outcome.output).toContain("Brick map verified:");
    expect(outcome.exitCode).toBe(0);
  });

  test.each([
    ["docs/decisions/INVARIANTS.md", "| I-99 | Ajouté sur le disque seulement |\n"],
    ["docs/decisions/DECISION-REGISTER.md", "| D9999 | Ajoutée sur le disque seulement |\n"],
    [
      "ecosystem/repositories.v1.yaml",
      "  - repository: libre-ai/fantome\n    visibility: public\n",
    ],
  ])("the doctrine source %s changed on disk and not staged is refused", (source, added) => {
    const root = freshTree(`doctrine-${source.replaceAll(/[^a-z]+/gi, "-")}`);
    const file = join(root, source);
    writeFileSync(file, `${readFileSync(file, "utf8")}${added}`);
    const outcome = judge(root);
    expect(outcome.output).toContain(
      `doctrine sources: ${source}: its working copy differs from the index`,
    );
    expect(outcome.exitCode).toBe(1);
  });

  test("without an origin remote, a local proof names no carrier", () => {
    const outcome = judge(freshTree("no-origin", null));
    expect(outcome.output).toContain("the name of this repository could not be derived");
    expect(outcome.exitCode).toBe(1);
  });

  test("a remote of another organisation is not this repository", () => {
    const outcome = judge(freshTree("foreign", "https://github.com/someone/project-governance"));
    expect(outcome.output).toContain("the name of this repository could not be derived");
    expect(outcome.exitCode).toBe(1);
  });

  test.each([
    ["a directory", "docs", (_root: string) => {}, "proof target docs is not a tracked file"],
    [
      "a file that exists on disk and is not tracked",
      "scratch.md",
      (root: string) => write(root, "scratch.md", "# brouillon\n"),
      "proof target scratch.md is not a tracked file",
    ],
    [
      "a tracked symbolic link to a file outside the tree",
      "docs/link.md",
      (root: string) => {
        symlinkSync("/etc/hosts", join(root, "docs/link.md"));
        git(root, "add", "docs/link.md");
      },
      "proof target docs/link.md is a symbolic link",
    ],
    [
      "a tracked empty file",
      "docs/empty.md",
      (root: string) => {
        write(root, "docs/empty.md", "");
        git(root, "add", "docs/empty.md");
      },
      "proof target docs/empty.md is an empty file",
    ],
    [
      "a tracked file deleted from the working copy",
      "docs/proof.md",
      (root: string) => unlinkSync(join(root, "docs/proof.md")),
      "proof target docs/proof.md: its working copy differs from the index",
    ],
    [
      "a tracked file replaced on disk by a link out of the tree",
      "docs/proof.md",
      (root: string) => {
        unlinkSync(join(root, "docs/proof.md"));
        symlinkSync("/etc/hosts", join(root, "docs/proof.md"));
      },
      "proof target docs/proof.md: its working copy differs from the index",
    ],
    [
      "the fiche of the brick itself",
      "ecosystem/briques/preuve/PRV-01.md",
      (_root: string) => {},
      "is part of the map itself",
    ],
  ])("a proof target that is %s does not hold", (name, cible, prepare, expected) => {
    const root = freshTree(`target-${name.replaceAll(/[^a-z]+/g, "-")}`);
    prepare(root);
    retarget(root, "preuve", cible);
    // The map is staged again; what `prepare` left unstaged stays so.
    git(root, "add", "ecosystem/briques");
    const outcome = judge(root);
    expect(outcome.output).toContain(expected);
    expect(outcome.exitCode).toBe(1);
  });
});
