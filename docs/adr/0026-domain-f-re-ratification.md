# ADR-0026 — Re-ratification du domaine F (Outillage agent)

- **Statut :** accepted — la ratification est le merge propriétaire de cette
  pull request.
- **Arbitrage :** propriétaire le 2026-08-18, par questions structurées
  (ADR-0022/I-24) — remise à plat de l'écosystème libre-ai, domaine F
  (Outillage agent).
- **Date :** 2026-08-18
- **Portée :** re-ratification de ADR-0004a (`docs/adr/0004-agent-orchestration-option-b-specification-lock.md`,
  à distinguer de `0004-licensing-governance.md`, collision héritée — voir
  `docs/decisions/INVARIANTS.md` I-11), ADR-0011 D3 et ADR-0018 D2/D4/D5 ;
  création du repository `libre-ai/harness` (chantier A) ; correction
  LEXICON §8.4/§9.3 (§10) ; état des chantiers concurrents du même domaine.
- **Étend :** ADR-0004a, ADR-0011 (D3), ADR-0018 (D2, D4, D5).
- **Ne supersède rien :** re-ratification à l'identique de cinq décisions
  citées, création d'un repository, une correction de carte de noms vers
  l'honnête (LEXICON §10).

Owner-arbitration: 2026-08-18

## 1. Contexte

Le protocole ADR-0022 (I-24) régit la forme des points de décision
propriétaire ; le présent ADR en est une application au domaine F
(Outillage agent) de la remise à plat de l'écosystème libre-ai — sur le
même patron qu'ADR-0023 (domaine A) et ADR-0024 (domaine B).

`docs/decisions/LEXICON.md` §8.4 posait, depuis l'activation générale du
2026-07-28, que `harness` était un nom réservé, re-scopé comme contenu
roadmap du repository `orchestrator` (`docs/apps/harness.md`,
ADR-0018/WP-G3-H01) — « aucun repo créé pour lui ». La recommandation
d'ingénierie par défaut (attendre une première contrainte concrète avant
d'ouvrir un repository dédié) est renversée ici par une décision
propriétaire explicite et nominative : le repository est créé aujourd'hui,
avant qu'une telle contrainte ne se soit présentée.

## 2. Décisions

### 2.1 ADR-0004a, ADR-0011 D3 et ADR-0018 D2/D4/D5 re-ratifiés tels quels

Re-ratifiés **sans modification**, conformes au patron d'ADR-0023 §2.1 et
d'ADR-0024 §2.1 (re-ratifier sans réécrire quand rien ne change dans le
texte de la décision) :

- **ADR-0004a** — verrouille quatorze entrées catalogue de l'orchestration
  agentique option B (dont `harness-profile-v1`, `harness-attestation-v1`),
  pose Missions comme unique autorité d'autorisation, Pi comme worker RPC
  remplaçable, et n'autorise après promotion qu'un cœur de contrôle
  simulation-only (`WP-G2-A01`) — aucune crate harness, aucun chemin
  `apps/`, aucune capacité créés par cette promotion.
- **ADR-0011 D3** — le Specification Lock orchestrateur reste un arrêt dur
  **permanent**, jamais prononcé en run autonome, à chaque occurrence.
- **ADR-0018 D2** — la première capacité réelle ouverte pour le harness
  reste l'exécution d'un processus local, sans réseau ni secret ; tout le
  reste (réseau sortant, secrets, providers, persistance de mission réelle,
  données de tenant) reste fermé jusqu'à son propre package et sa propre
  revue.
- **ADR-0018 D4** — le worker reste Pi d'abord ; la remplaçabilité prouvée
  par un second worker reste un critère de **sortie** de la vague 3, pas du
  premier work package.
- **ADR-0018 D5** — le plan de work-packages reçoit les entrées de la
  couche 2 sans cardinal figé ; les invariants que la gate vérifie déjà
  (identifiants uniques, chemins d'écriture exclusifs, absence de cycle,
  gate humaine sur tout package à risque élevé ou critique) restent
  l'unique garantie.

Aucune de ces cinq décisions n'appelait de correction de fond :
`docs/decisions/INVARIANTS.md` n'est donc pas modifié par le présent ADR.

### 2.2 `libre-ai/harness` créé (chantier A)

Repository public créé le 2026-08-18, né vert : crate Rust
`libre-ai-harness` minimale mais réelle (`HarnessRefusal`, le type de
frontière fail-closed, trois codes stables `harness.refuse.*`, tests unitaires
et d'intégration, `#![forbid(unsafe_code)]`, zéro dépendance) ;
`verification/agent-harness/check-capabilities.ts` (adapté de
`orchestrator/verification/agent-orchestrator/`, zéro effet système tant
qu'aucun work package ne l'ouvre) ; `docs/apps/harness.md` migré
**contenu inchangé** depuis `orchestrator/docs/apps/harness.md` (ADR-0018
D3, Specification Lock), seul le chemin de crate corrigé vers la réalité
de ce nouveau repository ; `AGENTS.md`/`CLAUDE.md` conformes au gabarit
couche-2 (`docs/method/CONTEXT-TEMPLATE.md`) ; `project.v1.yaml`
(`kind: satellite`, `layer: couche-2`, `maturity: specified`,
`exposure: spec-published`, trois phases pending mirant les trois work
packages de la spécification) ; workflows CI épinglés à la génération
fleet-pins `9cd1d421d318129db99456d963f4bc1cfad67b33` (licensing et
context-hygiene réutilisables, rust-quality local, dependency-policy
réutilisable — première consommation de `reusable-dependency-policy.yml`,
déclarée pour l'occasion par `governance#43`, publiée mais non déclarée
depuis `e1232c1`). REUSE.toml conforme à `LICENSING.md`
(EUPL-1.2 premier-parti, CC-BY-4.0 pour `*.md`/`docs/**`) ; `reuse lint`
propre. Enregistré dans `ecosystem/repositories.v1.yaml` (satellite,
couche 2, public, actif) — la création avait fait échouer la gate requise
« Index freshness and GitHub reconciliation » sur chaque pull request
`governance` ouverte tant que ce repository restait absent de
l'inventaire ; corrigé dans le même chantier, `check-inventory-drift.ts`,
`check-fleet-pins.ts` et `check-fleet-presentation.ts` re-vérifiés verts
contre l'organisation réelle.

`cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D
warnings` et `cargo test --locked --all-features` verts ; `bun run check`
vert (capacités, secret-scan, personal-data, specification-lock, lint,
typecheck) ; CI verte sur `main`
(`https://github.com/libre-ai/harness/actions`).

### 2.3 LEXICON §8.4/§9.3 corrigés

`docs/decisions/LEXICON.md` §10 (même pull request) corrige le §8.4 pour
`harness` seul — `memory` reste re-scopé comme roadmap du repo
`orchestrator`, cette décision ne le touche pas — et renvoie depuis le
§9.3 plutôt que de dupliquer l'autorité du fait entre deux paragraphes.

### 2.4 La mention WP-G3-H01 pendante est résolue, sans préempter `orchestrator#13`

Le §8.4 citait « ADR-0018/WP-G3-H01 » comme le contenu du re-scope
roadmap. Cette mention est résolue par la création du présent repository :
elle ne désigne plus un contenu roadmap sans repository, elle désigne la
spécification de `libre-ai/harness`. Ceci ne préempte **pas** la pull
request `orchestrator#13` (`feat/wp-g3-h01-confined-execution`,
`crates/agent-harness`, implémentation réelle de confinement et
d'attestation, 54 tests, arrêt dur d'amorçage réservé au propriétaire
ADR-0011 D4) : elle reste ouverte, non fusionnée, hors du périmètre du
présent chantier. `orchestrator#13` ne touche ni `docs/apps/harness.md`
ni la ligne `check:specifications` de son `package.json` — son seul point
de recoupement avec le retrait pratiqué ici (§2.2, chantier orchestrator)
est la ligne adjacente `check:capabilities` du même fichier, un rebase
mécanique à une ligne, jamais un conflit de contenu. La réconciliation
entre le contenu de cette pull request et ce repository — migration,
statu quo, ou autre — reste un acte propriétaire distinct, non tranché
ici.

### 2.5 État des chantiers concurrents du même domaine (notés, non tranchés ici)

Quatre autres chantiers du domaine F relevés par la remise à plat du
2026-08-18 progressent en parallèle du présent chantier A ; le présent
ADR les note pour que le lecteur du domaine F ait une vue complète, il ne
les décide pas :

- `memory.md` — rétabli à l'état `DRAFT` ; sa promotion relève d'un ADR
  futur, propre à ce chantier.
- K1–K5 (noyau de sécurité des boucles) — unification en une table unique
  et un gate de dérive dédié, propre à ce chantier.
- Fan-out de revue — résolution de son protocole via un git-dep
  `governance` épinglé plutôt qu'une convention ad hoc, propre à ce
  chantier.
- `compat-policy` — mécanisation du critère de rupture (aujourd'hui
  déclaré en prose dans plusieurs fiches `project.v1.yaml`, dont
  `orchestrator`), propre à ce chantier.

Aucun de ces quatre points n'est fixé, implémenté ou vérifié par le
présent ADR.

## 3. Conséquences

- `libre-ai/harness` existe, public, satellite couche 2, né vert,
  enregistré dans l'inventaire de flotte.
- `docs/decisions/LEXICON.md` §8.4 ne décrit plus l'état courant de
  `harness` ; §10 porte la correction et le renvoi.
- Une pull request `orchestrator` retire `docs/apps/harness.md` (remplacé
  par un pointeur d'une ligne) et ajuste `check:specifications` à
  `--apps orchestrator memory` — hors du présent repository, référencée
  ici pour traçabilité.
- `orchestrator#13` reste un acte propriétaire distinct et non préempté
  (§2.4).
- `ecosystem/fleet-pins.v1.yaml` gagne une génération
  (`9cd1d421d318129db99456d963f4bc1cfad67b33`, `governance#43`), première
  déclaration permettant la consommation de
  `reusable-dependency-policy.yml`.
- `docs/decisions/INVARIANTS.md` n'est **pas** modifié : les décisions
  re-ratifiées (§2.1) ne changent pas de texte.

## Ce qui n'est pas décidé ici

- La réconciliation entre `orchestrator#13` et `libre-ai/harness` (§2.4).
- Le contenu des quatre chantiers concurrents notés au §2.5.
- Toute promotion de `libre-ai/harness` au-delà de `maturity: specified` —
  chaque work package (`docs/apps/harness.md` §Work packages) et sa revue
  indépendante restent requis, dont un arrêt dur d'amorçage propriétaire
  pour le premier merge sécurité-critique (WP2, filesystem confinement,
  ADR-0011 D4).
