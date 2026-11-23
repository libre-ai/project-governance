import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * La commande est exercée comme le processus qu'elle est : ses codes de sortie ne s'observent
 * que de l'extérieur. Aucun test ne configure un juge joignable : aucun appel réseau.
 */

const LANCER = join(import.meta.dir, "lancer.ts");
const CORPUS = join(import.meta.dir, "corpus");
const racines: string[] = [];

afterAll(() => {
  for (const racine of racines) rmSync(racine, { recursive: true, force: true });
});

function dossier(): string {
  const racine = mkdtempSync(join(tmpdir(), "entonnoir-test-"));
  racines.push(racine);
  return racine;
}

interface Issue {
  readonly code: number;
  readonly sortie: string;
  readonly erreur: string;
}

function lancer(...args: string[]): Issue {
  const run = Bun.spawnSync(["bun", LANCER, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "" },
  });
  return {
    code: run.exitCode ?? -1,
    sortie: run.stdout.toString(),
    erreur: run.stderr.toString(),
  };
}

describe("critères 5, 7 et 8 — le corpus de démonstration, sans juge", () => {
  test("la mesure sort en 0, imprime son volume et vaut unavailable pour chaque cas accepté", () => {
    const resultats = join(dossier(), "resultats.jsonl");
    const issue = lancer(join(CORPUS, "cas.json"), resultats);
    expect(issue.erreur).toBe("");
    expect(issue.code).toBe(0);
    expect(issue.sortie).toContain("cas lus : 6");
    expect(issue.sortie).toContain("somme 6/6");
    expect(issue.sortie).toContain("unavailable 3 (aucun juge configuré)");
    expect(issue.sortie).toContain("réussis 0");
    const lignes = readFileSync(resultats, "utf8").trim().split("\n");
    expect(lignes).toHaveLength(6);
    const etats = lignes.map(
      (ligne) => (JSON.parse(ligne) as { signal: { etat: string } }).signal.etat,
    );
    expect(etats.filter((etat) => etat === "unavailable")).toHaveLength(3);
    expect(etats).not.toContain("reussi");
  });
});

describe("critère 7 — une source illisible est un échec, jamais zéro", () => {
  test.each([
    ["absente", null],
    ["en JSON invalide", "{ pas du json"],
    ["sans cas", '{ "cas": [] }'],
    [
      "aux contrôles inconnus",
      '{ "cas": [{ "id": "a", "controles": "inconnu", "sortie": {}, "candidat": { "modele": "m", "version": "1", "famille": "f" } }] }',
    ],
  ])("une source %s sort en 2 sans écrire de résultat", (_nom, contenu) => {
    const racine = dossier();
    const source = join(racine, "cas.json");
    if (contenu !== null) writeFileSync(source, contenu);
    const resultats = join(racine, "resultats.jsonl");
    const issue = lancer(source, resultats);
    expect(issue.code).toBe(2);
    expect(issue.sortie).toBe("");
    expect(existsSync(resultats)).toBe(false);
  });
});

describe("critère 6 et usage — refus avant tout appel", () => {
  const juge = ["--juge-modele", "m", "--juge-version", "1", "--juge-famille", "fam-b"];

  test("une URL de juge non locale sort en 2", () => {
    const resultats = join(dossier(), "resultats.jsonl");
    const issue = lancer(
      join(CORPUS, "cas.json"),
      resultats,
      "--juge-url",
      "https://api.exemple.invalid",
      ...juge,
    );
    expect(issue.code).toBe(2);
    expect(issue.erreur).toContain("seule une URL locale");
    expect(existsSync(resultats)).toBe(false);
  });

  test("une identité de juge incomplète sort en 2", () => {
    const issue = lancer(
      join(CORPUS, "cas.json"),
      join(dossier(), "r.jsonl"),
      "--juge-url",
      "http://127.0.0.1:9",
    );
    expect(issue.code).toBe(2);
  });

  test("une qualification sans juge sort en 2", () => {
    const issue = lancer(
      join(CORPUS, "cas.json"),
      join(dossier(), "r.jsonl"),
      "--qualification",
      join(CORPUS, "qualification.json"),
    );
    expect(issue.code).toBe(2);
  });
});
