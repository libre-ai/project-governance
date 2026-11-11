# GOV-02 — Invariants en couches

## Contexte

ADR-0008, point 7, fait de `docs/decisions/INVARIANTS.md` la liste exhaustive des invariants de doctrine : ce qui n'y figure pas n'est pas doctrine. Chaque entrée porte la source de son arbitrage et sa date. I-03 range les invariants dans l'autorité de gouvernance, que porte `project-governance`. I-17 place ce registre sur la surface à touche humaine. Sans GOV-01, aucune ligne n'entre au registre ni n'en sort : chaque modification est une décision du propriétaire. Le tableau du registre a trois colonnes de contenu : l'invariant, la source d'arbitrage, la date. Il ne dit ni la couche ni la classe de dépôt qu'un invariant lie.

## Ce que la brique ferme

- Une règle écrite hors du registre et tenue pour doctrine : ADR-0008 pose qu'elle n'est pas doctrine.
- Une doctrine rédigée sans trace d'arbitrage : ADR-0008 la déclare nulle.
- Un invariant que rien ne vérifie : D103 a retiré du registre l'invariant du quorum agentique, qu'aucun mécanisme ne pouvait faire rougir, en conservant son texte historique.

## Ce qu'elle ne fait pas

- Elle ne décide pas d'une modification du registre : I-17 réserve cet acte au propriétaire (GOV-01).
- Elle ne mesure pas la conformité d'un dépôt à un invariant : c'est GOV-06.
- Elle ne réattribue pas un numéro retiré : D103 l'écrit.

## Mesure

Preuve citée : `tools/quality/check-doctrine-governance.sh`. Ce gate vérifie que chaque ADR accepté à partir de 0008 porte une ligne d'arbitrage, et cite un invariant ou déclare n'en porter aucun. Il vérifie aussi que chaque ADR cité par le registre existe. Il montre que le registre est lu et tenu. Il ne montre pas des invariants rangés par couche.

Prochaine preuve : le registre porte pour chaque invariant sa couche et les classes de dépôt qu'il lie, et un gate refuse un invariant sans ces deux champs.
