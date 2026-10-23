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
 * eleven on 2026-10-22, ten of them in ADRs 0028, 0045, 0048 and 0049. An
 * action reference (`owner/action@<sha>`) is not a citation and is not read.
 *
 * Verdicts are named and distinct, and every one of them but `resolved` fails:
 * repository-not-found, repository-unreachable, sha-not-found, sha-ambiguous,
 * path-absent, line-range-outside-file, invalid-citation. An unreachable
 * repository is not a missing one — the first is about the network, the second
 * about the citation — and neither is ever a zero.
 *
 * A citation of a deleted repository, or a deliberately fictitious example,
 * fails unless it is listed in the data file with a written reason. An
 * exemption that matches no citation fails too: it is a permission nobody
 * checks.
 *
 * WHAT IT DOES NOT ASSERT: that the cited code still says what the prose says
 * it says — a pin is exactly the means of not having to, and the relevance of a
 * citation stays a review matter. A ref that is not a sha
 * (`libre-ai/<repository>@v2`) is not a pin and is not read. A private
 * repository is indistinguishable from a deleted one: no credential is ever
 * offered, on purpose.
 *
 * HARDENING. The text this gate reads is written by anyone who can open a pull
 * request, and it becomes git arguments. So: git runs in an empty environment
 * (`GIT_CONFIG_NOSYSTEM`, no global configuration, no credential helper, no
 * terminal prompt, `GIT_ALLOW_PROTOCOL=https`, hooks pointed at nothing); every
 * value is passed as a separate argument, never through a shell; the sha is
 * hex by construction; the path is refused if absolute, if it carries a `.` or
 * `..` segment (`<rev>:./x` is resolved against the working directory), a
 * backslash, a colon or a control character. The repository URL is built from
 * the organisation in data and a name restricted to `[A-Za-z0-9._-]`.
 *
 * It reads other repositories, so it runs where the fleet gates run
 * (`inventory-drift.yml`), not in `bun run check`.
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
  /** The citation exactly as written, trailing punctuation excluded. */
  readonly citation: string;
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
        isReasoned(entry) && typeof (entry as { citation?: unknown }).citation === "string",
    )
  ) {
    fail("every exemption needs a citation and a non-empty because");
  }
  const seen = new Set<string>();
  for (const entry of exemptions as CitationExemption[]) {
    if (seen.has(entry.citation)) fail(`duplicate exemption ${entry.citation}`);
    seen.add(entry.citation);
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
  readonly lines: readonly LineSpan[];
  readonly line: number;
}

/** `<name>@<sha>[:…]` without the organisation: a pin no instrument can address. */
export interface UnqualifiedPin {
  readonly text: string;
  readonly line: number;
}

export interface ScannedText {
  readonly pinned: readonly PinnedCitation[];
  readonly rejected: readonly RejectedCitation[];
  readonly bare: readonly BareCitation[];
  readonly unqualified: readonly UnqualifiedPin[];
}

const LINE_SPEC: RegExp = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;
const SHA: RegExp = /^[0-9a-f]{7,40}$/;
const HEX_LIKE: RegExp = /^[0-9a-fA-F]+$/;
const REPOSITORY_NAME: RegExp = /^[A-Za-z0-9._-]+$/;
const TRAILING_PUNCTUATION: RegExp = /[.,;:!?]+$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point.
const CONTROL_CHARACTER: RegExp = /[\u0000-\u001f\u007f]/;

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
  if (path.includes(":")) return "the path carries a colon, ambiguous with a line suffix";
  for (const segment of path.split("/")) {
    if (segment === "..") return "the path climbs out of the tree with '..'";
    if (segment === ".")
      return "the path carries a '.' segment, resolved against the working directory by git";
    if (segment === "") return "the path carries an empty segment";
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pinnedPattern(organization: string): RegExp {
  // Not preceded by a path or scope character: `@libre-ai/ui@1.0.0` is a package
  // specifier and `github.com/libre-ai/x` a URL, neither is a citation.
  return new RegExp(
    String.raw`(?<![A-Za-z0-9_.@/-])${escapeRegExp(organization)}/([A-Za-z0-9._-]+)@([0-9A-Za-z]+)(?::([^\s\`'"()<>\[\]{}|]*))?`,
    "g",
  );
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
  const pinnedRegExp: RegExp = pinnedPattern(organization);
  const bareRegExp: RegExp | null = bareExtensions.length > 0 ? barePattern(bareExtensions) : null;

  for (const [index, sourceLine] of text.split("\n").entries()) {
    const line = index + 1;
    let masked = sourceLine;
    for (const match of sourceLine.matchAll(pinnedRegExp)) {
      const repository = match[1] ?? "";
      const token = match[2] ?? "";
      // A ref that is not hex (`@v2`) is not a commit pin: not this gate's object.
      if (!HEX_LIKE.test(token)) continue;
      masked = blank(masked, match.index ?? 0, match[0].length);

      const tail = (match[3] ?? "").replace(TRAILING_PUNCTUATION, "");
      const head = `${organization}/${repository}@${token}`;
      const written = tail.length > 0 ? `${head}:${tail}` : head;
      const reject = (reason: string): void => {
        rejected.push({ text: written, line, reason });
      };

      if (repository === "." || repository === ".." || !REPOSITORY_NAME.test(repository)) {
        reject(`'${repository}' is not a repository name`);
        continue;
      }
      if (!SHA.test(token)) {
        reject("a pinned sha is 7 to 40 lowercase hexadecimal characters");
        continue;
      }
      if (tail.length === 0) {
        pinned.push({ text: written, repository, sha: token, path: null, lines: null, line });
        continue;
      }
      let path = tail;
      let lines: LineSpan[] | null = null;
      const colon = tail.lastIndexOf(":");
      if (colon !== -1 && /^[0-9][0-9,-]*$/.test(tail.slice(colon + 1))) {
        path = tail.slice(0, colon);
        lines = parseLineSpec(tail.slice(colon + 1));
        if (lines === null) {
          reject(`'${tail.slice(colon + 1)}' is not a line spec (L, a-b, a,b; 1-based, a <= b)`);
          continue;
        }
      }
      const invalid = validateCitedPath(path);
      if (invalid !== null) {
        reject(invalid);
        continue;
      }
      pinned.push({ text: written, repository, sha: token, path, lines, line });
    }

    for (const match of masked.matchAll(UNQUALIFIED_PIN)) {
      masked = blank(masked, match.index ?? 0, match[0].length);
      unqualified.push({ text: match[0].replace(TRAILING_PUNCTUATION, ""), line });
    }

    if (bareRegExp === null) continue;
    for (const match of masked.matchAll(bareRegExp)) {
      const path = match[1] ?? "";
      const lines = parseLineSpec(match[2] ?? "");
      if (lines === null) {
        rejected.push({ text: match[0], line, reason: "malformed line spec" });
        continue;
      }
      bare.push({ text: match[0], path, lines, line });
    }
  }
  return { pinned, rejected, bare, unqualified };
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
}

type RepositoryHandle =
  | { readonly kind: "ready"; readonly gitDir: string }
  | { readonly kind: "failed"; readonly resolution: Resolution };

export class CitationResolver {
  readonly #options: ResolverOptions;
  readonly #environment: Record<string, string>;
  readonly #repositories = new Map<string, Promise<RepositoryHandle>>();
  readonly #citations = new Map<string, Promise<Resolution>>();

  constructor(options: ResolverOptions) {
    this.#options = options;
    this.#environment = hardenedGitEnvironment(options.scratch, options.allowProtocol);
  }

  /** Repositories this resolver addressed: printed so the volume includes them. */
  get repositoriesAddressed(): number {
    return this.#repositories.size;
  }

  async #git(args: readonly string[]): Promise<Ran> {
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
  resolve(
    citation: Pick<PinnedCitation, "repository" | "sha" | "path" | "lines">,
  ): Promise<Resolution> {
    const key = `${citation.repository}@${citation.sha}:${citation.path ?? ""}:${citation.lines === null ? "" : renderSpans(citation.lines)}`;
    const known = this.#citations.get(key);
    if (known !== undefined) return known;
    const resolved = this.#resolveUncached(citation);
    this.#citations.set(key, resolved);
    return resolved;
  }

  async #resolveUncached(
    citation: Pick<PinnedCitation, "repository" | "sha" | "path" | "lines">,
  ): Promise<Resolution> {
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
}

export interface CitationsVolume {
  readonly files: number;
  readonly filesUnreadable: number;
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
  if (!input.tracked.has(citation.path)) {
    return {
      ok: false,
      note: `${citation.path} is not tracked in this repository: pin it as ${input.config.organization}/<repository>@<sha>:${citation.path}:${renderSpans(citation.lines)}`,
    };
  }
  const text = await input.readTracked(citation.path);
  if (text === null)
    return { ok: false, note: `${citation.path} is tracked but could not be read` };
  const lineCount = countLines(text);
  const outside = spansOutside(citation.lines, lineCount);
  if (outside.length > 0) {
    return {
      ok: false,
      note: `${citation.path} has ${lineCount} line(s); cited ${renderSpans(outside)} lie outside`,
    };
  }
  return { ok: true, note: `${citation.path} resolves in this tree (${lineCount} line(s))` };
}

/** The verdict over files already read; git is reached only through `resolver`. */
export async function evaluateCitations(
  input: CitationsInput,
  resolver: Pick<CitationResolver, "resolve">,
): Promise<{ report: GateReport; volume: CitationsVolume; information: string[] }> {
  const { config } = input;
  const report = new GateReport();
  const exemptions = new Map(config.exemptions.map((entry) => [entry.citation, entry.because]));
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
    const standing = adrStanding(file.path, config.adr);
    const scanned = scanText(
      file.text,
      config.organization,
      standing === "not-an-adr" ? [] : config.adr.extensions,
    );

    for (const rejected of scanned.rejected) {
      const because = exemptions.get(rejected.text);
      if (because !== undefined) {
        usedExemptions.add(rejected.text);
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

    const resolutions = await Promise.all(
      scanned.pinned.map((citation) =>
        exemptions.has(citation.text) ? Promise.resolve(null) : resolver.resolve(citation),
      ),
    );
    for (const [index, citation] of scanned.pinned.entries()) {
      const item = `${file.path}:${citation.line} ${citation.text}`;
      const resolution = resolutions[index];
      if (resolution === null || resolution === undefined) {
        usedExemptions.add(citation.text);
        pinnedExempted += 1;
        report.check(item, true, `exempt: ${exemptions.get(citation.text) ?? ""}`);
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
    if (standing === "legacy") {
      legacyAdrs += 1;
      for (const citation of scanned.bare) {
        legacyBare += 1;
        if ((await resolveBare(citation, input)).ok) legacyBareResolving += 1;
      }
    }
  }

  for (const entry of config.exemptions) {
    if (usedExemptions.has(entry.citation)) continue;
    report.check(
      entry.citation,
      false,
      "exemption matches no citation in the scope — remove it, an unused permission is checked by nobody",
    );
  }

  const pinned = pinnedResolved + pinnedExempted + pinnedFailed;
  const volume: CitationsVolume = {
    files: input.files.length,
    filesUnreadable,
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
  };
  const failures = Object.entries(byVerdict)
    .filter(([verdict]) => verdict !== "resolved")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([verdict, count]) => `${verdict} ${count}`)
    .join(", ");
  report.volume(
    `${pinned} pinned citation(s) examined in ${input.files.length} tracked file(s) of ${config.scope.join(", ")} ` +
      `(${filesUnreadable} unreadable) = ${pinnedResolved} resolved + ${pinnedExempted} exempted (with reason) + ` +
      `${pinnedFailed} failed${failures.length > 0 ? ` [${failures}]` : ""}; ` +
      `${config.exemptions.length} exemption(s) declared, ${usedExemptions.size} matched; ` +
      `bare citations of ${guardedAdrs} ADR(s) above ${config.adr.bareCitationsGuardedAbove}: ${guardedBare} examined = ` +
      `${guardedBareResolved} resolved + ${guardedBareFailed} failed; ${guardedUnqualified} unqualified pin(s) there, all failed`,
  );
  const information = [
    `Pinned citations (information, not a pass): ${legacyAdrs} ADR(s) at or below ${config.adr.bareCitationsGuardedAbove} ` +
      `carry ${legacyBare} bare path:line citation(s); ${legacyBareResolving} resolve in this tree, ` +
      `${volume.legacyBareUnverifiable} cannot be verified by any instrument (no repository, no commit). Not judged: ` +
      "the forward rule does not rewrite history.",
    `Pinned citations (information, not a pass): ${unjudgedUnqualified} unqualified pin(s) (<name>@<sha>, no organisation) ` +
      "outside the guarded ADRs — no repository to ask, so not verified.",
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
  const scratch = await mkdtemp(join(tmpdir(), "check-pinned-citations-"));
  let outcome: Awaited<ReturnType<typeof evaluateCitations>>;
  let addressed: number;
  try {
    const resolver = new CitationResolver({
      urlFor: (repository) => `https://github.com/${config.organization}/${repository}`,
      allowProtocol: "https",
      scratch,
    });
    outcome = await evaluateCitations(
      { config, files, tracked: new Set(tracked), readTracked: (path) => readOrNull(root, path) },
      resolver,
    );
    addressed = resolver.repositoriesAddressed;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  console.log(`Pinned citations: ${addressed} repository(ies) addressed over git (https only).`);
  for (const line of outcome.information) console.log(line);
  concludeGate("Pinned citations", outcome.report);
}
