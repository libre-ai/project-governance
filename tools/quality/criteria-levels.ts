/**
 * Advisory report of the verification level declared by the criteria of a
 * requirements specification (docs/specifications/WORK-PACKAGES.md, section
 * "Verification level (advisory)").
 *
 *   bun tools/quality/criteria-levels.ts <path of the specification>
 *
 * The level is an optional clause of the `CA-<n>` bullet. No gate reads it:
 * this command is outside `bun run check`, and a violation it reports does not
 * change its exit code. Exit codes: 0 the report was produced, 2 wrong usage or
 * an unreadable specification.
 *
 * The report names identifiers, lines and problem codes, never the text of a
 * criterion: a specification may quote what a log must not keep.
 */
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
  readonly declared: boolean;
  readonly malformed: boolean;
}

const EXIT_REPORTED: number = 0;
const EXIT_UNREADABLE: number = 2;

// Same word boundary as the `Validation :` clause of prd-model.ts, which does
// not export it: changing the contract of that module is out of this command.
const VALIDATION_CLAUSE: RegExp = /(?<![^\s.,;(*_`])Validation[ \t]*:/u;
const LEVEL_CLAUSE: RegExp =
  /(?<![^\s.,;(*_`])Niveau[ \t]*:[*_`]*[ \t]*([^\s,;]*)(?:[ \t,]+(jugement)(?![\p{L}\p{N}]))?/gu;
const ANY_BULLET: RegExp = /^[ \t]*[-*+][ \t]+/;
const LEVEL_TOKEN: RegExp = /^[1-4]$/;

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
const SYMBOL_PLACEHOLDERS: ReadonlySet<string> = new Set<string>(["?", "...", "-"]);
// A placeholder ends at the end of the clause, a space or a separator, so that
// the command `todo-cli list` is not read as the word `todo`.
const PLACEHOLDER: RegExp = new RegExp(`^(?:${WORD_PLACEHOLDERS.join("|")})(?=$|[\\s.,;:!?)\\]])`);
const LEADING_MARKERS: RegExp = /^(?:[\s[\](){}*_"'«»:.,;!-]|\d+[.)](?=\s|$))*/u;
const TEMPLATE: RegExp = /^<[^>]*>[.,;]?$/;
const ISO_DATE: RegExp = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g;
const CLAIM: RegExp =
  /(?<![\p{L}\p{N}])(?:testée?s?|vérifiée?s?|validée?s?|revue?s?|relue?s?|contrôlée?s?|approuvée?s?|fonctionnel(?:le)?s?|fonctionne|tests passés|ça marche)(?![\p{L}\p{N}])/u;

/** The bullet and its indented continuation lines, as `parseCriteria` delimits them. */
function bulletBody(lines: readonly string[], criterion: Criterion): string {
  const parts: string[] = [lines[criterion.line - 1] ?? ""];
  for (let index = criterion.line; index < lines.length; index += 1) {
    const continuation: string = lines[index] ?? "";
    const endsBullet: boolean =
      continuation.trim() === "" || ANY_BULLET.test(continuation) || !/^[ \t]/.test(continuation);
    if (endsBullet) break;
    parts.push(continuation);
  }
  return parts.join(" ");
}

function readLevelClause(body: string): LevelClause {
  const clauses: readonly RegExpMatchArray[] = [...body.matchAll(LEVEL_CLAUSE)];
  const first: RegExpMatchArray | undefined = clauses[0];
  if (first === undefined) {
    return { level: null, judgement: false, declared: false, malformed: false };
  }
  const token: string = (first[1] ?? "").replace(/[*_`]/g, "").replace(/\.$/, "");
  const judgement: boolean = first[2] !== undefined;
  // Two clauses cannot be ranked: naming one of them would be a guess.
  if (clauses.length > 1 || !LEVEL_TOKEN.test(token)) {
    return { level: null, judgement, declared: true, malformed: true };
  }
  return {
    level: Number(token) as VerificationLevel,
    judgement,
    declared: true,
    malformed: false,
  };
}

/** The text of the `Validation :` clause without the level clause, or null when absent. */
function validationText(body: string): string | null {
  const withoutLevel: string = body.replace(LEVEL_CLAUSE, " ");
  const clause: RegExpExecArray | null = VALIDATION_CLAUSE.exec(withoutLevel);
  if (clause === null) return null;
  return withoutLevel
    .slice(clause.index + clause[0].length)
    .replace(/\s+/g, " ")
    .trim();
}

function normalized(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/…/g, "...")
    .toLowerCase();
}

function validationProblem(text: string | null): LevelProblem | null {
  if (text === null || text === "") return "validation-empty";
  const plain: string = normalized(text);
  if (TEMPLATE.test(plain)) return "validation-placeholder";
  if (!/[a-z0-9]/.test(plain)) {
    const symbol: string = plain.replace(/[\s[\]()]/g, "");
    return SYMBOL_PLACEHOLDERS.has(symbol) ? "validation-placeholder" : "validation-empty";
  }
  return PLACEHOLDER.test(plain.replace(LEADING_MARKERS, "")) ? "validation-placeholder" : null;
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

/** A code span is the means of replaying the check: a clause holding one claims nothing. */
function claimsWithoutReplay(text: string): boolean {
  const hasReplay: boolean = text.includes("`");
  return !hasReplay && CLAIM.test(text.toLowerCase());
}

function problemsOf(text: string | null, clause: LevelClause): readonly LevelProblem[] {
  const problems: LevelProblem[] = [];
  const validation: LevelProblem | null = validationProblem(text);
  if (validation !== null) problems.push(validation);
  if (text !== null && !clause.judgement && claimsWithoutReplay(text)) {
    problems.push("claim-without-judgement");
  }
  if (clause.malformed) {
    problems.push("level-malformed");
    return problems;
  }
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
  const levels: readonly CriterionLevel[] = criteria.value.map(
    (criterion: Criterion): CriterionLevel => {
      const body: string = bulletBody(read.value.lines, criterion);
      const clause: LevelClause = readLevelClause(body);
      return {
        id: criterion.id,
        line: criterion.line,
        level: clause.level,
        judgement: clause.judgement,
        problems: problemsOf(validationText(body), clause),
      };
    },
  );
  return { ok: true, value: levels };
}

function levelLabel(criterion: CriterionLevel): string {
  if (criterion.problems.includes("level-malformed")) return "malformed";
  return criterion.level === null ? "undeclared" : String(criterion.level);
}

/** One line per criterion, then the counters: each of the two counter lines sums to `read`. */
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
