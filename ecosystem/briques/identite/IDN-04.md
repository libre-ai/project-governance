# IDN-04 — Identité des agents et des runners

## Contexte

I-18 exige une identité d'agent par flotte, mission et capacités, avec révocation par agent. Le contrôle K1 du noyau de sécurité la réalise. Le gabarit d'autorité `authority-v2` porte les trois faits d'identité, et la politique `agent-runs-v2` refuse l'action hors flotte ou hors mission. Les deux contrats sont verrouillés dans `schemas-and-contracts`, et `capability-authorization` émet le jeton d'agent. La vérification du périmètre de capacités à la frontière d'outil est différée, faute de consommateur. Aucun runner n'a d'identité attestée, et des workflows de `project-governance` lisent encore un jeton dans les secrets du dépôt.

## Ce que la brique ferme

- L'agent anonyme : un jeton d'agent sans ses faits d'identité ne porte aucune autorité (I-18).
- Le jeton réutilisé d'une mission à l'autre, menace que le modèle de menace rattache à I-18.
- L'agent qui écrit ses propres garde-fous : aucun jeton d'agent n'accorde par défaut l'écriture sur la CI ou les gates.
- Le secret de longue durée déposé dans un runner : une identité attestée par exécution le remplace.

## Ce qu'elle ne fait pas

- Elle ne fixe pas ce qu'un agent peut faire seul sur un produit : c'est HAR-12.
- Elle ne confine pas l'exécution : c'est EXE-01.
- Elle ne retire pas un jeton déjà émis : c'est IDN-05.

## Mesure

- Preuves citées : les contrats `authority-v2` et `agent-runs-v2`, épinglés. Ils fixent les trois faits et les clauses de flotte et de mission. Le test qui exerce le refus entre flottes vit dans `capability-authorization`.
- Prochaine preuve : un runner de CI obtient un jeton court par attestation, et son workflow ne lit plus aucun secret de dépôt.
