<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Libre-AI — ExecutionProtocol v1 design candidate

## Goal

Define a versioned boundary between Forge and Harness/executor implementations. Exercise guarantees with a real adapter before freezing v1.

## Lifecycle

```text
prepare
execute
observe*
checkpoint*
cancel?
resume?
finalize
```

## Commands

### prepare
Input:
- ExecutionCapsule.

Output:
- AttemptRef ;
- environment status ;
- initial checkpoint.

### execute
Starts or continues execution.

### observe
Returns typed events since cursor.

### checkpoint
Produces resumable operational state.

### cancel
Requests bounded cancellation.

### resume
Starts from a checkpoint on an explicitly compatible executor after authority and external effects are reconciled. Task/artifact portability does not imply portability of model-internal or process-internal state.

### finalize
Returns:
- candidate outputs ;
- evidence refs ;
- blocker/invalidated/delivered status candidate.

Forge still owns authoritative Task transition.

## Event families

- attempt.started ;
- action.performed ;
- context.expanded ;
- artifact.created ;
- change.created ;
- evidence.recorded ;
- eval.recorded ;
- finding.recorded ;
- blocker.proposed ;
- checkpoint.created ;
- candidate.created ;
- attempt.failed ;
- attempt.finished.

## Required properties

- versioned ;
- typed ;
- replay-safe ;
- resumable ;
- cancellation-aware ;
- executor-neutral ;
- no chain-of-thought requirement ;
- secrets absent from persisted payloads.

## Error classes

- protocol_error ;
- executor_unavailable ;
- environment_error ;
- capability_denied ;
- cancelled ;
- recoverable_failure ;
- unrecoverable_attempt_failure.

Attempt failure does not imply Task failure.

## Required negotiation and effect semantics

Prepare returns protocol version, supported operations, checkpoint compatibility, environment identity and cancellation limits. Each attempt and command has a stable identity. Event envelopes identify producer, attempt, schema version and cursor; duplicate delivery must be handled explicitly by consumers.

Idempotency is defined per effect and retention window, not asserted for arbitrary shell or external API actions. On an uncertain outcome, observe the destination before retrying. If the outcome cannot be established, preserve the uncertainty and block the affected transition.

Finalization returns a candidate. Forge verifies applicable acceptance evidence independently before changing task state. Cancellation, cleanup and compensation are distinct observed results; cancellation is not a claim that prior effects were reversed.
