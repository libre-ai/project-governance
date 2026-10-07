# Loop-security kernel lock (K1–K5)

- **Status:** socle specification of the loop-security kernel — realizes
  invariant **I-18** (ADR-0009 §6). Consumes the control-plane input
  `constantin-jais/constantin-jais:ecosystem/specs/shared/loop-security-kernel.md`.
- **Authority:** this document **specifies** the five loop-security controls at
  the socle and was the **entry gate of wave 3**. The orchestrator Specification
  Lock was pronounced by the owner on 2026-07-20 (ADR-0018 §Contexte, accepted
  2026-07-25: "the five loop-security kernel controls are `in service` — K1
  included"). All five controls reached `in service` that day (K1 by PR #150,
  the last to close) — see the status table below, which is this document's
  single normative status source. `POLARIS.md` and `THREAT-MODEL.md` point here
  rather than restating a status (domain F/H, 2026-08-18).
- **Nature:** these are guardrails (I-17 human-touch surface). Establishing and
  mutating them is an owner-touch act; this specification is pronounced by the
  owner at the wave-3 gate, not auto-merged.

The self-feeding agent loop is the product zero. A loop that feeds on its own
operational output can poison itself: operational data is untrusted content, and
the agents that improve the tools are the agents those tools govern. K1–K5 close
that hole. Each control names its **requirement**, its **socle realization**, and
its **enforcement**.

### State vocabulary (normative)

- **in service** — realized and enforced today by a merged brick or gate.
- **reviewed** — implemented, independently reviewed clean; a bounded follow-up
  (a contract promotion) completes it, named explicitly.
- **specified** — fully and faithfully specified here; its **integration** is an
  explicit step of a subsequent owner-pronounced lock (not a gap in this
  specification).

A control being `reviewed` or `specified` rather than `in service` is **not** an
omission: it distinguishes "specified and ready to lock" from the orchestrator
lock pronouncement (the porte-V3 owner act) that closes the gap. That gap is
now closed for all five controls — see the status table — but the three-state
vocabulary stays normative for any control this kernel adds later.

## K1 — Agent identity (the absent lock)

**Requirement.** The G1 identity lock (`IDENTITY-AUTHORIZATION.md`) covers humans
and browser sessions, never agent fleets. The kernel adds an agent identity
taxonomy expressed as locked Biscuit facts:

- `agent_fleet(agent_id, fleet)` — every agent belongs to exactly one fleet
  (e.g. `forge`, `product-ops`);
- `mission_agent(agent_id, mission_id)` — an agent operates within one mission;
  cross-mission operation is denied by an authorizer `check if`;
- `capability_scope(agent_id, capability_set)` — an explicit permission vector
  (which tools, which write paths; never CI/gates by default);
- revocation is **per `agent_id`**, not per token: a revoked agent issues no new
  tokens; the revocation store fails closed (unavailable ⇒ deny), consistent
  with the G1 Biscuit doctrine.

**Socle realization.** The Biscuit issuance/attenuation/revocation machinery is
locked (`WP-G2-Z01`, `crates/authz-biscuit`, `IDENTITY-AUTHORIZATION.md` Biscuit
authority). The three agent facts and per-agent revocation were added in the
v2 authority template `contracts/authz/authority-v2.datalog` and its companion
authorizer `contracts/authz/agent-runs-v2.datalog` (cross-fleet/mission `check
if` clauses), both promoted `candidate → locked` 2026-07-20 (PR #150) once
every precondition closed with real evidence: taxonomy in the template (#143),
the authorizer (#145), a real-Biscuit runtime proof of cross-fleet denial in
`ecosystem-engine` (#146), agent-token issuance carrying the three facts
(`authz-biscuit` #147), and fail-closed per-agent revocation at issuance (#149)
— dossier `docs/reviews/authority-v2/PROMOTION-DOSSIER.md`. Human and
browser-session tokens are unaffected: they keep using authority-v1.
Deferred, non-blocking per that dossier: immediate invalidation of tokens
already issued to a since-revoked agent (bounded by the ≤900s TTL until a
runtime consumer adds live-invalidation) and `capability_scope` enforcement at
the tool/write-path boundary (a runtime-consumer responsibility, not yet
built).

**Enforcement.** Deny-by-default authorizer; cross-mission and out-of-scope
operations refused; revocation fail-closed. No agent token grants CI/gate write
by default.

## K2 — Data reliability classification

**Requirement.** Every payload carries `reliability ∈ {authoritative, derived,
operational}` at capture. Operational data (tool outputs, APIs, web, git logs)
is **never** authority; no write to a source of truth (doctrine, gates,
revocation list, permission vocabulary, contracts) may be justified by
operational data alone.

**Socle realization.** `@libre-ai/classification` (this wave): sealed, frozen
`classify` / `deriveFrom`; `requireAuthorityFor` fails closed unless the payload
is a sealed authoritative one; derivation cannot launder operational data into
authority. Independent review CLEAN (`docs/reviews/classification-v1/`).

**Enforcement.** Any source-of-truth write path calls `requireAuthorityFor`;
forged or deserialized payloads fail closed (not sealed).

## K3 — Envelope integrity

**Requirement.** Every recalled untrusted payload carries an integrity-signed
envelope (escape + `trusted:false` tag + label + verifiable signature), so a
stripped or altered envelope is detectable. A surface that re-serializes recalled
data re-applies the envelope; it is never left to caller discipline.

**Socle realization.** `@libre-ai/envelope` (this wave): `wrapUntrusted` /
`verifyEnvelope` / `renderGuarded`, HMAC over a length-prefixed canonical
serialization, constant-time verify, provable delimiter escaping. Contract
`envelope.v1` (candidate → locked on the first dogfooding consumer). Independent
review: security APPROVE, crypto APPROVE (`docs/reviews/envelope-v1/`). Honest
limit: a mitigation, not enforcement — it sits alongside planning-only and
refusal-first, not instead of them.

**Enforcement.** Every model-facing recall path wraps via `wrapUntrusted` and
renders via `renderGuarded` (which verifies first). The Ed25519 origin-signature
upgrade is deferred (WP-G2-Z01 key ceremony).

## K4 — Layer-3 and guardrail mutations

**Requirement.** Writes to layer-3 bricks (envelope patterns, memory schema,
provenance contracts, proof format) and to guardrails (CI workflows, the
invariants register, the revocation list) require, in order: human review, a
signature attesting the approving decision-log entry, and a bounded rollback
point. **No auto-merge on these paths.**

**Socle realization.** No `.github/CODEOWNERS` file exists in this repository
(`G0-CANONICAL-BOOTSTRAP.md` already records that CODEOWNERS enforcement stays
disabled until reviewer teams exist) and the `Doctrine governance` gate checks
ADR/invariants hygiene, not reviewer attestation — an earlier revision of this
section claimed both as the realization, which did not match the running
gates. The honest realization for a solo-maintainer forge (K4 redefinition,
Domain A re-ratification, ADR-0023, 2026-08-18): a documented adversarial
review pass — the independent-review protocol
(`docs/reviews/AGENT-REVIEW-PROTOCOL.md`, K4: implementer ≠ reviewer), exercised
on every couche-3 brick (envelope, classification, authority-v2/agent-runs-v2)
— followed by an owner merge, itself the signature (`AGENTS.md`: "a doctrine
merge is a signature"). The run's autonomous-merge authorization explicitly
**excludes** these guardrail paths — they remain owner-touch (I-17).

**Enforcement.** `tools/quality/check-review-evidence.ts` (merged, PR #37) is
the mechanical backstop on pull requests: it fails a PR touching `docs/adr/**`,
`docs/decisions/INVARIANTS.md` or `docs/decisions/DECISION-REGISTER.md` unless
the PR body or diff carries a `docs/reviews/` artefact reference or a dated
`Owner-arbitration:` marker. Its gated-path list does not (yet) cover CI
workflow files or the runtime revocation store this requirement also names —
an honest gap, not claimed closed. Tool-state retrieval that feeds a guardrail
mutation uses DNS-pinned transport (control-plane E10) with a timestamped
signature; a DNS/data mismatch aborts.

## K5 — Immutable register in production

**Requirement.** The invariants register is mutable only by reviewed pull
request; no loop mutates it in production. This is the structural guarantee
behind "no loop modifies its own guardrails."

**Socle realization.** `docs/decisions/INVARIANTS.md` under the human-touch
surface (I-17: extensible only by ADR), protected `main` with required checks,
the `Doctrine governance` gate (unique ADR numbering, mandatory Arbitrage line,
resolved citations, retired-brand deny-list).

**Enforcement.** No agent path writes `INVARIANTS.md` outside a reviewed PR;
`main` protection + required gates are the structural backstop.

## Enforcement boundary (wave-3 entry gate)

K1–K5 were the entry gate of wave 3. The orchestrator Specification Lock was
pronounced by the owner 2026-07-20 (ADR-0011 D3, a permanent nominative hard
stop, exercised then and not repeatable as a routine gate) and ADR-0018
(accepted 2026-07-25) records that wave 3's entry gate was satisfied that day:
"the five loop-security kernel controls are `in service` — K1 included, whose
agent identity facts are integrated into the Biscuit authority with fail-closed
per-agent revocation." Dogfooding-first applies: the forge itself is the first
system these controls govern, and its evidence of doing so is published (I-20).

**All five controls are `in service`; none remain pending at a later lock.**
K1's agent identity facts (`agent_fleet`, `mission_agent`, `capability_scope`)
and per-agent revocation, once described above as integrating "at the
orchestrator lock", are integrated: `contracts/authz/authority-v2.datalog` and
`contracts/authz/agent-runs-v2.datalog`, both `locked` in
`contracts/catalog.v1.json`, carry them (see K1 above). This document's own
prose said otherwise in an earlier revision — the 2026-07-20 promotion (PR
#150) updated only the status table below, not this section or the header;
that gap between sections is the drift this revision (domain F/H, 2026-08-18)
closes.

## Status of the five controls at this lock

| Control                | Socle brick / mechanism                                                     | State                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1 agent identity      | Biscuit (Z01) + the three agent facts + per-agent revocation                | **in service** — `authority-v2` + `agent-runs-v2` locked; fleet/mission enforced (real-biscuit proof), issuance carries the three facts, per-agent revocation is fail-closed |
| K2 classification      | `@libre-ai/classification`                                                  | **in service** — sealed authority gate, reviewed CLEAN                                                                                                                       |
| K3 envelope            | `@libre-ai/envelope` (`envelope.v1` locked)                                 | **in service** — contract locked after first dogfooding consumer (fanout orchestrator wraps evidence); HMAC integrity enforced at every model-facing recall path             |
| K4 guardrail mutations | independent review + owner merge, backstopped by `check-review-evidence.ts` | **in service** — ADR-0023 (2026-08-18) redefinition; no CODEOWNERS file exists in this repository, corrected here (see K4 above)                                             |
| K5 immutable register  | `INVARIANTS.md` + main protection + doctrine gate                           | **in service**                                                                                                                                                               |
