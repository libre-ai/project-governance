# PLT-01 — Cœur Rust par produit

## Contexte

ADR-0042 §6 pose une architecture agnostique : un cœur Rust et des adaptateurs d'interface par plateforme. Son §8 et ADR-0057 §1 parlent du « cœur Rust du produit ». I-06 retient Rust pour les moteurs spécialisés : c'est ce que la brique réalise. ADR-0057 §1 lie ce cœur dans le processus de la coquille (D96) et interdit au front d'en réimplémenter une fonction. ADR-0063, encore proposé, étendrait Rust à tout composant qui traite du contenu. Les deux preuves citées viennent de `personal-knowledge-workspace` pour P04 et de `square-control` pour P40.

## Ce que la brique ferme

- La logique métier écrite deux fois, dans le cœur et dans l'interface : le front ne réimplémente aucune fonction du cœur (ADR-0057 §1).
- Pour P04, le caractère modifié sans que la personne l'ait tapé : la lecture et l'écriture fidèles à l'octet restent dans le cœur (ADR-0044 décisions 2 et 3, D97).
- La brique de base entrée comme cœur alors qu'elle porte des fichiers ou des processus : ADR-0065 §2 (fusionné, statut non clos dans son fichier) exige qu'elle entre scindée ou comme adaptateur.

## Ce qu'elle ne fait pas

- Elle ne rend aucune interface : PLT-02.
- Elle ne choisit pas le serveur d'un produit : I-06 n'admet Rust comme runtime serveur complet que lorsque l'ADR du produit le décide.

## Mesure

- Preuve citée : le test du front de P04 qui refuse toute réimplémentation d'une fonction du cœur, par des vecteurs rouges appliqués à une copie du front réel.
- Preuve citée : le test Rust des vecteurs de référence du cœur d'agencement de P40, partagés avec le côté Swift.
- Aucune des deux ne montre un produit entier construit sur son cœur.
- Prochaine preuve : la série de mesures d'ADR-0057 §3 exécutée dans la coquille de P04, avec son rapport versionné.
