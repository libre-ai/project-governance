# GOV-03 — Dégel et retrait de produit

## Contexte

ADR-0042 §1 fixe le catalogue des produits. Son §3 pose un moratoire : aucun nouveau dépôt avant le jalon B′, levé domaine par domaine par ADR. Deux levées existent : ADR-0052 pour Square Control (D76) et ADR-0055 pour `signalement` (D94). D80 consigne un retrait : deux dépôts hors catalogue sont sortis de l'organisation. La charte d'une brique produit porte un fait de dégel et un fait d'abandon. Aucun compteur n'évalue encore ces deux faits.

## Ce que la brique ferme

- Un produit ouvert par opportunité : la sortie du gel passe par un ADR signé (I-17, D53).
- Un produit exposé sans rien de vérifiable : I-15 lie la vitrine à l'échelle de preuve.
- Un abandon jugé sur une comparaison prématurée : I-27 interdit d'évaluer un critère de parité avant l'usage réel.
- Un dépôt déclaré archivé qui reste inscriptible : l'inventaire fait foi (I-14).

## Ce qu'elle ne fait pas

- Elle ne rédige pas la charte : celle-ci appartient à chaque brique de la couche produit.
- Elle ne crée ni ne supprime un dépôt : ces actes restent au propriétaire (GOV-01).
- Elle n'exige pas l'analyse d'impact avant un dégel : ce lien avec GOV-12 n'est pas décidé.

## Mesure

Preuve citée : `ecosystem/check-inventory-drift.ts`. Ce gate compare le cycle de vie déclaré à l'inventaire avec l'archivage constaté sur la forge, dans les deux sens. Il montre qu'un retrait déclaré est un retrait constaté, pas qu'un fait de dégel est évalué.

Prochaine preuve : un gate lit le fait de dégel et le fait d'abandon de chaque charte et imprime, par produit, lequel est constaté.
