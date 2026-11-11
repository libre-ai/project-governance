# PRD-15 — Projets, tickets et support

## Contexte

P15 est le produit « projets, tickets et support » du catalogue d'ADR-0042 §1. ADR-0055 lève le gel de `signalement` et en fait le seul dépôt porteur de P15 (D94) ; `ai-work-supervision` reste la fabrique. La première version capture un signalement depuis une surface web et l'envoie au bon système de tickets, sous une politique d'organisation.

ADR-0064 D8 en fait la seconde brique `produit` à prouver, après PRD-02.

## Ce que la brique ferme

- Le signalement qui se perd entre l'endroit où il est émis et l'outil où il est traité : il est relayé, et l'émetteur reçoit un reçu qu'il peut vérifier.
- L'entrée de personnes tierces sans cadre : un signalement vient d'un usager, d'un client ou d'un habitant, et I-22 exige pour lui une base légale écrite et une information de la personne.
- L'injection par le contenu signalé : ce que la capture lit est une donnée, jamais une instruction (I-32).

## Ce qu'elle ne fait pas

- Elle ne remplace pas l'outil de tickets de l'organisation : elle projette vers lui.
- Elle n'impose pas de file de messages hébergée.
- Elle ne lit pas le navigateur de l'utilisateur au-delà de la page signalée.

## Mesure

- Preuve citée : le module de capture de l'extension, épinglé au commit du dépôt porteur. Il montre que la capture existe, pas qu'un signalement est relayé.
- Fait de dégel : un signalement réel, émis depuis une surface publique, relayé vers un connecteur réel, avec un reçu de projection vérifiable, sur une release signée dont l'évidence est publiée.
- Fait d'abandon : celui de la charte. C'est une proposition de l'agent (revue des chartes du 2026-11-09), sans source dans la doctrine ; le propriétaire ne l'a pas arbitrée.
- Les contrats publics de la v1 (politique de routage, enveloppe de remise, reçu de projection, profil de connecteur) sont dans `schemas-and-contracts` ; leur verrouillage est une condition du dégel, pas une preuve de cette brique.
