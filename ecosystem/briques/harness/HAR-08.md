# HAR-08 — Contexte versionné

## Contexte

Un gate de ce dépôt vérifie, pour chaque dépôt actif de l'inventaire, la présence et la forme du fichier `AGENTS.md` sur la branche servie. ADR-0050 D7 distribue la collection de skills de ce dépôt par un manifeste généré, vérifié égal à la collection par un gate (D73). Ce manifeste ne porte pas de numéro de version : la version installée est l'empreinte du commit.

## Ce que la brique ferme

- Un agent conduit par un contexte que personne ne peut retrouver après coup.
- Un manifeste qui dérive de la collection sans que rien ne le voie (ADR-0050 D7).
- Un fichier d'instructions sans renvoi vérifiable vers l'autorité qui le gouverne.
- La confusion entre publier un contexte et l'installer : I-38 dit que publier un dépôt n'autorise jamais d'installer une skill, et réserve l'installation à une demande explicite du propriétaire.

## Ce qu'elle ne fait pas

- Elle n'admet ni ne signe un module : l'admission des skills relève de HAR-11.
- Elle n'impose aucun contenu aux fichiers d'instructions, seulement une structure.

## Mesure

Preuves citées : `ecosystem/check-context-conformance.ts` et `tools/skills/build-skills-manifest.ts`. Le premier vérifie la présence et la forme des fichiers d'instructions de chaque dépôt de l'inventaire. Le second échoue quand le manifeste commité n'est pas celui que la collection génère. Aucun ne lie un contexte à une mission, et aucun ne compare une copie installée à la collection.

Prochaine preuve : une preuve de mission qui porte l'empreinte SHA-256 du contexte chargé, vérifiable contre un commit.
