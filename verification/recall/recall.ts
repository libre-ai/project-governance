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
 * single section titled « Constats » (ATX or Setext title), the Markdown read
 * as GitHub renders it (GFM: a table needs no leading pipe). Prose, another
 * section, a « Hors périmètre » section above or inside it, fenced or indented
 * code, an HTML block, the header row of a table and the cells a body row
 * holds beyond the header's count do not count. A pipe inside inline code, or
 * escaped as `\|`, stays in its cell.
 *
 * In the proof of a `parc` measure, only a line that names no other
 * repository of the state counts: such a line speaks for that repository. A
 * proof reached through a symbolic link, or that is not a regular file, is an
 * error.
 *
 * The score is deterministic: a needle is a literal substring, no judgement of
 * whether two texts mean the same thing is ever made.
 *
 * THE TRUTH is a TSV table whose header is exactly TRUTH_COLUMNS: identifier,
 * class (C covered by a detector, U without one), needle (the string that
 * identifies the defect), expected detector or `-`, description. An unexpected
 * header, a wrong column count, an empty or repeated identifier, an unknown
 * class, an empty needle or a truth without any defect is refused; a field of
 * spaces only is empty.
 *
 * NOTHING IS A SILENT ZERO. An instrument not requested is absent from the
 * summary, never reported as 0/y. A missing evidence directory, a measure the
 * score needs that is in error, exempt or absent, or a specification without
 * its section or whose section holds no table is an error (exit 1), not a
 * missed defect: a defect is RATÉ only
 * when the instrument did run and its output does not hold the needle.
 *
 * Output: one table row per defect (trouvé / RATÉ / — for an instrument not
 * requested), then the summary by instrument (« détecteurs x/y · agent x/y »)
 * and by class. Exit codes: 0 scored (missed defects included), 1 truth,
 * evidence or specification unreadable, 2 usage.
 */

import { lstat, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

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
    // A field of spaces only is empty: a needle of spaces would be found in almost any text.
    if (id.trim() === "") throw new RecallReadError(`${where}: empty identifier`);
    if (seen.has(id))
      throw new RecallReadError(`${where}: identifier « ${printable(id)} » repeated`);
    seen.add(id);
    if (!(CLASSES as readonly string[]).includes(defectClass)) {
      throw new RecallReadError(`${where}: unknown class « ${printable(defectClass)} »`);
    }
    if (needle.trim() === "") throw new RecallReadError(`${where}: empty needle`);
    if (detector.trim() === "")
      throw new RecallReadError(`${where}: empty detector (write - for none)`);
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

/**
 * The real path of a measure's proof, verified: its real path lies under the
 * real state directory, no segment below the state directory is a symbolic
 * link (lstat), even one that stays inside, and the proof is a regular file (a
 * FIFO would block the read). A proof that leads elsewhere is not evidence
 * about this state, whatever it holds.
 */
async function verifiedProofPath(stateDirectory: string, row: StateRow): Promise<string> {
  const what = `proof of ${printable(row.detector)} ${printable(row.repository)}`;
  const root = resolve(stateDirectory);
  const path = proofFile(root, row.detector, row.repository);
  let current = root;
  try {
    const realRoot = await realpath(root);
    const real = await realpath(path);
    if (!real.startsWith(`${realRoot}${sep}`)) {
      throw new RecallReadError(`${what}: resolves outside the state`);
    }
    for (const segment of relative(root, path).split(sep)) {
      current = join(current, segment);
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new RecallReadError(`${what}: ${printable(segment)} is a symbolic link`);
      }
      if (current === path && !stat.isFile()) {
        throw new RecallReadError(`${what}: not a regular file`);
      }
    }
    return real;
  } catch (error) {
    if (error instanceof RecallReadError) throw error;
    throw new RecallReadError(`${what} unreadable`);
  }
}

export function stateProofReader(stateDirectory: string): ProofReader {
  return async (row) => {
    const path = await verifiedProofPath(stateDirectory, row);
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

/**
 * Matches `name` as a whole repository name, not as part of a longer one: no
 * character of the REPOSITORY_NAME alphabet (or `/`) right before it, none
 * right after it. A dot right after it continues the name only when a name
 * character follows; otherwise it ends a sentence.
 */
function wholeName(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9._/-])${escaped}(?![A-Za-z0-9_/-]|\\.[A-Za-z0-9._-])`);
}

/**
 * Whether a parc proof holds the needle for `repository`. A parc measure
 * covers the whole fleet, so a line that names another repository of the
 * inventory speaks for that repository, not this one: it does not count.
 */
function parkProofHolds(proof: string, needle: string, others: readonly RegExp[]): boolean {
  return proof
    .split("\n")
    .some((line) => line.includes(needle) && !others.some((other) => other.test(line)));
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
  const inventory = new Set([...state.rows.map((row) => row.repository), ...state.heads.keys()]);
  const others = [...inventory]
    .filter((name) => name !== repository && name !== PARK_REPOSITORY)
    .map(wholeName);
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
        const text = await proof(row);
        const holds =
          row.repository === PARK_REPOSITORY
            ? parkProofHolds(text, defect.needle, others)
            : text.includes(defect.needle);
        if (holds) {
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
/** A Setext underline: `=` makes a level 1 title, `-` a level 2 one. */
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const BLOCK_QUOTE = /^ {0,3}>/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;

/** A CommonMark HTML block kind: the line that opens it and the one that closes it. */
interface HtmlBlockKind {
  readonly start: RegExp;
  /** A pattern found on the closing line, or `blank` when a blank line ends the block. */
  readonly end: RegExp | "blank";
  readonly interruptsParagraph: boolean;
}

const HTML_BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";

/** The seven HTML block kinds of CommonMark, in its order. */
const HTML_BLOCKS: readonly HtmlBlockKind[] = [
  {
    start: /^ {0,3}<(?:script|pre|style|textarea)(?:[ \t>]|$)/i,
    end: /<\/(?:script|pre|style|textarea)>/i,
    interruptsParagraph: true,
  },
  { start: /^ {0,3}<!--/, end: /-->/, interruptsParagraph: true },
  { start: /^ {0,3}<\?/, end: /\?>/, interruptsParagraph: true },
  { start: /^ {0,3}<![A-Za-z]/, end: />/, interruptsParagraph: true },
  { start: /^ {0,3}<!\[CDATA\[/, end: /\]\]>/, interruptsParagraph: true },
  {
    start: new RegExp(`^ {0,3}</?(?:${HTML_BLOCK_TAGS})(?:[ \\t>]|/>|$)`, "i"),
    end: "blank",
    interruptsParagraph: true,
  },
  {
    start:
      /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>)[ \t]*$/,
    end: "blank",
    interruptsParagraph: false,
  },
];

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

type SectionKind = "constats" | "out-of-scope" | "other";

/** A title, case, accents and a final colon aside. */
function sectionKind(title: string): SectionKind {
  const plain = title
    .trim()
    .replace(/:$/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (plain === "constats") return "constats";
  if (/^hors[ -]perimetre(?![a-z])/.test(plain)) return "out-of-scope";
  return "other";
}

/** Leading indentation in columns, a tab advancing to the next multiple of 4. */
function indentWidth(line: string): number {
  let width = 0;
  for (const character of line) {
    if (character === " ") width += 1;
    else if (character === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** The HTML block kind `line` opens, if any (kind 7 cannot interrupt a paragraph). */
function htmlBlockStart(line: string, inParagraph: boolean): HtmlBlockKind | undefined {
  return HTML_BLOCKS.find(
    (kind) => kind.start.test(line) && (!inParagraph || kind.interruptsParagraph),
  );
}

/** Whether `line` opens another block, which ends a table. */
function opensBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    THEMATIC_BREAK.test(line) ||
    BLOCK_QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    htmlBlockStart(line, false) !== undefined
  );
}

/**
 * The cells of every body row of every table in the single « Constats »
 * section, read as GitHub renders the Markdown (GFM). A table is a header row
 * followed by a delimiter row with as many cells, leading pipe or not; it ends
 * at a blank line or at the start of another block. Fenced code, indented code
 * (4 columns or more), HTML blocks, prose, header rows and the cells a body row
 * holds beyond the header's count (GFM does not render them) do not count. A
 * section is opened by an ATX or a Setext title and closed by a title of the
 * same or a higher level; a « Hors périmètre » title, above or inside the
 * section, puts what it covers out of the count.
 *
 * A specification without that section, with more than one, or whose section
 * holds no table is refused: no table is no measure, not a list of misses.
 */
export function findingCells(markdown: string): string[] {
  const lines = markdown.split("\n").map((line) => line.replace(/\r$/, ""));
  const titles: { readonly level: number; readonly kind: SectionKind }[] = [];
  let sections = 0;
  let tables = 0;
  let fence: string | null = null;
  let html: HtmlBlockKind | null = null;
  let paragraph: string[] = [];
  let table: { readonly columns: number; readonly counted: boolean } | null = null;
  const cells: string[] = [];

  const counting = (): boolean =>
    titles.some((title) => title.kind === "constats") &&
    !titles.some((title) => title.kind === "out-of-scope");

  const openTitle = (level: number, text: string): void => {
    while ((titles.at(-1)?.level ?? 0) >= level) titles.pop();
    const kind = sectionKind(text);
    const outOfScope = titles.some((title) => title.kind === "out-of-scope");
    if (kind === "constats" && !outOfScope) sections += 1;
    titles.push({ level, kind });
  };

  for (const line of lines) {
    if (fence !== null) {
      const closing = FENCE.exec(line)?.[1];
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
    if (html !== null) {
      if (html.end === "blank" ? line.trim() === "" : html.end.test(line)) html = null;
      continue;
    }
    const blank = line.trim() === "";
    const indented = indentWidth(line) >= 4;
    if (table !== null) {
      if (!blank && !indented && !opensBlock(line)) {
        if (table.counted) cells.push(...splitRow(line).slice(0, table.columns));
        continue;
      }
      table = null;
    }
    if (blank) {
      paragraph = [];
      continue;
    }
    if (indented) {
      // Indented code cannot interrupt a paragraph: there the line continues it.
      if (paragraph.length > 0) paragraph.push(line);
      continue;
    }
    const underline = SETEXT_UNDERLINE.exec(line)?.[1];
    if (paragraph.length > 0 && underline !== undefined) {
      openTitle(underline.startsWith("=") ? 1 : 2, paragraph.join(" "));
      paragraph = [];
      continue;
    }
    const opening = FENCE.exec(line)?.[1];
    if (opening !== undefined) {
      paragraph = [];
      fence = opening;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      paragraph = [];
      openTitle(heading[1]?.length ?? 1, heading[2] ?? "");
      continue;
    }
    const htmlKind = htmlBlockStart(line, paragraph.length > 0);
    if (htmlKind !== undefined) {
      paragraph = [];
      html = htmlKind.end !== "blank" && htmlKind.end.test(line) ? null : htmlKind;
      continue;
    }
    if (THEMATIC_BREAK.test(line) || BLOCK_QUOTE.test(line) || LIST_ITEM.test(line)) {
      paragraph = [];
      continue;
    }
    const header = paragraph.at(-1);
    if (header !== undefined && isDelimiterRow(line)) {
      const columns = splitRow(line).length;
      if (splitRow(header).length === columns) {
        const counted = counting();
        if (counted) tables += 1;
        table = { columns, counted };
        paragraph = [];
        continue;
      }
    }
    paragraph.push(line);
  }
  if (sections === 0) throw new RecallReadError("specification: no « Constats » section");
  if (sections > 1) {
    throw new RecallReadError(`specification: ${sections} « Constats » sections, one expected`);
  }
  if (tables === 0) throw new RecallReadError("specification: « Constats » holds no table");
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
