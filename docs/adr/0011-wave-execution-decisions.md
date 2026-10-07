# ADR-0011 — Décisions d'exécution des vagues (moteur pilote, Polaris, politiques de gate, environnement D01)

- **Statut :** accepted
- **Date :** 2026-07-20
- **Arbitrage :** propriétaire, session du 2026-07-20 (décisions forcées par questionnaire pour armer l'exécution autonome des vagues 1-4).
- **Portée :** exécution — séquencement des vagues, politiques de gate en run autonome, environnement de développement de D01, nom de la couche 2.
- **Étend :** ADR-0009 (constellation, séquencement des vagues) ; `docs/transformation/EXECUTION-SEQUENCING.md`.

## Contexte

Pour lancer l'exécution autonome des vagues 1-4, les gates d'entrée qui dépendent d'un arbitrage propriétaire devaient être tranchées en amont, sans quoi un run autonome se bloque à chaque gate. Ces décisions sont des entrées ; ce ne sont pas des invariants durables (elles portent sur une phase d'exécution), d'où leur enregistrement en ADR d'exécution plutôt qu'au registre des invariants.

## Décisions

### D1 — Premier moteur produit : Notebook (pilote), puis parallèle via Polaris

La vague 4 (apps) s'exécute en deux temps :

- **Vague 4a — Notebook, pilote.** Gate B déjà approuvée, surface PII maîtrisée, contrat Notebook Core v2 verrouillé. Rôle : valider le pattern app de bout en bout (contrat → moteur → app → revue) une fois.
- **Vague 4b — le reste en parallèle, orchestré par Polaris.** Radar, Boussole, Model Policy, Practices, Sessions, Spec Studio construits en parallèle par la couche 2 une fois le pattern validé. Cette phase parallèle est la démonstration du produit zéro (gestion agentique de la flotte).

Motif du pilote plutôt que « tous en parallèle d'emblée » : prouver le pattern une fois avant réplication, borner la charge de revue concurrente, et faire de la phase parallèle le test réel de Polaris.

### D2 — Nom de la couche 2 (étoile polaire) : Polaris

La couche 2 (orchestration gouvernable de la flotte, productîsée) porte le nom **Polaris**. Réserve connue et acceptée : collision de nom élevée (nom répandu dans la tech) — à traiter comme la coexistence de marque déjà documentée (dépôt figuratif, ancrage `.fr`), non re-litigée ici.

### D3 — Gate du Specification Lock orchestrateur (vague 3) : arrêt dur

Le Specification Lock orchestrateur n'est **jamais** prononcé en run autonome. Un agent verrouille le noyau de sécurité des boucles K1-K5 dans le socle, lance sa revue adversariale indépendante (relecteurs distincts de l'implémenteur), produit le dossier de décision (état du noyau, verdict de la revue, périmètre du lock), puis **s'arrête**. Le prononcé du lock est un acte propriétaire nominatif exclusif. Motif du durcissement (2026-07-20) : c'est la gate qui démarre la boucle auto-alimentée officielle — le composant le plus sensible ; le coût d'un franchissement erroné est disproportionné devant le coût d'un arrêt pour prononcé humain. (Supersede la pré-autorisation conditionnelle initialement retenue.)

### D4 — Politique des gates de sécurité en run autonome : confiance graduée (premier merge de couche = arrêt dur, répétitions = auto)

Chaque composant sécurité-critique est relu par des agents adversariaux **distincts de l'implémenteur** (conforme au noyau K4 : l'implémenteur n'approuve pas ses propres garde-fous). Le prononcé du merge suit une **confiance graduée** :

- **Premier merge sécurité-critique d'une couche = arrêt dur.** Le premier franchissement d'un pattern de gate donné — première barrière RLS de la couche données (D01), première revue de sécurité de chaque couche produit — produit son dossier de décision et **s'arrête** pour prononcé propriétaire. Ce premier prononcé amorce la chaîne de confiance : l'humain valide le pattern de revue une fois, sur pièce.
- **Répétitions du même pattern = auto-procéder sur revue verte.** Une fois le pattern d'une couche validé humainement, les merges suivants de même nature (même couche, même type de garde-fou) se prononcent automatiquement si le dossier de revue indépendante est propre.

**Motif :** réconcilier D4 avec le durcissement de D3. Durcir le lock orchestrateur tout en laissant la première barrière d'isolation des données (D01 RLS) auto-merger serait incohérent sur l'axe sécurité #1 (isolation tenant, RGPD). La confiance graduée borne le risque au point d'amorçage — un checkpoint humain par couche — sans imposer un arrêt à chaque itération.

**Distinction avec D3 :** le lock orchestrateur (D3) reste un arrêt dur **permanent** (jamais auto, à chaque occurrence) car il démarre la boucle auto-alimentée officielle ; la confiance graduée (D4) est un arrêt d'amorçage **unique par couche**, puis auto. Dans les deux cas, K4 (indépendance implémenteur/relecteur) est préservé.

### D5 — Environnement de développement de D01 : conteneur Linux local (colima), CI en validation

L'intégration DB de D01 se développe dans un conteneur Linux local (colima, déjà installé) : un bun 1.4 canary linux-arm64 natif régénère le lockfile v2 et exécute les tests RLS (pglite, WASM) en boucle rapide. Le CI (linux-x64, bun figé `1.4.0-canary.1+57f349f63`) reste l'autorité de reproductibilité et valide en fin de cycle. Le format de lockfile v2 dépend de la version de bun, pas de l'architecture : le lock local arm64 et le lock CI x64 sont identiques à version égale.

**Préalable de vérification (colima non éprouvé) :** cette chaîne — bun 1.4 canary arm64 + pglite dans colima — n'a pas encore été exécutée ; elle est une hypothèse d'outillage, pas un fait établi. Avant tout développement d'adapter, un **preflight** l'éprouve sur un test RLS trivial (`SET LOCAL` + deny cross-tenant, deux tenants). En cas d'échec de la chaîne locale, **repli** : piloter le lockfile et les tests d'intégration via le CI (PR ouverte, itération sur le retour CI comme autorité de repro) sans bloquer la couche applicative déjà complète.

### D6 — Plafonds d'autonomie chiffrés (liveness et coût) en run autonome

En run autonome, deux classes de risque exigent des seuils chiffrés, sans quoi un run peut boucler (non-progrès) ou dériver en coût. Un dépassement n'est jamais un échec silencieux : il produit un dossier d'avancement (fait / reste / cause) puis **s'arrête** pour décision propriétaire (relever le seuil ou re-scoper).

**Liveness (non-progrès).** « Progrès mesurable » = au moins un des événements suivants depuis la dernière mesure : une PR mergée satisfaisant un nouveau critère de gate de sortie ; un finding bloquant de revue fermé ; un work-package passé de `pending` à `done`. Seuils :

- **Par PR :** au plus 3 cycles CI/revue pour atteindre le vert. Au 3ᵉ échec → STOP + dossier (règle TDD : « rendre le test vert est difficile » = problème de conception, pas d'itération).
- **Par vague :** 3 PR consécutives sans progrès mesurable → STOP + dossier.
- **Anti-thrash :** un même fichier réédité 5 fois ou plus sans faire avancer une gate → STOP + dossier.

**Coût (tokens de sortie).** Plafonds de sécurité (« stop-and-reassess »), calibrés au-dessus du coût attendu pour n'attraper que la dérive. Seuils :

- **Par PR :** plus de 400 k tokens de sortie sur une seule PR → STOP + dossier (thrashing probable).
- **Par vague (cumul) :** Phase 0 Lexicon Lock 300 k · G2 (D01+Q01) 1,5 M · vague 1 1 M · vague 2 2 M · vague 4a 1 M.
- **Total run α :** 6 M → STOP global + dossier.

Ces valeurs sont des décisions de phase, tunables par ADR ultérieur ; elles bornent le risque sans figer une estimation comme un fait.

## Conséquences

- `docs/transformation/EXECUTION-SEQUENCING.md` est mis à jour : vague 4 scindée en 4a/4b, gates 3 et 4 renseignées, politiques de gate de run autonome inscrites.
- `STATUS.md` reflète les décisions et l'état courant.
- `ecosystem/repositories.v1.yaml` nomme la couche 2 « Polaris ».
- Ces décisions sont des décisions de phase : elles peuvent évoluer par ADR ultérieur sans toucher le registre des invariants.

No invariant (backfill 2026-08-18, Domain I — Process & CI) : conforme au
Contexte de cet ADR, qui le dit déjà — « ce ne sont pas des invariants
durables (elles portent sur une phase d'exécution), d'où leur enregistrement
en ADR d'exécution plutôt qu'au registre des invariants ».
