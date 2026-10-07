# ADR-0024 — Re-ratification du domaine B (Topologie & flotte)

- **Statut :** accepted — la ratification est le merge propriétaire de cette
  pull request.
- **Arbitrage :** propriétaire le 2026-08-18, par questions structurées
  (ADR-0022/I-24) — remise à plat de l'écosystème libre-ai, domaine B.
- **Date :** 2026-08-18
- **Portée :** topologie et granularité de la flotte — re-ratification de
  I-02, I-03, I-04, I-05, I-12, I-15 ; granularité des satellites de code
  partagé (statu quo structurel) ; retrait d'un repo de recherche local sur
  le durcissement de harness agent, ses éléments réutilisables versés aux
  domaines skills et outillage agent ; exemption `.github` de fiche projet.
- **Étend :** ADR-0020 (I-02 à I-05, I-12, I-15), ADR-0008 (I-04, amendement
  des noms de repository).
- **Ne supersède rien :** re-ratification à l'identique des six invariants
  cités, un retrait de repository local consigné au registre, une correction
  de quatre fiches d'état vers l'honnête.

## 1. Contexte

Le protocole ADR-0022 (I-24) régit la forme des points de décision
propriétaire ; le présent ADR en est une application au domaine B (Topologie
& flotte) de la remise à plat de l'écosystème libre-ai. Deux constats l'ont
déclenché.

Premièrement, quatre fiches `project.v1.yaml` (`provenance`, `knowledge`,
`classification`, `collab-relay`) déclaraient leur critère de sortie
`consumed-pinned` à `status: accepted`, avec une preuve générique
(« gate-acceptance-log 2026-07-29 (ligne 3.4), PRs hub #279-#283 »). Un grep
sur les 34 repositories de la flotte n'a trouvé aucun consommateur réel de
ces briques épinglées : l'acceptation était fausse. La correction factuelle
de ces quatre fiches (chantier 1, §2.2 ci-dessous) a soulevé la question de
fond que le présent ADR tranche : la granularité de ces satellites est-elle
la bonne, ou l'écart révèle-t-il qu'ils devraient être fusionnés ou
restructurés ?

Deuxièmement, une recherche locale de durcissement de harness agent
(classification de risque des commandes, évaluation de sandbox, fixtures
anti-injection), jamais publiée sur GitHub et donc hors du périmètre
`libre-ai`, est arrivée à son terme. Sa clôture et le sort de son contenu
sont un acte propriétaire (préservation avant retrait) que ce domaine
consigne et dont il verse les éléments réutilisables à la doctrine.

## 2. Décisions

### 2.1 I-02, I-03, I-04, I-05, I-12, I-15 re-ratifiés tels quels

Les six invariants de topologie sourcés à ADR-0020 (et, pour I-04, amendés
par ADR-0008) sont re-ratifiés **sans modification** :

- **I-02** — topologie multi-repository comme état courant (activation
  générale) : deux autorités, repos produits réels, satellites de code
  partagé, `website`, `db-inspect`, `.github` ; le hub `libre-ai/libre-ai`
  en démantèlement puis archive + index de migration.
- **I-03** — deux autorités séparées (`governance` et `contracts`), la règle
  « un sujet = une autorité unique » portée par la carte d'autorité.
- **I-04** — noms de repository conformes à l'architecture (amendement
  propriétaire 2026-07-23 d'ADR-0008) ; noms d'outillage hérités jamais
  réutilisés, `website` excepté par la régularisation nominative d'ADR-0020
  §2.4.
- **I-05** — la « projection » est l'artefact généré, jamais le repository
  qui l'héberge ; `website` est une application qui sert des projections.
- **I-12** — GitHub est la forge canonique ; exports git et artefacts
  empêchent toute dépendance de données irréversible.
- **I-15** — loi d'exposition : vitrine publique d'un produit dès, et
  seulement dès, quelque chose de vérifiable, portée par la fiche
  `project.v1.yaml` de chaque projet.

Aucun de ces six invariants n'appelait de correction de fond : l'écart
constaté (§2.2) était dans l'exécution des fiches d'état, pas dans la
doctrine qu'elles doivent porter. `docs/decisions/INVARIANTS.md` n'est donc
pas modifié par le présent ADR — conforme au patron d'ADR-0023 §2.1, qui
re-ratifie sans réécrire quand rien ne change dans le texte de l'invariant.

### 2.2 Granularité de la flotte : statu quo structurel, correction par les fiches

Neuf satellites de code partagé de la flotte comptent chacun moins de cinq
fichiers de code examinés (hors tests) : ce sont des briques complètes et
testées en attente de consommateurs, pas des coquilles vides. Explicité,
ce constat n'appelle **aucune fusion** — la granularité fine sert la règle
« une brique, un repository, un `bun.lock` » (I-03) et permet à chaque
consommateur de n'épingler que ce dont il a besoin. La correction du réel
écart constaté (§1) n'est pas architecturale, elle est factuelle : quatre
fiches déclaraient un usage qui n'existait pas. Corrigées (chantier 1,
2026-08-18, chacune un critère `consumed-pinned` repassé `pending`, la
preuve stale retirée, `current_situation` et `freshness.last_verified_on`
mis à jour, section README régénérée) :

- `libre-ai/provenance#5` — `dc115ec9afa67c5cfc1fcf9d40744a77469e3818`
- `libre-ai/knowledge#3` — `6e0beef0502571c9153fad86cee434ab27b5b523`
- `libre-ai/classification#3` — `278fae239ff2f100bde290ecf5a6fd49264ef7b7`
- `libre-ai/collab-relay#4` — `0ccaa9bca381951d8c6856aa7672ab334288a37b`

Une cinquième fiche de statut, sans rapport avec `consumed-pinned`, portait
un écart de forme différent : `libre-ai/website` affichait un bandeau
README « Reserved · future home » alors que sa fiche déclare `maturity:
specified`, CI verte et un publieur statique fonctionnel (phase
first-projection acceptée), activation régularisée nominativement par
ADR-0020 §2.4 depuis le 2026-07-28. Corrigé par `libre-ai/website#12`
(`1a60d8ff9acfffc818efc8126fca8ddfe6702448`) — le bandeau, la section Status
et la section Where-the-work-happens alignés sur l'état réel, la section
générée entre sentinelles inchangée.

### 2.3 Repo de recherche local retiré, éléments réutilisables versés à la doctrine

Une recherche locale de durcissement de harness agent, jamais publiée sur
GitHub, ferme : recherche close le 2026-08-18. Son contenu est préservé
avant retrait, la preuve produite avant l'assertion — un `git bundle --all`
vérifié (`git bundle verify`), un clone réel depuis ce bundle avec `git
fsck --full` propre et un compte de fichiers suivis concordant (90
fichiers), et une archive séparée pour le seul worktree de branche non
commité trouvé à la capture — le tout haché dans un manifeste SHA256SUMS
détenu par le propriétaire, hors de ce repository. L'entrée de retrait est
consignée dans `ecosystem/LEGACY-MANIFEST.yaml`
(`legacy.local-agent-harness-hardening`,
`libre-ai/governance#40` — `c384d42949ad635132ae3e0810be30c3a5582277`) ; ce
repository n'a jamais eu de présence GitHub, donc les champs `remote` et
`freeze_status` (un cycle d'archivage/retrait GitHub) n'y figurent pas —
omis plutôt que remplis d'une valeur qui déformerait ce qui s'est passé.

Sept éléments réutilisables, identifiés avant le retrait, sont versés comme
**intrants** aux domaines skills et outillage agent de la remise à plat
(travail d'intégration différé, propre à ces domaines — le présent ADR
n'en fixe aucune valeur, il en acte le principe et la provenance, sur le
même patron qu'ADR-0023 §2.3 pour le produit zéro) :

1. une taxonomie de risque de commande à quatre paliers (R0 lecture seule,
   R1 mutation locale, R2 mutation distante confirmée, R3 mutation distante
   dangereuse) ;
2. un registre de capacités fail-closed avec expiration (TTL) — une
   capacité non déclarée ou expirée retombe au palier de risque le plus
   restrictif, jamais au plus permissif ;
3. un skill de vérification d'environnement d'exécution avant délégation
   d'une tâche agent (`verify-runtime`) ;
4. une fixture de contenu non fiable pour les tests anti-injection
   (instruction impérative encodée dans un document externe, avec le
   résultat attendu : traiter le texte comme donnée, jamais comme
   commande) ;
5. un corpus de commandes bénignes (R0) servant de jeu de non-régression au
   classifieur de risque ;
6. une checklist de huit exigences non négociables pour tout backend de
   sandbox (échec fermé, réseau refusé par défaut, home et credentials
   illisibles, écriture bornée à une copie jetable, pas de flag de
   désactivation en mode restrictif, attestation consommable, nettoyage en
   fin d'exécution, aucun log de commande/prompt/chemin/contenu en clair) ;
7. une méthode de revue où chaque verdict porte la preuve qui l'a produit,
   plutôt qu'une classification affirmée sans trace vérifiable.

### 2.4 Exemption `.github` re-ratifiée

L'entrée `libre-ai/.github` d'`ecosystem/repositories.v1.yaml` porte
`role: org-profile` et aucun champ `card` — la seule entrée de la flotte
dans ce cas. `ecosystem/check-fleet-presentation.ts` la nomme explicitement
dans son code, pas seulement dans un commentaire : une entrée sans `card`
retourne `{ failures: [], skipped: true }` et le gate l'inspecte en la
signalant (« no card declared — nothing to present ») au lieu de l'ignorer
silencieusement — le mécanisme qu'ADR-0020 §2.4 documente déjà en prose pour
`website` (« Entries without a `card` field … are reported and skipped,
never silently ignored »), appliqué ici à l'org-profile. Cette exemption est
re-ratifiée sans modification : un profil d'organisation GitHub n'est pas un
projet et n'a pas de fiche d'état à porter.

## 3. Conséquences

- Quatre fiches `project.v1.yaml` et un README (§2.2) sont corrigés par les
  cinq pull requests citées, mergées avant la présente.
- `ecosystem/LEGACY-MANIFEST.yaml` gagne l'entrée
  `legacy.local-agent-harness-hardening` par la pull request `#40`, mergée
  avant la présente.
- `docs/decisions/INVARIANTS.md` n'est **pas** modifié : les six invariants
  re-ratifiés (§2.1) ne changent pas de texte.
- L'intégration effective des sept éléments réutilisables (§2.3) dans les
  domaines skills et outillage agent reste à faire : de futures pull
  requests dédiées, propres à ces domaines, en fixeront le contenu et la
  forme. Le présent ADR en est la source de provenance, pas
  l'implémentation.
- Aucune fusion de repository n'est engagée par le présent ADR (§2.2) :
  la granularité actuelle de la flotte est confirmée, pas rouverte.

## Ce qui n'est pas décidé ici

- La forme exacte que prendront les sept éléments versés (§2.3) dans les
  domaines skills et outillage agent — nom de skill, emplacement, format —
  n'est pas fixée : décision propre à ces domaines.
- Aucun repository supplémentaire n'est examiné pour fusion ou scission au-
  delà du constat du §2.2 ; un futur repository sous-cinq-fichiers n'hérite
  pas automatiquement de cette re-ratification, sa fiche est jugée sur ses
  propres critères.
