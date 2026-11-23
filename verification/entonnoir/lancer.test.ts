import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

/** Juge local qui compte ses appels ; `avant` s'exécute à chaque requête, avant la réponse. */
function jugeLocal(avant: () => void = () => {}) {
  const compte = { recus: 0 };
  const serveur = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      compte.recus += 1;
      avant();
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdicts: { "titre-fidele": true, "actions-explicites": true },
                justification: "trace",
              }),
            },
          },
        ],
      });
    },
  });
  return { serveur, compte };
}

/** La commande avec un juge local, en asynchrone : le serveur vit dans ce processus. */
async function lancerAvecJuge(port: number | undefined, resultats: string): Promise<Issue> {
  const run = Bun.spawn(
    [
      "bun",
      LANCER,
      join(CORPUS, "cas.json"),
      resultats,
      "--juge-url",
      `http://127.0.0.1:${port}`,
      "--juge-modele",
      "m",
      "--juge-version",
      "1",
      "--juge-famille",
      "fam-b",
    ],
    { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "" } },
  );
  const code = await run.exited;
  return {
    code,
    sortie: await new Response(run.stdout).text(),
    erreur: await new Response(run.stderr).text(),
  };
}

describe("fichier de résultats — même contrat que relecture.ts", () => {
  test("une sortie dans un répertoire absent est refusée en 2 avant tout appel", async () => {
    const { serveur, compte } = jugeLocal();
    try {
      const resultats = join(dossier(), "absent", "resultats.jsonl");
      const issue = await lancerAvecJuge(serveur.port, resultats);
      expect(issue.code).toBe(2);
      expect(issue.erreur).toContain("n'existe pas");
      expect(issue.sortie).toBe("");
      expect(compte.recus).toBe(0);
      expect(existsSync(resultats)).toBe(false);
    } finally {
      serveur.stop(true);
    }
  });

  test("un fichier de résultats existant est refusé en 2 avant tout appel, et laissé intact", async () => {
    const { serveur, compte } = jugeLocal();
    try {
      const resultats = join(dossier(), "resultats.jsonl");
      const ancien = '{"id":"ancien"}\n';
      writeFileSync(resultats, ancien);
      const issue = await lancerAvecJuge(serveur.port, resultats);
      expect(issue.code).toBe(2);
      expect(issue.erreur).toContain("existe déjà");
      expect(issue.sortie).toBe("");
      expect(compte.recus).toBe(0);
      expect(readFileSync(resultats, "utf8")).toBe(ancien);
    } finally {
      serveur.stop(true);
    }
  });

  test("un lien pendant à la place du fichier de résultats est refusé en 2 avant tout appel", async () => {
    const { serveur, compte } = jugeLocal();
    try {
      const racine = dossier();
      const resultats = join(racine, "resultats.jsonl");
      symlinkSync(join(racine, "cible-absente"), resultats);
      const issue = await lancerAvecJuge(serveur.port, resultats);
      expect(issue.code).toBe(2);
      expect(issue.erreur).toContain("existe déjà");
      expect(compte.recus).toBe(0);
      expect(existsSync(join(racine, "cible-absente"))).toBe(false);
    } finally {
      serveur.stop(true);
    }
  });

  test("un fichier apparu pendant le run est gardé : sortie 3, mesures sur la sortie standard", async () => {
    const racine = dossier();
    const resultats = join(racine, "resultats.jsonl");
    const autre = "écrit par quelqu'un d'autre\n";
    // Le fichier apparaît après le contrôle de départ, avant l'écriture finale.
    const { serveur, compte } = jugeLocal(() => writeFileSync(resultats, autre));
    try {
      const issue = await lancerAvecJuge(serveur.port, resultats);
      expect(issue.code).toBe(3);
      expect(compte.recus).toBeGreaterThan(0);
      expect(issue.erreur).toContain("mesures ci-dessous");
      expect(issue.erreur).toContain("cas lus : 6");
      const lignes = issue.sortie.trim().split("\n");
      expect(lignes).toHaveLength(6);
      for (const ligne of lignes) expect(() => JSON.parse(ligne)).not.toThrow();
      expect(readFileSync(resultats, "utf8")).toBe(autre);
    } finally {
      serveur.stop(true);
    }
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

  test("le refus d'une URL portant un mot de passe ne le recopie pas sur la sortie d'erreur", () => {
    const resultats = join(dossier(), "resultats.jsonl");
    const issue = lancer(
      join(CORPUS, "cas.json"),
      resultats,
      "--juge-url",
      "http://u:jeton@exemple.invalid:8080",
      ...juge,
    );
    expect(issue.code).toBe(2);
    expect(issue.erreur).toContain("seule une URL locale");
    expect(issue.erreur).not.toContain("jeton");
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

  // Sans exemption : les deux dernières formes laissaient partir l'invite sous Bun 1.4.4 avec
  // une garde qui acceptait no_proxy (mesuré par la revue rev-285-5d4a314).
  test.each([
    ["sans exemption", {}],
    [
      "avec NO_PROXY nommant l'hôte, masqué par no_proxy",
      { NO_PROXY: "127.0.0.1", no_proxy: "example.com" },
    ],
    ["avec No_Proxy en casse mêlée nommant l'hôte", { No_Proxy: "127.0.0.1" }],
  ])("un proxy d'environnement %s est refusé : ni le proxy ni le juge ne reçoivent rien", async (_nom, exemption) => {
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
          env: {
            PATH: process.env.PATH ?? "",
            http_proxy: `http://127.0.0.1:${proxy.port}`,
            ...exemption,
          },
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
