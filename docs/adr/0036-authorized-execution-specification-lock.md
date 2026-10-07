# ADR-0036 — Specification Lock de l'exécution autorisée

- **Statut :** accepted — l'acte propriétaire autorise la promotion technique
  exacte décrite ci-dessous si ses preuves restent vertes et byte-identiques ;
  il n'autorise aucune capacité runtime
- **Date :** 2026-09-10
- **Arbitrage :** recommandation A approuvée par le propriétaire en session le
  2026-09-10 par « ok go ». Owner-arbitration: 2026-09-10
- **Autorité candidate revue :** Contracts
  `cb865613039c78e344bcbb51f4dbdfd469f634b9`, tree contrats
  `8015ead233c805a30f2bb1e74c5feedaaafdb7ce`
- **Étend :** ADR-0034 D6 et D40.
- **Étendu par :** ADR-0037/D43 ouvre uniquement le cœur natif pur de Phase 4A
  et conserve toutes les absences de preuve runtime de D2.
- **Applique :** I-08 (autorité du Specification Lock) et I-17 (acte
  propriétaire requis pour un amendement de lock).
- **N'autorise :** ni runtime, ni service, ni déploiement, ni mission réelle,
  ni migration de données, ni dépendance LangGraph/LangChain/LangSmith.

## Contexte

ADR-0034 a borné le graphe d'exécution autorisé et a explicitement arrêté son
autorité avant le Specification Lock. La phase contractuelle suivante a produit
onze familles candidates, leurs préimages RFC 8785, leurs scénarios adverses,
leurs règles de rétention et leurs projections TypeScript/Rust.

Les passes séparées architecture, sécurité et vie privée ont revu une même
autorité Contracts immuable et ont rendu `approve` sans finding. La passe
candidate-integration a ensuite reproduit les gates des quatre dépôts. Les
octets et SHA-256 correspondants sont consignés dans le dossier Contracts
`docs/reviews/authorized-execution-contracts-review.md`.

Rester candidat après ces preuves conserve la réversibilité mais empêche tout
runtime futur de dépendre d'une sémantique stable. Promouvoir plus largement
ouvrirait au contraire une autorité implicite sur des contrats non revus. Le
payoff recherché est donc précis : stabiliser seulement la frontière wire et
les refus fail-closed déjà éprouvés, sans confondre stabilité du contrat et
correction d'une implémentation.

## Décision

### D1 — Verrouiller exactement onze autorités

Le propriétaire autorise la transition `candidate -> locked` des seuls IDs :

- `execution-graph-v1` ;
- `execution-plan-body-v2` ;
- `execution-transfer-v1` ;
- `execution-authorization-v2` ;
- `human-decision-request-v1` ;
- `human-decision-response-v1` ;
- `step-invocation-v1` ;
- `effect-attestation-v1` ;
- `orchestrator-event-v3` ;
- `retention-policy-schema-v2` ;
- `retention-policy-v2`.

La transition retire uniquement leurs objets de revue désormais satisfaits et
met à jour la prose de cycle de vie. Les schémas, données de rétention,
fixtures, vecteurs sémantiques, vecteurs de digest et règles de validation
revus restent byte-identiques à l'autorité candidate citée en tête.

Les quatre autres candidats présents lors de la décision —
`harness-profile-v2`, `public-vote-dataset-v3`, `boussole-method-v3` et
`local-comparison-v3` — restent candidats. Cet acte ne les révise ni ne les
préautorise.

### D2 — Faire du lock une stabilité de contrat, jamais une preuve runtime

`locked` fixe la signification des onze contrats et permet aux consommateurs
de pinner une autorité exacte. Il ne prouve pas :

- la sérialisation atomique des transitions, générations et réservations ;
- l'idempotence ou le fencing au point d'effet externe ;
- l'absence de PII, secret ou valeur wire dans les logs d'un runtime ;
- la conformité d'un producteur ou consommateur Missions, Orchestrator,
  Harness, Proof/Artifact ou worker ;
- la sûreté d'un adaptateur LangGraph ou de tout autre framework.

Chacune de ces preuves appartient à un work package de Phase 4, avec TDD,
tests d'intégration/E2E, threat model, rollback et autorisation séparée. Aucun
runtime ne peut déduire de cet ADR le droit d'émettre un effet, de traiter une
mission réelle ou d'adopter une dépendance.

### D3 — Conserver LangGraph comme oracle non normatif

Le lock incorpore les questions rendues visibles par l'étude de LangGraph —
replay, retry, interruption humaine, checkpoint et panne entre effet et
persistance — mais aucune API, classe, sérialisation ou convention LangGraph ne
devient normative. Un worker LangGraph futur doit rester supprimable sans
modifier Missions ni l'autorité canonique d'Orchestrator.

Une divergence future avec LangGraph constitue une question à analyser, pas un
défaut du contrat. Modifier une sémantique verrouillée exige un nouveau major et
un nouveau cycle de décision ; une évolution du framework ne la modifie jamais
implicitement.

### D4 — Conditionner la promotion aux preuves exactes

La promotion est valide seulement si la revue de promotion confirme sur un
commit immuable :

1. les onze transitions exactes et la suppression de leurs seuls objets de
   revue ;
2. `99 locked / 4 candidate` et les quatre candidats restants exacts ;
3. tous les SHA-256 de l'autorité revue inchangés ;
4. les gates Contracts, TypeScript et Rust vertes, sans dérive générée ;
5. aucune modification de runtime, dépendance, infrastructure ou donnée ;
6. aucune fuite de PII ou de contenu privé dans les preuves ajoutées.

Tout écart remet automatiquement la décision à `hold`. Les SDK ne peuvent être
fusionnés qu'après présence du commit Contracts épinglé sur la branche par
défaut. La présence des pins prouve la provenance des projections, pas la
conformité d'un runtime.

## Conséquences

- Les futurs work packages runtime disposent d'une frontière stable et peuvent
  échouer sur dérive plutôt que reconstruire une convention implicite.
- Les onze majors ne peuvent plus être modifiés en place ; toute rupture exige
  un nouveau major, ses vecteurs, ses revues et son propre acte propriétaire.
- Les SDK restent des projections jetables de l'autorité Contracts et ne
  gagnent aucun pouvoir normatif.
- Le retrait d'un futur worker ou adaptateur framework ne nécessite aucune
  migration de contrat canonique.
- Les risques runtime résiduels restent visibles et bloquants ; le lock ne les
  transforme pas en hypothèses acceptées.

## Alternatives rejetées

### Conserver les onze familles candidates

Rejeté : après clôture des trois revues spécialisées et de l'intégration
candidate, cela n'ajoute aucune preuve de sécurité. Cela laisse seulement la
frontière instable et empêche un pin runtime futur d'avoir une sémantique
garantie.

### Verrouiller puis ouvrir immédiatement la Phase 4

Rejeté : cette option confond octets contractuels et propriétés concurrentes
d'une implémentation. Elle ferait disparaître les gates encore manquantes sur
l'atomicité, les effets et les logs.

### Adopter LangGraph comme implémentation de référence

Rejeté : une implémentation de référence deviendrait une spécification
implicite et rendrait son retrait coûteux pour Missions et Orchestrator. Cela
contredirait ADR-0032 et la remplaçabilité exigée par ADR-0034.

## Compatibilité et rollback

Le lock ajoute de nouveaux majors sans modifier les autorités antérieures. Le
rollback avant consommation runtime est un revert du changement de catalogue,
de la prose de cycle de vie et des pins SDK ; aucune donnée ni projection
générée ne migre.

Après une future activation runtime séparément autorisée, le rollback de cette
activation doit préserver les enregistrements et tombstones déjà produits. Ce
cas n'est pas ouvert par le présent ADR.

## Gate d'acceptation

L'acte propriétaire du 2026-09-10 accepte ce package sous les conditions D4.
L'intégration reste séquentielle : Governance ratifie l'acte, Contracts porte
le lock normatif, puis les SDK épinglent le commit Contracts revu. Chaque dépôt
doit être fusionné sous signature propriétaire après revue et CI vertes.
