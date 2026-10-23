/**
 * Shape gate of the fleet refusals register (ADR-0056 D4, named follow-up).
 *
 * `ecosystem/refusals.v1.yaml` records the third-party projects, tools and
 * dependencies the fleet evaluated and turned down, so that the next session
 * reads the motive before proposing them again. Until this gate, nothing read
 * the file: ADR-0056 "Conséquences" wrote it down as a limit ("aucun contrôle
 * ne vérifie sa forme"). A refusal whose evidence is not a public, pinned or
 * dated proof is exactly the entry D4 says must not be written, and nothing
 * told it apart from a well-formed one.
 *
 * What this gate asserts, from the format written in the register's header
 * and in ADR-0056 D4:
 *   - the root carries `schema_version: libre-ai.refusals.v1` and `refusals`,
 *     and nothing else;
 *   - every entry carries the fields of the format and no other key: `id`
 *     (prefixed `refusal.`, unique), `subject`, `source` (https URL),
 *     `revision` (absent, null, or `<owner>/<repository>@<sha>`), `action` and
 *     `origin` in their closed vocabularies, `decided_on` (a real ISO 8601
 *     calendar date), `reason`, `evidence` and `reexamine_when` (a string or
 *     null, always written);
 *   - every evidence is a pinned citation
 *     `<owner>/<repository>@<sha>:<path>:<lines>` or an https URL followed by
 *     its consultation date, written `<url> (consultée le YYYY-MM-DD)` as the
 *     entries of the register write it;
 *   - the register is non-empty: it was seeded with entries by ADR-0056, so an
 *     empty list means it was emptied or is no longer read, never that the
 *     fleet refused nothing.
 *
 * Fail closed, never zero: an absent or unreadable register, a character the
 * YAML parser reads differently from a line scan (`yaml-text-guard`), a parse
 * error, or an exemption file that does not validate is a failure.
 *
 * Duplicate keys. `Bun.YAML.parse` keeps the last of two identical keys
 * without saying so (measured with Bun 1.4.4: `c: 1` then `c: 2` parses to
 * `{ c: 2 }`), so an entry carrying two `reason:` would lose the first one
 * silently. The register is therefore also read line by line, in the block
 * style it is written in, and no key may appear twice there. A line in any
 * other style (a quoted or explicit key, a flow mapping) is refused rather
 * than half read, since a duplicate could hide in it (`scanBlockLayout`).
 *
 * Exemptions live in data (`tools/quality/refusals-exemptions.v1.json`), each
 * with its reason, and are printed on the success line. An exemption only
 * covers an evidence that fails the form above; one that covers nothing fails,
 * so it cannot outlive the divergence it records.
 *
 * What this gate does NOT assert: that the evidence establishes the motive,
 * that a pinned citation resolves, or that the refusal belongs in this
 * register rather than in `vision.md` §28. Those stay review matters.
 */

import { concludeGate, GateReport } from "./gate-report";
import { findUnreadableCharacter } from "./yaml-text-guard";

export const REGISTER_PATH = "ecosystem/refusals.v1.yaml";
export const EXEMPTIONS_PATH = "tools/quality/refusals-exemptions.v1.json";
export const SCHEMA_VERSION = "libre-ai.refusals.v1";

export const ACTIONS: readonly string[] = ["install", "depend", "reuse-code", "use-service"];
export const ORIGINS: readonly string[] = ["observed", "inspection", "synthetic", "proposal"];

const ROOT_KEYS: readonly string[] = ["schema_version", "refusals"];
const REQUIRED_ENTRY_KEYS: readonly string[] = [
  "id",
  "subject",
  "source",
  "action",
  "origin",
  "decided_on",
  "reason",
  "evidence",
  "reexamine_when",
];
const OPTIONAL_ENTRY_KEYS: readonly string[] = ["revision"];

const ID = /^refusal\.\S+$/;
const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
const REPOSITORY = "[A-Za-z0-9._-]+";
const SHA = "[0-9a-f]{7,40}";
const REVISION = new RegExp(`^${OWNER}/${REPOSITORY}@${SHA}$`);
const PINNED_CITATION = new RegExp(
  `^${OWNER}/(${REPOSITORY})@${SHA}:(?<path>[^:\\s]+):(?<lines>[^:\\s]+)$`,
);
const LINE_SPEC = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;
const DATED_URL = /^(?<url>\S+) \(consultée le (?<date>\d{4}-\d{2}-\d{2})\)$/;

export const EMPTY_REGISTER_NOTE =
  "le registre ne porte aucune entrée : il a été amorcé par ADR-0056 D4, donc une liste vide " +
  "veut dire qu'il a été vidé ou n'est plus lu, jamais que la flotte n'a rien refusé ; retirer " +
  "une entrée est une décision du propriétaire, qui n'en retire pas toutes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A real calendar date written `YYYY-MM-DD`: `2026-02-30` is refused.
 *
 * The round trip is the whole test: only a string equal to the first ten
 * characters of an ISO timestamp survives it, so no shape regex precedes it
 * (one did, and a substitution mutant removing it left every test green).
 */
export function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** An absolute https URL written without whitespace. */
export function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string" || /\s/.test(value)) return false;
  const url = URL.parse(value);
  return url !== null && url.protocol === "https:" && url.hostname.length > 0;
}

/** Null when the path names a file inside a repository, else why not. */
function pathProblem(path: string): string | null {
  if (path.startsWith("/")) return "le chemin est absolu";
  for (const segment of path.split("/")) {
    if (segment === "") return "le chemin porte un segment vide";
    if (segment === "." || segment === "..") return `le chemin porte un segment '${segment}'`;
  }
  return null;
}

/** Null when `lines` is `L`, `a-b` or a comma list of those, 1-based and ordered. */
function linesProblem(lines: string): string | null {
  if (!LINE_SPEC.test(lines)) return `'${lines}' n'est pas une spécification de lignes`;
  for (const item of lines.split(",")) {
    const [startText, endText] = item.split("-");
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    if (start < 1 || end < start) return `l'intervalle '${item}' ne désigne aucune ligne`;
  }
  return null;
}

export type EvidenceForm =
  | { readonly kind: "pinned" }
  | { readonly kind: "dated-url" }
  | { readonly kind: "invalid"; readonly reason: string };

/** Classify one evidence item against the two forms the register admits. */
export function classifyEvidence(evidence: unknown): EvidenceForm {
  if (typeof evidence !== "string") {
    return { kind: "invalid", reason: "une preuve est une chaîne" };
  }
  const pinned = PINNED_CITATION.exec(evidence);
  if (pinned?.groups !== undefined) {
    const repository = pinned[1];
    if (repository === "." || repository === "..") {
      return { kind: "invalid", reason: `'${repository}' n'est pas un nom de dépôt` };
    }
    const problem =
      pathProblem(pinned.groups.path ?? "") ?? linesProblem(pinned.groups.lines ?? "");
    return problem === null ? { kind: "pinned" } : { kind: "invalid", reason: problem };
  }
  const dated = DATED_URL.exec(evidence);
  if (dated?.groups !== undefined) {
    if (!isHttpsUrl(dated.groups.url)) {
      return { kind: "invalid", reason: `'${dated.groups.url}' n'est pas une URL https` };
    }
    if (!isIsoDate(dated.groups.date)) {
      return {
        kind: "invalid",
        reason: `la date de consultation '${dated.groups.date}' n'est pas une date ISO 8601 valide`,
      };
    }
    return { kind: "dated-url" };
  }
  return {
    kind: "invalid",
    reason:
      "ni citation épinglée `<propriétaire>/<dépôt>@<sha>:<chemin>:<lignes>`, ni URL https " +
      "suivie de « (consultée le AAAA-MM-JJ) »",
  };
}

export interface EvidenceExemption {
  readonly id: string;
  readonly evidence: string;
  readonly because: string;
}

/** Validate the exemption file; throws on any deviation, so the gate fails closed. */
export function validateExemptions(value: unknown): readonly EvidenceExemption[] {
  const where = EXEMPTIONS_PATH;
  if (!isRecord(value) || !Array.isArray(value.exemptions)) {
    throw new Error(`${where}: attendu { "exemptions": [...] }`);
  }
  const extra = Object.keys(value).filter((key) => key !== "exemptions");
  if (extra.length > 0) throw new Error(`${where}: clé(s) inconnue(s) : ${extra.join(", ")}`);
  const seen = new Set<string>();
  const exemptions: EvidenceExemption[] = [];
  for (const item of value.exemptions) {
    if (!isRecord(item)) throw new Error(`${where}: une exemption est un objet`);
    const unknown = Object.keys(item).filter((key) => !["id", "evidence", "because"].includes(key));
    if (unknown.length > 0) {
      throw new Error(`${where}: clé(s) inconnue(s) d'exemption : ${unknown.join(", ")}`);
    }
    const { id, evidence, because } = item;
    if (!isNonEmptyString(id) || !isNonEmptyString(evidence) || !isNonEmptyString(because)) {
      throw new Error(`${where}: chaque exemption porte id, evidence et because non vides`);
    }
    const key = `${id}\n${evidence}`;
    if (seen.has(key)) throw new Error(`${where}: exemption en double : ${id} ← ${evidence}`);
    seen.add(key);
    exemptions.push({ id, evidence, because });
  }
  return exemptions;
}

/** The keys the register writes, read line by line in its block style. */
export interface BlockLayout {
  readonly rootKeys: readonly string[];
  readonly entryKeys: readonly (readonly string[])[];
  /** 1-based lines of the shape below that are none of the admitted forms. */
  readonly unreadLines: readonly number[];
}

const ROOT_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;
const ENTRY_START = /^ {2}- ([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;
const ENTRY_KEY = /^ {4}([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;
const NESTED_CONTENT = /^ {5,}\S/;

/**
 * Independent reading of the keys, so a key written twice — which the parser
 * resolves silently to its last value — is seen.
 *
 * The scan is a whitelist, not a key detector: YAML can also write a key
 * quoted, escaped, as an explicit `? key` or in a flow mapping, and a scan
 * that only recognised the bare form would miss a duplicate written in any
 * other one. So every line is one of: blank; a comment; a bare root key in
 * column 0; and, under `refusals`, an entry opened by `  - <key>:` in column
 * 2, a bare entry key in column 4, or nested content indented five spaces or
 * more (block scalars and evidence items). Any other line is unread, and an
 * unread line fails the register: entry keys can only sit in column 4, and
 * every column-4 line is read. The value of a root key other than `refusals`
 * is not read; that key already fails as unknown.
 */
export function scanBlockLayout(text: string): BlockLayout {
  const rootKeys: string[] = [];
  const entryKeys: string[][] = [];
  const unreadLines: number[] = [];
  let currentRoot: string | null = null;
  text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .forEach((line, index) => {
      if (line.trim() === "" || line.trimStart().startsWith("#")) return;
      if (!line.startsWith(" ")) {
        const root = ROOT_KEY.exec(line);
        if (root?.[1] === undefined) {
          unreadLines.push(index + 1);
          return;
        }
        currentRoot = root[1];
        rootKeys.push(root[1]);
        return;
      }
      if (currentRoot !== "refusals") return;
      const start = ENTRY_START.exec(line);
      if (start?.[1] !== undefined) {
        entryKeys.push([start[1]]);
        return;
      }
      const key = ENTRY_KEY.exec(line);
      const open = entryKeys.at(-1);
      if (key?.[1] !== undefined && open !== undefined) {
        open.push(key[1]);
        return;
      }
      if (NESTED_CONTENT.test(line) && open !== undefined) return;
      unreadLines.push(index + 1);
    });
  return { rootKeys, entryKeys, unreadLines };
}

function duplicatesOf(keys: readonly string[]): string[] {
  return [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
}

/** The problems of one entry's fields, in the order of the format. */
function fieldProblems(entry: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const keys = Object.keys(entry);
  const unknown = keys.filter(
    (key) => !REQUIRED_ENTRY_KEYS.includes(key) && !OPTIONAL_ENTRY_KEYS.includes(key),
  );
  if (unknown.length > 0) problems.push(`clé(s) inconnue(s) : ${unknown.join(", ")}`);
  const missing = REQUIRED_ENTRY_KEYS.filter((key) => !Object.hasOwn(entry, key));
  if (missing.length > 0) problems.push(`champ(s) requis absent(s) : ${missing.join(", ")}`);

  if (Object.hasOwn(entry, "id") && !(typeof entry.id === "string" && ID.test(entry.id))) {
    problems.push("`id` doit être préfixé `refusal.` et sans espace");
  }
  if (Object.hasOwn(entry, "subject") && !isNonEmptyString(entry.subject)) {
    problems.push("`subject` doit être une chaîne non vide");
  }
  if (Object.hasOwn(entry, "source") && !isHttpsUrl(entry.source)) {
    problems.push("`source` doit être une URL https");
  }
  const revision = entry.revision;
  if (revision !== undefined && revision !== null) {
    if (!(typeof revision === "string" && REVISION.test(revision))) {
      problems.push("`revision` doit être absent, null ou `<propriétaire>/<dépôt>@<sha>`");
    }
  }
  if (Object.hasOwn(entry, "action") && !ACTIONS.includes(entry.action as string)) {
    problems.push(`\`action\` doit valoir l'un de : ${ACTIONS.join(", ")}`);
  }
  if (Object.hasOwn(entry, "origin") && !ORIGINS.includes(entry.origin as string)) {
    problems.push(`\`origin\` doit valoir l'un de : ${ORIGINS.join(", ")}`);
  }
  if (Object.hasOwn(entry, "decided_on") && !isIsoDate(entry.decided_on)) {
    problems.push("`decided_on` doit être une date ISO 8601 valide (AAAA-MM-JJ)");
  }
  if (Object.hasOwn(entry, "reason") && !isNonEmptyString(entry.reason)) {
    problems.push("`reason` doit être une chaîne non vide");
  }
  if (
    Object.hasOwn(entry, "evidence") &&
    !(Array.isArray(entry.evidence) && entry.evidence.length > 0)
  ) {
    problems.push("`evidence` doit être une liste non vide");
  }
  const reexamine = entry.reexamine_when;
  if (
    Object.hasOwn(entry, "reexamine_when") &&
    reexamine !== null &&
    !isNonEmptyString(reexamine)
  ) {
    problems.push("`reexamine_when` doit être une chaîne non vide ou null");
  }
  return problems;
}

interface Tally {
  entriesOk: number;
  entriesBad: number;
  pinned: number;
  datedUrls: number;
  exempted: string[];
  evidenceBad: number;
}

/**
 * Pure verdict over the register text and the exemptions.
 *
 * One assertion per entry that holds, named by its id; one per problem
 * otherwise, so a failure says which entry broke and why.
 */
export function evaluateRefusals(
  text: string,
  exemptions: readonly EvidenceExemption[],
): GateReport {
  const report = new GateReport();
  const unreadable = findUnreadableCharacter(text);
  if (unreadable !== null) {
    report.check(
      REGISTER_PATH,
      false,
      `caractère ${unreadable.codePoint} ligne ${unreadable.line} : le parseur YAML et une lecture ` +
        "par ligne n'y lisent pas le même document",
    );
    return report;
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch (error) {
    report.check(REGISTER_PATH, false, `YAML illisible : ${(error as Error).message}`);
    return report;
  }
  if (!isRecord(parsed)) {
    report.check(REGISTER_PATH, false, "la racine du registre n'est pas une table");
    return report;
  }

  const layout = scanBlockLayout(text);
  const unknownRoot = Object.keys(parsed).filter((key) => !ROOT_KEYS.includes(key));
  if (unknownRoot.length > 0) {
    report.check(REGISTER_PATH, false, `clé(s) racine inconnue(s) : ${unknownRoot.join(", ")}`);
  }
  const rootTwice = duplicatesOf(layout.rootKeys);
  if (rootTwice.length > 0) {
    report.check(
      REGISTER_PATH,
      false,
      `clé(s) racine écrite(s) deux fois : ${rootTwice.join(", ")}`,
    );
  }
  report.check(
    REGISTER_PATH,
    parsed.schema_version === SCHEMA_VERSION,
    parsed.schema_version === SCHEMA_VERSION
      ? `schema_version ${SCHEMA_VERSION}`
      : `schema_version doit valoir exactement ${SCHEMA_VERSION}`,
  );

  const entries = parsed.refusals;
  if (!Array.isArray(entries)) {
    report.check(REGISTER_PATH, false, "`refusals` doit être une liste");
    return report;
  }
  if (entries.length === 0) {
    report.check(REGISTER_PATH, false, EMPTY_REGISTER_NOTE);
    return report;
  }
  if (layout.unreadLines.length > 0) {
    report.check(
      REGISTER_PATH,
      false,
      `ligne(s) ${layout.unreadLines.join(", ")} hors du style bloc que ce gate relit (clé nue en ` +
        "colonne 0 ou 4, entrée ouverte par `  - <clé>:`, contenu imbriqué à cinq espaces ou plus) : " +
        "une clé écrite deux fois sous une autre forme y échapperait à la lecture par ligne",
    );
  }

  const tally: Tally = {
    entriesOk: 0,
    entriesBad: 0,
    pinned: 0,
    datedUrls: 0,
    exempted: [],
    evidenceBad: 0,
  };
  const usedExemptions = new Set<EvidenceExemption>();
  const seenIds = new Set<string>();

  entries.forEach((entry, index) => {
    const name = isRecord(entry) && typeof entry.id === "string" ? entry.id : `refusals[${index}]`;
    if (!isRecord(entry)) {
      report.check(name, false, "une entrée est une table");
      tally.entriesBad += 1;
      return;
    }
    const problems = fieldProblems(entry);

    const twice = duplicatesOf(layout.entryKeys[index] ?? []);
    if (twice.length > 0) {
      problems.push(
        `clé(s) écrite(s) deux fois, le parseur ne garde que la dernière : ${twice.join(", ")}`,
      );
    }

    if (typeof entry.id === "string") {
      if (seenIds.has(entry.id)) problems.push(`\`id\` en double : ${entry.id}`);
      seenIds.add(entry.id);
    }

    const evidence: readonly unknown[] = Array.isArray(entry.evidence) ? entry.evidence : [];
    for (const item of evidence) {
      const form = classifyEvidence(item);
      if (form.kind === "pinned") {
        tally.pinned += 1;
      } else if (form.kind === "dated-url") {
        tally.datedUrls += 1;
      } else {
        const exemption = exemptions.find(
          (candidate) => candidate.id === entry.id && candidate.evidence === item,
        );
        if (exemption !== undefined) {
          usedExemptions.add(exemption);
          tally.exempted.push(`${exemption.id} ← ${exemption.evidence}`);
        } else {
          tally.evidenceBad += 1;
          problems.push(`preuve hors forme '${String(item)}' : ${form.reason}`);
        }
      }
    }

    if (problems.length === 0) {
      tally.entriesOk += 1;
      report.check(
        name,
        true,
        `${String(entry.action)}, ${String(entry.origin)}, décidé le ${String(entry.decided_on)}, ` +
          `${evidence.length} preuve(s)`,
      );
    } else {
      tally.entriesBad += 1;
      for (const problem of problems) report.check(name, false, problem);
    }
  });

  for (const exemption of exemptions) {
    if (usedExemptions.has(exemption)) continue;
    report.check(
      EXEMPTIONS_PATH,
      false,
      `exemption inutilisée : ${exemption.id} ← ${exemption.evidence} ne couvre aucune preuve ` +
        "hors forme du registre ; la retirer",
    );
  }

  const evidenceTotal = tally.pinned + tally.datedUrls + tally.exempted.length + tally.evidenceBad;
  const exempted = tally.exempted.length > 0 ? ` (${tally.exempted.join("; ")})` : "";
  report.volume(
    `${entries.length} entrée(s) examinée(s) = ${tally.entriesOk} conforme(s) + ` +
      `${tally.entriesBad} en défaut ; ${evidenceTotal} preuve(s) = ${tally.pinned} citation(s) ` +
      `épinglée(s) + ${tally.datedUrls} URL datée(s) + ${tally.exempted.length} exemptée(s)` +
      `${exempted} + ${tally.evidenceBad} hors forme`,
  );
  return report;
}

/**
 * Read both files and judge them. An absent or unreadable file is a named
 * failure, never an empty register.
 */
export async function evaluateRefusalsFiles(
  registerPath: string,
  exemptionsPath: string,
): Promise<GateReport> {
  let exemptions: readonly EvidenceExemption[];
  try {
    exemptions = validateExemptions(JSON.parse(await Bun.file(exemptionsPath).text()));
  } catch (error) {
    return new GateReport().check(
      exemptionsPath,
      false,
      `fichier d'exemptions absent ou illisible : ${(error as Error).message}`,
    );
  }
  let text: string;
  try {
    text = await Bun.file(registerPath).text();
  } catch (error) {
    return new GateReport().check(
      registerPath,
      false,
      `registre absent ou illisible : ${(error as Error).message}`,
    );
  }
  return evaluateRefusals(text, exemptions);
}

if (import.meta.main) {
  concludeGate("Refusals register", await evaluateRefusalsFiles(REGISTER_PATH, EXEMPTIONS_PATH));
}
