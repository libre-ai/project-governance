import { join } from "node:path";
import { printable } from "./fleet-gates";

/**
 * What the three detectors of `ecosystem/fleet-detectors/` share: reading the
 * tracked files of one worktree, the shape of a finding line, and the run
 * protocol of `ecosystem/fleet-state.ts` (one non-empty stdout line per
 * finding, exit 0 for a measure, anything else an error).
 *
 * WHY THE TRACKED TREE. `fleet-state.ts` measures a worktree only when it is
 * clean, so the tracked files are HEAD. Reading `git ls-files` rather than
 * walking the directory keeps `.git`, ignored caches and build outputs out of
 * the measure without a skip list.
 *
 * A SOURCE THAT CANNOT BE READ IS AN ERROR, NEVER A ZERO. A failing
 * `git ls-files`, a tracked file absent from the working tree or unreadable,
 * a missing input variable: the run exits non-zero with the reason on stderr,
 * so the state records `erreur`, not `conforme`.
 *
 * THE VOLUME. Every run prints, on stderr (stdout is the findings), what it
 * examined, and the counters sum: tracked = out of scope + links + submodules
 * + binary + read.
 */

/** A file of the worktree, read as text. */
export interface TrackedFile {
  readonly path: string;
  readonly text: string;
}

export interface TrackedRead {
  readonly files: readonly TrackedFile[];
  readonly tracked: number;
  /** Tracked paths the detector's scope filter declined. */
  readonly outOfScope: number;
  /** Mode 120000: the repository versions the link, not its target. */
  readonly links: number;
  /** Mode 160000: another repository, measured on its own. */
  readonly submodules: number;
  /** A NUL byte in the first 8000 bytes, git's own binary heuristic. */
  readonly binary: number;
}

/** A source the detector could not read; the run fails with this message. */
export class DetectorInputError extends Error {}

const BINARY_PROBE_BYTES = 8000;

/** A variable of the run protocol (`FLEET_WORKTREE`, …); absent or empty is an input error. */
export function requiredVariable(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value === "") {
    throw new DetectorInputError(`${name} is not set`);
  }
  return value;
}

export interface ReadOptions {
  /**
   * Set aside a file with a NUL byte in its first 8000 bytes as binary. Off
   * for a detector whose scope is source files: a NUL byte does not stop bun
   * or rustc from reading a source, so it must not stop the scan either.
   */
  readonly skipBinary: boolean;
}

/**
 * The tracked files of `worktree` that `inScope` keeps, read as text. Links
 * and submodules are counted apart, never read (a link is versioned, not its
 * target, which may lie outside the worktree); binary files too, when the
 * options say so. A worktree with no tracked file is an error: an empty source
 * is not a clean one.
 */
export async function readTrackedFiles(
  worktree: string,
  inScope: (path: string) => boolean,
  options: ReadOptions = { skipBinary: true },
): Promise<TrackedRead> {
  const listed = Bun.spawnSync(["git", "-C", worktree, "ls-files", "--stage", "-z"], {
    stdout: "pipe",
    stderr: "pipe",
    env: withoutGitVariables(process.env),
  });
  if (listed.exitCode !== 0) {
    throw new DetectorInputError(
      `git ls-files failed in ${printable(worktree)}: ${printable(listed.stderr.toString().trim())}`,
    );
  }
  const records = listed.stdout
    .toString()
    .split("\0")
    .filter((record) => record !== "");
  if (records.length === 0) {
    throw new DetectorInputError(`no tracked file in ${printable(worktree)}: nothing to measure`);
  }

  const files: TrackedFile[] = [];
  let outOfScope = 0;
  let links = 0;
  let submodules = 0;
  let binary = 0;
  const seen = new Set<string>();
  for (const record of records) {
    // `<mode> <sha> <stage>\t<path>`; a conflicted path appears once per stage.
    const tab = record.indexOf("\t");
    const mode = record.slice(0, record.indexOf(" "));
    const path = record.slice(tab + 1);
    if (seen.has(path)) continue;
    seen.add(path);
    if (!inScope(path)) {
      outOfScope += 1;
      continue;
    }
    if (mode === "120000") {
      links += 1;
      continue;
    }
    if (mode === "160000") {
      submodules += 1;
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await Bun.file(join(worktree, path)).bytes();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new DetectorInputError(
        `tracked file ${printable(path)} unreadable: ${printable(reason)}`,
      );
    }
    if (options.skipBinary && bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
      binary += 1;
      continue;
    }
    files.push({ path, text: new TextDecoder().decode(bytes) });
  }
  return { files, tracked: seen.size, outOfScope, links, submodules, binary };
}

/** The volume line of a read; its terms sum to `tracked`. */
export function describeRead(read: TrackedRead): string {
  return `${read.tracked} tracked = ${read.outOfScope} out of scope + ${read.links} link(s) + ${read.submodules} submodule(s) + ${read.binary} binary + ${read.files.length} read`;
}

/**
 * One finding as `fleet-state.ts` stores it and `tools/fleet/remediation/kit.ts`
 * parses it: `path:line:rule`. The rule is the detector's own identifier,
 * never the matched text, which may carry what the detector exists to keep out
 * of the record (a user name, for one).
 *
 * The path is encoded so the line stays one finding and its first colon stays
 * the separator: a backslash becomes `\` first (so the encoding is
 * reversible), then a colon `:`, then control and bidi characters as
 * `printable` writes them. `decodeFindingPath` is the inverse.
 */
export function findingLine(path: string, line: number, rule: string): string {
  const encoded = printable(path.replaceAll("\\", "\\u005c").replaceAll(":", "\\u003a"));
  return `${encoded}:${line}:${rule}`;
}

/** The path a `findingLine` encoded. */
export function decodeFindingPath(encoded: string): string {
  return encoded.replace(/\\u([0-9a-f]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

export interface DetectorResult {
  readonly findings: readonly string[];
  readonly volume: string;
}

/**
 * Runs one detector as a command: findings on stdout, the volume on stderr,
 * exit 0; a DetectorInputError on stderr with exit 1.
 */
export async function runDetectorCommand(
  name: string,
  measure: () => Promise<DetectorResult>,
): Promise<never> {
  try {
    const result = await measure();
    for (const finding of result.findings) console.log(finding);
    console.error(`${name}: ${result.findings.length} finding(s); ${result.volume}`);
    process.exit(0);
  } catch (error) {
    if (!(error instanceof DetectorInputError)) throw error;
    console.error(`${name}: ${error.message}`);
    process.exit(1);
  }
}

/** A GIT_DIR or GIT_INDEX_FILE inherited by hand would aim git at another repository. */
function withoutGitVariables(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined && !key.startsWith("GIT_")) kept[key] = value;
  }
  return kept;
}
