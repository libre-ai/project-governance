# FAB-02 — Charte de brique

## Contexte

ADR-0064 D2 donne à toute brique de la couche `produit` un champ `charte`. La charte tient en cinq lignes : la valeur, le public, le fait de dégel, le fait d'abandon et les refus. Le schéma `brique.v1` la décrit, et le vérificateur refuse une brique produit qui n'en porte pas. Seuls les produits du catalogue d'ADR-0042 §1 qui ont un ADR de sortie de gel ont une charte en données.

## Ce que la brique ferme

- Le produit écrit sans public ni critère : sans charte, une brique produit est refusée (ADR-0064 D2).
- Le dégel ou l'abandon énoncé comme une durée : le gate y refuse un mot de durée, et chacun nomme un fait observable (I-08).
- La vitrine sans rien de vérifiable : le fait de dégel dit ce qui doit pouvoir être montré avant toute exposition (I-15).

## Ce qu'elle ne fait pas

- Elle ne décide ni du dégel ni du retrait d'un produit : la décision revient au propriétaire, par GOV-03.
- Elle ne vérifie pas sa propre forme : FAB-13 lit le schéma et applique la règle de couche.
- Elle ne remplace pas la fiche `project.v1.yaml` du dépôt porteur.

## Mesure

- Preuve citée : `ecosystem/schemas/brique.v1.schema.json`. Elle montre que la charte a cinq champs requis et n'en admet aucun autre. Elle ne montre pas qu'un produit tient sa charte.
- Les faits d'abandon écrits sont des propositions de l'agent, que le propriétaire n'a pas arbitrées.
- Prochaine preuve : une charte reprise par la fiche de son dépôt porteur, puis son fait de dégel constaté sur une release signée liée à son évidence.
