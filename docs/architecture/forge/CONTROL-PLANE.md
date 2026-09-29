<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Libre-AI Forge — Human Control Plane

## Goal

Allow a human to supervise multiple missions without following agent conversations.

## Read-model first

```text
forge events
→ projector
→ MissionStatus
→ PortfolioStatus
→ AttentionQueue
→ TimelineProjection
→ CriticalPathProjection
```

Initial consumers:
1. JSON ;
2. CLI ;
3. TUI ;
4. Web ;
5. Mobile.

No UI owns state.

## Primary views

### Portfolio
- active missions ;
- health ;
- highest risk ;
- human attention required ;
- commitments ;
- machine cost.

### Mission
- goal ;
- DAG ;
- critical path ;
- progress ;
- risk ;
- blockers ;
- decisions ;
- changes ;
- eval status ;
- convergence ;
- timeline.

### Attention
Only:
- decisions ;
- approvals ;
- policy exceptions ;
- destructive commitments ;
- unresolved contradictions.

## Unknowns & convergence visibility

Example:

```text
Convergence: GREEN
Unknowns: 5 → 2
Blocking findings: 3 → 0
Scope growth: +4%
Repeated findings: 0
```

## Fatigue prevention

Do not surface:
- normal worker chatter ;
- successful routine actions ;
- transient retry already handled ;
- non-blocking findings individually by default.

Surface:
- attention items ;
- risk changes ;
- convergence failures ;
- commitment points ;
- mission completion ;
- explicit drill-down requests.

## `why`

Every important object should answer:
- why is this task running?
- why was this capability allowed?
- why is approval required?
- why was this model/harness selected?
- why was a task invalidated?
- why did mission replan?

## `what-if`

Simulate:
- cancel task ;
- reject API change ;
- lose repository ;
- switch provider ;
- defer finding ;
- deny deployment.

## Product and release status

Expose candidate verification, integration, distribution and verified user availability separately. A green task is not a green product. Show missing evidence, expired observations, unsupported platforms and incomplete reconciliation explicitly.

A what-if view is a projection with assumptions and coverage, not a guarantee about unobserved external effects. Normal conversation remains available for framing and diagnosis; durable operational state is reconstructed from authoritative records.
