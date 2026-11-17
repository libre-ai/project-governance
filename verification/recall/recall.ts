/**
 * Recall score against injected defects (lot L094, idea h-plugins-flotte-09).
 *
 *   bun verification/recall/recall.ts <truth.tsv> <owner/name> [--evidence <state-dir>] [--spec <file.md>]
 *
 * Defects are injected into a copy of a repository by someone else (the
 * injection is out of this module's scope); this module only counts how many
 * of them an instrument found. Two instruments, each scored only when asked:
 *
 * DETECTORS (`--evidence`): a fleet state directory written by
 * `ecosystem/fleet-state.ts state` (lot L093). A defect is found when its
 * needle occurs in the proof of the expected detector, for this repository or
 * for the whole fleet (a `parc` measure). When the truth expects no detector
 * (`-`), the proof of any detector with an integer target counts. Two proofs
 * never count: the proof of an informative detector (target `info`: a list of
 * things to look at is not a detection) and the proof of another repository.
 *
 * AGENT (`--spec`): a Markdown specification written by an agent. A defect is
 * found when its needle occurs in a cell of a body row of a table inside the
 * single section titled « Constats ». Prose, another section (out of scope
 * included), a fenced code block and the header row of a table do not count. A
 * pipe inside inline code, or escaped as `\|`, stays in its cell.
 *
 * The score is deterministic: a needle is a literal substring, no judgement of
 * whether two texts mean the same thing is ever made.
 *
 * THE TRUTH is a TSV table whose header is exactly TRUTH_COLUMNS: identifier,
 * class (C covered by a detector, U without one), needle (the string that
 * identifies the defect), expected detector or `-`, description. An unexpected
 * header, a wrong column count, an empty or repeated identifier, an unknown
 * class, an empty needle or a truth without any defect is refused.
 *
 * NOTHING IS A SILENT ZERO. An instrument not requested is absent from the
 * summary, never reported as 0/y. A missing evidence directory, a measure the
 * score needs that is in error, exempt or absent, or a specification without
 * its section is an error (exit 1), not a missed defect: a defect is RATÉ only
 * when the instrument did run and its output does not hold the needle.
 *
 * Output: one table row per defect (trouvé / RATÉ / — for an instrument not
 * requested), then the summary by instrument (« détecteurs x/y · agent x/y »)
 * and by class. Exit codes: 0 scored (missed defects included), 1 truth,
 * evidence or specification unreadable, 2 usage.
 */

import { printable } from "../../ecosystem/fleet-gates";
import {
  type FleetState,
  PARK_REPOSITORY,
  proofFile,
  readState,
  repositoryNameError,
  StateReadError,
  type StateRow,
} from "../../ecosystem/fleet-state";

export const TRUTH_COLUMNS = ["id", "classe", "aiguille", "détecteur", "description"] as const;

/** The truth's mark for « no detector expected ». */
const NO_DETECTOR = "-";

export type DefectClass = "C" | "U";
const CLASSES: readonly DefectClass[] = ["C", "U"];

export interface Defect {
  readonly id: string;
  readonly defectClass: DefectClass;
  readonly needle: string;
  /** The expected detector, or null when the truth says `-`. */
  readonly detector: string | null;
  readonly description: string;
}

/** Any reason an input (truth, evidence, specification) cannot be read. */
export class RecallReadError extends Error {}

/** Parses the truth table; every malformed line is refused, never skipped. */
export function parseTruth(text: string): Defect[] {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines.at(-1) === "") lines.pop();
  const [header, ...body] = lines;
  if (header !== TRUTH_COLUMNS.join("\t")) {
    throw new RecallReadError(
      `truth: unexpected header « ${printable(header ?? "")} », expected « ${TRUTH_COLUMNS.join("\\t")} »`,
    );
  }
  if (body.length === 0) throw new RecallReadError("truth: no defect");
  const seen = new Set<string>();
  return body.map((line, index) => {
    const where = `truth: line ${index + 2}`;
    const fields = line.split("\t");
    if (fields.length !== TRUTH_COLUMNS.length) {
      throw new RecallReadError(
        `${where}: ${fields.length} columns, ${TRUTH_COLUMNS.length} expected`,
      );
    }
    const [id = "", defectClass = "", needle = "", detector = "", description = ""] = fields;
    if (id === "") throw new RecallReadError(`${where}: empty identifier`);
    if (seen.has(id))
      throw new RecallReadError(`${where}: identifier « ${printable(id)} » repeated`);
    seen.add(id);
    if (!(CLASSES as readonly string[]).includes(defectClass)) {
      throw new RecallReadError(`${where}: unknown class « ${printable(defectClass)} »`);
    }
    if (needle === "") throw new RecallReadError(`${where}: empty needle`);
    if (detector === "") throw new RecallReadError(`${where}: empty detector (write - for none)`);
    return {
      id,
      defectClass: defectClass as DefectClass,
      needle,
      detector: detector === NO_DETECTOR ? null : detector,
      description,
    };
  });
}

// ------------------------------------------------------------------ detectors

/** Reads a proof file of the state; an unreadable proof is an error, not a miss. */
export type ProofReader = (row: StateRow) => Promise<string>;

export function stateProofReader(stateDirectory: string): ProofReader {
  return async (row) => {
    const path = proofFile(stateDirectory, row.detector, row.repository);
    try {
      return await Bun.file(path).text();
    } catch {
      throw new RecallReadError(
        `proof of ${printable(row.detector)} ${printable(row.repository)} unreadable`,
      );
    }
  };
}

/** The measures that speak for `repository`: its own and those of the whole fleet. */
function rowsFor(state: FleetState, repository: string): StateRow[] {
  return state.rows.filter(
    (row) => row.repository === repository || row.repository === PARK_REPOSITORY,
  );
}

function notMeasured(row: StateRow): string {
  return `${printable(row.detector)} ${printable(row.repository)} is ${row.status}, not measured: ${printable(row.detail)}`;
}

/**
 * Whether the detectors found each defect, by identifier. Errors are collected
 * for every defect, none stops the others; any error means no score.
 */
export async function scoreDetectors(
  defects: readonly Defect[],
  state: FleetState,
  repository: string,
  readProof: ProofReader,
): Promise<{ found: Map<string, boolean>; errors: string[] }> {
  const found = new Map<string, boolean>();
  const errors: string[] = [];
  const own = state.rows.filter((row) => row.repository === repository);
  if (!own.some((row) => row.status !== "exempté")) {
    return {
      found,
      errors: [
        `evidence: ${printable(repository)} has no measure in state ${printable(state.label)}`,
      ],
    };
  }
  const relevant = rowsFor(state, repository);
  const proofs = new Map<string, Promise<string>>();
  const proof = (row: StateRow): Promise<string> => {
    const key = `${row.detector}\t${row.repository}`;
    let text = proofs.get(key);
    if (text === undefined) {
      text = readProof(row);
      proofs.set(key, text);
    }
    return text;
  };

  for (const defect of defects) {
    const where = `defect ${printable(defect.id)}`;
    const candidates =
      defect.detector === null
        ? relevant.filter((row) => row.target !== null && row.status !== "exempté")
        : relevant.filter((row) => row.detector === defect.detector);
    if (defect.detector !== null && candidates.length === 0) {
      errors.push(
        `${where}: detector ${printable(defect.detector)} has no measure of ${printable(repository)}`,
      );
      continue;
    }
    const unmeasured = candidates.filter((row) => row.status !== "ok");
    if (unmeasured.length > 0) {
      for (const row of unmeasured) errors.push(`${where}: ${notMeasured(row)}`);
      continue;
    }
    let hit = false;
    try {
      for (const row of candidates) {
        // An informative detector lists things to look at: never a detection.
        if (row.target === null) continue;
        if ((await proof(row)).includes(defect.needle)) {
          hit = true;
          break;
        }
      }
    } catch (error) {
      errors.push(`${where}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    found.set(defect.id, hit);
  }
  return { found, errors };
}

// ------------------------------------------------------------------ specification

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const DELIMITER_CELL = /^:?-+:?$/;

/**
 * The cells of a table row. An unescaped pipe outside inline code separates
 * cells; a pipe inside a code span, or written `\|`, stays in its cell (as `|`).
 */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  const cells: string[] = [];
  let current = "";
  let index = 0;
  let openTicks = 0;
  while (index < text.length) {
    const character = text[index] ?? "";
    if (character === "\\" && text[index + 1] === "|") {
      current += "|";
      index += 2;
      continue;
    }
    if (character === "`") {
      let run = 0;
      while (text[index + run] === "`") run += 1;
      if (openTicks === 0) openTicks = run;
      else if (run === openTicks) openTicks = 0;
      current += "`".repeat(run);
      index += run;
      continue;
    }
    if (character === "|" && openTicks === 0) {
      cells.push(current.trim());
      current = "";
      index += 1;
      continue;
    }
    current += character;
    index += 1;
  }
  // A trailing pipe closes the last cell; text after the last pipe is a cell.
  if (current.trim() !== "" || !text.trimEnd().endsWith("|")) cells.push(current.trim());
  return cells;
}

function isDelimiterRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell));
}

function isSectionTitle(title: string): boolean {
  return title.trim().replace(/:$/, "").trim().toLowerCase() === "constats";
}

/**
 * The cells of every body row of every table in the single « Constats »
 * section, fenced code excluded. A specification without that section, or
 * with more than one, is refused.
 */
export function findingCells(markdown: string): string[] {
  const lines = markdown.split("\n").map((line) => line.replace(/\r$/, ""));
  let fence: string | null = null;
  let sections = 0;
  let sectionLevel: number | null = null;
  let block: string[] = [];
  const cells: string[] = [];

  const flush = (): void => {
    // A table is a header row followed by a delimiter row; anything else is prose.
    if (block.length >= 2 && isDelimiterRow(block[1] ?? "")) {
      for (const row of block.slice(2)) cells.push(...splitRow(row));
    }
    block = [];
  };

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fence !== null) {
      const closing = fenceMatch?.[1];
      if (
        closing !== undefined &&
        closing[0] === fence[0] &&
        closing.length >= fence.length &&
        line.trim() === closing
      ) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch?.[1] !== undefined) {
      flush();
      fence = fenceMatch[1];
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      const level = heading[1]?.length ?? 1;
      if (sectionLevel !== null && level <= sectionLevel) sectionLevel = null;
      if (isSectionTitle(heading[2] ?? "")) {
        sections += 1;
        sectionLevel = level;
      }
      continue;
    }
    if (sectionLevel !== null && line.trim().startsWith("|")) {
      block.push(line);
      continue;
    }
    flush();
  }
  flush();
  if (sections === 0) throw new RecallReadError("specification: no « Constats » section");
  if (sections > 1) {
    throw new RecallReadError(`specification: ${sections} « Constats » sections, one expected`);
  }
  return cells;
}

export function scoreSpecification(
  defects: readonly Defect[],
  markdown: string,
): Map<string, boolean> {
  const cells = findingCells(markdown);
  return new Map(
    defects.map((defect) => [defect.id, cells.some((cell) => cell.includes(defect.needle))]),
  );
}

// ------------------------------------------------------------------ report

export interface Scores {
  /** null: the instrument was not requested, hence not scored. */
  readonly detectors: ReadonlyMap<string, boolean> | null;
  readonly agent: ReadonlyMap<string, boolean> | null;
}

function mark(scores: ReadonlyMap<string, boolean> | null, id: string): string {
  if (scores === null) return "—";
  return scores.get(id) === true ? "trouvé" : "RATÉ";
}

function markdownCell(text: string): string {
  return printable(text).replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

function ratio(defects: readonly Defect[], scores: ReadonlyMap<string, boolean>): string {
  const found = defects.filter((defect) => scores.get(defect.id) === true).length;
  return `${found}/${defects.length}`;
}

/** « détecteurs x/y · agent x/y » over `defects`, an instrument not scored left out. */
export function summary(defects: readonly Defect[], scores: Scores): string {
  const parts: string[] = [];
  if (scores.detectors !== null) parts.push(`détecteurs ${ratio(defects, scores.detectors)}`);
  if (scores.agent !== null) parts.push(`agent ${ratio(defects, scores.agent)}`);
  return parts.join(" · ");
}

export function renderReport(
  repository: string,
  defects: readonly Defect[],
  scores: Scores,
): string {
  const rows = defects.map(
    (defect) =>
      `| ${markdownCell(defect.id)} | ${defect.defectClass} | ${markdownCell(defect.detector ?? NO_DETECTOR)} | ${mark(scores.detectors, defect.id)} | ${mark(scores.agent, defect.id)} |`,
  );
  const byClass = CLASSES.filter((defectClass) =>
    defects.some((defect) => defect.defectClass === defectClass),
  ).map(
    (defectClass) =>
      `classe ${defectClass} : ${summary(
        defects.filter((defect) => defect.defectClass === defectClass),
        scores,
      )}`,
  );
  return [
    `# Rappel — ${markdownCell(repository)}`,
    "",
    "| Défaut | Classe | Détecteur attendu | Détecteurs | Agent |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    `rappel ${printable(repository)} : ${summary(defects, scores)}`,
    ...byClass,
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ command

export interface CommandOutcome {
  readonly code: 0 | 1 | 2;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

const USAGE =
  "usage: bun verification/recall/recall.ts <truth.tsv> <owner/name> [--evidence <state-dir>] [--spec <file.md>] (at least one of --evidence, --spec)";

function usage(reason: string): CommandOutcome {
  return { code: 2, stdout: [], stderr: [reason, USAGE] };
}

function unreadable(lines: readonly string[]): CommandOutcome {
  return { code: 1, stdout: [], stderr: lines };
}

async function readInput(path: string, name: string): Promise<string> {
  try {
    return await Bun.file(path).text();
  } catch {
    throw new RecallReadError(`${name} ${printable(path)}: unreadable`);
  }
}

export async function runRecall(argv: readonly string[]): Promise<CommandOutcome> {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!["evidence", "spec"].includes(name) || options.has(name)) {
      return usage(`unknown or repeated option ${printable(argument)}`);
    }
    if (value === undefined || value === "") return usage(`${printable(argument)} needs a value`);
    options.set(name, value);
    index += 1;
  }
  const [truthPath, repository] = positional;
  if (positional.length !== 2 || truthPath === undefined || repository === undefined) {
    return usage("a truth file and a repository expected");
  }
  const refused = repositoryNameError(repository);
  if (refused !== null) return usage(refused);
  const evidence = options.get("evidence");
  const spec = options.get("spec");
  if (evidence === undefined && spec === undefined) {
    return usage("no instrument to score: give --evidence, --spec or both");
  }

  let defects: Defect[];
  try {
    defects = parseTruth(await readInput(truthPath, "truth"));
  } catch (error) {
    if (!(error instanceof RecallReadError)) throw error;
    return unreadable([error.message]);
  }

  const errors: string[] = [];
  let detectors: Map<string, boolean> | null = null;
  if (evidence !== undefined) {
    try {
      const state = await readState(evidence);
      const scored = await scoreDetectors(defects, state, repository, stateProofReader(evidence));
      errors.push(...scored.errors);
      detectors = scored.found;
    } catch (error) {
      if (!(error instanceof StateReadError)) throw error;
      errors.push(`evidence ${printable(evidence)}: ${error.message}`);
    }
  }
  let agent: Map<string, boolean> | null = null;
  if (spec !== undefined) {
    try {
      agent = scoreSpecification(defects, await readInput(spec, "specification"));
    } catch (error) {
      if (!(error instanceof RecallReadError)) throw error;
      errors.push(error.message);
    }
  }
  if (errors.length > 0) return unreadable(errors);
  return { code: 0, stdout: [renderReport(repository, defects, { detectors, agent })], stderr: [] };
}

if (import.meta.main) {
  const outcome = await runRecall(Bun.argv.slice(2));
  for (const line of outcome.stdout) console.log(line);
  for (const line of outcome.stderr) console.error(line);
  process.exit(outcome.code);
}
