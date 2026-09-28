<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Libre-AI — Contract Catalog

## Principles

A contract is:
- explicit ;
- versioned ;
- machine-readable ;
- stable enough for independent consumers ;
- transport-agnostic where possible.

A contract is not:
- a shared database schema ;
- an ORM model ;
- an internal struct accidentally exported ;
- an MCP tool definition.

## Priority contracts

### RepositoryManifest
Owner: each repository.

Purpose:
- eliminate repeated rediscovery ;
- expose stable machine-readable boundaries and capabilities.

### TaskContract
Owner: `forge`.

Fields:
- outcome ;
- scope ;
- inputs ;
- acceptance ;
- allowed mutations ;
- forbidden mutations ;
- evidence required ;
- escalation conditions ;
- risk profile ref.

### ExecutionProtocol
Owner: `harness` specification, consumed by Forge.

Operations:
```text
prepare
execute
observe
checkpoint
cancel
resume
finalize
```

Required properties:
- typed ;
- versioned ;
- resumable ;
- cancellation-aware ;
- executor-agnostic ;
- no hidden conversational state ;
- idempotent where possible.

## Other contracts

- GoalContract
- MissionManifest
- ExecutionCapsule
- WorkingSet
- Capability
- Mandate
- PolicyFact
- PolicyDecision
- Artifact
- Change
- ImpactSet
- Evidence
- Eval
- Finding
- Decision
- AttentionItem
- SystemStatus
- Checkpoint
- EnvironmentSpec
- PortfolioManifest

## KnownUnknown

```yaml
known_unknown:
  id:
  question:
  affects:
    - task:...
  blocking: false
  resolution:
    type: targeted_search|experiment|decision|external_input
  status: open|resolving|resolved|invalidated
  evidence_refs: []
```

## ConvergenceContract

The design example and field semantics have one source: [CONVERGENCE.md](CONVERGENCE.md).
A shared executable schema requires explicit admission in schemas-and-contracts; these Markdown examples are not a second schema authority.

## PolicyDecision vs AuthorityEnforcement

PolicyDecision:
- allowed/denied ;
- reasons ;
- required approval ;
- policy version ;
- facts digest.

AuthorityEnforcement:
- validates actor ;
- validates mandate ;
- validates effective capability ;
- checks commitment point ;
- executes/denies capability.

## Read models

`forge-control` consumes:
- MissionStatus
- PortfolioStatus
- AttentionQueue
- TimelineProjection
- CriticalPathProjection
- NextCommitmentProjection

Read models are derived and reconstructible.

## Extraction rule

A type becomes cross-repo contract only when:
1. at least two independent producers/consumers need identical semantics ;
2. independent versioning has value ;
3. coupling is reduced, not increased ;
4. migration story exists.

Otherwise keep local.
