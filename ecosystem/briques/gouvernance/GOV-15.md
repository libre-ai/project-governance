# GOV-15 — Forge substituable

## Contexte

I-12 fait de GitHub la forge canonique, et pose que les exports git et les artefacts empêchent toute dépendance de données irréversible. D03 garde cette forge canonique : la migration n'en introduit aucune autre. La brique ne propose donc aucune migration : elle exerce une réversibilité. `project-governance` porte un contrôle de restauration depuis un bundle git, dans le rapport de souveraineté. ADR-0029 §2.2 re-ratifie le workflow planifié de ce rapport parmi les gates de flotte périodiques.

## Ce que la brique ferme

- Un historique que seule la forge sait rendre : le bundle se restaure dans un répertoire propre.
- Une restauration supposée et jamais exercée : l'empreinte du commit et celle de l'arbre sont comparées après l'aller-retour.

## Ce qu'elle ne fait pas

- Elle ne migre aucun dépôt et ne nomme aucune forge de remplacement (D03).
- Elle ne couvre ni les issues ni les pull requests : la spécification du contrôle écrit cette limite.
- Elle ne modifie aucun ruleset : cet acte reste au propriétaire.

## Mesure

Preuve citée : `verification/sovereignty/forge-restore.ts`. Ce contrôle crée un bundle du clone, le restaure et vérifie l'égalité des empreintes du commit de tête et de son arbre. Il montre que l'historique de `HEAD` survit hors de la forge. Il ne montre pas que les rulesets, les protections de branche et les workflows requis sont tenus en données, ni qu'ils sont rejouables ailleurs.

Prochaine preuve : les rulesets et les workflows requis existent en données dans le dépôt, et un exercice les rejoue sur une forge autre que la forge canonique.
