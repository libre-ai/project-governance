# PAS-03 — Budgets de jetons et d'énergie par mission

## Contexte

Le plan d'exécution autorisé porte déjà des budgets par mission : jetons en entrée et en sortie, durée, appels d'outil, processus, fichiers et octets modifiés. ADR-0034 lie ces bornes au condensé du plan et fait réserver le budget avant chaque effet. ADR-0036 a verrouillé ce contrat. Le dépôt `execution-continuity-evaluator` porte un évaluateur pur, qui refuse un événement dont les totaux dépassent le plan. Aucun budget d'énergie n'existe, ni dans un contrat ni dans un instrument de mesure. Aucun budget n'est fixé par produit.

## Ce que la brique ferme

- La mission sans borne : un dépassement produit un code de refus fermé, pas un avertissement.
- Le budget remis à zéro par une reprise : ADR-0034 l'interdit, et toute hausse exige un nouveau plan autorisé.
- La boucle d'appels d'outil sans progrès : ADR-0046 garde le compteur d'appels du budget comme borne dure, et I-33 interdit de le corriger.

## Ce qu'elle ne fait pas

- Elle ne compte aucune monnaie : un agent ne paie rien.
- Elle ne mesure pas le coût constaté d'une mission : c'est EXP-03, et l'énergie mesurée relève d'EXP-07.
- Elle ne choisit pas un modèle moins coûteux : c'est PAS-04.

## Mesure

- Preuves citées : le schéma du corps de plan et le module de budget de l'évaluateur, épinglés. Ils montrent des bornes déclarées et un refus au dépassement sur des faits fournis. Ils ne montrent ni mission réelle ni énergie.
- Prochaine preuve : une mission réelle arrêtée par un dépassement de budget, avec son événement dans une évidence publiée, puis un champ d'énergie borné dans le contrat.
