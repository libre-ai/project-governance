# ADR-0066 — Modèle économique commun aux produits : on paie le service d'hébergement, jamais une fonction

- **Statut :** proposé — la fusion de cette pull request vaut signature du propriétaire (ADR-0043).
- **Arbitrage :** Owner-arbitration: 2026-11-15 — quatre choix du propriétaire, pris sur une page de décision à options (ADR-0022/I-24) : « Le service seulement », « Ceux qui entrent en développement », « "Sans frais chez vous. Abonnement si nous l'hébergeons." » et « Nommer le verrou ». La section « Source » cite mot pour mot chaque question, le libellé retenu et la conséquence que la page lui attachait. Ce que l'auteur de cet ADR ajoute à ces textes est marqué « lecture de l'auteur, à confirmer à la signature ».
- **Date de rédaction :** 2026-11-15
- **Portée :** ce qu'une offre hébergée d'un produit du catalogue d'ADR-0042 §1 fait payer, quels produits en ont une, la formule publique qui le dit, et la rédaction du champ `a_la_place_de` des fiches de `ecosystem/produits/`. Ne fixe aucun prix, n'ouvre aucune instance, ne crée aucun dépôt, n'active aucun produit.
- **Amende :**
  - ADR-0054 §4 (D81), « offre hébergée payante » de P02 : l'offre reste, et ce qu'elle vend est borné par D1 ci-dessous ;
  - la ligne « Pas un éditeur SaaS par défaut » de `docs/positioning/non-goals.md`, complétée dans cette pull request ; l'auto-hébergement et l'export sans verrou sont conservés.
- **Ne modifie pas :** ADR-0033, dont l'interdiction des affirmations absolues, « gratuit » compris ; ADR-0054 §1 à §3 ; D87 (aucune donnée de paiement dans le code de P02) ; ADR-0044 et ADR-0057 pour l'application de P04.
- **Invariants :** aucun invariant modifié. S'appliquent : I-07 (un déploiement est autorisé dépôt par dépôt, sur un environnement choisi par le propriétaire), I-10 (cycle de vie des données : rétention exécutable, suppression prouvable), I-17 (le registre et les ADR sont sur la surface à touche humaine). Deux lectures de l'auteur, à confirmer à la signature, qui ne sont pas dans le texte de ces invariants : une limite de durée d'archive d'une offre hébergée est une rétention au sens d'I-10 ; admettre une offre hébergée pour un produit passe par un ADR au sens d'I-17. S'applique aussi, I-29 (toute qualification publique est adjacente à son mécanisme, sa source, sa date de vérification et sa limite : la formule de D3 en est une). La phrase « ni gratuité de l'infrastructure » ne vient pas d'un invariant : elle est dans ADR-0033 D1.
- **N'autorise pas :** l'ouverture d'une instance hébergée ; une fonction réservée à une offre payante ; l'emploi de « gratuit » comme affirmation absolue (ADR-0033).

## Contexte

État de la doctrine le 2026-11-15, avant cet ADR :

- ADR-0054 §4 (D81) : P02 a une offre hébergée payante pour plusieurs organisations. C'est le seul produit du catalogue qui en a une.
- `docs/positioning/non-goals.md` : « Pas un éditeur SaaS par défaut. » La cible est du logiciel que chacun peut héberger, répliquer et quitter.
- ADR-0033 : les affirmations absolues, dont « gratuit », restent interdites. Son D1 dit que « posséder » ne signifie « ni gratuité de l'infrastructure, ni absence de dépendance, ni contrôle absolu ».
- Aucun document ne dit ce qu'une offre hébergée fait payer : le service, des fonctions, ou les deux.

Deux commentaires du propriétaire, écrits le 2026-11-15 sur la page de relecture du catalogue, précèdent la décision du même jour, qui les remplace. Ni cette page ni ces commentaires ne sont versionnés : leur texte est celui que l'auteur de cet ADR a reçu par son mandat.

Sur la fiche de P02 :

> Gratuit par design ; si besoin de synchro entre les devices payant ; option de filtre regexp et autre payant si j'héberge sinon dispo gratuitement

Sur la fiche de P04 :

> Gratuit et auto hébergement possible. Abo si je dois gérer le service

Le premier commentaire faisait payer, sur l'instance hébergée, une fonction (le filtre par expression régulière) que le logiciel hébergé par la personne donnait sans frais. D1 retire cette différence : la fonction est partout, et seul le service se paie.

Mesure datée du 2026-11-15, à rejouer avant de s'en servir. Elle vient d'un relevé de pages officielles de sept lecteurs de flux, lu par un outil qui résume les pages : c'est un fait inféré d'un résumé, pas une lecture intégrale. Aucune marque n'est nommée ici.

- Chez l'un des sept, le filtrage est réservé au palier payant.
- Chez un autre, les expressions régulières sont réservées au palier le plus cher.
- Deux lecteurs libres donnent toutes les fonctions.
- L'un d'eux ne fait payer que l'hébergement, avec le même code.

## Décision

Chaque décision donne d'abord le texte retenu par le propriétaire, puis ce que l'auteur de cet ADR y ajoute. Seul le premier est arbitré.

### D1 — Le service seulement

Texte retenu par le propriétaire :

> Mêmes fonctions partout. On paie l'hébergement géré : synchronisation, relève en continu, sauvegardes. Les limites de l'offre hébergée portent sur ce qui coûte : volume, fréquence, durée d'archive.

La règle commune :

- un produit a les mêmes fonctions partout ;
- l'offre hébergée fait payer l'hébergement géré ;
- les limites de l'offre hébergée portent sur ce qui coûte : le volume, la fréquence, la durée d'archive.

« Synchronisation, relève en continu, sauvegardes » sont des exemples d'hébergement géré, pas une liste fermée. La relève en continu est celui d'un lecteur de flux, comme P02 ; un produit qui ne relève rien n'en a pas. Chaque produit nomme ce que son hébergement géré comprend quand il déclare son offre.

Lecture de l'auteur, à confirmer à la signature :

- « partout » se lit : sur l'instance qu'une personne ou une organisation héberge elle-même, et sur l'offre hébergée ;
- « mêmes fonctions partout » se lit aussi dans l'autre sens : aucune fonction n'est réservée à l'offre payante.

### D2 — Portée : les produits qui entrent en développement

Texte retenu par le propriétaire :

> P02 et P04 aujourd'hui. Chaque nouveau produit dit s'il en a une au moment où il démarre. Les non-objectifs restent vrais.

Le 2026-11-15, les produits qui ont une offre hébergée sont P02 et P04.

- P02 : l'offre d'ADR-0054 §4 reste, sous D1.
- P04 : cet ADR admet une offre hébergée, sous D1. Le Markdown sur disque continue de faire foi (ADR-0042 §3).
- Tout autre produit : il dit s'il a une offre hébergée au moment où il démarre.

Les non-objectifs restent vrais : la cible est du logiciel que chacun peut héberger, répliquer et quitter, avec export sans verrou (`docs/positioning/non-goals.md`).

Lecture de l'auteur, à confirmer à la signature. Le texte retenu ne dit ni où un produit le déclare, ni ce qui vaut tant qu'il ne l'a pas fait :

- un produit le dit par l'ADR qui fixe sa première version ;
- tant qu'il ne l'a pas dit, il n'a pas d'offre hébergée ; un produit qui en ouvrirait une sans l'avoir dit contredirait D2.

### D3 — Formule publique

Texte retenu par le propriétaire, pour la formule :

> Sans frais chez vous. Abonnement si nous l'hébergeons.

Et pour ce qu'elle fait :

> Dit la condition. Conforme à la règle de marque. Vaut pour tous les produits concernés.

Le mot « gratuit » reste interdit comme affirmation absolue (ADR-0033, inchangé).

Lecture de l'auteur, à confirmer à la signature :

- la formule « dit la condition » : la condition, « chez vous », accompagne donc toujours « Sans frais ». « Sans frais » ne s'emploie jamais seul. Sans sa condition, il se lirait comme l'affirmation absolue qu'ADR-0033 interdit, et comme une qualification publique sans sa limite (I-29) ;
- « Sans frais chez vous » porte sur le logiciel. La machine, le réseau et le temps de la personne qui héberge restent à sa charge, ce qu'ADR-0033 D1 dit déjà (« ni gratuité de l'infrastructure »). La formule n'est pas une promesse de coût nul ;
- « les produits concernés » se lit : les produits qui ont une offre hébergée au sens de D2.

### D4 — `a_la_place_de` nomme le verrou

Texte retenu par le propriétaire :

> Chaque fiche dit ce que la catégorie fait payer ou enferme. Je propose les six formules sur une prochaine page.

Dans le champ `a_la_place_de` des fiches de `ecosystem/produits/`, chaque fiche dit ce que la catégorie d'outil remplacée fait payer ou enferme, au lieu de dire « par abonnement ». La règle est écrite dans `ecosystem/produits/README.md`. C'est une règle de rédaction : le gate ne la lit pas.

Les formules elles-mêmes ne sont pas arbitrées ici : le texte retenu les renvoie à une page suivante. Le « six » de ce texte était une erreur de la page : 25 fiches portaient « par abonnement » quand elle a été présentée (mesure ci-dessous).

## Conséquences

- `docs/positioning/non-goals.md` dit ce qu'une offre hébergée vend et quels produits en ont une. Sa ligne garde son titre.
- La brique `EXP-08` (offre hébergée) cite cet ADR, D109 et D110.
- `vision.md`, lu sous ses amendements, cite cet ADR dans son préambule.
- Une fonction qui n'existe que sur l'instance hébergée contredit D1. Aucun gate ne le vérifie aujourd'hui : c'est une règle de revue.
- Les fiches qui portent encore « par abonnement » dans `a_la_place_de` ne sont pas réécrites ici. Mesures du 2026-11-15, à rejouer avant de s'en servir : `git grep -l "par abonnement" <commit> -- 'ecosystem/produits/*.yaml' | wc -l` répond 25 sur le commit `e0c2832`, écrit avant la fusion de #187, et 23 sur cette branche une fois la branche servie, qui porte #187, fusionnée en elle. Chaque réécriture est une proposition d'agent, à inscrire dans `a_relire`.
- La fiche du nouveau produit P41 (ADR-0067) suit D4.

## Ce qui n'est pas décidé ici

- Les prix, les paliers et les seuils de volume, de fréquence et de durée d'archive.
- Le contenu de l'offre hébergée de P04 : ce qui est synchronisé, où, et sous quelle garantie.
- Le mode de paiement hors de P02. D87 (paiement hors application, aucune donnée de paiement dans le code) est écrit pour P02 seul ; cet ADR ne l'étend pas.
- Le premier sens de « commercial » dans D81, la distribution signée et notarisée à des tiers : cet ADR ne dit pas si elle se paie. Lu avec D1, rien ne s'y vend qui soit une fonction ; ce point reste à confirmer par le propriétaire.
- L'endroit où la formule de D3 est affichée. Le site vit dans un autre dépôt.
- Les formules de `a_la_place_de`, fiche par fiche (D4).
- Un gate qui vérifierait D1 ou D4.
- Chaque « lecture de l'auteur » des décisions ci-dessus : la signature la confirme ou la corrige.

## Source

Page de décision présentée au propriétaire le 2026-11-15, à options mutuellement exclusives. Question posée, libellé retenu et conséquence affichée sous ce libellé, mot pour mot :

| Décision | Question posée | Libellé retenu | Conséquence affichée |
| --- | --- | --- | --- |
| D1 | « Fait-on payer le service, ou aussi des fonctions ? » | « Le service seulement » | « Mêmes fonctions partout. On paie l'hébergement géré : synchronisation, relève en continu, sauvegardes. Les limites de l'offre hébergée portent sur ce qui coûte : volume, fréquence, durée d'archive. » |
| D2 | « Quels produits ont une offre hébergée ? » | « Ceux qui entrent en développement » | « P02 et P04 aujourd'hui. Chaque nouveau produit dit s'il en a une au moment où il démarre. Les non-objectifs restent vrais. » |
| D3 | « Comment le dire sur le site et dans les fiches ? » | « "Sans frais chez vous. Abonnement si nous l'hébergeons." » | « Dit la condition. Conforme à la règle de marque. Vaut pour tous les produits concernés. » |
| D4 | « "Par abonnement" dans "À la place de" : on garde ? » | « Nommer le verrou » | « Chaque fiche dit ce que la catégorie fait payer ou enferme. Je propose les six formules sur une prochaine page. » |

La page de décision n'est pas dans ce dépôt. L'auteur de cet ADR a reçu ces textes par son mandat, et n'a pas lu la page. Ils sont reproduits dans `docs/reviews/economic-model-p41-2026-11-15/REVIEW.md`, pour qu'un lecteur du dépôt puisse confronter cet ADR à ce qui a été retenu. Les options écartées n'ont pas été transmises.

Les deux commentaires cités au « Contexte » viennent d'une autre page, la page de relecture du catalogue, non versionnée elle aussi.

## Preuves

- Numéro d'ADR dérivé le 2026-11-15 : `ls docs/adr | grep -oE '^00[0-9]{2}' | sort | tail -1` répond `0065`. Aucune pull request ouverte ne réserve de numéro : `gh pr diff <n> --name-only | grep '^docs/adr/'` ne répond rien pour #163, #166 et #187. Donc 0066, et 0067 pour la scission de P15.
- Numéros de décision : `grep -oE '^\| D[0-9]+' docs/decisions/DECISION-REGISTER.md | sort -t D -k2 -n | tail -1` répond `| D108`. Donc D109 à D112 ici, D113 pour ADR-0067.
- Offre hébergée dans la doctrine avant cet ADR : `grep -rn "offre hébergée" docs/adr docs/positioning` ne nomme que P02.
- Invariants cités : `grep -n -E '^\| I-(07|10|17|29) ' docs/decisions/INVARIANTS.md` donne leur texte ; « ni gratuité de l'infrastructure » se lit par `grep -n "gratuité" docs/adr/0033-*.md`.
