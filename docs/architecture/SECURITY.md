# Security architecture

Normative identity/authz protocol: [`docs/specifications/IDENTITY-AUTHORIZATION.md`](../specifications/IDENTITY-AUTHORIZATION.md). Data/privacy lifecycle: [`docs/specifications/DATA-LIFECYCLE.md`](../specifications/DATA-LIFECYCLE.md).

## Trust zones

1. external/untrusted sources ;
2. validated observations ;
3. reviewed knowledge ;
4. normative decisions and contracts ;
5. runtime secrets, never in Knowledge Objects, fixtures or logs.

## Browser boundary

Provider-neutral OIDC Authorization Code + PKCE through the BFF. Application identity is an opaque 256-bit `__Host-` HttpOnly Secure SameSite=Strict cookie backed by a keyed digest. Cookie mutations require Origin, CSRF synchronizer token, idempotency and expected revision. Browser storage contains neither Biscuit nor provider/session token.

## Authorization

Biscuit Ed25519 authority contains opaque user, mandatory tenant, bounded role and expiry. The verifier derives the signed root block ID for revocation. Delegations attenuate resource, operations, tenant and expiry. Authorizers inject authoritative resource ownership and end with `deny if true`; PostgreSQL RLS repeats tenant isolation.

## Agents

Scoped credentials, network sandbox, bounded work packages, zero-content/PII operational logs and human approval for schema, auth, data, release and deployment. Planning handoffs cannot grant execution capability. Orchestrator tokens cannot approve or judge Missions.

## Data

Local-only content has no server fallback. Server data has one owner, one authority and machine retention. Accepted deletion removes active access/keys immediately and emits a content-free receipt; backups expire within 35 days and cannot restore deleted state.

## Supply chain

Exact versions, trusted dependency allowlist, MIT/Apache/MPL-compatible licensing, advisory/source scans, SBOM, checksums and provenance. No production secret or personal/runtime data is placed in GitHub.
