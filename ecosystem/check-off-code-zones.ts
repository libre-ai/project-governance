/**
 * Off-code zones guard.
 *
 * An off-code zone is a part of the infrastructure this repository cannot
 * describe in code: a proprietary tool fleet that cannot be scripted, the
 * firmware of a hardware signing module. Such an exception is acceptable only
 * when it is named, owned, versioned and reviewed periodically, so every zone
 * of `ecosystem/off-code-zones.v1.yaml` must carry an owner, a version, a
 * fingerprint (each missing one is a violation) and a well-formed review date.
 *
 * Review age = whole days between the review date and the reference date
 * (today, UTC). A missing or malformed date is a violation; a negative age is
 * a review in the future, a violation; an age strictly greater than the
 * declared `review_max_age_days` is a violation naming the age and the
 * threshold. The threshold is inclusive: an age equal to it holds. A threshold
 * above `MAX_THRESHOLD_DAYS` (code, not data) is a violation. An owner, version
 * or fingerprint present but not a string (`version: 1.0` reads as a number)
 * must be quoted.
 *
 * Counters sum to the universe: zones read = compliant + violating + unjudged,
 * where unjudged zones are those whose review age cannot be measured because
 * the threshold or the reference date is invalid. A register that cannot be
 * read or parsed fails; it is never counted as "no zone". A key written twice,
 * or any line outside the bare block form, refuses the register (`scanLayout`).
 * An empty register asserts nothing and says so through `allowEmpty`.
 *
 * This gate is run by `bun run check:off-code-zones` only; it is not a step of
 * `bun run check`.
 *
 * Usage: bun ecosystem/check-off-code-zones.ts [--today=YYYY-MM-DD]
 */

import { dayNumber } from "../tools/quality/advisory-waivers";
import { findUnreadableCharacter } from "../tools/quality/yaml-text-guard";

export const REGISTER_PATH = "ecosystem/off-code-zones.v1.yaml";
export const SCHEMA_VERSION = "libre-ai.off-code-zones.v1";

/** The fields every zone must carry, besides its id and its review date. */
export const REQUIRED_FIELDS = ["owner", "version", "fingerprint"] as const;

/**
 * Ceiling of the declared threshold, set in code so the data cannot loosen it:
 * a register declaring more days than this is a violation, not a wider window.
 * 365 is the value the register ships with.
 */
export const MAX_THRESHOLD_DAYS = 365;

export interface Violation {
  /** `zones.<id>`, `zones[<index>]` when the id is unusable, or the register key at fault. */
  readonly path: string;
  readonly message: string;
}

/**
 * `unjudged`: no field violation, but the review age could not be measured
 * because the threshold or the reference date is invalid. Never compliant.
 */
export type ZoneStatus = "compliant" | "violating" | "unjudged";

export interface ZoneVerdict {
  readonly path: string;
  readonly status: ZoneStatus;
}

export interface ZonesEvaluation {
  readonly zonesRead: number;
  readonly compliant: number;
  readonly violating: number;
  readonly unjudged: number;
  readonly zones: readonly ZoneVerdict[];
  readonly violations: readonly Violation[];
}

export interface Register {
  readonly threshold: unknown;
  readonly zones: readonly unknown[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function reviewViolation(reviewedOn: unknown, today: number, thresholdDays: number): string | null {
  if (reviewedOn === undefined || reviewedOn === null) return "no review date (reviewed_on)";
  const reviewed = typeof reviewedOn === "string" ? dayNumber(reviewedOn) : null;
  if (reviewed === null) {
    return `malformed review date ${JSON.stringify(reviewedOn)}: expected a real YYYY-MM-DD calendar date`;
  }
  const age = today - reviewed;
  if (age < 0) return `review date ${reviewedOn} is in the future (${-age} day(s) ahead)`;
  if (age > thresholdDays) {
    return `review date ${reviewedOn} is ${age} day(s) old, beyond the threshold of ${thresholdDays} day(s)`;
  }
  return null;
}

/**
 * Pure verdict over the zones, the declared threshold (days) and the
 * reference date (YYYY-MM-DD, UTC).
 */
export function check(
  zones: readonly unknown[],
  thresholdDays: unknown,
  referenceDate: string,
): ZonesEvaluation {
  const violations: Violation[] = [];
  const today = dayNumber(referenceDate);
  if (today === null) {
    violations.push({
      path: "reference date",
      message: `${JSON.stringify(referenceDate)} is not a real YYYY-MM-DD calendar date`,
    });
  }
  const wholeDays =
    typeof thresholdDays === "number" && Number.isSafeInteger(thresholdDays) && thresholdDays >= 0;
  if (!wholeDays) {
    violations.push({
      path: "review_max_age_days",
      message: `${JSON.stringify(thresholdDays)} is not a whole number of days`,
    });
  } else if (thresholdDays > MAX_THRESHOLD_DAYS) {
    violations.push({
      path: "review_max_age_days",
      message: `${thresholdDays} day(s) exceeds the ceiling of ${MAX_THRESHOLD_DAYS} day(s) set in code`,
    });
  }
  const thresholdValid = wholeDays && thresholdDays <= MAX_THRESHOLD_DAYS;
  const judged = today !== null && thresholdValid;

  const seen = new Set<string>();
  const verdicts: ZoneVerdict[] = [];
  zones.forEach((zone, index) => {
    const zoneViolations: Violation[] = [];
    const usableId = isRecord(zone) && isFilledString(zone.id) && !seen.has(zone.id);
    const path = usableId ? `zones.${zone.id as string}` : `zones[${index}]`;
    if (!isRecord(zone)) {
      zoneViolations.push({ path, message: "a zone is a mapping of its fields" });
    } else {
      if (!isFilledString(zone.id)) zoneViolations.push({ path, message: "no id" });
      else if (seen.has(zone.id)) {
        zoneViolations.push({ path, message: `duplicate id ${zone.id}` });
      } else seen.add(zone.id);
      for (const field of REQUIRED_FIELDS) {
        const value = zone[field];
        if (
          value === undefined ||
          value === null ||
          (typeof value === "string" && !isFilledString(value))
        ) {
          zoneViolations.push({ path, message: `no ${field}` });
        } else if (typeof value !== "string") {
          // `version: 1.0` reaches here as the number 1: present, but no longer what was written.
          zoneViolations.push({ path, message: `${field} must be a quoted string` });
        }
      }
      if (judged && today !== null) {
        const review = reviewViolation(zone.reviewed_on, today, thresholdDays as number);
        if (review !== null) zoneViolations.push({ path, message: review });
      }
    }
    const status: ZoneStatus =
      zoneViolations.length > 0 ? "violating" : judged ? "compliant" : "unjudged";
    verdicts.push({ path, status });
    violations.push(...zoneViolations);
  });

  const count = (status: ZoneStatus): number =>
    verdicts.filter((verdict) => verdict.status === status).length;
  return {
    zonesRead: zones.length,
    compliant: count("compliant"),
    violating: count("violating"),
    unjudged: count("unjudged"),
    zones: verdicts,
    violations,
  };
}

const ROOT_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;
/** `zones:` alone on its line; `[]` is the one inline value, the empty register. */
const ZONES_OPENER = /^zones:\s*(?:\[\]\s*)?(?:#.*)?$/;
/** A root value on its own line, never opening a flow collection the line reading cannot see into. */
const SCALAR_ROOT = /^[A-Za-z_][A-Za-z0-9_-]*:\s+[^\s[{&*!|>?#]/;
const ENTRY_START = /^ {2}- ([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;
const ENTRY_KEY = /^ {4}([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;

interface Layout {
  readonly rootKeys: readonly string[];
  readonly entryKeys: readonly (readonly string[])[];
  readonly unreadLines: readonly number[];
}

/**
 * Independent, line-based reading of the keys, compared with the parser's.
 *
 * `Bun.YAML.parse` keeps the last of two identical keys in silence, so a
 * second `review_max_age_days: 99999` would loosen the threshold unseen. The
 * method is the one of `scanBlockLayout` in tools/quality/check-refusals.ts: a
 * whitelist of line forms, not a key detector, since YAML can also write a key
 * quoted, as an explicit `? key` or in a flow mapping. Every line is blank, a
 * comment, a bare root key in column 0 with a plain scalar value, `zones:`
 * (alone or `[]`), an entry opened by `  - <key>:` in column 2, or a bare entry
 * key in column 4. Any other line is unread, and an unread line refuses the
 * register.
 */
function scanLayout(text: string): Layout {
  const rootKeys: string[] = [];
  const entryKeys: string[][] = [];
  const unreadLines: number[] = [];
  let inZones = false;
  text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .forEach((line, index) => {
      const number = index + 1;
      if (line.trim() === "" || line.trimStart().startsWith("#")) return;
      const root = ROOT_KEY.exec(line);
      if (root?.[1] !== undefined) {
        rootKeys.push(root[1]);
        inZones = root[1] === "zones";
        if (inZones ? !ZONES_OPENER.test(line) : !SCALAR_ROOT.test(line)) unreadLines.push(number);
        return;
      }
      const start = inZones ? ENTRY_START.exec(line) : null;
      if (start?.[1] !== undefined) {
        entryKeys.push([start[1]]);
        return;
      }
      const key = inZones ? ENTRY_KEY.exec(line) : null;
      const open = entryKeys.at(-1);
      if (key?.[1] !== undefined && open !== undefined) {
        open.push(key[1]);
        return;
      }
      unreadLines.push(number);
    });
  return { rootKeys, entryKeys, unreadLines };
}

function duplicatesOf(keys: readonly string[]): string[] {
  return [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
}

function keySet(keys: readonly string[]): string {
  return [...new Set(keys)].sort().join(", ");
}

/** Why the line reading and the parser disagree on `parsed`, or null. */
function layoutDisagreement(
  layout: Layout,
  parsed: Readonly<Record<string, unknown>>,
  zones: readonly unknown[],
): string | null {
  if (layout.unreadLines.length > 0) {
    return (
      `line(s) ${layout.unreadLines.join(", ")} outside the bare block form this gate reads ` +
      "(bare root key in column 0, `zones:` alone or `[]`, entry `  - <key>:`, entry key in column 4): " +
      "a key written twice in another form would escape the line reading"
    );
  }
  const rootTwice = duplicatesOf(layout.rootKeys);
  if (rootTwice.length > 0) {
    return `root key(s) written twice, the parser keeps only the last: ${rootTwice.join(", ")}`;
  }
  if (keySet(layout.rootKeys) !== keySet(Object.keys(parsed))) {
    return `root keys read line by line (${keySet(layout.rootKeys)}) and by the parser (${keySet(Object.keys(parsed))}) differ`;
  }
  if (layout.entryKeys.length !== zones.length) {
    return `${layout.entryKeys.length} zone(s) read line by line, ${zones.length} by the parser`;
  }
  for (const [index, written] of layout.entryKeys.entries()) {
    const twice = duplicatesOf(written);
    if (twice.length > 0) {
      return `zones[${index}]: key(s) written twice, the parser keeps only the last: ${twice.join(", ")}`;
    }
    const zone = zones[index];
    const parsedKeys = isRecord(zone) ? Object.keys(zone) : [];
    if (keySet(written) !== keySet(parsedKeys)) {
      return `zones[${index}]: keys read line by line (${keySet(written)}) and by the parser (${keySet(parsedKeys)}) differ`;
    }
  }
  return null;
}

/** The register's threshold and zones, or the reason it cannot be read. */
export function parseRegister(text: string): Register | string {
  const unreadable = findUnreadableCharacter(text);
  if (unreadable !== null) {
    return (
      `character ${unreadable.codePoint} on line ${unreadable.line}: ` +
      "the YAML parser and a line-based reading would not see the same document"
    );
  }
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch (error) {
    return `unreadable YAML: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!isRecord(parsed)) return "the register root is not a mapping";
  if (parsed.schema_version !== SCHEMA_VERSION) {
    return `schema_version ${JSON.stringify(parsed.schema_version)}, expected ${SCHEMA_VERSION}`;
  }
  if (!Array.isArray(parsed.zones)) return "zones is not a list";
  const disagreement = layoutDisagreement(scanLayout(text), parsed, parsed.zones);
  if (disagreement !== null) return disagreement;
  return { threshold: parsed.review_max_age_days, zones: parsed.zones };
}

export function volumeLine(evaluation: ZonesEvaluation, threshold: unknown, today: string): string {
  return (
    `zones: read=${evaluation.zonesRead} compliant=${evaluation.compliant} ` +
    `violating=${evaluation.violating} unjudged=${evaluation.unjudged}; ` +
    `threshold=${String(threshold)} day(s), ceiling ${MAX_THRESHOLD_DAYS}; judged at ${today} (UTC)`
  );
}

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  let today = new Date().toISOString().slice(0, 10);
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith("--today=")) today = argument.slice("--today=".length);
    else {
      console.error(`Usage: bun ecosystem/check-off-code-zones.ts [--today=YYYY-MM-DD]`);
      process.exit(2);
    }
  }
  const report = new GateReport();
  let text: string | null = null;
  try {
    text = await Bun.file(REGISTER_PATH).text();
  } catch (error) {
    report.check(
      REGISTER_PATH,
      false,
      `unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const register = text === null ? null : parseRegister(text);
  if (typeof register === "string") report.check(REGISTER_PATH, false, register);
  if (register !== null && typeof register !== "string") {
    const evaluation = check(register.zones, register.threshold, today);
    for (const violation of evaluation.violations) {
      report.check(violation.path, false, violation.message);
    }
    // Only a zone judged compliant is an assertion that holds: an unjudged
    // zone already sits behind a threshold or reference-date violation.
    for (const zone of evaluation.zones) {
      if (zone.status === "compliant") {
        report.check(zone.path, true, "owned, versioned, fingerprinted, reviewed in time");
      }
    }
    // Reading zero zones asserts nothing; the empty register (the one shipped)
    // must say so through allowEmpty rather than through a "register read" check.
    if (evaluation.zonesRead === 0) report.allowEmpty("aucune zone déclarée");
    const volume = volumeLine(evaluation, register.threshold, today);
    report.volume(volume);
    // The success line carries the volume only when something was asserted.
    if (report.outcome !== "pass") console.error(`Off-code zones volume: ${volume}`);
    else if (report.asserted === 0) console.log(`Off-code zones volume: ${volume}`);
  }
  concludeGate("Off-code zones", report);
}
