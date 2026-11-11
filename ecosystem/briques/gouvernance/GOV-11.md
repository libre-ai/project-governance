# GOV-11 — Marquage des contenus générés

## Contexte

`schemas-and-contracts` porte un contrat de lignage des contributeurs, verrouillé dans son catalogue, qui le classe `tenant-private` et lui donne pour consommateurs `missions` et `proof`. Un lignage nomme une mission, l'empreinte de son sujet, les agents contributeurs, les rôles tenus, l'empreinte de chaque contribution et une signature. Le registre des invariants, lu le 2026-11-11, ne porte aucune règle qui impose de dire à un lecteur qu'un contenu vient d'un agent. La brique ne cite donc ni invariant ni décision.

## Ce que la brique ferme

- Un contributeur déclaré sans titre : le contrat exige de chaque contributeur un identifiant d'agent et au moins un rôle parmi auteur, exécutant, correcteur et éditeur.
- Un lignage sans empreinte ni signature : le contrat exige l'empreinte de chaque contribution, celle du sujet, celle du lignage, l'identifiant de la clé et une signature.
- Un lignage sans pièce à l'appui : le contrat exige au moins une référence d'artefact observé.

## Ce qu'elle ne fait pas

- Elle n'impose pas qu'un lignage nomme un contributeur : le contrat n'exige aucun nombre minimal de contributeurs.
- Elle ne vérifie aucune signature et ne détecte pas une contribution modifiée après sa déclaration : le contrat fixe une forme, et aucune preuve citée ici ne la contrôle.
- Elle ne signe rien et ne garde aucune clé : la signature relève de la couche preuve.
- Elle ne détecte pas après coup un contenu généré.
- Elle ne fixe pas la forme d'un marquage visible par le lecteur : le registre des invariants ne la décide pas, et le catalogue classe ce contrat `tenant-private`.

## Mesure

Preuve citée : le contrat de lignage des contributeurs, épinglé à un commit de `schemas-and-contracts`. Il montre que la provenance d'une contribution d'agent a une forme verrouillée. Il ne montre aucun contenu publié qui la porte, ni aucun destinataire qui la vérifie.

Prochaine preuve : un artefact publié par la flotte porte un lignage conforme à ce contrat, et un gate refuse la publication d'un artefact d'agent qui n'en porte pas.
