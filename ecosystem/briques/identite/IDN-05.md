# IDN-05 — Révocation continue

## Contexte

I-09 veut un Biscuit « révocable », et I-18 une « révocation par agent » (ADR-0009 §6). La spécification d'identité de ce dépôt (`docs/specifications/IDENTITY-AUTHORIZATION.md`), sous l'autorité d'ADR-0002 §2, fait contrôler la révocation avant toute évaluation de politique et fait d'un magasin indisponible un refus. Dans `capability-authorization`, la révocation par jeton vise le bloc racine vérifié. La révocation par agent agit à l'émission : un agent révoqué n'obtient plus de jeton. La spécification du noyau de sécurité diffère l'invalidation d'un jeton déjà émis à un agent révoqué ; seule la durée de vie courte du jeton la borne. La brique dépend d'IDN-02 : sans jeton émis, elle n'a rien à refuser. Elle dépend d'IDN-04 : sans identité d'agent, la révocation par agent n'a pas de clé.

## Ce que la brique ferme

- Le jeton volé qui reste valable jusqu'à son échéance : un bloc racine révoqué est refusé avant elle (I-09).
- Le contournement par cache : seul un verdict de révocation est mis en cache, jamais une acceptation. Chaque acceptation reconsulte le magasin.
- La panne lue comme une permission : sans magasin de révocation, la réponse est un refus.

## Ce qu'elle ne fait pas

- Elle n'invalide pas le jeton déjà émis à un agent révoqué : le modèle de menace de ce dépôt rattache ce risque résiduel à I-18.
- Elle ne décide pas qui révoquer.
- Elle n'émet ni n'atténue de jeton : c'est IDN-02.
- Elle n'arrête pas une mission en cours : c'est PRV-08.

## Mesure

- Preuve citée : le module de révocation, épinglé. Il montre le contrôle par jeton, le refus sur magasin indisponible et l'enregistrement de révocation par agent consulté à l'émission. Il porte un trait de magasin, pas un magasin partagé en service : il ne montre pas une révocation reçue par un second vérificateur.
- Prochaine preuve : un test publié où un jeton d'agent déjà émis est refusé par un second vérificateur dès la révocation de l'agent, sans attendre l'échéance.
