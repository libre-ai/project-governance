# PRD-02 — Veille documentaire

## Contexte

P02 est le produit de veille du catalogue d'ADR-0042 §1. ADR-0054 le sort du gel et fixe sa première version : un serveur entièrement en Rust, et trois surfaces qui parlent à la même API (une application web installable, une application macOS sous Tauri 2, une extension de navigateur sans accès réseau). ADR-0064 D8 en fait la première brique `produit` qui doit atteindre `prototypee`, sous la pile d'ADR-0063.

Son dépôt porteur existe et reste privé : I-30 sépare l'attestation, la publication et l'enregistrement à l'inventaire, et aucun des trois n'est fait. Cette fiche ne nomme donc aucun porteur dans ses données et ne cite aucune preuve.

## Ce que la brique ferme

- La veille qui passe par un serveur tiers : les sources suivies et ce qui est lu restent sur le poste ou chez l'organisation (I-10).
- La logique dupliquée par surface : l'application macOS et l'extension ne parsent rien, elles délèguent à l'API (ADR-0054 §3).
- Le produit annoncé avant d'être vérifiable : la brique ne compte comme prototypée qu'avec une release signée liée à son évidence (I-15, I-20).

## Ce qu'elle ne fait pas

- Elle ne parse pas de flux dans l'application macOS ni dans l'extension.
- Elle ne stocke aucune donnée de paiement, y compris pour l'offre hébergée (D81).
- Elle n'ouvre ni mobile, ni Windows, ni Linux au premier palier ; Linux s'ouvre au second palier, quand la brique est prototypée sur macOS et que sa matrice de parité est verte (ADR-0064 D7).
- Elle ne dépend d'aucun service managé pour son cœur.

## Mesure

- Preuve citée : aucune. Rien n'est citable tant que le dépôt porteur est privé (I-15).
- Fait de dégel : les trois surfaces construites sur le même cœur, avec les preuves par surface d'ADR-0054 §3 (parcours sur trois navigateurs et trois largeurs ; sur macOS, aucun port en écoute, signature et notarisation, mémoire résidente sous le plafond fixé ; extension sur deux navigateurs réels), sur une release signée dont l'évidence est publiée.
- Fait d'abandon : celui de la charte. C'est une proposition de l'agent (revue des chartes du 2026-11-09), sans source dans la doctrine ; le propriétaire ne l'a pas arbitrée.
- À l'enregistrement du dépôt à l'inventaire : ajouter le porteur, puis une preuve épinglée par commit.
