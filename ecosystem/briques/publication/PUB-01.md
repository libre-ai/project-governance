# PUB-01 — Page vision générée

## Contexte

ADR-0064 D6, proposé, veut la page vision produite sous `distribution/vision/` par un générateur qui lit les seules sorties du vérificateur de la carte. Son contenu est dérivé du graphe des couches, des fiches et des compteurs par statut. Les compteurs et la matrice des couches sont calculés ; les fiches que la page reprend sont rédigées à la main, comme sa feuille de style et son texte fixe (titres, légendes, sens de chaque statut), écrit dans le générateur. Le même ADR range la page parmi les projections d'I-05, et ses comptes sous I-14. D6 veut une publication « privée d'abord sous ADR-0038 » ; ADR-0038 règle la première publication d'un dépôt, et D6 ne dit pas comment il s'applique à une page. La page est un fichier de ce dépôt, qui est public, et aucun site ne la sert. D6 veut aussi `vision.md` remplacé par un renvoi vers la page le jour où elle existe : ce remplacement n'est pas fait tant qu'ADR-0064 reste proposé, et `vision.md` reste le texte lu.

## Ce que la brique ferme

- Une vision tenue en plusieurs endroits qui ne se vérifient pas entre eux : la page a pour source la carte, et pour le statut d'ADR-0064 la ligne de statut de cet ADR.
- Un compte écrit à la main dans un texte public : I-14 exclut tout décompte codé en dur.
- Une page prise pour une autorité : I-05 pose qu'un artefact généré est une projection, jamais canonique.

## Ce qu'elle ne fait pas

- Elle ne juge pas la carte : règles et statuts viennent du vérificateur, FAB-13. La table de D1 n'admet pas cette dépendance pour la couche publication : elle n'est pas déclarée.
- Elle ne dit pas ce qui s'installe : c'est le catalogue, PUB-02.
- Elle ne décide pas de sa propre exposition publique, acte du propriétaire.

## Mesure

Preuves citées : `distribution/build-vision.ts`, le générateur, et le workflow `brick-map.yml`, qui régénère la page et échoue sur un écart avec le fichier suivi. Elles montrent que la page est dérivée de la carte jugée par le vérificateur, qu'aucune page n'est écrite depuis une carte qui a une violation, et que la page suivie est comparée à sa régénération à chaque pull request. Elles ne montrent pas que la page est servie quelque part, ni qu'un lecteur l'a lue, ni que son rendu est accessible : aucun contrôle ne l'ouvre dans un navigateur. Le workflow n'est pas un contrôle requis.

Prochaine preuve : la page servie par un site sous une politique de sécurité de contenu stricte, avec un contrôle d'accessibilité qui l'ouvre.
