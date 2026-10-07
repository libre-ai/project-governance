// Advisory parsing shared by the two halves of ADR-0021: the fleet control
// (check-fleet-advisories, D1) and the per-pull-request delta gate
// (check-audit-delta, D2). Both read `bun audit` output, so the reading lives
// once.

const GHSA_PATTERN = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/g;

export interface AdvisoryRepositoryEntry {
  readonly repository: string;
  readonly lifecycle: "active" | "archived";
  readonly visibility: "public" | "private";
}

export function selectPublicAdvisoryRepositories(
  repositories: readonly AdvisoryRepositoryEntry[],
): string[] {
  return repositories
    .filter((entry) => entry.lifecycle === "active" && entry.visibility === "public")
    .map((entry) => entry.repository);
}

/** Unique, sorted GHSA identifiers found in a `bun audit` output. */
export function extractAdvisoryIds(output: string): string[] {
  return [...new Set(output.match(GHSA_PATTERN) ?? [])].sort();
}

export interface AdvisoryDelta {
  /** Present on head, absent on base: what THIS change introduces. Blocking. */
  readonly introduced: string[];
  /** Present on both: the state of the world, owned by the fleet control. */
  readonly preExisting: string[];
}

export function diffAdvisories(base: readonly string[], head: readonly string[]): AdvisoryDelta {
  const baseSet = new Set(base);
  return {
    introduced: head.filter((id) => !baseSet.has(id)),
    preExisting: head.filter((id) => baseSet.has(id)),
  };
}

export type AuditScope =
  | { readonly kind: "auditable" }
  | { readonly kind: "nothing-to-audit" }
  | { readonly kind: "unparseable"; readonly detail: string };

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * What a package.json asks of `bun audit` before any lockfile is looked for.
 *
 * Bun refuses to persist an empty lockfile ("No packages! Deleted empty
 * lockfile", 1.4.0-canary.1, measured 2026-09-07 on libre-ai/carriere), so a
 * manifest with no dependency at all can never ship a bun.lock — demanding
 * one demanded an artifact that cannot exist. Nothing to audit is a held
 * assertion, said explicitly by the caller; a manifest with dependencies and
 * no lockfile remains the unpinned, unauditable failure it always was.
 */
export function auditScope(manifestText: string): AuditScope {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    return { kind: "unparseable", detail: error instanceof Error ? error.message : String(error) };
  }
  if (manifest === null || typeof manifest !== "object") {
    return { kind: "unparseable", detail: "package.json is not a JSON object" };
  }
  const record = manifest as Record<string, unknown>;
  for (const field of DEPENDENCY_FIELDS) {
    const value = record[field];
    if (value !== null && typeof value === "object" && Object.keys(value).length > 0) {
      return { kind: "auditable" };
    }
  }
  return { kind: "nothing-to-audit" };
}

export interface AuditReading {
  /** The audit RAN — clean or with findings. False means it could not answer. */
  readonly ran: boolean;
  readonly advisories: string[];
  readonly detail: string;
}

/**
 * Interpret one `bun audit` run from its exit code and output.
 *
 * `bun audit` exits 0 when clean and 1 when it found advisories — but 1 is
 * also what a network failure produces. "Found nothing" and "could not look"
 * must never be conflated (the lesson DOCTRINE-REPLICATION records), so a
 * non-zero exit only counts as a *finding* when the output actually carries
 * advisory identifiers or the explicit vulnerability count; anything else is
 * an audit that could not answer, and the caller fails on it.
 */
export function readAudit(exitCode: number, output: string): AuditReading {
  const advisories = extractAdvisoryIds(output);
  if (exitCode === 0) {
    return { ran: true, advisories, detail: "clean" };
  }
  if (advisories.length > 0 || /\d+ vulnerabilit/.test(output)) {
    return { ran: true, advisories, detail: `${advisories.length} advisory id(s)` };
  }
  return {
    ran: false,
    advisories: [],
    detail: `bun audit exited ${exitCode} without an advisory listing — not a clean result, an unanswered question`,
  };
}
