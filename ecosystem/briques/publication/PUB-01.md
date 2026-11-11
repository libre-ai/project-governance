# PUB-01 — Page vision générée

## Contexte

ADR-0064 D6, proposé, veut la page vision produite sous `distribution/vision/` par un générateur qui lit les seules sorties du vérificateur de la carte. Son contenu serait dérivé du graphe des couches, des fiches et des compteurs par statut. Les compteurs et le graphe sont calculés ; les fiches que la page reprendrait sont rédigées à la main. Le même ADR range la page parmi les projections d'I-05, et ses comptes sous I-14. D6 veut une publication « privée d'abord sous ADR-0038 » ; ADR-0038 règle la première publication d'un dépôt, et D6 ne dit pas comment il s'applique à une page. Tant que la page n'existe pas, `vision.md` reste le texte lu.

## Ce que la brique ferme

- Une vision tenue en plusieurs endroits qui ne se vérifient pas entre eux : la page n'aurait qu'une source, la carte.
- Un compte écrit à la main dans un texte public : I-14 exclut tout décompte codé en dur.
- Une page prise pour une autorité : I-05 pose qu'un artefact généré est une projection, jamais canonique.

## Ce qu'elle ne fait pas

- Elle ne juge pas la carte : règles et statuts viennent du vérificateur, FAB-13. La table de D1 n'admet pas cette dépendance pour la couche publication : elle n'est pas déclarée.
- Elle ne dit pas ce qui s'installe : c'est le catalogue, PUB-02.
- Elle ne décide pas de sa propre exposition publique, acte du propriétaire.

## Mesure

Aucune preuve n'est citée. Au 2026-11-11, `distribution/vision/` est absent de l'arbre suivi, et aucun fichier hors de `docs/` et de la carte ne nomme ce chemin.

Prochaine preuve : un générateur versionné dans `project-governance`, dont la sortie est régénérée à l'identique depuis la carte par un contrôle de fraîcheur, comme le sont les flux de PUB-04.
