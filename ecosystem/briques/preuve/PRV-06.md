# PRV-06 — Adversaire continu

## Contexte

I-30 exige, avant la première publication d'un dépôt, des « contrepreuves rouges par surface » (ADR-0038, D44). Ce dépôt porte les outils de cette attestation, et un outil qui neutralise un à un leurs sites de refus et exige qu'un test rougisse à chaque fois. Cet outil tourne dans `bun run check`. I-34 demande des vecteurs rouges du même genre pour une autre surface ; il lie PRV-12 et n'est pas cité ici. Le rôle vise des sondes rejouées contre tout système de Libre AI : la preuve ne couvre que les outils d'attestation.

## Ce que la brique ferme

- Le contrôle qui reste vert quand on retire ce qu'il vérifie : un site de refus neutralisé sans test rouge est compté comme un défaut.
- Le test qui casse au lieu d'affirmer : un mutant qui ne provoque qu'un plantage est rapporté à part et compté comme un problème.
- Le site de refus hors de vue : l'outil compte les sites par son propre motif et échoue sur un site qui n'a ni marqueur ni exemption motivée.

## Ce qu'elle ne fait pas

- Elle ne vise aucun système tiers : le rôle borne les sondes aux seuls systèmes de Libre AI.
- Elle ne sonde ni un agent ni un produit.
- Elle ne décide pas des menaces : le modèle est PRV-07.
- Elle n'observe pas les agents en service : c'est PRV-05.

## Mesure

- Preuve citée : l'outil de neutralisation des contrôles d'attestation, dans ce dépôt. Il montre que chaque site de refus marqué de ces outils est rejoué contre un mutant, et qu'un test doit alors échouer par assertion ; un site exempté n'est pas rejoué, il est compté à part. Il ne couvre que cette surface : la part du rôle qui vise tout système de Libre AI n'a pas de preuve.
- Prochain fait observable : un jeu de sondes rejoué dans le workflow de release d'un produit, dont une sonde rougit quand la défense visée est neutralisée.
