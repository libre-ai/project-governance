# FAB-08 — Tranche de bout en bout

## Contexte

ADR-0042 §3 place avant toute extension le jalon B′ : dix missions consécutives de bout en bout dans Work Supervision, sans fichier de passation hors de l'outil. `ai-work-supervision` porte une répétition de ce jalon avec le faux agent, que sa fiche de projet ne compte pas : le critère de sortie y reste en attente. Aucune mission n'y est conduite par un agent réel : le seul exécuteur que son domaine admet est le faux agent.

## Ce que la brique ferme

- La méthode écrite couche par couche sans jamais être traversée : une tranche exerce toute la chaîne sur un seul travail (I-13, I-19).
- L'élargissement avant la preuve : aucun nouveau dépôt n'est créé avant B′ (ADR-0042 §3, D53).
- La passation hors de l'outil : la tranche se lit dans le journal, sans note à côté (I-08).

## Ce qu'elle ne fait pas

- Elle ne remplace aucun maillon : l'entrée vient de FAB-01, la mission de FAB-04, la remise de FAB-09.
- Elle ne mesure pas un produit contre son étalon : c'est FAB-05.

## Mesure

- Preuve citée : le test de répétition du jalon B′ de `ai-work-supervision`, épinglé au commit lu. Il exerce une campagne de missions créées, lancées, rendues avec preuve puis acceptées, et vérifie le journal à la fin. Il tourne avec le faux agent : il ne montre pas une tranche réelle et ne compte pas pour B′.
- Prochaine preuve : une mission réelle, issue d'une entrée triée, dont le résultat accepté est fusionné par une pull request de flotte, la chaîne se lisant dans le journal vérifié.
