import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  classifySource,
  evaluateWaivers,
  readWaiverFile,
  type SourceReading,
  unreadableSource,
  volumeLine,
} from "./advisory-waivers";
import { concludeGate, GateReport } from "./gate-report";

// Advisory-waiver gate — docs/security/ADVISORY-WAIVER-POLICY.md.
//
// Usage: bun tools/quality/check-advisory-waivers.ts [--root=<dir>] [--today=YYYY-MM-DD]
//
//   --root   the repository to examine (default: the current directory). It must
//            be a git work tree: the sources are its TRACKED files, so a waiver
//            file the repository does not commit cannot be read as policy.
//   --today  the UTC calendar date the clock-dependent rule is judged against
//            (default: the runner's UTC date). A flag, so tests and a reviewer
//            replaying a past verdict pass the clock instead of mocking it.
//
// The rules and the reasons for them live in ./advisory-waivers.ts. This file
// is the effectful half: enumerate, read, report.

export interface GateArguments {
  readonly root: string;
  readonly today: string;
}

export function parseArguments(argv: readonly string[], now: Date): GateArguments {
  let root = ".";
  let today = now.toISOString().slice(0, 10);
  for (const argument of argv) {
    if (argument.startsWith("--root=")) root = argument.slice("--root=".length);
    else if (argument.startsWith("--today=")) today = argument.slice("--today=".length);
    else throw new Error(`unknown argument '${argument}'`);
  }
  return { root: resolve(root), today };
}

function trackedFiles(root: string): string[] {
  const result = Bun.spawnSync(["git", "-C", root, "ls-files", "-z"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    // Not "no waiver files": the inventory itself could not be taken.
    throw new Error(
      `git ls-files failed in ${root}: ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter((path) => path !== "");
}

/** How the tracked tree was swept; the counters sum to `tracked`. */
export interface SweepCounters {
  readonly tracked: number;
  /** Text files read (classified or not). */
  readonly swept: number;
  /** Files with a NUL byte: no command line or TOML lives there. */
  readonly binary: number;
  /** Tracked paths that are not regular files (symlinks, submodules), by name. */
  readonly notRegular: readonly string[];
  /** Unclassified files that could not be read, by name. */
  readonly unreadable: readonly string[];
}

export interface RepositoryWaivers {
  readonly readings: SourceReading[];
  readonly isTrackedFile: (path: string) => boolean;
  readonly sweep: SweepCounters;
}

/**
 * Every advisory-waiver source of a git work tree, read as the gate reads it.
 *
 * Exported for any control that needs the waivers of a cloned repository; a
 * control that fetches files one by one calls `readWaiverFile` from
 * ./advisory-waivers.ts directly. Both are the gate's own reading.
 */
export function readRepositoryWaivers(root: string): RepositoryWaivers {
  const tracked = trackedFiles(root);
  const trackedSet = new Set(tracked);
  const readings: SourceReading[] = [];
  const notRegular: string[] = [];
  const unreadable: string[] = [];
  let swept = 0;
  let binary = 0;
  const regular = new Set<string>();
  for (const path of tracked) {
    const absolute = join(root, path);
    let isFile: boolean;
    try {
      isFile = lstatSync(absolute).isFile();
    } catch (error) {
      // A tracked path missing from the work tree: if its name is a waiver
      // source it is a failure, otherwise it cannot be swept and is named.
      const reading = readWaiverFile(path, "");
      if (reading !== null && reading.kind !== "other-text") {
        readings.push(unreadableSource(path, reading.kind, (error as Error).message));
      } else {
        unreadable.push(path);
      }
      continue;
    }
    if (!isFile) {
      // A waiver source behind a symlink is still read by its tool; the gate
      // does not follow links (the repository versions the link, not its
      // target), so it refuses rather than reading nothing.
      const kind = classifySource(path);
      if (kind !== null) {
        readings.push(unreadableSource(path, kind, "not a regular file (symlink or submodule)"));
      } else {
        notRegular.push(path);
      }
      continue;
    }
    regular.add(path);
    let bytes: Buffer;
    try {
      bytes = readFileSync(absolute);
    } catch (error) {
      const reading = readWaiverFile(path, "");
      if (reading !== null && reading.kind !== "other-text") {
        readings.push(unreadableSource(path, reading.kind, (error as Error).message));
      } else {
        unreadable.push(path);
      }
      continue;
    }
    if (bytes.includes(0)) {
      binary += 1;
      continue;
    }
    swept += 1;
    const text = bytes.toString("utf8");
    if (path.endsWith("package.json")) {
      try {
        JSON.parse(text);
      } catch (error) {
        readings.push({
          file: path,
          kind: "audit-command",
          entries: [],
          anchor: null,
          error: `is not valid JSON: ${(error as Error).message}`,
          unattributed: [],
          skipped: null,
        });
        continue;
      }
    }
    const reading = readWaiverFile(path, text);
    if (reading !== null) readings.push(reading);
  }
  // Tracked regular files only: a record present on disk but never committed is
  // not one anyone else can read, and a directory is not a record.
  const isTrackedFile = (path: string) => trackedSet.has(path) && regular.has(path);
  return {
    readings,
    isTrackedFile,
    sweep: { tracked: tracked.length, swept, binary, notRegular, unreadable },
  };
}

if (import.meta.main) {
  const report = new GateReport();
  const args = parseArguments(Bun.argv.slice(2), new Date());
  if (!existsSync(args.root)) {
    console.error(`Advisory waivers: --root ${args.root} does not exist`);
    process.exit(2);
  }
  const { readings, isTrackedFile, sweep } = readRepositoryWaivers(args.root);
  const evaluation = evaluateWaivers(readings, { today: args.today, isTrackedFile });

  // Every classified source is one assertion — it was read and its waivers (if
  // any) judged, or it was skipped with its reason. Zero sources leaves the
  // report empty, and an empty report fails: a repository with no workflow, no
  // manifest and no Cargo policy was not examined, it was skipped.
  for (const reading of readings) {
    if (reading.error !== null) continue;
    const note =
      reading.skipped === null
        ? `${reading.kind}: ${reading.entries.length} waiver(s) read`
        : `${reading.kind}: skipped, ${reading.skipped}`;
    report.check(reading.file, true, note);
  }
  for (const line of evaluation.clean) report.check(line, true, "dated, referenced, bounded");
  for (const defect of evaluation.defects) {
    report.check(`${defect.code} ${defect.where}`, false, defect.message);
  }
  report.volume(volumeLine(evaluation));

  const notSwept = [
    ...sweep.notRegular.map((path) => `${path} (not a regular file)`),
    ...sweep.unreadable.map((path) => `${path} (unreadable)`),
  ];
  console.log(
    `Advisory waivers: ${sweep.tracked} tracked file(s): ${sweep.swept} swept as text, ` +
      `${sweep.binary} binary, ${notSwept.length} not swept${notSwept.length === 0 ? "" : `: ${notSwept.join(", ")}`}`,
  );
  console.log(`Advisory waivers: ${volumeLine(evaluation)}; judged at ${args.today} (UTC)`);
  for (const warning of evaluation.warnings) console.warn(`Advisory waivers: WARN ${warning}`);
  concludeGate("Advisory waivers", report);
}
