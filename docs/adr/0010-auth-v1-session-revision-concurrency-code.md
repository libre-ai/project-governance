# ADR-0010 — Code de concurrence de révision de session (auth.v1)

- **Statut :** accepted
- **Date :** 2026-07-20
- **Arbitrage :** propriétaire, délégué en session du 2026-07-20 (« review les PR #111 + trancher le 412 (ratifier/remapper) ») ; cette instruction est la trace d'arbitrage.
- **Portée :** contrat auth.v1 — clarification, sans amendement de principe verrouillé
- **Répond à :** la réserve bloquante de la gate `identity-threat-model-review` (WP-G2-I01)

## Contexte

L'implémentation `packages/auth-web` répond `412 Precondition Failed` avec le code problem-details `auth.session_revision_mismatch` (`handlers.ts:139`) quand la précondition de révision d'une mutation de session échoue. La revue a signalé que ce code n'apparaît pas dans la table de refus verrouillée de `IDENTITY-AUTHORIZATION.md`.

Vérification à la source :

1. Le lock **exige déjà** la précondition de révision : « Cookie-authenticated mutations require exact allowed Origin, same-site Fetch Metadata where available, a synchronizer CSRF token in `X-CSRF-Token`, idempotency key and **expected revision** » (`IDENTITY-AUTHORIZATION.md`, section session).
2. Le contrat OpenAPI `auth.v1.yaml` documente déjà le paramètre `Revision` du `DELETE /v1/auth/session` et une réponse `default: Problem` qui accueille tout code problem-details.
3. La table de refus liste les refus d'**authentification et d'autorisation** (état/claim OIDC, session, CSRF, tenant, Biscuit, autorisation, clé). Un échec de précondition de concurrence optimiste n'est pas un refus d'auth.

Le 412 n'est donc ni une extension non déclarée du contrat (il tombe sous `default: Problem`, le paramètre de révision est documenté) ni une transgression de la table (qui ne prétend couvrir que les refus d'auth). Le lock imposait la précondition de révision sans fixer son code de réponse.

## Décision

Le contrôle de concurrence optimiste requis par la précondition de révision répond **`412` avec `auth.session_revision_mismatch`**. Ce code est **ratifié** comme sémantique de concurrence, **distincte de la table de refus d'authentification** — laquelle reste inchangée (aucun code retiré, ajouté ou modifié).

Aucun principe verrouillé n'est amendé : l'exigence de révision était déjà normative ; seule sa réponse HTTP, jusqu'ici sous-spécifiée, est explicitée. Une note de portée est ajoutée à `IDENTITY-AUTHORIZATION.md` pour distinguer les deux catégories. Le code d'implémentation reste inchangé — il était déjà conforme.

## Alternative écartée

Remapper le 412 sur un code de la table (`400`/`403`) dégraderait la sémantique HTTP : `412 Precondition Failed` avec `If-Match` est l'usage canonique d'un contrôle de concurrence optimiste, et `403` (autorisation refusée) décrirait faussement un conflit de concurrence. La correction prime sur l'évitement procédural d'une clarification.

## Conséquences

- Note de portée dans `IDENTITY-AUTHORIZATION.md` (table de refus = refus d'auth ; concurrence de révision = 412).
- Réserve bloquante de la gate `identity-threat-model-review` levée.
- Dette non bloquante enregistrée (verdict de gate) : `rotateSession()` est définie mais non appelée en production (conformité de fait par cookie neuf à chaque login) ; la course multi-onglets n'est prouvée qu'au niveau unitaire.

No invariant (backfill 2026-08-18, Domain I — Process & CI) : cet ADR le dit
déjà lui-même dans sa Décision — « aucun principe verrouillé n'est amendé »
— une clarification de code de réponse HTTP pour une exigence déjà
normative, sans ajout au registre.
