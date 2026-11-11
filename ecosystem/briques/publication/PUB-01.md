# PUB-01 — Page vision générée

## Contexte

ADR-0064 D6 décide que la page vision est produite sous `distribution/vision/` par un générateur qui lit les seules sorties du vérificateur de la carte. Son contenu est dérivé du graphe des couches, des fiches et des compteurs par statut. Aujourd'hui `vision.md` reste le texte lu, et aucun générateur n'est écrit. La page est en français d'abord, et sa publication est privée d'abord, sous ADR-0038.

## Ce que la brique ferme

- Une vision tenue en plusieurs endroits qui ne se vérifient pas entre eux : la page n'a qu'une source, la carte.
- Un compte ou un état écrit à la main dans un texte public : I-14 exclut tout décompte codé en dur.
- Une page prise pour une autorité : I-05 en fait une projection, régénérée et jamais éditée.

## Ce qu'elle ne fait pas

- Elle ne juge pas la carte : règles et statuts viennent du vérificateur, FAB-13, que la table d'ADR-0064 D1 ne permet pas de déclarer ici en dépendance.
- Elle ne dit pas ce qui s'installe aujourd'hui : c'est le catalogue, PUB-02.
- Elle ne décide pas de sa propre exposition publique, acte du propriétaire.

## Mesure

Preuve citée : aucune. Le générateur n'existe pas et `distribution/vision/` est absent de l'arbre.

Prochaine preuve : un générateur versionné dans `project-governance`, dont la sortie est régénérée à l'identique depuis la carte par un contrôle de fraîcheur, comme le sont déjà les flux de PUB-04.
