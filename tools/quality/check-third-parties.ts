/**
 * Shape and due-date gate of the third-party exit register (ADR-0070, proposed).
 *
 * `ecosystem/third-parties.v1.yaml` lists the services the fleet depends on,
 * each with a dated exit exercise and the tracked file that describes it. A
 * service with no exit plan, or an exercise whose date went by with nothing
 * recorded, is what this gate tells apart from a kept commitment.
 *
 * It reads declarations and runs no procedure: an execution date is a claim
 * written by a person, and nothing here proves the exercise took place.
 *
 * Not wired into `bun run check`: ADR-0070 is proposed, and the dates of the
 * register are the owner's commitments only once it is accepted. The command
 * is `bun run check:third-parties`.
 *
 * Fail closed, never zero: an absent or unreadable register, a character the
 * YAML parser reads differently from a line scan (`yaml-text-guard`), a parse
 * error, an empty list, or a tracked-file listing that cannot be read is a
 * named failure.
 *
 * Two readings that must agree. `Bun.YAML.parse` keeps the last of two
 * identical keys without saying so, so an entry carrying two `planned_on`
 * would lose the first in silence. The register is therefore also read line by
 * line, by a whitelist of the block style it is written in: a key written
 * twice fails, and both readings must count the same entries. A line outside
 * the whitelist fails the register: a key written quoted or as `? key` would
 * otherwise escape the scan.
 *
 * Dates compare as `YYYY-MM-DD` strings in UTC. `now` is a parameter; the clock
 * is read at the entry point only.
 */

import { parseStagedEntries } from "./check-data-inventory";
import { isIsoDate } from "./check-refusals";
import { concludeGate, GateReport } from "./gate-report";
import { readGit } from "./git-diff";
import { findUnreadableCharacter } from "./yaml-text-guard";

export const REGISTER_PATH = "ecosystem/third-parties.v1.yaml";
export const SCHEMA_VERSION = "libre-ai.third-parties.v1";

const ROOT_KEYS: readonly string[] = ["schema_version", "third_parties"];
const ENTRY_KEYS: readonly string[] = ["id", "subject", "exit_exercise"];
const EXERCISE_KEYS: readonly string[] = ["planned_on", "procedure", "last_executed_on"];

const ID = /^third-party\.[a-z0-9]+(-[a-z0-9]+)*$/;
const REGULAR_FILE_MODE = /^100[0-7]{3}$/;

const ROOT_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;
const ENTRY_START = /^ {2}- ([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;
const ENTRY_KEY = /^ {4}([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;
const EXERCISE_OPENER = /^ {4}exit_exercise:\s*(?:#.*)?$/;
const EXERCISE_KEY = /^ {6}([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;

const EMPTY_REGISTER_NOTE =
  "le registre ne porte aucune entrée : une liste vide veut dire qu'il a été vidé ou n'est plus " +
  "lu, jamais que la flotte ne dépend d'aucun tiers";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function duplicatesOf(keys: readonly string[]): string[] {
  return [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
}

/** Distinct keys, sorted, as one comparable and printable string. */
function keySet(keys: readonly string[]): string {
  return [...new Set(keys)].sort().join(", ");
}

interface EntryLayout {
  readonly keys: string[];
  readonly exerciseKeys: string[];
}

interface RegisterLayout {
  readonly rootKeys: readonly string[];
  readonly entries: readonly EntryLayout[];
  /** 1-based lines that are none of the admitted forms. */
  readonly unreadLines: readonly number[];
}

/**
 * Independent reading of the keys, compared with the parser's.
 *
 * Every line is one of: blank; a comment; a bare root key in column 0; under
 * `third_parties`, an entry opened by `  - <key>:` in column 2, a bare entry
 * key in column 4, or, under `exit_exercise:` written alone on its line, a
 * bare key in column 6. Any other line is unread, and an unread line fails.
 */
function scanLayout(text: string): RegisterLayout {
  const rootKeys: string[] = [];
  const entries: EntryLayout[] = [];
  const unreadLines: number[] = [];
  let inList = false;
  let inExercise = false;
  text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .forEach((line, index) => {
      const number = index + 1;
      if (line.trim() === "" || line.trimStart().startsWith("#")) return;
      const root = ROOT_KEY.exec(line);
      if (root?.[1] !== undefined) {
        rootKeys.push(root[1]);
        inList = root[1] === "third_parties";
        inExercise = false;
        return;
      }
      const open = entries.at(-1);
      const start = inList ? ENTRY_START.exec(line) : null;
      if (start?.[1] !== undefined) {
        entries.push({ keys: [start[1]], exerciseKeys: [] });
        inExercise = false;
        return;
      }
      const key = inList ? ENTRY_KEY.exec(line) : null;
      if (key?.[1] !== undefined && open !== undefined) {
        open.keys.push(key[1]);
        inExercise = EXERCISE_OPENER.test(line);
        if (key[1] === "exit_exercise" && !inExercise) unreadLines.push(number);
        return;
      }
      const nested = inExercise ? EXERCISE_KEY.exec(line) : null;
      if (nested?.[1] !== undefined && open !== undefined) {
        open.exerciseKeys.push(nested[1]);
        return;
      }
      unreadLines.push(number);
    });
  return { rootKeys, entries, unreadLines };
}

interface Tally {
  past: number;
  upcoming: number;
  undated: number;
}

/** The problems of one `exit_exercise`, and the count its due date falls in. */
function exerciseProblems(
  exercise: Record<string, unknown>,
  trackedFiles: ReadonlySet<string>,
  today: string,
  tally: Tally,
): string[] {
  const problems: string[] = [];
  const unknown = Object.keys(exercise).filter((key) => !EXERCISE_KEYS.includes(key));
  if (unknown.length > 0) problems.push(`clé(s) inconnue(s) : ${unknown.join(", ")}`);

  const planned = exercise.planned_on;
  const plannedIsReadable = isIsoDate(planned);
  if (!plannedIsReadable) {
    problems.push(`\`planned_on\` '${String(planned)}' n'est pas une date AAAA-MM-JJ réelle`);
  }

  const procedure = exercise.procedure;
  if (!isNonEmptyString(procedure)) {
    problems.push("`procedure` doit nommer un fichier suivi du dépôt");
  } else if (!trackedFiles.has(procedure)) {
    problems.push(`\`procedure\` '${procedure}' n'est pas un fichier régulier suivi du dépôt`);
  }

  const executed = exercise.last_executed_on;
  const executedIsDate = isIsoDate(executed);
  if (!Object.hasOwn(exercise, "last_executed_on")) {
    problems.push("`last_executed_on` s'écrit toujours : une date AAAA-MM-JJ ou null");
  } else if (executed !== null && !executedIsDate) {
    problems.push(`\`last_executed_on\` '${String(executed)}' n'est ni null ni une date réelle`);
  } else if (executedIsDate && (executed as string) > today) {
    problems.push(`\`last_executed_on\` ${String(executed)} est postérieure au ${today}`);
  }

  if (!plannedIsReadable) {
    tally.undated += 1;
    return problems;
  }
  // `YYYY-MM-DD` strings order like the dates they name, once isIsoDate holds.
  if ((planned as string) >= today) {
    tally.upcoming += 1;
    return problems;
  }
  tally.past += 1;
  if (executed === null || (executedIsDate && (executed as string) < (planned as string))) {
    problems.push(
      `exercice prévu le ${String(planned)} sans exécution enregistrée entre cette date et le ${today}`,
    );
  }
  return problems;
}

/** The problems of one entry, in the order of the format. */
function entryProblems(
  entry: Record<string, unknown>,
  written: EntryLayout | undefined,
  trackedFiles: ReadonlySet<string>,
  today: string,
  tally: Tally,
): string[] {
  const problems: string[] = [];
  const keys = Object.keys(entry);
  const unknown = keys.filter((key) => !ENTRY_KEYS.includes(key));
  if (unknown.length > 0) problems.push(`clé(s) inconnue(s) : ${unknown.join(", ")}`);
  if (!(typeof entry.id === "string" && ID.test(entry.id))) {
    problems.push(
      "`id` doit s'écrire `third-party.<mot>[-<mot>…]`, en minuscules ASCII et chiffres",
    );
  }
  if (!isNonEmptyString(entry.subject)) problems.push("`subject` doit être une chaîne non vide");

  if (written !== undefined) {
    const twice = duplicatesOf([...written.keys, ...written.exerciseKeys]);
    if (twice.length > 0) {
      problems.push(
        `clé(s) écrite(s) deux fois, le parseur ne garde que la dernière : ${twice.join(", ")}`,
      );
    }
  }

  // The line reading admits `exit_exercise:` only alone on its line, so what
  // reaches this point is a table or nothing.
  const exercise = entry.exit_exercise;
  if (!isRecord(exercise)) {
    tally.undated += 1;
    problems.push("exercice de sortie absent");
    return problems;
  }
  return [...problems, ...exerciseProblems(exercise, trackedFiles, today, tally)];
}

/**
 * Pure verdict over the register text, the tracked files and the current time.
 *
 * `registerText` null means the register is absent. One assertion per entry
 * that holds, named by its id; one per problem otherwise.
 */
export function evaluateThirdParties(
  registerText: string | null,
  trackedFiles: ReadonlySet<string>,
  now: Date,
): GateReport {
  const report = new GateReport();
  if (registerText === null) {
    return report.check(REGISTER_PATH, false, "registre absent ou illisible");
  }
  const unreadable = findUnreadableCharacter(registerText);
  if (unreadable !== null) {
    return report.check(
      REGISTER_PATH,
      false,
      `caractère ${unreadable.codePoint} ligne ${unreadable.line} : le parseur YAML et une lecture ` +
        "par ligne n'y lisent pas le même document",
    );
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(registerText);
  } catch (error) {
    return report.check(REGISTER_PATH, false, `YAML illisible : ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) {
    return report.check(REGISTER_PATH, false, "la racine du registre n'est pas une table");
  }

  const layout = scanLayout(registerText);
  if (layout.unreadLines.length > 0) {
    return report.check(
      REGISTER_PATH,
      false,
      `ligne(s) ${layout.unreadLines.join(", ")} hors du style bloc que ce gate relit : une clé ` +
        "écrite deux fois sous une autre forme y échapperait à la lecture par ligne",
    );
  }

  const rootTwice = duplicatesOf(layout.rootKeys);
  if (rootTwice.length > 0) {
    report.check(
      REGISTER_PATH,
      false,
      `clé(s) racine écrite(s) deux fois : ${rootTwice.join(", ")}`,
    );
  }
  if (keySet(Object.keys(parsed)) !== keySet(ROOT_KEYS)) {
    report.check(
      REGISTER_PATH,
      false,
      `la racine porte exactement ${ROOT_KEYS.join(" et ")}, pas : ${keySet(Object.keys(parsed))}`,
    );
  }
  if (parsed.schema_version !== SCHEMA_VERSION) {
    report.check(REGISTER_PATH, false, `schema_version doit valoir exactement ${SCHEMA_VERSION}`);
  }

  const entries = parsed.third_parties;
  if (!Array.isArray(entries)) {
    return report.check(REGISTER_PATH, false, "`third_parties` doit être une liste");
  }
  if (entries.length === 0) return report.check(REGISTER_PATH, false, EMPTY_REGISTER_NOTE);

  // Entry keys are compared index by index only when both readings see the
  // same entries; otherwise an index names a different entry in each.
  const sameEntries = layout.entries.length === entries.length;
  if (!sameEntries) {
    report.check(
      REGISTER_PATH,
      false,
      `${layout.entries.length} entrée(s) lue(s) ligne à ligne, ${entries.length} par le parseur`,
    );
  }

  const today = now.toISOString().slice(0, 10);
  const tally: Tally = { past: 0, upcoming: 0, undated: 0 };
  const seenIds = new Set<string>();
  entries.forEach((entry: unknown, index: number) => {
    // An id names the entry only once it passes its form: an empty or
    // multi-line id would otherwise blank or split the report line.
    const name =
      isRecord(entry) && typeof entry.id === "string" && ID.test(entry.id)
        ? `third_parties.${entry.id}`
        : `third_parties[${index}]`;
    if (!isRecord(entry)) {
      tally.undated += 1;
      report.check(name, false, "une entrée est une table");
      return;
    }
    const written = sameEntries ? layout.entries[index] : undefined;
    const problems = entryProblems(entry, written, trackedFiles, today, tally);
    if (typeof entry.id === "string") {
      if (seenIds.has(entry.id)) problems.push(`\`id\` en double : ${entry.id}`);
      seenIds.add(entry.id);
    }
    for (const problem of problems) report.check(name, false, problem);
    if (problems.length === 0)
      report.check(name, true, "exercice de sortie daté, procédure suivie");
  });

  report.volume(
    `${entries.length} entrée(s) examinée(s) = ${tally.past} échéance(s) passée(s) + ` +
      `${tally.upcoming} à venir + ${tally.undated} sans date lisible`,
  );
  return report;
}

/** The regular files of `git ls-files -s -z`, or null when the listing is unusable. */
export function regularTrackedFiles(listing: string): ReadonlySet<string> | null {
  const entries = parseStagedEntries(listing);
  if (entries === null || entries.length === 0) return null;
  return new Set(
    entries.filter((entry) => REGULAR_FILE_MODE.test(entry.mode)).map((entry) => entry.path),
  );
}

async function readRegister(): Promise<string | null> {
  try {
    return await Bun.file(REGISTER_PATH).text();
  } catch {
    // Absent and unreadable are the same verdict: the gate fails on null.
    return null;
  }
}

if (import.meta.main) {
  const listed = readGit(["ls-files", "-s", "-z"], "list the tracked files");
  const trackedFiles = listed.ok ? regularTrackedFiles(listed.stdout) : null;
  if (trackedFiles === null) {
    const reason = listed.ok ? "git ls-files printed no usable record" : listed.reason;
    concludeGate("Third-party exits", new GateReport().check("git ls-files", false, reason));
  } else {
    // The one read of the clock: everything above takes `now` as a parameter.
    const now = new Date();
    concludeGate(
      "Third-party exits",
      evaluateThirdParties(await readRegister(), trackedFiles, now),
    );
  }
}
