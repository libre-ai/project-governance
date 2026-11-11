# FAB-10 — Graphe de tâches natif

## Contexte

ADR-0034 admet un graphe d'exécution autorisé fini, acyclique, à issues fermées, où une seule étape est prête à la fois (D40). ADR-0037 en ouvre le cœur natif dans un crate pur, sans effet et sans dépendance à un framework (D43). Ce crate vit dans `execution-continuity-evaluator`. ADR-0058, en vigueur, admet LangGraph JS comme runtime interne d'un worker TypeScript ; ADR-0063, proposé, le renverserait. La brique porte sur le graphe autorisé, natif sous l'un comme sous l'autre.

## Ce que la brique ferme

- La prochaine étape choisie sans contrat : une issue inconnue, une transition absente ou ambiguë bloque le run (ADR-0034 D1).
- Le framework devenu autorité : les contrats restent la seule autorité, et le cœur n'en est pas une seconde (I-03, ADR-0037).
- Le plan étendu par un contenu lu : le graphe est fixé avant l'exécution, réalisation par défaut d'I-32 (D66).

## Ce qu'elle ne fait pas

- Elle n'a ni persistance, ni réseau, ni horloge : le cœur n'effectue aucune entrée-sortie (ADR-0037).
- Elle ne fixe pas le runtime interne d'un worker : ADR-0058 l'ouvre, ADR-0063 propose de le fermer.
- Elle n'est ni le moteur commun ni l'autorité des contrats : elle s'appuie sur HAR-09 et sur GOV-07.

## Mesure

- Preuves citées : le module de graphe du cœur et son test, épinglés au commit lu de `execution-continuity-evaluator`. Ils montrent la validation d'un graphe et ses refus fermés. Ils ne montrent aucune mission de la fabrique exécutée par ce cœur.
- Prochaine preuve : une mission de Work Supervision dont les étapes sont décidées par ce cœur, avec le rejeu de son état depuis le journal.
