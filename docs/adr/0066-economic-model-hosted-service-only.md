# ADR-0066 — Modèle économique commun aux produits : on paie le service d'hébergement, jamais une fonction

- **Statut :** proposé — la fusion de cette pull request vaut signature du propriétaire (ADR-0043).
- **Arbitrage :** Owner-arbitration: 2026-11-15 — quatre choix du propriétaire, pris sur une page de décision à options (ADR-0022/I-24) : « Le service seulement », « Ceux qui entrent en développement », « "Sans frais chez vous. Abonnement si nous l'hébergeons." » et « Nommer le verrou ». La section « Source » cite mot pour mot chaque question, le libellé retenu et la conséquence que la page lui attachait. Le même jour, après la quatrième passe de revue, quatre réponses du propriétaire à des questions à options posées dans la session de l'agent qui tient la pull request : « Oui, aucune fonction réservée » (D1), « Dans son ADR » (D2), « Jamais sans sa condition » (D3) et « Sans frais » (D5, décision nouvelle). La section « Source » les cite dans une sous-section distincte. Ce que l'auteur de cet ADR ajoute à ces textes, et que ces réponses ne couvrent pas, reste marqué « lecture de l'auteur, à confirmer à la signature ».
- **Date de rédaction :** 2026-11-15
- **Portée :** ce qu'une offre hébergée d'un produit du catalogue d'ADR-0042 §1 fait payer, quels produits en ont une, la formule publique qui le dit, et la rédaction du champ `a_la_place_de` des fiches de `ecosystem/produits/`. Ne fixe aucun prix, n'ouvre aucune instance, ne crée aucun dépôt, n'active aucun produit.
- **Amende :**
  - ADR-0054 §4 (D81), « offre hébergée payante » de P02 : l'offre reste, et ce qu'elle vend est borné par D1 ci-dessous ;
  - ADR-0054 §4 (D81), « distribution signée et notarisée à des tiers » de P02 : elle ne se paie pas (D5 ci-dessous) ;
  - la ligne « Pas un éditeur SaaS par défaut » de `docs/positioning/non-goals.md`, complétée dans cette pull request ; l'auto-hébergement et l'export sans verrou sont conservés.
- **Ne modifie pas :** ADR-0033, dont l'interdiction des affirmations absolues, « gratuit » compris ; ADR-0054 §1 à §3 ; D87 (aucune donnée de paiement dans le code de P02) ; ADR-0044 et ADR-0057 pour l'application de P04.
- **Invariants :** aucun invariant modifié. S'appliquent : I-07 (un déploiement est autorisé dépôt par dépôt, sur un environnement choisi par le propriétaire), I-10 (cycle de vie des données : rétention exécutable, suppression prouvable), I-17 (le registre et les ADR sont sur la surface à touche humaine). Une lecture de l'auteur, à confirmer à la signature, qui n'est pas dans le texte d'I-10 : une limite de durée d'archive d'une offre hébergée est une rétention au sens d'I-10. Qu'admettre une offre hébergée pour un produit passe par un ADR n'est plus une lecture de l'auteur : le propriétaire l'a confirmé le 2026-11-15 (D2, « Dans son ADR »), et un ADR est sur la surface d'I-17. S'applique aussi I-29 (toute qualification publique est adjacente à son mécanisme, sa source, sa date de vérification et sa limite : la formule de D3 en est une). La phrase « ni gratuité de l'infrastructure » ne vient pas d'un invariant : elle est dans ADR-0033 D1.
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

Chaque décision donne d'abord le texte retenu par le propriétaire sur la page de décision, puis, s'il y en a une, sa confirmation du même jour, puis ce que l'auteur de cet ADR y ajoute. Sont arbitrés les textes retenus et les confirmations. Ce qui reste sous « lecture de l'auteur » ne l'est pas.

### D1 — Le service seulement

Texte retenu par le propriétaire :

> Mêmes fonctions partout. On paie l'hébergement géré : synchronisation, relève en continu, sauvegardes. Les limites de l'offre hébergée portent sur ce qui coûte : volume, fréquence, durée d'archive.

La règle commune :

- un produit a les mêmes fonctions partout ;
- l'offre hébergée fait payer l'hébergement géré ;
- les limites de l'offre hébergée portent sur ce qui coûte : le volume, la fréquence, la durée d'archive.

Confirmation du propriétaire, le 2026-11-15, sur la lecture de « Mêmes fonctions partout ». Libellé retenu : « Oui, aucune fonction réservée ». Conséquence affichée sous ce libellé :

> Jamais de fonction payante. Seuls l'hébergement géré et ses quotas (volume, fréquence, durée d'archive) se paient. Le gate des fiches pourra s'y appuyer.

Donc :

- aucune fonction n'est réservée à l'offre payante, et aucune fonction ne se paie ;
- « partout » se lit : sur l'instance qu'une personne ou une organisation héberge elle-même, et sur l'offre hébergée ;
- seuls l'hébergement géré et ses quotas se paient.

Lecture de l'auteur, à confirmer à la signature, que cette confirmation ne couvre pas : « synchronisation, relève en continu, sauvegardes » sont des exemples d'hébergement géré, pas une liste fermée. La relève en continu est celui d'un lecteur de flux, comme P02 ; un produit qui ne relève rien n'en a pas. Chaque produit nomme ce que son hébergement géré comprend quand il déclare son offre.

### D2 — Portée : les produits qui entrent en développement

Texte retenu par le propriétaire :

> P02 et P04 aujourd'hui. Chaque nouveau produit dit s'il en a une au moment où il démarre. Les non-objectifs restent vrais.

Le 2026-11-15, les produits qui ont une offre hébergée sont P02 et P04.

- P02 : l'offre d'ADR-0054 §4 reste, sous D1.
- P04 : cet ADR admet une offre hébergée, sous D1. Le Markdown sur disque continue de faire foi (ADR-0042 §3).
- Tout autre produit : il dit s'il a une offre hébergée au moment où il démarre.

Les non-objectifs restent vrais : la cible est du logiciel que chacun peut héberger, répliquer et quitter, avec export sans verrou (`docs/positioning/non-goals.md`).

Le texte retenu ne disait ni où un produit le déclare, ni ce qui vaut tant qu'il ne l'a pas fait. Confirmation du propriétaire, le 2026-11-15, sur l'endroit où un produit déclare son offre hébergée. Libellé retenu : « Dans son ADR ». Conséquence affichée sous ce libellé :

> Une trace signée par produit. Sans elle, pas d'offre hébergée et le gate refuse le champ "offre". P02 et P04 sont déjà couverts.

Donc :

- un produit déclare son offre hébergée dans son ADR ;
- sans cet ADR, il n'a pas d'offre hébergée ;
- P02 (ADR-0054 §4) et P04 (cet ADR) sont déjà couverts.

Le champ « offre » et le gate que cette conséquence nomme n'existent pas dans ce dépôt le 2026-11-15, et cette pull request ne les écrit pas (voir « Ce qui n'est pas décidé ici »).

### D3 — Formule publique

Texte retenu par le propriétaire, pour la formule :

> Sans frais chez vous. Abonnement si nous l'hébergeons.

Et pour ce qu'elle fait :

> Dit la condition. Conforme à la règle de marque. Vaut pour tous les produits concernés.

Le mot « gratuit » reste interdit comme affirmation absolue (ADR-0033, inchangé).

Confirmation du propriétaire, le 2026-11-15, sur l'emploi de « Sans frais ». Libellé retenu : « Jamais sans sa condition ». Conséquence affichée sous ce libellé :

> Toute mention porte "chez vous" ou l'équivalent. Vérifiable par un gate sur le site et dans les fiches.

Donc « Sans frais » ne s'emploie jamais seul : toute mention porte sa condition, « chez vous » ou l'équivalent. Sans elle, il se lirait comme l'affirmation absolue qu'ADR-0033 interdit, et comme une qualification publique sans sa limite (I-29). Le gate que cette conséquence nomme n'existe pas dans ce dépôt le 2026-11-15, et cette pull request ne l'écrit pas.

Lecture de l'auteur, à confirmer à la signature, que cette confirmation ne couvre pas :

- « Sans frais chez vous » porte sur le logiciel. La machine, le réseau et le temps de la personne qui héberge restent à sa charge, ce qu'ADR-0033 D1 dit déjà (« ni gratuité de l'infrastructure »). La formule n'est pas une promesse de coût nul ;
- « les produits concernés » se lit : les produits qui ont une offre hébergée au sens de D2.

### D4 — `a_la_place_de` nomme le verrou

Texte retenu par le propriétaire :

> Chaque fiche dit ce que la catégorie fait payer ou enferme. Je propose les six formules sur une prochaine page.

Dans le champ `a_la_place_de` des fiches de `ecosystem/produits/`, chaque fiche dit ce que la catégorie d'outil remplacée fait payer ou enferme, au lieu de dire « par abonnement ». La règle est écrite dans `ecosystem/produits/README.md`. C'est une règle de rédaction : le gate ne la lit pas.

Les formules elles-mêmes ne sont pas arbitrées ici : le texte retenu les renvoie à une page suivante. Le « six » de ce texte était une erreur de la page : 25 fiches portaient « par abonnement » quand elle a été présentée (mesure ci-dessous).

### D5 — L'application signée de P02 ne se paie pas

Décision du propriétaire du 2026-11-15, prise après la page de décision. ADR-0054 §4 (D81) dit P02 « commercial en deux sens : distribution signée et notarisée à des tiers, et offre hébergée payante pour plusieurs organisations ». Il ne disait pas si la distribution signée se paie. La question posée au propriétaire portait sur ce point. Libellé retenu : « Sans frais ». Conséquence affichée sous ce libellé :

> L'application signée se télécharge sans frais ; seul le service hébergé se paie. Cohérent avec "aucune fonction réservée". À écrire dans l'ADR-0066 avant fusion.

Donc :

- l'application signée et notarisée de P02 se télécharge sans frais ;
- pour P02, seul le service hébergé se paie, sous D1 ;
- D81 est amendé sur ce point : sa « distribution signée et notarisée à des tiers » ne se paie pas. Son « offre hébergée payante » reste.

D87 n'est pas modifié : plans et quotas sont dans l'application, le paiement est hors application, et le code ne porte aucune donnée de paiement, aucune donnée de carte et aucun webhook de prestataire de paiement (ADR-0054 §4).

Lecture de l'auteur, à confirmer à la signature :

- les plans et quotas de D87 portent sur le service hébergé de P02, le seul qui se paie ; l'application téléchargée n'en reçoit pas qui lui retirerait une fonction (D1) ;
- sous D3, une mention publique de ce « sans frais » porte sa condition, comme toute autre.

## Conséquences

- `docs/positioning/non-goals.md` dit ce qu'une offre hébergée vend et quels produits en ont une. Sa ligne garde son titre.
- ADR-0054 porte « Amendé par : ADR-0066 » dans sa ligne de statut, pour l'offre hébergée (D109) et pour la distribution signée (D114).
- La brique `EXP-08` (offre hébergée) cite cet ADR, D109 et D110.
- `vision.md`, lu sous ses amendements, cite cet ADR dans son préambule.
- Une fonction qui n'existe que sur l'instance hébergée contredit D1. Aucun gate ne le vérifie aujourd'hui : c'est une règle de revue.
- Les fiches qui portent encore « par abonnement » dans `a_la_place_de` ne sont pas réécrites ici. Mesures du 2026-11-15, à rejouer avant de s'en servir : `git grep -l "par abonnement" <commit> -- 'ecosystem/produits/*.yaml' | wc -l` répond 25 sur le commit `e0c2832`, écrit avant la fusion de #187, et 23 sur cette branche une fois la branche servie, qui porte #187, fusionnée en elle. Chaque réécriture est une proposition d'agent, à inscrire dans `a_relire`.
- La fiche du nouveau produit P41 (ADR-0067) suit D4.

## Ce qui n'est pas décidé ici

- Les prix, les paliers et les seuils de volume, de fréquence et de durée d'archive.
- Le contenu de l'offre hébergée de P04 : ce qui est synchronisé, où, et sous quelle garantie.
- Le mode de paiement hors de P02. D87 (paiement hors application, aucune donnée de paiement dans le code) est écrit pour P02 seul ; cet ADR ne l'étend pas.
- Ce que « commercial » veut dire pour la distribution signée de P02, maintenant qu'elle ne se paie pas (D5).
- Lequel de ses ADR porte la déclaration d'offre hébergée d'un produit, s'il en a plusieurs (D2).
- L'endroit où la formule de D3 est affichée. Le site vit dans un autre dépôt.
- Les formules de `a_la_place_de`, fiche par fiche (D4).
- Les gates que les confirmations du 2026-11-15 nomment : celui des fiches qui s'appuierait sur D1, celui qui refuserait un champ « offre » sans ADR (D2), celui qui vérifierait la condition de « Sans frais » sur le site et dans les fiches (D3). Ni ces gates ni le champ « offre » ne sont écrits ici, et aucun gate ne vérifie D4.
- Les « lectures de l'auteur » qui restent marquées, que la signature confirme ou corrige : les exemples d'hébergement géré (D1), la portée de « Sans frais chez vous » et de « produits concernés » (D3), les deux lectures de D5, et la glose sur I-10 de la ligne « Invariants ».

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

### Confirmations du propriétaire, 2026-11-15, après la passe 4 de revue

Canal : des questions à options posées au propriétaire dans la session de l'agent qui tient la pull request. Ces questions ne sont pas versionnées, et ce canal n'est pas la page de décision ci-dessus. L'auteur de ce commit a reçu par son mandat chaque question sous forme résumée, et le libellé retenu et sa conséquence mot pour mot. La colonne « Question » donne donc un résumé, pas le texte posé. Les options écartées n'ont pas été transmises.

| Décision | Question (résumée) | Libellé retenu | Conséquence affichée |
| --- | --- | --- | --- |
| D1 | Lecture de « Mêmes fonctions partout » | « Oui, aucune fonction réservée » | « Jamais de fonction payante. Seuls l'hébergement géré et ses quotas (volume, fréquence, durée d'archive) se paient. Le gate des fiches pourra s'y appuyer. » |
| D2 | Où un produit déclare son offre hébergée | « Dans son ADR » | « Une trace signée par produit. Sans elle, pas d'offre hébergée et le gate refuse le champ "offre". P02 et P04 sont déjà couverts. » |
| D3 | « Sans frais » | « Jamais sans sa condition » | « Toute mention porte "chez vous" ou l'équivalent. Vérifiable par un gate sur le site et dans les fiches. » |
| D5 | L'application signée et notarisée de P02 (ADR-0054 §4, D81) se paie-t-elle ? | « Sans frais » | « L'application signée se télécharge sans frais ; seul le service hébergé se paie. Cohérent avec "aucune fonction réservée". À écrire dans l'ADR-0066 avant fusion. » |

Les deux autres réponses du même lot portent sur ADR-0067 et y sont citées. Les six sont reproduites dans `docs/reviews/economic-model-p41-2026-11-15/REVIEW.md`.

## Preuves

- Numéro d'ADR dérivé le 2026-11-15 : `ls docs/adr | grep -oE '^00[0-9]{2}' | sort | tail -1` répond `0065`. Aucune pull request ouverte ne réserve de numéro : `gh pr diff <n> --name-only | grep '^docs/adr/'` ne répond rien pour #163, #166 et #187. Donc 0066, et 0067 pour la scission de P15.
- Numéros de décision : `grep -oE '^\| D[0-9]+' docs/decisions/DECISION-REGISTER.md | sort -t D -k2 -n | tail -1` répond `| D108`. Donc D109 à D112 ici, D113 pour ADR-0067. Rejouée avant d'inscrire D5, la même commande répond `| D113` : D5 porte D114.
- ADR-0054 §4 lu avant d'écrire D5 : `grep -n -E 'commercial|Le paiement est hors application' docs/adr/0054-*.md`.
- Offre hébergée dans la doctrine avant cet ADR : `grep -rn "offre hébergée" docs/adr docs/positioning` ne nomme que P02.
- Invariants cités : `grep -n -E '^\| I-(07|10|17|29) ' docs/decisions/INVARIANTS.md` donne leur texte ; « ni gratuité de l'infrastructure » se lit par `grep -n "gratuité" docs/adr/0033-*.md`.
