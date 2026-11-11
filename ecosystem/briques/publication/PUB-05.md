# PUB-05 — Contributions

## Contexte

I-11 rend obligatoires le sign-off DCO et la conformité REUSE, sous licences différenciées. D23 consigne que ces licences sont lisibles par machine. Le `CONTRIBUTING.md` de `project-governance` écrit qu'aucune voie séparée ni allégée n'existe pour une contribution extérieure, et qu'aucun accord de licence de contributeur n'est demandé. Un workflow réutilisable vérifie le sign-off des commits et la licence de chaque fichier. Ce que la brique publie est la règle d'entrée, rédigée à la main, et le verdict des contrôles, calculé sur les commits.

## Ce que la brique ferme

- Un commit sans origine certifiée : le workflow refuse un commit dont le message ne porte pas un `Signed-off-by` égal à son auteur (I-11). Un commit produit par la forge (fusion, mise à jour de branche, modification par l'interface web, Dependabot) passe avec tout `Signed-off-by` valide.
- Un fichier sans licence lisible par machine : le workflow lance `reuse lint`.
- Un paquet dont la licence déclarée contredit celle que REUSE attribue : le workflow lance cette comparaison après `reuse lint`.

## Ce qu'elle ne fait pas

- Elle ne fusionne rien. Sans GOV-01, une contribution n'a personne pour la décider : qui fusionne, et sous quels gates, relève de GOV-01.
- Elle ne rend pas ce contrôle requis : `CONTRIBUTING.md` écrit que les mêmes contrôles requis s'appliquent à tout auteur, et le workflow cité ne lit aucune protection de branche.
- Elle ne revérifie pas l'historique repris par greffe : le workflow l'exempte quand l'appelant en donne la borne. Il saute aussi, avec un avertissement, la plage d'un push dont la base n'est plus atteignable.
- Elle ne donne aucun droit sur la marque : `LICENSING.md` l'écrit, et PUB-07 porte la marque.
- Elle ne guide pas la reconstruction par un tiers, laissée à PUB-06.

## Mesure

Preuve citée : `.github/workflows/reusable-licensing.yml`. Ce workflow montre que le sign-off est vérifié commit par commit, sur la plage d'une pull request et sur celle d'un push, et que REUSE l'est fichier par fichier. Il ne montre pas qu'une contribution extérieure est entrée par cette porte, ni que ce contrôle est requis sur un dépôt.

Prochaine preuve : une pull request d'un auteur extérieur fusionnée sous ces contrôles dans un dépôt de la flotte.
