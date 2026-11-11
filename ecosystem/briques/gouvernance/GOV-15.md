# GOV-15 — Forge substituable

## Contexte

I-12 fait de GitHub la forge canonique, et pose que les exports git et les artefacts empêchent toute dépendance de données irréversible. D03 garde cette forge canonique : la migration n'en introduit aucune autre. La brique ne propose donc aucune migration : elle exerce une réversibilité. `project-governance` porte un contrôle de restauration depuis un bundle git, dans le rapport de souveraineté. ADR-0029 §2.2 re-ratifie le workflow planifié de ce rapport parmi les gates de flotte périodiques.

## Ce que la brique ferme

- Un historique que seule la forge sait rendre : le bundle de `HEAD` se restaure par un clone dans un répertoire propre, sans appel à la forge.
- Une restauration supposée et jamais exercée : l'empreinte du commit et celle de l'arbre sont comparées après l'aller-retour, et un écart est un échec.

## Ce qu'elle ne fait pas

- Elle ne migre aucun dépôt et ne nomme aucune forge de remplacement (D03).
- Elle ne couvre ni les issues ni les pull requests : la spécification du contrôle écrit cette limite.
- Elle ne modifie aucune protection de branche : ADR-0029 §2.8 n'admet cette modification que par l'outil `tools/security/check-branch-protection.ts`.

## Mesure

Preuve citée : `verification/sovereignty/forge-restore.ts`. Ce contrôle crée un bundle de `HEAD` depuis le clone, le restaure et vérifie l'égalité des empreintes du commit de tête et de son arbre. Pour cette brique, il montre la première moitié du rôle, pour ce seul dépôt : la restauration est exercée, et elle ne lit que le clone et le bundle. La spécification du contrôle écrit que le bundle couvre l'historique de `HEAD`. Il ne montre rien de la seconde moitié du rôle : ni rulesets, ni protections de branche, ni workflows requis tenus en données, ni leur rejeu ailleurs.

Prochaine preuve : les rulesets et les workflows requis existent en données dans le dépôt, et un exercice les rejoue sur une forge autre que la forge canonique.
