# FAB-10 — Graphe de tâches natif

## Contexte

ADR-0034 admet un graphe d'exécution autorisé fini, acyclique, à issues fermées, où une seule étape est prête à la fois (D40). ADR-0037 en ouvre le cœur natif dans un crate pur, sans effet et sans dépendance à un framework (D43). I-06 destine Rust aux moteurs spécialisés, et ce crate en est un. Il vit dans `execution-continuity-evaluator`. ADR-0058, en vigueur, admet LangGraph JS comme runtime interne d'un worker TypeScript, jamais comme autorité. ADR-0063, proposé, le renverserait. La brique porte sur le graphe autorisé, natif sous l'un comme sous l'autre.

## Ce que la brique ferme

- La prochaine étape choisie sans contrat : une issue inconnue, une transition absente ou ambiguë bloque le run (ADR-0034 D1).
- Le framework devenu autorité : I-03 veut une autorité unique par sujet, et ADR-0037 D1 la laisse aux contrats, le cœur n'étant pas normatif.
- Le plan étendu par un contenu lu : D66 fait du plan fixé avant l'exécution, sur ce graphe, la réalisation par défaut d'I-32.

## Ce qu'elle ne fait pas

- Elle n'a ni persistance, ni réseau, ni horloge : le cœur n'effectue aucune entrée-sortie (ADR-0037 D1).
- Elle ne fixe pas le runtime interne d'un worker : ADR-0058 l'ouvre, ADR-0063 propose de le fermer.
- Elle n'est ni le moteur commun ni l'autorité des contrats. Sans HAR-09, elle n'a pas de moteur qui exécute le graphe. Sans GOV-07, elle n'a ni contrats ni vecteurs contre lesquels le valider.

## Mesure

- Preuves citées : le module de graphe du cœur et son test, épinglés au commit lu de `execution-continuity-evaluator`. Ils montrent la validation d'un graphe et ses refus fermés. Ils ne montrent aucune mission de la fabrique exécutée par ce cœur.
- Prochaine preuve : une mission de Work Supervision dont les étapes sont décidées par ce cœur, avec le rejeu de son état depuis le journal.
