# PLT-07 — Accessibilité RGAA

## Contexte

Le nom de la brique cite le RGAA. Au 2026-11-11, aucun fichier de `docs/adr/` ni de `docs/decisions/` ne contient ce sigle, et aucun invariant du registre ne porte sur l'accessibilité d'une interface : sa liste d'invariants est vide. ADR-0001 retient des primitives d'interface accessibles. Le standard de spécification exige une section « Accessibility and degraded mode » et refuse une release sans parcours d'accessibilité attaché au candidat. ADR-0057 §3 pose pour P04 un seuil bloquant : 100 % du texte de la note exposé à l'accessibilité (D97).

## Ce que la brique ferme

- L'éditeur en vue web qui n'expose pas son texte : le front maintient l'arbre d'accessibilité, et le seuil le mesure (ADR-0057 §3).
- Le seuil révisé après une mesure rouge : un rouge est une décision de surface, qui retourne à ADR-0044.
- La spécification d'application écrite sans section d'accessibilité, que le verrou de spécification refuse.

## Ce qu'elle ne fait pas

- Elle n'adopte aucun référentiel : le relevé ci-dessus ne trouve aucune décision qui rende le RGAA opposable.
- Elle ne fournit ni composants ni jetons : PLT-09.
- Elle ne construit pas la surface mesurée : sans PLT-02, il n'y a pas de surface dont lire l'arbre d'accessibilité.

## Mesure

- Preuve citée : le test de bout en bout de P04 qui lit l'arbre d'accessibilité de l'éditeur sur la note de 1 Mio du corpus, sous Playwright WebKit.
- Il mesure le front dans un navigateur. Le protocole de P04, au même commit, prescrit l'API d'accessibilité de macOS lue sur l'application lancée : la preuve citée n'est pas cette mesure.
- Dans ce dépôt, le verrou de spécification ne lit aucune spécification d'application : `docs/apps/` en est absent.
- Prochaine preuve : la proportion du texte exposé, mesurée par l'API de macOS dans la coquille de P04 et consignée dans le rapport de sa série.
