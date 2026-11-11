# FAB-10 — Graphe de tâches natif

## Contexte

ADR-0034 admet un graphe d'exécution autorisé fini, acyclique, à issues fermées, où une seule étape est prête à la fois (D40). ADR-0037 en ouvre le cœur natif dans un crate pur, sans effet et sans dépendance à un framework (D43). I-06 destine Rust aux moteurs spécialisés, et ce crate en est un. Il vit dans `execution-continuity-evaluator`. D66 fait du plan fixé avant l'exécution, sur ce graphe, la réalisation par défaut d'I-32, l'« isolation par construction contre l'injection de prompt indirecte ». ADR-0058, en vigueur, admet LangGraph JS comme runtime interne d'un worker TypeScript, jamais comme autorité. ADR-0063, proposé, le renverserait pour les produits, la fabrique et le harness, et ferait de ce cœur le graphe d'exécution des agents. La brique porte sur le graphe autorisé, natif sous l'un comme sous l'autre. I-03, qui veut une autorité unique par sujet, est voisin : il lie l'autorité des contrats, que tient GOV-07, et il n'est pas cité.

## Ce que la brique ferme

- Le graphe mal formé admis comme plan : étape ou arête dupliquée, entrée absente, arête pendante, étape inatteignable, terminal inatteignable ou cycle sont refusés par un code fermé (ADR-0034 D1).
- La prochaine étape choisie sans contrat : pour une étape et une issue, une route absente ou ambiguë est refusée, sans que l'ordre de déclaration départage (ADR-0034 D1).

## Ce qu'elle ne fait pas

- Elle n'a ni persistance, ni réseau, ni horloge : le cœur n'effectue aucune entrée-sortie (ADR-0037 D1).
- Elle n'est pas une autorité : ADR-0037 D1 la laisse aux contrats, et le cœur n'est pas normatif.
- Elle ne fixe pas le runtime interne d'un worker : ADR-0058 l'ouvre, ADR-0063 propose de le fermer.
- Elle n'est ni le moteur commun ni l'autorité des contrats. Sans HAR-09, elle n'a pas de moteur qui exécute le graphe. Sans GOV-07, elle n'a ni schéma de plan ni vecteurs contre lesquels le valider.

## Mesure

- Preuves citées : le module de graphe du cœur et son test, épinglés au commit lu de `execution-continuity-evaluator`. Pour cette brique, le module montre la forme d'un plan exécutable : dix codes de refus fermés sur la structure d'un graphe, et la sélection d'une transition par le seul couple étape et issue. Le test exerce l'ordre de ces refus et l'indépendance du résultat à l'ordre de déclaration.
- Ils ne montrent aucune mission de la fabrique exécutée par ce cœur, ni qu'un plan fixé ferme une injection.
- Prochaine preuve : une mission de Work Supervision dont les étapes sont décidées par ce cœur, avec le rejeu de son état depuis le journal.
