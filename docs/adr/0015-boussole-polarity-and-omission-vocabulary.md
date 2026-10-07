# ADR-0015 — Traçabilité de la polarité éditoriale et vocabulaire d'omission (Boussole)

- **Statut :** accepted (2026-08-18) — la ratification est le merge propriétaire de cette pull request. Requalifié `deferred` par ADR-0023 le 2026-08-18 ; arbitré au fond le même jour, phase produits de la remise à plat 2026-08.
- **Date :** 2026-07-25 (questions posées) ; 2026-08-18 (décision)
- **Arbitrage :** propriétaire, 2026-08-18, par questions structurées (ADR-0022/I-24) — Q1-A et Q2-A retenues. Voir « Décision retenue » ci-dessous. Owner-arbitration: 2026-08-18
- **Portée :** contrats Boussole v2 — `contracts/schemas/public-vote-dataset.v2.schema.json`, `contracts/schemas/local-comparison.v2.schema.json`, monde `contracts/wit/boussole-scoring-v2`
- **Origine :** analyse d'écart du 2026-07-25 entre une spécification non versionnée retrouvée dans le dépôt `boussole-politique` (candidate jamais commitée) et les contrats Boussole verrouillés du monorepo.
- **Lié à :** ADR-0013, ADR-0014 (mêmes contrats, même axe de vérifiabilité).

## Contexte

Deux informations que le produit manipule n'ont **aucune existence contractuelle**. Elles sont traitées ensemble parce qu'elles portent le même défaut : une distinction sémantique réelle, portée aujourd'hui par la seule prose ou par la seule couche produit, sans trace vérifiable par machine.

### 1. Polarité éditoriale

Un scrutin et la formulation d'un énoncé peuvent être de sens inverse : un vote « pour » sur le scrutin correspond alors à un **désaccord** avec l'énoncé tel qu'il est rédigé. La spécification candidate portait un champ dédié, `polarity ∈ {-1, +1}`, requis par énoncé, avec une fixture d'inversion et une section méthodologique dédiée.

Dans les contrats du monorepo, `polarity` n'existe pas. Vérification : `git grep -ril polarity -- contracts apps packages crates` ne retourne aucun fichier. L'inversion est censée être absorbée par la rédaction de `wording`, elle-même liée au digest du dataset et relue par le relecteur vie privée. Le signe du score dépend donc d'une relecture de prose, sans marqueur machine et sans vecteur golden couvrant un dataset à formulation inversée.

**Fait à signaler, non corrigé par cet ADR — réserve close le 2026-07-28.** Le tableau §3 des cartes de parité pré-freeze de Boussole déclarait la ligne « VAA statement layer + polarity » comme couverte par la spécification, colonne « Couverture spec » renseignée à « Data, Journey #2 ». **Cette ligne était fausse** : aucun contrat ne porte la polarité. La correction annoncée par pull request séparée est devenue sans objet : ces cartes ont été oubliées par ADR-0019 (`forgotten.legacy-reference-parity`). Le fait reste enregistré ici ; l'affirmation fausse ne survit nulle part.

### 2. Vocabulaire d'omission

`boussole-method.v2` déclare `"missingTreatment": { "const": "excluded-and-reported" }` — la donnée manquante est exclue **et rapportée**. Le rapport se réduit pourtant, dans `local-comparison.v2`, à `"omitted": { "type": "integer" }` : une **somme de votes**, sans motif et sans granularité par énoncé.

Quatre distinctions sont perdues :

- **`skip` explicite vs réponse absente.** `SEMANTICS.md` les traite identiquement : « A skipped or missing response omits all votes … and emits no contribution ». La candidate en faisait deux motifs distincts et interdisait explicitement de convertir l'un ou l'autre en position neutre.
- **Abstention vs absence.** Les deux alimentent `votesOmitted_i` selon `abstentionTreatment`, sans qu'on puisse les distinguer en sortie.
- **Donnée de vote indisponible vs absence de l'élu.** Cette distinction est **inexprimable** dans le modèle v2 : les quatre compteurs sont requis, et un énoncé sans donnée s'écrirait `0,0,0,0`, ce que le plancher `minimumGroupSize ≥ 5` exclut du dataset.
- **Motif par énoncé.** La candidate portait une liste `[{statementId, reason}]` avec cinq motifs exclusifs classés par priorité ; la v2 n'a qu'un scalaire global.

Le produit a pourtant besoin de ce vocabulaire : la fonction d'explication annoncée pour Boussole doit dire à l'utilisateur pourquoi un énoncé n'a pas compté. Aujourd'hui elle devrait le dériver hors contrat.

## Questions posées

> **Q1.** L'inversion de sens entre un scrutin et la formulation d'un énoncé doit-elle laisser une trace contractuelle vérifiable par machine, ou reste-t-elle une contrainte de rédaction contrôlée par la seule relecture humaine du `wording` ?
>
> **Q2.** Le motif d'omission par énoncé — réponse manquante, `skip`, abstention, absence, donnée de vote indisponible — appartient-il au contrat de résultat, ou à la couche produit qui détient déjà le dataset et le jeu de réponses ?

## Contrainte commune : aucune fermeture par extension compatible

Les deux fermetures contractuelles se heurtent à la même mécanique, qu'il faut énoncer avant les options.

1. `public-vote-dataset.v2` et `local-comparison.v2` sont `additionalProperties: false`. Aucun champ, même optionnel, ne peut y être ajouté sans amender le schéma.
2. Le dataset est lié par digest à ses approbations : `H("libre-ai.public-vote-dataset.v2", dataset sans publishedAt, digest, approvals)`, et chaque approbation porte `subjectDigest` égal à ce digest. **Tout ajout de champ change le digest et invalide les deux approbations de tous les datasets existants**, qui doivent être ré-attestées.
3. `contracts/COMPATIBILITY.md` : « Required-field removal, rename, type/meaning change, enum narrowing or identifier reinterpretation requires a new major contract ». Remplacer `omitted: integer` par une liste est un changement de type d'un champ requis.
4. Le type de sortie du monde WIT change en même temps que le schéma de résultat.

Une fermeture contractuelle de Q1 implique donc `public-vote-dataset.v3` ; une fermeture contractuelle de Q2 implique `local-comparison.v3` **et** `boussole-scoring-v3`. Dans les deux cas : ADR d'amendement, reprise des rôles de revue du catalogue, nouvelles approbations.

## Options pour Q1 — polarité

### Option Q1-A — contractuelle

Ajouter `polarity` aux énoncés de `public-vote-dataset.v3`, requis, et faire porter l'inversion par le calcul plutôt que par la rédaction.

- **Conséquence :** nouvelle majeure du dataset, re-attestation de tous les datasets. En contrepartie, le signe du score cesse de dépendre d'une lecture de prose : un vecteur golden peut couvrir l'inversion, et un dataset mal orienté devient détectable par test.

### Option Q1-B — rédactionnelle, avec preuve par vecteur

Ne rien changer aux contrats ; fixer la règle de rédaction dans `docs/apps/boussole.md` (la formulation absorbe l'inversion, jamais le calcul), et ajouter aux vecteurs golden un cas à formulation inversée.

- **Conséquence :** aucun amendement de schéma. Réserve à instruire : `engine-golden-vectors-v1` est `locked` au catalogue ; l'ajout d'un cas relève-t-il d'une extension additive de fixture ou d'une nouvelle version de fixture ? Ce point est ouvert.
- **Ce qu'elle ne referme pas :** le contrat reste incapable de distinguer un dataset correctement orienté d'un dataset inversé. La garantie repose sur la relecture humaine du `wording`, déjà exigée par `SEMANTICS.md` pour le contrôle de non-ciblage de personne.

### Option Q1-C — statu quo intégral

Aucune règle écrite, aucune trace, aucun vecteur. Enregistré ici pour être explicitement pesé : c'est l'état courant, et le tableau de parité le déclare pourtant couvert.

## Options pour Q2 — vocabulaire d'omission

### Option Q2-A — contractuelle

Remplacer `omitted: integer` par une liste `[{statementId, reason}]` à motifs exclusifs dans `local-comparison.v3`, avec l'énumération correspondante dans le monde `boussole-scoring-v3`.

- **Conséquence :** deux majeures corrélées. En contrepartie, la taxonomie est gouvernée par le contrat, partagée par le moteur et le produit, et couverte par vecteurs. La distinction « donnée de vote indisponible » exige en outre de rendre le cas représentable côté dataset, ce qui la rattache à une majeure du dataset.

### Option Q2-B — dérivation côté produit

Laisser le contrat inchangé. La couche TypeScript détient le dataset, la méthode et le jeu de réponses ; elle peut recalculer par elle-même le motif d'omission de chaque énoncé pour l'affichage.

- **Conséquence :** aucun amendement. La taxonomie cesse d'être gouvernée par contrat : deux consommateurs peuvent en produire deux versions divergentes, et rien ne garantit qu'elle reste alignée sur le moteur si `SEMANTICS.md` évolue.
- **Réserve à noter :** `missingTreatment: "excluded-and-reported"` reste alors une promesse contractuelle dont la partie « reported » n'est pas honorée par le contrat lui-même.

### Option Q2-C — cadrage documentaire du scalaire

Laisser le contrat inchangé et énoncer en prose que `omitted` est un total de votes, non un décompte d'énoncés, et que le motif par énoncé est hors périmètre du moteur.

- **Conséquence :** aucun amendement de schéma ; la sous-spécification cesse d'être silencieuse. Ne referme aucun des quatre écarts de distinction.

## Décision retenue (2026-08-18)

Q1 et Q2 reçoivent toutes deux la réponse contractuelle, dans la même majeure v3 (§"Contrainte commune" ci-dessus l'anticipait : une fermeture contractuelle de Q1 implique `public-vote-dataset.v3`, une fermeture de Q2 implique `local-comparison.v3` ; les deux fermetures partagent la pull request `contracts` [#8](https://github.com/libre-ai/contracts/pull/8), draft).

### Q1 — **Option Q1-A, contractuelle**

`public-vote-dataset.v3` porte `polarity` (`enum: [-1, 1]`), requis par énoncé — l'inversion de sens entre un scrutin et la formulation d'un énoncé est désormais déclarée par le contrat, pas seulement absorbée par la relecture du `wording`. Option Q1-B (rédactionnelle) et Q1-C (statu quo) sont écartées : le signe du score cesse de dépendre d'une seule relecture de prose.

**Correction de la ligne fausse du tableau de parité, actée ici.** Le §"Contexte" ci-dessus enregistrait comme fait vérifié que la ligne « VAA statement layer + polarity » du tableau de parité pré-freeze était fausse (aucun contrat ne portait alors la polarité) et que sa correction restait sans objet, ces cartes ayant été oubliées par ADR-0019. Cette décision ne rouvre pas les cartes oubliées ; elle ferme le seul écart qui restait ouvert — l'absence contractuelle elle-même.

### Q2 — **Option Q2-A, contractuelle**

`local-comparison.v3` remplace le scalaire `omitted: integer` par une liste `omissions: [{statementId, reason}]`, motifs exclusifs. La taxonomie retenue le 2026-08-18 comporte quatre motifs fermés — `explicit-skip`, `abstention`, `vote-data-unavailable`, `representative-absent` — et non les cinq de la spécification candidate d'origine citée au §"Contexte" (qui distinguait en plus `skip` explicite de réponse absente comme deux motifs séparés ; le moteur documenté par `SEMANTICS.md` les traite déjà identiquement, « A skipped or missing response omits all votes... and emits no contribution », d'où leur fusion sous `explicit-skip` dans le contrat plutôt que la reconduction du cinquième motif). Options Q2-B (dérivation côté produit) et Q2-C (cadrage documentaire seul) sont écartées : la taxonomie est désormais gouvernée par le contrat plutôt que rederivée, potentiellement de façon divergente, par chaque consommateur.

La distinction « donnée de vote indisponible vs absence de l'élu » que le §"Contexte" qualifiait d'inexprimable dans le modèle v2 (compteurs requis, plancher `minimumGroupSize ≥ 5`) reste, à ce stade, une distinction portée par le _vocabulaire de sortie_ (`vote-data-unavailable` et `representative-absent` sont deux valeurs distinctes de l'énumération) sans que le _dataset_ v3 gagne un moyen structurel de produire l'une plutôt que l'autre au-delà de ses compteurs `votesFor`/`votesAgainst`/`abstentions`/`absent` existants — cette dernière fermeture n'était pas demandée par la présente décision et reste ouverte.

**Ce que la décision ne couvre pas encore :** comme pour ADR-0013 et ADR-0014, le monde WIT `boussole-scoring-v3` n'existe pas ; `contracts/wit/boussole-scoring-v2` et ses vecteurs golden/sécurité continuent de nommer et de produire selon la majeure v2, y compris pour l'énumération d'omission côté moteur que Q2-A évoque. Majeure corrélée restant à ouvrir.

Le catalogue porte `public-vote-dataset-v3` et `local-comparison-v3` en `candidate` (`pending-independent-agent-review`), pas `locked`, pour la même raison qu'ADR-0013/ADR-0014 : revue à rôles séparés requise (`COMPATIBILITY.md`), non fournie par une session solo — voir le dossier partagé `docs/reviews/boussole-v3-numeric-polarity-omission-review.md` dans `contracts`.
