/**
 * Loop-security kernel K2 — data reliability classification.
 *
 * Every payload carries a reliability at capture:
 * - `authoritative` — source-controlled (signed Git commits, Biscuit-verified
 *   decisions, the invariants register);
 * - `derived` — computed from authoritative data, tracing to its spans;
 * - `operational` — tool outputs, API and web responses, git logs. NEVER
 *   authority.
 *
 * The load-bearing invariant: no write to a source of truth (doctrine, gates,
 * revocation list, permission vocabulary, contracts) may be justified by
 * `operational` data alone. Operational data enters plans as evidence, never
 * as directive — facts are never commands.
 */

const RELIABILITIES = ["authoritative", "derived", "operational"] as const;
export type Reliability = (typeof RELIABILITIES)[number];

export interface Classified<T> {
  readonly reliability: Reliability;
  readonly value: T;
}

// Module-private seal: only objects this module built are trusted. A WeakSet
// (not a Symbol property) cannot be forged by structural copying or JSON
// deserialization, so an attacker-shaped `{reliability:"authoritative"}` is
// never sealed and fails closed at the authority gate (review K-01). Sealed
// objects are also frozen, so their class cannot be mutated (review K-02).
const sealed = new WeakSet<object>();

export class OperationalNotAuthorityError extends Error {
  constructor(sink: string, reliability: Reliability) {
    // Names the sink and the offending class, never the payload value.
    super(`${reliability} data may not authorize a write to ${sink} (K2: only authoritative may)`);
    this.name = "OperationalNotAuthorityError";
  }
}

export class UnsealedClassificationError extends Error {
  constructor(sink: string) {
    super(`unsealed classification may not authorize a write to ${sink} (K2: forged or tampered)`);
    this.name = "UnsealedClassificationError";
  }
}

function isReliability(value: string): value is Reliability {
  return (RELIABILITIES as readonly string[]).includes(value);
}

function seal<T>(payload: Classified<T>): Classified<T> {
  const frozen = Object.freeze(payload);
  sealed.add(frozen);
  return frozen;
}

export function classify<T>(reliability: Reliability, value: T): Classified<T> {
  if (!isReliability(reliability)) {
    throw new RangeError(`unknown reliability class ${JSON.stringify(reliability)}`);
  }
  return seal({ reliability, value });
}

/** True only for a genuinely sealed, authoritative payload built by this module. */
export function isAuthoritative<T>(payload: Classified<T>): boolean {
  return sealed.has(payload) && payload.reliability === "authoritative";
}

/**
 * The K2 gate: only a sealed, authoritative payload may authorize a write to a
 * source of truth. An unsealed (forged/deserialized/tampered) payload fails
 * closed, and derived or operational data is refused.
 */
export function requireAuthorityFor<T>(sink: string, payload: Classified<T>): void {
  if (!sealed.has(payload)) {
    throw new UnsealedClassificationError(sink);
  }
  if (payload.reliability !== "authoritative") {
    throw new OperationalNotAuthorityError(sink, payload.reliability);
  }
}

/**
 * Derive a new payload from a non-empty set of SEALED sources. The result is at
 * most `derived`, and any `operational` source taints it to `operational`:
 * derivation can never launder operational data into authority. An unsealed
 * source fails closed — provenance cannot be asserted for a forged input.
 */
export function deriveFrom<T>(value: T, sources: readonly Classified<unknown>[]): Classified<T> {
  if (sources.length === 0) {
    throw new RangeError("a derivation requires at least one source");
  }
  for (const source of sources) {
    if (!sealed.has(source)) {
      throw new UnsealedClassificationError("derivation");
    }
  }
  const reliability: Reliability = sources.some((s) => s.reliability === "operational")
    ? "operational"
    : "derived";
  return seal({ reliability, value });
}
