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

import { FICHE_SECTIONS, LAYERS, SCHEMA_VERSION } from "./briques";

/**
 * The brick-map gate run as a process, against a real tree.
 *
 * WHY A PROCESS. `briques.test.ts` judges a map held in memory: it proves the
 * rules, and nothing about the half that reads the disk. Whether a symbolic
 * link is seen as a link, whether an unreadable doctrine file becomes a
 * failure, whether the name of the repository is derived from the remote, and
 * whether a violation reaches the exit code are all decided in
 * `check-briques.ts`. These probes run that file.
 *
 * WHY A SCRUBBED ENVIRONMENT. A child inheriting `GIT_DIR` or a global git
 * configuration would read another remote than the fixture's, and
 * `GATE_VERBOSE` would change the output: each child gets only what it declares.
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
      JSON.stringify({ schema_version: SCHEMA_VERSION, couche: layer.slug, briques: [brick] }),
    );
    const sections = FICHE_SECTIONS.map((title) => `## ${title}\n\nTexte.`).join("\n\n");
    write(
      root,
      `ecosystem/briques/${layer.slug}/${id}.md`,
      `# ${id} — Brique ${id}\n\n${sections}\n`,
    );
  }
}

let workspace: string;

function freshTree(name: string, origin: string | null = ORIGIN): string {
  const root = join(workspace, name);
  mkdirSync(root);
  plantTree(root);
  expect(run(["git", "init", "--quiet"], root).exitCode).toBe(0);
  if (origin !== null) {
    expect(run(["git", "remote", "add", "origin", origin], root).exitCode).toBe(0);
  }
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
    expect(outcome.output).toContain(`${LAYERS.length} on this tree, 0 pinned`);
    expect(outcome.output).toContain(
      "2 in the catalogue of ADR-0042 §1 = 1 as bricks + 1 outside the map",
    );
    expect(outcome.exitCode).toBe(0);
  });

  test("a fiche that is a symbolic link is refused as a link, not read as its target", () => {
    const root = freshTree("link");
    const fiche = join(root, "ecosystem/briques/preuve/PRV-01.md");
    const target = join(root, "PRV-01.md");
    copyFileSync(fiche, target);
    unlinkSync(fiche);
    symlinkSync(target, fiche);
    const outcome = judge(root);
    expect(outcome.output).toContain("preuve/PRV-01.md (link)");
    expect(outcome.output).toContain("Brick map volume:");
    expect(outcome.exitCode).toBe(1);
  });

  test("a layer file removed from the tree is a failure, with the volume it was found in", () => {
    const root = freshTree("missing");
    unlinkSync(join(root, "ecosystem/briques/identite.v1.yaml"));
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

  test("a proof target absent from the tree is a failure", () => {
    const root = freshTree("absent");
    unlinkSync(join(root, "docs/proof.md"));
    const outcome = judge(root);
    expect(outcome.output).toContain("proof target docs/proof.md does not exist");
    expect(outcome.exitCode).toBe(1);
  });
});
