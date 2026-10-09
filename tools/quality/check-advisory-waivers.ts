import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  classifySource,
  evaluateWaivers,
  readSource,
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

export function readRepository(root: string): {
  readings: SourceReading[];
  refExists: (ref: string) => boolean;
} {
  const tracked = trackedFiles(root);
  const trackedSet = new Set(tracked);
  const readings: SourceReading[] = [];
  for (const path of tracked) {
    const kind = classifySource(path);
    if (kind === null) continue;
    let text: string;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch (error) {
      readings.push(unreadableSource(path, kind, (error as Error).message));
      continue;
    }
    if (path.endsWith("package.json")) {
      try {
        JSON.parse(text);
      } catch (error) {
        readings.push({
          file: path,
          kind,
          entries: [],
          anchor: null,
          error: `is not valid JSON: ${(error as Error).message}`,
        });
        continue;
      }
    }
    readings.push(readSource(path, kind, text));
  }
  // Tracked only: a ref to a file present on disk but never committed is not a
  // record anyone else can read.
  const refExists = (ref: string) =>
    trackedSet.has(ref) || tracked.some((path) => path.startsWith(`${ref}/`));
  return { readings, refExists };
}

if (import.meta.main) {
  const report = new GateReport();
  const args = parseArguments(Bun.argv.slice(2), new Date());
  if (!existsSync(args.root)) {
    console.error(`Advisory waivers: --root ${args.root} does not exist`);
    process.exit(2);
  }
  const { readings, refExists } = readRepository(args.root);
  const evaluation = evaluateWaivers(readings, { today: args.today, refExists });

  // Every readable source is one assertion — it was read, and its waivers (if
  // any) were judged. Zero sources leaves the report empty, and an empty report
  // fails: a repository with no workflow, no manifest and no Cargo policy was
  // not examined, it was skipped.
  for (const reading of readings) {
    if (reading.error === null) {
      report.check(reading.file, true, `${reading.kind}: ${reading.entries.length} waiver(s) read`);
    }
  }
  for (const line of evaluation.clean) report.check(line, true, "dated, referenced, bounded");
  for (const defect of evaluation.defects) {
    report.check(`${defect.code} ${defect.where}`, false, defect.message);
  }
  report.volume(volumeLine(evaluation));

  console.log(`Advisory waivers: ${volumeLine(evaluation)}; judged at ${args.today} (UTC)`);
  for (const warning of evaluation.warnings) console.warn(`Advisory waivers: WARN ${warning}`);
  concludeGate("Advisory waivers", report);
}
