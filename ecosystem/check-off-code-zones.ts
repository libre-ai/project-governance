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
 * threshold. The threshold is inclusive: an age equal to it holds.
 *
 * Counters sum to the universe: zones read = compliant + violating. A register
 * that cannot be read or parsed fails; it is never counted as "no zone".
 *
 * Usage: bun ecosystem/check-off-code-zones.ts [--today=YYYY-MM-DD]
 */

import { dayNumber } from "../tools/quality/advisory-waivers";
import { findUnreadableCharacter } from "../tools/quality/yaml-text-guard";

export const REGISTER_PATH = "ecosystem/off-code-zones.v1.yaml";
export const SCHEMA_VERSION = "libre-ai.off-code-zones.v1";

/** The fields every zone must carry, besides its id and its review date. */
export const REQUIRED_FIELDS = ["owner", "version", "fingerprint"] as const;

export interface Violation {
  /** `zones.<id>`, `zones[<index>]` when the id is unusable, or the register key at fault. */
  readonly path: string;
  readonly message: string;
}

export interface ZonesEvaluation {
  readonly zonesRead: number;
  readonly compliant: number;
  readonly violating: number;
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
  const thresholdValid =
    typeof thresholdDays === "number" && Number.isSafeInteger(thresholdDays) && thresholdDays >= 0;
  if (!thresholdValid) {
    violations.push({
      path: "review_max_age_days",
      message: `${JSON.stringify(thresholdDays)} is not a whole number of days`,
    });
  }

  const seen = new Set<string>();
  let violating = 0;
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
        if (!isFilledString(zone[field])) zoneViolations.push({ path, message: `no ${field}` });
      }
      if (today !== null && thresholdValid) {
        const review = reviewViolation(zone.reviewed_on, today, thresholdDays as number);
        if (review !== null) zoneViolations.push({ path, message: review });
      }
    }
    if (zoneViolations.length > 0) violating += 1;
    violations.push(...zoneViolations);
  });

  return {
    zonesRead: zones.length,
    compliant: zones.length - violating,
    violating,
    violations,
  };
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
  return { threshold: parsed.review_max_age_days, zones: parsed.zones };
}

export function volumeLine(evaluation: ZonesEvaluation, threshold: unknown, today: string): string {
  return (
    `zones: read=${evaluation.zonesRead} compliant=${evaluation.compliant} ` +
    `violating=${evaluation.violating}; threshold=${String(threshold)} day(s); judged at ${today} (UTC)`
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
    const failed = new Set(evaluation.violations.map((violation) => violation.path));
    report.check(REGISTER_PATH, true, `${evaluation.zonesRead} zone(s) read`);
    for (const violation of evaluation.violations) {
      report.check(violation.path, false, violation.message);
    }
    for (const zone of register.zones) {
      if (isRecord(zone) && isFilledString(zone.id) && !failed.has(`zones.${zone.id}`)) {
        report.check(`zones.${zone.id}`, true, "owned, versioned, fingerprinted, reviewed in time");
      }
    }
    const volume = volumeLine(evaluation, register.threshold, today);
    report.volume(volume);
    if (report.outcome !== "pass") console.error(`Off-code zones volume: ${volume}`);
  }
  concludeGate("Off-code zones", report);
}
