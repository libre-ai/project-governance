# GOV-12 — Analyse d'impact par produit

## Contexte

I-22 n'admet une personne tierce dans un produit que sous des conditions cumulées : base légale écrite, information, registre de traitement, droits exerçables sans développement. I-21 sépare le code des données d'instance, et I-10 régit leur cycle de vie. ADR-0012 fixe ce régime. Le dépôt `organization-data-lifecycle` porte un gabarit d'analyse d'impact, vide et non approuvé à sa création. La skill `rgpd-dpia` de `project-governance` renvoie vers lui et rappelle que l'approbation reste hors de tout gate.

## Ce que la brique ferme

- Un produit qui traite des données de personnes sans analyse écrite.
- Une analyse préremplie ou approuvée par un agent : le gabarit ne préremplit jamais le champ d'approbation.
- Une personne tierce entrée dans un produit sans les quatre conditions d'ADR-0012 D2.

## Ce qu'elle ne fait pas

- Elle n'approuve rien : la signature est un acte manuel du propriétaire (GOV-01).
- Elle ne conditionne pas aujourd'hui le dégel d'un produit : ce lien avec GOV-03 n'est pas décidé.
- Elle n'exécute ni rétention ni suppression : c'est GOV-13.

## Mesure

Preuve citée : le gabarit d'analyse d'impact du paquet `rgpd-kit`, épinglé au commit de la branche servie de son dépôt. Il montre que les questions de dépistage et la liste des risques ont une forme typée. Il ne montre aucune analyse établie pour un produit.

Prochaine preuve : une analyse signée par le propriétaire, rattachée à un produit qui traite des données de tiers et citée par sa charte.
