// Fleet gate template — ADR-0058 section 3, condition 1, second instrument.
//
// Copied by a repository that adds `@langchain/langgraph` (see docs/method/LANGGRAPH-ENTRY-GATES.md).
// Self-contained on purpose: one file, `node:` and `Bun` only. Same shape as
// tools/quality/check-advisory-waivers.ts of the governance repository: enumerate the tracked
// files, read them, report with the volume — and the same `--root` flag.
//
// Usage: bun check-langgraph-advisory-floor.ts [--root=<dir>] [--floor=<path relative to the root>]
//
//   --root   the repository to examine (default: the current directory). It must be a git work
//            tree: the lockfiles and the floor are TRACKED files, so a floor the repository does
//            not commit cannot be read as policy.
//   --floor  the data file (default: DEFAULT_FLOOR below). It must be tracked.
//
// The floor is data, one line per advisory fix: `<package> <minimum version> <advisory id>`, blank
// lines and `#` comments allowed. Adding a line is a reviewed edit: when the vulnerability
// database the other instrument reads lacks an advisory, the floor carries it.
//
// Rule: every resolved version of a floor package must be greater than or equal to its minimum,
// under semver ordering (a pre-release of the minimum is below it). Two rows for one package are
// two assertions: the higher minimum decides. A package the lockfile does not resolve satisfies
// its row, but a floor that matches NO resolved package fails: it was compared to nothing, or to
// the wrong lockfile.
//
// Fail closed on what cannot be read: a lockfile of a format this gate does not read
// (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, an npm lockfile of version 1), a lockfile that does
// not parse, a floor line that does not parse, and a floor package resolved at a version that is
// not a semver number (`github:`, `file:`, `workspace:`) are each a failure, never zero.
//
// What it does NOT express: a version to avoid. The floor is a minimum; an advisory with no fixed
// version (the 2.0.0 line of `@langchain/langgraph-sdk` in GHSA-432w-3h3v-2pv4) is invisible to it.
// It also does not fetch anything: the advisory database is the other instrument (ADR-0021).

import { lstatSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// Where a consumer keeps the data file; the CI command carries --floor when it moves it.
const DEFAULT_FLOOR = "tools/quality/langgraph-advisory-floor.v1.txt";

const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const PACKAGE_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const MINIMUM_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const ADVISORY_ID = /^GHSA(?:-[2-9cfghjmpqrvwx]{4}){3}$/;
const RESOLVED_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface FloorRow {
  readonly line: number;
  readonly package: string;
  readonly minimum: string;
  readonly advisory: string;
}

export interface Floor {
  readonly rows: readonly FloorRow[];
  readonly errors: readonly string[];
}

export function parseFloor(text: string): Floor {
  const rows: FloorRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = index + 1;
    const content = raw.trim();
    if (content === "" || content.startsWith("#")) continue;
    const fields = content.split(/\s+/);
    if (fields.length !== 3) {
      errors.push(
        `line ${line}: expected '<package> <minimum version> <advisory id>', got ${fields.length} field(s)`,
      );
      continue;
    }
    const [name, minimum, advisory] = fields as [string, string, string];
    if (!PACKAGE_NAME.test(name)) errors.push(`line ${line}: '${name}' is not a package name`);
    else if (!MINIMUM_VERSION.test(minimum))
      errors.push(`line ${line}: '${minimum}' is not an x.y.z version`);
    else if (!ADVISORY_ID.test(advisory))
      errors.push(`line ${line}: '${advisory}' is not a GHSA identifier`);
    else if (seen.has(`${name} ${advisory}`))
      errors.push(`line ${line}: ${name} ${advisory} is already a row`);
    else {
      seen.add(`${name} ${advisory}`);
      rows.push({ line, package: name, minimum, advisory });
    }
  }
  return { rows, errors };
}

export interface LockEntry {
  readonly name: string;
  readonly version: string;
  readonly where: string;
}

export type LockReading = { readonly entries: readonly LockEntry[] } | { readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBunLock(text: string): LockReading {
  let parsed: unknown;
  try {
    parsed = Bun.JSONC.parse(text);
  } catch (error) {
    return { error: `does not parse as JSONC: ${(error as Error).message}` };
  }
  // A lockfile that lists no package is not evidence about the graph: it is a lockfile not read.
  const packages = isRecord(parsed) && isRecord(parsed.packages) ? parsed.packages : {};
  if (Object.keys(packages).length === 0) return { error: "has no packages table" };
  const entries: LockEntry[] = [];
  for (const [where, value] of Object.entries(packages)) {
    // [0] is `<real name>@<version>`: for an alias the key is the install name, [0] is the package.
    const spec = Array.isArray(value) ? value[0] : undefined;
    const at = typeof spec === "string" ? spec.lastIndexOf("@") : -1;
    if (typeof spec !== "string" || at <= 0)
      return { error: `entry '${where}' has no name@version` };
    entries.push({ name: spec.slice(0, at), version: spec.slice(at + 1), where });
  }
  return { entries };
}

function readNpmLock(text: string): LockReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: `does not parse as JSON: ${(error as Error).message}` };
  }
  const packages = isRecord(parsed) && isRecord(parsed.packages) ? parsed.packages : {};
  if (Object.keys(packages).length === 0) {
    return { error: "has no packages table (lockfileVersion 1 is not read)" };
  }
  const entries: LockEntry[] = [];
  for (const [where, value] of Object.entries(packages)) {
    if (where === "" || !isRecord(value) || value.link === true) continue;
    const marker = where.lastIndexOf("node_modules/");
    const installed = marker === -1 ? where : where.slice(marker + "node_modules/".length);
    const name = typeof value.name === "string" ? value.name : installed;
    if (typeof value.version !== "string") return { error: `entry '${where}' has no version` };
    entries.push({ name, version: value.version, where });
  }
  return { entries };
}

export function readLockfile(path: string, text: string): LockReading {
  const name = basename(path);
  if (name === "bun.lock") return readBunLock(text);
  if (name === "package-lock.json" || name === "npm-shrinkwrap.json") return readNpmLock(text);
  return { error: `format '${name}' is not read by this gate` };
}

export interface Evaluation {
  readonly defects: readonly string[];
  readonly resolvedRows: number;
  readonly absentRows: number;
  readonly entriesCompared: number;
}

export function evaluate(
  rows: readonly FloorRow[],
  locks: readonly { readonly file: string; readonly entries: readonly LockEntry[] }[],
): Evaluation {
  const defects: string[] = [];
  let resolvedRows = 0;
  let absentRows = 0;
  let entriesCompared = 0;
  for (const row of rows) {
    let resolved = 0;
    for (const lock of locks) {
      for (const entry of lock.entries) {
        if (entry.name !== row.package) continue;
        resolved += 1;
        entriesCompared += 1;
        if (!RESOLVED_VERSION.test(entry.version)) {
          defects.push(
            `${lock.file}: ${entry.name}@${entry.version} (${entry.where}) is not a version this gate can compare to ${row.minimum} (${row.advisory})`,
          );
        } else if (Bun.semver.order(entry.version, row.minimum) < 0) {
          defects.push(
            `${lock.file}: ${entry.name}@${entry.version} (${entry.where}) is below ${row.minimum} (${row.advisory})`,
          );
        }
      }
    }
    if (resolved === 0) absentRows += 1;
    else resolvedRows += 1;
  }
  return { defects, resolvedRows, absentRows, entriesCompared };
}

export interface Arguments {
  readonly root: string;
  readonly floor: string;
}

export function parseArguments(argv: readonly string[]): Arguments {
  let root = ".";
  let floor = DEFAULT_FLOOR;
  for (const argument of argv) {
    if (argument.startsWith("--root=")) root = argument.slice("--root=".length);
    else if (argument.startsWith("--floor=")) floor = argument.slice("--floor=".length);
    else throw new Error(`unknown argument '${argument}'`);
  }
  return { root: resolve(root), floor };
}

function trackedFiles(root: string): string[] {
  const result = Bun.spawnSync(["git", "-C", root, "ls-files", "-z"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    // Not "no lockfile": the inventory itself could not be taken.
    throw new Error(
      `git ls-files failed in ${root}: ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter((path) => path !== "");
}

function readTrackedText(root: string, path: string): string {
  const absolute = join(root, path);
  if (!lstatSync(absolute).isFile()) throw new Error("not a regular file");
  return readFileSync(absolute, "utf8");
}

if (import.meta.main) {
  let args: Arguments;
  let tracked: string[];
  try {
    args = parseArguments(Bun.argv.slice(2));
    tracked = trackedFiles(args.root);
  } catch (error) {
    console.error(`LangGraph advisory floor: ${(error as Error).message}`);
    process.exit(2);
  }
  const failures: string[] = [];

  let floor: Floor = { rows: [], errors: [] };
  if (!tracked.includes(args.floor)) {
    failures.push(`${args.floor}: the floor is not a tracked file of ${args.root}`);
  } else {
    try {
      floor = parseFloor(readTrackedText(args.root, args.floor));
    } catch (error) {
      failures.push(`${args.floor}: floor unreadable (${(error as Error).message})`);
    }
  }
  for (const error of floor.errors) failures.push(`${args.floor}: ${error}`);
  if (floor.rows.length === 0 && failures.length === 0) {
    failures.push(`${args.floor}: the floor has 0 row(s): an empty floor compares nothing`);
  }

  const lockfiles = tracked.filter((path) => LOCKFILES.has(basename(path)));
  const locks: { file: string; entries: readonly LockEntry[] }[] = [];
  for (const file of lockfiles) {
    let reading: LockReading;
    try {
      reading = readLockfile(file, readTrackedText(args.root, file));
    } catch (error) {
      reading = { error: `unreadable (${(error as Error).message})` };
    }
    if ("error" in reading) failures.push(`${file}: lockfile ${reading.error}`);
    else locks.push({ file, entries: reading.entries });
  }
  if (lockfiles.length === 0)
    failures.push("0 lockfile(s) tracked: the resolved graph was not examined");

  const evaluation = evaluate(floor.rows, locks);
  failures.push(...evaluation.defects);
  if (floor.rows.length > 0 && locks.length > 0 && evaluation.resolvedRows === 0) {
    failures.push(
      "no floor package is resolved in any lockfile: the floor was compared to nothing",
    );
  }

  const packages = new Set(floor.rows.map((row) => row.package)).size;
  const entries = locks.reduce((sum, lock) => sum + lock.entries.length, 0);
  console.log(
    `LangGraph advisory floor: ${floor.rows.length} row(s) over ${packages} package(s) from ${args.floor}; ` +
      `${locks.length} of ${lockfiles.length} lockfile(s) read, ${entries} entr(ies) listed, ` +
      `${evaluation.entriesCompared} row-by-entry comparison(s); ${evaluation.resolvedRows} row(s) resolved, ` +
      `${evaluation.absentRows} absent from the lockfile(s), ${evaluation.defects.length} below the floor or not comparable`,
  );
  console.log(
    "LangGraph advisory floor: not expressed — a version to avoid (an advisory with no fixed version); " +
      "the advisory database is the other instrument",
  );
  if (failures.length > 0) {
    for (const failure of failures) console.error(`LangGraph advisory floor: ${failure}`);
    console.error(`LangGraph advisory floor failed: ${failures.length} problem(s).`);
    process.exit(1);
  }
  console.log(
    "LangGraph advisory floor verified: every resolved floor package is at or above its minimum.",
  );
}
