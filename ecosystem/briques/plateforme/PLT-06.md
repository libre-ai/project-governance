# PLT-06 — Retour arrière et fin de vie

## Contexte

I-07 n'autorise un déploiement qu'avec un smoke test et un rollback démontré. ADR-0035 demande une révision précédente récupérable, ou une procédure d'arrêt démontrée pour une première release (D41). I-23 et ADR-0019 font de l'oubli une éviction dont la récupérabilité est prouvée par garde-fou, jamais une destruction. ADR-0042 §7 traite de même l'archivage d'un dépôt, qui reste lisible et restaurable. Les deux garde-fous cités vivent dans `project-governance`.

## Ce que la brique ferme

- Le contenu évincé qui revient dans l'arbre, ou qu'un fichier suivi cite (I-23) : le garde d'oubli refuse l'un et l'autre.
- L'éviction déclarée sans commit où retrouver le contenu : le garde exige un commit de récupération qui se résout et qui porte les chemins évincés.
- Le registre d'oubli vidé : le garde échoue sur un registre sans entrée.
- Le dépôt déclaré archivé qui reste inscriptible, ou l'inverse : le gate de dérive d'inventaire compare l'état déclaré à l'état observé sur la forge, dans les deux sens.

## Ce qu'elle ne fait pas

- Elle ne montre la cible de retour d'aucune release : I-07 demande un rollback démontré et ADR-0035 une révision précédente récupérable (D41), et aucune preuve citée ne l'exerce.
- Elle ne décide ni un gel, ni un retrait, ni une restauration : ce sont des décisions du propriétaire.
- Elle ne supprime rien. ADR-0042 §1 le dit pour le dépôt qu'il retire du portefeuille : sa suppression reste un acte séparé du propriétaire.
- Elle n'achemine pas la version précédente : sans PLT-03 pour une application, ou sans EXE-02 pour un service hébergé, le retour arrière n'a pas de chemin.
- Elle n'écrit pas le critère d'abandon d'un produit, qui appartient à sa charte.

## Mesure

- Preuve citée : le garde d'oubli. Il refuse la résurrection, la citation et l'éviction sans commit de récupération, et rend une assertion par entrée du registre. Il ne cherche une citation que dans les fichiers texte. Quand le dépôt d'ancrage ne répond pas, il saute la vérification du contenu du commit et l'écrit.
- Preuve citée : le gate de dérive d'inventaire. Pour la fin de vie, il rend une assertion nommée par dépôt déclaré archivé, et compte comme dérive un dépôt déclaré archivé qu'il ne peut pas observer. Il lit l'état archivé ; il ne vérifie pas qu'un dépôt archivé reste lisible et restaurable (ADR-0042 §7).
- Les deux montrent la fin de vie d'un contenu et d'un dépôt, pas le retour arrière d'une release.
- Prochaine preuve : un rollback joué sur une release réelle, suivi de son smoke test.
