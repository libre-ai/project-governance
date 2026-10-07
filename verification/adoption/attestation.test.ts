import { describe, expect, test } from "bun:test";
import {
  ADOPTION_ATTESTATION_SCHEMA_VERSION,
  type AdoptionStep,
  buildAttestation,
  parseAttestation,
  renderAttestationMarkdown,
} from "./attestation";

/**
 * Positioning L3 — the attestation is the machine-readable proof that an
 * unassisted third party can appropriate the project from its public surface
 * alone. Its schema is therefore contract-like: strictly validated, stable
 * field names, ISO 8601 timestamps, and a verdict that can never silently
 * drift from the recorded step outcomes. These tests pin that contract.
 */

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const SHA = "0123456789abcdef0123456789abcdef01234567";

function step(id: string, status: AdoptionStep["status"]): AdoptionStep {
  return { id, label: `label for ${id}`, status, durationMs: 5 };
}

function baseInput() {
  return {
    generatedAt: "2026-07-24T10:00:00Z",
    repository: "https://github.com/libre-ai/libre-ai",
    clonedSha: SHA,
    environment: { bunVersion: "1.4.0", os: "darwin", arch: "arm64" },
    steps: [step("clone", "passed"), step("install", "passed"), step("reference-chain", "passed")],
    referenceChain: { expectedDigest: DIGEST_A, obtainedDigest: DIGEST_A },
    frictionLog: [],
  };
}

describe("buildAttestation", () => {
  test("passes when every step passed and the chain digest matches", () => {
    const attestation = buildAttestation(baseInput());
    expect(attestation.verdict).toBe("pass");
    expect(attestation.schemaVersion).toBe(ADOPTION_ATTESTATION_SCHEMA_VERSION);
    expect(attestation.referenceChain.matches).toBe(true);
  });

  test("derives the run id from the UTC date and the short cloned sha", () => {
    const attestation = buildAttestation(baseInput());
    expect(attestation.runId).toBe("2026-07-24-0123456");
  });

  test("fails when any step failed, even with a matching digest", () => {
    const input = { ...baseInput(), steps: [step("clone", "passed"), step("install", "failed")] };
    expect(buildAttestation(input).verdict).toBe("fail");
  });

  test("fails on a digest mismatch, even when every step passed", () => {
    const input = {
      ...baseInput(),
      referenceChain: { expectedDigest: DIGEST_A, obtainedDigest: DIGEST_B },
    };
    const attestation = buildAttestation(input);
    expect(attestation.verdict).toBe("fail");
    expect(attestation.referenceChain.matches).toBe(false);
  });

  test("fails when the chain produced no digest at all", () => {
    const input = {
      ...baseInput(),
      referenceChain: { expectedDigest: DIGEST_A, obtainedDigest: null },
    };
    expect(buildAttestation(input).verdict).toBe("fail");
  });

  test("still passes when the documented digest could not be located (recorded as friction, not failure)", () => {
    // The comparison is impossible, which is a readability defect of the
    // documentation, not a defect of the published code: the friction log is
    // the honest carrier for it.
    const input = {
      ...baseInput(),
      referenceChain: { expectedDigest: null, obtainedDigest: DIGEST_A },
      frictionLog: [
        {
          step: "reference-chain",
          kind: "ambiguous-output" as const,
          description: "documented digest not found",
        },
      ],
    };
    const attestation = buildAttestation(input);
    expect(attestation.verdict).toBe("pass");
    expect(attestation.referenceChain.matches).toBe(false);
  });

  test("a non-empty friction log never flips a green run to fail", () => {
    const input = {
      ...baseInput(),
      frictionLog: [
        {
          step: "install",
          kind: "implicit-prerequisite" as const,
          description: "bun install is not documented",
        },
      ],
    };
    expect(buildAttestation(input).verdict).toBe("pass");
  });

  test("rejects a malformed cloned sha instead of minting a wrong run id", () => {
    expect(() => buildAttestation({ ...baseInput(), clonedSha: "not-a-sha" })).toThrow(/sha/i);
  });
});

describe("parseAttestation", () => {
  test("round-trips a built attestation through JSON", () => {
    const attestation = buildAttestation(baseInput());
    expect(parseAttestation(JSON.stringify(attestation))).toEqual(attestation);
  });

  test("rejects an unknown schema version", () => {
    const raw = { ...buildAttestation(baseInput()), schemaVersion: "libre-ai.other.v9" };
    expect(() => parseAttestation(JSON.stringify(raw))).toThrow(/schemaVersion/);
  });

  test("rejects an unknown step status", () => {
    const attestation = buildAttestation(baseInput());
    const raw = JSON.parse(JSON.stringify(attestation)) as Record<string, unknown>;
    Object.assign((raw.steps as Array<Record<string, unknown>>)[0] ?? {}, { status: "green" });
    expect(() => parseAttestation(JSON.stringify(raw))).toThrow(/status/);
  });

  test("rejects an unknown friction kind", () => {
    const attestation = buildAttestation({
      ...baseInput(),
      frictionLog: [{ step: "x", kind: "implicit-prerequisite", description: "d" }],
    });
    const raw = JSON.parse(JSON.stringify(attestation)) as Record<string, unknown>;
    Object.assign((raw.frictionLog as Array<Record<string, unknown>>)[0] ?? {}, { kind: "vibes" });
    expect(() => parseAttestation(JSON.stringify(raw))).toThrow(/kind/);
  });

  test("rejects a non-ISO-8601 timestamp", () => {
    const raw = { ...buildAttestation(baseInput()), generatedAt: "24/07/2026 10:00" };
    expect(() => parseAttestation(JSON.stringify(raw))).toThrow(/generatedAt/);
  });

  test("rejects a verdict inconsistent with the recorded steps", () => {
    // The verdict is derived, never free-form: a tampered "pass" over a failed
    // step must not parse. This keeps published attestations non-forgeable by
    // accident (deliberate forgery is out of scope until signing lands).
    const failed = buildAttestation({
      ...baseInput(),
      steps: [step("clone", "failed")],
    });
    const raw = {
      ...(JSON.parse(JSON.stringify(failed)) as Record<string, unknown>),
      verdict: "pass",
    };
    expect(() => parseAttestation(JSON.stringify(raw))).toThrow(/verdict/);
  });

  test("rejects non-object JSON", () => {
    expect(() => parseAttestation("[]")).toThrow(/object/);
  });
});

describe("renderAttestationMarkdown", () => {
  test("renders the verdict, run id, every step and every friction entry", () => {
    const attestation = buildAttestation({
      ...baseInput(),
      frictionLog: [
        {
          step: "install",
          kind: "implicit-prerequisite",
          description: "Playwright browsers must already be installed",
        },
      ],
    });
    const markdown = renderAttestationMarkdown(attestation);
    expect(markdown).toContain("2026-07-24-0123456");
    expect(markdown).toContain("PASS");
    expect(markdown).toContain("reference-chain");
    expect(markdown).toContain("Playwright browsers must already be installed");
    expect(markdown).toContain(DIGEST_A);
  });

  test("says explicitly when no friction was recorded", () => {
    const markdown = renderAttestationMarkdown(buildAttestation(baseInput()));
    expect(markdown).toMatch(/no friction/i);
  });
});
