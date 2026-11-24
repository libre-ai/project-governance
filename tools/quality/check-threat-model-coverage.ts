/**
 * Every quality gate answers to a threat, or says it answers to none.
 *
 * `docs/security/THREAT-MODEL.md` names its threats in two tables: the residual
 * risks `R<n>`, and the gaps `U<n>` of its "Threats to resolve" section, each
 * derived from a sentence of the document where a control is not yet enforced.
 * Until this gate, nothing read the gates against those rows: a gate could exist
 * that no threat justified, and a gap could stand in the document with no gate
 * watching it. `threat-model-coverage.v1.json` holds one entry per tracked gate:
 * the rows it covers (`covers`, possibly `[]`) and why (`because`).
 *
 * What this gate asserts, mechanically:
 *   - every tracked gate of `tools/quality/` (`gateGlob`, `.ts` or `.sh`, not a
 *     test) has exactly one entry, and every entry names a tracked gate: an entry
 *     whose file is gone or no longer matches fails, and so does a duplicate;
 *   - every identifier of `covers` is a `R<n>` or `U<n>` row really present in the
 *     tables of the threat model. A threat model that cannot be read is a failure,
 *     never zero rows;
 *   - `because` is not empty.
 * In success as in failure it prints its counters, which sum: `gates tracked =
 * listed + unlisted`, `entries = covering a row + covering none` and `threat rows =
 * covered + uncovered`. A listed gate is not a justified gate: only the second sum
 * says how many gates name a threat. The rows no gate
 * covers are listed as information, not as a failure.
 *
 * What it deliberately does NOT assert: that a `covers` names the RIGHT threat for
 * a gate. That is a judgment of review, made by reading the gate's header against
 * the text of the row. A mechanical match between the two would only restate one
 * with the other, and drift with it.
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import { type ReadFile, readOrNull } from "./check-threat-model-citations";
import { concludeGate, GateReport } from "./gate-report";

export const GATE = "Threat-model coverage";
export const CONFIG_PATH = "tools/quality/threat-model-coverage.v1.json";

export interface CoverageEntry {
  readonly path: string;
  readonly covers: readonly string[];
  readonly because: string;
}

export interface CoverageConfig {
  readonly threatModel: string;
  readonly gateGlob: string;
  readonly gates: readonly CoverageEntry[];
}

export interface CoverageInput {
  readonly threatModel: ReadFile;
  /** Tracked gates, already filtered by `isGatePath`. */
  readonly tracked: readonly string[];
  readonly config: CoverageConfig;
}

export interface CoverageVolume {
  readonly tracked: number;
  readonly listed: number;
  readonly unlisted: number;
  readonly entries: number;
  /** Entries whose `covers` names at least one row; the rest declare they cover none. */
  readonly covering: number;
  readonly coveringNone: number;
  readonly orphans: number;
  readonly threatRows: number;
  readonly covered: number;
  readonly uncovered: number;
  readonly uncoveredIds: readonly string[];
}

// A threat row is `| R4  | ...` or `| U1  | ...`: the identifier is its first cell.
const THREAT_ROW = /^\| ([RU]\d+)\s*\|/;

/** Identifiers of the threat rows of a document, in document order, duplicates included. */
export function threatRowsOf(text: string): string[] {
  return text.split("\n").flatMap((line) => {
    const id = THREAT_ROW.exec(line)?.[1];
    return id === undefined ? [] : [id];
  });
}

/** Whether a tracked path is a gate: matches the glob, is `.ts` or `.sh`, and is not a test. */
export function isGatePath(path: string, gateGlob: string): boolean {
  return (
    new Bun.Glob(gateGlob).match(path) && /\.(ts|sh)$/.test(path) && !path.endsWith(".test.ts")
  );
}

/** Pure verdict over the inputs already read, so every rule is testable without git. */
export function evaluateCoverage(input: CoverageInput): {
  report: GateReport;
  volume: CoverageVolume;
  summary: string;
} {
  const report = new GateReport();
  const { config } = input;

  if (input.threatModel.text === null) {
    report.check(
      input.threatModel.path,
      false,
      "the threat model could not be read — a missing model is not zero threat rows",
    );
  }
  const rowIds = input.threatModel.text === null ? [] : threatRowsOf(input.threatModel.text);
  const rows = new Set(rowIds);
  if (input.threatModel.text !== null) {
    const duplicates = rowIds.filter((id, index) => rowIds.indexOf(id) !== index);
    report.check(
      input.threatModel.path,
      rows.size > 0 && duplicates.length === 0,
      rows.size === 0
        ? "no R<n> or U<n> row parsed — every covers would read as unknown"
        : duplicates.length > 0
          ? `duplicate threat row(s): ${[...new Set(duplicates)].join(", ")}`
          : `${rows.size} threat row(s) parsed`,
    );
  }

  const declared = new Map<string, number>();
  for (const entry of config.gates) {
    declared.set(entry.path, (declared.get(entry.path) ?? 0) + 1);
  }

  let listed = 0;
  for (const gate of input.tracked) {
    const hasEntry = declared.has(gate);
    if (hasEntry) listed += 1;
    if (!hasEntry) {
      report.check(
        gate,
        false,
        `tracked gate has no entry in ${CONFIG_PATH} — add one, with covers (possibly []) and because`,
      );
    }
  }

  const tracked = new Set(input.tracked);
  const covered = new Set<string>();
  const seen = new Set<string>();
  let orphans = 0;
  let covering = 0;
  for (const entry of config.gates) {
    const problems: string[] = [];
    if (entry.covers.length > 0) covering += 1;
    if (!tracked.has(entry.path)) {
      orphans += 1;
      problems.push(
        "no tracked gate at this path (the file is missing, or gateGlob does not match it)",
      );
    }
    if (seen.has(entry.path)) problems.push("duplicate entry for this gate");
    seen.add(entry.path);
    if (entry.because.trim() === "") problems.push("because is empty");
    for (const id of entry.covers) {
      if (rows.has(id)) covered.add(id);
      else problems.push(`${id} is not a R<n> or U<n> row of the threat model`);
    }
    if (problems.length > 0) {
      report.check(entry.path, false, problems.join("; "));
    } else {
      const note =
        entry.covers.length === 0
          ? `covers no threat row: ${entry.because}`
          : `covers ${entry.covers.join(", ")}: ${entry.because}`;
      report.check(entry.path, true, note);
    }
  }

  const uniqueRows = [...new Set(rowIds)];
  const uncoveredIds = uniqueRows.filter((id) => !covered.has(id));
  const volume: CoverageVolume = {
    tracked: input.tracked.length,
    listed,
    unlisted: input.tracked.length - listed,
    entries: config.gates.length,
    covering,
    coveringNone: config.gates.length - covering,
    orphans,
    threatRows: rows.size,
    covered: uniqueRows.length - uncoveredIds.length,
    uncovered: uncoveredIds.length,
    uncoveredIds,
  };
  const summary =
    `${volume.tracked} gate(s) tracked = ${volume.listed} listed + ${volume.unlisted} unlisted; ` +
    `${volume.entries} entr(ies) declared = ${volume.covering} covering a row + ${volume.coveringNone} covering none, ${volume.orphans} orphan; ` +
    `${volume.threatRows} threat row(s) = ${volume.covered} covered + ${volume.uncovered} uncovered; ` +
    `uncovered (information, not a failure): ${uncoveredIds.join(", ") || "none"}`;
  report.volume(summary);
  return { report, volume, summary };
}

/** Collects the inputs from disk: the effectful half of the gate. */
export async function loadCoverageInput(
  root: string,
  config: CoverageConfig,
  tracked: readonly string[],
): Promise<CoverageInput> {
  return {
    threatModel: await readOrNull(root, config.threatModel),
    tracked: tracked.filter((path) => isGatePath(path, config.gateGlob)),
    config,
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function validateCoverageConfig(value: unknown): CoverageConfig {
  const where = `${CONFIG_PATH}:`;
  const candidate = value as Partial<CoverageConfig> | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    !isString(candidate.threatModel) ||
    !isString(candidate.gateGlob) ||
    !Array.isArray(candidate.gates)
  ) {
    throw new Error(`${where} expected { threatModel, gateGlob, gates[] }`);
  }
  for (const entry of candidate.gates as readonly Partial<CoverageEntry>[]) {
    if (
      !isString(entry?.path) ||
      !Array.isArray(entry.covers) ||
      !entry.covers.every(isString) ||
      typeof entry.because !== "string"
    ) {
      throw new Error(`${where} every gate needs a path, a covers list and a because`);
    }
  }
  return candidate as CoverageConfig;
}

if (import.meta.main) {
  const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  const config = validateCoverageConfig(await Bun.file(join(root, CONFIG_PATH)).json());
  const tracked = execSync("git ls-files", { encoding: "utf8", cwd: root })
    .split("\n")
    .filter(Boolean);
  const { report, summary } = evaluateCoverage(await loadCoverageInput(root, config, tracked));
  if (report.outcome === "violations") console.error(`${GATE}: ${summary}`);
  concludeGate(GATE, report);
}
