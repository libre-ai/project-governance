# HAR-03 — Registre d'outils signé

## Contexte

ADR-0045 relève que le plan autorisé d'une exécution porte la liste de ses outils, chacun avec l'empreinte de sa politique d'argument. ADR-0046 fait observer les appels d'outil sans leur contenu, par un agrégat que le harnais signe (D67). ADR-0056 D4 tient le registre des projets et outils tiers écartés. Le registre des outils admis n'est pas écrit. Parmi les 103 schémas de `schemas-and-contracts` au commit que cette couche épingle, lus le 2026-11-11, aucun nom ne désigne un registre.

## Ce que la brique ferme

- Un outil appelé par un agent sans avoir été admis, ni par le plan ni par un registre.
- Un outil remplacé entre son admission et son appel, que seule une empreinte épinglée détecte.
- Un outil à effet que rien ne déclare comme tel : I-32 porte sur le modèle qui détient un outil à effet, d'écriture, d'exécution ou de réseau.

## Ce qu'elle ne fait pas

- Elle ne juge pas les arguments d'un appel : c'est le garde de HAR-04.
- Elle ne définit ni les classes de données, qui relèvent de PAS-02, ni la signature, qui relève de PRV-03.
- Elle ne tient pas le registre des écartés. Sans GOV-05, elle ne peut pas vérifier qu'un outil admis n'a pas été écarté.
- Elle n'installe rien : I-38 dit que publier un dépôt n'autorise jamais d'installer un outil d'agent.

## Mesure

Preuve citée : l'évaluateur d'observations de `execution-continuity-evaluator`. Il rend le verdict `tool-undeclared` quand un outil observé n'est pas dans la liste du plan. Ce verdict vient après l'appel et ne bloque rien : le module le déclare donnée opérationnelle. Il ne montre ni un registre, ni une empreinte par outil, ni une classe de données, ni un refus avant l'appel.

Prochaine preuve : un registre en données dont chaque entrée porte son empreinte, et un gate qui refuse un outil absent ou d'empreinte différente.
