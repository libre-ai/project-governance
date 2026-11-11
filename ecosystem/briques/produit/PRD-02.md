# PRD-02 — Veille documentaire

## Contexte

ADR-0042 §1 inscrit P02 au catalogue et le sort du gel. ADR-0054 fixe sa première version et lève le moratoire pour son dépôt dédié : un serveur en Rust (D85), que I-06 amendé admet quand l'ADR du produit le décide, et trois surfaces sur la même API. Il porte aussi une offre hébergée payante (D81). ADR-0064 D8 et ADR-0063 D6, encore proposés, en font la première brique `produit` à prouver.

I-30 sépare le nom et l'enrôlement, le distant de staging privé, puis l'exposition publique après attestation. Au 2026-11-11, `information-watch` n'est pas à l'inventaire : la fiche ne nomme aucun porteur.

Sans PLT-01, ses surfaces n'ont pas de cœur commun. Sans PLT-02, ni coquille ni PWA. Sans PLT-05, aucune cible de preuve inscrite. Sans PLT-07, pas de parcours d'accessibilité, qu'exige le standard de spécification. Sans EXE-04, pas de parseur isolé en processus fils.

## Ce que la brique ferme

- La logique dupliquée par surface : l'application macOS et l'extension délèguent à l'API (ADR-0054 §3).
- Le produit montré avant d'être vérifiable : I-15 n'ouvre sa vitrine publique que dès quelque chose de vérifiable.
- Le travail sans trace : I-08 fait tracer phases, critères et preuves datées dans la fiche `project.v1.yaml` de son dépôt.
- La parité jugée trop tôt : I-27 n'évalue son gate de parité qu'après son jalon de dogfooding.

## Ce qu'elle ne fait pas

- Elle ne stocke aucune donnée de paiement (D87).
- Elle n'ouvre ni mobile, ni Windows, ni Linux au premier palier (ADR-0054 §3).
- Propositions de l'agent, non arbitrées : la clause « sans qu'aucun serveur tiers ne sache ce qu'on lit » de la charte, son refus d'un service managé, et son fait d'abandon.

## Mesure

- Preuve citée : aucune.
- Fait de dégel : celui de la charte.
- Prochain fait observable : l'entrée du dépôt à l'inventaire, puis une preuve épinglée.
