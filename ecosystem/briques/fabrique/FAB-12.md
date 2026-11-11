# FAB-12 — Décisions en données

## Contexte

I-24, posé par ADR-0022 (D31) et amendé par D74, fait présenter toute décision réelle en deux à quatre options avec leurs conséquences. I-17 range le registre et les ADR dans la surface à touche humaine. Un gate y exige une référence de revue ou une ligne d'arbitrage datée. `ai-work-supervision` tient les demandes de décision dans une table, avec leur état. ADR-0060, rédigé le 2026-10-24, renvoyait son choix à un ADR ultérieur. ADR-0062 l'a porté le 2026-11-09 et note qu'aucune décision du registre ne citait ce renvoi.

## Ce que la brique ferme

- La question ouverte que personne ne compte : une demande a un état et un instant de création.
- La décision présentée en paragraphe : les options se comparent sur les mêmes champs, conséquence et réversibilité (I-24).
- L'arbitrage affirmé sans date : le gate ne reconnaît que la ligne d'arbitrage suivie d'une date (I-17).

## Ce qu'elle ne fait pas

- Elle ne répond pas. Sans GOV-01, rien ne dit que la réponse revient au propriétaire.
- Elle ne remplace ni le registre des décisions ni les ADR, qui restent la surface signée (I-17).
- Elle ne rappelle aucune demande ouverte dans un rapport de jalon.

## Mesure

- Preuve locale : `tools/quality/check-review-evidence.ts`. Elle montre qu'une mutation de la surface gardée sans référence de revue ni ligne d'arbitrage datée est refusée.
- Preuve épinglée : la migration de coordination du magasin de `ai-work-supervision`. Elle montre la table des demandes : état, auteur, options, instants de création et de mise à jour. Elle ne montre pas une liste des demandes ouvertes.
- Prochaine preuve : la liste des demandes ouvertes, chacune avec son instant d'ouverture, imprimée dans un rapport de jalon.
