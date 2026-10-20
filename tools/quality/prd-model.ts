/**
 * Reading model of a product requirements document (PRD) and of its
 * work-package table. Pure functions over Markdown text: no I/O, no git.
 *
 * Every reader fails closed. A document that does not carry the structure
 * returns `ok: false` with a reason, never an empty success, so that a gate
 * built on top cannot confuse "nothing declared" with "could not read".
 *
 * The readers hold one invariant over the RAW text, with no Markdown
 * semantics: every raw occurrence of a declaration form (a maturity line, a
 * work-package header or row, a criterion definition) is either read as live
 * or makes the document unreadable, with its line. Why raw: a reader that
 * imitates a renderer (fences, HTML blocks, indented code, list items)
 * disagrees with it somewhere, and each disagreement lets a quoted example be
 * read as live or hides a live line. The reviewer of a PRD reads the raw
 * diff; so does the gate. A PRD therefore never quotes a declaration form.
 *
 * The invariant is held by enumerating what a document may contain, not by
 * detecting what it must not. The alphabet IS the skeleton table: a finite,
 * hand-written map from every admitted non-ASCII code point to what a person
 * reads it as (its skeleton). Rule 1 checks every character against it before
 * anything is read; rule 2 refuses HTML; rule 3 detects declaration forms on
 * the skeleton of each line, never on an open class of spellings. The text is
 * read once (`readRawLines`), and the three parsers share that reading.
 */
export type MaturityLevel =
  | "exploration"
  | "hypothèse"
  | "proposition"
  | "décision"
  | "prototype"
  | "mise en service"
  | "industrialisation"
  | "standardisation";

/** Ascending order: a later entry is at least as mature as an earlier one. */
export const MATURITY_LADDER: readonly MaturityLevel[] = [
  "exploration",
  "hypothèse",
  "proposition",
  "décision",
  "prototype",
  "mise en service",
  "industrialisation",
  "standardisation",
];

export interface Criterion {
  readonly id: string;
  readonly line: number;
  readonly hasValidation: boolean;
}

export interface WorkPackage {
  readonly id: string;
  readonly criteria: readonly string[];
  readonly scope: readonly string[];
  readonly verify: string;
  readonly door: "one-way" | "two-way";
}

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * A document read once: its raw lines, and for each line its structural form
 * (rule 3) and its detection form (rule 3, with the ASCII confusables folded).
 * The three parsers accept it in place of the text, so that the alphabet is
 * checked and the skeletons computed one time per file.
 */
export interface RawDocument {
  readonly lines: readonly string[];
  readonly structural: readonly string[];
  readonly detection: readonly string[];
}

const fail = (reason: string): { readonly ok: false; readonly reason: string } => ({
  ok: false,
  reason,
});

// ---------------------------------------------------------------------------
// Rule 1: the alphabet of a PRD is the skeleton table
// ---------------------------------------------------------------------------

// The neutral separator: the skeleton of an admitted character that a person
// reads as no letter, digit, dash or bar. Not ASCII, so that it can never be
// confused with a structural character of a form.
const NEUTRAL: string = String.fromCodePoint(0xb7);

/**
 * Every admitted non-ASCII code point, with its skeleton: the ASCII character
 * (or pair) a person may read it as — a letter, a digit, `-`, `|`, `.`, `'`,
 * `"`, `/`, `%`, `?`, `!`, a space — or the neutral separator. Hand-written,
 * one entry per line, reviewed one by one. A code point absent from this
 * table is refused by every reader; U+FE0F is the single exception, admitted
 * only right after an entry of category So (the emoji presentation of that
 * symbol) and read as nothing.
 *
 * The choice of each skeleton errs toward the letter: a symbol that could be
 * read as a letter gets that letter, so that a key word spelled with it is
 * detected and the document refused (a faux refusal), never accepted.
 */
export const SKELETON: ReadonlyMap<number, string> = new Map<number, string>([
  // Latin-1 letters, upper case (U+00C0–U+00DE except × U+00D7).
  [0x00c0, "a"], // À
  [0x00c1, "a"], // Á
  [0x00c2, "a"], // Â
  [0x00c3, "a"], // Ã
  [0x00c4, "a"], // Ä
  [0x00c5, "a"], // Å
  [0x00c6, "ae"], // Æ
  [0x00c7, "c"], // Ç
  [0x00c8, "e"], // È
  [0x00c9, "e"], // É
  [0x00ca, "e"], // Ê
  [0x00cb, "e"], // Ë
  [0x00cc, "i"], // Ì
  [0x00cd, "i"], // Í
  [0x00ce, "i"], // Î
  [0x00cf, "i"], // Ï
  [0x00d0, "d"], // Ð
  [0x00d1, "n"], // Ñ
  [0x00d2, "o"], // Ò
  [0x00d3, "o"], // Ó
  [0x00d4, "o"], // Ô
  [0x00d5, "o"], // Õ
  [0x00d6, "o"], // Ö
  [0x00d8, "o"], // Ø
  [0x00d9, "u"], // Ù
  [0x00da, "u"], // Ú
  [0x00db, "u"], // Û
  [0x00dc, "u"], // Ü
  [0x00dd, "y"], // Ý
  [0x00de, "p"], // Þ
  [0x00df, "b"], // ß
  // Latin-1 letters, lower case (U+00E0–U+00FF except ÷ U+00F7).
  [0x00e0, "a"], // à
  [0x00e1, "a"], // á
  [0x00e2, "a"], // â
  [0x00e3, "a"], // ã
  [0x00e4, "a"], // ä
  [0x00e5, "a"], // å
  [0x00e6, "ae"], // æ
  [0x00e7, "c"], // ç
  [0x00e8, "e"], // è
  [0x00e9, "e"], // é
  [0x00ea, "e"], // ê
  [0x00eb, "e"], // ë
  [0x00ec, "i"], // ì
  [0x00ed, "i"], // í
  [0x00ee, "i"], // î
  [0x00ef, "i"], // ï
  [0x00f0, "d"], // ð
  [0x00f1, "n"], // ñ
  [0x00f2, "o"], // ò
  [0x00f3, "o"], // ó
  [0x00f4, "o"], // ô
  [0x00f5, "o"], // õ
  [0x00f6, "o"], // ö
  [0x00f8, "o"], // ø
  [0x00f9, "u"], // ù
  [0x00fa, "u"], // ú
  [0x00fb, "u"], // û
  [0x00fc, "u"], // ü
  [0x00fd, "y"], // ý
  [0x00fe, "p"], // þ
  [0x00ff, "y"], // ÿ
  // Latin Extended-A: the three French ligature and capital letters.
  [0x0152, "oe"], // Œ
  [0x0153, "oe"], // œ
  [0x0178, "y"], // Ÿ
  // Latin-1 punctuation and symbols (U+00A0–U+00BF, × and ÷). Excluded on
  // purpose: U+00AD soft hyphen (format character), U+00B5 micro sign (a
  // Greek letter), both refused.
  [0x00a0, " "], // no-break space
  [0x00a1, "i"], // ¡
  [0x00a2, "c"], // ¢
  [0x00a3, "l"], // £
  [0x00a4, NEUTRAL], // ¤
  [0x00a5, "y"], // ¥
  [0x00a6, "|"], // ¦
  [0x00a7, "s"], // §
  [0x00a8, NEUTRAL], // ¨
  [0x00a9, "c"], // ©
  [0x00aa, "a"], // ª
  [0x00ab, NEUTRAL], // «
  [0x00ac, "-"], // ¬
  [0x00ae, "r"], // ®
  [0x00af, "-"], // ¯
  [0x00b0, "o"], // °
  [0x00b1, "-"], // ±
  [0x00b2, "2"], // ²
  [0x00b3, "3"], // ³
  [0x00b4, "'"], // ´
  [0x00b6, NEUTRAL], // ¶
  [0x00b7, NEUTRAL], // ·
  [0x00b8, ","], // ¸
  [0x00b9, "1"], // ¹
  [0x00ba, "o"], // º
  [0x00bb, NEUTRAL], // »
  [0x00bc, NEUTRAL], // ¼
  [0x00bd, NEUTRAL], // ½
  [0x00be, NEUTRAL], // ¾
  [0x00bf, "?"], // ¿
  [0x00d7, "x"], // ×
  [0x00f7, NEUTRAL], // ÷
  // General punctuation of French typography.
  [0x2009, " "], // thin space
  [0x2010, "-"], // ‐ hyphen
  [0x2011, "-"], // ‑ non-breaking hyphen
  [0x2012, "-"], // ‒ figure dash
  [0x2013, "-"], // – en dash
  [0x2014, "-"], // — em dash
  [0x2015, "-"], // ― horizontal bar
  [0x2016, "|"], // ‖ double vertical line
  [0x2018, "'"], // ‘
  [0x2019, "'"], // ’
  [0x201a, ","], // ‚
  [0x201c, '"'], // “
  [0x201d, '"'], // ”
  [0x201e, '"'], // „
  [0x2020, NEUTRAL], // †
  [0x2021, NEUTRAL], // ‡
  [0x2022, NEUTRAL], // •
  [0x2026, "."], // …
  [0x202f, " "], // narrow no-break space
  [0x2030, "%"], // ‰
  [0x2032, "'"], // ′
  [0x2033, '"'], // ″
  [0x2039, NEUTRAL], // ‹
  [0x203a, NEUTRAL], // ›
  [0x2043, "-"], // ⁃ hyphen bullet
  [0x2044, "/"], // ⁄ fraction slash
  // Letterlike symbols, currency, arrows and mathematical operators of
  // technical prose.
  [0x20ac, "e"], // €
  [0x2116, "no"], // №
  [0x2122, "tm"], // ™
  [0x2190, NEUTRAL], // ←
  [0x2191, NEUTRAL], // ↑
  [0x2192, NEUTRAL], // →
  [0x2193, NEUTRAL], // ↓
  [0x2194, NEUTRAL], // ↔
  [0x21d0, NEUTRAL], // ⇐
  [0x21d2, NEUTRAL], // ⇒
  [0x21d4, NEUTRAL], // ⇔
  [0x2208, "e"], // ∈
  [0x2212, "-"], // − minus sign
  [0x221e, "oo"], // ∞
  [0x2227, NEUTRAL], // ∧
  [0x2228, "v"], // ∨
  [0x2229, "n"], // ∩
  [0x222a, "u"], // ∪
  [0x2248, NEUTRAL], // ≈
  [0x2260, NEUTRAL], // ≠
  [0x2264, NEUTRAL], // ≤
  [0x2265, NEUTRAL], // ≥
  [0x2282, "c"], // ⊂
  [0x2286, "c"], // ⊆
  [0x22ef, "."], // ⋯
  // Geometric shapes, dingbats and the status emoji.
  [0x25a0, NEUTRAL], // ■
  [0x25a1, "o"], // □
  [0x25aa, NEUTRAL], // ▪
  [0x25ab, NEUTRAL], // ▫
  [0x25b2, NEUTRAL], // ▲
  [0x25b6, NEUTRAL], // ▶
  [0x25bc, NEUTRAL], // ▼
  [0x25c6, NEUTRAL], // ◆
  [0x25cb, "o"], // ○
  [0x25cf, "o"], // ●
  [0x25e6, "o"], // ◦
  [0x2605, NEUTRAL], // ★
  [0x2606, NEUTRAL], // ☆
  [0x2610, "o"], // ☐
  [0x2611, "o"], // ☑
  [0x2612, "o"], // ☒
  [0x26a0, NEUTRAL], // ⚠
  [0x2705, NEUTRAL], // ✅
  [0x2713, "v"], // ✓
  [0x2714, "v"], // ✔
  [0x2717, "x"], // ✗
  [0x2718, "x"], // ✘
  [0x274c, "x"], // ❌
  [0x1f534, "o"], // 🔴
  [0x1f535, "o"], // 🔵
  [0x1f7e0, "o"], // 🟠
  [0x1f7e1, "o"], // 🟡
  [0x1f7e2, "o"], // 🟢
]);

const VARIATION_SELECTOR_16: number = 0xfe0f;
const SYMBOL_OTHER: RegExp = /^\p{So}$/u;
// The entries after which U+FE0F is admitted.
const EMOJI_BASES: ReadonlySet<number> = new Set<number>(
  [...SKELETON.keys()].filter((codePoint: number): boolean =>
    SYMBOL_OTHER.test(String.fromCodePoint(codePoint)),
  ),
);

/** True when the code point is printable ASCII, the tab, or a key of the table. */
export function admitsCodePoint(codePoint: number): boolean {
  if (codePoint === 0x09) return true;
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true;
  return SKELETON.has(codePoint);
}

// Opens a tag, a closing tag, a comment, a declaration, a CDATA section or a
// processing instruction; or an entity, named or numeric, with or without
// its semicolon (a browser decodes the legacy ones without it). `a < b` and
// `R&D` do not match: a single letter after `&` is not an entity unless a
// semicolon follows.
const HTML_MARKUP: RegExp =
  /<[A-Za-z!?/]|&(?:[A-Za-z](?:[A-Za-z0-9]+;?|;)|#(?:[0-9]+|[xX][0-9A-Fa-f]+);?)/;
// Every character that is not printable ASCII nor the tab: the candidates of
// the table. Line ends never occur inside a line.
const NON_ASCII: RegExp = /[^\t -~]/gu;
const CATEGORIES: readonly (readonly [string, RegExp])[] = [
  ["Lu", /\p{Lu}/u],
  ["Ll", /\p{Ll}/u],
  ["Lt", /\p{Lt}/u],
  ["Lm", /\p{Lm}/u],
  ["Lo", /\p{Lo}/u],
  ["Mn", /\p{Mn}/u],
  ["Mc", /\p{Mc}/u],
  ["Me", /\p{Me}/u],
  ["Nd", /\p{Nd}/u],
  ["Nl", /\p{Nl}/u],
  ["No", /\p{No}/u],
  ["Pc", /\p{Pc}/u],
  ["Pd", /\p{Pd}/u],
  ["Ps", /\p{Ps}/u],
  ["Pe", /\p{Pe}/u],
  ["Pi", /\p{Pi}/u],
  ["Pf", /\p{Pf}/u],
  ["Po", /\p{Po}/u],
  ["Sm", /\p{Sm}/u],
  ["Sc", /\p{Sc}/u],
  ["Sk", /\p{Sk}/u],
  ["So", /\p{So}/u],
  ["Zs", /\p{Zs}/u],
  ["Zl", /\p{Zl}/u],
  ["Zp", /\p{Zp}/u],
  ["Cc", /\p{Cc}/u],
  ["Cf", /\p{Cf}/u],
  ["Cs", /\p{Cs}/u],
  ["Co", /\p{Co}/u],
  ["Cn", /\p{Cn}/u],
];

function categoryOf(char: string): string {
  return (
    CATEGORIES.find(([, pattern]: readonly [string, RegExp]): boolean => pattern.test(char))?.[0] ??
    "Cn"
  );
}

function codePointOf(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/** 1-based column in code points of the UTF-16 index `index` of `line`. */
function columnOf(line: string, index: number): number {
  return [...line.slice(0, index)].length + 1;
}

/** The first character of the line outside the alphabet, or null. */
function outsideAlphabet(line: string): string | null {
  NON_ASCII.lastIndex = 0;
  let previousEnd: number = -1;
  let previousCodePoint: number = -1;
  let hit: RegExpExecArray | null = NON_ASCII.exec(line);
  while (hit !== null) {
    const char: string = hit[0];
    const codePoint: number = char.codePointAt(0) ?? 0;
    // The exception: U+FE0F directly after a So entry (the previous non-ASCII
    // match ended exactly where this one starts, and was such an entry).
    const admitted: boolean =
      SKELETON.has(codePoint) ||
      (codePoint === VARIATION_SELECTOR_16 &&
        previousEnd === hit.index &&
        EMOJI_BASES.has(previousCodePoint));
    if (!admitted) {
      return `column ${columnOf(line, hit.index)}, ${codePointOf(char)} (${categoryOf(char)}): outside the alphabet of a PRD (printable ASCII, the tab and the ${SKELETON.size} code points of the skeleton table)`;
    }
    previousEnd = hit.index + char.length;
    previousCodePoint = codePoint;
    hit = NON_ASCII.exec(line);
  }
  return null;
}

/** The first HTML construction of the line, or null. */
function htmlMarkup(line: string): string | null {
  const hit: RegExpExecArray | null = HTML_MARKUP.exec(line);
  if (hit === null) return null;
  return `column ${columnOf(line, hit.index)}: "${hit[0]}" opens HTML markup (a tag, a comment, a processing instruction or an entity), which a PRD never holds`;
}

// ---------------------------------------------------------------------------
// Rule 3, the skeleton of a line: what a line may say to a person. Detection
// only decides that a line MUST be strict; reading is always done on the raw
// line.
// ---------------------------------------------------------------------------

/**
 * The structural form of a line: lower case, every non-ASCII character
 * replaced by its skeleton (U+FE0F by nothing), `*`, `_`, `~`, a backtick and
 * a backslash removed, runs of white space as one space. The `|` of a table
 * and the `-` of an identifier are read on this form; the alphabet guarantees
 * that every character has a skeleton.
 */
export function structuralForm(line: string): string {
  return line
    .toLowerCase()
    .replace(NON_ASCII, (char: string): string => SKELETON.get(char.codePointAt(0) ?? -1) ?? "")
    .replace(/[*_~`\\]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * The detection form: the structural form with the ASCII confusables of the
 * key words folded — `rn` as `m`, `vv` as `w`, `0` as `o`, `1`, `i` and `|`
 * as `l`. Used only to find the key words and the identifiers of a form (the
 * digits of `WP-<n>` and `CA-<n>` are then `2`–`9`, `l` and `o`), never to
 * accept anything, and never for the `|` that structures a table.
 */
export function detectionForm(line: string): string {
  return structuralForm(line)
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/0/g, "o")
    .replace(/[1i|]/g, "l");
}

/**
 * The lines of the text, each of CRLF, a lone CR and LF ending one line, so
 * that a line number names a line of the original, with their skeletons.
 * Refused with its line and column: a character outside the alphabet, an HTML
 * construction. Nothing is read before this check holds on every line.
 */
export function readRawLines(markdown: string): Parsed<RawDocument> {
  const lines: readonly string[] = markdown.split(/\r\n?|\n/);
  const structural: string[] = [];
  const detection: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line: string = lines[index] ?? "";
    const problem: string | null = outsideAlphabet(line) ?? htmlMarkup(line);
    if (problem !== null) return fail(`line ${index + 1}, ${problem}`);
    const form: string = structuralForm(line);
    structural.push(form);
    detection.push(detectionForm(form));
  }
  return { ok: true, value: { lines, structural, detection } };
}

/** The document, read once: the text is read here, a document is returned as is. */
function documentOf(input: string | RawDocument): Parsed<RawDocument> {
  return typeof input === "string" ? readRawLines(input) : { ok: true, value: input };
}

// Rule 4: on the detection form, the markers before a form are every
// character that is neither a letter nor a digit, a numbering token (digits
// or one letter, dotted or not, with an optional `.` or `)`, as `1.`, `1)`,
// `1.2`, `a)`, `iv.`) and a task-list box. What follows is the first token.
// The box and the numbering come first: the generic alternative would
// otherwise consume their `[` or stop at their digit.
const LEADING_MARKERS: RegExp =
  /^(?:\[[ x]\](?![a-z0-9])|(?:[0-9lo]{1,9}(?:[.)][0-9lo]{1,9})*|[a-z]|[ivxl]{1,4})[.)]?(?=[^a-z0-9]|$)|[^a-z0-9])*/;

const afterMarkers = (form: string): string => form.replace(LEADING_MARKERS, "");

// ---------------------------------------------------------------------------
// Criteria (rule 3 of the model)
// ---------------------------------------------------------------------------

// Strict: 0-3 spaces, a bullet, optional bold, `CA-<digits>` and a boundary
// that is neither a letter nor a digit (`CA-1é` is not CA-1).
const CRITERION_BULLET: RegExp = /^ {0,3}[-*+][ \t]+(?:\*\*)?(CA-(\d+))(?![\p{L}\p{N}])/u;
const ANY_BULLET: RegExp = /^[ \t]*[-*+][ \t]+/;
// The clause starts a word: only white space, `.`, `,`, `;`, `(`, `*`, `_` or
// a backtick may precede it (`Invalidation :`, `Non-Validation :` and
// `~~Validation :~~` are not the clause).
const VALIDATION_CLAUSE: RegExp = /(?<![^\s.,;(*_`])Validation[ \t]*:/u;
// After the detection fold a digit is `2`-`9`, `l` (for 1, i, |) or `o` (for 0).
const CRITERION_FORM: RegExp = /^ca-[2-9lo]/;

/** True when the line, as a person reads it, starts by defining a `CA-<n>`. */
const looksLikeCriterion = (detection: string): boolean =>
  CRITERION_FORM.test(afterMarkers(detection));

/** The number of a `CA-<digits>` without its leading zeros: `CA-01` is `CA-1`. */
const numberKey = (digits: string): string => digits.replace(/^0+(?=\d)/, "");

/**
 * Read the `- CA-n … Validation : …` bullets. Every line whose detection
 * form starts, after its leading markers, with `CA-<n>` is a strict bullet
 * (0-3 spaces, `-`, `*` or `+`, optional bold) or the document is refused.
 * Line numbers are 1-based, of the original text.
 */
export function parseCriteria(input: string | RawDocument): Parsed<readonly Criterion[]> {
  const read: Parsed<RawDocument> = documentOf(input);
  if (!read.ok) return read;
  const { lines, detection } = read.value;
  const criteria: Criterion[] = [];
  const firstSeen: Map<string, { readonly id: string; readonly line: number }> = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const line: string = lines[index] ?? "";
    const lineNumber: number = index + 1;
    const match: RegExpExecArray | null = CRITERION_BULLET.exec(line);
    if (match === null) {
      if (looksLikeCriterion(detection[index] ?? "")) {
        return fail(
          `line ${lineNumber}: a CA-<n> definition that is not a strict criterion bullet ("- CA-<n> …", at most three spaces of indentation) is not read`,
        );
      }
      continue;
    }
    const id: string = match[1] ?? "";
    const key: string = numberKey(match[2] ?? "");

    const earlier: { readonly id: string; readonly line: number } | undefined = firstSeen.get(key);
    if (earlier !== undefined) {
      const spelling: string =
        earlier.id === id ? "" : ` (${earlier.id} and ${id} name the same number)`;
      return fail(
        `criterion ${id} is declared twice, at lines ${earlier.line} and ${lineNumber}${spelling}`,
      );
    }
    firstSeen.set(key, { id, line: lineNumber });

    // A bullet may wrap: indented lines that do not open a new bullet belong to it.
    let body: string = line;
    let next: number = index + 1;
    while (next < lines.length) {
      const continuation: string = lines[next] ?? "";
      if (
        continuation.trim() === "" ||
        ANY_BULLET.test(continuation) ||
        !/^[ \t]/.test(continuation)
      ) {
        break;
      }
      body += `\n${continuation}`;
      next += 1;
    }
    criteria.push({ id, line: lineNumber, hasValidation: VALIDATION_CLAUSE.test(body) });
  }
  return { ok: true, value: criteria };
}

// ---------------------------------------------------------------------------
// Work-package table (rule 2 of the model)
// ---------------------------------------------------------------------------

const EXPECTED_HEADER: readonly RegExp[] = [
  /^WP$/i,
  /^CA-n\b/i,
  /^Périmètre\b/i,
  /^Vérification\b/i,
  /^Porte\b/i,
];
// GFM: one or more dashes, with optional colons.
const RULE_CELL: RegExp = /^:?-+:?$/;
// The grammar of the `WP-<k>` of the trailer (check-work-package-link.ts,
// WP_SOURCE): a row the trailer cannot name could never be declared.
const WP_ID: RegExp = /^WP-[1-9][0-9]{0,8}$/;
const CA_ID: RegExp = /^CA-\d+$/;
const ROW_FORM: RegExp = /^wp-[2-9lo]/;

// The table cells are split on `|`: a verification command containing a pipe
// would shift the columns, which the cell-count check then reports as an error
// instead of reading a wrong value.
function splitRow(line: string): readonly string[] | null {
  const trimmed: string = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const inner: string = trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed.slice(1);
  return inner.split("|").map((cell: string): string => cell.trim());
}

const unquote = (cell: string): string => cell.replace(/`/g, "").trim();

const splitList = (cell: string): readonly string[] =>
  unquote(cell)
    .split(",")
    .map((item: string): string => item.trim())
    .filter((item: string): boolean => item !== "");

/**
 * Split a scope cell on the commas outside `{}`: `src/{a,b}/**` is one glob.
 * Unbalanced braces return null, since the split would be a guess.
 */
function splitGlobs(cell: string): readonly string[] | null {
  const globs: string[] = [];
  let depth: number = 0;
  let current: string = "";
  for (const char of unquote(cell)) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return null;
    if (char === "," && depth === 0) {
      globs.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (depth !== 0) return null;
  globs.push(current);
  return globs
    .map((glob: string): string => glob.trim())
    .filter((glob: string): boolean => glob !== "");
}

function isHeader(cells: readonly string[]): boolean {
  return (
    cells.length === EXPECTED_HEADER.length &&
    EXPECTED_HEADER.every((pattern: RegExp, position: number): boolean =>
      pattern.test(unquote(cells[position] ?? "")),
    )
  );
}

/**
 * True when the line, as a person reads it, is a header with a `WP` and a
 * `CA` cell: the cells are cut on the `|` of the structural form, their
 * words are read on the detection form after the leading markers.
 */
function looksLikeHeader(structural: string): boolean {
  if (!structural.includes("|")) return false;
  const cells: readonly string[] = structural
    .split("|")
    .map((cell: string): string => afterMarkers(detectionForm(cell).trim()));
  return (
    cells.some((cell: string): boolean => /^wp\b/.test(cell) && !ROW_FORM.test(cell)) &&
    cells.some((cell: string): boolean => /^ca\b/.test(cell))
  );
}

/** True when the line, as a person reads it, is a row starting with `WP-<n>`. */
const looksLikeRow = (structural: string, detection: string): boolean =>
  structural.includes("|") && ROW_FORM.test(afterMarkers(detection));

function parseRow(cells: readonly string[], lineNumber: number): Parsed<WorkPackage> {
  const id: string = unquote(cells[0] ?? "");
  const label: string = id === "" ? `line ${lineNumber}` : `${id} (line ${lineNumber})`;
  if (cells.length !== EXPECTED_HEADER.length) {
    return fail(
      `work package ${label}: expected ${EXPECTED_HEADER.length} cells, found ${cells.length}`,
    );
  }
  if (!WP_ID.test(id)) {
    return fail(
      `work package ${label}: identifier must be WP- and a positive integer of at most nine digits without a leading zero`,
    );
  }
  const criteria: readonly string[] = splitList(cells[1] ?? "");
  if (criteria.length === 0) return fail(`work package ${label}: cites no criterion`);
  const badCriterion: string | undefined = criteria.find(
    (criterion: string): boolean => !CA_ID.test(criterion),
  );
  if (badCriterion !== undefined) {
    return fail(`work package ${label}: "${badCriterion}" is not a CA-<n> identifier`);
  }
  const scope: readonly string[] | null = splitGlobs(cells[2] ?? "");
  if (scope === null) return fail(`work package ${label}: unbalanced braces in scope`);
  if (scope.length === 0) return fail(`work package ${label}: empty scope`);
  const verify: string = unquote(cells[3] ?? "");
  if (verify === "") return fail(`work package ${label}: empty verification command`);
  const door: string = unquote(cells[4] ?? "");
  if (door !== "one-way" && door !== "two-way") {
    return fail(`work package ${label}: door "${door}" is neither one-way nor two-way`);
  }
  return { ok: true, value: { id, criteria, scope, verify, door } };
}

/**
 * Read the `WP | CA-n | Périmètre | Vérification | Porte` table. Citing a CA
 * is not validated here: the gate checks the citation against the criteria
 * of the cited document.
 *
 * Refused, with the line: a line that looks like a header (a `WP` and a `CA`
 * cell) but is not the exact header; more than one exact header; a separator
 * row whose cell count is not that of the header; a line whose first token,
 * on its detection form and after its leading markers, is `WP-<n>` and which
 * holds a `|`, outside the block of the table.
 */
export function parseWorkPackages(input: string | RawDocument): Parsed<readonly WorkPackage[]> {
  const read: Parsed<RawDocument> = documentOf(input);
  if (!read.ok) return read;
  const { lines, structural, detection } = read.value;
  const headers: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const cells: readonly string[] | null = splitRow(lines[index] ?? "");
    if (cells !== null && isHeader(cells)) {
      headers.push(index);
    } else if (looksLikeHeader(structural[index] ?? "")) {
      return fail(
        `line ${index + 1}: a work-package table header that is not the exact header (\`| WP | CA-n | Périmètre | Vérification | Porte |\`, plain cells) is not read`,
      );
    }
  }
  const headerAt: number | undefined = headers[0];
  if (headerAt === undefined) {
    return fail(
      "work-package table not found (expected header: WP | CA-n | Périmètre | Vérification | Porte)",
    );
  }
  if (headers.length > 1) {
    const at: string = headers.map((index: number): string => String(index + 1)).join(" and ");
    return fail(
      `work-package table header at lines ${at}: a PRD holds exactly one work-package table`,
    );
  }
  const rule: readonly string[] | null = splitRow(lines[headerAt + 1] ?? "");
  if (
    rule === null ||
    rule.length !== EXPECTED_HEADER.length ||
    !rule.every((cell: string): boolean => RULE_CELL.test(cell))
  ) {
    return fail(
      `work-package table at line ${headerAt + 1} has no separator row of ${EXPECTED_HEADER.length} cells`,
    );
  }

  const packages: WorkPackage[] = [];
  const firstSeen: Map<string, number> = new Map<string, number>();
  let end: number = headerAt + 2;
  for (; end < lines.length; end += 1) {
    const cells: readonly string[] | null = splitRow(lines[end] ?? "");
    if (cells === null) break;
    const lineNumber: number = end + 1;
    const row: Parsed<WorkPackage> = parseRow(cells, lineNumber);
    if (!row.ok) return row;
    const earlier: number | undefined = firstSeen.get(row.value.id);
    if (earlier !== undefined) {
      return fail(
        `work package ${row.value.id} is declared twice, at lines ${earlier} and ${lineNumber}`,
      );
    }
    firstSeen.set(row.value.id, lineNumber);
    packages.push(row.value);
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (index >= headerAt && index < end) continue;
    if (looksLikeRow(structural[index] ?? "", detection[index] ?? "")) {
      return fail(
        `line ${index + 1}: a WP-<n> row outside the block of the work-package table is not read`,
      );
    }
  }
  if (packages.length === 0) return fail("work-package table has a header but no row");
  return { ok: true, value: packages };
}

// ---------------------------------------------------------------------------
// Document maturity (rule 1 of the model)
// ---------------------------------------------------------------------------

// Only the "du document" form counts: in the pilot PRD the bare `Maturité :`
// qualifies the observed project, and the document itself is "a proposal".
const DOCUMENT_MATURITY_LINE: RegExp =
  /^ {0,3}(?:[-*+][ \t]+)?(?:\*\*)?Maturité du document[ \t]*:(?:\*\*)?[ \t]*(.*)$/i;
// The key word on its detection form, letters and digits only: compared
// skeleton to skeleton.
const lettersOnly = (detection: string): string => detection.replace(/[^a-z0-9]/g, "");
const MATURITY_MENTION: string = lettersOnly(detectionForm("Maturité du document"));
// Rule 5: after the level, only the end of the line, a space, a tab, `.`,
// `,`, `;`, `:` or `)`; `décisionnel`, `décision-rejetée` and `décision/x`
// give none.
const LEVEL_BOUNDARY: RegExp = /^(?:$|[ \t.,;:)])/;

const LEVELS_LONGEST_FIRST: readonly MaturityLevel[] = [...MATURITY_LADDER].sort(
  (a: MaturityLevel, b: MaturityLevel): number => b.length - a.length,
);

function levelOf(value: string): MaturityLevel | null {
  const cleaned: string = value.replace(/[*`_]/g, "").trim().toLowerCase();
  for (const level of LEVELS_LONGEST_FIRST) {
    if (!cleaned.startsWith(level)) continue;
    if (!LEVEL_BOUNDARY.test(cleaned.slice(level.length))) continue;
    return level;
  }
  return null;
}

/** How many times the letters mention "maturité du document". */
function mentionsIn(letters: string): number {
  return letters.split(MATURITY_MENTION).length - 1;
}

/**
 * A mention split by hard line ends: an occurrence inside the letters of a
 * run of consecutive non-empty lines that starts on one line and ends on
 * another. Returns the 1-based first and last line of the first such
 * occurrence, or null.
 */
function splitMention(
  letters: readonly string[],
  lines: readonly string[],
): readonly [number, number] | null {
  let start: number = 0;
  while (start < lines.length) {
    if ((lines[start] ?? "").trim() === "") {
      start += 1;
      continue;
    }
    let end: number = start;
    while (end < lines.length && (lines[end] ?? "").trim() !== "") end += 1;
    // The run is [start, end): join its letters, remembering where each line ends.
    const ends: number[] = [];
    let joined: string = "";
    for (let index = start; index < end; index += 1) {
      joined += letters[index] ?? "";
      ends.push(joined.length);
    }
    let at: number = joined.indexOf(MATURITY_MENTION);
    while (at !== -1) {
      const last: number = at + MATURITY_MENTION.length - 1;
      const firstLine: number = ends.findIndex((lineEnd: number): boolean => at < lineEnd);
      const lastLine: number = ends.findIndex((lineEnd: number): boolean => last < lineEnd);
      if (firstLine !== lastLine) return [start + firstLine + 1, start + lastLine + 1];
      at = joined.indexOf(MATURITY_MENTION, at + 1);
    }
    start = end;
  }
  return null;
}

/**
 * The level declared by the `Maturité du document :` line. Every line whose
 * detection form mentions "maturité du document" must be exactly one strict
 * declaration line, or the document is refused with the line; a mention split
 * across the lines of a paragraph is refused naming its first and last line.
 * `ok: true` with null when no strict line gives a level, or when the strict
 * lines disagree (fail closed: an ambiguous document does not reach a
 * maturity threshold).
 */
export function readDocumentMaturity(input: string | RawDocument): Parsed<MaturityLevel | null> {
  const read: Parsed<RawDocument> = documentOf(input);
  if (!read.ok) return read;
  const { lines, detection } = read.value;
  const letters: readonly string[] = detection.map(lettersOnly);
  const split: readonly [number, number] | null = splitMention(letters, lines);
  if (split !== null) {
    return fail(
      `lines ${split[0]} to ${split[1]}: "Maturité du document" split across a line end is not read`,
    );
  }
  const levels: (MaturityLevel | null)[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const mentions: number = mentionsIn(letters[index] ?? "");
    if (mentions === 0) continue;
    const strict: RegExpExecArray | null = DOCUMENT_MATURITY_LINE.exec(lines[index] ?? "");
    if (strict === null || mentions !== 1) {
      return fail(
        `line ${index + 1}: "Maturité du document" outside a strict declaration line (\`Maturité du document : <level>\`, at most three spaces of indentation, an optional bullet and bold) is not read`,
      );
    }
    levels.push(levelOf(strict[1] ?? ""));
  }
  const first: MaturityLevel | null | undefined = levels[0];
  if (first === undefined || first === null) return { ok: true, value: null };
  return {
    ok: true,
    value: levels.every((level: MaturityLevel | null): boolean => level === first) ? first : null,
  };
}

/** True when `level` is at or above `floor` on the maturity ladder. */
export function atLeast(level: MaturityLevel, floor: MaturityLevel): boolean {
  const levelIndex: number = MATURITY_LADDER.indexOf(level);
  const floorIndex: number = MATURITY_LADDER.indexOf(floor);
  // indexOf answers -1 for a value off the ladder (a floor read from YAML or
  // JSON and cast): comparing it would pass every document, so fail closed.
  if (levelIndex === -1 || floorIndex === -1) return false;
  return levelIndex >= floorIndex;
}
