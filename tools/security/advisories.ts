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

/**
 * One read of a file through the contents API, classified.
 *
 * Three answers, never two: the file is there, the forge said it is not
 * (`absent`), or the question went unanswered (`unreadable`). Before
 * 2026-10-09 the Bun half of the fleet control collapsed the last two —
 * any non-zero `gh` exit read as "no package.json", so a 403, a quota, a 5xx
 * or a dropped connection was counted as a repository with no JS dependency
 * surface, and passed. Same contract as the Rust half (`answered`) and as the
 * fleet gates' `ghWithRetry`: a 404 is an answer, anything else is not.
 */
export type ContentsRead =
  | { readonly kind: "found"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly detail: string };

/** `gh api` prints the HTTP status of a rejected request as `(HTTP 404)` on stderr. */
const NOT_FOUND = /\(HTTP 404\)/;

/**
 * Classify one `gh api repos/<r>/contents/<path>` call made with the raw media
 * type. Pure, so every class of failure is tested without a network.
 *
 * A raw read that succeeds returns the file's bytes. An empty body, or the
 * JSON metadata envelope / directory listing the endpoint returns when the raw
 * media type is not honoured, is not the file: it is a malformed answer, and
 * reading it as the file would let a metadata object pass as a manifest that
 * declares no dependency.
 */
export function classifyContentsRead(
  exitCode: number,
  stdout: string,
  stderr: string,
): ContentsRead {
  if (exitCode !== 0) {
    if (NOT_FOUND.test(stderr)) return { kind: "absent" };
    const reason = stderr.trim().split("\n")[0] ?? "";
    return {
      kind: "unreadable",
      detail: reason === "" ? `gh exited ${exitCode} without a message` : reason,
    };
  }
  if (stdout.trim() === "") {
    return { kind: "unreadable", detail: "contents API answered an empty body" };
  }
  if (isContentsEnvelope(stdout)) {
    return {
      kind: "unreadable",
      detail: "contents API answered metadata instead of the raw file",
    };
  }
  return { kind: "found", text: stdout };
}

function isContentsEnvelope(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON at all (bun.lock carries trailing commas): certainly not the envelope.
    return false;
  }
  if (Array.isArray(parsed)) return true;
  if (parsed === null || typeof parsed !== "object") return false;
  const record = parsed as Record<string, unknown>;
  return typeof record.sha === "string" && "_links" in record && "type" in record;
}

/** Reads one path of the repository under examination; injected for tests. */
export type ContentsReader = (path: string) => ContentsRead;

/** Runs `bun audit` over a manifest and its lockfile; injected for tests. */
export type BunAuditRunner = (
  manifest: string,
  lockfile: string,
) => { readonly exitCode: number; readonly output: string };

/**
 * Where one repository landed. The four outcomes partition the fleet, so the
 * volume line can prove that every repository was accounted for.
 */
export type BunOutcome = "absent" | "nothing-to-audit" | "audited" | "failed";

export interface BunExamination {
  readonly repository: string;
  readonly outcome: BunOutcome;
  readonly ok: boolean;
  readonly advisories: readonly string[];
  readonly note: string;
}

/** Examine the Bun dependency surface of one repository's served branch. */
export function examineBunRepository(
  repository: string,
  read: ContentsReader,
  audit: BunAuditRunner,
): BunExamination {
  const result = (outcome: BunOutcome, ok: boolean, note: string, advisories: string[] = []) => ({
    repository,
    outcome,
    ok,
    advisories,
    note,
  });

  const manifest = read("package.json");
  if (manifest.kind === "unreadable") {
    return result(
      "failed",
      false,
      `package.json unreadable (${manifest.detail}) — JS dependency surface unknown`,
    );
  }
  if (manifest.kind === "absent") {
    // Asserted, not skipped: the forge answered 404, which is a statement
    // about the repository and counts as an inspection.
    return result("absent", true, "no package.json — no JS dependency surface to audit");
  }
  const scope = auditScope(manifest.text);
  if (scope.kind === "unparseable") {
    return result("failed", false, `package.json unparseable — ${scope.detail}`);
  }
  if (scope.kind === "nothing-to-audit") {
    // A manifest without any dependency field cannot carry a lockfile: Bun
    // deletes an empty one ("No packages! Deleted empty lockfile"). Asking
    // for bun.lock here asked for an artifact that cannot exist (carriere,
    // 2026-09-07). Asserted out loud, never skipped in silence.
    return result(
      "nothing-to-audit",
      true,
      "package.json declares no dependency — nothing to audit (Bun persists no empty lockfile)",
    );
  }
  const lockfile = read("bun.lock");
  if (lockfile.kind === "unreadable") {
    return result(
      "failed",
      false,
      `bun.lock unreadable (${lockfile.detail}) — lockfile state unknown`,
    );
  }
  if (lockfile.kind === "absent") {
    // A manifest without a lockfile cannot be audited AND breaks the fleet's
    // pinning discipline — red on both counts.
    return result("failed", false, "package.json without bun.lock — unpinned, unauditable");
  }

  const run = audit(manifest.text, lockfile.text);
  const reading = readAudit(run.exitCode, run.output);
  if (!reading.ran) return result("failed", false, reading.detail);
  if (reading.advisories.length > 0) {
    return result(
      "audited",
      false,
      `lockfile carries ${reading.advisories.join(", ")}`,
      reading.advisories,
    );
  }
  return result("audited", true, "lockfile audited, no advisory");
}

export interface BunVolume {
  readonly repositories: number;
  readonly absent: number;
  readonly nothingToAudit: number;
  readonly audited: number;
  readonly failed: number;
  readonly advisories: number;
}

export function tallyBun(repositories: number, examinations: readonly BunExamination[]): BunVolume {
  const count = (outcome: BunOutcome) =>
    examinations.filter((examination) => examination.outcome === outcome).length;
  return {
    repositories,
    absent: count("absent"),
    nothingToAudit: count("nothing-to-audit"),
    audited: count("audited"),
    failed: count("failed"),
    advisories: examinations.reduce((sum, examination) => sum + examination.advisories.length, 0),
  };
}

/**
 * The volume line of the Bun half. `repositories` must equal absent +
 * nothing-to-audit + audited + failed; a mismatch is a counting defect of the
 * control itself and is said on the line rather than hidden.
 */
export function bunVolumeLine(volume: BunVolume): string {
  const sum = volume.absent + volume.nothingToAudit + volume.audited + volume.failed;
  const mismatch =
    sum === volume.repositories
      ? ""
      : ` — COUNTING DEFECT: ${sum} accounted for, ${volume.repositories} examined`;
  return (
    `Bun: ${volume.repositories} repositories = ${volume.absent} without package.json + ` +
    `${volume.nothingToAudit} with nothing to audit + ${volume.audited} audited + ` +
    `${volume.failed} failed, ${volume.advisories} advisory(ies)${mismatch}`
  );
}

export function bunVolumeHolds(volume: BunVolume): boolean {
  return (
    volume.absent + volume.nothingToAudit + volume.audited + volume.failed === volume.repositories
  );
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
