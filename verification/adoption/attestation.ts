/**
 * Adoption-reproduction attestation schema (positioning L3).
 *
 * The doctrine publishes evidence by default (I-20) but nothing yet proves
 * that a third party WITHOUT private assistance can appropriate the project.
 * This attestation is that proof, machine-readable: one blank-room
 * reproduction run, its steps, its environment, the reference-chain digest
 * comparison, and — most importantly — the friction log. The friction log is
 * the objective readability backlog: every implicit prerequisite or ambiguous
 * output an unassisted adopter would hit, recorded even when the run passes.
 *
 * The verdict is DERIVED from the recorded facts, never free-form, so a
 * published attestation cannot accidentally claim more than its own steps
 * show. Like the reference chain it wraps, the attestation is digest-anchored
 * upstream but not cryptographically signed: signing waits for the provenance
 * brick (wave 2), consistent with the P3 lineage deferral.
 */

export const ADOPTION_ATTESTATION_SCHEMA_VERSION = "libre-ai.adoption-reproduction.v1";

export type AdoptionStepStatus = "passed" | "failed" | "skipped";

export interface AdoptionStep {
  readonly id: string;
  readonly label: string;
  readonly status: AdoptionStepStatus;
  readonly durationMs: number;
}

/**
 * Friction taxonomy. Kept deliberately small so entries stay comparable
 * across runs: a growing vocabulary would fragment the backlog it feeds.
 */
export type FrictionKind =
  | "undocumented-step"
  | "implicit-prerequisite"
  | "ambiguous-output"
  | "environment-gap";

export interface FrictionEntry {
  /** Step id the friction was met on, or "global" when it spans the run. */
  readonly step: string;
  readonly kind: FrictionKind;
  readonly description: string;
}

export interface AdoptionEnvironment {
  readonly bunVersion: string;
  readonly os: string;
  readonly arch: string;
}

export interface ReferenceChainComparison {
  /** Digest documented in the harness evidence; null when not found there. */
  readonly expectedDigest: string | null;
  /** Digest the freshly cloned chain reported; null when it emitted none. */
  readonly obtainedDigest: string | null;
  readonly matches: boolean;
}

export interface AdoptionAttestation {
  readonly schemaVersion: typeof ADOPTION_ATTESTATION_SCHEMA_VERSION;
  /** `YYYY-MM-DD-<short-sha>`: date of the run plus the cloned revision. */
  readonly runId: string;
  /** ISO 8601 UTC timestamp of attestation creation. */
  readonly generatedAt: string;
  readonly repository: string;
  readonly clonedSha: string;
  readonly verdict: "pass" | "fail";
  readonly environment: AdoptionEnvironment;
  readonly steps: readonly AdoptionStep[];
  readonly referenceChain: ReferenceChainComparison;
  readonly frictionLog: readonly FrictionEntry[];
}

export interface BuildAttestationInput {
  readonly generatedAt: string;
  readonly repository: string;
  readonly clonedSha: string;
  readonly environment: AdoptionEnvironment;
  readonly steps: readonly AdoptionStep[];
  readonly referenceChain: {
    readonly expectedDigest: string | null;
    readonly obtainedDigest: string | null;
  };
  readonly frictionLog: readonly FrictionEntry[];
}

const STEP_STATUSES: readonly AdoptionStepStatus[] = ["passed", "failed", "skipped"];
const FRICTION_KINDS: readonly FrictionKind[] = [
  "undocumented-step",
  "implicit-prerequisite",
  "ambiguous-output",
  "environment-gap",
];
const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
// UTC-only: attestations are compared across machines, so a local offset
// would make two identical runs look different.
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function deriveVerdict(
  steps: readonly AdoptionStep[],
  chain: ReferenceChainComparison,
): "pass" | "fail" {
  if (steps.some((step) => step.status === "failed")) {
    return "fail";
  }
  // No digest from the chain means the chain never completed: that is a
  // failure even if the spawn itself exited 0. A missing DOCUMENTED digest,
  // by contrast, is a documentation friction — the code did what it claims.
  if (chain.obtainedDigest === null) {
    return "fail";
  }
  if (chain.expectedDigest !== null && !chain.matches) {
    return "fail";
  }
  return "pass";
}

export function buildAttestation(input: BuildAttestationInput): AdoptionAttestation {
  if (!ISO_UTC_PATTERN.test(input.generatedAt)) {
    throw new Error(`generatedAt must be an ISO 8601 UTC timestamp, got: ${input.generatedAt}`);
  }
  if (!FULL_SHA_PATTERN.test(input.clonedSha)) {
    throw new Error(`clonedSha must be a full lowercase git sha, got: ${input.clonedSha}`);
  }
  const { expectedDigest, obtainedDigest } = input.referenceChain;
  const matches =
    expectedDigest !== null && obtainedDigest !== null && expectedDigest === obtainedDigest;
  const referenceChain: ReferenceChainComparison = { expectedDigest, obtainedDigest, matches };
  const datePart = input.generatedAt.slice(0, 10);
  return {
    schemaVersion: ADOPTION_ATTESTATION_SCHEMA_VERSION,
    runId: `${datePart}-${input.clonedSha.slice(0, 7)}`,
    generatedAt: input.generatedAt,
    repository: input.repository,
    clonedSha: input.clonedSha,
    verdict: deriveVerdict(input.steps, referenceChain),
    environment: input.environment,
    steps: input.steps,
    referenceChain,
    frictionLog: input.frictionLog,
  };
}

function fail(field: string, expectation: string): never {
  throw new Error(`invalid attestation: ${field} ${expectation}`);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(field, "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(field, "must be a non-empty string");
  }
  return value;
}

function asStringOrNull(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return asString(value, field);
}

function asArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(field, "must be an array");
  }
  return value;
}

function parseStep(value: unknown, field: string): AdoptionStep {
  const record = asRecord(value, field);
  const status = asString(record.status, `${field}.status`);
  if (!STEP_STATUSES.includes(status as AdoptionStepStatus)) {
    fail(`${field}.status`, `must be one of ${STEP_STATUSES.join(", ")}`);
  }
  const durationMs = record.durationMs;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    fail(`${field}.durationMs`, "must be a non-negative finite number");
  }
  return {
    id: asString(record.id, `${field}.id`),
    label: asString(record.label, `${field}.label`),
    status: status as AdoptionStepStatus,
    durationMs,
  };
}

function parseFriction(value: unknown, field: string): FrictionEntry {
  const record = asRecord(value, field);
  const kind = asString(record.kind, `${field}.kind`);
  if (!FRICTION_KINDS.includes(kind as FrictionKind)) {
    fail(`${field}.kind`, `must be one of ${FRICTION_KINDS.join(", ")}`);
  }
  return {
    step: asString(record.step, `${field}.step`),
    kind: kind as FrictionKind,
    description: asString(record.description, `${field}.description`),
  };
}

/**
 * Strict parse of a serialized attestation. Rejects unknown enum values,
 * malformed timestamps/shas/digests, and — deliberately — any verdict or
 * runId that does not re-derive from the recorded facts.
 */
export function parseAttestation(text: string): AdoptionAttestation {
  const root = asRecord(JSON.parse(text), "attestation");
  if (root.schemaVersion !== ADOPTION_ATTESTATION_SCHEMA_VERSION) {
    fail("schemaVersion", `must be ${ADOPTION_ATTESTATION_SCHEMA_VERSION}`);
  }
  const generatedAt = asString(root.generatedAt, "generatedAt");
  if (!ISO_UTC_PATTERN.test(generatedAt)) {
    fail("generatedAt", "must be an ISO 8601 UTC timestamp");
  }
  const clonedSha = asString(root.clonedSha, "clonedSha");
  if (!FULL_SHA_PATTERN.test(clonedSha)) {
    fail("clonedSha", "must be a full lowercase git sha");
  }
  const chainRecord = asRecord(root.referenceChain, "referenceChain");
  const expectedDigest = asStringOrNull(
    chainRecord.expectedDigest,
    "referenceChain.expectedDigest",
  );
  const obtainedDigest = asStringOrNull(
    chainRecord.obtainedDigest,
    "referenceChain.obtainedDigest",
  );
  for (const [field, digest] of [
    ["referenceChain.expectedDigest", expectedDigest],
    ["referenceChain.obtainedDigest", obtainedDigest],
  ] as const) {
    if (digest !== null && !DIGEST_PATTERN.test(digest)) {
      fail(field, "must be a sha256 hex digest");
    }
  }
  const steps = asArray(root.steps, "steps").map((value, index) =>
    parseStep(value, `steps[${index}]`),
  );
  const frictionLog = asArray(root.frictionLog, "frictionLog").map((value, index) =>
    parseFriction(value, `frictionLog[${index}]`),
  );
  const environmentRecord = asRecord(root.environment, "environment");
  const rebuilt = buildAttestation({
    generatedAt,
    repository: asString(root.repository, "repository"),
    clonedSha,
    environment: {
      bunVersion: asString(environmentRecord.bunVersion, "environment.bunVersion"),
      os: asString(environmentRecord.os, "environment.os"),
      arch: asString(environmentRecord.arch, "environment.arch"),
    },
    steps,
    referenceChain: { expectedDigest, obtainedDigest },
    frictionLog,
  });
  // Re-derivation is the tamper check: a hand-edited verdict/runId/matches
  // that contradicts the recorded facts must not parse.
  if (root.verdict !== rebuilt.verdict) {
    fail("verdict", `is inconsistent with the recorded steps (expected ${rebuilt.verdict})`);
  }
  if (root.runId !== rebuilt.runId) {
    fail("runId", `is inconsistent with generatedAt and clonedSha (expected ${rebuilt.runId})`);
  }
  if (chainRecord.matches !== rebuilt.referenceChain.matches) {
    fail("referenceChain.matches", "is inconsistent with the recorded digests");
  }
  return rebuilt;
}

export function renderAttestationMarkdown(attestation: AdoptionAttestation): string {
  const lines: string[] = [
    `# Adoption reproduction attestation — ${attestation.runId}`,
    "",
    "Blank-room reproduction of the public repository by",
    "`verification/adoption/reproduce.ts`: fresh temporary directory,",
    "credential-free environment, anonymous clone. Proof that the project is",
    "appropriable without private assistance (positioning L3).",
    "",
    `- **Verdict:** ${attestation.verdict === "pass" ? "PASS" : "FAIL"}`,
    `- **Generated at:** ${attestation.generatedAt}`,
    `- **Repository:** ${attestation.repository}`,
    `- **Cloned sha:** \`${attestation.clonedSha}\``,
    `- **Environment:** bun ${attestation.environment.bunVersion}, ${attestation.environment.os}/${attestation.environment.arch}`,
    "",
    "## Steps",
    "",
    "| Step | Status | Duration (ms) |",
    "| ---- | ------ | ------------- |",
  ];
  for (const step of attestation.steps) {
    lines.push(`| ${step.id} — ${step.label} | ${step.status} | ${step.durationMs} |`);
  }
  lines.push(
    "",
    "## Reference-chain digest",
    "",
    `- Expected (documented): ${formatDigest(attestation.referenceChain.expectedDigest)}`,
    `- Obtained (fresh clone): ${formatDigest(attestation.referenceChain.obtainedDigest)}`,
    `- Matches: ${attestation.referenceChain.matches ? "yes" : "no"}`,
    "",
    "## Friction log",
    "",
  );
  if (attestation.frictionLog.length === 0) {
    lines.push("No friction recorded: every step behaved as its documentation implies.");
  } else {
    lines.push(
      "The friction log is the objective readability backlog: what an",
      "unassisted adopter hit, even where the run passed.",
      "",
      "| Step | Kind | Description |",
      "| ---- | ---- | ----------- |",
    );
    for (const friction of attestation.frictionLog) {
      lines.push(`| ${friction.step} | ${friction.kind} | ${friction.description} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function formatDigest(digest: string | null): string {
  return digest === null ? "none" : `\`${digest}\``;
}
