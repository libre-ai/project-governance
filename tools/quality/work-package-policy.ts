/**
 * Policy of the work-package gate, read from
 * ecosystem/work-package-policy.v1.yaml.
 *
 * Why data: who is exempt and from which maturity level the gate applies are
 * decisions to review, not behaviour to bury in the gate. The `exempt` object
 * only DESCRIBES predicates; the gate verifies each one against the pull
 * request itself and never believes an author's claim about it. That is why a
 * rule carries exactly one predicate: two would make "which one was verified"
 * ambiguous.
 *
 * The loader fails closed. A policy that cannot be read in full yields
 * `ok: false` naming the cause, never a default or a partial policy, so that
 * a gate built on it cannot confuse "no exemption declared" with "policy
 * unreadable" (gate-integrity §2).
 */
import { MATURITY_LADDER, type MaturityLevel, type Parsed } from "./prd-model";

export type ExemptRule =
  | { readonly author: string }
  | { readonly paths: readonly string[] }
  | { readonly titlePrefix: string };

export interface WorkPackagePolicy {
  readonly approvedFrom: MaturityLevel;
  readonly exempt: Readonly<Record<string, ExemptRule>>;
  readonly owners: readonly string[];
}

const fail = (reason: string): { readonly ok: false; readonly reason: string } => ({
  ok: false,
  reason,
});

const ROOT_KEYS = ["approvedFrom", "exempt", "owners"] as const;
const PREDICATE_KEYS = ["author", "paths", "titlePrefix"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function parseRule(name: string, raw: unknown): Parsed<ExemptRule> {
  if (!isRecord(raw)) {
    return fail(`exempt rule "${name}" must be an object with exactly one predicate`);
  }
  const keys = Object.keys(raw);
  const unknown = keys.filter((key) => !(PREDICATE_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return fail(
      `exempt rule "${name}" has unknown key "${unknown[0]}" (expected one of ${PREDICATE_KEYS.join(", ")})`,
    );
  }
  if (keys.length !== 1) {
    return fail(
      `exempt rule "${name}" must have exactly one predicate (${PREDICATE_KEYS.join(", ")}), found ${keys.length}`,
    );
  }
  const [key] = keys;
  const value = raw[key as string];
  if (key === "author" || key === "titlePrefix") {
    if (!isNonEmptyString(value)) {
      return fail(`exempt rule "${name}": ${key} must be a non-empty string`);
    }
    return { ok: true, value: key === "author" ? { author: value } : { titlePrefix: value } };
  }
  if (!isNonEmptyStringArray(value)) {
    return fail(`exempt rule "${name}": paths must be a non-empty array of non-empty strings`);
  }
  return { ok: true, value: { paths: [...value] } };
}

export function loadWorkPackagePolicy(text: string): Parsed<WorkPackagePolicy> {
  let root: unknown;
  try {
    root = Bun.YAML.parse(text);
  } catch (error) {
    return fail(
      `policy is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(root)) {
    return fail("policy root must be an object");
  }
  const unknownRoot = Object.keys(root).filter(
    (key) => !(ROOT_KEYS as readonly string[]).includes(key),
  );
  if (unknownRoot.length > 0) {
    return fail(`policy has unknown key "${unknownRoot[0]}" (expected ${ROOT_KEYS.join(", ")})`);
  }
  for (const key of ROOT_KEYS) {
    if (!(key in root)) {
      return fail(`policy is missing required key "${key}"`);
    }
  }

  const approvedFrom = root.approvedFrom;
  if (
    typeof approvedFrom !== "string" ||
    !(MATURITY_LADDER as readonly string[]).includes(approvedFrom)
  ) {
    return fail(
      `approvedFrom must be one of the maturity ladder (${MATURITY_LADDER.join(", ")}), got ${JSON.stringify(approvedFrom)}`,
    );
  }

  if (!isNonEmptyStringArray(root.owners)) {
    return fail("owners must be a non-empty array of non-empty strings");
  }

  if (!isRecord(root.exempt)) {
    return fail("exempt must be an object of named rules");
  }
  const exempt: Record<string, ExemptRule> = {};
  for (const [name, raw] of Object.entries(root.exempt)) {
    if (name.length === 0) {
      return fail("exempt rule names must be non-empty");
    }
    const rule = parseRule(name, raw);
    if (!rule.ok) {
      return rule;
    }
    exempt[name] = rule.value;
  }

  return {
    ok: true,
    value: { approvedFrom: approvedFrom as MaturityLevel, exempt, owners: [...root.owners] },
  };
}
