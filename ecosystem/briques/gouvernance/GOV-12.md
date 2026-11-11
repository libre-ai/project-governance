# GOV-12 — Analyse d'impact par produit

## Contexte

Le dépôt `organization-data-lifecycle` porte un gabarit d'analyse d'impact : quatre questions de dépistage, une liste de risques, un champ d'approbation. La fiche de ce dépôt, au commit cité, déclare que cet arbre n'est pas requalifié. La skill `rgpd-dpia` de `project-governance`, admise par ADR-0025 et pas encore éprouvée à l'usage réel selon ce même ADR, renvoie vers ce gabarit quand un changement de produit remplit une condition de dépistage. Au 2026-11-11, le registre des invariants et celui des décisions ne nomment pas l'analyse d'impact : la liste des invariants de la brique est vide.

## Ce que la brique ferme

- Une analyse approuvée par le gabarit lui-même : le constructeur ne remplit jamais le champ d'approbation.
- Une approbation sans auteur : quand il est rempli, ce champ porte un rôle, une date et un nom.
- Un gabarit créé sans produit ni périmètre : le constructeur refuse un identifiant, un produit, un périmètre ou une version vides, et une date mal formée.

## Ce qu'elle ne fait pas

- Elle n'approuve rien. Sans GOV-01, aucune analyse n'est approuvée : la skill écrit que l'approbation est un acte manuel du propriétaire.
- Elle ne distingue pas une analyse non remplie d'une analyse dont les quatre réponses sont « non » : le constructeur pose `false` aux quatre questions de dépistage.
- Elle ne réserve pas l'approbation au propriétaire dans le type : le champ admet les rôles `owner`, `dpo` et `legal`.
- Elle ne décide pas seule qu'une analyse est due : la skill signale le besoin sur les conditions de dépistage.
- Elle n'exécute ni rétention ni suppression : c'est GOV-13.

## Mesure

Preuve citée : le gabarit d'analyse d'impact du paquet `rgpd-kit`, épinglé à un commit de son dépôt. Il montre que les questions de dépistage, la liste des risques et le champ d'approbation ont une forme typée. Il ne montre aucune analyse établie pour un produit. Aucun gate ne vérifie l'approbation : l'en-tête du gabarit écrit qu'il n'a ni câblage d'intégration continue ni circuit d'approbation, et la skill écrit qu'aucun gate n'existe.

Prochaine preuve : une analyse approuvée par le propriétaire, rattachée à un produit du catalogue.
