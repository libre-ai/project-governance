/**
 * Proven remediation kit per repository (lot L069, idea h-plugins-cycle-14).
 *
 *   bun tools/fleet/remediation/kit.ts <ticket> <state-label>
 *
 * For one ticket (a fleet detector, `ecosystem/fleet-gates.ts`) and one
 * measured state (`ecosystem/fleet-state.ts state`, lot L093), the tool turns
 * decisions written by hand into one patch per repository in écart, then
 * PROVES each patch before writing anything. It decides nothing: every
 * finding is covered by exactly one decision, or the run stops.
 *
 * ENVIRONMENT. No variable has a default that supposes a tree layout, except
 * the output, which defaults under the working directory:
 *
 *   REMEDIATION_WORK_DIR  working directory; per ticket `<dir>/<ticket>/` holds
 *                         decisions.tsv, optional companions.tsv,
 *                         manual/<owner>/<name>.patch, verify/<owner>/<name>
 *   REMEDIATION_KIT_DIR   optional output root (default `<work>/kits`); the kit
 *                         is written to `<root>/<ticket>/`, never replaced
 *   FLEET_STATES_DIR      the `--out` of `fleet-state.ts state`
 *   FLEET_WORKTREES_DIR   the measured worktrees, `<dir>/<owner>/<name>`
 *   FLEET_SNAPSHOT_DIR    the forge snapshot (`forge-snapshot.ts`): the served
 *                         branch is its `default_branch`
 *   FLEET_DETECTORS_DIR   the detectors directory
 *   FLEET_GATES_REGISTRY  optional, the registry (default: this repository's)
 *
 * DECISIONS (`decisions.tsv`, UTF-8, header then one decision per line):
 *
 *   repository  path  line  action  argument  reason
 *
 * `line` is a 1-based number or `*` (every finding of that file); a numbered
 * decision wins over the `*` of its file. Actions: the four edits of
 * `tools/fleet/line-edits.ts` (mark, replace, delete, insert, same argument),
 * `keep` (left in écart on purpose) and `manual` (the patch is written by hand
 * at manual/<owner>/<name>.patch). The reason is mandatory. Several findings on
 * one line are one modification. `companions.tsv` (same columns, numbered lines
 * and edit actions only) declares the lines a fix orphans without a finding:
 * they are declared, never inferred.
 *
 * REFUSED (code 4, nothing written): a malformed line, an unknown action, an
 * empty reason, a finding covered by no decision or by two, a dead decision
 * (no finding uses it), `manual` mixed with another action in a repository, a
 * repository whose decisions are all `keep`, a companion outside a kit or on a
 * finding line, an edit the line editor refuses.
 *
 * PROOF, per repository (code 1 when it fails, nothing written):
 *   1. the edits run through the line editor on a throwaway clone of the
 *      measured sha; the patch is that clone's diff;
 *   2. the patch touches only files that hold a finding or a declared
 *      companion (`git apply --numstat -z`), renames and copies nothing, and
 *      involves no mode 120000 (symbolic link) or 160000 (submodule)
 *      (`git apply --summary`): this holds for `manual` too, whose lines are
 *      otherwise not predicted (a manual patch may change any line of those
 *      files); then the lines added and removed (git numstat, never the
 *      default diff format) equal the prediction: mark and replace +1/-1,
 *      delete -1, insert +1 per line, i.e. one plus one per literal `\n` (not
 *      checked for `manual`);
 *   3. on a second fresh clone of the sha, the detector first reproduces the
 *      measured proof line for line (else the copy is not the measured tree:
 *      code 3), then `git apply --check` and `git apply` (the tool the
 *      application, lot L070, uses) succeed;
 *   4. on that patched copy, committed so it reads as a clean HEAD, the
 *      detector returns exactly the kept findings: same number AND same paths;
 *   5. the repository's own verification script, when present, exits 0 (its
 *      output is relayed otherwise; a script that cannot be started, not
 *      executable for instance, is code 3, not a failed proof).
 *
 * STALE OR UNREADABLE INPUT (code 3): a ticket matched by zero or two
 * detectors, a detector of `parc` scope (a kit is per repository), a state
 * that cannot be read, a measure in error for the ticket, a proof whose lines
 * differ from the count of the state or are not `path:line:text`, a measured
 * worktree whose HEAD moved since the state (or which is no longer clean), a
 * snapshot without a served branch, a detector in error on a copy (never
 * green), a decisions file absent while a repository is in écart.
 *
 * WHAT IS WRITTEN. Only `<kit-root>/<ticket>/`: `manifest.tsv` (MANIFEST_COLUMNS,
 * one line per repository) and `<owner>/<name>.patch`, staged beside the
 * target and renamed in (the target is created exclusively first: a directory
 * that appeared meanwhile is never replaced). Throwaway clones live under the
 * system temporary directory and are removed. Nothing is written to a measured
 * worktree (a clone only reads it) and nothing to the forge: no push, no
 * `gh`, no network (the application with its pull request is lot L070). Git
 * and the line editor receive PATH, HOME, TMPDIR, LANG and LC_ALL only (never
 * an inherited GIT_* variable: a GIT_DIR or GIT_INDEX_FILE would aim the
 * copies' commands at another repository), plus GIT_TERMINAL_PROMPT=0; the
 * copies' configuration is passed by GIT_CONFIG_COUNT, never written to a
 * .git/config. A Python detector runs in an isolated interpreter (`python3 -I`).
 *
 * COUNTERS. Success prints `findings = edited + kept + manual` and the lines
 * added and removed; a sum that does not hold is an error.
 *
 * Exit codes: 0 kit written, or no repository in écart; 1 a proof failed;
 * 2 usage (arguments, a missing variable, a kit already present); 3 input
 * unreadable, inconsistent or stale, or detector in error; 4 decisions
 * inconsistent.
 */

import { lstat, mkdir, mkdtemp, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { decodeFindingPath } from "../../../ecosystem/fleet-detector-io";
import {
  type DetectorDescriptor,
  discoverDetectors,
  printable,
  REGISTRY_PATH,
} from "../../../ecosystem/fleet-gates";
import {
  DETECTOR_MAX_STDOUT_BYTES,
  DETECTOR_TIMEOUT_MS,
  type FleetReader,
  type FleetState,
  groupProcessRunner,
  localFleetReader,
  PASSED_VARIABLES,
  type ProcessRunner,
  proofPath,
  readState,
  repositoryNameError,
  StateReadError,
  ticketStatus,
} from "../../../ecosystem/fleet-state";

export const EXIT = {
  ok: 0,
  proof: 1,
  usage: 2,
  input: 3,
  decisions: 4,
} as const;
type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface CommandOutcome {
  readonly code: ExitCode;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

const USAGE = "usage: bun tools/fleet/remediation/kit.ts <ticket> <state-label>";

/** A ticket or a label becomes a path segment: no separator, no leading dot. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ------------------------------------------------------------------ findings

export interface Finding {
  readonly path: string;
  readonly line: number;
  /** The detector's line, as measured. */
  readonly raw: string;
}

const FINDING = /^([^:]+):([1-9][0-9]*):/;

/**
 * A finding line `path:line:text`; null when it has another shape. The path is
 * decoded as `findingLine` encodes it (a colon in a name would otherwise end
 * the path early: `doc:12:x.md` read as `doc` at line 12).
 */
export function parseFinding(raw: string): Finding | null {
  const match = FINDING.exec(raw);
  const path = match?.[1];
  const line = match?.[2];
  if (path === undefined || line === undefined) return null;
  const number = Number(line);
  if (!Number.isSafeInteger(number)) return null;
  return { path: decodeFindingPath(path), line: number, raw };
}

// ------------------------------------------------------------------ decisions

const EDIT_ACTIONS = ["mark", "replace", "delete", "insert"] as const;
type EditAction = (typeof EDIT_ACTIONS)[number];
const ACTIONS = [...EDIT_ACTIONS, "keep", "manual"] as const;
type Action = (typeof ACTIONS)[number];

export const DECISION_COLUMNS = [
  "repository",
  "path",
  "line",
  "action",
  "argument",
  "reason",
] as const;

export interface Decision {
  readonly repository: string;
  readonly path: string;
  /** null for `*`: every finding of the file without a numbered decision. */
  readonly line: number | null;
  readonly action: Action;
  readonly argument: string;
  readonly reason: string;
  /** `<file>:<line>`, for messages. */
  readonly where: string;
}

export type DecisionsRead =
  | { readonly ok: true; readonly decisions: readonly Decision[] }
  | { readonly ok: false; readonly errors: readonly string[] };

const LINE_NUMBER = /^[1-9][0-9]*$/;

const isAction = (value: string): value is Action => (ACTIONS as readonly string[]).includes(value);
const isEditAction = (value: Action): value is EditAction =>
  (EDIT_ACTIONS as readonly string[]).includes(value);

function pathError(path: string): string | null {
  if (path === "") return "the path is empty";
  if (path.startsWith("/")) return `the path is absolute: ${printable(path)}`;
  if (path.split("/").includes("..")) return `the path has a ".." segment: ${printable(path)}`;
  return null;
}

/**
 * Reads a decisions file (`companions` restricts it to numbered edits). Every
 * defect is named with its line and none stops the others: a list read as
 * fewer decisions than it holds would cover findings nobody decided.
 */
export function parseDecisions(text: string, file: string, companions: boolean): DecisionsRead {
  const errors: string[] = [];
  const decisions: Decision[] = [];
  if (text.includes("\r")) return { ok: false, errors: [`${file}: carriage return (CR)`] };
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const [header, ...body] = lines;
  if (header !== DECISION_COLUMNS.join("\t")) {
    return {
      ok: false,
      errors: [`${file}:1: header expected « ${DECISION_COLUMNS.join("\\t")} »`],
    };
  }
  for (const [index, row] of body.entries()) {
    const where = `${file}:${index + 2}`;
    if (row === "") continue;
    const fields = row.split("\t");
    const [repository = "", path = "", line = "", action = "", argument = "", reason = ""] = fields;
    const problems: string[] = [];
    if (fields.length !== DECISION_COLUMNS.length) {
      errors.push(`${where}: ${fields.length} columns, ${DECISION_COLUMNS.length} expected`);
      continue;
    }
    const nameError = repositoryNameError(repository);
    if (nameError !== null) problems.push(nameError);
    const badPath = pathError(path);
    if (badPath !== null) problems.push(badPath);
    const numbered = LINE_NUMBER.test(line);
    if (!numbered && (line !== "*" || companions)) {
      problems.push(
        `line « ${printable(line)} » is not ${companions ? "a positive number" : "a positive number or *"}`,
      );
    }
    if (!isAction(action)) {
      problems.push(`unknown action « ${printable(action)} » (${ACTIONS.join(", ")})`);
    } else if (companions && !isEditAction(action)) {
      problems.push(`a companion is an edit (${EDIT_ACTIONS.join(", ")}), not « ${action} »`);
    }
    if (reason.trim() === "") problems.push("the reason is empty");
    for (const problem of problems) errors.push(`${where}: ${problem}`);
    if (problems.length > 0 || !isAction(action)) continue;
    decisions.push({
      repository,
      path,
      line: numbered ? Number(line) : null,
      action,
      argument,
      reason,
      where,
    });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, decisions };
}

// ------------------------------------------------------------------ coverage

export interface LineEdit {
  readonly path: string;
  readonly line: number;
  readonly action: EditAction;
  readonly argument: string;
}

export interface RepositoryFindings {
  readonly repository: string;
  readonly findings: readonly Finding[];
}

export interface RepositoryPlan {
  readonly repository: string;
  readonly findings: number;
  /** Findings covered by an edit, a keep, a manual decision: they sum to `findings`. */
  readonly edited: number;
  readonly kept: readonly Finding[];
  readonly manual: number;
  /** One per edited line (findings on one line are deduplicated), then companions. */
  readonly edits: readonly LineEdit[];
  readonly companions: number;
}

export type CoverageResult =
  | { readonly ok: true; readonly plans: readonly RepositoryPlan[] }
  | { readonly ok: false; readonly errors: readonly string[] };

const decisionKey = (repository: string, path: string, line: number | null): string =>
  `${repository}\t${path}\t${line === null ? "*" : line}`;

const describe = (decision: Decision): string =>
  `${decision.repository} ${printable(decision.path)}:${decision.line ?? "*"} ${decision.action}`;

/**
 * Covers every finding by exactly one decision and derives the edits. Pure:
 * every refusal is named, none stops the others.
 */
export function cover(
  repositories: readonly RepositoryFindings[],
  decisions: readonly Decision[],
  companions: readonly Decision[],
): CoverageResult {
  const errors: string[] = [];
  const byKey = new Map<string, Decision>();
  for (const decision of decisions) {
    const key = decisionKey(decision.repository, decision.path, decision.line);
    const first = byKey.get(key);
    if (first !== undefined) {
      errors.push(
        `covered twice: ${describe(decision)} (${decision.where}) and ${first.action} (${first.where})`,
      );
      continue;
    }
    byKey.set(key, decision);
  }

  const used = new Set<Decision>();
  const plans: RepositoryPlan[] = [];
  const editedLines = new Map<string, Set<string>>();
  const keptLines = new Map<string, Set<string>>();
  for (const { repository, findings } of repositories) {
    const edits: LineEdit[] = [];
    const kept: Finding[] = [];
    const edited = new Set<string>();
    const keptHere = new Set<string>();
    const actions = new Set<Action>();
    let editedCount = 0;
    let manual = 0;
    for (const finding of findings) {
      const decision =
        byKey.get(decisionKey(repository, finding.path, finding.line)) ??
        byKey.get(decisionKey(repository, finding.path, null));
      if (decision === undefined) {
        errors.push(`finding not covered: ${repository} ${printable(finding.raw)}`);
        continue;
      }
      used.add(decision);
      actions.add(decision.action);
      const lineKey = `${finding.path}\t${finding.line}`;
      if (decision.action === "keep") {
        kept.push(finding);
        keptHere.add(lineKey);
      } else if (decision.action === "manual") {
        manual += 1;
      } else {
        editedCount += 1;
        // Several findings on one line are one modification.
        if (!edited.has(lineKey)) {
          edited.add(lineKey);
          edits.push({
            path: finding.path,
            line: finding.line,
            action: decision.action,
            argument: decision.argument,
          });
        }
      }
    }
    if (actions.has("manual") && actions.size > 1) {
      errors.push(`${repository}: « manual » mixed with ${[...actions].join(", ")}`);
    }
    if (findings.length > 0 && actions.size === 1 && actions.has("keep")) {
      errors.push(`${repository}: every finding is kept, there is nothing to fix`);
    }
    editedLines.set(repository, edited);
    keptLines.set(repository, keptHere);
    plans.push({
      repository,
      findings: findings.length,
      edited: editedCount,
      kept,
      manual,
      edits,
      companions: 0,
    });
  }

  for (const decision of decisions) {
    if (
      !used.has(decision) &&
      byKey.get(decisionKey(decision.repository, decision.path, decision.line)) === decision
    ) {
      errors.push(`dead decision: ${describe(decision)} (${decision.where}) covers no finding`);
    }
  }

  const companionKeys = new Set<string>();
  const withCompanions = plans.map((plan) => {
    const added: LineEdit[] = [];
    for (const companion of companions) {
      if (companion.repository !== plan.repository || companion.line === null) continue;
      if (!isEditAction(companion.action)) continue;
      const lineKey = `${companion.path}\t${companion.line}`;
      const where = `companion ${describe(companion)} (${companion.where})`;
      if (plan.manual > 0) {
        errors.push(`${where}: the repository is fixed by a manual patch, which holds it`);
      } else if (editedLines.get(plan.repository)?.has(lineKey) === true) {
        errors.push(`${where}: the line is already edited by a decision`);
      } else if (keptLines.get(plan.repository)?.has(lineKey) === true) {
        errors.push(`${where}: the line holds a kept finding`);
      } else if (companionKeys.has(`${plan.repository}\t${lineKey}`)) {
        errors.push(`${where}: declared twice`);
      } else {
        companionKeys.add(`${plan.repository}\t${lineKey}`);
        added.push({
          path: companion.path,
          line: companion.line,
          action: companion.action,
          argument: companion.argument,
        });
      }
    }
    return {
      ...plan,
      edits: [...plan.edits, ...added],
      companions: added.length,
    };
  });
  const known = new Set(plans.map((plan) => plan.repository));
  for (const companion of companions) {
    if (!known.has(companion.repository)) {
      errors.push(
        `companion ${describe(companion)} (${companion.where}): the repository has no kit`,
      );
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, plans: withCompanions };
}

/** Lines the edits must add and remove: mark and replace +1/-1, delete -1, insert +1 per line. */
export function predictLines(edits: readonly LineEdit[]): {
  readonly added: number;
  readonly removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    if (edit.action === "mark" || edit.action === "replace") {
      added += 1;
      removed += 1;
    } else if (edit.action === "delete") {
      removed += 1;
    } else {
      added += edit.argument.split("\\n").length;
    }
  }
  return { added, removed };
}

export interface PatchStat {
  readonly added: number;
  readonly removed: number;
  /** One path per file entry, unquoted (the new name, or the old one for a deletion). */
  readonly paths: readonly string[];
}

const NUMSTAT_RECORD = /^([0-9]+)\t([0-9]+)\t([^\0]+)$/;

/**
 * Sums and paths of `git apply --numstat -z` (one NUL-terminated record per
 * file); null for a binary entry, which no line edit yields, or a record of
 * another shape.
 */
export function numstatTotals(text: string): PatchStat | null {
  let added = 0;
  let removed = 0;
  const paths: string[] = [];
  const records = text.split("\0");
  if (records.at(-1) === "") records.pop();
  for (const record of records) {
    const match = NUMSTAT_RECORD.exec(record);
    const [, plus, minus, path] = match ?? [];
    if (plus === undefined || minus === undefined || path === undefined) return null;
    added += Number(plus);
    removed += Number(minus);
    paths.push(path);
  }
  return { added, removed, paths };
}

/** Modes a patch may never involve: a symbolic link and a submodule (gitlink). */
const REFUSED_MODES = new Set(["120000", "160000"]);

/**
 * What `git apply --summary` shows that a kit refuses: a rename or a copy
 * (numstat names only the destination), a mode 120000 or 160000 created,
 * deleted or changed. One message per refused line.
 */
export function summaryProblems(summary: string): string[] {
  const problems: string[] = [];
  for (const raw of summary.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (/^(rename|copy) /.test(line)) {
      problems.push(`the patch renames or copies a file: ${printable(line)}`);
      continue;
    }
    const modes =
      /^(?:create|delete) mode ([0-7]+) /.exec(line)?.slice(1) ??
      /^mode change ([0-7]+) => ([0-7]+) /.exec(line)?.slice(1) ??
      [];
    const refused = modes.find((mode) => REFUSED_MODES.has(mode));
    if (refused !== undefined) {
      problems.push(
        `the patch involves mode ${refused} (symbolic link or submodule): ${printable(line)}`,
      );
    }
  }
  return problems;
}

/** The paths of a patch outside `allowed`, sorted, each once. */
export function pathsOutside(paths: readonly string[], allowed: ReadonlySet<string>): string[] {
  return [...new Set(paths.filter((path) => !allowed.has(path)))].sort();
}

/** Why the residue is not exactly the kept findings (same count AND same paths), or null. */
export function residueProblem(
  kept: readonly Finding[],
  residue: readonly string[],
): string | null {
  const expected = kept.map((finding) => finding.path).sort();
  const found = residue.map((raw) => parseFinding(raw)?.path ?? raw).sort();
  if (expected.length === found.length && expected.every((path, i) => path === found[i])) {
    return null;
  }
  return `the detector returns ${found.length} finding(s) on [${found.map(printable).join(", ")}], the kept ones are ${expected.length} on [${expected.map(printable).join(", ")}]`;
}

// ------------------------------------------------------------------ manifest

/** One line per repository; consumed by the application (lot L070). */
export const MANIFEST_COLUMNS = [
  "ticket",
  "repository",
  "served_branch",
  "base_sha",
  "patch",
  "added",
  "removed",
  "kept",
  "replay",
  "note",
] as const;

export interface ManifestLine {
  readonly ticket: string;
  readonly repository: string;
  readonly servedBranch: string;
  readonly baseSha: string;
  /** Relative to the kit directory. */
  readonly patch: string;
  readonly added: number;
  readonly removed: number;
  readonly kept: number;
  readonly replay: string;
  readonly note: string;
}

export function renderManifest(lines: readonly ManifestLine[]): string {
  const rows = lines.map((line) =>
    [
      line.ticket,
      line.repository,
      line.servedBranch,
      line.baseSha,
      line.patch,
      String(line.added),
      String(line.removed),
      String(line.kept),
      line.replay,
      line.note,
    ].join("\t"),
  );
  return `${[MANIFEST_COLUMNS.join("\t"), ...rows].join("\n")}\n`;
}

/**
 * The command that measures the repository again, written with the variables
 * of this tool rather than their values: it is cited in a pull request, where
 * a path of the operator's machine has no place.
 */
export function replayCommand(repository: string, registryOverridden: boolean): string {
  return [
    "bun ecosystem/fleet-state.ts state",
    '--detectors "$FLEET_DETECTORS_DIR"',
    '--worktrees "$FLEET_WORKTREES_DIR"',
    '--snapshot "$FLEET_SNAPSHOT_DIR"',
    '--out "$FLEET_STATES_DIR"',
    "--label <new-label>",
    `--repos ${repository}`,
    ...(registryOverridden ? ['--registry "$FLEET_GATES_REGISTRY"'] : []),
  ].join(" ");
}

// ------------------------------------------------------------------ processes

/** A Python detector runs in an isolated interpreter: no user site, no PYTHON* variable. */
export function isolatedArgv(argv: readonly string[]): readonly string[] {
  const [program, ...rest] = argv;
  if (program !== undefined && extname(program).toLowerCase() === ".py") {
    return ["python3", "-I", program, ...rest];
  }
  return argv;
}

const isolatingRunner =
  (inner: ProcessRunner): ProcessRunner =>
  (argv, options) =>
    inner(isolatedArgv(argv), options);

type Ran =
  | { readonly ok: true; readonly stdout: string; readonly stderr: string }
  | {
      readonly ok: false;
      /** False when the program could not be started at all (not executable, absent). */
      readonly launched: boolean;
      readonly reason: string;
      readonly stdout: string;
      readonly stderr: string;
    };

async function runCommand(
  spawn: ProcessRunner,
  argv: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<Ran> {
  try {
    const result = await spawn(argv, { cwd, env });
    const stdout = new TextDecoder().decode(result.stdout);
    if (result.failure !== null) {
      return {
        ok: false,
        launched: true,
        reason: result.failure,
        stdout,
        stderr: result.stderr,
      };
    }
    if (result.exitCode !== 0) {
      const reason =
        result.signal !== null ? `killed by ${result.signal}` : `exit ${result.exitCode}`;
      return { ok: false, launched: true, reason, stdout, stderr: result.stderr };
    }
    return { ok: true, stdout, stderr: result.stderr };
  } catch (error) {
    // The runner rejects only when the program cannot be started.
    return { ok: false, launched: false, reason: errorText(error), stdout: "", stderr: "" };
  }
}

/** Configuration of every git call of the kit, passed as command-line configuration. */
function copyConfiguration(hooks: string): readonly (readonly [string, string])[] {
  return [
    // A global hooks path must not run in a throwaway copy.
    ["core.hooksPath", hooks],
    ["user.name", "remediation-kit"],
    ["user.email", "remediation-kit@localhost"],
    ["commit.gpgsign", "false"],
  ];
}

/**
 * The environment of git and of the line editor: the variables a detector
 * receives (PASSED_VARIABLES of `fleet-state.ts`), never a GIT_* variable of
 * the caller (a GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE or GIT_CONFIG_PARAMETERS
 * would aim the copies' commands at another repository or configure them),
 * no prompt, and the copies' configuration by GIT_CONFIG_COUNT, so that no
 * `git config` writes a .git/config anywhere.
 */
export function toolEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  hooks: string,
): Record<string, string> {
  const built: Record<string, string> = {};
  for (const name of PASSED_VARIABLES) {
    const value = environment[name];
    if (value !== undefined) built[name] = value;
  }
  built.GIT_TERMINAL_PROMPT = "0";
  const configuration = copyConfiguration(hooks);
  built.GIT_CONFIG_COUNT = String(configuration.length);
  for (const [index, [key, value]] of configuration.entries()) {
    built[`GIT_CONFIG_KEY_${index}`] = key;
    built[`GIT_CONFIG_VALUE_${index}`] = value;
  }
  return built;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const firstLine = (text: string): string => printable(text.trim().split("\n")[0] ?? "");

// ------------------------------------------------------------------ command

const VARIABLES = {
  work: "REMEDIATION_WORK_DIR",
  states: "FLEET_STATES_DIR",
  worktrees: "FLEET_WORKTREES_DIR",
  snapshot: "FLEET_SNAPSHOT_DIR",
  detectors: "FLEET_DETECTORS_DIR",
} as const;
const KIT_DIR = "REMEDIATION_KIT_DIR";
const REGISTRY = "FLEET_GATES_REGISTRY";

const LINE_EDITS = join(import.meta.dir, "..", "line-edits.ts");
const SERVED_BRANCH = /^[A-Za-z0-9._/-]+$/;
const VERIFY_OUTPUT_LINES = 20;

interface Failure {
  readonly code: ExitCode;
  readonly messages: readonly string[];
}

const fail = (code: ExitCode, ...messages: string[]): Failure => ({
  code,
  messages,
});

/** The worst failure decides the code: stale input, then decisions, then proof. */
function worstCode(failures: readonly Failure[]): ExitCode {
  for (const code of [EXIT.input, EXIT.decisions, EXIT.proof] as const) {
    if (failures.some((failure) => failure.code === code)) return code;
  }
  return EXIT.ok;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(path: string): Promise<string | null> {
  if (!(await exists(path))) return null;
  return Bun.file(path).text();
}

interface Target {
  readonly repository: string;
  readonly sha: string;
  readonly servedBranch: string;
  readonly findings: readonly Finding[];
  readonly proof: readonly string[];
}

interface Context {
  readonly ticket: string;
  readonly detector: DetectorDescriptor;
  readonly work: string;
  readonly worktrees: string;
  readonly snapshot: string;
  readonly environment: Readonly<Record<string, string>>;
  /** For git and the line editor: `toolEnvironment`, never the caller's environment. */
  readonly toolEnvironment: Readonly<Record<string, string>>;
  readonly spawn: ProcessRunner;
  readonly scratch: string;
}

interface Proven {
  readonly target: Target;
  readonly plan: RepositoryPlan;
  readonly patch: string;
  readonly added: number;
  readonly removed: number;
}

/** Reads, per repository in écart, its proof, its measured HEAD and its served branch. */
async function readTargets(
  state: FleetState,
  stateDirectory: string,
  context: Context,
  reader: FleetReader,
): Promise<{ readonly targets: Target[]; readonly failures: Failure[] }> {
  const targets: Target[] = [];
  const failures: Failure[] = [];
  for (const row of state.rows) {
    if (row.detector !== context.ticket || row.verdict !== "écart") continue;
    const { repository } = row;
    const nameError = repositoryNameError(repository);
    if (nameError !== null) {
      failures.push(fail(EXIT.input, `state: ${nameError}`));
      continue;
    }
    const proofFile = join(stateDirectory, proofPath(context.ticket, repository));
    let proofText: string;
    try {
      proofText = await Bun.file(proofFile).text();
    } catch (error) {
      failures.push(
        fail(EXIT.input, `${repository}: proof unreadable: ${printable(errorText(error))}`),
      );
      continue;
    }
    const proof = proofText.split("\n").filter((line) => line !== "");
    if (proof.length !== row.count) {
      failures.push(
        fail(
          EXIT.input,
          `${repository}: the proof holds ${proof.length} line(s), the state counts ${row.count ?? "-"}`,
        ),
      );
      continue;
    }
    if (proof.length === 0) {
      failures.push(
        fail(EXIT.input, `${repository}: in écart without any finding, a kit cannot add one`),
      );
      continue;
    }
    const findings: Finding[] = [];
    for (const raw of proof) {
      const finding = parseFinding(raw);
      if (finding === null || pathError(finding.path) !== null) {
        failures.push(
          fail(EXIT.input, `${repository}: not a path:line:text finding: ${printable(raw)}`),
        );
      } else findings.push(finding);
    }
    if (findings.length !== proof.length) continue;
    const measured = state.heads.get(repository);
    if (measured === undefined) {
      failures.push(fail(EXIT.input, `${repository}: no measured HEAD in heads.tsv`));
      continue;
    }
    const head = await reader.head(repository);
    if (!head.ok) {
      failures.push(
        fail(EXIT.input, `${repository}: measured worktree unreadable: ${head.reason}`),
      );
      continue;
    }
    if (head.sha !== measured) {
      failures.push(
        fail(
          EXIT.input,
          `${repository}: the worktree moved since the state (${measured.slice(0, 8)} measured, ${head.sha.slice(0, 8)} now)`,
        ),
      );
      continue;
    }
    const servedBranch = await readServedBranch(context.snapshot, repository);
    if (!servedBranch.ok) {
      failures.push(fail(EXIT.input, `${repository}: ${servedBranch.reason}`));
      continue;
    }
    targets.push({
      repository,
      sha: measured,
      servedBranch: servedBranch.value,
      findings,
      proof,
    });
  }
  return { targets, failures };
}

async function readServedBranch(
  snapshot: string,
  repository: string,
): Promise<{ ok: true; value: string } | { ok: false; reason: string }> {
  const file = join(snapshot, `${repository}.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await Bun.file(file).text());
  } catch (error) {
    return {
      ok: false,
      reason: `snapshot unreadable: ${printable(errorText(error))}`,
    };
  }
  const branch =
    typeof parsed === "object" && parsed !== null && "default_branch" in parsed
      ? parsed.default_branch
      : undefined;
  if (typeof branch !== "string" || !SERVED_BRANCH.test(branch)) {
    return { ok: false, reason: "the snapshot holds no valid default_branch" };
  }
  return { ok: true, value: branch };
}

/** A fresh clone of the measured worktree at `sha`: the worktree itself is only read. */
async function freshCopy(
  context: Context,
  repository: string,
  sha: string,
  root: string,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const path = join(root, repository);
  await mkdir(join(root, repository.split("/")[0] ?? ""), { recursive: true });
  const env = context.toolEnvironment;
  const steps: readonly (readonly string[])[] = [
    [
      "git",
      "clone",
      "--quiet",
      "--no-checkout",
      "--no-hardlinks",
      join(context.worktrees, repository),
      path,
    ],
    ["git", "-C", path, "checkout", "--quiet", "--detach", sha],
  ];
  for (const argv of steps) {
    const ran = await runCommand(context.spawn, argv, context.scratch, env);
    if (!ran.ok)
      return {
        ok: false,
        reason: `${argv.slice(1, 4).join(" ")}: ${ran.reason}: ${firstLine(ran.stderr)}`,
      };
  }
  const head = await runCommand(context.spawn, ["git", "-C", path, "rev-parse", "HEAD"], path, env);
  if (!head.ok || head.stdout.trim() !== sha) {
    return { ok: false, reason: `the copy is not at ${sha.slice(0, 8)}` };
  }
  return { ok: true, path };
}

async function proveRepository(
  context: Context,
  target: Target,
  plan: RepositoryPlan,
  index: number,
): Promise<{ ok: true; proven: Proven } | { ok: false; failure: Failure }> {
  const { repository } = target;
  const env = context.toolEnvironment;
  const git = (cwd: string, ...args: string[]) =>
    runCommand(context.spawn, ["git", "-C", cwd, ...args], cwd, env);
  const own = join(context.scratch, String(index));

  // 1. The patch: the line editor on a first copy, or the manual patch.
  let patch: string;
  if (plan.manual > 0) {
    const manual = await readOptional(
      join(context.work, context.ticket, "manual", `${repository}.patch`),
    );
    if (manual === null) {
      return {
        ok: false,
        failure: fail(
          EXIT.input,
          `${repository}: manual patch absent (manual/${repository}.patch)`,
        ),
      };
    }
    patch = manual;
  } else {
    const copy = await freshCopy(context, repository, target.sha, join(own, "edit"));
    if (!copy.ok)
      return {
        ok: false,
        failure: fail(EXIT.input, `${repository}: ${copy.reason}`),
      };
    const list = join(own, "edits.tsv");
    await writeFile(
      list,
      plan.edits.map((e) => `${e.path}\t${e.line}\t${e.action}\t${e.argument}\n`).join(""),
    );
    const edited = await runCommand(
      context.spawn,
      [process.execPath, LINE_EDITS, copy.path, list],
      own,
      env,
    );
    if (!edited.ok) {
      const refusals = edited.stderr
        .split("\n")
        .filter((line) => line !== "")
        .map(printable);
      return {
        ok: false,
        failure: fail(
          EXIT.decisions,
          `${repository}: the line editor refuses (${edited.reason})`,
          ...refusals,
        ),
      };
    }
    const staged = await git(copy.path, "add", "--all");
    const diff = staged.ok
      ? await git(
          copy.path,
          "diff",
          "--cached",
          "--binary",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--src-prefix=a/",
          "--dst-prefix=b/",
        )
      : staged;
    if (!diff.ok)
      return {
        ok: false,
        failure: fail(EXIT.input, `${repository}: git diff: ${diff.reason}`),
      };
    patch = diff.stdout;
  }
  const patchFile = join(own, "kit.patch");
  await mkdir(own, { recursive: true });
  await writeFile(patchFile, patch);

  // 2. The files touched, the shape, then the lines added and removed.
  const numstat = await runCommand(
    context.spawn,
    ["git", "apply", "--numstat", "-z", patchFile],
    own,
    env,
  );
  const totals = numstat.ok ? numstatTotals(numstat.stdout) : null;
  if (totals === null) {
    return {
      ok: false,
      failure: fail(EXIT.proof, `${repository}: the patch has no readable numstat`),
    };
  }
  // A manual patch is not predicted line by line: what it may touch is bounded here.
  const allowed = new Set([
    ...target.findings.map((finding) => finding.path),
    ...plan.edits.map((edit) => edit.path),
  ]);
  const outside = pathsOutside(totals.paths, allowed);
  const summary = await runCommand(
    context.spawn,
    ["git", "apply", "--summary", patchFile],
    own,
    env,
  );
  if (!summary.ok) {
    return {
      ok: false,
      failure: fail(EXIT.proof, `${repository}: the patch has no readable summary`),
    };
  }
  const shape = [
    ...outside.map(
      (path) => `the patch touches a file without a finding or a companion: ${printable(path)}`,
    ),
    ...summaryProblems(summary.stdout),
  ];
  if (shape.length > 0) {
    return {
      ok: false,
      failure: fail(EXIT.proof, ...shape.map((problem) => `${repository}: ${problem}`)),
    };
  }
  if (plan.manual === 0) {
    const predicted = predictLines(plan.edits);
    if (predicted.added !== totals.added || predicted.removed !== totals.removed) {
      return {
        ok: false,
        failure: fail(
          EXIT.proof,
          `${repository}: lines added / removed: attendu ${predicted.added} / ${predicted.removed}, patch ${totals.added} / ${totals.removed}`,
        ),
      };
    }
  }

  // 3. A fresh copy reproduces the measure, then takes the patch.
  const proofRoot = join(own, "proof");
  const copy = await freshCopy(context, repository, target.sha, proofRoot);
  if (!copy.ok)
    return {
      ok: false,
      failure: fail(EXIT.input, `${repository}: ${copy.reason}`),
    };
  const reader = localFleetReader({
    worktrees: proofRoot,
    snapshot: context.snapshot,
    environment: context.environment,
    spawn: context.spawn,
  });
  const before = await reader.run(context.detector, {
    scope: "repo",
    repository,
  });
  if (!before.ok) {
    return {
      ok: false,
      failure: fail(
        EXIT.input,
        `${repository}: detector in error on the base copy: ${before.reason}`,
      ),
    };
  }
  if (before.lines.join("\n") !== target.proof.join("\n")) {
    return {
      ok: false,
      failure: fail(
        EXIT.input,
        `${repository}: the base copy does not reproduce the measured proof (${before.lines.length} line(s) for ${target.proof.length})`,
      ),
    };
  }
  for (const args of [
    ["apply", "--check", patchFile],
    ["apply", patchFile],
  ]) {
    const applied = await git(copy.path, ...args);
    if (!applied.ok) {
      return {
        ok: false,
        failure: fail(
          EXIT.proof,
          `${repository}: git ${args.slice(0, -1).join(" ")} refuses the patch: ${firstLine(applied.stderr)}`,
        ),
      };
    }
  }
  const committed = await git(copy.path, "add", "--all");
  const commit = committed.ok
    ? await git(copy.path, "commit", "--quiet", "-m", "remediation kit")
    : committed;
  if (!commit.ok) {
    return {
      ok: false,
      failure: fail(
        EXIT.proof,
        `${repository}: the patched copy cannot be committed: ${firstLine(commit.stderr)}`,
      ),
    };
  }

  // 4. The detector returns exactly the kept findings.
  const after = await reader.run(context.detector, {
    scope: "repo",
    repository,
  });
  if (!after.ok) {
    return {
      ok: false,
      failure: fail(
        EXIT.input,
        `${repository}: detector in error on the patched copy: ${after.reason}`,
      ),
    };
  }
  const residue = residueProblem(plan.kept, after.lines);
  if (residue !== null)
    return {
      ok: false,
      failure: fail(EXIT.proof, `${repository}: ${residue}`),
    };

  // 5. The repository's own verification, when declared.
  const verify = join(context.work, context.ticket, "verify", repository);
  let declared = false;
  try {
    const status = await lstat(verify);
    if (!status.isFile()) {
      return {
        ok: false,
        failure: fail(EXIT.input, `${repository}: verify/${repository} is not a regular file`),
      };
    }
    declared = true;
  } catch {
    declared = false;
  }
  if (declared) {
    const verifyEnv: Record<string, string> = {};
    for (const name of PASSED_VARIABLES) {
      const value = context.environment[name];
      if (value !== undefined) verifyEnv[name] = value;
    }
    const verified = await runCommand(context.spawn, [verify], copy.path, {
      ...verifyEnv,
      FLEET_REPOSITORY: repository,
      FLEET_WORKTREE: copy.path,
    });
    if (!verified.ok && !verified.launched) {
      return {
        ok: false,
        failure: fail(
          EXIT.input,
          `${repository}: verification could not be started: ${printable(verified.reason)}`,
        ),
      };
    }
    if (!verified.ok) {
      const output = `${verified.stdout}\n${verified.stderr}`
        .split("\n")
        .filter((line) => line !== "")
        .slice(0, VERIFY_OUTPUT_LINES)
        .map((line) => `  ${printable(line)}`);
      return {
        ok: false,
        failure: fail(
          EXIT.proof,
          `${repository}: verification failed (${verified.reason})`,
          ...output,
        ),
      };
    }
  }

  return {
    ok: true,
    proven: {
      target,
      plan,
      patch,
      added: totals.added,
      removed: totals.removed,
    },
  };
}

/**
 * Writes the kit in a staging directory beside its target, creates the target
 * exclusively (a directory that appeared since the check fails here, with no
 * window between a test and the rename), then renames the staging over that
 * empty directory it owns.
 */
async function writeKit(
  kitRoot: string,
  ticket: string,
  manifest: string,
  patches: readonly { readonly path: string; readonly content: string }[],
): Promise<void> {
  await mkdir(kitRoot, { recursive: true });
  const staging = await mkdtemp(join(kitRoot, `.${ticket}.kit-`));
  const target = join(kitRoot, ticket);
  let published = false;
  try {
    await writeFile(join(staging, "manifest.tsv"), manifest, { flag: "wx" });
    for (const patch of patches) {
      const file = join(staging, patch.path);
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(file, patch.content, { flag: "wx" });
    }
    await mkdir(target);
    try {
      await rename(staging, target);
    } catch (error) {
      // Only the empty directory created above: rmdir never removes content.
      await rmdir(target).catch(() => undefined);
      throw error;
    }
    published = true;
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface KitDependencies {
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Replaces the process runner of git, the editor, the detector and the verification. */
  readonly spawn?: ProcessRunner;
}

function usage(reason: string): CommandOutcome {
  return { code: EXIT.usage, stdout: [], stderr: [reason, USAGE] };
}

export async function runKit(
  argv: readonly string[],
  deps: KitDependencies,
): Promise<CommandOutcome> {
  const [ticket, label] = argv;
  if (argv.length !== 2 || ticket === undefined || label === undefined) {
    return usage("two arguments expected: <ticket> <state-label>");
  }
  for (const [what, value] of [
    ["ticket", ticket],
    ["label", label],
  ] as const) {
    if (!NAME.test(value)) {
      return usage(`${what} « ${printable(value)} » is not a plain name (no /, no leading dot)`);
    }
  }
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(deps.environment)) {
    if (value !== undefined) environment[name] = value;
  }
  const dirs: Record<keyof typeof VARIABLES, string> = {
    work: "",
    states: "",
    worktrees: "",
    snapshot: "",
    detectors: "",
  };
  for (const [key, name] of Object.entries(VARIABLES) as [keyof typeof VARIABLES, string][]) {
    const value = environment[name];
    if (value === undefined || value === "") return usage(`${name} is not set`);
    dirs[key] = resolve(value);
  }
  const registryOverridden = (environment[REGISTRY] ?? "") !== "";
  const registry = registryOverridden ? resolve(environment[REGISTRY] ?? "") : REGISTRY_PATH;
  const kitRoot = resolve(environment[KIT_DIR] || join(dirs.work, "kits"));
  const kitTarget = join(kitRoot, ticket);
  if (await exists(kitTarget)) {
    return usage(`${printable(kitTarget)} already exists: a kit is never replaced`);
  }

  // Inputs: the detector of the ticket, then the state.
  const discovery = await discoverDetectors(dirs.detectors, registry);
  if (!discovery.ok) {
    return {
      code: EXIT.input,
      stdout: [],
      stderr: discovery.errors.map((e) => `configuration: ${e}`),
    };
  }
  const matching = discovery.detectors.filter((d) => d.id === ticket);
  const [detector] = matching;
  if (matching.length !== 1 || detector === undefined) {
    return {
      code: EXIT.input,
      stdout: [],
      stderr: [`ticket ${ticket}: ${matching.length} detector(s) declare it, exactly 1 expected`],
    };
  }
  if (detector.scope !== "repo") {
    return {
      code: EXIT.input,
      stdout: [],
      stderr: [`ticket ${ticket}: a parc detector has no kit per repository`],
    };
  }
  const stateDirectory = join(dirs.states, label);
  let state: FleetState;
  try {
    state = await readState(stateDirectory);
  } catch (error) {
    if (!(error instanceof StateReadError)) throw error;
    return {
      code: EXIT.input,
      stdout: [],
      stderr: [`state ${label}: ${error.message}`],
    };
  }
  const rows = state.rows.filter((row) => row.detector === ticket);
  // The ticket status of L093: ABSENT and ERREUR measured nothing usable.
  const status = ticketStatus(rows);
  if (status === "ABSENT") {
    return {
      code: EXIT.input,
      stdout: [],
      stderr: [`state ${label}: no line for ticket ${ticket}`],
    };
  }
  if (status === "ERREUR") {
    return {
      code: EXIT.input,
      stdout: [],
      stderr: rows
        .filter((row) => row.status === "erreur")
        .map((row) => `state ${label}: ${row.repository}: measure in error: ${row.detail}`),
    };
  }

  const spawn =
    deps.spawn ??
    groupProcessRunner({
      timeoutMs: DETECTOR_TIMEOUT_MS,
      maxStdoutBytes: DETECTOR_MAX_STDOUT_BYTES,
    });
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "remediation-kit-")));
  try {
    const worktrees = await realpath(dirs.worktrees).catch(() => dirs.worktrees);
    const hooks = join(scratch, "no-hooks");
    await mkdir(hooks);
    const context: Context = {
      ticket,
      detector,
      work: dirs.work,
      worktrees,
      snapshot: dirs.snapshot,
      environment,
      toolEnvironment: toolEnvironment(environment, hooks),
      spawn: isolatingRunner(spawn),
      scratch,
    };
    const measuredReader = localFleetReader({
      worktrees,
      snapshot: dirs.snapshot,
      environment,
      spawn: context.spawn,
    });
    const { targets, failures } = await readTargets(state, stateDirectory, context, measuredReader);
    if (failures.length > 0)
      return {
        code: EXIT.input,
        stdout: [],
        stderr: failures.flatMap((f) => f.messages),
      };

    const header = `kit ${ticket} ${label}: status=${status} ticket-lines=${rows.length} ecart=${targets.length}`;
    const decisionsFile = join(dirs.work, ticket, "decisions.tsv");
    const decisionsText = await readOptional(decisionsFile);
    if (decisionsText === null && targets.length > 0) {
      return {
        code: EXIT.input,
        stdout: [header],
        stderr: [`${printable(decisionsFile)}: absent`],
      };
    }
    const decisions = parseDecisions(
      decisionsText ?? DECISION_COLUMNS.join("\t"),
      "decisions.tsv",
      false,
    );
    const companionsText = await readOptional(join(dirs.work, ticket, "companions.tsv"));
    const companions = parseDecisions(
      companionsText ?? DECISION_COLUMNS.join("\t"),
      "companions.tsv",
      true,
    );
    const readErrors = [
      ...(decisions.ok ? [] : decisions.errors),
      ...(companions.ok ? [] : companions.errors),
    ];
    if (!decisions.ok || !companions.ok) {
      return { code: EXIT.decisions, stdout: [header], stderr: readErrors };
    }
    const coverage = cover(
      targets.map((t) => ({ repository: t.repository, findings: t.findings })),
      decisions.decisions,
      companions.decisions,
    );
    if (!coverage.ok)
      return {
        code: EXIT.decisions,
        stdout: [header],
        stderr: coverage.errors,
      };
    if (targets.length === 0) {
      return {
        code: EXIT.ok,
        stdout: [header, `kit ${ticket} ${label}: no repository in écart, nothing written`],
        stderr: [],
      };
    }

    const proven: Proven[] = [];
    const proofFailures: Failure[] = [];
    for (const [index, target] of targets.entries()) {
      const plan = coverage.plans[index];
      if (plan === undefined || plan.repository !== target.repository) {
        throw new Error(`coverage out of order at ${target.repository}`);
      }
      const result = await proveRepository(context, target, plan, index);
      if (result.ok) proven.push(result.proven);
      else proofFailures.push(result.failure);
    }
    if (proofFailures.length > 0) {
      return {
        code: worstCode(proofFailures),
        stdout: [
          header,
          `kit ${ticket} ${label}: proven=${proven.length} failed=${proofFailures.length}, nothing written`,
        ],
        stderr: proofFailures.flatMap((f) => f.messages),
      };
    }

    const sum = (pick: (p: Proven) => number): number => proven.reduce((n, p) => n + pick(p), 0);
    const findings = sum((p) => p.plan.findings);
    const edited = sum((p) => p.plan.edited);
    const kept = sum((p) => p.plan.kept.length);
    const manual = sum((p) => p.plan.manual);
    if (findings !== edited + kept + manual) {
      return {
        code: EXIT.proof,
        stdout: [header],
        stderr: [
          `inconsistent sum: findings=${findings} edited+kept+manual=${edited + kept + manual}`,
        ],
      };
    }
    const manifest: ManifestLine[] = proven.map((p) => ({
      ticket,
      repository: p.target.repository,
      servedBranch: p.target.servedBranch,
      baseSha: p.target.sha,
      patch: `${p.target.repository}.patch`,
      added: p.added,
      removed: p.removed,
      kept: p.plan.kept.length,
      replay: replayCommand(p.target.repository, registryOverridden),
      note:
        p.plan.manual > 0
          ? "manual"
          : `edits=${p.plan.edits.length} companions=${p.plan.companions}`,
    }));
    try {
      await writeKit(
        kitRoot,
        ticket,
        renderManifest(manifest),
        proven.map((p) => ({
          path: `${p.target.repository}.patch`,
          content: p.patch,
        })),
      );
    } catch (error) {
      return {
        code: EXIT.proof,
        stdout: [header],
        stderr: [`write failed: ${printable(errorText(error))}`],
      };
    }
    return {
      code: EXIT.ok,
      stdout: [
        header,
        ...manifest.map(
          (m) =>
            `kit ${ticket}: ${m.repository} base=${m.baseSha.slice(0, 8)} served=${m.servedBranch} added=${m.added} removed=${m.removed} kept=${m.kept} patch=${m.patch}`,
        ),
        `kit ${ticket} ${label}: repositories=${proven.length} findings=${findings} edited=${edited} kept=${kept} manual=${manual} added=${sum((p) => p.added)} removed=${sum((p) => p.removed)} forge-writes=0 written=${printable(kitTarget)}`,
      ],
      stderr: [],
    };
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

if (import.meta.main) {
  const outcome = await runKit(Bun.argv.slice(2), { environment: process.env });
  for (const line of outcome.stdout) console.log(line);
  for (const line of outcome.stderr) console.error(line);
  process.exit(outcome.code);
}
