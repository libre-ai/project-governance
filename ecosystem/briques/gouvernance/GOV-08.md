# GOV-08 — Spécifications ouvertes

## Contexte

Le standard de spécification de `project-governance`, `docs/specifications/SPECIFICATION-STANDARD.md`, fixe les treize sections que porte toute spécification d'application, des acteurs au retour arrière. ADR-0002 a tranché les cinq arbitrages transverses qui précédaient le verrou des contrats. ADR-0020 §2.2 remplace le foyer unique des spécifications par leur ventilation, et fait migrer leur gate vers ce dépôt. Au 2026-11-11, le registre des invariants ne fixe pas la forme d'une spécification d'application : la liste des invariants de la brique est vide.

## Ce que la brique ferme

- Une spécification à trous : le gate refuse une section absente ou un marqueur d'attente.
- Une spécification sans surface d'échec : le gate exige au moins trois codes de refus distincts.
- Une spécification qui ne désigne pas l'autorité de ses contrats. Sans GOV-07, ce chemin de contrat ne désigne rien.
- Un gate vert sans avoir rien lu : le mode d'exécution est déclaré par l'appelant, jamais déduit du disque.

## Ce qu'elle ne fait pas

- Elle ne verrouille pas les contrats : c'est GOV-07.
- Elle ne publie pas les spécifications sur le site : c'est la couche publication.
- Elle ne juge pas le fond d'une spécification.

## Mesure

Preuve citée : `tools/quality/check-specification-lock.ts`. Ce gate vérifie, pour chaque spécification que son appelant nomme, ses sections, l'absence de marqueur d'attente, un chemin de contrat et ses codes de refus. Il montre que la forme est exercée. Il ne compte pas les produits du catalogue qui ont une spécification.

Prochaine preuve : un gate de flotte liste les produits du catalogue, lit la spécification de chacun dans son dépôt et imprime ceux qui n'en ont pas.
