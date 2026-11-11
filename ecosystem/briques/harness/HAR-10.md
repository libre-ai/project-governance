# HAR-10 — Protocole unique

## Contexte

I-03 réserve les contrats canoniques à une autorité unique, tenue par `schemas-and-contracts`. ADR-0034 D6 nomme les familles à concevoir : graphe, corps de plan, événements, demandes et réponses de décision, invocation d'étape, attestation d'effet. ADR-0036 en verrouille onze, sans ouvrir de capacité d'exécution (D42). Il applique I-08, qui place le Specification Lock des contrats dans le dépôt des contrats. Les contrats antérieurs restent identiques à l'octet. Le contrat d'observation des appels d'outil reste candidat.

## Ce que la brique ferme

- Une sémantique reconstruite par chaque harnais ou worker à partir de prose.
- Un type de framework d'agent glissé dans un contrat, exclu par ADR-0034.
- Un contrat verrouillé modifié en place : I-17 range les amendements de locks dans la surface à touche humaine, et un changement passe par une nouvelle majeure.
- Un mode mixte implicite entre deux majeures, qu'ADR-0034 interdit.

## Ce qu'elle ne fait pas

- Elle n'exécute rien : l'interprétation des contrats relève de HAR-09.
- Elle ne tient pas l'autorité des contrats. Sans GOV-07, ses contrats n'ont ni autorité ni vecteurs.
- Elle ne décrit pas une brique exécutable par ses effets, objet de HAR-01.

## Mesure

Preuves citées : le schéma d'invocation d'étape et les vecteurs sémantiques de l'exécution autorisée, dans `schemas-and-contracts`. Le schéma fixe les champs d'une invocation. Le document de vecteurs porte 54 cas, comptés au commit lu. Ils montrent un protocole écrit hors de toute implémentation. Ils ne montrent pas un harnais réel qui le parle.

Prochaine preuve : une invocation d'étape émise par un harnais de la flotte et validée contre ce schéma pendant une mission.
