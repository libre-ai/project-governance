# FAB-03 — Affinage par dépendances

## Contexte

ADR-0042 §3 fixe un ordre de réalisation par dépendances, et I-08 exige des critères et des preuves datées. La norme des lots de travail relie document de besoin, critère, lot et pull request. `ai-work-supervision` découpe un plan approuvé en missions liées par leurs dépendances. Aucun outil ne calcule encore un ordre à partir des dépendances entre les briques de la carte.

## Ce que la brique ferme

- Le travail lancé sans critère vérifiable : un lot ne cite que des critères qui portent leur clause de validation (I-08).
- L'ordre décidé par préférence : une mission attend celles dont elle dépend, et un cycle de dépendances est refusé (ADR-0042 §3).
- La tranche qui ne démontre rien : chaque tranche nomme ce qu'elle permet de démontrer, et ce fait devient son premier critère.

## Ce qu'elle ne fait pas

- Elle ne reçoit ni ne trie les entrées : c'est FAB-01.
- Elle n'exécute pas les tranches : chacune devient une mission conduite par FAB-04.
- Elle n'infère aucune dépendance du texte d'un plan : les dépendances sont une déclaration du propriétaire.

## Mesure

- Preuve locale : `tools/quality/prd-model.ts`. Elle montre la lecture fermée d'une table de lots et de ses critères : un document illisible est refusé, jamais lu comme vide.
- Preuve épinglée : le module de découpage du domaine de `ai-work-supervision`. Il porte les règles qui valident un plan de tranches et refusent une dépendance inconnue, dupliquée ou cyclique.
- Aucune des deux ne calcule un ordre.
- Prochaine preuve : un ordre de réalisation produit par un outil à partir des champs `depend_de` de la carte et des briques sans preuve.
