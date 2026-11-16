/**
 * Version tag for the product: `bun tools/release/tag-release.ts [--check]`.
 *
 * Reads the product version from `VERSION` at the repository root (one line,
 * `X.Y.Z`, digits only) and derives the tag `v<X.Y.Z>`. Whether that tag
 * exists, and at which commit, is asked to the git protocol
 * (`ls-remote --symref`, annotated tags peeled): no quota, no token, and the
 * release API cannot tell a tag without a release from a free name. The same
 * call resolves the branch the remote serves — never a hardcoded name.
 *
 * - On the served branch, tag mode: a free tag is created through the forge
 *   release API at the pipeline commit, then read back through git; a 201
 *   that does not leave the tag at that commit is not a success.
 * - Anywhere else, or with `--check`: nothing is created, the same refusal
 *   applies, so a branch that did not bump the version is red before merge.
 * - Tag already at the commit: nothing to do (an idempotent rerun).
 * - Tag at another commit: refused — one release per commit.
 *
 * Exit codes: 0 done or already done; 1 refusal (tag elsewhere, malformed
 * version); 2 usage, missing or malformed variable, unreadable version file;
 * 3 forge or git unreachable, or an unexpected answer. An unreadable remote is
 * never a free tag.
 *
 * Inputs are the CI variables GITHUB_SERVER_URL, GITHUB_REPOSITORY,
 * GITHUB_API_URL, GITHUB_SHA, GITHUB_REF (the full ref: tag mode needs
 * `refs/heads/<served branch>`, so a pushed tag of the same short name is not
 * the branch) and GITHUB_TOKEN (GITHUB_API_URL and GITHUB_TOKEN read only when
 * a tag must be created). Each git or forge call is bounded to 30 s; ls-remote
 * refs that only end like the ones asked about are counted and set aside. Of a
 * forge answer only the HTTP status is printed, plus, on a refusal, its
 * `message` with the token removed, control characters neutralised and the
 * length bounded to 200. Any other error is code 3, printed by name only.
 *
 * Release notes are out of scope: the release is created bare.
 */
import { resolve } from "node:path";

export type TagReleaseCode = 0 | 1 | 2 | 3;

export interface TagReleaseInput {
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly repositoryRoot: string;
  /** Bound on each git or forge call; 30 s when absent. */
  readonly timeoutMs?: number;
}

export interface TagReleaseResult {
  readonly code: TagReleaseCode;
  readonly lines: readonly string[];
}

const VERSION_LINE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\n?$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF = /^refs\/[A-Za-z0-9._/-]+$/;
const BRANCH_PREFIX = "refs/heads/";
const TOKEN = /^[\x21-\x7e]+$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MESSAGE_LIMIT = 200;
const REQUEST_TIMEOUT_MS = 30_000;

/** Usage, a missing variable or an unreadable file: code 2. */
class UsageError extends Error {}
/** Git or the forge did not answer, or answered something unexpected: code 3. */
class UnreachableError extends Error {}

interface RemoteState {
  readonly servedBranch: string;
  /** Commit the tag points at (peeled), or null when the tag is free. */
  readonly tagCommit: string | null;
  readonly refLines: number;
  /** Lines naming a ref that only ends like one asked about. */
  readonly ignored: number;
}

function required(environment: TagReleaseInput["environment"], name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) throw new UsageError(`${name} is not set`);
  return value;
}

function matching(
  environment: TagReleaseInput["environment"],
  name: string,
  pattern: RegExp,
): string {
  const value = required(environment, name);
  if (!pattern.test(value)) throw new UsageError(`${name} is malformed`);
  return value;
}

/** A URL that carries no credentials: it may be printed in an error. */
function parsedUrl(environment: TagReleaseInput["environment"], name: string): URL {
  let url: URL;
  try {
    url = new URL(required(environment, name));
  } catch {
    throw new UsageError(`${name} is not a URL`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new UsageError(`${name} must not carry credentials`);
  }
  return url;
}

function serverUrl(environment: TagReleaseInput["environment"]): string {
  const url = parsedUrl(environment, "GITHUB_SERVER_URL");
  if (url.protocol !== "https:" && url.protocol !== "file:") {
    throw new UsageError("GITHUB_SERVER_URL must be https: (or file: for a local remote)");
  }
  return url.href.replace(/\/+$/, "");
}

/** The token travels to this URL: cleartext is accepted on loopback only. */
function apiUrl(environment: TagReleaseInput["environment"]): string {
  const url = parsedUrl(environment, "GITHUB_API_URL");
  const loopback = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !loopback) {
    throw new UsageError("GITHUB_API_URL must be https: (http: on loopback only)");
  }
  return url.href.replace(/\/+$/, "");
}

function repositoryName(environment: TagReleaseInput["environment"]): string {
  const value = matching(environment, "GITHUB_REPOSITORY", REPOSITORY);
  if (value.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new UsageError("GITHUB_REPOSITORY is malformed");
  }
  return value;
}

/**
 * One ls-remote for both questions. Every line must be understood: a line of
 * an unexpected shape, a missing symbolic HEAD or a non-zero exit is code 3.
 * Git's stderr is not relayed: a remote configured with credentials would
 * otherwise print them.
 */
async function readRemote(remote: string, tag: string, timeoutMs: number): Promise<RemoteState> {
  const tagRef = `refs/tags/${tag}`;
  const peeledRef = `${tagRef}^{}`;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["git", "ls-remote", "--symref", remote, "HEAD", tagRef, peeledRef], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch {
    throw new UnreachableError("git could not be started");
  }
  const [stdout, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    proc.exited,
  ]);
  if (proc.signalCode !== null) throw new UnreachableError("git ls-remote did not answer");
  if (code !== 0) throw new UnreachableError(`git ls-remote exited ${code}`);

  let servedBranch: string | null = null;
  let direct: string | null = null;
  let peeled: string | null = null;
  let refLines = 0;
  let ignored = 0;
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    refLines += 1;
    const symref = /^ref: (\S+)\t(\S+)$/.exec(line);
    if (symref !== null) {
      const [, target, name] = symref;
      if (name === "HEAD" && target?.startsWith(BRANCH_PREFIX)) {
        servedBranch = target.slice(BRANCH_PREFIX.length);
      } else if (name !== "HEAD") {
        ignored += 1;
      }
      continue;
    }
    const entry = /^(\S+)\t(\S+)$/.exec(line);
    const [, commit, ref] = entry ?? [];
    if (commit === undefined || ref === undefined || !COMMIT.test(commit)) {
      throw new UnreachableError("git ls-remote returned a line it should not");
    }
    // ls-remote matches its patterns on the tail of a ref name: a branch named
    // `x/HEAD` or `refs/tags/<tag>` comes back too. It is not one of the refs
    // asked about, so it is counted and set aside, never read as the tag.
    if (ref === tagRef) direct = commit;
    else if (ref === peeledRef) peeled = commit;
    else if (ref !== "HEAD") ignored += 1;
  }
  if (servedBranch === null) throw new UnreachableError("the remote reports no served branch");
  return { servedBranch, tagCommit: peeled ?? direct, refLines, ignored };
}

/** The forge's own words, made safe to print. */
function boundedMessage(body: string, token: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const message = (parsed as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  const redacted = message.split(token).join("[redacted]");
  // A line break in the forge's words would start a log line of its own: a CI
  // runner reads `::command::` lines as instructions.
  const flat = Array.from(redacted, (character) => {
    const code = character.charCodeAt(0);
    const control = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    return control || code === 0x2028 || code === 0x2029 ? " " : character;
  }).join("");
  return flat.slice(0, MESSAGE_LIMIT);
}

async function createRelease(
  api: string,
  repository: string,
  token: string,
  tag: string,
  commit: string,
  timeoutMs: number,
  lines: string[],
): Promise<void> {
  let response: Response;
  let body: string;
  // The body is read inside the same try: a connection cut or the timeout
  // while it streams is the forge not answering, not an exception to escape.
  try {
    response = await fetch(`${api}/repos/${repository}/releases`, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tag_name: tag, target_commitish: commit, name: tag }),
    });
    body = await response.text();
  } catch {
    throw new UnreachableError("the release API did not answer");
  }
  lines.push(`forge: HTTP ${response.status}`);
  if (response.status !== 201) {
    const message = boundedMessage(body, token);
    if (message !== null) lines.push(`forge message: ${message}`);
    throw new UnreachableError("the forge did not create the release");
  }
}

async function decide(input: TagReleaseInput, lines: string[]): Promise<TagReleaseCode> {
  const [flag, ...extra] = input.args;
  if (extra.length > 0 || (flag !== undefined && flag !== "--check")) {
    throw new UsageError("usage: tag-release [--check]");
  }
  const checkOnly = flag === "--check";
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const environment = input.environment;
  const remote = `${serverUrl(environment)}/${repositoryName(environment)}.git`;
  const repository = repositoryName(environment);
  const commit = matching(environment, "GITHUB_SHA", COMMIT);
  // GITHUB_REF, not GITHUB_REF_NAME: the short name of a pushed tag can equal
  // the served branch's, and only the full ref tells them apart.
  const ref = matching(environment, "GITHUB_REF", REF);
  const branch = ref.startsWith(BRANCH_PREFIX) ? ref.slice(BRANCH_PREFIX.length) : null;

  let content: string;
  try {
    content = await Bun.file(resolve(input.repositoryRoot, "VERSION")).text();
  } catch {
    throw new UsageError("VERSION cannot be read");
  }
  const version = VERSION_LINE.exec(content)?.[0]?.trim();
  if (version === undefined) {
    lines.push("refused: VERSION must hold exactly one X.Y.Z line, digits only");
    return 1;
  }
  const tag = `v${version}`;
  lines.push(
    `version: ${version}`,
    `tag: ${tag}`,
    `commit: ${commit}`,
    `branch: ${branch ?? `none (${ref})`}`,
  );

  const before = await readRemote(remote, tag, timeoutMs);
  const tagging = !checkOnly && branch !== null && branch === before.servedBranch;
  lines.push(
    `remote: ${before.refLines} ref line(s) read, ${before.ignored} ignored, ` +
      `served branch ${before.servedBranch}, ` +
      `tag ${before.tagCommit === null ? "free" : `at ${before.tagCommit}`}`,
    `mode: ${tagging ? "tag" : "check"}`,
  );

  if (before.tagCommit === commit) {
    lines.push(`result: ${tag} already at ${commit}, nothing to do`);
    return 0;
  }
  if (before.tagCommit !== null) {
    lines.push(`refused: ${tag} is already at ${before.tagCommit}, one release per commit`);
    return 1;
  }
  if (!tagging) {
    lines.push(`result: ${tag} is free, nothing created`);
    return 0;
  }

  const api = apiUrl(environment);
  const token = matching(environment, "GITHUB_TOKEN", TOKEN);
  await createRelease(api, repository, token, tag, commit, timeoutMs, lines);

  const after = await readRemote(remote, tag, timeoutMs);
  if (after.tagCommit !== commit) {
    throw new UnreachableError(
      `the forge answered 201 but ${tag} is ${after.tagCommit === null ? "absent" : `at ${after.tagCommit}`}`,
    );
  }
  lines.push(`result: ${tag} created at ${commit}, read back`);
  return 0;
}

export async function tagRelease(input: TagReleaseInput): Promise<TagReleaseResult> {
  const lines: string[] = [];
  try {
    const code = await decide(input, lines);
    return { code, lines };
  } catch (error) {
    if (error instanceof UsageError) {
      lines.push(`usage error: ${error.message}`);
      return { code: 2, lines };
    }
    if (error instanceof UnreachableError) {
      lines.push(`unreachable: ${error.message}`);
      return { code: 3, lines };
    }
    // Anything else is an unexpected answer: code 3 with the lines already
    // gathered, never an uncaught exception whose exit 1 would read as a
    // refusal. Only the error's name is printed: its message may quote data.
    const name = error instanceof Error ? error.name : typeof error;
    lines.push(`unexpected: ${name}`);
    return { code: 3, lines };
  }
}

if (import.meta.main) {
  const result = await tagRelease({
    args: process.argv.slice(2),
    environment: process.env,
    repositoryRoot: resolve(import.meta.dir, "../.."),
  });
  for (const line of result.lines) console.log(line);
  process.exit(result.code);
}
