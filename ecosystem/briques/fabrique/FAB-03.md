# FAB-03 — Affinage par dépendances

## Contexte

ADR-0042 §3 fixe un ordre de réalisation par dépendances (D53). I-08 n'admet aucun travail produit sans discipline de preuve. Le gate de doctrine de ce dépôt le lit comme une référence de lot exigée sur les commits qui touchent `apps/**`. La norme des lots de travail relie document de besoin, critère, lot, pull request et évidence. `ai-work-supervision` découpe un plan approuvé en missions liées par leurs dépendances. Dans ce dépôt, au 2026-11-11, seuls le module de la carte et ses tests lisent le champ `depend_de`, et aucun n'en tire un ordre.

## Ce que la brique ferme

- Le travail lancé sans critère vérifiable : la norme interdit à un lot de citer un critère sans clause de validation.
- L'ordre décidé par préférence : une tranche attend celles dont elle dépend, et une dépendance inconnue, dupliquée ou cyclique est refusée.
- La tranche qui ne démontre rien : chaque tranche nomme ce qu'elle permet de démontrer, et un texte vide est refusé.

## Ce qu'elle ne fait pas

- Elle ne reçoit ni ne trie les entrées. Sans FAB-01, elle n'a pas d'entrée admise à découper.
- Elle n'exécute pas les tranches : chacune devient une mission conduite par FAB-04.
- Elle n'infère aucune dépendance du texte d'un plan : le propriétaire donne le plan et ses dépendances.

## Mesure

- Preuve locale : `tools/quality/prd-model.ts`. Elle montre la lecture fermée d'une table de lots et de ses critères : un document illisible est refusé, jamais lu comme vide.
- Preuve épinglée : le module de découpage du domaine de `ai-work-supervision`. Il porte les règles qui valident un plan de tranches et refusent une dépendance inconnue, dupliquée ou cyclique.
- Aucune des deux ne calcule un ordre.
- Prochaine preuve : un ordre de réalisation produit par un outil à partir des champs `depend_de` de la carte et des briques sans preuve.
