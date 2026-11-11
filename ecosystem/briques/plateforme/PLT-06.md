# PLT-06 — Retour arrière et fin de vie

## Contexte

I-07 n'autorise un déploiement qu'avec un smoke test et un rollback démontré. ADR-0035 demande pour chaque release une révision précédente récupérable. I-23 et ADR-0019 font de l'oubli une éviction dont la récupérabilité est prouvée, jamais une destruction. ADR-0042 §7 traite de même l'archivage d'un dépôt, qui reste lisible et restaurable. ADR-0064 D4, encore proposé, dérive le retrait d'une brique d'une décision du registre et conserve sa fiche. Les deux garde-fous vivent dans `project-governance`.

## Ce que la brique ferme

- La release sans cible de retour : la révision immuable précédente reste la cible du rollback (ADR-0035, D41).
- Le contenu évincé qui revient dans l'arbre, ou qu'un fichier cite comme source vivante (I-23).
- L'éviction déclarée sans commit où retrouver le contenu.
- Le dépôt déclaré archivé qui reste inscriptible, ou l'inverse.

## Ce qu'elle ne fait pas

- Elle ne décide ni un gel, ni un retrait, ni une restauration : ce sont des décisions du propriétaire.
- Elle ne supprime rien : la suppression d'un dépôt reste un acte séparé du propriétaire (ADR-0042 §1).
- Elle n'achemine pas la version précédente : PLT-03 pour une application, EXE-02 pour une offre hébergée.
- Elle n'écrit pas le critère d'abandon d'un produit, qui appartient à sa charte.

## Mesure

- Preuve citée : le garde d'oubli, qui refuse la résurrection, la citation et l'éviction sans commit de récupération.
- Preuve citée : le gate de dérive d'inventaire, qui compare l'état archivé déclaré à l'état observé, dans les deux sens.
- Les deux montrent la fin de vie d'un contenu et d'un dépôt, pas le retour arrière d'une release : aucun dépôt porteur examiné n'en a publié.
- Prochaine preuve : un rollback joué sur une release réelle, suivi de son smoke test.
