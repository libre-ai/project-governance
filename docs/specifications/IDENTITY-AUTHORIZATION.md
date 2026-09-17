# Identity, browser session and Biscuit lock

- **Status:** accepted G1 baseline
- **Decision authority:** ADR-0002 section 2 and D09
- **HTTP authority:** `contracts/openapi/auth.v1.yaml`
- **Session authority:** `contracts/schemas/browser-session.v1.schema.json`
- **Biscuit authority template:** `contracts/authz/authority-v1.datalog`

## Domain protocol

**Commands:** `StartOidcLogin`, `CompleteOidcCallback`, `CreateBrowserSession`, `RevokeBrowserSession`, `IssueBiscuit`, `AttenuateBiscuit`, `RevokeBiscuit`, `RotateSigningKey`.

**Queries:** `GetBrowserSession`, `GetBiscuitPublicKeys`, `GetRevocationStatus`.

Browser authentication and internal authorization are separate protocols. A browser never receives, stores or attenuates a Biscuit. An internal service never accepts the browser cookie as service authorization.

## OIDC boundary

The BFF is a confidential, provider-neutral OIDC client using Authorization Code with PKCE (`S256`). Login creates a random state, nonce and verifier, stores only bounded server-side state and sends the challenge to an issuer allowlisted by exact HTTPS origin. Callback validates state once, nonce, issuer, audience, signature, code verifier, `exp` and `iat` before subject mapping.

Identity key is `(issuer, subject)`, mapped server-side to an opaque `usr_*` ID. Email, display name and group claims are never stable identity or authorization facts. Unsupported issuer, algorithm, audience, stale callback, replay or mapping ambiguity fails closed. The deterministic development issuer runs in process and contains no production identities. Sovereign production-provider selection/provisioning remains G4 and cannot alter this contract.

## Cookie and CSRF protocol

- OIDC transaction cookie: `__Host-libre_ai_oidc`, Secure, HttpOnly, SameSite=Lax, Path=/, maximum 10 minutes, one use.
- Application cookie: `__Host-libre_ai_session`, Secure, HttpOnly, SameSite=Strict, Path=/, no Domain, opaque random value with at least 256 bits.
- Server stores only a keyed digest of the application cookie, never the raw value.
- Session idle timeout is 30 minutes; absolute lifetime is at most 12 hours. Authentication and privilege change rotate the cookie and CSRF secret.
- Cookie-authenticated mutations require exact allowed Origin, same-site Fetch Metadata where available, a synchronizer CSRF token in `X-CSRF-Token`, idempotency key and expected revision.
- CSRF token is delivered in the rendered document and kept in memory; it is not stored in localStorage, sessionStorage, URL, log or analytics.
- Logout/revocation invalidates the server record before clearing the cookie. Missing session is a generic 401 without identity disclosure.

## Browser session state machine

`active → revoked | expired`. Expired/revoked records reject immediately and remain only until expiry + 24 hours for replay/refusal evidence. Every request checks absolute/idle expiry and tenant membership; sensitive commands also check current membership revision. The session record contains opaque user/tenant/role facts and OIDC subject digest, not provider tokens or personal claims.

## Biscuit authority

Only the authorization issuer owns the Ed25519 private key. An authority block contains:

```datalog
user("usr_opaque");
tenant("ten_opaque");
role("usr_opaque", "bounded-role");
check if time($time), $time < 2026-07-16T12:00:00Z;
```

The verifier derives the root authority block ID from the verified token and uses it for revocation; no token-supplied token ID is trusted. Browser-mapped issuance requires an active session and produces a server-to-server token only. Default internal TTL is 5 minutes; release operations may use at most 15 minutes with exact artifact/dataset hash.

No token contains email, name, content, source text, political response, note, secret or provider credential. Transport is `Authorization: Bearer`, never cookie, URL or browser storage. Extractors and instrumentation explicitly skip token bytes.

## Attenuation

Each delegation adds checks for exact resource, allowed operation set, tenant and expiry no later than its parent. Worker tokens additionally bind job/mission/source ID and budget where applicable. Attenuation never adds a role or permission. A service passes canonical bytes/digests only after its own authorization; Rust/WASM pure engines receive no Biscuit.

Examples:

```datalog
check if resource("mission/mission-1");
check if operation($operation), ["report-event", "submit-result"].contains($operation);
check if tenant("ten_1234567890abcdef");
```

## Authorizer context and policy

Handlers inject verified current `time`, `resource`, `operation`, request tenant and authoritative `resource_tenant`/ownership/audience facts. Every allow rule matches `user`, `role(user, role)`, token tenant and resource tenant. The final policy is `deny if true`. Unknown operation/resource, absent/divergent tenant, timeout or policy evaluation error is denied.

PostgreSQL RLS repeats the tenant boundary after authorization. The database transaction receives tenant/user context, never a token. A cache or RLS failure cannot turn denial into allowance.

## Revocation and rotation

Revocation stores the verified root block ID, reason code, revocation time and token expiry. Checks occur before policy evaluation. A 30-second maximum cache is invalidated on local revocation; revocation-store unavailability fails closed. Entries expire only after maximum token TTL.

Ed25519 signing keys rotate at least every 90 days: publish new public key, deploy two-key verification, switch the sole issuer private key, wait beyond maximum TTL, then remove the old public key. Public keys expose key ID, algorithm, validity and status. Private keys remain in G4 secret storage and are never shared with applications, GitHub, logs or Knowledge Objects. Emergency compromise revokes the key ID and all derived tokens before replacement.

## Refusal codes

This table enumerates authentication and authorization refusals. The optimistic-concurrency control required by the revision precondition of cookie-authenticated mutations is a distinct category: a stale revision returns `412` with `auth.session_revision_mismatch`, not a refusal from this table (monorepo ADR-0010).

| Code                      | Meaning                                             |
| ------------------------- | --------------------------------------------------- |
| `auth.oidc_state_invalid` | state missing, stale, replayed or divergent         |
| `auth.oidc_claim_invalid` | issuer/audience/signature/nonce/time invalid        |
| `auth.session_missing`    | opaque session absent or unknown                    |
| `auth.session_expired`    | idle/absolute expiry reached                        |
| `auth.session_revoked`    | session revoked or membership invalidated           |
| `auth.csrf_invalid`       | origin/fetch metadata/token check failed            |
| `auth.tenant_mismatch`    | token/session/resource tenants differ               |
| `auth.biscuit_invalid`    | signature, format, authority or attenuation invalid |
| `auth.biscuit_revoked`    | verified root block is revoked                      |
| `auth.operation_denied`   | deny-by-default authorizer found no allowance       |
| `auth.key_unavailable`    | qualified verification/signing key unavailable      |

Messages never reveal whether a user, tenant or resource exists. Operational logs retain request/resource IDs, root block ID, policy/rule ID and outcome—not user/session IDs. Attributable actor history belongs to the authorized product event or deletion/approval receipt under that owner's retention policy, not to auth logs.

## Required evidence

- OIDC state/nonce/PKCE replay and claim-confusion vectors ;
- cookie attributes, fixation rotation, Origin/CSRF and logout browser tests ;
- session idle/absolute clock tests and revocation retention ;
- minimal Biscuit allow vectors plus missing tenant, cross-tenant, wrong role/operation and expiry denials ;
- attenuation monotonicity, root-ID revocation, cache outage and two-key rotation tests ;
- proxy/application log inspection proving no cookie, code, verifier, provider token or Biscuit bytes.
