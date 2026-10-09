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
 * Retirement: the register carries no retirement convention today (0 retired
 * rows). A row whose invariant cell is struck through (`~~…~~`) or opens with
 * "Retired"/"Retiré" is treated as retired, so the convention a future
 * retirement is most likely to use already turns citations of it red.
 *
 * The declared files and the scope live in data:
 * `tools/quality/threat-model-citations.v1.json`.
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import { GateReport } from "./gate-report";

export interface DeclaredFile {
  readonly path: string;
  readonly because: string;
}

export interface CitationsConfig {
  readonly register: string;
  readonly scope: string;
  readonly files: readonly DeclaredFile[];
}

export interface RegisterEntry {
  readonly id: string;
  readonly retired: boolean;
}

export interface ParsedRegister {
  readonly entries: ReadonlyMap<string, RegisterEntry>;
  readonly duplicates: readonly string[];
}

export interface Citation {
  readonly id: string;
  readonly line: number;
}

export type Resolution =
  | { readonly ok: true; readonly note: string }
  | { readonly ok: false; readonly note: string };

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
}

const REGISTER_ROW = /^\|\s*(I-\d+)\s*\|([^|]*)\|/;
const RETIRED_CELL = /^\s*(?:~~|\*{0,2}(?:Retired|Retiré)\b)/i;
// `I-xx` as a whole token: `AI-01` or `WP-I-02` must not read as a citation.
const CITATION = /(?<![A-Za-z0-9-])I-(\d+)\b/g;

export function parseRegister(text: string): ParsedRegister {
  const entries = new Map<string, RegisterEntry>();
  const duplicates: string[] = [];
  for (const line of text.split("\n")) {
    const match = REGISTER_ROW.exec(line);
    if (match === null) continue;
    const id = match[1] ?? "";
    const cell = match[2] ?? "";
    if (entries.has(id)) duplicates.push(id);
    entries.set(id, { id, retired: RETIRED_CELL.test(cell) });
  }
  return { entries, duplicates };
}

export function findCitations(text: string): Citation[] {
  const citations: Citation[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(CITATION)) {
      citations.push({ id: `I-${match[1] ?? ""}`, line: index + 1 });
    }
  }
  return citations;
}

export function resolveCitation(id: string, register: ParsedRegister): Resolution {
  const entry = register.entries.get(id);
  if (entry === undefined) {
    return { ok: false, note: `${id} is not a row of the invariants register` };
  }
  if (entry.retired) {
    return { ok: false, note: `${id} is retired in the invariants register` };
  }
  return { ok: true, note: `${id} resolves to a live register row` };
}

export interface CitationsVolume {
  readonly declaredRead: number;
  readonly declaredUnreadable: number;
  readonly citations: number;
  readonly resolved: number;
  readonly failed: number;
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
  let failed = 0;
  let undeclaredCiting = 0;

  if (input.register.text === null) {
    report.check(input.register.path, false, "the invariants register could not be read");
  }
  const register = parseRegister(input.register.text ?? "");
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

  for (const file of input.declared) {
    if (file.text === null) {
      declaredUnreadable += 1;
      report.check(
        file.path,
        false,
        "declared file could not be read — a missing file is not zero citations",
      );
      continue;
    }
    declaredRead += 1;
    for (const citation of findCitations(file.text)) {
      citationCount += 1;
      const resolution = resolveCitation(citation.id, register);
      if (resolution.ok) resolved += 1;
      else failed += 1;
      report.check(`${file.path}:${citation.line} ${citation.id}`, resolution.ok, resolution.note);
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

  const volume: CitationsVolume = {
    declaredRead,
    declaredUnreadable,
    citations: citationCount,
    resolved,
    failed,
    registerRows,
    registerRetired,
    undeclaredScanned: input.undeclared.length,
    undeclaredCiting,
  };
  report.volume(
    `${declaredRead} declared file(s) read, ${declaredUnreadable} unreadable; ` +
      `${citationCount} citation(s) read, ${resolved} resolved, ${failed} failed; ` +
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
  return { register, declared, undeclared };
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
  return candidate as CitationsConfig;
}

export const CONFIG_PATH = "tools/quality/threat-model-citations.v1.json";

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
