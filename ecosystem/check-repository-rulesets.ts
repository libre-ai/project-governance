/**
 * Declared-vs-read reconciliation of repository rulesets (bricks EXE-05, GOV-15).
 *
 * ecosystem/repository-rulesets.v1.yaml declares, per repository, the complete
 * list of its expected rulesets. This gate reconciles that declaration with a
 * readback supplied as a file — one `{ repository, rulesets }` object per
 * repository, the shape tools/attestation/provider-policy.sh already prints —
 * in BOTH directions: every ruleset read is declared with the same content,
 * every declared ruleset is read, every declared repository has a readback,
 * and every readback targets a declared repository.
 *
 * Why files and not the network. The verdict must not depend on a quota or a
 * token: collecting the readback is another tool's job, and this one judges
 * what it is handed. It reads, compares and exits; it writes nothing and
 * proposes no correction, because changing a guard stays a human act (I-17,
 * ADR-0029 §2.8).
 *
 * Why an unreadable readback is a finding. `rulesets: null` is what the
 * collector prints when the provider refused the read. Treating it as an
 * empty list would report N missing rulesets — or, for a repository that
 * declares none, a green result over nothing read. It is named instead, and
 * nothing else is compared for that repository.
 *
 * Why the declaration is also read line by line. The YAML parser keeps the
 * last of two equal keys and converts unquoted scalars (`1.10` reads 1.1), so
 * a key written twice or an ambiguous scalar would change the baseline
 * without a word. The declaration must be in block style, every key once,
 * and every plain scalar must read back as itself (`checkDeclarationLayout`).
 *
 * Usage: bun ecosystem/check-repository-rulesets.ts --observed <file.json> [--observed <file.json> ...]
 *        [--declaration <file.yaml>]   (default: the tracked declaration)
 */

import { concludeGate, GateReport } from "../tools/quality/gate-report";
import { parseYaml } from "../tools/quality/yaml-text-guard";

export const RULESET_DECLARATION_SCHEMA_VERSION = "libre-ai.repository-rulesets.v1";
export const RULESET_DECLARATION_SOURCE = "ecosystem/repository-rulesets.v1.yaml";

/** The content compared for a ruleset; `name` is the key, not content. */
export const COMPARED_FIELDS = [
  "target",
  "enforcement",
  "conditions",
  "bypass_actors",
  "rules",
] as const;

export type ComparedField = (typeof COMPARED_FIELDS)[number];

/**
 * Sequences whose order the provider does not guarantee and that carry no
 * meaning: a permutation there is not a difference. Everywhere else order is
 * compared, because nothing establishes that it is free.
 */
const UNORDERED_PATHS: ReadonlySet<string> = new Set([
  "rules",
  "bypass_actors",
  "conditions.ref_name.include",
  "conditions.ref_name.exclude",
]);

export interface DeclaredRuleset {
  readonly name: string;
  readonly target: string;
  readonly enforcement: string;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly bypass_actors: readonly unknown[];
  readonly rules: readonly unknown[];
}

export interface DeclaredRepository {
  readonly repository: string;
  readonly rulesets: readonly DeclaredRuleset[];
}

/**
 * One readback. `rulesets` is `unknown` on purpose: it is whatever the
 * collector printed, and judging its shape is this module's job. Extra keys
 * are ignored, so the full output of provider-policy.sh fits as is.
 */
export interface RulesetObservation {
  readonly repository: string;
  readonly rulesets: unknown;
}

export type RulesetFindingKind =
  | "undeclared-repository"
  | "unobserved-repository"
  | "unreadable-observation"
  | "undeclared-ruleset"
  | "missing-ruleset"
  | "ruleset-differs";

export interface RulesetFinding {
  readonly kind: RulesetFindingKind;
  readonly path: string;
  readonly note: string;
}

/** A comparison that held, kept so the gate can say what it verified. */
export interface RulesetAgreement {
  readonly path: string;
  readonly note: string;
}

export interface RulesetCounts {
  readonly declaredRepositories: number;
  readonly observedRepositories: number;
  readonly declaredRulesets: number;
  readonly observedRulesets: number;
  readonly matched: number;
}

export interface RulesetReconciliation {
  readonly findings: readonly RulesetFinding[];
  readonly agreements: readonly RulesetAgreement[];
  readonly counts: RulesetCounts;
}

const REPOSITORY_SLUG = /^[^/\s]+\/[^/\s]+$/;

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a sequence";
  return typeof value;
}

function fail(path: string, expected: string, actual: unknown): never {
  throw new Error(
    `${RULESET_DECLARATION_SOURCE}: ${path}: expected ${expected}, got ${describe(actual)}`,
  );
}

function refuse(path: string, reason: string): never {
  throw new Error(`${RULESET_DECLARATION_SOURCE}: ${path}: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, "a mapping", value);
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(path, "a non-empty string", value);
  return value;
}

function asSequence(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "a sequence", value);
  return value;
}

/** Closed key set: an unknown key and a missing key are both refused by path. */
function requireExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const prefix = path.length === 0 ? "" : `${path}.`;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) refuse(`${prefix}${key}`, "unknown key");
  }
  for (const key of keys) {
    if (!(key in record)) refuse(`${prefix}${key}`, "missing key");
  }
}

function toDeclaredRuleset(value: unknown, path: string): DeclaredRuleset {
  const record = asRecord(value, path);
  requireExactKeys(record, ["name", ...COMPARED_FIELDS], path);
  return {
    name: asString(record.name, `${path}.name`),
    target: asString(record.target, `${path}.target`),
    enforcement: asString(record.enforcement, `${path}.enforcement`),
    conditions: asRecord(record.conditions, `${path}.conditions`),
    bypass_actors: asSequence(record.bypass_actors, `${path}.bypass_actors`),
    rules: asSequence(record.rules, `${path}.rules`),
  };
}

function toDeclaredRepository(value: unknown, path: string): DeclaredRepository {
  const record = asRecord(value, path);
  requireExactKeys(record, ["repository", "rulesets"], path);
  const repository = asString(record.repository, `${path}.repository`);
  if (!REPOSITORY_SLUG.test(repository)) {
    refuse(`${path}.repository`, `expected an owner/name slug, got ${JSON.stringify(repository)}`);
  }
  const rulesets = asSequence(record.rulesets, `${path}.rulesets`).map((ruleset, index) =>
    toDeclaredRuleset(ruleset, `${path}.rulesets[${index}]`),
  );
  const names = new Set<string>();
  rulesets.forEach((ruleset, index) => {
    if (hasControlCharacter(ruleset.name)) {
      refuse(`${path}.rulesets[${index}].name`, "a ruleset name carries a control character");
    }
    if (names.has(ruleset.name)) {
      refuse(`${path}.rulesets[${index}].name`, `duplicate ruleset name ${ruleset.name}`);
    }
    names.add(ruleset.name);
  });
  return { repository, rulesets };
}

/** C0, DEL, C1 and the two Unicode line separators: each can break an output line. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point.
const CONTROL_CHARACTER = /[\u{0}-\u{1f}\u{7f}-\u{9f}\u{2028}\u{2029}]/u;

function hasControlCharacter(text: string): boolean {
  return CONTROL_CHARACTER.test(text);
}

/** A text from outside, safe to put in one output line. */
function printable(text: string): string {
  return hasControlCharacter(text) ? JSON.stringify(text) : text;
}

const BLOCK_KEY = /^([A-Za-z_][A-Za-z0-9_]*):(?:\s+(.*))?$/;
const DOUBLE_QUOTED = /^"(?:[^"\\]|\\.)*"(?:\s+#.*)?$/;
const SINGLE_QUOTED = /^'(?:[^']|'')*'(?:\s+#.*)?$/;
/** Characters YAML gives a meaning to at the start of a plain scalar. */
const PLAIN_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;

interface LayoutFrame {
  readonly indent: number;
  readonly kind: "mapping" | "sequence";
  readonly path: string;
  readonly keys: Set<string>;
  items: number;
}

function outsideBlockStyle(line: number, reason: string): never {
  refuse(`line ${line}`, `not in the block style this declaration is written in (${reason})`);
}

/**
 * Check one scalar value written after a key or an item marker. Quoted
 * scalars are strings; `[]` and `{}` are the empty collections; a plain
 * scalar must read back as itself, so `1.10` (read 1.1), `0x10`, `012` or
 * `~` are refused and must be quoted.
 */
function checkScalar(raw: string, path: string, line: number): void {
  if (DOUBLE_QUOTED.test(raw) || SINGLE_QUOTED.test(raw)) return;
  const commentAt = raw.search(/\s#/);
  const plain = (commentAt === -1 ? raw : raw.slice(0, commentAt)).trimEnd();
  if (plain === "[]" || plain === "{}") return;
  if (PLAIN_INDICATOR.test(plain) || /:\s|:$/.test(plain)) {
    outsideBlockStyle(line, `value ${JSON.stringify(plain)} is not a plain scalar`);
  }
  let read: unknown;
  try {
    read = (parseYaml(`v: ${plain}`) as { v: unknown }).v;
  } catch {
    outsideBlockStyle(line, `value ${JSON.stringify(plain)} does not parse alone`);
  }
  if (typeof read === "string" || JSON.stringify(read) === plain) return;
  refuse(path, `plain scalar ${JSON.stringify(plain)} reads as ${JSON.stringify(read)}; quote it`);
}

/**
 * Independent, line-by-line reading of the declaration's keys.
 *
 * Why. The YAML parser keeps the last of two equal keys: `rulesets:` written
 * twice would erase the first list and the gate would compare nothing. Every
 * key is therefore read here once, by field path, and a second one is
 * refused. The reading only works on the block style the declaration is
 * written in — a flow collection, a quoted or explicit key, an anchor, a tag,
 * a block scalar or a document marker would hide keys from it — so any line
 * outside that style is refused rather than skipped. Same method as
 * `scanBlockLayout` in tools/quality/check-refusals.ts, extended to any depth.
 */
function checkDeclarationLayout(text: string): void {
  const stack: LayoutFrame[] = [
    { indent: 0, kind: "mapping", path: "", keys: new Set(), items: 0 },
  ];
  let pending: { readonly path: string; readonly indent: number } | null = null;

  const openChild = (indent: number, kind: LayoutFrame["kind"]): void => {
    if (pending !== null && indent > pending.indent) {
      stack.push({ indent, kind, path: pending.path, keys: new Set(), items: 0 });
    } else {
      while ((stack.at(-1)?.indent ?? 0) > indent) stack.pop();
    }
    pending = null;
  };

  const readKey = (frame: LayoutFrame, match: RegExpExecArray, line: number): void => {
    const key = match[1] ?? "";
    const path = frame.path.length === 0 ? key : `${frame.path}.${key}`;
    if (frame.keys.has(key)) refuse(path, "duplicate key");
    frame.keys.add(key);
    const value = match[2] ?? "";
    if (value.length === 0 || value.startsWith("#")) {
      pending = { path, indent: frame.indent };
      return;
    }
    checkScalar(value, path, line);
  };

  text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .forEach((content, index) => {
      const line = index + 1;
      if (content.trim() === "" || content.trimStart().startsWith("#")) return;
      const indent = content.length - content.trimStart().length;
      const rest = content.slice(indent);
      if (content.slice(0, indent).includes("\t")) outsideBlockStyle(line, "tab indentation");
      if (rest === "-" || rest.startsWith("- ")) {
        openChild(indent, "sequence");
        const sequence = stack.at(-1);
        if (sequence?.kind !== "sequence" || sequence.indent !== indent) {
          outsideBlockStyle(line, "sequence item where none is open");
        }
        const itemPath = `${sequence.path}[${sequence.items}]`;
        sequence.items += 1;
        const item = rest.slice(2);
        if (item.trim().length === 0) outsideBlockStyle(line, "item opened on its own line");
        const key = BLOCK_KEY.exec(item);
        if (key !== null) {
          const mapping: LayoutFrame = {
            indent: indent + 2,
            kind: "mapping",
            path: itemPath,
            keys: new Set(),
            items: 0,
          };
          stack.push(mapping);
          readKey(mapping, key, line);
          return;
        }
        checkScalar(item, itemPath, line);
        return;
      }
      const key = BLOCK_KEY.exec(rest);
      if (key === null) outsideBlockStyle(line, "neither a bare key nor a sequence item");
      openChild(indent, "mapping");
      const mapping = stack.at(-1);
      if (mapping?.kind !== "mapping" || mapping.indent !== indent) {
        outsideBlockStyle(line, "key at an indentation no mapping is open at");
      }
      readKey(mapping, key, line);
    });
}

/**
 * Read the declaration. Throws an error naming the field path on any
 * malformed input: a declaration that is half understood is not a baseline.
 */
export function parseRulesetDeclaration(yamlText: string): DeclaredRepository[] {
  checkDeclarationLayout(yamlText);
  const document = asRecord(parseYaml(yamlText), "document");
  requireExactKeys(document, ["schema_version", "repositories"], "");
  if (document.schema_version !== RULESET_DECLARATION_SCHEMA_VERSION) {
    refuse(
      "schema_version",
      `expected ${RULESET_DECLARATION_SCHEMA_VERSION}, got ${JSON.stringify(document.schema_version)}`,
    );
  }
  const entries = document.repositories;
  if (!Array.isArray(entries) || entries.length === 0) {
    fail("repositories", "a non-empty sequence", entries);
  }
  const repositories = entries.map((entry, index) =>
    toDeclaredRepository(entry, `repositories[${index}]`),
  );
  const seen = new Set<string>();
  repositories.forEach((entry, index) => {
    if (seen.has(entry.repository)) {
      refuse(`repositories[${index}].repository`, `duplicate repository ${entry.repository}`);
    }
    seen.add(entry.repository);
  });
  return repositories;
}

/**
 * Canonical text of a compared value: object keys sorted, sequences kept in
 * order unless their path is declared unordered. `undefined` has its own
 * token so an absent field never equals a present one.
 */
function canonical(value: unknown, path: string): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    const items = value.map((item) => canonical(item, `${path}[]`));
    // Default sort is by UTF-16 code unit: identical on every machine.
    if (UNORDERED_PATHS.has(path)) items.sort();
    return `[${items.join(",")}]`;
  }
  if (isRecord(value)) {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key], `${path}.${key}`)}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

function differingFields(
  declared: DeclaredRuleset,
  observed: Record<string, unknown>,
): ComparedField[] {
  return COMPARED_FIELDS.filter(
    (field) => canonical(declared[field], field) !== canonical(observed[field], field),
  );
}

type ReadRulesets =
  | { readonly readable: true; readonly byName: ReadonlyMap<string, Record<string, unknown>> }
  | { readonly readable: false; readonly reason: string };

function readRulesets(rulesets: unknown): ReadRulesets {
  if (!Array.isArray(rulesets)) {
    return { readable: false, reason: `rulesets is ${describe(rulesets)}, not a sequence` };
  }
  const byName = new Map<string, Record<string, unknown>>();
  for (const [index, entry] of rulesets.entries()) {
    if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.length === 0) {
      return { readable: false, reason: `rulesets[${index}] carries no non-empty string name` };
    }
    // The name becomes part of an output line: a newline in it would forge one.
    if (hasControlCharacter(entry.name)) {
      return {
        readable: false,
        reason: `rulesets[${index}] carries a name with a control character`,
      };
    }
    if (byName.has(entry.name)) {
      return {
        readable: false,
        reason: `ruleset name ${JSON.stringify(entry.name)} is read more than once`,
      };
    }
    byName.set(entry.name, entry);
  }
  return { readable: true, byName };
}

function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Pure reconciliation, both directions. Findings and agreements are sorted,
 * so two runs over the same drift print byte-identical output.
 */
export function reconcileRulesets(
  declared: readonly DeclaredRepository[],
  observations: readonly RulesetObservation[],
): RulesetReconciliation {
  const findings: RulesetFinding[] = [];
  const agreements: RulesetAgreement[] = [];
  let observedRulesets = 0;
  let matched = 0;

  const observationsByRepository = new Map<string, RulesetObservation[]>();
  for (const observation of observations) {
    if (Array.isArray(observation.rulesets)) observedRulesets += observation.rulesets.length;
    const group = observationsByRepository.get(observation.repository) ?? [];
    group.push(observation);
    observationsByRepository.set(observation.repository, group);
  }

  const declaredNames = new Set(declared.map((entry) => entry.repository));
  for (const repository of observationsByRepository.keys()) {
    if (!declaredNames.has(repository)) {
      findings.push({
        kind: "undeclared-repository",
        path: `observed.${printable(repository)}`,
        note: "a readback was supplied for a repository the declaration does not list",
      });
    }
  }

  for (const entry of declared) {
    const repository = entry.repository;
    const group = observationsByRepository.get(repository);
    const observation = group?.[0];
    if (group === undefined || observation === undefined) {
      findings.push({
        kind: "unobserved-repository",
        path: `declared.${repository}`,
        note: `no readback supplied; ${entry.rulesets.length} declared ruleset(s) not compared`,
      });
      continue;
    }
    // Two readbacks of one repository cannot both be the state read: choosing
    // one would hide the other, so neither is compared.
    const read: ReadRulesets =
      group.length > 1
        ? { readable: false, reason: `${group.length} readbacks supplied for this repository` }
        : readRulesets(observation.rulesets);
    if (!read.readable) {
      findings.push({
        kind: "unreadable-observation",
        path: `observed.${repository}.rulesets`,
        note: `${read.reason}; ${entry.rulesets.length} declared ruleset(s) not compared`,
      });
      continue;
    }

    agreements.push({
      path: `declared.${repository}`,
      note: `readback readable, ${read.byName.size} ruleset(s) read`,
    });

    const declaredRulesetNames = new Set<string>();
    for (const ruleset of entry.rulesets) {
      declaredRulesetNames.add(ruleset.name);
      const path = `declared.${repository}.rulesets.${ruleset.name}`;
      const observed = read.byName.get(ruleset.name);
      if (observed === undefined) {
        findings.push({
          kind: "missing-ruleset",
          path,
          note: "declared, absent from the readback",
        });
        continue;
      }
      const differing = differingFields(ruleset, observed);
      if (differing.length > 0) {
        findings.push({
          kind: "ruleset-differs",
          path,
          note: `differs on: ${differing.join(", ")}`,
        });
        continue;
      }
      matched += 1;
      agreements.push({ path, note: `identical on ${COMPARED_FIELDS.join(", ")}` });
    }

    for (const name of read.byName.keys()) {
      if (!declaredRulesetNames.has(name)) {
        findings.push({
          kind: "undeclared-ruleset",
          path: `observed.${repository}.rulesets.${name}`,
          note: "read, absent from the declaration",
        });
      }
    }
  }

  findings.sort(
    (left, right) =>
      byCodeUnit(left.path, right.path) ||
      byCodeUnit(left.kind, right.kind) ||
      byCodeUnit(left.note, right.note),
  );
  agreements.sort((left, right) => byCodeUnit(left.path, right.path));

  return {
    findings,
    agreements,
    counts: {
      declaredRepositories: declared.length,
      observedRepositories: observations.length,
      declaredRulesets: declared.reduce((total, entry) => total + entry.rulesets.length, 0),
      observedRulesets,
      matched,
    },
  };
}

/** The five counters, in one sentence, for the success line. */
export function describeRulesetVolume(counts: RulesetCounts): string {
  return (
    `${counts.declaredRepositories} declared repositories, ` +
    `${counts.observedRepositories} readbacks supplied, ` +
    `${counts.declaredRulesets} declared rulesets, ` +
    `${counts.observedRulesets} rulesets read, ` +
    `${counts.matched} identical`
  );
}

class InputError extends Error {}

interface Arguments {
  readonly declaration: string | null;
  readonly observed: readonly string[];
}

function parseArguments(argv: readonly string[]): Arguments {
  let declaration: string | null = null;
  const observed: string[] = [];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== "--observed" && flag !== "--declaration") {
      throw new InputError(`unknown argument ${String(flag)}`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new InputError(`${flag} expects a file path`);
    }
    if (flag === "--observed") observed.push(value);
    else if (declaration === null) declaration = value;
    else throw new InputError("--declaration given more than once");
  }
  if (observed.length === 0) {
    // Without a readback nothing is compared, and a gate that compares nothing
    // must not look like one that found no drift.
    throw new InputError("no --observed file supplied: nothing to reconcile");
  }
  return { declaration, observed };
}

async function readObservation(path: string): Promise<RulesetObservation> {
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (error) {
    throw new InputError(`${path}: unreadable readback file (${(error as Error).message})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new InputError(`${path}: readback is not JSON (${(error as Error).message})`);
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.repository !== "string" ||
    parsed.repository.length === 0
  ) {
    throw new InputError(`${path}: readback carries no non-empty string \`repository\``);
  }
  if (hasControlCharacter(parsed.repository)) {
    throw new InputError(
      `${path}: readback repository ${JSON.stringify(parsed.repository)} carries a control character`,
    );
  }
  return { repository: parsed.repository, rulesets: parsed.rulesets };
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArguments(argv);
  const declarationSource =
    args.declaration ?? new URL("repository-rulesets.v1.yaml", import.meta.url);
  let declarationText: string;
  try {
    declarationText = await Bun.file(declarationSource).text();
  } catch (error) {
    throw new InputError(`unreadable declaration (${(error as Error).message})`);
  }
  const declared = parseRulesetDeclaration(declarationText);
  const observations: RulesetObservation[] = [];
  for (const path of args.observed) observations.push(await readObservation(path));

  const reconciliation = reconcileRulesets(declared, observations);
  const report = new GateReport();
  for (const agreement of reconciliation.agreements) {
    report.check(agreement.path, true, agreement.note);
  }
  for (const finding of reconciliation.findings) {
    report.check(finding.path, false, `${finding.kind}: ${finding.note}`);
  }
  report.volume(describeRulesetVolume(reconciliation.counts));
  concludeGate("Repository rulesets", report);
}

if (import.meta.main) {
  try {
    await main(Bun.argv.slice(2));
  } catch (error) {
    // Input the gate cannot judge — no readback, an unreadable file, a
    // malformed declaration — is a failure of its own, distinct from drift.
    console.error(`Repository rulesets cannot run: ${(error as Error).message}`);
    process.exit(2);
  }
}
