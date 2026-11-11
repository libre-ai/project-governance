# PLT-01 — Cœur Rust par produit

## Contexte

ADR-0042 §6 pose une architecture agnostique : un cœur Rust par produit et des adaptateurs d'interface par plateforme. ADR-0057 §1 lie ce cœur dans le processus de la coquille et interdit au front d'en réimplémenter une fonction. ADR-0063, encore proposé, étendrait Rust à tout composant qui traite du contenu. Deux dépôts portent un cœur aujourd'hui : `personal-knowledge-workspace` pour P04 et `square-control` pour P40.

## Ce que la brique ferme

- La logique métier écrite deux fois, dans le cœur et dans l'interface : le pont est le seul chemin d'appel (ADR-0057 §1, D96).
- Le caractère modifié sans que la personne l'ait tapé : la lecture et l'écriture fidèles à l'octet restent dans le cœur (ADR-0044 décisions 2 et 3, D97).
- La brique de base entrée comme cœur alors qu'elle porte des fichiers ou des processus : ADR-0065 §2 exige qu'elle entre scindée ou comme adaptateur.

## Ce qu'elle ne fait pas

- Elle ne rend aucune interface : PLT-02.
- Elle ne choisit pas le serveur d'un produit : I-06 laisse ce choix à l'ADR du produit tant qu'ADR-0063 n'est pas accepté.
- Elle n'admet aucune dépendance à elle seule : les six conditions d'entrée d'ADR-0065 §2 se vérifient dans la pull request qui l'ajoute.

## Mesure

- Preuve citée : le test du front de P04 qui refuse toute réimplémentation d'une fonction du cœur, par des vecteurs rouges appliqués à une copie du front réel.
- Preuve citée : le test Rust des vecteurs de référence du cœur d'agencement de P40, partagés avec le côté Swift.
- Aucune des deux ne montre un produit entier construit sur son cœur.
- Prochaine preuve : la série de mesures d'ADR-0057 §3 exécutée dans la coquille de P04, avec son rapport versionné.
