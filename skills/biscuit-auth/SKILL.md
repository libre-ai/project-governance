---
name: biscuit-auth
description: Apply Biscuit token authorization — authority blocks, attenuation, authorizer policies, multi-tenant isolation, Ed25519 keys. Use when implementing or debugging Biscuit auth in Rust/axum or TypeScript/Hono services. Key rotation and revocation live in references/rotation-revocation.md.
license: Apache-2.0
status: candidate
---

<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Biscuit — autorisation

## Modèle mental

- Biscuit est un système logique (mini-Datalog), pas un blob signé comme JWT.
- Token = facts (données) + checks (auto-restrictions) ; Authorizer = facts (contexte) + policies (décisions).
- Closed-world assumption : tout ce qui n'est pas explicitement autorisé est refusé.
- Attenuation : chaque intermédiaire restreint, jamais n'étend — sans contacter l'émetteur.
- Un token Biscuit peut être restreint après émission, un JWT ne peut pas.

## Authority block — le socle du token

```datalog
// Créé par le service d'auth uniquement
user("user_123");
tenant("org_456");
role("user_123", "admin");
check if time($time), $time < 2026-12-31T23:59:59Z;
```

- `user()` : identité, obligatoire. `tenant()` : organisation, obligatoire (multi-tenant). `role()` : permissions, liée à l'utilisateur.
- `check if time(...)` : expiration dans le token — le token s'auto-limite.
- Aucune donnée sensible dans le token (pas de mot de passe, pas d'email).

## Attenuation — restreindre sans round-trip

```datalog
// Block ajouté par un service intermédiaire (API gateway, BFF)
check if resource("invoices");
check if operation($op), ["read", "list"].contains($op);
```

Chaque block ajouté ne peut que restreindre, jamais étendre les droits. Cas d'usage : gateway qui délègue à un micro-service avec des droits réduits ; token utilisateur atténué en token de service pour une tâche spécifique.

## Authorizer — côté service

```datalog
// Facts de contexte (injectés par le service)
time(2026-03-02T10:30:00Z);
resource("invoices");
operation("read");

// Policies (décisions du service)
allow if user($id), tenant($tenant), role($id, "admin");
allow if user($id), tenant($tenant), resource("invoices"), operation("read");
deny if true;
```

- `deny if true` obligatoire en dernière policy (closed-world) : sans elle, un token sans match est ignoré plutôt que refusé — faille.
- Policies dans l'authorizer, checks dans le token — jamais l'inverse. Tester chaque policy avec un token minimal.

## Multi-tenant — isolation

- Fact `tenant("org_id")` obligatoire dans chaque authority block ; l'authorizer vérifie toujours `check if tenant($t)`.
- Un token sans `tenant()` est invalide, l'authorizer doit le rejeter. Jamais de cross-tenant : un token tenant A n'accède jamais aux données tenant B. Combiner avec Row-Level Security PostgreSQL pour défense en profondeur.

## Clés et cryptographie

- Ed25519 : clé privée signe, clé publique vérifie. Génération : `biscuit keypair` (CLI).
- Clé privée : env var `BISCUIT_PRIVATE_KEY`, uniquement sur le service d'auth. Clé publique : env var `BISCUIT_PUBLIC_KEY`, distribuée à tous les services (alternative : `GET /.well-known/biscuit-public-key` si rotation fréquente).
- Rotation et révocation : voir `references/rotation-revocation.md` — jamais réinlinées ici.

## Token lifecycle

- **Création** : uniquement par le service d'auth, jamais par le client ni un service intermédiaire.
- **Transport** : header `Authorization: Bearer <base64>`, pas en cookie (évite CSRF).
- **Validation** : vérifier la signature → exécuter l'authorizer → extraire les facts.
- **Expiration** : check dans le token, pas dans l'authorizer — c'est le token qui s'auto-limite.
- **Refresh** : pas de refresh token — le client redemande un nouveau Biscuit au service d'auth.

## Intégration Rust (axum) et TypeScript (Hono)

- Rust : extracteur custom `FromRequestParts` — lire `Authorization: Bearer`, `Biscuit::from_base64(token, public_key)`, exécuter l'authorizer, retourner `AuthenticatedUser`. Layer sur les routes protégées (`Router::nest`), routes publiques sans layer (`/health`, `/.well-known/biscuit-public-key`). `#[instrument(skip(token))]` : ne jamais logger le token.
- TypeScript (Hono) : middleware lisant `c.req.header("Authorization")`, `Biscuit.from_base64` via `@biscuit-auth/biscuit-wasm`, injection dans `c.set("user", ...)`. Facts en `snake_case`.

## Debugging

- `biscuit inspect <token>` : facts, checks, policies. `biscuit inspect --verify-with <public_key>` : vérifie la signature.
- En cas de 401 : logger le résultat de l'authorizer (quelle policy a refusé, pourquoi) — jamais le token complet.

## Interdit

- JWT sauf interface avec un système externe qui l'exige. Création de tokens côté client. Policies dans le token (policies = authorizer, checks = token). Token sans expiration ni sans `tenant()`. Clé privée partagée entre services. Logger le token complet.
