# FAB-09 — Pull request de flotte

## Contexte

I-11 rend le DCO obligatoire (D23). D68 fait tenir la signature d'une pull request de doctrine par la ligne `Owner-arbitration` et par la fusion squash. ADR-0059 amende ADR-0056 et fixe le bloc de déclaration en tête de la description (D102). La skill `pr-body` de ce dépôt écrit cette description au gabarit de flotte, que porte le dépôt `.github`. Un workflow réutilisable vérifie le sign-off de chaque commit.

## Ce que la brique ferme

- Le commit sans origine attestée : un commit dont le sign-off ne correspond pas à son auteur fait échouer le check (I-11).
- La mutation de doctrine sans trace d'arbitrage : I-17 ferme la surface du registre et des ADR, et D68 y exige la ligne d'arbitrage datée.

## Ce qu'elle ne fait pas

- Elle ne juge pas ses propres déclarations. Sans FAB-06, rien ne confronte le bloc à la description et au diff.
- Elle n'empile pas plusieurs lots : la norme des lots de travail fait réaliser un seul lot par pull request.

## Mesure

- Preuves citées : `skills/pr-body/SKILL.md` et `.github/workflows/reusable-licensing.yml`. La première montre la procédure d'écriture d'une description ; son en-tête la déclare `candidate`, et le contrat qu'elle décrit est appliqué par les gates de FAB-06, pas par elle. La seconde montre le contrôle du sign-off sur chaque commit.
- Aucune ne montre la fusion par squash, réglage de la forge que l'arbre ne contient pas.
- Prochaine preuve : la méthode de fusion de chaque dépôt de la flotte lue sur la forge par un gate, qui échoue sur toute méthode autre que le squash.
