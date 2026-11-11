# PLT-07 — Accessibilité RGAA

## Contexte

Le nom de la brique cite le RGAA. Au 2026-11-11, aucun fichier de `docs/adr/` ni de `docs/decisions/` ne contient ce sigle, et aucun invariant du registre ne porte sur l'accessibilité d'une interface : sa liste d'invariants est vide. ADR-0001 retient des primitives d'interface accessibles. Le standard de spécification exige une section « Accessibility and degraded mode » et refuse une release sans parcours d'accessibilité attaché au candidat. ADR-0057 §3 pose pour P04 un seuil bloquant : 100 % du texte de la note exposé à l'accessibilité (D97). Le même paragraphe écrit qu'un éditeur dans une vue web n'expose pas ce texte de lui-même, et que le front maintient l'arbre d'accessibilité.

## Ce que la brique ferme

- L'éditeur en vue web qui n'expose pas tout son texte : le test cité échoue dès que le texte de l'arbre lu s'écarte de la note en une position, lignes non dessinées comprises.
- La mesure qui passerait sans rien lire : un vecteur rouge ouvre l'éditeur sans sa copie accessible et attend une proportion inférieure à 1.

## Ce qu'elle ne fait pas

- Elle n'adopte aucun référentiel : le relevé ci-dessus ne trouve aucune décision qui rende le RGAA opposable.
- Elle ne révise pas un seuil après une mesure rouge : ADR-0057 §3 en fait une décision de surface, qui retourne à ADR-0044.
- Elle ne fournit ni composants ni jetons : PLT-09.
- Elle ne construit pas la surface mesurée : sans PLT-02, il n'y a pas de surface dont lire l'arbre d'accessibilité.

## Mesure

- Preuve citée : le test de bout en bout de P04 qui compare, sous Playwright WebKit, le texte de l'arbre d'accessibilité de l'éditeur à une note de 1 Mio. Cette taille est celle que nomment l'en-tête du test (« the 1 MiB note of CR-10k ») et le tableau des seuils d'ADR-0057 §3.
- Le module de lecture du test, au même commit, écrit que l'arbre lu est l'arbre ARIA que Playwright calcule dans la page depuis le DOM, pas l'arbre du navigateur, et que la mesure par l'API d'accessibilité de macOS dans la coquille construite relève d'un autre critère. Le test charge le front avec un substitut du pont Tauri.
- Le protocole de P04, au même commit, prescrit l'API d'accessibilité de macOS lue sur l'application lancée : la preuve citée n'est pas cette mesure, et elle ne mesure pas le seuil d'ADR-0057 §3.
- Le verrou de spécification de ce dépôt n'est pas cité en preuve. Son code refuse une spécification d'application sans section d'accessibilité, mais il n'en lit aucune ici : au 2026-11-11, `git ls-files docs/apps` ne rend aucun fichier.
- Prochaine preuve : la proportion du texte exposé, mesurée par l'API de macOS dans la coquille de P04 et consignée dans le rapport de sa série.
