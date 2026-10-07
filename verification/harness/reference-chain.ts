import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

/**
 * WP-G2-Q01 reference-chain harness (acceptance criterion 1). A single entry
 * point that exercises the foundation chain from a clean checkout and emits a
 * machine-readable, digest-anchored evidence report. The chain is declared as
 * ordered, modular steps so a gated step slots in without reshaping the
 * harness.
 *
 * Evidence is digest-anchored over the reproducible facts (step ids + statuses
 * in order), NOT cryptographically signed: signing waits for the provenance
 * brick (wave 2), consistent with the P3 lineage deferral — no key ceremony is
 * authorized (WP-G2-Z01). Volatile durations are recorded but excluded from
 * the digest so the evidence reproduces byte-for-byte.
 *
 * FOUNDATION_CHAIN was redefined 2026-08-19 for the post-γ perimeter (ADR-0020,
 * docs/adr/0020-general-activation-and-hub-dismantling.md). Acceptance
 * criterion 1 was originally proven from the pre-γ monorepo, where Bun.serve,
 * React, contracts, RLS, Biscuit, WIT, Proof, Artifact and Playwright all lived
 * in one checkout (see the 2026-07-20 entry kept for history in
 * wp-g2-q01-reference-chain-evidence.md). The γ split moved every one of those
 * out of this repository; each destination now gates itself in its own CI
 * (ecosystem/migration-index.v1.yaml, maintained in the hub during
 * dismantling, is the record of where):
 *   - contracts, generated-contracts, wit -> libre-ai/contracts
 *     (AGENTS.md: "Contract authorities are canonical in the contracts
 *     repository — never here")
 *   - web-react (packages/web-platform) -> libre-ai/web-platform
 *   - biscuit (crates/authz-biscuit)     -> libre-ai/authz-biscuit
 *   - proof-artifact (crates/artifact)   -> libre-ai/artifacts
 *   - rls (packages/data)                -> libre-ai/data
 *   - playwright (distribution/templates)-> libre-ai/starter
 * None of those paths can reappear in governance: AGENTS.md states "No Rust
 * workspace. No JavaScript source." as a structural invariant of this
 * repository, not a pending migration — so `requiresPath` gating them (as the
 * pre-γ chain did for rls/playwright) would leave permanent zombie steps
 * rather than a real gate. What IS replayable from a blank-room governance
 * clone today is governance's own quality-gate chain (`bun run check`,
 * AGENTS.md "Quality gates") plus the two governance-native checks CI runs
 * outside that umbrella (.github/workflows/ci.yml).
 */
export interface ChainStep {
  readonly id: string;
  readonly label: string;
  readonly command: readonly string[];
  /** If set, the step is skipped (not failed) when this repo path is absent. */
  readonly requiresPath?: string;
}

export interface StepOutcome {
  readonly id: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly durationMs: number;
}

export type ChainStatus = "passed" | "passed-with-skips" | "failed";

export interface ReferenceChainReport {
  readonly schemaVersion: "libre-ai.reference-chain.v1";
  readonly status: ChainStatus;
  readonly steps: readonly StepOutcome[];
  readonly skipped: readonly string[];
  readonly digest: string;
}

export function buildReferenceChainReport(
  steps: readonly ChainStep[],
  outcomes: readonly StepOutcome[],
): ReferenceChainReport {
  const byId = new Map(outcomes.map((o) => [o.id, o]));
  for (const outcome of outcomes) {
    if (!steps.some((step) => step.id === outcome.id)) {
      throw new Error(`unknown step in outcomes: ${outcome.id}`);
    }
  }
  const ordered: StepOutcome[] = [];
  for (const step of steps) {
    const outcome = byId.get(step.id);
    if (outcome === undefined) {
      throw new Error(`missing outcome for declared step: ${step.id}`);
    }
    ordered.push(outcome);
  }

  const skipped = ordered.filter((o) => o.status === "skipped").map((o) => o.id);
  const anyFailed = ordered.some((o) => o.status === "failed");
  const status: ChainStatus = anyFailed
    ? "failed"
    : skipped.length > 0
      ? "passed-with-skips"
      : "passed";

  // Digest over the reproducible facts only: ordered id:status pairs. Durations
  // and labels are excluded so re-running the same chain yields the same digest.
  const canonical = ordered.map((o) => `${o.id}:${o.status}`).join("\n");
  const digest = createHash("sha256").update(canonical).digest("hex");

  return {
    schemaVersion: "libre-ai.reference-chain.v1",
    status,
    steps: ordered,
    skipped,
    digest,
  };
}

/**
 * The foundation chain (acceptance criterion 1), post-γ perimeter: governance
 * holds doctrine, gates and evidence tooling only (AGENTS.md), so "the
 * foundation replayable from a blank-room clone of this repository" is its
 * own quality-gate chain plus the governance-native checks CI runs outside
 * that chain. See the module doc above for where every pre-γ step (contracts,
 * generated-contracts, web-react, biscuit, wit, proof-artifact, rls,
 * playwright) went and why none of them belongs here anymore.
 */
export const FOUNDATION_CHAIN: readonly ChainStep[] = [
  {
    id: "check",
    label: "Governance quality-gate chain (bun run check)",
    command: ["bun", "run", "check"],
  },
  {
    id: "secret-scan",
    label: "Secret scan (no committed credentials)",
    command: ["bun", "tools/quality/check-secret-scan.ts"],
  },
  {
    id: "no-clever",
    label: "No Clever resource / production claim",
    command: ["bun", "tools/quality/check-no-clever-production.ts"],
  },
];

async function pathExists(path: string): Promise<boolean> {
  // node:fs stat, not Bun.file().exists(): the latter reports false for a
  // directory, and gated paths (e.g. packages/data) are directories.
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runStep(step: ChainStep): Promise<StepOutcome> {
  if (step.requiresPath !== undefined && !(await pathExists(step.requiresPath))) {
    return { id: step.id, status: "skipped", durationMs: 0 };
  }
  const started = Bun.nanoseconds();
  const proc = Bun.spawn([...step.command], { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  const durationMs = Math.round((Bun.nanoseconds() - started) / 1_000_000);
  return { id: step.id, status: code === 0 ? "passed" : "failed", durationMs };
}

if (import.meta.main) {
  const outcomes: StepOutcome[] = [];
  for (const step of FOUNDATION_CHAIN) {
    console.error(`\n=== reference-chain: ${step.id} — ${step.label} ===`);
    outcomes.push(await runStep(step));
  }
  const report = buildReferenceChainReport(FOUNDATION_CHAIN, outcomes);
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "failed") {
    console.error("Reference chain FAILED (WP-G2-Q01 acceptance 1).");
    process.exit(1);
  }
  console.error(`Reference chain ${report.status} — digest ${report.digest}`);
}
