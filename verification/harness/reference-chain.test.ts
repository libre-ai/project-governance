import { describe, expect, test } from "bun:test";
import { buildReferenceChainReport, type ChainStep, type StepOutcome } from "./reference-chain";

/**
 * WP-G2-Q01 acceptance criterion 1: a clean checkout exercises the foundation
 * chain (Bun.serve, React, contracts, RLS, Biscuit, WIT, Proof, Artifact,
 * Playwright). This harness names the chain as ordered, modular steps and
 * aggregates their outcomes into a machine-readable, digest-anchored evidence
 * report. The pure aggregation is tested here; the entrypoint runs the real
 * step commands. Evidence is digest-anchored, NOT cryptographically signed —
 * signing waits for the provenance brick (wave 2), consistent with the P3
 * lineage deferral (no key ceremony authorized, WP-G2-Z01).
 */

const STEPS: readonly ChainStep[] = [
  { id: "contracts", label: "Contracts + generated projections", command: ["true"] },
  {
    id: "rls",
    label: "Tenant RLS barrier (D01)",
    command: ["true"],
    requiresPath: "packages/data",
  },
];

function outcome(id: string, status: StepOutcome["status"]): StepOutcome {
  return { id, status, durationMs: 1 };
}

describe("buildReferenceChainReport", () => {
  test("is 'passed' only when every required step passed", () => {
    const report = buildReferenceChainReport(STEPS, [
      outcome("contracts", "passed"),
      outcome("rls", "passed"),
    ]);
    expect(report.status).toBe("passed");
    expect(report.steps).toHaveLength(2);
  });

  test("is 'failed' when any run step failed", () => {
    const report = buildReferenceChainReport(STEPS, [
      outcome("contracts", "failed"),
      outcome("rls", "passed"),
    ]);
    expect(report.status).toBe("failed");
  });

  test("a skipped gated step (its path absent) does not fail the chain but is recorded", () => {
    // Before D01 merges, packages/data is absent from a clean main checkout:
    // the RLS step is skipped, not failed, and the report says so explicitly.
    const report = buildReferenceChainReport(STEPS, [
      outcome("contracts", "passed"),
      outcome("rls", "skipped"),
    ]);
    expect(report.status).toBe("passed-with-skips");
    expect(report.steps.find((s) => s.id === "rls")?.status).toBe("skipped");
    expect(report.skipped).toEqual(["rls"]);
  });

  test("the report digest is stable for identical inputs and changes with them", () => {
    const a = buildReferenceChainReport(STEPS, [
      outcome("contracts", "passed"),
      outcome("rls", "passed"),
    ]);
    const b = buildReferenceChainReport(STEPS, [
      outcome("contracts", "passed"),
      outcome("rls", "passed"),
    ]);
    const c = buildReferenceChainReport(STEPS, [
      outcome("contracts", "passed"),
      outcome("rls", "skipped"),
    ]);
    expect(a.digest).toBe(b.digest);
    expect(a.digest).not.toBe(c.digest);
    expect(a.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("the digest excludes volatile durations (evidence is reproducible)", () => {
    const fast = buildReferenceChainReport(STEPS, [
      { id: "contracts", status: "passed", durationMs: 1 },
      { id: "rls", status: "passed", durationMs: 1 },
    ]);
    const slow = buildReferenceChainReport(STEPS, [
      { id: "contracts", status: "passed", durationMs: 999 },
      { id: "rls", status: "passed", durationMs: 999 },
    ]);
    expect(fast.digest).toBe(slow.digest);
  });

  test("rejects an outcome for an unknown step", () => {
    expect(() => buildReferenceChainReport(STEPS, [outcome("ghost", "passed")])).toThrow(
      /unknown step/i,
    );
  });

  test("rejects a missing outcome for a declared step", () => {
    expect(() => buildReferenceChainReport(STEPS, [outcome("contracts", "passed")])).toThrow(
      /missing outcome/i,
    );
  });
});
