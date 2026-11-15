# ADR-0067 — Amendement d'ADR-0042 §1 : P15 garde la capture et le relais de signalements, P41 porte l'outil de tickets

- **Statut :** proposé — la fusion de cette pull request vaut signature du propriétaire (ADR-0043).
- **Arbitrage :** Owner-arbitration: 2026-11-15 — choix du propriétaire sur une page de décision à options (ADR-0022/I-24), dans sa formulation exacte : « Deux produits : P15 garde la capture et le relais ; un nouveau produit porte l'outil de tickets. »
- **Date de rédaction :** 2026-11-15
- **Portée :** ADR-0042 §1, ligne « Collaboration » du tableau du catalogue ; l'intitulé de P15 ; l'ajout de P41. Ne modifie ni les autres produits, ni l'ordre du §3, ni le jalon B′, ni le moratoire de création de dépôt.
- **Amende :**
  - ADR-0042 §1 (D52) : la ligne « Collaboration » du tableau est modifiée en place, parce que le gate `ecosystem/check-produits.ts` lit le catalogue dans ce tableau à chaque exécution ;
  - ADR-0055 D1 (D94) : dans le texte qu'il donne au premier point des « Rattachements », « P15 (projets, tickets et support) » se lit « P15 (capture et relais de signalements) » ;
  - ADR-0064, encore proposé : « les 40 produits P01 à P40 » se lit « les produits du catalogue, P01 à P41 ». Dans le tableau des couches de son D1, la cellule de rôle de la couche `produit` est modifiée en place (« P01 à P41 »), parce qu'un test de `ecosystem/briques.test.ts` tient la table du code à ce tableau. Le reste d'ADR-0064, titre compris, n'est pas réécrit.
- **Ne modifie pas :** ADR-0055 D2. `signalement` reste le seul dépôt porteur de P15, et `ai-work-supervision` reste la fabrique. La phrase « P15 n'est pas scindé » de D2 portait sur le partage de P15 entre ces deux dépôts : elle reste vraie. La scission décidée ici sépare deux produits ; elle ne partage pas un produit entre deux dépôts.
- **Invariants :** aucun invariant modifié. S'appliquent : I-03 (un sujet, une autorité), I-14 (aucun décompte codé en dur : le nombre de produits est imprimé par le gate, il n'est écrit dans aucun document), I-16 (naissance d'un dépôt).
- **N'autorise pas :** la création d'un dépôt pour P41 ; l'activation de P41 ; la désignation d'un dépôt porteur pour P41 ; une offre hébergée pour P41 (ADR-0066 D2).

## Contexte

Deux sources du même dépôt décrivaient P15 de deux façons, le 2026-11-15 :

- ADR-0042 §1 l'intitulait « projets, tickets et support » : un outil complet de tickets.
- Sa fiche `ecosystem/produits/P15.v1.yaml` et sa charte (`ecosystem/briques/produit.v1.yaml`, brique `PRD-15`) décrivaient la capture d'un signalement et son relais vers le système de tickets de l'équipe. La charte refuse de « devenir un back-office de tickets à la place de l'outil cible ».

ADR-0055 a fait de `libre-ai/signalement` le seul dépôt porteur de P15. Ce dépôt capture et relaie ; il ne tient pas les tickets.

La revue du catalogue l'a relevé sans le trancher (`docs/reviews/product-catalogue-2026-11-15/REVIEW.md`, « Ce qui reste au propriétaire », point P15) : la fiche est bornée par sa charte, et l'intitulé d'ADR-0042 reste « projets, tickets et support ».

## Décision

### D1 — Deux produits

P15 et l'outil de tickets sont deux produits.

- **P15** garde la capture et le relais. Son intitulé au catalogue devient « capture et relais de signalements ». Son dépôt porteur reste `libre-ai/signalement` (ADR-0055, inchangé).
- **P41** porte l'outil de tickets. Il reçoit l'intitulé « projets, tickets et support ». Aucune décision ne lui désigne de dépôt porteur.

La ligne « Collaboration » du tableau d'ADR-0042 §1 devient :

> | Collaboration | P15 capture et relais de signalements · P16 tâches · P17 messagerie · P18 conversations et visio · P19 agenda · P20 contacts et suivi · P21 assistant de réunion · P41 projets, tickets et support |

Le catalogue gagne un produit. Son compte se lit dans la sortie de `bun run check:produits`.

## Conséquences

- `ecosystem/produits/P15.v1.yaml` : `intitule` suit le catalogue. `fonction` (« Capture et relais de signalements ») dit ce que la décision dit et sort de `a_relire`. Les autres champs de la liste y restent : la décision ne les a pas relus.
- `ecosystem/produits/P41.v1.yaml` est ajouté. Son `intitule` vient de cet ADR et son `depot` est `null`. Tout autre champ de contenu est une proposition d'agent, inscrite dans `a_relire` : elle reprend un brouillon de fiche de l'outil de tickets, non versionné, écrit avant la scission.
- La brique `PRD-15` de la carte prend le nom « Capture et relais de signalements ». Aucune brique `PRD-41` n'est écrite : une brique `produit` demande une charte, et P41 n'en a pas.
- Le rôle de la couche `produit` de la carte des briques se lit « P01 à P41 » (`ecosystem/briques.ts`), et la page de vision est régénérée.
- P41 suit l'ordre d'ADR-0042 §3 comme « les autres produits » de son domaine. Le moratoire s'applique : aucun dépôt n'est créé pour lui.
- Les fiches qui citent des tickets tenus ailleurs (P16) ne changent pas : aucune ne nomme P15 dans `depend_de`. Mesure du 2026-11-15 : `grep -n "P15" ecosystem/produits/*.yaml` ne répond que dans `P15.v1.yaml`.
- Le site, dans un autre dépôt, nomme encore un seul produit pour les deux. L'aligner est une pull request de ce dépôt.

## Ce qui n'est pas décidé ici

- Le domaine de P41. Il est inscrit sous « Collaboration », la ligne d'où vient son intitulé. C'est une hypothèse de l'auteur de cet ADR, que la signature confirme ou corrige ; la fiche porte `categorie` dans `a_relire`.
- Le nom public de P41 et celui de P15. `nom_provisoire` reste dans `a_relire` sur les deux fiches.
- Le lien entre les deux produits : P41 reçoit-il les signalements que P15 relaie, et dépend-il de lui ? `depend_de` est vide sur les deux fiches, et dans `a_relire`.
- La forme de la réalisation de P41 et son dépôt porteur.
- La charte de P41.

## Source

Page de décision présentée au propriétaire le 2026-11-15. Libellé retenu, dans sa formulation exacte :

> Deux produits : P15 garde la capture et le relais ; un nouveau produit porte l'outil de tickets.

La page de décision n'est pas dans ce dépôt. L'auteur de cet ADR a reçu ce libellé par son mandat, et n'a pas lu la page. Le numéro P41 et l'intitulé « capture et relais de signalements » ne sont pas dans le libellé : le numéro est le suivant de la série, et l'intitulé reprend la `fonction` de la fiche de P15.

## Preuves

- Numéros : voir ADR-0066, « Preuves ». Cet ADR porte 0067 et D113.
- Motif de l'identifiant : `jq -r '."$defs".identifiant.pattern' ecosystem/schemas/produit.v1.schema.json` répond `^P[0-9]{2}$`. P41 y tient : le schéma n'est pas modifié.
- Le gate dérive le catalogue de l'ADR à l'exécution : avant l'ajout de la fiche de P41, `bun run check:produits` échoue sur « P41: in the catalogue of ADR-0042 §1, and no fiche ».
