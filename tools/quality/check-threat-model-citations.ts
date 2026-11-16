/**
 * Security documents cite invariants that exist.
 *
 * `docs/security/THREAT-MODEL.md` maps every threat to an `I-xx` entry of the
 * invariants register. Until 2026-10-09 nothing read those citations against the
 * register, and 27 of its 35 citations named an unrelated or imprecise entry:
 * SQL injection cited I-02 (topology), a cross-tenant leak cited I-01 (brand), a
 * dependency CVE cited I-19 (dogfooding). The register's own CI step ("Invariants
 * register citations resolve") checks the opposite direction only — register to
 * ADR — so the drift stayed invisible.
 *
 * What this gate asserts, mechanically:
 *   - every `I-xx` cited in a declared file is a row of the register, and that
 *     row is not retired;
 *   - every declared file is readable — an unreadable file is a failure, never a
 *     zero (a missing file and a file with no citation must not look alike);
 *   - every tracked file under the declared scope that cites an `I-xx` is
 *     declared, so a new security document cannot cite outside the gate's sight;
 *   - the register itself parses to at least one row and carries no duplicate id.
 *
 * What it deliberately does NOT assert: that a cited invariant is the RIGHT one
 * for the threat. That is a semantic judgment. A threat → invariant table kept in
 * data would only restate the document a second time and drift with it; the
 * relevance of a citation stays a review matter. The threat model instead marks
 * every threat the register does not carry as "no register invariant", so a gap
 * is written down rather than papered over by an unrelated id.
 *
 * Retirement: which rows are retired is read by `invariants-register.ts`, the
 * one reader this gate shares with the brick map. A mention of a retired row
 * fails, with one exception: a mention ADMITTED IN DATA. A document has to be
 * able to say that an invariant it used to rely on was withdrawn, and by which
 * decision; it cannot say so without naming it. Whether a sentence says that is
 * a matter of meaning, and this gate does not read meaning: for one day it
 * accepted a mention whenever its table cell held a word such as "withdrawn",
 * which let through "I-35 was never withdrawn and carries the case", excused a
 * second retired invariant named beside the first, and refused a notice
 * written in other words. The admitted mentions are therefore enumerated in
 * `retiredMentions` of the configuration, one entry per line of a document:
 *
 *   - `file`, a declared file; `id`, the retired invariant;
 *   - `anchor`, a piece of the line that holds the identifier. It designates
 *     the line by its text, never by its number, and it admits the occurrences
 *     of `id` that lie INSIDE it, not their neighbours on the line;
 *   - `because`, why the mention is not a citation of a living rule.
 *
 * An entry that admits nothing fails: its anchor is gone, or holds on several
 * lines (it then admits none), or its invariant is not retired. The file is on
 * the review-evidence surface, so an entry is a reviewed act, like the other
 * exemptions kept in data here. Mentions of retired rows are counted, and the
 * count is printed with its split: mentions = admitted + refused.
 *
 * The declared files, the scope and the admitted mentions live in data:
 * `tools/quality/threat-model-citations.v1.json`.
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import { GateReport } from "./gate-report";
import { type ParsedRegister, parseInvariantsRegister } from "./invariants-register";

export interface DeclaredFile {
  readonly path: string;
  readonly because: string;
}

/** One line of a declared file allowed to name a retired invariant. */
export interface AdmittedMention {
  readonly file: string;
  readonly id: string;
  /** Text of the line, holding `id`: the mention is admitted inside it only. */
  readonly anchor: string;
  readonly because: string;
}

export interface CitationsConfig {
  readonly register: string;
  readonly scope: string;
  readonly files: readonly DeclaredFile[];
  readonly retiredMentions: readonly AdmittedMention[];
}

export interface Citation {
  readonly id: string;
  readonly line: number;
  /** The whole line, in NFC. */
  readonly text: string;
  /** Where the identifier starts on the line. */
  readonly start: number;
}

export type Standing = "live" | "retired" | "unknown";

/** A file as read by the effectful half: `text` is null when it could not be read. */
export interface ReadFile {
  readonly path: string;
  readonly text: string | null;
}

export interface CitationsInput {
  readonly register: ReadFile;
  readonly declared: readonly ReadFile[];
  /** Tracked files under the scope that are not declared, with their contents. */
  readonly undeclared: readonly ReadFile[];
  readonly admitted: readonly AdmittedMention[];
}

// `I-xx` as a whole token: `AI-01` or `WP-I-02` must not read as a citation.
const CITATION = /(?<![A-Za-z0-9-])I-(\d+)\b/g;

/**
 * Every `I-xx` of a text, with its line. The text is read in NFC, so an anchor
 * matches its line whichever way either writes an accent.
 */
export function findCitations(text: string): Citation[] {
  const citations: Citation[] = [];
  const lines = text.normalize("NFC").split("\n");
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(CITATION)) {
      citations.push({
        id: `I-${match[1] ?? ""}`,
        line: index + 1,
        text: line,
        start: match.index,
      });
    }
  }
  return citations;
}

export function standingOf(id: string, register: ParsedRegister): Standing {
  const entry = register.entries.get(id);
  if (entry === undefined) return "unknown";
  return entry.retired ? "retired" : "live";
}

/** Whether an occurrence of `anchor` on the citation's line holds the citation. */
function anchorHolds(citation: Citation, anchor: string): boolean {
  const end = citation.start + citation.id.length;
  let from = citation.text.indexOf(anchor);
  while (from !== -1) {
    if (from <= citation.start && end <= from + anchor.length) return true;
    from = citation.text.indexOf(anchor, from + 1);
  }
  return false;
}

export interface CitationsVolume {
  readonly declaredRead: number;
  readonly declaredUnreadable: number;
  readonly citations: number;
  /** Citations of a live register row. */
  readonly resolved: number;
  /** Mentions of a retired row: `retiredAdmitted + retiredRefused`. */
  readonly retiredMentions: number;
  readonly retiredAdmitted: number;
  readonly retiredRefused: number;
  /** Citations of an identifier the register does not hold. */
  readonly unknown: number;
  /** `retiredRefused + unknown`. */
  readonly failed: number;
  readonly admittedEntries: number;
  /** Entries that admit nothing: anchor gone or ambiguous, invariant not retired. */
  readonly admittedEntriesStale: number;
  readonly registerRows: number;
  readonly registerRetired: number;
  readonly undeclaredScanned: number;
  readonly undeclaredCiting: number;
}

/** Pure verdict over files already read, so every rule is testable without a filesystem. */
export function evaluateCitations(input: CitationsInput): {
  report: GateReport;
  volume: CitationsVolume;
} {
  const report = new GateReport();
  let declaredRead = 0;
  let declaredUnreadable = 0;
  let citationCount = 0;
  let resolved = 0;
  let retiredAdmitted = 0;
  let retiredRefused = 0;
  let unknown = 0;
  let undeclaredCiting = 0;
  let admittedEntriesStale = 0;

  if (input.register.text === null) {
    report.check(input.register.path, false, "the invariants register could not be read");
  }
  const register = parseInvariantsRegister(input.register.text ?? "");
  const registerRows = register.entries.size;
  const registerRetired = [...register.entries.values()].filter((entry) => entry.retired).length;
  if (input.register.text !== null) {
    report.check(
      input.register.path,
      registerRows > 0 && register.duplicates.length === 0,
      registerRows === 0
        ? "the register parsed to zero `| I-xx |` rows — every citation would read as unresolved"
        : register.duplicates.length > 0
          ? `duplicate register id(s): ${register.duplicates.join(", ")} — a citation of them is ambiguous`
          : `${registerRows} register row(s), ${registerRetired} retired`,
    );
  }

  const read = new Map<string, Citation[]>();
  for (const file of input.declared) {
    if (file.text !== null) read.set(file.path, findCitations(file.text));
  }

  // An entry is judged before any mention: it designates ONE line, so the lines
  // its anchor holds on are counted first, and only an entry with exactly one
  // admits anything.
  const admitting: { readonly entry: AdmittedMention; readonly anchor: string }[] = [];
  for (const entry of input.admitted) {
    const anchor = entry.anchor.normalize("NFC");
    const item = `${entry.file} admitted mention ${entry.id} ${JSON.stringify(entry.anchor)}`;
    const lines = [
      ...new Set(
        (read.get(entry.file) ?? [])
          .filter((citation) => citation.id === entry.id && anchorHolds(citation, anchor))
          .map((citation) => citation.line),
      ),
    ];
    const standing = standingOf(entry.id, register);
    const note =
      standing !== "retired"
        ? `${entry.id} is not a retired row of the invariants register — the entry admits nothing, remove it`
        : lines.length === 0
          ? `no line of the file holds this anchor around a mention of ${entry.id} — the entry admits nothing, remove it or re-anchor it`
          : lines.length > 1
            ? `the anchor holds on ${lines.length} lines (${lines.join(", ")}) — an entry designates one line, lengthen the anchor`
            : null;
    if (note === null) {
      admitting.push({ entry, anchor });
      report.check(item, true, `admits ${entry.id} on line ${lines[0]}: ${entry.because}`);
    } else {
      admittedEntriesStale += 1;
      report.check(item, false, note);
    }
  }

  for (const file of input.declared) {
    const citations = read.get(file.path);
    if (citations === undefined) {
      declaredUnreadable += 1;
      report.check(
        file.path,
        false,
        "declared file could not be read — a missing file is not zero citations",
      );
      continue;
    }
    declaredRead += 1;
    for (const citation of citations) {
      citationCount += 1;
      const { id } = citation;
      const item = `${file.path}:${citation.line} ${id}`;
      const standing = standingOf(id, register);
      if (standing === "unknown") {
        unknown += 1;
        report.check(item, false, `${id} is not a row of the invariants register`);
      } else if (standing === "live") {
        resolved += 1;
        report.check(item, true, `${id} resolves to a live register row`);
      } else if (
        admitting.some(
          ({ entry, anchor }) =>
            entry.file === file.path && entry.id === id && anchorHolds(citation, anchor),
        )
      ) {
        retiredAdmitted += 1;
        report.check(item, true, `${id} is retired, and this mention is admitted in data`);
      } else {
        retiredRefused += 1;
        report.check(
          item,
          false,
          `${id} is retired in the invariants register — cite the invariant that carries the case now; if the line only records that ${id} was withdrawn, admit it under retiredMentions of ${CONFIG_PATH} (file, id, anchor, because)`,
        );
      }
    }
  }

  for (const file of input.undeclared) {
    if (file.text === null) {
      report.check(file.path, false, "tracked file under the scope could not be read");
      continue;
    }
    const citing = findCitations(file.text);
    if (citing.length === 0) continue;
    undeclaredCiting += 1;
    report.check(
      file.path,
      false,
      `cites ${citing.length} invariant(s) but is not declared in threat-model-citations.v1.json — declare it so its citations are checked`,
    );
  }

  const retiredMentions = retiredAdmitted + retiredRefused;
  const failed = retiredRefused + unknown;
  const volume: CitationsVolume = {
    declaredRead,
    declaredUnreadable,
    citations: citationCount,
    resolved,
    retiredMentions,
    retiredAdmitted,
    retiredRefused,
    unknown,
    failed,
    admittedEntries: input.admitted.length,
    admittedEntriesStale,
    registerRows,
    registerRetired,
    undeclaredScanned: input.undeclared.length,
    undeclaredCiting,
  };
  report.volume(
    `${declaredRead} declared file(s) read, ${declaredUnreadable} unreadable; ` +
      `${citationCount} citation(s) read, ${resolved} resolved to a live row, ` +
      `${unknown} unknown to the register; ` +
      `${retiredMentions} mention(s) of a retired row = ${retiredAdmitted} admitted + ${retiredRefused} refused; ` +
      `${input.admitted.length} admitted-mention entr(ies) declared, ${admittedEntriesStale} stale; ` +
      `register ${registerRows} row(s), ${registerRetired} retired; ` +
      `${input.undeclared.length} undeclared markdown file(s) under the scope scanned, ${undeclaredCiting} citing`,
  );
  return { report, volume };
}

/** Reads a file relative to `root`, returning null rather than throwing. */
export async function readOrNull(root: string, path: string): Promise<ReadFile> {
  try {
    const file = Bun.file(join(root, path));
    if (!(await file.exists())) return { path, text: null };
    return { path, text: await file.text() };
  } catch {
    return { path, text: null };
  }
}

/** Collects every input from disk: the effectful half of the gate. */
export async function loadCitationsInput(
  root: string,
  config: CitationsConfig,
  tracked: readonly string[],
): Promise<CitationsInput> {
  const declaredPaths = new Set(config.files.map((file) => file.path));
  const register = await readOrNull(root, config.register);
  const declared = await Promise.all(config.files.map((file) => readOrNull(root, file.path)));
  const undeclaredPaths = tracked.filter(
    (path) => path.startsWith(config.scope) && path.endsWith(".md") && !declaredPaths.has(path),
  );
  const undeclared = await Promise.all(undeclaredPaths.map((path) => readOrNull(root, path)));
  return { register, declared, undeclared, admitted: config.retiredMentions };
}

export const CONFIG_PATH = "tools/quality/threat-model-citations.v1.json";

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function validateConfig(value: unknown): CitationsConfig {
  const candidate = value as Partial<CitationsConfig> | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    typeof candidate.register !== "string" ||
    typeof candidate.scope !== "string" ||
    !Array.isArray(candidate.files) ||
    candidate.files.length === 0
  ) {
    throw new Error("threat-model-citations.v1.json: expected { register, scope, files[≥1] }");
  }
  for (const file of candidate.files) {
    if (typeof file?.path !== "string" || typeof file?.because !== "string") {
      throw new Error("threat-model-citations.v1.json: every file needs a path and a because");
    }
    if (!file.path.startsWith(candidate.scope)) {
      throw new Error(
        `threat-model-citations.v1.json: ${file.path} lies outside ${candidate.scope}`,
      );
    }
  }
  // Written even when empty: an absent list and a list nobody could read must
  // not look alike.
  if (!Array.isArray(candidate.retiredMentions)) {
    throw new Error("threat-model-citations.v1.json: retiredMentions must be a list, [] if none");
  }
  const declared = new Set(candidate.files.map((file) => file.path));
  const seen = new Set<string>();
  for (const entry of candidate.retiredMentions as readonly Partial<AdmittedMention>[]) {
    const where = "threat-model-citations.v1.json: retiredMentions";
    if (typeof entry?.file !== "string" || !declared.has(entry.file)) {
      throw new Error(`${where}: ${String(entry?.file)} is not a declared file`);
    }
    if (typeof entry.id !== "string" || !/^I-\d+$/.test(entry.id)) {
      throw new Error(`${where}: id ${String(entry.id)} is not of the form I-NN`);
    }
    if (!isNonBlank(entry.because)) {
      throw new Error(`${where}: ${entry.file} ${entry.id} needs a non-empty because`);
    }
    if (typeof entry.anchor !== "string" || entry.anchor.includes("\n")) {
      throw new Error(`${where}: the anchor of ${entry.file} ${entry.id} must be text of one line`);
    }
    if (!findCitations(entry.anchor).some((citation) => citation.id === entry.id)) {
      throw new Error(
        `${where}: the anchor ${JSON.stringify(entry.anchor)} does not name ${entry.id} — an anchor admits the mention it holds`,
      );
    }
    const key = JSON.stringify([entry.file, entry.id, entry.anchor.normalize("NFC")]);
    if (seen.has(key)) {
      throw new Error(`${where}: duplicate entry ${entry.file} ${entry.id} ${entry.anchor}`);
    }
    seen.add(key);
  }
  return candidate as CitationsConfig;
}

if (import.meta.main) {
  const { concludeGate } = await import("./gate-report");
  const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  const config = validateConfig(await Bun.file(join(root, CONFIG_PATH)).json());
  const tracked = execSync(`git ls-files -- ${config.scope}`, { encoding: "utf8", cwd: root })
    .split("\n")
    .filter(Boolean);
  const { report } = evaluateCitations(await loadCitationsInput(root, config, tracked));
  concludeGate("Threat-model invariant citations", report);
}
