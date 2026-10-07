# DESIGN: Missions vs Multica — Parity Gap Analysis and Wave-3 Scoping

- **Status:** design-only scoping document (not committed, not authorization)
- **Date:** 2026-07-23
- **Scope:** benchmark Missions (couche-2 human surface for agent orchestration) against Multica (open-source managed agents platform); identify parity gaps; propose prioritized wave-3 increments
- **Ownership:** Experiences (Missions domain) + Web Platform (human surface) + Orchestration (gate integration)

---

## Part 1: Multica Capability Baseline

**Multica** ([github.com/multica-ai/multica](https://github.com/multica-ai/multica)) is an open-source managed agents platform that treats AI agents as functional team members. The system enables humans and agents to work together with shared task visibility, real-time progress tracking, and persistent team memory.

### Core Capabilities

| Capability             | Implementation                                                                                             | Evidence                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Agent Assignment**   | Assign tasks directly to individual agents or squads; agents pick up, execute, report status               | Agent profiles visible on board; human assignee workflow                         |
| **Task Lifecycle**     | Full state machine: enqueue → claim → start → complete/fail; immutable history                             | Real-time progress via WebSocket; audit trail per task                           |
| **Squads**             | Group-based routing; stable squad membership; leader-decided assignment eligibility                        | SQLite model; team-level isolation supported                                     |
| **Real-Time Progress** | WebSocket-driven event stream; agent status, tool invocations, budget checks visible live                  | Frontend: Next.js App Router subscribing to task events                          |
| **Autopilots**         | Recurring mission templates; triggered by cron, webhooks, or manual runs                                   | PostgreSQL 17 storage; sqlc-generated type-safe queries                          |
| **Reusable Skills**    | Capture solution patterns from completed tasks; apply to future similar work                               | Compounded knowledge base; organizational learning retained                      |
| **Agent Profiles**     | Name, runtime selection, capability indicators, availability status                                        | Browser-visible; filtering by skill/squad supported                              |
| **Unified Runtimes**   | Single dashboard managing local daemons and cloud compute; auto-detection of available CLIs (14 supported) | Daemon agent communicates with 12 supported runtimes (Claude Code, Gemini, etc.) |
| **Multi-Workspace**    | Workspace-level isolation; different teams operate independently                                           | PostgreSQL schema isolation                                                      |
| **Activity Feed**      | Humans and agents visible as peers; agent-authored comments, issue creation, status changes                | Public-facing journal; social timeline metaphor                                  |
| **Integrations**       | Slack `/issue` command for workflow bridging                                                               | Webhook layer for external event ingestion                                       |

**Sources:**

- [Multica GitHub Repository](https://github.com/multica-ai/multica)
- [Multica Review — Stork.AI](https://www.stork.ai/en/multica)
- [The Open-Source Managed Agents Platform — The Menon Lab](https://themenonlab.blog/blog/multica-open-source-managed-agents-platform)

---

## Part 2: Missions Current State (v1 locked, v2 unimplemented)

### Implemented (v1)

Missions v1 locks human approvers as the authorization gate:

- **Proposal/Review**: Requester proposes mission from accepted planning handoff; risk assessment required before approval
- **Authorization**: Two-agent quorum (v2 contract locked; v1 uses single human approver) validates plan digest, emits expiring authorization token
- **Execution Observation**: Orchestrator reports causal events; operator may pause/cancel within policy
- **Result Validation**: Executor submits evidence/artifacts; two eligible agents (v2) or human reviewers (v1) independently review same digest
- **Audit Export**: Immutable records, quorum proof, evidence references exported; secrets never included

**Domain Model (v1):**

- Commands: ProposeMission, AssessMissionRisk, ApproveMission, RefuseMission, StartMission, PauseMission, ResumeMission, CancelMission, RecordOrchestratorEvent, AnswerDecisionRequest, SubmitMissionResult, AcceptMissionResult, RejectMissionResult, AbandonMission, ExportMissionRecord
- Queries: GetMission, ListMissions, GetMissionEvents, GetOpenDecisionRequests, GetResultEvidence, GetApprovalHistory, GetMissionExport
- Events: MissionProposed, MissionRiskAssessed, MissionApproved, MissionRefused, MissionStarted, MissionBlocked, HumanDecisionRequested, MissionPaused, MissionCancelled, MissionResultSubmitted, MissionResultAccepted, MissionResultRejected, MissionAbandoned

**Locked (unimplemented v2):**

- Agent reviewers replace human approvers; two reviewers must be distinct from contributors and each other
- Attenuated review tokens: one-shot, bound to subject digest, cannot see sibling verdicts before submission
- Result digest changes trigger rejection + fresh review requirement
- Same command/query structure but with SubmitExecutionPlan + SubmitAgentReview commands added

### Current Gaps vs Multica

1. **No Agent Board** (read-only fleet visibility): Missions owns mission state; agent-board is the operator UX (separate app, frozen until wave-3). The two are coupled at the event boundary but Missions does not provide the dashboard.
2. **No Squad/Group Assignment** (v1/v2): Missions assigns to individuals (agents or human approvers); no squad-level routing or eligibility rules.
3. **No Autopilots** (recurring templates): Missions accepts one-off missions; recurring patterns must be created repeatedly.
4. **No Reusable Skills Capture**: Missions validates results but does not extract patterns into organizational knowledge.
5. **No Real-Time Activity Feed**: Missions is state-centric (mission record, events); no agent-authored comments, issue creation, or social timeline.
6. **Limited Runtime Visibility**: Missions does not surface agent profiles, capabilities, or availability (that is Orchestrator/Harness authority).
7. **No Multi-Workspace Isolation** (yet): Missions uses organization-level tenant model; per-workspace isolation not yet implemented.
8. **No Async Event Integration** (beyond Orchestrator): Missions accepts events only from Orchestrator; external webhook/Slack integration out of scope for v1.

---

## Part 3: Couche-2 Boundary — Missions vs Orchestration

**Missions owns:** Human surface for mission activation (proposal → approval → result validation). It is the human control gate and evidence preservation layer.

**Orchestrator owns:** Process/tool scheduling, execution, budget enforcement, causal event generation. It is the engine.

**Agent Board owns:** Read-only projection of missions + execution events for operators. It is the operational dashboard (coupled to Missions via event stream, frozen until wave-3).

**Harness owns:** Agent identity, capability/credential provisioning, runtime management. It is the identity authority.

**Key principle:** Missions never orchestrates; it gates, validates, and preserves evidence. The orchestrator never approves; it executes and reports. Blurred boundary = security risk (quorum fabrication, evidence tampering).

---

## Part 4: Parity Gap Analysis

### Tier 1: Mission-core parity

| Gap                                         | Multica Baseline                    | Missions Current                                             | Wave-3 Delta                                                                       | Rationale                                                                                |
| ------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Result Validation Two-Agent Quorum**      | Single approval per task            | v2 contract locked but unimplemented                         | Implement v2 agent review (attenuation, nonce, expiry, isolation)                  | Core to Missions v2 contract; security-critical (K4 independence)                        |
| **Decision Request Routing**                | N/A (no human approval gates)       | Commands exist; AnswerDecisionRequest defined                | Implement blocking decision gates + operator answer flow (Agent Board integration) | Missions v1/v2 both require decision blocking; coupling to Agent Board (separate app)    |
| **Orchestrator Event Adapter**              | N/A (integrates tool CLIs directly) | Schema defined; event consumer contracts ready               | Implement real Orchestrator integration (not fixtures)                             | Missions accepts RecordOrchestratorEvent; need real, bounded orchestrator to emit events |
| **Plan Digest Immutability + Verification** | N/A (no plan review)                | Schema locked (v2); deterministic plan serialization defined | Implement plan hash verification for v2 quorum gate                                | v2 contract requires plan digest unchanged across review cycle                           |
| **Risk Assessment Workflow**                | N/A (no risk policy)                | Command exists; v1 uses human verdict                        | Wire risk assessment to approval gate (can block start)                            | v1/v2 both gate on risk verdict; need policy-driven assessment                           |

### Tier 2: Operator Efficiency (Agent Board + Missions integration)

| Gap                                | Multica Baseline                                              | Missions Current                             | Wave-3 Delta                                                                    | Rationale                                                                                      |
| ---------------------------------- | ------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Squad-Based Assignment**         | Full squad model; team routing                                | None; individual agent assignment only       | Add squad concept to mission authorization (if harness provides squad registry) | Multica uses squad routing as core mechanic; Missions v1/v2 allow agents but no grouping       |
| **Mission Board Kanban**           | Kanban with status columns (claimed, executing, done, failed) | Event schema exists; no UI yet               | Build Agent Board kanban (separate app); Missions emits events only             | Agent Board is the kanban UX; Missions is the authorization layer                              |
| **Autopilot Rules**                | Cron + webhook triggers; eligibility evaluation               | None                                         | Design autopilot eligibility rules (squad/agent/risk policy)                    | Multica has recurring templates; useful for repeated mission patterns (e.g., daily monitoring) |
| **Audit Trail Export with Quorum** | Task activity log; limited evidence                           | v1/v2 commands exist; need Proof integration | Implement GetMissionExport + evidence resolution from Proof/Artifact            | v1/v2 contracts define export; Proof/Artifact integration (couche-3) is gating item            |

### Tier 3: Organizational Learning + Collaboration

| Gap                                         | Multica Baseline                                     | Missions Current                             | Wave-3 Delta                                                                           | Rationale                                                                          |
| ------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Reusable Skills**                         | Capture patterns from completed tasks                | None                                         | Design post-mission skill extraction (out of scope for wave-3 MVP)                     | Low priority; Missions focused on validation, not learning loop                    |
| **Agent Activity Feed**                     | Agents post comments, create issues, change status   | Missions events only (no social layer)       | Out of scope for wave-3 (Session/Polaris collaboration separate)                       | Missions is not a collaboration tool; Sessions owns collective learning (couche-1) |
| **Agent Profiles + Availability**           | Public profiles, skill tags, status (busy/available) | Harness authority; Missions does not display | Depend on Harness integration for agent data; Missions only routes authorized missions | Harness owns agent identity; Agent Board reads from Harness + Missions             |
| **External Integrations (Slack, webhooks)** | Native Slack `/issue` command, webhook ingestion     | None                                         | Out of scope for wave-3 (Polaris integration first)                                    | Integrations follow proven orchestration; can be added later                       |

---

## Part 5: Wave-3 Increments (Prioritized)

Wave-3 is the gate for couche-2 (Polaris) unlock. Missions must be implementable within wave-3 constraints (Specification Lock orchestrator, v2 contract, security noyau K1-K5).

### Increment 1: Implement v2 Agent Review Quorum (CRITICAL)

**Goal:** Move from v1 human approvers to v2 two-agent reviewers (locked contract).

**Scope:**

- Implement SubmitAgentReview command: agent-signed review (Biscuit token, digest, verdict)
- Validate reviewer eligibility: not contributor, not duplicate, not orchestrator
- Compute quorum: two favorable reviews on exact digest = mission result validated
- Nonce/expiry enforcement: one-shot token, unexpired at submission time
- Reject stale digests: if result/evidence changes after first review, require fresh cycle

**Contracts touched:**

- schemas/mission-record.v2.schema.json (already locked)
- schemas/execution-plan-body.v1.schema.json (already locked)
- contracts/openapi/missions.v2.yaml (already locked)
- contracts/authz/missions-v1.datalog (update for v2 reviewer attenuation)

**Dependencies:**

- Harness provides agent identity + attestation (separate work package)
- Orchestrator provides trusted event binding (separate work package)
- Biscuit library supports one-shot token attenuation (library available)

**Evidence required:**

- Unit tests: reviewer isolation, nonce/expiry, digest immutability
- Contract tests: quorum rejection on self-review, stale digest, invalid signature
- Security qualification: no individual identity can fabricate quorum (attestation audit)

**Release gate:** Live mission with two-agent plan + result quorum; both reviews signed and verified.

**Decomposition:** domain implementation, API, authz, qualification.

---

### Increment 2: Orchestrator Event Binding + Decision Request Integration

**Goal:** Wire Missions to real Orchestrator events (not fixtures); implement decision request blocking.

**Scope:**

- RecordOrchestratorEvent: accept orchestrator-signed events (Biscuit token bound to execution instance)
- Validate event source: trusted orchestrator instance only (no self-authored execution events)
- Decision request blocking: mission pauses on HumanDecisionRequest; AnswerDecisionRequest resumes
- Event ordering: ensure causal consistency (orchestrator events append-only, never reordered)
- Budget enforcement: mission stops if budget exceeded (orchestrator reports BudgetCheck event)

**Contracts touched:**

- schemas/orchestrator-event.v1.schema.json (already locked; v2 for agent-orchestration context)
- schemas/orchestrator-event.v2.schema.json (locked, unimplemented)
- contracts/protocols/orchestration-control.v1.schema.json (locked handoff)

**Dependencies:**

- Orchestrator work package (separate, wave-3 entry): specify event protocol, Biscuit binding, instance token
- Missions adapter (specialized Rust): translate orchestrator events to Missions domain events

**Evidence required:**

- Integration tests: simulated orchestrator emits events; Missions projects them correctly
- Event ordering under network restart: WebSocket reconnect does not break causality
- Budget block: mission state correctly transitions to blocked when budget exceeded

**Release gate:** Live mission with orchestrator progress events; decision request blocks and resumes correctly.

**Decomposition:** event consumer, decision routing, adapter integration.

---

### Increment 3: Agent Board Event Projection (Separate App)

**Goal:** Build the operator UX (Agent Board) as a read-only projection of Missions events.

**Scope:**

- Consume Missions event stream via Biscuit-attenuated token (audience: agent-board only)
- Materialize mission board: kanban columns (proposed → authorized → executing → done/failed)
- Operator queries: GetMissionBoard, GetMissionProgressStream, GetRunAuditTrail
- WebSocket live updates: mission status, decision requests, blockers
- Audit trail export: fetch evidence from Proof/Artifact, verify review quorum

**Contracts touched:**

- contracts/openapi/agent-board.v1.yaml (to be authored)
- contracts/protocols/agent-board-events.v1.schema.json (to be authored)
- contracts/authz/agent-board-v1.datalog (to be authored; integrated with Missions authz)

**Dependencies:**

- Missions v2 quorum implementation (Increment 1)
- Orchestrator event binding (Increment 2)
- Proof/Artifact (couche-3): evidence resolution for export

**Evidence required:**

- E2E tests: operator views mission board, follows progress, answers decision request
- WebSocket stability: reconnect under network loss; event ordering verified
- Audit trail: export includes review quorum proof, evidence refs, no secrets

**Release gate:** Live mission observed on Agent Board; full audit trail exported with quorum.

**Decomposition:** event consumer, board UI, export integration.

---

### Increment 4: Risk Assessment Policy + Autopilot Eligibility (conditional)

**Goal:** Define repeatable mission patterns and risk-driven approval gates.

**Scope:**

- Risk assessment webhook or policy engine: compute risk verdict (approved/denied/escalate)
- Autopilot templates: recurring mission handoffs + eligibility rules (agent capability, squad, budget)
- Preview autopilot impact: show projected missions under template rules (no commit)
- Decision escalation: if risk escalates, trigger decision request before start

**Contracts touched:**

- contracts/schemas/risk-policy.v1.schema.json (to be authored)
- contracts/schemas/autopilot-template.v1.schema.json (to be authored)

**Dependencies:**

- Risk assessment authority (Missions or external service) — needs owner decision
- Autopilot trigger (cron, manual, or Orchestrator readiness signal) — needs design

**Evidence required:**

- Unit tests: risk verdict gates approval; autopilot rules reject ineligible agents
- Contract tests: template changes do not affect in-flight missions
- E2E: recurring template creates multiple missions; one rejection does not block others

**Release gate:** Recurring mission template created; two missions auto-created and routed correctly.

**Decomposition:** policy engine, eligibility evaluation, UI.

**Wave-3 inclusion:** Optional. If orchestrator risk service exists at wave-3 entry, integrate. Otherwise defer to wave-4 pending orchestrator maturity.

---

### Increment 5: Multi-Workspace Isolation (Future, not wave-3)

**Goal:** Enable different teams to operate isolated mission fleets under one Missions instance.

**Scope:**

- Workspace-level RLS: operators see only their workspace's agents and missions
- Separate approval gates per workspace (if needed)
- Cross-workspace audit for compliance (if needed)

**Contracts:** New schemas for workspace registry, isolation rules.

**Dependencies:** Tenant model already supports organization; workspace = subdivision of organization.

**Release gate:** Two workspaces assigned to same organization; each operator sees only their workspace missions.

**Decomposition:** RLS, isolation rules.

**Wave-3 inclusion:** NOT included. Post-wave-3 (wave-4 or later). Rationale: Missions v1/v2 are organization-scoped; workspace is a nice-to-have when multi-team demand arises.

---

## Part 6: Owner Decision Points

### Decision D1: Two-Agent Quorum Enforcement Timeline

**Question:** Should wave-3 implement both v1 (human approvers) and v2 (two-agent reviewers) in parallel, or fully migrate to v2?

**Options:**

- **Option A (Recommended):** Wave-3 implements v2 only (locked contract, security-critical). Maintain v1 API layer for backward compatibility with existing missions, but new missions use v2 quorum.
  - _Pro:_ Simpler domain logic; aligns with v2 security noyau (K4 independence).
  - _Con:_ Existing v1 missions cannot transition to v2; requires migration story.

- **Option B:** Implement both in parallel; operator chooses quorum mode at mission proposal time.
  - _Pro:_ No migration needed; organizations can choose.
  - _Con:_ Doubles test coverage; domain complexity; two approval paths = security risk if one is weaker.

- **Option C:** Keep v1 through wave-3; defer v2 to wave-4.
  - _Pro:_ Less scope for wave-3; time to harden v2 design.
  - _Con:_ Delays security-critical quorum (v2 contract was locked early for this reason).

**Recommendation:** Option A. v2 is the locked contract; v1 is transitional. Wave-3 should prove v2 works, not maintain two parallel systems.

---

### Decision D2: Autopilot Scope for Wave-3

**Question:** Are autopilots (recurring mission templates) in scope for wave-3, or defer to wave-4?

**Options:**

- **Option A:** Include Increment 4 (risk policy + autopilot eligibility) in wave-3 MVP.
  - _Pro:_ Repeatable workflows valuable to operators; Multica parity stronger.
  - _Con:_ Adds scope; risk assessment authority not yet designed.

- **Option B:** Defer to wave-4; focus wave-3 on core Missions quorum + event integration.
  - _Pro:_ Simpler wave-3 scope; allows risk authority design in between.
  - _Con:_ Missions less feature-complete at launch; operators must propose each mission manually.

**Recommendation:** Option B. Defer autopilots to wave-4. Wave-3 should prove core mission lifecycle (propose → authorize → execute → validate) with two-agent quorum. Autopilots are an efficiency multiplier, not a gate-blocking feature. Defer to wave-4 when orchestrator risk service is available.

---

### Decision D3: Squad-Based Routing

**Question:** Should Missions support squad-based assignment (like Multica), or keep individual agent assignment only?

**Options:**

- **Option A:** Add squad concept to Missions v2 authorization (harness provides squad registry).
  - _Pro:_ Matches Multica pattern; stable team routing.
  - _Con:_ Requires Harness to define squad model; couples Missions to Harness team registry.

- **Option B:** Keep individual agent assignment in v2; defer squad routing to Agent Board layer (UI filter/UI suggestion, not domain model).
  - _Pro:_ Simpler Missions domain; Agent Board handles squad display.
  - _Con:_ Less flexible for operator: must know eligible agents, cannot auto-filter by squad.

**Recommendation:** Option B. Missions v2 remains agent-focused (attenuated token is per-agent). Squad is an Agent Board concern (display, filtering, pre-selection suggestion). If squad routing becomes critical post-wave-3, move it to domain in wave-4 via ADR.

---

### Decision D4: Proof/Artifact Integration Timing

**Question:** Is Proof/Artifact (couche-3) complete and integrated by wave-3 entry, or is Missions audit export a wave-4 dependency?

**Options:**

- **Option A:** Proof/Artifact is ready at wave-3 entry; Missions audit export implements full evidence verification.
  - _Pro:_ Complete audit story in wave-3; verifiable release gate.
  - _Con:_ Blocks Missions on Proof maturity (couche-3 work package dependency).

- **Option B:** Proof/Artifact is ready for wave-4; wave-3 Missions exports evidence references (URIs) without verification.
  - _Pro:_ Missions and Proof can progress independently.
  - _Con:_ Audit export is incomplete (references only, no verification); export gate weaker.

**Recommendation:** Depends on Proof/Artifact work package status at wave-3 entry (owner decision). If Proof is complete by wave-3 start, use Option A (full verification). If not, use Option B (reference export) and complete verification in wave-4. This is a blockers/dependencies question, not a scope question.

---

## Part 7: Wave-3 Scope Summary

### In Scope

1. **Increment 1** (v2 two-agent quorum) — critical
2. **Increment 2** (orchestrator event binding + decision requests) — critical
3. **Increment 3** (Agent Board event projection) — critical for operator UX
4. **Increment 4** (risk policy + autopilot eligibility) — optional if risk authority exists; else defer

### Out of Scope (Wave-4 or later)

- Multi-workspace isolation (Option D1 defers)
- External integrations (Slack, webhooks)
- Reusable skills capture
- Squad-based routing in domain (keep at Agent Board level)
- Full collaboration features (activity feed, agent comments) — those belong to Sessions (couche-1)

---

## Part 8: Appendix — Missions vs Multica Feature Comparison

| Feature             | Multica                        | Missions (v1)              | Missions (v2 locked)              | Wave-3 Delta                | Notes        |
| ------------------- | ------------------------------ | -------------------------- | --------------------------------- | --------------------------- | ------------ |
| Task proposal       | Create issue                   | ProposeMission             | ProposeMission                    | same                        |              |
| Assignment          | Assign to agent/squad          | Implicit in handoff        | SubmitExecutionPlan               | Add squad support?          | Optional     |
| Approval gate       | Single human                   | ApproveMission             | SubmitAgentReview (two agents)    | Implement v2                | Critical     |
| Decision blocking   | N/A                            | AnswerDecisionRequest (v1) | AnswerDecisionRequest (v2)        | Implement logic             | Critical     |
| Progress streaming  | WebSocket task events          | RecordOrchestratorEvent    | RecordOrchestratorEvent           | Real integration            | Critical     |
| Audit export        | Activity log                   | ExportMissionRecord (v1)   | ExportMissionRecord (v2) + quorum | Implement full export       | Critical     |
| Recurring templates | Autopilot templates            | None                       | None                              | Add if risk authority ready | Optional     |
| Skill capture       | Reusable skills                | None                       | None                              | Defer to wave-4             | Nice-to-have |
| Collaboration feed  | Agent comments, issue creation | Events only                | Events only                       | Defer to Sessions           | Out of scope |
| Multi-workspace     | Workspace-level RLS            | Organization-level         | Organization-level                | Defer to wave-4             | Nice-to-have |

**Parity assessment:** Missions v2 + wave-3 increments achieve **core task management parity** with Multica (proposal, assignment, approval, progress, audit). Missions intentionally narrower on **collaboration** (no agent comments, issue creation — those belong to Sessions) and **automation scope** (no external webhooks, risk policy pending). The scope difference reflects the boundary: Missions is a human-driven control surface + evidence layer, not a general-purpose task management tool.

---

## Part 9: Design Status

**Status:** Design/scoping document (not committed, not authorization for work packages).

**Next step:** Owner review and decision on D1-D4 above. Once owner decisions are recorded, each increment can be authored as a separate work-package specification with detailed contracts, APIs, and evidence requirements.

**Out-of-scope for this document:**

- Implementation timelines (governed by ADR-0011 wave execution)
- Resource allocation (owner/process decision)
- Exact API signatures (derived from locked contracts in increment specs)
- UI/UX details (separate product design process)
