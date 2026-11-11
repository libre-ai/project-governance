# HAR-11 — Modules isolés signés

## Contexte

I-25 gouverne la collection de skills de ce dépôt : admission par gate, jeu d'évaluation obligatoire, échec observé cité. Des gates la lisent sous `tools/skills/` : forme et évaluation, recouvrement des descriptions, non-cascade entre skills invoquées par l'utilisateur. ADR-0053 ferme le premier niveau de l'en-tête d'une skill. Aucun module n'est signé, et aucun harnais ne charge une skill par son empreinte. Les règles et les hooks du harnais du propriétaire, hors flotte, n'en sont pas des modules.

## Ce que la brique ferme

- Une skill entrée sans échec observé ni jeu d'évaluation, refusée par I-25.
- Une skill qui en appelle une autre et fait tomber la protection d'une action que l'utilisateur autorise à chaque fois.
- Un module chargé sous son nom alors que son contenu a changé.
- Une installation déclenchée par la fusion d'une skill, contraire à I-38.

## Ce qu'elle ne fait pas

- Elle ne versionne pas le contexte entier : fichiers d'instructions et manifeste relèvent de HAR-08.
- Elle ne signe pas elle-même : la signature relève de PRV-03, hors des dépendances admises pour cette couche.
- Elle n'admet pas d'outil d'agent, objet de HAR-03.

## Mesure

Preuves citées : `tools/skills/check-skills.ts` et `tools/skills/check-skills-cascade.ts`. Le premier vérifie l'en-tête et le minimum d'évaluation de chaque skill. Le second refuse qu'une skill invoquée par l'utilisateur en invoque une autre. Aucun ne vérifie une signature.

Prochaine preuve : un module dont l'empreinte est vérifiée au chargement par un harnais, avec un vecteur rouge sur un contenu altéré.
