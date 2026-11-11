# FAB-13 — Vérificateur de la carte

## Contexte

ADR-0064, proposé, demande par D5 un vérificateur qui lit les fichiers de couche et les fiches, applique la table des dépendances de D1 et imprime ses compteurs. Ce dépôt le porte en deux moitiés : un module pur pour les règles, un script pour les fichiers. Il dérive aussi le catalogue d'ADR-0042 §1 et imprime combien de produits sont en brique. Un workflow dédié l'exécute ; le rendre requis reste un acte du propriétaire. `distribution/vision/` est absent de l'arbre : le générateur de la page vision n'existe pas dans ce dépôt.

## Ce que la brique ferme

- Le statut saisi à la main : un champ de statut fait échouer le gate, et le statut se dérive des preuves (ADR-0064 D4).
- La dépendance hors table : une brique qui dépend d'une couche non admise ou d'un produit est refusée, comme tout cycle (ADR-0064 D1).
- Le compte recopié : I-14 n'admet aucun décompte codé en dur, et les nombres de briques sont imprimés, jamais écrits.
- La source illisible lue comme vide : un fichier de couche manquant ou illisible est un échec.

## Ce qu'elle ne fait pas

- Elle ne résout pas une preuve épinglée dans un autre dépôt : le gate des citations épinglées le fait.
- Elle ne vérifie pas les règles de couche qui portent sur un comportement : elle les imprime comme déclaratives.
- Elle ne modifie pas le registre des invariants. Sans GOV-02, elle n'a pas de registre contre lequel refuser un invariant inconnu.

## Mesure

- Preuves citées : `ecosystem/check-briques.ts` et `ecosystem/briques.ts`. Elles montrent le gate et ses règles, dont la table des couches que la suite de tests relit depuis ADR-0064.
- Prochaine preuve : la page vision générée depuis les seules sorties de ce gate, puis le gate rendu requis sur la branche servie par un acte du propriétaire.
