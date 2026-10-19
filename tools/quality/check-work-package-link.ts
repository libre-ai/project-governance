import { GateReport } from "./gate-report";
import type { ExemptRule, WorkPackagePolicy } from "./work-package-policy";

/**
 * Work-package link gate — every pull request names the work package it
 * delivers, or an exemption class whose predicate the gate verifies.
 *
 * Why: the chain PRD, criterion, work package, pull request is only an audit
 * trail if the last link is machine-readable. The grammar of the declaration
 * line and the rule "one declaration line in total" are fixed by
 * docs/specifications/WORK-PACKAGES.md (sections "Pull-request line" and
 * "What the gate reports"); this file is their reader, not their author.
 *
 * The description of a pull request is text written by the author. It is
 * read as data: never interpolated into a command, never evaluated. It is read
 * the way a CommonMark renderer shows it (own reader, not the stripper of the
 * Door gate): a keyword inside an HTML comment or a fenced block, or indented
 * into a code block, is not displayed as a declaration and never counts as one,
 * so a template's own guidance or a quoted example is ignored.
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

/** Every outside read of the gate, so that the verdict is testable without network or git. */
export interface LinkPorts {
  readIssue(repo: string, number: number): Promise<Fact<IssueRead>>;
  readFileAt(repo: string, sha: string, path: string): Promise<Fact<string>>;
  isAncestorOfServedHead(repo: string, sha: string): Promise<Fact<boolean>>;
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
  readonly body: string;
  readonly baseSha: string;
  readonly headSha: string;
}

export type Declaration =
  | { readonly kind: "link"; readonly repo: string; readonly issue: number; readonly wp: string }
  | { readonly kind: "exempt"; readonly cls: string }
  | { readonly kind: "invalid"; readonly reason: string };

// A declaration line starts with its keyword, case-sensitive, after 0 to 3
// spaces: 4 spaces or a tab make an indented code block in the rendering.
// Only the prefix is tested: the value is read strictly afterwards, so a line
// that starts like a declaration but is malformed is counted and refused,
// never silently skipped.
const DECLARATION_PREFIX: RegExp = /^ {0,3}(Work-package|Exempt):/;
// The same keyword with any indentation: what is left over after the prefix
// above is a declaration shown as code, reported to the author as a hint.
const INDENTED_KEYWORD: RegExp = /^[ \t]*(?:Work-package|Exempt):/;

// Fences (CommonMark): 0 to 3 spaces of indentation, then a run of 3 or more
// backticks (whose info string holds no backtick) or tildes. A closing fence
// has the same character, a run at least as long and nothing but spaces after
// it, so an info string on a closing line keeps the fence open.
const BACKTICK_FENCE_OPEN: RegExp = /^ {0,3}(`{3,})[^`]*$/;
const TILDE_FENCE_OPEN: RegExp = /^ {0,3}(~{3,})/;
const FENCE_CLOSE: RegExp = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

// `Work-package: <owner>/<repo>#<n> WP-<k>` (norm, "Pull-request line"):
// exactly one space after the colon and between the parts, nothing after.
// `<n>` and `<k>` are positive integers without a leading zero. The owner is
// a GitHub login; the repository is GitHub's repository charset, which is
// never `.` or `..` (the lookahead refuses both).
const WORK_PACKAGE_VALUE: RegExp =
  /^ ([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/((?!\.{1,2}#)[A-Za-z0-9._-]{1,100})#([1-9][0-9]*) (WP-[1-9][0-9]*)$/;

// `Exempt: <class>`: the same shape as the names of the policy's rules.
const EXEMPT_VALUE: RegExp = /^ ([a-z][a-z0-9-]*)$/;

const invalid = (reason: string): Declaration => ({ kind: "invalid", reason });

interface DeclarationCandidate {
  readonly line: string;
  readonly match: RegExpExecArray;
}

interface DeclarationRead {
  readonly declaration: Declaration;
  readonly lineCount: number;
  readonly overIndented: number;
}

function readWorkPackageValue(value: string): Declaration {
  const match: RegExpExecArray | null = WORK_PACKAGE_VALUE.exec(value);
  if (match === null) {
    return invalid(
      `malformed Work-package value ${JSON.stringify(value)} — expected ` +
        '" <owner>/<repo>#<n> WP-<k>" with single spaces, <n> and <k> positive without a leading zero',
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
      `malformed Exempt value ${JSON.stringify(value)} — expected " <class>" in lowercase letters, digits and hyphens`,
    );
  }
  return { kind: "exempt", cls: match[1] as string };
}

interface Fence {
  readonly char: string;
  readonly length: number;
}

/** An opening fence: 0-3 spaces, then 3+ backticks (no backtick in the info string) or 3+ tildes. */
function openingFence(line: string): Fence | null {
  const ticks: RegExpExecArray | null = BACKTICK_FENCE_OPEN.exec(line);
  if (ticks !== null) {
    return { char: "`", length: (ticks[1] as string).length };
  }
  const tildes: RegExpExecArray | null = TILDE_FENCE_OPEN.exec(line);
  return tildes === null ? null : { char: "~", length: (tildes[1] as string).length };
}

/** A closing fence: the same character, a run at least as long, and nothing after it but spaces. */
function closesFence(line: string, fence: Fence): boolean {
  const match: RegExpExecArray | null = FENCE_CLOSE.exec(line);
  const run: string = match === null ? "" : (match[1] as string);
  return run.startsWith(fence.char) && run.length >= fence.length;
}

/**
 * Whether a comment is still open at the end of `line`. `<!--` opens anywhere
 * on a line; the first `-->` after it closes, possibly lines later.
 */
function commentOpenAfter(line: string, startsInside: boolean): boolean {
  let inside: boolean = startsInside;
  let at: number = 0;
  for (;;) {
    if (inside) {
      const end: number = line.indexOf("-->", at);
      if (end < 0) {
        return true;
      }
      at = end + 3;
      inside = false;
    } else {
      const start: number = line.indexOf("<!--", at);
      if (start < 0) {
        return false;
      }
      at = start + 4;
      inside = true;
    }
  }
}

interface DeclarationLines {
  readonly candidates: readonly DeclarationCandidate[];
  /** Keyword lines indented into a code block: shown as code, never declarations. */
  readonly overIndented: number;
}

/**
 * Find the lines that render as declaration lines.
 *
 * The decision is taken on the ORIGINAL line, not on a copy with comments
 * blanked out: a keyword that follows the end of a comment on the same line
 * does not start the line. Fences and comments are tracked only to know which
 * lines are inside one. Not modelled: containers (list items, block quotes)
 * and HTML blocks other than comments; a keyword there is not at the start of
 * its line, or is read strictly and refused.
 */
function findDeclarationLines(body: string): DeclarationLines {
  // CR and CRLF are line ends for a renderer. Split on LF only afterwards: a
  // regex with the `m` flag would also break at U+2028 / U+2029, which a
  // reader of the rendered description does not see as a line end.
  const text: string = body.replace(/\r\n?/g, "\n");
  const candidates: DeclarationCandidate[] = [];
  let overIndented: number = 0;
  let fence: Fence | null = null;
  let inComment: boolean = false;
  for (const line of text.split("\n")) {
    if (fence !== null) {
      if (closesFence(line, fence)) {
        fence = null;
      }
      continue;
    }
    if (inComment) {
      inComment = commentOpenAfter(line, true);
      continue;
    }
    fence = openingFence(line);
    if (fence !== null) {
      continue;
    }
    const match: RegExpExecArray | null = DECLARATION_PREFIX.exec(line);
    if (match !== null) {
      candidates.push({ line, match });
    } else if (INDENTED_KEYWORD.test(line)) {
      overIndented += 1;
    }
    inComment = commentOpenAfter(line, false);
  }
  return { candidates, overIndented };
}

const ZERO_LINES: string =
  "0 declaration line(s): expected one `Work-package:` or `Exempt:` line outside comments and code blocks";
const OVER_INDENTED_HINT: string =
  "a declaration indented by 4+ spaces or a tab is a code block, not a declaration";

function readDeclaration(body: string): DeclarationRead {
  const { candidates, overIndented }: DeclarationLines = findDeclarationLines(body);
  const lineCount: number = candidates.length;
  const only: DeclarationCandidate | undefined = candidates[0];
  if (lineCount === 0) {
    return {
      lineCount,
      overIndented,
      declaration: invalid(
        overIndented === 0 ? ZERO_LINES : `${ZERO_LINES} (${OVER_INDENTED_HINT})`,
      ),
    };
  }
  if (lineCount > 1 || only === undefined) {
    return {
      lineCount,
      overIndented,
      declaration: invalid(
        `${lineCount} declaration line(s): exactly one \`Work-package:\` or \`Exempt:\` line is allowed in total`,
      ),
    };
  }
  const value: string = only.line.slice(only.match[0].length);
  return {
    lineCount,
    overIndented,
    declaration:
      only.match[1] === "Work-package" ? readWorkPackageValue(value) : readExemptValue(value),
  };
}

/** Pure reading of the declaration of one pull request description. */
export function readLinkDeclaration(body: string): Declaration {
  return readDeclaration(body).declaration;
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
  const { declaration, lineCount, overIndented }: DeclarationRead = readDeclaration(pr.body);
  let filesExamined: number = 0;
  // null = no valid declaration was read (the volume line says so).
  let read: string | null = null;

  if (declaration.kind === "invalid") {
    report.check(`${label} — declaration`, false, declaration.reason);
  } else if (declaration.kind === "exempt") {
    read = `Exempt: ${declaration.cls}`;
    filesExamined = await evaluateExemption(report, label, declaration.cls, pr, policy, ports);
  } else {
    read = `Work-package: ${declaration.repo}#${declaration.issue} ${declaration.wp}`;
    report.check(`${label} — declaration`, true, read);
  }

  report.volume(
    `${lineCount} declaration line(s) seen (${overIndented} over-indented keyword line(s) ignored); declaration read: ${read ?? "none (invalid)"}; ` +
      `${filesExamined} file(s) examined for an exemption`,
  );
  return report;
}
