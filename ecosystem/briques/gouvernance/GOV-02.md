# GOV-02 — Invariants en couches

## Contexte

ADR-0008 fait de `docs/decisions/INVARIANTS.md` la liste exhaustive de la doctrine : ce qui n'y figure pas n'est pas doctrine. Chaque ligne porte la source de son arbitrage et sa date. I-03 range ce registre dans l'autorité de gouvernance, aujourd'hui `project-governance`. Le registre ne dit pas à quelle couche ni à quelle classe de dépôt un invariant s'applique : ces deux champs n'existent pas. D103 a retiré I-35, qu'aucun mécanisme ne pouvait faire rougir.

## Ce que la brique ferme

- Une règle écrite hors du registre et tenue pour doctrine : ADR-0008 la déclare nulle.
- Un invariant que rien ne vérifie : D103 fixe le précédent du retrait, texte historique conservé.
- Un invariant appliqué à un dépôt qu'il ne concerne pas, ou oublié sur un dépôt qu'il concerne, faute de champ d'application.

## Ce qu'elle ne fait pas

- Elle ne décide pas qui modifie le registre : c'est GOV-01, et I-17 réserve cet acte au propriétaire.
- Elle ne mesure pas la conformité d'un dépôt à un invariant : c'est GOV-06.
- Elle ne réattribue jamais un numéro retiré.

## Mesure

Preuve citée : `tools/quality/check-doctrine-governance.sh`. Ce gate vérifie que chaque ADR accepté cite un invariant ou déclare n'en porter aucun, et que chaque ADR cité par le registre existe. Il montre que le registre est lu et tenu, pas que les invariants sont rangés par couche.

Prochaine preuve : le registre porte pour chaque invariant sa couche et les classes de dépôt qu'il lie, et un gate refuse un invariant sans ces deux champs.
