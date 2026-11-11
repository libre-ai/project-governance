# PLT-06 — Retour arrière et fin de vie

## Contexte

I-07 n'autorise un déploiement qu'avec un smoke test et un rollback démontré. ADR-0035 demande une révision précédente récupérable, ou une procédure d'arrêt démontrée pour une première release (D41). I-23 et ADR-0019 font de l'oubli une éviction dont la récupérabilité est prouvée, jamais une destruction. ADR-0042 §7 traite de même l'archivage d'un dépôt, qui reste lisible et restaurable. Les deux garde-fous cités vivent dans `project-governance`.

## Ce que la brique ferme

- La release sans cible de retour : ADR-0035 garde la révision immuable précédente comme cible du rollback (D41). Aucune preuve citée ne l'exerce.
- Le contenu évincé qui revient dans l'arbre, ou qu'un fichier cite comme source vivante (I-23).
- L'éviction déclarée sans commit où retrouver le contenu.
- Le dépôt déclaré archivé qui reste inscriptible, ou l'inverse.

## Ce qu'elle ne fait pas

- Elle ne décide ni un gel, ni un retrait, ni une restauration : ce sont des décisions du propriétaire.
- Elle ne supprime rien. ADR-0042 §1 le dit pour le dépôt qu'il retire du portefeuille : sa suppression reste un acte séparé du propriétaire.
- Elle n'achemine pas la version précédente : sans PLT-03 pour une application, ou sans EXE-02 pour un service hébergé, le retour arrière n'a pas de chemin.
- Elle n'écrit pas le critère d'abandon d'un produit, qui appartient à sa charte.

## Mesure

- Preuve citée : le garde d'oubli, qui refuse la résurrection, la citation et l'éviction sans commit de récupération.
- Preuve citée : le gate de dérive d'inventaire, qui compare l'état archivé déclaré à l'état observé, dans les deux sens.
- Les deux montrent la fin de vie d'un contenu et d'un dépôt, pas le retour arrière d'une release.
- Prochaine preuve : un rollback joué sur une release réelle, suivi de son smoke test.
