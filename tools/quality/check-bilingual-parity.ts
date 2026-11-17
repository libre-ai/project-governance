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
//   tableaux       le nombre de lignes de chaque tableau, dans l'ordre ; un tableau
//                  est une suite de lignes à barre initiale, ou un en-tête suivi
//                  d'une ligne de délimitation GFM (barre initiale facultative)
//   code-en-ligne  les segments `...` comme multi-ensemble (l'ordre peut changer)
//   nombres        tous les nombres de la prose et des cellules, multi-ensemble,
//                  signe moins compris (« -5 » ≠ « 5 ») ; séparateurs de milliers
//                  (espace, insécable, fine insécable) normalisés. La virgule dépend
//                  de la langue de CHAQUE côté (a : anglais, b : français par défaut ;
//                  --lang-a, --lang-b) : en anglais « 1,500 » se lit 1500, en français
//                  « 1,500 » se lit 1.500 (distinct de 1500) et « 0,125 » se lit
//                  0.125. Les nombres se comparent tels qu'écrits : « 1.50 » et
//                  « 1.5 » diffèrent (« 1.10 » et « 1.1 » sont deux versions).
//                  Écrire « 1 500 » ne dépend d'aucune langue.
//   exigences      les mots-clés RFC 2119, multi-ensemble de CLASSES : MUST, SHALL
//                  et DOIT sont une même classe ; MUST NOT et NE DOIT PAS une autre.
//                  Cherchés sur un paragraphe entier, lignes jointes et blancs
//                  Unicode réduits : « MUST⏎NOT » et « MUST NOT » sont des MUST NOT
//
// Code en ligne, nombres et exigences se comparent SECTION PAR SECTION (une section
// va d'un titre au suivant) quand les titres sont alignés : un seuil ou un mot-clé
// échangé entre deux sections se voit. Titres désalignés : comparaison globale.
//
// Les blocs de code ne contribuent ni aux nombres ni aux mots-clés : leur octet
// compte déjà dans `blocs`. Une clôture est reconnue à toute indentation et derrière
// « > » ou une puce. Une fin de ligne CRLF est lue comme LF : ce n'est pas du contenu
// traduit. Un texte portant un contrôle C0 autre que tabulation, LF, CR (UTF-16 lu
// comme UTF-8, par exemple) sort en 2.
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
// Usage : bun tools/quality/check-bilingual-parity.ts <a> <b> [--lang-a=en|fr] [--lang-b=en|fr]
// (codes 0, 1, 2 ; une option ou une langue inconnue sort en 2)

import { readFile, stat } from "node:fs/promises";

type Category =
  | "version"
  | "titres"
  | "blocs"
  | "tableaux"
  | "code-en-ligne"
  | "nombres"
  | "exigences";

type Language = "en" | "fr";

interface ParityOptions {
  /** Langue du texte a (défaut : anglais). */
  readonly langA?: Language;
  /** Langue du texte b (défaut : français). */
  readonly langB?: Language;
}

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
  /** 0 avant le premier titre, sinon le rang (1, 2…) du titre qui ouvre la section. */
  readonly section: number;
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

// Une clôture est reconnue quelle que soit son indentation et derrière un préfixe de
// conteneur (citation « > », puce de liste) : un bloc dans une liste ou une citation
// porte autant de commandes qu'un bloc de premier niveau, et un bloc non reconnu
// verrait son contenu échapper à toute comparaison. Plus strict que CommonMark (qui
// lit un bloc indenté de 4 espaces hors liste comme code indenté) : une clôture lue
// à tort se compare à l'octet des deux côtés, elle ne fait rien passer.
// Chaque répétition commence par un caractère non blanc : coût linéaire.
const CONTAINER_PREFIX = /^[ \t]*(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*/;
const OPENING_FENCE = /^(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^(`{3,}|~{3,})[ \t]*$/;

/** La ligne sans son préfixe de conteneur (indentation, « > », puce). */
function withoutContainer(raw: string): string {
  return raw.slice(CONTAINER_PREFIX.exec(raw)?.[0].length ?? 0);
}
// Le titre est capturé en bloc ; la séquence de fermeture est retirée par
// headingTitle(). Un seul quantificateur sur les blancs et aucun `.*?` : un texte
// soumis en MR est une entrée externe, la ligne ne doit coûter que linéairement.
const HEADING = /^ {0,3}(#{1,6})[ \t]+([\s\S]*)$/;
// Ligne de délimitation d'un tableau GFM : au moins une barre, sinon « --- » seul
// serait un filet. Appliquée à la ligne rognée.
const TABLE_DELIMITER = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?$/;
// Le signe moins (ASCII ou U+2212) compte quand rien de numérique ni de lettre ne le
// précède : « -5 » est un signe, « 1-3 » et « a-3 » n'en portent pas.
const NUMBER = /(?:(?<![\d\p{L}])[-−])?\d+(?:\.\d+)*/gu;
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
    [
      "SHOULD",
      "RECOMMENDED",
      "DEVRAIT",
      "DEVRAIENT",
      "RECOMMANDÉ",
      "RECOMMANDÉE",
      "RECOMMANDÉS",
      "RECOMMANDÉES",
    ],
  ],
  [
    "MAY",
    [
      "MAY",
      "OPTIONAL",
      "PEUT",
      "PEUVENT",
      "FACULTATIF",
      "FACULTATIVE",
      "FACULTATIFS",
      "FACULTATIVES",
    ],
  ],
];

const REQUIREMENT_BY_TOKEN = new Map<string, string>(
  REQUIREMENT_CLASSES.flatMap(([klass, tokens]) => tokens.map((token) => [token, klass] as const)),
);
// Plus long d'abord : « NE DOIT PAS » doit gagner sur « DOIT ».
const REQUIREMENT_TOKENS = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${[...REQUIREMENT_BY_TOKEN.keys()]
    .sort((x, y) => y.length - x.length)
    .join("|")})(?![\\p{L}\\p{N}_])`,
  "gu",
);

// Les séparateurs de milliers admis sont l'espace, l'espace insécable (U+00A0) et la
// fine insécable (U+202F). Biome les réécrit littéralement dans les classes de
// caractères ci-dessous : le test « 16 777 216 » en fixe le comportement.
//
// La virgule entre deux chiffres dépend de la langue du texte : en anglais « 1,500 »
// vaut 1500 (milliers) ; en français « 1,500 » vaut 1,5 (décimale). Sans la langue,
// aucune règle ne tient : un seuil passé de 1500 à 1,5 resterait invisible, ou
// « 0,125 » deviendrait une fausse violation. La langue est donc un paramètre de
// chaque côté.
function normalizeNumbers(line: string, lang: Language): string {
  const spaced = line.replace(
    /(?<![\d.,])(\d{1,3})((?:[   ]\d{3})+)(?!\d)/g,
    (_all, head: string, groups: string) => head + groups.replace(/[   ]/g, ""),
  );
  const unsplit = lang === "en" ? spaced.replace(/(?<=\d),(?=\d{3}(?!\d))/g, "") : spaced;
  return unsplit.replace(/(?<=\d),(?=\d)/g, ".");
}

/** Titre sans sa séquence de fermeture (« ## a ## » -> « a »), en temps linéaire. */
function headingTitle(rest: string): string {
  let end = rest.trimEnd().length;
  while (end > 0 && rest[end - 1] === "#") end -= 1;
  return rest.slice(0, end).trimEnd();
}

function parseText(text: string, lang: Language): ParsedText {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headings: Heading[] = [];
  const blocks: CodeBlock[] = [];
  const tables: Table[] = [];
  const inlineCode: Occurrence[] = [];
  const numbers: Occurrence[] = [];
  const requirements: Occurrence[] = [];
  let version: Occurrence | null = null;
  let titleSeen = false;

  let fence: {
    char: string;
    length: number;
    line: number;
    info: string;
    body: string[];
  } | null = null;
  let table: { line: number; rows: number } | null = null;

  const closeTable = () => {
    if (table !== null) tables.push(table);
    table = null;
  };

  // Ligne précédente hors bloc de code : l'en-tête d'un tableau sans barre initiale
  // ne se reconnaît qu'à la ligne de délimitation qui le suit.
  let previous = "";
  let section = 0;

  // Les mots-clés se cherchent sur un paragraphe entier, lignes jointes : « MUST » en
  // fin de ligne suivi de « NOT » en tête de la suivante est une interdiction. Chaque
  // ligne y entre sans son code en ligne ni son préfixe de citation, ses blancs
  // Unicode (insécable, fine insécable, tabulation) réduits à une espace.
  let paragraph: { text: string; starts: number[]; lines: number[] } | null = null;
  const flushParagraph = () => {
    if (paragraph === null) return;
    const { text, starts, lines: origins } = paragraph;
    paragraph = null;
    // Les correspondances arrivent dans l'ordre : l'index de ligne ne fait qu'avancer.
    let part = 0;
    for (const match of text.matchAll(REQUIREMENT_TOKENS)) {
      const klass = REQUIREMENT_BY_TOKEN.get(match[1] ?? "");
      if (klass === undefined) continue;
      const at = match.index ?? 0;
      while (part + 1 < starts.length && (starts[part + 1] ?? Infinity) <= at) part += 1;
      requirements.push({ value: klass, line: origins[part] ?? 0, section });
    }
  };
  const addToParagraph = (raw: string, line: number) => {
    const cleaned = raw
      .replace(INLINE_CODE, " ")
      .normalize("NFC")
      .replace(/^(?:\s*>)+/u, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (cleaned === "") return;
    if (paragraph === null) {
      paragraph = { text: cleaned, starts: [0], lines: [line] };
    } else {
      paragraph.starts.push(paragraph.text.length + 1);
      paragraph.lines.push(line);
      paragraph.text = `${paragraph.text} ${cleaned}`;
    }
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    const before = previous;
    previous = raw;

    if (fence !== null) {
      previous = "";
      const closing = CLOSING_FENCE.exec(withoutContainer(raw))?.[1];
      if (closing !== undefined && closing[0] === fence.char && closing.length >= fence.length) {
        blocks.push({
          line: fence.line,
          key: `${fence.info}\n${fence.body.join("\n")}`,
        });
        fence = null;
      } else {
        fence.body.push(raw);
      }
      return;
    }

    const opening = OPENING_FENCE.exec(withoutContainer(raw));
    // CommonMark : l'info-string d'une clôture à backticks n'en contient aucun, sinon
    // « ```x``` » serait du code en ligne lu comme un bloc.
    if (
      opening?.[1] !== undefined &&
      !(opening[1].startsWith("`") && (opening[2] ?? "").includes("`"))
    ) {
      previous = "";
      closeTable();
      flushParagraph();
      fence = {
        char: opening[1][0] ?? "`",
        length: opening[1].length,
        line,
        info: (opening[2] ?? "").trim(),
        body: [],
      };
      return;
    }

    const trimmed = raw.trim();
    if (
      table === null &&
      trimmed.includes("|") &&
      before.includes("|") &&
      TABLE_DELIMITER.test(trimmed)
    ) {
      // Tableau GFM : l'en-tête est la ligne précédente, déjà passée.
      table = { line: line - 1, rows: 2 };
    } else if (trimmed.startsWith("|") || (table !== null && trimmed !== "" && raw.includes("|"))) {
      table = table === null ? { line, rows: 1 } : { line: table.line, rows: table.rows + 1 };
    } else {
      closeTable();
    }

    const heading = HEADING.exec(raw);
    // Un titre, une ligne de tableau ou une ligne blanche termine le paragraphe ; un
    // titre et une ligne de tableau forment chacun leur propre unité.
    const standalone = heading?.[1] !== undefined || table !== null;
    if (standalone || trimmed === "") flushParagraph();
    if (heading?.[1] !== undefined) {
      section += 1;
      const title = headingTitle(heading[2] ?? "");
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
        if (found !== undefined) version = { value: found, line, section };
      }
    }

    for (const match of raw.matchAll(INLINE_CODE)) {
      inlineCode.push({ value: match[2] ?? "", line, section });
    }
    const prose = normalizeNumbers(raw.replace(INLINE_CODE, " "), lang);
    for (const match of prose.matchAll(NUMBER)) {
      numbers.push({ value: match[0].replace("−", "-"), line, section });
    }
    // NFC seulement dans le paragraphe : les blocs de code se comparent à l'octet.
    addToParagraph(raw, line);
    if (standalone) flushParagraph();
  });
  flushParagraph();
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
    .map(([value, { count, line }]) => ({
      value,
      surplus: count - (tally.get(value) ?? 0),
      line,
    }))
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

/** Multi-ensemble comparé section par section ; une seule violation par catégorie. */
function sectionedViolation(
  category: Category,
  a: readonly Occurrence[],
  b: readonly Occurrence[],
  headings: readonly Heading[],
): Violation | null {
  // Regroupement en une passe : un filtre par section coûterait sections × occurrences.
  const bySection = (all: readonly Occurrence[]) => {
    const groups = new Map<number, Occurrence[]>();
    for (const occurrence of all) {
      const group = groups.get(occurrence.section);
      if (group === undefined) groups.set(occurrence.section, [occurrence]);
      else group.push(occurrence);
    }
    return groups;
  };
  const groupsA = bySection(a);
  const groupsB = bySection(b);
  const failing: string[] = [];
  for (let section = 0; section <= headings.length; section += 1) {
    const violation = multisetViolation(
      category,
      groupsA.get(section) ?? [],
      groupsB.get(section) ?? [],
    );
    if (violation === null) continue;
    const heading = headings[section - 1];
    const label =
      heading === undefined ? "avant le premier titre" : `section « ${clip(heading.raw, 40)} »`;
    failing.push(`${label} : ${violation.message}`);
  }
  if (failing.length === 0) return null;
  const rest = failing.length > 3 ? ` ; et ${failing.length - 3} autre(s) section(s)` : "";
  return { category, message: `${failing.slice(0, 3).join(" ; ")}${rest}` };
}

export function compareParity(a: string, b: string, options: ParityOptions = {}): ParityResult {
  const pa = parseText(a, options.langA ?? "en");
  const pb = parseText(b, options.langB ?? "fr");
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

  // Titres alignés : chaque section se compare à sa jumelle, un seuil ou un mot-clé
  // déplacé d'une section à l'autre se voit. Titres désalignés (déjà une violation) :
  // les sections ne se correspondent plus, la comparaison reste globale.
  const aligned = headingAt < 0;
  for (const [category, left, right] of [
    ["code-en-ligne", pa.inlineCode, pb.inlineCode],
    ["nombres", pa.numbers, pb.numbers],
    ["exigences", pa.requirements, pb.requirements],
  ] as const) {
    const violation = aligned
      ? sectionedViolation(category, left, right, pa.headings)
      : multisetViolation(category, left, right);
    if (violation !== null) violations.push(violation);
  }

  const counts: CategoryCount[] = [
    {
      category: "version",
      a: pa.version === null ? 0 : 1,
      b: pb.version === null ? 0 : 1,
    },
    { category: "titres", a: pa.headings.length, b: pb.headings.length },
    { category: "blocs", a: pa.blocks.length, b: pb.blocks.length },
    { category: "tableaux", a: pa.tables.length, b: pb.tables.length },
    {
      category: "code-en-ligne",
      a: pa.inlineCode.length,
      b: pb.inlineCode.length,
    },
    { category: "nombres", a: pa.numbers.length, b: pb.numbers.length },
    {
      category: "exigences",
      a: pa.requirements.length,
      b: pb.requirements.length,
    },
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

// Un texte UTF-16 sans BOM est de l'UTF-8 valide (un octet NUL après chaque caractère
// ASCII) : décodé, il perd ses titres et ses mots-clés, et deux textes ainsi vidés
// seraient « en parité ». Un contrôle C0 autre que tabulation, LF et CR n'a pas sa
// place dans un texte de spécification : il signale un mauvais encodage.
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;

class ControlCharacterError extends Error {}

/** Index du premier contrôle C0 interdit, ou -1. */
function forbiddenControlAt(text: string): number {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 && code !== TAB && code !== LF && code !== CR) return i;
  }
  return -1;
}

async function readUtf8(path: string): Promise<string> {
  const bytes = await readFile(path);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const at = forbiddenControlAt(text);
  if (at >= 0) {
    const code = text.charCodeAt(at).toString(16).padStart(4, "0").toUpperCase();
    const line = text.slice(0, at).split("\n").length;
    throw new ControlCharacterError(
      `caractère de contrôle U+${code} ligne ${line} (encodage autre que UTF-8, UTF-16 ?)`,
    );
  }
  return text;
}

/** Vrai quand a et b sont le même fichier, par lien symbolique ou physique compris. */
async function sameFile(pathA: string, pathB: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([stat(pathA), stat(pathB)]);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    // Un chemin illisible n'est pas tranché ici : la lecture qui suit sort en 2 et
    // nomme la cause.
    return false;
  }
}

export async function runParity(args: readonly string[]): Promise<Outcome> {
  const usage = "usage : check-bilingual-parity <a> <b> [--lang-a=en|fr] [--lang-b=en|fr]";
  const paths: string[] = [];
  const langs: { a: Language; b: Language } = { a: "en", b: "fr" };
  for (const arg of args) {
    const flag = /^--lang-([ab])=(.*)$/.exec(arg);
    if (flag === null) {
      if (arg.startsWith("--")) return { code: 2, lines: [`option inconnue : ${arg}`, usage] };
      paths.push(arg);
    } else if (flag[2] === "en" || flag[2] === "fr") {
      langs[flag[1] === "a" ? "a" : "b"] = flag[2];
    } else {
      return {
        code: 2,
        lines: [`langue inconnue : ${flag[2] ?? ""} (en ou fr)`, usage],
      };
    }
  }
  const [pathA, pathB, ...rest] = paths;
  if (pathA === undefined || pathB === undefined || rest.length > 0) {
    return { code: 2, lines: [usage] };
  }
  if (await sameFile(pathA, pathB)) {
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
        error instanceof ControlCharacterError
          ? error.message
          : error instanceof TypeError
            ? "UTF-8 invalide"
            : ((error as NodeJS.ErrnoException).code ?? "illisible");
      return {
        code: 2,
        lines: [`erreur : ${side} (${path}) illisible : ${reason}`],
      };
    }
  }

  const result = compareParity(texts[0] ?? "", texts[1] ?? "", {
    langA: langs.a,
    langB: langs.b,
  });
  const examined = result.counts.reduce((sum, c) => sum + c.a + c.b, 0);
  if (examined === 0) {
    return {
      code: 2,
      lines: ["erreur : rien n'a été examiné dans a ni dans b, un vert n'aurait aucune preuve"],
    };
  }
  return {
    code: result.violations.length === 0 ? 0 : 1,
    lines: renderParity(result),
  };
}

if (import.meta.main) {
  const outcome = await runParity(process.argv.slice(2));
  for (const line of outcome.lines) {
    if (outcome.code === 0) console.log(line);
    else console.error(line);
  }
  process.exit(outcome.code);
}
