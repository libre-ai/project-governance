# ADR-0066 — Modèle économique commun aux produits : on paie le service d'hébergement, jamais une fonction

- **Statut :** proposé — la fusion de cette pull request vaut signature du propriétaire (ADR-0043).
- **Arbitrage :** Owner-arbitration: 2026-11-15 — quatre choix du propriétaire, pris sur une page de décision à options (ADR-0022/I-24). Les libellés qu'il a retenus sont cités dans la section « Source », sans réinterprétation.
- **Date de rédaction :** 2026-11-15
- **Portée :** ce qu'une offre hébergée d'un produit du catalogue d'ADR-0042 §1 fait payer, quels produits en ont une, la formule publique qui le dit, et la rédaction du champ `a_la_place_de` des fiches de `ecosystem/produits/`. Ne fixe aucun prix, n'ouvre aucune instance, ne crée aucun dépôt, n'active aucun produit.
- **Amende :**
  - ADR-0054 §4 (D81), « offre hébergée payante » de P02 : l'offre reste, et ce qu'elle vend est borné par D1 ci-dessous ;
  - la ligne « Pas un éditeur SaaS par défaut » de `docs/positioning/non-goals.md`, complétée dans cette pull request ; l'auto-hébergement et l'export sans verrou sont conservés.
- **Ne modifie pas :** ADR-0033, dont l'interdiction des affirmations absolues, « gratuit » compris ; ADR-0054 §1 à §3 ; D87 (aucune donnée de paiement dans le code de P02) ; ADR-0044 et ADR-0057 pour l'application de P04.
- **Invariants :** aucun invariant modifié. S'appliquent : I-07 (un déploiement est autorisé dépôt par dépôt, sur un environnement choisi par le propriétaire), I-10 (toute exportation reste possible), I-17 (admettre une offre hébergée pour un produit est un acte de doctrine), I-29 (la possession ne signifie pas la gratuité de l'infrastructure).
- **N'autorise pas :** l'ouverture d'une instance hébergée ; une fonction réservée à une offre payante ; l'emploi de « gratuit » comme affirmation absolue ; une offre hébergée pour un produit qui ne l'a pas déclarée à son entrée en développement.

## Contexte

État de la doctrine le 2026-11-15, avant cet ADR :

- ADR-0054 §4 (D81) : P02 a une offre hébergée payante pour plusieurs organisations. C'est le seul produit du catalogue qui en a une.
- `docs/positioning/non-goals.md` : « Pas un éditeur SaaS par défaut. » La cible est du logiciel que chacun peut héberger, répliquer et quitter.
- ADR-0033 : les affirmations absolues, dont « gratuit », restent interdites. « Posséder » ne signifie pas la gratuité de l'infrastructure.
- Aucun document ne dit ce qu'une offre hébergée fait payer : le service, des fonctions, ou les deux.

Consignes antérieures du propriétaire, que cet ADR remplace. Leur date n'a pas été transmise à l'auteur de cet ADR ; elles précèdent la décision du 2026-11-15.

> Gratuit par design ; si besoin de synchro entre les devices payant ; option de filtre regexp et autre payant si j'héberge sinon dispo gratuitement

Et, pour P04 :

> Gratuit et auto hébergement possible. Abo si je dois gérer le service

La première consigne faisait payer, sur l'instance hébergée, une fonction (le filtre par expression régulière) que le logiciel hébergé par la personne donnait sans frais. D1 retire cette différence : la fonction est partout, et seul le service se paie.

Mesure datée du 2026-11-15, à rejouer avant de s'en servir. Elle vient d'un relevé de pages officielles de sept lecteurs de flux, lu par un outil qui résume les pages : c'est un fait inféré d'un résumé, pas une lecture intégrale. Aucune marque n'est nommée ici.

- Chez l'un des sept, le filtrage est réservé au palier payant.
- Chez un autre, les expressions régulières sont réservées au palier le plus cher.
- Deux lecteurs libres donnent toutes les fonctions.
- L'un d'eux ne fait payer que l'hébergement, avec le même code.

## Décision

### D1 — Le service seulement

Un produit a les mêmes fonctions partout : sur l'instance qu'une personne ou une organisation héberge elle-même, et sur l'offre hébergée.

L'offre hébergée fait payer l'hébergement géré : la synchronisation, la relève en continu, les sauvegardes. Ses limites portent sur ce qui coûte : le volume, la fréquence, la durée d'archive.

Aucune fonction n'est réservée à l'offre payante.

### D2 — Portée : les produits qui entrent en développement

Une offre hébergée existe pour un produit qui entre en développement et qui la déclare à ce moment. Le 2026-11-15, ce sont P02 et P04.

- P02 : l'offre d'ADR-0054 §4 reste, sous D1.
- P04 : cet ADR admet une offre hébergée, sous D1. Le Markdown sur disque continue de faire foi (ADR-0042 §3).
- Tout autre produit : il dit s'il a une offre hébergée au moment où il démarre, par l'ADR qui fixe sa première version. Tant qu'il ne l'a pas dit, il n'en a pas.

Les non-objectifs restent vrais : la cible est du logiciel que chacun peut héberger, répliquer et quitter, avec export sans verrou.

### D3 — Formule publique

La formule publique est :

> Sans frais chez vous. Abonnement si nous l'hébergeons.

Le mot « gratuit » reste interdit comme affirmation absolue (ADR-0033, inchangé).

### D4 — `a_la_place_de` nomme ce que la catégorie verrouille

Dans le champ `a_la_place_de` des fiches de `ecosystem/produits/`, on nomme ce que le genre d'outil remplacé verrouille, au lieu de dire « par abonnement ». La règle est écrite dans `ecosystem/produits/README.md`. C'est une règle de rédaction : le gate ne la lit pas.

## Conséquences

- `docs/positioning/non-goals.md` dit ce qu'une offre hébergée vend et quels produits en ont une. Sa ligne garde son titre.
- La brique `EXP-08` (offre hébergée) cite cet ADR, D109 et D110.
- `vision.md`, lu sous ses amendements, cite cet ADR dans son préambule.
- Un produit qui ouvre une offre hébergée sans l'avoir déclarée à son entrée en développement contredit D2.
- Une fonction qui n'existe que sur l'instance hébergée contredit D1. Aucun gate ne le vérifie aujourd'hui : c'est une règle de revue.
- Les fiches qui portent encore « par abonnement » dans `a_la_place_de` ne sont pas réécrites ici. Mesure du 2026-11-15 sur la base de cette pull request : `grep -l "par abonnement" ecosystem/produits/*.yaml | wc -l` répond 25. Une pull request ouverte le même jour (#187) en réécrit une partie. Chaque réécriture est une proposition d'agent, à inscrire dans `a_relire`.
- La fiche du nouveau produit P41 (ADR-0067) suit D4.

## Ce qui n'est pas décidé ici

- Les prix, les paliers et les seuils de volume, de fréquence et de durée d'archive.
- Le contenu de l'offre hébergée de P04 : ce qui est synchronisé, où, et sous quelle garantie.
- Le mode de paiement hors de P02. D87 (paiement hors application, aucune donnée de paiement dans le code) est écrit pour P02 seul ; cet ADR ne l'étend pas.
- Le premier sens de « commercial » dans D81, la distribution signée et notarisée à des tiers : cet ADR ne dit pas si elle se paie. Lu avec D1, rien ne s'y vend qui soit une fonction ; ce point reste à confirmer par le propriétaire.
- L'endroit où la formule de D3 est affichée. Le site vit dans un autre dépôt.
- Un gate qui vérifierait D1 ou D4.

Lecture de l'auteur de cet ADR, à confirmer à la signature : « Sans frais chez vous » porte sur le logiciel. La machine, le réseau et le temps de la personne qui héberge restent à sa charge, ce qu'ADR-0033 dit déjà (« ni gratuité de l'infrastructure »). La formule n'est donc pas une promesse de coût nul.

## Source

Page de décision présentée au propriétaire le 2026-11-15, à options mutuellement exclusives. Libellés retenus, dans leur formulation exacte :

| Question | Libellé retenu |
| --- | --- |
| Ce qui se paie | « Le service seulement » |
| Portée | « Ceux qui entrent en développement » |
| Formule publique | « Sans frais chez vous. Abonnement si nous l'hébergeons. » |

Le texte de D1 et de D2 reprend les conséquences que la page attachait à chaque libellé. La quatrième décision, D4, a été prise sur la même page : dans `a_la_place_de`, nommer ce que la catégorie verrouille au lieu de dire « par abonnement ».

La page de décision n'est pas dans ce dépôt. L'auteur de cet ADR a reçu les libellés et leurs conséquences par son mandat, et n'a pas lu la page.

## Preuves

- Numéro d'ADR dérivé le 2026-11-15 : `ls docs/adr | grep -oE '^00[0-9]{2}' | sort | tail -1` répond `0065`. Aucune pull request ouverte ne réserve de numéro : `gh pr diff <n> --name-only | grep '^docs/adr/'` ne répond rien pour #163, #166 et #187. Donc 0066, et 0067 pour la scission de P15.
- Numéros de décision : `grep -oE '^\| D[0-9]+' docs/decisions/DECISION-REGISTER.md | sort -t D -k2 -n | tail -1` répond `| D108`. Donc D109 à D112 ici, D113 pour ADR-0067.
- Offre hébergée dans la doctrine avant cet ADR : `grep -rn "offre hébergée" docs/adr docs/positioning` ne nomme que P02.
