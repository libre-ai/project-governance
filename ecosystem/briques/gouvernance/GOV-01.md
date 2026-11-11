# GOV-01 — Propriétaire, agents, gates

## Contexte

I-13 pose que le produit zéro est la méthode : une gestion agentique de la constellation sous gates vérifiables, avec une touche humaine réduite aux invariants. I-17 ferme la surface à touche humaine : registre et ADR, amendements de verrous, mutations des garde-fous et de la couche 3, activations, escalades. ADR-0009 §5 écrit que tout le reste appartient aux agents sous gates. I-24, issu d'ADR-0022, fixe la forme d'une décision qui revient au propriétaire. `project-governance` porte ces règles et le gate qui garde la surface d'I-17.

## Ce que la brique ferme

- Une règle de doctrine modifiée sans décision du propriétaire : ADR-0043, consigné par D68, tient la signature par la ligne d'arbitrage datée et par la fusion.
- Un agent qui tranche sur une hypothèse muette : I-24 impose le contexte restitué et la question structurée (D31).
- Une liste d'actes réservés qui s'étend par usage : elle ne s'étend que par ADR, selon ADR-0009 §5.

## Ce qu'elle ne fait pas

- Elle ne tient pas le texte des invariants : c'est GOV-02.
- Elle ne vérifie aucune signature cryptographique : la trace d'arbitrage est une convention de texte, et le gate l'écrit dans son en-tête.
- Elle ne mesure pas le respect du protocole de question : D31 note qu'aucun gate ne l'automatise.

## Mesure

Preuve citée : `tools/quality/check-review-evidence.ts`. Ce gate refuse une pull request qui modifie la surface gardée sans renvoi à un dossier sous `docs/reviews/` ni marque `Owner-arbitration:` suivie d'une date. Il montre que l'oubli de la trace ne fusionne pas. Il ne montre pas que l'arbitrage a eu lieu. Son en-tête déclare une limite : le code qui définit la surface gardée est lui-même hors de cette surface.

Prochaine preuve : un contrôle lit, pour chaque ADR accepté, la pull request fusionnée qui porte sa ligne d'arbitrage, et imprime le compte des ADR lus.
