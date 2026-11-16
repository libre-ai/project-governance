import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compareParity, renderParity, runParity } from "./check-bilingual-parity";

// L'attendu de chaque test vient du comportement voulu (ce qu'une traduction doit
// conserver), jamais de la sortie du code.

const FENCE = "```";

function doc(overrides: Partial<Record<string, string>> = {}): string {
  const parts: Record<string, string> = {
    title: "# Specification v1.2.0",
    limits: "## 1. Limits",
    prose:
      "The server MUST reject payloads over 200 bytes. A client SHOULD retry up to 3 times. " +
      "It MAY cache. Buffer: 16 777 216 bytes.",
    table: ["| name | value |", "| --- | --- |", "| a | 1 |", "| b | none |"].join("\n"),
    details: "### 1.1 Details",
    inline: "Use `max_size` and `retry`, then `max_size` again.",
    code: [`${FENCE}json`, '{"a": 1}', FENCE].join("\n"),
    annex: "## Annex A",
    ...overrides,
  };
  return `${Object.values(parts).join("\n\n")}\n`;
}

// Traduction fidèle de doc() : mots-clés d'exigence français, mêmes nombres.
function docFr(overrides: Partial<Record<string, string>> = {}): string {
  const parts: Record<string, string> = {
    title: "# Spécification v1.2.0",
    limits: "## 1. Limites",
    prose:
      "Le serveur DOIT rejeter les charges de plus de 200 octets. Un client DEVRAIT réessayer jusqu'à 3 fois. " +
      "Il PEUT mettre en cache. Tampon : 16 777 216 octets.",
    table: ["| nom | valeur |", "| --- | --- |", "| a | 1 |", "| b | aucun |"].join("\n"),
    details: "### 1.1 Détails",
    inline: "Utiliser `max_size` et `retry`, puis `max_size` encore.",
    code: [`${FENCE}json`, '{"a": 1}', FENCE].join("\n"),
    annex: "## Annexe A",
    ...overrides,
  };
  return `${Object.values(parts).join("\n\n")}\n`;
}

function categories(a: string, b: string): string[] {
  return compareParity(a, b).violations.map((violation) => violation.category);
}

describe("compareParity: une traduction fidèle passe", () => {
  test("un texte comparé à lui-même : zéro violation, volume non nul", () => {
    const result = compareParity(doc(), doc());
    expect(result.violations).toEqual([]);
    const byCategory = Object.fromEntries(result.counts.map((c) => [c.category, c]));
    expect(byCategory.titres).toMatchObject({ a: 4, b: 4 });
    expect(byCategory.blocs).toMatchObject({ a: 1, b: 1 });
    expect(byCategory.tableaux).toMatchObject({ a: 1, b: 1 });
    expect(byCategory["code-en-ligne"]).toMatchObject({ a: 3, b: 3 });
    expect(byCategory.exigences).toMatchObject({ a: 3, b: 3 });
    expect(byCategory.version).toMatchObject({ a: 1, b: 1 });
  });

  test("anglais contre français : les mots-clés d'exigence s'apparient par classe", () => {
    expect(compareParity(doc(), docFr()).violations).toEqual([]);
  });
});

describe("compareParity: nombres", () => {
  test("200 changé en 300 dans une seule langue est détecté", () => {
    const fr = docFr({
      prose:
        "Le serveur DOIT rejeter les charges de plus de 300 octets. Un client DEVRAIT réessayer jusqu'à 3 fois. " +
        "Il PEUT mettre en cache. Tampon : 16 777 216 octets.",
    });
    const violations = compareParity(doc(), fr).violations;
    expect(violations.map((v) => v.category)).toEqual(["nombres"]);
    expect(violations[0]?.message).toContain("200");
    expect(violations[0]?.message).toContain("300");
  });

  test("un nombre d'une cellule de tableau changé est détecté", () => {
    const fr = docFr({
      table: ["| nom | valeur |", "| --- | --- |", "| a | 1 |", "| b | 9 |"].join("\n"),
    });
    expect(categories(doc(), fr)).toEqual(["nombres"]);
  });

  test("16 777 216 avec espace, espace insécable ou fine insécable se lit pareil", () => {
    const withValue = (value: string) =>
      doc({ prose: `The server MUST accept ${value} bytes. A client SHOULD wait. It MAY stop.` });
    const plain = withValue("16777216");
    for (const separated of ["16 777 216", "16 777 216", "16 777 216"]) {
      expect(compareParity(plain, withValue(separated)).violations).toEqual([]);
      expect(compareParity(withValue(separated), plain).violations).toEqual([]);
    }
  });

  test("16 777 216 contre 16 777 217 reste détecté malgré la normalisation", () => {
    const withValue = (value: string) =>
      doc({ prose: `The server MUST accept ${value} bytes. A client SHOULD wait. It MAY stop.` });
    expect(categories(withValue("16 777 216"), withValue("16 777 217"))).toEqual(["nombres"]);
  });

  test("virgule décimale française contre point anglais : même nombre", () => {
    const en = doc({
      prose: "The ratio is 3.5 and the server MUST stop. A client SHOULD wait. It MAY go.",
    });
    const fr = doc({
      prose: "Le ratio est 3,5 et le serveur MUST stop. A client SHOULD wait. It MAY go.",
    });
    expect(compareParity(en, fr).violations).toEqual([]);
  });

  test("un nombre dans un bloc de code ne compte pas comme nombre de prose", () => {
    const changed = doc({ code: [`${FENCE}json`, '{"a": 2}', FENCE].join("\n") });
    expect(categories(doc(), changed)).toEqual(["blocs"]);
  });
});

describe("compareParity: structure", () => {
  test("un tableau avec un nombre de lignes différent est détecté", () => {
    const fr = docFr({
      table: ["| nom | valeur |", "| --- | --- |", "| a | 1 |"].join("\n"),
    });
    const violations = compareParity(doc(), fr).violations;
    expect(violations.map((v) => v.category)).toEqual(["tableaux"]);
    expect(violations[0]?.message).toMatch(/4/);
    expect(violations[0]?.message).toMatch(/3/);
  });

  test("un bloc de code différent d'un octet est détecté", () => {
    const fr = docFr({ code: [`${FENCE}json`, '{"a": 1} ', FENCE].join("\n") });
    expect(categories(doc(), fr)).toEqual(["blocs"]);
  });

  test("un bloc de code manquant d'un côté est détecté", () => {
    expect(categories(doc(), docFr({ code: "Texte seul." }))).toEqual(["blocs"]);
  });

  test("un bloc de code non fermé est une violation, jamais un bloc silencieusement tronqué", () => {
    const open = doc({ code: [`${FENCE}json`, '{"a": 1}'].join("\n") });
    const violations = compareParity(doc(), open).violations;
    expect(violations.some((v) => v.category === "blocs" && /fermé/.test(v.message))).toBe(true);
  });

  test("un dièse dans un bloc de code n'est pas un titre", () => {
    const withComment = doc({ code: [`${FENCE}sh`, "# a comment", FENCE].join("\n") });
    const result = compareParity(withComment, withComment);
    expect(result.counts.find((c) => c.category === "titres")).toMatchObject({ a: 4, b: 4 });
  });

  test("niveau de titre changé : détecté", () => {
    expect(categories(doc(), docFr({ details: "## 1.1 Détails" }))).toEqual(["titres"]);
  });

  test("numéro de titre changé : détecté", () => {
    // « 1.2 » est aussi un nombre de la prose : les deux catégories le voient.
    expect(categories(doc(), docFr({ details: "### 1.2 Détails" }))).toContain("titres");
  });

  test("annexe retirée ou renumérotée : détectée", () => {
    expect(categories(doc(), docFr({ annex: "## Annexe B" }))).toEqual(["titres"]);
    expect(categories(doc(), docFr({ annex: "Fin." }))).toEqual(["titres"]);
  });

  test("version de la ligne de titre différente : détectée", () => {
    expect(categories(doc(), docFr({ title: "# Spécification v1.3.0" }))).toContain("version");
  });

  test("code en ligne : un segment perdu ou changé est détecté (multi-ensemble)", () => {
    expect(
      categories(doc(), docFr({ inline: "Utiliser `max_size` et `retry`, puis `autre` encore." })),
    ).toEqual(["code-en-ligne"]);
    // Même ensemble de segments, multiplicité différente : un multi-ensemble le voit.
    expect(
      categories(doc(), docFr({ inline: "Utiliser `max_size` et `retry`, puis `retry` encore." })),
    ).toEqual(["code-en-ligne"]);
  });

  test("code en ligne : l'ordre des segments peut changer d'une langue à l'autre", () => {
    expect(
      compareParity(
        doc(),
        docFr({ inline: "Utiliser `retry` et `max_size`, puis `max_size` encore." }),
      ).violations,
    ).toEqual([]);
  });
});

describe("compareParity: mots-clés d'exigence", () => {
  test("un mot-clé perdu est détecté", () => {
    const fr = docFr({
      prose:
        "Le serveur DOIT rejeter les charges de plus de 200 octets. Un client DEVRAIT réessayer jusqu'à 3 fois. " +
        "Il peut mettre en cache. Tampon : 16 777 216 octets.",
    });
    expect(categories(doc(), fr)).toEqual(["exigences"]);
  });

  test("un mot-clé changé (MUST devenu SHOULD) est détecté", () => {
    const fr = docFr({
      prose:
        "Le serveur DEVRAIT rejeter les charges de plus de 200 octets. Un client DEVRAIT réessayer jusqu'à 3 fois. " +
        "Il PEUT mettre en cache. Tampon : 16 777 216 octets.",
    });
    expect(categories(doc(), fr)).toEqual(["exigences"]);
  });

  test("MUST NOT contre NE DOIT PAS est une classe, distincte de MUST", () => {
    const en = doc({ prose: "A MUST NOT be empty. B SHOULD NOT be large." });
    const fr = doc({ prose: "A NE DOIT PAS être vide. B NE DEVRAIT PAS être grand." });
    expect(compareParity(en, fr).violations).toEqual([]);
    const wrong = doc({ prose: "A DOIT être vide. B NE DEVRAIT PAS être grand." });
    expect(categories(en, wrong)).toEqual(["exigences"]);
  });

  test("un mot-clé dans un bloc de code ne compte pas", () => {
    const withKeyword = doc({ code: [`${FENCE}text`, "MUST", FENCE].join("\n") });
    expect(categories(doc(), withKeyword)).toEqual(["blocs"]);
  });
});

describe("renderParity", () => {
  test("imprime les comptes par catégorie et le nombre de violations", () => {
    const lines = renderParity(compareParity(doc(), doc()));
    expect(lines.join("\n")).toContain("titres=4/4");
    expect(lines.join("\n")).toContain("blocs=1/1");
    expect(lines.join("\n")).toContain("violations=0");
  });

  test("une ligne par violation, localisée par fichier et ligne", () => {
    const fr = docFr({ table: ["| nom | valeur |", "| --- | --- |", "| a | 1 |"].join("\n") });
    const lines = renderParity(compareParity(doc(), fr));
    expect(lines.filter((line) => line.startsWith("tableaux:"))).toHaveLength(1);
    expect(lines.join("\n")).toContain("violations=1");
  });
});

describe("runParity: codes de sortie 0, 1, 2", () => {
  let dir = "";
  const file = (name: string, content: string | Uint8Array) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "parity-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("parité : code 0 et comptes imprimés", async () => {
    const result = await runParity([file("en.md", doc()), file("fr.md", docFr())]);
    expect(result.code).toBe(0);
    expect(result.lines.join("\n")).toContain("violations=0");
  });

  test("différence : code 1", async () => {
    const result = await runParity([
      file("en1.md", doc()),
      file("fr1.md", docFr({ annex: "## Annexe B" })),
    ]);
    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("violations=1");
  });

  test("fichier absent : code 2, jamais un passage", async () => {
    const result = await runParity([file("en2.md", doc()), join(dir, "absent.md")]);
    expect(result.code).toBe(2);
  });

  test("un répertoire à la place d'un fichier : code 2", async () => {
    mkdirSync(join(dir, "sub"));
    expect((await runParity([file("en3.md", doc()), join(dir, "sub")])).code).toBe(2);
  });

  test("octets invalides en UTF-8 : code 2", async () => {
    const result = await runParity([
      file("en4.md", doc()),
      file("fr4.md", new Uint8Array([0x23, 0x20, 0xff, 0xfe, 0x0a])),
    ]);
    expect(result.code).toBe(2);
  });

  test("usage : nombre d'arguments différent de 2 : code 2", async () => {
    expect((await runParity([])).code).toBe(2);
    expect((await runParity([join(dir, "en.md")])).code).toBe(2);
    expect((await runParity(["a", "b", "c"])).code).toBe(2);
  });

  test("le même fichier des deux côtés ne certifie rien : code 2", async () => {
    const path = file("same.md", doc());
    expect((await runParity([path, path])).code).toBe(2);
  });

  test("deux textes vides : rien examiné, code 2 et non un vert", async () => {
    const result = await runParity([file("e1.md", ""), file("e2.md", "")]);
    expect(result.code).toBe(2);
  });

  test("le processus sort avec le code de runParity", async () => {
    const script = join(import.meta.dir, "check-bilingual-parity.ts");
    const run = async (args: string[]) => {
      const child = Bun.spawn(["bun", script, ...args], {
        env: { PATH: process.env.PATH ?? "" },
        stdout: "pipe",
        stderr: "pipe",
      });
      return await child.exited;
    };
    expect(await run([join(dir, "en.md"), join(dir, "fr.md")])).toBe(0);
    expect(await run([join(dir, "en1.md"), join(dir, "fr1.md")])).toBe(1);
    expect(await run([join(dir, "en.md"), join(dir, "absent.md")])).toBe(2);
  });
});
