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
 * detecting what it must not (that class was open: entities, tags, comments,
 * homoglyphs, format characters, non-ASCII dashes, each a spelling that hid a
 * form from a detector). Rule 1 is a closed alphabet, checked on every
 * character before anything is read; rule 2 refuses HTML; the detection fold
 * of rule 3 then only has to fold what the alphabet lets through.
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

const fail = (reason: string): { readonly ok: false; readonly reason: string } => ({
  ok: false,
  reason,
});

// ---------------------------------------------------------------------------
// Rule 1: the alphabet of a PRD
// ---------------------------------------------------------------------------

// What a line may hold: the tab, a space of category Zs, an ASCII digit, an
// ASCII letter, a precomposed Latin-1 letter (U+00C0-U+00FF; × U+00D7 and ÷
// U+00F7 are symbols, admitted as such), Œ œ Ÿ, and any punctuation or
// symbol. Everything else is outside: format characters (Cf), combining marks
// (M*), letters of other scripts or blocks (confusable with these), non-ASCII
// digits, controls other than the tab (DEL and C1 included), separators Zl
// and Zp, private use, surrogates and unassigned code points. The `g` flag
// serves the one loop that skips the single admitted exception below. The
// class is built from code points so that the source stays ASCII.
const range = (from: number, to: number): string =>
  `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
const LATIN1_LETTERS: string = `${range(0xc0, 0xd6)}${range(0xd8, 0xf6)}${range(0xf8, 0xff)}${String.fromCodePoint(0x152, 0x153, 0x178)}`;
const OUTSIDE_ALPHABET: RegExp = new RegExp(
  `[^\\t0-9A-Za-z${LATIN1_LETTERS}\\p{Zs}\\p{P}\\p{S}]`,
  "gu",
);
// The one exception: the variation selector 16 (Mn), which asks for the emoji
// presentation of the symbol (So) it follows. Nowhere else.
const VARIATION_SELECTOR_16: number = 0xfe0f;
const SYMBOL_OTHER: RegExp = /^\p{So}$/u;
// Opens a tag, a closing tag, a comment, a declaration, a CDATA section or a
// processing instruction; or an entity, named or numeric, with or without
// its semicolon (a browser decodes the legacy ones without it). `a < b` and
// `R&D` do not match: a single letter after `&` is not an entity unless a
// semicolon follows.
const HTML_MARKUP: RegExp =
  /<[A-Za-z!?/]|&(?:[A-Za-z](?:[A-Za-z0-9]+;?|;)|#(?:[0-9]+|[xX][0-9A-Fa-f]+);?)/;
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

const describe = (line: string, index: number, char: string): string =>
  `column ${columnOf(line, index)}, ${codePointOf(char)} (${categoryOf(char)})`;

/** The first character of the line outside the alphabet, or null. */
function outsideAlphabet(line: string): string | null {
  OUTSIDE_ALPHABET.lastIndex = 0;
  let hit: RegExpExecArray | null = OUTSIDE_ALPHABET.exec(line);
  while (hit !== null) {
    const char: string = hit[0];
    const previous: string | undefined = [
      ...line.slice(Math.max(0, hit.index - 2), hit.index),
    ].pop();
    if (
      char.codePointAt(0) === VARIATION_SELECTOR_16 &&
      previous !== undefined &&
      SYMBOL_OTHER.test(previous)
    ) {
      hit = OUTSIDE_ALPHABET.exec(line);
      continue;
    }
    return `${describe(line, hit.index, char)}: outside the alphabet of a PRD (ASCII, the Latin-1 letters, punctuation, symbols, spaces and the tab)`;
  }
  return null;
}

/** The first character at which the line differs from its NFC form, or null. */
function notNfc(line: string): string | null {
  const composed: string = line.normalize("NFC");
  if (composed === line) return null;
  let index: number = 0;
  while (index < line.length && line[index] === composed[index]) index += 1;
  const char: string = String.fromCodePoint(line.codePointAt(index) ?? 0);
  return `${describe(line, index, char)}: not in Unicode normalization form C`;
}

/** The first HTML construction of the line, or null. */
function htmlMarkup(line: string): string | null {
  const hit: RegExpExecArray | null = HTML_MARKUP.exec(line);
  if (hit === null) return null;
  return `column ${columnOf(line, hit.index)}: "${hit[0]}" opens HTML markup (a tag, a comment, a processing instruction or an entity), which a PRD never holds`;
}

/**
 * The lines of the text, each of CRLF, a lone CR and LF ending one line, so
 * that a line number names a line of the original. Refused with its line and
 * column: a character outside the alphabet, a line not in NFC, an HTML
 * construction. Nothing is read before this check holds on every line.
 */
export function readRawLines(markdown: string): Parsed<readonly string[]> {
  const lines: readonly string[] = markdown.split(/\r\n?|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line: string = lines[index] ?? "";
    const problem: string | null = outsideAlphabet(line) ?? notNfc(line) ?? htmlMarkup(line);
    if (problem !== null) return fail(`line ${index + 1}, ${problem}`);
  }
  return { ok: true, value: lines };
}

// ---------------------------------------------------------------------------
// Rule 3, detection form: what a line may say to a person, folded so that a
// spelling inside the alphabet cannot hide a declaration form from the
// detector. Detection only decides that a line MUST be strict; reading is
// always done on the raw line.
// ---------------------------------------------------------------------------

// Dashes read as `-`, colons as `:`, bars as `|`: the punctuation and symbols
// of the alphabet that a person reads as the ASCII character of a form.
const CONFUSABLE_PUNCTUATION: Readonly<Record<string, string>> = {
  [String.fromCodePoint(0x2010)]: "-",
  [String.fromCodePoint(0x2011)]: "-",
  [String.fromCodePoint(0x2012)]: "-",
  [String.fromCodePoint(0x2013)]: "-",
  [String.fromCodePoint(0x2014)]: "-",
  [String.fromCodePoint(0x2015)]: "-",
  [String.fromCodePoint(0x2212)]: "-",
  [String.fromCodePoint(0xfe63)]: "-",
  [String.fromCodePoint(0xff0d)]: "-",
  [String.fromCodePoint(0xff1a)]: ":",
  [String.fromCodePoint(0x2236)]: ":",
  [String.fromCodePoint(0xfe55)]: ":",
  [String.fromCodePoint(0xa789)]: ":",
  [String.fromCodePoint(0xff5c)]: "|",
  [String.fromCodePoint(0x2223)]: "|",
  [String.fromCodePoint(0xffe4)]: "|",
  [String.fromCodePoint(0x00a6)]: "|",
};
const CONFUSABLE: RegExp = new RegExp(`[${Object.keys(CONFUSABLE_PUNCTUATION).join("")}]`, "g");

/**
 * The line as a person may read it, folded for detection: accents of the
 * Latin-1 letters removed (NFD, then the combining marks, which the alphabet
 * guarantees come only from that decomposition), `*`, `_`, `~`, a backtick
 * and a backslash removed, confusable dashes, colons and bars read as `-`,
 * `:` and `|`, lower case, runs of white space as one space.
 */
export function detectionForm(line: string): string {
  return line
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[*_~`\\]/g, "")
    .replace(CONFUSABLE, (char: string): string => CONFUSABLE_PUNCTUATION[char] ?? char)
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Rule 4: on the folded line, every leading character that is neither a
// letter nor a digit, an ordered-list number and a task-list box are
// markers before a form; what follows is the first token read.
// The box and the number come first: the generic alternative would otherwise
// consume their `[` or stop at their digit.
const LEADING_MARKERS: RegExp =
  /^(?:\[[ x]\](?![\p{L}\p{N}])|\d{1,9}[.)](?![\p{L}\p{N}])|[^\p{L}\p{N}])*/u;

const afterMarkers = (form: string): string => form.replace(LEADING_MARKERS, "");

// ---------------------------------------------------------------------------
// Criteria (rule 3 of the model)
// ---------------------------------------------------------------------------

// Strict: 0-3 spaces, a bullet, optional bold, `CA-<digits>` and a boundary
// that is neither a letter nor a digit (`CA-1é` is not CA-1).
const CRITERION_BULLET: RegExp = /^ {0,3}[-*+][ \t]+(?:\*\*)?(CA-(\d+))(?![\p{L}\p{N}])/u;
const ANY_BULLET: RegExp = /^[ \t]*[-*+][ \t]+/;
// The clause, as a word: `Invalidation :` is not it.
const VALIDATION_CLAUSE: RegExp = /(?<![\p{L}\p{N}])Validation[ \t]*:/u;
const CRITERION_FORM: RegExp = /^ca-\d/;

/** True when the line, as a person reads it, starts by defining a `CA-<n>`. */
function looksLikeCriterion(line: string): boolean {
  return CRITERION_FORM.test(afterMarkers(detectionForm(line)));
}

/** The number of a `CA-<digits>` without its leading zeros: `CA-01` is `CA-1`. */
const numberKey = (digits: string): string => digits.replace(/^0+(?=\d)/, "");

/**
 * Read the `- CA-n … Validation : …` bullets. Every line that starts, once
 * folded and after its leading markers, with `CA-<n>` is a strict bullet
 * (0-3 spaces, `-`, `*` or `+`, optional bold) or the document is refused.
 * Line numbers are 1-based, of the original text.
 */
export function parseCriteria(markdown: string): Parsed<readonly Criterion[]> {
  const read: Parsed<readonly string[]> = readRawLines(markdown);
  if (!read.ok) return read;
  const lines: readonly string[] = read.value;
  const criteria: Criterion[] = [];
  const firstSeen: Map<string, { readonly id: string; readonly line: number }> = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const line: string = lines[index] ?? "";
    const lineNumber: number = index + 1;
    const match: RegExpExecArray | null = CRITERION_BULLET.exec(line);
    if (match === null) {
      if (looksLikeCriterion(line)) {
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
const ROW_FORM: RegExp = /^wp-\d/;

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

/** True when the line, as a person reads it, is a header with a `WP` and a `CA` cell. */
function looksLikeHeader(line: string): boolean {
  const form: string = detectionForm(line);
  if (!form.includes("|")) return false;
  const cells: readonly string[] = form.split("|").map((cell: string): string => cell.trim());
  return (
    cells.some((cell: string): boolean => /^wp\b/.test(cell) && !/^wp-?\d/.test(cell)) &&
    cells.some((cell: string): boolean => /^ca\b/.test(cell))
  );
}

/** True when the line, as a person reads it, is a row starting with `WP-<n>`. */
function looksLikeRow(line: string): boolean {
  const form: string = detectionForm(line);
  return form.includes("|") && ROW_FORM.test(afterMarkers(form));
}

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
 * once folded and after its leading markers, is `WP-<n>` and which holds a
 * `|`, outside the block of the table.
 */
export function parseWorkPackages(markdown: string): Parsed<readonly WorkPackage[]> {
  const read: Parsed<readonly string[]> = readRawLines(markdown);
  if (!read.ok) return read;
  const lines: readonly string[] = read.value;
  const headers: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line: string = lines[index] ?? "";
    const cells: readonly string[] | null = splitRow(line);
    if (cells !== null && isHeader(cells)) {
      headers.push(index);
    } else if (looksLikeHeader(line)) {
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
    if (looksLikeRow(lines[index] ?? "")) {
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
const MATURITY_MENTION: string = "maturitedudocument";
// Rule 5: after the level, only the end of the line, a space, a tab or an
// ASCII punctuation; `décisionnel`, `décisioné` and `décision–x` give none.
const ASCII_BOUNDARY: RegExp = /^(?:$|[ \t!-/:-@[-`{-~])/;

const LEVELS_LONGEST_FIRST: readonly MaturityLevel[] = [...MATURITY_LADDER].sort(
  (a: MaturityLevel, b: MaturityLevel): number => b.length - a.length,
);

function levelOf(value: string): MaturityLevel | null {
  const cleaned: string = value.replace(/[*`_]/g, "").trim().toLowerCase();
  for (const level of LEVELS_LONGEST_FIRST) {
    if (!cleaned.startsWith(level)) continue;
    if (!ASCII_BOUNDARY.test(cleaned.slice(level.length))) continue;
    return level;
  }
  return null;
}

/** The letters and digits of the line, as a person reads it: the carrier of a mention. */
function lettersOf(line: string): string {
  return detectionForm(line).replace(/[^\p{L}\p{N}]/gu, "");
}

/** How many times the letters mention "maturité du document". */
function mentionsIn(letters: string): number {
  return letters.split(MATURITY_MENTION).length - 1;
}

// A mention split by a hard line end: an occurrence inside the join of two
// consecutive lines that neither holds alone. The window of 17 letters on
// each side cannot hold an 18-letter occurrence on one side only.
const WINDOW: number = MATURITY_MENTION.length - 1;

/**
 * The level declared by the `Maturité du document :` line. Every line that
 * mentions "maturité du document" (once folded by `detectionForm`) must be
 * exactly one strict declaration line, or the document is refused with the
 * line; a mention split across two lines is refused naming both. `ok: true`
 * with null when no strict line gives a level, or when the strict lines
 * disagree (fail closed: an ambiguous document does not reach a maturity
 * threshold).
 */
export function readDocumentMaturity(markdown: string): Parsed<MaturityLevel | null> {
  const read: Parsed<readonly string[]> = readRawLines(markdown);
  if (!read.ok) return read;
  const levels: (MaturityLevel | null)[] = [];
  let previousLetters: string = "";
  for (let index = 0; index < read.value.length; index += 1) {
    const line: string = read.value[index] ?? "";
    const letters: string = lettersOf(line);
    if (index > 0 && mentionsIn(previousLetters.slice(-WINDOW) + letters.slice(0, WINDOW)) > 0) {
      return fail(
        `lines ${index} and ${index + 1}: "Maturité du document" split across a line end is not read`,
      );
    }
    previousLetters = letters;
    const mentions: number = mentionsIn(letters);
    if (mentions === 0) continue;
    const strict: RegExpExecArray | null = DOCUMENT_MATURITY_LINE.exec(line);
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
