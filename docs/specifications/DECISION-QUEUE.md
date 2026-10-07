# G1 decision queue

**Status:** closed on 2026-07-16. All five recommendations were explicitly accepted. Normative authority is [ADR-0002](../adr/0002-g1-cross-cutting-product-decisions.md).

## Q1 — Tenant model by application

**Status:** accepted.

Public/no user tenant for Website and public Boussole data; personal scope for Practices, Radar, Notebook and Boussole responses; organization tenant for Sessions, Model Policy, Specifications and Missions. Server-side personal data always has an opaque mandatory tenant ID.

## Q2 — External authentication provider boundary

**Status:** accepted.

Provider-neutral OIDC Authorization Code + PKCE adapter, deterministic local test issuer, provider selection deferred to G4 without changing the session contract.

## Q3 — Retention defaults

**Status:** accepted.

The complete retention table, active-store deletion and 35-day encrypted-backup expiry are normative in ADR-0002 section 3.

## Q4 — Notebook synchronization scope

**Status:** accepted.

Notebook v1 is local-only with encrypted export/import and deterministic conflict reporting. Server sync and multi-device merge require a new decision and threat model.

## Q5 — Boussole legal/methodological release authority

**Status:** accepted.

Public scoring remains fail-closed until independent methodological and French/EU legal/privacy approvals are recorded against exact dataset and method hashes.
