# GOV-09 — Boucle de management (plan, mesure, revue, amélioration)

## Contexte

I-13 fait de la méthode le produit zéro, et I-20 publie par défaut l'évidence de la forge. ADR-0042 §3 demande, à chaque clôture de jalon, un rapport public daté de ses enseignements (D53). `project-governance` porte des contrôles périodiques : reproduction en salle blanche, rapport de souveraineté, dérive de l'inventaire, avis de sécurité. ADR-0029 leur ajoute une alerte sur échec répété. Aucun générateur ne produit le rapport de jalon, et la revue des usages vit hors de la flotte.

## Ce que la brique ferme

- Un contrôle périodique rouge que personne ne lit : deux échecs consécutifs ouvrent une issue (ADR-0029).
- Un plan sans mesure : I-08 lie chaque phase à des critères pondérés et à des preuves datées.
- Un jalon clos sans enseignement écrit (ADR-0042 §3).

## Ce qu'elle ne fait pas

- Elle ne vise aucune certification : ni le registre des invariants ni celui des décisions n'en demandent.
- Elle ne mesure pas la conformité d'un dépôt : elle lit ce que GOV-06 mesure.
- Elle ne corrige rien seule : l'alerte signale, le correctif reste une décision.

## Mesure

Preuve citée : `tools/security/repeat-failure-alert.ts`. Cette étape ouvre une issue quand un contrôle planifié échoue deux fois de suite, et la ferme au premier succès. Elle montre que la mesure périodique a un lecteur, pas qu'une revue en tire une amélioration.

Prochaine preuve : un rapport de jalon généré depuis les fiches et l'évidence publiée, daté et référencé depuis le site.
