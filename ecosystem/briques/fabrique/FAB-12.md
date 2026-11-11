# FAB-12 — Décisions en données

## Contexte

I-24 fait présenter toute décision réelle en deux à quatre options avec leurs conséquences. Le registre des décisions est un tableau en prose, et un gate exige une référence de revue ou une ligne d'arbitrage datée pour toute mutation de doctrine. `ai-work-supervision` tient les demandes de décision en données, avec la liste des demandes ouvertes. ADR-0060, rédigé le 2026-10-24, renvoyait son choix à un ADR ultérieur. ADR-0062 l'a porté le 2026-11-09 et note qu'aucune décision du registre ne citait ce renvoi.

## Ce que la brique ferme

- La question ouverte que personne ne compte : une demande a un état, un instant d'ouverture et une liste où elle reste tant qu'elle est ouverte.
- La décision présentée en paragraphe : les options se comparent sur les mêmes champs, conséquence et réversibilité (I-24).
- L'arbitrage affirmé sans date : le gate ne reconnaît que la ligne d'arbitrage suivie d'une date (I-17).

## Ce qu'elle ne fait pas

- Elle ne répond pas : seul le propriétaire répond, selon GOV-01.
- Elle ne remplace ni le registre des décisions ni les ADR, qui restent la surface signée (I-17).
- Elle ne rappelle aucune demande ouverte dans un rapport de jalon.

## Mesure

- Preuve locale : `tools/quality/check-review-evidence.ts`. Elle montre qu'une mutation de la surface gardée sans référence de revue ni ligne d'arbitrage datée est refusée.
- Preuve épinglée : la migration de coordination du magasin de `ai-work-supervision`. Elle montre la table des demandes : état, auteur, options, instants de création et de mise à jour.
- Prochaine preuve : la liste des demandes ouvertes, chacune avec son instant d'ouverture, imprimée dans un rapport de jalon.
