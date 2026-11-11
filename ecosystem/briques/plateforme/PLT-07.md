# PLT-07 — Accessibilité RGAA

## Contexte

Le nom de la brique cite le RGAA, que ni un invariant ni un ADR de ce dépôt ne nomme. La doctrine porte trois éléments. ADR-0001 retient des primitives d'interface accessibles. Le standard de spécification exige une section « Accessibility and degraded mode » et refuse une release sans parcours d'accessibilité attaché au candidat. ADR-0057 §3 pose pour P04 un seuil bloquant : 100 % du texte de la note exposé à l'accessibilité (D97). ADR-0044 avait relevé 0,54 % pour la voie en vue web, contre 100 % pour la voie native.

## Ce que la brique ferme

- L'éditeur en vue web qui n'expose pas son texte : le front maintient l'arbre d'accessibilité, et le seuil le mesure (ADR-0057 §3).
- Le seuil révisé après une mesure rouge : un rouge est une décision de surface, qui retourne à ADR-0044.
- La spécification d'application écrite sans section d'accessibilité, que le verrou de spécification refuse.

## Ce qu'elle ne fait pas

- Elle n'adopte aucun référentiel : faire du RGAA la norme opposable demande une décision qui n'existe pas.
- Elle ne fournit ni composants ni jetons : PLT-09.
- Elle ne construit pas la surface mesurée : PLT-02.

## Mesure

- Preuve citée : le test de bout en bout de P04 qui lit l'arbre d'accessibilité de l'éditeur sur la note de 1 Mio du corpus, sous Playwright WebKit.
- Il mesure le front dans un navigateur, pas dans la coquille construite. Le protocole de P04 prescrit l'API d'accessibilité de macOS, et cette mesure n'existe pas.
- Le verrou de spécification ne lit dans ce dépôt aucune spécification d'application.
- Prochaine preuve : la proportion du texte exposé, mesurée par l'API de macOS dans la coquille de P04 et consignée dans le rapport de sa série.
