# ADR-0016 — Protocole de revue humaine gaté par hash, distinct du protocole de revue par agents

- **Statut :** deferred (2026-08-18, ADR-0023 — Domain A re-ratification) — fond arbitré en phase produits de la remise à plat 2026-08 ; question ouverte inchangée, aucune option retenue par cet ADR
- **Date :** 2026-07-25
- **Arbitrage :** en attente de décision propriétaire. Cet ADR formule la question et ses options avec leurs conséquences ; il ne tranche pas et n'autorise aucun amendement de contrat.
- **Portée :** gouvernance de revue — `docs/reviews/`, évidence de forge. **Aucun contrat n'est touché par le protocole lui-même.**
- **Origine :** analyse d'écart du 2026-07-25 entre une spécification non versionnée retrouvée dans le dépôt `boussole-politique` (candidate jamais commitée) et les contrats Boussole verrouillés du monorepo.
- **Se rapporte à :** décision D19 du registre (« Boussole public scoring independently gated »), `docs/reviews/AGENT-REVIEW-PROTOCOL.md`.

## Contexte

Les contrats Boussole v2 **prescrivent** deux approbations humaines et les font respecter au runtime :

- `boussole-method.v2` et `public-vote-dataset.v2` exigent exactement deux entrées `approvals`, de rôles `methodological-review` et `legal-privacy-review`, `actorKind: "human"`, `reviewerId` distincts au motif `^rev_[a-z0-9]{16,64}$`, capacité professionnelle couplée au rôle, `subjectDigest` égal au digest de l'objet, et une attestation externe HTTPS liée par SHA-256 avec `publicationBasis: "explicit-publication-consent"` et `identityBoundary: "professional-attestation-only"` ;
- la revue de publication du dataset porte une expiration UTC à la seconde ; toute comparaison postérieure à cet instant retourne `approval-invalid` ;
- un objet dépourvu d'approbations valides retourne `approval-invalid`.

**Aucun document du monorepo ne dit comment produire une de ces approbations.** `docs/reviews/AGENT-REVIEW-PROTOCOL.md` gouverne des passes d'**agents** : il pose explicitement que « The same agent and session **MAY** perform authoring and later review passes » et que l'inégalité d'agent ou de session n'est pas un critère d'indépendance. Les quatre verdicts de la promotion Boussole v2 sont des passes d'agent — `docs/reviews/boussole-scoring-v2/PROMOTION-VERDICT.md` porte `reviewerAgentId=pi-boussole-promotion-integrator-gpt54`, `provider=openai`, `model=gpt-5.4` — et l'intervention humaine se réduit à un jalon propriétaire `continue`. Rien de cela ne satisfait `actorKind: "human"` avec capacité professionnelle et attestation de consentement à publication.

L'état est donc le suivant : les contrats verrouillés définissent une porte, et le portefeuille ne possède pas la clé. En l'état, aucune mise en service publique de Boussole n'est atteignable, non pas par manque d'implémentation mais par absence de mode d'emploi de la revue.

La spécification candidate examinée apporte exactement ce mode d'emploi, sous une forme complète et transposable, et sans collision avec un quelconque lock.

## Question posée

> Le portefeuille adopte-t-il, **au-dessus** de `AGENT-REVIEW-PROTOCOL.md`, un protocole de revue **humaine** gaté par hash comme unique voie d'obtention des approbations que `boussole-method.v2` et `public-vote-dataset.v2` exigent déjà ? Et si oui, ce protocole exige-t-il l'indépendance vis-à-vis des implémenteurs et interdit-il l'approbation conditionnelle, alors que le protocole d'agents admet l'un et l'autre ?

## Le protocole évalué

Décrit ici avec assez de précision pour être jugé sur pièces. Quatre artefacts et deux dossiers.

### A. Manifeste de bundle

Fichier versionné listant de façon **exhaustive** les artefacts couverts avec leur SHA-256 individuel, plus un `bundleDigest` accompagné de sa **définition de projection dans le fichier lui-même** : champs projetés, ordre des artefacts (chemin ASCII croissant), canonicalisation (RFC 8785 JCS, UTF-8), préfixe de domaine, format de hash. Le relecteur recalcule le digest sans documentation externe.

Point structurant : le manifeste couvre **les dossiers de revue eux-mêmes**. Le protocole appliqué fait partie de ce qui est approuvé ; une retouche du protocole invalide l'approbation. C'est plus large que le `subjectDigest` des contrats v2, qui ne couvre que l'objet méthode ou dataset.

### B. Fichier d'état de gate, machine-lisible

Document versionné portant : `gateStatus`, `scorerImplementationAuthorized`, `publicScoringEnabled`, `requiredApprovalTypes[]`, `receivedApprovals[]`, `independenceRules{}` (nombre minimal de relecteurs distincts, distinction cryptographique, indépendance vis-à-vis des auteurs **et** des implémenteurs, obligation de déclarer les conflits), `hashBindingRules{}`, `blockingReasons[]` et une assertion de non-activation interdisant au chantier de spécification de basculer lui-même le booléen d'activation.

Le monorepo n'a pas d'équivalent : l'état de gate vit aujourd'hui dans le `status` de `contracts/catalog.v1.json` et dans un commentaire d'issue cité par hash de corps.

### C. Schéma de sortie d'approbation

La sortie du relecteur est un **document validable**, non de la prose : type de revue, décision, digest de bundle, référence du relecteur, indépendance affirmée, conflits déclarés, réserves, date, URI d'évidence.

**Contrainte d'insertion à respecter :** ce document ne peut pas se substituer à l'objet `reviewApproval` des contrats verrouillés, qui impose un `reviewerId` opaque et une attestation externe liée par hash, et qui est `additionalProperties: false`. Le protocole doit donc produire _deux_ choses : le document de revue, riche, versionné dans `docs/reviews/` et couvert par le manifeste ; et l'entrée `reviewApproval` conforme au schéma v2, dont l'attestation pointe vers ce document. L'identité reste hors du contrat, comme le lock l'exige.

### D. Un dossier par rôle

Structure identique pour le rôle méthodologique et le rôle juridique/vie privée :

1. **Mandat et indépendance** — compétence exigée, et de qui le relecteur doit être distinct : auteurs, futurs implémenteurs, autre relecteur.
2. **Question de décision unique** — une seule question, en une phrase, à laquelle le verdict répond. Côté méthodologique : la formule, ses omissions et ses sérialisations décrivent-elles de façon exacte, reproductible et non trompeuse un accord borné par énoncé, sans transformer abstention, absence, neutralité ou intensité en affirmations non justifiées ? Côté juridique : les contrats et l'architecture locale minimisent-ils effectivement le traitement d'opinions politiques, interdisent-ils toute communication au responsable, et prévoient-ils les bases, informations, mesures et preuves exigées en droit France-UE avant tout déploiement ?
3. **Artefacts à examiner, avec ordre imposé** — vérifier tous les hashes du manifeste **avant** lecture.
4. **Recalcul indépendant obligatoire** — le relecteur ne reprend pas les sorties attendues comme oracle. Suit une liste de valeurs **nommées à l'avance** qu'il doit retrouver par ses propres moyens, outil indépendant cité dans l'évidence : les deux bornes ±1, un rationnel simple à six décimales, les vecteurs de départage d'arrondi, l'égalité des digests entre une fixture et sa version réordonnée, et la distinction effective des motifs d'omission. Cette exigence est celle qui rend ADR-0013 et ADR-0014 opérants ou inopérants : un invariant qui n'existe que dans le moteur du projet n'est pas recalculable indépendamment.
5. **Axes à trancher séparément** — obligation de décisions distinctes là où une approbation globale masquerait un choix ; une approbation générale qui ne tranche pas ces axes est incomplète.
6. **Checklist d'invariants** en cases à cocher.
7. **Critères bloquants** — liste **fermée** de cas qui imposent le refus.
8. **Contenu minimal de l'évidence** — ce que l'URI d'évidence doit contenir pour que l'approbation compte : identité et compétence, indépendance et conflits, digest exact, hashes vérifiés, méthode de recalcul, résultat de chaque checklist, décisions séparées, réserves, trace durable datée.
9. **Modèle de menaces propre au rôle** — côté vie privée : lecture du stockage local par script injecté, service worker compromis, appareil partagé, réidentification par dictionnaire de digests, exfiltration par paramètres d'URL, journaux ou télémétrie, corrélation par adresse et cadence, import forgé, catalogue substitué.

### Les cinq règles de fonctionnement

1. **Cumul strict** — deux approbations, deux rôles, deux personnes distinctes. Aucune auto-approbation, aucune personne satisfaisant les deux gates.
2. **Fragilité par le hash** — la modification d'un seul octet d'un artefact couvert change son hash, rend le bundle obsolète et invalide les deux approbations.
3. **Pas de conditionnel** — une approbation sous condition n'ouvre pas la porte ; une correction crée un nouveau bundle à réapprouver.
4. **L'approbation n'active rien** — les deux gates franchis, l'activation reste `false` jusqu'à une décision de publication distincte, portant sur le build lié par hash.
5. **Séparation de la preuve présente et de la preuve future** — la preuve de non-transmission distingue ce qui est prouvé aujourd'hui (aucun transport n'existe dans l'arbre, garde-fou `tools/quality/check-no-transmission.ts`, monde WIT sans import) de ce qui reste dû (canari navigateur et capture réseau sur un build de release), avec un énoncé de non-interférence portant sur corps, en-têtes, méthode, chemin, paramètres, journaux **et cadence**.

## Options

### Option A — adoption intégrale

Le protocole ci-dessus devient la voie unique d'obtention des approbations exigées par les contrats v2, pour Boussole et pour tout objet ultérieur exigeant `actorKind: "human"`.

- **Coût contractuel :** nul. Documentation et évidence de forge, conformes à l'invariant I-20 (l'évidence de forge est publiée par défaut).
- **Ce qu'elle apporte :** la porte prescrite par les contrats devient franchissable ; l'état de gate devient machine-lisible ; le protocole appliqué devient lui-même couvert par le hash.
- **Ce qu'elle impose :** les règles 1 et 3 contredisent frontalement `AGENT-REVIEW-PROTOCOL.md` (voir sous-questions Q2 et Q3 ci-dessous) ; la contradiction doit être arbitrée, pas laissée implicite.

### Option B — adoption partielle : artefacts sans les règles de doctrine

Adopter A, B, C, D (manifeste, état de gate, schéma de sortie, dossiers) mais laisser au régime existant les questions d'indépendance et de conditionnalité.

- **Coût contractuel :** nul.
- **Ce qu'elle laisse ouvert :** le protocole devient une forme sans invariant d'indépendance. Un relecteur pourrait être l'implémenteur, et une approbation assortie de réserves pourrait ouvrir la porte — ce qui vide la porte d'une partie de sa fonction sur l'axe sécurité.

### Option C — statu quo

Aucun protocole humain écrit. Les approbations restent prescrites par contrat et impossibles à produire de manière définie.

- **Coût contractuel :** nul.
- **Conséquence :** la mise en service publique de Boussole reste inatteignable, et toute approbation produite ultérieurement le sera sans critère opposable — c'est-à-dire sans possibilité de démontrer, après coup, que la porte a été franchie correctement.

## Sous-questions à trancher en même temps

- **Q1 — périmètre.** Le protocole est-il propre à Boussole, ou est-il le régime général de toute approbation `actorKind: "human"` du portefeuille ?
- **Q2 — indépendance vis-à-vis des implémenteurs.** Le protocole humain l'exige ; `AGENT-REVIEW-PROTOCOL.md` pose l'inverse pour les agents. Les deux régimes coexistent-ils explicitement — revue d'ingénierie d'un côté, approbation de mise en service publique de l'autre — ou l'un gouverne-t-il l'autre ?
- **Q3 — approbation conditionnelle.** Le protocole humain interdit tout verdict conditionnel. La promotion Boussole v2 a employé `approve-with-minor-reservations` sur deux de ses quatre rôles. La porte humaine admet-elle un troisième verdict, ou se limite-t-elle à approuver/refuser ?
- **Q4 — conflits et réserves.** `$defs.reviewApproval` n'a ni champ de conflit d'intérêts ni champ de réserve, et le schéma est `additionalProperties: false` avec liaison par digest. Ces éléments vivent-ils dans le dossier couvert par le manifeste — **coût contractuel nul** — ou dans l'objet approuvé, ce qui exigerait une **nouvelle majeure** et la ré-attestation de tous les objets existants ?
- **Q5 — portée de la liaison par hash.** Le manifeste couvre contrats, fixtures et dossiers de revue ; le `subjectDigest` des contrats ne couvre que l'objet. Les deux portées coexistent-elles, la seconde restant la seule opposable au runtime ?

## Ce que cet ADR ne tranche pas

Aucune option n'est retenue, aucune sous-question n'est arbitrée. Aucun contrat n'est amendé, aucun protocole n'est mis en vigueur, aucun état de gate n'est créé par le présent document. Le protocole décrit ci-dessus est présenté pour évaluation, non comme un acquis : sa description ici ne vaut pas adoption.
