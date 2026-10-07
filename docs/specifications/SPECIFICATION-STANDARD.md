# Specification Lock standard

Every application and shared capability specification must contain the sections below before G1 can close. A missing answer is recorded in `DECISION-QUEUE.md`; `TBD`, implicit defaults and implementation-agent discretion are forbidden for cross-module behavior.

## Normative language

- **MUST / MUST NOT**: release-blocking invariant.
- **SHOULD / SHOULD NOT**: default that requires written evidence to override.
- **MAY**: local implementation choice that cannot alter a contract or ownership boundary.
- Every refusal has a stable machine code and safe public message.
- Every state mutation has an attributable command, resulting event and optimistic revision.

## Required application sections

1. **Purpose and actors** — one owned public outcome and named actors.
2. **Journeys** — entry state, commands, observable result and exit/export.
3. **Non-goals** — behaviors explicitly refused or delegated.
4. **Domain protocol** — commands, queries, events and state machine.
5. **Refusal matrix** — invalid, unauthorized, stale, unavailable and policy-denied cases.
6. **Data** — owner, records, authority, tenant key, retention, deletion and migration source.
7. **Authentication and authorization** — public/session routes, Biscuit facts, resource/operation policies and RLS mapping.
8. **Runtime boundaries** — Bun/React ownership, Rust/WASM/service boundary and forbidden coupling.
9. **Accessibility and degraded mode** — keyboard, assistive technology, reduced motion, offline/unavailable dependencies and recovery.
10. **Contracts** — canonical JSON Schema/OpenAPI/WIT paths, compatibility and negative fixtures.
11. **Evidence** — unit, integration, contract, browser, security and smoke gates.
12. **Work packages** — owner workstream, dependency order and parallel-safe path ownership.
13. **Release and rollback** — promotion evidence, migration reversibility and fail-closed behavior.

## Common envelope

HTTP JSON responses use one of:

```json
{"data": {}, "meta": {"requestId": "req_...", "revision": 1}}
```

```json
{
  "error": {
    "code": "stable.machine_code",
    "message": "Safe public message",
    "requestId": "req_...",
    "retryable": false
  }
}
```

Validation details MAY identify field paths and rule IDs but MUST NOT echo secrets, tokens, private content or hostile source bodies.

## Mutation protocol

- Commands include `commandId`, actor context and expected aggregate revision when an aggregate already exists.
- Duplicate `commandId` with identical input returns the recorded result.
- Duplicate `commandId` with different input is refused as `command.idempotency_conflict`.
- Revision mismatch is refused as `command.stale_revision`; silent last-write-wins is forbidden.
- Events include event ID, aggregate ID, new revision, occurred-at timestamp, actor kind/ID and contract version.
- Server time is authoritative for audit and expiration; client time is presentation-only.

## Browser and internal authorization

- Browser authentication uses only an opaque HttpOnly `Secure` cookie with strict SameSite policy and server-side expiry/revocation.
- State-changing browser requests require CSRF and Origin/Referer validation.
- Browser storage MUST NOT contain Biscuit tokens or external OIDC tokens.
- Internal calls use short-lived attenuated Biscuit tokens in `Authorization: Bearer`.
- Authority facts include `user`, mandatory `tenant`, `role(user, role)` and an expiration check; no email or personal content. The verifier derives the signed root authority block ID used for revocation and never trusts a token-supplied identifier.
- Authorizers inject `resource`, `operation`, current time and authoritative `resource_tenant`/ownership facts; policy equality binds them to the token tenant.
- Policies end with `deny if true`. A missing tenant, unknown operation, revoked root block, expired token or policy timeout is a refusal.
- PostgreSQL RLS repeats the tenant boundary for every tenant-owned table.

## Contract compatibility

- G1 contracts start at major version 1 and are strict by default (`additionalProperties: false`).
- Producers write one current version. Consumers MAY read explicitly listed older versions only through a bounded adapter with deletion criteria.
- Breaking changes require a new major contract path, migration plan and simultaneous consumer qualification before release.
- Generated types never become authority; schemas/WIT/OpenAPI remain authority.
- Every schema has a canonical positive fixture, malformed-root rejection, unknown-field rejection and at least one domain-specific negative fixture. Boundary suites add complete and cross-tenant vectors wherever tenant ownership applies.

## Data and privacy baseline

- Data minimization and local-first storage precede server persistence.
- Product tables never cross application ownership.
- Logs contain identifiers, rule IDs, timings and outcomes—not content, credentials, tokens, political positions, notes or participant messages.
- Deletion is an attributable command. Tombstones contain only the minimum needed for idempotency and audit.
- Backups inherit retention and deletion requirements; a deletion run is incomplete until backup expiry is bounded and documented.

## Release baseline

A release is refused unless contracts, migrations, security gates, accessibility journeys, browser smoke, backup/restore and rollback evidence are attached to one immutable candidate. Rollback MUST NOT restore data deleted by an accepted deletion command or downgrade across an irreversible migration.
