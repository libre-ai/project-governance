# Deux sections pour `AGENTS.md` : invariants faciles à casser, hors périmètre

## Portée et statut

- **Portée :** le gabarit de deux sections qu'un dépôt de la flotte peut ajouter à son
  `AGENTS.md` : celles qui listent les invariants que le design tient sans qu'aucun
  compilateur ni test ne les garde, et celles qui listent ce qu'un agent ne doit pas
  proposer dans ce dépôt. Méthode, pas doctrine : rien ici ne crée un invariant, et un ADR
  qui tranche autrement prime. Le gabarit des sections obligatoires et les plafonds de lignes
  restent ceux de [CONTEXT-TEMPLATE.md](CONTEXT-TEMPLATE.md).
- **Origine :** relevé du projet `shirudo-dev/shirudo` du 2026-11-24 (fichiers `AGENTS.md`,
  `.agents/skills/security-audit/SKILL.md`, `.agents/skills/docs/SKILL.md`). Ces deux formes
  sont reprises et réécrites ; aucun texte n'est copié.
- **Statut :** proposé le 2026-11-24. L'inscription dans la carte d'autorité
  (`docs/README.md`) est une décision de fusion du propriétaire.

## Règle de source

Une entrée n'entre dans une section que si elle cite sa source dans le dépôt : un
invariant `I-xx` de [INVARIANTS.md](../decisions/INVARIANTS.md), un ADR de `docs/adr/`, ou un
`chemin:ligne` lu. Une entrée sans source n'entre pas. Une entrée dont la source disparaît se
retire dans le même commit que sa source.

La même règle vaut pour les deux sections.

## Invariants faciles à casser

Chaque entrée répond à trois questions : quelle règle le design tient, pourquoi elle se casse
sans rien faire rougir, et quel contrôle la garde (un `bun run check:…` ou un fichier de gate),
ou `aucun contrôle` si rien ne la garde.

Gabarit, à copier vide :

```markdown
## Invariants faciles à casser

| Règle | Pourquoi elle se casse sans rien faire rougir | Contrôle existant | Source |
| --- | --- | --- | --- |
| <règle, à l'impératif> | <mécanisme silencieux> | <`bun run check:…` ou `aucun contrôle`> | <`I-xx`, `ADR-NNNN` ou `chemin:ligne`> |
```

Exemple rempli, tiré de ce dépôt :

```markdown
| Règle | Pourquoi elle se casse sans rien faire rougir | Contrôle existant | Source |
| --- | --- | --- | --- |
| Stage files before running tree-walking gates | Les scanners fondés sur `git ls-files` ne voient pas un fichier neuf non stagé : le gate passe vert sur un arbre incomplet, sans erreur. | aucun contrôle trouvé qui refuse un arbre non stagé ; la règle tient en prose | `AGENTS.md:68-69` |
```

Cette entrée est une règle de processus d'agent, pas un invariant de conception : elle entre
par sa source `AGENTS.md:68-69`, et aucun `I-xx` ne la porte.

## Hors périmètre

Chaque entrée nomme ce qu'un agent ne propose pas dans le dépôt, et où la chose est déléguée.
La règle de source s'applique à la délégation : elle se cite.

Gabarit, à copier vide :

```markdown
## Hors périmètre

| Ce qu'un agent ne propose pas ici | Où la chose est déléguée | Source |
| --- | --- | --- |
| <action ou artefact> | <dépôt, document ou propriétaire> | <`chemin:ligne`> |
```

Exemple rempli, tiré de ce dépôt :

```markdown
| Ce qu'un agent ne propose pas ici | Où la chose est déléguée | Source |
| --- | --- | --- |
| Définir un contrat canonique (schéma, vecteur, autorité de contrat) | `libre-ai/schemas-and-contracts`, dont l'adresse figure en `AGENTS.md:10` | `AGENTS.md:38-39` |
```

## Ce que la note ne fait pas

- Elle n'impose aucune section. Le gabarit de [CONTEXT-TEMPLATE.md](CONTEXT-TEMPLATE.md)
  n'exige ni l'une ni l'autre ; `check-context-conformance` ne les vérifie pas.
- Elle ne lève pas le plafond de lignes. Le `AGENTS.md` de `project-governance` est à 80 lignes
  pour un plafond bloquant de 80 (`ecosystem/check-context-conformance.ts:80`) : y ajouter ces
  deux sections le ferait échouer. Relever ce plafond, ou compacter le fichier, est une décision
  du propriétaire, pas de la méthode.
