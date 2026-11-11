# FAB-13 — Vérificateur de la carte

## Contexte

ADR-0064 D5 demande un vérificateur qui lit les fichiers de couche et les fiches, applique la table des dépendances de D1 et imprime ses compteurs. Ce dépôt le porte en deux moitiés : un module pur pour les règles, un script pour les fichiers. Un workflow dédié l'exécute, sans être un check requis : ADR-0064 laisse cet acte au propriétaire. Le générateur de la page vision, qui doit lire ses sorties, n'existe pas.

## Ce que la brique ferme

- Le statut saisi à la main : un champ de statut fait échouer le gate, et le statut se dérive des preuves (ADR-0064 D4).
- La dépendance hors table : une brique qui dépend d'une couche non admise, d'un produit ou d'elle-même est refusée (ADR-0064 D1).
- Le compte recopié : les nombres de briques sont imprimés, jamais écrits (I-14).
- La source illisible lue comme vide : un fichier de couche manquant ou illisible est un échec (I-08).

## Ce qu'elle ne fait pas

- Elle ne résout pas une preuve épinglée dans un autre dépôt : le gate des citations épinglées le fait.
- Elle ne vérifie pas les règles de couche qui portent sur un comportement : elle les imprime comme déclaratives.
- Elle ne modifie pas les invariants qu'elle lit, tenus par GOV-02.

## Mesure

- Preuves citées : `ecosystem/check-briques.ts` et `ecosystem/briques.ts`. Elles montrent le gate et ses règles, dont la table des couches que la suite de tests relit depuis ADR-0064.
- Prochaine preuve : la page vision générée depuis les seules sorties de ce gate, puis le gate rendu requis sur la branche servie par un acte du propriétaire.
