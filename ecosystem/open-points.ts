/**
 * Pure half of the governance open-points register.
 *
 * `ecosystem/open-points.v1.yaml` records the points governance has left
 * open: a decision still to take, a review pass still expected, an answer
 * awaited from a third party. Until this register they were written in prose
 * only (the « Known gaps » section of the decision register, the open points
 * of a decision record), and nothing checked that one of them had an owner, a
 * closure condition a machine can read, an existing decision once closed, or
 * a fallback when it waits for someone else. A point could stay open for ever
 * without anyone seeing it.
 *
 * WHAT THE REGISTER IS NOT. It is not a second register of decisions: a point
 * that is closed cites the decision that closed it (`clos_par`), and that
 * citation is resolved against `docs/decisions/DECISION-REGISTER.md` (through
 * `parseRegisterDecisions`, the reader the brick map already uses) and against
 * the numbers of `docs/adr/`. Nothing of either is copied here. Nor does it
 * copy the prose of a point: `source` names the tracked file that states it.
 *
 * THE RULES, one verdict each:
 *   - R1: closed root (`schema_version`, `points`) and closed point keys, a
 *     non-empty register, no character the YAML parser reads differently from
 *     a line scan;
 *   - R2: `id` is `point.` then lowercase ASCII words (letters and digits)
 *     joined by single hyphens, and is unique;
 *   - R3: `type`, `proprietaire` and `etat` in their closed lists, and the
 *     role `tiers` only on a `dependance_externe`;
 *   - R4: `condition` is one of the three forms `parseCondition` reads;
 *   - R5: `clos_par` present if and only if the point is `clos`, and the
 *     decision it cites exists;
 *   - R6: a `dependance_externe`, and only it, carries `attendu`,
 *     `critere_acceptation` and `repli`, none of them empty;
 *   - R7: `source` is a tracked path;
 *   - R8: no `ouvert` point whose condition is due.
 *
 * « Overdue » is never written: it is derived. An open point whose condition
 * is due is a violation, treated by closing the point or by renewing its
 * condition. A `merged()` condition whose pull request cannot be read is
 * `unavailable`: not a violation, and never green either (`openPointsExitCode`).
 *
 * Everything arrives by injection — the register text, the decisions, the
 * record numbers, the « tracked path » predicate, the date of the day, the
 * reader of a pull request. Files, the index, the clock and the network are
 * read by `check-open-points.ts` only.
 *
 * What this module does NOT assert: that a key is written once. `Bun.YAML.parse`
 * keeps the last of two identical keys in silence, and the line reading that
 * catches it in the refusals gate (`scanBlockLayout`) is bound to that
 * register's root key. A point whose `etat` is written twice is read at its
 * last value.
 */

import { isIsoDate } from "../tools/quality/check-refusals";
import { GateReport } from "../tools/quality/gate-report";
import { findUnreadableCharacter } from "../tools/quality/yaml-text-guard";

export const REGISTER_PATH = "ecosystem/open-points.v1.yaml";
export const SCHEMA_VERSION = "libre-ai.open-points.v1";

/** What kind of thing is awaited. */
export const TYPES: readonly string[] = ["decision", "relecture", "dependance_externe"];
/** Who owns the point. `tiers` is the outside party, admitted on a `dependance_externe` only. */
export const ROLES: readonly string[] = ["proprietaire", "auteur", "relecteur", "tiers"];
/** The states a point is written in. « Overdue » is derived, never written. */
export const ETATS: readonly string[] = ["ouvert", "clos"];

const EXTERNAL_TYPE = "dependance_externe";
const THIRD_PARTY_ROLE = "tiers";
const ROOT_KEYS: readonly string[] = ["schema_version", "points"];
const REQUIRED_KEYS: readonly string[] = [
  "id",
  "question",
  "type",
  "proprietaire",
  "condition",
  "etat",
  "source",
];
const EXTERNAL_KEYS: readonly string[] = ["attendu", "critere_acceptation", "repli"];
const CLOSED_BY_KEY = "clos_par";
const RULES: readonly string[] = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"];

const ID = /^point\.[a-z0-9]+(-[a-z0-9]+)*$/;
const DECISION = /^D[0-9]{1,4}$/;
const RECORD = /^ADR-([0-9]{4})$/;
const UNTIL = /^until=(\S+)$/;
const ABSENT = /^absent\(([^()\s]+)\)$/;
const MERGED =
  /^merged\(([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+)#([1-9][0-9]{0,8})\)$/;

const CONDITION_FORMS =
  "`until=AAAA-MM-JJ` (date réelle), `absent(<chemin relatif au dépôt>)` ou " +
  "`merged(<propriétaire>/<dépôt>#<n>)`";

export type Condition =
  | { kind: "date"; date: string }
  | { kind: "absent"; path: string }
  | { kind: "merged"; repository: string; number: number };

export type ConditionVerdict = "pending" | "due" | "unavailable";

export interface OpenPointsInput {
  /** The register text; null when it is absent or unreadable. */
  text: string | null;
  /** The `Dnn` identifiers of the decision register. Empty means the register was not read. */
  registerDecisions: ReadonlySet<string>;
  /** The four-digit numbers of the decision records. Empty means they were not read. */
  adrNumbers: ReadonlySet<string>;
  isTracked(path: string): boolean;
  /** The date of the day, `YYYY-MM-DD`. */
  today: string;
  /** Whether the pull request is merged; null when its state cannot be read. */
  pullRequestMerged(repository: string, number: number): Promise<boolean | null>;
}

export interface OpenPointsOutcome {
  report: GateReport;
  /** The counters, which sum; also set on the report. Empty when the register was not read. */
  volume: string;
  /** Open points whose `merged()` condition could not be read. */
  unavailable: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOneOf(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}

/** A path inside the repository: relative, without an empty, `.` or `..` segment. */
function isRepositoryPath(path: string): boolean {
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Read one closure condition; null when it is none of the three forms. */
export function parseCondition(text: string): Condition | null {
  const until = UNTIL.exec(text);
  if (until !== null) {
    const date = until[1] as string;
    return isIsoDate(date) ? { kind: "date", date } : null;
  }
  const absent = ABSENT.exec(text);
  if (absent !== null) {
    const path = absent[1] as string;
    return isRepositoryPath(path) ? { kind: "absent", path } : null;
  }
  const merged = MERGED.exec(text);
  if (merged !== null) {
    return { kind: "merged", repository: merged[1] as string, number: Number(merged[2]) };
  }
  return null;
}

/** Whether the condition has come due, against the injected date, index and forge. */
async function conditionVerdict(
  condition: Condition,
  input: OpenPointsInput,
): Promise<ConditionVerdict> {
  if (condition.kind === "date") {
    // `YYYY-MM-DD` strings order like the dates they name: due from the day after.
    return input.today > condition.date ? "due" : "pending";
  }
  if (condition.kind === "absent") return input.isTracked(condition.path) ? "pending" : "due";
  let merged: boolean | null;
  try {
    merged = await input.pullRequestMerged(condition.repository, condition.number);
  } catch {
    merged = null;
  }
  if (merged === null) return "unavailable";
  return merged ? "due" : "pending";
}

/**
 * The process exit code of an evaluation: 1 on a violation (a malformed
 * register or condition included), 3 when nothing is violated but at least
 * one `merged()` condition could not be read, 0 otherwise. Code 2 (usage) is
 * the entry point's.
 */
export function openPointsExitCode(outcome: OpenPointsOutcome): 0 | 1 | 3 {
  if (outcome.report.outcome !== "pass") return 1;
  return outcome.unavailable > 0 ? 3 : 0;
}

interface Tally {
  open: number;
  closed: number;
  stateless: number;
  date: number;
  absent: number;
  merged: number;
  malformed: number;
  pending: number;
  due: number;
  unavailable: number;
  unjudged: number;
}

/**
 * Judge the register. One assertion per rule that holds; one per problem
 * otherwise, named by its rule and its point.
 */
export async function evaluateOpenPoints(input: OpenPointsInput): Promise<OpenPointsOutcome> {
  const report = new GateReport();
  const refuse = (note: string): OpenPointsOutcome => {
    report.check(`R1 ${REGISTER_PATH}`, false, note);
    return { report, volume: "", unavailable: 0 };
  };

  if (input.text === null) return refuse("registre absent ou illisible");
  const unreadable = findUnreadableCharacter(input.text);
  if (unreadable !== null) {
    return refuse(
      `caractère ${unreadable.codePoint} ligne ${unreadable.line} : le parseur YAML et une ` +
        "lecture par ligne n'y lisent pas le même document",
    );
  }
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(input.text);
  } catch (error) {
    return refuse(`YAML illisible : ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) return refuse("la racine du registre n'est pas une table");
  const points = parsed.points;
  if (!Array.isArray(points)) return refuse("`points` doit être une liste");
  if (points.length === 0) {
    return refuse(
      "le registre ne porte aucun point : une liste vide veut dire qu'il a été vidé ou n'est " +
        "plus lu ; un point traité se ferme (`etat: clos`, `clos_par`), il ne se retire pas",
    );
  }

  const problems = new Map<string, { name: string; note: string }[]>(
    RULES.map((rule) => [rule, []]),
  );
  const fail = (rule: string, name: string, note: string): void => {
    problems.get(rule)?.push({ name, note });
  };

  const unknownRoot = Object.keys(parsed).filter((key) => !ROOT_KEYS.includes(key));
  if (unknownRoot.length > 0) {
    fail("R1", REGISTER_PATH, `clé(s) racine inconnue(s) : ${unknownRoot.join(", ")}`);
  }
  if (parsed.schema_version !== SCHEMA_VERSION) {
    fail("R1", REGISTER_PATH, `schema_version doit valoir exactement ${SCHEMA_VERSION}`);
  }
  // Unreadable is never zero: an empty set is a source that was not read, and a
  // register holding no closed point would otherwise never notice it.
  if (input.registerDecisions.size === 0) {
    fail("R5", REGISTER_PATH, "aucune décision `Dnn` lue dans le registre des décisions");
  }
  if (input.adrNumbers.size === 0) {
    fail("R5", REGISTER_PATH, "aucun numéro d'ADR lu dans docs/adr/");
  }
  if (!isIsoDate(input.today)) {
    fail("R8", REGISTER_PATH, `la date du jour '${input.today}' n'est pas une date AAAA-MM-JJ`);
  }

  const tally: Tally = {
    open: 0,
    closed: 0,
    stateless: 0,
    date: 0,
    absent: 0,
    merged: 0,
    malformed: 0,
    pending: 0,
    due: 0,
    unavailable: 0,
    unjudged: 0,
  };
  const seenIds = new Set<string>();

  for (const [index, point] of points.entries()) {
    // An id names the point only once it passes its form: an empty or
    // multi-line id would otherwise blank or split the report line.
    const name =
      isRecord(point) && typeof point.id === "string" && ID.test(point.id)
        ? point.id
        : `points[${index}]`;
    if (!isRecord(point)) {
      fail("R1", name, "un point est une table");
      tally.stateless += 1;
      tally.malformed += 1;
      continue;
    }
    const has = (key: string): boolean => Object.hasOwn(point, key);

    // R1 — closed keys.
    const known = [...REQUIRED_KEYS, CLOSED_BY_KEY, ...EXTERNAL_KEYS];
    const unknown = Object.keys(point).filter((key) => !known.includes(key));
    if (unknown.length > 0) fail("R1", name, `clé(s) inconnue(s) : ${unknown.join(", ")}`);
    const missing = REQUIRED_KEYS.filter((key) => !has(key));
    if (missing.length > 0) fail("R1", name, `champ(s) requis absent(s) : ${missing.join(", ")}`);
    if (has("question") && !isNonEmptyString(point.question)) {
      fail("R1", name, "`question` doit être une chaîne non vide");
    }

    // R2 — identifier.
    if (has("id")) {
      if (!(typeof point.id === "string" && ID.test(point.id))) {
        fail(
          "R2",
          name,
          "`id` doit s'écrire `point.<mot>[-<mot>…]`, mots en minuscules ASCII et chiffres " +
            "(^point\\.[a-z0-9]+(-[a-z0-9]+)*$)",
        );
      } else if (seenIds.has(point.id)) {
        fail("R2", name, `\`id\` en double : ${point.id}`);
      } else {
        seenIds.add(point.id);
      }
    }

    // R3 — closed vocabularies.
    if (has("type") && !isOneOf(TYPES, point.type)) {
      fail("R3", name, `\`type\` doit valoir l'un de : ${TYPES.join(", ")}`);
    }
    if (has("proprietaire") && !isOneOf(ROLES, point.proprietaire)) {
      fail("R3", name, `\`proprietaire\` doit valoir l'un de : ${ROLES.join(", ")}`);
    }
    if (point.proprietaire === THIRD_PARTY_ROLE && point.type !== EXTERNAL_TYPE) {
      fail(
        "R3",
        name,
        `le rôle \`${THIRD_PARTY_ROLE}\` n'est admis que pour le type \`${EXTERNAL_TYPE}\``,
      );
    }
    const open = point.etat === "ouvert";
    const closed = point.etat === "clos";
    if (open) tally.open += 1;
    else if (closed) tally.closed += 1;
    else tally.stateless += 1;
    if (has("etat") && !isOneOf(ETATS, point.etat)) {
      fail("R3", name, `\`etat\` doit valoir l'un de : ${ETATS.join(", ")}`);
    }

    // R4 — closure condition.
    const condition = typeof point.condition === "string" ? parseCondition(point.condition) : null;
    if (condition === null) {
      tally.malformed += 1;
      if (has("condition")) {
        fail(
          "R4",
          name,
          `condition malformée '${String(point.condition)}' : attendu ${CONDITION_FORMS}`,
        );
      }
    } else {
      tally[condition.kind] += 1;
    }

    // R5 — the decision that closed the point.
    if (closed && !has(CLOSED_BY_KEY)) {
      fail("R5", name, "un point `clos` nomme la décision qui l'a clos dans `clos_par`");
    }
    if (has(CLOSED_BY_KEY)) {
      const closedBy = point[CLOSED_BY_KEY];
      if (!closed) fail("R5", name, "`clos_par` ne s'écrit que sur un point `clos`");
      const record = typeof closedBy === "string" ? RECORD.exec(closedBy) : null;
      if (typeof closedBy === "string" && DECISION.test(closedBy)) {
        if (!input.registerDecisions.has(closedBy)) {
          fail("R5", name, `\`clos_par\` cite ${closedBy}, absent du registre des décisions`);
        }
      } else if (record !== null) {
        if (!input.adrNumbers.has(record[1] as string)) {
          fail("R5", name, `\`clos_par\` cite ${record[0]}, absent de docs/adr/`);
        }
      } else {
        fail("R5", name, "`clos_par` doit s'écrire `Dnn` ou `ADR-NNNN`");
      }
    }

    // R6 — what an external dependency says, and only it.
    if (point.type === EXTERNAL_TYPE) {
      for (const key of EXTERNAL_KEYS) {
        if (!isNonEmptyString(point[key])) {
          fail("R6", name, `une \`${EXTERNAL_TYPE}\` porte \`${key}\`, chaîne non vide`);
        }
      }
    } else {
      const reserved = EXTERNAL_KEYS.filter((key) => has(key));
      if (reserved.length > 0) {
        fail("R6", name, `${reserved.join(", ")} : réservé(s) au type \`${EXTERNAL_TYPE}\``);
      }
    }

    // R7 — where the point is stated.
    if (has("source") && !(isNonEmptyString(point.source) && input.isTracked(point.source))) {
      fail("R7", name, `\`source\` '${String(point.source)}' n'est pas un chemin suivi par git`);
    }

    // R8 — an open point whose condition has come due. A closed point is not
    // asked: its condition no longer decides anything, and costs no request.
    if (!open) continue;
    if (condition === null) {
      tally.unjudged += 1;
      continue;
    }
    const verdict = await conditionVerdict(condition, input);
    tally[verdict] += 1;
    if (verdict === "due") {
      fail(
        "R8",
        name,
        `point \`ouvert\` dont la condition '${String(point.condition)}' est échue : le fermer ` +
          "(`etat: clos`, `clos_par`) ou renouveler sa condition",
      );
    }
  }

  const notes: Readonly<Record<string, string>> = {
    R1: `racine et clés fermées sur ${points.length} point(s)`,
    R2: `${seenIds.size} identifiant(s) de la bonne forme, tous distincts`,
    R3: `type, proprietaire et etat dans leurs listes (${TYPES.length}, ${ROLES.length}, ${ETATS.length})`,
    R4: `${tally.date + tally.absent + tally.merged} condition(s) lisible(s)`,
    R5: `${tally.closed} point(s) clos, chacun par une décision existante`,
    R6: `champs de \`${EXTERNAL_TYPE}\` présents là, et là seulement`,
    R7: "chaque `source` est un chemin suivi",
    R8: `aucun point ouvert échu (${tally.unavailable} illisible(s))`,
  };
  for (const rule of RULES) {
    const found = problems.get(rule) ?? [];
    if (found.length === 0) report.check(rule, true, notes[rule] as string);
    for (const { name, note } of found) report.check(`${rule} ${name}`, false, note);
  }

  const volume =
    `${points.length} point(s) = ${tally.open} ouvert(s) + ${tally.closed} clos + ` +
    `${tally.stateless} sans état lisible ; ${points.length} condition(s) = ${tally.date} date + ` +
    `${tally.absent} absent + ${tally.merged} merged + ${tally.malformed} malformée(s) ; ` +
    `${tally.open} condition(s) de point ouvert = ${tally.pending} pending + ${tally.due} due + ` +
    `${tally.unavailable} unavailable + ${tally.unjudged} sans verdict`;
  report.volume(volume);
  return { report, volume, unavailable: tally.unavailable };
}
