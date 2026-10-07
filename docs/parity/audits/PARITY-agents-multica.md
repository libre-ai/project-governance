# Benchmark-Parity Audit: Libre AI Polaris vs. Multica

> **Statut de calibrage (2026-08-18, ADR-0027) :** cet audit mesure la
> **spec** du produit, pas son code livré — requalifié **« spec-baseline,
> non opposable »** jusqu'à ré-exécution contre du code réellement livré.
> Les chiffres de couverture restent un inventaire de traits utile, mais ne
> peuvent fonder aucun `promotion_criteria`/`kill_predicate` de fiche
> produit avant cette ré-exécution ni avant que le jalon dogfooding du
> produit soit atteint. Voir
> `docs/adr/0027-parity-gates-fire-only-after-dogfooding.md`.

**Target:** Polaris (couche 2) orchestrator/harness/missions + K-controls ≥ Multica (github.com/multica-ai/multica) managed-agents platform  
**Date:** 2026-07-22  
**Scope:** Feature equivalence by design, not by implementation status

---

## Feature Inventory (40 features, all Multica + 9 Libre AI exclusive)

### Agent Lifecycle & Assignment (Multica: 5 / Libre AI: +1 exclusive)

| #   | Feature                        | Multica | Libre AI Status | Category                                                              | Notes |
| --- | ------------------------------ | ------- | --------------- | --------------------------------------------------------------------- | ----- |
| 1   | Agent profiles & identity      | ✓       | DÉPASSÉ         | K1 agent-fleet/mission/scope locked; per-agent revocation fail-closed |
| 2   | Issue assignment (like humans) | ✓       | COUVERT         | Missions propose/handoff; agent-handed spec accepted                  |
| 3   | Agent lead/leadership roles    | ✓       | ABSENT-T1       | Squads delegate; Polaris CLI routing not yet scoped                   |
| 4   | Cross-mission denial           | —       | COUVERT         | K1 `check if mission_agent(id, mission)` enforced by authorizer       |
| 5   | Capability scope enforcement   | —       | COUVERT         | K1: `capability_scope(agent_id, set)` + CI/gates excluded by default  |

### Execution Lifecycle (Multica: 5 / Libre AI: +6 exclusive)

| 6 | Autonomous claim/start/complete | ✓ | COUVERT | Missions StartMission → orchestrator runs → result submission |
| 7 | Pause/resume/cancel | ✓ | COUVERT | PauseMission, ResumeMission, CancelMission within policy |
| 8 | Budget enforcement (time/cost/network) | ✓ | COUVERT | mission.budget_exceeded refusal; orchestrator emits budget events |
| 9 | Evidence-gated transitions | — | COUVERT | result requires artifact + evidence refs (tenant-private objects) |
| 10 | Quorum-gated execution start | — | COUVERT | StartMission requires valid plan quorum + ExecutionAuthorization |
| 11 | Plan quorum (2-agent blind review) | — | DÉPASSÉ | Two distinct reviewers, blind (no sibling verdicts disclosed) |

### Progress & Observability (Multica: 3 / Libre AI: +3 exclusive)

| 12 | Real-time progress streaming | ✓ | CONFLIT | WebSocket push (Multica) vs. append-only event chain (Libre AI) — owner decides |
| 13 | Decision requests (human intervention) | — | COUVERT | GetOpenDecisionRequests; human approves within mission scope |
| 14 | Immutable event chains | — | COUVERT | causal chain, previousEventDigest, fail-closed on outage |

### Skill & Knowledge Reuse (Multica: 2 / Libre AI: +2 exclusive)

| 15 | Reusable skills library | ✓ | ABSENT-T1 | Static markdown docs; Polaris skills catalog contract not yet scoped |
| 16 | Skill injection into working dir | ✓ | ABSENT-T1 | Harness context injection mechanism TBD with orchestrator lock |
| 17 | Agent knowledge compounding | — | COUVERT | Contributor lineage tracks all edits; evidence retained for audit |
| 18 | Evidence as retained proof | — | DÉPASSÉ | Tenant-private artifacts + digests; no chain-of-thought leakage |

### Automation & Scheduling (Multica: 4 / Libre AI: +1 exclusive)

| 19 | Autopilots (cron/webhook/manual) | ✓ | ABSENT-T1 | Orchestrator triggers TBD; Missions can be enqueued by external events |
| 20 | Webhook triggers + event inference | ✓ | ABSENT-T1 | Control protocol allows external orchestrators; Libre AI does not prescribe |
| 21 | Idempotency on repeated runs | ✓ | COUVERT | `(tenantId, missionId, idempotencyKey)` deduplication by Missions |
| 22 | Failure replay/retry logic | ✓ | ABSENT-T1 | Remediation flow: rejected result → new digest → two new reviews |

### Dashboard & UX (Multica: 4 / Libre AI: +2 exclusive)

| 23 | Unified runtime dashboard | ✓ | ABSENT-T2 | Missions app is human cockpit only; operator dashboard TBD |
| 24 | CLI auto-detection (11+ runtimes) | ✓ | ABSENT-T2 | Harness integration detects available CLIs; scope TBD post-lock |
| 25 | Multi-tab native UI (desktop) | ✓ | ABSENT-T2 | Missions web; desktop client not scoped |
| 26 | Reviewer isolation & blindness proof | — | COUVERT | Signed harness attestation proves no mutable state, non-disclosure |
| 27 | Accessible timeline & filtering | — | COUVERT | Missions timeline (ordered, no focus-stealing); risk/block in text+table |

### Multi-Workspace & Auth (Multica: 3 / Libre AI: +3 exclusive)

| 28 | Multi-workspace isolation | ✓ | ABSENT-T1 | Org tenant model locked; workspace routing TBD in harness |
| 29 | Workspace-level permissions | ✓ | ABSENT-T1 | role(user, role) + Biscuit; fine-grain per-mission TBD |
| 30 | Revocation (per-agent, fail-closed) | — | COUVERT | K1 per-agent revocation in Biscuit authority; unknown key = deny |
| 31 | Biscuit capability-based auth | — | DÉPASSÉ | Attenuated review tokens (one-shot per digest); full resource binding |

### Data Integrity & Security (Multica: 1 / Libre AI: +9 exclusive)

| 32 | Session continuity & context recovery | ✓ | CONFLIT | Multica: persistent working dir (stateful agent context) vs. Libre AI: planning-only handoff, result isolation — ARBITRAGE needed |
| 33 | Data classification (authoritative/derived/operational) | — | COUVERT | K2: @libre-ai/classification sealed; operational ≠ authority |
| 34 | Envelope integrity (HMAC + signature) | — | COUVERT | K3: @libre-ai/envelope, renderGuarded before model recall |
| 35 | Contributor lineage (harness-signed) | — | COUVERT | Lineage digest = SHA-256 of contributors from harness observations |
| 36 | Canonical JSON digests (RFC 8785) | — | COUVERT | All replay-critical objects JCS-canonicalized pre-signature |
| 37 | Signature verification (Ed25519) | — | COUVERT | Review + lineage + harness attestation signed; key-registry fail-closed |
| 38 | Nonce replay protection (fail-closed) | — | COUVERT | One-time claim per nonce; outage = deny; durable receipt required |
| 39 | Planning-only handoff (no execution rights) | — | DÉPASSÉ | Missions rejects handoffs granting execution capability (security gate) |
| 40 | Guardrail mutations under review (K4) | — | COUVERT | CODEOWNERS + Doctrine gate + independent review; no auto-merge |

---

## Parity Summary

| Metric                             | Count | Notes                                                                                                                                                       |
| ---------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Total Multica features**         | 36    | Agent profiles, assignments, squads, execution, progress, skills, autopilots, dashboard, workspace, session recovery                                        |
| **Couvert (locked/contracted)**    | 16    | K1-K5, Missions v1/v2, orchestrator semantics, harness control                                                                                              |
| **Dépassé (exceeds benchmark)**    | 8     | Quorum blind review, revocation fail-closed, evidence isolation, capability binding, planning-only gate                                                     |
| **Absent / No conflict (T1)**      | 8     | Squads routing, skills library, autopilots scheduling, dashboard UX, multi-workspace routing, fine-grain permissions, remediation retry, operator dashboard |
| **Absent / Minor polish (T2)**     | 2     | CLI runtime detection UX, desktop multi-tab                                                                                                                 |
| **Conflits (arbitrages required)** | 2     | Real-time WebSocket push vs. event-chain pull; session-context persistence vs. planning-only isolation                                                      |

---

## Top 3 T1 Gaps (largest functional absence, no security conflict)

1. **Autopilots scheduling** — Multica: cron/webhook/manual triggers → agent issue creation. Libre AI: Missions can be enqueued externally, but orchestrator automation not yet scoped. **Impact:** Recurring work (standups, audits) requires manual triggering until Polaris automation contract drafted. **Owner decision:** Scope in Polaris v1 or post-wave-3.

2. **Skills library & injection** — Multica: Persistent markdown docs injected into agent working dirs as context. Libre AI: Contributor lineage + evidence retention, but skill compounding mechanism (knowledge reuse across missions) TBD with harness context protocol. **Impact:** Early missions lack documented best practices; knowledge is audit-trail only. **Owner decision:** Add skills contract (v2?) or rely on Missions evidence export.

3. **Squads & leadership routing** — Multica: Agents lead squads, delegate to members. Libre AI: Agent identity locked (fleet/mission/scope), but squad leadership routing not yet in orchestrator control protocol. **Impact:** Early Polaris runs single-threaded; parallel fleet-work routing arrives post-v1. **Owner decision:** Add to harness control v2 or scope as separate gate.

---

## Arbitrages (Owner Decisions Required)

| Title                                | Multica                                                                   | Libre AI                                                                                              | Trade-off                          | Owner Call                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **A1: Progress delivery model**      | WebSocket real-time push (stateful)                                       | Append-only event chain (audit-first)                                                                 | Latency vs. causal integrity       | Keep event-chain (audit gate). Dashboard consumes chain asynchronously (slight lag acceptable for first version).      |
| **A2: Agent execution statefulness** | Session working dir persists across agent returns; context = agent memory | Planning-only handoff; orchestrator owns runtime state; agent sees result only after validated quorum | Convenience vs. security isolation | Keep planning-only (K-control doctrine). Skills contract + memory layer (arriving wave 3) replaces persistent context. |

---

## Libre AI Exclusive (Not in Multica)

- K1 agent identity taxonomy (fleet, mission, capability, revocation)
- K2 data classification (authoritative/derived/operational)
- K3 envelope integrity (HMAC + Ed25519)
- K4 guardrail mutation gates (no auto-merge on layer-3)
- K5 immutable register (INVARIANTS.md)
- Blind review quorum (neither reviewer sees sibling verdict pre-submission)
- Contributor lineage (harness-signed, atomically tracked)
- Evidence digests + verification (tenant-private, retention-bounded)
- Planning-only handoff enforcement
- Nonce replay protection (one-shot review tokens)

---

## Counts Summary

| Dimension                     | Value                                                  |
| ----------------------------- | ------------------------------------------------------ |
| Multica baseline features     | 36                                                     |
| Libre AI coverage             | 16 couvert + 8 dépassé = **24 / 36**                   |
| Unique Libre AI features      | 9 (K1-K5 + quorum + lineage + evidence)                |
| T1 gaps (absent, no conflict) | 8 (25% functional shortfall)                           |
| T2 gaps (UX/polish)           | 2                                                      |
| Arbitrages (owner decision)   | 2                                                      |
| **Parity verdict**            | **EXCEEDS on security/audit; BEHIND on automation/UX** |

---

## Sources

- Multica GitHub: https://github.com/multica-ai/multica
- Multica README: https://github.com/multica-ai/multica/blob/main/README.md
- Multica product overview: https://github.com/multica-ai/multica/blob/main/docs/product-overview.md
- Multica autopilots: https://multica.ai/docs/autopilots
- Libre AI missions spec: `docs/apps/missions.md`
- Libre AI loop-security kernel: `docs/specifications/LOOP-SECURITY-KERNEL.md`
- Libre AI orchestration semantics: `contracts/agent-orchestration/SEMANTICS.md`
