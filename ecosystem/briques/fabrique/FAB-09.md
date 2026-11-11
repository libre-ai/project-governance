# FAB-09 — Pull request de flotte

## Contexte

I-11 rend le DCO obligatoire, et ce dépôt fusionne ses pull requests par squash. ADR-0059 fixe le bloc de déclaration en tête de la description. La skill `pr-body` de la collection gouvernée écrit cette description au gabarit de flotte, que porte le dépôt `.github`. Un workflow réutilisable vérifie le sign-off de chaque commit.

## Ce que la brique ferme

- Le commit sans origine attestée : un commit dont le sign-off ne correspond pas à son auteur fait échouer le check (I-11).
- La mutation de doctrine sans trace d'arbitrage : une pull request qui touche la surface gardée porte une référence de revue ou une ligne d'arbitrage datée (I-17, D68).
- La skill modifiée sans échec observé : toute modification suit la règle d'admission de la collection (I-25).

## Ce qu'elle ne fait pas

- Elle ne juge pas ses propres déclarations : FAB-06 les confronte à la description et au diff.
- Elle ne confie à la forge aucune donnée sans export : I-12 exige des exports git et des artefacts.
- Elle n'empile pas plusieurs lots : une pull request réalise un seul lot de travail.

## Mesure

- Preuves citées : `skills/pr-body/SKILL.md` et `.github/workflows/reusable-licensing.yml`. La première montre la procédure d'écriture d'une description ; la skill y a le rang de candidate. La seconde montre le contrôle du sign-off sur chaque commit.
- Aucune ne montre la fusion par squash, réglage de la forge que l'arbre ne contient pas.
- Prochaine preuve : la méthode de fusion de chaque dépôt de la flotte lue sur la forge par un gate, qui échoue sur toute méthode autre que le squash.
