# PUB-05 — Contributions

## Contexte

I-11 rend obligatoires le sign-off DCO et la conformité REUSE, sous licences différenciées (D23). Le `CONTRIBUTING.md` de `project-governance` écrit qu'aucune voie séparée n'existe pour une contribution extérieure, et qu'aucun accord de cession de droits n'est demandé. Un workflow réutilisable vérifie le sign-off de chaque commit et la licence de chaque fichier. I-19 fait entrer les besoins externes par une capture de besoin. Ce que la brique publie est la règle d'entrée et le verdict des contrôles : un fait calculé sur les commits, pas une appréciation saisie.

## Ce que la brique ferme

- Un commit sans origine certifiée : chaque commit porte un `Signed-off-by` qui correspond à son auteur (I-11).
- Un fichier sans licence lisible par machine, ou un paquet dont la licence déclarée contredit celle que REUSE attribue.
- Une voie allégée selon l'auteur : les mêmes contrôles requis s'appliquent à toute pull request.
- Une identité non autorisée dans l'historique d'un dépôt avant sa première exposition publique (I-30).

## Ce qu'elle ne fait pas

- Elle ne fusionne rien : qui décide, et sous quels gates, relève de GOV-01.
- Elle ne donne aucun droit sur la marque, que PUB-07 garde hors des licences.
- Elle ne guide pas la reconstruction par un tiers, laissée à PUB-06.

## Mesure

Preuve citée : le workflow réutilisable de licence et de contribution. Il montre que le sign-off et REUSE sont vérifiés commit par commit et fichier par fichier. Il ne montre pas qu'une contribution extérieure est déjà entrée par cette porte.

Prochaine preuve : une pull request d'un auteur extérieur fusionnée sous ces contrôles dans un dépôt de la flotte.
