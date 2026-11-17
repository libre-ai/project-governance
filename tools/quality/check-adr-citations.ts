/**
 * An ADR citation in an authority document names the series it belongs to, and
 * a redirection page in docs/adr points at a tracked file and decides nothing.
 *
 * WHY. Two decisions of two repositories carry the number 0047: the local
 * docs/adr/0047-decision-binding-vectors-lock.md, and ADR 0047 of the
 * control-plane. A bare `ADR 0047` reads exactly like either. Until this gate,
 * the only check of that kind was one grep in check-doctrine-governance.sh,
 * written for that one number in that one file. This gate states the rule once,
 * in data (`adr-citations.v1.json`), for every authority document it lists.
 *
 * FORMS, closed by default. An ADR citation is `ADR` or `ADRs`, not glued to a
 * preceding letter, digit or underscore, then any run of characters that are
 * neither letters, digits nor line breaks (the separator, possibly empty), then
 * digits, then any number of `/digits` continuations, each read as a citation
 * of its own with the same prefix:
 *   F1 `ADR-NNNN` (exactly one ASCII hyphen, four digits): this repository's
 *      series, by the convention written in the data file; qualified by its
 *      form, and it must name a tracked docs/adr/NNNN-*.md. A repository name
 *      right before it (see below) contradicts the form: bare;
 *   F2 `<repository> ADR NNNN` (exactly one ASCII space, four digits), the
 *      repository listed in `foreignRepositories`: another repository's series;
 *   F3 `ADR NNNN` with no listed repository right before it: bare;
 *   F4 any other number of digits, any other separator (`ADR #0047`,
 *      `ADR_0047`, `ADR:0047`, `ADR\u{2011}0047`, `ADR\u{200b}0047`) or none
 *      (`ADR0047`), or the plural `ADRs NNNN`: bare.
 * A REPOSITORY NAME, before the hyphen form, is the word written right before
 * it when that word is listed in `foreignRepositories`, is written in
 * backticks, or has the shape of a repository slug: lowercase letters and
 * digits in at least two parts joined by `-`, `.`, `_` or `/`
 * (`control-plane`, `org/repo`). A single plain word (`inconnu`) cannot be told
 * from prose (`par`, `amende`, `the`) and is read as prose.
 * Limits, by design: lowercase `adr-` (file names, review folder names) is not
 * read, and a list joined by words or commas (`ADR-0028, 0045`,
 * `ADR-0047 and 0048`) is read for its first number only.
 *
 * REDIRECTIONS. A file of docs/adr is a redirection page when one of its first
 * ten lines declares `Redirection : <path>` (list marker and bold allowed, the
 * path bare, in backticks, or as the target of a Markdown link). The path is
 * relative to the repository root. It must be tracked and present in the
 * checkout, must not be the page itself, and the page must carry no Statut,
 * Status or Arbitrage field: a decision lives at the target, never at two
 * places. A line of the first ten that mentions a redirection and does not
 * parse is a violation, never a page silently left unread.
 *
 * Counters printed on every run, and they sum:
 *   citations = local + foreign + bare
 * where `citations` is counted from the raw matches of each whole document and
 * the three others from the classified per-line reading, so the check can fail.
 * (`local` counts every F1 citation, including those naming no file, which are
 * violations of their own.) Dead redirections are those whose target is not a
 * tracked file present in the checkout.
 *
 * A data file that is empty, unreadable or invalid, a document pattern that
 * resolves no tracked file, a tracked document that cannot be read: all are
 * failures, never a zero.
 *
 * This gate is run by hand (`bun tools/quality/check-adr-citations.ts`). It
 * does not replace check-doctrine-governance.sh and is wired in no chain: that
 * decision is the owner's.
 *
 * Exit codes: 0 pass, 1 violation or unreadable source.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_PATH = "tools/quality/adr-citations.v1.json";
export const ADR_DIRECTORY = "docs/adr/";
export const LOCAL_FORM = "ADR-NNNN";
const REDIRECT_HEADER_LINES = 10;

const SCOPE_KEYS = new Set(["convention", "localForm", "documents", "foreignRepositories"]);
const REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
/** A pattern segment: path characters and `*` only; no `**`, `?`, brackets or braces. */
const PATTERN_SEGMENT = /^[A-Za-z0-9._*-]+$/;
const LOCAL_ADR_FILE = /^docs\/adr\/(\d{4})-[^/]+\.md$/;
/**
 * `ADR` or `ADRs`, then any run of characters that are neither letters, digits
 * nor line breaks, then digits and `/digits` continuations. The separator is
 * captured whole so that only a single ASCII hyphen or space is accepted; line
 * breaks are excluded so that a match never spans two lines, which keeps the
 * whole-text raw count equal to the per-line reading.
 */
const CITATION =
  /(?<![\p{L}\p{N}_])ADR(s?)([^\p{L}\p{N}\r\n\u{2028}\u{2029}]*)([0-9]+(?:\/[0-9]+)*)(?![\p{N}])/gu;
const LEADING_WRAPPERS = /^[`*_"'([]+/;
const TRAILING_WRAPPERS = /[`*_"']+$/;
const IN_BACKTICKS = /^`[^`]+`$/;
const REPOSITORY_SLUG = /^[a-z0-9]+(?:[-._/][a-z0-9]+)+$/;
const REDIRECT_MENTION = /^\W*redirect/i;
const REDIRECT_LINE =
  /^\s*(?:[-*+>]\s+)?(?:\*\*|__)?Redirection\s*:\s*(?:\*\*|__)?\s*(?:`([^`\s]+)`|\[[^\]]*\]\(([^()\s]+)\)|([^\s`[\]()]+))\s*$/;
/** A decision field: list or plain field `Statut :`, heading `## Statut`, table row `| Statut |`. */
const DECISION_FIELD =
  /^\s*(?:(?:[-*+>]\s+)?(?:\*\*|__)?\s*(?:Statut|Status|Arbitrage)\s*(?:\*\*|__)?\s*:|#{1,6}\s+(?:\*\*|__)?(?:Statut|Status|Arbitrage)\b|\|\s*(?:\*\*|__)?\s*(?:Statut|Status|Arbitrage)\s*(?:\*\*|__)?\s*:?\s*\|)/i;

export interface Scope {
  readonly convention: string;
  readonly localForm: typeof LOCAL_FORM;
  readonly documents: readonly string[];
  readonly foreignRepositories: readonly string[];
}

export interface Citation {
  readonly file: string;
  readonly line: number;
  /** The citation as written, `ADR` through the last digit of its `/` list. */
  readonly text: string;
  /** True for the plural prefix `ADRs`. */
  readonly plural: boolean;
  readonly separator: string;
  readonly digits: string;
  /** The word right before `ADR`, unwrapped; null when there is none. */
  readonly qualifier: string | null;
  /** True when that word is a repository name (module header, REPOSITORY NAME). */
  readonly qualifierIsRepository: boolean;
}

export type CitationClass = "local" | "foreign-qualified" | "bare" | "unknown-local";

export interface Redirect {
  readonly file: string;
  readonly line: number;
  /** Null when the declaration line does not parse. */
  readonly target: string | null;
  readonly declaration: string;
  /** 1-based lines of the page that carry a Statut, Status or Arbitrage field. */
  readonly decisionLines: readonly number[];
}

export interface Counters {
  documents: number;
  citations: number;
  local: number;
  foreign: number;
  bare: number;
  redirects: number;
  deadRedirects: number;
}

export interface EvaluateInput {
  readonly scope: Scope;
  /** Every tracked path, as `git ls-files` lists it. */
  readonly tracked: readonly string[];
  /** Tracked paths present in the checkout. */
  readonly present: ReadonlySet<string>;
  /** The text of a tracked file, or null when it cannot be read. */
  readonly read: (path: string) => string | null;
}

export interface Evaluation {
  readonly violations: string[];
  readonly counters: Counters;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validatePattern(pattern: string): string | null {
  if (pattern.length === 0) return "an empty pattern";
  if (pattern.startsWith("/")) return "an absolute pattern";
  for (const segment of pattern.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      return "an empty, `.` or `..` segment";
    }
    if (!PATTERN_SEGMENT.test(segment) || segment.includes("**")) {
      return "a character other than path characters and a single `*`";
    }
  }
  return null;
}

/** Parse and validate the scope file. Throws, with the reason, on anything but a valid scope. */
export function readScope(raw: string): Scope {
  if (raw.trim().length === 0) throw new Error(`${CONFIG_PATH}: empty`);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${CONFIG_PATH}: not JSON (${(error as Error).message})`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${CONFIG_PATH}: not an object`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !SCOPE_KEYS.has(key));
  if (unknown.length > 0) throw new Error(`${CONFIG_PATH}: unknown key(s) ${unknown.join(", ")}`);
  const { convention, localForm, documents, foreignRepositories } = record;
  if (typeof convention !== "string" || convention.trim().length === 0) {
    throw new Error(`${CONFIG_PATH}: convention must state what the local form means`);
  }
  if (localForm !== LOCAL_FORM) {
    throw new Error(`${CONFIG_PATH}: localForm must be "${LOCAL_FORM}", the form this gate reads`);
  }
  if (!isStringArray(documents) || documents.length === 0) {
    throw new Error(`${CONFIG_PATH}: documents must be a non-empty list of patterns`);
  }
  for (const pattern of documents) {
    const reason = validatePattern(pattern);
    if (reason !== null)
      throw new Error(`${CONFIG_PATH}: document pattern "${pattern}" is ${reason}`);
  }
  if (new Set(documents).size !== documents.length) {
    throw new Error(`${CONFIG_PATH}: a document pattern is listed twice`);
  }
  if (!isStringArray(foreignRepositories)) {
    throw new Error(`${CONFIG_PATH}: foreignRepositories must be a list of repository names`);
  }
  for (const name of foreignRepositories) {
    if (!REPOSITORY_NAME.test(name)) {
      throw new Error(`${CONFIG_PATH}: "${name}" is not a repository name`);
    }
  }
  if (new Set(foreignRepositories).size !== foreignRepositories.length) {
    throw new Error(`${CONFIG_PATH}: a foreign repository is listed twice`);
  }
  return { convention, localForm: LOCAL_FORM, documents, foreignRepositories };
}

/** A segment-bound glob: `*` matches within one path segment, never across `/`. */
export function patternMatches(pattern: string, path: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${source}$`).test(path);
}

function unwrapQualifier(word: string): string {
  return word.replace(LEADING_WRAPPERS, "").replace(TRAILING_WRAPPERS, "");
}

function isRepositoryName(
  written: string,
  unwrapped: string,
  foreignRepositories: ReadonlySet<string>,
): boolean {
  return (
    foreignRepositories.has(unwrapped) ||
    IN_BACKTICKS.test(written) ||
    REPOSITORY_SLUG.test(unwrapped)
  );
}

/**
 * Every ADR citation of a text, one per number of a `/` list, with its line and
 * the word written right before it. `foreignRepositories` feeds the
 * repository-name reading of that word.
 */
export function findCitations(
  file: string,
  text: string,
  foreignRepositories: ReadonlySet<string> = new Set(),
): Citation[] {
  const citations: Citation[] = [];
  const lines = text.split("\n");
  lines.forEach((content, index) => {
    for (const match of content.matchAll(CITATION)) {
      const plural = match[1] === "s";
      const separator = match[2] ?? "";
      const numbers = (match[3] ?? "").split("/");
      const before = content.slice(0, match.index);
      const word = /(\S+)\s+$/.exec(before)?.[1];
      const unwrapped = word === undefined ? "" : unwrapQualifier(word);
      const qualifier = unwrapped === "" ? null : unwrapped;
      const qualifierIsRepository =
        word !== undefined &&
        qualifier !== null &&
        isRepositoryName(word, qualifier, foreignRepositories);
      for (const digits of numbers) {
        citations.push({
          file,
          line: index + 1,
          text: match[0],
          plural,
          separator,
          digits,
          qualifier,
          qualifierIsRepository,
        });
      }
    }
  });
  return citations;
}

/**
 * The number of citations in a text, counted from the raw matches of the whole
 * text, independently of the per-line reading of findCitations: the sum check
 * of `evaluate` compares the classified citations against this count.
 */
export function countRawCitations(text: string): number {
  let count = 0;
  for (const match of text.matchAll(CITATION)) {
    count += (match[3] ?? "").split("/").length;
  }
  return count;
}

export function classifyCitation(
  citation: Citation,
  localAdrNumbers: ReadonlySet<string>,
  foreignRepositories: ReadonlySet<string>,
): CitationClass {
  if (citation.plural || citation.digits.length !== 4) return "bare";
  if (citation.separator === "-") {
    // A repository named before the local form makes the citation ambiguous:
    // `control-plane ADR-0047` must never be checked against the local 0047.
    if (citation.qualifierIsRepository) return "bare";
    return localAdrNumbers.has(citation.digits) ? "local" : "unknown-local";
  }
  if (citation.separator === " " && citation.qualifier !== null) {
    if (foreignRepositories.has(citation.qualifier)) return "foreign-qualified";
  }
  return "bare";
}

function bareMotif(citation: Citation): string {
  const at = `${citation.file}:${citation.line}`;
  if (citation.plural) {
    return `${at}: bare ADR citation \`${citation.text}\`: a plural list hides which series each number belongs to; cite each decision as \`ADR-NNNN\` or \`<repository> ADR NNNN\``;
  }
  if (citation.digits.length !== 4) {
    return `${at}: bare ADR citation \`${citation.text}\`: an ADR number has four digits`;
  }
  if (citation.separator === "-" && citation.qualifierIsRepository) {
    return `${at}: bare ADR citation \`${citation.text}\`: "${citation.qualifier}" before it names a repository, and \`ADR-${citation.digits}\` is this repository's series; write \`<repository> ADR ${citation.digits}\` with a repository listed in foreignRepositories, or drop the repository name`;
  }
  if (citation.separator !== " ") {
    return `${at}: bare ADR citation \`${citation.text}\`: write \`ADR-${citation.digits}\` for this repository's series, or \`<repository> ADR ${citation.digits}\` for another's`;
  }
  const unlisted =
    citation.qualifier === null
      ? ""
      : `; "${citation.qualifier}" before it is not a repository listed in foreignRepositories`;
  return `${at}: bare ADR citation \`${citation.text}\`: write \`<repository> ADR ${citation.digits}\` with a repository listed in foreignRepositories, or \`ADR-${citation.digits}\` for this repository's series${unlisted}`;
}

/** The redirection pages among the given docs/adr files, and how each one reads. */
export function findRedirects(adrFiles: ReadonlyMap<string, string>): Redirect[] {
  const redirects: Redirect[] = [];
  for (const [file, text] of adrFiles) {
    const lines = text.split("\n");
    const header = lines.slice(0, REDIRECT_HEADER_LINES);
    const index = header.findIndex((line) => REDIRECT_MENTION.test(line));
    if (index === -1) continue;
    const declaration = header[index] ?? "";
    const parsed = REDIRECT_LINE.exec(declaration);
    const target = parsed === null ? null : (parsed[1] ?? parsed[2] ?? parsed[3] ?? null);
    const decisionLines: number[] = [];
    lines.forEach((line, at) => {
      if (DECISION_FIELD.test(line)) decisionLines.push(at + 1);
    });
    redirects.push({ file, line: index + 1, target, declaration, decisionLines });
  }
  return redirects;
}

function isCleanRelativePath(path: string): boolean {
  if (path.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function evaluate(input: EvaluateInput): Evaluation {
  const { scope, tracked, present, read } = input;
  const violations: string[] = [];
  const counters: Counters = {
    documents: 0,
    citations: 0,
    local: 0,
    foreign: 0,
    bare: 0,
    redirects: 0,
    deadRedirects: 0,
  };
  const trackedSet = new Set(tracked);
  const localAdrNumbers = new Set<string>();
  for (const path of tracked) {
    const number = LOCAL_ADR_FILE.exec(path)?.[1];
    if (number !== undefined && present.has(path)) localAdrNumbers.add(number);
  }
  const foreign = new Set(scope.foreignRepositories);

  const documents = new Set<string>();
  for (const pattern of scope.documents) {
    const matched = tracked.filter((path) => patternMatches(pattern, path));
    if (matched.length === 0) {
      violations.push(`${CONFIG_PATH}: document pattern "${pattern}" resolves no tracked file`);
    }
    for (const path of matched) documents.add(path);
  }
  if (documents.size === 0) {
    violations.push(`${CONFIG_PATH}: no document resolved; the gate has nothing to read`);
  }

  for (const path of [...documents].sort()) {
    const text = present.has(path) ? read(path) : null;
    if (text === null) {
      violations.push(`${path}:0: declared document cannot be read`);
      continue;
    }
    counters.documents += 1;
    counters.citations += countRawCitations(text);
    for (const citation of findCitations(path, text, foreign)) {
      const kind = classifyCitation(citation, localAdrNumbers, foreign);
      if (kind === "local" || kind === "unknown-local") counters.local += 1;
      if (kind === "foreign-qualified") counters.foreign += 1;
      if (kind === "bare") {
        counters.bare += 1;
        violations.push(bareMotif(citation));
      }
      if (kind === "unknown-local") {
        violations.push(
          `${path}:${citation.line}: \`${citation.text}\` cites this repository's series, and no tracked ${ADR_DIRECTORY}${citation.digits}-*.md exists`,
        );
      }
    }
  }

  const adrFiles = new Map<string, string>();
  for (const path of tracked) {
    if (!path.startsWith(ADR_DIRECTORY) || !path.endsWith(".md")) continue;
    if (path.slice(ADR_DIRECTORY.length).includes("/")) continue;
    const text = present.has(path) ? read(path) : null;
    if (text === null) {
      violations.push(
        `${path}:0: ADR file cannot be read, so it cannot be judged as a redirection`,
      );
      continue;
    }
    adrFiles.set(path, text);
  }
  for (const redirect of findRedirects(adrFiles)) {
    counters.redirects += 1;
    const at = `${redirect.file}:${redirect.line}`;
    if (redirect.target === null) {
      counters.deadRedirects += 1;
      violations.push(
        `${at}: malformed redirection declaration "${redirect.declaration.trim()}": write \`Redirection : <path from the repository root>\``,
      );
    } else if (!isCleanRelativePath(redirect.target)) {
      counters.deadRedirects += 1;
      violations.push(
        `${at}: redirection target "${redirect.target}" is not a path from the repository root`,
      );
    } else if (redirect.target === redirect.file) {
      counters.deadRedirects += 1;
      violations.push(`${at}: redirection page points at itself`);
    } else if (!trackedSet.has(redirect.target)) {
      counters.deadRedirects += 1;
      violations.push(`${at}: redirection target "${redirect.target}" is not a tracked file`);
    } else if (!present.has(redirect.target)) {
      counters.deadRedirects += 1;
      violations.push(
        `${at}: redirection target "${redirect.target}" is tracked and absent from the checkout`,
      );
    }
    for (const line of redirect.decisionLines) {
      violations.push(
        `${redirect.file}:${line}: redirection page carries a decision field (Statut, Status or Arbitrage)`,
      );
    }
  }

  const sum = sumViolation(counters);
  if (sum !== null) violations.push(sum);
  return { violations, counters };
}

/**
 * `citations` is the raw count of matches; the classified citations must add up
 * to it. A citation dropped or counted twice by the per-line reading fails here.
 */
export function sumViolation(counters: Counters): string | null {
  const classified = counters.local + counters.foreign + counters.bare;
  if (counters.citations === classified) return null;
  return `internal: citations=${counters.citations} (raw matches) differs from local+foreign+bare=${classified}`;
}

export function renderCounters(counters: Counters): string {
  return (
    `documents=${counters.documents} citations=${counters.citations} ` +
    `(local=${counters.local} foreign=${counters.foreign} bare=${counters.bare}) ` +
    `redirects=${counters.redirects} dead-redirects=${counters.deadRedirects}`
  );
}

function readOrNull(root: string, path: string): string | null {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return null;
  }
}

function main(): number {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  let scope: Scope;
  try {
    scope = readScope(readFileSync(join(root, CONFIG_PATH), "utf8"));
  } catch (error) {
    console.error(`ADR citations failed: ${(error as Error).message}`);
    return 1;
  }
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", cwd: root })
    .split("\0")
    .filter(Boolean);
  const present = new Set(tracked.filter((path) => existsSync(join(root, path))));
  const { violations, counters } = evaluate({
    scope,
    tracked,
    present,
    read: (path) => readOrNull(root, path),
  });
  for (const violation of violations) console.error(violation);
  const volume = renderCounters(counters);
  if (violations.length > 0) {
    console.error(`ADR citations failed: ${violations.length} violation(s) — ${volume}`);
    return 1;
  }
  console.log(`ADR citations verified — ${volume}`);
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
