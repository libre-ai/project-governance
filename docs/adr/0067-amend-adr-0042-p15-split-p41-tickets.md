# ADR-0067 — Amendement d'ADR-0042 §1 : P15 garde la capture et le relais de signalements, P41 porte l'outil de tickets

- **Statut :** proposé — la fusion de cette pull request vaut signature du propriétaire (ADR-0043).
- **Arbitrage :** Owner-arbitration: 2026-11-15 — choix du propriétaire sur une page de décision à options (ADR-0022/I-24). Libellé retenu : « Deux produits ». Conséquence affichée sous ce libellé : « P15 garde la capture et le relais ; un nouveau produit porte l'outil de tickets. » Le numéro du nouveau produit, son intitulé et le nouvel intitulé de P15 ne sont pas dans ce texte : ce sont des propositions de l'auteur de cet ADR, à confirmer à la signature.
- **Date de rédaction :** 2026-11-15
- **Portée :** ADR-0042 §1, ligne « Collaboration » du tableau du catalogue ; l'intitulé de P15 ; l'ajout de P41. Ne modifie ni les autres produits, ni l'ordre du §3, ni le jalon B′, ni le moratoire de création de dépôt.
- **Amende :**
  - ADR-0042 §1 (D52) : la ligne « Collaboration » du tableau est modifiée en place, parce que le gate `ecosystem/check-produits.ts` lit le catalogue dans ce tableau à chaque exécution ;
  - ADR-0055 D1 (D94) : dans le texte qu'il donne au premier point des « Rattachements », « P15 (projets, tickets et support) » se lit « P15 (capture et relais de signalements) » ;
  - ADR-0055 D2 (D94) : la phrase « P15 n'est pas scindé. » ne se lit plus à la lettre. Cet ADR sépare P15 en deux produits. La phrase se lit désormais « P15 n'est pas partagé entre deux dépôts. » Le reste de D2 est inchangé : `signalement` reste le seul dépôt porteur de P15, et `ai-work-supervision` reste la fabrique. Voir « Relecture d'ADR-0055 D2 » ;
  - ADR-0064, encore proposé : ses mentions du nombre de produits se lisent « les produits du catalogue d'ADR-0042 §1 ». Voir « Lecture d'ADR-0064 ».
- **Ne modifie pas :** le dépôt porteur de P15 (ADR-0055 D2) ; ADR-0054 ; le titre et le corps d'ADR-0064 hors de la cellule nommée plus bas.
- **Invariants :** aucun invariant modifié. S'appliquent : I-03 (un sujet, une autorité), I-14 (l'inventaire lisible par machine fait foi, aucun décompte codé en dur : cet ADR n'écrit pas le nombre de produits, que le gate imprime), I-16 (naissance d'un dépôt).
- **N'autorise pas :** la création d'un dépôt pour P41 ; l'activation de P41 ; la désignation d'un dépôt porteur pour P41 ; une offre hébergée pour P41, qu'aucune décision n'admet (ADR-0066 D2).

## Contexte

Deux sources du même dépôt décrivaient P15 de deux façons, le 2026-11-15 :

- ADR-0042 §1 l'intitulait « projets, tickets et support » : un outil complet de tickets.
- Sa fiche `ecosystem/produits/P15.v1.yaml` et sa charte (`ecosystem/briques/produit.v1.yaml`, brique `PRD-15`) décrivaient la capture d'un signalement et son relais vers le système de tickets de l'équipe. La charte refuse de « devenir un back-office de tickets à la place de l'outil cible ».

ADR-0055 a fait de `libre-ai/signalement` le seul dépôt porteur de P15. Ce dépôt capture et relaie ; il ne tient pas les tickets.

La revue du catalogue l'a relevé sans le trancher (`docs/reviews/product-catalogue-2026-11-15/REVIEW.md`, « Ce qui reste au propriétaire », point P15) : la fiche est bornée par sa charte, et l'intitulé d'ADR-0042 reste « projets, tickets et support ».

## Décision

### D1 — Deux produits

Texte retenu par le propriétaire :

> P15 garde la capture et le relais ; un nouveau produit porte l'outil de tickets.

P15 et l'outil de tickets sont deux produits. P15 garde la capture et le relais. Son dépôt porteur reste `libre-ai/signalement` (ADR-0055). Aucune décision ne désigne de dépôt porteur pour le nouveau produit.

Propositions de l'auteur, à confirmer à la signature. Le texte retenu ne donne ni numéro ni intitulé :

- le nouveau produit porte le numéro **P41**, le suivant de la série ;
- **P41** reçoit l'intitulé « projets, tickets et support », celui que P15 portait au catalogue. Le texte retenu dit « l'outil de tickets » ; « projets » et « support » viennent de l'ancien intitulé, pas de lui ;
- **P15** reçoit l'intitulé « capture et relais de signalements », repris de la `fonction` de sa fiche. Le texte retenu dit « la capture et le relais ».

Les deux fiches portent `intitule` dans `a_relire`.

Sous ces propositions, la ligne « Collaboration » du tableau d'ADR-0042 §1 devient :

> | Collaboration | P15 capture et relais de signalements · P16 tâches · P17 messagerie · P18 conversations et visio · P19 agenda · P20 contacts et suivi · P21 assistant de réunion · P41 projets, tickets et support |

Le catalogue gagne un produit. Son compte se lit dans la sortie de `bun run check:produits`.

### Relecture d'ADR-0055 D2

ADR-0055 D2 commence par « P15 n'est pas scindé. » La présente décision scinde P15 en deux produits. Les deux phrases ne tiennent pas ensemble à la lettre : D2 est donc amendé, et non laissé intact.

Lecture de l'auteur, à confirmer à la signature : D2 porte le titre « `signalement` est le seul dépôt porteur de P15 », et son texte écarte `ai-work-supervision` comme second porteur. La phrase répondait donc à la question du partage de P15 entre deux dépôts. Elle se lit désormais « P15 n'est pas partagé entre deux dépôts. », ce qui reste vrai après cet ADR. Le propriétaire n'a pas été interrogé sur cette phrase : la signature confirme la relecture ou la remplace.

### Lecture d'ADR-0064

ADR-0064 est encore proposé. Il écrit le nombre de produits ou leur plage à cinq endroits. Mesure du 2026-11-15, à rejouer avant de s'en servir : `git grep -n -E '40 produits|quarante|P01 à P4' -- docs/adr/0064-*.md`, lancé avant l'ajout de sa mention « Amendé par », répond 5 lignes.

| Endroit d'ADR-0064 | Texte | Traitement |
| --- | --- | --- |
| Titre | « les quarante produits sont des briques » | se lit « les produits du catalogue sont des briques » |
| « Amende » | « les 40 produits P01 à P40 » | se lit « les produits du catalogue d'ADR-0042 §1 » |
| « Contexte » | « le catalogue d'ADR-0042 §1 (40 produits, en prose) » | inchangé : c'est un état daté du 2026-11-09, vrai à cette date |
| D1, tableau des couches, couche `produit` | « P01 à P40 » | remplacé par « P01 à P41 », modifié en place dans cette pull request, parce qu'un test de `ecosystem/briques.test.ts` tient la table du code à ce tableau |
| « Ce qui n'est pas décidé » | « au-delà des 40 produits du catalogue » | se lit « au-delà des produits du catalogue » |

Cinq trouvés : un modifié en place, trois couverts par cette clause de lecture, un laissé comme état daté. ADR-0064 n'est pas réécrit au-delà de la cellule nommée : il porte la mention « Amendé par » qui renvoie ici.

## Conséquences

- ADR-0042, ADR-0055 et ADR-0064 portent la mention « Amendé par : ADR-0067 » dans leur ligne de statut, selon la forme d'ADR-0042 et d'ADR-0044. ADR-0054 porte de même « Amendé par : ADR-0066 ».
- `ecosystem/produits/P15.v1.yaml` : `intitule` suit le catalogue et entre dans `a_relire`, comme proposition de l'auteur. `fonction` (« Capture et relais de signalements ») dit ce que le texte retenu dit et sort de `a_relire`. Les autres champs de la liste y restent : la décision ne les a pas relus.
- `ecosystem/produits/P41.v1.yaml` est ajouté. Son `depot` est `null`. Tout champ de contenu, `intitule` compris, est une proposition d'agent inscrite dans `a_relire`. Hors `intitule`, ces champs reprennent un brouillon de fiche de l'outil de tickets, non versionné, écrit avant la scission.
- La brique `PRD-15` de la carte prend le nom « Capture et relais de signalements ». Aucune brique `PRD-41` n'est écrite : une brique `produit` demande une charte, et P41 n'en a pas.
- Le rôle de la couche `produit` de la carte des briques se lit « P01 à P41 » (`ecosystem/briques.ts`), et la page de vision est régénérée.
- P41 suit l'ordre d'ADR-0042 §3 comme « les autres produits » de son domaine. Le moratoire s'applique : aucun dépôt n'est créé pour lui.
- Les fiches qui citent des tickets tenus ailleurs (P16) ne changent pas : aucune ne nomme P15 dans `depend_de`. Mesure du 2026-11-15 : `grep -n "P15" ecosystem/produits/*.yaml` ne répond que dans `P15.v1.yaml`.
- Le site, dans un autre dépôt, nomme encore un seul produit pour les deux. L'aligner est une pull request de ce dépôt.

## Ce qui n'est pas décidé ici

- Le numéro et l'intitulé de P41, et l'intitulé de P15 : propositions de l'auteur (D1).
- Le domaine de P41. Il est inscrit sous « Collaboration », la ligne d'où vient son intitulé. C'est une hypothèse de l'auteur de cet ADR, que la signature confirme ou corrige ; la fiche porte `categorie` dans `a_relire`.
- Le nom public de P41 et celui de P15. `nom_provisoire` reste dans `a_relire` sur les deux fiches.
- Le lien entre les deux produits : P41 reçoit-il les signalements que P15 relaie, et dépend-il de lui ? `depend_de` est vide sur les deux fiches, et dans `a_relire`.
- La forme de la réalisation de P41 et son dépôt porteur.
- La charte de P41.
- La relecture d'ADR-0055 D2 : lecture de l'auteur.

## Source

Page de décision présentée au propriétaire le 2026-11-15. Libellé retenu et conséquence affichée sous ce libellé, mot pour mot :

| Libellé retenu | Conséquence affichée |
| --- | --- |
| « Deux produits » | « P15 garde la capture et le relais ; un nouveau produit porte l'outil de tickets. » |

La page de décision n'est pas dans ce dépôt. L'auteur de cet ADR a reçu ce texte par son mandat, et n'a pas lu la page. La question posée et les options écartées ne lui ont pas été transmises. Le texte est reproduit dans `docs/reviews/economic-model-p41-2026-11-15/REVIEW.md`.

## Preuves

- Numéros : voir ADR-0066, « Preuves ». Cet ADR porte 0067 et D113.
- Motif de l'identifiant : `jq -r '."$defs".identifiant.pattern' ecosystem/schemas/produit.v1.schema.json` répond `^P[0-9]{2}$`. P41 y tient : le schéma n'est pas modifié.
- Le gate dérive le catalogue de l'ADR à l'exécution : avant l'ajout de la fiche de P41, `bun run check:produits` échoue sur « P41: in the catalogue of ADR-0042 §1, and no fiche ».
- Le gate accepte `intitule` dans `a_relire` : avec ce nom ajouté aux fiches de P15 et de P41, `bun run check:produits` passe.
