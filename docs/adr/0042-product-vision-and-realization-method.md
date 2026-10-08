# ADR-0042 — Vision produit en 39 produits et méthode de réalisation

- **Statut :** proposed — la fusion de cette pull request constitue l'arbitrage propriétaire
- **Arbitrage :** décisions propriétaires du 2026-10-07, prises par questions structurées (ADR-0022/I-24) au cours d'une étude privée en sept tours, puis consignées dans cette proposition. Owner-arbitration: 2026-10-07
- **Étend :** la direction propriétaire du 2026-09-29 (`docs/adr/2026-09-29-portfolio-consolidation.md`), dont le point 2 (« consolider les familles de dépôts existantes ») reçoit ici sa règle de découpage
- **Cite sans la répéter :** ADR-0041 pour la topologie de l'autorité, l'inventaire de 25 dépôts et l'admission des 19 destinations par bascule de branche par défaut ; rien ici ne la reformule
- **Amende :** ADR-0041 (préambule « N'autorise pas » : transfert d'autorité au-delà des transferts tracés) pour la seule famille Connaissance (§6) ; LEXICON §1 (« les URLs des produits historiques ne sont jamais renommées ») pour le seul dépôt `personal-knowledge-notebook`
- **Applique :** I-03 (un sujet, une autorité), I-04 (noms conformes à l'architecture), I-06 (stack), I-08 (discipline de preuve), I-11 (licences), I-14 (portefeuille par familles), I-16 (naissance d'un repository), I-19 (dogfooding d'abord), I-27 (gate de parité après dogfooding)
- **N'autorise pas :** la création d'un dépôt ; l'activation d'un produit ; le renommage ou l'archivage d'un dépôt avant l'entrée LEXICON et les préconditions du §6 ; l'adoption d'une brique GPL avant la revue juridique du §4 ; une promesse de plateforme non qualifiée

## Contexte

L'inventaire déclare des homes produits (ADR-0041) mais aucune vision ne dit quels
produits le laboratoire construit, dans quel ordre, ni comment un produit est
réputé « au moins aussi bien » que l'outil qu'il remplace. Le propriétaire a
fourni le 2026-10-07 une vision en 39 fiches produit, regroupées en sept
familles, et a tranché la méthode de réalisation au cours de sept tours de
questions. Conformément au point 7 de la direction du 29/09, ce document en est
le résumé décisionnel ; la recherche et les fiches complètes restent privées.

## Décision

### 1. Le portefeuille est de 39 produits en sept familles, plus un

| Famille | Produits |
| --- | --- |
| Connaissance | P01 accès aux sources (nom de code interne, nom public à fixer par LEXICON) · P02 veille documentaire · P03 entretien du corpus bibliographique · P04 notes et mémoire personnelle · P05 wiki · P06 recherche transversale · P07 apprentissage et révision |
| Bureautique et données | P08 documents · P09 tableur · P10 présentations · P11 fichiers et partage · P12 atelier PDF et OCR · P13 formulaires et bases · P14 tableau blanc |
| Collaboration | P15 projets, tickets et support · P16 tâches · P17 messagerie · P18 conversations et visio · P19 agenda · P20 contacts et suivi · P21 assistant de réunion |
| Création et publication | P22 studio vidéo · P23 conception et prototypage · P24 studio audio · P25 sites · P26 promotion éditoriale · P27 ressources créatives |
| Médias et jeu | P28 extension de contrôle multimédia · P29 lecteur vidéo et abonnements · P30 manga, BD et livres · P31 médiathèque · P32 table virtuelle de JdR |
| Maîtrise des outils et des accès | P33 routeur de modèles · P34 assistant IA · P35 automatisations · P36 VPN · P37 coffre de secrets · P38 sauvegarde |
| Pédagogie collective | P39 activités pédagogiques |

S'y ajoute **P40 agencement des fenêtres** (Square Control). Les 39 sont tous
dans le périmètre ; aucun n'est exclu par un argument d'effort.

Rattachements : Capture & Relay (`signalement`) est une capacité de **P15**.
Work Supervision et le confinement des agents sont des **outils de la
fabrique**, hors catalogue, sous le home `ai-work-supervision` déjà désigné par
le point 4 de la direction du 29/09. Hors catalogue et gelés : Travel Planner,
Carrière (fiche gelée en `idea` le 2026-10-08, `libre-ai/carriere#11`).
Public Vote Comparison est retiré du portefeuille ; la suppression de son dépôt
reste un acte propriétaire séparé, avec retrait de son entrée d'inventaire dans
le même geste.

### 2. Ordre : par dépendances, fabrique en parallèle de la boucle documentaire

- **Fabrique** (Work Supervision + confinement) : cœur Rust, CLI/TUI pour le
  moteur et les terminaux, cockpit web en lecture et décision seulement. Le
  confinement est qualifié (C0) avant qu'un agent réel soit lancé par la
  fabrique ; tout agent qu'elle lance passe par lui.
- **Boucle documentaire P01-P04**, en parallèle de la fabrique.
- **En avance de leur famille**, parce que d'autres produits en dépendent :
  P06 recherche, P37 coffre, P38 sauvegarde.
- Les autres produits suivent les produits nommés de leur famille.

Le jalon de preuve suivant porte sur les deux lignes : dix missions
consécutives de bout en bout dans la fabrique, et une première utilisation
réelle de la boucle documentaire par le propriétaire. Chaque clôture de jalon
publie un rapport daté de ses enseignements.

### 3. Le produit est écrit ; les briques de base sont réutilisées

Parcours, modèle métier, permissions, provenance et interface sont **écrits**
sur la stack libre-ai (I-06). Les outils concurrents (Obsidian, Notion,
Inoreader, Miniflux, Zotero…) sont des **références** : ils nourrissent le
besoin, le cahier des charges et la recette, jamais le code.

Les briques de base — crypto, protocoles, codecs, OCR, CRDT, parseurs — sont des
dépendances sous la politique de licences du §4.

### 4. Politique de licences des briques

- Admises : MIT, Apache-2.0, BSD, MPL-2.0, LGPL (liaison dynamique).
- **GPL seulement en processus séparé** (exécutable externe, aucune liaison) ; le
  code libre-ai reste sous les licences d'I-11. Une revue juridique précède la
  première adoption d'une brique GPL.
- Interdites : AGPL, SSPL, et toute licence non OSI ou « source available ».
- La licence est lue dans le fichier de la brique, jamais dans un champ de forge :
  un `NOASSERTION` peut cacher aussi bien du MIT que de l'AGPL. Les dépôts
  open-core sont découpés par dossier (`enterprise/`, `ee/`…) avec un contrôle
  d'import.

### 5. Parité, plateformes, modèle de données

- **Matrice de parité par produit** : chaque fonction des références est
  classée requise, plus tard ou exclue, avec justification ; chaque fonction
  requise donne un test d'acceptation dont le seuil est figé avant la mesure.
  « Au moins aussi bien » = toutes les fonctions requises passent, plus les
  garanties libre-ai (provenance, export sans verrou, sécurité, aucune
  télémétrie). Le gate de parité reste soumis à I-27.
- **Architecture agnostique** : cœur Rust et adaptateurs d'interface par
  plateforme. La **promesse est faite par vague**, après qualification par un
  parcours réel. Vague 1 : web et extension navigateur (Chrome, Firefox). macOS
  natif en vague 2 avec P40. Les autres plateformes ne sont pas promises.
- Les produits du catalogue utilisent le tenant `organization` dès le premier
  produit, et les produits serveur suivent Bun + PostgreSQL/RLS (I-09). Ils
  sont local-first quand leur fiche l'exige.
- **Dérogation de la fabrique** : Work Supervision v0 est mono-utilisateur, sans
  tenant ni approbation tierce. Son stockage est SQLite, avec un journal chaîné
  par empreintes vérifiable hors de la base et un schéma portable vers
  PostgreSQL. Son code est public et générique ; sa configuration est privée,
  hors du dépôt. La dérogation vaut pour la fabrique seulement.

### 6. Topologie : une famille, un dépôt au plus — amendement pour Connaissance

Une famille de produits a **au plus un dépôt produit**. Il est créé, ou
réaffecté, quand le premier produit de la famille entre en réalisation. La
réaffectation d'un dépôt existant passe avant toute création. Le moratoire sur
les nouveaux dépôts est levé famille par famille, par ADR.

**Famille Connaissance (amendement).** `personal-knowledge-notebook` devient le
dépôt de la famille et porte P01 à P07. Cela exige trois actes :

1. une entrée LEXICON fixant le nom de famille, après vérification de sa
   disponibilité. Le renommage n'a lieu qu'ensuite ; jusque-là le dépôt garde
   son nom ;
2. le renommage, avec mise à jour de `ecosystem/repositories.v1.yaml` et de
   l'index régénéré dans la même pull request, de sorte que
   `check-inventory-drift` reste vert ;
3. l'archivage de `information-feed-filter` et `ai-practice-workbench`, avec une
   bannière de redirection vers le dépôt de famille. Leur entrée d'inventaire
   passe à `lifecycle: archived`. L'archivage n'est pas une suppression : un
   dépôt archivé reste lisible et restaurable.

`knowledge`, que la famille comptait parmi ses donneurs, est déjà absorbé dans
`ecosystem/knowledge-projection.ts` par ADR-0041 §4 et ne fait pas partie de cet
amendement.

Les six autres familles reprendront ce modèle par leur propre ADR. Aucun autre
dépôt n'est renommé ni archivé par celui-ci.

## Conséquences et limites

Le portefeuille devient lisible : 40 produits, 7 familles, au plus 8 dépôts
produits à terme, contre un home par produit selon la carte LEXICON initiale.
La règle protège l'invariant « 39 produits ≠ 39 dépôts » sans figer de
découpage interne aux familles.

Le coût de la méthode est assumé : écrire le produit plutôt qu'adopter un
concurrent écarte les candidats AGPL « évidents ». La confrontation privée en
a relevé pour 19 produits, et trois produits n'ont que des briques GPL (P24,
P29, P31). Ces trois-là ne peuvent avancer qu'avec la séparation par
processus et la revue du §4.

Aucune décision de cet ADR ne crée de dépôt, n'active de produit ni ne change
une protection. Les actes du §6 sont des pull requests distinctes, vérifiées
par les gates d'inventaire.

Le LEXICON garde des noms courts antérieurs à ADR-0041 (`notebook`,
`feed-radar`…). Sa remise à niveau sur les noms longs est un sujet distinct, non
traité ici. Seule l'entrée de famille Connaissance est rendue nécessaire.

## Preuves

- Décisions source : étude privée du 2026-10-07 (questions structurées, sept
  tours), dont ce document est le résumé décisionnel au sens du point 7 de la
  direction du 29/09.
- Les licences citées ont été lues dans les fichiers des dépôts le 2026-10-07.
- Inventaire au moment de la proposition : 25 dépôts déclarés = 25 observés
  (`check-inventory-drift` vert), `information-feed-filter`,
  `ai-practice-workbench` et `personal-knowledge-notebook` en
  `lifecycle: active`.
