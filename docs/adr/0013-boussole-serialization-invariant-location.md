# ADR-0013 — Lieu des invariants de sérialisation des résultats Boussole

- **Statut :** accepted (2026-08-18) — la ratification est le merge propriétaire de cette pull request. Requalifié `deferred` par ADR-0023 le 2026-08-18 ; arbitré au fond le même jour, phase produits de la remise à plat 2026-08.
- **Date :** 2026-07-25 (question posée) ; 2026-08-18 (décision)
- **Arbitrage :** propriétaire, 2026-08-18, par questions structurées (ADR-0022/I-24) — option C+D retenue. Voir « Décision retenue » ci-dessous. Owner-arbitration: 2026-08-18
- **Portée :** contrats Boussole v2 — `contracts/schemas/local-comparison.v2.schema.json`, `contracts/schemas/boussole-method.v2.schema.json`, `contracts/wit/boussole-scoring-v2/SEMANTICS.md`
- **Origine :** analyse d'écart du 2026-07-25 entre une spécification non versionnée retrouvée dans le dépôt `boussole-politique` (candidate jamais commitée) et les contrats Boussole verrouillés du monorepo.
- **Lié à :** ADR-0014 (auto-consistance du résultat), ADR-0016 (protocole de revue humaine) — même axe : ce qu'un tiers peut vérifier sans exécuter le moteur.

## Contexte

Les contrats Boussole v2 énoncent quatre invariants de forme sur les valeurs sérialisées :

1. six décimales exactes sur `score` et sur chaque `contribution` ;
2. arrondi ties-to-even (`"rounding": { "const": "decimal-6-half-even" }` dans `boussole-method.v2`) ;
3. zéro négatif interdit en sortie (« negative zero is emitted as `0` ») ;
4. `responseScale` strictement croissante, symétrique (`x` implique `-x`), de valeur absolue maximale `M` non nulle.

Les invariants 1, 3 et 4 ne vivent **que** dans la prose de `contracts/wit/boussole-scoring-v2/SEMANTICS.md` et dans l'implémentation de référence `tools/quality/check-boussole-v2-vectors.ts`. Les schémas JSON verrouillés ne les portent pas :

- `local-comparison.v2` déclare `"score": { "type": "number", "minimum": -1, "maximum": 1 }`. Un producteur qui émet `0.3333333333333333` **valide le schéma verrouillé**. Idem pour chaque `contribution`.
- `boussole-method.v2` déclare `responseScale` comme un tableau de 2 à 11 entiers uniques de `-5` à `+5`. La valeur `[0, 3]` — ni symétrique, ni de maximum absolu non nul au sens voulu — **valide le schéma verrouillé** et n'est refusée qu'au runtime du moteur.
- Aucune contrainte de schéma n'interdit `-0`.

La spécification candidate plaçait ces mêmes invariants **dans le schéma** : `score` sérialisé en entier signé de micros accompagné d'une chaîne contrainte par `pattern` à six décimales exactes, plus un `not: { "const": "-0.000000" }`. La conséquence est directe : un validateur JSON Schema générique suffisait à rejeter une sortie malformée, sans exécuter le moteur ni disposer de ses vecteurs.

L'écart n'est pas numérique. Pour `|x| ≤ 1` à six décimales, le double IEEE-754 est exact au round-trip et RFC 8785 (JCS) restitue la valeur ; le risque de perte de précision est nul en pratique. L'écart porte sur **le lieu de l'invariant**, donc sur qui peut le vérifier et avec quel outil.

Ce lieu conditionne une exigence déjà inscrite ailleurs : les contrats verrouillés imposent deux approbations humaines indépendantes (ADR-0016), et un relecteur indépendant à qui l'on demande de recalculer sans appeler le moteur du projet ne peut pas vérifier un invariant qui n'existe que dans ce moteur.

## Question posée

> Les invariants de forme du résultat de comparaison — six décimales, ties-to-even, zéro négatif interdit, échelle strictement croissante et symétrique — doivent-ils être portés par les schémas JSON, où un tiers les vérifie avec un validateur générique, ou restent-ils dans `SEMANTICS.md` et l'implémentation de référence ?

## Options

### Option A — statu quo : invariants en prose, vérifiés par le moteur et ses vecteurs

Les schémas restent des bornes de type et d'intervalle ; `SEMANTICS.md` reste l'autorité de forme ; `check-boussole-v2-vectors.ts` reste la seule vérification exécutable.

- **Coût contractuel :** nul. Aucun amendement, aucune approbation invalidée.
- **Ce qu'elle préserve :** la sortie reste un `number` JSON, forme la plus directe pour les consommateurs, et l'arithmétique exacte reste entièrement interne au moteur.
- **Ce qu'elle laisse ouvert :** la validation de schéma d'un artefact Boussole ne prouve rien sur sa forme ; toute vérification indépendante suppose de reconstruire l'algorithme d'arrondi depuis la prose ou de faire confiance à `tools/`, qui n'est pas une autorité du catalogue. Un artefact hors norme circule sans être détecté par un consommateur qui ne valide qu'au schéma.

### Option B — porter les invariants au schéma, sortie numérique conservée

Ajouter aux schémas les contraintes exprimables sur un `number` : `multipleOf` à `1e-6` sur `score` et `contribution`, contraintes de croissance et de symétrie sur `responseScale` par `$defs` dédié.

- **Coût contractuel :** resserrement du domaine accepté d'un champ requis. `contracts/COMPATIBILITY.md` traite le changement de type ou de sens comme exigeant un nouveau majeur ; un resserrement de domaine sur un champ existant relève de la même catégorie dès lors qu'un producteur conforme au v2 peut devenir non conforme. **Nouvelle majeure `local-comparison.v3` et `boussole-method.v3`.**
- **Réserve technique dirimante à instruire :** `multipleOf: 1e-6` sur des flottants binaires est d'évaluation dépendante de l'implémentation. `0.000001` n'est pas représentable exactement en binaire ; le reste calculé par un validateur peut être non nul pour une valeur pourtant correcte. Cette option ne tient que si le comportement est éprouvé sur le validateur retenu (Ajv, décision D13) et figé par vecteurs adverses. À défaut, elle donne l'apparence d'un invariant sans la garantie.
- **Contraintes de croissance/symétrie :** exprimables sans ambiguïté en JSON Schema 2020-12 (`prefixItems`, `contains`, `$defs`), sans le piège flottant. Ce sous-ensemble de l'option B est techniquement solide indépendamment du reste.

### Option C — porter les invariants au schéma, sortie en micros entiers plus chaîne contrainte

Reprendre la forme candidate : `scoreMicros` entier signé de `-1000000` à `1000000` **et** `score` en chaîne contrainte par `pattern` à six décimales exactes, avec `not: { "const": "-0.000000" }` ; même traitement par contribution.

- **Coût contractuel :** changement de type d'un champ requis, plus changement du type de sortie du monde WIT. **Nouvelle majeure `local-comparison.v3` et `boussole-scoring-v3`**, nouveaux vecteurs golden, reprise des rôles de revue du catalogue, et re-approbation des objets liés par digest.
- **Ce qu'elle apporte :** l'invariant devient vérifiable par un validateur JSON Schema générique, sans flottant et sans dépendance à l'implémentation du validateur. Le zéro négatif devient impossible par construction plutôt que neutralisé par la sérialisation ECMAScript. C'est la seule option qui satisfait pleinement l'exigence de recalcul indépendant.
- **Ce qu'elle coûte par ailleurs :** deux représentations d'une même valeur dans le document, donc un invariant de cohérence supplémentaire entre elles ; et une sortie moins directe à consommer.

### Option D — expliciter l'algorithme dans le contrat, sans toucher aux schémas

Écrire dans `SEMANTICS.md` la conversion rationnel exact → décimal à six décimales sous forme d'algorithme entier exact et vérifiable au papier, plutôt que par le seul nom `ties-to-even`. La spécification candidate donnait la forme équivalente pour son propre mode d'arrondi (`q = floor((2A + d) / (2d))`, `A = 10⁶ × |numerator|`).

- **Coût contractuel :** à instruire. `SEMANTICS.md` appartient à une autorité verrouillée, mais `COMPATIBILITY.md` réserve la majeure aux changements de signature, de type, d'imports host, d'opérations ou de droits. Une explicitation qui ne modifie aucun comportement observable relève plutôt de la clarification — précédent : ADR-0010, clarification d'une réponse sous-spécifiée sans amendement d'un principe verrouillé. **Ce classement est lui-même une question ouverte de cet ADR.**
- **Ce qu'elle apporte :** un relecteur retrouve la valeur attendue à la main, sans exécuter le moteur ni interpréter un nom de mode.
- **Ce qu'elle ne referme pas :** un validateur JSON Schema continue d'accepter une sortie hors norme. L'option D améliore la vérifiabilité humaine, pas la vérifiabilité machine par un consommateur.

Les options B, C et D ne s'excluent pas : D peut accompagner A, B ou C.

## Conséquences selon l'option

| Option | Amendement de lock             | Vérifiable par validateur générique   | Vérifiable à la main par un relecteur |
| ------ | ------------------------------ | ------------------------------------- | ------------------------------------- |
| A      | aucun                          | non                                   | seulement en réimplémentant l'arrondi |
| B      | majeure ×2                     | partiellement, sous réserve flottante | non                                   |
| C      | majeure ×3 (dont le monde WIT) | oui                                   | oui                                   |
| D      | à qualifier                    | non                                   | oui                                   |

## Décision retenue (2026-08-18)

**Option C + D**, combinées comme le document ci-dessus l'anticipait (« D peut accompagner A, B ou C ») :

- **C — micros entiers + chaîne contrainte.** `local-comparison.v3` porte `scoreMicros`/`contributionMicros` (entiers signés, `-1000000..1000000`) et `score`/`contribution` en chaîne à six décimales exactes (`^-?(0\.[0-9]{6}|1\.000000)$`), zéro négatif interdit par `not: {"const": "-0.000000"}`. Implémenté dans `libre-ai/contracts` pull request [#8](https://github.com/libre-ai/contracts/pull/8) (draft — voir plus bas), `contracts/schemas/local-comparison.v3.schema.json`.
- **D — algorithme explicite, pas seulement nommé.** Le mode d'arrondi n'est plus un simple nom : `boussole-method.v3` porte `"rounding": {"const": "decimal-6-half-even-exact-rational"}` avec une description qui fixe l'algorithme entier exact (`q = floor((2A + d) / (2d))`, `A = 10⁶ × |numerator|`) sur `(weightedNumerator, scaledDenominator)` — la forme exacte que porte ADR-0014. Ce classement referme la question ouverte par cet ADR (« la qualification exacte de l'option D... est un point d'arbitrage à part entière ») : documenter l'algorithme dans le contrat ne modifie aucun comportement observable, c'est une clarification au sens du précédent ADR-0010, appliquée ici en même temps qu'une majeure déjà requise par l'option C — la question de savoir si D à lui seul aurait exigé une majeure reste sans objet.

**Ce que la décision ne couvre pas encore :** l'écriture de l'algorithme en toutes lettres dans `contracts/wit/boussole-scoring-v2/SEMANTICS.md` (l'option D telle que décrite au §"Options" ci-dessus, qui visait ce fichier précisément) n'est pas faite — `SEMANTICS.md` reste au texte v2, non touché par la pull request contracts #8. De même, le monde WIT `boussole-scoring-v3` que le tableau « Conséquences selon l'option » compte pour l'option C (« majeure ×3, dont le monde WIT ») n'existe pas : la pull request #8 amende uniquement les trois schémas JSON Schema (`local-comparison`, `boussole-method`, `public-vote-dataset`), pas le monde WIT ni ses vecteurs golden/sécurité, qui continuent de nommer les majeures v2. Ce sont des majeures corrélées restant à ouvrir — non closes par le présent ADR.

Les trois schémas v3 sont catalogués `candidate` (`pending-independent-agent-review`), pas `locked` : ce dépôt exige une revue à rôles séparés avant verrouillage (`COMPATIBILITY.md`), qu'une session solo ne peut pas fournir. Le dossier de revue (`docs/reviews/boussole-v3-numeric-polarity-omission-review.md` dans `contracts`) signale par ailleurs que `docs/reviews/AGENT-REVIEW-PROTOCOL.md`, vers lequel le mécanisme de catalogue et la documentation de `contracts` renvoient, n'existe nulle part dans ce dépôt — un écart trouvé en amendant ce candidat, non corrigé par lui.
