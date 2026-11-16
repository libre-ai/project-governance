// Parité normative de deux textes de spécification (anglais, français).
//
// POURQUOI. Quand deux textes sont normatifs, une traduction ne dérive pas par la
// structure : elle dérive par un seuil. « 200 octets » devient « 300 octets » dans
// une langue, les titres, les tableaux et les blocs de code restent identiques, et
// aucun relecteur ne voit rien. Cette porte compare ce qu'une traduction doit
// CONSERVER, et rien d'autre : la fidélité du sens est hors périmètre.
//
// CE QU'ELLE COMPARE
//   version        la version de la ligne de titre (premier titre de niveau 1)
//   titres         la suite (niveau, numéro), annexes comprises, hors blocs de code
//   blocs          les blocs de code délimités, octet pour octet (info-string comprise)
//   tableaux       le nombre de lignes de chaque tableau, dans l'ordre
//   code-en-ligne  les segments `...` comme multi-ensemble (l'ordre peut changer)
//   nombres        tous les nombres de la prose et des cellules, multi-ensemble ;
//                  séparateurs de milliers (espace, insécable, fine insécable)
//                  normalisés, virgule décimale lue comme un point
//   exigences      les mots-clés RFC 2119, multi-ensemble de CLASSES : MUST, SHALL
//                  et DOIT sont une même classe ; MUST NOT et NE DOIT PAS une autre
//
// Les blocs de code ne contribuent ni aux nombres ni aux mots-clés : leur octet
// compte déjà dans `blocs`. Une fin de ligne CRLF est lue comme LF : ce n'est pas
// du contenu traduit.
//
// CE QU'ELLE IMPRIME. Un compte a/b par catégorie, le nombre de violations, et une
// ligne par catégorie en défaut (première différence localisée par ligne). Deux
// textes dont rien n'a pu être examiné sortent en 2, jamais en 0.
//
// shortcut: les listes de mots-clés couvrent l'anglais RFC 2119 et le français de
// sa traduction usuelle ; upgrade trigger : une troisième langue normative.
// shortcut: « 1 234 » se lit 1234 dans toute prose, même quand l'espace sépare deux
// nombres distincts (« ports 80 443 ») ; le défaut est symétrique, donc sans effet
// sur la comparaison, au prix d'un nombre non détecté si un seul côté l'écrit ainsi.
//
// Usage : bun tools/quality/check-bilingual-parity.ts <a> <b>   (codes 0, 1, 2)

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Category =
  | "version"
  | "titres"
  | "blocs"
  | "tableaux"
  | "code-en-ligne"
  | "nombres"
  | "exigences";

interface CategoryCount {
  readonly category: Category;
  readonly a: number;
  readonly b: number;
}

interface Violation {
  readonly category: Category;
  readonly message: string;
}

interface ParityResult {
  readonly counts: readonly CategoryCount[];
  readonly violations: readonly Violation[];
}

interface Occurrence {
  readonly value: string;
  readonly line: number;
}

interface Heading {
  readonly line: number;
  readonly level: number;
  readonly number: string;
  readonly raw: string;
}

interface CodeBlock {
  readonly line: number;
  readonly key: string;
}

interface Table {
  readonly line: number;
  readonly rows: number;
}

interface ParsedText {
  readonly version: Occurrence | null;
  readonly headings: readonly Heading[];
  readonly blocks: readonly CodeBlock[];
  readonly unclosedFenceLine: number | null;
  readonly tables: readonly Table[];
  readonly inlineCode: readonly Occurrence[];
  readonly numbers: readonly Occurrence[];
  readonly requirements: readonly Occurrence[];
}

const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const TITLE_VERSION = /(?<![\d.])v?(\d+(?:\.\d+)+)(?!\d)/;
const INLINE_CODE = /(`+)([^`]|[^`].*?[^`])\1(?!`)/g;
// « Annex A », « Annexe B.2 », « Appendix C » ; « A.1 » ; « 3 », « 3.2. »
const HEADING_NUMBER =
  /^(?:(?:Annexe?|Appendix)[  ]+([A-Z0-9]+(?:\.\d+)*)|([A-Z]\.\d+(?:\.\d+)*|\d+(?:\.\d+)*)\.?(?=[ \t ]|$))/;

const REQUIREMENT_CLASSES: readonly (readonly [string, readonly string[]])[] = [
  ["MUST NOT", ["MUST NOT", "SHALL NOT", "NE DOIT PAS", "NE DOIVENT PAS"]],
  [
    "SHOULD NOT",
    [
      "SHOULD NOT",
      "NOT RECOMMENDED",
      "NE DEVRAIT PAS",
      "NE DEVRAIENT PAS",
      "NON RECOMMANDÉ",
      "NON RECOMMANDÉE",
      "NON RECOMMANDÉS",
      "NON RECOMMANDÉES",
    ],
  ],
  ["MUST", ["MUST", "SHALL", "REQUIRED", "DOIT", "DOIVENT", "OBLIGATOIRE", "OBLIGATOIRES"]],
  [
    "SHOULD",
    ["SHOULD", "RECOMMENDED", "DEVRAIT", "DEVRAIENT", "RECOMMANDÉ", "RECOMMANDÉE", "RECOMMANDÉS"],
  ],
  ["MAY", ["MAY", "OPTIONAL", "PEUT", "PEUVENT", "FACULTATIF", "FACULTATIVE", "FACULTATIFS"]],
];

const REQUIREMENT_BY_TOKEN = new Map<string, string>(
  REQUIREMENT_CLASSES.flatMap(([klass, tokens]) => tokens.map((token) => [token, klass] as const)),
);
// Plus long d'abord : « NE DOIT PAS » doit gagner sur « DOIT ».
const REQUIREMENT_TOKENS = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${[...REQUIREMENT_BY_TOKEN.keys()]
    .sort((x, y) => y.length - x.length)
    .map((token) => token.replace(/ /g, " +"))
    .join("|")})(?![\\p{L}\\p{N}_])`,
  "gu",
);

// Les séparateurs de milliers admis sont l'espace, l'espace insécable (U+00A0) et la
// fine insécable (U+202F). Biome les réécrit littéralement dans les classes de
// caractères ci-dessous : le test « 16 777 216 » en fixe le comportement.
function normalizeNumbers(line: string): string {
  return line
    .replace(
      /(?<![\d.,])(\d{1,3})((?:[   ]\d{3})+)(?!\d)/g,
      (_all, head: string, groups: string) => head + groups.replace(/[   ]/g, ""),
    )
    .replace(/(?<=\d),(?=\d{3}(?!\d))/g, "")
    .replace(/(?<=\d),(?=\d)/g, ".");
}

function parseText(text: string): ParsedText {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headings: Heading[] = [];
  const blocks: CodeBlock[] = [];
  const tables: Table[] = [];
  const inlineCode: Occurrence[] = [];
  const numbers: Occurrence[] = [];
  const requirements: Occurrence[] = [];
  let version: Occurrence | null = null;
  let titleSeen = false;

  let fence: { char: string; length: number; line: number; info: string; body: string[] } | null =
    null;
  let table: { line: number; rows: number } | null = null;

  const closeTable = () => {
    if (table !== null) tables.push(table);
    table = null;
  };

  lines.forEach((raw, index) => {
    const line = index + 1;

    if (fence !== null) {
      const closing = CLOSING_FENCE.exec(raw)?.[1];
      if (closing !== undefined && closing[0] === fence.char && closing.length >= fence.length) {
        blocks.push({ line: fence.line, key: `${fence.info}\n${fence.body.join("\n")}` });
        fence = null;
      } else {
        fence.body.push(raw);
      }
      return;
    }

    const opening = OPENING_FENCE.exec(raw);
    if (opening?.[1] !== undefined) {
      closeTable();
      fence = {
        char: opening[1][0] ?? "`",
        length: opening[1].length,
        line,
        info: (opening[2] ?? "").trim(),
        body: [],
      };
      return;
    }

    if (raw.trim().startsWith("|")) {
      table = table === null ? { line, rows: 1 } : { line: table.line, rows: table.rows + 1 };
    } else {
      closeTable();
    }

    const heading = HEADING.exec(raw);
    if (heading?.[1] !== undefined) {
      const title = heading[2] ?? "";
      const numbering = HEADING_NUMBER.exec(title);
      headings.push({
        line,
        level: heading[1].length,
        number: numbering?.[1] !== undefined ? `annexe ${numbering[1]}` : (numbering?.[2] ?? ""),
        raw: title,
      });
      if (heading[1].length === 1 && !titleSeen) {
        titleSeen = true;
        const found = TITLE_VERSION.exec(title)?.[1];
        if (found !== undefined) version = { value: found, line };
      }
    }

    for (const match of raw.matchAll(INLINE_CODE)) {
      inlineCode.push({ value: match[2] ?? "", line });
    }
    const prose = normalizeNumbers(raw.replace(INLINE_CODE, " "));
    for (const match of prose.matchAll(/\d+(?:\.\d+)*/g)) {
      numbers.push({ value: match[0], line });
    }
    for (const match of raw.replace(INLINE_CODE, " ").matchAll(REQUIREMENT_TOKENS)) {
      const klass = REQUIREMENT_BY_TOKEN.get((match[1] ?? "").replace(/ +/g, " "));
      if (klass !== undefined) requirements.push({ value: klass, line });
    }
  });
  closeTable();

  const open = fence as { line: number } | null;
  return {
    version,
    headings,
    blocks,
    unclosedFenceLine: open === null ? null : open.line,
    tables,
    inlineCode,
    numbers,
    requirements,
  };
}

function clip(value: string, max = 80): string {
  const flat = value.replace(/\s+/g, " ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Première différence d'une suite : index, ou -1 si les deux suites sont égales. */
function firstDifference<T>(
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean,
): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || !same(x, y)) return i;
  }
  return a.length === b.length ? -1 : shared;
}

/** Valeurs en excès d'un côté, avec leur première ligne, triées par ligne. */
function excess(
  mine: readonly Occurrence[],
  theirs: readonly Occurrence[],
): { value: string; surplus: number; line: number }[] {
  const tally = new Map<string, number>();
  for (const { value } of theirs) tally.set(value, (tally.get(value) ?? 0) + 1);
  const seen = new Map<string, { count: number; line: number }>();
  for (const { value, line } of mine) {
    const entry = seen.get(value) ?? { count: 0, line };
    seen.set(value, { count: entry.count + 1, line: entry.line });
  }
  return [...seen.entries()]
    .map(([value, { count, line }]) => ({ value, surplus: count - (tally.get(value) ?? 0), line }))
    .filter((entry) => entry.surplus > 0)
    .sort((x, y) => x.line - y.line);
}

function multisetViolation(
  category: Category,
  a: readonly Occurrence[],
  b: readonly Occurrence[],
): Violation | null {
  const onlyA = excess(a, b);
  const onlyB = excess(b, a);
  if (onlyA.length === 0 && onlyB.length === 0) return null;
  const describe = (side: string, entries: typeof onlyA) =>
    entries.length === 0
      ? null
      : `en excès dans ${side} : ${entries
          .slice(0, 3)
          .map((e) => `« ${clip(e.value, 40)} » x${e.surplus} (ligne ${e.line})`)
          .join(", ")}${entries.length > 3 ? ` et ${entries.length - 3} autre(s)` : ""}`;
  const message = [describe("a", onlyA), describe("b", onlyB)].filter(Boolean).join(" ; ");
  return { category, message };
}

export function compareParity(a: string, b: string): ParityResult {
  const pa = parseText(a);
  const pb = parseText(b);
  const violations: Violation[] = [];

  if (pa.version?.value !== pb.version?.value) {
    const show = (v: Occurrence | null) =>
      v === null ? "absente" : `« ${v.value} » (ligne ${v.line})`;
    violations.push({
      category: "version",
      message: `version de la ligne de titre : a ${show(pa.version)} ≠ b ${show(pb.version)}`,
    });
  }

  const headingAt = firstDifference(
    pa.headings,
    pb.headings,
    (x, y) => x.level === y.level && x.number === y.number,
  );
  if (headingAt >= 0) {
    const x = pa.headings[headingAt];
    const y = pb.headings[headingAt];
    const show = (h: Heading | undefined, side: string) =>
      h === undefined
        ? `${side} n'en a plus (${(side === "a" ? pa : pb).headings.length} titre(s))`
        : `${side} ligne ${h.line} niveau ${h.level} numéro « ${h.number} » « ${clip(h.raw, 50)} »`;
    violations.push({
      category: "titres",
      message: `titre n°${headingAt + 1} : ${show(x, "a")} ≠ ${show(y, "b")}`,
    });
  }

  for (const [side, parsed] of [
    ["a", pa],
    ["b", pb],
  ] as const) {
    if (parsed.unclosedFenceLine !== null) {
      violations.push({
        category: "blocs",
        message: `bloc de code non fermé dans ${side} (ouvert ligne ${parsed.unclosedFenceLine}) : le reste du texte n'est pas comparable`,
      });
    }
  }
  const blockAt = firstDifference(pa.blocks, pb.blocks, (x, y) => x.key === y.key);
  if (blockAt >= 0) {
    const x = pa.blocks[blockAt];
    const y = pb.blocks[blockAt];
    let message: string;
    if (x === undefined || y === undefined) {
      message = `bloc n°${blockAt + 1} : a en compte ${pa.blocks.length}, b en compte ${pb.blocks.length}`;
    } else {
      const la = x.key.split("\n");
      const lb = y.key.split("\n");
      const at = firstDifference(la, lb, (p, q) => p === q);
      message = `bloc n°${blockAt + 1} (a ligne ${x.line}, b ligne ${y.line}) : première différence à la ligne ${at} du bloc (0 = info-string), a « ${clip(la[at] ?? "(fin)", 40)} » ≠ b « ${clip(lb[at] ?? "(fin)", 40)} »`;
    }
    violations.push({ category: "blocs", message });
  }

  const tableAt = firstDifference(pa.tables, pb.tables, (x, y) => x.rows === y.rows);
  if (tableAt >= 0) {
    const x = pa.tables[tableAt];
    const y = pb.tables[tableAt];
    const show = (t: Table | undefined, side: string, all: number) =>
      t === undefined
        ? `${side} n'en a plus (${all} tableau(x))`
        : `${side} ligne ${t.line} : ${t.rows} ligne(s)`;
    violations.push({
      category: "tableaux",
      message: `tableau n°${tableAt + 1} : ${show(x, "a", pa.tables.length)} ≠ ${show(y, "b", pb.tables.length)}`,
    });
  }

  for (const [category, left, right] of [
    ["code-en-ligne", pa.inlineCode, pb.inlineCode],
    ["nombres", pa.numbers, pb.numbers],
    ["exigences", pa.requirements, pb.requirements],
  ] as const) {
    const violation = multisetViolation(category, left, right);
    if (violation !== null) violations.push(violation);
  }

  const counts: CategoryCount[] = [
    { category: "version", a: pa.version === null ? 0 : 1, b: pb.version === null ? 0 : 1 },
    { category: "titres", a: pa.headings.length, b: pb.headings.length },
    { category: "blocs", a: pa.blocks.length, b: pb.blocks.length },
    { category: "tableaux", a: pa.tables.length, b: pb.tables.length },
    { category: "code-en-ligne", a: pa.inlineCode.length, b: pb.inlineCode.length },
    { category: "nombres", a: pa.numbers.length, b: pb.numbers.length },
    { category: "exigences", a: pa.requirements.length, b: pb.requirements.length },
  ];
  return { counts, violations };
}

export function renderParity(result: ParityResult): string[] {
  const counts = result.counts.map((c) => `${c.category}=${c.a}/${c.b}`).join(" ");
  return [
    `parité examinée (a/b) : ${counts} violations=${result.violations.length}`,
    ...result.violations.map((v) => `${v.category}: ${v.message}`),
  ];
}

interface Outcome {
  readonly code: 0 | 1 | 2;
  readonly lines: string[];
}

async function readUtf8(path: string): Promise<string> {
  const bytes = await readFile(path);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function runParity(args: readonly string[]): Promise<Outcome> {
  const [pathA, pathB, ...rest] = args;
  if (pathA === undefined || pathB === undefined || rest.length > 0) {
    return { code: 2, lines: ["usage : check-bilingual-parity <a> <b>"] };
  }
  if (resolve(pathA) === resolve(pathB)) {
    return {
      code: 2,
      lines: ["erreur : a et b désignent le même fichier, la comparaison ne prouverait rien"],
    };
  }

  const texts: string[] = [];
  for (const [side, path] of [
    ["a", pathA],
    ["b", pathB],
  ] as const) {
    try {
      texts.push(await readUtf8(path));
    } catch (error) {
      const reason =
        error instanceof TypeError
          ? "UTF-8 invalide"
          : ((error as NodeJS.ErrnoException).code ?? "illisible");
      return { code: 2, lines: [`erreur : ${side} (${path}) illisible : ${reason}`] };
    }
  }

  const result = compareParity(texts[0] ?? "", texts[1] ?? "");
  const examined = result.counts.reduce((sum, c) => sum + c.a + c.b, 0);
  if (examined === 0) {
    return {
      code: 2,
      lines: ["erreur : rien n'a été examiné dans a ni dans b, un vert n'aurait aucune preuve"],
    };
  }
  return { code: result.violations.length === 0 ? 0 : 1, lines: renderParity(result) };
}

if (import.meta.main) {
  const outcome = await runParity(process.argv.slice(2));
  for (const line of outcome.lines) {
    if (outcome.code === 0) console.log(line);
    else console.error(line);
  }
  process.exit(outcome.code);
}
