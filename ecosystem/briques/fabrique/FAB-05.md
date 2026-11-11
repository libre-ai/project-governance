# FAB-05 — Oracle de parité

## Contexte

ADR-0042 §6 demande une matrice de parité par produit : chaque fonction requise donne un test d'acceptation dont le seuil est figé avant la mesure (D55). I-27, posé par ADR-0027 (D34), interdit d'évaluer un gate de parité avant le jalon de dogfooding du produit. I-08 fait tracer à chaque dépôt produit ses phases et ses critères dans sa fiche `project.v1.yaml`. Le schéma de cette fiche exige d'un produit ses critères de promotion, ses prédicats d'arrêt et son étalon. D34 requalifie comme non opposables les audits existants, qui ont mesuré des spécifications. Dans ce dépôt, au 2026-11-11, aucun gate ne lit ces champs pour évaluer une parité.

## Ce que la brique ferme

- Le seuil ajusté après la mesure : il est figé avant (ADR-0042 §6).
- Le verdict tiré d'une spécification : un audit n'est opposable que s'il mesure du code livré (I-27).
- Le gate qui tire trop tôt : il ne s'évalue pas avant le jalon de dogfooding du produit, sur un usage réel (I-27).
- L'étalon complet exigé dès la première version : la cible opposable est le périmètre que l'audit du produit recommande (I-27).

## Ce qu'elle ne fait pas

- Elle ne décide pas du retrait d'un produit : un prédicat d'arrêt qui tire ouvre une décision du propriétaire, par GOV-03.
- Elle ne recalibre aucune fiche : chaque dépôt produit reste maître de la sienne (ADR-0027).
- Elle ne vérifie pas la conformité d'une implémentation à un contrat canonique : ce sont les vecteurs de GOV-07.

## Mesure

- Preuve citée : aucune. Le schéma des fiches déclare les champs de parité. Aucun gate de ce dépôt ne lit un seuil ni ne rejoue un test, au 2026-11-11.
- Prochaine preuve : un test d'acceptation de parité exécuté sur le code livré d'un produit qui a atteint son jalon de dogfooding, avec son seuil écrit avant l'exécution.
