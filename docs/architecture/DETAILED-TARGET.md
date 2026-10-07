# Architecture cible détaillée

Détail explicatif de l'architecture cible, extrait de vision.md (vague 0, carte d'autorité documentaire). **Autorités en cas de conflit :** `docs/architecture/TARGET.md`, les contrats (`contracts/`) et les locks G1 (`docs/specifications/`) priment sur ce document.

## 8. Structure physique cible

```text
libre-ai/
├── ecosystem/
│   ├── objects/
│   │   ├── theses/
│   │   ├── bets/
│   │   ├── hypotheses/
│   │   ├── capabilities/
│   │   ├── experiences/
│   │   ├── decisions/
│   │   ├── evidence/
│   │   ├── learnings/
│   │   └── releases/
│   ├── schemas/
│   ├── taxonomy/
│   ├── governance/
│   └── LEGACY-MANIFEST.yaml
│
├── apps/
│   ├── website/
│   ├── practices/
│   ├── radar/
│   ├── notebook/
│   ├── sessions/
│   ├── model-policy/
│   ├── boussole/
│   ├── specifications/
│   └── missions/
│
├── packages/
│   ├── ui/
│   ├── web-runtime/
│   ├── auth-web/
│   ├── contracts/
│   ├── database/
│   ├── cache/
│   ├── observability/
│   ├── testing/
│   └── pwa/
│
├── crates/
│   ├── ecosystem-engine/
│   ├── agent-orchestrator/
│   ├── agent-harness/
│   ├── authz-biscuit/
│   ├── policy-core/
│   ├── proof/
│   ├── artifact/
│   └── cli/
│
├── contracts/
│   ├── json-schema/
│   ├── openapi/
│   ├── wit/
│   └── fixtures/
│
├── verification/
│   ├── protocols/
│   ├── golden/
│   ├── campaigns/
│   ├── benchmarks/
│   └── accepted-evidence/
│
├── distribution/
│   ├── templates/
│   │   └── bun-app/
│   ├── knowledge-packs/
│   ├── documentation/
│   └── training/
│
├── infrastructure/
│   ├── clever-cloud/
│   ├── postgres/
│   ├── redis/
│   ├── cellar/
│   └── observability/
│
├── tools/
│   ├── migration/
│   ├── quality/
│   ├── release/
│   └── projection/
│
├── package.json
├── bun.lock
├── bunfig.toml
├── tsconfig.json
├── Cargo.toml
├── Cargo.lock
├── rust-toolchain.toml
├── deny.toml
└── AGENTS.md
```

### 8.1 Workspace Bun

Le monorepo possède :

- un `package.json` racine ;
- un seul `bun.lock` ;
- des workspaces `apps/*`, `packages/*` et `distribution/templates/*` ;
- un catalogue central des versions ;
- des versions exactes ;
- `workspace:*` pour les packages locaux ;
- aucun autre lockfile JavaScript.

Les packages peuvent avoir leur propre `package.json`, jamais leur propre
lockfile.

### 8.2 Workspace Cargo

La cible possède un workspace Cargo racine unique pour toutes les crates Rust
retenues :

- resolver commun ;
- toolchain épinglé ;
- dépendances communes centralisées ;
- un seul `Cargo.lock` ;
- licences par crate ;
- profils de release explicitement configurés ;
- aucun workspace Rust imbriqué durable.

Cette cible impose de résoudre maintenant les conflits de versions et features
plutôt que de reporter une seconde consolidation.

### 8.3 Applications

Chaque application est un produit déployable et possède :

```text
apps/<product>/
├── src/server/
├── src/client/
├── src/domain/
├── src/application/
├── src/infrastructure/
├── src/contracts/
├── src/shared/
├── public/
├── migrations/
├── tests/
├── e2e/
├── scripts/
├── package.json
├── tsconfig.json
└── bunfig.toml        # seulement si une surcharge locale est nécessaire
```

Une application peut adapter cette structure lorsque son domaine est plus clair
autrement. Elle ne peut pas déplacer sa vérité métier dans `packages/ui` ou un
handler HTTP.

---

## 9. Répartition complète des responsabilités

### 9.1 Applications Bun

Chaque application possède :

- expérience utilisateur ;
- composition de capabilities ;
- routes `Bun.serve` ;
- SSR, hydratation et statique ;
- BFF et API propres au produit ;
- sessions web et cookies ;
- CSRF ;
- état et migrations PostgreSQL du produit ;
- caches propres ;
- workers applicatifs simples ;
- déploiement et runbook ;
- télémétrie minimale sans PII ;
- tests unitaires, intégration et E2E.

Une application ne possède pas :

- une capability partagée sans contrat ;
- les clés privées Biscuit d’autorité sauf si elle est explicitement l’issuer ;
- les politiques écosystème ;
- les règles de release communes ;
- les preuves indépendantes qui la certifient.

### 9.2 `packages/ui`

Possède :

- tokens DTCG et variables CSS générées ;
- composants React accessibles ;
- primitives de layout et feedback ;
- thèmes ;
- fontes locales ;
- stories ou pages de preuve ;
- contrats clavier, focus, contrastes et reduced motion.

Ne possède pas de logique produit, de fetch ou d’autorisation.

### 9.3 `packages/web-runtime`

Fournit des primitives minces au-dessus des APIs publiques Bun :

- erreurs structurées ;
- enveloppes `{ data, meta }` ;
- request IDs ;
- logs JSON et redaction ;
- timeouts et limites de corps ;
- sécurité HTTP et CSP ;
- health/readiness ;
- graceful shutdown ;
- helpers ETag, cache et compression.

Il ne devient pas un framework maison : pas de conteneur de dépendances,
d’ORM, de DSL de routes ou d’abstraction générique de contrôleur.

### 9.4 `packages/auth-web`

Possède :

- authentification web et intégration OIDC externe ;
- session opaque côté navigateur ;
- cookies `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` ;
- protection CSRF ;
- contrôles Origin/Referer ;
- adaptation vers l’autorizer Biscuit ;
- rotation de session et logout.

Il ne possède pas la cryptographie Biscuit ni les politiques d’autorisation.

### 9.5 `packages/contracts`

Contient uniquement les types TypeScript générés et adaptateurs depuis les
contrats racine. Aucun contrat inter-langage n’est écrit indépendamment dans
Rust et TypeScript.

### 9.6 `packages/database`

Fournit des primitives Bun.sql minces :

- pools ;
- transactions ;
- exécution paramétrée ;
- contexte tenant transactionnel ;
- timeouts ;
- health checks ;
- instrumentation sans données sensibles.

Il ne possède ni schéma métier, ni migrations produit, ni ORM.

### 9.7 `packages/cache`

Fournit :

- conventions de clés ;
- TTL obligatoire ;
- timeouts ;
- chiffrement lorsque requis ;
- comportement dégradé ;
- métriques.

Redis reste non autoritatif.

### 9.8 `packages/testing`

Possède :

- configuration Playwright multi-moteur ;
- fixtures HTTP, cookies et CSRF ;
- helpers d’accessibilité ;
- lancement PostgreSQL/Redis de test ;
- conventions golden et contract tests ;
- vérification de fuite réseau et PII.

### 9.9 `crates/ecosystem-engine`

Possède :

- modèle des Knowledge Objects ;
- parsing et validation ;
- IDs, versions, hashing et provenance ;
- graphe typé ;
- règles de dépendance ;
- analyse d’impact ;
- compilation de documentation, context packs et projections ;
- CLI déterministe.

Ne possède pas l’exécution agentique, la release, l’inspection indépendante ou
le rendu web.

### 9.10 Orchestration agentique — différée

Aucune `crates/agent-orchestrator` n’est créée par WP-G2-S01. La nécessité à terme pour Missions est reconnue, mais les contrats actuels ne définissent ni plan d’exécution approuvé, ni commandes de contrôle, ni consommation de budgets, ni agent-harness.

Une future crate exige un Specification Lock et un work package séparés couvrant au minimum : plan exécutable hash-bound, contrôle start/pause/resume/cancel, événements v2 causaux et idempotents, sandbox/harness, autorisation atténuée, absence d’auto-approbation et journal sans PII. Aucun code legacy d’automerge, déploiement ou provider n’est porté implicitement.

### 9.11 `crates/agent-harness`

Possède :

- sandbox ;
- exécution bornée ;
- fixtures de sécurité ;
- collecte d’évidence ;
- contrôles de secrets et PII ;
- adapters de providers.

Il ne possède pas la décision de merge, release ou déploiement.

### 9.12 `crates/authz-biscuit`

Possède :

- parsing et vérification Biscuit ;
- Ed25519 ;
- authority facts ;
- attenuation ;
- authorizer ;
- politiques deny-by-default ;
- rotation et révocation ;
- tests tenant, expiration et délégation ;
- interface WASM ou service borné vers Bun.

Le navigateur ne crée jamais de Biscuit.

### 9.13 Contexte canonique — sans crate dédiée

`notebook-core` reste l’unique autorité Rust/WASM de canonicalisation de
`ContextDocument`. Aucune crate `context` générique, CLI parallèle ou seconde
WIT n’est créée. L’ingestion hostile et la provenance de l’ancien Context Kit
restent archivées tant qu’un nouveau package approuvé ne démontre pas un
invariant distinct, un consommateur et une frontière canonique.

### 9.14 `crates/policy-core`

Possède les règles déterministes de décision et scoring qui doivent rester
opposables ou réutilisables en WASM. Le catalogue, l’API et l’UI appartiennent à
`apps/model-policy`.

### 9.15 `crates/proof`

Possède l’inspection indépendante :

- SQL, migrations et RLS ;
- structures et contrats ;
- artefacts ;
- sécurité ;
- provenance ;
- contrôles reproductibles.

Proof ne dépend pas des implémentations privées qu’il inspecte. Il consomme
leurs contrats et artefacts publics.

### 9.16 `crates/artifact`

Possède :

- release plans ;
- manifests ;
- checksums ;
- SBOM ;
- provenance ;
- signatures ;
- packaging ;
- promotion et compensation.

Le Knowledge Engine décrit les artefacts ; Artifact les construit et les
transporte ; Proof les inspecte.

### 9.17 `contracts/`

Source canonique des frontières :

- JSON Schema pour documents et événements ;
- OpenAPI pour HTTP public ;
- WIT pour WASM ;
- fixtures golden ;
- règles de compatibilité.

Les types Rust et TypeScript sont générés ou testés contre cette source.

### 9.18 `verification/`

Possède protocoles, campagnes immuables, benchmarks et évidences acceptées.
L’entité qui produit un composant ne peut pas modifier silencieusement son
protocole après observation des résultats.

### 9.19 `infrastructure/`

Possède les manifestes de déploiement, runbooks, sauvegardes, observabilité et
configurations souveraines. Aucun secret réel n’est versionné.

---

## 10. Bun/TypeScript cible

### 10.1 TypeScript

Le `tsconfig.json` racine impose au minimum :

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "allowJs": false
  }
}
```

Règles :

- `tsc --noEmit` est toujours exécuté ;
- Bun transpile mais ne remplace pas le type-checking ;
- aucun `any` non justifié ;
- aucun `@ts-ignore` ;
- `@ts-expect-error` uniquement avec justification et test ;
- `.js`, `.jsx`, `.mjs` et `.cjs` interdits comme source applicative sauf
  artefacts générés ou exception documentée.

### 10.2 Dépendances Bun

- un seul `bun.lock` ;
- `bun install --frozen-lockfile` en CI ;
- versions exactes ;
- catalogues racine pour versions communes ;
- `workspace:*` pour packages locaux ;
- linker isolé lorsque compatible ;
- `minimumReleaseAge = 259200` au minimum ;
- exclusions minimales et justifiées ;
- `trustedDependencies` limitées ;
- chaque lifecycle script autorisé et audité ;
- scan licences, advisories et transitives ;
- AGPL, SSPL, BSL et dépendances propriétaires interdites ;
- MIT, Apache-2.0, BSD, ISC privilégiées ; MPL-2.0 revue.

Cette liste gouverne les licences **entrantes** des dépendances. Les licences
**sortantes** du code, des contrats et des contenus Libre AI sont définies par
`LICENSING.md`, l’ADR-0004 et `REUSE.toml`.

Bun est MIT et lie JavaScriptCore/WebKit sous LGPL-2. L’utilisation comme
runtime installé est acceptable. La redistribution d’un exécutable Bun ou d’un
standalone compilé exige une revue de licence dédiée.

### 10.3 HTTP avec `Bun.serve`

Chaque serveur définit explicitement :

- routes et méthodes ;
- validation de toute entrée ;
- mapping d’erreurs ;
- timeouts ;
- tailles maximales ;
- arrêt gracieux ;
- `/healthz` et `/readyz` séparés ;
- request ID ;
- logs JSON ;
- redaction ;
- CSP et headers de sécurité ;
- cache headers, ETag et compression lorsque pertinents ;
- enveloppe `{ data, meta }`, sauf health, fichiers et streams ;
- pagination par curseur.

Les handlers convertissent immédiatement l’entrée HTTP vers des commandes ou
queries du domaine.

### 10.4 SSR et assets

La cible utilise les APIs publiques React DOM adaptées aux Web Streams Bun.
Elle possède explicitement :

- template HTML ;
- rendu SSR ;
- streaming lorsqu’utile ;
- hydratation ;
- asset manifest ;
- cache busting ;
- CSP nonces ;
- erreurs de rendu ;
- statique/prerender ;
- génération et service des assets ;
- Pagefind ;
- PWA/service worker lorsque requis.

Aucune API privée de Bake n’est utilisée. En l’absence de HMR public et stable
satisfaisant, le développement utilise un rebuild/reload explicite plutôt qu’une
dépendance interne.

### 10.5 Routing

`Bun.serve` possède le routing serveur. React Router n’est ajouté que pour les
parcours nécessitant une navigation client longue ou offline. Les formulaires
et mutations simples privilégient les primitives HTTP de la plateforme.

### 10.6 Validation runtime

Chaque frontière valide :

- HTTP ;
- DB ;
- Redis ;
- fichiers ;
- événements ;
- réponses externes ;
- objets générés par IA.

La bibliothèque de validation TypeScript est unique dans le monorepo. Son choix
est une décision d’implémentation du template ; l’autorité reste JSON Schema,
OpenAPI ou WIT, afin d’éviter un verrou d’architecture.

---

## 11. Rust et interopérabilité

### 11.1 Règle de conservation

Une crate est retenue si au moins un critère s’applique :

- invariants complexes déjà testés ;
- surface de sécurité ou cryptographie ;
- déterminisme opposable ;
- performance mesurée ;
- partage WASM ou natif ;
- CLI et inspection système ;
- provenance/release ;
- orchestration agentique sensible.

### 11.2 Frontières Bun ↔ Rust

Ordre de préférence :

1. **WASM/WIT** pour domaine pur, déterministe et in-process ;
2. **CLI JSON/stdin/stdout** pour tooling et opérations de build ;
3. **HTTP local ou service** pour isolation, privilèges ou scaling indépendant ;
4. **FFI/native addon** uniquement après ADR, en raison du coût de portabilité et
   de supply chain.

Aucun type Bun ou React ne traverse la frontière Rust. Les erreurs sont
sérialisables, versionnées et sans secret.

### 11.3 Parité

Toute migration Rust → TypeScript ou TypeScript → Rust dispose de fixtures
golden et de tests aller-retour. La double exécution possède une date de fin.

---

## 12. Données et infrastructure applicative

### 12.1 PostgreSQL

Bun.sql devient le client par défaut des applications migrées. Aucun ORM n’est
ajouté sans besoin démontré.

Invariants :

- migrations SQL versionnées ;
- rôles migrator, application, auth et worker séparés ;
- RLS et isolation tenant ;
- TLS ;
- transactions explicites ;
- requêtes paramétrées ;
- aucun identifiant SQL issu directement d’une entrée ;
- migrations publiées append-only ;
- advisory lock ;
- dry-run ;
- inspection Proof ;
- sauvegarde et rollback avant migration destructive.

Le contexte tenant doit être posé dans la même transaction et connexion que les
requêtes protégées. Ce comportement fait l’objet de tests réels avec le pool
Bun.sql.

SQLx n’est supprimé qu’après transfert de l’ownership et preuve de parité. Les
inspecteurs Rust peuvent continuer à utiliser SQLx si cela reste justifié.

### 12.2 Redis

Le client natif Bun est utilisé lorsque Redis est nécessaire :

- préfixe produit/environnement/tenant ;
- TTL explicite ;
- aucune donnée sensible en clair ;
- cache non autoritatif ;
- timeouts ;
- comportement dégradé ;
- tests d’indisponibilité.

### 12.3 Cellar

Le client S3 Bun peut être utilisé avec :

- endpoint Cellar explicite ;
- aucun endpoint AWS ;
- `us-east-1` uniquement comme convention SDK ;
- données en France/UE ;
- chiffrement ;
- rétention et suppression ;
- URLs signées courtes ;
- aucune donnée personnelle publique par défaut.

---

## 13. Authentification et autorisation

### 13.1 Trois frontières distinctes

1. **Authentification externe** — OIDC peut imposer des JWT à son interface.
2. **Session navigateur** — cookie opaque `HttpOnly`, jamais un token lisible par
   JavaScript.
3. **Autorisation interne** — Biscuit attenué, vérifié localement et transmis en
   bearer entre frontières de service lorsque nécessaire.

Cette séparation évite de placer un Biscuit durable dans le stockage navigateur
et réduit l’exposition CSRF. Une exception utilisant directement Biscuit en
cookie exige un ADR et des tests renforcés.

### 13.2 Biscuit

- authority signée Ed25519 ;
- `user` et `tenant` obligatoires ;
- expiration dans le token ;
- attenuation avant délégation ;
- authorizer enrichi avec temps, ressource, opération et tenant ;
- dernière policy `deny if true` ;
- rotation avec chevauchement de clés ;
- révocation par root block ID ;
- cache de révocation court ;
- aucun email, PII ou secret dans le token ;
- aucun token dans les logs ;
- tests négatifs tenant, attenuation, expiration et révocation.

### 13.3 Web

- cookie `HttpOnly; Secure; SameSite=Strict; Path=/` ;
- CSRF sur toute mutation ;
- Origin/Referer lorsque pertinent ;
- aucune auth dans localStorage/sessionStorage ;
- aucune clé dans le bundle ;
- secrets injectés au runtime ;
- séparation authentification/autorisation.

---

## 14. Executable Knowledge Engine et chaîne agentique

### 14.1 Knowledge Engine

Le moteur Rust :

- parse et valide les Knowledge Objects ;
- construit le graphe ;
- calcule les impacts ;
- compile documentation et context packs ;
- génère les projections ;
- produit des plans descriptifs ;
- ne possède ni secrets produit ni droits de merge.

### 14.2 Agent Orchestrator

L’orchestrateur n’est pas une fondation G2 implémentable avec les autorités actuelles. Missions conserve son workflow humain et ses fixtures de protocole, mais aucune simulation Rust ne devient une seconde autorité d’état. Un moteur ultérieur est conditionné par un RFC architecture/sécurité, les contrats d’exécution et de contrôle, puis un package distinct incluant le harness.

### 14.3 Proof

Proof exécute des contrôles indépendants sur contrats, DB, UI, artefacts et
sécurité. Il ne produit pas l’objet qu’il inspecte.

### 14.4 Artifact

Artifact construit, signe, atteste et distribue. Il ne décide pas seul qu’un
produit peut être publié.

### 14.5 Website

Website rend les projections publiques. Le contenu vient des Knowledge Objects ;
les composants de rendu appartiennent à `apps/website`.

---

## 16. Tests et quality gates

### 16.1 Unitaires

- domaine pur ;
- validation ;
- erreurs ;
- autorisation ;
- sérialisation ;
- cas limites.

### 16.2 Intégration Bun

- routes `Bun.serve` ;
- cookies et CSRF ;
- PostgreSQL réel ;
- RLS ;
- Redis ;
- transactions ;
- timeouts et erreurs ;
- graceful shutdown.

### 16.3 Contrats

- Rust/TypeScript pendant transition ;
- JSON Schema/OpenAPI/WIT ;
- fixtures golden ;
- compatibilité publique ;
- round-trip WASM ou CLI.

### 16.4 Playwright

- Chromium ;
- Firefox ;
- WebKit ;
- viewport mobile ;
- clavier et focus ;
- ARIA ;
- reduced motion ;
- CSP ;
- cookies HttpOnly ;
- absence de fuite réseau ;
- PWA/offline lorsque requis ;
- parcours critiques.

`Bun.WebView` reste expérimental et ne remplace jamais Playwright.

### 16.5 Smoke production

- build release ;
- démarrage réel ;
- health/readiness ;
- PostgreSQL/Redis ;
- arrêt gracieux ;
- artefact Clever Cloud ;
- rollback.

### 16.6 Commandes canoniques

```text
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run test:integration
bun run build
bunx playwright test
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
cargo deny check
```

Les scripts racine déterminent les tâches affectées, mais une incertitude dans
le graphe déclenche davantage de tests, jamais moins.

---

## 17. Release, versionnement et distribution

### 17.1 Recommandation

Le monorepo n’a pas une version produit globale.

- applications : SemVer indépendante ;
- packages TypeScript : SemVer indépendante ;
- crates Rust : SemVer indépendante ;
- contrats : version majeure explicite ;
- campagnes de benchmark : identifiant immuable daté ;
- Knowledge Objects : identité stable + version + révision Git.

Tags namespacés :

```text
app/website/v1.0.0
app/radar/v1.0.0
pkg/ui/v1.2.0
crate/proof/v0.3.0
contract/curated-item/v2.0.0
```

Artifact produit le release plan et les manifestes. Proof inspecte les artefacts.

### 17.2 Registries

Les registries européennes ou auto-hébergées sont les canaux primaires. npm et
crates.io peuvent être des miroirs publics de distribution, jamais l’unique
lieu de conservation.

### 17.3 Projections

Chaque projection (documentation, SDK, context pack, catalogue) contient :

```yaml
schema_version: libre-ai.projection.v1
source_repository: libre-ai/libre-ai
source_revision: <sha>
source_path: <path>
compiler_version: <version>
content_digest: sha256:<digest>
```

Toute modification manuelle d’une projection échoue à sa CI.

---

## 18. Nommage cible

La reconstruction supprime les noms techniques hérités lorsqu’ils ne sont plus
pertinents.

### Conventions

- packages TypeScript : `@libre-ai/<name>` ;
- crates : `libre-ai-<name>` ;
- Knowledge Objects : `urn:libre-ai:<kind>:<name>` ;
- applications : noms courts orientés expérience ;
- contrats : nom métier + version ;
- aucun nouvel identifiant `rumble-*`, `gear-*`, `portal-*`, `wrench-*` ou
  `bolt-*`.

### Renommages internes recommandés

| Ancien nom                      | Cible                                                           |
| ------------------------------- | --------------------------------------------------------------- |
| `bolt-cosmatic`                 | `libre-ai-agent-orchestrator`                                   |
| `bolt-harness`                  | `libre-ai-agent-harness`                                        |
| `portal-core` / Client Kit core | `@libre-ai/web-runtime` ou crate native explicitement justifiée |
| Portal UI                       | `@libre-ai/ui`                                                  |
| Wrench inspect                  | `libre-ai-proof`                                                |
| Gear loader/memory              | `libre-ai-context`                                              |
| Gear cable/depot                | `libre-ai-artifact`                                             |
| Rumble product crates           | nom de domaine ou produit explicite                             |

Les noms publics des expériences peuvent rester pour préserver leur lisibilité.
Les anciens packages ne reçoivent pas de couche de compatibilité par défaut,
faute d’adoption externe démontrée. Une dépendance externe observée peut imposer
une release de migration bornée.

---

