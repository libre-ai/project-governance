/**
 * Counts a parity matrix, so that every figure quoted from it can be recomputed.
 *
 * WHY. `docs/method/PARITY-AUDIT-METHOD.md` makes three promises that only a
 * matrix can keep, never the method document: a status outside the four values
 * is counted apart instead of being dropped, an "absent" names what was searched
 * and where, and an exclusion cites a decision and carries no source. A count
 * typed by hand into an audit cannot be checked; a count printed by a command
 * can. This tool is that command. It is run on demand and is deliberately wired
 * into no check chain: the matrix of a product lives with that product.
 *
 * THE FILE holds its table and nothing else:
 *
 *   | # | fonctionnalité | <reference 1> | <reference 2> | verdict | décision | source | preuve |
 *   | - | -------------- | ------------- | ------------- | ------- | -------- | ------ | ------ |
 *   | 1 | ...            | natif         | absent        | adapter |          | ...    | motifs: ... ; chemins: ... |
 *
 * The first two and the last four columns are fixed; every column in between is
 * the status of one reference (one or more). Rows are numbered 1..N in order.
 *
 * Usage: bun tools/parity/count-parity-matrix.ts <matrix-file>
 * Exit codes: 0 conforming, 1 counted violation, 2 usage or unreadable file.
 */

import { readFileSync } from "node:fs";

const STATUSES = ["natif", "partiel", "absent", "non mesuré"] as const;
const VERDICTS = ["reprendre", "adapter", "réécrire", "exclure"] as const;
type Status = (typeof STATUSES)[number];
type Verdict = (typeof VERDICTS)[number];

const LEADING_HEADERS = ["#", "fonctionnalité"] as const;
const TRAILING_HEADERS = ["verdict", "décision", "source", "preuve"] as const;

// A decision is cited by its identifier in one of the three registers.
const DECISION_ID = /(?<![\w-])(?:D\d+|ADR-\d{4}|I-\d{2})(?![\w-])/;
// An absence names BOTH what was searched and where, as `;`-separated segments
// each opening on its label. A segment opening on no label continues the one
// before it (a searched pattern may hold a `;`).
const PROOF_LABELS = ["motifs", "chemins"] as const;
const LABELLED_SEGMENT = /^(motifs|chemins)\s*:(.*)$/s;
// Content names something only if it holds a letter or a digit: `-`, `.`, `/`
// alone name nothing. Content opening on a label is the other label, left empty.
const NAMES_SOMETHING = /[\p{L}\p{N}]/u;
const OPENS_ON_LABEL = /^(?:motifs|chemins)\s*:/;

export interface MatrixCounts {
  /** Numbered rows that were counted. */
  readonly rows: number;
  /** Rows of the table refused for their shape; rows + rejectedRows = data rows read. */
  readonly rejectedRows: number;
  readonly statusColumns: number;
  /** The header text of each status column, in order: one per reference. */
  readonly statusHeaders: readonly string[];
  /** The verdict cell of each counted row, in row order (index 0 is row 1). */
  readonly rowVerdicts: readonly string[];
  readonly statuses: Readonly<Record<Status, number>>;
  /** Status cells outside the four values: counted apart, never dropped. */
  readonly otherStatuses: number;
  readonly verdicts: Readonly<Record<Verdict, number>>;
  readonly otherVerdicts: number;
  readonly absentWithoutProof: number;
  readonly excludeWithoutDecision: number;
  readonly excludeWithSource: number;
  /** Shape violations, each naming its line. */
  readonly structure: readonly string[];
}

function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  // An escaped closing pipe is cell content, not the end of the row.
  if (!trimmed.startsWith("|") || !/(?<!\\)\|$/.test(trimmed) || trimmed.length < 2) return null;
  // `\|` is a literal pipe inside a cell: searched patterns are often alternations.
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/** True when the proof cell names searched patterns AND searched paths, each with content. */
function provesAbsence(proof: string): boolean {
  const contents = new Map<string, string>();
  let current: string | null = null;
  for (const segment of proof.split(";")) {
    const match = LABELLED_SEGMENT.exec(segment.trim());
    const label = match?.[1];
    if (label !== undefined) {
      // A label given twice is ambiguous: the proof is refused.
      if (contents.has(label)) return false;
      current = label;
      contents.set(label, (match?.[2] ?? "").trim());
    } else if (current !== null) {
      contents.set(current, `${contents.get(current) ?? ""};${segment}`);
    }
  }
  return PROOF_LABELS.every((label) => {
    const content = contents.get(label);
    return content !== undefined && !OPENS_ON_LABEL.test(content) && NAMES_SOMETHING.test(content);
  });
}

function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value);
}

/** Pure: the whole verdict is a function of the text, so it is testable without a file. */
export function countMatrix(text: string): MatrixCounts {
  const statuses: Record<Status, number> = { natif: 0, partiel: 0, absent: 0, "non mesuré": 0 };
  const verdicts: Record<Verdict, number> = { reprendre: 0, adapter: 0, réécrire: 0, exclure: 0 };
  const structure: string[] = [];
  const rowVerdicts: string[] = [];
  let statusHeaders: string[] = [];
  let rows = 0;
  let rejectedRows = 0;
  let statusColumns = 0;
  let otherStatuses = 0;
  let otherVerdicts = 0;
  let absentWithoutProof = 0;
  let excludeWithoutDecision = 0;
  let excludeWithSource = 0;

  const lines = text.split(/\r?\n/);
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && lines[first]?.trim() === "") first += 1;
  while (last >= first && lines[last]?.trim() === "") last -= 1;

  const table: { readonly lineNumber: number; readonly cells: string[] }[] = [];
  for (let index = first; index <= last; index += 1) {
    const cells = splitRow(lines[index] ?? "");
    if (cells === null) {
      structure.push(
        `line ${index + 1}: not a table row — the file holds its table and nothing else`,
      );
      continue;
    }
    table.push({ lineNumber: index + 1, cells });
  }

  const header = table[0];
  const separator = table[1];
  const fixed = LEADING_HEADERS.length + TRAILING_HEADERS.length;
  const headerNames = header?.cells.map((cell) => cell.toLowerCase()) ?? [];
  const headerOk =
    header !== undefined &&
    headerNames.length > fixed &&
    LEADING_HEADERS.every((name, i) => headerNames[i] === name) &&
    TRAILING_HEADERS.every(
      (name, i) => headerNames[headerNames.length - TRAILING_HEADERS.length + i] === name,
    );
  const separatorOk =
    separator !== undefined &&
    separator.cells.length === headerNames.length &&
    separator.cells.every((cell) => /^:?-+:?$/.test(cell));

  if (!headerOk) {
    structure.push(
      `header: expected | ${LEADING_HEADERS.join(" | ")} | <one status column per reference> | ${TRAILING_HEADERS.join(" | ")} |`,
    );
  }
  if (headerOk && !separatorOk) {
    structure.push("separator: the second row of the table is not a separator row");
  }

  if (headerOk && separatorOk) {
    const width = headerNames.length;
    statusColumns = width - fixed;
    statusHeaders = (header?.cells ?? []).slice(
      LEADING_HEADERS.length,
      LEADING_HEADERS.length + statusColumns,
    );
    for (const { lineNumber, cells } of table.slice(2)) {
      // `01` or `0` is not the number of a row: the suite starts at 1, unpadded.
      const numbered = /^[1-9][0-9]*$/.test(cells[0] ?? "");
      if (cells.length !== width || !numbered) {
        rejectedRows += 1;
        structure.push(
          numbered
            ? `line ${lineNumber}: ${cells.length} cells, the header declares ${width}`
            : `line ${lineNumber}: the first cell is not a row number`,
        );
        continue;
      }
      rows += 1;
      if (Number(cells[0]) !== rows) {
        structure.push(
          `line ${lineNumber}: row number ${cells[0]} where ${rows} is due — duplicated or missing number`,
        );
      }

      const rowStatuses = cells.slice(
        LEADING_HEADERS.length,
        LEADING_HEADERS.length + statusColumns,
      );
      for (const status of rowStatuses) {
        if (isStatus(status)) statuses[status] += 1;
        else otherStatuses += 1;
      }

      const [verdict = "", decision = "", source = "", proof = ""] = cells.slice(
        width - TRAILING_HEADERS.length,
      );
      rowVerdicts.push(verdict);
      if (isVerdict(verdict)) verdicts[verdict] += 1;
      else otherVerdicts += 1;

      if (verdict === "exclure" && !DECISION_ID.test(decision)) excludeWithoutDecision += 1;
      if (verdict === "exclure" && source !== "") excludeWithSource += 1;
      if (rowStatuses.includes("absent") && !provesAbsence(proof)) absentWithoutProof += 1;
    }
    // A matrix with no row measures nothing: it is not a conforming zero.
    if (rows === 0) structure.push("table: no numbered row");
  }

  return {
    rows,
    rejectedRows,
    statusColumns,
    statusHeaders,
    rowVerdicts,
    statuses,
    otherStatuses,
    verdicts,
    otherVerdicts,
    absentWithoutProof,
    excludeWithoutDecision,
    excludeWithSource,
    structure,
  };
}

/** The counters, one per line, in the order the method document quotes them. */
export function renderCounts(counts: MatrixCounts): string {
  const statusSum =
    STATUSES.reduce((sum, status) => sum + counts.statuses[status], 0) + counts.otherStatuses;
  return [
    `lignes=${counts.rows}`,
    `lignes_ecartees=${counts.rejectedRows}`,
    `colonnes_statut=${counts.statusColumns}`,
    ...STATUSES.map((status) => `statut ${status}=${counts.statuses[status]}`),
    `AUTRE=${counts.otherStatuses}`,
    `somme_statuts=${statusSum} lignes_x_colonnes_statut=${counts.rows * counts.statusColumns}`,
    ...VERDICTS.map((verdict) => `verdict ${verdict}=${counts.verdicts[verdict]}`),
    `verdict_autre=${counts.otherVerdicts}`,
    `absent_sans_preuve=${counts.absentWithoutProof}`,
    `exclure_sans_decision=${counts.excludeWithoutDecision}`,
    `exclure_avec_source=${counts.excludeWithSource}`,
    `structure=${counts.structure.length}`,
  ].join("\n");
}

/** 0 when nothing counted is a violation, 1 otherwise. */
export function exitCode(counts: MatrixCounts): 0 | 1 {
  const violations =
    counts.otherStatuses +
    counts.otherVerdicts +
    counts.absentWithoutProof +
    counts.excludeWithoutDecision +
    counts.excludeWithSource +
    counts.structure.length;
  return violations > 0 ? 1 : 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const path = args[0];
  if (args.length !== 1 || path === undefined) {
    console.error("usage: bun tools/parity/count-parity-matrix.ts <matrix-file>");
    process.exit(2);
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    // An unreadable matrix is not an empty one: no counter is printed.
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`cannot read the matrix: ${reason}`);
    process.exit(2);
  }
  const counts = countMatrix(text);
  console.log(renderCounts(counts));
  for (const violation of counts.structure) console.error(`structure: ${violation}`);
  process.exit(exitCode(counts));
}
