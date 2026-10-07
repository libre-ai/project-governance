# ADR-0014 — Auto-consistance vérifiable du résultat de comparaison Boussole

- **Statut :** accepted (2026-08-18) — la ratification est le merge propriétaire de cette pull request. Requalifié `deferred` par ADR-0023 le 2026-08-18 ; arbitré au fond le même jour, phase produits de la remise à plat 2026-08.
- **Date :** 2026-07-25 (question posée) ; 2026-08-18 (décision)
- **Arbitrage :** propriétaire, 2026-08-18, par questions structurées (ADR-0022/I-24) — option B retenue. Voir « Décision retenue » ci-dessous. Owner-arbitration: 2026-08-18
- **Portée :** contrats Boussole v2 — `contracts/schemas/local-comparison.v2.schema.json`, monde `contracts/wit/boussole-scoring-v2`
- **Origine :** analyse d'écart du 2026-07-25 entre une spécification non versionnée retrouvée dans le dépôt `boussole-politique` (candidate jamais commitée) et les contrats Boussole verrouillés du monorepo.
- **Lié à :** ADR-0013 (lieu des invariants de sérialisation), ADR-0016 (protocole de revue humaine).

## Contexte

`contracts/wit/boussole-scoring-v2/SEMANTICS.md` définit le calcul sur des rationnels exacts :

```text
publicPosition_i = (for_i - against_i) / considered_i
contribution_i   = u_i * publicPosition_i
score            = sum(contribution_i * considered_i) / denominator
```

puis prescrit la sérialisation : « Each emitted contribution and score is rounded to six decimal places, ties-to-even ». L'implémentation de référence le confirme — `tools/quality/check-boussole-v2-vectors.ts` appelle la même fonction `roundRational` sur chaque contribution **et** sur le score, chacune à partir de son propre rationnel exact.

La conséquence est un défaut d'auto-consistance de la sortie publiée. Chaque `contribution_i` sérialisée est arrondie **avant** d'entrer dans une recomposition, tandis que `score` est l'arrondi du rationnel global. Un tiers qui ne dispose que du document `local-comparison.v2` et qui recompose

```text
sum(contribution_i_publié * votesConsidered_i) / denominator
```

obtient une valeur qui peut différer du `score` publié. La borne est étroite et calculable : chaque contribution publiée s'écarte de sa valeur exacte d'au plus 5 × 10⁻⁷, l'erreur pondérée est majorée par cette même quantité puisque `Σ considered_i = denominator`, et l'arrondi final peut alors basculer d'un micro (10⁻⁶). Le vecteur `half-even-boundaries` de `contracts/fixtures/boussole-scoring-v2/golden-vectors.v1.json` retombe sur ses pieds, mais rien dans le contrat ne garantit ce résultat en général.

La spécification candidate ne pouvait pas présenter ce défaut : ses contributions étaient des **entiers exacts** (`numeratorContribution ∈ [-2, 2]`), la somme de ces entiers était le numérateur déclaré comme invariant sémantique, et la valeur normalisée dérivait du seul couple `(numerator, denominator)`. Une sortie candidate se revérifiait intégralement à partir d'elle-même.

Deux précisions factuelles bornent le débat.

**La forme exacte existe et tient dans les bornes actuelles.** Avec `u_i = r_i / M`, le terme pondéré vaut `r_i × (for_i − against_i) / M`. Le score exact s'écrit donc comme un rationnel d'entiers : numérateur `Σ r_i (for_i − against_i)`, dénominateur `M × denominator`. `SEMANTICS.md` majore déjà le premier par `21 474 836 475 000` et le second par `64 424 509 425 000`, tous deux inférieurs à `9007199254740991`, la borne d'entier sûr déjà employée par le schéma. Une représentation entière exacte du résultat est donc sérialisable en JSON sans arithmétique étendue.

**L'auto-consistance n'est pas une question de confidentialité.** La sortie v2 publie déjà `contribution_i`, `votesConsidered_i` et le digest du dataset ; un tiers qui détient le dataset public et la méthode retrouve `r_i` par simple inversion. Exposer des entiers exacts ne divulgue donc rien de plus que la sortie actuelle. L'argument de minimisation ne départage pas les options ci-dessous.

## Question posée

> Le résultat de comparaison publié doit-il être exactement re-dérivable à partir de ses seules valeurs sérialisées, ou la revérification exacte reste-t-elle réservée à un recalcul depuis le dataset, la méthode et le jeu de réponses ?

## Options

### Option A — statu quo : le résultat est un rapport, pas un objet auto-vérifiant

La sortie reste un compte rendu lisible ; l'autorité de vérification reste le triplet dataset + méthode + jeu de réponses, tous trois liés par digest dans le document.

- **Coût contractuel :** nul.
- **Ce qu'elle préserve :** une sortie compacte, des contributions directement affichables, aucune reprise des rôles de revue.
- **Ce qu'elle laisse ouvert :** un tiers qui ne détient que le résultat ne peut ni le confirmer ni l'infirmer. Le contrat ne dit nulle part que la recomposition n'est pas normative ; un consommateur qui la tenterait constaterait un écart d'un micro sans savoir si c'est un défaut de son calcul, un défaut du producteur ou un comportement attendu. Cette ambiguïté est aujourd'hui non documentée.

### Option A′ — statu quo, mais l'ambiguïté est levée en prose

Identique à A, plus un énoncé explicite dans `SEMANTICS.md` : la recomposition depuis les contributions publiées n'est pas normative et peut différer du score d'au plus un micro.

- **Coût contractuel :** à qualifier au regard de `contracts/COMPATIBILITY.md`, comme l'option D d'ADR-0013 : aucun comportement observable ne change.
- **Ce qu'elle apporte :** un consommateur et un relecteur savent ce qu'ils peuvent attendre de la sortie. Le défaut cesse d'être silencieux.
- **Ce qu'elle ne referme pas :** le résultat reste non auto-vérifiable.

### Option B — sérialiser la forme rationnelle exacte

Ajouter au résultat le couple entier exact `(weightedNumerator, scaledDenominator) = (Σ r_i (for_i − against_i), M × denominator)`, et par contribution son terme entier `r_i (for_i − against_i)`. `score` reste publié en tant que valeur arrondie, dérivée de ce couple.

- **Coût contractuel :** ajout de champs requis à un schéma `additionalProperties: false` et changement du type de sortie du monde WIT. **Nouvelle majeure `local-comparison.v3` et `boussole-scoring-v3`**, nouveaux vecteurs golden, reprise des rôles de revue du catalogue.
- **Ce qu'elle apporte :** l'égalité `Σ terme_i = weightedNumerator` et la dérivation de `score` depuis `(weightedNumerator, scaledDenominator)` deviennent deux invariants vérifiables sur la seule sortie, en arithmétique entière, sans flottant. C'est l'option qui satisfait l'exigence de recalcul indépendant d'ADR-0016 pour le résultat.
- **Ce qu'elle coûte par ailleurs :** un document plus large et une redondance assumée entre la forme exacte et la forme arrondie, donc un invariant de cohérence supplémentaire à faire respecter.

### Option C — redéfinir le score comme l'arrondi de la recomposition

Faire du score publié l'arrondi de `Σ contribution_i_arrondie × considered_i / denominator`, ce qui rend la relation exacte par construction sans nouveau champ.

- **Coût contractuel :** la valeur du score change dans les cas limites. C'est un changement de sémantique d'un monde WIT verrouillé. **Nouvelle majeure `boussole-scoring-v3`** et regénération des vecteurs golden.
- **Réserve technique :** l'option dégrade la correction pour obtenir la cohérence. Le score cesse d'être l'arrondi de la valeur mathématique et devient l'arrondi d'une somme d'arrondis, dont l'erreur par rapport au rationnel exact croît avec le nombre d'énoncés. C'est le sens inverse de l'exigence d'arithmétique exacte que `SEMANTICS.md` impose partout ailleurs.

### Option D — publier les entrées par énoncé plutôt que les agrégats

Reprendre la forme candidate : sérialiser `responseValue_i`, `votesFor_i`, `votesAgainst_i` dans le résultat, laissant le tiers refaire tout le calcul.

- **Coût contractuel :** identique à B — nouvelle majeure du schéma et du monde WIT.
- **Ce qu'elle apporte :** la revérification la plus complète possible sur un document unique.
- **Ce qu'elle coûte :** l'artefact local recopie une partie du dataset public, dont l'autorité est déjà liée par digest ; la duplication crée une source concurrente qui peut diverger de sa source liée. B obtient l'auto-consistance sans cette duplication.

## Conséquences selon l'option

| Option | Amendement de lock     | Score = arrondi de la valeur exacte | Recomposable sur la seule sortie |
| ------ | ---------------------- | ----------------------------------- | -------------------------------- |
| A      | aucun                  | oui                                 | non, écart possible d'un micro   |
| A′     | à qualifier            | oui                                 | non, mais l'écart est documenté  |
| B      | majeure ×2             | oui                                 | oui, en arithmétique entière     |
| C      | majeure ×1 (monde WIT) | non                                 | oui                              |
| D      | majeure ×2             | oui                                 | oui, par recalcul complet        |

## Décision retenue (2026-08-18)

**Option B — sérialiser la forme rationnelle exacte.** L'auto-consistance est retenue comme exigence du produit, pas seulement comme commodité de vérification : `local-comparison.v3` porte `weightedNumerator`/`scaledDenominator` (le couple entier exact `(Σ r_i(for_i−against_i), M×denominator)`) et, par contribution, `weightedTerm` (`r_i(for_i−against_i)`). `score` reste publié comme valeur arrondie, dérivée de ce couple — Option C (redéfinir le score comme l'arrondi de la recomposition, dégradant la correction) et Option D (dupliquer les entrées par énoncé) sont écartées : C sacrifiait l'exactitude par rapport à la valeur mathématique pour la cohérence, dans le sens inverse de ce que `SEMANTICS.md` exige partout ailleurs ; D dupliquait une partie du dataset déjà lié par digest.

Implémenté dans `libre-ai/contracts` pull request [#8](https://github.com/libre-ai/contracts/pull/8) (draft), `contracts/schemas/local-comparison.v3.schema.json` : `sum(weightedTerm)` sur `contributions` égale `weightedNumerator`, et `score == round(weightedNumerator / scaledDenominator)` (six décimales, ties-to-even, cf. ADR-0013) sont désormais des invariants vérifiables sur le seul document `local-comparison`, en arithmétique entière, sans exécuter le moteur — l'exigence de recalcul indépendant que cet ADR posait.

**Ce que la décision ne couvre pas encore :** le monde WIT `boussole-scoring-v3` que le tableau « Conséquences selon l'option » compte pour l'option B (« majeure ×2 ») n'existe pas — la pull request #8 amende le schéma JSON `local-comparison`, pas le monde WIT `boussole-scoring-v2` ni ses vecteurs golden/sécurité, qui continuent de nommer et de produire selon la majeure v2. Majeure corrélée restant à ouvrir, non close par le présent ADR.

Le catalogue porte `local-comparison-v3` en `candidate` (`pending-independent-agent-review`), pas `locked`, pour la même raison qu'ADR-0013 : revue à rôles séparés requise (`COMPATIBILITY.md`), non fournie par une session solo — voir le dossier `docs/reviews/boussole-v3-numeric-polarity-omission-review.md` dans `contracts`, partagé avec ADR-0013 et ADR-0015 puisque les trois candidats se verrouillent ensemble.
