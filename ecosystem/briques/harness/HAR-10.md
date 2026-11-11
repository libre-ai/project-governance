# HAR-10 — Protocole unique

## Contexte

I-03 réserve les contrats canoniques à une autorité unique, tenue par `schemas-and-contracts`. ADR-0034 D6 nomme les familles à concevoir : graphe, corps de plan, événements, demandes et réponses de décision, invocation d'étape, attestation d'effet. ADR-0036 en verrouille onze, sans ouvrir de capacité d'exécution (D42). Il applique I-08, qui place le Specification Lock des contrats dans le dépôt des contrats, et I-17, qui range les amendements de locks dans la surface à touche humaine : un contrat verrouillé ne se modifie pas en place, un changement passe par une nouvelle majeure, et ADR-0034 interdit tout mode mixte implicite entre deux majeures. Les contrats antérieurs restent identiques à l'octet. Le contrat d'observation des appels d'outil reste candidat.

## Ce que la brique ferme

- Une sémantique reconstruite par chaque harnais ou worker à partir de prose : le document de vecteurs fixe, cas par cas, l'entrée et le résultat attendu.
- Une invocation d'étape à la forme libre : le schéma cité est fermé, sans propriété hors liste, et lie l'invocation à son plan, son graphe, son run et son étape.
- Un type de framework d'agent glissé dans un contrat, exclu par ADR-0034 : ni le schéma ni le document de vecteurs cités ne contiennent `langgraph` ou `langchain`.

## Ce qu'elle ne fait pas

- Elle n'exécute rien : l'interprétation des contrats relève de HAR-09.
- Elle ne tient pas l'autorité des contrats. Sans GOV-07, ses contrats n'ont ni autorité ni vecteurs.
- Elle ne décrit pas une brique exécutable par ses effets, objet de HAR-01.

## Mesure

Preuves citées : le schéma d'invocation d'étape et les vecteurs sémantiques de l'exécution autorisée, dans `schemas-and-contracts`. Le schéma fixe les champs d'une invocation. Le document de vecteurs porte 54 cas : c'est la longueur de sa liste `cases` au commit épinglé, lue le 2026-11-11 par `jq '.cases | length'` sur le fichier, et le nombre qu'ADR-0037 D3 demande. Ils montrent un protocole écrit hors de toute implémentation. Ils ne montrent ni un harnais réel qui le parle, ni le verrou d'un contrat, ni le refus d'un contrat modifié en place.

Prochaine preuve : une invocation d'étape émise par un harnais de la flotte et validée contre ce schéma pendant une mission.
