# HAR-03 — Registre d'outils signé

## Contexte

ADR-0045 relève que le plan autorisé d'une exécution porte la liste de ses outils, chacun avec l'empreinte de sa politique d'argument. ADR-0046 fait observer les appels d'outil sans leur contenu, par un agrégat que le harnais signe (D67). ADR-0056 D4 tient le registre des projets et outils tiers écartés, que porte GOV-05. Parmi les 103 schémas de `schemas-and-contracts` au commit que cette couche épingle, lus le 2026-11-11, aucun nom ne désigne un registre d'outils admis. Aucun invariant du registre ne lie la brique : I-32 porte sur le modèle qui détient un outil à effet et sur la politique qui juge ses arguments, I-38 sur l'installation live. Ils sont voisins et ne sont pas cités.

## Ce que la brique ferme

Aucune preuve n'est citée ici : les fermetures ci-dessous sont l'objet de la brique, pas un fait montré.

- Un outil appelé par un agent sans avoir été admis, ni par le plan ni par un registre.
- Un outil remplacé entre son admission et son appel, que seule une empreinte épinglée détecte.
- Un outil à effet, d'écriture, d'exécution ou de réseau, que rien ne déclare comme tel.

## Ce qu'elle ne fait pas

- Elle ne juge pas les arguments d'un appel : c'est le garde de HAR-04.
- Elle ne définit ni les classes de données, qui relèvent de PAS-02, ni la signature, qui relève de PRV-03.
- Elle ne tient pas le registre des écartés, objet de GOV-05. Comparer les deux registres serait un contrôle croisé, pas une condition de son fonctionnement : GOV-05 n'est pas une dépendance.
- Elle n'installe rien.

## Mesure

Preuve citée : aucune. L'évaluateur d'observations de `execution-continuity-evaluator` rend le verdict `tool-undeclared` quand un outil observé n'est pas dans la liste du plan. Ce verdict vient après l'appel et le module déclare qu'il ne bloque rien. Il ne montre ni un registre, ni une empreinte par outil, ni une classe de données, ni un refus avant l'appel : il n'est pas cité en preuve.

Prochaine preuve : un registre en données dont chaque entrée porte son empreinte, et un gate qui refuse un outil absent ou d'empreinte différente.
