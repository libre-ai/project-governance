# HAR-03 — Registre d'outils signé

## Contexte

I-33 et ADR-0046 font observer les appels d'outil sans leur contenu, par un agrégat que le harnais signe. Le plan autorisé d'une exécution nomme ses outils et leur accès déclaré (ADR-0045). ADR-0056 D4 tient le registre des outils tiers écartés. Il manque le registre positif : des outils admis, chacun avec son empreinte SHA-256 et sa classe de données maximale.

## Ce que la brique ferme

- Un outil appelé par un agent sans avoir été admis, ni par le plan ni par un registre.
- Un outil remplacé entre son admission et son appel, que seule une empreinte épinglée détecte.
- Un outil à effet sans accès déclaré, qui prive la politique d'argument d'I-32 de son entrée.

## Ce qu'elle ne fait pas

- Elle ne juge pas les arguments d'un appel : c'est le garde de HAR-04.
- Elle ne définit ni les classes de données, qui relèvent de PAS-02, ni la signature, qui relève de PRV-03.
- Elle n'installe rien : admettre un outil n'autorise aucune installation sur un poste (I-38).

## Mesure

Preuves citées : l'évaluateur d'observations de `execution-continuity-evaluator` et le contrat candidat d'observation de `schemas-and-contracts`. L'évaluateur rend le verdict `tool-undeclared` quand un outil observé n'est pas dans le plan. Le contrat fixe la forme de l'observation lue. Aucun ne montre un registre, une empreinte par outil ou une classe de données.

Prochaine preuve : un registre en données dont chaque entrée porte son empreinte, et un gate qui refuse un outil absent ou d'empreinte différente.
