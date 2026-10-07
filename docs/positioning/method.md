# La méthode — fiche produit

Le produit zéro de Libre AI est **la méthode** : la gestion agentique d'une constellation de logiciels sous gates vérifiables, la touche humaine réduite aux invariants (invariant I-13, [ADR-0009 §1](../adr/0009-constellation-portfolio-and-method.md)). La fabrique est le premier produit ; ce document est sa fiche produit pour un lecteur extérieur. Sa réalisation courante s'appelle [Polaris](../method/POLARIS.md).

Position assumée : rien ici n'est une promesse. Chaque élément de cette fiche est soit **en service** (il tourne aujourd'hui, artefact à l'appui), soit **spécifié-en-attente** (spécifié, verrouillé, pas encore exécuté à l'échelle) — la distinction est affichée, jamais lissée.

## Le cycle

Chaque unité de travail parcourt le même cycle, et chaque étape laisse un artefact public dans ce dépôt :

| Étape                         | Ce qui se passe                                                               | Artefact vérifiable                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Intention**                 | un besoin réel est formulé en question réfutable                              | [`vision.md`](../../vision.md), [`GOALS.md`](../../GOALS.md), hypothèses par produit dans [`ecosystem/repositories.v1.yaml`](../../ecosystem/repositories.v1.yaml) |
| **Connaissance**              | sources, alternatives, risques et inconnues sont structurés                   | [`docs/apps/`](../apps) (cahiers des charges), [`docs/parity/`](../parity) (audits benchmark)                                                                      |
| **Spécification**             | la décision humaine devient contrat exécutable, puis est verrouillée          | [`contracts/`](../../contracts) (catalogue d'autorités), [`docs/specifications/`](../specifications), [`docs/adr/`](../adr)                                        |
| **Exécution par agents**      | des agents implémentent dans des work-packages bornés (chemins, contrats)     | [`AGENTS.md`](../../AGENTS.md), [`prompts/`](../../prompts), gate work-package en CI                                                                               |
| **Vérification indépendante** | relecture par des rôles distincts de l'implémenteur (K4), sur commit immuable | [`docs/reviews/AGENT-REVIEW-PROTOCOL.md`](../reviews/AGENT-REVIEW-PROTOCOL.md), dossiers dans [`docs/reviews/`](../reviews)                                        |
| **Artefact reproductible**    | la chaîne de référence rejoue les fondations depuis un checkout vierge        | [`verification/harness/reference-chain.ts`](../../verification/harness/reference-chain.ts), digest publié                                                          |
| **Évidence publiée**          | verdicts, rapports et métriques sont publics par défaut (I-20)                | [`distribution/evidence/gate-acceptance-log.md`](../../distribution/evidence/gate-acceptance-log.md), rapports datés                                               |

Une synthèse générée ne devient jamais silencieusement une spécification normative : l'arbitrage humain est une étape explicite du cycle ([`vision.md`](../../vision.md) §6).

## La surface à touche humaine, fermée

Tout appartient aux agents sous gates, **sauf cinq points** (invariant I-17, ADR-0009 §5) :

1. le registre des invariants et les ADRs ;
2. les amendements de contrats verrouillés ;
3. les mutations des garde-fous et de la couche 3 ;
4. les activations (dépôt produit, brique vivante, nouvelle boucle) ;
5. les escalades de gates.

Cette liste ne s'étend que par ADR. Le registre lui-même est public : [`docs/decisions/INVARIANTS.md`](../decisions/INVARIANTS.md) — ce qui n'y figure pas n'est pas doctrine.

## Les plafonds d'autonomie, chiffrés

Un run autonome n'est pas une délégation ouverte : il est borné par des seuils chiffrés ([ADR-0011 D6](../adr/0011-wave-execution-decisions.md)). Un dépassement n'est jamais un échec silencieux — il produit un dossier d'avancement (fait / reste / cause) puis **s'arrête** pour décision propriétaire.

**Liveness (non-progrès) :**

- au plus **3 cycles CI/revue** par pull request pour atteindre le vert ; au 3ᵉ échec → STOP + dossier ;
- **3 pull requests consécutives** sans progrès mesurable → STOP + dossier ;
- anti-thrash : un même fichier réédité **5 fois ou plus** sans faire avancer une gate → STOP + dossier.

**Coût (tokens de sortie) :**

- par pull request : plus de **400 k** tokens de sortie → STOP + dossier ;
- par vague (cumul) : phase 0 Lexicon Lock **300 k** · G2 **1,5 M** · vague 1 **1 M** · vague 2 **2 M** · vague 4a **1 M** ;
- total du run α : **6 M** → STOP global + dossier.

Deux politiques de gate complètent ces plafonds ([ADR-0011 D3 et D4](../adr/0011-wave-execution-decisions.md)) :

- **D3 — arrêt dur permanent** : le Specification Lock orchestrateur n'est jamais prononcé en autonome ; c'est un acte propriétaire nominatif exclusif, à chaque occurrence.
- **D4 — confiance graduée** : le premier merge sécurité-critique d'une couche s'arrête pour prononcé propriétaire sur dossier ; les répétitions du même pattern s'auto-prononcent ensuite sur revue indépendante propre.

Le journal des verdicts montre ces politiques en application réelle — amorçages prononcés, auto-merges sur revue propre, et l'arrêt dur de la porte V3 respecté puis prononcé : [`distribution/evidence/gate-acceptance-log.md`](../../distribution/evidence/gate-acceptance-log.md).

## Ce qui tourne aujourd'hui vs ce qui est spécifié

La méthode s'applique sa propre convention IN-SERVICE / SPECIFIED-PENDING ([`docs/method/POLARIS.md`](../method/POLARIS.md)) :

**IN SERVICE aujourd'hui :**

- le noyau de sécurité des boucles K1–K5 — identité d'agent, classification des données, enveloppe d'intégrité, revue indépendante, registre immuable — spécifié ([`docs/specifications/LOOP-SECURITY-KERNEL.md`](../specifications/LOOP-SECURITY-KERNEL.md)), verrouillé, et réalisé au socle (promotions K1 et K3 journalisées les 2026-07-20 et 2026-07-22) ;
- le protocole de revue indépendante (implémenteur ≠ relecteur) et les gates CI (secret-scan, doctrine, work-package, DCO, chaîne de référence) ;
- le registre des invariants et la gouvernance doctrine ;
- le traceur v1 : journal des verdicts + métriques de couverture.

**SPECIFIED-PENDING (en construction, vague 3) :**

- le runtime d'orchestrateur — les boucles elles-mêmes qui opèrent la flotte sous K1–K5 ;
- le runtime de harness — l'intégration identité + mémoire + métriques dans l'exécutable d'orchestration ;
- l'automatisation de merge généralisée sur revue propre.

La mesure qui tranche entre les deux : la couverture d'automatisation réelle est **0 %** aujourd'hui ([`distribution/evidence/coverage-2026-07-22.json`](../../distribution/evidence/coverage-2026-07-22.json)) — le noyau gouverne déjà, la boucle à l'échelle de la constellation s'amorce. C'est le chiffre que la méthode doit faire monter, et il est mesuré depuis l'historique observable des merges ([`distribution/evidence/coverage-metrics.ts`](../../distribution/evidence/coverage-metrics.ts)), pas déclaré.

## Ce qui se transpose ailleurs

La posture est transposable — réduire l'automatisation à l'essentiel gouvernable, publier la preuve immédiatement, laisser le jugement où il réside (humain + invariants). Les prérequis techniques et ce qui reste spécifique à Libre AI sont détaillés dans [`docs/method/POLARIS.md`](../method/POLARIS.md) (« Comment l'adopter sur un autre projet »).
