# GOV-10 — Littératie publique

## Contexte

Le positionnement du site public, `docs/positioning/website.md`, donne à Libre AI la mission d'aider chacun à comprendre, choisir et utiliser l'intelligence artificielle. `project-governance` porte un lecteur à froid : un modèle sans contexte du projet lit les seules surfaces publiques et répond à une grille versionnée. Ces surfaces sont le README du profil d'organisation et celui de ce dépôt. Au 2026-11-11, ni le registre des invariants ni celui des décisions ne nomment ce contrôle : la brique ne cite ni invariant ni décision.

## Ce que la brique ferme

- Une surface publique que seuls ses auteurs comprennent : la lecture revient à un modèle qui ne reçoit que les surfaces publiques.
- Une lecture faite sur une branche que le visiteur ne voit pas : le lecteur lit la branche servie de chaque dépôt.
- Un verdict annoncé sans lecture : sans modèle configuré, l'outil écrit un verdict en attente.

## Ce qu'elle ne fait pas

- Elle ne construit pas le site : c'est la couche publication.
- Elle ne remplace pas un lecteur humain : la grille mesure la présence d'éléments attendus, pas la compréhension d'une personne.
- Elle ne demande pas au lecteur ce que le projet ne prouve pas : la grille suivie, `questionnaire.json` en version 2, pose quatre questions, sur ce qu'est Libre AI, où est son évidence, comment vérifier une affirmation et comment contribuer.
- Elle ne vérifie pas que le modèle vient d'un autre fournisseur que celui des auteurs : le modèle est une configuration de l'opérateur.

## Mesure

Preuve citée : `verification/adoption/cold-reader/cold-reader.ts`. Cet outil soumet les deux README à un modèle, une question par requête, puis note ses réponses contre la grille. Il montre que la lisibilité a un instrument. Il ne montre pas qu'elle est atteinte : le verdict suivi, `distribution/evidence/adoption/cold-reader-latest.json`, généré le 2026-10-09, est en attente faute de modèle configuré.

Prochaine preuve : un verdict noté du lecteur à froid dans l'évidence, avec la version de la grille, le modèle employé et les éléments manquants.
