/**
 * Every threat of the threat model names evidence that exists, or a residual.
 *
 * WHY. `docs/security/THREAT-MODEL.md` writes a control in prose next to every
 * threat, and `check-threat-model-citations.ts` checks that the invariant cited
 * beside it is a live row of the register. Nothing read the control itself: a
 * cell could name a mechanism that no file of any repository holds, and no gate
 * turned red. The ledger `docs/security/THREAT-EVIDENCE.md` names, per threat,
 * the files and the named tests that hold the control, or says `residual:` with
 * a reason; a second table does the same for ten agentic risks and their
 * barriers. This tool reads the model and the ledger and checks that what is
 * named exists.
 *
 * WHAT IT ASSERTS:
 *   - every threat row of the model section "STRIDE + LINDDUN per surface" has
 *     one ledger row under the id of its surface, joined on the exact text of
 *     the threat cell; a threat without a row is unmapped, a row without a
 *     threat is an orphan, so a threat reworded, added or removed without its
 *     row turns red instead of staying silent;
 *   - every piece of evidence is a tracked, regular, non-empty file of this
 *     repository, or a regular file at a commit pinned by its full sha in a
 *     clone supplied on the command line — a link is never followed, and no
 *     network is ever read;
 *   - a named test is a `test("<name>"` or `it("<name>"` call written outside
 *     comments and without a modifier (TypeScript), or a `fn <name>` under
 *     `#[test]` and under no attribute mentioning `ignore`, `cfg_attr`
 *     included (Rust);
 *   - an agentic risk has a barrier that is not a document, and a risk that
 *     claims `refusal before execution` holds at least one named test (so its
 *     Barrier is never `residual:`); its Detection is judged in every case, a
 *     residual barrier included.
 *
 * WHAT IT DOES NOT ASSERT: that the evidence covers the threat, nor that the
 * test is green. Existence only — relevance stays a review matter, the same
 * position as the citations gate. Not read either: a `describe.skip` around a
 * test, a test name built at run time (`test.each`, an interpolated template),
 * and a call written inside the `${…}` of a template literal that itself holds
 * a backtick. In Rust, a `#[test]` inside a module that is never compiled
 * (`#[cfg(any())]`, or any `cfg` that is false on the runner) is read as found:
 * only the attributes of the function itself are read, not those of its
 * enclosing modules.
 *
 * Counters sum to what is covered: threats = mitigated + residual + unmapped,
 * risks = barred + residual + red, cited = found + missing + unavailable +
 * unreadable.
 *
 * Usage: bun tools/quality/check-threat-model-evidence.ts [<owner>/<repository>=<directory> …]
 * Exit:  0 nothing to report; 1 an unmapped threat, an orphan row or a red
 *        risk; 2 usage, or the model or the ledger cannot be read; 3 the only
 *        causes are pieces of evidence in repositories that were not supplied;
 *        4 the model or the ledger is malformed (nothing is judged).
 */

import { lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalRepository,
  HARDENING_FLAGS,
  hardenedGitEnvironment,
  validateCitedPath,
} from "./check-pinned-citations";

export const MODEL_PATH = "docs/security/THREAT-MODEL.md";
export const LEDGER_PATH = "docs/security/THREAT-EVIDENCE.md";

const MODEL_SECTION = "## STRIDE + LINDDUN per surface";
const THREATS_SECTION = "## Threat evidence";
const RISKS_SECTION = "## Agentic risks";
const CRITERIA = ["refusal before execution", "detection or judgment"] as const;

export type Criterion = (typeof CRITERIA)[number];

// ----------------------------------------------------------------- tables ---

/** The cells of a markdown table row, or null when the line is not one. */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const closed = trimmed.length > 1 && trimmed.endsWith("|") && !trimmed.endsWith("\\|");
  const inner = closed ? trimmed.slice(1, -1) : trimmed.slice(1);
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll("\\|", "|"));
}

function isSeparator(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

/** A heading that closes a `##` section: another `##`, or a `#`. */
function closesSection(line: string): boolean {
  return /^##? /.test(line);
}

// ------------------------------------------------------------------ model ---

export interface ModelSurface {
  /** 1-based rank of the `###` heading inside the section: the `k` of `T-S<k>-<nn>`. */
  readonly rank: number;
  readonly title: string;
  readonly threats: readonly string[];
}

export interface ParsedModel {
  readonly surfaces: readonly ModelSurface[];
  readonly defects: readonly string[];
}

/**
 * The surfaces of the model, in document order, each with the first cell of its
 * threat rows. The titles are read, never written in this code: a surface
 * added to the model shifts nothing here.
 */
export function parseModelThreats(text: string): ParsedModel {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === MODEL_SECTION);
  if (start === -1) {
    return { surfaces: [], defects: [`the model has no "${MODEL_SECTION}" section`] };
  }
  const surfaces: { rank: number; title: string; threats: string[] }[] = [];
  const defects: string[] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (closesSection(line)) break;
    const heading = /^### +(.+?)\s*$/.exec(line);
    if (heading !== null) {
      surfaces.push({ rank: surfaces.length + 1, title: heading[1] ?? "", threats: [] });
      inTable = false;
      continue;
    }
    const cells = splitRow(line);
    if (cells === null) {
      inTable = false;
      continue;
    }
    // The first row of a table is its header.
    const header = !inTable;
    inTable = true;
    const surface = surfaces.at(-1);
    // A table written before the first surface belongs to none: no id can name it.
    if (header || isSeparator(cells) || surface === undefined) continue;
    const threat = cells[0] ?? "";
    if (surface.threats.includes(threat)) {
      defects.push(
        `the model lists "${threat}" twice under "${surface.title}": the join on the threat text is ambiguous`,
      );
      continue;
    }
    surface.threats.push(threat);
  }
  if (surfaces.every((surface) => surface.threats.length === 0)) {
    defects.push(`the model section "${MODEL_SECTION}" holds no threat row`);
  }
  return { surfaces, defects };
}

// ----------------------------------------------------------------- ledger ---

export interface ThreatRow {
  readonly id: string;
  readonly surface: number;
  readonly threat: string;
  readonly evidence: string;
  /** 1-based line of the ledger. */
  readonly line: number;
}

export interface RiskRow {
  readonly id: string;
  readonly risk: string;
  readonly barrier: string;
  readonly detection: string;
  readonly criterion: Criterion;
  readonly line: number;
}

export interface ParsedLedger {
  readonly threats: readonly ThreatRow[];
  readonly risks: readonly RiskRow[];
  readonly defects: readonly string[];
}

interface TableRow {
  readonly cells: readonly string[];
  readonly line: number;
}

/** The data rows of the table under `title`; shape defects are pushed, never thrown. */
function sectionRows(
  lines: readonly string[],
  title: string,
  width: number,
  defects: string[],
): TableRow[] {
  const start = lines.findIndex((line) => line.trim() === title);
  if (start === -1) {
    defects.push(`the ledger has no "${title}" section`);
    return [];
  }
  const rows: TableRow[] = [];
  let tableLines = 0;
  let dataLines = 0;
  for (let index = start + 1; index < lines.length; index += 1) {
    const text = lines[index] ?? "";
    if (closesSection(text)) break;
    const cells = splitRow(text);
    if (cells === null) continue;
    tableLines += 1;
    const header = tableLines === 1;
    const separator = isSeparator(cells);
    if (!header && !separator) dataLines += 1;
    if (cells.length !== width) {
      defects.push(
        `line ${index + 1}: ${cells.length} cell(s), the "${title}" table has ${width} columns`,
      );
      continue;
    }
    if (!header && !separator) rows.push({ cells, line: index + 1 });
  }
  if (dataLines === 0) defects.push(`the "${title}" table has no row`);
  return rows;
}

const THREAT_ID = /^T-S([1-9]\d*)-\d{2}$/;
const RISK_ID = /^AR-\d{2}$/;

function isCriterion(value: string): value is Criterion {
  return (CRITERIA as readonly string[]).includes(value);
}

/** The rows of the two tables of the ledger, with every defect of form and its line. */
export function parseLedger(text: string): ParsedLedger {
  const lines = text.split("\n");
  const defects: string[] = [];
  const threats: ThreatRow[] = [];
  const risks: RiskRow[] = [];
  const seen = new Set<string>();
  const unique = (id: string, line: number): boolean => {
    if (seen.has(id)) {
      defects.push(
        `line ${line}: id ${id} is used twice — an id names one row, and is never reassigned`,
      );
      return false;
    }
    seen.add(id);
    return true;
  };

  for (const { cells, line } of sectionRows(lines, THREATS_SECTION, 3, defects)) {
    const [id = "", threat = "", evidence = ""] = cells;
    const match = THREAT_ID.exec(id);
    if (match === null) {
      defects.push(`line ${line}: id "${id}" is not T-S<k>-<nn>`);
      continue;
    }
    if (!unique(id, line)) continue;
    if (threat.length === 0) {
      defects.push(`line ${line}: ${id} has an empty Threat cell`);
      continue;
    }
    threats.push({ id, surface: Number(match[1]), threat, evidence, line });
  }

  for (const { cells, line } of sectionRows(lines, RISKS_SECTION, 5, defects)) {
    const [id = "", risk = "", barrier = "", detection = "", criterion = ""] = cells;
    if (!RISK_ID.test(id)) {
      defects.push(`line ${line}: id "${id}" is not AR-<nn>`);
      continue;
    }
    if (!unique(id, line)) continue;
    if (risk.length === 0) {
      defects.push(`line ${line}: ${id} has an empty Risk cell`);
      continue;
    }
    if (!isCriterion(criterion)) {
      defects.push(
        `line ${line}: ${id} has Criterion "${criterion}", expected one of: ${CRITERIA.join(" ; ")}`,
      );
      continue;
    }
    risks.push({ id, risk, barrier, detection, criterion, line });
  }
  return { threats, risks, defects };
}

// --------------------------------------------------------------- evidence ---

export type EvidenceTarget =
  | { readonly kind: "local"; readonly path: string }
  | {
      readonly kind: "pinned";
      readonly owner: string;
      readonly repository: string;
      readonly sha: string;
      readonly path: string;
    };

export interface EvidenceItem {
  /** The target as written, between its backticks. */
  readonly text: string;
  readonly target: EvidenceTarget;
  /** The named test, or null when the evidence is the file itself. */
  readonly test: string | null;
}

export type EvidenceCell =
  | { readonly kind: "residual"; readonly reason: string }
  | { readonly kind: "evidence"; readonly items: readonly EvidenceItem[] }
  | { readonly kind: "invalid"; readonly reason: string };

/** `<owner>/<repository>@<full sha>:<path>`: the pinned form the repository already cites by. */
const PINNED_TARGET =
  /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)@([0-9a-f]{40}):(.+)$/;
/**
 * One piece of evidence and what ends it. The whitespace before `::` is
 * required: glued to a pinned target, the test name would be read by the
 * pinned-citations gate as part of the citation, and refused there.
 */
const EVIDENCE_ITEM = /\s*`([^`]+)`(?:\s+::\s+`([^`]+)`)?\s*(,|$)/y;

function parseTarget(raw: string): EvidenceTarget | { readonly reason: string } {
  if (/\s/.test(raw)) return { reason: "a target carries no whitespace" };
  const pinned = PINNED_TARGET.exec(raw);
  if (pinned === null) {
    if (raw.includes("@") && raw.includes(":")) {
      return {
        reason: "a pinned target is <owner>/<repository>@<40 lowercase hex>:<path>, in full",
      };
    }
    const invalid = validateCitedPath(raw);
    return invalid === null ? { kind: "local", path: raw } : { reason: invalid };
  }
  const [, owner = "", repository = "", sha = "", path = ""] = pinned;
  if (repository === "." || repository === "..") {
    return { reason: `'${repository}' is not a repository name` };
  }
  const invalid = validateCitedPath(path);
  if (invalid !== null) return { reason: invalid };
  return { kind: "pinned", owner, repository, sha, path };
}

/** An Evidence, Barrier or Detection cell, judged in full: nothing is read around the code spans. */
export function parseEvidenceCell(cell: string): EvidenceCell {
  const text = cell.trim();
  if (text.length === 0) return { kind: "invalid", reason: "the cell is empty" };
  if (text.startsWith("residual:")) {
    const reason = text.slice("residual:".length).trim();
    return reason.length > 0
      ? { kind: "residual", reason }
      : { kind: "invalid", reason: "`residual:` carries no reason" };
  }
  const items: EvidenceItem[] = [];
  let at = 0;
  for (;;) {
    EVIDENCE_ITEM.lastIndex = at;
    const match = EVIDENCE_ITEM.exec(text);
    if (match === null) {
      return {
        kind: "invalid",
        reason: `text outside the code spans at column ${at + 1}: evidence is \`target\` or \`target\` :: \`test name\`, separated by commas`,
      };
    }
    const written = match[1] ?? "";
    const target = parseTarget(written);
    if ("reason" in target) return { kind: "invalid", reason: `${written}: ${target.reason}` };
    items.push({ text: written, target, test: match[2] ?? null });
    at = EVIDENCE_ITEM.lastIndex;
    if (match[3] === "") return { kind: "evidence", items };
  }
}

// ------------------------------------------------------------ named tests ---

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;
/** After one of these, a `/` opens a regular expression; after anything else it divides. */
const BEFORE_REGEX = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "+", "-"]);
/** Keywords an expression follows: a `/` after one opens a regular expression, as after `(`. */
const BEFORE_REGEX_WORDS: ReadonlySet<string> = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "await",
  "yield",
]);

/** The index after the string literal opening at `from`; a quote left open ends at the line. */
function skipString(source: string, from: number): number {
  const quote = source.charAt(from);
  let index = from + 1;
  while (index < source.length) {
    const character = source.charAt(index);
    if (character === "\\") index += 2;
    else if (character === quote) return index + 1;
    else if (character === "\n" && quote !== "`") return index;
    else index += 1;
  }
  return source.length;
}

/** The index after the regular expression opening at `from`, or `from + 1` when it is not one. */
function skipRegex(source: string, from: number): number {
  let inClass = false;
  for (let index = from + 1; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (character === "\n") break;
    if (character === "\\") index += 1;
    else if (character === "[") inClass = true;
    else if (character === "]") inClass = false;
    else if (character === "/" && !inClass) return index + 1;
  }
  return from + 1;
}

/**
 * A walk, not a pattern: a pattern cannot tell a call from the same text in a
 * comment or in a string, and this repository's test files are full of both.
 */
function findTypeScriptTest(source: string, name: string): boolean {
  let index = 0;
  let previous = "";
  while (index < source.length) {
    const character = source.charAt(index);
    const pair = source.slice(index, index + 2);
    if (pair === "//") {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
    } else if (pair === "/*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else if (character === '"' || character === "'" || character === "`") {
      index = skipString(source, index);
      previous = character;
    } else if (character === "/" && BEFORE_REGEX.has(previous)) {
      index = skipRegex(source, index);
      previous = "/";
    } else if (IDENTIFIER_START.test(character)) {
      let end = index + 1;
      while (end < source.length && IDENTIFIER_PART.test(source.charAt(end))) end += 1;
      const word = source.slice(index, end);
      // `x.test(` is a method, `test.skip(` and its kin are followed by `.`, not `(`.
      if ((word === "test" || word === "it") && previous !== ".") {
        let at = end;
        while (/\s/.test(source.charAt(at))) at += 1;
        if (source.charAt(at) === "(") {
          at += 1;
          while (/\s/.test(source.charAt(at))) at += 1;
          const quote = source.charAt(at);
          if (quote === '"' || quote === "'" || quote === "`") {
            const literal = source.slice(at + 1, skipString(source, at) - 1);
            if (literal.replace(/\\(.)/g, "$1") === name) return true;
          }
        }
      }
      // After `.` the word is a property (`range.of / 2`), never a keyword.
      previous = BEFORE_REGEX_WORDS.has(word) && previous !== "." ? "" : "a";
      index = end;
    } else {
      if (!/\s/.test(character)) previous = character;
      index += 1;
    }
  }
  return false;
}

/** Rust source with comments and the contents of string and character literals blanked. */
function blankRust(source: string): string {
  let out = "";
  let index = 0;
  const blank = (to: number): void => {
    out += source.slice(index, to).replace(/[^\n]/g, " ");
    index = to;
  };
  while (index < source.length) {
    const character = source.charAt(index);
    const pair = source.slice(index, index + 2);
    if (pair === "//") {
      const end = source.indexOf("\n", index);
      blank(end === -1 ? source.length : end);
    } else if (pair === "/*") {
      // Rust block comments nest.
      let depth = 1;
      let at = index + 2;
      while (at < source.length && depth > 0) {
        const inner = source.slice(at, at + 2);
        if (inner === "/*") {
          depth += 1;
          at += 2;
        } else if (inner === "*/") {
          depth -= 1;
          at += 2;
        } else at += 1;
      }
      blank(at);
    } else if (character === "r" && /^r#*"/.test(source.slice(index, index + 80))) {
      const hashes = (/^r(#*)"/.exec(source.slice(index, index + 80))?.[1] ?? "").length;
      const end = source.indexOf(`"${"#".repeat(hashes)}`, index + hashes + 2);
      blank(end === -1 ? source.length : end + hashes + 1);
    } else if (character === '"') {
      blank(skipString(source, index));
    } else if (character === "'") {
      // A character literal ('x', '\n', '"') — a lifetime ('a) has no closing quote.
      const literal = /^'(?:\\[^']*|[^'\\])'/.exec(source.slice(index, index + 12));
      if (literal === null) {
        out += character;
        index += 1;
      } else blank(index + literal[0].length);
    } else {
      out += character;
      index += 1;
    }
  }
  return out;
}

function findRustTest(source: string, name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  const code = blankRust(source);
  for (const match of code.matchAll(new RegExp(`\\bfn\\s+${name}\\b`, "g"))) {
    // The attribute block sits right above the function: a bounded tail is enough.
    let head = code.slice(Math.max(0, match.index - 4000), match.index).trimEnd();
    for (;;) {
      const qualifier = /(?:\bpub(?:\s*\([^)]*\))?|\basync|\bconst|\bunsafe)$/.exec(head);
      if (qualifier === null) break;
      head = head.slice(0, qualifier.index).trimEnd();
    }
    const attributes: string[] = [];
    for (;;) {
      const attribute = /#\[([^[\]]*)\]$/.exec(head);
      if (attribute === null) break;
      attributes.push((attribute[1] ?? "").trim());
      head = head.slice(0, attribute.index).trimEnd();
    }
    // `#[ignore]`, `#[ignore = "…"]` and a conditional `#[cfg_attr(…, ignore)]` alike: any
    // attribute that mentions `ignore` is read as ignoring, the safe side of the doubt.
    const ignored = attributes.some((attribute) => attribute.includes("ignore"));
    if (attributes.includes("test") && !ignored) return true;
  }
  return false;
}

/** Whether `source` holds a test named `name` that a runner would run. */
export function findNamedTest(source: string, extension: "ts" | "rs", name: string): boolean {
  return extension === "ts" ? findTypeScriptTest(source, name) : findRustTest(source, name);
}

// ---------------------------------------------------------------- verdict ---

export type Resolved =
  | { readonly state: "found"; readonly text: string }
  | { readonly state: "missing" | "unavailable" | "unreadable"; readonly reason: string };

export interface EvidenceInput {
  readonly model: string;
  readonly ledger: string;
  /** The effectful half: what a target is, read by `loadResolver` or stubbed by a test. */
  readonly resolve: (target: EvidenceTarget) => Resolved;
}

export interface SurfaceCount {
  readonly rank: number;
  readonly title: string;
  readonly threats: number;
  readonly mitigated: number;
  readonly residual: number;
  readonly unmapped: number;
}

export interface EvidenceOutcome {
  readonly defects: readonly string[];
  readonly surfaces: readonly SurfaceCount[];
  readonly evidence: {
    readonly cited: number;
    readonly found: number;
    readonly missing: number;
    readonly unavailable: number;
    readonly unreadable: number;
  };
  readonly threats: {
    readonly total: number;
    readonly mitigated: number;
    readonly residual: number;
    readonly unmapped: number;
    readonly orphans: number;
  };
  readonly risks: {
    readonly total: number;
    readonly barred: number;
    readonly residual: number;
    readonly red: number;
  };
  /** What the command prints, in order. */
  readonly lines: readonly string[];
  readonly exitCode: 0 | 1 | 3 | 4;
}

/** Why a row is not green: nothing, only evidence that could not be reached, or anything else. */
type Cause = "none" | "unavailable" | "hard";

function worse(left: Cause, right: Cause): Cause {
  if (left === "hard" || right === "hard") return "hard";
  return left === "unavailable" || right === "unavailable" ? "unavailable" : "none";
}

type ItemState = Resolved["state"];

function judgeItem(
  item: EvidenceItem,
  resolve: EvidenceInput["resolve"],
): { readonly state: ItemState; readonly reason: string } {
  const extension = /\.(ts|rs)$/.exec(item.target.path)?.[1];
  if (item.test !== null && extension === undefined) {
    return {
      state: "missing",
      reason: "extension not recognised: a named test is read in .ts and .rs files only",
    };
  }
  const resolved = resolve(item.target);
  if (resolved.state !== "found") return resolved;
  if (
    item.test !== null &&
    !findNamedTest(resolved.text, extension === "rs" ? "rs" : "ts", item.test)
  ) {
    return {
      state: "missing",
      reason: `no test named "${item.test}" that a runner would run (absent, commented out, skipped or ignored)`,
    };
  }
  return { state: "found", reason: "" };
}

/** Pure verdict over texts already read: every rule is testable without a filesystem. */
export function evaluateEvidence(input: EvidenceInput): EvidenceOutcome {
  const model = parseModelThreats(input.model);
  const ledger = parseLedger(input.ledger);
  const defects = [...model.defects, ...ledger.defects];
  for (const row of ledger.threats) {
    if (row.surface > model.surfaces.length) {
      defects.push(
        `line ${row.line}: ${row.id} names surface ${row.surface}, the model has ${model.surfaces.length}`,
      );
    }
  }
  const evidence = { cited: 0, found: 0, missing: 0, unavailable: 0, unreadable: 0 };
  const threats = { total: 0, mitigated: 0, residual: 0, unmapped: 0, orphans: 0 };
  const risks = { total: 0, barred: 0, residual: 0, red: 0 };
  if (defects.length > 0) {
    return {
      defects,
      surfaces: [],
      evidence,
      threats,
      risks,
      lines: [
        ...defects.map((defect) => `malformed: ${defect}`),
        `malformed=${defects.length}: nothing was judged`,
      ],
      exitCode: 4,
    };
  }

  const lines: string[] = [];
  let verdict: Cause = "none";

  /** Judges the items of one cell, counts them, prints the ones not found. */
  const judgeItems = (
    id: string,
    items: readonly EvidenceItem[],
  ): { readonly cause: Cause; readonly states: readonly ItemState[] } => {
    let cause: Cause = "none";
    const states: ItemState[] = [];
    for (const item of items) {
      const judged = judgeItem(item, input.resolve);
      states.push(judged.state);
      evidence.cited += 1;
      evidence[judged.state] += 1;
      if (judged.state === "found") continue;
      cause = worse(cause, judged.state === "unavailable" ? "unavailable" : "hard");
      const named = item.test === null ? "" : ` :: ${item.test}`;
      lines.push(`${id}: ${item.text}${named}: ${judged.state} — ${judged.reason}`);
    }
    return { cause, states };
  };

  const surfaces: SurfaceCount[] = [];
  const matched = new Set<ThreatRow>();
  for (const surface of model.surfaces) {
    const count = { mitigated: 0, residual: 0, unmapped: 0 };
    for (const threat of surface.threats) {
      const row = ledger.threats.find(
        (candidate) => candidate.surface === surface.rank && candidate.threat === threat,
      );
      if (row === undefined) {
        count.unmapped += 1;
        verdict = "hard";
        lines.push(`S${surface.rank} "${threat}": unmapped — no ledger row carries this threat`);
        continue;
      }
      matched.add(row);
      const cell = parseEvidenceCell(row.evidence);
      if (cell.kind === "residual") {
        count.residual += 1;
      } else if (cell.kind === "invalid") {
        count.unmapped += 1;
        verdict = "hard";
        lines.push(`${row.id}: unmapped — ${cell.reason}`);
      } else {
        const { cause } = judgeItems(row.id, cell.items);
        verdict = worse(verdict, cause);
        if (cause === "none") count.mitigated += 1;
        else count.unmapped += 1;
      }
    }
    surfaces.push({
      rank: surface.rank,
      title: surface.title,
      threats: surface.threats.length,
      ...count,
    });
    threats.total += surface.threats.length;
    threats.mitigated += count.mitigated;
    threats.residual += count.residual;
    threats.unmapped += count.unmapped;
  }
  for (const row of ledger.threats) {
    if (matched.has(row)) continue;
    threats.orphans += 1;
    verdict = "hard";
    const title = model.surfaces[row.surface - 1]?.title ?? "";
    lines.push(
      `${row.id}: orphan — "${row.threat}" is not a threat of surface ${row.surface} ("${title}") that no other row carries`,
    );
  }

  for (const row of ledger.risks) {
    risks.total += 1;
    const barrier = parseEvidenceCell(row.barrier);
    const detection = parseEvidenceCell(row.detection);
    let cause: Cause = "none";
    const refuse = (reason: string): void => {
      cause = "hard";
      lines.push(`${row.id}: red — ${reason}`);
    };
    if (barrier.kind === "residual") {
      // A residual barrier is no refusal: the claim needs a named test among the barriers.
      if (row.criterion === "refusal before execution") {
        refuse("`refusal before execution` needs a barrier that is a named test, not `residual:`");
      }
    } else if (barrier.kind === "invalid") {
      refuse(`Barrier: ${barrier.reason}`);
    } else {
      const judged = judgeItems(row.id, barrier.items);
      cause = worse(cause, judged.cause);
      for (const item of barrier.items) {
        if (item.target.path.endsWith(".md")) {
          refuse(`Barrier ${item.text}: a document is an inventory, not a barrier`);
        }
      }
      const namedTests = barrier.items.filter((item) => item.test !== null);
      if (row.criterion === "refusal before execution" && namedTests.length === 0) {
        refuse("`refusal before execution` needs a barrier that is a named test");
      }
    }
    if (detection.kind === "invalid") {
      refuse(`Detection: ${detection.reason}`);
    } else if (detection.kind === "evidence") {
      // Judged whatever the barrier, a residual one included: a dangling detection is red.
      cause = worse(cause, judgeItems(row.id, detection.items).cause);
    }
    verdict = worse(verdict, cause);
    if (cause !== "none") risks.red += 1;
    else if (barrier.kind === "residual") risks.residual += 1;
    else risks.barred += 1;
  }

  for (const surface of surfaces) {
    lines.push(
      `surface S${surface.rank} "${surface.title}": threats=${surface.threats} mitigated=${surface.mitigated} residual=${surface.residual} unmapped=${surface.unmapped}`,
    );
  }
  lines.push(
    `evidence: cited=${evidence.cited} found=${evidence.found} missing=${evidence.missing} unavailable=${evidence.unavailable} unreadable=${evidence.unreadable}`,
    `threats=${threats.total} mitigated=${threats.mitigated} residual=${threats.residual} unmapped=${threats.unmapped} orphans=${threats.orphans}`,
    `risks=${risks.total} barred=${risks.barred} residual=${risks.residual} red=${risks.red}`,
  );
  const exitCode = verdict === "hard" ? 1 : verdict === "unavailable" ? 3 : 0;
  return { defects, surfaces, evidence, threats, risks, lines, exitCode };
}

// ---------------------------------------------------------------- effects ---

function siblingKey(owner: string, repository: string): string {
  return `${owner.toLowerCase()}/${canonicalRepository(repository)}`;
}

function targetKey(target: EvidenceTarget): string {
  return target.kind === "local"
    ? `local\u0000${target.path}`
    : `${siblingKey(target.owner, target.repository)}\u0000${target.sha}\u0000${target.path}`;
}

/** The text of a file, or why it could not be read. */
async function readText(path: string): Promise<string | { readonly reason: string }> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { reason: "the file does not exist" };
  try {
    return await file.text();
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
}

function lastLine(text: string): string {
  return text.trim().split("\n").at(-1) ?? "";
}

const REGULAR_MODES: ReadonlySet<string> = new Set(["100644", "100755"]);

/**
 * The effectful half. Reads the ledger of `root`, resolves every target it
 * cites once, and returns the lookup `evaluateEvidence` takes: local targets
 * against the index of `root` (`git ls-files -s`, so a link is seen as a link
 * and never followed), pinned targets against the object database of the
 * directory supplied for their repository. Git runs hardened and offline: no
 * configuration, no hook, no lazy fetch of a missing object.
 */
export async function loadResolver(
  root: string,
  siblings: ReadonlyMap<string, string>,
): Promise<EvidenceInput["resolve"]> {
  const environment = { ...hardenedGitEnvironment(root, "none"), GIT_NO_LAZY_FETCH: "1" };
  const git = async (
    directory: string,
    args: readonly string[],
  ): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> => {
    const proc = Bun.spawn(["git", ...HARDENING_FLAGS, "-C", directory, ...args], {
      env: environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  };

  const index = await git(root, ["ls-files", "-s", "-z"]);
  const modes = new Map<string, string>();
  for (const entry of index.stdout.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab !== -1) modes.set(entry.slice(tab + 1), entry.slice(0, 6));
  }

  const resolveLocal = async (path: string): Promise<Resolved> => {
    if (index.code !== 0) {
      return { state: "unreadable", reason: `git ls-files failed: ${lastLine(index.stderr)}` };
    }
    const mode = modes.get(path);
    if (mode === undefined) return { state: "missing", reason: "not a file tracked by git" };
    if (!REGULAR_MODES.has(mode)) {
      return {
        state: "missing",
        reason: `tracked with mode ${mode}, not a regular file — a link is never followed`,
      };
    }
    try {
      const stat = await lstat(join(root, path));
      if (!stat.isFile()) {
        return { state: "missing", reason: "not a regular file in the working tree" };
      }
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      return code === "ENOENT"
        ? { state: "missing", reason: "tracked, but absent from the working tree" }
        : { state: "unreadable", reason: error instanceof Error ? error.message : String(error) };
    }
    const text = await readText(join(root, path));
    if (typeof text !== "string") return { state: "unreadable", reason: text.reason };
    if (text.length === 0) return { state: "missing", reason: "the file is empty" };
    return { state: "found", text };
  };

  const resolvePinned = async (
    target: Extract<EvidenceTarget, { kind: "pinned" }>,
  ): Promise<Resolved> => {
    const name = `${target.owner}/${target.repository}`;
    const directory = siblings.get(siblingKey(target.owner, target.repository));
    if (directory === undefined) {
      return {
        state: "unavailable",
        reason: `${name} was not supplied (${name}=<directory>)`,
      };
    }
    const commit = await git(directory, ["cat-file", "-e", `${target.sha}^{commit}`]);
    if (commit.code !== 0) {
      return {
        state: "unavailable",
        reason: `commit ${target.sha} is not in the clone supplied for ${name}`,
      };
    }
    const tree = await git(directory, ["ls-tree", "-z", target.sha, "--", target.path]);
    if (tree.code !== 0) {
      return { state: "unreadable", reason: `git ls-tree failed: ${lastLine(tree.stderr)}` };
    }
    const entry = tree.stdout.split("\0")[0] ?? "";
    if (entry.length === 0) {
      return { state: "missing", reason: `the path does not exist in ${name} at that commit` };
    }
    const [mode = "", type = "", oid = ""] = (entry.split("\t")[0] ?? "").split(" ");
    if (type !== "blob" || !REGULAR_MODES.has(mode)) {
      return { state: "missing", reason: `a ${type} of mode ${mode}, not a regular file` };
    }
    const blob = await git(directory, ["cat-file", "blob", oid]);
    if (blob.code !== 0) {
      return { state: "unreadable", reason: `git cat-file failed: ${lastLine(blob.stderr)}` };
    }
    if (blob.stdout.length === 0) return { state: "missing", reason: "the file is empty" };
    return { state: "found", text: blob.stdout };
  };

  const resolved = new Map<string, Resolved>();
  const ledger = await readText(join(root, LEDGER_PATH));
  if (typeof ledger === "string") {
    const parsed = parseLedger(ledger);
    const cells = [
      ...parsed.threats.map((row) => row.evidence),
      ...parsed.risks.flatMap((row) => [row.barrier, row.detection]),
    ];
    for (const cell of cells) {
      const judged = parseEvidenceCell(cell);
      if (judged.kind !== "evidence") continue;
      for (const { target } of judged.items) {
        const key = targetKey(target);
        if (resolved.has(key)) continue;
        resolved.set(
          key,
          target.kind === "local" ? await resolveLocal(target.path) : await resolvePinned(target),
        );
      }
    }
  }
  return (target) =>
    resolved.get(targetKey(target)) ?? {
      state: "unreadable",
      reason: "the target was not cited by the ledger this resolver was loaded from",
    };
}

const SIBLING_ARGUMENT = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)=(.+)$/;

if (import.meta.main) {
  const siblings = new Map<string, string>();
  for (const argument of process.argv.slice(2)) {
    const match = SIBLING_ARGUMENT.exec(argument);
    if (match === null) {
      console.error(
        `usage: bun tools/quality/check-threat-model-evidence.ts [<owner>/<repository>=<directory> …] — '${argument}' is not of that form`,
      );
      process.exit(2);
    }
    siblings.set(siblingKey(match[1] ?? "", match[2] ?? ""), match[3] ?? "");
  }
  const toplevel = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stderr: "pipe" });
  if (toplevel.exitCode !== 0) {
    console.error(`not in a git repository: ${lastLine(toplevel.stderr.toString())}`);
    process.exit(2);
  }
  const root = toplevel.stdout.toString().trim();
  const model = await readText(join(root, MODEL_PATH));
  const ledger = await readText(join(root, LEDGER_PATH));
  if (typeof model !== "string" || typeof ledger !== "string") {
    if (typeof model !== "string") console.error(`${MODEL_PATH} cannot be read: ${model.reason}`);
    if (typeof ledger !== "string") {
      console.error(`${LEDGER_PATH} cannot be read: ${ledger.reason}`);
    }
    process.exit(2);
  }
  const outcome = evaluateEvidence({
    model,
    ledger,
    resolve: await loadResolver(root, siblings),
  });
  for (const line of outcome.lines) {
    if (outcome.exitCode === 0) console.log(line);
    else console.error(line);
  }
  process.exit(outcome.exitCode);
}
