# PRV-12 — Collaboration chiffrée de bout en bout

## Contexte

I-34 impose que tout contenu échangé entre les membres d'un groupe circule « comme message applicatif MLS natif », RFC 9420, et que le destinataire vérifie la signature de l'expéditeur « avant toute application, avec refus fermé ». ADR-0048 (D70) a corrigé le design signé qui scellait les contenus sous une clé partagée par le groupe. L'invariant interdit de fusionner du code MLS avant ses vecteurs rouges. Ces vecteurs existent, candidats, dans `schemas-and-contracts`, avec un oracle de référence symbolique. L'inventaire de la flotte donne à `collaborative-data-sync` le cœur de collaboration et son relais ; aucun nom de fichier de ce dépôt ne contient `mls`, à sa tête lue le 2026-11-11.

## Ce que la brique ferme

- Le code MLS écrit avant que ses refus soient fixés : les vecteurs rouges qu'I-34 exige d'abord existent, candidats, un par clause de l'invariant au moins.
- Le vecteur rouge qui rougirait pour une autre raison que celle qu'il déclare : l'oracle rejoue chaque vecteur sur un modèle symbolique et vérifie qu'il viole exactement les propriétés déclarées.

## Ce qu'elle ne fait pas

- Elle ne refuse encore aucun message. Le contenu forgé par un membre au nom d'un autre, le contenu scellé sous une clé exportée ou dérivée, le message d'une époque périmée ou future et le rejeu sont des refus attendus, décrits par les vecteurs ; les preuves citées ici ne contiennent aucun code MLS, et l'oracle se déclare « not an MLS implementation ».
- Elle ne corrige pas le dépôt porteur : les vecteurs relèvent, à une révision qu'ils nomment, que le cadre scellé de `collaborative-data-sync` ne porte ni expéditeur ni signature, forme qu'I-34 refuse. À la tête de ce dépôt lue le 2026-11-11, le type de ce cadre n'a toujours que l'époque, le nonce, le chiffré et l'étiquette d'authentification.
- Elle ne résout pas le conflit d'édition entre deux membres hors ligne : ADR-0048 le classe en risque accepté.
- Elle ne cache pas au relais les métadonnées observables : ADR-0048 laisse ce risque résiduel inchangé.
- Elle ne dit pas qui est derrière une feuille : I-34 authentifie une clé de feuille, et l'identité d'une personne est IDN-01.
- Un agent n'y écrit pas de code MLS seul : ADR-0048 tient cette intégration pour un incrément cadré, non délégable.

## Mesure

- Preuves citées : les vecteurs rouges candidats d'I-34 et leur oracle de référence, dans `schemas-and-contracts`, épinglés à un commit. Ils décrivent les refus attendus sur un modèle symbolique, dont le matériel cryptographique reste à produire (`cryptoMaterial: "to-generate"`). Ils ne montrent aucun code MLS, et ils consignent deux écarts connus : le cadre scellé de `collaborative-data-sync`, et deux autorités de protocole de `schemas-and-contracts` qui décrivent encore la clé de groupe par époque.
- Prochain fait observable : une implémentation MLS dans `collaborative-data-sync` contre laquelle chaque vecteur rouge rend le refus attendu.
