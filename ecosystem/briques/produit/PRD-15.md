# PRD-15 — Projets, tickets et support

## Contexte

ADR-0042 §1 inscrit P15, « projets, tickets et support », au catalogue. ADR-0055 lève le gel de `signalement` et en fait son seul dépôt porteur (D94). La première version signale un problème depuis une interface web et l'envoie au bon système de tickets, sous une politique d'organisation. ADR-0064 D8, encore proposé, en fait la seconde brique `produit` à prouver.

La carte pose trois dépendances, sans source dans ADR-0055. Sans PAS-02, rien ne dit dans quelle zone un signalement, qui porte les données d'un tiers, peut être relayé. Sans PLT-06, sa release n'a pas de retour arrière. Sans PLT-07, elle n'a pas le parcours d'accessibilité qu'exige le standard de spécification.

## Ce que la brique ferme

- Le signalement qui n'atteint pas l'outil où il est traité : il est envoyé au système de tickets de l'organisation (ADR-0055).
- Le travail sans trace : I-08 fait tracer phases, critères et preuves datées dans la fiche `project.v1.yaml` du dépôt, qu'ADR-0055 garde comme source de son état.
- Le produit montré avant d'être vérifiable : I-15 n'ouvre sa vitrine publique que dès quelque chose de vérifiable.

## Ce qu'elle ne fait pas

- Elle ne remplace pas l'outil de tickets : elle projette vers lui.
- Propositions de l'agent, sans source dans ce dépôt et non arbitrées : dans la charte, le « reçu que l'émetteur peut vérifier », le « courriel », les refus d'une file de messages hébergée et d'une lecture du navigateur au-delà de la page signalée, et le fait d'abandon.

## Mesure

- Preuve citée : le module de capture de l'extension. Il capture en image l'onglet actif sur action explicite, sans script injecté dans la page. Il ne montre ni relais ni reçu.
- Fait de dégel : celui de la charte.
- ADR-0055 fait attendre le premier lot de code jusqu'au verrouillage des contrats publics de la v1 dans `schemas-and-contracts`.
