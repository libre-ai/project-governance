import { GateReport } from "./gate-report";
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
import type { ExemptRule, WorkPackagePolicy } from "./work-package-policy";
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
 * work package, cited criteria) and the containment of the diff in the scope
 * of the work package. Checking `ready` is added to `evaluateWorkPackageLink`
 * by a following task.
 */

/** A value read through a port: either the value, or the reason it could not be read. */
export type Fact<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

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
   * `ok: false`, never an empty list.
   */
  commitTrailers(baseSha: string, headSha: string): Promise<Fact<readonly CommitDeclarations[]>>;
  /**
   * Contract for the real implementation (Task 12): list BOTH sides of every
   * rename, i.e. `git diff --name-only --no-renames -z base...head`, so a file
   * moved into a documentation path is still seen at its source path. Paths
   * are returned exactly as git prints them: never quoted, never normalised.
   * An implementation, and any caller trusting one, must reject a path that
   * contains a `..` segment, starts with `./`, or starts with `/`, as an
   * unreadable source rather than match it against a glob.
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
    const named: string = distinct.map((p) => `${p.key}: ${JSON.stringify(p.value)}`).join(", ");
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
// and is pinned by the tests (`**` crosses `/` and matches dotfiles, `*` does
// not cross `/`, `{a,b}` alternates, matching is case-sensitive, and a
// directory itself is not matched by `dir/**`).
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
 * `(..)` and spaces are outside the grammar; so are an absolute entry and a
 * `..` segment, in any branch of an alternation.
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
  return bracesBalanced(entry) ? null : "its braces are unbalanced";
}

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
        note: `${outside.length} of ${changed.length} changed file(s) outside ${JSON.stringify(globs)}: ${outside.join(", ")}`,
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

async function evaluateExemption(
  report: GateReport,
  label: string,
  cls: string,
  pr: PrFacts,
  policy: WorkPackagePolicy,
  ports: LinkPorts,
): Promise<number> {
  const changed: Fact<readonly string[]> = await ports.changedFiles(pr.baseSha, pr.headSha);
  if (!changed.ok) {
    report.check(
      `${label} — Exempt: ${cls}`,
      false,
      `changed files unreadable (${changed.reason})`,
    );
    return 0;
  }
  const verdict: { readonly ok: boolean; readonly note: string } = exemptionHolds(
    cls,
    ruleOf(policy, cls),
    pr,
    changed.value,
  );
  report.check(`${label} — Exempt: ${cls}`, verdict.ok, verdict.note);
  return changed.value.length;
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
}

interface Resolution {
  readonly report: GateReport;
  readonly label: string;
  /** The pull request: its repository's owner is the one every link must stay within. */
  readonly pr: PrFacts;
  readonly volume: ResolutionVolume;
}

/** Steps 1 to 3: the issue is readable, its body is the form, and it projects the declared WP. */
async function readLinkedIssue(
  resolution: Resolution,
  link: LinkDeclaration,
  ports: LinkPorts,
): Promise<IssueFields | null> {
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
  return fields.value;
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
  const level: MaturityLevel | null = readDocumentMaturity(prd);
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

// At most this many paths are spelled out in one message; the rest is counted.
const NAMED_LIMIT = 20;

function boundedList(items: readonly string[]): string {
  const shown: string = items.slice(0, NAMED_LIMIT).join(", ");
  const rest: number = items.length - NAMED_LIMIT;
  return rest > 0 ? `${shown}, and ${rest} more` : shown;
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
 */
async function checkScope(
  resolution: Resolution,
  workPackage: WorkPackage,
  ports: LinkPorts,
): Promise<void> {
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
    return;
  }

  const changed: Fact<readonly string[]> = await ports.changedFiles(pr.baseSha, pr.headSha);
  if (!changed.ok) {
    report.check(
      `${label} — ${workPackage.id} changed files`,
      false,
      `changed files unreadable (${changed.reason})`,
    );
    volume.scopeDecision = "changed files unreadable";
    return;
  }
  const paths: readonly string[] = changed.value;
  volume.filesExamined = String(paths.length);
  if (paths.length === 0) {
    const reason = `the diff of the pull request is empty: there is no changed file to compare with the scope of ${workPackage.id}`;
    report.check(item, true, reason);
    report.allowEmpty(reason);
    volume.scopeDecision = "empty diff";
    return;
  }

  const unreadable: string[] = [];
  for (const path of paths) {
    const problem: string | null = changedPathProblem(path);
    if (problem !== null) {
      unreadable.push(`${asciiQuoted(path)} (${problem})`);
    }
  }
  if (unreadable.length > 0) {
    volume.scopeDecision = `${unreadable.length} of ${paths.length} changed file path(s) unreadable`;
    report.check(item, false, `${volume.scopeDecision}: ${boundedList(unreadable)}`);
    return;
  }

  const outside: string[] = paths.filter(
    (path: string): boolean => !scope.some((entry: string) => matchesScope(entry, path)),
  );
  if (outside.length > 0) {
    volume.scopeDecision = `${outside.length} of ${paths.length} changed file(s) outside the scope`;
    report.check(
      item,
      false,
      `${volume.scopeDecision} ${JSON.stringify(scope)}: ${boundedList(outside.map((path: string): string => JSON.stringify(path)))}`,
    );
    return;
  }
  volume.scopeDecision = `all ${paths.length} changed file(s) inside the scope`;
  report.check(
    item,
    true,
    `all ${paths.length} changed file(s) are inside the scope ${JSON.stringify(scope)}`,
  );
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
  const fields: IssueFields | null = await readLinkedIssue(resolution, link, ports);
  if (fields === null) {
    return;
  }
  const { prdRef } = fields;
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
  await checkScope(resolution, workPackage, ports);
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
  };
  await verifyChain({ report, label, pr, volume }, link, policy, ports);
  return (
    `issue ${volume.issue}; PRD ${volume.prd}; maturity ${volume.maturity}; ` +
    `work packages parsed: ${volume.workPackages}; criteria parsed: ${volume.criteria}; ` +
    `criteria cited: ${volume.cited}; scope entries: ${volume.scopeEntries}; ` +
    `files examined: ${volume.filesExamined}; scope decision: ${volume.scopeDecision}`
  );
}

interface Outcome {
  readonly read: string;
  readonly filesExamined: number;
  /** The volume of the resolution of a link, or null on any other path. */
  readonly resolution: string | null;
}

/** No declaration, and the author is the author of an exempt class: exempt, and the verdict says it is implicit. */
function passImplicitly(report: GateReport, label: string, cls: string, pr: PrFacts): Outcome {
  report.check(
    `${label} — declaration`,
    true,
    `exempt (implicit: ${cls}): no declaration trailer, and the author ${JSON.stringify(pr.author)} is the author of class ${JSON.stringify(cls)}`,
  );
  return { read: `exempt (implicit: ${cls})`, filesExamined: 0, resolution: null };
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
    return { read: "none (invalid)", filesExamined: 0, resolution: null };
  }
  if (declaration.kind === "exempt") {
    const filesExamined: number = await evaluateExemption(
      report,
      label,
      declaration.cls,
      pr,
      policy,
      ports,
    );
    return { read: `Exempt: ${declaration.cls}`, filesExamined, resolution: null };
  }
  const read: string = `Work-package: ${declaration.repo}#${declaration.issue} ${declaration.wp}`;
  report.check(`${label} — declaration`, true, read);
  const resolution: string = await resolveLink(report, label, pr, declaration, policy, ports);
  return { read, filesExamined: 0, resolution };
}

/**
 * Verdict over one pull request.
 *
 * The `link` path resolves the issue, the approved PRD at the cited commit,
 * the work package and its criteria, then requires every changed file to be
 * inside the scope of the work package. The explicit `ready` comes with a
 * following task.
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
      : passImplicitly(report, label, implicit, pr);

  return report.volume(
    `${commits.value.length} commit(s) examined; ${pairs.seen} declaration trailer pair(s) seen, ` +
      `${pairs.distinct.length} distinct; declaration read: ${outcome.read}; ` +
      `implicit exemption: ${implicit === null ? "no" : `yes (${implicit})`}; ` +
      `${outcome.filesExamined} file(s) examined for an exemption` +
      (outcome.resolution === null ? "" : `; resolution: ${outcome.resolution}`),
  );
}
