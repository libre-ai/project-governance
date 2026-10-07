import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * SOV-01 reconstruct-without-origin (sovereignty.v1): this check does NOT
 * replay the reproduction loop — that is the adoption attestation deliverable
 * (positioning L3, produced on its own branch). It only reads the latest
 * published attestation, so the sovereignty report can cite it (pass), flag a
 * non-passing attestation (fail), or honestly state the coverage gap
 * (pending) while L3 is not yet published. Contract v0: a JSON object with a
 * string `status` field; the L3 producer is authoritative on the final shape.
 */
export const ADOPTION_ATTESTATION_RELATIVE_PATH = "distribution/evidence/adoption/latest.json";

export type AttestationOutcome =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly detail: string }
  | { readonly kind: "present"; readonly path: string; readonly status: string };

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function readAdoptionAttestation(repoRoot: string): Promise<AttestationOutcome> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, ADOPTION_ATTESTATION_RELATIVE_PATH), "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { kind: "absent" };
    }
    return { kind: "unreadable", detail: "attestation file exists but cannot be read" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "unreadable", detail: "attestation is not valid JSON" };
  }
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    // The shipped L3 schema (libre-ai.adoption-reproduction.v1) carries the
    // run outcome in `verdict`; `status` is kept as a fallback so an older
    // draft attestation would still be readable rather than reported broken.
    const record = parsed as Record<string, unknown>;
    const verdict: unknown = record.verdict ?? record.status;
    if (typeof verdict === "string") {
      return { kind: "present", path: ADOPTION_ATTESTATION_RELATIVE_PATH, status: verdict };
    }
  }
  return { kind: "unreadable", detail: "attestation has no string `verdict` field" };
}
