# GOV-09 — Boucle de management (plan, mesure, revue, amélioration)

## Contexte

ADR-0042 §3 demande que chaque clôture de jalon publie un rapport public daté de ses enseignements ; D53 consigne ce paragraphe. `project-governance` porte des contrôles planifiés : reproduction en salle blanche, rapport de souveraineté, dérive de l'inventaire, avis de sécurité. ADR-0029 §2.5 leur ajoute une alerte sur échec répété. Sans GOV-06, la boucle n'a ni plan ni mesure à relire : les phases, les critères et les preuves datées sont dans la fiche de chaque dépôt. La liste des invariants de la brique est vide : ceux qui touchent le plan et la mesure lient GOV-06.

## Ce que la brique ferme

- Un contrôle planifié rouge que personne ne lit : deux échecs consécutifs ouvrent une issue (ADR-0029 §2.5).
- Une issue d'alerte qui survit au retour au vert : le premier succès la ferme.
- Un workflow planifié sans alerte : un test échoue quand l'un d'eux ne porte pas les deux étapes.

## Ce qu'elle ne fait pas

- Elle ne vise aucune certification : au 2026-11-11, ni le registre des invariants ni celui des décisions n'en nomment une.
- Elle ne mesure pas la conformité d'un dépôt : elle lit ce que GOV-06 mesure.
- Elle ne corrige rien seule : l'alerte signale, le correctif reste une décision.

## Mesure

Preuve citée : `tools/security/repeat-failure-alert.ts`. Cette étape ouvre une issue quand un contrôle planifié échoue deux fois de suite, et la ferme au premier succès. Elle montre que la mesure périodique a un lecteur. Elle ne montre ni une revue qui en tire une amélioration, ni le rapport de jalon d'ADR-0042 §3.

Prochaine preuve : un rapport de jalon daté, publié dans l'évidence de ce dépôt et référencé depuis le site.
