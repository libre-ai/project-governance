# FAB-05 — Oracle de parité

## Contexte

ADR-0042 §6 demande une matrice de parité par produit : chaque fonction requise donne un test d'acceptation dont le seuil est figé avant la mesure. I-27 interdit d'évaluer un gate de parité avant le jalon de dogfooding du produit. Le schéma des fiches de projet exige d'un produit ses critères de promotion, ses prédicats d'arrêt et son étalon. Aucun artefact n'exécute une comparaison de parité : les audits existants ont mesuré des spécifications, et ADR-0027 les déclare non opposables.

## Ce que la brique ferme

- Le seuil ajusté après la mesure : il est figé avant (ADR-0042 §6, D55).
- Le verdict tiré d'une spécification : un audit n'est opposable que s'il mesure du code livré (I-27).
- Le gate qui tire trop tôt : aucune comparaison ne s'évalue avant un usage réel du produit (I-19, I-27).
- L'étalon complet exigé dès la première version : la cible opposable est le périmètre que l'audit recommande (I-27).

## Ce qu'elle ne fait pas

- Elle ne décide pas du retrait d'un produit : un prédicat d'arrêt qui tire ouvre une décision du propriétaire, par GOV-03.
- Elle ne recalibre aucune fiche : chaque dépôt produit reste maître de la sienne (ADR-0027).
- Elle ne vérifie pas la conformité d'une implémentation à un contrat canonique : ce sont les vecteurs de GOV-07.

## Mesure

- Preuve citée : aucune. Le schéma des fiches déclare les champs de parité ; aucun gate ne lit un seuil ni ne rejoue un test.
- Prochaine preuve : un test d'acceptation de parité exécuté sur le code livré d'un produit qui a atteint son jalon de dogfooding, avec son seuil écrit avant l'exécution.
