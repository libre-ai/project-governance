# FAB-08 — Tranche de bout en bout

## Contexte

ADR-0042 §3 place avant toute extension le jalon B′ (D53) : dix missions consécutives de bout en bout dans Work Supervision, sans fichier de passation hors de l'outil, et une première utilisation réelle de la boucle documentaire par le propriétaire. Aucun nouveau dépôt n'est créé avant ce jalon. I-19 fait de la consommation interne le client prioritaire de chaque brique : B′ est cette consommation pour la fabrique. `ai-work-supervision` porte une répétition de ce jalon avec le faux agent. Sa fiche de projet, au commit lu, ne la compte pas : le critère de sortie y est en attente, et il demande un agent réel.

## Ce que la brique ferme

La preuve citée est une simulation : elle montre le mécanisme sur le faux agent, pas une tranche réelle.

- La passation hors de l'outil : B′ l'exclut, et la répétition échoue si un fichier est écrit hors de la racine de l'outil, du dépôt, de l'ancre et de ses propres entrées.
- La campagne close sans trace relisible : la répétition exige dix missions acceptées, un journal vérifié contre son ancre et une projection reconstruite à l'identique.

## Ce qu'elle ne fait pas

- Elle ne remplace aucun maillon. Sans FAB-01, elle n'a pas d'entrée. Sans FAB-04, elle n'a ni mission ni résultat accepté.
- Elle ne remet pas le résultat à la flotte : la pull request est l'objet de FAB-09, que le rôle écrit n'exige pas et qui n'est pas une dépendance.
- Elle ne mesure pas un produit contre son étalon : c'est FAB-05.

## Mesure

- Preuve citée : le test de répétition du jalon B′ de `ai-work-supervision`, épinglé au commit lu. Il exerce une campagne de dix missions créées, lancées, rendues puis acceptées, dont certaines après un rejet, et vérifie le journal. Il tourne avec le faux agent et se déclare simulation : il ne part pas d'une entrée triée, ne montre pas une tranche réelle et ne compte pas pour B′.
- Fait attendu, non montré : un seul travail réel qui traverse toute la chaîne, de l'entrée au résultat accepté.
- Prochaine preuve : une mission réelle, issue d'une entrée triée, dont le résultat est accepté avec sa preuve, la chaîne se lisant dans le journal vérifié.
