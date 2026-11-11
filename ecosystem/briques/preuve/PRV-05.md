# PRV-05 — Détection sur les agents

## Contexte

I-33 rend les appels d'outil d'un agent observables sans contenu : le harness signe, par fenêtre, des empreintes à clé de run (ADR-0046, D67). Le contrat candidat de ces observations et ses vecteurs vivent dans `schemas-and-contracts`. Le dépôt `execution-continuity-evaluator` porte l'évaluateur pur qui rejoue un flux d'observations et rend un seul verdict fermé. Aucun harness de la flotte ne produit encore ces observations sur une mission réelle.

## Ce que la brique ferme

- L'agent qui répète le même appel sans avancer : le verdict d'absence de progrès le nomme (D67).
- L'observation forgée, rejouée ou incomplète : signature du harness, chaîne des fenêtres et compteur d'appels sont vérifiés avant tout verdict (I-33).
- L'appel d'un outil que le plan ne déclare pas.
- La détection qui deviendrait une autorité : son verdict est une donnée opérationnelle (I-18).

## Ce qu'elle ne fait pas

- Elle n'arrête rien : l'arrêt est tenu par le harness, et le budget d'erreur par PRV-08.
- Elle ne compte pas comme défense contre l'injection : I-32 range la détection dans la défense en profondeur (ADR-0045, D66).
- Elle ne lit ni argument ni résultat, et ne détient aucune clé.
- Elle ne voit pas un agent qui varie ses arguments à chaque appel, limite écrite dans ADR-0046.

## Mesure

- Preuves citées : le module d'évaluation des observations de `execution-continuity-evaluator` et les vecteurs du contrat candidat dans `schemas-and-contracts`, épinglés chacun à un commit. Ils montrent qu'un flux d'observations se rejoue vers un verdict fermé.
- Prochain fait observable : le flux signé d'une mission réelle, rejoué par l'évaluateur, avec un verdict égal à la réaction du harness.
