# PAS-03 — Budgets de jetons et d'énergie par mission

## Contexte

Le corps de plan d'exécution (v2) porte des budgets par mission : jetons en entrée et en sortie, durée, appels d'outil, processus, fichiers et octets modifiés, agents simultanés. ADR-0034 (D40) lie ces bornes au condensé du plan et fait réserver le budget avant chaque effet. ADR-0036 (D42) a verrouillé ce contrat. Le dépôt `execution-continuity-evaluator` porte un évaluateur pur, qui refuse un événement dont les totaux dépassent le plan. Le schéma cité ne porte aucun champ d'énergie : cette moitié du nom de la brique n'a pas de source dans la doctrine. Aucun invariant du registre ne lie la brique ; I-33, qui protège le compteur d'appels contre l'observation, est voisin et n'est pas cité. La brique dépend de GOV-07 : sans contrat canonique du plan, les bornes n'ont pas de forme vérifiable.

## Ce que la brique ferme

- La mission sans borne : un dépassement produit le code de refus fermé `plan-budget-exceeded`, pas un avertissement.
- Le budget remis à zéro par une reprise : ADR-0034 l'interdit, et toute modification d'un budget exige un nouveau plan autorisé.
- La boucle d'appels d'outil que la garde d'absence de progrès ne voit pas : ADR-0046 garde `maxToolCalls` et les autres budgets comme borne dure.

## Ce qu'elle ne fait pas

- Elle ne compte aucune monnaie : les bornes du schéma sont des jetons, des durées, des appels, des processus et des octets.
- Elle ne mesure pas le coût constaté d'une mission : c'est EXP-03, et l'énergie mesurée relève d'EXP-07.
- Elle ne choisit pas un modèle moins coûteux : c'est PAS-04.

## Mesure

- Preuves citées : le schéma du corps de plan et le module de budget de l'évaluateur, épinglés. Ils montrent des bornes déclarées et un refus au dépassement sur des faits fournis par l'appelant. Ils ne montrent ni mission réelle ni énergie.
- Prochaine preuve : une mission réelle arrêtée par un dépassement de budget, avec son événement dans une évidence publiée, puis un champ d'énergie borné dans le contrat.
