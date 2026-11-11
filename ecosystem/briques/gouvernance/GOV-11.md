# GOV-11 — Marquage des contenus générés

## Contexte

`schemas-and-contracts` porte un contrat de lignage des contributeurs, verrouillé dans son catalogue. Un lignage nomme une mission, l'empreinte de son sujet, les agents contributeurs, les rôles tenus, l'empreinte de chaque contribution et une signature. Le registre des invariants, lu le 2026-11-11, ne porte aucune règle qui impose de dire à un lecteur qu'un contenu vient d'un agent. La brique ne cite donc ni invariant ni décision.

## Ce que la brique ferme

- Un contenu d'agent dont personne ne peut dire qui l'a produit ni à quel titre : le lignage nomme chaque agent et ses rôles.
- Une contribution modifiée après sa déclaration : le lignage porte l'empreinte de chaque contribution et une signature.
- Un lignage sans pièce à l'appui : le contrat exige au moins une référence d'artefact observé.

## Ce qu'elle ne fait pas

- Elle ne signe rien et ne garde aucune clé : la signature relève de la couche preuve.
- Elle ne détecte pas après coup un contenu généré.
- Elle ne fixe pas la forme d'un marquage visible par le lecteur : le registre des invariants ne la décide pas.

## Mesure

Preuve citée : le contrat de lignage des contributeurs, épinglé à un commit de `schemas-and-contracts`. Il montre que la provenance d'une contribution d'agent a une forme verrouillée. Il ne montre aucun contenu publié qui la porte, ni aucun destinataire qui la vérifie.

Prochaine preuve : un artefact publié par la flotte porte un lignage conforme à ce contrat, et un gate refuse la publication d'un artefact d'agent qui n'en porte pas.
