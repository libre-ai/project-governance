# DRAFT SPEC: `@libre-ai/auth-web` — Layer 4 Provider-Neutral OIDC & Opaque Sessions

**Version**: 0.1.0-draft  
**Status**: Benchmark alignment audit  
**Date**: 2026-07-22

---

## Propósito

Implémenter la frontière OIDC Authorization Code + PKCE (RFC 7636 S256) et la gestion de sessions opaque pour les navigateurs Web, indépendant du fournisseur d'identité. Brick layer-4 qui expose les quatre endpoints browser (login, callback, session read, logout) avec cookies signés (`__Host-` prefix), rotation de fixation, expiry idle/absolue et vérification ID-token fermée (RS256/ES256).

Conserver la souveraineté: pas de stockage provider tokens, pas de dépendance tiers auth SaaS, pas de Biscuit côté navigateur (Biscuit reste backend, via `crates/authz-biscuit`).

---

## Périmètre et Surface

**Surface actuelle** (v0.1.0):

- **Endpoints HTTP**: 4 handlers (handleLogin, handleCallback, handleGetSession, handleDeleteSession)
- **OIDC Flow**: Authorization Code + PKCE S256 (configurable token endpoint)
- **Session Management**: opaque cookies keyed-digest, CSRF synchronizer, fixation rotation
- **Token Verification**: ID-token RS256/ES256 closed boundary
- **Development Issuer**: in-memory deterministic issuer (testing, offline)
- **Storage Port**: in-memory store (deterministic tests); durable adapter → WP-G2-D01
- **Membership Directory**: résolution simple identité (in-memory mock)

**Conformité OpenAPI**:

- Contract: `contracts/openapi/auth.v1.yaml`
- Identity model lock: `docs/specifications/IDENTITY-AUTHORIZATION.md`
- Browser session schema: `contracts/schemas/browser-session.v1.schema.json`

---

## Capacités Actuelles

### Flux OIDC & Authorization

- **Authorization Code Flow**: redirect login → provider → callback → token exchange
- **PKCE S256**: code_challenge/code_verifier, protection CSRF native
- **Token Endpoint**: configurable (closures); abstract provider URL/client credentials
- **ID-Token Verification**: RS256/ES256 closed boundary, expiry/aud/iss validation

### Session Management

- **Opaque Browser Sessions**: pas d'JWT dans le navigateur; secrets never surfaced
- **Cookie-Digest Keys**: `__Host-` prefix (secure/httpOnly/sameSite=Strict)
- **CSRF Synchronizer**: CSRF token + cookie pair, vérification Double-Submit
- **Session Lifecycle**: idle timeout, absolute expiry, refusal retention
- **Fixation Rotation**: nouvel ID session après chaque authentification réussie
- **Membership Directory**: lookup identité (tenant, sub, claims)

### Sécurité & Observabilité

- **Cryptographic Digest**: HMAC-based session identification, no raw secrets in logs
- **Redaction**: sensitive fields stripped from observability
- **Clock Abstraction**: testable time (dev issuer uses fixed clock)
- **JWS Verification**: RS256/ES256, configurable JWKS endpoint

### Contrats HTTP

- `/v1/login`: GET → redirect OIDC provider
- `/v1/callback`: GET (code + state) → token exchange → session cookie + redirect
- `/v1/session`: GET → return current session identity (if valid)
- `/v1/session`: DELETE → destroy session, clear cookies, redirect logout

---

## Non-objectifs

**Hors périmètre volontaire**:

- **IdP (Identity Provider)**: ne fournirons pas Kratos/Hydra; restons neutres (configurez votre OIDC provider)
- **Stockage Mot-de-Passe**: délégué au provider ou à une couche séparée (e.g. Kratos)
- **Passkeys/WebAuthn**: non implémenté aujourd'hui (T1 optionnel)
- **MFA**: orthogonal à ce brick; delegated à provider capabilities
- **Account Linking**: non implémenté (T2 si multi-provider en même app)
- **OAuth Social Login Direct**: aucun client pré-intégré; OIDC generic configuration
- **Stockage Provider Tokens**: jamais de refresh_token/access_token stockés en base; sessions opaque uniquement
- **Sessions Publiques**: tous les endpoints demandent allowedOrigin strict

---

## Surface Contrats / API

### Exports Principaux

```typescript
// HTTP boundary & session service
export class AuthHttpBoundary {
  constructor(options: AuthHttpBoundaryOptions);
  handleLogin(req: Request): Promise<Response>;
  handleCallback(req: Request): Promise<Response>;
  handleGetSession(req: Request): Promise<Response>;
  handleDeleteSession(req: Request): Promise<Response>;
}

export interface AuthHttpBoundaryOptions {
  allowedOrigin: string; // "https://app.example.fr"
  flow: OidcLoginFlow;
  sessions: SessionService;
}

// OIDC transaction
export class OidcLoginFlow {
  startLogin(
    redirectUri: string,
    state: string,
    nonce: string,
  ): { authorizationUrl: string; state: string };
  completeLogin(
    code: string,
    verifier: string,
    tokenEndpoint: TokenEndpoint,
  ): Promise<CompletedLogin>;
}

export interface TokenEndpoint {
  (
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<{
    id_token: string;
    access_token?: string;
  }>;
}

// Session service
export class SessionService {
  createSession(claims: VerifiedIdTokenClaims): Promise<CreatedSession>;
  resolveSession(sessionId: string): Promise<SessionResolution>;
  deleteSession(sessionId: string): Promise<void>;
}

// Token verification
export function verifyIdToken(
  input: IdTokenVerificationInput,
): Promise<VerifiedIdTokenClaims>;

export interface IdTokenVerificationInput {
  token: string;
  jwksEndpoint?: string;
  expectedAudience?: string;
  expectedIssuer?: string;
}

// CSRF
export function verifyCsrf(input: CsrfCheckInput): Promise<CsrfCheckResult>;

// Types
export type BrowserSessionOidc = {
  oidc: { sub: string; iss: string; aud: string };
};
export type BrowserSessionStatus = "active" | "expired" | "not_found";
export type SessionResolution = {
  status: BrowserSessionStatus;
  identity?: SessionIdentityFacts;
};
```

### Constant Exports

```typescript
export const SESSION_COOKIE = "__Host-lai.session";
export const OIDC_TRANSACTION_COOKIE = "__Host-lai.oidc.tx";
export const OIDC_TRANSACTION_LIFETIME_MS = 15 * 60 * 1000; // 15 min
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
export const ABSOLUTE_LIFETIME_MS = 8 * 60 * 60 * 1000; // 8 hours
export const REFUSAL_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
```

### Storage Interface (Port)

```typescript
export interface SessionStore {
  create(record: BrowserSessionRecord): Promise<void>;
  retrieve(sessionId: string): Promise<BrowserSessionRecord | null>;
  revoke(sessionId: string): Promise<void>;
  expireIdle(before: Date): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  // Deterministic for tests; durable adapter in WP-G2-D01
}
```

---

## Posture Accessibilité & Sécurité

### Sécurité

- **OIDC Spec**: RFC 6749 (OAuth 2.0), RFC 6234 (OIDC Core), RFC 7636 (PKCE)
- **PKCE S256**: code_challenge = BASE64URL(SHA256(code_verifier)), protection contre authorization code interception
- **CSRF Protection**: Double-Submit Cookie + Synchronizer Token, configurable SameSite
- **Cookie Attributes**: `__Host-` prefix + secure + httpOnly + sameSite=Strict
- **ID-Token Verification**: signature (RS256/ES256) + expiry + aud/iss match
- **Session Fixation**: nouvel ID après authentication réussie, invalidation ancien
- **Secret Hygiene**: aucun raw secret en logs, digests uniquement (HMAC)

### Intégrité Contrats

- **OpenAPI v3.1**: `auth.v1.yaml` défini les 4 endpoints, formats request/response
- **JSON Schema**: `browser-session.v1.schema.json` type du record persistant
- **Identity Model Lock**: `IDENTITY-AUTHORIZATION.md` spécifie tenant/sub/claims invariants

### Pas de Telémétrie / Pas de Tiers

- Zéro appel d'origine distante en dehors du token endpoint configuré
- Logs redacted: sub/iss supprimés sauf dans audit explicite
- Storage port: adapter durable conçu pour self-hosted DB (Postgres/SQLite)

---

## Tableau de Parité Benchmark

| Benchmark                   | Auth.js (NextAuth)  | Lucia                | Ory (Kratos/Hydra)    | Couverture Actuelle                | T1 Prioritaire                                        | Arbitrage                            |
| --------------------------- | ------------------- | -------------------- | --------------------- | ---------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| **OIDC Authorization Code** | ✓ Provider adapters | ✓ OAuth integrations | ✓ Native Hydra        | ✓ Flow implémenté                  | —                                                     | ✓ Couvert                            |
| **PKCE S256**               | ✓ Natif             | ✓ Available          | ✓ Natif               | ✓ Code + verifier                  | —                                                     | ✓ Couvert                            |
| **Opaque Sessions**         | ✓ Database-backed   | ✓ Database port      | ✓ Hydra tokens        | ✓ Keyed-digest cookies             | —                                                     | ✓ Couvert                            |
| **Cookie Lifecycle**        | ✓ Session table     | ✓ Session store      | ✓ Session state       | ✓ Idle + absolute expiry           | —                                                     | ✓ Couvert                            |
| **CSRF Protection**         | ✓ Double-Submit     | ✓ Built-in           | ✓ Native              | ✓ Synchronizer token               | —                                                     | ✓ Couvert                            |
| **ID-Token Verification**   | ✓ JWKS endpoint     | ✓ Manual verify      | ✓ JWS verify          | ✓ RS256/ES256 closed               | —                                                     | ✓ Couvert                            |
| **Fixation Rotation**       | ✓ Session regen     | ✓ SessionId rotate   | ✓ Native              | ✓ Post-auth rotate                 | —                                                     | ✓ Couvert                            |
| **MFA / TOTP**              | ✓ Intégrations      | ✗ Absent             | ✓ Native              | ✗ Absent                           | ✗ Hors périmètre (provider)                           | Provider capability                  |
| **Passkeys / WebAuthn**     | ✓ (Experimental)    | ✗ Absent             | ✓ Kratos              | ✗ Absent                           | T1 optionnel                                          | Complexité; délegué provider         |
| **Account Linking**         | ✓ (Advanced)        | ✗ Absent             | ✓ Kratos              | ✗ Absent                           | T2 si multi-provider                                  | Non-goal; single provider pattern    |
| **RBAC / ABAC**             | ✓ (Auth0 style)     | ✗ Absent             | ✓ Keto (Zanzibar)     | ✗ Absent                           | ✗ Hors scope                                          | Layer-5 (authz package); pas session |
| **Membership Directory**    | ✓ (Adapter layer)   | ✓ (Custom)           | ✓ Kratos              | ✓ In-memory mock                   | Expand (LDAP, Kratos dir lookup)                      | T2 optionnel                         |
| **Provider Token Storage**  | ✓ (Configurable)    | ✓ (Optional)         | ✓ (Hydra token store) | ✗ Non-goal (never stored)          | —                                                     | Sovereignty non-goal                 |
| **Multi-Tenant**            | ✓ (Advanced)        | ✗ Absent             | ✓ Native              | ✓ Preparé (directory tenant field) | ✓ Tenant isolation test                               | T1 optionnel                         |
| **Session Inspection**      | ✓ API               | ✓ Manual             | ✓ Hydra introspection | ✓ `/v1/session` GET                | —                                                     | ✓ Couvert                            |
| **Logout Handling**         | ✓ Session clear     | ✓ Session delete     | ✓ RP-initiated logout | ✓ Destroy + redirect               | RP-initiated logout (provider signout)                | T2 optionnel                         |
| **Email Verification**      | ✓ (Emailer adapter) | ✗ Absent             | ✓ Kratos              | ✗ Absent                           | —                                                     | Orthogonal (provider layer)          |
| **Password Reset**          | ✓ (OAuth flow)      | ✗ Absent             | ✓ Kratos              | ✗ Absent                           | —                                                     | Hors scope (provider concern)        |
| **Social Sign-In**          | ✓ (30+ providers)   | ✓ (Generic OAuth)    | ✓ (OIDC connector)    | ✓ Generic OIDC config              | Preset common providers (FR: FranceConnect, Keycloak) | T2 pour FR ecosystem                 |
| **Development Mode**        | ✓ Mock provider     | ✗ Limited            | ✗ Absent              | ✓ DevIssuer in-memory              | —                                                     | ✓ Couvert                            |
| **Observability / Logs**    | ✓ Debug mode        | ✓ Manual             | ✓ Audit logs          | ✓ Redacted logs, clock abstract    | Structured logging (JSON event stream)                | T2 optionnel                         |

---

## T1 Prioritaires (Valeur Benchmark)

### 1. **WebAuthn / Passkeys Support**

- **Pourquoi**: Auth.js v5 / Ory Kratos le font natif; users attendent passwordless
- **Effort**: 5–7 jours (Aria assertion, credential store)
- **Impact**: align user expectations; match Auth.js/Ory surface
- **Arbitrage**: T1 si passkeys ciblé pour FR market; sinon T2 (OIDC provider handles)
- **Détail**: ceWebAuthn flows (registration/assertion) restent optionnels si provider (e.g. Kratos) les gère

### 2. **Multi-Tenant Isolation & Audit**

- **Pourquoi**: Lucia/Auth.js font par consommateur; Ory Kratos natif; nous avons le structure mais pas les tests
- **Effort**: 3–4 jours (tenant isolation tests, audit events)
- **Impact**: readiness production multi-client; compliance audit
- **Arbitrage**: T1 si multi-tenant déjà critère d'acceptation; sinon T2
- **Détail**: directory tenant field présent; ajouter e2e tests + événements audit signés

### 3. **RP-Initiated Logout (OpenID Connect RP-Initiated Logout spec)**

- **Pourquoi**: Auth.js/Ory native; users expect signout → provider signout
- **Effort**: 2 jours (POST to provider logout endpoint, state param)
- **Impact**: user logout complet (pas de session orpheline provider-side)
- **Arbitrage**: T1 si exigence; sinon T2 (logout local seul suffit MVP)

---

## Arbitrage Souveraineté qui Verrouille une Fonctionnalité Benchmark

**Stockage Provider Tokens (refresh_token / access_token)**: Auth.js/Lucia le font standard; Ory Hydra le stocke natif. Nous refusons volontairement — **non-goal souveraineté**. Raison: tokens stockés = dépendance fournisseur, révocation asynchrone, fuite de surface. À la place:

- Sessions opaque uniquement
- Token endpoint (provider) appelé à chaque besoin (online)
- Refresh via re-auth si expiré

**Conséquence**: clients ne peuvent pas utiliser provider `access_token` localement; doivent demander provider pour chaque call (e.g. via un proxy authz). Acceptable pour FR sovereign apps; bloque AWS/GCP/Auth0 workflows qui stockent tokens.

---

## Notes Registre

| Identifiant                 | Valeur                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brick**                   | `@libre-ai/auth-web`                                                                                                                                          |
| **Layer**                   | 4 (application identity boundary)                                                                                                                             |
| **Status**                  | Publish-ready (v0.1.0-draft)                                                                                                                                  |
| **Dépôt**                   | `github.com/libre-ai/libre-ai` → `packages/auth-web`                                                                                                          |
| **License**                 | EUPL-1.2                                                                                                                                                      |
| **Dépendances Directes**    | `@libre-ai/contracts`, `@libre-ai/web-platform` (workspace)                                                                                                   |
| **Exported Paths**          | `.` (index)                                                                                                                                                   |
| **API Surface**             | 4 HTTP handlers, SessionService interface, OidcLoginFlow, storage port                                                                                        |
| **Benchmark Parity**        | 75–80% (OIDC/PKCE/sessions/CSRF OK, MFA/passkeys/account-linking non-goals, token storage sovereign refusal)                                                  |
| **Sovereignity Score**      | Très élevé (opaque sessions, pas de token storage, provider-neutral, self-hosted compatible)                                                                  |
| **Biscuit Differentiation** | **Pas directement ici** — Biscuit (capability tokens) vit en layer-5 (`crates/authz-biscuit`), issu depuis les claims de session (browser never sees Biscuit) |

---

## Intégration Biscuit (Contexte Architectural)

Cette brick **ne fabrique pas** Biscuit. Au lieu:

- SessionService lit verified `sub` / `iss` / claims depuis ID-token
- Layer-5 authz-biscuit issuer reçoit ces claims
- Génère opaque Biscuit capabilities
- Browser les transmet en Authorization header (opaque au navigateur)

**Différenciation vs Auth.js/Lucia/Ory**: Nous isolons session (navigation) de capabilities (actions). Auth.js/Lucia/Ory embedded RBAC/ABAC dans la session; nous déléguons à Biscuit (cryptographic, revocable, fine-grained). Advantage: offline capability verification, zero-knowledge proofs, delegation chains.
