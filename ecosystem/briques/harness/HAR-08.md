# HAR-08 — Contexte versionné

## Contexte

Un gate de ce dépôt vérifie, pour chaque dépôt actif de l'inventaire, la présence et la forme du fichier `AGENTS.md` sur la branche servie. ADR-0050 D7 distribue la collection de skills de ce dépôt par un manifeste généré, vérifié égal à la collection par un gate (D73). Ce manifeste ne porte pas de numéro de version : son générateur écrit que la version installée est l'empreinte du commit. Cette fiche ne cite aucun invariant. I-38, qui dit que publier un dépôt n'autorise jamais d'installer une skill, est voisin : la brique publie et n'installe pas.

## Ce que la brique ferme

- Un manifeste qui dérive de la collection sans que rien ne le voie (ADR-0050 D7) : le gate échoue quand le manifeste commité n'est pas, à l'octet, celui que la collection génère.
- Un fichier d'instructions sans renvoi vérifiable vers l'autorité qui le gouverne : le gate exige au moins une adresse qui pointe vers un dépôt d'autorité.
- Un fichier d'instructions absent ou sans forme : le gate exige sa présence pour tout dépôt actif, ses sections, un plafond de lignes et son adaptateur.

## Ce qu'elle ne fait pas

- Elle n'admet ni ne signe un module : l'admission des skills relève de HAR-11.
- Elle n'impose aucun contenu aux fichiers d'instructions, seulement une structure.
- Elle n'installe rien : publier un contexte n'est pas l'installer.

## Mesure

Preuves citées : `ecosystem/check-context-conformance.ts` et `tools/skills/build-skills-manifest.ts`. Le premier vérifie la présence et la forme des fichiers d'instructions de chaque dépôt de l'inventaire. Le second échoue quand le manifeste commité n'est pas celui que la collection génère. Aucun des deux ne lie un contexte à une mission, ne calcule l'empreinte d'un contexte, ni ne compare une copie installée à la collection.

Fait attendu, non montré : un contexte retrouvé après coup par son empreinte, citée dans une preuve de mission, ce que le rôle nomme.

Prochaine preuve : une preuve de mission qui porte l'empreinte SHA-256 du contexte chargé, vérifiable contre un commit.
