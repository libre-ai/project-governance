# PLT-09 — Design system EUPL

## Contexte

ADR-0054 §3 décide pour P02 un design system écrit sous EUPL et écarte la réutilisation de `@libre-ai/ui` (D86). ADR-0033 confie pourtant à `ui` les jetons, les composants et la licence des assets (I-29), et `LICENSING.md` range sous Apache-2.0 les paquets de design tournés vers le client. Ce paquet vit dans `application-development-toolkit`, où son `REUSE.toml` annote ses sources en Apache-2.0, relevé le 2026-11-11 sur la tête servie. La doctrine porte donc deux règles de licence pour le même objet, et aucune décision ne les départage.

## Ce que la brique ferme

- Le front d'un produit sous EUPL qui dépend d'un paquet d'interface dont la licence n'est pas tranchée pour cet usage (ADR-0054 §3).
- Les jetons et les composants récrits par chaque produit, alors qu'ADR-0057 pose un seul moteur de rendu de front pour la flotte.
- L'asset figuratif publié avant l'acceptation de sa licence dédiée et l'archivage du contrôle de similarité (I-29).

## Ce qu'elle ne fait pas

- Elle ne tranche pas la licence de `@libre-ai/ui` : c'est une décision du propriétaire.
- Elle ne possède pas la sémantique de la marque, qui reste à `governance` (I-29).
- Elle ne fixe pas l'exigence d'accessibilité de ses composants : PLT-07.

## Mesure

- Preuve citée : aucune. Aucun dépôt de l'inventaire ne porte un design system sous EUPL, et le dépôt de P02 n'est pas à l'inventaire.
- Le paquet existant n'est pas cité : sa licence déclarée contredit le nom de la brique, et le citer trancherait le conflit.
- Prochaine preuve : un paquet de jetons et de composants dont le `REUSE.toml` déclare EUPL-1.2, consommé par le front d'un produit dans un dépôt de l'inventaire.
