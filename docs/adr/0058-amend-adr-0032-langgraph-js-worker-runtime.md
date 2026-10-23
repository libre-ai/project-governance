# ADR-0058 — Amendement d'ADR-0032 : LangGraph JS est admis comme runtime des workers TypeScript, jamais comme autorité

- **Statut :** proposé — la fusion de cette pull request vaut signature du propriétaire (ADR-0043).
- **Arbitrage :** Owner-arbitration: 2026-10-23 — décision prise en chat par question structurée (ADR-0022/I-24), après restitution d'ADR-0032, d'ADR-0037 et des avis de sécurité publiés sur les paquets concernés. La formulation du propriétaire est reprise, non réinterprétée (section « Source »).
- **Date de rédaction :** 2026-10-23
- **Portée :** le runtime des workers écrits en TypeScript, dans les produits du catalogue dont la fiche déclare un appel de modèle de langage et dans l'outillage de la forge. Ne modifie aucun contrat canonique, aucun lock, aucune autorité.
- **Amende :** ADR-0032 D1 (`docs/adr/0032-langgraph-pattern-mining-boundary.md:41`) et D38 pour ce qui concerne le **worker** : LangGraph n'est plus seulement un oracle de recherche, il est un runtime admis du graphe interne d'un worker TypeScript. ADR-0032 D2, D3, D4 et D5 (`docs/adr/0032-langgraph-pattern-mining-boundary.md:61`, `:72`, `:87`, `:97`) restent en vigueur mot pour mot.
- **Ne modifie pas :** ADR-0034 (frontière du graphe autorisé), ADR-0036 (lock des onze familles de contrats), ADR-0037 D6 (`docs/adr/0037-authorized-execution-native-core.md:90` : le cœur natif reste sans dépendance LangGraph), ADR-0045 et I-32 (isolation par construction).
- **Applique :** I-18 (noyau de sécurité des boucles), I-32 (isolation par construction contre l'injection indirecte), I-09 (tenant obligatoire et RLS), I-11 (licences), ADR-0042 §4 (briques de base sous licence admise).
- **Invariants :** aucun invariant modifié.
- **N'autorise pas :** un type LangChain, LangGraph ou LangSmith dans un contrat canonique ; un checkpointer ou un store LangGraph comme persistance d'un run ; un service managé de l'éditeur ; le paquet `langchain` (chaînes, modèles de prompt, chargeurs) ; une dépendance LangGraph dans un dépôt Rust ; l'ouverture d'une capacité runtime.

## Contexte

### Ce que la doctrine disait

ADR-0032 (D38, 2026-09-09) a tranché entre trois positions : adoption comme cœur, benchmark ponctuel, oracle de recherche non normatif. Le propriétaire a retenu l'oracle : LangGraph nourrit un catalogue de questions et de scénarios de panne, n'entre dans aucun contrat et aucune dépendance. ADR-0037 D6 (D43, 2026-09-10) a confirmé que le cœur natif d'exécution autorisée, le crate `libre-ai-agent-orchestrator`, reste sans dépendance LangGraph, « removable et non normatif » (`libre-ai/execution-continuity-evaluator@5d3275ec6bf5d48cf3cf4fba5ebf81945e11ab90:docs/apps/orchestrator.md:47-50`).

Le catalogue de recherche existe : `libre-ai/execution-continuity-evaluator@5d3275ec6bf5d48cf3cf4fba5ebf81945e11ab90:docs/research/orchestration-patterns/README.md:13-14` épingle `langchain-ai/langgraphjs` au commit `c6910a9ec1c2a84b76fb79b091b0f697a567e027` observé le 2026-09-09, sous licence MIT ; `catalog.v1.json` porte 10 patterns au statut `research-non-normative`, 8 candidats et 2 refusés (`jq '{status, patterns: (.patterns|length)}'` sur le fichier à ce commit). Cet ADR ne touche pas au catalogue : il reste la méthode d'étude.

### Ce que la flotte est

Mesure du 2026-10-23 (`gh repo list libre-ai --limit 100 --json name,isArchived,primaryLanguage`) : 22 dépôts actifs, dont 6 au langage principal Rust (`ai-work-supervision`, `capability-authorization`, `database-policy-inspector`, `execution-continuity-evaluator`, `execution-sandbox`, et le serveur de `information-watch` décidé en Rust par ADR-0054 §1), 1 Swift (`square-control`), 13 TypeScript ou JavaScript. LangGraph n'a pas d'implémentation Rust. Une adoption « sur tout libre-ai » ne peut donc porter que sur la part TypeScript ; c'est la portée de cet ADR.

Aucun code produit n'appelle un modèle aujourd'hui : `gh search code --owner libre-ai` ne trouve `@anthropic-ai/sdk`, `@mistralai/mistralai`, `ai-sdk` ni `rig-core` dans aucun dépôt ; `openai` n'apparaît que dans des verdicts de revue. ADR-0045 avait fait le même relevé le 2026-10-09 : seuls deux outils de forge appellent un modèle. La frontière posée ici l'est donc avant le premier client, comme ADR-0045 le demande.

### Ce que les paquets portent

Versions et licences publiées le 2026-10-23 (`npm view <paquet> version license`) : `@langchain/langgraph` 1.5.2 MIT ; `@langchain/core` 1.3.0 MIT ; `@langchain/langgraph-checkpoint` 1.2.1 MIT ; `@langchain/langgraph-checkpoint-postgres` 1.1.2 MIT ; `langsmith` 0.11.1 MIT, dépendance transitive de `@langchain/core`. Toutes admises par ADR-0042 §4 et I-11.

Avis de sécurité publiés par l'éditeur sur ses dépôts (`gh api repos/langchain-ai/langgraphjs/security-advisories` et `.../langchainjs/...`), lus le même jour. Quatre d'entre eux décrivent exactement les classes de défaut que la doctrine de la flotte isole :

| Avis | Gravité | Publié | Défaut | Corrigé à partir de |
| --- | --- | --- | --- | --- |
| GHSA-wp87-994x-j95x | high | 2026-10-08 | une entrée du graphe peut être interprétée comme une directive de contrôle | `@langchain/langgraph` 1.4.21 |
| GHSA-j87f-x5h5-gr75 | high | 2026-08-21 | désérialisation non sûre dans `JsonPlusSerializer`, exécution de code arbitraire | `@langchain/langgraph` 1.4.12 ; `@langchain/langgraph-checkpoint` 1.1.4 |
| GHSA-8p8h-xj5r-m5wf | high | 2026-10-08 | les espaces de noms des stores Postgres et Redis ne sont pas isolés | `@langchain/langgraph-checkpoint-postgres` 1.0.6 ; `-redis` 1.0.12 |
| GHSA-r399-636x-v7f6 (CVE-2025-68665) | high | 2025-12-23 | injection par sérialisation dans `@langchain/core`, extraction de secrets par des champs contrôlés par la réponse du modèle | `@langchain/core` 1.1.8 |

Lecture : le premier est une confusion donnée/contrôle, la classe d'I-32 ; le deuxième et le quatrième sont des désérialisations d'octets d'origine non fiable, la classe de K3 ; le troisième est une rupture d'isolation entre locataires, la classe d'I-09. Les versions courantes les corrigent tous. Ce que ces avis établissent n'est pas que le paquet est inutilisable, c'est que ses surfaces de persistance et de sérialisation ne sont pas des frontières de la flotte, et ne le seront jamais (§2).

Souveraineté : les bibliothèques sont MIT ; l'éditeur est une entreprise des États-Unis financée en capital-risque ; sa télémétrie LangSmith s'active par variables d'environnement (`LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, alias historiques `LANGCHAIN_*`), et une fois active envoie prompts, sorties d'outils et métadonnées à un service hébergé aux États-Unis. ADR-0032 D4 l'excluait déjà ; le §3 en fait un gate.

## Décision

### 1. LangGraph JS est un runtime admis du worker TypeScript (amende ADR-0032 D1 et D38)

Un worker écrit en TypeScript peut structurer son raisonnement interne avec `@langchain/langgraph` : graphe d'états, nœuds, arêtes conditionnelles, sous-graphes, interruptions, streaming interne. Ce droit vaut pour :

- les produits du catalogue dont la fiche `project.v1.yaml` déclare un appel de modèle de langage (le 2026-10-23, le catalogue en nomme quatre explicitement : P21 assistant de réunion, P33 routeur de modèles, P34 assistant IA, P35 automatisations ; la liste se lit dans les fiches, elle n'est pas figée ici) ;
- l'outillage de la forge écrit en TypeScript qui appelle un modèle (lecteur à froid, orchestrateur de revues en éventail, et leurs successeurs).

Il ne vaut pas pour les dépôts Rust, qui n'ont pas de LangGraph à adopter, ni pour le cœur natif d'exécution autorisée (ADR-0037 D6).

`@langchain/core` est admis comme dépendance transitive de `@langchain/langgraph`, et pour les seuls types que LangGraph lui emprunte. Le paquet `langchain` (chaînes, modèles de prompt, chargeurs de documents, intégrations) n'est pas admis : les appels de modèle se font par le client du fournisseur retenu par la fiche du produit (Clever AI ou Mistral par convention de souveraineté ; local par Magnitude quand la fiche l'exige), derrière une projection Libre AI fermée.

### 2. La frontière d'autorité d'ADR-0032 ne bouge pas (D2, D3, D4 maintenus)

- **Aucun type** LangChain, LangGraph ou LangSmith n'entre dans un contrat canonique, une préimage, un événement ni un digest (D2). Le graphe interne du worker reste opaque et sans droit d'étendre le plan ; le graphe autorisé appartient à l'Orchestrateur ; Missions autorise ; le harness revalide chaque invocation (D3).
- **Aucun checkpointer ni store LangGraph** ne sert de persistance d'un run, d'une mission, d'un état de worker au-delà de l'invocation, ni d'une donnée d'organisation. La persistance de la flotte reste celle d'I-09 (tenant et RLS) et d'I-10 (rétention exécutable, suppression prouvable), par ses propres projections. GHSA-8p8h-xj5r-m5wf mesure pourquoi : l'isolation des locataires n'y est pas une propriété de construction. L'état interne du worker vit en mémoire, dans sa sandbox, et meurt avec l'invocation ; un worker qui doit reprendre reçoit ses faits du run canonique, pas d'un checkpoint.
- **Aucune désérialisation** par les sérialiseurs du paquet d'octets venant d'ailleurs que du processus du worker lui-même (GHSA-j87f-x5h5-gr75, CVE-2025-68665). Tout ce qui entre dans le graphe, entrée initiale comprise, est une donnée au sens d'I-32 et de K2 : une entrée ne peut pas sélectionner une transition hors du couple autorisé déjà fixé par ADR-0037 (GHSA-wp87-994x-j95x).
- **Aucun service managé** : LangSmith, Agent Server, LangGraph Platform et toute surface de traces ou de déploiement de l'éditeur sont hors cible (D4).
- **La promotion d'un pattern** vers un contrat suit la séquence de D5 (`docs/adr/0032-langgraph-pattern-mining-boundary.md:103-114`) sans changement. Admettre le runtime n'ouvre aucune étape de cette séquence.

### 3. Conditions d'entrée d'un dépôt, vérifiées par gate

Un dépôt TypeScript qui ajoute `@langchain/langgraph` satisfait, dans la même pull request :

1. **Versions corrigées.** Toute version résolue du graphe est supérieure ou égale à la version corrigée de chaque avis publié par l'éditeur au jour de la pull request ; le 2026-10-23 : `@langchain/langgraph` ≥ 1.4.21, `@langchain/langgraph-checkpoint` ≥ 1.1.4, `@langchain/core` ≥ 1.1.8. La liste se relit sur les avis, elle n'est pas figée. Le gate de vulnérabilités existant (`osv-scanner` hors ligne) est bloquant.
2. **Épinglage.** Versions exactes dans le manifeste, verrou commité, âge minimal de publication de trois jours (garde supply-chain en vigueur) ; aucun téléchargement à l'exécution.
3. **Clôture des licences.** `check:licenses` vert sur le graphe complet, transitives comprises ; toute licence hors d'ADR-0042 §4 et §11 refuse.
4. **Télémétrie interdite par construction.** Un gate refuse toute occurrence de `LANGSMITH_`, `LANGCHAIN_TRACING`, `LANGCHAIN_API_KEY`, `LANGCHAIN_ENDPOINT` et `LANGCHAIN_CALLBACKS_BACKGROUND` dans le code, la configuration et les fichiers d'environnement du dépôt, hors fixtures de ce gate. Le worker tourne sous la politique réseau de son plan d'exécution (ADR-0034 : liste d'autorisation d'egress), qui ne contient aucun hôte de l'éditeur. Les deux mécanismes sont requis : le premier empêche d'écrire l'activation, le second empêche qu'une activation écrite ailleurs aboutisse.
5. **Pas de persistance LangGraph.** `@langchain/langgraph-checkpoint-*` et les stores du paquet n'entrent pas dans le manifeste ; `check:source` ou son équivalent dans le dépôt les refuse par nom.
6. **Valeur propre mesurée.** La pull request qui introduit le paquet dans un produit porte la mesure demandée par ADR-0032 D5 (`docs/adr/0032-langgraph-pattern-mining-boundary.md:116-119`) : la même tâche écrite sans le paquet, taille du graphe de dépendances, temps de démarrage du worker et consommation mémoire relevés des deux côtés, verbatim. Un écart défavorable n'interdit pas l'adoption, qui est décidée ici ; il est écrit, avec sa date, dans la fiche du produit.

### 4. Le worker reste remplaçable

Un worker LangGraph est qualifié contre les mêmes vecteurs et les mêmes invariants qu'un worker sans framework, et son retrait ne modifie ni Missions, ni l'Orchestrateur, ni l'historique des runs (ADR-0032 D5, étapes 8 et 9). Le premier produit qui adopte le runtime écrit cette preuve de retrait dans ses critères de sortie de phase (I-08) ; les suivants s'y réfèrent.

## Conséquences

- **D38 amendé** : LangGraph reste « jamais une autorité », et devient en plus un runtime admis du worker TypeScript sous les conditions du §3. **D1 d'ADR-0032 amendé** en conséquence ; D2 à D5 inchangés. **D43 et ADR-0037 D6 inchangés** : le cœur natif Rust reste sans dépendance LangGraph.
- **Le catalogue de recherche** de `execution-continuity-evaluator` garde son statut `research-non-normative` et sa méthode ; il devient aussi la liste des scénarios de panne contre lesquels le premier worker LangGraph est qualifié.
- **Aucun dépôt n'est modifié par cet ADR.** Le premier consommateur est le premier produit à modèle qui entre en réalisation selon l'ordre d'ADR-0042 §3, ou l'outillage de forge qui choisit de migrer ; chacun porte les six conditions du §3 dans sa pull request.
- **Deux gates nouveaux à écrire dans le dépôt consommateur**, pas ici : le refus des variables de télémétrie (§3.4) et le refus des paquets de persistance (§3.5). Le gabarit de gate shell de la flotte (neutralisation prouvée, environnement du fils purgé) s'applique.
- **Rien ici ne crée de dépôt, ne modifie de ruleset, n'ouvre de capacité runtime et n'exécute d'acte du propriétaire.**

## Source

Question posée au propriétaire le 2026-10-23, par question structurée, après restitution d'ADR-0032 D38, d'ADR-0037 D43, de la répartition des langages de la flotte et des avis de sécurité :

> Quel périmètre pour LangChain/LangGraph ?

Option retenue, dans sa formulation exacte :

> **LangGraph JS runtime des workers TS (Recommandé)** — Amende D38 : LangGraph admis comme runtime des workers TypeScript des produits à modèle (P21, P33, P34, P35, outillage), jamais dans l'autorité Orchestrator/Missions ni les contrats (D2/D3/D4 maintenus). Conditions D5 : versions ≥ corrigées des CVE, pin, closure licences, gate interdisant toute variable LANGSMITH_*. LangChain (chaînes/prompts) hors périmètre : LangGraph suffit.

Options écartées : « LangChain + LangGraph, workers TS » ; « Adoption comme cœur (option rejetée le 09/09) » ; « Garder D38 tel quel ».

Le message initial du propriétaire, le même jour : « On adopte : […] langchain et langgraph sur tout libre-ai ». La portée « tout libre-ai » est bornée par la mesure de la flotte (section « Contexte ») à sa part TypeScript ; le paquet `langchain` est écarté par l'option retenue.
