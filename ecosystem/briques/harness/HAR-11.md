# HAR-11 — Modules isolés signés

## Contexte

I-25, posé par ADR-0025 et amendé par ADR-0050, gouverne la collection de skills de ce dépôt : admission par gate, jeu d'évaluation obligatoire, échec observé cité. Des gates la lisent sous `tools/skills/` : forme et évaluation, doublon et routage des descriptions, non-cascade entre skills invoquées par l'utilisateur. ADR-0053 ferme le premier niveau de l'en-tête d'une skill (D77). La doctrine citée ne gouverne que les skills : traiter aussi chaque règle comme un module, ce que le rôle nomme, est une proposition de l'agent, non arbitrée. Au 2026-11-11, aucun des neuf fichiers suivis sous `tools/skills/` ne contient les mots `signature`, `digest`, `sha256` ou `createHash` : aucun gate n'y vérifie une signature ni l'empreinte d'un module. I-38, posé par ADR-0056, réserve l'installation live d'une skill à une demande explicite du propriétaire ; il est voisin, la brique n'installant rien, et il n'est pas cité.

## Ce que la brique ferme

- Une skill entrée sans jeu d'évaluation : le gate refuse une skill sans jeu, ou dont le jeu est sous le minimum d'admission d'I-25.
- Une skill à l'en-tête hors forme, que le même gate refuse (ADR-0053).
- Une skill invoquée par l'utilisateur qui en invoque une autre et fait tomber la protection d'une action que l'utilisateur autorise à chaque fois.

## Ce qu'elle ne fait pas

- Elle ne versionne pas le contexte entier. Sans HAR-08, un module admis n'a pas de manifeste qui le distribue.
- Elle ne signe pas elle-même : la signature relève de PRV-03.
- Elle n'admet pas d'outil d'agent, objet de HAR-03.
- Elle n'installe aucun module et n'en déclenche pas l'installation à la fusion.

## Mesure

Preuves citées : `tools/skills/check-skills.ts` et `tools/skills/check-skills-cascade.ts`. Le premier applique à chaque skill les contrôles de forme de son en-tête et le minimum de son jeu d'évaluation. Le second refuse qu'une skill invoquée par l'utilisateur en invoque une autre. Aucun des deux ne vérifie une signature, une empreinte ou l'échec observé qu'I-25 exige.

Fait attendu, non montré : un module refusé au chargement quand son contenu a changé sous le même nom. C'est l'objet de la brique, que cette fiche ne cite réalisé nulle part.

Prochaine preuve : un module dont l'empreinte est vérifiée au chargement par un harnais, avec un vecteur rouge sur un contenu altéré.
