# GOV-11 — Marquage des contenus générés

## Contexte

I-05 pose qu'un artefact généré est une projection : jamais canonique, jamais éditée à la main. I-32 exige que chaque valeur porte sa provenance et ses lecteurs autorisés, propagés à ce qui en dépend (ADR-0045). `schemas-and-contracts` porte un contrat verrouillé de lignage : agents contributeurs, rôles tenus, empreinte de chaque contribution, signature. Aucune règle de la doctrine n'impose qu'un contenu publié dise à son lecteur qu'un agent l'a produit.

## Ce que la brique ferme

- Un contenu d'agent dont personne ne peut dire qui l'a produit ni à quel titre.
- Un artefact généré pris pour une source : I-05 le range parmi les projections.
- Une provenance perdue en route : I-32 la propage à ce qui dépend de la valeur.

## Ce qu'elle ne fait pas

- Elle ne signe rien et ne garde aucune clé : la signature et le manifeste relèvent de la couche preuve.
- Elle ne détecte pas après coup un contenu généré : elle exige la déclaration à la production.
- Elle ne choisit pas encore la forme du marquage visible par le lecteur.

## Mesure

Preuve citée : le contrat de lignage des contributeurs, épinglé au commit de la branche servie de `schemas-and-contracts`. Il montre que la provenance d'une contribution d'agent a une forme verrouillée. Il ne montre aucun contenu publié qui la porte.

Prochaine preuve : un artefact publié par la flotte porte un lignage conforme à ce contrat. Un gate refuse alors la publication d'un artefact généré qui n'en porte pas.
