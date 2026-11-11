# HAR-08 — Contexte versionné

## Contexte

Chaque dépôt de la flotte porte un fichier `AGENTS.md`, dont un gate de ce dépôt vérifie la forme sur la branche servie. La collection de skills de ce dépôt est gouvernée par I-25. ADR-0050 D7 la distribue par un manifeste généré. Ce manifeste ne porte pas de numéro de version : la version installée est l'empreinte du commit. Les règles du harnais du propriétaire, hors flotte, sont tenues à part et aucun gate de la flotte ne les lit.

## Ce que la brique ferme

- Un agent conduit par un contexte que personne ne peut retrouver après coup.
- Une copie installée qui dérive de la collection canonique sans que rien ne le voie (ADR-0050 D7).
- Un fichier d'instructions sans renvoi vérifiable vers l'autorité qui le gouverne.
- La confusion entre publier un contexte et l'installer : I-38 réserve l'installation à une demande du propriétaire.

## Ce qu'elle ne fait pas

- Elle n'admet ni ne signe un module : l'admission des skills relève de HAR-11.
- Elle n'impose aucun contenu aux fichiers d'instructions, seulement une structure.
- Elle ne couvre pas les règles tenues hors flotte.

## Mesure

Preuves citées : `ecosystem/check-context-conformance.ts` et `tools/skills/build-skills-manifest.ts`. Le premier vérifie la présence et la forme des fichiers d'instructions de chaque dépôt de l'inventaire. Le second échoue quand le manifeste commité n'est pas celui que la collection génère. Aucun ne lie un contexte à une mission.

Prochaine preuve : une preuve de mission qui porte l'empreinte SHA-256 du contexte chargé, vérifiable contre un commit.
