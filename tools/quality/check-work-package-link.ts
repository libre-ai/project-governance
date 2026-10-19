import { GateReport } from "./gate-report";
import type { ExemptRule, WorkPackagePolicy } from "./work-package-policy";

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
 * This file holds the reader of the declaration, the verifier of exemptions
 * and the skeleton of the verdict. Reading the issue, resolving the PRD,
 * comparing the scope and checking `ready` are added to
 * `evaluateWorkPackageLink` by the following tasks; until then a well-formed
 * link passes without any further control.
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
const WORK_PACKAGE_VALUE: RegExp =
  /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/((?!\.{1,2}#)[A-Za-z0-9._-]{1,100})#([1-9][0-9]*) (WP-[1-9][0-9]{0,8})$/;

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

function holdsPaths(
  globs: readonly string[],
  changed: readonly string[],
): { ok: boolean; note: string } {
  if (changed.length === 0) {
    return { ok: false, note: "no changed file: an empty diff is not a documentation-only change" };
  }
  const matchers: Bun.Glob[] = globs.map((pattern) => new Bun.Glob(pattern));
  const outside: string[] = changed.filter(
    (path) => !matchers.some((matcher) => matcher.match(path)),
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

interface Outcome {
  readonly read: string;
  readonly filesExamined: number;
}

/** No declaration, and the author is the author of an exempt class: exempt, and the verdict says it is implicit. */
function passImplicitly(report: GateReport, label: string, cls: string, pr: PrFacts): Outcome {
  report.check(
    `${label} — declaration`,
    true,
    `exempt (implicit: ${cls}): no declaration trailer, and the author ${JSON.stringify(pr.author)} is the author of class ${JSON.stringify(cls)}`,
  );
  return { read: `exempt (implicit: ${cls})`, filesExamined: 0 };
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
    return { read: "none (invalid)", filesExamined: 0 };
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
    return { read: `Exempt: ${declaration.cls}`, filesExamined };
  }
  const read = `Work-package: ${declaration.repo}#${declaration.issue} ${declaration.wp}`;
  report.check(`${label} — declaration`, true, read);
  return { read, filesExamined: 0 };
}

/**
 * Verdict over one pull request.
 *
 * Skeleton: the `link` path only proves that the declaration is well formed.
 * The reads of the issue, of the PRD, of the scope and of `ready` come with
 * the following tasks.
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
      `${outcome.filesExamined} file(s) examined for an exemption`,
  );
}
