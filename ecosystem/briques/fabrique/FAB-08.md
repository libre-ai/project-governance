# FAB-08 — Tranche de bout en bout

## Contexte

ADR-0042 §3 place avant toute extension le jalon B′ (D53) : dix missions consécutives de bout en bout dans Work Supervision, sans fichier de passation hors de l'outil, et une première utilisation réelle de la boucle documentaire par le propriétaire. I-19 fait de la consommation interne le client prioritaire de chaque brique : B′ est cette consommation pour la fabrique. `ai-work-supervision` porte une répétition de ce jalon avec le faux agent. Sa fiche de projet, au commit lu, ne la compte pas : le critère de sortie y est en attente. Au même commit, le seul profil d'exécuteur que son domaine admet est le faux agent.

## Ce que la brique ferme

- La chaîne écrite maillon par maillon sans jamais être traversée : une tranche exerce toute la chaîne sur un seul travail.
- L'élargissement avant la preuve : aucun nouveau dépôt n'est créé avant B′ (ADR-0042 §3).
- La passation hors de l'outil : B′ l'exclut, et la répétition relève tout fichier écrit hors de la racine de l'outil, du dépôt, de l'ancre et de ses propres entrées.

## Ce qu'elle ne fait pas

- Elle ne remplace aucun maillon. Sans FAB-01, elle n'a pas d'entrée. Sans FAB-04, elle n'a pas de mission. Sans FAB-09, elle n'a pas de remise.
- Elle ne mesure pas un produit contre son étalon : c'est FAB-05.

## Mesure

- Preuve citée : le test de répétition du jalon B′ de `ai-work-supervision`, épinglé au commit lu. Il exerce une campagne de missions créées, lancées, rendues avec preuve puis acceptées, et vérifie le journal. Il tourne avec le faux agent : il ne montre pas une tranche réelle et ne compte pas pour B′.
- Prochaine preuve : une mission réelle, issue d'une entrée triée, dont le résultat accepté est fusionné par une pull request de flotte, la chaîne se lisant dans le journal vérifié.
