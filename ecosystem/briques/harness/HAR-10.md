# HAR-10 — Protocole unique

## Contexte

Le moteur, le harnais et les workers n'échangent que par des contrats canoniques, tenus par `schemas-and-contracts` (I-03). ADR-0034 D6 nomme les familles à concevoir : graphe, corps de plan, événements, demandes et réponses de décision, invocation d'étape, attestation d'effet. ADR-0036 en verrouille onze, sans ouvrir de capacité d'exécution. Les contrats antérieurs restent identiques à l'octet. Le contrat d'observation des appels d'outil reste candidat (ADR-0046).

## Ce que la brique ferme

- Une sémantique reconstruite par chaque harnais ou worker à partir de prose.
- Un type de framework d'agent glissé dans un contrat, exclu par ADR-0034.
- Un contrat verrouillé modifié en place : un changement passe par une nouvelle majeure et un acte du propriétaire (I-17).
- Un mode mixte implicite entre deux majeures, qu'ADR-0034 interdit.

## Ce qu'elle ne fait pas

- Elle n'exécute rien : l'interprétation des contrats relève de HAR-09.
- Elle ne tient pas l'autorité des autres contrats canoniques, qui relève de GOV-07.
- Elle ne décrit pas une brique exécutable par ses effets, objet de HAR-01.

## Mesure

Preuves citées : le schéma d'invocation d'étape et les vecteurs sémantiques de l'exécution autorisée, dans `schemas-and-contracts`. Ils montrent un protocole écrit et vérifiable hors de toute implémentation. Ils ne montrent pas un harnais réel qui le parle.

Prochaine preuve : une invocation d'étape émise par un harnais de la flotte et validée contre ce schéma pendant une mission.
