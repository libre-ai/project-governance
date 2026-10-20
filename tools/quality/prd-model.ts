/**
 * Reading model of a product requirements document (PRD) and of its
 * work-package table. Pure functions over Markdown text: no I/O, no git.
 *
 * Every reader fails closed. A document that does not carry the structure
 * returns `ok: false` with a reason, never an empty success, so that a gate
 * built on top cannot confuse "nothing declared" with "could not read".
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

// 0-3 spaces, then a run of three or more backticks (whose info string holds
// no backtick) or of three or more tildes. Four spaces make an indented line,
// not a fence: the parsers read lines of text, so its keywords count.
const BACKTICK_OPENER: RegExp = /^ {0,3}(`{3,})[^`]*$/;
const TILDE_OPENER: RegExp = /^ {0,3}(~{3,}).*$/;
const FENCE_CLOSER: RegExp = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const COMMENT_OPEN: string = "<!--";
const COMMENT_CLOSE: string = "-->";

// Constructions this reader does not model. Each one would make the reader
// disagree with a Markdown renderer about where a fence or a comment starts or
// ends, and so read a quoted example as live text (or hide a live line), so a
// document holding one is refused instead of read.
//
// A run of three backticks or tildes right after one or more list or quote
// markers: CommonMark opens a fence inside the item or the quote.
const FENCE_AFTER_MARKER: RegExp = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+|>[ \t]*)+(?:`{3}|~{3})/;
// The complete empty comments of CommonMark: `<!-->` and `<!--->` end where
// they start, whereas this reader would look for a later `-->`.
const EMPTY_COMMENTS: readonly string[] = ["<!-->", "<!--->"];
// A comment opener is read only at the start of a line, after at most three
// spaces: elsewhere it may sit in a code span or an indented block, where a
// renderer shows it as text.
const COMMENT_START_LIMIT: number = 3;
// Line terminators that a renderer or a regular expression could honour while
// this reader, which splits on LF, CRLF and CR only, does not.
// Built from code points so that the source holds no invisible character.
const FOREIGN_LINE_BREAK: RegExp = new RegExp(`[${String.fromCodePoint(0x0085, 0x2028, 0x2029)}]`);

function codePointOf(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Why the reader refuses this line outside fences and comments, or null. */
function refusedOpening(line: string, start: number): string | null {
  const before: string = line.slice(0, start);
  if (before.length > COMMENT_START_LIMIT || /[^ ]/.test(before)) {
    return `"${COMMENT_OPEN}" that does not start the line (after at most three spaces) is not read; put the comment on its own line`;
  }
  const rest: string = line.slice(start);
  if (EMPTY_COMMENTS.some((empty: string): boolean => rest.startsWith(empty))) {
    return `the complete empty comment "${rest.startsWith("<!--->") ? "<!--->" : "<!-->"}" is not read; write "<!-- -->"`;
  }
  return null;
}

interface OpenFence {
  readonly char: string;
  readonly length: number;
}

function fenceOpenedBy(line: string): OpenFence | null {
  const match: RegExpExecArray | null = BACKTICK_OPENER.exec(line) ?? TILDE_OPENER.exec(line);
  const run: string | undefined = match?.[1];
  return run === undefined ? null : { char: run.charAt(0), length: run.length };
}

function closes(line: string, fence: OpenFence): boolean {
  const run: string | undefined = FENCE_CLOSER.exec(line)?.[1];
  return run !== undefined && run.charAt(0) === fence.char && run.length >= fence.length;
}

function blankOf(text: string): string {
  return " ".repeat(text.length);
}

/**
 * The Markdown text with its fenced code blocks and its HTML comments replaced
 * by spaces, line ends normalised to `\n` (CRLF and a lone CR each end one
 * line). Every line keeps its number, so a reader of the result can name a
 * line of the original.
 *
 * Why its own reader: a PRD quotes examples of PRDs. A fence closed by any
 * line starting with three backticks, or a comment opened inside a fence,
 * would let such an example declare a maturity or a criterion.
 *
 * A fence opens on a line of 0-3 spaces and three or more backticks (the info
 * string holds no backtick) or tildes; it closes on a line of 0-3 spaces and
 * a run of the SAME character at least as long, followed only by spaces or
 * tabs. An unclosed fence runs to the end. Outside fences, `<!--` opens a
 * comment at the start of a line (after at most three spaces), `-->` ends it,
 * and an unterminated comment runs to the end.
 *
 * Refused, with the 1-based line of the original text (fail closed: the
 * reader cannot say where a renderer would put the fence or the comment):
 * U+0085, U+2028 or U+2029 anywhere; outside fences and comments, a run of
 * three backticks or tildes right after a list or quote marker, a `<!--`
 * elsewhere than at the start of a line, and the empty comments `<!-->` and
 * `<!--->`.
 */
export function blankFencesAndComments(markdown: string): Parsed<string> {
  const lines: readonly string[] = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fence: OpenFence | null = null;
  let inComment: boolean = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line: string = lines[index] ?? "";
    const lineNumber: number = index + 1;
    const foreign: RegExpExecArray | null = FOREIGN_LINE_BREAK.exec(line);
    if (foreign !== null) {
      return fail(
        `line ${lineNumber}: the line separator ${codePointOf(foreign[0])} is not read; end the line with LF`,
      );
    }
    if (fence !== null) {
      if (closes(line, fence)) fence = null;
      out.push(blankOf(line));
      continue;
    }
    if (!inComment) {
      const opened: OpenFence | null = fenceOpenedBy(line);
      if (opened !== null) {
        fence = opened;
        out.push(blankOf(line));
        continue;
      }
      if (FENCE_AFTER_MARKER.test(line)) {
        return fail(
          `line ${lineNumber}: a fence after a list or quote marker is not read; open the fence at the start of the line`,
        );
      }
    }
    let kept: string = "";
    let rest: string = line;
    while (rest !== "") {
      if (inComment) {
        const end: number = rest.indexOf(COMMENT_CLOSE);
        if (end === -1) {
          kept += blankOf(rest);
          rest = "";
        } else {
          kept += blankOf(rest.slice(0, end + COMMENT_CLOSE.length));
          rest = rest.slice(end + COMMENT_CLOSE.length);
          inComment = false;
          // CommonMark ends the comment block with the whole line holding
          // `-->`: text after it is hidden when rendered, so it is not read.
          if (/[^ \t]/.test(rest)) {
            return fail(
              `line ${lineNumber}: text after "${COMMENT_CLOSE}" on the same line is not read; end the comment at the end of its line`,
            );
          }
        }
      } else {
        const start: number = rest.indexOf(COMMENT_OPEN);
        if (start === -1) {
          kept += rest;
          rest = "";
        } else {
          const refusal: string | null = refusedOpening(line, line.length - rest.length + start);
          if (refusal !== null) return fail(`line ${lineNumber}: ${refusal}`);
          kept += rest.slice(0, start) + blankOf(COMMENT_OPEN);
          rest = rest.slice(start + COMMENT_OPEN.length);
          inComment = true;
        }
      }
    }
    out.push(kept);
  }
  return { ok: true, value: out.join("\n") };
}

const CRITERION_BULLET = /^[ \t]*[-*+][ \t]+(?:\*\*)?(CA-\d+)\b/;
const ANY_BULLET = /^[ \t]*[-*+][ \t]+/;
const VALIDATION_CLAUSE = /Validation[ \t]*:/;

/**
 * Read the `- CA-n … Validation : …` bullets. Line numbers are 1-based and
 * stay valid against the original text because `blankFencesAndComments`
 * blanks fenced blocks and HTML comments without removing their line ends.
 */
export function parseCriteria(markdown: string): Parsed<readonly Criterion[]> {
  const text: Parsed<string> = blankFencesAndComments(markdown);
  if (!text.ok) return text;
  const lines: readonly string[] = text.value.split("\n");
  const criteria: Criterion[] = [];
  const firstSeen = new Map<string, number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = CRITERION_BULLET.exec(line);
    if (match === null) continue;
    const id = match[1] ?? "";
    const lineNumber = index + 1;

    const earlier = firstSeen.get(id);
    if (earlier !== undefined) {
      return fail(`criterion ${id} is declared twice, at lines ${earlier} and ${lineNumber}`);
    }
    firstSeen.set(id, lineNumber);

    // A bullet may wrap: indented lines that do not open a new bullet belong to it.
    let body = line;
    let next = index + 1;
    while (next < lines.length) {
      const continuation = lines[next] ?? "";
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

const EXPECTED_HEADER: readonly RegExp[] = [
  /^WP$/i,
  /^CA-n\b/i,
  /^Périmètre\b/i,
  /^Vérification\b/i,
  /^Porte\b/i,
];
const RULE_CELL = /^:?-{3,}:?$/;
// Leading whitespace that reaches four columns: four spaces, or a tab after
// at most three spaces.
const INDENTED_BLOCK: RegExp = /^(?: {4}| {0,3}\t)/;
// The grammar of the `WP-<k>` of the trailer (check-work-package-link.ts,
// WP_SOURCE): a row the trailer cannot name could never be declared.
const WP_ID: RegExp = /^WP-[1-9][0-9]{0,8}$/;
const CA_ID = /^CA-\d+$/;

// The table cells are split on `|`: a verification command containing a pipe
// would shift the columns, which the cell-count check then reports as an error
// instead of reading a wrong value.
function splitRow(line: string): readonly string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const inner = trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed.slice(1);
  return inner.split("|").map((cell) => cell.trim());
}

const unquote = (cell: string): string => cell.replace(/`/g, "").trim();

const splitList = (cell: string): readonly string[] =>
  unquote(cell)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

/**
 * Split a scope cell on the commas outside `{}`: `src/{a,b}/**` is one glob.
 * Unbalanced braces return null, since the split would be a guess.
 */
function splitGlobs(cell: string): readonly string[] | null {
  const globs: string[] = [];
  let depth = 0;
  let current = "";
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
  return globs.map((glob) => glob.trim()).filter((glob) => glob !== "");
}

function isHeader(cells: readonly string[]): boolean {
  return (
    cells.length === EXPECTED_HEADER.length &&
    EXPECTED_HEADER.every((pattern, position) => pattern.test(unquote(cells[position] ?? "")))
  );
}

function parseRow(cells: readonly string[], lineNumber: number): Parsed<WorkPackage> {
  const id = unquote(cells[0] ?? "");
  const label = id === "" ? `line ${lineNumber}` : `${id} (line ${lineNumber})`;
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
  const criteria = splitList(cells[1] ?? "");
  if (criteria.length === 0) return fail(`work package ${label}: cites no criterion`);
  const badCriterion = criteria.find((criterion) => !CA_ID.test(criterion));
  if (badCriterion !== undefined) {
    return fail(`work package ${label}: "${badCriterion}" is not a CA-<n> identifier`);
  }
  const scope = splitGlobs(cells[2] ?? "");
  if (scope === null) return fail(`work package ${label}: unbalanced braces in scope`);
  if (scope.length === 0) return fail(`work package ${label}: empty scope`);
  const verify = unquote(cells[3] ?? "");
  if (verify === "") return fail(`work package ${label}: empty verification command`);
  const door = unquote(cells[4] ?? "");
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
 * Why exactly one header: a PRD that quotes an example table (in an indented
 * block, say) would otherwise have the reader pick "the first", which may be
 * the example. Two headers are refused, never ranked.
 */
export function parseWorkPackages(markdown: string): Parsed<readonly WorkPackage[]> {
  const text: Parsed<string> = blankFencesAndComments(markdown);
  if (!text.ok) return text;
  const lines: readonly string[] = text.value.split("\n");
  const headers: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line: string = lines[index] ?? "";
    const cells: readonly string[] | null = splitRow(line);
    if (cells === null || !isHeader(cells)) continue;
    // An indented block renders as code: a header there is a quoted example
    // for the reader of the PRD, so it is refused even when it is the only one.
    if (INDENTED_BLOCK.test(line)) {
      return fail(
        `work-package table header at line ${index + 1} is indented by four spaces or a tab: an indented block renders as code, so it is not read`,
      );
    }
    headers.push(index);
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
  const rule = splitRow(lines[headerAt + 1] ?? "");
  if (rule === null || rule.length === 0 || !rule.every((cell) => RULE_CELL.test(cell))) {
    return fail(`work-package table at line ${headerAt + 1} has no separator row`);
  }

  const packages: WorkPackage[] = [];
  const firstSeen = new Map<string, number>();
  for (let index = headerAt + 2; index < lines.length; index += 1) {
    const cells = splitRow(lines[index] ?? "");
    if (cells === null) break;
    const lineNumber = index + 1;
    const row = parseRow(cells, lineNumber);
    if (!row.ok) return row;
    const earlier = firstSeen.get(row.value.id);
    if (earlier !== undefined) {
      return fail(
        `work package ${row.value.id} is declared twice, at lines ${earlier} and ${lineNumber}`,
      );
    }
    firstSeen.set(row.value.id, lineNumber);
    packages.push(row.value);
  }
  if (packages.length === 0) return fail("work-package table has a header but no row");
  return { ok: true, value: packages };
}

// Only the "du document" form counts: in the pilot PRD the bare `Maturité :`
// qualifies the observed project, and the document itself is "a proposal".
const DOCUMENT_MATURITY_LINE =
  /^[ \t]*(?:[-*+][ \t]+)?(?:\*\*)?Maturité du document[ \t]*:(?:\*\*)?[ \t]*(.*)$/gim;

const LEVELS_LONGEST_FIRST: readonly MaturityLevel[] = [...MATURITY_LADDER].sort(
  (a, b) => b.length - a.length,
);

function levelOf(value: string): MaturityLevel | null {
  const cleaned = value.normalize("NFC").replace(/[*`_]/g, "").trim().toLowerCase();
  for (const level of LEVELS_LONGEST_FIRST) {
    if (!cleaned.startsWith(level)) continue;
    // Whole word only: "décisionnel" must not read as "décision".
    if (/^\p{L}/u.test(cleaned.slice(level.length))) continue;
    return level;
  }
  return null;
}

/**
 * The level declared by the `Maturité du document :` line. `ok: true` with
 * null when the line is absent, unrecognised, or repeated with different
 * values (fail closed: an ambiguous document does not reach a maturity
 * threshold); `ok: false` when the document holds a construction the reader
 * refuses (see `blankFencesAndComments`).
 */
export function readDocumentMaturity(markdown: string): Parsed<MaturityLevel | null> {
  const text: Parsed<string> = blankFencesAndComments(markdown);
  if (!text.ok) return text;
  const levels: (MaturityLevel | null)[] = [...text.value.matchAll(DOCUMENT_MATURITY_LINE)].map(
    (match: RegExpExecArray): MaturityLevel | null => levelOf(match[1] ?? ""),
  );
  const first: MaturityLevel | null | undefined = levels[0];
  if (first === undefined || first === null) return { ok: true, value: null };
  return {
    ok: true,
    value: levels.every((level: MaturityLevel | null): boolean => level === first) ? first : null,
  };
}

/** True when `level` is at or above `floor` on the maturity ladder. */
export function atLeast(level: MaturityLevel, floor: MaturityLevel): boolean {
  const levelIndex = MATURITY_LADDER.indexOf(level);
  const floorIndex = MATURITY_LADDER.indexOf(floor);
  // indexOf answers -1 for a value off the ladder (a floor read from YAML or
  // JSON and cast): comparing it would pass every document, so fail closed.
  if (levelIndex === -1 || floorIndex === -1) return false;
  return levelIndex >= floorIndex;
}
