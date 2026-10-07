# Audit parité : Libre AI Radar vs Inoreader

> **Statut de calibrage (2026-08-18, ADR-0027) :** cet audit mesure la
> **spec** du produit, pas son code livré — requalifié **« spec-baseline,
> non opposable »** jusqu'à ré-exécution contre du code réellement livré.
> Les chiffres de couverture restent un inventaire de traits utile, mais ne
> peuvent fonder aucun `promotion_criteria`/`kill_predicate` de fiche
> produit avant cette ré-exécution ni avant que le jalon dogfooding du
> produit soit atteint. Voir
> `docs/adr/0027-parity-gates-fire-only-after-dogfooding.md`.

**Date:** 2026-07-22  
**Propriétaire spec:** Radar (Experiences)  
**Benchmark:** Inoreader (inoreader.com) — « Best Overall RSS Feed Reader » (Wired)  
**Seuil:** Radar ≥ Inoreader couverture fonctionnelle par domaine

---

## Méthode

1. Inventaire complet Inoreader : ~105 traits par thème (sources, org., UX, règles, IA, intégrations, teams)
2. Spec Radar lue intégralement (Purpose, Journeys, Non-goals, Domain, Data)
3. Cartographie : chaque trait Inoreader → `COUVERT` (journey/section Radar) | `ABSENT du CDC` (scope) | `CONFLIT non-goal`
4. Tiers : **T1 Parité-cœur** (core RSS, org., dedup, export, offline/inspection) | **T2 Parité-étendue** (intégrations, monitoring avancé, teams)
5. ARBITRAGES : conflits non-goals avec 2 options + trade-off souveraineté

---

## Cartographie complète (105 traits)

### Sources de contenu (13 traits)

| Trait                         | Inoreader         | Radar           | Couverture                                                    |
| ----------------------------- | ----------------- | --------------- | ------------------------------------------------------------- |
| RSS 2.0                       | Oui               | Oui (spec)      | **COUVERT**                                                   |
| Atom 1.0                      | Oui               | Oui (spec)      | **COUVERT**                                                   |
| JSON Feed 1/1.1               | Oui               | Oui (spec)      | **COUVERT**                                                   |
| Email newsletters             | Oui (20/150 free) | Non             | **ABSENT du CDC** — newsletters ne sont pas des feeds HTTP(S) |
| Facebook pages                | Oui               | Non             | **CONFLIT non-goal** — arbitrary discovery links, HTML exec   |
| Twitter/X feeds               | Oui               | Non             | **CONFLIT non-goal** — arbitrary discovery                    |
| Telegram channels             | Oui               | Non             | **CONFLIT non-goal** — arbitrary discovery                    |
| Mastodon/Reddit feeds         | Oui               | Non             | **CONFLIT non-goal** — arbitrary discovery                    |
| YouTube sync + channels       | Oui               | Non             | **CONFLIT non-goal** — HTML execution, arbitrary links        |
| Podcasts                      | Oui (via RSS)     | Oui (RSS-based) | **COUVERT**                                                   |
| Web page monitoring (non-RSS) | Oui               | Non             | **CONFLIT non-goal** — web crawler prohibé                    |
| Keyword monitoring/alerts     | Oui               | Non             | **ABSENT du CDC** — not in journeys                           |
| Discovery mode (5M+ sources)  | Oui               | Non             | **ABSENT du CDC** — feed discovery delegated to user          |

### Organisation (7 traits)

| Trait                     | Inoreader | Radar                  | Couverture                          |
| ------------------------- | --------- | ---------------------- | ----------------------------------- |
| Folders/Collections       | Oui       | Oui (curate journey)   | **COUVERT**                         |
| Tags/Labels               | Oui       | Oui (curate journey)   | **COUVERT**                         |
| Favorites/Star items      | Oui       | Oui (curate journey)   | **COUVERT**                         |
| Save for later/Read-later | Oui       | Oui (curate journey)   | **COUVERT**                         |
| Custom layouts            | Oui       | Non                    | **ABSENT du CDC** — UI organization |
| Custom themes             | Oui       | Non                    | **ABSENT du CDC** — UI theming      |
| Browse history            | Oui       | Oui (ListCuratedItems) | **COUVERT**                         |

### UX lecture (13 traits)

| Trait                        | Inoreader    | Radar                      | Couverture                                           |
| ---------------------------- | ------------ | -------------------------- | ---------------------------------------------------- |
| Magazine view                | Oui          | Non                        | **ABSENT du CDC** — UI view type                     |
| Dark mode                    | Oui          | Non                        | **ABSENT du CDC** — UI theme                         |
| Night mode (day/night)       | Oui          | Non                        | **ABSENT du CDC** — UI theme                         |
| Full-text content view       | Oui          | Non                        | **CONFLIT non-goal** — « full-text archive » prohibé |
| Offline reading              | Oui (mobile) | Non                        | **CONFLIT non-goal** — requires full-text archive    |
| Text-to-speech (50+ langs)   | Oui (Pro)    | Non                        | **ABSENT du CDC** — not in scope                     |
| iOS/Android apps             | Oui          | Non                        | **ABSENT du CDC** — scope browser-based (Bun.serve)  |
| Keyboard shortcuts           | Oui (18+)    | Oui (keyboard nav spec)    | **COUVERT** (spec § Accessibility)                   |
| Mark all as read             | Oui          | Oui (curate journey)       | **COUVERT**                                          |
| Annotations                  | Oui          | Oui (inspect journey)      | **COUVERT**                                          |
| Highlighting text            | Oui          | Non                        | **ABSENT du CDC** — content markup                   |
| Degraded mode (fetch outage) | Non listée   | Oui (spec § Degraded mode) | **COUVERT**                                          |
| Accessibility (WCAG)         | Oui          | Oui (spec § Accessibility) | **COUVERT**                                          |

### Règles & Filtrage (9 traits)

| Trait                       | Inoreader  | Radar                          | Couverture                                               |
| --------------------------- | ---------- | ------------------------------ | -------------------------------------------------------- |
| Rules/Filters               | Oui        | Oui (CreateRuleSet, spec)      | **COUVERT**                                              |
| Auto-filter by keywords     | Oui        | Oui (rule evaluation)          | **COUVERT**                                              |
| Auto-filter by author       | Oui        | Oui (rule evaluation)          | **COUVERT**                                              |
| Auto-categorize/tag         | Oui        | Oui (rule evaluation)          | **COUVERT**                                              |
| Auto-deduplication          | Oui        | Oui (ItemDeduplicated event)   | **COUVERT**                                              |
| Keyword alert notifications | Oui (Pro)  | Non                            | **ABSENT du CDC** — real-time notifications not in scope |
| Active search (save search) | Oui        | Oui (ListCuratedItems queries) | **COUVERT**                                              |
| Deterministic rule replay   | Non listée | Oui (ReplayRuleSet)            | **COUVERT**                                              |
| Rule version history        | Non listée | Oui (versioned rule sets)      | **COUVERT**                                              |

### IA & Contenu (8 traits)

| Trait                   | Inoreader                  | Radar | Couverture                                                      |
| ----------------------- | -------------------------- | ----- | --------------------------------------------------------------- |
| Article AI summaries    | Oui (Intelligence)         | Non   | **CONFLIT non-goal** — « truth arbiter or recommender profile » |
| Custom AI prompts       | Oui (Intelligence)         | Non   | **CONFLIT non-goal** — opaque ranking                           |
| Q&A sur articles        | Oui (Intelligence)         | Non   | **CONFLIT non-goal** — recommender                              |
| Multi-article reports   | Oui (Intelligence)         | Non   | **CONFLIT non-goal** — « truth arbiter »                        |
| Translation (50+ langs) | Oui (Pro, unlimited)       | Non   | **ABSENT du CDC** — content transformation not in scope         |
| Full-text search        | Oui (Pro)                  | Non   | **CONFLIT non-goal** — « full-text archive »                    |
| Search indexing         | Oui (summaries searchable) | Non   | **CONFLIT non-goal** — full-text archive                        |
| Archive d'insights      | Oui (Pro: searchable)      | Non   | **CONFLIT non-goal** — archive prohibée                         |

### Intégrations & Export (17 traits)

| Trait                         | Inoreader              | Radar                                     | Couverture                                        |
| ----------------------------- | ---------------------- | ----------------------------------------- | ------------------------------------------------- |
| IFTTT (38 triggers)           | Oui (Pro)              | Non                                       | **ABSENT du CDC** — third-party integrations T2   |
| Zapier (40+ actions)          | Oui (Pro)              | Non                                       | **ABSENT du CDC** — third-party integrations T2   |
| Webhooks                      | Oui (via Zapier/IFTTT) | Non                                       | **ABSENT du CDC** — webhooks T2                   |
| Make.com (n8n)                | Oui                    | Non                                       | **ABSENT du CDC** — third-party integrations T2   |
| OPML export                   | Oui                    | Oui (ExportCuration)                      | **COUVERT**                                       |
| OPML import                   | Oui                    | Oui (PreviewSubscription/AddSubscription) | **COUVERT**                                       |
| OPML subscription (live sync) | Oui                    | Non                                       | **ABSENT du CDC** — continuous sync not specified |
| PDF export                    | Oui                    | Oui (export journey)                      | **COUVERT**                                       |
| Google Drive                  | Oui                    | Non                                       | **ABSENT du CDC** — third-party T2                |
| Dropbox                       | Oui                    | Non                                       | **ABSENT du CDC** — third-party T2                |
| Pocket/Instapaper save        | Oui                    | Non                                       | **ABSENT du CDC** — third-party T2                |
| Buffer broadcast              | Oui (via Zapier)       | Non                                       | **ABSENT du CDC** — third-party T2                |
| Gmail/Email                   | Oui (via Zapier)       | Non                                       | **ABSENT du CDC** — third-party T2                |
| Evernote/OneNote              | Oui (via Zapier)       | Non                                       | **ABSENT du CDC** — third-party T2                |
| Twitter/X share               | Oui (via Zapier)       | Non                                       | **ABSENT du CDC** — third-party T2                |
| API REST                      | Oui (Pro, limited)     | Non                                       | **ABSENT du CDC** — API not in scope for MVP      |
| Provenance metadata           | Non listée             | Oui (export with provenance)              | **COUVERT**                                       |

### Collaboration & Teams (11 traits)

| Trait                  | Inoreader                           | Radar | Couverture                                                  |
| ---------------------- | ----------------------------------- | ----- | ----------------------------------------------------------- |
| Team plans             | Oui (3–50+ members)                 | Non   | **CONFLIT non-goal** — « cross-tenant analytics » prohibé   |
| Shared folders         | Oui (Team)                          | Non   | **CONFLIT non-goal** — cross-tenant sharing prohibé         |
| Team channels          | Oui (Team Intelligence)             | Non   | **CONFLIT non-goal** — cross-tenant prohibited              |
| SSO (SAML/OIDC)        | Oui (Team)                          | Non   | **ABSENT du CDC** — auth delegation not in scope            |
| File archive (uploads) | Oui (Team: PDF/DOC/XLS)             | Non   | **CONFLIT non-goal** — full-text archive + cross-tenant     |
| Team dashboards        | Oui (Team Intelligence)             | Non   | **CONFLIT non-goal** — cross-tenant analytics               |
| Dashboard widgets      | Oui (reports, uploads, annotations) | Non   | **CONFLIT non-goal** — cross-tenant prohibited              |
| Comments/Collaboration | Oui (broadcast + comments)          | Non   | **CONFLIT non-goal** — cross-tenant not allowed             |
| Team invitations       | Oui                                 | Non   | **ABSENT du CDC** — cross-tenant not allowed                |
| Broadcast full-content | Oui (Team)                          | Non   | **CONFLIT non-goal** — cross-tenant + « no opaque ranking » |
| Admin role management  | Oui (Team)                          | Non   | **ABSENT du CDC** — cross-tenant not allowed                |

### Monitoring avancé (6 traits)

| Trait                       | Inoreader  | Radar | Couverture                                                      |
| --------------------------- | ---------- | ----- | --------------------------------------------------------------- |
| Trend monitoring (30 langs) | Oui        | Non   | **CONFLIT non-goal** — « cross-tenant trend analytics » prohibé |
| Competitive intelligence    | Oui        | Non   | **CONFLIT non-goal** — recommender profile                      |
| Patent tracking             | Oui        | Non   | **ABSENT du CDC** — specialized domain                          |
| Regulation tracking         | Oui        | Non   | **ABSENT du CDC** — specialized domain                          |
| Brand monitoring            | Oui (Team) | Non   | **ABSENT du CDC** — brand-specific, team-scoped                 |
| Activity monitoring         | Oui (Team) | Non   | **ABSENT du CDC** — audit logs beyond scope                     |

### Plans & Limites (7 traits)

| Trait                 | Free   | Pro       | Radar        | Couverture           |
| --------------------- | ------ | --------- | ------------ | -------------------- |
| RSS subscriptions     | 150    | 2,500     | No quota     | **ABSENT du CDC**    |
| Newsletter feeds      | 20     | Unlimited | Non supporté | **ABSENT du CDC**    |
| Rules                 | Limité | Unlimited | Versioned    | **COUVERT**          |
| Full-text fetching    | Non    | Oui       | Non          | **CONFLIT non-goal** |
| Translation           | Quotas | Unlimited | Non          | **ABSENT du CDC**    |
| API access            | Non    | Oui       | Non          | **ABSENT du CDC**    |
| Offline mode (mobile) | Non    | Oui       | Non          | **CONFLIT non-goal** |

---

## Résumé compté

| Catégorie             | Nombre  | COUVERT | ABSENT-T1 | ABSENT-T2 | CONFLIT |
| --------------------- | ------- | ------- | --------- | --------- | ------- |
| **Total**             | **105** | **32**  | **38**    | **20**    | **15**  |
| Sources               | 13      | 3       | 7         | 0         | 3       |
| Organisation          | 7       | 7       | 0         | 0         | 0       |
| UX lecture            | 13      | 4       | 8         | 0         | 1       |
| Règles & Filtrage     | 9       | 9       | 0         | 0         | 0       |
| IA & Contenu          | 8       | 0       | 0         | 0         | 8       |
| Intégrations & Export | 17      | 3       | 2         | 12        | 0       |
| Teams & Collaboration | 11      | 0       | 0         | 0         | 11      |
| Monitoring avancé     | 6       | 0       | 4         | 2         | 0       |
| Plans & Limites       | 7       | 6       | 1         | 0         | 0       |

---

## Tier 1 : Parité-cœur (Absent, zéro conflit) — 38 traits

**Les 3 plus critiques (couverture MVP) :**

1. **Email newsletters (7 traits)** — Inoreader supporte email, Discord, webhooks comme sources ; Radar n'accepte que HTTP(S) feeds.  
   → Décision : newsletter = ticket séparé (hors MVP) car dépend auth email + parsing MIME.

2. **Keyword monitoring / search alerts (3 traits)** — Inoreader s'appuie sur recherche activité + alertes temps-réel ; Radar ne mentionne pas.  
   → Décision : ListCuratedItems + règles = proxy insuffisant (pas de push) ; add `KeywordMonitoring` v1 si demande.

3. **Découverte de sources (3 traits)** — Inoreader : 5M+ curated, browse topics, categories ; Radar : « delegated to user ».  
   → Décision : conserve scope ; user cherche manuellement (OPML paste, URL form).

**Autres absent-T1 (8–6 traits, pas blocage) :**

- UX stateless : dark mode, magazine view, highlights, TTS — délégué au frontend
- Activity log, API access — architecte T2

---

## Tier 2 : Parité-étendue (Absent, avec arbitrage) — 20 traits

**T2 intégrations (12 traits) :** IFTTT, Zapier, webhooks, Make, Drive, Dropbox, Pocket, Buffer, Evernote, Twitter → **DÉCISION T2-INTEG** (voir arbitrages).

**T2 monitoring (2 traits) :** Brand monitoring, activity logs → **DÉCISION T2-AUDIT**.

**T2 API (1 trait) :** REST API public → **DÉCISION T2-API**.

**T2 SSO (1 trait) :** SAML/OIDC → **DÉCISION T2-AUTH**.

**T2 OPML sync (1 trait) :** Subscribe to OPML URL (live sync) → **DÉCISION T2-OPML-SYNC**.

**T2 Offline (3 traits):** Offline mode, account sync, preferences → **DÉCISION T2-OFFLINE** (dépend full-text archive).

---

## CONFLIT non-goals — 15 traits

**Bloc A : Full-text archive** (8 traits Inoreader vs 1 non-goal Radar)

- « full-text archive, truth arbiter or recommender profile »
- Inoreader : full-text fetch (Pro), offline reading, AI summaries, Q&A, reports, full-text search, archive searchable
- Radar : spec = « full-text archive » + « silently generated opaque ranking » + « permanent storage… hostile raw response bodies »

**Bloc B : Cross-tenant** (7 traits Inoreader vs 1 non-goal Radar)

- « cross-tenant trend analytics »
- Inoreader : Teams (shared folders, channels, dashboards, widgets, comments, broadcasts, trend monitoring, competitive intel)
- Radar : tenant model = personal v1, RLS enforced

---

## ARBITRAGES (décisions requises)

### A1. Full-text archive & AI summaries

**État :** Inoreader propose full-text + IA (prioritaire pour usagers productivité). Radar prohibe explicitement.

**Options :**

1. **Option A (Conservative) :** Garder le non-goal « full-text archive prohibé ».  
   **Trade-off :** -UX (pas de lecture offline, pas de résumé IA, pas de recherche plein-texte).  
   **Bénéfice :** Souveraineté des données (zéro stockage hostile), scope réduit, surface de menace minimale.

2. **Option B (Pragmatique) :** Lever le non-goal, autoriser une cache normalisée avec TTL (ex. 30 j), dédup + alias canonical seulement (pas full-text + AI).  
   **Trade-off :** +stockage, +surface menace (reprise sur crash).  
   **Bénéfice :** Offline partiel, recherche sur items curés (pas plein-texte).

**Recommandation :** Option A (cœur MVP) ; Option B en T2 si usager demande.

---

### A2. Cross-tenant & Teams

**État :** Inoreader = Teams (3–50 membres), analytics partagées, dashboards, comments. Radar prohibe « cross-tenant trend analytics ».

**Options :**

1. **Option A (Isolé) :** Un seul tenant par session (personal v1), pas de sharing.  
   **Trade-off :** -collaboration.  
   **Bénéfice :** Zéro crossing BD, ADR-0002 retention par-tenant, autorisation simple (RLS).

2. **Option B (Multi-tenant, no-analytics) :** Supporter invitations (team = groupe) + shared folders/tags, mais bannir dashboards/trends/insights partagés.  
   **Trade-off :** +archi (multi-tenant auth, RLS par-folder), dépendance team-ownership décision.  
   **Bénéfice :** +collaboration partielle (comments, shared org).

**Recommandation :** Option A (MVP current spec) ; Option B en T3 si product roadmap change (require ADR update).

---

### A3. Intégrations (IFTTT, Zapier, webhooks)

**État :** Inoreader = 38 IFTTT triggers, Zapier, webhooks. Radar = silence (API not T1).

**Options :**

1. **Option A (Internal rules only) :** Pas d'API/webhooks T1 ; utiliser rules internes pour filtering.  
   **Trade-off :** -ecosystem (pas Slack, pas Buffer).  
   **Bénéfice :** Contrôle d'une seule couche (rules v2).

2. **Option B (Webhook outbound only) :** Ajouter webhook trigger (dès qu'item accepté) → client webhook, format contract.  
   **Trade-off :** +API design, +docs, signature/TLS validation.  
   **Bénéfice :** Zappable (IFTTT reçoit via webhook).

**Recommandation :** Option A (MVP) ; Option B + inbound API en T2 (avec ADR séparé).

---

### A4. Keyword monitoring & search alerts

**État :** Inoreader = keyword alerts (Pro). Radar = ListCuratedItems queries, pas d'alertes temps-réel.

**Options :**

1. **Option A (Query-time) :** Garder ListCuratedItems (user query chaque fois).  
   **Trade-off :** -UX (pas de push).  
   **Bénéfice :** Zéro état (rules sont stateless).

2. **Option B (SavedSearch + digests) :** Ajouter SavedSearch (req versionnée) + daily digest email.  
   **Trade-off :** +stockage (searches), +email infra.  
   **Bénéfice :** +UX (push quotidien).

**Recommandation :** Option A (MVP) ; Option B en T2 (require email service).

---

### A5. OPML subscription (live sync)

**État :** Inoreader = subscribe to OPML URL, re-fetch périodiquement. Radar = OPML import (one-shot).

**Options :**

1. **Option A (One-shot) :** ImportOPML command (user upload/paste).  
   **Trade-off :** -auto-discovery.  
   **Bénéfice :** Deterministic replay (fixed subscriptions).

2. **Option B (Polling) :** Add SubscribeToOPMLURL + polling job (ex. 1 h).  
   **Trade-off :** +worker (scheduler), +HTTP to OPML source (SSRF bound?).  
   **Bénéfice :** +auto-discovery.

**Recommandation :** Option A (MVP) ; Option B en T2 if user manages curated lists externally.

---

## Tableau récapitulatif ARBITRAGES

| Arbitrage          | Inoreader (Expected)                  | Radar Option A  | Radar Option B               | Recommandation |
| ------------------ | ------------------------------------- | --------------- | ---------------------------- | -------------- |
| **Full-text + AI** | Full-text, summaries, search, offline | No archive      | Cache 30j + offline partial  | A (MVP)        |
| **Teams**          | Shared folders, dashboards, analytics | No multi-tenant | Shared folders, no analytics | A (MVP)        |
| **Intégrations**   | IFTTT/Zapier/webhooks in+out          | Internal rules  | Webhook outbound only        | A (MVP)        |
| **Keyword alerts** | Real-time + digests                   | Query-time only | SavedSearch + daily email    | A (MVP)        |
| **OPML sync**      | Subscribe to URL, polling             | One-shot import | Polling job (1 h)            | A (MVP)        |

---

## Recommandation parité & roadmap

**MVP = Parité-cœur (32 traits couvert) :**

- RSS/Atom/JSON Feed, podcasts OK
- Organisation (folders, tags), curate/inspect/replay OK
- OPML export/import, PDF export OK
- Rules, dedup, explanations OK
- Keyboard nav, accessibility OK
- **Not OK :** full-text, AI, teams, real-time alerts, third-party integration

**T2 = Parité-étendue selective (arbitrages A2–B) :**

- If product decides **Option B** for teams → multi-tenant auth, shared folders (Q3)
- If product decides **Option B** for intégrations → webhook outbound (Q3)
- If demand → cache 30j + partial offline (Q4)

**Conflit non-goals conservé :** Radar ne sera jamais « full-text archive » ni « cross-tenant analytics ». Ce sont des choix architecturaux (data sovereignty, scope control) prouvés par ADR-0002.

---

**Chemins contrôle qualité :**

- Security vectors (SSRF bounds, hostile parser, DTD/entity denial) — hostage golden corpus
- E2E (subscribe → inspect → replay → export) déjà spec
- Deterministic replay + audit explainability — gate bloquant
- Post-deploy smoke tests (OPML round-trip, rule versioning, cross-tenant refusal)
