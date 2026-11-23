import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * La commande est exercée comme le processus qu'elle est : ses codes de sortie ne s'observent
 * que de l'extérieur. Aucun appel ne quitte la machine : le seul juge joignable est un serveur
 * local lancé par le test, qui compte les appels qu'il reçoit.
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
    [
      "aux contrôles hérités du prototype",
      '{ "cas": [{ "id": "a", "controles": "toString", "sortie": {}, "candidat": { "modele": "m", "version": "1", "famille": "f" } }] }',
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

describe("sortie impossible à écrire", () => {
  test("une sortie dans un répertoire absent sort en 2, sans bilan ni trace de pile", () => {
    const resultats = join(dossier(), "absent", "resultats.jsonl");
    const issue = lancer(join(CORPUS, "cas.json"), resultats);
    expect(issue.code).toBe(2);
    expect(issue.erreur).toContain("écriture impossible");
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

  test("un juge de la famille du candidat est refusé avant la qualification : aucun appel", async () => {
    // Le serveur compte les appels ; une qualification lancée avant le refus en ferait cinq,
    // et le refus de la mesure qui suit rendrait quand même 2 : seul le compte distingue.
    let recus = 0;
    const serveur = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        recus += 1;
        return new Response("panne", { status: 503 });
      },
    });
    try {
      const resultats = join(dossier(), "r.jsonl");
      // Asynchrone : le serveur vit dans ce processus et doit répondre pendant la commande.
      const run = Bun.spawn(
        [
          "bun",
          LANCER,
          join(CORPUS, "cas.json"),
          resultats,
          "--juge-url",
          `http://127.0.0.1:${serveur.port}`,
          "--juge-modele",
          "autre",
          "--juge-version",
          "1",
          "--juge-famille",
          "famille-fictive-a",
          "--qualification",
          join(CORPUS, "qualification.json"),
        ],
        { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "" } },
      );
      const code = await run.exited;
      expect(code).toBe(2);
      expect(await new Response(run.stderr).text()).toContain("un juge d'une autre famille");
      expect(recus).toBe(0);
      expect(existsSync(resultats)).toBe(false);
    } finally {
      serveur.stop(true);
    }
  });

  test("un proxy d'environnement est refusé : ni le proxy ni le juge ne reçoivent rien", async () => {
    // Le `fetch` de Bun enverrait l'invite au proxy même vers 127.0.0.1 ; le proxy est ici un
    // serveur local qui compte ce qu'il reçoit.
    let recusProxy = 0;
    let recusJuge = 0;
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        recusProxy += 1;
        return new Response("proxy", { status: 502 });
      },
    });
    const serveurJuge = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        recusJuge += 1;
        return new Response("panne", { status: 503 });
      },
    });
    try {
      const resultats = join(dossier(), "r.jsonl");
      const run = Bun.spawn(
        [
          "bun",
          LANCER,
          join(CORPUS, "cas.json"),
          resultats,
          "--juge-url",
          `http://127.0.0.1:${serveurJuge.port}`,
          ...juge,
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: { PATH: process.env.PATH ?? "", http_proxy: `http://127.0.0.1:${proxy.port}` },
        },
      );
      const code = await run.exited;
      expect(code).toBe(2);
      expect(await new Response(run.stderr).text()).toContain("un proxy est défini (http_proxy)");
      expect(recusProxy).toBe(0);
      expect(recusJuge).toBe(0);
      expect(existsSync(resultats)).toBe(false);
    } finally {
      proxy.stop(true);
      serveurJuge.stop(true);
    }
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
