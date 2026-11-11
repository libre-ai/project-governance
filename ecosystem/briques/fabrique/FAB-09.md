# FAB-09 — Pull request de flotte

## Contexte

I-11 rend le DCO obligatoire (D23). D68 fait tenir la signature d'une pull request de doctrine par la ligne `Owner-arbitration` et par la fusion squash. ADR-0059 amende ADR-0056 et fixe le bloc de déclaration en tête de la description (D102). La skill `pr-body` de ce dépôt décrit comment écrire cette description au gabarit de flotte, que porte le dépôt `.github`. Un workflow réutilisable vérifie le sign-off de chaque commit. I-17, qui ferme la surface du registre et des ADR, est voisin et n'est pas cité : le gate qui y exige la ligne d'arbitrage n'est pas une preuve de cette brique.

## Ce que la brique ferme

- Le commit sans origine attestée : un commit dont le sign-off ne correspond pas mot pour mot à son auteur fait échouer le check (I-11).

## Ce qu'elle ne fait pas

- Elle ne juge pas ses propres déclarations. Sans FAB-06, rien ne confronte le bloc à la description et au diff, et deux des checks requis manquent à la remise.
- Elle n'exige pas elle-même la ligne d'arbitrage d'une mutation de doctrine : la skill dit quand l'écrire, et la doctrine la fait exiger par un autre gate (D68).
- Elle n'exige pas d'un commit produit par la forge un sign-off de son auteur : le workflow accepte pour lui tout sign-off valide.
- Elle n'empile pas plusieurs lots : la norme des lots de travail fait réaliser un seul lot par pull request.

## Mesure

- Preuves citées : `skills/pr-body/SKILL.md` et `.github/workflows/reusable-licensing.yml`. La première montre la procédure d'écriture d'une description ; son en-tête la déclare `candidate`, et le contrat qu'elle décrit est appliqué par les gates de FAB-06, pas par elle. La seconde montre le contrôle du sign-off sur chaque commit d'une pull request et d'un push.
- Aucune des deux ne montre la fusion par squash, qui est un réglage de la forge.
- Prochaine preuve : la méthode de fusion de chaque dépôt de la flotte lue sur la forge par un gate, qui échoue sur toute méthode autre que le squash.
