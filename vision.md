# Libre AI — Vision 2035 et architecture cible

**Statut :** accepted — architecture cible et migration Big Bang ; topologie amendée par ADR-0020 (activation générale, 2026-07-28)

**Cible :** reconstruction greenfield, d’abord dans un monorepo canonique, puis éclatée en topologie multi-repository (ADR-0020)

**Stack web cible :** Bun fullstack + TypeScript strict + React 19

**Rôle de Rust :** composants spécialisés à valeur durable démontrée

**Horizon :** 5 à 10 ans

> Libre AI choisit de supporter maintenant les coûts structurants de la cible :
> nouvelle source canonique, nouveaux noms, nouvelles frontières, nouvelle stack
> web et nouvel outillage. Le code et l’historique actuels ne contraignent pas la
> nouvelle organisation.

> La migration suit une approche Big Bang : les repositories historiques sont
> figés ensemble, toute nouvelle architecture et tout nouveau développement
> basculent dans le monorepo cible, et aucune compatibilité transitoire n’est
> entretenue. Les applications peuvent rester indisponibles ou incomplètes
> pendant la reconstruction ; la priorité est d’atteindre rapidement une cible
> cohérente, intégrée et durable.

> **Amendement ADR-0020 (2026-07-28) — activation générale.** La phase Big Bang
> est exécutée et la topologie n’est plus un monorepo unique : chaque repo est
> responsable de son périmètre, deux autorités séparées portent le partagé
> (`governance` pour la doctrine, `contracts` pour les contrats canoniques), et
> le hub `libre-ai/libre-ai` est démantelé en archive plus index de migration.
> Les énoncés de topologie et d’autorité de ce document se lisent sous cet
> amendement ; le récit de la migration Big Bang reste l’histoire de la
> refondation, pas une prescription courante.

---

## 1. Contexte

Libre AI dispose déjà d’un ensemble important de produits, composants,
contrats, décisions, benchmarks et preuves locales.

L’organisation actuelle a permis d’explorer :

- Rust-first et Dioxus ;
- orchestration agentique ;
- contract-first et verification-first ;
- ingestion, contexte et local-first ;
- distribution d’artefacts ;
- souveraineté et sécurité ;
- expériences web et multiplateformes ;
- acculturation aux usages responsables de l’IA.

Elle reflète cependant une succession d’explorations et de refontes :

- repositories nombreux et frontières parfois historiques ;
- noms techniques hérités (`rumble`, `gear`, `portal`, `wrench`, `bolt`) ;
- documentation et statuts dupliqués ;
- plusieurs chaînes de build et lockfiles ;
- dépendances inter-repositories épinglées par SHA ;
- Dioxus, Axum, Tokio et SQLx étaient présents dans des produits désormais
  servis plus directement par une stack Bun/TypeScript (greffes γ 3.5) ;
- contrats utiles mélangés à des implémentations qui ne constituent plus la
  cible ;
- coût élevé de contexte, de synchronisation et de release pour les humains et
  les agents.

La cible étant désormais suffisamment définie et destinée à rester stable,
Libre AI ne cherche plus à adapter progressivement l’architecture historique.

La décision est :

> **Créer une base canonique neuve, conçue directement pour la vision cible,
> puis y porter sélectivement les comportements, contrats, données et composants
> qui méritent d’être conservés.**

---

## 2. Vision

Libre AI est un laboratoire open source et souverain qui construit pour ses
propres besoins les capacités nécessaires au logiciel de l’ère IA-native, les
met à l’épreuve dans des expériences réelles, publie les évidences comme les
limites, puis distribue les résultats afin que d’autres puissent les reproduire
et les améliorer.

Notre hypothèse à dix ans est volontairement radicale :

> Une part importante des services SaaS caractéristiques des années 2020 pourra
> être reconstruite ou profondément adaptée à la demande à partir d’intentions,
> de connaissances, de données, de contraintes, de contrats et de critères de
> vérification explicites.

Générer du code ne suffit pas à produire un service durable. La valeur se
concentre dans la capacité à :

- formuler correctement une intention ;
- structurer et relier les connaissances ;
- rendre les décisions explicites ;
- définir des contrats exécutables ;
- maîtriser les données et les autorisations ;
- vérifier les réalisations ;
- exploiter et faire évoluer les systèmes ;
- transmettre les capacités et apprentissages.

Libre AI existe pour préparer et distribuer cette transition.

---

## 3. Mission

1. **Construire pour des besoins réels** — le dogfood fournit la première
   contrainte de vérité.
2. **Mettre des hypothèses à l’épreuve** — chaque initiative répond à une
   question explicite et réfutable.
3. **Produire des évidences** — tests, benchmarks, pilotes, incidents et retours
   sont publiés avec leurs limites.
4. **Structurer les apprentissages** — sources, décisions, contrats,
   implémentations et preuves deviennent exploitables par humains et agents.
5. **Produire des capabilities composables** — sans les confondre avec les
   expériences qui les démontrent.
6. **Distribuer et acculturer** — code, méthodes, contextes, formations,
   exemples et contre-exemples sont des sorties premières.
7. **Fédérer sans enfermer** — la source est ouverte, exportable, réplicable et
   indépendante d’un fournisseur unique.

Le succès ne se mesure ni au nombre de repositories ni au volume de code. Il se
mesure à la valeur produite, à la qualité des évidences et à la capacité
d’acteurs indépendants à reproduire, adopter ou contester le travail.

---

## 4. Décisions structurantes

### 4.1 Canonical Core

Libre AI a possédé une seule source d’écriture, un nouveau monorepo canonique,
le temps de la reconstruction. Depuis ADR-0020, l’écriture est répartie entre
les repos responsables de leur périmètre, et l’index de migration trace la
destination de chacun des contenus que le monorepo a portés :

- les Knowledge Objects ;
- les schémas et contrats ;
- les applications ;
- les packages TypeScript ;
- les crates Rust retenues ;
- les migrations ;
- les protocoles de vérification ;
- les preuves acceptées ;
- les outils de distribution ;
- la gouvernance et les décisions.

Les repositories publics sont de vrais lieux de développement, chacun
responsable de son périmètre, plus des archives. Deux d’entre eux portent le
partagé : `governance` pour la doctrine, les décisions, les invariants et
l’outillage d’écosystème, `contracts` pour les autorités canoniques de contrats
(ADR-0020, amendement I-03). La règle demeure — un sujet, une autorité unique :
aucun autre repository ne constitue une seconde autorité de contrats ou de
spécifications, et un contrat ne se duplique jamais ailleurs que comme
projection vérifiée sous gate de dérive (I-05).

### 4.2 Reconstruction sans import d’historique

La nouvelle base commence par un commit racine propre.

Les historiques Git actuels ne sont pas importés dans le monorepo. Cette
décision permet de ne pas transporter :

- artefacts de build historiquement commités ;
- anciens noms et chemins ;
- décisions remplacées ;
- lockfiles concurrents ;
- duplications et extractions successives ;
- documentation devenue fausse ;
- structures conçues pour l’ancienne stack.

Les anciens repositories sont figés et conservés comme archives externes. Leur
SHA final, licences, releases, contrats et provenance sont référencés dans un
`LEGACY-MANIFEST.yaml` du nouveau monorepo.

Le portage sélectif conserve uniquement :

- comportements encore souhaités ;
- contrats publics utiles ;
- données et migrations nécessaires ;
- tests exprimant des invariants réels ;
- composants Rust dont la valeur reste démontrée ;
- décisions encore applicables ;
- obligations de licence et d’attribution.

Un fichier copié ou réécrit depuis un ancien repository porte une provenance
vers le repository, le SHA et le chemin source. La conservation des archives
remplace l’import de leur graphe Git.

### 4.3 Bun fullstack comme plateforme web

Bun possède désormais la stack applicative web :

- package management ;
- workspaces et catalogue de versions ;
- task runner ;
- bundling ;
- serveur HTTP ;
- SSR, hydratation et rendu statique ;
- API et BFF ;
- WebSockets et SSE lorsque requis ;
- accès PostgreSQL, Redis et stockage objet pour les applications migrées ;
- tests TypeScript ;
- orchestration Playwright ;
- scripts de développement et de build.

`Bun.serve` est la frontière HTTP/fullstack par défaut.

La stack ne doit pas ajouter Next.js, Vite, Astro, Hono, Express, Fastify,
Elysia ou un autre framework serveur. Libre AI assume directement les quelques
primitives fullstack dont il a besoin.

### 4.4 React 19 comme renderer web

React 19 devient le renderer web par défaut.

La cible utilise :

- composants fonctionnels ;
- TypeScript strict ;
- SSR React public et documenté ;
- hydratation avec `hydrateRoot` ;
- rendu client avec `createRoot` lorsque nécessaire ;
- rendu statique via les APIs publiques de `react-dom/server` ;
- React Aria Components ou primitives headless accessibles équivalentes ;
- Tailwind v4 lorsqu’utile ;
- tokens Libre AI et variables CSS comme vérité visuelle ;
- fontes locales uniquement.

React Server Components ne font pas partie de la cible initiale. Leur adoption
nécessiterait un contrat public stable et un besoin démontré. Bake privé, `wip`
ou interne est interdit.

### 4.5 Rust spécialisé

Rust n’est plus la plateforme applicative web par défaut.

Rust reste utilisé lorsqu’il apporte une valeur durable et vérifiable :

- moteurs métier complexes ou sensibles ;
- algorithmes déterministes et scoring ;
- cryptographie et Biscuit ;
- inspection SQL, RLS et migrations ;
- preuves, provenance et supply chain ;
- agent orchestration et policy enforcement ;
- CLI système ;
- outils de release éprouvés ;
- WASM local-first ;
- composants partagés avec des clients natifs ;
- code dont la migration TypeScript supprimerait des invariants opposables.

Un composant Rust n’est pas conservé uniquement parce qu’il existe. Chaque
composant retenu doit déclarer la valeur qu’il protège et les tests qui la
prouvent.

### 4.6 Une implémentation par domaine

Il ne doit jamais exister durablement deux implémentations d’une même règle
métier.

Une double exécution temporaire est autorisée uniquement pour une gate de
parité :

- mêmes entrées ;
- sorties comparées ;
- divergences enregistrées ;
- propriétaire identifié ;
- date de suppression ;
- ancienne implémentation retirée après bascule.

### 4.7 Reconstruction Big Bang

Après la baseline, tous les anciens repositories sont figés simultanément. Ils
restent consultables comme archives, mais ne reçoivent plus de fonctionnalité,
de correction architecturale ou de mise à jour de stack.

Le monorepo est devenu immédiatement l’unique autorité de développement, pour
la durée de la reconstruction — clause de topologie supersédée depuis par
ADR-0020 §2.2, qui rend chaque repo responsable de son périmètre et retire
l’obligation d’intégration continue dans le monorepo :

```text
freeze global de l’existant
        ↓
spécification complète de la cible
        ↓
construction parallèle des fondations et applications
        ↓
intégration continue dans le monorepo
        ↓
qualification globale
        ↓
cutover unique de l’écosystème cible
```

Big Bang désigne l’absence d’architecture transitoire, de compatibilité et de
cutovers produit successifs. Il ne signifie pas que tous les agents modifient
les mêmes fichiers sans coordination : les workstreams restent bornés par
chemins, contrats et ownership.

Les comportements historiques ne sont conservés que s’ils sont réacceptés dans
la spécification cible. La parité exhaustive avec les anciens outils n’est pas
un objectif.

---

## 5. Vocabulaire stratégique

### Pari stratégique

Décision d’investir dans une direction incertaine mais jugée importante.

### Hypothèse stratégique mise à l’épreuve

Affirmation réfutable associée à un pari. Un pari n’est pas « démontré » : il
est assumé ; l’hypothèse est testée.

### Démonstrateur

Expérience ou parcours construit pour tester une hypothèse dans un usage réel.

### Évidence

Observation reproductible et bornée : test, benchmark, artefact, audit, pilote,
déploiement ou retour documenté.

### Capability

Capacité cohérente, contractuelle et composable. Une capability peut être
modélisée dès la conception, mais sa promotion publique exige des consommateurs,
des contrats exercés et un propriétaire.

### Expérience

Parcours utilisateur assemblant des capabilities. Les expériences restent les
véhicules de valeur, de feedback et de communication.

### Knowledge Object

Objet canonique typé représentant une source, une hypothèse, une décision, une
capability, une expérience, un contrat, une implémentation, une évidence, un
apprentissage ou une release.

### Projection

Artefact généré depuis une source canonique — un contrat, une fiche, un
Knowledge Object : site, documentation, graphe, diagramme, catalogue, SDK,
context pack ou release note. Une projection n’est jamais canonique et ne
s’édite jamais à la main (I-05). Un repository de distribution peut porter des
artefacts générés, dont le contenu reste non canonique ; une copie vendorée
sous gate de dérive est une projection vérifiée ; et une application qui sert
des projections reste une application, pas une projection (ADR-0020 §2.3).

---

## 6. Cycles fondamentaux

### Cycle stratégique

```text
Thèse
  ↓
Paris
  ↓
Hypothèses
  ↓
Démonstrateurs
  ↓
Évidences
  ↓
Apprentissages
  ↓
Capabilities
  ↓
Distribution
  ↓
Adoption et feedback
  ↺
Thèse
```

### Cycle d’ingénierie

```text
Knowledge
    ↓
Framing
    ↓
Decision
    ↓
Specification
    ↓
Implementation
    ↓
Verification
    ↓
Distribution
    ↓
Feedback
    ↺
Knowledge
```

`Framing` produit synthèses, alternatives, risques et inconnues. `Decision`
rend l’arbitrage humain explicite. Une synthèse générée ne devient jamais
silencieusement une spécification normative.

---

## 7. Cible expliquée

### 7.1 Ce qui est centralisé

La centralisation concerne l’autorité et les changements :

- une seule branche canonique ;
- un seul modèle d’objets ;
- un seul graphe de dépendances ;
- un seul lockfile Bun ;
- un seul workspace Cargo ;
- des contrats communs ;
- des changements atomiques entre application, contrat, moteur et preuve ;
- une gouvernance et une release supply chain communes.

Elle ne signifie pas que tous les composants sont déployés dans un seul process
ou versionnés ensemble.

### 7.2 Ce qui reste indépendant

- releases des applications ;
- versions des packages et crates ;
- données et migrations de chaque produit ;
- secrets et environnements ;
- droits par chemin ;
- déploiements ;
- cycles de maturité ;
- responsabilités métier ;
- preuves indépendantes.

### 7.3 Flux d’auteur

```text
Humain ou agent
      ↓
Monorepo canonique
      ↓
Contrats + code + tests + Knowledge Objects
      ↓
Gates humaines et automatisées
      ↓
Artefact + évidence + provenance
      ↓
Déploiement et publications publiques
```

### 7.4 Flux applicatif web

```text
Navigateur
    ↓ HTTPS
Bun.serve / BFF du produit
    ├── domaine TypeScript pur
    ├── capability Rust via WASM, CLI bornée ou service explicite
    ├── PostgreSQL via Bun.sql
    ├── Redis non autoritatif
    └── Cellar S3-compatible
```

Les objets `Request`, `Response` et `Server` ne traversent pas la frontière du
domaine. Les handlers Bun sont des adaptateurs.

### 7.5 Flux connaissance et agents

```text
Knowledge Objects + Contracts + Evidence
                    ↓
       Executable Knowledge Engine
                    ↓
Graphe · Impact · Context packs · Documentation · Plans
                    ↓
 Futur Agent Orchestrator (hors S01)
                    ↓
Work packages · Exécution bornée · Évidence
```

Le Knowledge Engine décrit et compile. Après un Specification Lock dédié, un futur Agent Orchestrator
pourra exécuter sous politique. Proof vérifie indépendamment. Artifact construit et distribue.

### 7.6 Repositories publics

```text
Autorités séparées (governance : doctrine · contracts : contrats canoniques)
       ↓ dépendances épinglées
Satellites de code partagé (un repo par package ou crate)
       ↓ dépendances épinglées
Repositories produits et application de couche 2 (développement réel)
       ↓ artefacts générés (docs, SDK, packs)
Publications
```

Les repositories produits sont de vrais lieux de développement : issues, pull
requests et releases. Ils consomment les satellites et les contrats comme
dépendances épinglées — git-deps GitHub bornées à l'organisation et fixées par
SHA, copies vendorées sous gate de dérive pour ce qui est consommé à la
compilation — et n'hébergent jamais l'autorité des contrats, qui reste au repo
`contracts` (ADR-0020). Les artefacts générés restent à sens unique et portent
le SHA source, le chemin, le hash de contenu et la version du compilateur.

### 7.7 GitHub et collaboration canoniques

La décision déjà prise est conservée : l’organisation GitHub `libre-ai` porte
les repositories, issues, pull requests, protections de branches et releases
publiques.

- `libre-ai/libre-ai` a été le repository canonique de la reconstruction ; il
  est démantelé en archive plus index de migration (ADR-0020 D2/D4) ;
- les homes produits gelés sont activés et reçoivent leur histoire migrée par
  greffe ; les anciens repositories d'outillage restent retirés après capture
  vérifiée, leurs noms morts (ADR-0008, LEXICON §1.2) ;
- les merges, tags et releases canoniques sont réalisés sur GitHub ;
- aucune nouvelle forge ou infrastructure Git n’est ajoutée à cette migration ;
- la souveraineté runtime et données reste assurée séparément par les choix
  d’hébergement applicatif ;
- les exports Git et les artefacts empêchent que GitHub devienne une dépendance
  de données irréversible.

Ce choix est une décision de distribution et de collaboration, pas une
affirmation de souveraineté complète de la forge.

---

## Architecture, toolchain et programme — documents d'autorité

Le détail est décomposé par autorité (vague 0, ADR-0009) :

- architecture cible : [`docs/architecture/TARGET.md`](docs/architecture/TARGET.md) (autorité) et [`docs/architecture/DETAILED-TARGET.md`](docs/architecture/DETAILED-TARGET.md) (détail) ;
- toolchain et politique de version : [`docs/architecture/TOOLCHAIN.md`](docs/architecture/TOOLCHAIN.md) ;
- programme de la refondation : [`docs/transformation/PROGRAM.md`](docs/transformation/PROGRAM.md) ; séquencement des vagues 0 à 3, historique depuis ADR-0020 : [`docs/transformation/EXECUTION-SEQUENCING.md`](docs/transformation/EXECUTION-SEQUENCING.md) ; ordre d'exécution courant : design d'activation générale [`docs/superpowers/specs/2026-07-28-multi-repo-activation-design.md`](docs/superpowers/specs/2026-07-28-multi-repo-activation-design.md) §5.6 ;
- invariants et décisions : [`docs/decisions/INVARIANTS.md`](docs/decisions/INVARIANTS.md), [`docs/adr/`](docs/adr/).

## 28. Non-objectifs

- importer les contenus et historiques Git legacy dans l'arbre de travail — la
  greffe d'histoire des repos produits (ADR-0020, design §5.1) n'est pas un
  import de contenu legacy ;
- maintenir les anciennes structures ou APIs par compatibilité interne ;
- maintenir les anciens outils pendant la reconstruction ;
- organiser des cutovers produit successifs ;
- promettre desktop/mobile via Bun ;
- remplacer Playwright par Bun.WebView ;
- migrer les outils Rust spécialisés sans bénéfice ;
- ajouter un framework serveur au-dessus de Bun.serve ;
- utiliser un hyperscaler américain ;
- conserver Dioxus dans la cible ;
- rouvrir Bun vs Dioxus sans blocage factuel majeur ;
- utiliser des APIs privées ou `wip` de Bake ;
- confondre reconstruction greenfield et perte de données, de licences ou
  d’invariants explicitement sélectionnés.

---

## Principe fondateur

> **Libre AI construit aujourd’hui, pour des usages réels, les capacités
> ouvertes et souveraines dont nous pensons que chacun aura besoin demain. Nous
> repartons sur une base propre conçue directement pour cette cible : Bun et
> React pour les applications web, Rust pour les composants spécialisés, une
> source canonique de connaissances et de code, des preuves opposables et des
> distributions que chacun peut reproduire, contester et améliorer.**
