/**
 * Measured fleet state and the ticket table derived from it (lot L093, ideas
 * h-plugins-flotte-03 and h-plugins-flotte-08; owner's decision of 2026-11-17,
 * option B: the detectors of `fleet-gates.ts` run on local worktrees and on the
 * local forge snapshot of `forge-snapshot.ts`, never on a quota API).
 *
 *   bun ecosystem/fleet-state.ts state --detectors <dir> --worktrees <dir>
 *       --snapshot <dir> --out <dir> --label <label>
 *       [--repos owner/a,owner/b] [--registry <file>] [--inventory <file>]
 *   bun ecosystem/fleet-state.ts tickets <state-dir> --detectors <dir> [--registry <file>]
 *
 * WHAT A DETECTOR RUN IS (this module owns execution; `fleet-gates.ts` only
 * discovers). The script is executed directly (its shebang and executable bit
 * are its own), with an argument vector and no shell. A `repo` detector runs
 * with the worktree `<worktrees>/<owner>/<name>` as working directory, once per
 * measured repository; a `parc` detector runs once, from the worktrees root.
 * Each non-empty line of its standard output is one finding: the count is the
 * number of such lines, and the lines are the proof. Exit 0 is a measure; any
 * other exit, a signal, a timeout, an output over DETECTOR_MAX_STDOUT_BYTES or
 * that is not UTF-8: an error, never a count of zero.
 *
 * A worktree is measured only when it is safe to call it "HEAD": the
 * repository name is a plain `owner/name` (REPOSITORY_NAME, no `.` or `..`
 * segment), neither segment under the worktrees root is a symbolic link, its
 * real path is that very path, it is the root of its own git repository, and
 * `git status --porcelain --untracked-files=all` is empty (a detector reads the
 * working tree, so a modified or untracked file would be measured as if it were
 * HEAD). Otherwise every measure of it is an error, and the detector runs in
 * the verified real path, never in a path re-joined later.
 *
 * A detector runs in its own process group. At the timeout, at an output over
 * the bound and as soon as the detector itself exits, the whole group is
 * killed: a background process it left cannot outlive the measure, and output
 * written after the pipes are drained (or a pipe still held open by a process
 * that escaped the group, OUTPUT_DRAIN_MS after the exit) is never counted.
 *
 * Its environment is built, not inherited: PATH, HOME, TMPDIR, LANG and LC_ALL
 * when set, plus FLEET_WORKTREES, FLEET_SNAPSHOT (both absolute),
 * FLEET_REPOSITORY and FLEET_WORKTREE for a `repo` run, FLEET_REPOSITORIES (one
 * per line) for a `parc` run. The snapshot holds `<owner>/<name>.json` per
 * repository. This confinement is of the environment only, not a sandbox: no
 * token variable of the caller is passed, but a detector runs as the caller's
 * user, with HOME, and can read whatever that user can (a credential helper, a
 * keychain, a token file). Detectors are trusted code of the registry.
 *
 * WHAT IS WRITTEN. `<out>/<label>/` holds `state.tsv` (one line per measure:
 * dépôt, détecteur, compte, cible, verdict, statut, détail), `heads.tsv` (the
 * HEAD sha each measured worktree was read at, so a later step can refuse a
 * stale input), `measured-at.txt` (ISO 8601) and `preuves/<detector>/<owner>/
 * <name>.txt`, or `preuves/<detector>/parc.txt` for a `parc` measure, whose
 * repository column is `*`. A measure in error writes no proof. The state is
 * staged beside its target then renamed: a label already used is refused, a
 * state is never merged or partial. Each run is a dated photograph; replaying
 * after a merge writes a new label, nothing is tracked continuously.
 *
 * Verdicts: conforme (status ok, integer target, count equal to it), info
 * (status ok, target `info`), erreur (status erreur, whatever the target),
 * exempté (private or archived repository, `fleet-tree.ts` `exemption`, the
 * detector is not run), écart (the rest). A finding does not fail the tool; a
 * measure in error does, and is printed as one `ERREUR` line on stderr.
 *
 * Ticket statuses: conforme, à corriger, informatif, ERREUR, EXEMPTÉ (every
 * line of the detector is exempt: nothing was measured, nothing is wrong) and
 * ABSENT (the detector has no line in the state).
 *
 * Exit codes of `state`: 0 measured (findings or not), 1 a measure in error,
 * an inconsistent sum, an invalid configuration (discovery refused, including
 * zero detectors) or a failed write, 2 usage, 4 an input absent or unreadable
 * (inventory, including a repository name that is not a plain `owner/name`,
 * worktrees root, snapshot directory). Exit codes of `tickets`:
 * 0, 1 invalid detector configuration, 2 usage, 4 state absent, unreadable or
 * empty.
 */

import { type ChildProcess, spawn as spawnChild } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseRegistry as parseInventory, type RegistryEntry } from "./check-context-conformance";
import {
  type DetectorDescriptor,
  type Discovery,
  discoverDetectors,
  printable,
  REGISTRY_PATH,
} from "./fleet-gates";
import { exemption } from "./fleet-tree";

/** The repository column of a measure of `parc` scope. */
export const PARK_REPOSITORY = "*";
/** The proof file name of a measure of `parc` scope. */
const PARK_PROOF = "parc";

export type Verdict = "conforme" | "info" | "écart" | "erreur" | "exempté";
export type MeasureStatus = "ok" | "erreur" | "exempté";

const VERDICTS: readonly Verdict[] = ["conforme", "info", "écart", "erreur", "exempté"];
const STATUSES: readonly MeasureStatus[] = ["ok", "erreur", "exempté"];

export const STATE_COLUMNS = [
  "dépôt",
  "détecteur",
  "compte",
  "cible",
  "verdict",
  "statut",
  "détail",
] as const;
const HEADS_COLUMNS = ["dépôt", "sha"] as const;

export interface Measure {
  /** `owner/name`, or `*` for a `parc` measure. */
  readonly repository: string;
  readonly detector: string;
  /** Findings counted; null when nothing was measured (error, exemption). */
  readonly count: number | null;
  /** The declared target; null for `info`. */
  readonly target: number | null;
  readonly verdict: Verdict;
  readonly status: MeasureStatus;
  /** Proof path (ok), reason (erreur) or exemption note (exempté), printable. */
  readonly detail: string;
  /** The detector's finding lines; empty unless the status is ok. */
  readonly lines: readonly string[];
}

export type HeadRead =
  | { readonly ok: true; readonly sha: string }
  | { readonly ok: false; readonly reason: string };

export type DetectorTarget =
  | { readonly scope: "repo"; readonly repository: string }
  | { readonly scope: "parc"; readonly repositories: readonly string[] };

export type DetectorRun =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Everything the measure reads from outside: the HEAD of a worktree and a
 * detector run. Tests inject fakes; the command injects `localFleetReader`.
 */
export interface FleetReader {
  head(repository: string): Promise<HeadRead>;
  run(detector: DetectorDescriptor, target: DetectorTarget): Promise<DetectorRun>;
}

export interface Measurement {
  readonly measures: readonly Measure[];
  /** HEAD sha of every worktree read, by repository, in measure order. */
  readonly heads: ReadonlyMap<string, string>;
}

/** The verdict of a measure that was run (statuses ok and erreur). */
export function verdictOf(status: "ok" | "erreur", target: number | null, count: number): Verdict {
  if (status === "erreur") return "erreur";
  if (target === null) return "info";
  return count === target ? "conforme" : "écart";
}

/**
 * A repository name the tool accepts: `owner/name`, each segment from a
 * closed alphabet. The name becomes a path (`<worktrees>/<owner>/<name>`, a
 * proof file) and a TSV cell, so a separator, a tab or a line break is refused
 * here, once, rather than escaped downstream.
 */
export const REPOSITORY_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Why a repository name is refused, or null. */
export function repositoryNameError(name: string): string | null {
  if (!REPOSITORY_NAME.test(name)) {
    return `« ${printable(name)} » is not a plain owner/name repository`;
  }
  if (name.split("/").some((segment) => segment === "." || segment === "..")) {
    return `« ${printable(name)} » has a . or .. segment`;
  }
  return null;
}

/** Path of a measure's proof, relative to the state directory. */
export function proofPath(detector: string, repository: string): string {
  const leaf = repository === PARK_REPOSITORY ? PARK_PROOF : repository;
  return `preuves/${detector}/${leaf}.txt`;
}

/** True when `path`, resolved, lies strictly under the directory `root`. */
function isUnder(root: string, path: string): boolean {
  return resolve(path).startsWith(`${resolve(root)}${sep}`);
}

/**
 * The absolute proof file of a measure inside `stateDirectory`; throws when it
 * would resolve outside it, whatever the repository or detector name holds.
 */
export function proofFile(stateDirectory: string, detector: string, repository: string): string {
  const path = resolve(stateDirectory, proofPath(detector, repository));
  if (!isUnder(stateDirectory, path)) {
    throw new Error(
      `proof of ${printable(detector)} ${printable(repository)} resolves outside the state`,
    );
  }
  return path;
}

function ran(detector: DetectorDescriptor, repository: string, run: DetectorRun): Measure {
  if (!run.ok) {
    return {
      repository,
      detector: detector.id,
      count: null,
      target: detector.target,
      verdict: "erreur",
      status: "erreur",
      detail: printable(run.reason),
      lines: [],
    };
  }
  return {
    repository,
    detector: detector.id,
    count: run.lines.length,
    target: detector.target,
    verdict: verdictOf("ok", detector.target, run.lines.length),
    status: "ok",
    detail: proofPath(detector.id, repository),
    lines: run.lines,
  };
}

/**
 * Runs every detector on every entry (`repo` scope) or once (`parc` scope).
 * Exempt entries get an `exempté` line and are neither read nor run. A
 * worktree whose HEAD cannot be read turns each of its measures into an error
 * without running the detector. Pure but for the injected reader.
 */
export async function measure(
  detectors: readonly DetectorDescriptor[],
  entries: readonly RegistryEntry[],
  reader: FleetReader,
): Promise<Measurement> {
  const measures: Measure[] = [];
  const heads = new Map<string, string>();
  const headReads = new Map<string, HeadRead>();
  const measured = entries.filter((entry) => exemption(entry) === null);

  for (const detector of detectors) {
    if (detector.scope === "parc") {
      const repositories = measured.map((entry) => entry.repository);
      measures.push(
        ran(detector, PARK_REPOSITORY, await reader.run(detector, { scope: "parc", repositories })),
      );
      continue;
    }
    for (const entry of entries) {
      const note = exemption(entry);
      if (note !== null) {
        measures.push({
          repository: entry.repository,
          detector: detector.id,
          count: null,
          target: detector.target,
          verdict: "exempté",
          status: "exempté",
          detail: printable(note),
          lines: [],
        });
        continue;
      }
      let head = headReads.get(entry.repository);
      if (head === undefined) {
        head = await reader.head(entry.repository);
        headReads.set(entry.repository, head);
        if (head.ok) heads.set(entry.repository, head.sha);
      }
      const run: DetectorRun = head.ok
        ? await reader.run(detector, { scope: "repo", repository: entry.repository })
        : { ok: false, reason: `worktree unreadable: ${head.reason}` };
      measures.push(ran(detector, entry.repository, run));
    }
  }
  return { measures, heads };
}

export interface Tally {
  readonly measures: number;
  readonly conforme: number;
  readonly info: number;
  readonly ecart: number;
  readonly erreur: number;
  readonly exempte: number;
}

export function tallyOf(verdicts: readonly Verdict[]): Tally {
  let conforme = 0;
  let info = 0;
  let ecart = 0;
  let erreur = 0;
  let exempte = 0;
  for (const verdict of verdicts) {
    if (verdict === "conforme") conforme += 1;
    else if (verdict === "info") info += 1;
    else if (verdict === "écart") ecart += 1;
    else if (verdict === "erreur") erreur += 1;
    else if (verdict === "exempté") exempte += 1;
  }
  return { measures: verdicts.length, conforme, info, ecart, erreur, exempte };
}

/** Measures a complete run must hold: one per `repo` detector and entry, one per `parc` detector. */
export function expectedMeasures(
  detectors: readonly DetectorDescriptor[],
  entries: readonly RegistryEntry[],
): number {
  const park = detectors.filter((detector) => detector.scope === "parc").length;
  return park + (detectors.length - park) * entries.length;
}

/**
 * Why the counters do not hold, or null: the verdicts must sum to the
 * measures, and the measures to the universe the run claims to cover.
 */
export function sumError(tally: Tally, expected: number): string | null {
  const summed = tally.conforme + tally.info + tally.ecart + tally.erreur + tally.exempte;
  if (summed !== tally.measures) {
    return `inconsistent sum: ${summed} verdicts for ${tally.measures} measures`;
  }
  if (tally.measures !== expected) {
    return `inconsistent sum: ${tally.measures} measures where ${expected} were expected`;
  }
  return null;
}

export function summaryLine(label: string, tally: Tally): string {
  return `fleet state ${printable(label)}: measures=${tally.measures} conforme=${tally.conforme} info=${tally.info} ecart=${tally.ecart} erreur=${tally.erreur} exempte=${tally.exempte}`;
}

function cell(value: number | null, absent: string): string {
  return value === null ? absent : String(value);
}

export function renderStateTsv(measures: readonly Measure[]): string {
  const rows = measures.map((m) =>
    [
      m.repository,
      m.detector,
      cell(m.count, "-"),
      cell(m.target, "info"),
      m.verdict,
      m.status,
      m.detail,
    ].join("\t"),
  );
  return `${[STATE_COLUMNS.join("\t"), ...rows].join("\n")}\n`;
}

function renderHeadsTsv(heads: ReadonlyMap<string, string>): string {
  const rows = [...heads].map(([repository, sha]) => `${repository}\t${sha}`);
  return `${[HEADS_COLUMNS.join("\t"), ...rows].join("\n")}\n`;
}

// ------------------------------------------------------------------ reading a state

export interface StateRow {
  readonly repository: string;
  readonly detector: string;
  readonly count: number | null;
  readonly target: number | null;
  readonly verdict: Verdict;
  readonly status: MeasureStatus;
  readonly detail: string;
}

export interface FleetState {
  readonly label: string;
  readonly measuredAt: string;
  readonly rows: readonly StateRow[];
  readonly heads: ReadonlyMap<string, string>;
  /** Lines of state.tsv after its header. */
  readonly lineCount: number;
}

/** Any reason a state directory cannot be read as one. */
export class StateReadError extends Error {}

const INTEGER = /^(0|[1-9][0-9]*)$/;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function tableLines(text: string, columns: readonly string[], file: string): string[][] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const [header, ...body] = lines;
  if (header !== columns.join("\t")) throw new StateReadError(`${file}: unexpected header`);
  return body.map((line, index) => {
    const fields = line.split("\t");
    if (fields.length !== columns.length) {
      throw new StateReadError(
        `${file}: line ${index + 2} has ${fields.length} columns, ${columns.length} expected`,
      );
    }
    return fields;
  });
}

function asCount(text: string, absent: string, where: string): number | null {
  if (text === absent) return null;
  if (!INTEGER.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new StateReadError(`${where}: « ${printable(text)} » is not a count`);
  }
  return Number(text);
}

/** Parses `state.tsv`; every malformed line is refused, never skipped. */
export function parseStateTsv(text: string): StateRow[] {
  return tableLines(text, STATE_COLUMNS, "state.tsv").map((fields, index) => {
    const [repository = "", detector = "", count = "", target = "", verdict = "", status = ""] =
      fields;
    const where = `state.tsv: line ${index + 2}`;
    if (!(VERDICTS as readonly string[]).includes(verdict)) {
      throw new StateReadError(`${where}: unknown verdict « ${printable(verdict)} »`);
    }
    if (!(STATUSES as readonly string[]).includes(status)) {
      throw new StateReadError(`${where}: unknown status « ${printable(status)} »`);
    }
    return {
      repository,
      detector,
      count: asCount(count, "-", where),
      target: asCount(target, "info", where),
      verdict: verdict as Verdict,
      status: status as MeasureStatus,
      detail: fields[6] ?? "",
    };
  });
}

async function readText(path: string, name: string): Promise<string> {
  try {
    return await Bun.file(path).text();
  } catch (error) {
    throw new StateReadError(`${name}: unreadable: ${printable(errorText(error))}`);
  }
}

/**
 * Reads a state directory written by `state`. An absent directory, a missing
 * or malformed file, or a state without any measure is refused.
 */
export async function readState(directory: string): Promise<FleetState> {
  const stateText = await readText(join(directory, "state.tsv"), "state.tsv");
  const rows = parseStateTsv(stateText);
  if (rows.length === 0) throw new StateReadError("state.tsv holds no measure");
  const measuredAt = (await readText(join(directory, "measured-at.txt"), "measured-at.txt")).trim();
  if (!ISO_INSTANT.test(measuredAt)) {
    throw new StateReadError("measured-at.txt is not an ISO 8601 instant");
  }
  const heads = new Map<string, string>();
  for (const [repository = "", sha = ""] of tableLines(
    await readText(join(directory, "heads.tsv"), "heads.tsv"),
    HEADS_COLUMNS,
    "heads.tsv",
  )) {
    if (!SHA.test(sha)) throw new StateReadError(`heads.tsv: ${printable(repository)}: not a sha`);
    heads.set(repository, sha);
  }
  return { label: basename(resolve(directory)), measuredAt, rows, heads, lineCount: rows.length };
}

// ------------------------------------------------------------------ tickets

export type TicketStatus =
  | "conforme"
  | "à corriger"
  | "informatif"
  | "ERREUR"
  | "EXEMPTÉ"
  | "ABSENT";

/**
 * The status of one detector over its lines of the state. Lines that are all
 * exempt measured nothing: EXEMPTÉ, never conforme, and distinct from ABSENT,
 * which the brief keeps for a detector without any line in the state.
 */
export function ticketStatus(rows: readonly StateRow[]): TicketStatus {
  const verdicts = new Set(rows.map((row) => row.verdict));
  if (verdicts.has("erreur")) return "ERREUR";
  if (verdicts.has("écart")) return "à corriger";
  if (verdicts.has("info")) return "informatif";
  if (verdicts.has("conforme")) return "conforme";
  if (verdicts.has("exempté")) return "EXEMPTÉ";
  return "ABSENT";
}

function markdownCell(text: string): string {
  return printable(text).replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

const TICKET_STATUSES: readonly TicketStatus[] = [
  "conforme",
  "à corriger",
  "informatif",
  "ERREUR",
  "EXEMPTÉ",
  "ABSENT",
];

/**
 * The ticket table of a state: one line per detector, the declared ones in
 * discovery order, then any detector the state holds that is no longer
 * declared. Every number is derived from the state.
 */
export function renderTickets(state: FleetState, detectors: readonly DetectorDescriptor[]): string {
  const byDetector = new Map<string, StateRow[]>();
  for (const row of state.rows) {
    const list = byDetector.get(row.detector) ?? [];
    list.push(row);
    byDetector.set(row.detector, list);
  }
  const declared = new Map(detectors.map((detector) => [detector.id, detector]));
  const ids = [
    ...detectors.map((detector) => detector.id),
    ...[...byDetector.keys()].filter((id) => !declared.has(id)),
  ];

  const counts = new Map<TicketStatus, number>(TICKET_STATUSES.map((status) => [status, 0]));
  const lines = ids.map((id) => {
    const rows = byDetector.get(id) ?? [];
    const descriptor = declared.get(id);
    const status = ticketStatus(rows);
    counts.set(status, (counts.get(status) ?? 0) + 1);
    const measuredTarget = rows.find((row) => row.status !== "exempté");
    const target =
      measuredTarget !== undefined ? measuredTarget.target : (descriptor?.target ?? null);
    const off = rows.filter((row) => row.verdict === "écart").map((row) => row.repository);
    const findings = rows.reduce(
      (sum, row) => sum + (row.status === "ok" ? (row.count ?? 0) : 0),
      0,
    );
    return `| ${markdownCell(id)} | ${markdownCell(descriptor?.title ?? "(non déclaré)")} | ${target === null ? "info" : target} | ${off.length === 0 ? "—" : markdownCell(off.join(", "))} | ${findings} | ${status} |`;
  });

  const totals = TICKET_STATUSES.map((status) => `${status} ${counts.get(status) ?? 0}`).join(", ");
  return [
    `# Tickets de flotte — ${markdownCell(state.label)}`,
    "",
    `Mesuré le ${state.measuredAt} · ${state.lineCount} mesures`,
    "",
    "| Détecteur | Titre | Cible | Dépôts en écart | Constats | Statut |",
    "| --- | --- | --- | --- | --- | --- |",
    ...lines,
    "",
    `Détecteurs : ${ids.length} (${totals})`,
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ local reader

/** Bound on one detector run; a detector that hangs is an error, not a wait. */
export const DETECTOR_TIMEOUT_MS = 300_000;
/** Bound on a detector's standard output; more is an error, never a truncation. */
export const DETECTOR_MAX_STDOUT_BYTES = 16 * 1024 * 1024;
/** Standard error is only read for its first line: the rest is dropped, not an error. */
const STDERR_KEPT_BYTES = 64 * 1024;
/**
 * Once the detector has exited and its group is killed, the pipes close at
 * once. Still open after this delay, they are held by a process that left the
 * group: an error, and nothing more is read.
 */
export const OUTPUT_DRAIN_MS = 1_000;

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: Uint8Array;
  readonly stderr: string;
  /** Why the run was cut (timeout, output bound, pipe held open), or null. */
  readonly failure: string | null;
}

export interface ProcessLimits {
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
}

/** Runs an argument vector — never a shell string. */
export type ProcessRunner = (
  argv: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> },
) => Promise<ProcessResult>;

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    // A negative pid addresses the process group the child leads (detached).
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // ESRCH: the group is already gone, which is the state wanted.
  }
}

/**
 * The process runner of detectors and of git: the child leads its own process
 * group, which is killed at the timeout, at the output bound and as soon as the
 * child exits. Rejects only when the program cannot be started.
 */
export function groupProcessRunner(limits: ProcessLimits): ProcessRunner {
  return (argv, options) =>
    new Promise<ProcessResult>((resolveRun, rejectRun) => {
      const [program, ...args] = argv;
      if (program === undefined) {
        rejectRun(new Error("empty argument vector"));
        return;
      }
      const child = spawnChild(program, args, {
        cwd: options.cwd,
        env: { ...options.env },
        detached: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdoutChunks: Uint8Array[] = [];
      let stdoutBytes = 0;
      const stderrChunks: Uint8Array[] = [];
      let stderrBytes = 0;
      let exit: { code: number | null; signal: string | null } | null = null;
      let failure: string | null = null;
      let settled = false;
      let drainTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(drainTimer);
        // Whatever arrives from now on is ignored: the streams are dropped.
        child.stdout?.destroy();
        child.stderr?.destroy();
        resolveRun({
          exitCode: exit?.code ?? null,
          signal: exit?.signal ?? null,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          failure,
        });
      };
      const cut = (reason: string): void => {
        if (settled) return;
        failure = reason;
        killGroup(child);
        finish();
      };

      const timer = setTimeout(() => cut(`timeout after ${limits.timeoutMs} ms`), limits.timeoutMs);
      child.stdout?.on("data", (chunk: Buffer) => {
        if (settled) return;
        stdoutBytes += chunk.length;
        if (stdoutBytes > limits.maxStdoutBytes) {
          cut(`output exceeds ${limits.maxStdoutBytes} bytes`);
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (settled || stderrBytes >= STDERR_KEPT_BYTES) return;
        stderrBytes += chunk.length;
        stderrChunks.push(chunk);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(drainTimer);
        killGroup(child);
        rejectRun(error);
      });
      child.on("exit", (code, signal) => {
        if (settled) return;
        exit = { code, signal };
        // The child is done: whatever it left behind in its group goes with it.
        killGroup(child);
        drainTimer = setTimeout(
          () => cut(`a process left by the program kept its output open after it exited`),
          OUTPUT_DRAIN_MS,
        );
      });
      // Exit seen and both pipes closed: everything written before the kill is read.
      child.on("close", finish);
    });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** First line of a diagnostic, bounded. */
function diagnostic(stderr: string): string {
  const first = stderr.trim().split("\n")[0] ?? "";
  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}

/** The finding lines of a detector's output: non-empty lines, carriage returns dropped. */
export function findingLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line !== "");
}

/** The caller's variables a detector may need to run; no token is among them. */
const PASSED_VARIABLES = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"] as const;

export interface LocalSources {
  /** Absolute worktrees root: `<root>/<owner>/<name>` per repository. */
  readonly worktrees: string;
  /** Absolute forge snapshot directory (`forge-snapshot.ts` output). */
  readonly snapshot: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Replaces the process runner; when set, the two limits below are not used. */
  readonly spawn?: ProcessRunner;
  /** Defaults to DETECTOR_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Defaults to DETECTOR_MAX_STDOUT_BYTES. */
  readonly maxStdoutBytes?: number;
}

type Verified =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The real path of `<worktrees>/<owner>/<name>`, verified: a plain name, no
 * symbolic link on either segment (lstat), a directory, and a real path equal
 * to the path itself, hence under the real worktrees root.
 */
async function verifyWorktree(root: string, repository: string): Promise<Verified> {
  const refused = repositoryNameError(repository);
  if (refused !== null) return { ok: false, reason: refused };
  let path = root;
  for (const segment of repository.split("/")) {
    path = join(path, segment);
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        return { ok: false, reason: `${repository}: ${segment} is a symbolic link` };
      }
      if (!stat.isDirectory()) {
        return { ok: false, reason: `${repository}: ${segment} is not a directory` };
      }
    } catch (error) {
      return { ok: false, reason: `${repository}: ${errorText(error)}` };
    }
  }
  let real: string;
  try {
    real = await realpath(path);
  } catch (error) {
    return { ok: false, reason: `${repository}: ${errorText(error)}` };
  }
  if (real !== path || !isUnder(root, real)) {
    return { ok: false, reason: `${repository}: resolves outside the worktrees root` };
  }
  return { ok: true, path: real };
}

/**
 * The reader of local sources: HEAD by `git rev-parse` in the verified
 * worktree, which must be the root of its own repository (a missing worktree
 * inside a parent repository would otherwise read the parent) and clean, and
 * detectors run as described in the header. No network call is made here.
 */
export function localFleetReader(sources: LocalSources): FleetReader {
  const spawn =
    sources.spawn ??
    groupProcessRunner({
      timeoutMs: sources.timeoutMs ?? DETECTOR_TIMEOUT_MS,
      maxStdoutBytes: sources.maxStdoutBytes ?? DETECTOR_MAX_STDOUT_BYTES,
    });
  const base: Record<string, string> = {};
  for (const name of PASSED_VARIABLES) {
    const value = sources.environment[name];
    if (value !== undefined) base[name] = value;
  }
  base.FLEET_WORKTREES = sources.worktrees;
  base.FLEET_SNAPSHOT = sources.snapshot;

  let rootRead: Promise<string> | undefined;
  const root = (): Promise<string> => {
    rootRead ??= realpath(sources.worktrees);
    return rootRead;
  };
  // One verification per repository: `run` executes in the path `head` checked.
  const verified = new Map<string, Promise<Verified>>();
  const worktree = (repository: string): Promise<Verified> => {
    let found = verified.get(repository);
    if (found === undefined) {
      found = root().then(
        (real) => verifyWorktree(real, repository),
        (error: unknown): Verified => ({
          ok: false,
          reason: `worktrees root: ${errorText(error)}`,
        }),
      );
      verified.set(repository, found);
    }
    return found;
  };

  const git = async (cwd: string, args: readonly string[]): Promise<ProcessResult | string> => {
    let result: ProcessResult;
    try {
      result = await spawn(["git", "-C", cwd, ...args], { cwd, env: base });
    } catch (error) {
      return `git could not be run: ${errorText(error)}`;
    }
    if (result.failure !== null) return `git ${args[0] ?? ""}: ${result.failure}`;
    if (result.exitCode !== 0) {
      return `git ${args[0] ?? ""} exit ${result.exitCode}: ${diagnostic(result.stderr)}`;
    }
    return result;
  };

  return {
    async head(repository) {
      const checked = await worktree(repository);
      if (!checked.ok) return { ok: false, reason: checked.reason };
      const real = checked.path;
      const parsed = await git(real, ["rev-parse", "--show-toplevel", "HEAD"]);
      if (typeof parsed === "string") return { ok: false, reason: parsed };
      const [toplevel = "", sha = ""] = new TextDecoder().decode(parsed.stdout).trim().split("\n");
      if (toplevel !== real) {
        return { ok: false, reason: `${repository} is not the root of a git repository` };
      }
      if (!SHA.test(sha)) return { ok: false, reason: `${repository}: HEAD is not a sha` };
      // A detector reads the working tree: it is HEAD only when nothing differs.
      const status = await git(real, ["status", "--porcelain", "--untracked-files=all"]);
      if (typeof status === "string") return { ok: false, reason: status };
      if (status.stdout.length > 0) {
        return {
          ok: false,
          reason: `${repository}: the working tree differs from HEAD (modified or untracked files)`,
        };
      }
      return { ok: true, sha };
    },

    async run(detector, target) {
      let cwd: string;
      if (target.scope === "repo") {
        const checked = await worktree(target.repository);
        if (!checked.ok) return { ok: false, reason: `worktree unreadable: ${checked.reason}` };
        cwd = checked.path;
      } else {
        try {
          cwd = await root();
        } catch (error) {
          return { ok: false, reason: `worktrees root: ${errorText(error)}` };
        }
      }
      const env =
        target.scope === "repo"
          ? { ...base, FLEET_REPOSITORY: target.repository, FLEET_WORKTREE: cwd }
          : { ...base, FLEET_REPOSITORIES: target.repositories.join("\n") };
      let result: ProcessResult;
      try {
        result = await spawn([detector.path], { cwd, env });
      } catch (error) {
        return { ok: false, reason: `detector could not be run: ${errorText(error)}` };
      }
      if (result.failure !== null) return { ok: false, reason: `detector ${result.failure}` };
      if (result.signal !== null) {
        return { ok: false, reason: `detector killed by ${result.signal}` };
      }
      if (result.exitCode !== 0) {
        return {
          ok: false,
          reason: `detector exit ${result.exitCode}: ${diagnostic(result.stderr)}`,
        };
      }
      let stdout: string;
      try {
        stdout = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
      } catch {
        return { ok: false, reason: "detector output is not UTF-8" };
      }
      return { ok: true, lines: findingLines(stdout) };
    },
  };
}

// ------------------------------------------------------------------ commands

export interface CommandOutcome {
  readonly code: 0 | 1 | 2 | 4;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

export interface StateDependencies {
  readonly discover: (directory: string, registry: string) => Promise<Discovery>;
  /** Builds the reader once the inputs are known to be readable directories. */
  readonly reader: (sources: { worktrees: string; snapshot: string }) => FleetReader;
  readonly now: () => Date;
  readonly defaultInventory: string;
}

const STATE_USAGE =
  "usage: bun ecosystem/fleet-state.ts state --detectors <dir> --worktrees <dir> --snapshot <dir> --out <dir> --label <label> [--repos owner/a,owner/b] [--registry <file>] [--inventory <file>]";
const TICKETS_USAGE =
  "usage: bun ecosystem/fleet-state.ts tickets <state-dir> --detectors <dir> [--registry <file>]";

const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type Options = Map<string, string>;

/** `--name value` pairs; null on an unknown, repeated or valueless option. */
function parseOptions(
  argv: readonly string[],
  known: readonly string[],
): { options: Options; positional: string[] } | null {
  const options: Options = new Map();
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!known.includes(name) || options.has(name) || value === undefined || value === "") {
      return null;
    }
    options.set(name, value);
    index += 1;
  }
  return { options, positional };
}

function usage(text: string, reason: string): CommandOutcome {
  return { code: 2, stdout: [], stderr: [reason, text] };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(await realpath(path))).isDirectory();
  } catch {
    return false;
  }
}

const ZERO: Tally = { measures: 0, conforme: 0, info: 0, ecart: 0, erreur: 0, exempte: 0 };

export async function runState(
  argv: readonly string[],
  deps: StateDependencies,
): Promise<CommandOutcome> {
  const parsed = parseOptions(argv, [
    "detectors",
    "worktrees",
    "snapshot",
    "out",
    "label",
    "repos",
    "registry",
    "inventory",
  ]);
  if (parsed === null) return usage(STATE_USAGE, "unknown, repeated or valueless option");
  const { options, positional } = parsed;
  if (positional.length > 0) return usage(STATE_USAGE, "unexpected argument");
  const required = ["detectors", "worktrees", "snapshot", "out", "label"] as const;
  const missing = required.filter((name) => !options.has(name));
  if (missing.length > 0) return usage(STATE_USAGE, `missing option(s): --${missing.join(", --")}`);
  const label = options.get("label") ?? "";
  if (!LABEL.test(label)) {
    return usage(STATE_USAGE, `label « ${printable(label)} » is not a plain name`);
  }

  const inventoryPath = options.get("inventory") ?? deps.defaultInventory;
  let inventory: RegistryEntry[];
  try {
    inventory = parseInventory(await Bun.file(inventoryPath).text());
  } catch (error) {
    return {
      code: 4,
      stdout: [],
      stderr: [`inventory ${printable(inventoryPath)}: unreadable: ${printable(errorText(error))}`],
    };
  }
  // A name is a path and a TSV cell: one that is not a plain owner/name makes
  // the whole inventory unusable, before anything is run or written.
  const refusedNames = inventory
    .map((entry) => repositoryNameError(entry.repository))
    .filter((reason): reason is string => reason !== null);
  if (refusedNames.length > 0) {
    return {
      code: 4,
      stdout: [],
      stderr: refusedNames.map((reason) => `inventory ${printable(inventoryPath)}: ${reason}`),
    };
  }

  let entries = inventory;
  const requested = options.get("repos");
  if (requested !== undefined) {
    const names = requested.split(",");
    if (new Set(names).size !== names.length) {
      return usage(STATE_USAGE, "a repository is requested more than once");
    }
    const known = new Set(inventory.map((entry) => entry.repository));
    const unknown = names.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      return usage(
        STATE_USAGE,
        `not in the repository inventory: ${unknown.map((name) => printable(name)).join(", ")}`,
      );
    }
    entries = inventory.filter((entry) => names.includes(entry.repository));
  }

  const inputs: Record<"worktrees" | "snapshot", string> = { worktrees: "", snapshot: "" };
  for (const name of ["worktrees", "snapshot"] as const) {
    const path = resolve(options.get(name) ?? "");
    if (!(await isDirectory(path))) {
      return {
        code: 4,
        stdout: [],
        stderr: [`--${name} ${printable(path)}: not a readable directory`],
      };
    }
    inputs[name] = await realpath(path);
  }

  const discovery = await deps.discover(
    options.get("detectors") ?? "",
    options.get("registry") ?? REGISTRY_PATH,
  );
  if (!discovery.ok) {
    // Zero detectors is a refusal of the discovery, never a clean fleet: the
    // counters are printed at zero and the run fails.
    return {
      code: 1,
      stdout: [summaryLine(label, ZERO)],
      stderr: discovery.errors.map((error) => `configuration: ${error}`),
    };
  }

  const out = resolve(options.get("out") ?? "");
  const target = join(out, label);
  try {
    await lstat(target);
    return usage(STATE_USAGE, `${printable(target)} already exists: a state is never replaced`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      return {
        code: 1,
        stdout: [summaryLine(label, ZERO)],
        stderr: [`${printable(target)}: ${printable(errorText(error))}`],
      };
    }
  }

  const measurement = await measure(discovery.detectors, entries, deps.reader(inputs));
  const tally = tallyOf(measurement.measures.map((m) => m.verdict));
  const summary = summaryLine(label, tally);
  const sums = sumError(tally, expectedMeasures(discovery.detectors, entries));
  const errors = measurement.measures
    .filter((m) => m.status === "erreur")
    .map((m) => `ERREUR ${m.detector} ${m.repository}: ${m.detail}`);
  if (sums !== null) return { code: 1, stdout: [summary], stderr: [...errors, sums] };

  try {
    await writeState(out, label, measurement, deps.now());
  } catch (error) {
    return {
      code: 1,
      stdout: [summary],
      stderr: [...errors, `write failed: ${printable(errorText(error))}`],
    };
  }
  return {
    code: errors.length > 0 ? 1 : 0,
    stdout: [
      summary,
      `fleet state ${printable(label)}: detectors=${discovery.detectors.length} repositories=${entries.length} written=${printable(target)}`,
    ],
    stderr: errors,
  };
}

/** Writes the state in a staging directory beside its target, then renames it in. */
async function writeState(
  out: string,
  label: string,
  measurement: Measurement,
  now: Date,
): Promise<void> {
  await mkdir(out, { recursive: true });
  const staging = await mkdtemp(join(out, `.${label}.fleet-state-`));
  let published = false;
  try {
    await writeFile(join(staging, "state.tsv"), renderStateTsv(measurement.measures));
    await writeFile(join(staging, "heads.tsv"), renderHeadsTsv(measurement.heads));
    await writeFile(join(staging, "measured-at.txt"), `${now.toISOString()}\n`);
    for (const m of measurement.measures) {
      if (m.status !== "ok") continue;
      const path = proofFile(staging, m.detector, m.repository);
      await mkdir(dirname(path), { recursive: true });
      const body = m.lines.length === 0 ? "" : `${m.lines.join("\n")}\n`;
      await writeFile(path, body, { flag: "wx" });
    }
    // The target was absent before measuring; a rename onto a directory created
    // meanwhile fails rather than merging (an empty one would be replaced).
    if ((await readdir(out)).includes(label)) throw new Error(`${label} appeared meanwhile`);
    await rename(staging, join(out, label));
    published = true;
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface TicketsDependencies {
  readonly discover: (directory: string, registry: string) => Promise<Discovery>;
}

export async function runTickets(
  argv: readonly string[],
  deps: TicketsDependencies,
): Promise<CommandOutcome> {
  const parsed = parseOptions(argv, ["detectors", "registry"]);
  if (parsed === null) return usage(TICKETS_USAGE, "unknown, repeated or valueless option");
  const { options, positional } = parsed;
  const [directory] = positional;
  if (positional.length !== 1 || directory === undefined || directory === "") {
    return usage(TICKETS_USAGE, "one state directory expected");
  }
  if (!options.has("detectors")) return usage(TICKETS_USAGE, "missing option: --detectors");

  let state: FleetState;
  try {
    state = await readState(directory);
  } catch (error) {
    if (!(error instanceof StateReadError)) throw error;
    return {
      code: 4,
      stdout: [],
      stderr: [`state ${printable(directory)}: ${error.message}`],
    };
  }
  const discovery = await deps.discover(
    options.get("detectors") ?? "",
    options.get("registry") ?? REGISTRY_PATH,
  );
  if (!discovery.ok) {
    return {
      code: 1,
      stdout: [],
      stderr: discovery.errors.map((error) => `configuration: ${error}`),
    };
  }
  return { code: 0, stdout: [renderTickets(state, discovery.detectors)], stderr: [] };
}

if (import.meta.main) {
  const [command, ...rest] = Bun.argv.slice(2);
  let outcome: CommandOutcome;
  if (command === "state") {
    outcome = await runState(rest, {
      discover: discoverDetectors,
      reader: (sources) => localFleetReader({ ...sources, environment: process.env }),
      now: () => new Date(),
      defaultInventory: join(import.meta.dir, "repositories.v1.yaml"),
    });
  } else if (command === "tickets") {
    outcome = await runTickets(rest, { discover: discoverDetectors });
  } else {
    outcome = { code: 2, stdout: [], stderr: [STATE_USAGE, TICKETS_USAGE] };
  }
  for (const line of outcome.stdout) console.log(line);
  for (const line of outcome.stderr) console.error(line);
  process.exit(outcome.code);
}
