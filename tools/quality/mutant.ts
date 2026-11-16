/**
 * Mutant launcher: proof by mutation, described as data.
 *
 * A mutant is an entry of a catalogue (`tools/quality/mutants.v1.json` by default):
 *
 *   { id, file, anchor, substitution, oracle: { tests: [...], trace? } }
 *
 * `anchor` must occur exactly once in `file`, and `substitution` must differ from it and keep its
 * line count: a mutant REPLACES a decisive expression, it never deletes one. Deleting a line
 * unbalances the structure and turns everything red for the wrong reason, and a substitution
 * identical to the original proves nothing.
 *
 * The launcher copies the tracked files of the repository into a throwaway directory (history
 * excluded, `node_modules` linked), never the working tree itself. It first runs every oracle on
 * the unmutated copy: a red base proves nothing about any mutant, so it stops with exit 2. Then,
 * for each mutant, it writes the mutated file into the copy, runs the oracle (`bun test` on the
 * named files, with a purged environment so an ambient CI variable cannot decide the verdict),
 * writes the original bytes back and checks them byte for byte.
 *
 * Verdicts, read from the JUnit report bun writes:
 *   killed    the oracle failed BY ASSERTION, and printed the declared trace if one is declared;
 *   survived  the oracle stayed green with at least one test run;
 *   invalid   anything else: a load or syntax error, a thrown error, no report, no test run,
 *             a red run without the trace. A crash proves the mutant breaks the program, not
 *             that a test checks the guard.
 *
 * Green only when the base is green, at least one mutant ran, every mutant is killed and every
 * restoration is identical. Counters are printed and sum: mutants = killed + survived + invalid.
 *
 * Usage: bun tools/quality/mutant.ts run [--id <id>] [--validate] [--catalogue <path>]
 * Exit:  0 all killed, 1 otherwise, 2 red base, 3 usage, invalid site or missing dependency,
 *        128 + signal number on interruption (130 for SIGINT).
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve } from "node:path";

import type { Subprocess } from "bun";

export const DEFAULT_CATALOGUE = "tools/quality/mutants.v1.json";
const SCHEMA = "mutants.v1";
const ID = /^[a-z0-9][a-z0-9-]*$/;

export interface Oracle {
  readonly tests: readonly string[];
  readonly trace?: string;
}

export interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly anchor: string;
  readonly substitution: string;
  readonly oracle: Oracle;
}

export interface Catalogue {
  readonly mutants: readonly Mutant[];
}

/** The catalogue does not describe mutants the launcher can trust. */
export class CatalogueError extends Error {}

/** A mutation site is not exactly one occurrence, or the substitution proves nothing. */
export class SiteError extends Error {}

class UsageError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new CatalogueError(`${where}: unknown key "${key}"`);
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new CatalogueError(`${where}: expected a non-empty string`);
  return value;
}

/**
 * A repository-relative path that cannot leave the repository: no absolute path, no `..`,
 * no `.` segment, no backslash. Membership of the tracked set is checked later, on the copy.
 */
function relativePath(value: unknown, where: string): string {
  const path = text(value, where);
  const normalised = posix.normalize(path);
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    normalised !== path ||
    path.split("/").some((segment) => segment === ".." || segment === ".")
  )
    throw new CatalogueError(
      `${where}: path "${path}" must be relative and stay in the repository`,
    );
  return path;
}

/** Validate untrusted catalogue JSON. Throws CatalogueError on the first defect. */
export function parseCatalogue(value: unknown): Catalogue {
  if (!isRecord(value)) throw new CatalogueError("catalogue: expected an object");
  onlyKeys(value, ["schema", "mutants"], "catalogue");
  if (value.schema !== SCHEMA) throw new CatalogueError(`catalogue: schema must be "${SCHEMA}"`);
  if (!Array.isArray(value.mutants))
    throw new CatalogueError("catalogue: mutants must be an array");
  const seen = new Set<string>();
  const mutants = value.mutants.map((raw: unknown, index: number): Mutant => {
    const where = `mutants[${index}]`;
    if (!isRecord(raw)) throw new CatalogueError(`${where}: expected an object`);
    onlyKeys(raw, ["id", "file", "anchor", "substitution", "oracle"], where);
    const id = text(raw.id, `${where}.id`);
    if (!ID.test(id)) throw new CatalogueError(`${where}.id: "${id}" is not [a-z0-9-]`);
    if (seen.has(id)) throw new CatalogueError(`${where}.id: duplicate id "${id}"`);
    seen.add(id);
    const oracle = raw.oracle;
    if (!isRecord(oracle)) throw new CatalogueError(`${where}.oracle: expected an object`);
    onlyKeys(oracle, ["tests", "trace"], `${where}.oracle`);
    if (!Array.isArray(oracle.tests) || oracle.tests.length === 0)
      throw new CatalogueError(`${where}.oracle.tests: expected a non-empty array`);
    const tests = oracle.tests.map((test: unknown, at: number) =>
      relativePath(test, `${where}.oracle.tests[${at}]`),
    );
    const trace =
      oracle.trace === undefined ? undefined : text(oracle.trace, `${where}.oracle.trace`);
    // The substitution is checked for emptiness by applyMutant, where it is reported as a site.
    if (typeof raw.substitution !== "string")
      throw new CatalogueError(`${where}.substitution: expected a string`);
    return {
      id,
      file: relativePath(raw.file, `${where}.file`),
      anchor: text(raw.anchor, `${where}.anchor`),
      substitution: raw.substitution,
      oracle: trace === undefined ? { tests } : { tests, trace },
    };
  });
  return { mutants };
}

export function occurrences(source: string, anchor: string): number {
  return source.split(anchor).length - 1;
}

/** Replace the single occurrence of `anchor`. Throws SiteError when that proves nothing. */
export function applyMutant(source: string, anchor: string, substitution: string): string {
  const found = occurrences(source, anchor);
  if (found !== 1) throw new SiteError(`anchor found ${found} times, expected exactly once`);
  if (substitution === anchor) throw new SiteError("substitution identical to the anchor");
  if (
    substitution.trim().length === 0 ||
    substitution.split("\n").length !== anchor.split("\n").length
  )
    throw new SiteError("substitution deletes instead of replacing (blank or fewer lines)");
  // A replacer function: `$&` and friends in the substitution stay literal.
  return source.replace(anchor, () => substitution);
}

export type VerdictLabel = "killed" | "survived" | "invalid";

export interface Verdict {
  readonly verdict: VerdictLabel;
  readonly tests: number;
  readonly assertions: number;
}

/** Classify one oracle run. Pure: takes the exit code, the JUnit report (or null) and the output. */
export function classify(
  exitCode: number,
  report: string | null,
  output: string,
  trace: string | undefined,
): Verdict {
  const header = report === null ? null : /<testsuites\b[^>]*\btests="(\d+)"[^>]*>/.exec(report);
  if (report === null || header === null) return { verdict: "invalid", tests: 0, assertions: 0 };
  const tests = Number(header[1]);
  const assertions = report.split('<failure type="AssertionError"').length - 1;
  if (exitCode === 0)
    return {
      verdict: tests > 0 && !report.includes("<failure") ? "survived" : "invalid",
      tests,
      assertions,
    };
  if (assertions === 0) return { verdict: "invalid", tests, assertions };
  if (trace !== undefined && !output.includes(trace))
    return { verdict: "invalid", tests, assertions };
  return { verdict: "killed", tests, assertions };
}

// ---------------------------------------------------------------------------------------------
// Process side.

interface Active {
  work: string | null;
  child: Subprocess | null;
}

const active: Active = { work: null, child: null };

function git(root: string, args: readonly string[]): string {
  const spawn = (): { exitCode: number; stdout: Buffer } => {
    try {
      return Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
    } catch {
      throw new UsageError("dependency missing: git");
    }
  };
  const result = spawn();
  if (result.exitCode !== 0)
    throw new UsageError(`git ${args[0]} failed in the catalogue's repository`);
  return result.stdout.toString();
}

interface Copy {
  readonly tree: string;
  readonly tracked: ReadonlySet<string>;
}

/** Copy the tracked files into `work/tree`, link `node_modules`, print counters that sum. */
function copyTracked(root: string, work: string): Copy {
  const tracked = git(root, ["ls-files", "-z"])
    .split("\0")
    .filter((path) => path.length > 0);
  const tree = join(work, "tree");
  mkdirSync(tree);
  let files = 0;
  let links = 0;
  let skipped = 0;
  for (const path of tracked) {
    const source = join(root, path);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(source);
    } catch {
      throw new UsageError(`tracked file unreadable: ${path}`);
    }
    // A gitlink (submodule) is a directory: its content is not this repository's.
    if (stat.isDirectory()) {
      skipped += 1;
      continue;
    }
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    cpSync(source, join(tree, path), { verbatimSymlinks: true });
    if (stat.isSymbolicLink()) links += 1;
    else files += 1;
  }
  const modules = join(root, "node_modules");
  if (existsSync(modules)) symlinkSync(modules, join(tree, "node_modules"));
  console.log(
    `copy: tracked=${tracked.length} files=${files} symlinks=${links} skipped=${skipped}`,
  );
  return { tree, tracked: new Set(tracked) };
}

interface OracleRun {
  readonly code: number;
  readonly report: string | null;
  readonly output: string;
}

let runs = 0;

async function runOracle(work: string, tree: string, oracle: Oracle): Promise<OracleRun> {
  runs += 1;
  const reportPath = join(work, `report-${runs}.xml`);
  const home = join(work, `home-${runs}`);
  mkdirSync(home);
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      "--reporter=junit",
      `--reporter-outfile=${reportPath}`,
      ...oracle.tests.map((test) => join(tree, test)),
    ],
    {
      cwd: tree,
      // Purged: only what a test run strictly needs, nothing ambient (CI variables, tokens).
      env: { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: home, TZ: "UTC", NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  active.child = child;
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  active.child = null;
  const report = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : null;
  return { code, report, output: `${stdout}${stderr}` };
}

interface Options {
  readonly id: string | null;
  readonly validate: boolean;
  readonly catalogue: string | null;
}

function parseArguments(argv: readonly string[]): Options {
  if (argv[0] !== "run")
    throw new UsageError("usage: mutant run [--id <id>] [--validate] [--catalogue <path>]");
  let id: string | null = null;
  let validate = false;
  let catalogue: string | null = null;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--validate") validate = true;
    else if (arg === "--id" || arg === "--catalogue") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`${arg} needs a value`);
      index += 1;
      if (arg === "--id") id = value;
      else catalogue = value;
    } else throw new UsageError("unknown argument");
  }
  return { id, validate, catalogue };
}

function loadCatalogue(path: string): Catalogue {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new UsageError("catalogue unreadable or not JSON");
  }
  try {
    return parseCatalogue(raw);
  } catch (error) {
    if (error instanceof CatalogueError) throw new UsageError(error.message);
    throw error;
  }
}

/** Check every selected site against the working tree's tracked files. Returns the invalid count. */
function validateSites(
  root: string,
  mutants: readonly Mutant[],
  tracked: ReadonlySet<string>,
): number {
  let invalid = 0;
  for (const mutant of mutants) {
    let anchors = 0;
    let problem: string | null = null;
    const missing = [mutant.file, ...mutant.oracle.tests].find((path) => !tracked.has(path));
    if (missing !== undefined) problem = `${missing} is not a tracked file`;
    else {
      const source = readFileSync(join(root, mutant.file), "utf8");
      anchors = occurrences(source, mutant.anchor);
      try {
        applyMutant(source, mutant.anchor, mutant.substitution);
      } catch (error) {
        if (!(error instanceof SiteError)) throw error;
        problem = error.message;
      }
    }
    if (problem !== null) invalid += 1;
    console.log(
      `site id=${mutant.id} anchors=${anchors} verdict=${problem === null ? "valid" : `invalid (${problem})`}`,
    );
  }
  console.log(`sites=${mutants.length} valid=${mutants.length - invalid} invalid=${invalid}`);
  return invalid;
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArguments(argv);
  const start = options.catalogue === null ? process.cwd() : dirname(resolve(options.catalogue));
  const root = git(start, ["rev-parse", "--show-toplevel"]).trim();
  const cataloguePath =
    options.catalogue === null ? join(root, DEFAULT_CATALOGUE) : resolve(options.catalogue);
  const catalogue = loadCatalogue(cataloguePath);
  const selected =
    options.id === null ? catalogue.mutants : catalogue.mutants.filter((m) => m.id === options.id);
  if (options.id !== null && selected.length === 0) throw new UsageError("unknown mutant id");

  const tracked = new Set(
    git(root, ["ls-files", "-z"])
      .split("\0")
      .filter((p) => p.length > 0),
  );
  const invalidSites = validateSites(root, selected, tracked);
  if (invalidSites > 0) return 3;
  if (options.validate) return selected.length === 0 ? 1 : 0;

  const work = mkdtempSync(join(tmpdir(), "mutant-"));
  active.work = work;
  try {
    const copy = copyTracked(root, work);
    // Base: every distinct oracle, unmutated, must be green with at least one test.
    const oracles = new Map<string, Oracle>();
    for (const mutant of selected) oracles.set(JSON.stringify(mutant.oracle.tests), mutant.oracle);
    let green = 0;
    for (const oracle of oracles.values()) {
      const base = await runOracle(work, copy.tree, oracle);
      const verdict = classify(base.code, base.report, base.output, undefined);
      if (verdict.verdict === "survived") green += 1;
      else
        console.log(
          `base oracle=${oracle.tests.join(",")} exit=${base.code} tests=${verdict.tests}: red`,
        );
    }
    console.log(`base oracles=${oracles.size} green=${green} red=${oracles.size - green}`);
    if (green !== oracles.size) return 2;

    let killed = 0;
    let survived = 0;
    let invalid = 0;
    let identical = 0;
    for (const mutant of selected) {
      const target = join(copy.tree, mutant.file);
      const original = readFileSync(target);
      const mutated = applyMutant(original.toString("utf8"), mutant.anchor, mutant.substitution);
      let result: OracleRun;
      try {
        writeFileSync(target, mutated);
        result = await runOracle(work, copy.tree, mutant.oracle);
      } finally {
        writeFileSync(target, original);
      }
      const restored = readFileSync(target).equals(original);
      if (restored) identical += 1;
      const verdict = classify(result.code, result.report, result.output, mutant.oracle.trace);
      if (verdict.verdict === "killed") killed += 1;
      else if (verdict.verdict === "survived") survived += 1;
      else invalid += 1;
      console.log(
        `mutant id=${mutant.id} verdict=${verdict.verdict} oracle=${mutant.oracle.tests.join(",")} exit=${result.code} tests=${verdict.tests} assertions=${verdict.assertions} restored=${restored ? "identical" : "different"}`,
      );
    }
    console.log(
      `mutants=${selected.length} killed=${killed} survived=${survived} invalid=${invalid} restored_identical=${identical}`,
    );
    const allKilled = selected.length > 0 && killed === selected.length;
    return allKilled && identical === selected.length ? 0 : 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
    active.work = null;
  }
}

/** Kill the running oracle, remove the copy, exit 128 + signal number. */
async function interrupt(signal: "SIGINT" | "SIGTERM", code: number): Promise<void> {
  const child = active.child;
  if (child !== null) {
    child.kill("SIGKILL");
    await child.exited;
  }
  if (active.work !== null) rmSync(active.work, { recursive: true, force: true });
  console.error(`interrupted by ${signal}: oracle killed, copy removed`);
  process.exit(code);
}

if (import.meta.main) {
  process.on("SIGINT", () => void interrupt("SIGINT", 130));
  process.on("SIGTERM", () => void interrupt("SIGTERM", 143));
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError || error instanceof SiteError) {
      console.error(`mutant: ${error.message}`);
      process.exitCode = 3;
    } else throw error;
  }
}
