# PUB-05 — Contributions

## Contexte

I-11 rend obligatoires le sign-off DCO et la conformité REUSE, sous licences différenciées. D23 consigne que ces licences sont lisibles par machine. Le `CONTRIBUTING.md` de `project-governance` écrit qu'aucune voie séparée ni allégée n'existe pour une contribution extérieure, et qu'aucun accord de cession de droits n'est demandé. Un workflow réutilisable vérifie le sign-off de chaque commit et la licence de chaque fichier. Ce que la brique publie est la règle d'entrée, rédigée à la main, et le verdict des contrôles, calculé sur les commits.

## Ce que la brique ferme

- Un commit sans origine certifiée : chaque commit porte un `Signed-off-by` qui correspond à son auteur (I-11).
- Un fichier sans licence lisible par machine, ou un paquet dont la licence déclarée contredit celle que REUSE attribue.
- Une voie allégée selon l'auteur : `CONTRIBUTING.md` écrit que les mêmes contrôles requis s'appliquent.

## Ce qu'elle ne fait pas

- Elle ne fusionne rien. Sans GOV-01, une contribution n'a personne pour la décider : qui fusionne, et sous quels gates, relève de GOV-01.
- Elle ne donne aucun droit sur la marque : `LICENSING.md` l'écrit, et PUB-07 porte la marque.
- Elle ne guide pas la reconstruction par un tiers, laissée à PUB-06.

## Mesure

Preuve citée : `.github/workflows/reusable-licensing.yml`. Ce workflow montre que le sign-off et REUSE sont vérifiés commit par commit et fichier par fichier. Il ne montre pas qu'une contribution extérieure est entrée par cette porte.

Prochaine preuve : une pull request d'un auteur extérieur fusionnée sous ces contrôles dans un dépôt de la flotte.
