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
 * WHY THE PERIMETER FIRST. Only repositories of `ecosystem/repositories.v1.yaml`
 * may be read, and a private one is refused: the CI token cannot read it, so a
 * cross-repository read would either fail or require more authority than the
 * gates hold. Both refusals happen before any network call.
 *
 * Exit codes: 0 written, 1 read failed (nothing written), 2 usage,
 * 3 repository outside the perimeter.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
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

/**
 * Cron entries of one workflow's `schedule` trigger. `on` may be a string or
 * a list of event names (no schedule then); a `schedule` that is not a list,
 * or a document without `on`, is an unexpected type.
 */
export function countSchedules(workflowText: string): number {
  let document: unknown;
  try {
    document = Bun.YAML.parse(workflowText);
  } catch {
    throw new ForgeReadError("workflow is not valid YAML");
  }
  if (!isRecord(document)) throw new ForgeReadError("workflow is not a mapping");
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

function outputPath(outputDir: string, repository: string): string {
  const root = resolve(outputDir);
  const target = resolve(root, `${repository}.json`);
  // Names are validated above; this is the last line that refuses an escape.
  if (!target.startsWith(root + sep)) {
    throw new Error(`output path escapes the output directory: ${repository}`);
  }
  return target;
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

  // shortcut: files are written one by one after every read succeeded; a disk
  // failure in this loop can leave some written. Upgrade trigger: a consumer
  // that reads the directory while it is being written.
  for (const snapshot of snapshots) {
    const target = outputPath(outputDir, snapshot.repository);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
  return {
    code: 0,
    stdout: [
      `forge snapshot: requested=${repositories.length} collected=${snapshots.length} written=${snapshots.length}`,
    ],
    stderr: [],
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
