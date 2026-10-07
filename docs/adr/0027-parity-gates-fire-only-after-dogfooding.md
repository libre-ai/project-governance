# ADR-0027 — Parity gates fire only after dogfooding

- **Statut :** accepted — la ratification est le merge propriétaire de cette
  pull request.
- **Arbitrage :** propriétaire, remise à plat du 2026-08-18 (phase produits)
  — généralisation à toute la flotte du pattern de calibrage arbitré
  constaté sur Radar.

Owner-arbitration: 2026-08-18

- **Date de rédaction :** 2026-08-18
- **Portée :** doctrine transverse des fiches `project.v1.yaml` de tout
  produit — quand un `kill_predicate`/`promotion_criteria` fondé sur une
  comparaison de parité peut s'évaluer, ce qu'un audit de parité a le droit
  de mesurer, et où se situe la cible v1 opposable par rapport à l'étalon
  complet. N'instruit aucun recalibrage individuel de fiche : chaque produit
  reste maître de sa propre fiche, dans son propre repository.
- **Étend :** I-16 (les métriques de couverture sont des indicateurs publiés
  a posteriori, jamais des conditions d'existence), I-19 (dogfooding
  d'abord), I-08 (discipline de preuve — phases et critères pondérés,
  preuves datées).
- **N'amende aucun contrat verrouillé.**

## Contexte — le même défaut mesuré trois fois

Les huit audits de parité de `docs/parity/README.md` (`docs/parity/audits/*.md`,
tous datés du 2026-07-22) partagent une méthode identique : la colonne
« Radar »/« Notebook »/« Sessions » de chaque cartographie de traits est
remplie en lisant la **spec** du produit, jamais son code livré —
`docs/parity/audits/PARITY-radar-inoreader.md:13` (« Spec Radar lue
intégralement ») marque chaque trait couvert « Oui (spec) » ; les fiches
Notebook et Sessions le confirment par leur propre en-tête, « Evidence: Deep
research via web + spec cross-reference ». Le fichier `docs/parity/README.md`
porte déjà un avertissement général (« research + DRAFTS for owner review —
not locked specs ») mais rien qui empêche un `promotion_criteria` de fiche
produit de citer ces chiffres comme s'ils mesuraient du code livré. Trois cas
mesurés le montrent :

**Radar.** `feed-radar/project.v1.yaml:52` fixe le seuil `usable-verifiable`
à « covered traits >= 70 of 105 ». Or l'audit source
(`docs/parity/audits/PARITY-radar-inoreader.md:335`) recommande lui-même
« **MVP = Parité-cœur (32 traits couvert)** », T2 restant conditionné à des
arbitrages produit ultérieurs (`docs/parity/README.md:17` : 32/105 mesuré).
La fiche n'a plus été retouchée depuis (`freshness.last_verified_on:
"2026-07-30"`, `feed-radar/project.v1.yaml:41`) : le seuil 70 n'a jamais été
confronté ni à l'audit qui l'a produit ni à du code réel.

**Notebook.** `notebook/project.v1.yaml:56` fixe le même type de seuil —
« covered traits >= 71 of 143 (all 42 ABSENT-T1 closed) » — alors que le
champ `evidence_required` de la **même fiche**, trois lignes plus haut
(`notebook/project.v1.yaml:52`), ne demande que « the 6 T1 core-parity items
shipped » : la fiche se contredit elle-même, le seuil de promotion exigeant
sept fois plus que ce que la fiche déclare nécessaire. Ces six items T1
(détection de mentions non liées, visualisation du graphe, attributs/tags,
recherche avancée, export texte/HTML, undo/redo —
`docs/parity/audits/PARITY-notebook-siyuan.md:274-279`) sont à l'état 0/6
travaillés : la phase `engine` de la fiche est `pending`
(`notebook/project.v1.yaml:82-88`) et le crate `notebook-core` n'a pas encore
d'intégration dans les parcours applicatifs (`current_situation`).
Le dogfooding qui doit démontrer un usage réel mesure en réalité une fixture
vide : `notebook/apps/notebook/src/backup/public-fixture.ts:3` définit
`PUBLIC_FIXTURE` comme `{"blocks":[],...}` — zéro bloc — consommée par le
parcours de qualification Gate B (ADR-0005/0006/0007, D25-D27). Une
qualification qui rejoue une fixture sans contenu ne peut établir aucune
preuve d'usage réel, quel que soit son statut « vert ».

**Sessions.** `sessions/project.v1.yaml:61` fixe « covered traits >= 40 of 62
(baseline 16) and the 6 ABSENT-T1 closed ». L'arithmétique de l'audit source
ne produit jamais 40 : COUVERT (16) + T1 (6) = 22 ; même COUVERT + T1 + tout
T2 (12) ne fait que 34 (`docs/parity/audits/PARITY-sessions-miro.md:47-53`,
« Coverage Counts »). L'audit recommande explicitement « Prioritize T1 only.
T2 deferred post-GA. » (`docs/parity/audits/PARITY-sessions-miro.md:89`,
« Recommended Next Steps », item 3) — un seuil de 40 excède donc la propre
priorisation de l'audit. Premier trait du premier domaine de la cartographie
benchmark, « Canvas & Content »
(`docs/parity/audits/PARITY-sessions-miro.md:8-9`), aucune
occurrence du mot « canvas » n'existe dans le repository Sessions
(`git grep -i canvas` sur `origin/main`, zéro résultat) : le domaine que
l'audit lui-même place en tête de sa cartographie n'a reçu aucun travail.

Le motif commun : un seuil de promotion **conçu au-delà de ce que son propre
audit recommande**, appliqué à un produit dont le jalon dogfooding — l'usage
réel qui validerait que la mesure porte sur quelque chose — n'est pas
atteint. Les trois cas ont fait l'objet d'un arbitrage propriétaire le
2026-08-18 (remise à plat de phase produits) ; le présent ADR généralise le
pattern retenu pour Radar en doctrine transverse, plutôt que de le refaire
séparément pour chaque produit qui reproduira ce défaut.

## Décisions

### D1 — Séquencement temporel : le dogfooding avant la parité

Aucun `kill_predicate` ni `promotion_criteria` fondé sur une comparaison de
parité (couverture de traits face à un benchmark) ne s'évalue avant que le
jalon dogfooding propre au produit soit atteint. Ce jalon est une phase de la
fiche `project.v1.yaml` du produit (le schéma `phases[]` le porte déjà,
générique — aucune extension de schéma n'est nécessaire), dont le critère de
sortie démontre un **usage réel** : un parcours applicatif exercé sur du
contenu produit par un usage véritable, jamais une fixture synthétique vide
comme celle qui masque aujourd'hui l'absence de dogfooding sur Notebook
(voir « Contexte »). Tant que cette phase n'est pas `accepted` avec preuve
datée, un gate ou un rapport de flotte qui cite un pourcentage de parité le
présente comme un **indicateur descriptif** (I-16 : la couverture est un
indicateur publié a posteriori), jamais comme une condition bloquante de
promotion ou de retrait.

### D2 — Un audit de parité mesure du code livré, jamais une spec

Un audit de parité qui compare un produit à un concurrent n'a de valeur
opposable que s'il mesure ce que le produit **fait**, pas ce que sa spec
**promet**. Les huit audits datés du 2026-07-22
(`docs/parity/audits/PARITY-*.md`) mesurent tous une spec — vérifié un par un
sur leurs propres en-têtes de méthode (voir « Contexte ») — et sont donc
requalifiés **« spec-baseline, non opposable »** : ils restent des sources
d'inventaire de traits utiles (la cartographie face au benchmark ne change
pas), mais aucun seuil qu'ils alimentent ne peut fonder une décision de
promotion ou de retrait tant qu'ils n'ont pas été rejoués contre du code
réellement livré. Une bannière portant cette qualification et un renvoi au
présent ADR est ajoutée en tête des huit fichiers par la présente pull
request (voir « Application immédiate »).

### D3 — La cible v1 opposable est le MVP que l'audit recommande lui-même

Quand un `promotion_criteria` fixe un seuil numérique de parité pour la
maturité `usable-verifiable`, ce seuil est celui que l'audit du produit
recommande **lui-même** comme MVP (par exemple, pour Radar, la section
« Recommandation parité & roadmap » de son propre audit
— `docs/parity/audits/PARITY-radar-inoreader.md:333-347` — et non un chiffre
composé a posteriori par l'auteur de la fiche). L'étalon complet — parité T2
incluse — devient l'horizon de la maturité `proven`, jamais une exigence de
v1. Un seuil de promotion qui excède la propre recommandation MVP de son
audit source (les trois cas mesurés en Contexte) est présumé mal calibré et
se corrige en le ramenant à cette recommandation, jamais en réécrivant
l'audit a posteriori pour justifier le seuil déjà fixé.

## Application immédiate (dans ce dépôt)

- Bannière « spec-baseline, non opposable » ajoutée en tête des huit fichiers
  `docs/parity/audits/PARITY-*.md`, avec renvoi au présent ADR (D2).
- `docs/parity/README.md` gagne une ligne pointant vers cette requalification
  et vers D3 (l'écart entre le MVP recommandé par chaque audit et tout seuil
  `usable-verifiable` déjà fixé dans une fiche produit).

## Conséquences

- Le registre des invariants gagne I-27, sourcé par le présent ADR ; le
  registre des décisions gagne D34. **Note sur le numéro :** I-26 aurait été
  le prochain libre sur `main`, mais la PR #59 ouverte au moment de la
  rédaction le revendique déjà pour un autre sujet (backfill I-26 sur
  ADR-0021) — vérifié sur le registre vivant avant de choisir I-27, le
  prochain numéro qu'aucune PR ouverte ne revendiquait.
- Les fiches `project.v1.yaml` de `feed-radar`, `notebook` et `sessions`
  restent inchangées par la présente pull request : leur recalibrage effectif
  (nouveau seuil, phase dogfooding déclarée, ré-exécution de l'audit contre
  du code) est un acte d'exécution propre à chaque repository produit, hors
  du périmètre de ce dépôt d'autorité (`AGENTS.md` — « Product code, product
  specifications... live in their product/satellite repositories »). Le
  présent ADR fixe la règle qu'ils devront appliquer, il ne l'applique pas à
  leur place.
- Tout produit futur qui déclare un `kill_predicate`/`promotion_criteria` de
  parité applique D1-D3 dès sa première fiche — pas seulement les trois cas
  mesurés ici.

## Ce qui n'est pas décidé ici

- Le recalibrage effectif des seuils `promotion_criteria`/`kill_predicates`
  de Radar, Notebook et Sessions : décision et exécution par repository
  produit, sur la base de la règle fixée ici.
- La ré-exécution des huit audits de parité contre du code livré : travail
  produit par produit, déclenché quand chaque dogfooding est atteint —
  aucun calendrier n'est fixé par le présent ADR.
- Un gate CI mécanique qui vérifierait D1 (séquencement dogfooding → parité)
  à l'échelle de la flotte : il exigerait une source fiable et commune du
  statut dogfooding par produit, qui n'existe pas encore sous une forme
  vérifiable automatiquement (une phase `phases[]` nommée ne suffit pas à
  elle seule à distinguer un usage réel d'une fixture vide — voir le cas
  Notebook). Établir un tel gate serait un acte propriétaire distinct
  (I-17), pas une conséquence automatique de ce texte.
