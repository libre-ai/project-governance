import { touchesGatedPaths } from "./check-review-evidence";
import { concludeGate, GateReport } from "./gate-report";
import {
  atLeast,
  type Criterion,
  type MaturityLevel,
  type Parsed,
  parseCriteria,
  parseWorkPackages,
  readDocumentMaturity,
  type WorkPackage,
} from "./prd-model";
import {
  type ExemptRule,
  loadWorkPackagePolicy,
  type WorkPackagePolicy,
} from "./work-package-policy";
import { realPorts } from "./work-package-ports";
import { findUnreadableCharacter, type UnreadableCharacter } from "./yaml-text-guard";

/**
 * Work-package link gate — every pull request names the work package it
 * delivers, or an exemption class whose predicate the gate verifies.
 *
 * Why: the chain PRD, criterion, work package, pull request is only an audit
 * trail if the last link is machine-readable. The grammar of the declaration
 * and the rule "exactly one distinct value in the range" are fixed by
 * docs/specifications/WORK-PACKAGES.md (section "Commit trailer"); this file
 * is their reader, not their author.
 *
 * The declaration is a git trailer of the commits of the pull request, parsed
 * by git itself (see `LinkPorts.commitTrailers`), never a line of the pull
 * request description: a description is Markdown, and every attempt to read a
 * line "the way it renders" left a class where the gate read something other
 * than what a reviewer sees. A trailer has no Markdown semantics. The
 * description is not an input of this gate.
 *
 * This file holds the reader of the declaration, the verifier of exemptions,
 * the reader of the issue body, the resolution of a link (issue, approved PRD,
 * work package, cited criteria), the containment of the diff in the scope of
 * the work package, and the explicit `ready` of an owner where the norm
 * requires one (section "Readiness").
 */

/** A value read through a port: either the value, or the reason it could not be read. */
export type Fact<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * What the gate reads of the issue that projects a work package.
 *
 * Contract for the real implementation (Task 12), from the timeline of the
 * issue:
 * - `labels`: the names of the labels the issue carries now, as written.
 * - `readyLabeledBy`: the actor of the LAST `labeled` event of the label
 *   `ready` (ASCII case-insensitive) that no later `unlabeled` event of that
 *   label follows; `null` when the issue does not carry `ready`. A label
 *   removed then set again gives the actor of the new `labeled` event.
 * - `bodyEditedAfterReady`: `true` when an edit of the issue body is later
 *   than that `labeled` event, `false` otherwise (and `false` when there is no
 *   such event). Setting the label again restarts the comparison from the new
 *   event.
 * An implementation that cannot read the timeline returns `ok: false`, never
 * a default value. The gate takes no value but the boolean `false` as "not
 * edited since".
 */
export interface IssueRead {
  readonly body: string;
  readonly labels: readonly string[];
  readonly readyLabeledBy: string | null;
  readonly bodyEditedAfterReady: boolean;
}

export interface Trailer {
  readonly key: string;
  readonly value: string;
}

/** The trailers of one commit of the range, as git parsed them. */
export interface CommitDeclarations {
  readonly sha: string;
  readonly trailers: readonly Trailer[];
}

/** Every outside read of the gate, so that the verdict is testable without network or git. */
export interface LinkPorts {
  readIssue(repo: string, number: number): Promise<Fact<IssueRead>>;
  readFileAt(repo: string, sha: string, path: string): Promise<Fact<string>>;
  isAncestorOfServedHead(repo: string, sha: string): Promise<Fact<boolean>>;
  /**
   * Contract for the real implementation (Task 12): one entry per commit of
   * `baseSha..headSha`, each with the trailers GIT parses from the trailer
   * block of that commit's message (`git log --format` with
   * `%(trailers:only,unfold)`, or `git interpret-trailers --parse`). Never a
   * regular expression over the message: a `Work-package:` line outside the
   * trailer block is not a trailer. Keys are returned as written, values with
   * the surrounding whitespace trimmed by git. A range that cannot be read is
   * `ok: false`, never an empty list, and so is any range read in a shallow
   * checkout (a shallow history can cut the range or widen it), or with grafts
   * or replace refs in effect.
   */
  commitTrailers(baseSha: string, headSha: string): Promise<Fact<readonly CommitDeclarations[]>>;
  /**
   * Contract for the real implementation (Task 12): list BOTH sides of every
   * rename, i.e. `git diff --name-only --no-renames -z base...head`, so a file
   * moved into a documentation path is still seen at its source path. Paths
   * are returned exactly as git prints them: never quoted, never normalised.
   * An implementation, and any caller trusting one, must reject a path that
   * contains a `..` segment, starts with `./`, or starts with `/`, as an
   * unreadable source rather than match it against a glob. A diff read in a
   * shallow checkout is `ok: false`: git may take another merge base there.
   */
  changedFiles(baseSha: string, headSha: string): Promise<Fact<readonly string[]>>;
}

export interface PrFacts {
  readonly repo: string;
  readonly number: number | null;
  readonly title: string;
  readonly author: string | null;
  readonly baseSha: string;
  readonly headSha: string;
}

export type Declaration =
  | { readonly kind: "link"; readonly repo: string; readonly issue: number; readonly wp: string }
  | { readonly kind: "exempt"; readonly cls: string }
  | { readonly kind: "invalid"; readonly reason: string };

// `Work-package: <owner>/<repo>#<n> WP-<k>` (norm, "Commit trailer"): the
// value git hands over has no surrounding whitespace; between its two parts
// there is exactly one space and nothing follows `WP-<k>`. `<n>` and `<k>`
// are positive integers without a leading zero. The owner is a GitHub login;
// the repository is GitHub's repository charset, which is never `.` or `..`
// (the lookahead refuses both). `<k>` has at most nine digits: a PRD table has
// no row beyond that, and a bounded number cannot overflow a later reader.
//
// Both value grammars are anchored on the WHOLE value and must never take the
// `m` flag, a `.` or a `\s`: git can hand over a value holding a line feed
// (an unfolded continuation), a NUL, a CR or a Unicode separator, and only
// whole-value anchors refuse such a value instead of reading one of its lines.
// The tests pin this against every such character.
//
// The owner, repository-name and WP sources are shared with the reader of the
// issue body, whose `PRD-ref` and `WP` values have the grammar of the trailer.
const OWNER_SOURCE = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?";
const REPOSITORY_NAME_SOURCE = "[A-Za-z0-9._-]{1,100}";
const WP_SOURCE = "WP-[1-9][0-9]{0,8}";

const WORK_PACKAGE_VALUE: RegExp = new RegExp(
  `^(${OWNER_SOURCE})\\/((?!\\.{1,2}#)${REPOSITORY_NAME_SOURCE})#([1-9][0-9]*) (${WP_SOURCE})$`,
);

// `Exempt: <class>`: the same shape as the names of the policy's rules.
const EXEMPT_VALUE: RegExp = /^([a-z][a-z0-9-]*)$/;

const invalid = (reason: string): Declaration => ({ kind: "invalid", reason });

function readWorkPackageValue(value: string): Declaration {
  const match: RegExpExecArray | null = WORK_PACKAGE_VALUE.exec(value);
  if (match === null) {
    return invalid(
      `malformed Work-package value ${JSON.stringify(value)} — expected ` +
        '"<owner>/<repo>#<n> WP-<k>" with one space, <n> and <k> positive without a leading zero',
    );
  }
  const [, owner, name, issue, wp] = match as unknown as [string, string, string, string, string];
  const number: number = Number(issue);
  if (!Number.isSafeInteger(number)) {
    return invalid(`issue number ${issue} is too large to be an issue`);
  }
  return { kind: "link", repo: `${owner}/${name}`, issue: number, wp };
}

function readExemptValue(value: string): Declaration {
  if (value.trim() === "") {
    return invalid("empty Exempt class — name a class of the policy");
  }
  const match: RegExpExecArray | null = EXEMPT_VALUE.exec(value);
  if (match === null) {
    return invalid(
      `malformed Exempt value ${JSON.stringify(value)} — expected "<class>" in lowercase letters, digits and hyphens`,
    );
  }
  return { kind: "exempt", cls: match[1] as string };
}

/** A declaration trailer: the key in ASCII lower case, the value as git returned it. */
interface Pair {
  readonly key: "work-package" | "exempt";
  readonly value: string;
}

interface Pairs {
  /** Declaration trailers seen, repeats included. */
  readonly seen: number;
  /** Distinct (key, value) pairs, in order of first appearance. */
  readonly distinct: readonly Pair[];
}

// ASCII only: `toLowerCase` would also fold characters such as U+212A (Kelvin
// sign) into the letters of the keyword.
const asciiLower = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

function declarationKey(key: string): Pair["key"] | null {
  const lower: string = asciiLower(key);
  return lower === "work-package" || lower === "exempt" ? lower : null;
}

/** Keep the declaration trailers of every commit; the same pair on several commits counts once. */
function collectPairs(commits: readonly CommitDeclarations[]): Pairs {
  const distinct = new Map<string, Pair>();
  let seen: number = 0;
  for (const commit of commits) {
    for (const trailer of commit.trailers) {
      const key: Pair["key"] | null = declarationKey(trailer.key);
      if (key !== null) {
        seen += 1;
        distinct.set(JSON.stringify([key, trailer.value]), { key, value: trailer.value });
      }
    }
  }
  return { seen, distinct: [...distinct.values()] };
}

function declarationOf(distinct: readonly Pair[]): Declaration {
  const [only] = distinct;
  if (only === undefined) {
    return invalid("no declaration trailer in the commits of the range");
  }
  if (distinct.length > 1) {
    // At most twenty pairs named, the rest counted: every distinct value
    // named made a message of hundreds of thousands of characters.
    const named: string = boundedList(
      distinct.map((p: Pair): string => `${p.key}: ${JSON.stringify(p.value)}`),
    );
    return invalid(
      `${distinct.length} distinct declaration trailers in the range (${named}) — exactly one distinct value is allowed`,
    );
  }
  return only.key === "work-package"
    ? readWorkPackageValue(only.value)
    : readExemptValue(only.value);
}

/** Pure reading of the declaration carried by the commits of a pull request. */
export function readDeclaration(commits: readonly CommitDeclarations[]): Declaration {
  return declarationOf(collectPairs(commits).distinct);
}

// ---------------------------------------------------------------------------
// Issue body
//
// The body of an issue is Markdown written by whoever opened it, through the
// web form, `gh issue create` or the API. It is accepted only in the EXACT
// shape the `work-package` issue form produces (norm, "Issue body"): any
// heuristic reading ("first non-empty line after the heading") leaves a class
// of bodies where the gate reads something other than what a reviewer sees.
// ---------------------------------------------------------------------------

/** The PRD cited by an issue: a repository, a full commit, and the path of the PRD. */
export interface PrdRef {
  readonly repo: string;
  readonly sha: string;
  readonly path: string;
}

export interface IssueFields {
  readonly prdRef: PrdRef;
  readonly wp: string;
}

const PRD_PATH = "docs/prd.md";
const REQUIREMENTS_PATH = "docs/cahier-des-charges.md";

// One entry per line of the body: a fixed text, or `null` for a value line.
const ISSUE_BODY_SHAPE: readonly (string | null)[] = [
  "### PRD-ref",
  "",
  null,
  "",
  "### WP",
  "",
  null,
];
const PRD_REF_LINE = 2;
const WP_LINE = 6;

// Whole-value anchors, no `m` flag, no `.`, no `\s`: see WORK_PACKAGE_VALUE.
const REPOSITORY: RegExp = new RegExp(`^${OWNER_SOURCE}\\/(?!\\.{1,2}$)${REPOSITORY_NAME_SOURCE}$`);
const FULL_COMMIT: RegExp = /^[0-9a-f]{40}$/;
const WP_VALUE: RegExp = new RegExp(`^${WP_SOURCE}$`);

const failed = (reason: string): { readonly ok: false; readonly reason: string } => ({
  ok: false,
  reason,
});

/** Line ends normalised (CRLF to LF), and at most one final line end removed. */
function bodyLines(body: string): readonly string[] {
  const normalised: string = body.replaceAll("\r\n", "\n");
  const trimmed: string = normalised.endsWith("\n") ? normalised.slice(0, -1) : normalised;
  return trimmed.split("\n");
}

/** The first line that departs from the form, or null when every fixed line is in place. */
function shapeProblem(lines: readonly string[]): string | null {
  for (const [index, expected] of ISSUE_BODY_SHAPE.entries()) {
    const actual: string | undefined = lines[index];
    if (actual === undefined) {
      return `issue body ends after line ${lines.length}, expected exactly ${ISSUE_BODY_SHAPE.length} lines`;
    }
    if (expected !== null && actual !== expected) {
      const wanted: string = expected === "" ? "an empty line" : JSON.stringify(expected);
      return `issue body line ${index + 1} is ${JSON.stringify(actual)}, expected ${wanted}`;
    }
  }
  if (lines.length > ISSUE_BODY_SHAPE.length) {
    return `issue body has ${lines.length} lines, expected exactly ${ISSUE_BODY_SHAPE.length}: nothing may follow the WP value`;
  }
  return null;
}

function readPrdRef(value: string): Parsed<PrdRef> {
  const at: number = value.indexOf("@");
  const colon: number = at === -1 ? -1 : value.indexOf(":", at + 1);
  if (colon === -1) {
    return failed(`PRD-ref ${JSON.stringify(value)} is not <owner>/<repo>@<40 hex>:${PRD_PATH}`);
  }
  const repo: string = value.slice(0, at);
  const sha: string = value.slice(at + 1, colon);
  const path: string = value.slice(colon + 1);
  if (!REPOSITORY.test(repo)) {
    return failed(`PRD-ref repository ${JSON.stringify(repo)} is not <owner>/<repo>`);
  }
  if (!FULL_COMMIT.test(sha)) {
    return failed(
      `PRD-ref commit ${JSON.stringify(sha)} is not a full commit of 40 lowercase hexadecimal characters`,
    );
  }
  if (path !== PRD_PATH) {
    return failed(`PRD-ref path ${JSON.stringify(path)} is not ${JSON.stringify(PRD_PATH)}`);
  }
  return { ok: true, value: { repo, sha, path } };
}

/** Read the `PRD-ref` and `WP` of an issue body written exactly as the work-package form writes it. */
export function readIssueFields(body: string): Parsed<IssueFields> {
  const lines: readonly string[] = bodyLines(body);
  const problem: string | null = shapeProblem(lines);
  if (problem !== null) {
    return failed(problem);
  }
  const prdRef: Parsed<PrdRef> = readPrdRef(lines[PRD_REF_LINE] as string);
  if (!prdRef.ok) {
    return prdRef;
  }
  const wp: string = lines[WP_LINE] as string;
  if (!WP_VALUE.test(wp)) {
    return failed(
      `WP ${JSON.stringify(wp)} is not WP-<k> with <k> a positive integer of at most nine digits, without a leading zero`,
    );
  }
  return { ok: true, value: { prdRef: prdRef.value, wp } };
}

// ---------------------------------------------------------------------------
// Containment of a path in a glob
//
// ONE function decides it, for the `paths` predicate of an exempt class and for
// the scope of a work package: two matchers would let the same file be inside
// a scope for one and outside it for the other. `Bun.Glob#match` is used as
// is; its behaviour on the grammar the gate accepts was measured on Bun 1.4.0
// and is pinned by the tests (outside braces `**` crosses `/` and matches
// dotfiles, `*` does not cross `/`, `{a,b}` alternates literals, matching is
// case-sensitive, and a directory itself is not matched by `dir/**`). Inside
// braces a `*` does NOT behave the same (`{src/**,lib/**}` misses `src/a/b`),
// which is why `scopeEntryProblem` refuses any `*` inside braces.
// ---------------------------------------------------------------------------

/** Whether `path`, a repository-relative path, is inside the glob `pattern`. */
export function matchesScope(pattern: string, path: string): boolean {
  return new Bun.Glob(pattern).match(path);
}

/** The characters a scope entry may hold: the grammar the gate can match with certainty. */
const SCOPE_CHARACTERS = "[A-Za-z0-9._/@+=,{}*-]";
const OUTSIDE_SCOPE_CHARACTERS: RegExp = /[^A-Za-z0-9._/@+=,{}*-]/u;

// A character that renders as nothing, or as a blank, in a log or a review UI
// and that `findUnreadableCharacter` lets through (U+200B is inside its
// allow-class): space separators other than U+0020, format characters (zero
// width, bidirectional controls) and private use.
const INVISIBLE_CHARACTER: RegExp = /(?! )[\p{Zs}\p{Zl}\p{Zp}\p{Cf}\p{Co}]/u;

/** A text safe to print: JSON quoting, then every non-ASCII character as `\u{hex}`. */
function asciiQuoted(text: string): string {
  return JSON.stringify(text).replace(
    /[^\x20-\x7E]/gu,
    (char: string): string => `\\u{${(char.codePointAt(0) as number).toString(16)}}`,
  );
}

const codePointLabel = (char: string): string =>
  `U+${(char.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`;

function bracesBalanced(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Why the gate refuses a scope entry, or null when it accepts it.
 *
 * Why: the norm only says authors SHOULD use literal paths, `*`, `**` and
 * `{a,b}`; the gate, which decides, refuses what it cannot match with
 * certainty rather than guess (fail closed). `!` negation, `[..]`, `?`, `\`,
 * `(..)` and spaces are outside the grammar; so are an absolute entry, a
 * `..` segment in any branch of an alternation, and a `*` inside braces
 * (braces are for literal alternatives only).
 */
export function scopeEntryProblem(entry: string): string | null {
  if (entry === "") {
    return "the entry is empty";
  }
  const outside: RegExpExecArray | null = OUTSIDE_SCOPE_CHARACTERS.exec(entry);
  if (outside !== null) {
    return `the character ${asciiQuoted(outside[0])} is outside ${SCOPE_CHARACTERS}`;
  }
  if (entry.startsWith("/")) {
    return 'it starts with "/"';
  }
  if (entry.split(/[/{},]/).includes("..")) {
    return 'it has a ".." segment';
  }
  if (!bracesBalanced(entry)) {
    return "its braces are unbalanced";
  }
  return hasWildcardInBraces(entry)
    ? 'it has a "*" inside braces: list the alternatives as separate entries outside braces'
    : null;
}

/**
 * Whether a `*` sits inside `{...}`. Measured on Bun 1.4.0: there `**` no longer
 * crosses `/` (`{src/**,lib/**}` does not match `src/a/b`, `src{/**,}` does not
 * match `src/x/y`), so the entry would silently match less than it says.
 */
function hasWildcardInBraces(entry: string): boolean {
  let depth = 0;
  for (const char of entry) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (char === "*" && depth > 0) return true;
  }
  return false;
}

// The scope entries that bound (almost) nothing: the double star and the double
// star followed by a slash and a star match every path, the single star every
// path at the root. Accepted (a work package may cover everything) but flagged,
// because with one of them the containment check can hardly refuse a file.
const UNBOUNDED_SCOPE_ENTRIES: readonly string[] = ["**", "*", "**/*"];

/** The first character of `path` that is a control, a separator or invisible, as `U+XXXX`. */
function unreadableCharacterOf(path: string): string | null {
  // `findUnreadableCharacter` is meant for multi-line text and lets a line feed through.
  if (path.includes("\n")) {
    return "U+000A";
  }
  const guarded: UnreadableCharacter | null = findUnreadableCharacter(path);
  if (guarded !== null) {
    return guarded.codePoint;
  }
  const invisible: RegExpExecArray | null = INVISIBLE_CHARACTER.exec(path);
  return invisible === null ? null : codePointLabel(invisible[0]);
}

/**
 * Why a path handed over by the `changedFiles` port is not a repository-relative
 * path, or null when it is.
 *
 * Why: the port is not trusted. `src/../../etc/passwd` matches `src/**`, and a
 * path holding a control or invisible character would be printed unreadable
 * in the verdict. Git never prints either, so a hit is a misread source.
 */
export function changedPathProblem(path: string): string | null {
  if (path === "") {
    return "it is empty";
  }
  const unreadable: string | null = unreadableCharacterOf(path);
  if (unreadable !== null) {
    return `it contains the unreadable character ${unreadable}`;
  }
  if (path.startsWith("/")) {
    return "it is absolute";
  }
  if (path.startsWith("./")) {
    return 'it starts with "./"';
  }
  const segments: readonly string[] = path.split("/");
  if (segments.includes("..")) {
    return 'it has a ".." segment';
  }
  if (segments.includes(".")) {
    return 'it has a "." segment';
  }
  return segments.includes("") ? "it has an empty segment" : null;
}

// At most this many paths are spelled out in one message; the rest is counted.
const NAMED_LIMIT = 20;

function boundedList(items: readonly string[]): string {
  const shown: string = items.slice(0, NAMED_LIMIT).join(", ");
  const rest: number = items.length - NAMED_LIMIT;
  return rest > 0 ? `${shown}, and ${rest} more` : shown;
}

/**
 * The refusal of the paths of a diff that are not repository-relative paths,
 * or null when every one is. One message shape for the link path and the
 * exempt path, so the same defect reads the same way in both.
 */
function unreadablePaths(
  paths: readonly string[],
): { readonly summary: string; readonly note: string } | null {
  const unreadable: string[] = [];
  for (const path of paths) {
    const problem: string | null = changedPathProblem(path);
    if (problem !== null) {
      unreadable.push(`${asciiQuoted(path)} (${problem})`);
    }
  }
  if (unreadable.length === 0) {
    return null;
  }
  const summary = `${unreadable.length} of ${paths.length} changed file path(s) unreadable`;
  return { summary, note: `${summary}: ${boundedList(unreadable)}` };
}

function holdsPaths(
  globs: readonly string[],
  changed: readonly string[],
): { ok: boolean; note: string } {
  if (changed.length === 0) {
    return { ok: false, note: "no changed file: an empty diff is not a documentation-only change" };
  }
  const outside: string[] = changed.filter(
    (path) => !globs.some((pattern) => matchesScope(pattern, path)),
  );
  return outside.length === 0
    ? { ok: true, note: `all ${changed.length} changed file(s) match ${JSON.stringify(globs)}` }
    : {
        ok: false,
        note: `${outside.length} of ${changed.length} changed file(s) outside ${JSON.stringify(globs)}: ${outside.map(asciiQuoted).join(", ")}`,
      };
}

/**
 * Verify the predicate of one exempt class against the pull request itself.
 * The class is a name; only the rule of the policy says what it means. Every
 * comparison is exact — no trimming, no case folding.
 */
export function exemptionHolds(
  cls: string,
  rule: ExemptRule | undefined,
  pr: PrFacts,
  changed: readonly string[],
): { readonly ok: boolean; readonly note: string } {
  if (rule === undefined) {
    return { ok: false, note: `exempt class ${JSON.stringify(cls)} is not listed in the policy` };
  }
  if ("author" in rule) {
    const ok: boolean = pr.author !== null && pr.author === rule.author;
    return {
      ok,
      note: ok
        ? `author is ${JSON.stringify(rule.author)}`
        : `author ${JSON.stringify(pr.author)} is not ${JSON.stringify(rule.author)} (class ${JSON.stringify(cls)})`,
    };
  }
  if ("titlePrefix" in rule) {
    const ok: boolean = pr.title.startsWith(rule.titlePrefix);
    return {
      ok,
      note: ok
        ? `title starts with ${JSON.stringify(rule.titlePrefix)}`
        : `title ${JSON.stringify(pr.title)} does not start with ${JSON.stringify(rule.titlePrefix)} (class ${JSON.stringify(cls)})`,
    };
  }
  const result: { ok: boolean; note: string } = holdsPaths(rule.paths, changed);
  return { ok: result.ok, note: `${result.note} (class ${JSON.stringify(cls)})` };
}

/** Own-property lookup: a class named like an inherited member never reaches it. */
function ruleOf(policy: WorkPackagePolicy, cls: string): ExemptRule | undefined {
  return Object.hasOwn(policy.exempt, cls) ? policy.exempt[cls] : undefined;
}

/** The class whose `author` predicate equals the author EXACTLY, or null when none does. */
function implicitClassOf(policy: WorkPackagePolicy, author: string | null): string | null {
  // An empty login is no author: a rule written `author: ""` must not exempt it.
  if (author === null || author === "") {
    return null;
  }
  for (const [cls, rule] of Object.entries(policy.exempt)) {
    if ("author" in rule && rule.author === author) {
      return cls;
    }
  }
  return null;
}

/** The refusal of the first glob of a `paths` rule outside the scope grammar, or null. */
function unsupportedRuleGlob(cls: string, rule: ExemptRule): string | null {
  if (!("paths" in rule)) {
    return null;
  }
  for (const glob of rule.paths) {
    const problem: string | null = scopeEntryProblem(glob);
    if (problem !== null) {
      return `exemption rule ${JSON.stringify(cls)} has an unsupported glob ${asciiQuoted(glob)}: ${problem}`;
    }
  }
  return null;
}

interface GuardedRefusal {
  readonly note: string;
  readonly decision: string;
}

/**
 * The refusal of an exemption, explicit or implicit, whose diff touches a
 * guarded path of I-17, or null when none is touched. One message for both
 * paths, so the same defect reads the same way.
 */
function guardedPathRefusal(paths: readonly string[]): GuardedRefusal | null {
  const guarded: readonly string[] = touchesGatedPaths(paths);
  if (guarded.length === 0) {
    return null;
  }
  return {
    note: `an exemption cannot cover a guarded path (${boundedList(guarded.map(asciiQuoted))}): declare a Work-package and obtain the owner ready`,
    decision: `refused, an exemption cannot cover a guarded path: ${guarded.length} guarded path(s) touched`,
  };
}

/** What the judgement of a declared exemption examined and decided, for the volume. */
interface ExemptionVolume {
  readonly filesExamined: number;
  readonly decision: string;
}

/**
 * Judge a declared exemption against the diff.
 *
 * Why in this order: every path is validated first, for EVERY class (the port
 * is not trusted, and `docs/adr/../x` must not hide a guarded path from the
 * next step, nor `docs/../src/x.ts` match `docs/**`). Then an exemption never
 * covers a guarded path of I-17 (norm, "Readiness"): the title of a revert and
 * the paths of a documentation change are in the author's hands, and a
 * guarded surface needs the owner `ready` of a work package. Only then is the
 * predicate of the class consulted.
 */
async function evaluateExemption(
  report: GateReport,
  label: string,
  cls: string,
  pr: PrFacts,
  policy: WorkPackagePolicy,
  ports: LinkPorts,
): Promise<ExemptionVolume> {
  const item: string = `${label} — Exempt: ${cls}`;
  const changed: Fact<readonly string[]> = await ports.changedFiles(pr.baseSha, pr.headSha);
  if (!changed.ok) {
    report.check(item, false, `changed files unreadable (${changed.reason})`);
    return { filesExamined: 0, decision: "changed files unreadable" };
  }
  const paths: readonly string[] = changed.value;
  // Same rule as the implicit exemption: nothing changed is covered by no
  // class, whatever its predicate (an author or a title says nothing of a diff).
  if (paths.length === 0) {
    report.check(
      item,
      false,
      "the diff holds no changed file: an exemption covers a pull request that changes at least one file",
    );
    return { filesExamined: 0, decision: "the diff holds no changed file" };
  }
  const refusal: { readonly summary: string; readonly note: string } | null =
    unreadablePaths(paths);
  if (refusal !== null) {
    report.check(item, false, refusal.note);
    return { filesExamined: paths.length, decision: refusal.summary };
  }
  const guarded: GuardedRefusal | null = guardedPathRefusal(paths);
  if (guarded !== null) {
    report.check(item, false, guarded.note);
    return { filesExamined: paths.length, decision: guarded.decision };
  }
  const rule: ExemptRule | undefined = ruleOf(policy, cls);
  // The globs of a `paths` rule are data: they pass the grammar of a scope
  // entry before they are matched, since `matchesScope` misreads what that
  // grammar refuses (a `*` inside braces matches less than it says).
  const unsupported: string | null = rule === undefined ? null : unsupportedRuleGlob(cls, rule);
  if (unsupported !== null) {
    report.check(item, false, unsupported);
    return { filesExamined: paths.length, decision: "refused, the exemption rule is unsupported" };
  }
  const verdict: { readonly ok: boolean; readonly note: string } = exemptionHolds(
    cls,
    rule,
    pr,
    paths,
  );
  report.check(item, verdict.ok, verdict.note);
  return {
    filesExamined: paths.length,
    decision: verdict.ok ? "predicate held" : "predicate false",
  };
}

// ---------------------------------------------------------------------------
// Resolution of a link: issue, PRD at the cited commit, approval, work
// package, cited criteria (norm, "Issue body", "Approved PRD", "Criteria
// grammar"). Each step stops the chain on a failure, since every later step
// reads what the failed one would have resolved; the last step reports every
// cited criterion, so that one pull request shows all its faulty citations.
// ---------------------------------------------------------------------------

type LinkDeclaration = Extract<Declaration, { readonly kind: "link" }>;

/** What the resolution read, printed in the volume. A field that was never reached says so. */
interface ResolutionVolume {
  issue: string;
  prd: string;
  maturity: string;
  workPackages: string;
  criteria: string;
  cited: string;
  scopeEntries: string;
  filesExamined: string;
  scopeDecision: string;
  /** Whether `ready` is implicit or explicit, why, and the result of the explicit check. */
  ready: string;
  /** The unbounded entries of the scope, empty when it is bounded. */
  unbounded: readonly string[];
}

interface Resolution {
  readonly report: GateReport;
  readonly label: string;
  /** The pull request: its repository's owner is the one every link must stay within. */
  readonly pr: PrFacts;
  readonly volume: ResolutionVolume;
}

/** The issue as read, with the fields of its body; the readiness step reads its labels. */
interface LinkedIssue {
  readonly read: IssueRead;
  readonly fields: IssueFields;
}

/** Steps 1 to 3: the issue is readable, its body is the form, and it projects the declared WP. */
async function readLinkedIssue(
  resolution: Resolution,
  link: LinkDeclaration,
  ports: LinkPorts,
): Promise<LinkedIssue | null> {
  const item: string = `${resolution.label} — issue ${link.repo}#${link.issue}`;
  const issue: Fact<IssueRead> = await ports.readIssue(link.repo, link.issue);
  if (!issue.ok) {
    resolution.volume.issue = `${link.repo}#${link.issue} unreadable`;
    resolution.report.check(item, false, `issue unreadable (${issue.reason})`);
    return null;
  }
  resolution.volume.issue = `${link.repo}#${link.issue} read`;
  const fields: Parsed<IssueFields> = readIssueFields(issue.value.body);
  if (!fields.ok) {
    resolution.report.check(
      item,
      false,
      `the issue body is not the work-package form: ${fields.reason}`,
    );
    return null;
  }
  if (fields.value.wp !== link.wp) {
    resolution.report.check(
      item,
      false,
      `the issue projects ${fields.value.wp}, the trailer declares ${link.wp}`,
    );
    return null;
  }
  const { repo, sha, path } = fields.value.prdRef;
  resolution.report.check(item, true, `projects ${fields.value.wp} of ${repo}@${sha}:${path}`);
  return { read: issue.value, fields: fields.value };
}

/** The owner segment of `<owner>/<name>`, or null when there is no slash. */
function ownerOf(repo: string): string | null {
  const slash: number = repo.indexOf("/");
  if (slash === -1) {
    return null;
  }
  const owner: string = repo.slice(0, slash);
  // `libre-ai/` or `/gov` is no repository: an empty side never names an owner.
  return owner === "" || slash === repo.length - 1 ? null : owner;
}

/**
 * Record whether `repo` belongs to the owner of the pull request.
 *
 * Why: an issue or a PRD of another owner is a public file anyone can write
 * at `décision`, so the chain would prove nothing. GitHub logins are
 * case-insensitive, and the owner grammar is ASCII, so the comparison folds
 * ASCII case only (`asciiLower`), never Unicode case.
 */
function checkSameOwner(
  resolution: Resolution,
  item: string,
  kind: "issue" | "PRD-ref",
  repo: string,
): boolean {
  const owner: string | null = ownerOf(repo);
  const prOwner: string | null = ownerOf(resolution.pr.repo);
  const same: boolean =
    owner !== null && prOwner !== null && asciiLower(owner) === asciiLower(prOwner);
  if (!same) {
    const cause: string =
      prOwner === null
        ? `the pull request repository has no owner (${JSON.stringify(resolution.pr.repo)} is not <owner>/<repo>)`
        : `the ${kind} repository belongs to owner ${JSON.stringify(owner ?? repo)}, the pull request to owner ${JSON.stringify(prOwner)}`;
    resolution.report.check(
      item,
      false,
      `${cause}: the chain is resolved only within the owner of the pull request`,
    );
  }
  return same;
}

/** Step 4: the cited commit is on the branch the repository serves. */
async function checkServed(
  resolution: Resolution,
  item: string,
  prdRef: PrdRef,
  ports: LinkPorts,
): Promise<boolean> {
  const served: Fact<boolean> = await ports.isAncestorOfServedHead(prdRef.repo, prdRef.sha);
  if (!served.ok) {
    resolution.report.check(
      item,
      false,
      `ancestry of the cited commit unreadable (${served.reason})`,
    );
    return false;
  }
  // Strictly `true`: a sloppy port answering "false" or 1 must not read as ancestry.
  const onServedBranch: boolean = served.value === true;
  resolution.report.check(
    item,
    onServedBranch,
    onServedBranch
      ? `the cited commit is on the served branch of ${prdRef.repo}`
      : `the cited commit is not on the served branch of ${prdRef.repo}`,
  );
  return onServedBranch;
}

/** Step 5: one document of the repository at the cited commit; unreadable is a violation naming its path. */
async function readAtCitedCommit(
  resolution: Resolution,
  item: string,
  prdRef: PrdRef,
  path: string,
  ports: LinkPorts,
): Promise<string | null> {
  const file: Fact<string> = await ports.readFileAt(prdRef.repo, prdRef.sha, path);
  if (!file.ok) {
    resolution.report.check(item, false, `${path} unreadable (${file.reason})`);
    return null;
  }
  return file.value;
}

/** Step 6: the PRD declares a maturity at least equal to the policy's threshold. */
function checkApproved(
  resolution: Resolution,
  item: string,
  prd: string,
  floor: MaturityLevel,
): boolean {
  const read: Parsed<MaturityLevel | null> = readDocumentMaturity(prd);
  if (!read.ok) {
    resolution.volume.maturity = "unreadable";
    resolution.report.check(item, false, `${PRD_PATH} unreadable as a PRD (${read.reason})`);
    return false;
  }
  const level: MaturityLevel | null = read.value;
  if (level === null) {
    resolution.volume.maturity = "none";
    resolution.report.check(
      item,
      false,
      `no \`Maturité du document :\` line gives a level (absent, unknown or contradictory): the PRD is not approved (threshold: ${floor})`,
    );
    return false;
  }
  resolution.volume.maturity = level;
  const approved: boolean = atLeast(level, floor);
  resolution.report.check(
    item,
    approved,
    approved
      ? `maturity ${level} is at least ${floor}: the PRD is approved`
      : `maturity ${level} is below ${floor}: the PRD is not approved`,
  );
  return approved;
}

/** Step 7: the declared WP is a row of the work-package table of the PRD. */
function findWorkPackage(
  resolution: Resolution,
  item: string,
  prd: string,
  wp: string,
): WorkPackage | null {
  const table: Parsed<readonly WorkPackage[]> = parseWorkPackages(prd);
  if (!table.ok) {
    resolution.report.check(item, false, `work-package table unreadable (${table.reason})`);
    return null;
  }
  resolution.volume.workPackages = String(table.value.length);
  const row: WorkPackage | undefined = table.value.find((candidate) => candidate.id === wp);
  if (row === undefined) {
    const rows: string = table.value.map((candidate) => candidate.id).join(", ");
    resolution.report.check(
      item,
      false,
      `${wp} is not a row of the work-package table (rows: ${rows})`,
    );
    return null;
  }
  resolution.report.check(item, true, `${wp} is a row of the work-package table`);
  return row;
}

/**
 * Step 8: every criterion the work package cites is declared once, with a
 * `Validation :` clause. Every faulty citation is reported; the answer says
 * whether all of them held.
 */
function checkCitedCriteria(
  resolution: Resolution,
  item: string,
  requirements: string,
  workPackage: WorkPackage,
): boolean {
  const parsed: Parsed<readonly Criterion[]> = parseCriteria(requirements);
  if (!parsed.ok) {
    resolution.report.check(
      item,
      false,
      `${REQUIREMENTS_PATH} unreadable as criteria (${parsed.reason})`,
    );
    return false;
  }
  resolution.volume.criteria = String(parsed.value.length);
  resolution.volume.cited = String(workPackage.criteria.length);
  let allHold = true;
  for (const cited of workPackage.criteria) {
    const criterionItem: string = `${resolution.label} — ${workPackage.id} cites ${cited}`;
    const criterion: Criterion | undefined = parsed.value.find(
      (candidate) => candidate.id === cited,
    );
    if (criterion === undefined) {
      allHold = false;
      resolution.report.check(criterionItem, false, `${REQUIREMENTS_PATH} does not declare it`);
    } else if (!criterion.hasValidation) {
      allHold = false;
      resolution.report.check(criterionItem, false, "it has no `Validation :` clause");
    } else {
      resolution.report.check(
        criterionItem,
        true,
        `declared at line ${criterion.line} with a \`Validation :\` clause`,
      );
    }
  }
  return allHold;
}

/**
 * Step 9: the files of the pull request are all inside the scope of the work
 * package (norm, "Work-package table"). The scope is the `Périmètre` cell of
 * the PRD at the cited commit, never a text editable outside a pull request.
 *
 * Why in this order: the entries come from the PRD already read, so they are
 * validated before the diff is asked for (a refused scope makes the read
 * pointless); then the paths the port returns, which are not trusted; then
 * the containment itself. Any doubt is a violation, never a pass: an entry the
 * gate cannot match with certainty, an unreadable diff and an unreadable path
 * all refuse. An empty diff is the one verdict that asserts nothing, and it
 * says so with its reason instead of passing mute.
 *
 * Returns the validated paths of the diff when every one is inside the scope,
 * so the readiness step judges the very list judged here without asking the
 * port again; null on any refusal.
 */
async function checkScope(
  resolution: Resolution,
  workPackage: WorkPackage,
  ports: LinkPorts,
): Promise<readonly string[] | null> {
  const { report, label, volume, pr } = resolution;
  const { scope } = workPackage;
  const item: string = `${label} — ${workPackage.id} scope`;
  volume.scopeEntries = String(scope.length);

  const unsupported: number = scope.reduce((count: number, entry: string): number => {
    const problem: string | null = scopeEntryProblem(entry);
    if (problem === null) {
      return count;
    }
    report.check(item, false, `unsupported scope glob ${asciiQuoted(entry)}: ${problem}`);
    return count + 1;
  }, 0);
  if (unsupported > 0) {
    volume.scopeDecision = `${unsupported} unsupported scope glob(s)`;
    return null;
  }
  // Accepted, never silently: such an entry leaves the containment check with
  // almost nothing to refuse, and a reader of the verdict must see that.
  volume.unbounded = scope.filter((entry: string): boolean =>
    UNBOUNDED_SCOPE_ENTRIES.includes(entry),
  );
  if (volume.unbounded.length > 0) {
    report.check(
      item,
      true,
      `scope unbounded: the entries ${JSON.stringify(volume.unbounded)} are accepted and flagged, because they do not bound the files of the work package`,
    );
  }

  const changed: Fact<readonly string[]> = await ports.changedFiles(pr.baseSha, pr.headSha);
  if (!changed.ok) {
    report.check(
      `${label} — ${workPackage.id} changed files`,
      false,
      `changed files unreadable (${changed.reason})`,
    );
    volume.scopeDecision = "changed files unreadable";
    return null;
  }
  const paths: readonly string[] = changed.value;
  volume.filesExamined = String(paths.length);
  // A zero is a failure, not a pass: a diff with no file has nothing to attach
  // to the work package (gate-integrity section 2), like an empty commit range.
  if (paths.length === 0) {
    const reason =
      "the diff holds no changed file: a pull request that cites a work package changes at least one file";
    report.check(`${label} — ${workPackage.id} changed files`, false, reason);
    volume.scopeDecision = "the diff holds no changed file";
    return null;
  }

  const unreadable = unreadablePaths(paths);
  if (unreadable !== null) {
    volume.scopeDecision = unreadable.summary;
    report.check(item, false, unreadable.note);
    return null;
  }

  const outside: string[] = paths.filter(
    (path: string): boolean => !scope.some((entry: string) => matchesScope(entry, path)),
  );
  if (outside.length > 0) {
    volume.scopeDecision = `${outside.length} of ${paths.length} changed file(s) outside the scope`;
    report.check(
      item,
      false,
      `${volume.scopeDecision} ${JSON.stringify(scope)}: ${boundedList(outside.map(asciiQuoted))}`,
    );
    return null;
  }
  volume.scopeDecision = `all ${paths.length} changed file(s) inside the scope`;
  report.check(
    item,
    true,
    `all ${paths.length} changed file(s) are inside the scope ${JSON.stringify(scope)}`,
  );
  return paths;
}

// ---------------------------------------------------------------------------
// Readiness (norm, "Readiness"). Inside an approved PRD a work package is
// ready implicitly. An explicit `ready` is required when the diff touches a
// guarded path of I-17 (`GATED_PATH_PATTERNS`, the surface the review-evidence
// gate already guards) or when the work package is `one-way` in the
// `Porte anticipée` column of the PRD at the cited commit. The door is read
// from that versioned table, never from the pull request description: the
// description is Markdown and is not an input of this gate.
//
// The owner check is a consistency check, not an authentication: the agents
// share the owner's account (norm, "Limit of the control").
// ---------------------------------------------------------------------------

const READY_LABEL = "ready";

/** GitHub logins and label names compare ASCII case-insensitively, never Unicode case. */
const sameAsciiFolded = (left: string, right: string): boolean =>
  asciiLower(left) === asciiLower(right);

/** Why an explicit ready is required, or null when it is implicit. */
function explicitReadyReason(workPackage: WorkPackage, paths: readonly string[]): string | null {
  const reasons: string[] = [];
  const guarded: readonly string[] = touchesGatedPaths(paths);
  if (guarded.length > 0) {
    reasons.push(`guarded path(s) touched: ${boundedList(guarded.map(asciiQuoted))}`);
  }
  if (workPackage.door === "one-way") {
    reasons.push(`work package ${workPackage.id} is one-way`);
  }
  return reasons.length === 0 ? null : reasons.join(" and ");
}

/** A printable rendering of a value a careless port may hand over in place of a boolean. */
function shown(value: unknown): string {
  // JSON.stringify answers undefined for undefined, a function or a symbol.
  const json: string | undefined = JSON.stringify(value);
  return json === undefined
    ? typeof value
    : json.replace(
        /[^\x20-\x7E]/gu,
        (char: string): string => `\\u{${(char.codePointAt(0) as number).toString(16)}}`,
      );
}

/**
 * The refusals of an explicit ready, in a fixed order, every one reported:
 * one pull request shows all the defects of its issue at once, like the cited
 * criteria. An empty list means the ready holds.
 */
function readyRefusals(issue: IssueRead, owners: readonly string[], reason: string): string[] {
  const refusals: string[] = [];
  // The port is not trusted: labels that are not a list leave nothing the
  // other controls could be judged against, so the read itself is refused.
  const labels: unknown = issue.labels;
  if (!Array.isArray(labels)) {
    return [`inconsistent issue read: the labels are ${shown(labels)}, not a list of names`];
  }
  // A non-string label is no label.
  const labelled: boolean = labels.some(
    (name: unknown): boolean => typeof name === "string" && sameAsciiFolded(name, READY_LABEL),
  );
  const actor: unknown = issue.readyLabeledBy;
  if (!labelled) {
    refusals.push(
      `the issue carries no "ready" label: an explicit ready is required because ${reason}`,
    );
  }
  if (actor !== null && typeof actor !== "string") {
    refusals.push(
      `inconsistent issue read: the actor of the "ready" label is ${shown(actor)}, neither a login nor null`,
    );
  } else if (labelled !== (actor !== null)) {
    refusals.push(
      `inconsistent issue read: the "ready" label is ${labelled ? "present" : "absent"} but its actor is ${actor === null ? "null" : asciiQuoted(actor)}`,
    );
  }
  if (typeof actor === "string" && !owners.some((owner) => sameAsciiFolded(owner, actor))) {
    refusals.push(
      `the "ready" label was set by ${asciiQuoted(actor)}, who is not in owners ${JSON.stringify(owners)}: it does not count`,
    );
  }
  // Strictly `false`: a careless port answering undefined, null or "false"
  // must not read as "not edited since".
  const edited: unknown = issue.bodyEditedAfterReady;
  if (edited === true) {
    refusals.push(
      'the issue body was edited after the "ready" label: the ready is cancelled, set it again',
    );
  } else if (edited !== false) {
    refusals.push(
      `bodyEditedAfterReady is ${shown(edited)}, not the boolean false: the issue read cannot show the body unedited since the ready`,
    );
  }
  return refusals;
}

/** Step 10: an explicit ready of an owner where the norm requires one; otherwise ready is implicit. */
function checkReady(
  resolution: Resolution,
  workPackage: WorkPackage,
  issue: IssueRead,
  paths: readonly string[],
  owners: readonly string[],
): void {
  const reason: string | null = explicitReadyReason(workPackage, paths);
  if (reason === null) {
    // No check is added: nothing is asserted, and the volume says why.
    resolution.volume.ready = `implicit (no guarded path touched, work package ${workPackage.door})`;
    return;
  }
  const item: string = `${resolution.label} — ${workPackage.id} ready`;
  const refusals: string[] = readyRefusals(issue, owners, reason);
  for (const refusal of refusals) {
    resolution.report.check(item, false, refusal);
  }
  // No refusal implies a string actor (the consistency check refuses null with a label).
  const actor: string | null = issue.readyLabeledBy;
  if (refusals.length === 0 && actor !== null) {
    resolution.report.check(
      item,
      true,
      `explicit ready set by ${asciiQuoted(actor)} (an owner), the issue body not edited since; required because ${reason}`,
    );
  }
  resolution.volume.ready =
    `explicit required (${reason}), ` +
    (refusals.length === 0 ? "held" : `${refusals.length} check(s) failed`);
}

async function verifyChain(
  resolution: Resolution,
  link: LinkDeclaration,
  policy: WorkPackagePolicy,
  ports: LinkPorts,
): Promise<void> {
  // Before any port call: the issue of another owner is never read.
  const issueItem: string = `${resolution.label} — issue ${link.repo}#${link.issue}`;
  if (!checkSameOwner(resolution, issueItem, "issue", link.repo)) {
    return;
  }
  const issue: LinkedIssue | null = await readLinkedIssue(resolution, link, ports);
  if (issue === null) {
    return;
  }
  const { prdRef } = issue.fields;
  const item: string = `${resolution.label} — PRD ${prdRef.repo}@${prdRef.sha}`;
  // Before the ancestry: a PRD of another owner is never resolved.
  if (!checkSameOwner(resolution, item, "PRD-ref", prdRef.repo)) {
    return;
  }
  resolution.volume.prd = `${prdRef.repo}@${prdRef.sha}:${prdRef.path}`;
  if (!(await checkServed(resolution, item, prdRef, ports))) {
    return;
  }
  const prd: string | null = await readAtCitedCommit(resolution, item, prdRef, PRD_PATH, ports);
  if (prd === null) {
    return;
  }
  const requirements: string | null = await readAtCitedCommit(
    resolution,
    item,
    prdRef,
    REQUIREMENTS_PATH,
    ports,
  );
  if (requirements === null) {
    return;
  }
  if (!checkApproved(resolution, item, prd, policy.approvedFrom)) {
    return;
  }
  const workPackage: WorkPackage | null = findWorkPackage(resolution, item, prd, link.wp);
  if (workPackage === null) {
    return;
  }
  if (!checkCitedCriteria(resolution, item, requirements, workPackage)) {
    return;
  }
  // Ready is judged on the diff the scope check validated, never on a second
  // read of the port: a port answering differently twice cannot slip a guarded
  // path past this step.
  const paths: readonly string[] | null = await checkScope(resolution, workPackage, ports);
  if (paths === null) {
    return;
  }
  checkReady(resolution, workPackage, issue.read, paths, policy.owners);
}

/** Resolve a link and return the volume of what was read, for the summary line. */
async function resolveLink(
  report: GateReport,
  label: string,
  pr: PrFacts,
  link: LinkDeclaration,
  policy: WorkPackagePolicy,
  ports: LinkPorts,
): Promise<string> {
  const volume: ResolutionVolume = {
    issue: `${link.repo}#${link.issue} not read`,
    prd: "not resolved",
    maturity: "not read",
    workPackages: "not read",
    criteria: "not read",
    cited: "not read",
    scopeEntries: "not read",
    filesExamined: "not read",
    scopeDecision: "not reached",
    ready: "not reached",
    unbounded: [],
  };
  await verifyChain({ report, label, pr, volume }, link, policy, ports);
  return (
    `issue ${volume.issue}; PRD ${volume.prd}; maturity ${volume.maturity}; ` +
    `work packages parsed: ${volume.workPackages}; criteria parsed: ${volume.criteria}; ` +
    `criteria cited: ${volume.cited}; scope entries: ${volume.scopeEntries}; ` +
    `files examined: ${volume.filesExamined}; scope decision: ${volume.scopeDecision}; ` +
    `ready: ${volume.ready}` +
    (volume.unbounded.length === 0 ? "" : "; scope: unbounded")
  );
}

interface Outcome {
  readonly read: string;
  readonly filesExamined: number;
  /** What a declared exemption decided, or null on any other path. */
  readonly exemption: string | null;
  /** The volume of the resolution of a link, or null on any other path. */
  readonly resolution: string | null;
  /** True when an implicit exemption applied and was refused by the diff. */
  readonly implicitRefused: boolean;
}

/**
 * No declaration, and the author is the author of an exempt class: exempt,
 * and the verdict says it is implicit — provided the diff allows it.
 *
 * Why the diff is read: an exemption never covers a guarded path of I-17,
 * and a person can push to a bot's pull request (the author of the pull
 * request decides the class, not the author of each commit). The diff is read
 * once, every path validated, and an empty or unreadable diff is a violation,
 * as on every other path of the gate.
 */
async function judgeImplicitly(
  report: GateReport,
  label: string,
  cls: string,
  pr: PrFacts,
  ports: LinkPorts,
): Promise<Outcome> {
  const item: string = `${label} — declaration`;
  const refused = (filesExamined: number, note: string, decision: string): Outcome => {
    report.check(item, false, note);
    return {
      read: `none (implicit exemption ${cls} refused)`,
      filesExamined,
      exemption: decision,
      resolution: null,
      implicitRefused: true,
    };
  };
  const changed: Fact<readonly string[]> = await ports.changedFiles(pr.baseSha, pr.headSha);
  if (!changed.ok) {
    return refused(0, `changed files unreadable (${changed.reason})`, "changed files unreadable");
  }
  const paths: readonly string[] = changed.value;
  if (paths.length === 0) {
    return refused(
      0,
      "the diff holds no changed file: an implicit exemption covers a pull request that changes at least one file",
      "the diff holds no changed file",
    );
  }
  const unreadable: { readonly summary: string; readonly note: string } | null =
    unreadablePaths(paths);
  if (unreadable !== null) {
    return refused(paths.length, unreadable.note, unreadable.summary);
  }
  const guarded: GuardedRefusal | null = guardedPathRefusal(paths);
  if (guarded !== null) {
    return refused(paths.length, guarded.note, guarded.decision);
  }
  report.check(
    item,
    true,
    `exempt (implicit: ${cls}): no declaration trailer, and the author ${JSON.stringify(pr.author)} is the author of class ${JSON.stringify(cls)}`,
  );
  return {
    read: `exempt (implicit: ${cls})`,
    filesExamined: paths.length,
    exemption: "no guarded path touched",
    resolution: null,
    implicitRefused: false,
  };
}

/** Judge the declaration of a range that carries at least one declaration trailer, or none and no implicit exemption. */
async function judgeDeclaration(
  report: GateReport,
  label: string,
  declaration: Declaration,
  pr: PrFacts,
  policy: WorkPackagePolicy,
  ports: LinkPorts,
): Promise<Outcome> {
  if (declaration.kind === "invalid") {
    report.check(`${label} — declaration`, false, declaration.reason);
    return {
      read: "none (invalid)",
      filesExamined: 0,
      exemption: null,
      resolution: null,
      implicitRefused: false,
    };
  }
  if (declaration.kind === "exempt") {
    const judged: ExemptionVolume = await evaluateExemption(
      report,
      label,
      declaration.cls,
      pr,
      policy,
      ports,
    );
    return {
      read: `Exempt: ${declaration.cls}`,
      filesExamined: judged.filesExamined,
      exemption: judged.decision,
      resolution: null,
      implicitRefused: false,
    };
  }
  const read: string = `Work-package: ${declaration.repo}#${declaration.issue} ${declaration.wp}`;
  report.check(`${label} — declaration`, true, read);
  const resolution: string = await resolveLink(report, label, pr, declaration, policy, ports);
  return { read, filesExamined: 0, exemption: null, resolution, implicitRefused: false };
}

/**
 * Verdict over one pull request.
 *
 * The `link` path resolves the issue, the approved PRD at the cited commit,
 * the work package and its criteria, then requires every changed file to be
 * inside the scope of the work package, and last an explicit `ready` of an
 * owner when the diff touches a guarded path or the work package is one-way.
 */
export async function evaluateWorkPackageLink(
  pr: PrFacts,
  policy: WorkPackagePolicy,
  ports: LinkPorts,
): Promise<GateReport> {
  const report: GateReport = new GateReport();
  const label: string = pr.number === null ? "pull request" : `PR #${pr.number}`;
  const commits: Fact<readonly CommitDeclarations[]> = await ports.commitTrailers(
    pr.baseSha,
    pr.headSha,
  );
  if (!commits.ok) {
    report.check(`${label} — declaration`, false, `commit trailers unreadable (${commits.reason})`);
    return report.volume("0 commit(s) examined: the range could not be read");
  }
  // A pull request has at least one commit, so an empty list is a misread
  // range (an unreadable source turned into zero), for every author: read as
  // "no declaration" it would grant the implicit exemption to a bot.
  if (commits.value.length === 0) {
    report.check(
      `${label} — declaration`,
      false,
      "the range holds no commit: a pull request has at least one, so an empty list is a misread range",
    );
    return report.volume("0 commit(s) examined: the range holds no commit");
  }

  const pairs: Pairs = collectPairs(commits.value);
  const implicit: string | null =
    pairs.distinct.length === 0 ? implicitClassOf(policy, pr.author) : null;
  const outcome: Outcome =
    implicit === null
      ? await judgeDeclaration(report, label, declarationOf(pairs.distinct), pr, policy, ports)
      : await judgeImplicitly(report, label, implicit, pr, ports);

  return report.volume(
    `${commits.value.length} commit(s) examined; ${pairs.seen} declaration trailer pair(s) seen, ` +
      `${pairs.distinct.length} distinct; declaration read: ${outcome.read}; ` +
      `implicit exemption: ${implicit === null ? "no" : `yes (${implicit})${outcome.implicitRefused ? ", refused" : ""}`}; ` +
      `${outcome.filesExamined} file(s) examined for an exemption` +
      (outcome.exemption === null ? "" : `; exemption decision: ${outcome.exemption}`) +
      (outcome.resolution === null ? "" : `; resolution: ${outcome.resolution}`),
  );
}

// ---------------------------------------------------------------------------
// Entry point (event `pull_request`). Every input is read strictly: a field
// that is absent or mistyped is a named violation, never a default, because a
// default would let the gate judge a pull request other than the one it runs
// for.
// ---------------------------------------------------------------------------

const GATE_NAME = "Work package link";

/** The policy is trusted data of THIS repository, resolved from the module, never from the checkout. */
const POLICY_PATH: string = `${import.meta.dir}/../../ecosystem/work-package-policy.v1.yaml`;

type Environment = Readonly<Record<string, string | undefined>>;

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function shaField(pullRequest: Record<string, unknown>, side: "base" | "head"): Parsed<string> {
  const sha: unknown = recordOf(pullRequest[side])?.sha;
  return typeof sha === "string" && FULL_COMMIT.test(sha)
    ? { ok: true, value: sha }
    : failed(
        `pull_request.${side}.sha ${shown(sha)} is not a full commit of 40 lowercase hexadecimal characters`,
      );
}

/** Pure reading of the event payload and of `GITHUB_REPOSITORY`, without any I/O. */
export function readPullRequestFacts(payload: string, env: Environment): Parsed<PrFacts> {
  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch (error) {
    const message: string = error instanceof Error ? error.message : String(error);
    return failed(`event payload is not valid JSON (${message})`);
  }
  const pullRequest: Record<string, unknown> | null = recordOf(recordOf(event)?.pull_request);
  if (pullRequest === null) {
    return failed("event payload carries no pull_request object");
  }
  const number: unknown = pullRequest.number;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) {
    return failed(`pull_request.number ${shown(number)} is not a positive integer`);
  }
  const title: unknown = pullRequest.title;
  if (typeof title !== "string") {
    return failed(`pull_request.title ${shown(title)} is not a string`);
  }
  const login: unknown = recordOf(pullRequest.user)?.login;
  if (typeof login !== "string" || login === "") {
    return failed(`pull_request.user.login ${shown(login)} is not a non-empty string`);
  }
  const base: Parsed<string> = shaField(pullRequest, "base");
  if (!base.ok) {
    return base;
  }
  const head: Parsed<string> = shaField(pullRequest, "head");
  if (!head.ok) {
    return head;
  }
  const repo: string | undefined = env.GITHUB_REPOSITORY;
  if (repo === undefined || !REPOSITORY.test(repo)) {
    return failed(`GITHUB_REPOSITORY ${shown(repo)} is not <owner>/<repo>`);
  }
  return {
    ok: true,
    value: { repo, number, title, author: login, baseSha: base.value, headSha: head.value },
  };
}

const violation = (item: string, reason: string): GateReport =>
  new GateReport().check(item, false, reason);

/**
 * The run of the command. No `allowEmpty`: the gate is wired on
 * `pull_request` only, so a run on any other event is a misconfiguration and
 * fails, rather than a legitimate empty verdict.
 */
async function runFromEnvironment(env: Environment): Promise<GateReport> {
  const eventName: string | undefined = env.GITHUB_EVENT_NAME;
  if (eventName !== "pull_request") {
    const named: string =
      eventName === undefined ? "GITHUB_EVENT_NAME unset" : `GITHUB_EVENT_NAME=${shown(eventName)}`;
    return violation(
      "pull request event",
      `not a pull_request event (${named}): this gate reads the commits of a pull request and runs on no other event`,
    );
  }
  const eventPath: string | undefined = env.GITHUB_EVENT_PATH;
  if (eventPath === undefined || eventPath === "") {
    return violation("pull request event", "GITHUB_EVENT_PATH is unset on a pull_request run");
  }
  let payload: string;
  try {
    payload = await Bun.file(eventPath).text();
  } catch (error) {
    const message: string = error instanceof Error ? error.message : String(error);
    return violation("pull request event", `event payload unreadable at ${eventPath} (${message})`);
  }
  const facts: Parsed<PrFacts> = readPullRequestFacts(payload, env);
  if (!facts.ok) {
    return violation("pull request event", facts.reason);
  }
  const workspace: string | undefined = env.GITHUB_WORKSPACE;
  if (workspace === undefined || workspace === "") {
    return violation(
      "pull request checkout",
      "GITHUB_WORKSPACE is unset: the commits cannot be read",
    );
  }
  let policyText: string;
  try {
    policyText = await Bun.file(POLICY_PATH).text();
  } catch (error) {
    const message: string = error instanceof Error ? error.message : String(error);
    return violation("policy", `work-package policy unreadable at ${POLICY_PATH} (${message})`);
  }
  const policy: Parsed<WorkPackagePolicy> = loadWorkPackagePolicy(policyText);
  if (!policy.ok) {
    return violation("policy", `work-package policy unreadable: ${policy.reason}`);
  }
  const token: string | undefined = env.GITHUB_TOKEN;
  const ports: LinkPorts = realPorts({
    token: token === undefined || token === "" ? null : token,
    workspace,
    prRepo: facts.value.repo,
    env,
  });
  return evaluateWorkPackageLink(facts.value, policy.value, ports);
}

if (import.meta.main) {
  concludeGate(GATE_NAME, await runFromEnvironment(process.env));
}
