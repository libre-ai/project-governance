/**
 * A pinned code citation names a commit, a path and lines that exist.
 *
 * WHY. The decision records of this repository argue from code held in other
 * repositories, and they cite it pinned: `libre-ai/<repository>@<sha>:<path>`,
 * optionally followed by `:<lines>`. Until 2026-10-22 nothing read a single one
 * of those citations back. A sha typed from memory, a path renamed before the
 * pin was taken, a line range shifted by one commit, or a repository among the
 * thirty-six the fleet deleted on 2026-09-16: each reads exactly like a valid
 * citation, and an argument resting on it rests on nothing a reader can reach.
 * The ADRs also carry bare `path:line` citations. Measured the same day: 43
 * distinct ones in `docs/adr`, of which 25 do not resolve in this repository —
 * they name files of other repositories without saying which, nor at which
 * commit, so no instrument can ever check them.
 *
 * WHAT IT ASSERTS, for every pinned citation in a tracked file of the declared
 * scope (`pinned-citations.v1.json`):
 *   1. the repository answers over the git protocol (`git ls-remote`), never
 *      through the REST API, whose shared quota turns a refusal to answer into
 *      a red that means nothing (the orphan-rev gate already paid for that);
 *   2. the sha resolves to one commit of a blobless bare clone
 *      (`rev-parse <sha>^{commit}`); a short sha matching two commits is
 *      AMBIGUOUS, a verdict of its own, because the citation names neither;
 *   3. the path exists at that commit (`rev-parse <commit>:<path>`, which reads
 *      trees only, then `cat-file -e` on the object);
 *   4. every cited line (`L`, `a-b`, `a,b`, or a comma list of those) lies in
 *      the blob.
 * And, for the bare `path:line` citations of an ADR numbered ABOVE the
 * threshold recorded in data: the path is tracked here and the lines lie in
 * it. Otherwise the citation must be pinned. ADRs at or below the threshold
 * are not rewritten; their bare citations are counted and printed as
 * information, never as a pass. The same forward rule refuses an UNQUALIFIED
 * pin (`<repository>@<sha>:<path>`, `docs/X.md@<sha>:<line>`) in a guarded ADR:
 * it names no repository to ask. Elsewhere such pins are counted, not judged:
 * eleven on 2026-10-22, ten of them in ADRs 0028, 0045, 0048 and 0049.
 *
 * LOCAL PINS (`<sha>:<path>[:<lines>]`, the repository left implicit) of a
 * guarded ADR are asked of THIS repository, through the same resolver and the
 * same path-and-lines grammar as a pinned citation (owner arbitration
 * 2026-10-23), with one more condition: the commit must be on the served branch
 * of the remote, since this repository merges by squash and a commit of a work
 * branch disappears with it. The name of this repository is derived from its
 * `origin` remote, never written in data; a name that cannot be derived fails
 * every local pin. They are read closed by default (`LOCAL_CANDIDATE`): any
 * segment holding seven hexadecimal digits then `:` must be a local pin in
 * full, a pin of another owner (counted, never asked), or it is refused by
 * name. In ADRs at or below the threshold they are counted, not judged. They
 * are read in ADRs only, like bare citations, whatever the extension.
 *
 * ACTION REFERENCES of the organisation (`libre-ai/<repository>/<path>@<sha>`, a
 * reusable workflow or a composite action) name a repository, a commit and a
 * path: they are resolved as `libre-ai/<repository>@<sha>:<path>`, so one that
 * points at a live repository is verified like any citation. One of another
 * owner (`actions/checkout@<sha>`) does not hold `libre-ai/` and is not read.
 *
 * Verdicts are named and distinct, and every one of them but `resolved` fails:
 * repository-not-found, repository-unreachable, sha-not-found, sha-ambiguous
 * (two commits, or a branch or tag named like the cited hex),
 * sha-not-on-served-branch (local pins), path-absent, line-range-outside-file,
 * invalid-citation, exemption-now-resolves.
 * An unreachable repository is not a missing one — the first is about the
 * network, the second about the citation — and neither is ever a zero.
 *
 * CLOSED BY DEFAULT. A candidate is any whitespace-free segment holding
 * `libre-ai/` with an `@` after it — no delimiter list, no lookbehind. Two
 * earlier forms of this gate had both, and each character in them was a way to
 * cut a citation short (`@<sha>*docs/x`, `:a.json(9999)` came out `resolved` on
 * the prefix) or to hide one (`_libre-ai/…_`, `see.libre-ai/…` were seen by
 * nothing). Only named wrappings are removed — final `.,;:!?`, backticks, an
 * enclosing pair of `**` `__` `*` `_` `()` `[]` `""`, a closing parenthesis the
 * segment does not open — and what remains must match the grammar IN FULL, or
 * it is an `invalid-citation` with its reason: after the sha only `:` or the
 * end; no ref that is not a sha (`@v2`, `@main`); no character in a path that a
 * path is never written with (`*{}[]|()<>'"\`#^~?`); nothing written against
 * the organisation (`@libre-ai/ui@1.0.0`, `https://github.com/libre-ai/…`); no
 * citation ending in `:` (`@<sha>: package.json:9999` would otherwise resolve
 * the commit alone, its path being in the next segment).
 *
 * RECONCILIATION. `listCandidateSegments` walks the text character by character
 * with no regular expression, no wrapping removal and its own copy of the
 * candidate test. It shares the definitions, not the code: whitespace (the code
 * points `\s` names, listed) and the organisation. The gate requires the walk
 * and the parser to agree on the number of candidate segments, on their
 * concatenated text, and on the number of verdicts given. resolved + exempted +
 * failed sums to itself by construction; these three do not. A parser that
 * splits a segment on any extra character changes the text, a candidate test
 * that admits or misses a segment changes the number. What stays open by
 * construction: a mistake made identically in both definitions (a whitespace
 * set, an organisation string) is invisible to a comparison between them.
 *
 * OUT OF DECLARED SCOPE — read by nothing, by design: a citation split by a
 * zero-width space (U+200B is not whitespace, so it stays inside one segment
 * the grammar then refuses — but `libre` U+200B `-ai/` is no candidate at all);
 * another case (`Libre-AI/`) or a homoglyph of the organisation; a GitHub
 * permalink (`github.com/libre-ai/x/blob/<sha>/…`, no `@`); a markdown link
 * `[libre-ai/…@…](x)`, which is a candidate and is refused, never resolved.
 *
 * A citation of a deleted repository, a deliberately fictitious example, or an
 * action pin recorded as evidence fails unless it is listed in the data file,
 * for the file it is written in, with a written reason. An exemption that
 * matches no citation of its file fails, and so does one whose citation
 * resolves again: both are permissions nobody checks.
 *
 * WHAT IT DOES NOT ASSERT: that the cited code still says what the prose says
 * it says — a pin is exactly the means of not having to, and the relevance of a
 * citation stays a review matter. A private repository is indistinguishable
 * from a deleted one: no credential is ever offered, on purpose.
 *
 * HARDENING. The text this gate reads is written by anyone who can open a pull
 * request, and it becomes git arguments. So: git runs in an empty environment
 * (`GIT_CONFIG_NOSYSTEM`, no global configuration, no credential helper, no
 * terminal prompt, `GIT_ALLOW_PROTOCOL=https`, hooks pointed at nothing); every
 * value is passed as a separate argument, never through a shell; the sha is
 * hex by construction; the path is refused if absolute, if it carries a `.` or
 * `..` segment (`<rev>:./x` is resolved against the working directory), a
 * backslash, a colon, a control character or one of the characters above, so
 * no revision expression (`^`, `~`, `{…}`) reaches git. The repository URL is built from
 * the organisation in data and a name restricted to `[A-Za-z0-9._-]`. At most
 * four git processes run at once, whatever a document cites.
 *
 * It reads other repositories, so it runs in its own workflow
 * (`pinned-citations.yml`), not in `bun run check`: a required check of the
 * served branch since the owner arbitration of 2026-10-23, kept apart from
 * `inventory-drift.yml`, whose fleet gates are knowingly red.
 */

import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { GateReport } from "./gate-report";

// ---------------------------------------------------------------- config ---

export interface Reasoned {
  readonly because: string;
}

export interface CitationExemption extends Reasoned {
  /** The tracked file the citation is written in: an exemption covers that file only. */
  readonly file: string;
  /** The citation exactly as written, its wrappings excluded. */
  readonly citation: string;
}

/** The key an exemption is matched on: the same text in another file is not exempt. */
export function exemptionKey(file: string, citation: string): string {
  return `${file}\u0000${citation}`;
}

export interface UnnumberedAdr extends Reasoned {
  readonly path: string;
}

export interface AdrRule {
  readonly directory: string;
  /** ADRs numbered strictly above this must resolve their bare citations. */
  readonly bareCitationsGuardedAbove: number;
  /** ADR files without a number, treated as at-or-below the threshold. */
  readonly unnumbered: readonly UnnumberedAdr[];
  /** Extensions a bare `path:line` citation is recognised by. */
  readonly extensions: readonly string[];
}

export interface PinnedCitationsConfig {
  readonly organization: string;
  readonly scope: readonly string[];
  readonly adr: AdrRule;
  readonly exemptions: readonly CitationExemption[];
}

export const CONFIG_PATH: string = "tools/quality/pinned-citations.v1.json";

function fail(message: string): never {
  throw new Error(`pinned-citations.v1.json: ${message}`);
}

function isReasoned(value: unknown): value is Reasoned {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { because?: unknown }).because === "string" &&
    (value as { because: string }).because.trim().length > 0
  );
}

export function validateConfig(value: unknown): PinnedCitationsConfig {
  if (typeof value !== "object" || value === null) fail("expected an object");
  const candidate = value as Record<string, unknown>;
  const organization = candidate.organization;
  if (typeof organization !== "string" || !/^[A-Za-z0-9-]+$/.test(organization)) {
    fail("organization must be a GitHub organisation name");
  }
  const scope = candidate.scope;
  if (
    !Array.isArray(scope) ||
    scope.length === 0 ||
    !scope.every((entry) => typeof entry === "string" && entry.endsWith("/"))
  ) {
    fail("scope must list at least one directory prefix ending in '/'");
  }
  const adr = candidate.adr as Record<string, unknown> | undefined;
  if (typeof adr !== "object" || adr === null) fail("adr rule missing");
  if (typeof adr.directory !== "string" || !adr.directory.endsWith("/")) {
    fail("adr.directory must end in '/'");
  }
  if (
    !Number.isInteger(adr.bareCitationsGuardedAbove) ||
    (adr.bareCitationsGuardedAbove as number) < 0
  ) {
    fail("adr.bareCitationsGuardedAbove must be a non-negative integer");
  }
  if (
    !Array.isArray(adr.unnumbered) ||
    !adr.unnumbered.every(
      (entry) => isReasoned(entry) && typeof (entry as { path?: unknown }).path === "string",
    )
  ) {
    fail("adr.unnumbered entries need a path and a non-empty because");
  }
  if (
    !Array.isArray(adr.extensions) ||
    adr.extensions.length === 0 ||
    !adr.extensions.every((entry) => typeof entry === "string" && /^[a-z0-9]+$/.test(entry))
  ) {
    fail("adr.extensions must list lowercase extensions without a dot");
  }
  const exemptions = candidate.exemptions;
  if (
    !Array.isArray(exemptions) ||
    !exemptions.every(
      (entry) =>
        isReasoned(entry) &&
        typeof (entry as { citation?: unknown }).citation === "string" &&
        typeof (entry as { file?: unknown }).file === "string",
    )
  ) {
    fail("every exemption needs a file, a citation and a non-empty because");
  }
  const seen = new Set<string>();
  for (const entry of exemptions as CitationExemption[]) {
    const key = exemptionKey(entry.file, entry.citation);
    if (seen.has(key)) fail(`duplicate exemption ${entry.file}: ${entry.citation}`);
    seen.add(key);
  }
  return value as PinnedCitationsConfig;
}

// ---------------------------------------------------------------- parsing ---

export interface LineSpan {
  readonly start: number;
  readonly end: number;
}

export interface PinnedCitation {
  /** As written, trailing punctuation excluded: the key an exemption matches. */
  readonly text: string;
  readonly repository: string;
  readonly sha: string;
  readonly path: string | null;
  readonly lines: readonly LineSpan[] | null;
  /** 1-based line of the host file. */
  readonly line: number;
}

export interface RejectedCitation {
  readonly text: string;
  readonly line: number;
  readonly reason: string;
}

export interface BareCitation {
  readonly text: string;
  readonly path: string;
  /** Null when the line suffix is malformed (`:0`, `:9-3`). */
  readonly lines: readonly LineSpan[] | null;
  readonly line: number;
}

/** `<name>@<sha>[:…]` without the organisation: a pin no instrument can address. */
export interface UnqualifiedPin {
  readonly text: string;
  readonly line: number;
}

/** `<sha>:<path>[:<lines>]`: a commit of this repository, the repository left implicit. */
export interface LocalPin {
  readonly text: string;
  readonly sha: string;
  readonly path: string;
  /** Null when no line is cited. */
  readonly lines: readonly LineSpan[] | null;
  readonly line: number;
}

/** `<owner>/<repository>@<sha>[:…]` of another owner: counted, never asked. */
export interface ForeignPin {
  readonly text: string;
  readonly line: number;
}

export interface ScannedText {
  readonly pinned: readonly PinnedCitation[];
  readonly rejected: readonly RejectedCitation[];
  readonly bare: readonly BareCitation[];
  readonly unqualified: readonly UnqualifiedPin[];
  /** Read in ADRs only, like bare citations. */
  readonly local: readonly LocalPin[];
  /** Local-pin candidates that are not a local pin in full, with the reason. */
  readonly localRejected: readonly RejectedCitation[];
  readonly foreign: readonly ForeignPin[];
  /** The raw candidate segments the parser judged, in order: reconciled against the independent walk. */
  readonly candidates: readonly string[];
}

const LINE_SPEC: RegExp = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;
const SHA: RegExp = /^[0-9a-f]{7,40}$/;
const HEX_LIKE: RegExp = /^[0-9a-fA-F]+$/;
const REPOSITORY_NAME: RegExp = /^[A-Za-z0-9._-]+$/;
const TRAILING_PUNCTUATION: RegExp = /[.,;:!?]+$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point.
const CONTROL_CHARACTER: RegExp = /[\u0000-\u001f\u007f]/;
/**
 * Markdown and git-revision characters. Inside a segment they used to END the
 * citation silently (`@<sha>*docs/x.md`, `:package.json(9999)` came out
 * `resolved` on the prefix); now they are part of it, so a path carrying one is
 * refused by name instead.
 */
const FORBIDDEN_PATH_CHARACTER: RegExp = /[*{}[\]|()<>'"`#^~?]/;

/** `L`, `a-b`, `a,b` and comma lists of those; null when malformed. Lines are 1-based. */
export function parseLineSpec(spec: string): LineSpan[] | null {
  if (!LINE_SPEC.test(spec)) return null;
  const spans: LineSpan[] = [];
  for (const item of spec.split(",")) {
    const [startText, endText] = item.split("-");
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    if (start < 1 || end < start) return null;
    spans.push({ start, end });
  }
  return spans;
}

/** Null when the path may be handed to git as `<commit>:<path>`, else why not. */
export function validateCitedPath(path: string): string | null {
  if (path.length === 0) return "the path is empty";
  if (CONTROL_CHARACTER.test(path)) return "the path carries a control character";
  if (path.startsWith("/")) return "the path is absolute";
  if (path.includes("\\")) return "the path carries a backslash";
  const forbidden = FORBIDDEN_PATH_CHARACTER.exec(path);
  if (forbidden !== null) {
    return `the path carries '${forbidden[0]}', a markdown or revision character no cited path is written with`;
  }
  if (path.includes(":")) return "the path carries a colon, ambiguous with a line suffix";
  for (const segment of path.split("/")) {
    if (segment === "..") return "the path climbs out of the tree with '..'";
    if (segment === ".")
      return "the path carries a '.' segment, resolved against the working directory by git";
    if (segment === "") return "the path carries an empty segment";
  }
  return null;
}

/**
 * A candidate is a whitespace-free segment holding `<org>/` with an `@` after
 * it. There is no delimiter list and no lookbehind: the two earlier forms of
 * this gate had both, and every character in the list (`*`, `(`, `<`, `'`, `|`…)
 * or in the lookbehind (`_`, `.`) became a way to cut a citation short or to
 * hide it. The segment is judged whole, once its named wrappings are removed.
 */
const SEGMENT: RegExp = /\S+/g;

/** Wrappings a citation may be written in, removed only when they enclose it. */
const PAIRED_WRAPPINGS: readonly (readonly [string, string])[] = [
  ["**", "**"],
  ["__", "__"],
  ["*", "*"],
  ["_", "_"],
  ["(", ")"],
  ["[", "]"],
  // JSON and YAML carry citations as strings: the review evidence does.
  ['"', '"'],
];

/**
 * Final punctuation a citation may be followed by. `:` is not in it: written
 * `@<sha>: package.json:9999`, the path sits in the next segment and the
 * citation would silently become a commit-only one. A citation ending in `:` is
 * refused instead.
 */
const FINAL_PUNCTUATION: RegExp = /[.,;!?]+$/;

function occurrences(text: string, character: string): number {
  return text.split(character).length - 1;
}

/**
 * Removes the named wrappings of a segment, from the outside in: final
 * punctuation `.,;!?` (not `:`, see `FINAL_PUNCTUATION`), backticks (a code span may open in an earlier segment),
 * an enclosing pair of `**`, `__`, `*`, `_`, `()`, `[]` or `""`, and a closing
 * parenthesis the segment does not open. Nothing else is removed — whatever
 * remains must be a citation in full.
 */
export function unwrapSegment(segment: string): string {
  let core = segment;
  for (;;) {
    const before = core;
    core = core.replace(FINAL_PUNCTUATION, "");
    core = core.replace(/^`+/, "").replace(/`+$/, "");
    for (const [open, close] of PAIRED_WRAPPINGS) {
      if (
        core.length >= open.length + close.length &&
        core.startsWith(open) &&
        core.endsWith(close)
      ) {
        core = core.slice(open.length, core.length - close.length);
        break;
      }
    }
    if (core.endsWith(")") && occurrences(core, "(") < occurrences(core, ")")) {
      core = core.slice(0, -1);
    }
    if (core === before) return core;
  }
}

/** The parser's test: whether a whitespace-free segment is a candidate citation. */
function isCandidate(segment: string, needle: string): boolean {
  const at = segment.indexOf(needle);
  return at !== -1 && segment.includes("@", at + needle.length);
}

/**
 * The code points ECMAScript's `\s` matches, listed rather than matched, so the
 * independent walk below needs no regular expression. They are the
 * specification's WhiteSpace and LineTerminator sets; the parser's `\S+` splits
 * on exactly these.
 */
const WHITESPACE_CODE_POINTS: ReadonlySet<number> = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]);

/**
 * The walk's own copy of the candidate test, written apart on purpose: a count
 * that called the parser's predicate would agree with any mistake in it.
 */
function holdsOrganisationThenAt(segment: string, needle: string): boolean {
  for (let start = 0; start + needle.length <= segment.length; start += 1) {
    if (segment.slice(start, start + needle.length) !== needle) continue;
    for (let after = start + needle.length; after < segment.length; after += 1) {
      if (segment.charAt(after) === "@") return true;
    }
    return false;
  }
  return false;
}

/**
 * Every candidate segment of a text, raw, by a character walk independent of
 * the parser: no regular expression, no wrapping removal, and its own copy of
 * the candidate test. What it shares with the parser is the definition, not the
 * code: whitespace (`WHITESPACE_CODE_POINTS`, the set `\s` names) and the
 * organisation. The gate reconciles both the number AND the concatenated text
 * of these segments with the ones the parser judged, so a parser that splits a
 * segment differently — on `*`, `(`, `"` or any other character — changes the
 * text even where it leaves the number alone.
 */
export function listCandidateSegments(text: string, organization: string): string[] {
  const needle = `${organization}/`;
  const segments: string[] = [];
  let segment = "";
  for (const character of `${text}\n`) {
    if (WHITESPACE_CODE_POINTS.has(character.codePointAt(0) ?? 0)) {
      if (segment.length > 0 && holdsOrganisationThenAt(segment, needle)) segments.push(segment);
      segment = "";
    } else {
      segment += character;
    }
  }
  return segments;
}

type ParsedPin =
  | { readonly kind: "pinned"; readonly citation: PinnedCitation }
  | { readonly kind: "rejected"; readonly rejection: RejectedCitation };

/** A candidate segment judged whole: a valid pin, or a rejection with its reason. */
export function parseCandidate(organization: string, segment: string, line: number): ParsedPin {
  const core = unwrapSegment(segment);
  const prefix = `${organization}/`;
  if (!core.startsWith(prefix)) {
    const at = core.indexOf(prefix);
    return {
      kind: "rejected",
      rejection: {
        text: core,
        line,
        reason: `'${at > 0 ? core.slice(0, at) : core}' is written against ${prefix}: a citation is wrapped only in backticks, emphasis, brackets, parentheses or quotes`,
      },
    };
  }
  return parsePinToken(organization, core.slice(prefix.length), line);
}

/**
 * The text after `<org>/`, judged in full: `<repository>@<sha>[:<path>[:<lines>]]`,
 * or an action reference `<repository>/<path>@<sha>`, resolved as
 * `<repository>@<sha>:<path>`.
 */
export function parsePinToken(organization: string, raw: string, line: number): ParsedPin {
  const text = `${organization}/${raw}`;
  const reject = (reason: string): ParsedPin => ({
    kind: "rejected",
    rejection: { text, line, reason },
  });
  const at = raw.indexOf("@");
  if (at === -1) return reject("no '@<sha>' follows the repository");
  if (raw.endsWith(":")) {
    return reject(
      "the citation ends with ':': a ':' introduces a path or a line spec, written in the same segment",
    );
  }
  const left = raw.slice(0, at);
  const rest = raw.slice(at + 1);
  const slash = left.indexOf("/");
  const repository = slash === -1 ? left : left.slice(0, slash);
  const actionPath = slash === -1 ? null : left.slice(slash + 1);
  if (repository === "." || repository === ".." || !REPOSITORY_NAME.test(repository)) {
    return reject(`'${repository}' is not a repository name`);
  }
  const colon = rest.indexOf(":");
  const ref = colon === -1 ? rest : rest.slice(0, colon);
  const tail = colon === -1 ? "" : rest.slice(colon + 1);
  if (!SHA.test(ref)) {
    if (HEX_LIKE.test(ref)) {
      return reject("a pinned sha is 7 to 40 lowercase hexadecimal characters");
    }
    const sha = /^[0-9a-f]{7,40}/.exec(ref)?.[0];
    if (sha === undefined) {
      return reject(
        `'${ref}' is not a sha: a pin names a commit, never a branch, a tag or a revision expression`,
      );
    }
    return reject(
      `after the sha only ':' or the end of the citation may follow, found '${ref.charAt(sha.length)}': '${ref}' does not name a commit`,
    );
  }
  if (actionPath !== null) {
    // `libre-ai/<repository>/<path>@<sha>`: an action or reusable-workflow
    // reference. It names a repository, a commit and a path, so it is checked
    // like the citation it is equivalent to.
    if (colon !== -1) {
      return reject(
        `an action reference (${organization}/<repository>/<path>@<sha>) ends at its sha, found ':${tail}'`,
      );
    }
    const invalidAction = validateCitedPath(actionPath);
    if (invalidAction !== null) return reject(invalidAction);
    return {
      kind: "pinned",
      citation: { text, repository, sha: ref, path: actionPath, lines: null, line },
    };
  }
  if (tail.length === 0) {
    return {
      kind: "pinned",
      citation: { text, repository, sha: ref, path: null, lines: null, line },
    };
  }
  const target = parsePathAndLines(tail);
  if ("reason" in target) return reject(target.reason);
  return {
    kind: "pinned",
    citation: { text, repository, sha: ref, path: target.path, lines: target.lines, line },
  };
}

/**
 * What follows `<sha>:` in a pinned or a local pin, judged in full: a path,
 * optionally `:<lines>`. Shared by both forms, so they refuse the same tails.
 */
function parsePathAndLines(
  tail: string,
): { readonly path: string; readonly lines: LineSpan[] | null } | { readonly reason: string } {
  let path = tail;
  let lines: LineSpan[] | null = null;
  const lastColon = tail.lastIndexOf(":");
  const suffix = lastColon === -1 ? "" : tail.slice(lastColon + 1);
  // A suffix that opens with a digit is a line spec, valid or not: `:9999~` is a
  // malformed spec, not a path with a colon in it.
  if (lastColon !== -1 && /^[0-9]/.test(suffix)) {
    path = tail.slice(0, lastColon);
    lines = parseLineSpec(suffix);
    if (lines === null) {
      return { reason: `'${suffix}' is not a line spec (L, a-b, a,b; 1-based, a <= b)` };
    }
  }
  const invalid = validateCitedPath(path);
  if (invalid !== null) return { reason: invalid };
  return { path, lines };
}

// Measured 2026-10-22: eleven pins in docs omit the organisation
// (`<repository>@<sha>[:<path>]`) or name a file of this repository
// (`docs/…/X.md@<sha>:<line>`). Neither says which repository to ask; resolving
// them by guessing the organisation would verify a guess. They are counted, and
// refused under the forward rule. Two shapes only: a bare name (no slash), or a
// file path followed by a line — so `actions/checkout@<sha>` and a reusable
// workflow reference, which are action pins and not citations, stay out.
const UNQUALIFIED_PIN: RegExp =
  /(?<![A-Za-z0-9_.@/-])(?:[A-Za-z0-9._-]+@[0-9a-f]{7,40}(?![0-9A-Za-z])(?::[^\s`'"()<>[\]{}|]*)?|[A-Za-z0-9._/-]+\.[A-Za-z0-9]+@[0-9a-f]{7,40}:\d[\d,-]*)/g;

function blank(line: string, start: number, length: number): string {
  return line.slice(0, start) + " ".repeat(length) + line.slice(start + length);
}

function barePattern(extensions: readonly string[]): RegExp {
  return new RegExp(
    String.raw`(?<![A-Za-z0-9_./@:-])([A-Za-z0-9_./-]+\.(?:${extensions.join("|")})):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)(?![0-9A-Za-z])`,
    "g",
  );
}

// Measured 2026-10-23: ADR-0056 carries eleven `c466a5c:<path>[:<lines>]`
// citations, a commit of this repository with the repository left implicit. The
// bare pattern skips them (a `:` precedes the path) and the unqualified one
// needs an `@`, so the gate counted them nowhere: "0 examined" above the
// threshold while eleven were written there. Owner arbitration of the same day:
// they are judged against this repository, through the same resolver as a
// pinned citation, so a sha this repository does not carry fails.
//
// Closed by default, like the `libre-ai/` candidates and for the same reason: a
// first form of this reader matched a pattern and stopped at a lookahead, so
// `:3-9999999x` was judged on `:3`, `#L99999` on the bare path, and `_<sha>:…_`
// or an uppercase sha were seen by nothing. A candidate is now any
// whitespace-free segment holding a run of at least seven hexadecimal digits
// followed by `:` and more text; once its named wrappings are removed it must
// be `<sha>:<path>[:<lines>]` in full, or another owner's
// `<owner>/<repository>@<sha>[:…]` (counted, never asked: this gate offers no
// credential and addresses the organisation only), or it is refused by name.
const LOCAL_CANDIDATE: RegExp = /[0-9a-fA-F]{7,}:\S/;
const FOREIGN_PIN: RegExp = /^([A-Za-z0-9-]+)\/[A-Za-z0-9._-]+@[0-9a-f]{7,40}(?::\S*)?$/;

/**
 * `unwrapSegment`, plus an opening parenthesis the segment does not close: a
 * parenthesis opened before a local pin is closed on a later line as often as
 * not (`(\`<sha>:AGENTS.md:80\`` at the end of a line of ADR-0056).
 */
function unwrapLocalSegment(segment: string): string {
  let core = segment;
  for (;;) {
    const before = core;
    core = unwrapSegment(core);
    if (core.startsWith("(") && occurrences(core, "(") > occurrences(core, ")")) {
      core = core.slice(1);
    }
    if (core === before) return core;
  }
}

type ParsedLocal =
  | { readonly kind: "local"; readonly pin: LocalPin }
  | { readonly kind: "foreign"; readonly pin: ForeignPin }
  | { readonly kind: "rejected"; readonly rejection: RejectedCitation };

/** A local-pin candidate segment judged whole. */
export function parseLocalCandidate(
  organization: string,
  segment: string,
  line: number,
): ParsedLocal {
  const core = unwrapLocalSegment(segment);
  const reject = (reason: string): ParsedLocal => ({
    kind: "rejected",
    rejection: { text: core, line, reason },
  });
  const foreign = FOREIGN_PIN.exec(core);
  if (foreign !== null && foreign[1] !== organization) {
    return { kind: "foreign", pin: { text: core, line } };
  }
  const colon = core.indexOf(":");
  const sha = colon === -1 ? core : core.slice(0, colon);
  if (colon === -1 || !HEX_LIKE.test(sha)) {
    return reject(
      `'${core}' holds a sha followed by ':' but is not a local pin: write <sha>:<path>[:<lines>] alone, or ${organization}/<repository>@<sha>:<path>`,
    );
  }
  if (!SHA.test(sha)) return reject("a pinned sha is 7 to 40 lowercase hexadecimal characters");
  const target = parsePathAndLines(core.slice(colon + 1));
  if ("reason" in target) return reject(target.reason);
  return {
    kind: "local",
    pin: { text: core, sha, path: target.path, lines: target.lines, line },
  };
}

/**
 * Every pinned and bare citation of a text.
 *
 * Bare citations are read on the text with the pinned ones blanked out, so the
 * `path:line` tail of a pinned citation is never counted a second time.
 * `bareExtensions` empty means bare citations are not read.
 */
export function scanText(
  text: string,
  organization: string,
  bareExtensions: readonly string[],
): ScannedText {
  const pinned: PinnedCitation[] = [];
  const rejected: RejectedCitation[] = [];
  const bare: BareCitation[] = [];
  const unqualified: UnqualifiedPin[] = [];
  const local: LocalPin[] = [];
  const localRejected: RejectedCitation[] = [];
  const foreign: ForeignPin[] = [];
  const candidates: string[] = [];
  const needle = `${organization}/`;
  const bareRegExp: RegExp | null = bareExtensions.length > 0 ? barePattern(bareExtensions) : null;

  for (const [index, sourceLine] of text.split("\n").entries()) {
    const line = index + 1;
    let masked = sourceLine;
    for (const match of sourceLine.matchAll(SEGMENT)) {
      const segment = match[0];
      // `libre-ai/<repository>` without a later `@` names a repository, it pins nothing.
      if (!isCandidate(segment, needle)) continue;
      candidates.push(segment);
      masked = blank(masked, match.index ?? 0, segment.length);
      const parsed = parseCandidate(organization, segment, line);
      if (parsed.kind === "pinned") pinned.push(parsed.citation);
      else rejected.push(parsed.rejection);
    }

    for (const match of masked.matchAll(UNQUALIFIED_PIN)) {
      masked = blank(masked, match.index ?? 0, match[0].length);
      unqualified.push({ text: match[0].replace(TRAILING_PUNCTUATION, ""), line });
    }

    if (bareRegExp === null) continue;
    // Local pins are read in ADRs only, like bare citations, and before them: a
    // candidate segment is blanked whole, so no bare citation is read inside it.
    for (const match of masked.matchAll(SEGMENT)) {
      const segment = match[0];
      if (!LOCAL_CANDIDATE.test(segment)) continue;
      masked = blank(masked, match.index ?? 0, segment.length);
      const parsed = parseLocalCandidate(organization, segment, line);
      if (parsed.kind === "local") local.push(parsed.pin);
      else if (parsed.kind === "foreign") foreign.push(parsed.pin);
      else localRejected.push(parsed.rejection);
    }
    for (const match of masked.matchAll(bareRegExp)) {
      const path = match[1] ?? "";
      // A malformed spec (`:0`, `:9-3`) stays a bare citation: judged under the
      // forward rule, counted below it — never mixed into the pinned tally.
      bare.push({ text: match[0], path, lines: parseLineSpec(match[2] ?? ""), line });
    }
  }
  return { pinned, rejected, bare, unqualified, local, localRejected, foreign, candidates };
}

/** Lines in a text the way an editor numbers them: a final newline opens no line. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

/** The cited spans that do not lie in a file of `lineCount` lines. */
export function spansOutside(spans: readonly LineSpan[], lineCount: number): LineSpan[] {
  return spans.filter((span) => span.end > lineCount);
}

function renderSpans(spans: readonly LineSpan[]): string {
  return spans
    .map((span) => (span.start === span.end ? `${span.start}` : `${span.start}-${span.end}`))
    .join(",");
}

// ---------------------------------------------------------------- git ---

export type Verdict =
  | "resolved"
  | "repository-not-found"
  | "repository-unreachable"
  | "sha-not-found"
  | "sha-ambiguous"
  | "sha-not-on-served-branch"
  | "path-absent"
  | "line-range-outside-file"
  | "invalid-citation";

export interface Resolution {
  readonly verdict: Verdict;
  readonly note: string;
}

/**
 * The whole environment of every git process this gate starts — nothing is
 * inherited. No system or global configuration (so no `url.insteadOf`, no
 * credential helper reaching a keychain), no terminal prompt, one transport.
 */
export function hardenedGitEnvironment(
  home: string,
  allowProtocol: string,
): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: allowProtocol,
  };
}

/** Prefixed to every git invocation: no hook can run, no credential is offered. */
export const HARDENING_FLAGS: readonly string[] = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "credential.helper=",
];

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * `ls-remote` failed: is the repository absent, or did we fail to ask?
 *
 * GitHub answers a missing or private repository with 401 to an anonymous
 * client, which git reports as a refused prompt once prompts are disabled.
 */
export function classifyRemoteFailure(stderr: string, timedOut: boolean): Verdict {
  if (timedOut) return "repository-unreachable";
  if (
    /repository '.*' not found|Repository not found|does not appear to be a git repository|could not read Username|terminal prompts disabled|Authentication failed/i.test(
      stderr,
    )
  ) {
    return "repository-not-found";
  }
  return "repository-unreachable";
}

export interface ResolverOptions {
  /** The URL of a repository of the organisation. */
  readonly urlFor: (repository: string) => string;
  /** The single transport git may use (`https` in the gate). */
  readonly allowProtocol: string;
  /** A fresh directory owned by the caller, removed by the caller. */
  readonly scratch: string;
  readonly timeoutMs?: number;
  /** At most this many git processes at once (default 4): a document citing many repositories must not fork-bomb the runner. */
  readonly maxConcurrentGit?: number;
}

/** What the resolver is asked: a citation, and whether its commit must be on the served branch. */
export interface Asked extends Pick<PinnedCitation, "repository" | "sha" | "path" | "lines"> {
  /**
   * True for a local pin: this repository merges by squash, so a commit
   * reachable only from a work branch disappears with it. A pinned citation of
   * another repository may name any branch or tag of it, as before.
   */
  readonly servedBranchOnly?: boolean;
}

type RepositoryHandle =
  | { readonly kind: "ready"; readonly gitDir: string }
  | { readonly kind: "failed"; readonly resolution: Resolution };

export class CitationResolver {
  readonly #options: ResolverOptions;
  readonly #environment: Record<string, string>;
  readonly #repositories = new Map<string, Promise<RepositoryHandle>>();
  readonly #citations = new Map<string, Promise<Resolution>>();
  readonly #limit: number;
  #running = 0;
  #peak = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(options: ResolverOptions) {
    this.#options = options;
    this.#environment = hardenedGitEnvironment(options.scratch, options.allowProtocol);
    this.#limit = Math.max(1, options.maxConcurrentGit ?? 4);
  }

  /** Repositories this resolver addressed: printed so the volume includes them. */
  get repositoriesAddressed(): number {
    return this.#repositories.size;
  }

  /** The most git processes that ever ran at once: the cap, observed. */
  get peakConcurrentGit(): number {
    return this.#peak;
  }

  async #acquire(): Promise<void> {
    if (this.#running < this.#limit) {
      this.#running += 1;
      this.#peak = Math.max(this.#peak, this.#running);
      return;
    }
    // The releasing call hands its slot over: `#running` is unchanged.
    await new Promise<void>((resume) => this.#waiting.push(resume));
  }

  #release(): void {
    const next = this.#waiting.shift();
    if (next === undefined) this.#running -= 1;
    else next();
  }

  async #git(args: readonly string[]): Promise<Ran> {
    await this.#acquire();
    try {
      const proc = Bun.spawn(["git", ...HARDENING_FLAGS, ...args], {
        cwd: this.#options.scratch,
        env: this.#environment,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: this.#options.timeoutMs ?? 120_000,
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stdout, stderr, timedOut: proc.signalCode === "SIGTERM" };
    } finally {
      this.#release();
    }
  }

  #open(repository: string): Promise<RepositoryHandle> {
    const known = this.#repositories.get(repository);
    if (known !== undefined) return known;
    const opened = this.#openUncached(repository, this.#repositories.size);
    this.#repositories.set(repository, opened);
    return opened;
  }

  async #openUncached(repository: string, index: number): Promise<RepositoryHandle> {
    const url = this.#options.urlFor(repository);
    const probe = await this.#git(["ls-remote", url, "HEAD"]);
    if (probe.code !== 0) {
      const verdict = classifyRemoteFailure(probe.stderr, probe.timedOut);
      const said = probe.timedOut ? "timed out" : lastLine(probe.stderr);
      return {
        kind: "failed",
        resolution: {
          verdict,
          note:
            verdict === "repository-not-found"
              ? `${url} does not answer as a repository (deleted, renamed, or private — no credential is offered): ${said}`
              : `${url} could not be asked: ${said}`,
        },
      };
    }
    // Commits and trees, no blob: a sha and a path are answered from the graph;
    // only the blobs whose lines are cited are fetched, on demand.
    const gitDir = join(this.#options.scratch, `repository-${index}.git`);
    const cloned = await this.#git([
      "clone",
      "--bare",
      "--quiet",
      "--filter=blob:none",
      url,
      gitDir,
    ]);
    if (cloned.code !== 0) {
      return {
        kind: "failed",
        resolution: {
          verdict: "repository-unreachable",
          note: `${url} answered ls-remote but could not be cloned: ${lastLine(cloned.stderr)}`,
        },
      };
    }
    return { kind: "ready", gitDir };
  }

  /** Resolves one citation; identical citations are resolved once. */
  resolve(citation: Asked): Promise<Resolution> {
    const key = `${citation.repository}@${citation.sha}:${citation.path ?? ""}:${citation.lines === null ? "" : renderSpans(citation.lines)}:${citation.servedBranchOnly === true ? "served" : "any"}`;
    const known = this.#citations.get(key);
    if (known !== undefined) return known;
    const resolved = this.#resolveUncached(citation);
    this.#citations.set(key, resolved);
    return resolved;
  }

  async #resolveUncached(citation: Asked): Promise<Resolution> {
    // Defence in depth: the parser already refused these, but this method is
    // exported and must not depend on its caller for what reaches git.
    if (!/^[0-9a-f]{4,40}$/.test(citation.sha) || !REPOSITORY_NAME.test(citation.repository)) {
      return {
        verdict: "invalid-citation",
        note: "repository or sha outside the accepted alphabet",
      };
    }
    if (citation.path !== null) {
      const invalid = validateCitedPath(citation.path);
      if (invalid !== null) return { verdict: "invalid-citation", note: invalid };
    }

    const handle = await this.#open(citation.repository);
    if (handle.kind === "failed") return handle.resolution;
    const gitDir = handle.gitDir;

    const commit = await this.#git([
      "--git-dir",
      gitDir,
      "rev-parse",
      "--verify",
      `${citation.sha}^{commit}`,
    ]);
    if (commit.code !== 0) {
      if (/is ambiguous/.test(commit.stderr)) {
        const candidates = [
          ...commit.stderr.matchAll(/^hint:\s+([0-9a-f]{7,40})\s+commit\b/gm),
        ].map((match) => match[1]);
        return {
          verdict: "sha-ambiguous",
          note: `${citation.sha} names more than one commit of ${citation.repository}${candidates.length > 0 ? ` (${candidates.join(", ")})` : ""}: cite a longer sha`,
        };
      }
      return {
        verdict: "sha-not-found",
        note: `${citation.sha} is not a commit reachable from a branch or tag of ${citation.repository}`,
      };
    }
    const full = commit.stdout.trim();
    // `rev-parse` prefers a ref to an object: a branch or tag whose name is the
    // cited hex would answer for it, and the pin would follow a moving ref.
    if (!full.startsWith(citation.sha)) {
      return {
        verdict: "sha-ambiguous",
        note: `${citation.sha} is also the name of a branch or tag of ${citation.repository}, which answers ${full}: cite the full sha`,
      };
    }
    if (citation.servedBranchOnly === true) {
      // The bare clone's HEAD is the remote's served branch.
      const served = await this.#git(["--git-dir", gitDir, "symbolic-ref", "HEAD"]);
      const servedRef = served.stdout.trim();
      if (served.code !== 0 || !servedRef.startsWith("refs/heads/")) {
        return {
          verdict: "repository-unreachable",
          note: `the served branch of ${citation.repository} could not be read: ${lastLine(served.stderr) || servedRef}`,
        };
      }
      const contained = await this.#git([
        "--git-dir",
        gitDir,
        "merge-base",
        "--is-ancestor",
        full,
        servedRef,
      ]);
      if (contained.code === 1) {
        return {
          verdict: "sha-not-on-served-branch",
          note: `${full} is not on ${servedRef.slice("refs/heads/".length)}, the served branch of ${citation.repository}: a commit of a branch that is squashed or deleted leaves the citation dangling — cite a commit of the served branch`,
        };
      }
      if (contained.code !== 0) {
        return {
          verdict: "repository-unreachable",
          note: `whether ${full} is on the served branch of ${citation.repository} could not be decided: ${lastLine(contained.stderr)}`,
        };
      }
    }
    if (citation.path === null) {
      return {
        verdict: "resolved",
        note: `${citation.repository}@${citation.sha} is commit ${full}`,
      };
    }

    const object = await this.#git([
      "--git-dir",
      gitDir,
      "rev-parse",
      "--verify",
      `${full}:${citation.path}`,
    ]);
    if (object.code !== 0) {
      return {
        verdict: "path-absent",
        note: `${citation.path} does not exist in ${citation.repository} at ${full}`,
      };
    }
    const oid = object.stdout.trim();
    const present = await this.#git(["--git-dir", gitDir, "cat-file", "-e", oid]);
    if (present.code !== 0) {
      return {
        verdict: "repository-unreachable",
        note: `${citation.path} is in the tree at ${full} but its object ${oid} could not be fetched: ${lastLine(present.stderr)}`,
      };
    }
    if (citation.lines === null) {
      return { verdict: "resolved", note: `${citation.path} exists at ${full}` };
    }

    const type = await this.#git(["--git-dir", gitDir, "cat-file", "-t", oid]);
    if (type.code !== 0 || type.stdout.trim() !== "blob") {
      return {
        verdict: "line-range-outside-file",
        note: `${citation.path} is a ${type.stdout.trim() || "non-file object"} at ${full}: lines cannot be cited in it`,
      };
    }
    const blob = await this.#git(["--git-dir", gitDir, "cat-file", "blob", oid]);
    if (blob.code !== 0) {
      return {
        verdict: "repository-unreachable",
        note: `the blob of ${citation.path} at ${full} could not be read: ${lastLine(blob.stderr)}`,
      };
    }
    const lineCount = countLines(blob.stdout);
    const outside = spansOutside(citation.lines, lineCount);
    if (outside.length > 0) {
      return {
        verdict: "line-range-outside-file",
        note: `${citation.path} has ${lineCount} line(s) at ${full}; cited ${renderSpans(outside)} lie outside`,
      };
    }
    return {
      verdict: "resolved",
      note: `${citation.path}:${renderSpans(citation.lines)} lies in its ${lineCount} line(s) at ${full}`,
    };
  }
}

function lastLine(text: string): string {
  const lines = text.trim().split("\n");
  return lines[lines.length - 1] ?? "";
}

// ---------------------------------------------------------------- verdict ---

export interface ReadFile {
  readonly path: string;
  /** Null when the file could not be read. */
  readonly text: string | null;
}

export interface CitationsInput {
  readonly config: PinnedCitationsConfig;
  /** Tracked files under the declared scope, read. */
  readonly files: readonly ReadFile[];
  /** Every tracked path of this repository: where a bare citation must resolve. */
  readonly tracked: ReadonlySet<string>;
  /** Reads a tracked file of this repository; null when unreadable. */
  readonly readTracked: (path: string) => Promise<string | null>;
  /**
   * The name of this repository in the organisation, derived from its `origin`
   * remote (`repositoryFromRemote`); null when it could not be derived. A local
   * pin is asked of this repository, so without a name it fails.
   */
  readonly selfRepository: string | null;
}

export interface CitationsVolume {
  readonly files: number;
  readonly filesUnreadable: number;
  /** Candidate segments found by the independent walk; must equal `pinned`. */
  readonly found: number;
  /** Their concatenated length: equal to the parser's, or the gate fails. */
  readonly foundCharacters: number;
  readonly pinned: number;
  readonly pinnedResolved: number;
  readonly pinnedExempted: number;
  readonly pinnedFailed: number;
  readonly byVerdict: Readonly<Record<string, number>>;
  readonly guardedAdrs: number;
  readonly guardedBare: number;
  readonly guardedBareResolved: number;
  readonly guardedBareFailed: number;
  readonly legacyAdrs: number;
  readonly legacyBare: number;
  readonly legacyBareResolving: number;
  readonly legacyBareUnverifiable: number;
  /** Unqualified pins of guarded ADRs: each one failed. */
  readonly guardedUnqualified: number;
  /** Unqualified pins anywhere else in the scope: counted, not judged. */
  readonly unjudgedUnqualified: number;
  /**
   * Local-pin candidates of guarded ADRs, refused ones included:
   * examined = resolved + failed.
   */
  readonly guardedLocal: number;
  readonly guardedLocalResolved: number;
  readonly guardedLocalFailed: number;
  /** Local-pin candidates of ADRs at or below the threshold: counted, not judged. */
  readonly legacyLocal: number;
  /** Pins of another owner in any ADR: counted, never asked. */
  readonly foreignPins: number;
}

/**
 * The repository an `origin` URL names in `organization`, or null.
 *
 * `actions/checkout` sets `https://github.com/<owner>/<repository>`; a clone by
 * `gh` or by hand may add `.git` or use the SSH form. Anything else — another
 * host, another owner, a name outside `[A-Za-z0-9._-]` — is null: the gate
 * would otherwise ask a repository it guessed.
 */
export function repositoryFromRemote(url: string, organization: string): string | null {
  const prefixes = [
    `https://github.com/${organization}/`,
    `git@github.com:${organization}/`,
    `ssh://git@github.com/${organization}/`,
  ];
  const prefix = prefixes.find((candidate) => url.startsWith(candidate));
  if (prefix === undefined) return null;
  let name = url.slice(prefix.length);
  if (name.endsWith("/")) name = name.slice(0, -1);
  if (name.endsWith(".git")) name = name.slice(0, -".git".length);
  if (name === "." || name === ".." || !REPOSITORY_NAME.test(name)) return null;
  return name;
}

export type AdrStanding = "guarded" | "legacy" | "not-an-adr";

/** Whether the bare citations of `path` are judged, counted, or not read at all. */
export function adrStanding(path: string, rule: AdrRule): AdrStanding {
  if (!path.startsWith(rule.directory) || !path.endsWith(".md")) return "not-an-adr";
  const name = basename(path);
  if (path.slice(rule.directory.length).includes("/")) return "not-an-adr";
  // `NNNN-<slug>`: a dated file (`2026-09-29-…`) is not numbered 2026.
  const numbered = /^(\d{4})-[a-z]/i.exec(name);
  if (numbered !== null) {
    return Number(numbered[1]) > rule.bareCitationsGuardedAbove ? "guarded" : "legacy";
  }
  // An unnumbered ADR escapes the forward rule only by being listed with a reason.
  return rule.unnumbered.some((entry) => entry.path === path) ? "legacy" : "guarded";
}

async function resolveBare(
  citation: BareCitation,
  input: CitationsInput,
): Promise<{ ok: boolean; note: string }> {
  const invalid = validateCitedPath(citation.path);
  if (invalid !== null) return { ok: false, note: invalid };
  const spans = citation.lines;
  if (spans === null) {
    return { ok: false, note: "malformed line spec (L, a-b, a,b; 1-based, a <= b)" };
  }
  if (!input.tracked.has(citation.path)) {
    return {
      ok: false,
      note: `${citation.path} is not tracked in this repository: pin it as ${input.config.organization}/<repository>@<sha>:${citation.path}:${renderSpans(spans)}`,
    };
  }
  const text = await input.readTracked(citation.path);
  if (text === null)
    return { ok: false, note: `${citation.path} is tracked but could not be read` };
  const lineCount = countLines(text);
  const outside = spansOutside(spans, lineCount);
  if (outside.length > 0) {
    return {
      ok: false,
      note: `${citation.path} has ${lineCount} line(s); cited ${renderSpans(outside)} lie outside`,
    };
  }
  return { ok: true, note: `${citation.path} resolves in this tree (${lineCount} line(s))` };
}

/**
 * A local pin, asked of this repository through the same resolver as a pinned
 * citation, with one more condition: the commit must be on the served branch
 * of the remote. Present in the working clone is not enough, and neither is
 * reachable from a work branch, which a squash merge leaves behind.
 */
async function resolveLocal(
  pin: LocalPin,
  input: CitationsInput,
  resolver: Pick<CitationResolver, "resolve">,
): Promise<{ ok: boolean; note: string }> {
  if (input.selfRepository === null) {
    return {
      ok: false,
      note: `the name of this repository could not be derived from its origin remote, so no repository can be asked: write ${input.config.organization}/<repository>@${pin.sha}:${pin.path}`,
    };
  }
  const resolution = await resolver.resolve({
    repository: input.selfRepository,
    sha: pin.sha,
    path: pin.path,
    lines: pin.lines,
    servedBranchOnly: true,
  });
  return {
    ok: resolution.verdict === "resolved",
    note:
      resolution.verdict === "resolved"
        ? resolution.note
        : `${resolution.verdict}: ${resolution.note}`,
  };
}

/**
 * Null when the parser and the independent walk agree, else why not.
 *
 * Three equalities, each closing a different way to disagree:
 *   - `found.length === examined`: `examined` sums its own parts (resolved +
 *     exempted + failed) by construction, so a citation the parser records but
 *     never gives a verdict shows up here;
 *   - `found.length === judged.length`: a candidate test that admits or misses
 *     a segment the walk does not;
 *   - the concatenated text of `found` equals that of `judged`: a parser that
 *     splits a segment on a character the walk does not changes the text even
 *     where the count happens to stay the same (`@<sha>*x` cut at `*` is still
 *     one candidate, but a shorter one).
 */
export function reconcileCandidates(
  found: readonly string[],
  judged: readonly string[],
  examined: number,
): string | null {
  const foundText = found.join("\n");
  const judgedText = judged.join("\n");
  if (found.length === examined && found.length === judged.length && foundText === judgedText) {
    return null;
  }
  let first = 0;
  while (first < found.length && found[first] === judged[first]) first += 1;
  return (
    `the independent walk found ${found.length} candidate segment(s) (${foundText.length} character(s)), ` +
    `the parser judged ${judged.length} (${judgedText.length} character(s)) and ${examined} received a verdict; ` +
    `first difference at segment ${first + 1}: walk ${JSON.stringify(found[first] ?? null)}, parser ${JSON.stringify(judged[first] ?? null)}`
  );
}

/** The verdict over files already read; git is reached only through `resolver`. */
export async function evaluateCitations(
  input: CitationsInput,
  resolver: Pick<CitationResolver, "resolve">,
): Promise<{ report: GateReport; volume: CitationsVolume; information: string[] }> {
  const { config } = input;
  const report = new GateReport();
  const exemptions = new Map(
    config.exemptions.map((entry) => [exemptionKey(entry.file, entry.citation), entry.because]),
  );
  const usedExemptions = new Set<string>();
  const byVerdict: Record<string, number> = {};
  const tally = (verdict: string): void => {
    byVerdict[verdict] = (byVerdict[verdict] ?? 0) + 1;
  };
  let filesUnreadable = 0;
  let pinnedResolved = 0;
  let pinnedExempted = 0;
  let pinnedFailed = 0;
  let guardedAdrs = 0;
  let guardedBare = 0;
  let guardedBareResolved = 0;
  let guardedBareFailed = 0;
  let legacyAdrs = 0;
  let legacyBare = 0;
  let legacyBareResolving = 0;
  let guardedUnqualified = 0;
  let unjudgedUnqualified = 0;
  let guardedLocal = 0;
  let guardedLocalResolved = 0;
  let guardedLocalFailed = 0;
  let legacyLocal = 0;
  let foreignPins = 0;
  const foundSegments: string[] = [];
  const judgedSegments: string[] = [];

  if (input.files.length === 0) {
    report.check(
      config.scope.join(", "),
      false,
      "the declared scope holds no tracked file — the scope moved, or the gate reads nothing",
    );
  }

  for (const declared of config.adr.unnumbered) {
    if (!input.tracked.has(declared.path)) {
      report.check(
        declared.path,
        false,
        "listed as an unnumbered legacy ADR but not tracked — remove the entry",
      );
    }
  }

  for (const file of input.files) {
    if (file.text === null) {
      filesUnreadable += 1;
      report.check(
        file.path,
        false,
        "tracked file under the scope could not be read — unreadable is not zero citations",
      );
      continue;
    }
    foundSegments.push(...listCandidateSegments(file.text, config.organization));
    const standing = adrStanding(file.path, config.adr);
    const scanned = scanText(
      file.text,
      config.organization,
      standing === "not-an-adr" ? [] : config.adr.extensions,
    );
    judgedSegments.push(...scanned.candidates);

    for (const rejected of scanned.rejected) {
      const key = exemptionKey(file.path, rejected.text);
      const because = exemptions.get(key);
      if (because !== undefined) {
        usedExemptions.add(key);
        pinnedExempted += 1;
        report.check(`${file.path}:${rejected.line} ${rejected.text}`, true, `exempt: ${because}`);
        continue;
      }
      pinnedFailed += 1;
      tally("invalid-citation");
      report.check(
        `${file.path}:${rejected.line} ${rejected.text}`,
        false,
        `invalid-citation: ${rejected.reason}`,
      );
    }

    // Exempted citations are resolved too: an exemption whose citation resolves
    // again (the repository restored, the example made real) is a permission
    // that no longer has a reason, and it fails like an unused one.
    const resolutions = await Promise.all(
      scanned.pinned.map((citation) => resolver.resolve(citation)),
    );
    for (const [index, citation] of scanned.pinned.entries()) {
      const item = `${file.path}:${citation.line} ${citation.text}`;
      const resolution = resolutions[index] ?? {
        verdict: "repository-unreachable",
        note: "no resolution was produced for this citation",
      };
      const key = exemptionKey(file.path, citation.text);
      const because = exemptions.get(key);
      if (because !== undefined) {
        usedExemptions.add(key);
        if (resolution.verdict === "resolved") {
          pinnedFailed += 1;
          tally("exemption-now-resolves");
          report.check(
            item,
            false,
            `exemption-now-resolves: ${resolution.note} — remove the exemption ("${because}")`,
          );
          continue;
        }
        pinnedExempted += 1;
        report.check(item, true, `exempt: ${because} (still ${resolution.verdict})`);
        continue;
      }
      tally(resolution.verdict);
      if (resolution.verdict === "resolved") pinnedResolved += 1;
      else pinnedFailed += 1;
      report.check(
        item,
        resolution.verdict === "resolved",
        resolution.verdict === "resolved"
          ? resolution.note
          : `${resolution.verdict}: ${resolution.note}`,
      );
    }

    if (standing === "guarded") {
      guardedAdrs += 1;
      for (const pin of scanned.unqualified) {
        guardedUnqualified += 1;
        report.check(
          `${file.path}:${pin.line} ${pin.text}`,
          false,
          `unqualified pin in an ADR above ${config.adr.bareCitationsGuardedAbove}: write ${config.organization}/<repository>@<sha>:<path> so the repository can be asked`,
        );
      }
      for (const pin of scanned.local) {
        guardedLocal += 1;
        const item = `${file.path}:${pin.line} ${pin.text}`;
        const outcome = await resolveLocal(pin, input, resolver);
        if (outcome.ok) guardedLocalResolved += 1;
        else guardedLocalFailed += 1;
        report.check(
          item,
          outcome.ok,
          outcome.ok
            ? outcome.note
            : `local pin in an ADR above ${config.adr.bareCitationsGuardedAbove}: ${outcome.note}`,
        );
      }
      for (const rejected of scanned.localRejected) {
        guardedLocal += 1;
        guardedLocalFailed += 1;
        report.check(
          `${file.path}:${rejected.line} ${rejected.text}`,
          false,
          `invalid local pin in an ADR above ${config.adr.bareCitationsGuardedAbove}: ${rejected.reason}`,
        );
      }
      for (const citation of scanned.bare) {
        guardedBare += 1;
        const outcome = await resolveBare(citation, input);
        if (outcome.ok) guardedBareResolved += 1;
        else guardedBareFailed += 1;
        report.check(
          `${file.path}:${citation.line} ${citation.text}`,
          outcome.ok,
          outcome.ok
            ? outcome.note
            : `bare citation in an ADR above ${config.adr.bareCitationsGuardedAbove}: ${outcome.note}`,
        );
      }
    } else {
      unjudgedUnqualified += scanned.unqualified.length;
    }
    foreignPins += scanned.foreign.length;
    if (standing === "legacy") {
      legacyAdrs += 1;
      legacyLocal += scanned.local.length + scanned.localRejected.length;
      for (const citation of scanned.bare) {
        legacyBare += 1;
        if ((await resolveBare(citation, input)).ok) legacyBareResolving += 1;
      }
    }
  }

  for (const entry of config.exemptions) {
    if (usedExemptions.has(exemptionKey(entry.file, entry.citation))) continue;
    report.check(
      `${entry.file}: ${entry.citation}`,
      false,
      "exemption matches no citation in that file — remove it, an unused permission is checked by nobody",
    );
  }

  const pinned = pinnedResolved + pinnedExempted + pinnedFailed;
  const unreconciled = reconcileCandidates(foundSegments, judgedSegments, pinned);
  if (unreconciled !== null) report.check("pinned citations", false, unreconciled);
  const found = foundSegments.length;
  const foundCharacters = foundSegments.join("\n").length;
  const volume: CitationsVolume = {
    files: input.files.length,
    filesUnreadable,
    found,
    foundCharacters,
    pinned,
    pinnedResolved,
    pinnedExempted,
    pinnedFailed,
    byVerdict,
    guardedAdrs,
    guardedBare,
    guardedBareResolved,
    guardedBareFailed,
    legacyAdrs,
    legacyBare,
    legacyBareResolving,
    legacyBareUnverifiable: legacyBare - legacyBareResolving,
    guardedUnqualified,
    unjudgedUnqualified,
    guardedLocal,
    guardedLocalResolved,
    guardedLocalFailed,
    legacyLocal,
    foreignPins,
  };
  const failures = Object.entries(byVerdict)
    .filter(([verdict]) => verdict !== "resolved")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([verdict, count]) => `${verdict} ${count}`)
    .join(", ");
  report.volume(
    `${pinned} pinned citation(s) examined in ${input.files.length} tracked file(s) of ${config.scope.join(", ")} ` +
      `(${filesUnreadable} unreadable) = ${pinnedResolved} resolved + ${pinnedExempted} exempted (with reason) + ` +
      `${pinnedFailed} failed${failures.length > 0 ? ` [${failures}]` : ""}, ` +
      `against ${found} candidate segment(s) (${foundCharacters} character(s)) found by an independent walk; ` +
      `${config.exemptions.length} exemption(s) declared, ${usedExemptions.size} matched; ` +
      `bare citations of ${guardedAdrs} ADR(s) above ${config.adr.bareCitationsGuardedAbove}: ${guardedBare} examined = ` +
      `${guardedBareResolved} resolved + ${guardedBareFailed} failed; ${guardedUnqualified} unqualified pin(s) there, all failed; ` +
      `local pins (<sha>:<path>, asked of ${input.selfRepository === null ? "an underived repository" : `${config.organization}/${input.selfRepository}`}) there: ` +
      `${guardedLocal} examined = ${guardedLocalResolved} resolved + ${guardedLocalFailed} failed`,
  );
  const information = [
    `Pinned citations (information, not a pass): ${legacyAdrs} ADR(s) at or below ${config.adr.bareCitationsGuardedAbove} ` +
      `carry ${legacyBare} bare path:line citation(s); ${legacyBareResolving} resolve in this tree, ` +
      `${volume.legacyBareUnverifiable} cannot be verified by any instrument (no repository, no commit). Not judged: ` +
      "the forward rule does not rewrite history.",
    `Pinned citations (information, not a pass): ${unjudgedUnqualified} unqualified pin(s) (<name>@<sha>, no organisation) ` +
      "outside the guarded ADRs — no repository to ask, so not verified.",
    `Pinned citations (information, not a pass): ${legacyLocal} local pin(s) (<sha>:<path>, repository implicit) ` +
      `in ADR(s) at or below ${config.adr.bareCitationsGuardedAbove} — counted, not judged: the forward rule does not rewrite history.`,
    `Pinned citations (information, not a pass): ${foreignPins} pin(s) of another owner (<owner>/<repository>@<sha>) in the ADRs ` +
      `— counted, never asked: this gate addresses ${config.organization} only and offers no credential.`,
  ];
  return { report, volume, information };
}

// ---------------------------------------------------------------- effects ---

async function readOrNull(root: string, path: string): Promise<string | null> {
  try {
    const file = Bun.file(join(root, path));
    if (!(await file.exists())) return null;
    return await file.text();
  } catch {
    return null;
  }
}

if (import.meta.main) {
  const { concludeGate } = await import("./gate-report");
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const config = validateConfig(await Bun.file(join(root, CONFIG_PATH)).json());
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", cwd: root })
    .split("\0")
    .filter(Boolean);
  const inScope = tracked.filter((path) => config.scope.some((prefix) => path.startsWith(prefix)));
  const files = await Promise.all(
    inScope.map(async (path) => ({ path, text: await readOrNull(root, path) })),
  );
  let origin: string | null;
  try {
    origin = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      cwd: root,
    }).trim();
  } catch {
    origin = null;
  }
  const selfRepository = origin === null ? null : repositoryFromRemote(origin, config.organization);
  const scratch = await mkdtemp(join(tmpdir(), "check-pinned-citations-"));
  let outcome: Awaited<ReturnType<typeof evaluateCitations>>;
  let addressed: number;
  let peak: number;
  try {
    const resolver = new CitationResolver({
      urlFor: (repository) => `https://github.com/${config.organization}/${repository}`,
      allowProtocol: "https",
      scratch,
    });
    outcome = await evaluateCitations(
      {
        config,
        files,
        tracked: new Set(tracked),
        readTracked: (path) => readOrNull(root, path),
        selfRepository,
      },
      resolver,
    );
    addressed = resolver.repositoriesAddressed;
    peak = resolver.peakConcurrentGit;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  console.log(
    `Pinned citations: ${addressed} repository(ies) addressed over git (https only), at most ${peak} git process(es) at once.`,
  );
  for (const line of outcome.information) console.log(line);
  concludeGate("Pinned citations", outcome.report);
}
