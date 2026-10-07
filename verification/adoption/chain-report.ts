/**
 * Extraction of the reference-chain report from a mixed stdout stream
 * (positioning L3).
 *
 * `verification/harness/reference-chain.ts` prints its JSON report as the
 * last thing on stdout, but the chain's sub-commands inherit that stream and
 * write their own output first. Rather than change the harness (its contract
 * is locked by its own evidence), the adoption loop recovers the last valid
 * report from the noise and refuses anything that does not carry the exact
 * schema version and a well-formed digest — a wrong digest silently accepted
 * would corrupt the attestation's central comparison.
 */

// Type-only reuse of the existing harness contract: no runtime coupling.
import type { ChainStatus } from "../harness/reference-chain";

export interface ChainReportSummary {
  readonly status: ChainStatus;
  readonly digest: string;
  readonly skipped: readonly string[];
}

const CHAIN_SCHEMA_VERSION = "libre-ai.reference-chain.v1";
const CHAIN_STATUSES: readonly ChainStatus[] = ["passed", "passed-with-skips", "failed"];
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function toSummary(candidate: unknown): ChainReportSummary | null {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  if (record.schemaVersion !== CHAIN_SCHEMA_VERSION) {
    return null;
  }
  const { status, digest, skipped } = record;
  if (typeof status !== "string" || !CHAIN_STATUSES.includes(status as ChainStatus)) {
    return null;
  }
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
    return null;
  }
  if (!Array.isArray(skipped) || skipped.some((id) => typeof id !== "string")) {
    return null;
  }
  return { status: status as ChainStatus, digest, skipped: skipped as string[] };
}

/**
 * Scans the stream from the end: every line that opens a JSON object is a
 * candidate start, and the first candidate (from the end) that parses into a
 * valid report wins. Returns null when no valid report exists — the caller
 * records that as friction instead of crashing.
 */
export function parseChainReportFromOutput(stdout: string): ChainReportSummary | null {
  const lines = stdout.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.trimEnd() !== "{") {
      continue;
    }
    const candidateText = lines.slice(index).join("\n").trim();
    try {
      const summary = toSummary(JSON.parse(candidateText));
      if (summary !== null) {
        return summary;
      }
    } catch {
      // Not a complete JSON object from this line onward; keep scanning.
    }
  }
  return null;
}
