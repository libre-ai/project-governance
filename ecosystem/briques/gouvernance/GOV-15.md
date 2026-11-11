# GOV-15 — Forge substituable

## Contexte

I-12 fait de GitHub la forge canonique, et pose que les exports git et les artefacts empêchent toute dépendance de données irréversible. D03 exclut l'introduction d'une nouvelle forge. La brique ne propose donc aucune migration : elle prouve une réversibilité. `project-governance` porte un exercice périodique de restauration depuis un bundle git, dans le rapport de souveraineté que traite ADR-0029. Les rulesets et les protections de branche vivent chez la forge. Leur forme en données, rejouable ailleurs, n'existe pas.

## Ce que la brique ferme

- Un historique que seule la forge sait rendre : le bundle se restaure dans un répertoire propre.
- Une restauration supposée et jamais exercée : l'empreinte du commit et celle de l'arbre sont comparées après l'aller-retour.
- Une règle de protection connue de la seule interface de la forge.

## Ce qu'elle ne fait pas

- Elle ne migre aucun dépôt et ne nomme aucune forge de remplacement (D03).
- Elle ne couvre pas les issues ni les pull requests : la spécification de l'exercice écrit cette limite.
- Elle ne modifie aucun ruleset : cet acte reste au propriétaire (I-17).

## Mesure

Preuve citée : `verification/sovereignty/forge-restore.ts`. Ce contrôle crée un bundle du clone, le restaure et vérifie l'égalité des empreintes du commit de tête et de son arbre. Il montre que l'historique servi survit hors de la forge, pas que les gates et les règles y sont rejouables.

Prochaine preuve : les rulesets et les workflows requis existent en données dans le dépôt, et un exercice les rejoue sur une forge autre que la forge canonique.
