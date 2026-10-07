import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";

/**
 * γ phase 3.2 — the project-card system (design §6, ADR-0020).
 *
 * A card (`project.v1.yaml`) is the single state authority of a project:
 * mission statement in plain language, scope and non-goals, dependencies,
 * maturity ≠ progress ≠ confidence ≠ freshness, and phases whose exit
 * criteria carry integer weights and dated evidence. Progress is COMPUTED
 * from accepted criteria with evidence — the schema has no percent field by
 * construction, and an unstable scope reports « Avancement non calculable —
 * périmètre à clarifier » instead of a ratio (information, not a defect).
 *
 * This module is built in the hub and migrates to `governance` with the rest
 * of the ecosystem tooling (ADR-0020 §3).
 */

const schema = (await Bun.file(
  new URL("./schemas/project.v1.schema.json", import.meta.url).pathname,
).json()) as object;

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function safeError(error: ErrorObject): string {
  const message = error.message ?? "invalid";
  return `${error.instancePath || "/"}: ${message} (${error.keyword})`;
}

/**
 * Latest acceptable evidence date: tomorrow in the local calendar of the
 * process. Cards are written in local time while the CI runs in UTC, so a
 * strict "today" bound makes the same repository green on one machine and
 * red on another around midnight; a one-day tolerance absorbs any timezone
 * skew and keeps the gate deterministic wherever it executes, while still
 * refusing genuinely future-dated evidence.
 */
function latestAcceptableIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Evidence dated in the future is a claim, not a proof (design §6.6, §7.3). */
function futureDateErrors(value: unknown): string[] {
  const card = value as CardShape;
  const latest = latestAcceptableIso();
  const errors: string[] = [];
  if (card.freshness.last_verified_on > latest) {
    errors.push(
      `/freshness/last_verified_on: ${card.freshness.last_verified_on} est dans le futur (borne : ${latest})`,
    );
  }
  for (const phase of card.phases) {
    for (const criterion of phase.exit_criteria) {
      if (criterion.evidence && criterion.evidence.date > latest) {
        errors.push(
          `/phases/${phase.id}/exit_criteria/${criterion.id}/evidence/date: ${criterion.evidence.date} est dans le futur (borne : ${latest})`,
        );
      }
    }
  }
  return errors;
}

export function validateCard(value: unknown): string[] {
  if (!validate(value)) {
    const errors = (validate.errors ?? []).map(safeError);
    // Ajv reports a failed if/then as a bare "must match then schema" on the
    // criterion; make the accepted-without-evidence case name its rule.
    return errors.map((error) =>
      error.includes('"then"') || error.includes("then")
        ? `${error} — an accepted criterion requires dated evidence`
        : error,
    );
  }
  return futureDateErrors(value);
}

interface ExitCriterion {
  readonly id: string;
  readonly weight: number;
  readonly status: "pending" | "accepted";
  readonly evidence?: { readonly date: string; readonly reference: string };
}

interface Phase {
  readonly id: string;
  readonly exit_criteria: readonly ExitCriterion[];
}

interface CardShape {
  readonly scope_stability: "stable" | "unstable";
  readonly phases: readonly Phase[];
  readonly maturity: string;
  readonly confidence: string;
  readonly exposure: string;
  readonly freshness: { readonly last_verified_on: string };
  readonly project: string;
  readonly current_situation: string;
}

export interface PhaseProgress {
  readonly id: string;
  readonly accepted_weight: number;
  readonly applicable_weight: number;
  readonly ratio: number;
}

export type ProgressReport =
  | {
      readonly computable: true;
      readonly phases: readonly PhaseProgress[];
      readonly overall_ratio: number;
      readonly display: string;
    }
  | { readonly computable: false; readonly display: string };

export const NOT_COMPUTABLE_DISPLAY = "Avancement non calculable — périmètre à clarifier";

/**
 * Exact percent to one decimal place — the owner arbitration of 2026-07-30
 * dissolves the floor/round question (open since γ 3.2): the display shows
 * the measured value (62,5 %), never an optimistic or pessimistic rounding.
 * The two hard guards remain: never « 100 % » while anything is still
 * pending, never « 0 % » while anything is accepted (design §7.5). French
 * decimal comma, formatted by hand so the output is locale-independent.
 */
function displayPercent(overall: number): string {
  let value = Math.round(overall * 1000) / 10;
  if (overall < 1) value = Math.min(value, 99.9);
  if (overall > 0) value = Math.max(value, 0.1);
  const text = Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
  return `${text} % du périmètre actuellement déclaré`;
}

/**
 * Progress = accepted weights over applicable weights, per phase then over
 * the whole card. Only an `accepted` criterion counts, and the validator
 * guarantees every accepted criterion carries dated evidence. The input is
 * re-validated here: this function is public API and will be consumed
 * cross-repo by the governance fleet aggregator, which nothing forces
 * through `validateCard` first.
 */
export function aggregateProgress(value: unknown): ProgressReport {
  const errors = validateCard(value);
  if (errors.length > 0) {
    throw new Error(`aggregateProgress: invalid card — ${errors.join("; ")}`);
  }
  const card = value as CardShape;
  if (card.scope_stability === "unstable") {
    return { computable: false, display: NOT_COMPUTABLE_DISPLAY };
  }
  const phases: PhaseProgress[] = card.phases.map((phase) => {
    const applicable = phase.exit_criteria.reduce((sum, c) => sum + c.weight, 0);
    const accepted = phase.exit_criteria
      .filter((c) => c.status === "accepted")
      .reduce((sum, c) => sum + c.weight, 0);
    return {
      id: phase.id,
      accepted_weight: accepted,
      applicable_weight: applicable,
      ratio: applicable === 0 ? 0 : accepted / applicable,
    };
  });
  const applicableTotal = phases.reduce((sum, p) => sum + p.applicable_weight, 0);
  const acceptedTotal = phases.reduce((sum, p) => sum + p.accepted_weight, 0);
  // Unreachable through the schema (minItems 1, weight ≥ 1) — kept as
  // defence in depth: a scope with no applicable weight has no ratio.
  if (applicableTotal === 0) {
    return { computable: false, display: NOT_COMPUTABLE_DISPLAY };
  }
  const overall = acceptedTotal / applicableTotal;
  return {
    computable: true,
    phases,
    overall_ratio: overall,
    display: displayPercent(overall),
  };
}

export const STATUS_SECTION_BEGIN = "<!-- libre-ai:project-status:begin -->";
export const STATUS_SECTION_END = "<!-- libre-ai:project-status:end -->";

/**
 * The generated status section of a repository README. Deterministic,
 * sentinel-delimited, never hand-edited: the divergence gate fails when the
 * committed section differs from a fresh render of the card.
 */
export function renderStatusSection(value: unknown): string {
  const card = value as CardShape;
  const report = aggregateProgress(card);
  const lines = [
    STATUS_SECTION_BEGIN,
    "<!-- Section générée depuis project.v1.yaml — ne pas éditer à la main. -->",
    "",
    // The honest present state always travels with the statement: a render
    // showing the mission without the current situation would present a
    // planned capability as available (§7.5).
    `- Situation actuelle : ${card.current_situation.trim()}`,
    `- Maturité : ${card.maturity}`,
    `- Exposition : ${card.exposure}`,
    `- Confiance : ${card.confidence}`,
    `- Preuves vérifiées le : ${card.freshness.last_verified_on}`,
    `- Avancement : ${report.display}`,
    "",
    STATUS_SECTION_END,
  ];
  return lines.join("\n");
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Divergence gate primitive: the README must contain exactly one generated
 * section, byte-identical to a fresh render of the card. A second block
 * pasted anywhere else — the most natural drift gesture — is refused.
 */
export function checkStatusSection(readme: string, card: unknown): string[] {
  // Fail safely on an invalid card instead of letting the render throw: when
  // this gate runs across ~34 repositories in phase 3.6, a readable failure
  // beats an uncaught exception.
  const cardErrors = validateCard(card);
  if (cardErrors.length > 0) {
    return cardErrors.map((error) => `project.v1.yaml invalide — ${error}`);
  }
  const beginCount = countOccurrences(readme, STATUS_SECTION_BEGIN);
  const endCount = countOccurrences(readme, STATUS_SECTION_END);
  if (beginCount === 0 || endCount === 0) {
    return ["README: generated project-status section missing (sentinels not found)"];
  }
  if (beginCount > 1 || endCount > 1) {
    return [
      "README: section statut dupliquée — une seule paire de sentinelles project-status est admise",
    ];
  }
  const begin = readme.indexOf(STATUS_SECTION_BEGIN);
  const end = readme.indexOf(STATUS_SECTION_END);
  const committed = readme.slice(begin, end + STATUS_SECTION_END.length);
  const fresh = renderStatusSection(card);
  if (committed !== fresh) {
    return ["README: la section statut générée diverge de la fiche project.v1.yaml"];
  }
  return [];
}

/**
 * Repo-path-looking tokens extracted from a reference string, anywhere in it
 * — the house citation style is « chemin.md (ligne N) », so an anchored
 * whole-string match would miss exactly the class this guard exists for.
 * A token qualifies when its first segment starts with a letter and carries
 * no dot (which excludes URLs' domains and numeric fractions); directories
 * qualify (no extension required); trailing sentence punctuation is stripped.
 */
function extractPathTokens(reference: string): string[] {
  const normalized = reference.replace(/(^|[\s"'«»()[\]])\.\//g, "$1");
  const token = /(?:^|[\s"'«»()[\]])([A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9._-]+)+)/g;
  const tokens: string[] = [];
  for (const match of normalized.matchAll(token)) {
    const captured = match[1];
    if (captured !== undefined) tokens.push(captured.replace(/[.,;:!?)\]]+$/, ""));
  }
  return tokens;
}

/**
 * Evidence references that look like repo paths, for existence checking by
 * the gate (a dangling reference was found during phase 3.1 review — this is
 * the guard that finding called for). PR/gate-log style references without a
 * path remain checked by humans and review passes, not by the filesystem.
 */
export function collectPathReferences(value: unknown): string[] {
  const card = value as CardShape;
  const references: string[] = [];
  for (const phase of card.phases) {
    for (const criterion of phase.exit_criteria) {
      const reference = criterion.evidence?.reference;
      if (reference !== undefined) references.push(...extractPathTokens(reference));
    }
  }
  return references;
}
