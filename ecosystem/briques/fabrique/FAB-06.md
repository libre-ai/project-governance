# FAB-06 — Gates de porte et négatives

## Contexte

ADR-0056 fait déclarer à toute pull request l'origine de ce qu'elle corrige (D1). Il fait déclarer à celle qui ajoute une capacité ce qu'elle n'ajoute pas (D5). D95 porte ces règles au registre. ADR-0059 en fixe la forme (D102) : un bloc de déclaration en tête de la description, seul endroit lu. Ce dépôt porte les deux gates qui lisent ce bloc. ADR-0060 relève le 2026-10-24 que « Door declaration » et « Negatives declaration » sont deux des six checks requis de ce dépôt.

## Ce que la brique ferme

- Le changement irréversible passé comme un autre : une porte à sens unique nomme son second instrument.
- Le cas construit présenté comme une défaillance d'usage : l'origine se déclare dans un vocabulaire fermé (ADR-0056 D1).
- La négative démentie par le diff : une surface déclarée intacte et touchée fait échouer le check (ADR-0056 D5, ADR-0059).
- Le texte caché dans la description : une ligne refusée arrête la lecture du bloc (D102).

## Ce qu'elle ne fait pas

- Elle n'écrit pas la description : FAB-09 la produit.
- Elle ne rend pas ses checks requis. I-17 ferme la surface des mutations de garde-fous. Sans GOV-01, rien ne dit que cet acte sur le ruleset revient au propriétaire.
- Elle ne confronte au diff que trois négatives : dépendance, schéma et workflow (ADR-0056 D5).

## Mesure

- Preuves citées : `tools/quality/check-pr-door.ts` et `tools/quality/check-pr-negatives.ts`. La première montre le refus d'une description sans porte ni origine déclarées. La seconde montre l'échec d'une négative dont la surface est touchée.
- Limite déclarée : le code de ces gates s'exécute depuis la tête de la pull request qu'il juge (ADR-0060). ADR-0062 retient pour remède l'option A2 + Bw (D2). Son application n'est pas mesurée ici.
- Prochaine preuve : la mesure avant et après que demande ADR-0062 D2, sur une pull request synthétique qui modifie un gate.
