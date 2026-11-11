# PRV-06 — Adversaire continu

## Contexte

La doctrine exige déjà des contrepreuves par endroits. I-30 demande des contrepreuves rouges par surface avant la première publication d'un dépôt (ADR-0038, D44). I-34 demande des vecteurs rouges dont chacun rougit contre une implémentation privée de la propriété visée (ADR-0048, D70). Ce dépôt porte un outil qui neutralise un à un les contrôles des outils d'attestation et exige qu'un test rougisse à chaque fois. Rien ne rejoue de sondes contre un agent ou un produit.

## Ce que la brique ferme

- Le contrôle qui reste vert quand on retire ce qu'il vérifie : un contrôle neutralisé sans test rouge est compté comme un défaut.
- La défense prouvée une fois puis jamais rejouée : les sondes tournent à chaque vérification.
- La menace inscrite au modèle sans essai correspondant : chaque sonde part d'une ligne de PRV-07.

## Ce qu'elle ne fait pas

- Elle ne vise aucun système tiers : les sondes tournent contre les seuls systèmes de Libre AI.
- Elle ne remplace pas la revue humaine, seule revue qui vaut sous I-17.
- Elle ne décide pas des menaces : le modèle est PRV-07.
- Elle n'observe pas les agents en service : c'est PRV-05.

## Mesure

- Preuve citée : l'outil de neutralisation des contrôles d'attestation, dans ce dépôt. Il montre que chaque site de refus de ces outils est rejoué contre un mutant. Il ne couvre que cette surface.
- Prochain fait observable : un jeu de sondes tiré des menaces du modèle, rejoué dans le workflow de release d'un produit, dont une sonde rougit quand la défense visée est neutralisée.
