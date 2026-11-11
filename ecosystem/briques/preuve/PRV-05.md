# PRV-05 — Détection sur les agents

## Contexte

I-33 rend les appels d'outil observables sans contenu : « seul un document signé par la clé liée à l'attestation de harness du run est une observation », et « comparer des observations n'élargit aucune capacité ni ne modifie aucun plan ». ADR-0046 (D67) fait signer par le harness un agrégat par fenêtre d'empreintes à clé de run. Le contrat de ces observations est candidat au catalogue de `schemas-and-contracts`, au commit cité. Le dépôt `execution-continuity-evaluator` porte l'évaluateur pur qui rejoue un flux d'observations et rend un seul verdict fermé. La brique dépend d'IDN-04 : I-33 ne reconnaît pour observation que le document signé par la clé liée à l'attestation de harness du run, et le module délègue cette vérification à l'appelant. Sans l'identité attestée que la carte range sous IDN-04, la brique ne peut pas distinguer une observation d'un document forgé.

## Ce que la brique ferme

Le module nomme ces cas par un verdict ; il n'en empêche aucun.

- L'agent qui répète le même appel sans avancer : le verdict `no-progress` le nomme (D67).
- L'observation rejouée ou incomplète : la chaîne des fenêtres et le compteur d'appels sont jugés avant le verdict d'absence de progrès (I-33).
- L'appel d'un outil que le plan ne déclare pas : verdict `tool-undeclared`.
- La détection qui deviendrait une autorité : le module déclare son verdict donnée opérationnelle, que I-18 tient « jamais autorité », et ne détient aucune clé.

## Ce qu'elle ne fait pas

- Elle n'arrête rien : ADR-0046 fait tenir l'arrêt par le harness.
- Elle ne compte pas comme défense contre l'injection : ADR-0045 (D66) range la détection dans la défense en profondeur.
- Elle ne lit ni argument ni résultat, et ne détient aucune clé.
- Elle ne voit pas un agent qui varie ses arguments à chaque appel, limite écrite dans ADR-0046.

## Mesure

- Preuves citées : le module d'évaluation des observations de `execution-continuity-evaluator` et les vecteurs du contrat candidat dans `schemas-and-contracts`, épinglés chacun à un commit. Pour la détection, le module montre un classement en sept verdicts fermés, pris dans un ordre fixe, dont `no-progress` et `tool-undeclared` ; il se déclare sans effet (« It blocks nothing ») et ne contient aucun test. Les vecteurs fixent le verdict attendu de flux fabriqués, chacun des sept verdicts y étant attendu au moins une fois. La suite qui rejoue ces vecteurs contre le module vit dans le même dépôt ; elle n'est pas citée ici. Les signatures des vecteurs sont des octets nuls : aucune signature de harness n'y est vérifiée. Les deux preuves ne montrent aucune observation produite par un harness, ni aucun agent arrêté.
- Prochain fait observable : le flux signé d'une mission réelle, rejoué par l'évaluateur, avec un verdict égal à la réaction du harness.
