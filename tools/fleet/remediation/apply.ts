/**
 * Apply a remediation kit to one repository (lot L070).
 *
 *   bun tools/fleet/remediation/apply.ts <ticket> <owner/name> <work-branch> <title> [--apply]
 *
 * The kit is the output of `kit.ts` (lot L069): `<kit-root>/<ticket>/manifest.tsv`
 * (MANIFEST_COLUMNS, one line per repository) and the patch it names, relative
 * to `<kit-root>/<ticket>/`. Six columns are consumed: ticket, repository,
 * served_branch, base_sha, patch, replay.
 *
 * ENVIRONMENT (absent or empty: code 2):
 *
 *   REMEDIATION_KIT_DIR     the kit root, as given to `kit.ts`
 *   REMEDIATION_CLONES_DIR  source clones, `<dir>/<name>` per repository, whose
 *                           remote `origin` is the forge
 *
 * WHAT IT DOES, in this order, each step refusing before the next one runs:
 *
 *   1. reads the manifest line of the repository; its ticket must be the
 *      argument's, its patch a relative path without `..` inside the kit;
 *   2. requires every fetch and push URL of the clone's origin to designate
 *      `<owner/name>` (originProblem: https, ssh or scp-like naming exactly
 *      owner/name[.git], or a `file://` URL ending with it, the local forge of
 *      the tests), so the push lands where the pull request is opened;
 *      resolves the served branch by `git ls-remote --symref origin HEAD` in
 *      the clone (no branch name is written here), fetches it, and requires
 *      the branch to be the manifest's and its head to be exactly `base_sha`:
 *      a kit computed on another head is stale and never applied;
 *   3. refuses a work branch that exists locally or at origin, then creates a
 *      NEW worktree of the clone on `base_sha` and that branch: the clone's
 *      own working tree is never touched;
 *   4. `git apply --check`, and the refusals of `kit.ts` again on the patch as
 *      it is on disk (`git apply --summary`: no rename, no copy, no mode 120000
 *      or 160000), then `git apply`; the modified set read by
 *      `git status --porcelain` (untracked and ignored files included) must be
 *      non-empty and equal to the patch's paths (`git apply --numstat -z`);
 *      only those paths are added (`git add -f -- <paths>`: `-f` so that a
 *      file the patch creates under an ignore rule is not dropped);
 *   5. commits with `git commit -s`, the identity coming from the git
 *      configuration (never a `-c user.*`), then reads the message back once
 *      (WRITTEN_MESSAGE_FORMAT) and requires its last line to be the sign-off
 *      of `git config user.name` / `user.email` as the worktree resolves them.
 *
 * Without --apply nothing is written to the forge: no push, no `gh`. The
 * worktree stays for inspection and the cleanup commands are printed. With
 * --apply, exactly two forge writes: `git push origin HEAD:refs/heads/<branch>`
 * (never to the served branch: the branch must be `work/**`; its only forced
 * form is `--force-with-lease=refs/heads/<branch>:`, whose empty expected
 * value refuses the push once the branch exists at origin, so nothing is
 * overwritten nor fast-forwarded), then `gh pr create`. The pull request is
 * never merged.
 *
 * Git and gh receive PATH, HOME, TMPDIR, LANG and LC_ALL only (PASSED_VARIABLES
 * of `fleet-state.ts`, never an inherited GIT_* variable: a GIT_DIR or a
 * GIT_INDEX_FILE would aim the commands at another repository), plus
 * GIT_TERMINAL_PROMPT=0. Git also receives SSH_AUTH_SOCK (a fetch or a push
 * over ssh), and configuration by GIT_CONFIG_COUNT, never `-c`: always
 * `core.fsmonitor=false`, since the clone's configuration would otherwise run
 * a command on every index read; and `core.hooksPath` set to an empty
 * directory this tool owns, except for the commit and the push, which run the
 * operator's hooks (the gates `--no-verify` would skip; their effect is
 * checked afterwards). The commit identity is the operator's configuration.
 * gh also receives GH_TOKEN when it is set, and no prompt.
 *
 * Exit codes (EXIT): 0 local commit made (dry run) or pull request opened;
 * 2 usage; 3 input unreadable; 4 kit stale; 5 patch refused; 6 forge
 * unreadable; 7 forge write refused.
 */

import { lstat, mkdir, mkdtemp, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

import { printable } from "../../../ecosystem/fleet-gates";
import {
  DETECTOR_MAX_STDOUT_BYTES,
  DETECTOR_TIMEOUT_MS,
  groupProcessRunner,
  PASSED_VARIABLES,
  type ProcessRunner,
  repositoryNameError,
} from "../../../ecosystem/fleet-state";
import type { Parsed } from "../../quality/prd-model";
import { splitWrittenMessage, WRITTEN_MESSAGE_FORMAT } from "../bump-generation";
import { MANIFEST_COLUMNS, summaryProblems } from "./kit";

export const EXIT = {
  ok: 0,
  usage: 2,
  input: 3,
  stale: 4,
  patch: 5,
  forge: 6,
  write: 7,
} as const;
type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface CommandOutcome {
  readonly code: ExitCode;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

const USAGE =
  "usage: bun tools/fleet/remediation/apply.ts <ticket> <owner/name> <work-branch> <title> [--apply]";

/** Same alphabet as the ticket of `kit.ts`: it is a path segment of the kit. */
const TICKET = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** The only branches this tool pushes to; a served branch is never one of them. */
const WORK_PREFIX = "work/";
const SHA = /^[0-9a-f]{40}$/;
/** Same alphabet as the served branch accepted by `kit.ts`, and never an option. */
const SERVED_BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/;
const SERVED = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m;

// ------------------------------------------------------------------ arguments

export interface Arguments {
  readonly ticket: string;
  readonly repository: string;
  readonly branch: string;
  readonly title: string;
  readonly apply: boolean;
}

/**
 * A control character in the broad sense of `printable`: C0, DEL, C1, a line
 * or paragraph separator, a bidi mark or override. Each one would forge a
 * line or reorder text in a commit message or a pull request description.
 */
function hasControlCharacter(text: string): boolean {
  return printable(text) !== text;
}

/**
 * The positional arguments and the flag. The branch is checked again by
 * `git check-ref-format --branch`, which needs a process: see `runApply`.
 */
export function parseArguments(argv: readonly string[]): Parsed<Arguments> {
  const fail = (reason: string): Parsed<Arguments> => ({ ok: false, reason });
  if (argv.length < 4 || argv.length > 5) {
    return fail(`4 arguments and an optional --apply expected, got ${argv.length}`);
  }
  const [ticket = "", repository = "", branch = "", title = "", flag] = argv;
  if (flag !== undefined && flag !== "--apply") {
    return fail(`« ${printable(flag)} » is not --apply`);
  }
  if (!TICKET.test(ticket)) {
    return fail(`ticket « ${printable(ticket)} » is not a plain name (no /, no leading dot)`);
  }
  const refused = repositoryNameError(repository);
  if (refused !== null) return fail(refused);
  if (!branch.startsWith(WORK_PREFIX) || branch.length === WORK_PREFIX.length) {
    return fail(`work branch « ${printable(branch)} » is not under ${WORK_PREFIX}`);
  }
  if (title.trim() === "" || hasControlCharacter(title)) {
    return fail("the title is empty or holds a control character");
  }
  return { ok: true, value: { ticket, repository, branch, title, apply: flag === "--apply" } };
}

// ------------------------------------------------------------------ manifest

/** The six columns of the kit manifest this tool consumes. */
export interface Manifest {
  readonly ticket: string;
  readonly repository: string;
  readonly servedBranch: string;
  readonly baseSha: string;
  /** Relative to `<kit-root>/<ticket>/`. */
  readonly patch: string;
  /** The state measure's replay command, cited in the pull request. */
  readonly replay: string;
}

function patchPathProblem(path: string): string | null {
  if (path === "" || isAbsolute(path)) return `patch path « ${printable(path)} » is absolute`;
  if (path.split(/[/\\]/).some((segment) => segment === ".." || segment === "")) {
    return `patch path « ${printable(path)} » holds a .. or an empty segment`;
  }
  return null;
}

/**
 * The line of `repository` in a manifest written by `kit.ts`. Every line must
 * carry `ticket`: a manifest of another ticket is not this kit.
 */
export function readManifest(text: string, ticket: string, repository: string): Parsed<Manifest> {
  const fail = (reason: string): Parsed<Manifest> => ({ ok: false, reason: `manifest: ${reason}` });
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const [header, ...rows] = lines;
  if (header !== MANIFEST_COLUMNS.join("\t")) {
    return fail(`header is not ${MANIFEST_COLUMNS.join(" ")}`);
  }
  const column = (name: (typeof MANIFEST_COLUMNS)[number]): number =>
    MANIFEST_COLUMNS.indexOf(name);
  const matching: string[][] = [];
  for (const [index, row] of rows.entries()) {
    const cells = row.split("\t");
    if (cells.length !== MANIFEST_COLUMNS.length) {
      return fail(
        `line ${index + 2} has ${cells.length} cells, ${MANIFEST_COLUMNS.length} expected`,
      );
    }
    const lineTicket = cells[column("ticket")] ?? "";
    if (lineTicket !== ticket) {
      return fail(`line ${index + 2} is ticket « ${printable(lineTicket)} », not ${ticket}`);
    }
    if (cells[column("repository")] === repository) matching.push(cells);
  }
  const [cells] = matching;
  if (matching.length !== 1 || cells === undefined) {
    return fail(`${matching.length} line(s) for ${repository}, exactly 1 expected`);
  }
  const cell = (name: (typeof MANIFEST_COLUMNS)[number]): string => cells[column(name)] ?? "";
  const manifest: Manifest = {
    ticket,
    repository,
    servedBranch: cell("served_branch"),
    baseSha: cell("base_sha"),
    patch: cell("patch"),
    replay: cell("replay"),
  };
  if (!SERVED_BRANCH.test(manifest.servedBranch)) {
    return fail(`served_branch « ${printable(manifest.servedBranch)} » is not a branch name`);
  }
  if (!SHA.test(manifest.baseSha)) {
    return fail(`base_sha « ${printable(manifest.baseSha)} » is not 40 hexadecimal digits`);
  }
  const patchProblem = patchPathProblem(manifest.patch);
  if (patchProblem !== null) return fail(patchProblem);
  if (manifest.replay.trim() === "") return fail("replay is empty");
  // The other copied fields have closed alphabets; the replay is free text.
  if (hasControlCharacter(manifest.replay)) {
    return fail(`replay « ${printable(manifest.replay)} » holds a control character`);
  }
  return { ok: true, value: manifest };
}

// ------------------------------------------------------------------ checks

/** Why the kit no longer matches the served branch, or null. */
export function staleness(
  servedBranch: string,
  servedHead: string,
  manifest: Manifest,
): string | null {
  if (servedBranch !== manifest.servedBranch) {
    return `kit stale: the served branch is ${printable(servedBranch)}, the kit was computed on ${manifest.servedBranch}`;
  }
  if (servedHead !== manifest.baseSha) {
    return `kit stale: ${servedBranch} is at ${servedHead.slice(0, 8)}, the kit was computed on ${manifest.baseSha.slice(0, 8)}; compute the kit again`;
  }
  return null;
}

/** Why the modified set is not exactly the patch's, or null. */
export function changedSetProblem(
  patchPaths: readonly string[],
  statusPaths: readonly string[],
): string | null {
  if (patchPaths.length === 0) return "the patch changes no file";
  const patch = new Set(patchPaths);
  const status = new Set(statusPaths);
  const extra = [...status].filter((path) => !patch.has(path)).sort();
  const missing = [...patch].filter((path) => !status.has(path)).sort();
  if (extra.length === 0 && missing.length === 0) return null;
  return [
    "the modified set is not the patch's",
    ...(extra.length > 0 ? [`not in the patch: ${extra.map(printable).join(" ")}`] : []),
    ...(missing.length > 0 ? [`unchanged: ${missing.map(printable).join(" ")}`] : []),
  ].join("; ");
}

/** Why the written message does not end with the expected sign-off, or null. */
export function signOffProblem(message: string, name: string, email: string): string | null {
  const expected = `Signed-off-by: ${name} <${email}>`;
  const lines = message.trimEnd().split("\n");
  if (lines.at(-1) === expected) return null;
  if (lines.includes(expected)) return `« ${printable(expected)} » is not the last line`;
  return `« ${printable(expected)} » is absent from the commit message`;
}

/** Backticks one longer than the longest run in `text`, and at least `minimum`. */
function backtickFence(text: string, minimum: number): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(minimum, longest + 1));
}

/**
 * A Markdown code span holding `text` verbatim: a fence no run inside can
 * close, and one space of padding, which the renderer strips, when the text
 * starts or ends with a backtick or a space.
 */
function codeSpan(text: string): string {
  const fence = backtickFence(text, 1);
  const padded = /^[` ]|[` ]$/.test(text) ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
}

/**
 * The pull request description: ticket, base, files and the measure's
 * replay. The fields copied from the manifest hold no control character
 * (`readManifest`), the paths are made printable, and no path or replay can
 * close the code span or block it sits in.
 */
export function prBody(manifest: Manifest, paths: readonly string[]): string {
  const fence = backtickFence(manifest.replay, 3);
  return [
    `Remediation kit of ticket \`${manifest.ticket}\` for \`${manifest.repository}\`.`,
    "",
    `Computed on \`${manifest.baseSha}\`, the head of \`${manifest.servedBranch}\` when applied.`,
    "",
    `Files (${paths.length}):`,
    "",
    ...[...paths].sort().map((path) => `- ${codeSpan(printable(path))}`),
    "",
    "Replay of the state measure, after merge:",
    "",
    `${fence}sh`,
    manifest.replay,
    fence,
    "",
  ].join("\n");
}

/** Paths of `git apply --numstat -z`; null when an entry is a rename or a copy. */
function numstatPaths(stdout: string): string[] | null {
  const fields = stdout.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    if (field === "") continue;
    const match = /^(?:\d+|-)\t(?:\d+|-)\t(.*)$/s.exec(field);
    const path = match?.[1];
    // An empty path announces a rename or a copy: the two names follow.
    if (path === undefined || path === "") return null;
    paths.push(path);
  }
  return paths;
}

/** Paths of `git status --porcelain=v1 -z`; a rename's origin is skipped. */
function statusPaths(stdout: string): string[] {
  const fields = stdout.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    if (field.length < 4) continue;
    paths.push(field.slice(3));
    if (field[0] === "R" || field[0] === "C") index += 1;
  }
  return paths;
}

// ------------------------------------------------------------------ processes

type Ran =
  | { readonly ok: true; readonly code: number; readonly stdout: string; readonly stderr: string }
  | {
      readonly ok: false;
      readonly code: number | null;
      readonly stdout: string;
      readonly reason: string;
    };

async function runCommand(
  spawn: ProcessRunner,
  argv: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<Ran> {
  try {
    const result = await spawn(argv, { cwd, env });
    const stdout = new TextDecoder().decode(result.stdout);
    if (result.failure !== null) {
      return { ok: false, code: null, stdout, reason: result.failure };
    }
    if (result.exitCode !== 0) {
      const first = printable(result.stderr.trim().split("\n")[0] ?? "");
      const status =
        result.signal !== null ? `killed by ${result.signal}` : `exit ${result.exitCode}`;
      return {
        ok: false,
        code: result.exitCode,
        stdout,
        reason: first === "" ? status : `${status}: ${first}`,
      };
    }
    return { ok: true, code: 0, stdout, stderr: result.stderr };
  } catch (error) {
    // The runner rejects only when the program cannot be started.
    const text = error instanceof Error ? error.message : String(error);
    return { ok: false, code: null, stdout: "", reason: `cannot start: ${printable(text)}` };
  }
}

/** The caller's variables a child receives: PASSED_VARIABLES, never a GIT_* one. */
export function childEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const built: Record<string, string> = {};
  for (const name of PASSED_VARIABLES) {
    const value = environment[name];
    if (value !== undefined) built[name] = value;
  }
  built.GIT_TERMINAL_PROMPT = "0";
  return built;
}

/**
 * Git's environment: the children's, plus SSH_AUTH_SOCK (a push or a fetch
 * over ssh needs the operator's agent), plus configuration by GIT_CONFIG_COUNT,
 * which outranks every configuration file of the clone: `core.fsmonitor=false`
 * always (the clone's configuration would otherwise run a command on every
 * index read), and `core.hooksPath=<hooks>`, an empty directory this tool owns,
 * unless `operatorHooks`: the commit and the push run the operator's hooks,
 * the gates `--no-verify` would skip, and their effect is checked afterwards
 * (commit equal to the patch, sign-off last; a refused push is code 7).
 */
export function gitEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  hooks: string,
  operatorHooks: boolean,
): Record<string, string> {
  const built = childEnvironment(environment);
  const agent = environment.SSH_AUTH_SOCK;
  if (agent !== undefined && agent !== "") built.SSH_AUTH_SOCK = agent;
  const configuration: [string, string][] = [["core.fsmonitor", "false"]];
  if (!operatorHooks) configuration.push(["core.hooksPath", hooks]);
  built.GIT_CONFIG_COUNT = String(configuration.length);
  for (const [index, [key, value]] of configuration.entries()) {
    built[`GIT_CONFIG_KEY_${index}`] = key;
    built[`GIT_CONFIG_VALUE_${index}`] = value;
  }
  return built;
}

/** URL schemes an origin may use: authenticated transports, and `file` for a local forge. */
const ORIGIN_SCHEMES = new Set(["https:", "ssh:", "file:"]);
/** `[user@]host:path`, git's scp-like form; never `<transport>::<address>`. */
const SCP_LIKE = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:(?!:)(.*)$/;

/** The path segments an origin URL names, or why it is not a forge URL. */
function originSegments(url: string): { segments: string[]; local: boolean } | string {
  if (url.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return "it is not a URL";
    }
    if (!ORIGIN_SCHEMES.has(parsed.protocol)) return `its scheme ${parsed.protocol} is refused`;
    if (parsed.search !== "" || parsed.hash !== "") return "it holds a query or a fragment";
    if (parsed.pathname.includes("%")) return "its path is percent-encoded";
    return { segments: parsed.pathname.split("/").slice(1), local: parsed.protocol === "file:" };
  }
  const path = SCP_LIKE.exec(url)?.[1];
  if (path === undefined) return "it is neither a URL nor a host:owner/name address";
  return { segments: path.split("/"), local: false };
}

/**
 * Why `url`, a URL of the clone's origin, does not designate `repository`,
 * or null. A forge URL (https, ssh, scp-like) names exactly `owner/name`,
 * with an optional `.git`; a `file://` URL, the local forge of the tests,
 * ends with those two segments. GitHub names compare without case. The URL
 * itself is never printed: it may carry a credential.
 */
export function originProblem(url: string, repository: string): string | null {
  const refuse = (why: string): string =>
    `the clone's origin does not designate ${repository}: ${why}`;
  // `new URL` would resolve a `..` the transport may not: refuse it unread.
  if (url.split(/[/\\]/).some((segment) => segment === "." || segment === "..")) {
    return refuse("it holds a . or .. segment");
  }
  const read = originSegments(url);
  if (typeof read === "string") return refuse(read);
  const { segments, local } = read;
  if (!local && segments.length !== 2) return refuse("its path is not owner/name");
  const named = segments
    .slice(-2)
    .join("/")
    .replace(/\.git$/, "");
  if (segments.length < 2 || named.toLowerCase() !== repository.toLowerCase()) {
    return refuse(`it names « ${printable(named)} »`);
  }
  return null;
}

// ------------------------------------------------------------------ command

const VARIABLES = {
  kits: "REMEDIATION_KIT_DIR",
  clones: "REMEDIATION_CLONES_DIR",
} as const;

export interface ApplyDependencies {
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Replaces the process runner of git and gh. */
  readonly spawn?: ProcessRunner;
}

async function isInside(path: string, directory: string): Promise<boolean> {
  try {
    const real = await realpath(path);
    return real.startsWith(directory + sep) && (await lstat(real)).isFile();
  } catch {
    return false;
  }
}

export async function runApply(
  argv: readonly string[],
  deps: ApplyDependencies,
): Promise<CommandOutcome> {
  const out: string[] = [];
  const done = (code: ExitCode, ...stderr: string[]): CommandOutcome => ({
    code,
    stdout: out,
    stderr,
  });

  const parsed = parseArguments(argv);
  if (!parsed.ok) return done(EXIT.usage, parsed.reason, USAGE);
  const { ticket, repository, branch, title, apply } = parsed.value;
  const dirs = { kits: "", clones: "" };
  for (const [key, name] of Object.entries(VARIABLES) as [keyof typeof VARIABLES, string][]) {
    const value = deps.environment[name];
    if (value === undefined || value === "") return done(EXIT.usage, `${name} is not set`, USAGE);
    dirs[key] = resolve(value);
  }

  const spawn =
    deps.spawn ??
    groupProcessRunner({
      timeoutMs: DETECTOR_TIMEOUT_MS,
      maxStdoutBytes: DETECTOR_MAX_STDOUT_BYTES,
    });
  // The commit message, the pull request body and the empty hooks directory.
  const scratch = await mkdtemp(join(tmpdir(), "remediation-apply-scratch-"));
  try {
    const hooks = join(scratch, "hooks");
    await mkdir(hooks);
    return await applyKit(
      { ticket, repository, branch, title, apply },
      dirs,
      { spawn, environment: deps.environment, scratch, hooks },
      out,
      done,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface Context {
  readonly spawn: ProcessRunner;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Removed by the caller once the command ends. */
  readonly scratch: string;
  /** Empty, owned by this tool: the hooks path of every git call but commit and push. */
  readonly hooks: string;
}

async function applyKit(
  { ticket, repository, branch, title, apply }: Arguments,
  dirs: { readonly kits: string; readonly clones: string },
  { spawn, environment, scratch, hooks }: Context,
  out: string[],
  done: (code: ExitCode, ...stderr: string[]) => CommandOutcome,
): Promise<CommandOutcome> {
  const env = childEnvironment(environment);
  const quietEnv = gitEnvironment(environment, hooks, false);
  const hookedEnv = gitEnvironment(environment, hooks, true);
  const git = (cwd: string, ...args: string[]): Promise<Ran> =>
    runCommand(spawn, ["git", ...args], cwd, quietEnv);
  /** Commit and push: the operator's hooks run (see gitEnvironment). */
  const hookedGit = (cwd: string, ...args: string[]): Promise<Ran> =>
    runCommand(spawn, ["git", ...args], cwd, hookedEnv);

  const refFormat = await git(tmpdir(), "check-ref-format", "--branch", branch);
  if (!refFormat.ok) {
    if (refFormat.code === null) return done(EXIT.input, `git: ${refFormat.reason}`);
    return done(EXIT.usage, `work branch « ${printable(branch)} » is refused by git`, USAGE);
  }

  // 1. The kit.
  const kitDirectory = join(dirs.kits, ticket);
  let manifestText: string;
  try {
    manifestText = await readFile(join(kitDirectory, "manifest.tsv"), "utf8");
  } catch {
    return done(EXIT.input, `${printable(join(kitDirectory, "manifest.tsv"))}: unreadable`);
  }
  const read = readManifest(manifestText, ticket, repository);
  if (!read.ok) return done(EXIT.input, read.reason);
  const manifest = read.value;
  const realKit = await realpath(kitDirectory);
  const patch = resolve(realKit, manifest.patch);
  if (!(await isInside(patch, realKit))) {
    return done(EXIT.input, `patch ${printable(manifest.patch)}: not a file inside the kit`);
  }

  // 2. The source clone and the served branch.
  const name = repository.split("/")[1] ?? "";
  let clone: string;
  try {
    clone = await realpath(join(dirs.clones, name));
  } catch {
    return done(EXIT.input, `clone ${printable(join(dirs.clones, name))}: absent`);
  }
  const top = await git(clone, "rev-parse", "--show-toplevel");
  if (!top.ok || (await realpath(top.stdout.trim()).catch(() => "")) !== clone) {
    return done(EXIT.input, `clone ${printable(clone)}: not the top of a git repository`);
  }
  // Every fetch URL and every push URL of origin designates the argument's
  // repository: the push goes where the pull request is opened.
  for (const direction of [[], ["--push"]]) {
    const urls = await git(clone, "remote", "get-url", "--all", ...direction, "origin");
    if (!urls.ok) return done(EXIT.input, `clone ${printable(clone)}: no remote origin`);
    for (const url of urls.stdout.split("\n").filter((line) => line !== "")) {
      const problem = originProblem(url, repository);
      if (problem !== null) return done(EXIT.input, problem);
    }
  }

  const symref = await git(clone, "ls-remote", "--symref", "origin", "HEAD");
  if (!symref.ok) return done(EXIT.forge, `ls-remote --symref origin HEAD: ${symref.reason}`);
  const served = SERVED.exec(symref.stdout)?.[1];
  if (served === undefined) return done(EXIT.forge, "origin announces no symbolic HEAD");
  const tracking = `refs/remotes/origin/${served}`;
  const fetched = await git(
    clone,
    "fetch",
    "--quiet",
    "--no-tags",
    "origin",
    `+refs/heads/${served}:${tracking}`,
  );
  if (!fetched.ok) return done(EXIT.forge, `fetch ${printable(served)}: ${fetched.reason}`);
  const head = await git(clone, "rev-parse", "--verify", "--quiet", `${tracking}^{commit}`);
  if (!head.ok) return done(EXIT.forge, `cannot read the head of ${printable(served)}`);
  const stale = staleness(served, head.stdout.trim(), manifest);
  if (stale !== null) return done(EXIT.stale, stale);

  // 3. A new branch and a new worktree on the base.
  if (branch === served) return done(EXIT.input, `${branch} is the served branch`);
  const local = await git(clone, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
  if (local.ok) return done(EXIT.input, `${branch} already exists in the clone`);
  const remote = await git(clone, "ls-remote", "--heads", "origin", `refs/heads/${branch}`);
  if (!remote.ok) return done(EXIT.forge, `ls-remote --heads origin: ${remote.reason}`);
  if (remote.stdout.trim() !== "") return done(EXIT.input, `${branch} already exists at origin`);

  const parent = await mkdtemp(join(tmpdir(), "remediation-apply-"));
  const worktree = join(await realpath(parent), name);
  const added = await git(
    clone,
    "worktree",
    "add",
    "--quiet",
    "--no-track",
    "-b",
    branch,
    worktree,
    manifest.baseSha,
  );
  if (!added.ok) {
    await rmdir(parent).catch(() => undefined);
    return done(EXIT.input, `worktree add: ${added.reason}`);
  }
  const cleanup = [
    `cleanup: git -C ${clone} worktree remove ${worktree}`,
    `cleanup: git -C ${clone} branch -D ${branch}`,
  ];
  const refuse = (code: ExitCode, reason: string): CommandOutcome => done(code, reason, ...cleanup);

  const identity = await git(worktree, "config", "user.name");
  const mail = await git(worktree, "config", "user.email");
  const userName = identity.stdout.trim();
  const userEmail = mail.stdout.trim();
  if (!identity.ok || !mail.ok || userName === "" || userEmail === "") {
    return refuse(EXIT.input, "git config user.name / user.email: absent in the worktree");
  }

  // 4. The patch, and nothing else.
  const check = await git(worktree, "apply", "--check", patch);
  if (!check.ok) return refuse(EXIT.patch, `git apply --check: ${check.reason}`);
  const numstat = await git(worktree, "apply", "--numstat", "-z", patch);
  const paths = numstat.ok ? numstatPaths(numstat.stdout) : null;
  if (paths === null) {
    return refuse(EXIT.patch, "git apply --numstat: unreadable, or a rename or a copy");
  }
  // Same refusals as kit.ts: the patch on disk may not be the one it checked.
  const summary = await git(worktree, "apply", "--summary", patch);
  if (!summary.ok) return refuse(EXIT.patch, `git apply --summary: ${summary.reason}`);
  const refused = summaryProblems(summary.stdout);
  if (refused.length > 0) return refuse(EXIT.patch, refused.join("; "));
  const applied = await git(worktree, "apply", patch);
  if (!applied.ok) return refuse(EXIT.patch, `git apply: ${applied.reason}`);
  // Ignored files are listed too, one by one (`traditional` with
  // `--untracked-files=all`; `matching` names an ignored directory instead):
  // a patch may create one, and a parasite may be one.
  const status = await git(
    worktree,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignored=traditional",
  );
  if (!status.ok) return refuse(EXIT.patch, `git status: ${status.reason}`);
  const changed = changedSetProblem(paths, statusPaths(status.stdout));
  if (changed !== null) return refuse(EXIT.patch, changed);
  // `-f` adds a patch path an ignore rule matches; the set is the patch's, checked above.
  const staged = await git(worktree, "add", "-f", "--", ...paths);
  if (!staged.ok) return refuse(EXIT.patch, `git add: ${staged.reason}`);

  // 5. The signed commit, read back once.
  const messageFile = join(scratch, "message");
  await writeFile(
    messageFile,
    `${title}\n\nRemediation kit ${ticket} for ${repository}, computed on ${manifest.baseSha}.\n`,
  );
  const commit = await hookedGit(worktree, "commit", "--quiet", "-s", `--file=${messageFile}`);
  if (!commit.ok) return refuse(EXIT.patch, `git commit: ${commit.reason}`);
  const tree = await git(
    worktree,
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    "-z",
    "HEAD",
  );
  const committed = tree.ok ? tree.stdout.split("\0").filter((path) => path !== "") : [];
  const committedProblem = changedSetProblem(paths, committed);
  if (!tree.ok || committedProblem !== null) {
    return refuse(EXIT.patch, `the commit is not the patch: ${committedProblem ?? "unreadable"}`);
  }
  const written = await git(worktree, "log", "-1", `--format=${WRITTEN_MESSAGE_FORMAT}`);
  const message = written.ok ? splitWrittenMessage(written.stdout) : null;
  if (message === null) return refuse(EXIT.patch, "cannot read the written commit message");
  const signOff = signOffProblem(message.message, userName, userEmail);
  if (signOff !== null) return refuse(EXIT.patch, signOff);
  const sha = await git(worktree, "rev-parse", "HEAD");

  const line = `apply ${ticket} ${repository}: served=${served} base=${manifest.baseSha.slice(0, 8)} patch-files=${paths.length} committed=${committed.length} commit=${sha.stdout.trim().slice(0, 8)} branch=${branch}`;
  out.push(...[...paths].sort().map((path) => `apply ${ticket}: file ${printable(path)}`));
  if (!apply) {
    out.push(`${line} forge-writes=0 (dry run: no push, no gh)`, ...cleanup);
    return done(EXIT.ok);
  }

  // 6. The two forge writes. The lease with an empty expected value is the
  // only forced form this tool uses: it pushes only while the branch is
  // absent at origin, so a branch created since the check is refused, never
  // fast-forwarded nor overwritten.
  const pushed = await hookedGit(
    worktree,
    "push",
    "--quiet",
    `--force-with-lease=refs/heads/${branch}:`,
    "origin",
    `HEAD:refs/heads/${branch}`,
  );
  if (!pushed.ok) return refuse(EXIT.write, `push refused, no pull request: ${pushed.reason}`);
  const bodyFile = join(scratch, "body.md");
  await writeFile(bodyFile, prBody(manifest, paths));
  const ghEnvironment: Record<string, string> = { ...env, GH_PROMPT_DISABLED: "1" };
  const token = environment.GH_TOKEN;
  if (token !== undefined && token !== "") ghEnvironment.GH_TOKEN = token;
  const pr = await runCommand(
    spawn,
    [
      "gh",
      "pr",
      "create",
      "--repo",
      repository,
      "--base",
      served,
      "--head",
      branch,
      "--title",
      title,
      "--body-file",
      bodyFile,
    ],
    worktree,
    ghEnvironment,
  );
  if (!pr.ok) {
    return refuse(EXIT.write, `pushed ${branch}, but gh pr create failed: ${pr.reason}`);
  }
  out.push(`${line} forge-writes=2 pull-request=${printable(pr.stdout.trim())}`, ...cleanup);
  return done(EXIT.ok);
}

if (import.meta.main) {
  const outcome = await runApply(Bun.argv.slice(2), { environment: process.env });
  for (const line of outcome.stdout) console.log(line);
  for (const line of outcome.stderr) console.error(line);
  process.exit(outcome.code);
}
