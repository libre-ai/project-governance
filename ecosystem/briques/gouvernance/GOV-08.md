# GOV-08 — Spécifications ouvertes

## Contexte

Le standard de spécification de `project-governance` fixe les sections que porte toute spécification d'application, des acteurs au retour arrière. ADR-0002 a tranché les arbitrages transverses qui précédaient le verrou. ADR-0020 a envoyé chaque spécification dans le dépôt de son produit, où elle est publique. I-08 confie le verrou des contrats à l'autorité des contrats. Aucun gate ne compte les produits du catalogue qui ont une spécification publiée.

## Ce que la brique ferme

- Une spécification à trous : le gate refuse une section absente ou un marqueur d'attente.
- Une spécification sans surface d'échec : elle nomme au moins trois codes de refus stables.
- Une spécification qui ne désigne pas l'autorité de ses contrats.
- Un gate vert sans avoir rien lu : le mode d'exécution est déclaré par l'appelant, jamais déduit du disque.

## Ce qu'elle ne fait pas

- Elle ne verrouille pas les contrats : c'est GOV-07.
- Elle ne publie pas les spécifications sur le site : c'est la couche publication.
- Elle ne juge pas le fond d'une spécification : la revue reste humaine.

## Mesure

Preuve citée : `tools/quality/check-specification-lock.ts`. Ce gate vérifie, pour chaque spécification nommée, ses sections, l'absence de marqueur d'attente, un chemin de contrat et ses codes de refus. Il montre que la forme est exercée, pas que chaque produit a sa spécification.

Prochaine preuve : un gate de flotte liste les produits du catalogue, lit la spécification de chacun dans son dépôt et imprime ceux qui n'en ont pas.
