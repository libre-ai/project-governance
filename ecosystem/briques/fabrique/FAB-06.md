# FAB-06 — Gates de porte et négatives

## Contexte

ADR-0056 fait déclarer à toute pull request l'origine de ce qu'elle corrige et ce qu'elle n'ajoute pas. ADR-0059 en fixe la forme : un bloc de déclaration en tête de la description, seul endroit lu. Ce dépôt porte les deux gates qui lisent ce bloc, et leurs checks sont requis sur sa branche servie. Le rayon d'impact d'une pull request reste un texte de sa description, qu'aucun gate ne juge.

## Ce que la brique ferme

- Le changement irréversible passé comme un autre : une porte à sens unique nomme son second instrument.
- Le cas construit présenté comme une défaillance d'usage : l'origine se déclare dans un vocabulaire fermé (ADR-0056 D1).
- La négative démentie par le diff : une surface déclarée intacte et touchée fait échouer le check (ADR-0056 D5, ADR-0059).
- Le texte caché dans la description : une ligne refusée arrête la lecture du bloc (D102).

## Ce qu'elle ne fait pas

- Elle n'écrit pas la description : FAB-09 la produit.
- Elle ne rend pas ses checks requis : c'est un acte du propriétaire sur le ruleset, réservé par GOV-01 (I-17).
- Elle ne confronte au diff que trois négatives ; les autres se lisent en revue (ADR-0056 D5).

## Mesure

- Preuves citées : `tools/quality/check-pr-door.ts` et `tools/quality/check-pr-negatives.ts`. La première montre le refus d'une description sans porte ni origine déclarées. La seconde montre l'échec d'une négative dont la surface est touchée.
- Limite déclarée : le code de ces gates s'exécute depuis la tête de la pull request qu'il juge (ADR-0060).
- Prochaine preuve : le rayon d'impact rendu comme un verdict de gate, calculé depuis le diff.
