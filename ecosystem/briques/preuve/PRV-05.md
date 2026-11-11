# PRV-05 — Détection sur les agents

## Contexte

I-33 rend les appels d'outil observables sans contenu : « seul un document signé par la clé liée à l'attestation de harness du run est une observation », et « comparer des observations n'élargit aucune capacité ni ne modifie aucun plan ». ADR-0046 (D67) fait signer par le harness un agrégat par fenêtre d'empreintes à clé de run. Le contrat de ces observations est candidat au catalogue de `schemas-and-contracts`, au commit cité. Le dépôt `execution-continuity-evaluator` porte l'évaluateur pur qui rejoue un flux d'observations et rend un seul verdict fermé. La brique dépend d'IDN-04 : le module délègue la vérification de la signature du harness à l'appelant, et sans identité attestée cette signature ne se rattache à rien.

## Ce que la brique ferme

- L'agent qui répète le même appel sans avancer : le verdict `no-progress` le nomme (D67).
- L'observation rejouée ou incomplète : la chaîne des fenêtres et le compteur d'appels sont jugés avant le verdict d'absence de progrès (I-33).
- L'appel d'un outil que le plan ne déclare pas : verdict `tool-undeclared`.
- La détection qui deviendrait une autorité : son verdict est une donnée opérationnelle, que I-18 tient « jamais autorité ».

## Ce qu'elle ne fait pas

- Elle n'arrête rien : ADR-0046 fait tenir l'arrêt par le harness.
- Elle ne compte pas comme défense contre l'injection : ADR-0045 (D66) range la détection dans la défense en profondeur.
- Elle ne lit ni argument ni résultat, et ne détient aucune clé.
- Elle ne voit pas un agent qui varie ses arguments à chaque appel, limite écrite dans ADR-0046.

## Mesure

- Preuves citées : le module d'évaluation des observations de `execution-continuity-evaluator` et les vecteurs du contrat candidat dans `schemas-and-contracts`, épinglés chacun à un commit. Ils montrent qu'un flux d'observations se rejoue vers un verdict fermé. Les signatures des vecteurs sont des octets nuls : aucune signature de harness n'y est vérifiée. Ils ne montrent aucune observation produite par un harness.
- Prochain fait observable : le flux signé d'une mission réelle, rejoué par l'évaluateur, avec un verdict égal à la réaction du harness.
