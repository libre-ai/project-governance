# ADR-0059 — Amendement d'ADR-0056 : bloc de déclaration, ligne `Not-added:`, citations locales, checks requis

- **Statut :** accepted — arbitrages du propriétaire des 2026-10-23 et
  2026-10-24 en chat ; les points (a) à (f) et D102 sont en vigueur à la
  fusion.
- **Arbitrage :** Owner-arbitration: 2026-10-24 — décisions du propriétaire en
  chat les 2026-10-23 et 2026-10-24, consignées sur la consigne « go all » du
  2026-10-24, qui a autorisé l'agent à écrire cette ligne et la pull request.
  La trace datée de l'arbitrage est portée par le corps de la pull request ;
  elle n'est pas recopiée ici au-delà de cette ligne.
- **Date de rédaction :** 2026-10-24
- **Portée :** forme de la description d'une pull request de ce dépôt (D1 et
  D5 d'ADR-0056), sens d'une négative vérifiable, lecture des citations
  locales par le gate de citations épinglées, checks requis de la branche
  servie, et la liste « Ce qui n'est pas décidé ici » d'ADR-0056.
- **Amende :** ADR-0056 D1, la « forme proposée » de la ligne `Origin:`
  (`docs/adr/0056-method-origin-review-dispositions-live-install-refusals-negatives.md:142-144`),
  remplacée par le bloc de déclaration ; ADR-0056 D5, « un gate les confrontera
  au diff » et l'absence de déclaration
  (`docs/adr/0056-method-origin-review-dispositions-live-install-refusals-negatives.md:303`
  et `:309-310`), précisés ; ADR-0056, « Ce qui n'est pas décidé ici »
  (`docs/adr/0056-method-origin-review-dispositions-live-install-refusals-negatives.md:380-391`),
  dont les trois premiers points sont tranchés. Le texte d'ADR-0056 n'est pas
  édité : ADR-0055, qui amende ADR-0042, ne l'a pas édité non plus (sa pull
  request #134 ne touche que son propre fichier et le registre des décisions).
- **Ne modifie pas :** ADR-0042 (le point (f) n'en amende aucune phrase) ;
  ADR-0056 D2, D3 et D4 ; la gravité `blocking` d'une négative démentie par le
  diff (ADR-0056 D5) ; ADR-0050.
- **Applique :** I-17 (surface à touche humaine fermée : un check requis et un
  gate sont des mutations de garde-fou).
- **Invariants :** aucun invariant modifié ; entrée D102 de
  `docs/decisions/DECISION-REGISTER.md`.
- **N'autorise pas :** la modification d'un gate ou de ses données ; le
  gabarit de pull request de `libre-ai/.github` ; un amendement d'ADR-0042 ;
  l'inscription de `yt-dlp` au registre des refus.

## Contexte

ADR-0056 a fixé, le 2026-10-23, la règle de D1 (déclarer l'origine) et celle
de D5 (déclarer ce qu'une pull request n'ajoute pas), et a laissé leur forme et
leur portée aux gates qui les liraient. Ces gates ont fusionné depuis, chacun
sur un arbitrage du propriétaire pris en chat et écrit dans son en-tête, pas
dans un ADR :

- `tools/quality/check-pr-door.ts`, pull request #141 (`0fe0a63`, 2026-10-24),
  lit le bloc de déclaration et la ligne `Origin:` ;
- `tools/quality/check-pr-negatives.ts` et `tools/quality/pr-negatives.v1.json`,
  pull request #144 (`066ef49`, 2026-10-24), lisent la ligne `Not-added:` et la
  confrontent au diff ;
- `tools/quality/check-pinned-citations.ts` et
  `tools/quality/pinned-citations.v1.json`, pull request #133 (`ac514aa`,
  2026-10-23), jugent les citations épinglées des documents.

Le texte signé d'ADR-0056 décrit donc encore une forme que le code ne lit pas
(« une ligne `Origin:` à côté de `Door:` », ligne 142) et laisse ouverts trois
points que le code ou le propriétaire ont tranchés. Cet ADR consigne ces
arbitrages et ne décrit que ce que le code fusionné applique. Toutes les
citations de code ci-dessous sont épinglées sur `066ef49`, tête de la branche
servie au moment de la rédaction ; chacune se rejoue par `git show` du
fichier à ce commit, suivi de `sed -n` sur les lignes citées.

## Décisions

### (a) 2026-10-24 — Les déclarations forment un bloc en tête de la description

Ce point remplace la « forme proposée » de D1. Les déclarations sont les
premières lignes de la description, et seules ces lignes sont lues
(`066ef49:tools/quality/check-pr-door.ts:17-19`). Le bloc reçoit cinq clés,
`Door`, `Second-instrument`, `Origin`, `Owner-arbitration` et `Not-added`
(`066ef49:tools/quality/check-pr-door.ts:162-168`) ; les deux dernières
appartiennent au bloc et sont jugées par d'autres gates. Trois règles, telles
que le code les applique :

- **T1 — le bloc.** Après le retrait d'un BOM initial et la normalisation des
  fins de ligne, la description s'ouvre par zéro ou plusieurs lignes d'en-tête,
  chacune un commentaire HTML complet qui occupe toute la ligne (les en-têtes
  SPDX), puis par le bloc : des lignes consécutives `Clé: valeur` en colonne 0.
  Le bloc se termine à la première ligne vide, exigée, ou à la fin du corps ;
  une ligne non vide qui n'est pas une déclaration, juste après le bloc, fait
  échouer le gate (`066ef49:tools/quality/check-pr-door.ts:28-42` ; code :
  `:466-500`, motif d'en-tête `:178`).
- **T2' — les valeurs.** La syntaxe qui peut cacher du texte est retirée, pas
  modélisée. Les code spans sont lus d'abord, comme CommonMark sur la ligne ;
  un span non fermé refuse la ligne, et tout est admis dans un span fermé.
  Hors code span, une valeur ne porte ni `[` ni `]` (même échappés), ni `~`,
  ni `$`, ni `<` sauf un autolien `http(s)` complet, ni HTML. Une ligne refusée
  fait échouer le gate, et aucune ligne du bloc qui la suit n'est lue
  (`066ef49:tools/quality/check-pr-door.ts:43-53` ; code : `:201`, `:368-415`,
  `:470-489`).
- **T3 — hors du bloc.** Une ligne de clé en colonne 0 ailleurs dans le corps
  fait échouer le gate en la nommant, sauf si elle est dans un commentaire HTML
  ou un bloc de code clôturé ouvert en colonne 0, en début de ligne, juste
  après une ligne vide brute. Après une ligne que cmark laisse ouverte dans un
  bloc HTML à travers les lignes vides (types 1, 3, 4 et 5, ou `--!>`), plus
  aucune ligne n'est exemptée (`066ef49:tools/quality/check-pr-door.ts:54-66` ;
  code : `:502-513`, `:691-707`).

Valeurs : une seule ligne `Door:`, `one-way` ou `two-way` ; `Second-instrument:`
exigée pour une porte `one-way` ; une seule ligne `Origin:`, du vocabulaire de
D1, `observed` avec sa date ISO et sa source
(`066ef49:tools/quality/check-pr-door.ts:70-77` et `:96-131`). Un auteur de
`IMPLICIT_TWO_WAY_AUTHORS` (Dependabot) sans ligne `Door:` ni `Origin:` en est
dispensé (`066ef49:tools/quality/check-pr-door.ts:85-94` et `:129-131`).

Conséquence écrite par #141 : une ligne `Owner-arbitration:` en colonne 0 hors
du bloc fait désormais échouer le check « Door declaration » (T3), alors que
`check-review-evidence` reconnaît le marqueur partout dans la description. Le
marqueur d'arbitrage s'écrit donc dans le bloc de tête.

### (b) 2026-10-23 — La ligne `Not-added:` est unique, séparée par des virgules, facultative

Ce point tranche les deux premiers points ouverts d'ADR-0056 (forme et portée
de la ligne de D5). La ligne est une ligne du bloc de (a), sous la clé
`Not-added:` ; sa valeur passe T2' et porte des valeurs du vocabulaire fermé
de D5, séparées par des virgules, chacune une fois ; deux lignes sont
refusées (`066ef49:tools/quality/check-pr-negatives.ts:23-36` ; code :
`:356-358`, `:372-385`). La ligne est facultative : absente, le gate passe, le
dit et ne lit pas le diff (`066ef49:tools/quality/check-pr-negatives.ts:779-787`).
Seules les négatives déclarées sont confrontées au diff, et parmi elles les
trois vérifiables (`dependency`, `schema`, `workflow`) ; `hosted-service`,
`telemetry` et `public-surface` sont validées comme valeurs du vocabulaire et
imprimées comme non vérifiées par le gate, à lire en revue
(`066ef49:tools/quality/check-pr-negatives.ts:796-812`).

Ce point remplace la phrase de D5 « l'absence de déclaration n'est pas
bloquante tant que le gate de D5 n'existe pas » : le gate existe, et
l'absence de déclaration reste non bloquante, par la facultativité de la
ligne. ADR-0056 D5 disait qu'une pull request qui ajoute une capacité déclare
ce qu'elle n'ajoute pas ; aucun gate ne l'exige, puisqu'un gate ne sait pas ce
qu'est une capacité (ADR-0056, « Ce qui n'est pas décidé ici ») : cette
attente reste une règle de revue.

### (c) 2026-10-24 — Une négative vérifiable ne tient que si sa surface n'est pas touchée

Ce point précise le « un gate les confrontera au diff » de D5. Une négative
vérifiable nomme une **surface**, écrite en donnée dans
`tools/quality/pr-negatives.v1.json`, et tout contact du diff avec cette
surface rend la négative invérifiable : le check échoue en nommant le chemin
(« cannot verify: <chemin> … changed — remove "<valeur>" from Not-added: »).
Le gate ne lit ni manifestes, ni provenance, ni `uses:`
(`066ef49:tools/quality/check-pr-negatives.ts:38-47` ; code : `:822-837`).
`dependency` signifie donc « ne touche pas la surface de dépendance », plus
fort que « n'ajoute pas de dépendance » : une montée de version, un
rafraîchissement de verrou ou un retrait la touchent aussi
(`066ef49:tools/quality/check-pr-negatives.ts:49-52`).

Les règles sont celles de la base : le fichier de données est lu au merge base
de la pull request par `git cat-file blob`, jamais depuis sa tête ; absent ou
illisible à cet endroit, chaque négative vérifiable échoue fermée
(`066ef49:tools/quality/check-pr-negatives.ts:115-118` ; code : `:858-863`,
`:870-888`). Une pull request ne peut donc pas élargir ou rétrécir la surface
qui la juge.

L'en-tête du gate attribue ce sens à une décision de l'orchestrateur prise
après la deuxième revue du 2026-10-23
(`066ef49:tools/quality/check-pr-negatives.ts:38-39`) ; le propriétaire l'a
arbitré le 2026-10-24, et c'est cet arbitrage qui est consigné ici. Une
négative démentie par le diff reste, comme ADR-0056 D5 le fixe, un défaut de
gravité `blocking` ; le gate en fait un check rouge.

### (d) 2026-10-23 — Citations locales jugées contre ce dépôt, sur sa branche servie ; propriétaires étrangers listés

Ces arbitrages précisent le gate de #133 ; ils sont vérifiés dans son code.
Dans un ADR numéroté au-dessus du seuil en donnée (`bareCitationsGuardedAbove`,
53 au 2026-10-24 : `jq .adr.bareCitationsGuardedAbove tools/quality/pinned-citations.v1.json`) :

- une citation locale `<sha>:<chemin>[:<lignes>]` est demandée à **ce dépôt**,
  par le même résolveur et la même grammaire qu'une citation épinglée, avec une
  condition de plus : le commit doit être sur la **branche servie** du distant,
  parce que ce dépôt fusionne par squash et qu'un commit de branche de travail
  disparaît avec elle. La condition vaut aussi pour une citation qualifiée de
  ce dépôt, sinon la qualifier la contournerait. Le nom du dépôt est dérivé de
  son distant `origin`, jamais écrit en donnée ; s'il ne peut pas l'être,
  chaque citation locale échoue
  (`066ef49:tools/quality/check-pinned-citations.ts:38-49` ; code : `:1233-1262`,
  `:1466-1482`, `:1675-1684`, `:1904-1911`) ;
- une citation d'un autre propriétaire `<propriétaire>/<dépôt>@<sha>:<chemin>[:<lignes>]`
  est demandée par git, sur toute branche ou étiquette, quand ce propriétaire
  est listé dans `foreignOwners` avec un motif ; un propriétaire non listé
  échoue, exemption ou non, et un propriétaire listé qu'aucun ADR gardé ne cite
  échoue aussi (`066ef49:tools/quality/check-pinned-citations.ts:50-58` ; code :
  `:1749-1766`, `:1796-1803` ; donnée :
  `066ef49:tools/quality/pinned-citations.v1.json:37-42`).

La pull request #133 consigne ces deux choix comme les points 2 et 4 de
l'arbitrage du propriétaire du 2026-10-23, pris par questions structurées.

### (e) 2026-10-24 — « Negatives declaration » et « Every pinned code citation of the documents resolves » sont des checks requis

Les deux checks sont requis sur la branche servie, à côté de « Door
declaration » et « Bun quality ». Ce sont les noms des jobs
`066ef49:.github/workflows/pr-negatives.yml:30` et
`066ef49:.github/workflows/pinned-citations.yml:50`. Mesure du 2026-10-24 :
`gh api repos/libre-ai/project-governance/rules/branches/migrate%2Frecover-code --jq '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]'`
→ six contextes, dont les deux nommés ici. L'historique du jeu de règles
`forge-reviewed-recovery-admission`
(`gh api repos/libre-ai/project-governance/rulesets/24161111/history`) date
l'ajout de « Every pinned code citation of the documents resolves » du
2026-10-23 à 13:00 (+02:00), sur l'arbitrage du même jour (point 1 de #133 :
« a dedicated job, made required »), et celui de « Negatives declaration » du
2026-10-24 à 10:28 (+02:00). Le propriétaire a confirmé les deux le
2026-10-24.

### (f) 2026-10-24 — Le point `yt-dlp` est retiré de « Ce qui n'est pas décidé ici »

ADR-0056 laissait ouvert « le refus de `yt-dlp` pour P29 et les connecteurs de
P01 : candidat à un amendement d'ADR-0042 »
(`docs/adr/0056-method-origin-review-dispositions-live-install-refusals-negatives.md:382-384`).
Aucun motif de refus n'est écrit dans ce dépôt : `git grep -il yt-dlp` ne
trouve que la phrase d'ADR-0042 qui fait de `yt-dlp` le backend de P29
(`docs/adr/0042-product-vision-and-realization-method.md:339-340`), ADR-0056 et
l'entrée D95 du registre, et `ecosystem/refusals.v1.yaml` n'en porte aucune
entrée. Sans motif, il n'y a pas de refus. Le point est retiré, `yt-dlp` n'est
pas inscrit au registre des refus, et ADR-0042 reste inchangé. Une proposition
future de refus commencerait par écrire son motif en constats, avec une preuve
publique (ADR-0056 D4).

## Conséquences

- Les trois premiers points de « Ce qui n'est pas décidé ici » d'ADR-0056 sont
  tranchés : la forme de la ligne de D5 (b), sa portée (b) et `yt-dlp` (f). Le
  quatrième, les autres règles extraites par le drill, reste ouvert.
- Le registre des décisions gagne D102.
- La description de toute pull request de ce dépôt porte ses déclarations dans
  le bloc de tête ; les checks « Door declaration » et « Negatives
  declaration » le font respecter, et « Every pinned code citation of the
  documents resolves » refuse toute citation locale d'un ADR gardé qui ne vise
  pas un commit de la branche servie.
- Aucun gate, aucune donnée et aucun workflow ne change : cet ADR écrit ce que
  le code applique déjà.

## Ce qui n'est pas décidé ici

- Le gabarit de pull request de `libre-ai/.github` (suite nommée d'ADR-0056) :
  il n'est pas touché.
- L'application de ces gates à d'autres dépôts de la flotte : aucun autre dépôt
  ne les exécute aujourd'hui.

## Numérotation

ADR-0059 et D102 suivent les derniers numéros de la branche servie. Reproduire,
sur sa tête :
`git ls-tree --name-only origin/migrate/recover-code docs/adr/ | sed 's#docs/adr/##' | grep -oE '^[0-9]{4}-[a-z]' | cut -c1-4 | sort -n | tail -1`
→ `0058` (le filtre `-[a-z]` écarte `2026-09-29-portfolio-consolidation.md`) ;
`git show origin/migrate/recover-code:docs/decisions/DECISION-REGISTER.md | grep -oE '^\| D[0-9]+' | tail -1`
→ `| D101`. Mesures du 2026-10-24, tête `066ef49`. Un conflit de numéro à la
fusion se résout par renumérotation, jamais par réutilisation.
