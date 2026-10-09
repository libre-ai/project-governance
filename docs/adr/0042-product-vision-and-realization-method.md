# ADR-0042 — Vision produit et méthode de réalisation

- **Statut :** proposed — la fusion de cette pull request constitue l'arbitrage propriétaire
- **Arbitrage :** décisions propriétaires du 2026-10-07, prises par questions structurées (ADR-0022/I-24) au cours d'une étude privée en sept tours, puis consignées dans cette proposition. Owner-arbitration: 2026-10-07 ; §8 ajouté sur arbitrage du 2026-10-08. Owner-arbitration: 2026-10-08 ; §9 et §10 ajoutés sur arbitrage du 2026-10-09. Owner-arbitration: 2026-10-09 ; §11 ajouté sur arbitrage du 2026-10-09 (décision Y38). Owner-arbitration: 2026-10-09
- **Étend :** la direction propriétaire du 2026-09-29 (`docs/adr/2026-09-29-portfolio-consolidation.md`), dont le point 2 (« consolider les familles de dépôts existantes ») reçoit ici sa règle de découpage
- **Cite sans la répéter :** ADR-0041 pour la topologie de l'autorité, l'inventaire et l'admission des destinations par bascule de branche par défaut
- **Amende :** ADR-0041, préambule « N'autorise pas » (aucun transfert d'autorité au-delà des transferts tracés), pour le seul domaine Connaissance (§7)
- **Déroge :** I-09 (« tenant obligatoire + RLS »), pour la seule v0 mono-utilisateur de Work Supervision (§5), et pour le seul P40, outil local mono-poste (§9)
- **Remplace :** un point du mandat du 2026-09-15 — Notebook comme première épreuve (remplacé par l'ordre du §3). Le second point initialement remplacé, macOS natif dès le premier palier de plateformes, est rétabli par le §8
- **Applique :** I-03 (un sujet, une autorité), I-04 (noms conformes à l'architecture, préservation des URLs levée), I-06 (stack), I-08 (discipline de preuve), I-11 (licences), I-13 (la méthode est le produit zéro), I-14 (portefeuille par couches, aucun décompte codé en dur), I-16 (naissance d'un repository), I-19 (dogfooding d'abord), I-21 (frontière code / données), I-27 (gate de parité après dogfooding)
- **Autorise :** la sortie du gel de P02, P07, P33 et P39 ; l'ouverture des PR du §7 une fois leurs préconditions remplies
- **N'autorise pas :** la création d'un dépôt ; l'activation d'un produit ; le renommage ou l'archivage d'un dépôt hors des préconditions du §7 ; l'adoption d'une brique GPL avant la revue juridique du §4 (portée précisée par le §10) ; une promesse de plateforme non qualifiée

## Contexte

L'inventaire déclare des homes produits (ADR-0041), mais aucune vision ne dit quels
produits le laboratoire construit, dans quel ordre, ni à quelle condition un produit
est « au moins aussi bien » que l'outil qu'il remplace. Le propriétaire a fourni le
2026-10-07 une vision en fiches produit, regroupées par domaines, et a tranché la
méthode de réalisation au cours de sept tours de questions. Conformément au point 7
de la direction du 29/09, ce document en est le résumé décisionnel ; l'étude et les
fiches complètes restent privées.

Vocabulaire : un **domaine** est un regroupement thématique de produits à
l'intérieur d'une couche. Le mot « famille » reste réservé à la couche, au sens
d'I-14.

## Décision

### 1. Le catalogue d'applications

| Domaine | Produits |
| --- | --- |
| Connaissance | P01 accès aux sources (nom de code interne, nom public à fixer par le LEXICON) · P02 veille documentaire · P03 entretien du corpus bibliographique · P04 notes et mémoire personnelle · P05 wiki · P06 recherche transversale · P07 apprentissage et révision |
| Bureautique et données | P08 documents · P09 tableur · P10 présentations · P11 fichiers et partage · P12 atelier PDF et OCR · P13 formulaires et bases · P14 tableau blanc |
| Collaboration | P15 projets, tickets et support · P16 tâches · P17 messagerie · P18 conversations et visio · P19 agenda · P20 contacts et suivi · P21 assistant de réunion |
| Création et publication | P22 studio vidéo · P23 conception et prototypage · P24 studio audio · P25 sites · P26 promotion éditoriale · P27 ressources créatives |
| Médias et jeu | P28 extension de contrôle multimédia · P29 lecteur vidéo et abonnements · P30 manga, BD et livres · P31 médiathèque · P32 table virtuelle de JdR |
| Maîtrise des outils et des accès | P33 routeur de modèles · P34 assistant IA · P35 automatisations · P36 VPN · P37 coffre de secrets · P38 sauvegarde |
| Pédagogie collective | P39 activités pédagogiques |
| Poste de travail | P40 agencement des fenêtres (Square Control) |

Tous les produits de la table sont dans le périmètre ; aucun n'est exclu par un
argument d'effort. P02, P07, P33 et P39, gelés jusqu'ici, sortent du gel et
prennent leur place dans l'ordre du §3.

Rattachements :

- Capture & Relay (`signalement`) est une capacité de **P15**. Sa qualification en
  cours est terminée et publiée, puis il est gelé : aucun nouveau lot avant le
  jalon B′.
- La **fabrique** relève du produit zéro, la méthode (I-13). Ce n'est pas une
  application du catalogue. Ses deux composants ont deux homes distincts :
  Work Supervision dans `ai-work-supervision` (point 4 de la direction du 29/09) ;
  le confinement des agents d'abord comme outillage privé, puis promu dans
  `execution-sandbox` (enveloppe gondolin) quand ses scénarios de qualification
  C0 passent.
- Hors catalogue et gelés : Carrière (fiche gelée en `idea` le 2026-10-08,
  `libre-ai/carriere#11`) ; Travel Planner, dont le gel est décidé mais dont la
  fiche n'est pas modifiée par cet ADR.
- Public Vote Comparison est retiré du portefeuille. La suppression de son dépôt
  reste un acte propriétaire séparé, qui retire son entrée d'inventaire dans le
  même geste.

### 2. Omarchy : des patrons, pas une distribution

Libre-ai ne produit pas de distribution système. Les patrons d'Omarchy
(curation, mises à jour, configuration par défaut) sont repris là où ils servent.
Le confinement des agents est le point de différence, puisque Omarchy lance les
agents en auto-approbation. Un « poste libre-ai » qui distribuerait la suite
redevient discutable quand au moins deux applications sont distribuables.

### 3. Roadmap et ordre

La roadmap prend la forme A′-F′ :

- **A′** : clore la consolidation par son gate ;
- **B′** : dix missions consécutives de bout en bout dans Work Supervision, sans
  fichier de passation hors de l'outil, **et** une première utilisation réelle
  de la boucle documentaire par le propriétaire ;
- **C′-F′** : capacité partagée, continuité, distribution, adoption.

Aucun nouveau dépôt n'est créé avant B′ (**moratoire**). Il est levé domaine par
domaine, par ADR (§7). Chaque clôture de jalon publie un rapport public daté de
ses enseignements, référencé depuis `project-website`.

Ordre de réalisation, par dépendances :

- la **fabrique** : cœur Rust, CLI/TUI pour le moteur et les terminaux, cockpit
  web en lecture et décision seulement, sans pont du navigateur vers un terminal.
  Le cœur est testé avec un faux agent pendant la qualification C0. Aucun agent
  réel n'est lancé par la fabrique avant que C0 soit vert, et tout agent qu'elle
  lance ensuite passe par le confinement ;
- la **boucle documentaire P01-P04**, en parallèle de la fabrique. Pour P04, le
  Markdown sur disque fait foi ; le stockage chiffré en est la réplique. Pour
  P01, le cœur est écrit (plan de collecte, provenance, extraction, politique,
  confinement), et les connecteurs sont des adaptateurs qui appellent en
  processus séparé des briques compatibles, ou sont écrits ;
- en avance de leur domaine, parce que d'autres produits en dépendent : P06
  recherche, P37 coffre, P38 sauvegarde ;
- **P40** : relecture de la spécification v1, puis vague de revue, puis
  spécification v2. Aucun code avant ;
- les autres produits suivent les produits nommés de leur domaine.

Plusieurs lignes produit avancent en même temps, avec un coordinateur par
application. Chaque dépôt a un seul propriétaire à la fois, et ce verrou est
vérifié avant toute écriture.

### 4. Le produit est écrit ; les briques de base sont réutilisées

Parcours, modèle métier, permissions, provenance et interface sont **écrits** sur
la stack libre-ai (I-06), en réutilisant le code récupéré là où il s'insère. Les
outils concurrents (Obsidian, Notion, Inoreader, Miniflux, Zotero…) sont des
**références** : ils nourrissent le besoin, le cahier des charges et la recette,
jamais le code.

Les briques de base (crypto, protocoles, codecs, OCR, CRDT, parseurs) sont des
dépendances, sous la politique suivante :

- admises : MIT, Apache-2.0, BSD, MPL-2.0, LGPL ;
- GPL seulement en processus séparé (exécutable externe, sans liaison). Le code
  libre-ai reste sous les licences d'I-11. Une revue juridique précède la
  première adoption d'une brique GPL ;
- interdites : AGPL et SSPL.

Ce qu'est « adopter une brique GPL » est précisé par le §10.

Les licences permissives ISC, Zlib et Unicode-3.0 sont admises au même titre (§11).

### 5. Modèle de données et dérogation de la fabrique

Les produits du catalogue utilisent le tenant `organization` dès le premier
produit. Les produits serveur suivent Bun et PostgreSQL, avec tenant et RLS
(I-09), et sont local-first quand leur fiche l'exige. P40 en est exempté
nommément (§9).

**Dérogation à I-09.** Work Supervision v0 est mono-utilisateur : sans tenant,
sans rôles, sans approbation tierce. Son stockage est SQLite, avec un journal
chaîné par empreintes vérifiable hors de la base et un schéma portable vers
PostgreSQL. Son code est public et générique ; sa configuration est privée, hors
du dépôt, et sa racine est un paramètre. La frontière d'I-21 est donc tenue : le
dépôt ne contient aucune donnée d'instance. La dérogation vaut pour la seule v0
de la fabrique.

### 6. Parité et plateformes

- **Matrice de parité par produit.** Chaque fonction des références est classée
  requise, plus tard ou exclue, avec sa justification. Chaque fonction requise
  donne un test d'acceptation dont le seuil est figé avant la mesure. « Au moins
  aussi bien » signifie que toutes les fonctions requises passent, plus les
  garanties libre-ai : provenance, export, absence de verrou, sécurité. Le gate
  de parité reste soumis à I-27.
- **Architecture agnostique.** Un cœur Rust et des adaptateurs d'interface par
  plateforme.
- **Promesse par palier de plateformes**, faite après qualification par un
  parcours réel. Le contenu des paliers est fixé par le §8, qui remplace la
  rédaction initiale (premier palier web et extension, macOS natif au second).
  Les autres plateformes ne sont pas
  promises.

### 7. Topologie : un domaine, un dépôt produit au plus — amendement pour Connaissance

Un domaine a **au plus un dépôt produit**, créé ou réaffecté quand le premier
produit du domaine entre en réalisation. Un dépôt existant est réaffecté avant
qu'un nouveau soit créé. Le moratoire du §3 est levé domaine par domaine, par
ADR. Les dépôts de la fabrique, ainsi que les homes hors catalogue
(`carriere`, `travel-itinerary-planner`), ne relèvent pas de cette règle.

**Domaine Connaissance (amendement d'ADR-0041).** `personal-knowledge-notebook`
devient le dépôt du domaine et porte P01 à P07. Le moratoire est levé pour ce
domaine. Les actes, dans l'ordre :

1. une entrée LEXICON fixe le nom du domaine, après vérification de sa
   disponibilité. Jusque-là le dépôt garde son nom ;
2. une pull request prépare le renommage. Elle met à jour **toutes** les
   références de l'autorité, mesurées à la proposition : 13 fichiers hors cet
   ADR et le registre, dont le gate de composition
   (`.github/workflows/validate-composition.yml`,
   `.github/composition/manifest.json`), et l'index régénéré. Le dépôt est
   renommé sur GitHub, puis la pull request est fusionnée aussitôt. Entre ces
   deux actes, `check-inventory-drift` est rouge, et la pull request le dit ;
3. `information-feed-filter` et `ai-practice-workbench` sont archivés, avec une
   bannière de redirection vers le dépôt du domaine. Leurs références (10
   fichiers chacun) sont mises à jour, et leur entrée d'inventaire passe à
   `lifecycle: archived`. Aucun gate ne lit aujourd'hui l'état d'archivage.
   Cette pull request ajoute donc à `check-inventory-drift` la comparaison entre
   `lifecycle: archived` et l'état archivé observé, et elle échoue si les deux
   divergent. L'archivage n'est pas une suppression : un dépôt archivé reste
   lisible et restaurable. Leur code récupéré y reste lisible. Sa réutilisation
   passe par un import avec provenance dans le dépôt du domaine.

`knowledge` est déjà absorbé dans `ecosystem/knowledge-projection.ts` par
ADR-0041 §4 : il n'est pas concerné. Aucun renommage n'exige d'amender le
LEXICON §1, puisque I-04 a levé la préservation des URLs historiques ; seule
l'entrée de nom de l'acte 1 est requise. Les autres domaines suivront ce modèle,
chacun par son propre ADR. Aucun autre dépôt n'est renommé ni archivé par
celui-ci.

### 8. Premier palier : application macOS native et extension — amendement du 2026-10-08

Owner-arbitration: 2026-10-08 — « tous les produits », « app + extension », en
réponse à la question de la portée d'un premier palier natif.

Le premier palier de plateformes devient, **pour tous les produits du
catalogue** :

- une **application macOS native**, adaptateur d'interface du cœur Rust du
  produit (§6). Pour un produit à fichiers locaux, l'application lit et écrit
  directement le dossier qui fait foi, sans pont ni service local ;
- l'**extension navigateur** (Chrome, Firefox), conservée pour ce que seul un
  navigateur voit (capture web, lecture de page). Elle parle au même cœur par
  **native messaging** : le navigateur lance l'hôte et lui parle par stdio, seule
  l'extension déclarée peut l'appeler, et aucun port n'est ouvert sur la
  machine. Un service en écoute sur `localhost` est écarté : toute page web
  pourrait le viser.

Une interface web n'est pas promise au premier palier. Les produits serveur
(Bun + PostgreSQL, §5) sont servis à l'application par leur API. Le contenu du
deuxième palier sera fixé par un ADR ultérieur. La fabrique n'est pas
concernée : son moteur et ses terminaux restent en CLI/TUI et son cockpit en
web (§3). P40 est exempté nommément de l'extension (§9).

Conséquences :

- toute **distribution** d'une application à un tiers exige un compte Apple
  Developer, la signature et la notarisation du binaire, ainsi que la
  déclaration de l'hôte de native messaging auprès de chaque navigateur.
  L'usage réel par le propriétaire (jalon B′) n'en dépend pas ;
- la qualification de chaque produit porte sur deux adaptateurs, l'application et
  l'extension, et sur leur partage d'un même cœur ;
- le point du mandat du 2026-09-15 « macOS natif dès le premier palier » est
  rétabli.

### 9. Exemption nommée de P40 (§5 et §8) — amendement du 2026-10-09

Owner-arbitration: 2026-10-09 — option A de la question Q2 de la spécification v2
de Square Control (privée), qui regroupe les constats S-B7, A-B6 et U-B5 de sa
vague de revue.

P40 (agencement des fenêtres, Square Control) est un outil local mono-poste : il
n'a ni serveur, ni base partagée, ni donnée partagée, ni second utilisateur, et
il ne joue aucun rôle dans un navigateur. Sa frontière d'isolation est le compte
macOS : droits du fichier de configuration et autorisation Accessibilité accordée
par utilisateur. Deux règles du catalogue ne s'y appliquent donc pas :

- **§5 (tenant `organization`, Bun + PostgreSQL/RLS).** Aucun mécanisme (RLS,
  autorisation) n'appliquerait un champ `organization` dans P40. Ce serait une
  frontière déclarée sans être appliquée, contraire à I-08. P40 n'a pas de
  tenant ; c'est une **dérogation nommée à I-09** (« tenant obligatoire + RLS »)
  pour le seul P40, de même forme que celle de Work Supervision v0. Ses données
  concernent une personne et restent sur son poste, ce qui est la règle d'I-21 ;
- **§8 (extension navigateur et hôte de native messaging).** L'extension
  n'aurait aucune fonction propre au navigateur. Elle ouvrirait en revanche un
  canal du navigateur vers un processus qui détient l'autorisation
  Accessibilité, par un manifeste d'hôte installé dans le profil de
  l'utilisateur. P40 n'a pas d'extension.

P40 garde le reste du §8 : son premier palier est une application macOS native,
adaptateur d'interface de son cœur Rust (§6). Le reste de l'ADR s'applique sans
changement, dont la matrice de parité et I-27.

Conditions de réouverture, chacune par ADR :

- si des agencements deviennent partageables entre personnes, le tenant
  `organization` s'applique au service de partage, pas au client local ;
- si une fonction de P40 exige ce que seul un navigateur voit, l'exemption du §8
  est réexaminée.

L'exemption vaut pour le seul P40. Elle ne crée pas de catégorie « outil local »
où un autre produit pourrait se ranger sans son propre arbitrage.

### 10. Appeler un exécutable GPL déjà installé — précision du §4, 2026-10-09

Owner-arbitration: 2026-10-09 — décision D-1 du plan de Work Supervision v0
(privé) : les worktrees sont créés par le `git` du système, appelé en processus
séparé.

Appeler, dans un processus séparé et sans liaison ni redistribution, un
exécutable sous GPL **déjà installé** sur la machine de l'utilisateur n'est pas
« adopter une brique GPL » au sens du §4. Cet usage ne déclenche pas la revue
juridique préalable. Le cas qui motive la précision est `git`, appelé par Work
Supervision pour ses worktrees.

Reste une adoption soumise au §4, revue juridique comprise :

- distribuer un binaire GPL, seul ou avec un produit libre-ai ;
- l'embarquer dans un paquet, une image ou une application ;
- le télécharger ou l'installer pour l'utilisateur ;
- se lier à une bibliothèque GPL, statiquement ou dynamiquement.

Le code libre-ai reste sous les licences d'I-11 ; aucun code GPL n'y est copié.
Si l'exécutable manque, le produit le signale ; l'installer à la place de
l'utilisateur serait une adoption au sens ci-dessus.

### 11. Licences permissives ISC, Zlib et Unicode-3.0 — précision du §4, 2026-10-09

Owner-arbitration: 2026-10-09 — décision Y38 de l'étude privée du 2026-10-07.

Le §4 nomme les licences admises sans nommer ISC, Zlib ni Unicode-3.0. Ces trois
licences permissives sont **admises au même titre que MIT, Apache-2.0 et BSD**.
Elles sont déjà dans la liste `allow` de `[licenses]` des `deny.toml` de la
flotte, ce que ce paragraphe ne change pas ; il aligne la doctrine sur la
politique appliquée. Relevé le 2026-10-09 sur la branche servie :
`deny.toml` et `crates/ecosystem-engine/deny.toml` de cette autorité, et
`deny.toml` d'`ai-model-policy`, admettent `"ISC"`, `"Unicode-3.0"` et `"Zlib"`.

Dépendances rencontrées, licences relevées sur crates.io le 2026-10-09 :

- `ring` (`Apache-2.0 AND ISC`) et `rustls-webpki` (`ISC`), que toute pile
  `rustls` entraîne ;
- `unicode-ident` (`(MIT OR Apache-2.0) AND Unicode-3.0`), utilisé à la seule
  compilation ;
- `foldhash` (`Zlib`), entraîné par `ratatui` dans l'interface terminal de
  Work Supervision.

## Conséquences et limites

Le nombre de dépôts produits suit le nombre de domaines en réalisation, et non le
nombre de produits. Le compte vit dans l'inventaire (I-14), pas dans cet ADR.

La méthode a un coût. Écrire le produit plutôt qu'adopter un concurrent écarte
les candidats AGPL « évidents » de nombreux produits. P24 et P31 n'ont que des
briques GPL. P29 n'a que des clients GPL, mais son backend, `yt-dlp`, ne l'est
pas. Ces produits n'avancent qu'avec la séparation par processus et la revue du
§4.

Cet ADR ne crée aucun dépôt, n'active aucun produit et ne change aucune
protection. Les actes du §7 sont des pull requests distinctes, vérifiées par les
gates d'inventaire.

Le LEXICON garde des noms courts antérieurs à ADR-0041 (`notebook`,
`feed-radar`…). Sa remise à niveau sur les noms longs est un sujet distinct, que
cet ADR ne traite pas.

## Preuves

- Décisions source : étude privée du 2026-10-07 (questions structurées, sept
  tours), dont ce document est le résumé décisionnel au sens du point 7 de la
  direction du 29/09.
- Licences des candidats relevées par l'API GitHub le 2026-10-07. Elles sont à
  relire dans le fichier de licence de la brique avant toute adoption.
- Références mesurées par `git grep` sur l'arbre de la proposition :
  `personal-knowledge-notebook` dans 13 fichiers, `information-feed-filter` et
  `ai-practice-workbench` dans 10 chacun, hors cet ADR et le registre.
  `ecosystem/check-inventory-drift.ts` ne lit pas l'état archivé.
