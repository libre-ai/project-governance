# IDN-05 — Révocation continue

## Contexte

I-09 veut un jeton révocable, et I-18 une révocation par agent. Dans `capability-authorization`, la révocation par jeton vise le bloc racine vérifié et se contrôle avant toute évaluation de politique. Un magasin indisponible vaut refus. La révocation par agent agit à l'émission : un agent révoqué n'obtient plus de jeton. L'invalidation d'un jeton déjà émis à un agent révoqué est différée ; seule la durée de vie courte du jeton la borne. Aucun flux d'événements ne propage une révocation entre services.

## Ce que la brique ferme

- Le jeton volé qui reste valable jusqu'à son échéance : un bloc racine révoqué est refusé avant elle (I-09).
- Le contournement par cache : seul un verdict de révocation est mis en cache, jamais une acceptation.
- La panne lue comme une permission : sans magasin de révocation, la réponse est un refus.
- Le délai entre la détection d'un agent compromis et son arrêt, risque résiduel que le modèle de menace rattache à I-18.

## Ce qu'elle ne fait pas

- Elle ne décide pas qui révoquer : la décision vient d'un arrêt, d'un gate ou du propriétaire.
- Elle n'émet ni n'atténue de jeton : c'est IDN-02.
- Elle n'arrête pas un processus en cours : couper l'exécution relève de PRV-08.

## Mesure

- Preuve citée : le module de révocation, épinglé. Il montre le contrôle par jeton, le refus sur magasin indisponible et la révocation par agent à l'émission. Il ne montre aucune propagation entre services.
- Prochaine preuve : un test publié où un jeton d'agent déjà émis est refusé par un second vérificateur dès la révocation de l'agent, sans attendre l'échéance.
