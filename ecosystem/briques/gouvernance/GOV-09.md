# GOV-09 — Boucle de management (plan, mesure, revue, amélioration)

## Contexte

ADR-0042 §3 demande que chaque clôture de jalon publie un rapport public daté de ses enseignements ; D53 consigne ce paragraphe. `project-governance` porte des contrôles planifiés : reproduction en salle blanche, rapport de souveraineté, dérive de l'inventaire, avis de sécurité. ADR-0029 §2.5 leur ajoute une alerte sur échec répété. Sans GOV-06, la boucle n'a ni plan ni mesure à relire : les phases, les critères et les preuves datées sont dans la fiche de chaque dépôt. La liste des invariants de la brique est vide : ceux qui touchent le plan et la mesure lient GOV-06.

## Ce que la brique ferme

- Un contrôle planifié rouge que personne ne lit : un échec qui suit un échec du même workflow ouvre une issue (ADR-0029 §2.5).
- Une issue ouverte deux fois pour la même panne : le titre est stable, et l'étape ne crée rien quand une issue ouverte le porte déjà.
- Une issue d'alerte qui survit au retour au vert : le premier succès la ferme.
- Un échec de branche compté comme une dérive de flotte : seule une exécution planifiée ou lancée à la main compte comme exécution précédente.

## Ce qu'elle ne fait pas

- Elle ne vise aucune certification : au 2026-11-11, ni le registre des invariants ni celui des décisions n'en nomment une.
- Elle ne mesure pas la conformité d'un dépôt : elle lit ce que GOV-06 mesure.
- Elle ne corrige rien seule : l'alerte signale, le correctif reste une décision.

## Mesure

Preuve citée : `tools/security/repeat-failure-alert.ts`. Cette étape ouvre une issue quand un contrôle planifié échoue deux fois de suite, et la ferme au premier succès. Son en-tête écrit que chaque workflow planifié de ce dépôt porte les deux étapes et qu'un test, `scheduled-loop-alerting.test.ts`, échoue sinon ; ce test n'est pas cité en preuve ici. Elle montre qu'un échec répété d'un contrôle planifié devient une issue. Elle ne montre ni qu'une personne lit cette issue, ni une revue qui en tire une amélioration, ni le rapport de jalon d'ADR-0042 §3.

Prochaine preuve : un rapport de jalon daté, publié dans l'évidence de ce dépôt et référencé depuis le site.
