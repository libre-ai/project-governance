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
 * imitates a renderer (fences, comments, HTML blocks, indented code, list
 * items) disagrees with it somewhere, and each disagreement lets a quoted
 * example be read as live or hides a live line. The reviewer of a PRD reads
 * the raw diff; so does the gate. A PRD therefore never quotes a declaration
 * form: it paraphrases it.
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
// Raw lines
// ---------------------------------------------------------------------------

// Characters a regular expression, an editor or a renderer may split or hide
// differently from this reader, which ends lines on LF, CRLF and CR only:
// the C0 controls other than the tab, U+0085, U+2028 and U+2029. Built from
// code points so that the source holds no invisible character.
const UNREADABLE: RegExp = new RegExp(
  `[${String.fromCodePoint(0x00)}-${String.fromCodePoint(0x08)}${String.fromCodePoint(0x0b, 0x0c)}${String.fromCodePoint(0x0e)}-${String.fromCodePoint(0x1f)}${String.fromCodePoint(0x85, 0x2028, 0x2029)}]`,
);

function codePointOf(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * The lines of the text, each of CRLF, a lone CR and LF ending one line, so
 * that a line number names a line of the original. Refused with its line: a
 * character of `UNREADABLE`.
 */
export function readRawLines(markdown: string): Parsed<readonly string[]> {
  const lines: readonly string[] = markdown.split(/\r\n?|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const hit: RegExpExecArray | null = UNREADABLE.exec(lines[index] ?? "");
    if (hit !== null) {
      return fail(
        `line ${index + 1}: the character ${codePointOf(hit[0])} is not read (a line separator or a control character)`,
      );
    }
  }
  return { ok: true, value: lines };
}

// ---------------------------------------------------------------------------
// Detection form: what a line may say to a person, folded so that a spelling
// cannot hide a declaration form from the detector. Detection only decides
// that a line MUST be strict; reading is always done on the raw line.
// ---------------------------------------------------------------------------

const ENTITY: RegExp = /&(#[0-9]{1,8}|#[xX][0-9A-Fa-f]{1,7}|[A-Za-z][A-Za-z0-9]{0,31});/g;
// `&eacute;`, `&Agrave;`, `&ccedil;`…: the base letter is enough, since the
// accents are folded next.
const LETTER_ENTITY: RegExp = /^([A-Za-z])(?:acute|grave|circ|uml|tilde|cedil|ring|slash)$/;
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  ast: "*",
  bsol: "\\",
  colon: ":",
  dash: "-",
  emsp: " ",
  ensp: " ",
  grave: "`",
  gt: ">",
  hyphen: "-",
  lowbar: "_",
  lt: "<",
  minus: "-",
  nbsp: " ",
  num: "#",
  quot: '"',
  thinsp: " ",
  verbar: "|",
  vert: "|",
};
const TAG: RegExp = /<\/?[A-Za-z][^<>]*>/g;
const PRINTABLE_ASCII: RegExp = /^[ -~\t]*$/;

function decodeEntity(_whole: string, body: string): string {
  if (body.startsWith("#")) {
    const point: number =
      body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    const valid: boolean = point <= 0x10ffff && (point < 0xd800 || point > 0xdfff);
    return valid ? String.fromCodePoint(point) : "";
  }
  if (Object.hasOwn(NAMED_ENTITIES, body)) return NAMED_ENTITIES[body] ?? "";
  // An unknown entity is removed: removal can only join the letters around
  // it, so a declaration form spelled with it is still detected.
  return LETTER_ENTITY.exec(body)?.[1] ?? "";
}

/**
 * The line as a person may read it, folded for detection: compatibility
 * forms (NFKC), HTML entities decoded (an unknown one removed), HTML tags
 * removed, accents and invisible format characters removed, `*`, `_`, a
 * backtick and a backslash removed, lower case, runs of white space as one
 * space.
 */
export function detectionForm(line: string): string {
  const folded: string = PRINTABLE_ASCII.test(line)
    ? line.replace(ENTITY, decodeEntity).replace(TAG, "")
    : line
        .normalize("NFKC")
        .replace(ENTITY, decodeEntity)
        .normalize("NFKC")
        .replace(TAG, "")
        .normalize("NFD")
        .replace(/[\p{M}\p{Cf}]/gu, "");
  return folded
    .replace(/[*_`\\]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Criteria (rule 3)
// ---------------------------------------------------------------------------

const CRITERION_BULLET: RegExp = /^ {0,3}[-*+][ \t]+(?:\*\*)?(CA-\d+)\b/;
const ANY_BULLET: RegExp = /^[ \t]*[-*+][ \t]+/;
const VALIDATION_CLAUSE: RegExp = /Validation[ \t]*:/;
// Indentation, list, quote and heading markers before a definition.
const DEFINITION_PREFIX: RegExp = /^(?:[\s>#+-]|\d{1,9}[.)])+/;
const CRITERION_FORM: RegExp = /^ca-\d+(?![\p{L}\p{N}])/u;

/** True when the line, as a person reads it, starts by defining a `CA-<n>`. */
function looksLikeCriterion(line: string): boolean {
  return CRITERION_FORM.test(detectionForm(line).replace(DEFINITION_PREFIX, ""));
}

/**
 * Read the `- CA-n … Validation : …` bullets. Every line that starts, after
 * indentation, list, quote or heading markers and emphasis, with `CA-<n>` and
 * a separator is a strict bullet (0-3 spaces, `-`, `*` or `+`, optional bold)
 * or the document is refused. Line numbers are 1-based, of the original text.
 */
export function parseCriteria(markdown: string): Parsed<readonly Criterion[]> {
  const read: Parsed<readonly string[]> = readRawLines(markdown);
  if (!read.ok) return read;
  const lines: readonly string[] = read.value;
  const criteria: Criterion[] = [];
  const firstSeen: Map<string, number> = new Map<string, number>();

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

    const earlier: number | undefined = firstSeen.get(id);
    if (earlier !== undefined) {
      return fail(`criterion ${id} is declared twice, at lines ${earlier} and ${lineNumber}`);
    }
    firstSeen.set(id, lineNumber);

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
// Work-package table (rule 2)
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
  return form.includes("|") && /^[\s|]*wp-\d/.test(form);
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
 * row whose cell count is not that of the header; a line that starts with
 * `WP-<n>` and holds a `|` outside the block of the table.
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
// Document maturity (rule 1)
// ---------------------------------------------------------------------------

// Only the "du document" form counts: in the pilot PRD the bare `Maturité :`
// qualifies the observed project, and the document itself is "a proposal".
const DOCUMENT_MATURITY_LINE: RegExp =
  /^ {0,3}(?:[-*+][ \t]+)?(?:\*\*)?Maturité du document[ \t]*:(?:\*\*)?[ \t]*(.*)$/i;
const MATURITY_MENTION: string = "maturitedudocument";

const LEVELS_LONGEST_FIRST: readonly MaturityLevel[] = [...MATURITY_LADDER].sort(
  (a: MaturityLevel, b: MaturityLevel): number => b.length - a.length,
);

function levelOf(value: string): MaturityLevel | null {
  const cleaned: string = value.normalize("NFC").replace(/[*`_]/g, "").trim().toLowerCase();
  for (const level of LEVELS_LONGEST_FIRST) {
    if (!cleaned.startsWith(level)) continue;
    // Whole word only: "décisionnel" must not read as "décision".
    if (/^\p{L}/u.test(cleaned.slice(level.length))) continue;
    return level;
  }
  return null;
}

/** How many times the line, as a person reads it, mentions "maturité du document". */
function maturityMentions(line: string): number {
  const letters: string = detectionForm(line).replace(/[^\p{L}\p{N}]/gu, "");
  return letters.split(MATURITY_MENTION).length - 1;
}

/**
 * The level declared by the `Maturité du document :` line. Every line that
 * mentions "maturité du document" (once folded by `detectionForm`) must be
 * exactly one strict declaration line, or the document is refused with the
 * line. `ok: true` with null when no strict line gives a level, or when the
 * strict lines disagree (fail closed: an ambiguous document does not reach a
 * maturity threshold).
 */
export function readDocumentMaturity(markdown: string): Parsed<MaturityLevel | null> {
  const read: Parsed<readonly string[]> = readRawLines(markdown);
  if (!read.ok) return read;
  const levels: (MaturityLevel | null)[] = [];
  for (let index = 0; index < read.value.length; index += 1) {
    const line: string = read.value[index] ?? "";
    const mentions: number = maturityMentions(line);
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
