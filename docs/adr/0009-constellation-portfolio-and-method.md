# ADR-0009 — La constellation comme portefeuille total, gérée par la méthode

- **Statut :** accepted — la ratification est le merge propriétaire de cette pull request
- **Date :** 2026-07-19
- **Arbitrage :** propriétaire, session source-de-vérité du 2026-07-19. Direction constellation quatre couches énoncée par le propriétaire ; but énoncé : « le défi reste de créer cette nouvelle méthode de gestion de tous ces projets en automatisation agentique, c'est mon goal » ; couches reconnues comme produits à part entière ; après passage d'un panel adversarial à trois lentilles (architecture des systèmes, sécurité des boucles, économie/preuve), arbitrage final « reco partout », traceur = la méthode elle-même.
- **Portée :** écosystème — but du projet, topologie finale, doctrine du portefeuille, lois de croissance, sécurité des boucles, ordre de migration, visibilité
- **Étend :** ADR-0008 (topologie multi-repository, marque). **Rend caduque :** la doctrine héritée « l'infrastructure n'est pas une marque publique ».

## Contexte

Le Big Bang (G0–G2) est la refondation : internaliser toutes les capacités dans un repository unique le temps de les re-fonder sur contrats. Il n'a jamais été la destination. L'ADR-0008 a fixé la cible multi-repository sans les couches agents ni le but du projet. Un panel adversarial a établi : (1) qu'une fragmentation à froid en 15-20 repositories vivants est ingérable **humainement** (cascade de mises à jour, diamants de dépendances, intégration tardive) ; (2) que les boucles d'agents exigent des prérequis de sécurité absents des locks actuels ; (3) que l'évidence produite par la forge n'était pas publiée, contredisant le positionnement « preuve par l'exemple ». La réponse du propriétaire convertit ces constats en spécifications : une large surface de repositories n'est pas un problème **si chaque brique est unitairement stable et si l'automatisation agentique couvre l'exploitation** — construire cette méthode est le but du projet.

## Décision

### 1. Le but : le produit zéro est la méthode

Créer **la méthode de gestion agentique d'une constellation de projets** : des boucles d'agents qui opèrent, maintiennent et améliorent la flotte sous des gates vérifiables, avec une touche humaine réduite aux invariants. Les applications et les briques sont à la fois les fins et les bancs d'essai de cette méthode. C'est la mission de la lignée d'orchestration historique, retrouvée et généralisée.

### 2. Topologie : un moyeu, quatre couches

```
MOYEU     libre-ai/libre-ai   autorité unique (contrats, spécifications,
                              doctrine) + atelier des briques à fort churn
                              + CI de flotte (intégration croisée, matrices
                              de compatibilité, source unique des fixtures)
COUCHE 1  les apps            radar · notebook · practices · sessions ·
                              boussole · specifications · model-policy
COUCHE 2  gérer les agents    orchestrator · harness · missions
COUCHE 3  outils des agents   envelope · memory · provenance · proof · artifacts
COUCHE 4  outils des apps     ui · auth · sdk-ts · sdk-rs · starter
TRANSVERSE                    corpus · docs
```

Toute brique consomme le moyeu par dépendances versionnées ; aucune brique ne définit de contrat ; pas de dépendance latérale hors contrats ; « projection » reste réservé aux artefacts générés (ADR-0008 §4).

### 3. Le portefeuille total et son étoile polaire

Chaque couche est une **famille de produits à part entière**, avec son public et sa promesse :

| Famille                                | Public                               | Promesse                                                                      |
| -------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| Couche 1 — apps                        | utilisateurs finaux                  | des outils qui vous respectent : explicables, locaux, réversibles             |
| Couche 2 — la méthode incarnée         | équipes opérant des flottes d'agents | l'automatisation agentique gouvernable : plans bornés, refus, évidence, gates |
| Couche 3 — infrastructure de confiance | constructeurs d'agents               | des agents dignes de confiance par construction                               |
| Couche 4 — atelier applicatif          | constructeurs d'applications         | l'application souveraine assemblée vite et vérifiable                         |
| Transverse — corpus, docs              | décideurs                            | la pratique documentée, opposable                                             |

**L'étoile polaire du portefeuille** — le produit directeur sur lequel tout le reste se navigue — est **la méthode** (couches 2-3 productisées). Les apps sont des produits de plein droit ET les preuves vivantes que la méthode fonctionne : les clients zéro des couches inférieures. Aucun décompte de produits n'est gravé en doctrine : l'inventaire machine-lisible fait foi (§7).

### 4. Deux lois de croissance, indépendantes

- **Loi d'exposition** (surface publique) : un produit obtient sa vitrine publique (repository home, README, roadmap) dès qu'il a **quelque chose de vérifiable** à montrer, selon son échelle de preuve (idée → spécification publiée → utilisable et vérifiable → éprouvé), portée par l'inventaire. Pas de vitrine sans vérifiable.
- **Loi de couverture** (vie opérationnelle) : une brique naît au moyeu, devient satellite publié (registres npm/crates, miroir en lecture seule), puis **repository vivant** quand son contrat est stable (churn mesuré bas) ET que son exploitation est couverte par l'automatisation **prouvée**. Les métriques de couverture (part des opérations sans touche humaine, temps de rétablissement, taux de passage des gates) sont publiées. Il n'existe pas de plafond fixe : **la surface vivante suit la couverture prouvée** — une large constellation est un niveau à débloquer, jamais un état de départ.

### 5. La surface à touche humaine, fermée

Tout appartient aux agents sous gates, sauf : (1) le registre des invariants et les ADRs ; (2) les amendements de contrats verrouillés ; (3) les mutations des garde-fous et de la couche 3 ; (4) les activations (repository produit, brique vivante, nouvelle boucle) ; (5) les escalades de gates. Cette liste ne s'étend que par ADR.

### 6. Noyau de sécurité des boucles (conditionne l'ouverture de la vague 3)

- **Identité des agents** : taxonomie flotte / mission / capacités, jeton attribué par mission, révocation par agent — à spécifier et verrouiller avant toute exécution réelle d'agents (absente des locks actuels, qui couvrent humains et sessions).
- **Classification des données** : `authoritative` / `derived` / `operational` ; les données d'exploitation (sorties d'outils, APIs) ne sont **jamais** autorité et n'autorisent seules aucune écriture sur une source de vérité.
- **Enveloppe d'intégrité** : tout rappel de mémoire porte une enveloppe de contenu non fiable dont l'intégrité est signée et vérifiable.
- **Mutations de la couche 3 et des garde-fous** : revue humaine obligatoire, signature attestant la décision, capacité de retour arrière ; aucun auto-merge sur ces chemins.
- **Registre immuable en production** : le registre des invariants n'est mutable que par pull request revue ; aucune boucle ne modifie ses propres garde-fous.
- **Dogfooding d'abord** : la consommation interne (la forge, les apps) est le client prioritaire de chaque brique ; les besoins externes entrent par need-capture.
- **L'ops de produit est automatisée par la méthode** : notes de release générées depuis l'évidence, advisories, triage — la surface de promesse suit la même loi de couverture que la surface de code.

### 7. Preuve et traceur

- **L'évidence de forge est publiée par défaut** : rapports d'évidence signés, journal public des verdicts de gates, chaque release liée à l'évidence qui l'a autorisée. Exception unique : les détails exploitables d'une défense peuvent être résumés et hachés sur décision propriétaire, la décision étant elle-même journalisée.
- **Les métriques de la loi de couverture sont publiées** : elles pilotent la croissance de la flotte et constituent le corpus opposable du positionnement.
- **Le traceur — première démonstration publique — est la méthode elle-même** : cette forge, gérant cette constellation, auto-documentée — gates, refus, évidence et métriques à l'appui. Livrable dès les premières vagues, avant toute application.
- `ecosystem/repositories.v1.yaml` est la **source unique** de la topologie publique et des états d'exposition ; le profil d'organisation, les descriptions et les gates de dérive en sont des projections vérifiées.

### 8. Ordre de migration — vagues gated

```
vague 0  pré-migration   main = vérité courante seule (tag + retrait des
                         strates obsolètes) ; inventaire machine-lisible ;
                         carte d'autorité documentaire ; première publication
                         d'évidence de forge (traceur, itération 1)
vague 1  couche 4        la plus mûre (construite en G2)
vague 2  couche 3        l'infrastructure de confiance avant les agents
vague 3  couche 2        sous le Specification Lock orchestrateur ;
                         gate d'entrée = noyau de sécurité du §6 verrouillé
vague 4  couche 1        les apps ; la première = sélection propriétaire
                         du moteur ; model-policy rendu public après
                         re-audit secrets/PII
```

G2 (identité → données → harness qualité) s'achève avant la vague 1. Gate d'entrée d'une vague : fondations verrouillées au moyeu. Gate de sortie : produits exposés selon leur échelle de preuve, évidence scellée, gates CI étendues. Différés faute de consommateur : `sdk-rs`, `memory` en brique autonome (arrive avec le lock orchestrateur), `starter` (dérivé de la première app).

### 9. Visibilité

Tous les repositories du portefeuille sont **publics** (pour `model-policy` : après le re-audit du §8). Aucun élément privé personnel n'appartient au périmètre de ce portefeuille ni à ses inventaires.

Amendement ADR-0038 (2026-09-10) : un distant privé temporaire utilisé pour prouver
la première publication n'est pas encore un repository du portefeuille, n'entre dans
aucun inventaire ou état d'exposition, et ne peut contenir que le candidat destiné à
devenir public. Il rejoint le portefeuille uniquement après l'attestation privée
fusionnée et la bascule publique séparée prescrites par ADR-0038/I-30.

## Conséquences

- L'ancien séquencement « neuf apps en parallèle » est re-séquencé (les apps sont la vague 4) ; `docs/transformation/EXECUTION-SEQUENCING.md` mappera vagues ↔ work-packages.
- Le registre des invariants est étendu par la même pull request (I-13 à I-20).
- Le nom propre de l'étoile polaire (la méthode comme marque) est une décision de marque propriétaire à instruire — non bloquante.
- La carte d'autorité documentaire et l'inventaire sont institués en vague 0 ; les gates CI existantes sont étendues à chaque vague ; aucun système de gates parallèle.
- Les décomptes de produits codés en dur dans les surfaces publiques sont remplacés par des projections de l'inventaire.

## Annexe non normative — exigences de la méthode issues du panel

| Constat adversarial                                        | Exigence de la méthode                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Cascade de mises à jour (≈300 PRs/trimestre à 15-20 repos) | agents de bump bout-en-bout sous gates, zéro touche humaine nominale         |
| Diamants de dépendances                                    | matrice de compatibilité automatisée à chaque release du moyeu               |
| Intégration tardive                                        | CI de flotte : intégration croisée exécutée par le moyeu sur les satellites  |
| Divergence des fixtures                                    | source unique au moyeu, projetée                                             |
| Observabilité silotée, déploiement par app                 | traces distribuées et exploitation de flotte automatisées                    |
| Charge de revue humaine                                    | surface à touche humaine fermée (§5) + métriques de couverture publiées (§4) |
