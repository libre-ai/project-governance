# GOV-01 — Propriétaire, agents, gates

## Contexte

I-13 pose que le produit zéro est la méthode : des agents gèrent la flotte sous des gates vérifiables, et la touche humaine se réduit aux invariants. I-17 ferme la liste des actes réservés au propriétaire : registre et ADR, amendements de verrous, mutations des garde-fous, activations, escalades. I-24 fixe la forme d'une décision qui lui revient. `project-governance` porte ces règles et le gate qui les exerce. La flotte ne connaît que ces deux acteurs.

## Ce que la brique ferme

- Une règle de doctrine modifiée sans décision du propriétaire : D68 tient la signature par la ligne d'arbitrage datée et par la fusion.
- Un agent qui tranche sur une hypothèse muette : I-24 et ADR-0022 imposent le contexte restitué et la question structurée.
- Une liste d'actes réservés qui s'étend par usage : elle ne s'étend que par ADR, selon ADR-0009 §5.

## Ce qu'elle ne fait pas

- Elle ne tient pas le texte des invariants : c'est GOV-02.
- Elle ne vérifie aucune signature cryptographique : la trace d'arbitrage est une convention de texte, et le gate le dit.
- Elle ne mesure pas le respect du protocole de question : D31 note qu'aucun gate ne l'automatise.

## Mesure

Preuve citée : `tools/quality/check-review-evidence.ts`. Ce gate refuse une pull request qui modifie la surface d'I-17 sans dossier de revue ni ligne d'arbitrage datée. Il montre que l'oubli de la trace ne fusionne pas, pas que l'arbitrage a eu lieu.

Prochaine preuve : un contrôle lit, pour chaque ADR en vigueur, la pull request fusionnée qui porte sa ligne d'arbitrage, et imprime le compte des ADR lus.
