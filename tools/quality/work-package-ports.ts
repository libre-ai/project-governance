import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  CommitDeclarations,
  Fact,
  IssueRead,
  LinkPorts,
  Trailer,
} from "./check-work-package-link";

/**
 * The real ports of the work-package gate: git for every repository read, the
 * GitHub GraphQL API for the issue alone.
 *
 * Why git and not the REST `contents` API: a file and an ancestry are
 * questions the protocol answers without a quota (gate-integrity section 4),
 * and the branch a repository serves is asked of the remote, never written
 * down (resolve-never-hardcode). The issue has no git form, so it is the one
 * read that goes through the API, with the token of the run.
 *
 * Security properties every port keeps:
 * - git is run through ONE injectable function, with an argument array (no
 *   shell) and an explicit minimal environment: nothing of the process
 *   environment is inherited but PATH, HOME is a fresh temporary directory,
 *   and the system and global configs are not read;
 * - every value that reaches an argument is validated first (a full commit of
 *   40 lowercase hexadecimal characters, `<owner>/<name>`, one of the two
 *   documents the gate reads), so no text a third party controls can become
 *   an option or a revision expression;
 * - the token goes to git through its environment (`GIT_CONFIG_*`) and to the
 *   API through the `Authorization` header, never through an argument, a URL
 *   or a message: every reason built from an outside message is redacted.
 * Every unreadable source is `ok: false` with a named cause, never a default.
 */

export interface GitInvocation {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface GitResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

/** The only way the ports run a process: `git` with an argument array, never a shell. */
export type RunGit = (invocation: GitInvocation) => Promise<GitResult>;

export const spawnGit: RunGit = async (invocation: GitInvocation): Promise<GitResult> => {
  const child = Bun.spawn(["git", ...invocation.args], {
    cwd: invocation.cwd,
    env: { ...invocation.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode]: [Uint8Array, string, number] = await Promise.all([
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
};

export interface RealPortsOptions {
  /** The token of the run; `null` when there is none (a public repository). */
  readonly token: string | null;
  /** The checkout of the pull request (GITHUB_WORKSPACE). */
  readonly workspace: string;
  /** `<owner>/<name>` of the pull request: its files may be read from the checkout. */
  readonly prRepo?: string;
  /** Base of the git URLs, `<serverUrl>/<owner>/<name>.git`. Default: https://github.com. */
  readonly serverUrl?: string;
  /** Endpoint of the GraphQL API. Default: https://api.github.com/graphql. */
  readonly graphqlUrl?: string;
  readonly fetch?: typeof fetch;
  readonly run?: RunGit;
  /** Where PATH is taken from, and nothing else. Default: the process environment. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const DEFAULT_SERVER_URL = "https://github.com";
const DEFAULT_GRAPHQL_URL = "https://api.github.com/graphql";

// The grammars of the gate (check-work-package-link.ts, OWNER_SOURCE and
// REPOSITORY_NAME_SOURCE), duplicated rather than imported: the gate imports
// this module, and a value import back would make a cycle. Whole-value
// anchors, no `m` flag.
const REPOSITORY: RegExp =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const FULL_COMMIT: RegExp = /^[0-9a-f]{40}$/;
/** The two documents the gate reads at a cited commit, and nothing else. */
const READABLE_PATHS: readonly string[] = ["docs/prd.md", "docs/cahier-des-charges.md"];
const SYMREF_LINE: RegExp = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/;
// A served branch name as an argument: a refspec under refs/heads/, so it can
// never start an option; anything outside this set is refused, not guessed.
const BRANCH_NAME: RegExp = /^[A-Za-z0-9._/-]+$/;
const SERVED_REF = "refs/served/head";

const STDERR_LIMIT = 300;

type Failure = { readonly ok: false; readonly reason: string };

const fail = (reason: string): Failure => ({ ok: false, reason });

const asciiLower = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

// `ignoreBOM: true`: the default decoder REMOVES a leading U+FEFF, so the first
// path of a diff, the first byte of a blob or of a trailer would reach the gate
// as a text other than the one git printed. Every byte is kept.
const decoder: TextDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** git output as text, byte for byte, or null when it is not valid UTF-8. */
export function decodeGitOutput(bytes: Uint8Array): string | null {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

const decode: (bytes: Uint8Array) => string | null = decodeGitOutput;

const UNIT_SEPARATOR = "\u001f";
const NUL = "\u0000";

/** The refusal of a range a shallow checkout may have cut (its boundary commits are inside it). */
export const SHALLOW_CUT_REASON =
  "the checkout is shallow and the range base..head may be cut: fetch with full history";

function commitProblem(label: string, sha: string): Failure | null {
  return FULL_COMMIT.test(sha)
    ? null
    : fail(
        `${label} ${JSON.stringify(sha)} is not a full commit of 40 lowercase hexadecimal characters`,
      );
}

function repositoryProblem(repo: string): Failure | null {
  return REPOSITORY.test(repo)
    ? null
    : fail(`repository ${JSON.stringify(repo)} is not <owner>/<name>`);
}

/** A fresh temporary directory for one port call, removed whatever happens. */
async function withScratch<T>(body: (directory: string) => Promise<T>): Promise<T> {
  const directory: string = await mkdtemp(join(tmpdir(), "work-package-gate-"));
  try {
    return await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function realPorts(options: RealPortsOptions): LinkPorts {
  const run: RunGit = options.run ?? spawnGit;
  const fetchImpl: typeof fetch = options.fetch ?? fetch;
  const serverUrl: string = options.serverUrl ?? DEFAULT_SERVER_URL;
  const graphqlUrl: string = options.graphqlUrl ?? DEFAULT_GRAPHQL_URL;
  const path: string = (options.env ?? process.env).PATH ?? "";
  const token: string | null = options.token === "" ? null : options.token;
  const basicCredential: string | null =
    token === null ? null : Buffer.from(`x-access-token:${token}`).toString("base64");

  /** Remove every form of the token from a text that came from outside. */
  function redact(text: string): string {
    let clean: string = text;
    for (const secret of [token, basicCredential]) {
      if (secret !== null) {
        clean = clean.split(secret).join("[redacted]");
      }
    }
    return clean;
  }

  function gitEnv(
    home: string,
    authenticated: boolean,
    ceiling: string | null = null,
  ): Record<string, string> {
    const env: Record<string, string> = {
      PATH: path,
      HOME: home,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    };
    if (ceiling !== null) {
      env.GIT_CEILING_DIRECTORIES = ceiling;
    }
    if (authenticated && basicCredential !== null) {
      env.GIT_CONFIG_COUNT = "1";
      env.GIT_CONFIG_KEY_0 = `http.${serverUrl}/.extraheader`;
      env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basicCredential}`;
    }
    return env;
  }

  async function git(
    args: readonly string[],
    cwd: string,
    env: Record<string, string>,
  ): Promise<GitResult | Failure> {
    try {
      return await run({ args, cwd, env });
    } catch (error) {
      const message: string = error instanceof Error ? error.message : String(error);
      return fail(`git could not be run (${redact(message)})`);
    }
  }

  function gitFailure(what: string, result: GitResult | Failure): Failure {
    if ("ok" in result) {
      return result;
    }
    const stderr: string = redact(result.stderr.trim().replaceAll("\n", " | ")).slice(
      0,
      STDERR_LIMIT,
    );
    return fail(`${what}: git exited with code ${result.exitCode} (${JSON.stringify(stderr)})`);
  }

  const succeeded = (result: GitResult | Failure): result is GitResult =>
    !("ok" in result) && result.exitCode === 0;

  const urlOf = (repo: string): string => `${serverUrl}/${repo}.git`;

  /**
   * Make sure the checkout holds both commits of the range. A shallow checkout
   * misses the base: a targeted fetch from `origin` brings both, with the
   * credential the checkout persisted (never the token in an argument).
   */
  async function ensureCommits(
    shas: readonly string[],
    env: Record<string, string>,
  ): Promise<Failure | null> {
    const missing: string[] = [];
    for (const sha of shas) {
      const present = await git(["cat-file", "-e", `${sha}^{commit}`], options.workspace, env);
      if ("ok" in present) {
        return present;
      }
      if (present.exitCode !== 0) {
        missing.push(sha);
      }
    }
    if (missing.length === 0) {
      return null;
    }
    await git(["fetch", "--no-tags", "--quiet", "origin", ...missing], options.workspace, env);
    for (const sha of missing) {
      const present = await git(["cat-file", "-e", `${sha}^{commit}`], options.workspace, env);
      if (!succeeded(present)) {
        return fail(`commit ${sha} is not in the checkout and could not be fetched from origin`);
      }
    }
    return null;
  }

  async function commitTrailers(
    baseSha: string,
    headSha: string,
  ): Promise<Fact<readonly CommitDeclarations[]>> {
    const invalid: Failure | null =
      commitProblem("base", baseSha) ?? commitProblem("head", headSha);
    if (invalid !== null) {
      return invalid;
    }
    return withScratch(async (home: string): Promise<Fact<readonly CommitDeclarations[]>> => {
      const env: Fact<Record<string, string>> = await workspaceEnv(home);
      if (!env.ok) {
        return env;
      }
      const absent: Failure | null = await ensureCommits([baseSha, headSha], env.value);
      if (absent !== null) {
        return absent;
      }
      // ONE walk of the range, the trailers parsed by git itself: one record
      // per commit, terminated by NUL (a commit message cannot carry one).
      const logged = await git(
        [
          "log",
          "-z",
          "--reverse",
          "--no-decorate",
          `--format=%H%x1f%(trailers:only,unfold,key_value_separator=%x1f)`,
          `${baseSha}..${headSha}`,
        ],
        options.workspace,
        env.value,
      );
      if (!succeeded(logged)) {
        return gitFailure(`the commits of ${baseSha}..${headSha} are unreadable`, logged);
      }
      const text: string | null = decode(logged.stdout);
      if (text === null) {
        return fail(`the commits of ${baseSha}..${headSha} are not valid UTF-8`);
      }
      const commits: Fact<readonly CommitDeclarations[]> = parseLogRecords(text);
      if (!commits.ok) {
        return commits;
      }
      const cut: Failure | null = await shallowCut(
        commits.value.map((commit) => commit.sha),
        env.value,
      );
      return cut ?? commits;
    });
  }

  /**
   * The checkout as a git repository, and the environment to read it with.
   *
   * Why: git walks UP from a directory that is not a repository root and reads
   * the enclosing repository, which is not the checkout of the pull request.
   * The workspace must be absolute, discovery stops at its parent
   * (`GIT_CEILING_DIRECTORIES`), and git must name the workspace itself as the
   * top of the work tree.
   */
  async function workspaceEnv(home: string): Promise<Fact<Record<string, string>>> {
    const workspace: string = options.workspace;
    if (!isAbsolute(workspace)) {
      return fail(`the workspace ${JSON.stringify(workspace)} is not an absolute path`);
    }
    let real: string;
    try {
      real = await realpath(workspace);
    } catch {
      return fail(`the workspace ${JSON.stringify(workspace)} does not exist`);
    }
    const env: Record<string, string> = gitEnv(home, false, dirname(real));
    const top = await git(["rev-parse", "--show-toplevel"], workspace, env);
    if (!succeeded(top)) {
      return gitFailure(`the workspace ${JSON.stringify(workspace)} is not a git repository`, top);
    }
    const decoded: string | null = decode(top.stdout);
    if (decoded === null) {
      return fail("the top of the workspace repository is not valid UTF-8");
    }
    const printed: string = decoded.replace(/\n$/, "");
    const printedReal: string | null = await realpath(printed).catch((): null => null);
    if (printedReal !== real) {
      return fail(
        `the workspace ${JSON.stringify(workspace)} is not the root of its repository (git names ${JSON.stringify(printed)})`,
      );
    }
    return { ok: true, value: env };
  }

  /**
   * A shallow checkout whose boundary commits (their parents are cut) fall
   * inside the range may have lost the earlier commits of the range, and a
   * declaration with them: refused, never read short. A boundary below `base`
   * cuts nothing of the range.
   */
  async function shallowCut(
    range: readonly string[],
    env: Record<string, string>,
  ): Promise<Failure | null> {
    const shallow = await git(["rev-parse", "--is-shallow-repository"], options.workspace, env);
    if (!succeeded(shallow)) {
      return gitFailure("whether the checkout is shallow is unreadable", shallow);
    }
    const answer: string | null = decode(shallow.stdout);
    if (answer === "false\n") {
      return null;
    }
    if (answer !== "true\n") {
      return fail(`git answered ${JSON.stringify(answer)} to whether the checkout is shallow`);
    }
    const located = await git(["rev-parse", "--git-path", "shallow"], options.workspace, env);
    const relative: string | null = succeeded(located) ? decode(located.stdout) : null;
    if (relative === null) {
      return fail("the list of shallow boundary commits cannot be located");
    }
    let boundary: string;
    try {
      boundary = await Bun.file(resolve(options.workspace, relative.replace(/\n$/, ""))).text();
    } catch {
      return fail("the list of shallow boundary commits is unreadable");
    }
    const boundaries: Set<string> = new Set(boundary.split("\n").filter((line) => line !== ""));
    const inside: string[] = range.filter((sha) => boundaries.has(sha));
    return inside.length === 0
      ? null
      : fail(`${SHALLOW_CUT_REASON} (boundary commit(s) inside the range: ${inside.join(", ")})`);
  }

  async function changedFiles(baseSha: string, headSha: string): Promise<Fact<readonly string[]>> {
    const invalid: Failure | null =
      commitProblem("base", baseSha) ?? commitProblem("head", headSha);
    if (invalid !== null) {
      return invalid;
    }
    return withScratch(async (home: string): Promise<Fact<readonly string[]>> => {
      const workspace: Fact<Record<string, string>> = await workspaceEnv(home);
      if (!workspace.ok) {
        return workspace;
      }
      const env: Record<string, string> = workspace.value;
      const absent: Failure | null = await ensureCommits([baseSha, headSha], env);
      if (absent !== null) {
        return absent;
      }
      // `--no-renames`: both sides of a rename are listed, so a source moved
      // into a documentation path is still seen at its source path. `-z`: the
      // paths are raw, never quoted, each terminated by NUL.
      const diff = await git(
        ["diff", "--name-only", "--no-renames", "-z", `${baseSha}...${headSha}`],
        options.workspace,
        env,
      );
      if (!succeeded(diff)) {
        return gitFailure(`the diff ${baseSha}...${headSha} is unreadable`, diff);
      }
      const text: string | null = decode(diff.stdout);
      if (text === null) {
        return fail("the changed paths are not valid UTF-8");
      }
      if (text === "") {
        return { ok: true, value: [] };
      }
      if (!text.endsWith("\u0000")) {
        return fail("the list of changed paths is truncated: its last path has no NUL terminator");
      }
      const paths: string[] = text.slice(0, -1).split("\u0000");
      if (paths.includes("")) {
        return fail("the list of changed paths holds an empty path");
      }
      return { ok: true, value: paths };
    });
  }

  async function readBlob(
    cwd: string,
    env: Record<string, string>,
    repo: string,
    sha: string,
    file: string,
  ): Promise<Fact<string>> {
    // `cat-file blob`: the raw content, never a textconv nor a tree listing.
    const blob = await git(["cat-file", "blob", `${sha}:${file}`], cwd, env);
    if (!succeeded(blob)) {
      return gitFailure(`${file} does not exist at ${repo}@${sha} or is unreadable`, blob);
    }
    const text: string | null = decode(blob.stdout);
    return text === null
      ? fail(`${file} at ${repo}@${sha} is not valid UTF-8`)
      : { ok: true, value: text };
  }

  const isPullRequestRepository = (repo: string): boolean =>
    options.prRepo !== undefined && asciiLower(options.prRepo) === asciiLower(repo);

  async function readFileAt(repo: string, sha: string, file: string): Promise<Fact<string>> {
    const invalid: Failure | null = repositoryProblem(repo) ?? commitProblem("commit", sha);
    if (invalid !== null) {
      return invalid;
    }
    if (!READABLE_PATHS.includes(file)) {
      return fail(`path ${JSON.stringify(file)} is not one of ${JSON.stringify(READABLE_PATHS)}`);
    }
    return withScratch(async (home: string): Promise<Fact<string>> => {
      // The checkout is only a shortcut: when it is not a usable repository
      // root, or lacks the commit, the remote is read instead.
      if (isPullRequestRepository(repo)) {
        const local: Fact<Record<string, string>> = await workspaceEnv(home);
        if (local.ok) {
          const present = await git(
            ["cat-file", "-e", `${sha}^{commit}`],
            options.workspace,
            local.value,
          );
          if (succeeded(present)) {
            return readBlob(options.workspace, local.value, repo, sha, file);
          }
        }
      }
      const env: Record<string, string> = gitEnv(home, true);
      const bare: string = join(home, "repository.git");
      const created = await git(["init", "--bare", "--quiet", bare], home, env);
      if (!succeeded(created)) {
        return gitFailure("a temporary repository could not be created", created);
      }
      const fetched = await git(
        ["fetch", "--no-tags", "--quiet", "--depth=1", urlOf(repo), sha],
        bare,
        env,
      );
      if (!succeeded(fetched)) {
        return gitFailure(`commit ${sha} could not be fetched from ${repo}`, fetched);
      }
      return readBlob(bare, env, repo, sha, file);
    });
  }

  async function isAncestorOfServedHead(repo: string, sha: string): Promise<Fact<boolean>> {
    const invalid: Failure | null = repositoryProblem(repo) ?? commitProblem("commit", sha);
    if (invalid !== null) {
      return invalid;
    }
    return withScratch(async (home: string): Promise<Fact<boolean>> => {
      const env: Record<string, string> = gitEnv(home, true);
      const listed = await git(["ls-remote", "--symref", urlOf(repo), "HEAD"], home, env);
      if (!succeeded(listed)) {
        return gitFailure(`the served branch of ${repo} is unreadable`, listed);
      }
      const advertised: string | null = decode(listed.stdout);
      if (advertised === null) {
        return fail(`the references ${repo} advertises are not valid UTF-8`);
      }
      const branches: string[] = [];
      for (const line of advertised.split("\n")) {
        const match: RegExpExecArray | null = SYMREF_LINE.exec(line);
        if (match !== null) {
          branches.push(match[1] as string);
        }
      }
      const [branch] = branches;
      if (branch === undefined || branches.length !== 1) {
        return fail(`${repo} names ${branches.length} served branch(es), expected exactly one`);
      }
      if (!BRANCH_NAME.test(branch) || branch.split("/").includes("..")) {
        return fail(
          `the served branch name ${JSON.stringify(branch)} of ${repo} is outside the readable set`,
        );
      }
      const bare: string = join(home, "repository.git");
      const created = await git(["init", "--bare", "--quiet", bare], home, env);
      if (!succeeded(created)) {
        return gitFailure("a temporary repository could not be created", created);
      }
      // Commits only: the ancestry needs no blob.
      const fetched = await git(
        [
          "fetch",
          "--no-tags",
          "--quiet",
          "--filter=blob:none",
          urlOf(repo),
          `+refs/heads/${branch}:${SERVED_REF}`,
          sha,
        ],
        bare,
        env,
      );
      if (!succeeded(fetched)) {
        return gitFailure(
          `the served branch and commit ${sha} could not be fetched from ${repo}`,
          fetched,
        );
      }
      const ancestry = await git(["merge-base", "--is-ancestor", sha, SERVED_REF], bare, env);
      if ("ok" in ancestry) {
        return ancestry;
      }
      if (ancestry.exitCode === 0) {
        return { ok: true, value: true };
      }
      if (ancestry.exitCode === 1) {
        return { ok: true, value: false };
      }
      return gitFailure(`the ancestry of ${sha} in ${repo} is unreadable`, ancestry);
    });
  }

  async function readIssue(repo: string, number: number): Promise<Fact<IssueRead>> {
    const invalid: Failure | null = repositoryProblem(repo);
    if (invalid !== null) {
      return invalid;
    }
    if (!Number.isSafeInteger(number) || number <= 0) {
      return fail(`issue number ${JSON.stringify(number)} is not a positive integer`);
    }
    if (token === null) {
      return fail("no token: the GitHub GraphQL API reads an issue only with one");
    }
    const [owner, name] = repo.split("/") as [string, string];
    let response: Response;
    try {
      response = await fetchImpl(graphqlUrl, {
        method: "POST",
        headers: {
          Authorization: `bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "libre-ai-work-package-gate",
        },
        body: JSON.stringify({ query: ISSUE_QUERY, variables: { owner, name, number } }),
      });
    } catch (error) {
      const message: string = error instanceof Error ? error.message : String(error);
      return fail(`the issue ${repo}#${number} could not be requested (${redact(message)})`);
    }
    if (!response.ok) {
      return fail(`the issue ${repo}#${number} could not be read: HTTP ${response.status}`);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(await response.text());
    } catch {
      return fail(`the answer for the issue ${repo}#${number} is not valid JSON`);
    }
    const read: Fact<IssueRead> = readIssuePayload(payload);
    return read.ok
      ? read
      : fail(`the issue ${repo}#${number} is unreadable: ${redact(read.reason)}`);
  }

  return { readIssue, readFileAt, isAncestorOfServedHead, commitTrailers, changedFiles };
}

/**
 * The records of `git log -z --format=%H%x1f%(trailers:only,unfold,key_value_separator=%x1f)`.
 *
 * Each record is the full commit, U+001F, then one line per trailer (unfolded,
 * a trailer is one line), and is terminated by NUL. A git key holds only
 * letters, digits and hyphens, so the first U+001F of a line splits key from
 * value exactly; a value may hold a later U+001F, it stays in the value.
 */
function parseLogRecords(text: string): Fact<readonly CommitDeclarations[]> {
  if (text === "") {
    return { ok: true, value: [] };
  }
  if (!text.endsWith(NUL)) {
    return fail("the list of commits is truncated: its last record has no NUL terminator");
  }
  const commits: CommitDeclarations[] = [];
  for (const record of text.slice(0, -1).split(NUL)) {
    const sha: string = record.slice(0, 40);
    if (!FULL_COMMIT.test(sha) || record.charAt(40) !== UNIT_SEPARATOR) {
      return fail(`git printed a commit record that does not start with a full commit and U+001F`);
    }
    const trailers: Trailer[] = [];
    for (const line of record.slice(41).split("\n")) {
      if (line === "") {
        continue;
      }
      const separator: number = line.indexOf(UNIT_SEPARATOR);
      if (separator === -1) {
        return fail(`git printed a trailer line of ${sha} without a key: ${JSON.stringify(line)}`);
      }
      trailers.push({ key: line.slice(0, separator), value: line.slice(separator + 1) });
    }
    commits.push({ sha, trailers });
  }
  return { ok: true, value: commits };
}

// ---------------------------------------------------------------------------
// The issue: one GraphQL query, its values as variables, never interpolated.
// ---------------------------------------------------------------------------

const ISSUE_QUERY = `query WorkPackageIssue($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      body
      lastEditedAt
      labels(first: 100) { nodes { name } pageInfo { hasNextPage } }
      timelineItems(itemTypes: [LABELED_EVENT, UNLABELED_EVENT], first: 100) {
        nodes {
          __typename
          ... on LabeledEvent { createdAt label { name } actor { __typename login } }
          ... on UnlabeledEvent { createdAt label { name } actor { __typename login } }
        }
        pageInfo { hasNextPage }
      }
    }
  }
}`;

const READY_LABEL = "ready";

interface LabelEvent {
  readonly labeled: boolean;
  readonly label: string;
  readonly actor: string | null;
  readonly at: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The nodes of a connection, or the reason they cannot be read whole. */
function connectionNodes(connection: unknown, what: string): Fact<readonly unknown[]> {
  if (!isRecord(connection) || !Array.isArray(connection.nodes) || !isRecord(connection.pageInfo)) {
    return fail(`the ${what} are not a connection`);
  }
  const more: unknown = connection.pageInfo.hasNextPage;
  if (more !== false) {
    return fail(
      more === true
        ? `too many ${what} to read in one page: a truncated read would not be the whole issue`
        : `the ${what} do not say whether a further page exists`,
    );
  }
  return { ok: true, value: connection.nodes };
}

function readTimestamp(value: unknown, what: string): Fact<number> {
  const at: number = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(at)
    ? fail(`${what} ${JSON.stringify(value)} is not a timestamp`)
    : { ok: true, value: at };
}

function readLabelEvent(node: unknown): Fact<LabelEvent> {
  if (
    !isRecord(node) ||
    (node.__typename !== "LabeledEvent" && node.__typename !== "UnlabeledEvent")
  ) {
    return fail("a timeline item is neither a labeled nor an unlabeled event");
  }
  const at: Fact<number> = readTimestamp(node.createdAt, "the date of a label event");
  if (!at.ok) {
    return at;
  }
  const label: unknown = isRecord(node.label) ? node.label.name : undefined;
  if (typeof label !== "string") {
    return fail("a label event names no label");
  }
  // A deleted account leaves a null actor: kept null, never a default login.
  // Only a `User` is an actor whose login can be an owner's: a `Bot` (a GitHub
  // App can take its owner's name, and its GraphQL login has no `[bot]`
  // suffix) or a `Mannequin` with the same login is an unknown actor, and so is
  // an actor whose type is not given. The gate then sees a `ready` label
  // without an actor and refuses the read as inconsistent.
  let actor: string | null = null;
  if (node.actor !== null) {
    if (!isRecord(node.actor)) {
      return fail("a label event has an actor that is not an object");
    }
    if (node.actor.__typename === "User") {
      const login: unknown = node.actor.login;
      if (typeof login !== "string") {
        return fail("a label event has a User actor without a login");
      }
      actor = login;
    }
  }
  return {
    ok: true,
    value: { labeled: node.__typename === "LabeledEvent", label, actor, at: at.value },
  };
}

/**
 * The `ready` event that still holds: the last `labeled` event of `ready` with
 * no `unlabeled` event of `ready` after it. The API lists timeline items in
 * chronological order; that order is the one followed, so two events of the
 * same second keep the order GitHub recorded.
 */
function holdingReadyEvent(events: readonly LabelEvent[]): LabelEvent | null {
  let holding: LabelEvent | null = null;
  for (const event of events) {
    // ASCII case only, as the gate compares it: `Ready` counts, U+212A does not fold.
    if (asciiLower(event.label) === READY_LABEL) {
      holding = event.labeled ? event : null;
    }
  }
  return holding;
}

/** Pure reading of the GraphQL answer for one issue. */
function readIssuePayload(payload: unknown): Fact<IssueRead> {
  if (!isRecord(payload)) {
    return fail("the answer is not an object");
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const first: unknown = isRecord(payload.errors[0]) ? payload.errors[0].message : undefined;
    return fail(
      `GraphQL answered ${payload.errors.length} error(s), first: ${JSON.stringify(first)}`,
    );
  }
  const repository: unknown = isRecord(payload.data) ? payload.data.repository : undefined;
  if (!isRecord(repository)) {
    return fail("the repository is absent or not readable with this token");
  }
  const issue: unknown = repository.issue;
  if (!isRecord(issue)) {
    return fail("the issue does not exist or is not readable with this token");
  }
  if (typeof issue.body !== "string") {
    return fail("the issue body is not a string");
  }
  const labelNodes: Fact<readonly unknown[]> = connectionNodes(issue.labels, "labels");
  if (!labelNodes.ok) {
    return labelNodes;
  }
  const labels: string[] = [];
  for (const node of labelNodes.value) {
    const name: unknown = isRecord(node) ? node.name : undefined;
    if (typeof name !== "string") {
      return fail("a label has no name");
    }
    labels.push(name);
  }
  const timeline: Fact<readonly unknown[]> = connectionNodes(issue.timelineItems, "timeline items");
  if (!timeline.ok) {
    return timeline;
  }
  const events: LabelEvent[] = [];
  for (const node of timeline.value) {
    const event: Fact<LabelEvent> = readLabelEvent(node);
    if (!event.ok) {
      return event;
    }
    events.push(event.value);
  }
  // The contract: no actor when the issue does not carry `ready` now, whatever
  // the timeline holds.
  const carriesReady: boolean = labels.some((name) => asciiLower(name) === READY_LABEL);
  const ready: LabelEvent | null = carriesReady ? holdingReadyEvent(events) : null;
  let bodyEditedAfterReady = false;
  if (issue.lastEditedAt !== null) {
    const edited: Fact<number> = readTimestamp(issue.lastEditedAt, "the last edit of the body");
    if (!edited.ok) {
      return edited;
    }
    // `>=`, failing closed: timestamps have a one-second precision, and an
    // issue author can edit the body without write access, so an edit in the
    // same second as the label is counted as after it. The cost: an edit in
    // the same second just BEFORE the label also cancels the ready.
    bodyEditedAfterReady = ready !== null && edited.value >= ready.at;
  }
  return {
    ok: true,
    value: {
      body: issue.body,
      labels,
      readyLabeledBy: ready === null ? null : ready.actor,
      bodyEditedAfterReady,
    },
  };
}
