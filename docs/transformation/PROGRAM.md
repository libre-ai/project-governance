# Programme Big Bang — détail historique d'exécution

Extrait de vision.md (vague 0). **Séquencement supersédé :** l'ordre d'exécution post-G2 fait autorité dans `docs/transformation/EXECUTION-SEQUENCING.md` (ADR-0009) ; la cartographie des repositories fait autorité dans `REPOSITORY-MAP.md`. Ce document conserve le programme détaillé de la refondation comme trace d'exécution.

## 19. Gouvernance remise à plat

### 19.1 Ownership

- `CODEOWNERS` par application, package, crate, contrat et infrastructure ;
- deux approbations pour schémas, auth, supply chain et migrations destructives ;
- propriétaire unique de décision pour chaque work package ;
- aucun agent approbateur de sa propre sortie.

### 19.2 Décisions

- RFC pour capability ou changement transversal ;
- ADR pour architecture et exceptions ;
- décision datée, propriétaire et critères de révision ;
- ADR remplacée marquée `superseded`, jamais silencieusement réécrite.

### 19.3 Dépendances

```text
apps → packages → contracts
apps → adaptateurs explicites → crates
packages ↛ apps
crates ↛ apps TypeScript
proof → contrats et artefacts publics uniquement
ecosystem-engine ↛ logique produit
agent-orchestrator ↛ UI produit, DB partagée et moteur agentique généraliste
```

Ces règles sont testées automatiquement.

### 19.4 Merge

- branches courtes ;
- merge queue ;
- CI affectée + tests consommateurs ;
- suite complète avant promotion ;
- aucun push direct sur `main` ;
- migrations produit séparées ;
- limite de travaux en cours alignée sur la capacité humaine de revue.

### 19.5 Sécurité agentique

- permissions minimales ;
- secrets à durée courte ;
- worktrees isolés ;
- budget de fichiers, temps et tokens ;
- journal sans PII ;
- sandbox réseau ;
- validation humaine des merges, releases, migrations et déploiements.

---

## 20. Cartographie des repositories actuels vers la cible

| Repository actuel     | Cible                                                | Portage principal                                 | Rust attendu                                    |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `agent-factory`       | futur package `agent-orchestrator` + `agent-harness` | archive/RFC uniquement en G2 ; aucune reprise S01 | différé jusqu’au lock dédié                     |
| `agent-board`         | `apps/missions`                                      | Bun/React greenfield                              | seulement si moteur d’état le justifie          |
| `ai-practices`        | `apps/practices`                                     | Bun/React/Bun.sql                                 | corpus/scoring opposable à évaluer              |
| `artifact-supply`     | `crates/artifact`                                    | nettoyage et renommage                            | oui                                             |
| `benchmarks`          | `verification/benchmarks` et `campaigns`             | import sélectif des campagnes                     | tooling selon besoin                            |
| `boussole-politique`  | `apps/boussole`                                      | Bun/React local-first                             | scoring déterministe conservé                   |
| `client-kit`          | `packages/*`, `distribution/templates/bun-app`       | reconstruction TS/React                           | bindings natifs seulement si consommés          |
| `context-kit`         | archive externe uniquement                           | aucune reprise sans nouveau package approuvé      | non dans G2                                     |
| `design-system`       | `packages/ui`                                        | tokens et composants React                        | non par défaut                                  |
| `dioxus-app-template` | archive externe uniquement                           | remplacé par `bun-app`, aucune cible de reprise   | non                                             |
| `feed-radar`          | `apps/radar`                                         | Bun fullstack                                     | parsing/règles déterministes à conserver        |
| `gear`                | archive externe uniquement                           | aucun code importé                                | non, responsabilités redistribuées par contrats |
| `notebook`            | `apps/notebook`                                      | greenfield Bun/React local-first                  | chiffrement/index/WASM si justifié              |
| `policy`              | `apps/model-policy`, `crates/policy-core`            | Bun UI/API + cœur WASM                            | oui pour policy/scoring                         |
| `proof-kit`           | `crates/proof`, `verification/`                      | suppression du lab Dioxus                         | oui                                             |
| `sessions`            | `apps/sessions`                                      | Bun SSR/WebSocket/BFF                             | authz/RAG exact-evidence à évaluer              |
| `spec-studio`         | `apps/specifications`                                | Bun/React greenfield                              | seulement pour hashing/invariants prouvés       |
| `website`             | `apps/website`                                       | Bun/React SSR + statique                          | non par défaut                                  |

`boussole-politique` reste dans Libre AI comme démonstrateur exigeant de
calcul local, explicabilité, provenance et neutralité méthodologique. Sa présence
met à l’épreuve la capacité de la stack cible à traiter un domaine sensible sans
profilage ni autorité opaque.

---

## 21. Chemin critique Big Bang

L’ordre n’est plus celui de migrations produit successives. Quatre workstreams
construisent la cible en parallèle dans le monorepo, avec intégration continue.

### Workstream A — Canonical Core

- gouvernance et Knowledge Objects ;
- contrats racine ;
- Knowledge Engine ;
- règles de dépendance ;
- projection déterministe ;
- toolchains et workspaces ;
- CI, licences et provenance.

### Workstream B — Web Platform

- `packages/ui` ;
- `packages/web-runtime` ;
- `packages/auth-web` ;
- `packages/database` et `cache` ;
- `packages/testing` et `pwa` ;
- template Bun ;
- SSR, assets, CSP et Playwright ;
- déploiement Clever Cloud.

### Workstream C — Specialized Rust

- Agent Orchestrator et Harness — différés jusqu’à un Specification Lock dédié ;
- Biscuit ;
- canonicalisation ContextDocument dans Notebook Core uniquement ;
- Policy Core ;
- Proof ;
- Artifact ;
- WASM/WIT et CLIs ;
- suppression des dépendances Dioxus/Axum/SQLx non justifiées.

### Workstream D — Experiences

Les applications `website`, `practices`, `radar`, `notebook`, `sessions`,
`model-policy`, `boussole`, `specifications` et `missions` sont reconstruites
directement dans `apps/`.

Le Website sert d’intégrateur précoce de SSR/statique. Model Policy valide
WASM. Radar valide Bun.sql/RLS. Sessions valide auth, WebSockets et Redis. Ces
rôles déterminent les priorités internes, pas des cutovers séparés.

### Dépendances du chemin critique

```text
Architecture + contrats
        ↓
Canonical Core ─────┬──── Web Platform
                    ├──── Specialized Rust
                    └──── Experiences
                              ↓
                    Intégration globale
                              ↓
                    Qualification globale
                              ↓
                       Cutover unique
```

---

## 22. Programme Big Bang

### Vague 0 — Global Freeze

#### Objectif

Arrêter l’ancien écosystème et en conserver une référence consultable, sans
chercher à le remettre au propre pour le maintenir.

#### Actions

1. inventorier branches, worktrees et modifications locales ;
2. sauvegarder tout travail utilisateur non commité ;
3. scanner secrets et PII ;
4. enregistrer SHA, licence, releases, données et contrats utiles ;
5. exporter issues, assets, Pages et paramètres nécessaires ;
6. produire `LEGACY-MANIFEST.yaml` ;
7. marquer les repositories historiques comme archives ;
8. interdire toute nouvelle fonctionnalité ou correction de stack dans
   l’ancien écosystème.

Il n’est pas nécessaire de rendre chaque ancienne CI verte. Les échecs connus
sont enregistrés ; seuls les éléments sélectionnés pour la cible deviennent des
exigences.

#### Gate 0 — Legacy Frozen

- aucun travail utilisateur perdu ;
- références finales connues ;
- données et obligations légales identifiées ;
- anciens repositories considérés non canoniques ;
- monorepo déclaré unique destination de tout nouveau travail.

### Vague 1 — Specification Lock

#### Objectif

Spécifier la cible assez précisément pour permettre les workstreams parallèles
sans rediscuter les frontières.

#### Livrables obligatoires

- ADR Bun Fullstack / Rust Specialized ;
- architecture physique et règles de dépendance ;
- ownership complet ;
- modèle Knowledge Object ;
- contrats HTTP, document, événement et WASM ;
- conventions DB/RLS, auth, logs et erreurs ;
- noms définitifs ;
- versions et release model ;
- architecture du template ;
- plans de chaque application ;
- matrice de souveraineté ;
- work packages et graphe de dépendances.

#### Gate 1 — Target Locked

- aucun domaine sans propriétaire ;
- aucune frontière Rust/TS implicite ;
- aucun contrat critique sans source canonique ;
- aucune app sans modèle de données, auth, tests et déploiement ;
- aucune ancienne compatibilité requise ;
- questions restantes limitées à l’implémentation locale, pas à l’architecture.

### Vague 2 — Foundation Build

#### Objectif

Créer l’ossature finale du monorepo et les fondations communes.

#### Actions

- commit racine propre ;
- workspace Bun et `bun.lock` unique ;
- workspace Cargo unique ;
- toolchains épinglées ;
- Biome, TypeScript, Ajv et Playwright ;
- Knowledge Engine minimal ;
- contrats et générateurs ;
- packages web ;
- crates spécialisées ;
- template Bun ;
- CI, sécurité, licences et Clever smoke ;
- première projection déterministe.

#### Gate 2 — Foundations Operational

```text
Bun.serve → React SSR → hydration → API → PostgreSQL/RLS
→ Biscuit → Rust/WASM → Playwright 3 moteurs
→ Artifact → Proof → projection → Clever smoke
```

Cette chaîne fonctionne depuis une checkout vierge.

### Vague 3 — Parallel Reconstruction

#### Objectif

Construire toutes les applications et capacités cibles en parallèle, sans
porter les anciennes structures.

#### Règles

- workstreams isolés par chemins et contrats ;
- branches courtes et intégration fréquente ;
- pas de branche de migration longue par produit ;
- pas de compatibilité avec les anciens packages ;
- comportements historiques repris uniquement s’ils figurent dans la spec ;
- fixtures de parité limitées aux invariants sélectionnés ;
- aucune dépendance Dioxus dans la cible ;
- Axum, Tokio et SQLx uniquement dans une crate Rust explicitement propriétaire.

#### Gate 3 — Target Complete

- toutes les apps cibles compilent ;
- parcours critiques E2E présents ;
- workspaces sans ancien nom ou lockfile ;
- contrats et migrations cohérents ;
- Knowledge Graph complet ;
- projections et artefacts reproductibles ;
- aucune double implémentation sans suppression planifiée avant lancement.

### Vague 4 — Global Integration and Hardening

- intégration inter-applications ;
- migrations de données sélectionnées ;
- sécurité, Biscuit, CSRF et tenancy ;
- accessibilité ;
- performance et charge ;
- sauvegarde, restauration et rollback ;
- observabilité ;
- supply chain ;
- déploiement de l’ensemble en environnement cible ;
- répétition générale du cutover.

#### Gate 4 — Release Candidate

Une release candidate globale peut être reconstruite, déployée, testée et
rollbackée sans dépendre d’un ancien repository ou service.

### Vague 5 — Single Cutover

- publication du monorepo canonique ;
- bascule des domaines, DNS et artefacts ;
- activation des publications générées ; les repositories produits s'activent
  par décision propriétaire (ADR-0008) ;
- archivage définitif des anciens repositories ;
- publication des limites et fonctionnalités non reprises ;
- surveillance renforcée ;
- rollback global si une gate critique échoue.

### Vague 6 — Distribution and Federation

- registry européen primaire ;
- miroirs GitHub, npm et crates.io lorsque justifiés ;
- documentation, SDK, MCP et knowledge packs ;
- formations, articles et conférences ;
- reproduction indépendante ;
- contributions externes ;
- publication des hypothèses réfutées.

---

## 23. Protocole d’un workstream de reconstruction

1. lire la spécification cible et les archives pertinentes ;
2. lister les comportements historiques candidats ;
3. accepter explicitement ceux qui appartiennent à la cible ;
4. définir contrats, données, autorisation et refus ;
5. créer le module directement dans son chemin définitif ;
6. implémenter avec la stack cible ;
7. ajouter tests unitaires, intégration, contrats et E2E ;
8. produire évidence et provenance ;
9. intégrer rapidement sur la branche canonique ;
10. supprimer toute solution temporaire avant la release candidate.

La définition de fini porte sur la spécification cible, pas sur une parité
générale avec l’ancien produit.

---

## 24. Template Bun canonique

`distribution/templates/bun-app` doit fournir :

### Runtime

- Bun épinglé et vérifié ;
- `Bun.serve` direct ;
- React 19 SSR/hydratation ;
- routes API ;
- graceful shutdown ;
- health/readiness ;
- logs JSON ;
- CSP et headers ;
- request IDs ;
- limites et timeouts.

### Frontend

- TypeScript strict ;
- `@libre-ai/ui` ;
- tokens et fontes locales ;
- focus, clavier et reduced motion ;
- Tailwind v4 optionnel mais préconfiguré si retenu ;
- PWA activable sans fork d’architecture ;
- aucun framework supplémentaire.

### Data

- Bun.sql ;
- transaction tenant/RLS ;
- migrator séparé ;
- Redis dégradable ;
- Cellar endpoint explicite ;
- fixtures de test.

### Sécurité

- session opaque HttpOnly ;
- CSRF ;
- Origin/Referer ;
- Biscuit adapter ;
- tests négatifs tenant/expiration/révocation ;
- secrets runtime ;
- aucune PII dans les logs.

### Tests

- Bun unit/integration ;
- contrats ;
- Playwright Chromium/Firefox/WebKit/mobile ;
- accessibilité ;
- CSP ;
- offline optionnel ;
- production smoke.

### Supply chain

- `bun.lock` unique ;
- versions exactes ;
- linker isolé ;
- minimum release age ;
- trusted dependencies ;
- licences/advisories ;
- SBOM ;
- checksum ;
- provenance ;
- Clever deployment.

Le template Dioxus n’entre pas dans le nouveau monorepo. Son repository est
archivé lors du freeze global ; aucun consommateur historique ne bloque la cible.

---

## 25. Règles Agent Factory à modifier

### Sources doctrinales

- `agent-factory/engine/AGENTS.md` ;
- `agent-factory/engine/CLAUDE.md` ;
- `engine/content/domains/stack-authority.md` ;
- `engine/content/domains/web-boundary.md` ;
- `engine/content/domains/testing-strategy.md` ;
- `engine/content/domains/mobile-webview-rust-core.md` ;
- ADR-0033 Rust-core doctrine hardening ;
- descriptions embarquées dans `engine/crates/core/src/library.rs` ;
- détection et diagnostics dans `engine/crates/core/src/stack.rs` ;
- tests CLI et stack associés ;
- templates CI et init.

### Inversions requises

| Règle actuelle                          | Nouvelle règle                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Rust possède toute logique durable      | Bun/TS possède la stack web durable ; Rust possède les composants spécialisés justifiés  |
| Bun est une commodité web               | Bun est la plateforme applicative web par défaut                                         |
| TypeScript ne possède pas le backend    | TypeScript possède BFF, API web, sessions, DB et workers applicatifs des produits migrés |
| `Bun.serve` seulement local/SSR jetable | `Bun.serve` est la frontière HTTP/fullstack par défaut                                   |
| contrat nécessairement Rust-owned       | contrat canonique dans `contracts/`, types Rust/TS générés                               |
| Axum/Tokio/SQLx standards par défaut    | standards uniquement pour services Rust retenus                                          |
| Rust-first test stack                   | stratégie duale Bun/TS + Rust spécialisé + Playwright                                    |
| Dioxus/PWA candidat par défaut          | React/Bun web par défaut ; Dioxus deprecated pour web                                    |
| Rust/WASM UI                            | Rust/WASM core possible derrière UI React                                                |
| durable shell migre en Rust             | orchestration durable via Bun task runner ou CLI Rust selon ownership                    |

### Gates nouvelles

- un seul `bun.lock` ;
- aucune source JS ;
- aucun framework web interdit ;
- Bun version check ;
- TypeScript strict ;
- Dioxus interdit dans une app déclarée migrée ;
- Axum/SQLx interdits sans owner Rust actif ;
- contrat canonique généré ;
- Playwright multi-moteur ;
- Clever smoke ;
- licence et trusted dependencies ;
- deadline sur toute double implémentation ;
- détection des anciens noms.

ADR-0033 devient `superseded` par le nouvel ADR Bun Fullstack / Rust Specialized.

---

## 26. Incrément de préparation immédiat

Créer immédiatement le nouveau repository canonique, isolé des dépôts
historiques, avec :

1. `vision.md` ;
2. ADR Bun Fullstack / Rust Specialized / Big Bang ;
3. plan global et workstreams ;
4. `LEGACY-MANIFEST.yaml` initial ;
5. structure racine définitive ;
6. manifests Bun, Cargo, TypeScript et Biome ;
7. toolchain Bun épinglée avec version, commit et checksums ;
8. schéma minimal Knowledge Object ;
9. conventions d’architecture et de nommage ;
10. cartographie des anciens repositories ;
11. règles Agent Factory cibles ;
12. spécification du template Bun ;
13. CI de bootstrap sans application.

Dès que la Vague 0 est validée, ce repository devient l’unique destination de
développement. La réversibilité concerne la restauration des archives, pas le
maintien d’une architecture parallèle.

---

## 27. Challenges techniques encore ouverts

### 27.1 Bun stable Rust non disponible au checkpoint

La cible est décidée, mais la dernière stable observée reste `1.3.14`. Le canary
`1.4.0-canary.1+57f349f63` doit être considéré pré-release.

**Décision recommandée :** construire la fondation et qualifier le canary, mais
ne pas effectuer de cutover production sans artefact reproductible et accepté.

### 27.2 Canary roulant

Le tag GitHub `canary` remplace ses assets. Un checksum seul garantit
l’intégrité, pas la disponibilité future.

**À résoudre :** conservation légale du binaire exact, image par digest ou build
reproductible depuis le commit.

### 27.3 Clever choisit la dernière version Bun

Le support natif actuel ne garantit pas le pin exact.

**Décision recommandée :** ne l’utiliser que lorsqu’il expose la version requise ;
sinon binaire vérifié ou OCI maîtrisée.

### 27.4 Plateforme sans framework

Ne pas utiliser Next/Vite/Hono réduit les dépendances, mais Libre AI doit alors
posséder explicitement SSR, assets, erreurs, sécurité, routing et DX.

**Garde-fou :** `web-runtime` reste mince et mesuré. Si son périmètre devient un
framework généraliste, la décision doit être rechallengée sur preuve de coût.

### 27.5 Biscuit et session navigateur

Biscuit est adapté au bearer inter-service ; le cookie navigateur est exposé au
CSRF même s’il est HttpOnly.

**Recommandation :** cookie opaque pour la session, Biscuit interne attenué.
Tester toute exception.

### 27.6 Bun.sql et RLS

L’isolation dépend du maintien du contexte tenant sur la connexion et la
transaction correctes.

**Gate :** tests PostgreSQL réels, concurrence, rollback et pool avant migration
de Feed Radar ou Sessions.

### 27.7 Un seul workspace Cargo

Cette cible force l’unification de versions/features. C’est volontaire, mais la
CI devra surveiller temps de build et feature leakage.

**Gate :** architecture tests, `cargo tree`, builds WASM et natifs.

### 27.8 Desktop et mobile

Bun/React remplace le web, pas les clients natifs.

**Décision :** aucun engagement desktop/mobile via Bun. Les cores Rust/WASM
restent disponibles ; une UI native future reçoit ses bindings depuis les mêmes
contrats.

### 27.9 Repartir sans historique

La base sera plus propre, mais `git blame` ne racontera pas l’origine du code
porté.

**Réponse :** archives, `LEGACY-MANIFEST`, provenance par composant et référence
au SHA source dans les commits de portage.

### 27.10 Capacité humaine de revue

La nouvelle stack et la refonte des noms peuvent produire plus de changements
que la gouvernance ne peut absorber.

**Réponse :** workstreams par ownership, branches courtes, intégrateurs dédiés,
merge queue, limites de modifications simultanées sur les contrats et priorité
aux gates automatiques déterministes.

### 27.11 Risque propre au Big Bang

L’absence de compatibilité accélère la construction mais concentre le risque sur
l’intégration finale.

**Réponse :** intégration continue dès la fondation, environnement cible complet,
release candidate globale et répétition du cutover. Le Big Bang concerne la
rupture avec l’ancien, pas un assemblage tardif des nouveaux composants.

---

## 29. Livrables suivants

1. `ADR-0001-bun-fullstack-rust-specialized.md` ;
2. `LEGACY-MANIFEST.yaml` ;
3. `TARGET-ARCHITECTURE.md` ;
4. `OBJECT-MODEL.md` ;
5. `REPOSITORY-MAP.md` ;
6. `MIGRATION-ORDER.md` ;
7. `BUN-APP-TEMPLATE.md` ;
8. `AGENT-FACTORY-RULE-MIGRATION.md` ;
9. `SOVEREIGNTY-MATRIX.md` ;
10. `AGENT-PROTOCOL.md` ;
11. `TRANSFORMATION.md`.

---

