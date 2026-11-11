# PLT-09 — Design system EUPL

## Contexte

ADR-0054 §3 décide pour P02 un design system écrit sous EUPL et écarte la réutilisation de `@libre-ai/ui` (D86). L'étendre aux fronts des autres produits est une proposition de l'agent, non arbitrée. I-11 différencie les licences EUPL, Apache-2.0 et CC BY : le choix d'EUPL pour ce paquet en relève. ADR-0033 confie à `ui` les jetons, les composants et la licence des assets, et I-29 lui donne la réalisation visuelle de la marque : un second design system ne la possède pas. `LICENSING.md` range sous Apache-2.0 les paquets de design tournés vers le client. Le paquet `ui` vit dans `application-development-toolkit` ; au commit lu le 2026-11-11, son `REUSE.toml` annote ses sources en Apache-2.0. ADR-0054 §3 tranche pour P02 seul. Ni ADR-0033, ni ADR-0054, ni `LICENSING.md` ne disent quel paquet sert le front d'un autre produit.

## Ce que la brique ferme

- Le front de P02 qui dépendrait d'un paquet d'interface qu'ADR-0054 §3 dit bloqué pour cet usage.
- Proposition de l'agent, non arbitrée : les jetons et les composants récrits par chaque produit.

## Ce qu'elle ne fait pas

- Elle ne tranche pas la licence de `@libre-ai/ui` : c'est une décision du propriétaire.
- Elle ne possède pas la sémantique de la marque, qui reste à `governance` (I-29).
- Elle ne fixe pas l'exigence d'accessibilité de ses composants : sans PLT-07, ils n'ont pas de critère contre lequel être vérifiés.

## Mesure

- Preuve citée : aucune. Au 2026-11-11, le dépôt de P02 n'est pas à l'inventaire de la flotte.
- Le paquet `ui` n'est pas cité : sa licence déclarée n'est pas celle que le nom de la brique porte, et le citer trancherait la question.
- Prochaine preuve : un paquet de jetons et de composants dont le `REUSE.toml` déclare EUPL-1.2, consommé par le front d'un produit dans un dépôt de l'inventaire.
