/**
 * Advisory report of the verification level declared by the criteria of a
 * requirements specification (docs/specifications/WORK-PACKAGES.md, section
 * "Verification level (advisory)").
 *
 *   bun tools/quality/criteria-levels.ts <path of the specification>
 *
 * The level is an optional clause of the `CA-<n>` bullet, after its
 * `Validation :` clause. No gate reads it: this command is outside
 * `bun run check`, and a violation it reports does not change its exit code,
 * which the report states on a line of its own. Exit codes: 0 the report was
 * produced, 2 wrong usage, a path that is not a regular file or an unreadable
 * specification.
 *
 * The report names identifiers, lines and problem codes, never the text of a
 * criterion: a specification may quote what a log must not keep.
 */
import { lstat } from "node:fs/promises";
import {
  type Criterion,
  type Parsed,
  parseCriteria,
  type RawDocument,
  readRawLines,
} from "./prd-model";

export type VerificationLevel = 1 | 2 | 3 | 4;

export type LevelProblem =
  | "validation-placeholder"
  | "validation-empty"
  | "claim-without-judgement"
  | "judgement-level-mismatch"
  | "volatile-without-date"
  | "level-malformed";

export interface CriterionLevel {
  readonly id: string;
  readonly line: number;
  readonly level: VerificationLevel | null;
  readonly judgement: boolean;
  readonly problems: readonly LevelProblem[];
}

interface LevelClause {
  readonly level: VerificationLevel | null;
  readonly judgement: boolean;
  readonly malformed: boolean;
}

/** What a bullet says once its code spans can no longer be mistaken for its clauses. */
interface BulletReading {
  readonly validation: string | null;
  readonly clause: LevelClause;
}

/** The lines of a criterion: the bullet with its continuation, and what is nested under it. */
interface BulletLines {
  readonly body: string;
  readonly nested: string;
}

const EXIT_REPORTED: number = 0;
const EXIT_UNREADABLE: number = 2;

// Same word boundary as the `Validation :` clause of prd-model.ts, which does
// not export it: changing the contract of that module is out of this command.
const VALIDATION_CLAUSE: RegExp = /(?<![^\s.,;(*_`])Validation[ \t]*:/u;
// Every spelling a person would read as the clause, so that a near miss is
// reported instead of being taken for prose. Groups: 1 the word, 2 the markup
// before the colon, 3 the space before it, 4 the markup after it, 5 the space
// after it, 6 the value, 7 the judgement mark.
const LEVEL_SPELLING: RegExp =
  /(?<![\p{L}\p{N}-])(niveaux?)([*_]*)(\s*):([*_]*)(\s*)([^\s,;)]*)(?:[ \t,]+[*_]*(jugement)(?![\p{L}\p{N}]))?/giu;
const ASCII_BLANKS: RegExp = /^[ \t]*$/;
const NUMERIC_VALUE: RegExp = /^\d+$/;
const ANY_BULLET: RegExp = /^[ \t]*[-*+][ \t]+/;
const LEVEL_TOKEN: RegExp = /^[1-4]$/;
// A run of backticks closed by a run of the same length, as in CommonMark.
const CODE_SPAN: RegExp = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g;
const ENVIRONMENT_ASSIGNMENT: RegExp = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PROGRAM: RegExp = /^(?:\.{0,2}\/)?[A-Za-z0-9][A-Za-z0-9_.+/-]*$/;
const EXPLICIT_PATH: RegExp = /^\.{1,2}\//;

const WORD_PLACEHOLDERS: readonly string[] = [
  "a definir",
  "a determiner",
  "a preciser",
  "a venir",
  "en attente",
  "en cours",
  "neant",
  "todo",
  "tbd",
  "tba",
  "fixme",
  "wip",
  "xxx",
  "n/a",
  "na",
  "none",
];
// The marks that may wrap a placeholder, for a regular expression class.
const WRAPPING_MARKS: string = "\\[\\](){}*_\"'«»‹›“”„‘’‚";
const LIST_NUMBER: string = "\\d+[.)](?=\\s|$)";
// `.`, `:`, `_` and `-` also join the words of a command (`todo.sh`, `todo:list`,
// `todo_list`, `todo-cli`): they end a placeholder only when no word follows.
const WORD_END: string = `(?=$|[\\s,;!?/${WRAPPING_MARKS.replace("_", "")}]|[.:_-]+[${WRAPPING_MARKS}.,;:!?-]*(?:\\s|$))`;
const PLACEHOLDER: RegExp = new RegExp(`^(?:${WORD_PLACEHOLDERS.join("|")})${WORD_END}`, "u");
const LEADING_MARKERS: RegExp = new RegExp(
  `^(?:[\\s${WRAPPING_MARKS}:.,;!-]|${LIST_NUMBER})*`,
  "u",
);
// `?`, `.` and `-` are the placeholders themselves here, so they are not skipped.
const BEFORE_SYMBOL: RegExp = new RegExp(`^(?:[\\s${WRAPPING_MARKS}:,;!]|${LIST_NUMBER})*`, "u");
const SYMBOL_PLACEHOLDER: RegExp = new RegExp(
  `^(?:\\?|\\.{3}|-+)(?=$|[\\s${WRAPPING_MARKS}:.,;!?])`,
  "u",
);
const TEMPLATE: RegExp = new RegExp(`^<[^>]*>[${WRAPPING_MARKS}.,;:!?-]*$`, "u");
const ASCII_ALPHANUMERIC: RegExp = /[A-Za-z0-9]/;
const ISO_DATE: RegExp = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g;
const CLAIM: RegExp =
  /(?<![\p{L}\p{N}])(?:testée?s?|vérifiée?s?|validée?s?|revue?s?|relue?s?|contrôlée?s?|approuvée?s?|fonctionnel(?:le)?s?|fonctionne|tests passés|ça marche)(?![\p{L}\p{N}])/u;

/**
 * The bullet and its indented continuation lines, as `parseCriteria` delimits
 * them, then the indented lines nested under it, up to `end` (0-based, excluded).
 */
function bulletLines(lines: readonly string[], criterion: Criterion, end: number): BulletLines {
  const parts: string[] = [lines[criterion.line - 1] ?? ""];
  let index: number = criterion.line;
  for (; index < end; index += 1) {
    const continuation: string = lines[index] ?? "";
    const endsBullet: boolean =
      continuation.trim() === "" || ANY_BULLET.test(continuation) || !/^[ \t]/.test(continuation);
    if (endsBullet) break;
    parts.push(continuation);
  }
  const nested: string[] = [];
  for (; index < end; index += 1) {
    const line: string = lines[index] ?? "";
    if (line.trim() === "" || !/^[ \t]/.test(line)) break;
    nested.push(line);
  }
  return { body: parts.join(" "), nested: nested.join(" ") };
}

/** The text with each code span blanked, every other character keeping its offset. */
function maskCodeSpans(text: string): string {
  return text.replace(CODE_SPAN, (span: string): string => " ".repeat(span.length));
}

function levelValue(spelling: RegExpMatchArray): string {
  return (spelling[6] ?? "").replace(/[*_]/g, "").replace(/\.$/, "");
}

function isCanonicalSpelling(spelling: RegExpMatchArray): boolean {
  return (
    spelling[1] === "Niveau" &&
    spelling[2] === "" &&
    ASCII_BLANKS.test(spelling[3] ?? "") &&
    ASCII_BLANKS.test(spelling[5] ?? "")
  );
}

function readLevelClause(spellings: readonly RegExpMatchArray[], nested: boolean): LevelClause {
  const first: RegExpMatchArray | undefined = spellings[0];
  if (first === undefined) return { level: null, judgement: false, malformed: nested };
  const value: string = levelValue(first);
  const judgement: boolean = first[7] === "jugement";
  const wellFormed: boolean =
    // Two clauses cannot be ranked: naming one of them would be a guess.
    spellings.length === 1 &&
    !nested &&
    isCanonicalSpelling(first) &&
    (first[7] === undefined || judgement) &&
    LEVEL_TOKEN.test(value);
  if (!wellFormed) return { level: null, judgement, malformed: true };
  return { level: Number(value) as VerificationLevel, judgement, malformed: false };
}

/**
 * The end of a level clause in the text. A value that is not a number stays in
 * the validation: it is a word of that clause, and it may be a claim.
 */
function clauseEnd(spelling: RegExpMatchArray): number {
  const start: number = spelling.index ?? 0;
  if (NUMERIC_VALUE.test(levelValue(spelling))) return start + spelling[0].length;
  const label: readonly (string | undefined)[] = spelling.slice(1, 6);
  // The colon is the one character of the label that no group captures.
  return start + label.join("").length + 1;
}

/** The validation without its level clauses, and the level clause read after the anchor. */
function readBullet(lines: BulletLines): BulletReading {
  const masked: string = maskCodeSpans(lines.body);
  const nested: boolean = maskCodeSpans(lines.nested).search(LEVEL_SPELLING) !== -1;
  const anchor: RegExpExecArray | null = VALIDATION_CLAUSE.exec(masked);
  if (anchor === null) return { validation: null, clause: readLevelClause([], nested) };
  const start: number = anchor.index + anchor[0].length;
  const spellings: readonly RegExpMatchArray[] = [...masked.slice(start).matchAll(LEVEL_SPELLING)];
  const tail: string = lines.body.slice(start);
  let validation: string = "";
  let cursor: number = 0;
  for (const spelling of spellings) {
    validation += `${tail.slice(cursor, spelling.index ?? 0)} `;
    cursor = clauseEnd(spelling);
  }
  validation += tail.slice(cursor);
  return {
    validation: validation.replace(/\s+/g, " ").trim(),
    clause: readLevelClause(spellings, nested),
  };
}

function normalized(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[…⋯]/gu, "...")
    .replace(/[\u{2010}-\u{2015}\u{2043}\u{2212}]/gu, "-")
    .toLowerCase();
}

function validationProblem(text: string | null): LevelProblem | null {
  if (text === null) return "validation-empty";
  const plain: string = normalized(text);
  const afterMarks: string = plain.replace(LEADING_MARKERS, "");
  if (TEMPLATE.test(afterMarks)) return "validation-placeholder";
  if (SYMBOL_PLACEHOLDER.test(plain.replace(BEFORE_SYMBOL, ""))) return "validation-placeholder";
  // On the text as written: folding the accents would make `é` an ASCII letter.
  if (!ASCII_ALPHANUMERIC.test(text)) return "validation-empty";
  return PLACEHOLDER.test(afterMarks) ? "validation-placeholder" : null;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date: Date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function holdsIsoDate(text: string): boolean {
  return [...text.matchAll(ISO_DATE)].some((date: RegExpMatchArray): boolean =>
    isCalendarDate(Number(date[1]), Number(date[2]), Number(date[3])),
  );
}

/**
 * A code span has the form of a command when, after optional `NAME=value`
 * assignments, it holds a program and an argument, or a single program named
 * by an explicit relative path. A lone file name is what a check reads, not
 * how to replay it.
 */
function isCommand(span: string): boolean {
  const words: readonly string[] = span.trim().split(/\s+/);
  const first: number = words.findIndex(
    (word: string): boolean => !ENVIRONMENT_ASSIGNMENT.test(word),
  );
  const program: string | undefined = first === -1 ? undefined : words[first];
  if (program === undefined || !PROGRAM.test(program)) return false;
  return first + 1 < words.length || EXPLICIT_PATH.test(program);
}

/** A command in a code span is the means of replaying the check: its clause claims nothing. */
function claimsWithoutReplay(text: string): boolean {
  const hasReplay: boolean = [...text.matchAll(CODE_SPAN)].some((span: RegExpMatchArray): boolean =>
    isCommand(span[2] ?? ""),
  );
  return !hasReplay && CLAIM.test(maskCodeSpans(text).toLowerCase());
}

function problemsOf(text: string | null, clause: LevelClause): readonly LevelProblem[] {
  const problems: LevelProblem[] = [];
  const validation: LevelProblem | null = validationProblem(text);
  if (validation !== null) problems.push(validation);
  if (text !== null && !clause.judgement && claimsWithoutReplay(text)) {
    problems.push("claim-without-judgement");
  }
  if (clause.malformed) problems.push("level-malformed");
  if (clause.level === null) return problems;
  const requiresJudgement: boolean = clause.level >= 3;
  if (requiresJudgement !== clause.judgement) problems.push("judgement-level-mismatch");
  if (clause.level === 2 && !holdsIsoDate(text ?? "")) problems.push("volatile-without-date");
  return problems;
}

/**
 * The declared level and the problems of every criterion. A malformed clause
 * is a problem of its criterion; only a specification the model refuses is a
 * refusal, with the reason of the model.
 */
export function readCriterionLevels(
  input: string | RawDocument,
): Parsed<readonly CriterionLevel[]> {
  const read: Parsed<RawDocument> =
    typeof input === "string" ? readRawLines(input) : { ok: true, value: input };
  if (!read.ok) return read;
  const criteria: Parsed<readonly Criterion[]> = parseCriteria(read.value);
  if (!criteria.ok) return criteria;
  const { lines } = read.value;
  const levels: readonly CriterionLevel[] = criteria.value.map(
    (criterion: Criterion, index: number): CriterionLevel => {
      // An indented bullet may be the next criterion: its clause is its own.
      const next: Criterion | undefined = criteria.value[index + 1];
      const end: number = next === undefined ? lines.length : next.line - 1;
      const { validation, clause }: BulletReading = readBullet(bulletLines(lines, criterion, end));
      return {
        id: criterion.id,
        line: criterion.line,
        level: clause.level,
        judgement: clause.judgement,
        problems: problemsOf(validation, clause),
      };
    },
  );
  return { ok: true, value: levels };
}

function levelLabel(criterion: CriterionLevel): string {
  if (criterion.problems.includes("level-malformed")) return "malformed";
  return criterion.level === null ? "undeclared" : String(criterion.level);
}

/**
 * One line per criterion, then the counters: each of the two counter lines sums
 * to `read`. A report with violations says that the command still exits 0.
 */
export function formatCriterionLevels(levels: readonly CriterionLevel[]): string {
  const rows: readonly string[] = levels.map((criterion: CriterionLevel): string => {
    const problems: string =
      criterion.problems.length === 0 ? "none" : criterion.problems.join(",");
    return `${criterion.id} line=${criterion.line} level=${levelLabel(criterion)} problems=${problems}`;
  });
  const count = (label: string): number =>
    levels.filter((criterion: CriterionLevel): boolean => levelLabel(criterion) === label).length;
  const violating: number = levels.filter(
    (criterion: CriterionLevel): boolean => criterion.problems.length > 0,
  ).length;
  return [
    ...rows,
    `criteria: read=${levels.length} conforming=${levels.length - violating} violating=${violating}`,
    `levels: read=${levels.length} 1=${count("1")} 2=${count("2")} 3=${count("3")} 4=${count("4")} undeclared=${count("undeclared")} malformed=${count("malformed")}`,
    ...(violating > 0 ? [`advisory: exit 0 despite ${violating} violating`] : []),
  ].join("\n");
}

async function main(args: readonly string[]): Promise<number> {
  const path: string | undefined = args[0];
  if (path === undefined || args.length !== 1) {
    console.error("usage: bun tools/quality/criteria-levels.ts <path of the specification>");
    return EXIT_UNREADABLE;
  }
  let text: string;
  try {
    // lstat and not stat: a link would report on a file the caller did not name,
    // and reading a FIFO would block the command.
    if (!(await lstat(path)).isFile()) {
      console.error("unreadable specification: not a regular file");
      return EXIT_UNREADABLE;
    }
    text = await Bun.file(path).text();
  } catch (error: unknown) {
    const name: string = error instanceof Error ? error.name : "unknown error";
    console.error(`unreadable specification: ${name}`);
    return EXIT_UNREADABLE;
  }
  const levels: Parsed<readonly CriterionLevel[]> = readCriterionLevels(text);
  if (!levels.ok) {
    console.error(`unreadable specification: ${levels.reason}`);
    return EXIT_UNREADABLE;
  }
  console.log(formatCriterionLevels(levels.value));
  return EXIT_REPORTED;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
