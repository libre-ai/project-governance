/**
 * Reading model of a product requirements document (PRD) and of its
 * work-package table. Pure functions over Markdown text: no I/O, no git.
 *
 * Every reader fails closed. A document that does not carry the structure
 * returns `ok: false` with a reason, never an empty success, so that a gate
 * built on top cannot confuse "nothing declared" with "could not read".
 */
import { stripNonDeclarations } from "./check-pr-door";

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

const CRITERION_BULLET = /^[ \t]*[-*+][ \t]+(?:\*\*)?(CA-\d+)\b/;
const ANY_BULLET = /^[ \t]*[-*+][ \t]+/;
const VALIDATION_CLAUSE = /Validation[ \t]*:/;

/**
 * Read the `- CA-n … Validation : …` bullets. Line numbers are 1-based and
 * stay valid against the original text because `stripNonDeclarations` blanks
 * fenced blocks and HTML comments without removing their newlines.
 */
export function parseCriteria(markdown: string): Parsed<readonly Criterion[]> {
  const lines = stripNonDeclarations(markdown).text.split("\n");
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
 */
export function parseWorkPackages(markdown: string): Parsed<readonly WorkPackage[]> {
  const lines = stripNonDeclarations(markdown).text.split("\n");
  const headerAt = lines.findIndex((line) => {
    const cells = splitRow(line);
    return cells !== null && isHeader(cells);
  });
  if (headerAt === -1) {
    return fail(
      "work-package table not found (expected header: WP | CA-n | Périmètre | Vérification | Porte)",
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
 * The level declared by the `Maturité du document :` line, or null when the
 * line is absent, unrecognised, or repeated with different values (fail
 * closed: an ambiguous document does not reach a maturity threshold).
 */
export function readDocumentMaturity(markdown: string): MaturityLevel | null {
  const { text } = stripNonDeclarations(markdown);
  const levels = [...text.matchAll(DOCUMENT_MATURITY_LINE)].map((match) => levelOf(match[1] ?? ""));
  const first = levels[0];
  if (first === undefined || first === null) return null;
  return levels.every((level) => level === first) ? first : null;
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
