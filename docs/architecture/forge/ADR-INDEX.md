<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Libre-AI Forge — Design decision inventory

## Design candidates awaiting implementation qualification

Portfolio consolidation is recorded in [the consolidation ADR](../../adr/2026-09-29-portfolio-consolidation.md). The F identifiers below are local design references, not replacements for historical governance ADR numbers. Product direction approval does not qualify runtime guarantees.

F-001 — Forge is a control plane, not a super-agent.
F-002 — Harness owns bounded execution.
F-003 — No generic ANALYZING state.
F-004 — Task is durable, Attempt is disposable.
F-005 — Evidence required for delivery.
F-006 — Human supervision by exception.
F-007 — Human-required only at explicit policy/commitment boundaries.
F-008 — Control Plane UI is status/attention oriented, not chat oriented.
F-009 — WorkingSet is bounded and causally expanded.
F-010 — Rules machine-enforced whenever possible.
F-011 — Practices are overrideable heuristics.
F-012 — Progressive autonomy is evidence/risk based.
F-013 — Credentials mediated through broker where possible.
F-014 — Child authority cannot exceed parent authority.
F-015 — Change, Evidence and Eval are first-class.
F-016 — Delivered != Integrated.
F-017 — Mission is a long-running saga.
F-018 — Recovery and rollback are separate concepts.
F-019 — Differential replanning only.
F-020 — Contracts are transport agnostic; MCP is an adapter.
F-021 — Portfolio graph is derived, never canonical.
F-022 — Human-facing questions must be structured DecisionRequests.
F-023 — Agent chat is debugging data, not primary product state.
F-024 — SystemStatus and AttentionItem are first-class control-plane outputs.
F-025 — No permanent opaque agent memory.
F-026 — RepositoryManifest is the agent-compatible contract of a repository.
F-027 — Contract extraction requires demonstrated reuse.
F-028 — RepositoryManifest precedes heuristic repository discovery.
F-029 — ExecutionProtocol guarantees are exercised with a real executor before freezing their first stable version.
F-030 — KnownUnknown is a first-class control-plane entity.
F-031 — ConvergenceContract is explicit and observable.
F-032 — PolicyDecision and AuthorityEnforcement are separate.
F-033 — Evidence stores references/results, not canonical product data.
F-034 — forge-contracts remains minimal and may disappear if reuse is not proven.
F-035 — forge-control starts from reconstructible read-model projections.
F-036 — UI never owns mission state.
