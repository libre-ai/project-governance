# GOV-03 — Dégel et retrait de produit

## Contexte

ADR-0042 §1 fixe le catalogue et dit quels produits sortent du gel. Son §3 pose un moratoire : aucun nouveau dépôt avant le jalon B′, levé domaine par domaine par ADR (D53). Deux levées du moratoire existent : ADR-0052 pour le domaine de Square Control (D76), et ADR-0054 pour le seul dépôt de P02 (D89). ADR-0055 sort `signalement` du gel sans toucher au moratoire (D94). D80 consigne un retrait : deux dépôts hors catalogue sont sortis de l'organisation et de l'inventaire. ADR-0064 D2, proposé, donne à la charte d'une brique produit un fait de dégel et un fait d'abandon.

## Ce que la brique ferme

- Un dépôt créé par opportunité : I-17 réserve l'activation d'un dépôt produit au propriétaire, et D53 ne lève le moratoire que par ADR.
- Un abandon jugé sur une comparaison prématurée : I-27 interdit d'évaluer un `kill_predicate` fondé sur une comparaison à un concurrent avant le jalon dogfooding du produit.
- Un dépôt déclaré archivé qui reste inscriptible : I-14 pose que l'inventaire lisible par machine fait foi, et le gate cité le compare à la forge.

## Ce qu'elle ne fait pas

- Elle ne crée ni ne supprime un dépôt. Sans GOV-01, ni dégel ni retrait n'a lieu : chacun est une décision du propriétaire.
- Elle n'évalue pas les faits de dégel et d'abandon : le vérificateur de la carte contrôle seulement qu'ils ne nomment pas un délai.

## Mesure

Preuve citée : `ecosystem/check-inventory-drift.ts`. Ce gate compare l'inventaire à l'organisation observée sur la forge, dans les deux sens : présence, visibilité, cycle de vie. Il montre qu'un archivage déclaré est constaté, pas qu'un fait de dégel ou d'abandon est évalué. En intégration continue, il compte non vérifiable une entrée privée et active.

Prochaine preuve : un gate lit le fait de dégel et le fait d'abandon de chaque charte et imprime, par produit, lequel est constaté.
