# Run γ charter — autonomous loop to finish the flottable

> **SUPERSÉDÉ par ADR-0020 (2026-07-28).** Cette charte a été ratifiée avant
> l'activation générale : la séquence de vagues qu'elle cite en C3
> (« conformément à EXECUTION-SEQUENCING ») et l'écluse #2 (ouverture G4)
> relèvent d'un séquencement désormais supersédé — ADR-0009 §8, ADR-0011 D1 et
> le cadre de vagues d'ADR-0018 étant supersédés. Le jalon γ d'activation
> générale et de démantèlement du hub qu'il anticipait s'est refermé le
> 2026-07-30 (`distribution/evidence/gate-acceptance-log.md`, ligne phase
> 3.8). Le présent document reste **l'histoire** du run autonome γ1→γ2→δ→ε→ζ
> tel que ratifié en session : il n'ordonne plus rien et n'est pas une
> autorité vivante.

**Ratified in session, 2026-07-22.** This charter is the compaction-proof
source of truth for the autonomous run: any session continuing this run reads
it first and treats it as binding. Progress ledger:
`.superpowers/run-gamma/progress.md` (scratch; recovery = this charter +
`git log`).

## Brief (owner-validated)

> **Objectif** : exécuter en loops autonomes les runs γ1→γ2→δ→ε→ζ jusqu'à
> épuisement du flottable — chaque app testée intégralement en local,
> documentée, prête à déployer — en produisant en continu la file de dossiers
> d'écluses pour les prononcés du propriétaire.
> **Invariants** : séquence des vagues stricte (Polaris avant 4b — C3 « oui ») ;
> écluses owner jamais franchies (front gaté = parqué + dossier en file) ; une
> PR à la fois, squash, 5 gates CI + revue K4 indépendante ; plafonds D6
> étendus (§Ceilings) ; aucune publication npm, création de repo, DNS ou
> déploiement par la loop — préparation seulement (C1 : « pas avant mon go »,
> cible semaine du 2026-07-27).
> **Critère de fin** : plus aucun chantier non-gaté restant ; chaque écluse a
> son dossier prêt ; évidence scellée par run.

## Owner arbitrations recorded

- **C1 (deployment)** : rien ne se déploie avant le go owner ; DNS/npm/Clever
  visés sa semaine ; PAS dans cette session. La gate `check-no-clever-production`
  reste inviolée ; l'ouverture de G4 sera un acte owner (entrée ADR).
- **C2 (testing)** : « testé intégralement » = **local uniquement** ; une VM
  locale peut simuler une topologie si nécessaire ; jamais de ressource cloud.
- **C3 (sequence)** : stricte — la vague 4b (moteurs en parallèle) n'ouvre
  qu'avec Polaris opérationnel (vague 3), conformément à EXECUTION-SEQUENCING.
- **D (écluses)** : parquer + file de dossiers ; la loop ne s'arrête jamais
  parce qu'un front est gaté — elle produit le dossier et continue ailleurs.
- **E (ceilings, extension ADR-0011 D6)** : γ1 300k · γ2 1M · δ 2,5M · ε 500k ·
  ζ 3M tokens de sortie ; ≤ 3 cycles CI/revue par PR ; dépassement = STOP +
  dossier, jamais de kill silencieux.
- **G (spec-studio store d'acceptation)** : NON arbitré — parqué en file
  (reco loop : table `spec_packages` content-addressed dédiée). Aucun build
  avant l'arbitrage.
- **H (moteur policy-core)** : sélection owner à l'entrée de ζ.

## Definition of "testé intégralement" (opposable)

Par app : (a) unit + contrats verts ; (b) e2e Playwright 3 moteurs sur toutes
les surfaces LIVRÉES ; (c) 5 gates CI ; (d) dual-K4 sur toute surface
sécurité ; (e) apps serveur : chaîne PGlite/RLS verte depuis checkout propre.
Les surfaces gatées (scoring, contenu, moteurs non sélectionnés) sont
documentées comme absentes — jamais simulées comme présentes.

## Run sequence and scope

- **γ1-prep** (npm-independent parts now; exit gate waits the owner's npm day):
  `starter` satellite built against workspace refs with a documented one-line
  npm flip; evidence/coverage upkeep. Parked until npm day: real-npm
  consumption proof, mirrors.
- **γ2** : envelope premier consommateur dogfooding (promotion candidate→locked
  par conception) ; classification opérationnelle sur les flux forge
  (couche 3 déjà amorcée D4 → répétitions auto sur K4 propre) ;
  provenance/proof productisés jusqu'à la couture cérémonie de clés (⏸).
- **δ (Polaris)** : orchestrator runtime (sur le decision core Accepted) →
  memory → missions app → harness. Tout NOUVEAU pattern sécurité-critique
  (sandbox d'exécution, première exécution réelle d'agent) = ⏸ D4 en file.
- **ε** : dossier d'activation Notebook (3 volets séparables) — document
  produit tôt, prononcé owner à sa main.
- **ζ** : moteurs + produits en parallèle **sous Polaris** ; gates par produit
  (sélection policy-core ⏸H, approbations boussole ⏸, humanGate practices ⏸).

## Écluse queue (initial state)

| #   | Écluse                                                              | Dossier                          | État                 |
| --- | ------------------------------------------------------------------- | -------------------------------- | -------------------- |
| 1   | npm day (publication 4 satellites + miroirs + starter flip)         | WAVE1-PUBLICATION-RUNBOOK.md     | **prêt**             |
| 2   | Ouverture G4 + DNS + Clever (+ inputs : domaines, org, IdP, addons) | à produire en fin de γ2/δ        | à produire           |
| 3   | Cérémonie de clés Ed25519 (provenance/proof/lineage)                | à produire en γ2                 | à produire           |
| 4   | D4 nouveaux patterns couche 2 (sandbox harness, exécution réelle)   | dossiers au fil de δ             | —                    |
| 5   | Activation Notebook volets (a)/(b)/(c)                              | dossier ε                        | à produire           |
| 6   | Arbitrage G — store d'acceptation spec-studio                       | 1 ligne (reco : dédiée)          | **attend arbitrage** |
| 7   | Sélection moteur policy-core (entrée ζ)                             | dossier d'options à produire     | à produire           |
| 8   | Approbations méthodo + légale scoring boussole (ADR-0002)           | dossier de levée à produire en ζ | à produire           |
| 9   | humanGate `activity-content-and-privacy-review` (practices)         | dossier à produire en ζ          | à produire           |

## Loop mechanics

- Un chantier = un pod (implémenteur SDD + dual-K4 indépendants + conformité
  si vecteurs) ; préparation parallèle en branches, merge sériel.
- La loop ne sollicite le propriétaire QUE sur : une écluse atteinte (dossier
  joint), un dépassement de plafond, une contradiction de doctrine détectée.
- À chaque frontière de run : évidence scellée + file d'écluses mise à jour +
  DELTA.
