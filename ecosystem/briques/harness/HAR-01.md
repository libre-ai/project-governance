# HAR-01 — Contrat de brique

## Contexte

Le schéma de la carte porte le rôle, les dépendances et les preuves d'une brique. Il ne porte ni ce qu'elle consomme, ni ce qu'elle rend, ni ce qu'elle modifie. La doctrine a cette forme pour une étape de graphe : ADR-0034 D4 lui fait déclarer sa classe, calcul ou effet externe, et D1 ses résultats fermés. La brique étend cette forme à toute brique exécutable. I-03 réserve les contrats canoniques à une autorité unique, `contracts` : un tel contrat y aurait sa place. Parmi les 103 schémas de `schemas-and-contracts` au commit que cette couche épingle, lus le 2026-11-11, aucun nom ne désigne une brique. Ce relevé porte sur les noms, pas sur les contenus.

## Ce que la brique ferme

- Une brique lancée sans effets déclarés : rien ne dit ce qu'un agent peut toucher en l'exécutant.
- Une exécution dont la preuve attendue n'est pas nommée d'avance.
- Deux descriptions concurrentes d'une même brique, en prose et en code, que seule une autorité unique évite (I-03).

## Ce qu'elle ne fait pas

- Elle ne porte pas le protocole du moteur : plans, invocations et attestations relèvent de HAR-10.
- Elle ne fixe pas le niveau d'autonomie d'un agent sur la brique, objet de HAR-12.
- Elle ne tient pas l'autorité des contrats. Sans GOV-07, son contrat n'aurait ni autorité ni vecteurs.
- Elle ne remplace pas la fiche de brique, qui reste la source du lecteur.

## Mesure

Preuve citée : aucune. Le schéma de la carte n'a aucun champ d'entrée, de sortie ou d'effet.

Prochaine preuve : un contrat candidat dans `schemas-and-contracts`, avec ses vecteurs valides et invalides, et une première brique exécutable dont la déclaration passe ce contrat dans un gate.
