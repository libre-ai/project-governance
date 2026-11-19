import {
  type DetectorResult,
  describeRead,
  findingLine,
  readTrackedFiles,
  requiredVariable,
  runDetectorCommand,
} from "./fleet-detector-io";

/**
 * Fleet detector `local-paths` (run by `ecosystem/fleet-detectors/
 * local-paths.sh`): an absolute path of one workstation in a tracked text file.
 *
 * The pattern is the generic one of `tools/quality/check-context-hygiene.sh`
 * (a macOS home followed by a name), extended to Linux homes, and its only
 * exemption is that gate's: a line carrying the `allow-local-path` marker.
 * That gate cannot be called here: it is bound to this repository (it moves to
 * its own root and adds this repository's private deny-list), so the pattern is
 * restated, not imported.
 *
 * One deliberate narrowing against that gate: the home must not follow a
 * name character (letter, digit, `_`, `.`, `-`), so a web path whose segment
 * happens to be `home` after a host name, or a relative path through a `home`
 * folder, is not a workstation path; after a slash, a quote, a blank, a colon
 * (a file URL, a drive letter) it is. The examples are in the tests, not here:
 * this file is itself scanned.
 *
 * A finding names the line, never the path it found: the record of a measure
 * must not carry the user name this detector exists to keep out of the tree.
 */

export const LOCAL_PATH_RULE = "local-path";
export const LOCAL_PATH_MARKER = "allow-local-path";

const HOME_PATH = /(?<![A-Za-z0-9_.-])\/(?:Users|home)\/[A-Za-z0-9._-]+/;

export interface LocalPathScan {
  readonly findings: readonly string[];
  readonly exempted: number;
}

/** Pure: one finding per line that names a workstation home without the marker. */
export function scanLocalPaths(
  files: readonly { readonly path: string; readonly text: string }[],
): LocalPathScan {
  const findings: string[] = [];
  let exempted = 0;
  for (const file of files) {
    for (const [index, line] of file.text.split("\n").entries()) {
      if (!HOME_PATH.test(line)) continue;
      if (line.includes(LOCAL_PATH_MARKER)) {
        exempted += 1;
        continue;
      }
      findings.push(findingLine(file.path, index + 1, LOCAL_PATH_RULE));
    }
  }
  return { findings, exempted };
}

export async function measureLocalPaths(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<DetectorResult> {
  const worktree = requiredVariable(environment, "FLEET_WORKTREE");
  const read = await readTrackedFiles(worktree, () => true);
  const scan = scanLocalPaths(read.files);
  return {
    findings: scan.findings,
    volume: `${describeRead(read)} text file(s); ${scan.exempted} line(s) exempted by « ${LOCAL_PATH_MARKER} »`,
  };
}

if (import.meta.main) {
  await runDetectorCommand("local-paths", () => measureLocalPaths(process.env));
}
