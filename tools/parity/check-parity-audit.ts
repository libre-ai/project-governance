/**
 * Checks that a parity audit is complete: one row file ("fiche") per matrix row,
 * each in its fixed shape, citing only frozen copies at frozen revisions.
 *
 * WHY. `count-parity-matrix.ts` counts the matrix, but a matrix row is a claim;
 * its argument lives in the fiche of that row. A fiche removed, a section moved,
 * or a citation of a reference at a branch name instead of the frozen revision
 * all read like a finished audit. This gate makes "every row is argued, at the
 * frozen versions" a printed count instead of a reading impression. Like the
 * matrix counter, it runs on demand and is wired into no check chain: the audit
 * of a product lives with that product. It checks the shape only, never the
 * substance (that the argument holds, that a cited path exists at its revision,
 * that "mesuré", "inféré" and "non mesuré" are marked where due).
 *
 * THE FICHE of row N is `<NN>.md` or `<NN>-<slug>.md`, NN the row number on two
 * digits at least (`01`, `12`, `103`). It opens with its fields, in this order,
 * between two `---` lines:
 *
 *   format: 1
 *   ligne: N
 *   verdict: reprendre | adapter | réécrire | exclure   (the matrix verdict of row N)
 *   depot: <one of the target repositories of the map>  (absent for exclure)
 *   source: <copy>@<revision>:<path>[:<line>[-<line>]]  (one or more; or `aucune`,
 *                                                         alone, for réécrire only;
 *                                                         absent for exclure)
 *   decision: D<n> | ADR-<nnnn> | I-<nn>                (exclure only, required)
 *
 * then its `## ` sections, exactly and in this order: one per status column of
 * the matrix (its header text), then `Retenu` and `Test d'acceptation` for a
 * kept row, or `Motif` for an excluded one.
 *
 * THE MAP (JSON) lists the frozen copies and the target repositories:
 *
 *   { "format": 1, "copies": { "<copy>": "<40 lowercase hex>" }, "depots": ["<repo>", ...] }
 *
 * Every `<name>@<ref>:` token of a fiche is a citation, whatever follows the
 * colon, and is allowed only when the map lists that copy at exactly that
 * revision and a bare path follows. Another ref (a branch, a tag, a short or
 * upper-case sha) or a decorated or empty path is counted and refused. A `## `
 * line inside a fenced code block is not a section. A link named as a fiche is
 * never followed: like a directory or a pipe, it is an unreadable source.
 *
 * Usage: bun tools/parity/check-parity-audit.ts --matrix <file> --map <file>
 *          --fiches <directory> [--lines N|A-B]
 * Output: two counter lines on stdout; diagnostics on stderr, one per line.
 * Exit codes: 0 the count holds, 1 gap, 4 malformed fiche (wins over 1),
 * 2 count not reached (usage, unreadable source, range without a row, matrix
 * without a row or with a structure defect, map without a copy), with nothing
 * on stdout.
 */

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MatrixCounts } from "./count-parity-matrix";
import { countMatrix } from "./count-parity-matrix";

const VERDICTS = ["reprendre", "adapter", "réécrire", "exclure"] as const;
type Verdict = (typeof VERDICTS)[number];

const FIELD_ORDER = ["format", "ligne", "verdict", "depot", "source", "decision"] as const;
type Field = (typeof FIELD_ORDER)[number];

const FORMAT_VERSION = "1";
const NO_SOURCE = "aucune";
const KEPT_SECTIONS = ["Retenu", "Test d'acceptation"] as const;
const EXCLUDED_SECTIONS = ["Motif"] as const;

// Same three registers as the matrix counter accepts for an exclusion.
const DECISION_ID = /^(?:D\d+|ADR-\d{4}|I-\d{2})$/;
const COPY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FROZEN_REVISION = /^[0-9a-f]{40}$/;
const FICHE_NAME = /^(\d{2,})(?:-[A-Za-z0-9._-]+)?\.md$/;
// Any `<name>@<ref>:` token is a citation, allowed or not, whatever follows
// the colon: an empty or decorated rest (a quote, a back quote, a space) is
// still a citation, and its path is then judged invalid. The ref class stops
// only at whitespace, `:` and `@`, so a branch, a tag, an upper-case sha or a
// quoted ref is still a token.
const CITATION_TOKEN =
  /(?<![A-Za-z0-9._@-])([A-Za-z0-9][A-Za-z0-9._-]*)@([^\s:@]+):([^\s`'"()<>]*)/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CITED_PATH = /^[^\s:]+(?::(\d+)(?:-(\d+))?)?$/;
const TRAILING_PUNCTUATION = /[.,;!?]+$/;

export interface RepositoryMap {
  /** Frozen copy name -> the one revision at which it may be cited. */
  readonly copies: ReadonlyMap<string, string>;
  /** Target repositories a kept row may name. */
  readonly targets: readonly string[];
}

export type MapResult =
  | { readonly ok: true; readonly map: RepositoryMap }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates the parsed map; a map without a copy allows nothing and is refused. */
export function parseRepositoryMap(value: unknown): MapResult {
  if (!isRecord(value)) return { ok: false, reason: "the map is not a JSON object" };
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "copies,depots,format") {
    return { ok: false, reason: "the map holds exactly format, copies and depots" };
  }
  if (value.format !== 1) return { ok: false, reason: "format: expected 1" };
  if (!isRecord(value.copies)) return { ok: false, reason: "copies: expected an object" };
  const copies = new Map<string, string>();
  for (const [name, revision] of Object.entries(value.copies)) {
    if (!COPY_NAME.test(name)) return { ok: false, reason: `copies: invalid copy name ${name}` };
    if (typeof revision !== "string" || !FROZEN_REVISION.test(revision)) {
      return { ok: false, reason: `copies.${name}: expected 40 lowercase hexadecimal digits` };
    }
    copies.set(name, revision);
  }
  if (copies.size === 0) return { ok: false, reason: "copies: no allowed copy" };
  const depots = value.depots;
  if (
    !Array.isArray(depots) ||
    depots.length === 0 ||
    !depots.every((depot): depot is string => typeof depot === "string" && /^\S+$/.test(depot)) ||
    new Set(depots).size !== depots.length
  ) {
    return { ok: false, reason: "depots: expected a non-empty list of distinct names" };
  }
  return { ok: true, map: { copies, targets: depots } };
}

export interface LineRange {
  readonly from: number;
  readonly to: number;
}

/** `N` or `A-B`, 1-based, A <= B; anything else is null (a usage error). */
export function parseRange(spec: string): LineRange | null {
  const match = /^([1-9]\d*)(?:-([1-9]\d*))?$/.exec(spec);
  if (match === null) return null;
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  return from <= to ? { from, to } : null;
}

export type NameClass =
  | { readonly kind: "ignored" }
  | { readonly kind: "misnamed" }
  | { readonly kind: "named"; readonly line: number };

/** Hidden entries and non-Markdown entries are ignored; a `.md` must be named as a fiche. */
export function classifyName(name: string): NameClass {
  if (name.startsWith(".") || !name.endsWith(".md")) return { kind: "ignored" };
  const digits = FICHE_NAME.exec(name)?.[1];
  if (digits === undefined) return { kind: "misnamed" };
  const line = Number(digits);
  // `001.md` and `00.md` do not name a row on two digits.
  if (line === 0 || String(line).padStart(2, "0") !== digits) return { kind: "misnamed" };
  return { kind: "named", line };
}

interface Citation {
  readonly token: string;
  readonly allowed: boolean;
}

function stripPunctuation(path: string): string {
  return path.replace(TRAILING_PUNCTUATION, "");
}

function isAllowedCitation(map: RepositoryMap, copy: string, ref: string, rest: string): boolean {
  if (map.copies.get(copy) !== ref) return false;
  const path = CITED_PATH.exec(rest);
  if (path === null) return false;
  const first = path[1] === undefined ? null : Number(path[1]);
  const last = path[2] === undefined ? first : Number(path[2]);
  return first === null || (first >= 1 && last !== null && first <= last);
}

/** Every citation token of a text, each judged against the map. */
export function findCitations(map: RepositoryMap, text: string): Citation[] {
  const citations: Citation[] = [];
  for (const match of text.matchAll(CITATION_TOKEN)) {
    const [, copy = "", ref = "", rawRest = ""] = match;
    const rest = stripPunctuation(rawRest);
    citations.push({
      token: `${copy}@${ref}:${rest}`,
      allowed: isAllowedCitation(map, copy, ref, rest),
    });
  }
  return citations;
}

function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value);
}

function isField(value: string): value is Field {
  return (FIELD_ORDER as readonly string[]).includes(value);
}

/**
 * The `## ` titles of a fiche body, outside fenced code blocks: a `## ` line
 * quoted in a code block is not a section. A fence closes on a line of the same
 * character, at least as long, and nothing else (CommonMark).
 */
export function sectionTitles(body: readonly string[]): string[] {
  const titles: string[] = [];
  let open: string | null = null;
  for (const bodyLine of body) {
    const fence = FENCE.exec(bodyLine)?.[1] ?? null;
    if (open === null) {
      if (fence !== null) open = fence;
      else if (bodyLine.startsWith("## ")) titles.push(bodyLine.slice(3).trim());
    } else if (
      fence !== null &&
      fence[0] === open[0] &&
      fence.length >= open.length &&
      bodyLine.trim() === fence
    ) {
      open = null;
    }
  }
  return titles;
}

interface FicheReading {
  readonly defects: readonly string[];
  readonly verdict: string | null;
  readonly hasSource: boolean;
  readonly sourcesAllowed: boolean;
  readonly hasDepot: boolean;
  readonly citations: readonly Citation[];
}

/** Reads one fiche against its row; every shape defect is named. */
export function readFiche(
  text: string,
  line: number,
  matrix: MatrixCounts,
  map: RepositoryMap,
): FicheReading {
  const defects: string[] = [];
  const lines = text.split(/\r?\n/);
  const citations = findCitations(map, text);
  for (const citation of citations) {
    if (!citation.allowed) defects.push(`citation not allowed by the map: ${citation.token}`);
  }

  const closing = lines.indexOf("---", 1);
  if (lines[0] !== "---" || closing === -1) {
    defects.push("the fiche does not open with its fields between two --- lines");
    return {
      defects,
      verdict: null,
      hasSource: false,
      sourcesAllowed: false,
      hasDepot: false,
      citations,
    };
  }

  const values = new Map<Field, string[]>();
  let lastRank = -1;
  for (const fieldLine of lines.slice(1, closing)) {
    const match = /^([a-z_]+): (.+)$/.exec(fieldLine);
    const name = match?.[1] ?? "";
    const value = match?.[2]?.trim() ?? "";
    if (match === null || value === "") {
      defects.push(`field line not of the form "name: value": ${JSON.stringify(fieldLine)}`);
      continue;
    }
    if (!isField(name)) {
      defects.push(`unknown field: ${name}`);
      continue;
    }
    const rank = FIELD_ORDER.indexOf(name);
    if (rank < lastRank || (rank === lastRank && name !== "source")) {
      defects.push(`field out of order or repeated: ${name}`);
    }
    lastRank = Math.max(lastRank, rank);
    values.set(name, [...(values.get(name) ?? []), value]);
  }
  const single = (field: Field): string | null => values.get(field)?.[0] ?? null;

  if (single("format") !== FORMAT_VERSION) defects.push(`format: expected ${FORMAT_VERSION}`);
  if (single("ligne") !== String(line)) defects.push(`ligne: expected ${line}, the file number`);

  const verdict = single("verdict");
  if (verdict === null) defects.push("verdict: missing");
  else if (!isVerdict(verdict)) defects.push(`verdict: unknown value ${verdict}`);

  const excluded = verdict === "exclure";
  const sources = values.get("source") ?? [];
  const depot = single("depot");
  const decision = single("decision");
  let sourcesAllowed = sources.length > 0;
  if (excluded) {
    if (sources.length > 0) defects.push("source: an excluded row has no source");
    if (depot !== null) defects.push("depot: an excluded row has no target repository");
    if (decision === null || !DECISION_ID.test(decision)) {
      defects.push("decision: an excluded row cites D<n>, ADR-<nnnn> or I-<nn>");
    }
  } else {
    if (decision !== null) defects.push("decision: only an excluded row cites a decision");
    if (depot !== null && !map.targets.includes(depot)) {
      defects.push(`depot: ${depot} is not a target repository of the map`);
    }
    for (const source of sources) {
      if (source === NO_SOURCE) {
        if (sources.length !== 1) defects.push(`source: ${NO_SOURCE} stands alone`);
        if (verdict !== "réécrire") defects.push(`source: ${NO_SOURCE} goes with réécrire only`);
        continue;
      }
      const cited = findCitations(map, source);
      const whole = cited.length === 1 && cited[0]?.token === source;
      if (!whole) defects.push(`source: not one citation <copy>@<revision>:<path>: ${source}`);
      if (!whole || cited[0]?.allowed !== true) sourcesAllowed = false;
    }
  }

  const sections = sectionTitles(lines.slice(closing + 1));
  const expected = [
    ...matrix.statusHeaders,
    ...(excluded ? EXCLUDED_SECTIONS : isVerdict(verdict ?? "") ? KEPT_SECTIONS : []),
  ];
  // An unknown verdict leaves the trailing sections undetermined: only the
  // reference sections are then compared, and the verdict is already a defect.
  const compared = isVerdict(verdict ?? "") ? sections : sections.slice(0, expected.length);
  if (compared.join("\n") !== expected.join("\n")) {
    defects.push(`sections: expected ${expected.map((s) => `"${s}"`).join(", ")} in this order`);
  }

  return {
    defects,
    verdict,
    hasSource: !excluded && sources.length > 0,
    sourcesAllowed: !excluded && sourcesAllowed,
    hasDepot: !excluded && depot !== null,
    citations,
  };
}

export interface AuditInput {
  readonly matrix: MatrixCounts;
  readonly map: RepositoryMap;
  readonly range: LineRange | null;
  /** Every entry of the fiche directory. */
  readonly names: readonly string[];
  /** The text of every entry named as a fiche. */
  readonly texts: ReadonlyMap<string, string>;
}

export interface AuditCounts {
  readonly lines: number;
  readonly fiches: number;
  readonly source: number;
  readonly verdict: number;
  readonly depot: number;
  readonly sourceShaAllowed: number;
  readonly excluded: number;
  readonly files: number;
  readonly ignored: number;
  readonly misnamed: number;
  readonly unplaced: number;
  readonly outOfRange: number;
  readonly inRange: number;
  readonly malformed: number;
  readonly citations: number;
  readonly citationsAllowed: number;
  readonly copiesAllowed: number;
  readonly matrixLines: number;
}

export interface AuditReport {
  readonly counts: AuditCounts;
  /** Malformed fiches, one line each: exit 4. */
  readonly defects: readonly string[];
  /** Gaps in the count: exit 1 when no defect. */
  readonly gaps: readonly string[];
}

/** Pure: the whole verdict is a function of the inputs. Assumes a matrix without structure defect. */
export function checkAudit(input: AuditInput): AuditReport {
  const { matrix, map } = input;
  const from = input.range?.from ?? 1;
  const to = Math.min(input.range?.to ?? matrix.rows, matrix.rows);
  const defects: string[] = [];
  const gaps: string[] = [];
  let ignored = 0;
  let misnamed = 0;
  let unplaced = 0;
  let outOfRange = 0;
  let inRange = 0;
  let source = 0;
  let verdict = 0;
  let depot = 0;
  let sourceShaAllowed = 0;
  let excluded = 0;
  let citations = 0;
  let citationsAllowed = 0;
  const malformedFiles = new Set<string>();
  const byLine = new Map<number, string[]>();

  for (const name of [...input.names].sort()) {
    const kind = classifyName(name);
    if (kind.kind === "ignored") {
      ignored += 1;
      continue;
    }
    if (kind.kind === "misnamed") {
      misnamed += 1;
      malformedFiles.add(name);
      defects.push(`${name}: a fiche is named <NN>.md or <NN>-<slug>.md, NN on two digits`);
      continue;
    }
    if (kind.line > matrix.rows) {
      unplaced += 1;
      gaps.push(`${name}: the matrix has no row ${kind.line}`);
      continue;
    }
    if (kind.line < from || kind.line > to) {
      outOfRange += 1;
      continue;
    }
    inRange += 1;
    byLine.set(kind.line, [...(byLine.get(kind.line) ?? []), name]);
    const reading = readFiche(input.texts.get(name) ?? "", kind.line, matrix, map);
    for (const defect of reading.defects) defects.push(`${name}: ${defect}`);
    if (reading.defects.length > 0) malformedFiles.add(name);
    citations += reading.citations.length;
    citationsAllowed += reading.citations.filter((citation) => citation.allowed).length;
    if (reading.verdict === "exclure") excluded += 1;
    if (reading.verdict !== null && reading.verdict === matrix.rowVerdicts[kind.line - 1]) {
      verdict += 1;
    } else if (reading.verdict !== null) {
      gaps.push(
        `${name}: verdict ${reading.verdict}, the matrix says ${matrix.rowVerdicts[kind.line - 1] ?? ""}`,
      );
    }
    if (reading.hasSource) source += 1;
    if (reading.hasDepot) depot += 1;
    if (reading.sourcesAllowed) sourceShaAllowed += 1;
    if (reading.verdict !== "exclure" && !reading.hasSource) gaps.push(`${name}: no source`);
    if (reading.verdict !== "exclure" && !reading.hasDepot) gaps.push(`${name}: no depot`);
  }

  for (const [line, names] of byLine) {
    if (names.length > 1) {
      for (const name of names) malformedFiles.add(name);
      defects.push(`line ${line}: ${names.length} fiches (${names.join(", ")})`);
    }
  }
  const missing: number[] = [];
  for (let line = from; line <= to; line += 1) if (!byLine.has(line)) missing.push(line);
  if (missing.length > 0) gaps.push(`missing fiche for line(s) ${missing.join(", ")}`);

  return {
    counts: {
      lines: Math.max(0, to - from + 1),
      fiches: byLine.size,
      source,
      verdict,
      depot,
      sourceShaAllowed,
      excluded,
      files: input.names.length,
      ignored,
      misnamed,
      unplaced,
      outOfRange,
      inRange,
      malformed: malformedFiles.size,
      citations,
      citationsAllowed,
      copiesAllowed: map.copies.size,
      matrixLines: matrix.rows,
    },
    defects,
    gaps,
  };
}

/** The two counter lines. */
export function renderCounts(counts: AuditCounts): string {
  return [
    `lines=${counts.lines} fiches=${counts.fiches} source=${counts.source} verdict=${counts.verdict} depot=${counts.depot} source_sha_allowed=${counts.sourceShaAllowed} excluded=${counts.excluded}`,
    `examined: files=${counts.files} ignored=${counts.ignored} misnamed=${counts.misnamed} unplaced=${counts.unplaced} out_of_range=${counts.outOfRange} in_range=${counts.inRange} malformed=${counts.malformed} citations=${counts.citations} citations_allowed=${counts.citationsAllowed} copies_allowed=${counts.copiesAllowed} matrix_lines=${counts.matrixLines}`,
  ].join("\n");
}

/** True when every row in range is argued once, in agreement with the matrix. */
export function countHolds(counts: AuditCounts): boolean {
  return (
    counts.fiches === counts.lines &&
    counts.verdict === counts.fiches &&
    counts.source + counts.excluded === counts.fiches &&
    counts.depot === counts.source &&
    counts.sourceShaAllowed === counts.source &&
    counts.citationsAllowed === counts.citations &&
    counts.unplaced === 0
  );
}

/** 4 wins over 1: a malformed fiche makes its counters meaningless. */
export function exitCode(report: AuditReport): 0 | 1 | 4 {
  if (report.defects.length > 0 || report.counts.malformed > 0) return 4;
  // The gaps only name what the counters already show: the count decides.
  return countHolds(report.counts) ? 0 : 1;
}

const USAGE =
  "usage: bun tools/parity/check-parity-audit.ts --matrix <file> --map <file> --fiches <directory> [--lines N|A-B]";

export interface Options {
  readonly matrix: string;
  readonly map: string;
  readonly fiches: string;
  readonly lines: string | null;
}

/** Each option once, with a value; anything else is a usage error. */
export function parseArguments(args: readonly string[]): Options | null {
  const seen = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] ?? "";
    const value = args[index + 1];
    if (!["--matrix", "--map", "--fiches", "--lines"].includes(flag)) return null;
    if (value === undefined || seen.has(flag)) return null;
    seen.set(flag, value);
  }
  const matrix = seen.get("--matrix");
  const map = seen.get("--map");
  const fiches = seen.get("--fiches");
  if (matrix === undefined || map === undefined || fiches === undefined) return null;
  return { matrix, map, fiches, lines: seen.get("--lines") ?? null };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Exit 2 with nothing on stdout: the count was not reached. */
function unreached(message: string): never {
  console.error(message);
  process.exit(2);
}

function main(args: readonly string[]): never {
  const options = parseArguments(args);
  if (options === null) unreached(USAGE);

  let matrixText: string;
  try {
    matrixText = readFileSync(options.matrix, "utf8");
  } catch (error) {
    unreached(`cannot read the matrix: ${reason(error)}`);
  }
  const matrix = countMatrix(matrixText);
  if (matrix.structure.length > 0) {
    for (const violation of matrix.structure) console.error(`matrix: ${violation}`);
    unreached("the matrix has a structure defect: count-parity-matrix.ts names it");
  }

  let mapValue: unknown;
  try {
    mapValue = JSON.parse(readFileSync(options.map, "utf8"));
  } catch (error) {
    unreached(`cannot read the map: ${reason(error)}`);
  }
  const map = parseRepositoryMap(mapValue);
  if (!map.ok) unreached(`map: ${map.reason}`);

  let range: LineRange | null = null;
  if (options.lines !== null) {
    range = parseRange(options.lines);
    if (range === null) unreached(`--lines: expected N or A-B with A <= B, got ${options.lines}`);
    if (range.from > matrix.rows) unreached(`--lines: no matrix row in ${options.lines}`);
  }

  let names: string[];
  try {
    names = readdirSync(options.fiches);
  } catch (error) {
    unreached(`cannot read the fiche directory: ${reason(error)}`);
  }
  const texts = new Map<string, string>();
  for (const name of names) {
    if (classifyName(name).kind !== "named") continue;
    const path = join(options.fiches, name);
    // A link (broken or not), a directory or a pipe named as a fiche is an
    // unreadable source, never an empty one: reading it as nothing would hide a
    // missing argument, and following a link would count a fiche the audited
    // directory does not hold. `lstatSync` does not follow the link.
    try {
      if (!lstatSync(path).isFile()) unreached(`${name}: named as a fiche, not a regular file`);
      texts.set(name, readFileSync(path, "utf8"));
    } catch (error) {
      unreached(`${name}: cannot read the fiche: ${reason(error)}`);
    }
  }

  const report = checkAudit({ matrix, map: map.map, range, names, texts });
  console.log(renderCounts(report.counts));
  for (const defect of report.defects) console.error(`malformed: ${defect}`);
  for (const gap of report.gaps) console.error(`gap: ${gap}`);
  process.exit(exitCode(report));
}

if (import.meta.main) main(process.argv.slice(2));
