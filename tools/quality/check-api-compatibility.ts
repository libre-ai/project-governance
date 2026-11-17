/**
 * Public API compatibility gate for one crate, against a git baseline.
 *
 *   bun tools/quality/check-api-compatibility.ts --crate <name>
 *       [--repository <path>] [--baseline-rev <rev>]
 *
 * A repository could remove a public item of a crate and tag a version without
 * incrementing it, with every required check green: nothing compared the
 * public API to a reference revision. This gate does, with
 * cargo-semver-checks, and never against a registry.
 *
 * What it decides itself, and why it does not leave it to the tool:
 *
 * - **The baseline.** Either the revision given, or the highest tag
 *   `<prefix>-v<X>.<Y>.<Z>` whose prefix is the crate name (exact) or a suffix
 *   of it cut at a dash. A suffix tag may belong to a sibling crate that
 *   happens to carry the shorter name: it counts only when its tree carries
 *   THIS crate at the same path, and is otherwise discarded and counted. The
 *   highest exact tag is never discarded: a tree without the crate is exit 18.
 * - **Where the baseline is read.** The baseline commit is extracted with
 *   `git archive` into a directory of its own and handed to the tool as
 *   `--baseline-root`. The tool's own `--baseline-rev` is never used: it
 *   resolves the revision a second time, in a clone this gate does not see.
 * - **No green without a baseline, and none without a check.** No baseline is
 *   exit 12; a run that executed zero checks is exit 15.
 *
 * The summary line it reads was measured on cargo-semver-checks 0.51.0
 * (stderr): `Checked [   0.004s] 229 checks: 226 pass, 3 fail, 0 warn, 31 skip`
 * on a break, `229 checks: 229 pass, 31 skip` otherwise; each break is a
 * `--- failure <lint>: <title> ---` line on stdout, and the exit code is 100.
 * Anything else is exit 17, never a pass.
 *
 * Not wired into `bun run check`: this repository has no tagged crate. It is
 * run by `.github/workflows/reusable-api-compat.yml` from the governance
 * checkout, over the caller's workspace.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runGit } from "./git-diff";
import { parseTomlDocument, toPlain } from "./toml-document";

/** The closed list of exit codes. */
export const EXIT = {
  compatible: 0,
  usage: 2,
  toolMissing: 10,
  unknownCrate: 11,
  noBaseline: 12,
  unresolvedBaseline: 13,
  apiBreak: 14,
  noCheckRun: 15,
  versionNotIncremented: 16,
  toolError: 17,
  crateAbsentFromBaseline: 18,
  unreadableRepository: 19,
} as const;

/** The binary the caller provides; without it, `cargo-semver-checks` is looked up on PATH. */
export const PROVIDED_BINARY_ENV = "LIBRE_AI_CARGO_SEMVER_CHECKS";

const TOOL_NAME = "cargo-semver-checks";

export interface ToolRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface WorkspacePackage {
  readonly name: string;
  readonly version: string;
  readonly manifestPath: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

export interface ApiCompatDeps {
  /** Runs the tool: the full argument vector, binary first. */
  readonly runTool?: (argv: readonly string[]) => ToolRun | Promise<ToolRun>;
  /** The packages of the workspace at this repository root. */
  readonly readWorkspace?: (
    repository: string,
  ) => readonly WorkspacePackage[] | Promise<readonly WorkspacePackage[]>;
  /** Where the baseline extraction directory is created. */
  readonly temporaryRoot?: string;
  /** Where the binaries are looked up (the provided-binary variable and PATH). */
  readonly environment?: Environment;
  /** Receives every printed line. */
  readonly write?: (line: string) => void;
}

interface Arguments {
  readonly repository: string;
  readonly crate: string;
  readonly baselineRev: string | null;
}

const CRATE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The parsed arguments, or the reason they are refused. */
function parseArguments(argv: readonly string[], defaultRepository: string): Arguments | string {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index] ?? "";
    if (flag !== "--repository" && flag !== "--crate" && flag !== "--baseline-rev") {
      return `unknown argument ${JSON.stringify(flag)}`;
    }
    const value = argv[index + 1];
    if (value === undefined || value === "") return `${flag} needs a value`;
    if (values.has(flag)) return `${flag} is given twice`;
    values.set(flag, value);
  }
  const crate = values.get("--crate");
  if (crate === undefined) return "--crate is required";
  if (!CRATE_NAME.test(crate)) return `--crate is not a package name: ${JSON.stringify(crate)}`;
  return {
    repository: resolve(values.get("--repository") ?? defaultRepository),
    crate,
    baselineRev: values.get("--baseline-rev") ?? null,
  };
}

interface Tools {
  readonly cargo: string;
  readonly semverChecks: string;
}

/**
 * Both binaries, or the name of the one that is missing. A provided binary
 * that does not exist is missing: PATH is not searched for a substitute.
 */
function locateTools(environment: Environment): Tools | string {
  const path = environment.PATH ?? "";
  const cargo = Bun.which("cargo", { PATH: path });
  if (cargo === null) return "cargo";
  const provided = environment[PROVIDED_BINARY_ENV];
  if (provided !== undefined && provided !== "") {
    return existsSync(provided)
      ? { cargo, semverChecks: provided }
      : `${TOOL_NAME} (${PROVIDED_BINARY_ENV} names a path that does not exist)`;
  }
  const semverChecks = Bun.which(TOOL_NAME, { PATH: path });
  return semverChecks === null ? TOOL_NAME : { cargo, semverChecks };
}

/**
 * Runs cargo, or the tool that calls it, IN the repository examined: rustup
 * picks the toolchain from the `rust-toolchain.toml` above its working
 * directory, and that must be the caller's, not the one of the checkout this
 * script is run from.
 */
function spawnTool(
  argv: readonly string[],
  environment: Environment,
  cargo: string,
  cwd: string,
): ToolRun {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) env[key] = value;
  }
  // The tool calls `cargo` by name: the one located above must be the one it finds.
  env.PATH = `${dirname(cargo)}${delimiter}${environment.PATH ?? ""}`;
  const result = Bun.spawnSync([...argv], { stdout: "pipe", stderr: "pipe", env, cwd });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function cargoMetadata(
  repository: string,
  environment: Environment,
  cargo: string,
): WorkspacePackage[] {
  const run = spawnTool(
    [
      cargo,
      "metadata",
      "--no-deps",
      "--format-version",
      "1",
      "--manifest-path",
      join(repository, "Cargo.toml"),
    ],
    environment,
    cargo,
    repository,
  );
  if (run.exitCode !== 0) throw new Error(`cargo metadata failed: ${run.stderr.trim()}`);
  const parsed = JSON.parse(run.stdout) as { readonly packages?: unknown };
  if (!Array.isArray(parsed.packages)) throw new Error("cargo metadata lists no packages");
  return parsed.packages.map((entry: unknown): WorkspacePackage => {
    const fields = entry as Record<string, unknown>;
    const { name, version, manifest_path: manifestPath } = fields;
    if (
      typeof name !== "string" ||
      typeof version !== "string" ||
      typeof manifestPath !== "string"
    ) {
      throw new Error("cargo metadata lists a package without name, version or manifest_path");
    }
    return { name, version, manifestPath };
  });
}

/** The path as the filesystem resolves it, or as written when it does not exist. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The plain value at a dotted path of nested tables, or `undefined`. */
function field(value: unknown, keys: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function parseManifest(text: string): unknown {
  try {
    return toPlain(parseTomlDocument(text).root);
  } catch {
    return undefined;
  }
}

/** `<cratePath>/Cargo.toml` as a path inside a git tree. */
const manifestInTree = (cratePath: string): string =>
  cratePath === "." ? "Cargo.toml" : `${cratePath}/Cargo.toml`;

/** True when the tree of this commit carries the crate, under its name, at its path. */
function treeCarriesCrate(
  repository: string,
  sha: string,
  cratePath: string,
  crate: string,
): boolean {
  const show = runGit(["-C", repository, "show", `${sha}:${manifestInTree(cratePath)}`]);
  if (show.exitCode !== 0) return false;
  return field(parseManifest(show.stdout), ["package", "name"]) === crate;
}

/** The version the extracted baseline declares for the crate, inherited from the workspace if so written. */
function baselineVersion(extracted: string, cratePath: string): string | null {
  const read = (path: string): unknown => {
    try {
      return parseManifest(readFileSync(path, "utf8"));
    } catch {
      return undefined;
    }
  };
  const version = field(read(join(extracted, manifestInTree(cratePath))), ["package", "version"]);
  if (typeof version === "string") return version;
  if (field(version, ["workspace"]) !== true) return null;
  const inherited = field(read(join(extracted, "Cargo.toml")), ["workspace", "package", "version"]);
  return typeof inherited === "string" ? inherited : null;
}

interface TagCandidate {
  readonly tag: string;
  readonly prefix: string;
  readonly version: string;
}

const RELEASE_TAG = /^(.+)-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;

/** The crate name, then each of its suffixes cut at a dash. */
function admittedPrefixes(crate: string): string[] {
  const parts = crate.split("-");
  return parts.map((_part, index) => parts.slice(index).join("-"));
}

/** Highest version first; at equal versions, the longest prefix first. */
function highestFirst(left: TagCandidate, right: TagCandidate): number {
  return Bun.semver.order(right.version, left.version) || right.prefix.length - left.prefix.length;
}

type Baseline =
  | { readonly ok: true; readonly label: string; readonly sha: string }
  | { readonly ok: false; readonly code: number; readonly cause: string };

const FORTY_HEX = /^[0-9a-f]{40}$/;

/** The commit a revision names, annotated tags dereferenced; `null` when it names none. */
function commitOf(repository: string, rev: string): string | null {
  const run = runGit([
    "-C",
    repository,
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${rev}^{commit}`,
  ]);
  const sha = run.stdout.trim();
  return run.exitCode === 0 && FORTY_HEX.test(sha) ? sha : null;
}

interface TagCounts {
  readonly candidates: number;
  readonly exact: number;
  readonly suffix: number;
  discarded: number;
}

function selectBaseline(
  repository: string,
  args: Arguments,
  cratePath: string,
  exact: readonly TagCandidate[],
  suffix: readonly TagCandidate[],
  counts: TagCounts,
): Baseline {
  const absent = (label: string): Baseline => ({
    ok: false,
    code: EXIT.crateAbsentFromBaseline,
    cause: `crate ${args.crate} is absent from baseline ${label}: its tree has no ${manifestInTree(cratePath)} naming it`,
  });
  const unresolved = (label: string): Baseline => ({
    ok: false,
    code: EXIT.unresolvedBaseline,
    cause: `baseline ${JSON.stringify(label)} does not resolve to a commit`,
  });

  if (args.baselineRev !== null) {
    const rev = args.baselineRev;
    // The revision is printed in a machine-readable line and handed to git: no
    // blank or control character, and nothing git could read as an option.
    if (/[\s\p{Cc}]/u.test(rev) || rev.startsWith("-")) return unresolved(rev);
    const sha = commitOf(repository, rev);
    if (sha === null) return unresolved(rev);
    if (!treeCarriesCrate(repository, sha, cratePath, args.crate)) return absent(rev);
    return { ok: true, label: rev, sha };
  }

  const highestExact = [...exact].sort(highestFirst)[0];
  if (highestExact !== undefined) {
    const sha = commitOf(repository, `refs/tags/${highestExact.tag}`);
    if (sha === null) return unresolved(highestExact.tag);
    if (!treeCarriesCrate(repository, sha, cratePath, args.crate)) return absent(highestExact.tag);
    return { ok: true, label: highestExact.tag, sha };
  }

  // Every suffix tag is examined, not only the first that fits: the count of
  // discarded tags must not depend on where the search stopped.
  let retained: { readonly label: string; readonly sha: string } | null = null;
  for (const candidate of [...suffix].sort(highestFirst)) {
    const sha = commitOf(repository, `refs/tags/${candidate.tag}`);
    if (sha !== null && treeCarriesCrate(repository, sha, cratePath, args.crate)) {
      retained ??= { label: candidate.tag, sha };
    } else {
      counts.discarded += 1;
    }
  }
  if (retained !== null) return { ok: true, ...retained };
  return {
    ok: false,
    code: EXIT.noBaseline,
    cause: `no baseline: no tag ${args.crate}-vX.Y.Z, and no suffix tag whose tree carries the crate`,
  };
}

type ToolVerdict =
  | {
      readonly ok: true;
      readonly checks: number;
      readonly passed: number;
      readonly skipped: number;
      readonly breaks: number;
      readonly breakLines: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

const SUMMARY =
  /^\s*Checked \[[^\]]*\] (\d+) checks: (\d+) pass(?:, (\d+) fail)?(?:, (\d+) warn)?, (\d+) skip\s*$/;
const FAILURE = /^--- failure .+ ---$/;

/** The counts the tool printed, or why its output is not the one this gate was written for. */
function readToolOutput(run: ToolRun): ToolVerdict {
  const lines = `${run.stderr}\n${run.stdout}`.split("\n");
  const summaries = lines
    .map((line) => line.match(SUMMARY))
    .filter((match): match is RegExpMatchArray => match !== null);
  const summary = summaries[0];
  if (summary === undefined || summaries.length !== 1) {
    return {
      ok: false,
      reason: `the tool exited ${run.exitCode} with ${summaries.length} summary line(s), 1 expected`,
    };
  }
  const count = (index: number): number => Number(summary[index] ?? "0");
  const [checks, passed, breaks, warned, skipped] = [1, 2, 3, 4, 5].map(count) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const breakLines = lines.map((line) => line.trim()).filter((line) => FAILURE.test(line));
  if (passed + breaks + warned !== checks) {
    return {
      ok: false,
      reason: `the tool's counts do not sum: ${passed} pass + ${breaks} fail + ${warned} warn is not ${checks} checks`,
    };
  }
  if (breakLines.length !== breaks) {
    return {
      ok: false,
      reason: `the tool counts ${breaks} failed check(s) and reports ${breakLines.length}`,
    };
  }
  if ((run.exitCode === 0) !== (breaks === 0)) {
    return {
      ok: false,
      reason: `the tool exited ${run.exitCode} while counting ${breaks} failed check(s)`,
    };
  }
  return { ok: true, checks, passed, skipped, breaks, breakLines };
}

const LIMIT_RETURN_TYPE =
  "limit: a changed return type (u32 to u64) is not reported by the tool; this gate does not see it";
const LIMIT_TRIVIAL = "limit: the head is the baseline commit; the gate passes trivially";

export async function main(argv: readonly string[], deps: ApiCompatDeps = {}): Promise<number> {
  const write = deps.write ?? ((line: string): void => console.log(line));
  const environment = deps.environment ?? process.env;
  const conclude = (code: number, cause: string): number => {
    write(cause);
    return code;
  };

  const args = parseArguments(argv, process.cwd());
  if (typeof args === "string") return conclude(EXIT.usage, `usage: ${args}`);

  // Tags live in the history: without all of it, a missing tag and a tag that
  // was never fetched are the same empty list.
  const topLevel = runGit(["-C", args.repository, "rev-parse", "--show-toplevel"]);
  const shallow = runGit(["-C", args.repository, "rev-parse", "--is-shallow-repository"]);
  const head = commitOf(args.repository, "HEAD");
  if (topLevel.exitCode !== 0 || shallow.exitCode !== 0 || head === null) {
    return conclude(
      EXIT.unreadableRepository,
      `unreadable repository: ${args.repository} is not a git repository with a commit`,
    );
  }
  if (shallow.stdout.trim() !== "false") {
    return conclude(
      EXIT.unreadableRepository,
      "unreadable repository: the checkout is shallow, tags need the full history (fetch-depth: 0)",
    );
  }
  const repository = real(topLevel.stdout.trim());

  const tools = locateTools(environment);
  if (typeof tools === "string") return conclude(EXIT.toolMissing, `tool missing: ${tools}`);
  const runTool =
    deps.runTool ??
    ((toolArgv: readonly string[]): ToolRun =>
      spawnTool(toolArgv, environment, tools.cargo, repository));
  const readWorkspace =
    deps.readWorkspace ??
    ((root: string): WorkspacePackage[] => cargoMetadata(root, environment, tools.cargo));

  let packages: readonly WorkspacePackage[];
  try {
    packages = await readWorkspace(repository);
  } catch (error) {
    return conclude(
      EXIT.unreadableRepository,
      `unreadable repository: ${(error as Error).message}`,
    );
  }
  const crate = packages.find((entry) => entry.name === args.crate);
  if (crate === undefined) {
    return conclude(
      EXIT.unknownCrate,
      `unknown crate: ${args.crate} is not one of the ${packages.length} package(s) of the workspace`,
    );
  }
  const relativePath = relative(repository, real(dirname(crate.manifestPath)));
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return conclude(EXIT.unknownCrate, `unknown crate: ${args.crate} lives outside the repository`);
  }
  const cratePath = relativePath === "" ? "." : relativePath.split(sep).join("/");

  const tagList = runGit([
    "-C",
    repository,
    "for-each-ref",
    "--format=%(refname:strip=2)",
    "refs/tags",
  ]);
  if (tagList.exitCode !== 0) {
    return conclude(EXIT.unreadableRepository, "unreadable repository: the tags cannot be listed");
  }
  const prefixes = admittedPrefixes(args.crate);
  const candidates: TagCandidate[] = [];
  for (const tag of tagList.stdout.split("\n")) {
    const match = tag.match(RELEASE_TAG);
    const [, prefix = "", version = ""] = match ?? [];
    if (match !== null && prefixes.includes(prefix)) candidates.push({ tag, prefix, version });
  }
  const exact = candidates.filter((candidate) => candidate.prefix === args.crate);
  const suffix = candidates.filter((candidate) => candidate.prefix !== args.crate);
  const counts: TagCounts = {
    candidates: candidates.length,
    exact: exact.length,
    suffix: suffix.length,
    discarded: 0,
  };
  const baseline = selectBaseline(repository, args, cratePath, exact, suffix, counts);
  const tagsLine = `tags: candidates=${counts.candidates} exact=${counts.exact} suffix=${counts.suffix} discarded=${counts.discarded}`;
  if (!baseline.ok) {
    write(tagsLine);
    return conclude(baseline.code, baseline.cause);
  }

  mkdirSync(deps.temporaryRoot ?? tmpdir(), { recursive: true });
  const scratch = mkdtempSync(join(deps.temporaryRoot ?? tmpdir(), "api-compat-"));
  try {
    const extracted = join(scratch, "baseline");
    const archive = join(scratch, "baseline.tar");
    mkdirSync(extracted);
    const archived = runGit([
      "-C",
      repository,
      "archive",
      "--format=tar",
      `--output=${archive}`,
      baseline.sha,
    ]);
    const untar = Bun.spawnSync(["tar", "-xf", archive, "-C", extracted], { stderr: "pipe" });
    if (archived.exitCode !== 0 || untar.exitCode !== 0) {
      write(tagsLine);
      return conclude(
        EXIT.unreadableRepository,
        `unreadable repository: baseline ${baseline.sha} cannot be extracted`,
      );
    }
    const previous = baselineVersion(extracted, cratePath);
    if (previous === null) {
      write(tagsLine);
      return conclude(
        EXIT.crateAbsentFromBaseline,
        `crate ${args.crate} declares no readable version in baseline ${baseline.label}`,
      );
    }

    const versionRun = await runTool([tools.semverChecks, "semver-checks", "--version"]);
    const toolVersion = versionRun.stdout.trim().match(/^cargo-semver-checks (\d+\.\d+\.\d+)$/);
    const run =
      toolVersion === null
        ? null
        : await runTool([
            tools.semverChecks,
            "semver-checks",
            "--manifest-path",
            crate.manifestPath,
            "--package",
            args.crate,
            "--baseline-root",
            extracted,
            "--color",
            "never",
          ]);

    write(
      `api-compat tool=${TOOL_NAME}@${toolVersion?.[1] ?? "unknown"} crate=${args.crate} path=${cratePath} version=${crate.version} baseline=${baseline.label} baseline-sha=${baseline.sha}`,
    );
    write(tagsLine);
    write(LIMIT_RETURN_TYPE);
    if (head === baseline.sha) write(LIMIT_TRIVIAL);
    if (run === null) {
      return conclude(
        EXIT.toolError,
        `tool error: the tool does not state its version (exit ${versionRun.exitCode})`,
      );
    }
    const verdict = readToolOutput(run);
    if (!verdict.ok) return conclude(EXIT.toolError, `tool error: ${verdict.reason}`);
    write(
      `checks=${verdict.checks} passed=${verdict.passed} skipped=${verdict.skipped} breaks=${verdict.breaks}`,
    );
    for (const line of verdict.breakLines) write(`break: ${line}`);
    if (verdict.checks === 0) return conclude(EXIT.noCheckRun, "no check was run");
    if (verdict.breaks > 0) {
      return Bun.semver.order(crate.version, previous) <= 0
        ? conclude(
            EXIT.versionNotIncremented,
            `version not incremented: ${verdict.breaks} API break(s) at ${crate.version}, baseline at ${previous}`,
          )
        : conclude(
            EXIT.apiBreak,
            `API break: ${verdict.breaks} break(s) between ${previous} and ${crate.version}`,
          );
    }
    return conclude(EXIT.compatible, "OK");
  } catch (error) {
    return conclude(EXIT.toolError, `tool error: ${(error as Error).message}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
