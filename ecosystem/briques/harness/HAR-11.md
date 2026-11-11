# HAR-11 — Modules isolés signés

## Contexte

I-25, posé par ADR-0025 et amendé par ADR-0050, gouverne la collection de skills de ce dépôt : admission par gate, jeu d'évaluation obligatoire, échec observé cité. Des gates la lisent sous `tools/skills/` : forme et évaluation, doublon et routage des descriptions, non-cascade entre skills invoquées par l'utilisateur. ADR-0053 ferme le premier niveau de l'en-tête d'une skill (D77). Au 2026-11-11, aucun gate de `tools/skills/` ne vérifie une signature ni l'empreinte d'un module.

## Ce que la brique ferme

- Une skill entrée sans jeu d'évaluation : le gate refuse un jeu sous le minimum d'admission d'I-25.
- Une skill qui en appelle une autre et fait tomber la protection d'une action que l'utilisateur autorise à chaque fois.
- Un module chargé sous son nom alors que son contenu a changé : c'est l'objet de la brique, que rien ne réalise encore.
- Une installation déclenchée par la fusion d'une skill : I-38, posé par ADR-0056, dit que publier un dépôt n'autorise jamais d'installer une skill.

## Ce qu'elle ne fait pas

- Elle ne versionne pas le contexte entier. Sans HAR-08, un module admis n'a pas de manifeste qui le distribue.
- Elle ne signe pas elle-même : la signature relève de PRV-03.
- Elle n'admet pas d'outil d'agent, objet de HAR-03.

## Mesure

Preuves citées : `tools/skills/check-skills.ts` et `tools/skills/check-skills-cascade.ts`. Le premier vérifie l'en-tête et le minimum d'évaluation de chaque skill. Le second refuse qu'une skill invoquée par l'utilisateur en invoque une autre. Aucun ne vérifie une signature, une empreinte ou l'échec observé qu'I-25 exige.

Prochaine preuve : un module dont l'empreinte est vérifiée au chargement par un harnais, avec un vecteur rouge sur un contenu altéré.
