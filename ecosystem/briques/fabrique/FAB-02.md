# FAB-02 — Charte de brique

## Contexte

ADR-0064, proposé, donne par D2 un champ `charte` à toute brique de la couche `produit`. La charte tient en cinq lignes : la valeur, le public, le fait de dégel, le fait d'abandon et les refus. Le schéma `brique.v1` la décrit, et le vérificateur refuse une brique produit qui n'en porte pas. Deux produits du catalogue d'ADR-0042 §1 ont une charte en données, `PRD-02` et `PRD-15` : la précision 9 d'ADR-0064 les retient parce qu'un ADR fixe leur première version. Aucun invariant ne lie cette brique.

## Ce que la brique ferme

- Le produit écrit sans public ni critère : sans charte, une brique produit est refusée (ADR-0064 D2).
- Le dégel ou l'abandon énoncé comme une durée : le gate y refuse un mot de durée, et chacun doit nommer un fait observable.

## Ce qu'elle ne fait pas

- Elle ne décide ni du dégel ni du retrait d'un produit. Sans GOV-03, ses lignes de dégel et d'abandon ne se rattachent à aucun acte : c'est GOV-03 qui sort un produit du gel ou le retire, sur décision du propriétaire.
- Elle ne vérifie pas sa propre forme. Sans FAB-13, rien ne refuse une brique produit sans charte : FAB-13 lit le schéma et applique la règle de couche.
- Elle ne remplace pas la fiche `project.v1.yaml` du dépôt porteur.

## Mesure

- Preuve citée : `ecosystem/schemas/brique.v1.schema.json`. Elle montre que la charte a cinq champs requis et n'en admet aucun autre. Elle ne montre pas qu'un produit tient sa charte.
- Les deux faits d'abandon écrits sont des propositions : la revue des chartes du 2026-11-09 les marque ainsi, et le propriétaire ne les a pas arbitrés.
- Prochaine preuve : une charte reprise par la fiche de son dépôt porteur, puis son fait de dégel constaté sur une release signée liée à son évidence.
