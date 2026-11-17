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
 * FORMS, closed by default. An ADR citation is `ADR`, not glued to a preceding
 * letter, digit or underscore, then any run of hyphens or spaces, then digits:
 *   F1 `ADR-NNNN` (ASCII hyphen, four digits): this repository's series, by the
 *      convention written in the data file; qualified by its form, and it must
 *      name a tracked docs/adr/NNNN-*.md;
 *   F2 `<repository> ADR NNNN` (ASCII space, four digits), the repository
 *      listed in `foreignRepositories`: another repository's series;
 *   F3 `ADR NNNN` with no listed repository right before it: bare;
 *   F4 any other number of digits, any other separator, or none
 *      (`ADR-003`, `ADR0047`, `ADR\u{2011}0047`): bare.
 * Limits, by design: lowercase `adr-` (file names, review folder names) is not
 * read, and a list after one prefix (`ADRs 0028, 0045`, `ADR-0042/0054`) is read
 * for its first number only, if at all.
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
 * `ADR`, then any run of separator characters (hyphens of every width, any
 * whitespace including no-break spaces), then digits. The separator is
 * captured whole so that only a single ASCII hyphen or space is accepted.
 */
const CITATION = /(?<![A-Za-z0-9_])ADR([\s\u{2010}-\u{2015}\u{2212}-]*)(\d+)(?![0-9])/gu;
const LEADING_WRAPPERS = /^[`*_"'([]+/;
const TRAILING_WRAPPERS = /[`*_"']+$/;
const REDIRECT_MENTION = /^\W*redirect/i;
const REDIRECT_LINE =
  /^\s*(?:[-*+>]\s+)?(?:\*\*|__)?Redirection\s*:\s*(?:\*\*|__)?\s*(?:`([^`\s]+)`|\[[^\]]*\]\(([^()\s]+)\)|([^\s`[\]()]+))\s*$/;
const DECISION_FIELD =
  /^\s*(?:[-*+>]\s+)?(?:\*\*|__)?\s*(Statut|Status|Arbitrage)\s*(?:\*\*|__)?\s*:/i;

export interface Scope {
  readonly convention: string;
  readonly localForm: typeof LOCAL_FORM;
  readonly documents: readonly string[];
  readonly foreignRepositories: readonly string[];
}

export interface Citation {
  readonly file: string;
  readonly line: number;
  /** The citation as written, `ADR` through the last digit. */
  readonly text: string;
  readonly separator: string;
  readonly digits: string;
  /** The word right before `ADR `, unwrapped; null when there is none. */
  readonly qualifier: string | null;
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

/** Every ADR citation of a text, with its line and the word written right before it. */
export function findCitations(file: string, text: string): Citation[] {
  const citations: Citation[] = [];
  const lines = text.split("\n");
  lines.forEach((content, index) => {
    for (const match of content.matchAll(CITATION)) {
      const separator = match[1] ?? "";
      const digits = match[2] ?? "";
      const before = content.slice(0, match.index);
      const word = /(\S+)\s+$/.exec(before)?.[1];
      const qualifier = word === undefined ? null : unwrapQualifier(word);
      citations.push({
        file,
        line: index + 1,
        text: match[0],
        separator,
        digits,
        qualifier: qualifier === "" ? null : qualifier,
      });
    }
  });
  return citations;
}

export function classifyCitation(
  citation: Citation,
  localAdrNumbers: ReadonlySet<string>,
  foreignRepositories: ReadonlySet<string>,
): CitationClass {
  if (citation.digits.length !== 4) return "bare";
  if (citation.separator === "-") {
    return localAdrNumbers.has(citation.digits) ? "local" : "unknown-local";
  }
  if (citation.separator === " " && citation.qualifier !== null) {
    if (foreignRepositories.has(citation.qualifier)) return "foreign-qualified";
  }
  return "bare";
}

function bareMotif(citation: Citation): string {
  const at = `${citation.file}:${citation.line}`;
  if (citation.digits.length !== 4) {
    return `${at}: bare ADR citation \`${citation.text}\`: an ADR number has four digits`;
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
    for (const citation of findCitations(path, text)) {
      counters.citations += 1;
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

  if (counters.citations !== counters.local + counters.foreign + counters.bare) {
    violations.push(
      `internal: citations=${counters.citations} differs from local+foreign+bare=${counters.local + counters.foreign + counters.bare}`,
    );
  }
  return { violations, counters };
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
