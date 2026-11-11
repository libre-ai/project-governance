# GOV-12 — Analyse d'impact par produit

## Contexte

Le dépôt `organization-data-lifecycle` porte un gabarit d'analyse d'impact : quatre questions de dépistage, une liste de risques, un champ d'approbation. La skill `rgpd-dpia` de `project-governance`, admise par ADR-0025, renvoie vers ce gabarit quand un changement de produit remplit une condition de dépistage. Au 2026-11-11, le registre des invariants et celui des décisions ne nomment pas l'analyse d'impact : la liste des invariants de la brique est vide.

## Ce que la brique ferme

- Une analyse préremplie ou approuvée par un agent : le gabarit rend une analyse vide, sans champ d'approbation rempli.
- Une approbation sans auteur : le champ d'approbation porte un rôle, une date et un nom.
- Un gabarit créé sans produit ni périmètre : le constructeur refuse un champ vide.

## Ce qu'elle ne fait pas

- Elle n'approuve rien. Sans GOV-01, aucune analyse n'est approuvée : la skill écrit que l'approbation est un acte manuel du propriétaire.
- Elle ne décide pas seule qu'une analyse est due : la skill signale le besoin sur les conditions de dépistage.
- Elle n'exécute ni rétention ni suppression : c'est GOV-13.

## Mesure

Preuve citée : le gabarit d'analyse d'impact du paquet `rgpd-kit`, épinglé à un commit de son dépôt. Il montre que les questions de dépistage et la liste des risques ont une forme typée. Il ne montre aucune analyse établie pour un produit. Aucun gate ne vérifie l'approbation : la skill écrit qu'il n'en existe pas.

Prochaine preuve : une analyse approuvée par le propriétaire, rattachée à un produit du catalogue.
