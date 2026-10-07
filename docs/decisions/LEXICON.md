# LEXICON — carte de noms cible et glossaire produit (Phase 0, Lexicon Lock)

- **Statut :** signé — signature propriétaire prononcée le 2026-07-20, journalisée dans [`distribution/evidence/gate-acceptance-log.md`](../../distribution/evidence/gate-acceptance-log.md) (PR #130, merge = signature). Cette carte est en vigueur : elle est l'autorité unique des noms cibles, et tout nom hors carte est un défaut bloquant (garde-fou classe 4).
- **Date :** 2026-07-20. **Amendé :** 2026-07-28 par ADR-0020 (activation générale), 2026-07-30 (§9, carte des couches complétée), 2026-08-18 (§10, harness créé — domaine F chantier A et §11, neuvième produit), 2026-09-10 (§12, dixième produit candidat), même procédure que la signature — production → revue K4 → arrêt dur → merge = signature propriétaire. Le §8 porte le premier amendement ; les corrections ciblées dans le corps sont marquées « (ADR-0020) ».
- **Arbitrage :** accompli — la signature propriétaire de cette carte est l'acte de clôture de la Phase 0 (Lexicon Lock). Procédure suivie : production solo → revue K4 (relecteurs indépendants : cohérence, collisions, doctrine) → arrêt dur → signature propriétaire → renommage et écriture des noms cibles comme acquis.
- **Portée :** tous les noms cibles de la constellation — repositories, produits, briques, packages npm, crates, familles — et le glossaire produit. Le glossaire de **méthode** (socle, control plane, satellite, vague, gate, WP, traceur…) est déjà fixé et ne relève pas de cette carte.
- **Règle d'anti-hallucination :** tant que cette carte n'est pas signée, aucun agent n'écrit un nom cible comme acquis dans un artefact ; après signature, tout nom hors carte est un défaut bloquant (garde-fou classe 4).
- **Place documentaire :** après signature, cette carte devient l'autorité unique du sujet « noms cibles et glossaire produit » et s'inscrit à ce titre dans la carte d'autorité (`docs/README.md`) — la même pull request porte cette inscription. Elle ne concurrence ni le registre des invariants ni l'inventaire : elle fixe des noms, pas la doctrine ni la topologie.

## 1. Repositories GitHub — carte legacy → cible

Doctrine applicable : les URLs des produits historiques sont **réservées** comme emplacements des futurs repositories produits (I-04, ADR-0008 §2) ; elles ne sont **jamais renommées**. Les noms d'outillage hérités ne sont **jamais réutilisés** (I-04).

### 1.1 Homes produits et application (conservés, gelés jusqu'à activation)

| Legacy (repo)        | Cible (repo)                                                                                      | Produit / application   | Couche | Activation                                   |
| -------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- | ------ | -------------------------------------------- |
| `feed-radar`         | `feed-radar` (inchangé, réservé)                                                                  | Radar                   | 1      | vague 4b                                     |
| `notebook`           | `notebook` (inchangé, réservé)                                                                    | Notebook                | 1      | vague 4a                                     |
| `ai-practices`       | `ai-practices` (inchangé, réservé)                                                                | AI Practices            | 1      | vague 4b                                     |
| `sessions`           | `sessions` (inchangé, réservé)                                                                    | Sessions                | 1      | vague 4b                                     |
| `boussole-politique` | `boussole-politique` (inchangé)                                                                   | Boussole Politique      | 1      | vague 4b                                     |
| `spec-studio`        | `spec-studio` (inchangé, réservé)                                                                 | Spec Studio             | 1      | vague 4b                                     |
| `policy`             | `policy` (inchangé, réservé)                                                                      | Model Policy            | 1      | vague 4b (public après re-audit secrets/PII) |
| `agent-board`        | `missions` (ADR-0020 : la carte rattrape l'arbitrage propriétaire du 2026-07-23, ADR-0008 amendé) | Missions (app couche 2) | 2      | activation générale                          |

Sept produits (Radar, Notebook, AI Practices, Sessions, Boussole Politique, Spec Studio, Model Policy) ; `agent-board`/Missions est l'**application** de la couche 2, pas un huitième produit (ADR-0009 §2, inventaire).

### 1.2 Outillage retiré — noms morts, jamais réutilisés

`gear`, `context-kit`, `client-kit`, `proof-kit`, `artifact-supply`, `design-system`, `agent-factory`, `benchmarks`, `dioxus-app-template` — et `website`, dont l'activation comme repo réel est **régularisée nominativement** par ADR-0020 §2.4 (application du portefeuille qui sert des projections) : le nom sort de cette liste pour ce seul usage. Les responsabilités des autres vivent dans la constellation ; aucun repository, package ou crate futur ne reprend ces noms (I-04).

## 2. Briques et satellites — noms canoniques par couche

Convention transverse (fixée par cette carte) :

- **Repo satellite** : nom de brique nu sous l'organisation (`libre-ai/<brique>`).
- **Package npm** : `@libre-ai/<brique>` (exceptions listées, conservées pour exactitude de contenu).
- **Crate Rust** : `libre-ai-<brique>` (six des sept crates du workspace sont conformes — correction ADR-0020 : le septième, `policy-core`, né le 2026-07-23 sans le préfixe, est conservé tel quel comme **quatrième exception** du §5 ; il rejoint le repo produit `policy`, pas un satellite).

### 2.1 Couche 4 — atelier applicatif (vague 1)

| Brique    | Repo satellite cible | Package/crate cible                        | Source socle actuelle                                | Note                                                                                                                                                                                                                                     |
| --------- | -------------------- | ------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui`      | `libre-ai/ui`        | `@libre-ai/ui`                             | `packages/design-system` (`@libre-ai/design-system`) | **Renommage requis à la vague 1** : `design-system` est un nom d'outillage retiré (§1.2) ; le package socle actuel le réutilise — dérive latente vis-à-vis d'I-04, corrigée par le renommage `@libre-ai/design-system` → `@libre-ai/ui`. |
| `auth`    | `libre-ai/auth`      | `@libre-ai/auth-web` (conservé)            | `packages/auth-web`                                  | Le package nomme sa surface exacte (auth **web**, WP-G2-I01) ; le repo satellite porte la famille `auth`, les surfaces futures s'y ajoutent en `@libre-ai/auth-*`.                                                                       |
| `sdk-ts`  | `libre-ai/sdk-ts`    | `@libre-ai/contracts` (conservé)           | `packages/contracts`                                 | Le package est la projection SDK TypeScript des contrats (WP-G2-C01) ; son nom décrit son contenu et il précède cette carte.                                                                                                             |
| `sdk-rs`  | `libre-ai/sdk-rs`    | crate `libre-ai-contract-types` (conservé) | `crates/contract-types`                              | Différé (ADR-0009 §8, faute de consommateur) ; nommé ici pour que rien ne s'invente à l'activation.                                                                                                                                      |
| `starter` | `libre-ai/starter`   | —                                          | dérivé de la première app                            | Différé ; nommé ici.                                                                                                                                                                                                                     |

### 2.2 Couche 3 — infrastructure de confiance (vague 2)

| Brique       | Repo satellite cible  | Package/crate cible                                    | Source socle actuelle                                                                       | Note                                                                                                                                       |
| ------------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `envelope`   | `libre-ai/envelope`   | `@libre-ai/envelope` · `libre-ai-envelope`             | à naître (vague 2)                                                                          | Doctrine anti-injection (K3).                                                                                                              |
| `provenance` | `libre-ai/provenance` | `@libre-ai/provenance` · `libre-ai-provenance`         | à naître (vague 2)                                                                          | Porte `agent-contributor-lineage.v1`.                                                                                                      |
| `proof`      | `libre-ai/proof`      | `@libre-ai/proof` · `libre-ai-proof`                   | à naître (vague 2 ; autorités `evidence-report.v1`, `harness-attestation.v1` déjà au socle) |                                                                                                                                            |
| `artifacts`  | `libre-ai/artifacts`  | `@libre-ai/artifacts` · `libre-ai-artifact` (conservé) | `crates/artifact`                                                                           | Le crate existant garde son singulier (précède cette carte) ; le repo satellite prend le pluriel doctrinal (ADR-0008 annexe, ADR-0009 §2). |
| `memory`     | `libre-ai/memory`     | `@libre-ai/memory` · `libre-ai-memory`                 | à naître (vague 3, livrée avec le lock orchestrateur)                                       |                                                                                                                                            |

### 2.3 Couche 2 — la méthode incarnée : famille Polaris (vague 3)

Le nom de la couche 2 productisée est **Polaris** (ADR-0011 D2, collision de nom connue et acceptée, traitée par la posture de marque option C).

| Brique         | Repo satellite cible      | Package/crate cible                      | Source socle actuelle            | Note                                                                     |
| -------------- | ------------------------- | ---------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `orchestrator` | `libre-ai/orchestrator`   | `libre-ai-agent-orchestrator` (conservé) | `crates/agent-orchestrator`      | Crate existant conforme à la convention (préfixe `agent-` désambiguïse). |
| `harness`      | `libre-ai/harness`        | `libre-ai-harness`                       | à naître (vague 3, sous le lock) |                                                                          |
| Missions (app) | home `agent-board` (§1.1) | chemin canonique `apps/missions`         | à naître (vague 3)               | Application humaine de la couche 2 — pas un huitième produit.            |

### 2.4 Transverse — distribution

| Brique       | Repo satellite cible  | Package/crate cible    | Note            |
| ------------ | --------------------- | ---------------------- | --------------- |
| `mcp-server` | `libre-ai/mcp-server` | `@libre-ai/mcp-server` | À l'activation. |
| `corpus`     | `libre-ai/corpus`     | —                      | À l'activation. |
| `docs`       | `libre-ai/docs`       | —                      | À l'activation. |

### 2.5 Packages socle — renversé par ADR-0020 : tous deviennent des repos satellites

**Amendement ADR-0020 (activation générale)** : la catégorie « sans exposition satellite prévue » tombe avec les préconditions d'I-16. `knowledge`, `web-platform`, `authz-biscuit` et `ecosystem-engine` deviennent des repos satellites (`libre-ai/knowledge`, `libre-ai/web-platform`, `libre-ai/authz-biscuit`, `libre-ai/ecosystem-engine`) selon la règle déterministe ci-dessous ; `@libre-ai/notebook` (app) et `libre-ai-notebook-core` rejoignent le repo produit `notebook` ; `@libre-ai/root` meurt avec le workspace du hub. Texte d'origine (conservé pour l'histoire) : noms conformes à la convention, inchangés. `libre-ai-authz-biscuit` et `libre-ai-ecosystem-engine` restent internes au socle jusqu'à ce que la loi de couverture (I-16) les promeuve ; leur nom satellite éventuel reprend le nom du crate sans le préfixe `libre-ai-` — règle déterministe qui prime sur tout autre patron : `libre-ai-authz-biscuit` → repo `authz-biscuit`, npm `@libre-ai/authz-biscuit` ; `libre-ai-ecosystem-engine` → repo `ecosystem-engine`.

## 3. Produits — marque publique

La marque publique de chaque produit est « **Libre AI \<Produit\>** » ; le nom nu est descriptif et n'est jamais revendiqué seul comme marque (posture option C, ADR-0008 §6 : marque figurative EUIPO + ancrage `libre-ai.fr`).

| Produit            | Nom public                  | Moteur/crates associés                      | Contrats (familles existantes)                       |
| ------------------ | --------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| Radar              | Libre AI Radar              | moteur radar (à naître, vague 4b)           | `radar-engine-v1/v2`, `radar-*.v1`                   |
| Notebook           | Libre AI Notebook           | `libre-ai-notebook-core` (Gate B approuvée) | `notebook-core-v1/v2`, `notebook-backup.*`           |
| AI Practices       | Libre AI Practices          | moteur practices (à naître, vague 4b)       | `practice-scoring-v1`, `practice-progress-export.v1` |
| Sessions           | Libre AI Sessions           | à naître (vague 4b)                         | `session-event.v1`, `session-export.v1`              |
| Boussole Politique | Libre AI Boussole Politique | moteur boussole (contrats verrouillés)      | `boussole-scoring-v1/v2`, `boussole-*`               |
| Spec Studio        | Libre AI Spec Studio        | à naître (vague 4b)                         | `spec-package.v1`                                    |
| Model Policy       | Libre AI Model Policy       | policy-core (contrats verrouillés)          | `policy-core-v1/v2`, `policy-*`                      |
| Carrière           | Libre AI Carrière           | à naître                                   | —                                                    |
| Travel Agent       | Libre AI Travel Agent       | à naître                                   | —                                                    |
| Website            | Libre AI Website            | site public                                | —                                                    |

Le décompte des produits n'est pas gravé ici (I-14) : l'inventaire `ecosystem/repositories.v1.yaml` fait foi ; cette table fixe les **noms**, pas le portefeuille.

## 4. Glossaire produit

| Terme              | Définition (une ligne)                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Libre AI           | La marque ombrelle : constellation de produits souverains, explicables, réversibles, gérée par la méthode.                                                                                                                     |
| Polaris            | La méthode incarnée (couche 2 productisée) : orchestration gouvernable de flottes d'agents — plans bornés, refus, évidence, gates.                                                                                             |
| Missions           | L'application humaine de Polaris : la surface où les missions d'agents se voient, s'approuvent, s'auditent.                                                                                                                    |
| Radar              | Sélection de flux explicable et curation portable.                                                                                                                                                                             |
| Notebook           | Connaissance personnelle local-first, export de contexte contrôlé.                                                                                                                                                             |
| AI Practices       | Formation professionnelle à la pratique sourcée de l'IA.                                                                                                                                                                       |
| Sessions           | Apprentissage collectif ancré aux sources, facilitation.                                                                                                                                                                       |
| Boussole Politique | Comparaison civique privée contre les votes publics sourcés.                                                                                                                                                                   |
| Spec Studio        | Décisions produit, spécifications et handoffs bornés.                                                                                                                                                                          |
| Model Policy       | Sélection de modèles sous politique explicable.                                                                                                                                                                                |
| envelope           | Enveloppe d'intégrité du contenu non fiable : escape, marquage, signature vérifiable (K3).                                                                                                                                     |
| provenance         | Traçabilité des contributions et lignées d'agents (`agent-contributor-lineage.v1`).                                                                                                                                            |
| proof              | Rapports d'évidence signés et attestations de harness — la preuve opposable des gates.                                                                                                                                         |
| artifacts          | Manifestes et chaîne d'approvisionnement des artefacts produits.                                                                                                                                                               |
| memory             | Mémoire d'agents gouvernée (rappel enveloppé, classification, effacement prouvable) — livrée avec le lock.                                                                                                                     |
| orchestrator       | Le cœur d'exécution de Polaris : plans, autorisations, contrôle.                                                                                                                                                               |
| harness            | Le cadre d'exécution sécurisé des agents de Polaris.                                                                                                                                                                           |
| ui                 | Primitives d'interface accessibles et vérifiables de l'atelier applicatif.                                                                                                                                                     |
| auth               | Identité et autorisation (OIDC, session opaque, Biscuit) pour les apps de la constellation.                                                                                                                                    |
| sdk-ts / sdk-rs    | Projections SDK TypeScript / Rust des contrats du socle.                                                                                                                                                                       |
| starter            | Gabarit d'application souveraine, dérivé de la première app.                                                                                                                                                                   |
| mcp-server         | Exposition MCP des capacités de la constellation.                                                                                                                                                                              |
| corpus             | La pratique documentée, opposable — corpus public.                                                                                                                                                                             |
| docs               | Documentation générée de la constellation (projection, jamais une autorité).                                                                                                                                                   |
| skills             | Collection **présente**, versionnée et testée de compétences du harness d'ingénierie (`governance/skills/`, ADR-0025) — à ne pas confondre avec `patterns-skills` ci-dessous.                                                  |
| patterns-skills    | Candidat **futur** du portfolio couche 2 (`ecosystem/portfolio.v1.yaml`, source Fabric, `exposure: idea`) : bibliothèque de patterns d'agent pour Polaris, pas encore construite — à ne pas confondre avec `skills` ci-dessus. |

## 5. Justification des noms

- **Posture générale (tous les noms nus)** : chaque nom de produit ou de brique est un **générique descriptif** (français ou anglais) volontairement non appropriable seul ; la protection est portée par l'ombrelle « Libre AI » (marque figurative EUIPO à déposer, action propriétaire actée ADR-0008 §6) et l'ancrage `libre-ai.fr`. Aucun compte social homonyme n'est revendiqué. Vérification de coexistence déjà actée : homonyme de Dublin (`libreai.com`, aucune marque EUIPO déposée — vérifié 2026-07-10, re-confirmé par ADR-0008).
- **Polaris** : collision de nom élevée, connue et **acceptée** par arbitrage (ADR-0011 D2) ; traitement identique à la coexistence de marque documentée (figuratif + `.fr`). **Donnée nouvelle post-arbitrage** identifiée par la revue K4 (lentille collisions) : un produit actif du même segment (« Atos Polaris AI Platform », orchestration d'agents, lancé juillet 2025) et un enregistrement UE du signe « POLARIS » par un tiers hors segment. La confirmation ou le remplacement du nom est un **point de décision propriétaire** du dossier Phase 0 — cette carte ne le tranche pas.
- **Noms de produits (Radar, Notebook, …)** : déjà portés publiquement par les repositories gelés sous ces URLs depuis leur création et re-publiés le 2026-07-19 avec bannière de gel, sans contestation connue ; l'exposition cible n'ajoute aucun risque nouveau de collision par rapport à l'existant. La revue K4 (lentille collisions) vérifie ce constat nom par nom avant signature.
- **Boussole Politique** : ancrage francophone fort (`.fr`), nom composé spécifique — le risque de collision est structurellement plus faible que pour les génériques anglais.
- **Domaine `libre-ai.fr`** (finding N-02 de la revue K4) : vérification empirique du 2026-07-20 (whois + RDAP AFNIC) — le domaine est **enregistré et actif** (registrar Infomaniak, titulaire anonymisé, pratique AFNIC normale pour un particulier). L'anonymisation empêche de prouver le contrôle par le titulaire de ce dépôt : la **confirmation nominative du contrôle** est un point de décision propriétaire du dossier Phase 0 — cette carte ne la présume pas.
- **Familles plateforme/preuve/distribution (`ui`, `proof`, `artifacts`, `starter`, `sdk-ts`, `sdk-rs`, `mcp-server`, `corpus`, `docs`)** : reprises **à l'identique** de l'annexe non normative d'ADR-0008 — cette carte est l'acte qui les fige (l'annexe prévoyait « fixés à l'activation, par décision propriétaire ») ; zéro nom nouveau inventé.
- **Briques couches 2-3 (`orchestrator`, `harness`, `envelope`, `provenance`, `memory`)** : reprises à l'identique d'ADR-0009 §2 (topologie ratifiée) ; zéro nom nouveau inventé.
- **Cohérence de famille** : un seul patron pour toute la constellation — repo = nom nu, npm = `@libre-ai/<nom>`, crate = `libre-ai-<nom>` ; quatre exceptions conservées pour exactitude de contenu (`@libre-ai/auth-web`, `@libre-ai/contracts`, `libre-ai-agent-orchestrator`, et — depuis l'amendement ADR-0020 — le crate `policy-core`, qui rejoint le repo produit `policy`), une correction requise (`@libre-ai/design-system` → `@libre-ai/ui`, réalisée en vague 1).

## 6. Marques mortes et deny-list

### 6.1 Marques retirées (jamais réintroduites dans un document ou identifiant vivant)

Marques d'écosystème héritées : `rumble`, `bolt`, `wrench`, `gear`, `portal`, `cos-matic`/`cosmatic`. S'y ajoutent les trois motifs de marque et de domaine déjà deny-listés par le gate doctrine — cette carte les référence **par pointeur** (voir la liste exacte dans `.github/workflows/doctrine-governance.yml`) et ne les recopie pas : les écrire ici déclencherait le gate lui-même, et la liste du workflow reste la source unique. Noms d'outillage retirés (§1.2) : jamais réutilisés comme nom de repo, package ou crate.

### 6.2 État constaté (inventaire du 2026-07-20)

Aucune occurrence de marque morte dans le code vivant (crates, packages, apps, contracts, workflows CI). Les occurrences restantes sont des **traces historiques légitimes** : registres d'archive (`ecosystem/LEGACY-MANIFEST.yaml`, `docs/transformation/G0-FREEZE-EVIDENCE.md`, `REPOSITORY-MAP.md`, `PROGRAM.md`), tableaux de migration (`docs/architecture/DETAILED-TARGET.md`), registre de décisions (`DECISION-REGISTER.md`), contexte d'ADR (`0008`), énumération de vision (`vision.md`) et une mention de migration dans `crates/artifact/README.md`.

### 6.3 Extension du gate (à implémenter après signature)

Étendre la deny-list du job `doctrine-governance` aux motifs `rumble`, `bolt`, `wrench`, `gear`, `portal`, `cos-matic|cosmatic` sur les documents vivants, avec exclusions explicites : les registres historiques du §6.2, `docs/reviews/` (déjà exclu par le gate), **et cette carte elle-même** (`docs/decisions/LEXICON.md`), qui doit pouvoir énumérer les marques mortes sans les réintroduire. Le `README.md` de `crates/artifact` est nettoyé de ses références `Gear Cable`/`Gear Depot` (documentation vivante d'un crate vivant) dans la même passe.

## 7. Actions post-signature (récapitulatif exécutable)

1. Renommage `@libre-ai/design-system` → `@libre-ai/ui` (`packages/design-system` → `packages/ui`), imports et lockfile à la main (v2) — **première action de la vague 1, précondition de tout autre merge de cette vague** (clôture de la dérive I-04 constatée §2.1 ; délai ferme : avant toute publication satellite).
2. Nettoyage `crates/artifact/README.md` (références Gear).
3. Extension de la deny-list `doctrine-governance` (§6.3).
4. Réservation du scope npm `@libre-ai` (création de l'organisation npm) avant toute publication satellite de la vague 1 — le scope est libre au 2026-07-20 (revue K4 collisions) ; action externe soumise au checkpoint propriétaire (garde-fou classe 9, premier de son type).
5. Mise à jour d'`ecosystem/repositories.v1.yaml` : aucune entrée nouvelle requise (les homes réservés y figurent déjà) ; les satellites y entrent à leur activation avec les noms de cette carte.
6. Gate truth-drift re-vérifié vert ; aucun nom hors carte dans les artefacts nouveaux (garde-fou classe 4).

## 8. Amendement du 2026-07-28 — activation générale (ADR-0020)

Porté par la pull request de l'ADR-0020, même procédure que la signature de cette carte (production → revue K4 → arrêt dur → merge = signature propriétaire). Les décisions ci-dessous sont normatives ; les colonnes « Activation / vague » des tables §1.1 et §2.1–2.4 sont périmées — l'état d'activation vit dans l'index d'écosystème (`ecosystem/repositories.v1.yaml`) et les fiches `project.v1.yaml`, jamais dans cette carte.

### 8.1 Noms d'autorité

| Brique       | Repo cible            | Note                                                                                                                                                                                                                                                            |
| ------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `governance` | `libre-ai/governance` | doctrine, invariants, ADR, cette carte, index d'écosystème, schéma des fiches, outillage d'écosystème, evidence, gates de flotte                                                                                                                                |
| `contracts`  | `libre-ai/contracts`  | les autorités canoniques de contrats, catalog, gates contrats. **Désambiguïsation** : le repo `libre-ai/contracts` (autorités) et le package npm `@libre-ai/contracts` (projection SDK TypeScript, repo `sdk-ts`, nom conservé §2.1) sont deux objets distincts |

### 8.2 Identifiants nés après la signature de la carte

| Brique           | Repo satellite cible             | Package/crate                                                         | Source socle               |
| ---------------- | -------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| `testing`        | `libre-ai/testing`               | `@libre-ai/testing`                                                   | `packages/testing`         |
| `data`           | `libre-ai/data`                  | `@libre-ai/data`                                                      | `packages/data`            |
| `rgpd-kit`       | `libre-ai/rgpd-kit`              | `@libre-ai/rgpd-kit`                                                  | `packages/rgpd-kit`        |
| `classification` | `libre-ai/classification`        | `@libre-ai/classification`                                            | `packages/classification`  |
| `collab-core`    | `libre-ai/collab-core`           | `@libre-ai/collab-core`                                               | `packages/collab-core`     |
| `collab-relay`   | `libre-ai/collab-relay`          | `@libre-ai/collab-relay`                                              | `packages/collab-relay`    |
| —                | rejoint le repo produit `policy` | `@libre-ai/policy-core-ref`                                           | `packages/policy-core-ref` |
| —                | rejoint le repo produit `policy` | crate `policy-core` (conservé sans préfixe — quatrième exception, §5) | `crates/policy-core`       |

### 8.3 Promotions par renversement du §2.5

`knowledge`, `web-platform` (nés avant la signature, rangés « sans exposition »), `authz-biscuit` et `ecosystem-engine` (gelés « jusqu'à promotion I-16 ») deviennent des repos satellites — les préconditions d'I-16 sont abrogées par ADR-0020. Leurs noms suivent la règle déterministe du §2.5 : repo = nom du crate sans le préfixe `libre-ai-`, npm = `@libre-ai/<nom>`.

### 8.4 Noms réservés non instanciés

`proof`, `memory`, `harness`, `mcp-server`, `corpus`, `docs` restent **réservés** ; aucun repo n'est créé pour eux par l'activation générale. `harness` et `memory` sont re-scopés comme roadmap du repo `orchestrator` (contenu ADR-0018/WP-G3-H01), leur réservation de nom demeure.

### 8.5 Régularisations

`agent-board` → `missions` : la carte rattrape l'arbitrage propriétaire du 2026-07-23 (ADR-0008 amendé) — le repo GitHub et l'inventaire étaient déjà alignés, c'est la documentation qui avait dérivé. `website` : sortie de la liste §1.2 des noms retirés, régularisée par ADR-0020 §2.4.

## 9. Amendement du 2026-07-30 — carte des couches complétée (reliquat γ 3.4)

Amendement produit selon la procédure de ce document (production → revue K4
role-separated → merge = signature), sous le GO propriétaire explicite du
2026-07-30. Il régularise la carte §2 sur ce qui est **déjà en service vert**
(inventaire topologique v2, fiches d'état) — rien n'est inventé, rien ne
change de nom.

### 9.1 Six briques nées satellites en γ 3.4, absentes de la carte

| Brique           | Repo satellite            | Package                    | Couche   |
| ---------------- | ------------------------- | -------------------------- | -------- |
| `testing`        | `libre-ai/testing`        | `@libre-ai/testing`        | couche 4 |
| `rgpd-kit`       | `libre-ai/rgpd-kit`       | `@libre-ai/rgpd-kit`       | couche 4 |
| `classification` | `libre-ai/classification` | `@libre-ai/classification` | couche 4 |
| `collab-core`    | `libre-ai/collab-core`    | `@libre-ai/collab-core`    | couche 4 |
| `collab-relay`   | `libre-ai/collab-relay`   | `@libre-ai/collab-relay`   | couche 4 |
| `data`           | `libre-ai/data`           | `@libre-ai/data`           | couche 4 |

### 9.2 Couches des quatre briques du §2.5 (nommées sans couche)

| Brique             | Couche     |
| ------------------ | ---------- |
| `knowledge`        | couche 4   |
| `web-platform`     | couche 4   |
| `authz-biscuit`    | couche 3   |
| `ecosystem-engine` | transverse |

### 9.3 Outil autonome, nommé pour exhaustivité

`db-inspect` (`libre-ai/db-inspect`, transverse) — outil CI fail-closed
antérieur à l'activation générale, consommé épinglé par release ; hors
famille brique, listé pour que la carte n'ait aucun angle mort.

Les briques « à naître » du §2 (proof, memory, harness, mcp-server, corpus,
docs) restent à naître : leurs noms sont réservés par cette carte, aucun
repo n'existe, rien ne se crée sans arrêt dur propriétaire. **Corrigé par
le §10 pour `harness` seul** — la phrase ci-dessus décrivait l'état du
2026-07-30 ; `harness` a un repository depuis le 2026-08-18.

## 10. Amendement du 2026-08-18 — harness créé (domaine F chantier A)

Amendement produit selon la procédure de ce document (production → revue
K4 role-separated → merge = signature), sous arrêt dur propriétaire
explicite du 2026-08-18 (ADR-0026, re-ratification du domaine F). `harness`
sort de son statut de nom réservé : le repository existe.

### 10.1 §8.4 corrigé — `harness` n'est plus un nom réservé re-scopé

Le §8.4 disait : « `harness` et `memory` sont re-scopés comme roadmap du
repo `orchestrator` (contenu ADR-0018/WP-G3-H01), leur réservation de nom
demeure. » Ce n'est plus exact pour `harness` : par décision propriétaire
explicite du 2026-08-18, `libre-ai/harness` est un repository satellite
couche 2 à part entière, créé pour porter la frontière d'exécution
confinée et sa spécification — migrée depuis
`orchestrator/docs/apps/harness.md` (ADR-0018 D3), contenu inchangé, seul
le chemin de crate mis à jour vers la réalité de ce nouveau dépôt. Le §8.4
reste la référence historique de la décision du 2026-07-28 ; il ne décrit
plus l'état courant pour `harness`. **`memory` reste re-scopé comme
roadmap du repo `orchestrator`** — ce chantier ne le touche pas.

| Brique    | Repo satellite     | Package/crate      | Couche   |
| --------- | ------------------ | ------------------ | -------- |
| `harness` | `libre-ai/harness` | `libre-ai-harness` | couche 2 |

### 10.2 La mention WP-G3-H01 pendante est résolue

`orchestrator/docs/apps/harness.md`, cité depuis le §8.4 comme le contenu
du re-scope roadmap (ADR-0018/WP-G3-H01), est retiré d'`orchestrator` dans
le même chantier et remplacé par un pointeur d'une ligne vers ce
repository. La mention « WP-G3-H01 » que portait le §8.4 est résolue par
cette création — elle ne désigne plus un contenu roadmap sans repository,
elle désigne la spécification de ce repository. Cela ne préempte pas la
pull request `orchestrator#13` (`crates/agent-harness`, arrêt dur
d'amorçage ADR-0011 D4, réservé au propriétaire) : elle reste ouverte,
non fusionnée, hors du périmètre du présent chantier — la réconciliation
entre son contenu et ce repository est un acte propriétaire distinct, non
tranché ici.

### 10.3 §9.3 corrigé par renvoi

La phrase de clôture du §9.3 (« Les briques "à naître" du §2 … restent à
naître ») portait encore `harness` dans son énumération après cette
création ; la note ajoutée à cet endroit renvoie ici plutôt que de
réécrire l'énumération, pour ne pas dupliquer l'autorité de ce fait entre
deux paragraphes.

## 11. Amendement du 2026-08-18 — neuvième produit couche 1 : `travel-agent`

Décision propriétaire du 2026-08-18 (arbitrage structuré, remise à plat,
domaine B) : `travel-agent` est un produit Libre AI de couche 1 — un
planificateur d'itinéraires raisonnant sur des faits de ville vérifiés et
sourcés, où le modèle compose et où le code oppose son veto, avec isolation
stricte de l'instance de voyage (trois strates ; l'instance ne vit jamais dans
le repository).

### 11.1 Nom canonique

| Produit        | Repo                    | Marque publique                                                                           | Couche |
| -------------- | ----------------------- | ----------------------------------------------------------------------------------------- | ------ |
| `travel-agent` | `libre-ai/travel-agent` | Libre AI Travel Agent (famille ratifiée par ADR-0033) | 1      |

Le décompte de produits couche 1 passe de huit à neuf ; comme pour `carriere`
(§ registre, décision du 2026-07-23), la constellation croît par décision
propriétaire (ADR-0009 §4), le décompte historique des sections signées
antérieures n'est pas réécrit.

### 11.2 Condition de publication honorée à la création

Le repository est né après la sortie prouvée de sa phase `sealed-repo`
(gate d'isolation démontré dans les deux sens, index initial audité sans
instance de voyage, fiche valide, double licence Apache-2.0/ODbL) — preuves
dans `travel-agent/docs/evidence/2026-08-18-sealed-repo.md`.

## 12. Amendement du 2026-09-10 — produit couche 1 pré-repository : `signalement`

Décision propriétaire du 2026-09-10, issue d'une qualification structurée :
`signalement` est un produit Libre AI de couche 1. Il permet de capturer et
qualifier un incident ou une demande d'amélioration, de produire un scénario
de reproduction et des verdicts vérifiables, puis de synchroniser des
projections vers plusieurs systèmes de travail sans devenir lui-même un
nouveau ticketing.

### 12.1 Nom canonique

| Produit       | Repo                    | Marque publique      | Couche |
| ------------- | ----------------------- | -------------------- | ------ |
| `signalement` | `libre-ai/signalement` | Libre AI Signalement | 1      |

Le produit reste centré sur l'acte utilisateur de signaler un problème ou une
amélioration. Son objet métier canonique s'appelle `Dossier` : il rassemble
déclarations, faits observés, preuves approuvées, scénario et résultats. Les
tickets externes restent des projections indépendantes. Comme tout produit de
la famille, Signalement ne reçoit ni promesse ni identité de marque autonome :
seule l'ombrelle Libre AI porte la promesse publique (`brand/README.md`,
architecture de famille).

L'inscription correspondante dans `ecosystem/portfolio.v1.yaml` est l'autorité
de son état pré-repository. Elle l'enrôle à l'exposition `idea` ; elle ne prouve
ni repository, ni implémentation, ni connecteur qualifié.

### 12.2 Collision et limite sémantique

Le contrôle du 2026-09-10 n'a identifié aucun produit homonyme exact **Libre AI
Signalement** sur les surfaces interrogées. Le mot nu reste un générique français
non revendiqué et porte une limite réelle : il est aussi associé au lancement
d'alerte, au HSE et au signalement civique. Le premier emploi public doit donc
préciser « incident ou demande d'amélioration dans une application web » et ne
jamais suggérer un canal anonyme de dénonciation. Une vulnérabilité suspectée, un
secret exposé ou un détail d'exploitation est explicitement hors de ce parcours :
le `SECURITY.md` de flotte impose son canal privé. Les moteurs, requêtes, classes,
résultats normalisés, sources et limites sont archivés avec digest dans le dossier
de décision ; ce contrôle n'est ni une recherche d'antériorité ni un avis juridique.

### 12.3 Condition de publication

Le repository public ne naît qu'après la signature de cet amendement et le
protocole privé-first d'ADR-0038/I-30. Cette autorité sépare la création d'un
distant vide privé, le push des OID attestés vers des refs complètes exactes, la
preuve reproduite depuis un clone privé complet et l'exposition publique. Le
manifeste canonique refs/objets et son attestation restent archivés dans
Governance ; une simple CI post-publication ne protège pas la première
divulgation. L'inscription dans l'inventaire topologique intervient seulement
après que le repository est observable, afin que le truth-drift ne transforme
jamais une intention en état du monde.

## 13. Amendement du 2026-09-11 — dépôt administratif privé

ADR-0039/I-31 admet exactement `libre-ai/product-research`, nom canonique d'un
dépôt `administrative-private` transverse, hors portfolio, sans fiche produit.
Ce nom ne désigne ni produit, ni package, ni crate. Le contenu de recherche reste
non normatif ; seuls le nom, le rôle, la visibilité et la frontière d'autorité
entrent dans l'index public. Les familles de noms existantes restent inchangées.
