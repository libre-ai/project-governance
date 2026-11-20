/**
 * Forge snapshot: the facts of forge read once, all or nothing.
 *
 *   bun ecosystem/forge-snapshot.ts <output-dir> <owner/name>...
 *
 * Detectors that judge a repository against its forge settings stay pure
 * functions of a worktree and of this snapshot: this collector is the only
 * place that calls the network. For every requested repository it reads,
 * through the `gh` CLI, the default branch, the sorted list of protected
 * branches and the number of scheduled workflow runs (cron entries of the
 * workflows at the default branch), and dates the read in ISO 8601. `gh`
 * honours `GH_HOST` natively, which is how another forge host is chosen.
 *
 * WHY ALL OR NOTHING. A half-written snapshot would make detectors say
 * "nothing" about what could not be read. Every forge error, empty response,
 * missing field or unexpected type therefore interrupts the run, and no file
 * is written until every repository has been read.
 *
 * HOW IT IS PUBLISHED. The whole snapshot is written to a staging directory
 * beside the output directory, then published by renaming. The output
 * directory is the snapshot: a previous one is replaced whole, never merged.
 * Replacing an existing directory takes two renames (previous aside, staging
 * in); between them the output path is absent for a moment, never partial. If
 * the second rename fails the first is undone; if the process dies between
 * them, the previous snapshot stays beside the output, named
 * `.<output>.forge-snapshot-*.previous`. On any write failure the output is
 * left as it was and the staging directory is removed.
 *
 * WHY NO LINK. The output directory must be absent, or hold a previous
 * snapshot only: real owner directories holding regular `.json` files. A
 * symbolic link at or below it would make a write land outside it, and
 * anything else would be deleted by the replacement, so both are refused
 * before any network call. Links above it (the parent, resolved by realpath,
 * such as /var on macOS) are where the caller chose to put it, and are kept.
 *
 * WHY THE PERIMETER FIRST. Only repositories of `ecosystem/repositories.v1.yaml`
 * may be read, and a private one is refused: the CI token cannot read it, so a
 * cross-repository read would either fail or require more authority than the
 * gates hold. Both refusals happen before any network call.
 *
 * Exit codes: 0 written, 1 read or write failed (the output is unchanged),
 * 2 usage (including a refused output directory), 3 repository outside the
 * perimeter.
 */

import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { buildIndex, type Visibility } from "./build-index";

export interface ForgeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `gh` with an argument vector — never a shell string. */
export type ForgeRunner = (args: readonly string[]) => Promise<ForgeResult>;

export interface SnapshotDependencies {
  readonly run: ForgeRunner;
  /** Inventory repositories and their visibility: anything absent is out of perimeter. */
  readonly perimeter: ReadonlyMap<string, Visibility>;
  readonly now: () => Date;
}

export interface SnapshotOutcome {
  readonly code: 0 | 1 | 2 | 3;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

interface RepositorySnapshot {
  readonly repository: string;
  readonly collected_at: string;
  readonly default_branch: string;
  readonly protected_branches: readonly string[];
  readonly schedules: number;
}

/** Any reason the forge facts of a repository could not be established. */
class ForgeReadError extends Error {}

const USAGE = "usage: bun ecosystem/forge-snapshot.ts <output-dir> <owner/name>...";

/**
 * One path segment of a repository name. Refusing `.` and `..` keeps every
 * output file under the output directory, whatever the arguments say.
 */
const NAME_SEGMENT = /^[A-Za-z0-9_.-]+$/;

function isRepositoryName(value: string): boolean {
  const segments = value.split("/");
  return (
    segments.length === 2 &&
    segments.every((segment) => NAME_SEGMENT.test(segment) && segment !== "." && segment !== "..")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The output of `gh api --paginate --slurp`: an outer array holding one JSON
 * document per page. Pages of arrays are concatenated; a single object page
 * is returned as is. An empty response, several object pages or a mix of
 * shapes is an error — none of them can be read as an answer.
 */
export function mergePages(text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ForgeReadError("forge response is not JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ForgeReadError("forge response carries no page");
  }
  if (parsed.every((page) => Array.isArray(page))) {
    return parsed.flat();
  }
  const [only] = parsed;
  if (parsed.length === 1 && isRecord(only)) return only;
  throw new ForgeReadError("forge pages are neither all arrays nor a single object");
}

const ON_KEY = /^(?:on|"on"|'on')\s*:/;
const SCHEDULE_KEY = /^(?:schedule|"schedule"|'schedule')\s*:/;

/**
 * Bun.YAML.parse keeps the last of two equal keys without saying so: a second
 * top-level `on`, or a second `schedule` directly under `on`, would hide the
 * cron entries of the first. Both are refused.
 *
 * shortcut: block style only — a duplicate inside a flow mapping
 * (`on: {schedule: [...], schedule: [...]}`) is not seen. Upgrade trigger: a
 * YAML parser in the toolchain that reports duplicate keys.
 */
function refuseDuplicatedTriggers(workflowText: string): void {
  let onKeys = 0;
  let insideOn = false;
  let childIndent: number | null = null;
  let scheduleKeys = 0;
  for (const line of workflowText.split("\n")) {
    const content = line.trimStart();
    if (content === "" || content.startsWith("#")) continue;
    const indent = line.length - content.length;
    if (indent === 0) {
      insideOn = ON_KEY.test(content);
      if (insideOn) {
        onKeys += 1;
        childIndent = null;
        if (onKeys > 1) throw new ForgeReadError("workflow has a duplicated `on` key");
      }
      continue;
    }
    if (!insideOn) continue;
    childIndent ??= indent;
    if (indent === childIndent && SCHEDULE_KEY.test(content)) {
      scheduleKeys += 1;
      if (scheduleKeys > 1) throw new ForgeReadError("workflow has a duplicated `on.schedule` key");
    }
  }
}

/**
 * Cron entries of one workflow's `schedule` trigger. `on` may be a string or
 * a list of event names (no schedule then); a `schedule` that is not a list,
 * or a document without `on`, is an unexpected type.
 */
export function countSchedules(workflowText: string): number {
  // Only U+0000, not the whole class of tools/quality/yaml-text-guard.ts: that
  // guard also refuses a tab, which a legitimate `run:` block may carry, and one
  // such workflow would then interrupt every snapshot. The NUL is the character
  // at which Bun.YAML.parse may stop without saying so, under-counting the cron
  // entries after it; no line scan runs before this parse, so the guard's other
  // reason (a scan and a parser reading two documents) does not arise here.
  const nul = workflowText.indexOf("\u0000");
  if (nul !== -1) {
    const line = workflowText.slice(0, nul).split("\n").length;
    throw new ForgeReadError(`workflow holds an unreadable character U+0000 on line ${line}`);
  }
  let document: unknown;
  try {
    document = Bun.YAML.parse(workflowText);
  } catch {
    throw new ForgeReadError("workflow is not valid YAML");
  }
  if (!isRecord(document)) throw new ForgeReadError("workflow is not a mapping");
  refuseDuplicatedTriggers(workflowText);
  const trigger = document.on;
  if (typeof trigger === "string" || Array.isArray(trigger)) return 0;
  if (!isRecord(trigger)) throw new ForgeReadError("workflow has no readable `on` trigger");
  if (!("schedule" in trigger)) return 0;
  if (!Array.isArray(trigger.schedule)) {
    throw new ForgeReadError("workflow `on.schedule` is not a list");
  }
  return trigger.schedule.length;
}

/** First line of the tool's diagnostic, bounded so no response body reaches the log. */
function diagnostic(stderr: string): string {
  const first = stderr.trim().split("\n")[0] ?? "";
  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}

async function call(run: ForgeRunner, args: readonly string[]): Promise<string> {
  let result: ForgeResult;
  try {
    result = await run(args);
  } catch (error) {
    throw new ForgeReadError(
      `gh could not be run: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.exitCode !== 0) {
    throw new ForgeReadError(`gh exit ${result.exitCode}: ${diagnostic(result.stderr)}`);
  }
  return result.stdout;
}

async function readRest(run: ForgeRunner, endpoint: string): Promise<unknown> {
  return mergePages(await call(run, ["api", "--paginate", "--slurp", endpoint]));
}

const WORKFLOWS_QUERY = `query($owner: String!, $name: String!, $expression: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $expression) {
      ... on Tree { entries { name type object { ... on Blob { text isBinary isTruncated } } } }
    }
  }
}`;

const WORKFLOW_FILE = /\.ya?ml$/;

/**
 * Cron entries across the workflows at the default branch, in one GraphQL
 * request (variables passed as fields, never spliced into the query). A
 * `null` object inside a successful, error-free response is GitHub's answer
 * that the directory does not exist — zero schedules, not an unread one.
 */
async function readSchedules(
  run: ForgeRunner,
  repository: string,
  defaultBranch: string,
): Promise<number> {
  const [owner, name] = repository.split("/") as [string, string];
  const text = await call(run, [
    "api",
    "graphql",
    "-f",
    `query=${WORKFLOWS_QUERY}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-f",
    `expression=${defaultBranch}:.github/workflows`,
  ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ForgeReadError("workflow listing is not JSON");
  }
  if (!isRecord(parsed) || "errors" in parsed || !isRecord(parsed.data)) {
    throw new ForgeReadError("workflow listing carries errors or no data");
  }
  const repositoryNode = parsed.data.repository;
  if (!isRecord(repositoryNode) || !("object" in repositoryNode)) {
    throw new ForgeReadError("workflow listing carries no repository object");
  }
  const tree = repositoryNode.object;
  if (tree === null) return 0;
  if (!isRecord(tree) || !Array.isArray(tree.entries)) {
    throw new ForgeReadError("workflow directory is not a readable tree");
  }
  let schedules = 0;
  for (const entry of tree.entries) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.type !== "string") {
      throw new ForgeReadError("workflow entry has no name or type");
    }
    if (entry.type !== "blob" || !WORKFLOW_FILE.test(entry.name)) continue;
    const blob = entry.object;
    if (
      !isRecord(blob) ||
      blob.isBinary !== false ||
      blob.isTruncated !== false ||
      typeof blob.text !== "string"
    ) {
      throw new ForgeReadError(`workflow ${entry.name} has no complete text`);
    }
    schedules += countSchedules(blob.text);
  }
  return schedules;
}

async function collectRepository(
  deps: SnapshotDependencies,
  repository: string,
): Promise<RepositorySnapshot> {
  const info = await readRest(deps.run, `repos/${repository}`);
  if (!isRecord(info) || typeof info.default_branch !== "string" || info.default_branch === "") {
    throw new ForgeReadError("response carries no default branch");
  }
  const defaultBranch = info.default_branch;

  const branches = await readRest(
    deps.run,
    `repos/${repository}/branches?protected=true&per_page=100`,
  );
  if (!Array.isArray(branches)) throw new ForgeReadError("protected branches are not a list");
  const protectedBranches = branches.map((branch) => {
    if (!isRecord(branch) || typeof branch.name !== "string") {
      throw new ForgeReadError("protected branch entry has no name");
    }
    return branch.name;
  });
  // Code-unit order, not localeCompare: identical on every machine and locale.
  protectedBranches.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const schedules = await readSchedules(deps.run, repository, defaultBranch);
  return {
    repository,
    collected_at: deps.now().toISOString(),
    default_branch: defaultBranch,
    protected_branches: protectedBranches,
    schedules,
  };
}

/** Any reason the output directory cannot receive a snapshot. */
class OutputError extends Error {}

/** Where the snapshot is published: `target` sits in the real path of its parent. */
interface OutputTarget {
  readonly parent: string;
  readonly base: string;
  readonly target: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * The output directory is absent, or holds a previous snapshot and nothing
 * else: real owner directories holding regular `.json` files. A link at or
 * below it, or any other entry, is refused (see the header).
 */
async function inspectOutput(target: string): Promise<"absent" | "snapshot"> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(target);
  } catch (error) {
    if (isMissing(error)) return "absent";
    throw new OutputError(`output directory is not readable: ${errorText(error)}`);
  }
  if (stat.isSymbolicLink()) throw new OutputError("output directory is a symbolic link");
  if (!stat.isDirectory()) throw new OutputError("output path is not a directory");
  try {
    // Dirent types come from lstat: a link is neither a directory nor a file.
    for (const owner of await readdir(target, { withFileTypes: true })) {
      if (owner.isSymbolicLink()) {
        throw new OutputError(`output entry ${owner.name} is a symbolic link`);
      }
      if (!owner.isDirectory()) {
        throw new OutputError(`output entry ${owner.name} is not part of a previous snapshot`);
      }
      for (const file of await readdir(join(target, owner.name), { withFileTypes: true })) {
        const entry = `${owner.name}/${file.name}`;
        if (file.isSymbolicLink()) {
          throw new OutputError(`output entry ${entry} is a symbolic link`);
        }
        if (!file.isFile() || !file.name.endsWith(".json")) {
          throw new OutputError(`output entry ${entry} is not part of a previous snapshot`);
        }
      }
    }
  } catch (error) {
    if (error instanceof OutputError) throw error;
    throw new OutputError(`output directory is not readable: ${errorText(error)}`);
  }
  return "snapshot";
}

async function settleOutput(outputDir: string): Promise<OutputTarget> {
  const absolute = resolve(outputDir);
  const base = basename(absolute);
  if (base === "" || dirname(absolute) === absolute) {
    throw new OutputError("output directory cannot be the file system root");
  }
  let parent: string;
  try {
    parent = await realpath(dirname(absolute));
  } catch (error) {
    throw new OutputError(`output parent directory is not readable: ${errorText(error)}`);
  }
  const target = join(parent, base);
  await inspectOutput(target);
  return { parent, base, target };
}

function stagedPath(staging: string, repository: string): string {
  const target = resolve(staging, `${repository}.json`);
  // Names are validated above; this is the last line that refuses an escape.
  if (!target.startsWith(staging + sep)) {
    throw new Error(`output path escapes the output directory: ${repository}`);
  }
  return target;
}

/**
 * Writes every file into a fresh staging directory beside the output, then
 * publishes it by renaming. Throws with the output unchanged, except in the
 * documented window between the two renames of a replacement. Returns the
 * notices of a published snapshot (a previous one that could not be removed).
 */
async function publish(
  output: OutputTarget,
  snapshots: readonly RepositorySnapshot[],
): Promise<string[]> {
  const staging = await mkdtemp(join(output.parent, `.${output.base}.forge-snapshot-`));
  let published = false;
  try {
    for (const snapshot of snapshots) {
      const target = stagedPath(staging, snapshot.repository);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
    }
    // The reads took time: the output is inspected again just before it is replaced.
    if ((await inspectOutput(output.target)) === "absent") {
      await rename(staging, output.target);
      published = true;
      return [];
    }
    const previous = `${staging}.previous`;
    await rename(output.target, previous);
    try {
      await rename(staging, output.target);
    } catch (error) {
      try {
        await rename(previous, output.target);
      } catch (restore) {
        throw new Error(
          `${errorText(error)}; the previous snapshot could not be put back and is at ${previous}: ${errorText(restore)}`,
        );
      }
      throw error;
    }
    published = true;
    try {
      await rm(previous, { recursive: true });
    } catch (error) {
      return [`previous snapshot could not be removed, left at ${previous}: ${errorText(error)}`];
    }
    return [];
  } finally {
    if (!published) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function runSnapshot(
  argv: readonly string[],
  deps: SnapshotDependencies,
): Promise<SnapshotOutcome> {
  const [outputDir, ...repositories] = argv;
  if (outputDir === undefined || outputDir === "" || repositories.length === 0) {
    return { code: 2, stdout: [], stderr: [USAGE] };
  }
  const malformed = repositories.filter((repository) => !isRepositoryName(repository));
  if (malformed.length > 0) {
    return {
      code: 2,
      stdout: [],
      stderr: [`malformed repository name(s), expected owner/name: ${malformed.join(", ")}`, USAGE],
    };
  }
  if (new Set(repositories).size !== repositories.length) {
    return { code: 2, stdout: [], stderr: ["a repository is requested more than once", USAGE] };
  }

  const refused = repositories.filter((repository) => deps.perimeter.get(repository) !== "public");
  if (refused.length > 0) {
    return {
      code: 3,
      stdout: [],
      stderr: refused.map((repository) =>
        deps.perimeter.has(repository)
          ? `${repository}: private repository refused`
          : `${repository}: not in the repository inventory`,
      ),
    };
  }

  let output: OutputTarget;
  try {
    output = await settleOutput(outputDir);
  } catch (error) {
    if (!(error instanceof OutputError)) throw error;
    return { code: 2, stdout: [], stderr: [`${outputDir}: ${error.message}`, USAGE] };
  }

  const snapshots: RepositorySnapshot[] = [];
  for (const repository of repositories) {
    try {
      snapshots.push(await collectRepository(deps, repository));
    } catch (error) {
      if (!(error instanceof ForgeReadError)) throw error;
      const notAttempted = repositories.length - snapshots.length - 1;
      return {
        code: 1,
        stdout: [
          `forge snapshot: requested=${repositories.length} collected=${snapshots.length} failed=1 not_attempted=${notAttempted} written=0`,
        ],
        stderr: [`${repository}: ${error.message}`],
      };
    }
  }

  let notices: string[];
  try {
    notices = await publish(output, snapshots);
  } catch (error) {
    return {
      code: 1,
      stdout: [
        `forge snapshot: requested=${repositories.length} collected=${snapshots.length} written=0`,
      ],
      stderr: [`write failed: ${errorText(error)}`],
    };
  }
  return {
    code: 0,
    stdout: [
      `forge snapshot: requested=${repositories.length} collected=${snapshots.length} written=${snapshots.length}`,
    ],
    stderr: notices,
  };
}

const runGh: ForgeRunner = async (args) => {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

if (import.meta.main) {
  const inventory = buildIndex(
    await Bun.file(join(import.meta.dir, "repositories.v1.yaml")).text(),
  );
  const perimeter = new Map(
    inventory.repositories.map((entry) => [entry.repository, entry.visibility] as const),
  );
  const outcome = await runSnapshot(Bun.argv.slice(2), {
    run: runGh,
    perimeter,
    now: () => new Date(),
  });
  for (const line of outcome.stdout) console.log(line);
  for (const line of outcome.stderr) console.error(line);
  process.exit(outcome.code);
}
