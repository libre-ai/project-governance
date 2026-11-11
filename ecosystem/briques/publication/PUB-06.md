# PUB-06 — Voie balisée pour reconstruire

## Contexte

I-12 exige que les exports git et les artefacts empêchent toute dépendance de données irréversible. Dans `project-governance`, une boucle de reproduction rejoue un adoptant sans assistance : environnement sans identifiant, clone anonyme, installation depuis le lockfile commité, puis chaîne de référence. Chaque passage produit une attestation et un journal de friction, publiés sous `distribution/evidence/adoption/`. Le contenu publié est donc dérivé d'une exécution, pas d'un guide rédigé. La boucle ne couvre que ce dépôt : son étape de validation d'un contrat a été retirée lors de la migration.

## Ce que la brique ferme

- Une méthode publiée que nul ne peut reprendre sans aide privée : la boucle échoue à la première demande d'authentification.
- Un prérequis implicite ou une étape non documentée : le journal de friction les consigne, même quand le passage réussit.
- Une chaîne de référence qui s'écarte de son évidence publiée : l'empreinte obtenue est comparée à l'empreinte publiée (I-20).

## Ce qu'elle ne fait pas

- Elle ne définit ni les contrats ni leurs vecteurs : c'est GOV-07, dans `schemas-and-contracts`.
- Elle ne restaure pas la flotte sur une autre forge : l'exercice de sortie est EXP-04.
- Elle ne traite pas l'entrée d'une contribution, laissée à PUB-05.

## Mesure

Preuves citées : la boucle de reproduction et son workflow planifié. Elles montrent qu'un clone anonyme de ce dépôt s'installe et rejoue sa chaîne de référence sans identifiant. Elles ne montrent la reconstruction ni d'un contrat validé contre ses vecteurs, ni d'un produit.

Prochaine preuve : une attestation où la boucle valide, depuis un clone anonyme, un contrat de `schemas-and-contracts` contre ses vecteurs.
