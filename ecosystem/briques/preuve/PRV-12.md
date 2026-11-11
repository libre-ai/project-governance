# PRV-12 — Collaboration chiffrée de bout en bout

## Contexte

I-34 impose que tout contenu échangé entre les membres d'un groupe circule « comme message applicatif MLS natif », RFC 9420, et que le destinataire vérifie la signature de l'expéditeur « avant toute application, avec refus fermé ». ADR-0048 (D70) a corrigé le design signé qui scellait les contenus sous une clé partagée par le groupe. L'invariant interdit de fusionner du code MLS avant ses vecteurs rouges. Ces vecteurs existent, candidats, dans `schemas-and-contracts`, avec un oracle de référence symbolique. L'inventaire de la flotte donne à `collaborative-data-sync` le cœur de collaboration et son relais ; aucun nom de fichier de ce dépôt ne contient `mls`, à sa tête lue le 2026-11-11.

## Ce que la brique ferme

Ces fermetures sont décrites par des vecteurs ; aucun code MLS ne les réalise.

- Le membre qui forge un contenu au nom d'un autre : la signature de la feuille de l'expéditeur est vérifiée avant toute application, avec refus fermé (I-34).
- Le contenu scellé sous une clé exportée ou dérivée, qui ne prouve que l'appartenance au groupe (I-34).
- Le message d'une époque périmée ou future, et le rejeu (I-34).

## Ce qu'elle ne fait pas

- Elle ne résout pas le conflit d'édition entre deux membres hors ligne : ADR-0048 le classe en risque accepté.
- Elle ne cache pas au relais les métadonnées observables : ADR-0048 laisse ce risque résiduel inchangé.
- Elle ne dit pas qui est derrière une feuille : I-34 authentifie une clé de feuille, et l'identité d'une personne est IDN-01.
- Un agent n'y écrit pas de code MLS seul : ADR-0048 tient cette intégration pour un incrément cadré, non délégable.

## Mesure

- Preuves citées : les vecteurs rouges candidats d'I-34 et leur oracle de référence, dans `schemas-and-contracts`, épinglés à un commit. Ils décrivent les refus attendus sur un modèle symbolique, dont le matériel cryptographique reste à produire. Ils ne montrent aucun code MLS.
- Prochain fait observable : une implémentation MLS dans `collaborative-data-sync` contre laquelle chaque vecteur rouge rend le refus attendu.
