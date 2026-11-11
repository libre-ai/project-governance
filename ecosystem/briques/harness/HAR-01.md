# HAR-01 — Contrat de brique

## Contexte

Aucun artefact de la flotte ne décrit une brique exécutable par ses entrées, ses sorties, ses effets et la preuve qu'elle doit rendre. Le schéma de la carte (ADR-0064 D2) porte le rôle, les dépendances et les preuves, pas ce que la brique consomme ni ce qu'elle modifie. La doctrine a cette forme pour une étape de graphe : ADR-0034 D4 lui fait déclarer sa classe, calcul ou effet externe, et ses résultats fermés. La brique étend cette forme à toute brique exécutable, comme contrat canonique au sens d'I-03.

## Ce que la brique ferme

- Une brique lancée sans effets déclarés : rien ne dit ce qu'un agent peut toucher en l'exécutant.
- Une exécution dont la preuve attendue n'est pas nommée d'avance, contraire à I-08.
- Deux descriptions concurrentes d'une même brique, en prose et en code, que seule une autorité unique évite (I-03).

## Ce qu'elle ne fait pas

- Elle ne porte pas le protocole du moteur : plans, invocations et attestations relèvent de HAR-10.
- Elle ne fixe pas le niveau d'autonomie d'un agent sur la brique, objet de HAR-12.
- Elle ne remplace pas la fiche de brique, qui reste la source du lecteur (ADR-0064 D3).

## Mesure

Preuve citée : aucune. Aucun dépôt de la flotte ne porte un contrat de cette forme.

Prochaine preuve : un contrat candidat dans `schemas-and-contracts`, avec ses vecteurs valides et invalides, et une première brique exécutable dont la déclaration passe ce contrat dans un gate.
