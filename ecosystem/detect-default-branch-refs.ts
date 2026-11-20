import { join } from "node:path";
import {
  ALLOWANCE_MARKER,
  isScannedFile,
  locateWorkflowsMissingServedBranch,
  SCANNED_EXTENSIONS,
  scanForWrittenRefs,
} from "../tools/quality/check-resolved-refs";
import {
  DetectorInputError,
  type DetectorResult,
  describeRead,
  findingLine,
  readTrackedFiles,
  requiredVariable,
  runDetectorCommand,
} from "./fleet-detector-io";

/**
 * Fleet detector `default-branch-ref` (run by `ecosystem/fleet-detectors/
 * default-branch-ref.sh`): a default branch written down where it must be
 * resolved, on one measured worktree.
 *
 * Both halves are `tools/quality/check-resolved-refs.ts`, imported:
 * `scanForWrittenRefs` (its request forms, its scanned extensions, its
 * test-and-fixture exemption, its `allow-hardcoded-ref: <reason>` marker) and
 * the workflow filter that omits the served branch. Three things differ, all
 * because the fleet is not this repository:
 *
 *   - the scope is every tracked file of a scanned extension, not this
 *     repository's eight roots: a product keeps its tooling where it likes;
 *   - Rust sources are scanned too (`.rs`), since fleet crates make requests;
 *   - the served branch is the forge snapshot's (`$FLEET_SNAPSHOT/<owner>/
 *     <name>.json`, `default_branch`), never the local checkout's. A snapshot
 *     that is absent or unreadable fails the run: a workflow filter judged
 *     against no branch would read « conforme ».
 */

export const WORKFLOW_RULE = "workflow-filter-omits-served-branch";

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;

/** The gate's extensions, plus Rust: a fleet crate makes requests too. */
export const DETECTOR_EXTENSIONS: ReadonlySet<string> = new Set([...SCANNED_EXTENSIONS, ".rs"]);

/** The served branch of `repository` in a `forge-snapshot.ts` directory. */
export async function servedBranchOf(snapshot: string, repository: string): Promise<string> {
  const path = join(snapshot, `${repository}.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await Bun.file(path).text());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DetectorInputError(`forge snapshot of ${repository} unreadable: ${reason}`);
  }
  const branch =
    typeof parsed === "object" && parsed !== null && "default_branch" in parsed
      ? parsed.default_branch
      : undefined;
  if (typeof branch !== "string" || branch === "") {
    throw new DetectorInputError(`forge snapshot of ${repository} carries no default_branch`);
  }
  return branch;
}

export async function measureDefaultBranchRefs(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<DetectorResult> {
  const worktree = requiredVariable(environment, "FLEET_WORKTREE");
  const repository = requiredVariable(environment, "FLEET_REPOSITORY");
  const snapshot = requiredVariable(environment, "FLEET_SNAPSHOT");
  const served = await servedBranchOf(snapshot, repository);
  // Scope by extension, read without the binary heuristic: a NUL byte does
  // not stop a source from running, so it must not stop the scan.
  const read = await readTrackedFiles(
    worktree,
    (path) => isScannedFile(path, DETECTOR_EXTENSIONS),
    { skipBinary: false },
  );

  const scan = scanForWrittenRefs(read.files, DETECTOR_EXTENSIONS);
  const workflows = read.files.filter((file) => WORKFLOW.test(file.path));
  let filters: ReturnType<typeof locateWorkflowsMissingServedBranch>;
  try {
    filters = locateWorkflowsMissingServedBranch(workflows, served);
  } catch (error) {
    // A workflow that cannot be parsed cannot be judged: an error, never a zero.
    throw new DetectorInputError(error instanceof Error ? error.message : String(error));
  }
  const findings = [
    ...scan.findings.map((found) => findingLine(found.file, found.line, found.id)),
    ...filters.map((found) => findingLine(found.path, found.line, WORKFLOW_RULE)),
  ];
  return {
    findings,
    volume: `${describeRead(read)} text file(s); ${scan.filesScanned} scanned for written refs, ${scan.patternSubjects} test/fixture exempt, ${scan.allowed.length} line(s) exempted by « ${ALLOWANCE_MARKER} <reason> »; ${workflows.length} workflow(s) judged against the served branch ${served}`,
  };
}

if (import.meta.main) {
  await runDetectorCommand("default-branch-ref", () => measureDefaultBranchRefs(process.env));
}
