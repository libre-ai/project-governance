/**
 * Invariant → gate → test matrix: generator and `--check` gate.
 *
 * `docs/decisions/INVARIANTS.md` says what the invariants are; nothing said
 * which mechanism holds each one, so an invariant no gate enforces read exactly
 * like an enforced one (I-35 was found by hand before its retirement, D103).
 *
 * Two inputs, one authority each:
 *   - the register stays the only source of the I-nn ids and of their state
 *     (in force, retired). This script never writes it;
 *   - `ecosystem/invariant-gates.v1.yaml` carries the reviewed correspondence
 *     I-nn → [{ gate, test }], and nothing else: no rule text, no applicability.
 *     It is declared rather than derived because a gate header citing an I-nn
 *     is a mention, not an enforcement.
 *
 * What is derived from the tree: that every named gate and test is a tracked
 * file, and that the test names its gate.
 *
 * The output, `ecosystem/projections/invariant-matrix.v1.json`, is generated,
 * deterministic and carries no timestamp. No projection is produced from a red
 * state: one violation and the matrix is null.
 *
 * Usage: bun ecosystem/render-invariant-matrix.ts           (writes the projection)
 *        bun ecosystem/render-invariant-matrix.ts --check   (writes nothing)
 * Exit:  0 green; 1 violation, or committed projection differing from the
 *        regeneration; 2 usage. `--check` reads the register, the
 *        correspondence, the tests and the projection from the git index:
 *        stage an edit before checking it; a projection never indexed is red.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

import type { ReadFile } from "../tools/quality/check-threat-model-citations";
import { concludeGate, GateReport } from "../tools/quality/gate-report";
import { parseInvariantsRegister } from "../tools/quality/invariants-register";
import { gitEnvironment } from "./check-briques";

export const REGISTER_PATH = "docs/decisions/INVARIANTS.md";
export const MAPPING_PATH = "ecosystem/invariant-gates.v1.yaml";
export const PROJECTION_PATH = "ecosystem/projections/invariant-matrix.v1.json";
export const MAPPING_SCHEMA = "libre-ai.invariant-gates.v1";

export interface GatePair {
  readonly gate: string;
  readonly test: string | null;
}

export type InvariantState = "en vigueur" | "retiré";
export type InvariantApplication = "sans gate" | "imposé, non testé" | "imposé et testé";

export interface InvariantMatrixRow {
  readonly invariant: string;
  readonly etat: InvariantState;
  readonly application: InvariantApplication;
  readonly gates: readonly GatePair[];
}

export interface InvariantMatrix {
  readonly schema_version: "libre-ai.invariant-matrix.v1";
  readonly source: "docs/decisions/INVARIANTS.md + ecosystem/invariant-gates.v1.yaml";
  readonly rows: readonly InvariantMatrixRow[];
}

/** The tracked tree as the pure half sees it. */
export interface TrackedTree {
  /** Paths of the git index; null when git could not list it. */
  readonly paths: ReadonlySet<string> | null;
  /** Text of a tracked file; null when it could not be read. */
  readonly text: (path: string) => string | null;
}

interface MappingEntry {
  readonly invariant: string;
  readonly gates: readonly GatePair[];
}

type ParsedMapping =
  | { readonly ok: true; readonly entries: readonly MappingEntry[] }
  | { readonly ok: false; readonly reason: string };

const INVARIANT_ID = /^I-\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys of `record` outside `allowed`: the file carries the correspondence and nothing else. */
function foreignKeys(record: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(record).filter((key) => !allowed.includes(key));
}

function parseGatePair(value: unknown, where: string): GatePair | string {
  if (!isRecord(value)) return `${where}: expected { gate, test }`;
  const foreign = foreignKeys(value, ["gate", "test"]);
  if (foreign.length > 0) return `${where}: unexpected key(s) ${foreign.join(", ")}`;
  const { gate, test } = value;
  if (typeof gate !== "string" || gate === "") return `${where}: \`gate\` must be a path`;
  if (test !== null && (typeof test !== "string" || test === "")) {
    return `${where}: \`test\` must be a path or null`;
  }
  return { gate, test };
}

function parseEntry(value: unknown, where: string): MappingEntry | string {
  if (!isRecord(value)) return `${where}: expected { invariant, gates }`;
  const foreign = foreignKeys(value, ["invariant", "gates"]);
  if (foreign.length > 0) return `${where}: unexpected key(s) ${foreign.join(", ")}`;
  const { invariant, gates } = value;
  if (typeof invariant !== "string" || !INVARIANT_ID.test(invariant)) {
    return `${where}: \`invariant\` must be an I-nn id`;
  }
  if (!Array.isArray(gates)) return `${where} (${invariant}): \`gates\` must be a list`;
  const pairs: GatePair[] = [];
  for (const [index, raw] of gates.entries()) {
    const pair = parseGatePair(raw, `${where} (${invariant}) gates[${index}]`);
    if (typeof pair === "string") return pair;
    pairs.push(pair);
  }
  return { invariant, gates: pairs };
}

function parseMapping(text: string): ParsedMapping {
  // Bun.YAML.parse stops silently at a NUL: the tail of the file would be
  // dropped and the rest read as complete.
  if (text.includes("\0")) return { ok: false, reason: "contains a NUL byte" };
  let value: unknown;
  try {
    value = Bun.YAML.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `YAML parse failed: ${message}` };
  }
  if (!isRecord(value)) return { ok: false, reason: "expected { schema_version, entries }" };
  if (value.schema_version !== MAPPING_SCHEMA) {
    return { ok: false, reason: `schema_version must be ${MAPPING_SCHEMA}` };
  }
  const foreign = foreignKeys(value, ["schema_version", "entries"]);
  if (foreign.length > 0) return { ok: false, reason: `unexpected key(s) ${foreign.join(", ")}` };
  if (!Array.isArray(value.entries)) return { ok: false, reason: "`entries` must be a list" };
  const entries: MappingEntry[] = [];
  for (const [index, raw] of value.entries.entries()) {
    const entry = parseEntry(raw, `entries[${index}]`);
    if (typeof entry === "string") return { ok: false, reason: entry };
    entries.push(entry);
  }
  return { ok: true, entries };
}

function applicationOf(gates: readonly GatePair[]): InvariantApplication {
  if (gates.length === 0) return "sans gate";
  return gates.some((pair) => pair.test !== null) ? "imposé et testé" : "imposé, non testé";
}

/** `tools/x/check-y.ts` → `check-y`: the name a test of that gate has to cite. */
function gateStem(gate: string): string {
  return posix.basename(gate).replace(/\.[^.]+$/, "");
}

/**
 * Whether `body` names `stem` as a word of a path: not inside a longer name
 * (`check-things`, `precheck-thing`) and not as a letter of an unrelated word.
 * A following `.` stays allowed, for `check-thing.ts`.
 */
function citesStem(body: string, stem: string): boolean {
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_.-])${escaped}(?![A-Za-z0-9_-])`).test(body);
}

interface PairCounts {
  gates: number;
  tests: number;
}

function checkPairs(
  report: GateReport,
  entry: MappingEntry,
  paths: ReadonlySet<string>,
  text: TrackedTree["text"],
  counts: PairCounts,
): void {
  const seen = new Set<string>();
  for (const pair of entry.gates) {
    const item = `${entry.invariant} → ${pair.gate}`;
    const key = JSON.stringify([pair.gate, pair.test]);
    if (seen.has(key)) {
      report.check(item, false, `the pair gate/test (${pair.test ?? "null"}) is listed twice`);
      continue;
    }
    seen.add(key);
    counts.gates += 1;
    const gateTracked = paths.has(pair.gate);
    report.check(
      item,
      gateTracked,
      gateTracked ? "gate is a tracked file" : "gate is not a file tracked by git",
    );
    if (pair.test === null) continue;
    counts.tests += 1;
    const testItem = `${item} → ${pair.test}`;
    // A gate that names itself would « cite » its own base name: the citation
    // check would then certify a test that does not exist.
    if (pair.test === pair.gate) {
      report.check(testItem, false, "the test is the gate itself, not a test of it");
      continue;
    }
    if (!paths.has(pair.test)) {
      report.check(testItem, false, "test is not a file tracked by git");
      continue;
    }
    const body = text(pair.test);
    if (body === null) {
      report.check(testItem, false, "test is tracked but could not be read");
      continue;
    }
    const stem = gateStem(pair.gate);
    const cites = citesStem(body, stem);
    report.check(
      testItem,
      cites,
      cites
        ? `test is tracked and cites ${stem}`
        : `test does not cite \`${stem}\`, the base name of its gate`,
    );
  }
}

/**
 * Pure verdict and projection over inputs already read.
 *
 * `matrix` is null as soon as one check fails: a matrix built from a register
 * that could not be read, or from a correspondence naming a gate that does not
 * exist, would be an empty or flattering green.
 */
export function buildInvariantMatrix(
  register: ReadFile,
  mapping: ReadFile,
  tracked: TrackedTree,
): { report: GateReport; matrix: InvariantMatrix | null } {
  const report = new GateReport();

  // The register's one reader, shared with the threat-model citations gate and
  // the brick map: rows in order, duplicates named, and the retired standing.
  // A line it does not take as a row (an id past three digits, a cell without
  // its closing bar) is no row at all, so a correspondence naming that id is
  // refused below as absent from the register — never defaulted to in force.
  const parsed = parseInvariantsRegister(register.text ?? "");
  const ids = [...parsed.entries.values()].map((entry) => ({
    id: entry.id,
    retired: entry.retired,
  }));
  const retiredIds = new Set(ids.filter((entry) => entry.retired).map((entry) => entry.id));
  const live = ids.filter((entry) => !entry.retired);
  const retired = ids.length - live.length;
  if (register.text === null) {
    report.check(register.path, false, "the invariants register could not be read");
  } else if (ids.length === 0) {
    report.check(register.path, false, "the register parsed to zero `| I-nn |` rows");
  } else if (parsed.duplicates.length > 0) {
    report.check(
      register.path,
      false,
      `duplicate register id(s): ${[...new Set(parsed.duplicates)].join(", ")}`,
    );
  } else {
    report.check(
      register.path,
      true,
      `${ids.length} row(s), ${live.length} in force, ${retired} retired`,
    );
  }

  const correspondence: ParsedMapping =
    mapping.text === null
      ? { ok: false, reason: "the correspondence could not be read" }
      : parseMapping(mapping.text);
  const entries = correspondence.ok ? correspondence.entries : [];
  report.check(
    mapping.path,
    correspondence.ok,
    correspondence.ok ? `${entries.length} entr(ies)` : correspondence.reason,
  );

  if (tracked.paths === null) {
    report.check("git ls-files", false, "the git index could not be listed");
  }

  const byInvariant = new Map<string, MappingEntry[]>();
  for (const entry of entries) {
    byInvariant.set(entry.invariant, [...(byInvariant.get(entry.invariant) ?? []), entry]);
  }

  const counts: PairCounts = { gates: 0, tests: 0 };
  const applications = { "sans gate": 0, "imposé, non testé": 0, "imposé et testé": 0 };
  let unresolved = 0;
  const sourcesRead = report.outcome === "pass";

  if (sourcesRead && tracked.paths !== null) {
    for (const { id } of live) {
      const found = byInvariant.get(id) ?? [];
      const only = found.length === 1 ? found[0] : undefined;
      if (only === undefined) {
        unresolved += 1;
        report.check(
          id,
          false,
          found.length === 0
            ? `in force in the register, no entry in ${mapping.path}`
            : `${found.length} entries in ${mapping.path}, exactly one expected`,
        );
        continue;
      }
      applications[applicationOf(only.gates)] += 1;
      report.check(id, true, `one entry, ${only.gates.length} gate(s)`);
    }
    for (const id of byInvariant.keys()) {
      if (!parsed.entries.has(id)) {
        report.check(id, false, `named by ${mapping.path}, absent from the register`);
      } else if (retiredIds.has(id)) {
        report.check(id, false, `named by ${mapping.path}, retired in the register`);
      }
    }
    for (const entry of entries) checkPairs(report, entry, tracked.paths, tracked.text, counts);
  } else {
    unresolved = live.length;
  }

  report.volume(
    `register: ${ids.length} row(s) read, ${live.length} in force, ${retired} retired; ` +
      `correspondence: ${entries.length} entr(ies); ` +
      `${counts.gates} gate(s) and ${counts.tests} test(s) verified; ` +
      `in force: ${applications["sans gate"]} without gate, ` +
      `${applications["imposé, non testé"]} enforced untested, ` +
      `${applications["imposé et testé"]} enforced and tested, ${unresolved} unresolved`,
  );

  if (report.outcome !== "pass") return { report, matrix: null };

  const rows: InvariantMatrixRow[] = ids.map((row) => {
    const gates = row.retired ? [] : (byInvariant.get(row.id)?.[0]?.gates ?? []);
    return {
      invariant: row.id,
      etat: row.retired ? "retiré" : "en vigueur",
      application: applicationOf(gates),
      gates: gates.map((pair) => ({ gate: pair.gate, test: pair.test })),
    };
  });
  return {
    report,
    matrix: {
      schema_version: "libre-ai.invariant-matrix.v1",
      source: "docs/decisions/INVARIANTS.md + ecosystem/invariant-gates.v1.yaml",
      rows,
    },
  };
}

/** Rows in register order, indented, one trailing newline, no timestamp. */
export function renderInvariantMatrix(matrix: InvariantMatrix): string {
  return `${JSON.stringify(matrix, null, 2)}\n`;
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function git(cwd: string, argv: readonly string[]): string | null {
  try {
    return execFileSync("git", [...argv], {
      encoding: "utf8",
      cwd,
      env: gitEnvironment(),
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((argument) => argument !== "--check");
  if (unknown.length > 0 || argv.length > 1) {
    console.error(
      `usage: bun ecosystem/render-invariant-matrix.ts [--check] — unexpected: ${argv.join(" ")}`,
    );
    process.exit(2);
  }
  const check = argv.length === 1;

  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"])?.trim() ?? process.cwd();
  const listing = git(root, ["ls-files", "-z"]);
  const paths = listing === null ? null : new Set(listing.split("\0").filter(Boolean));
  // `--check` judges what is committed: every source, the projection included,
  // is read from the index (`git show :<path>`), never from the disk, where an
  // unstaged edit or a projection never indexed would pass for the committed
  // one. Generation reads the disk, where the correspondence is being edited.
  const read = check
    ? (path: string) => git(root, ["show", `:${path}`])
    : (path: string) => readOrNull(join(root, path));
  const tracked: TrackedTree = { paths, text: read };
  const { report, matrix } = buildInvariantMatrix(
    { path: REGISTER_PATH, text: read(REGISTER_PATH) },
    { path: MAPPING_PATH, text: read(MAPPING_PATH) },
    tracked,
  );

  if (matrix !== null) {
    const rendered = renderInvariantMatrix(matrix);
    if (check) {
      const isTracked = paths?.has(PROJECTION_PATH) === true;
      const committed = isTracked ? read(PROJECTION_PATH) : null;
      report.check(
        PROJECTION_PATH,
        committed === rendered,
        committed === rendered
          ? "byte-identical to the regeneration"
          : !isTracked
            ? "not tracked by git — generate it with `bun ecosystem/render-invariant-matrix.ts`, then `git add` it"
            : committed === null
              ? "tracked but could not be read from the index"
              : "differs from the regeneration — run `bun ecosystem/render-invariant-matrix.ts`",
      );
    } else {
      await Bun.write(join(root, PROJECTION_PATH), rendered);
      console.log(`Generated ${PROJECTION_PATH}: ${matrix.rows.length} row(s).`);
    }
  }
  concludeGate("Invariant matrix", report);
}
