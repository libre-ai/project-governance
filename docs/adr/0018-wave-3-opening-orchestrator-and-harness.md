# ADR-0018 — Ouverture de la vague 3 : réalisation de l'orchestrateur et du harness

- **Statut :** accepted — la ratification est le merge propriétaire de cette pull request
- **Date :** 2026-07-25
- **Arbitrage :** propriétaire, session du 2026-07-25 (cinq choix de réalisation posés et tranchés après constat que les contrats de la couche 2 étaient déjà verrouillés mais sans spécification produit ni work-package).
- **Portée :** réalisation — langage et emplacement, première capacité ouverte, foyer de spécification, worker, et découpage en work-packages de la couche 2.
- **Étend :** ADR-0004 (Specification Lock de l'orchestration agentique, 14 entrées catalogue verrouillées), ADR-0011 (décisions d'exécution des vagues), `docs/specifications/LOOP-SECURITY-KERNEL.md` (noyau K1-K5).
- **N'amende aucun contrat verrouillé.**

## Contexte

Le Specification Lock orchestrateur a été prononcé le 2026-07-20, et les cinq contrôles du noyau de sécurité des boucles sont `in service` — K1 compris, dont les faits d'identité d'agent sont intégrés à l'autorité Biscuit avec révocation par agent fail-closed. La gate d'entrée de la vague 3 est donc satisfaite.

L'ouverture butait néanmoins sur un vide de réalisation, pas de conception. ADR-0004 a verrouillé quatorze entrées catalogue et réparti quatre autorités séparées — Missions, Agent Orchestrator, Agent Harness, Proof/Artifact — en posant que Missions reste l'unique autorité d'autorisation et que l'orchestrateur ne peut pas s'auto-autoriser. Les contrats existent et portent des vecteurs. Mais aucune spécification produit n'existe pour l'orchestrateur ni pour le harness, et le plan de work-packages, verrouillé à vingt-sept entrées, n'en contient aucune pour la couche 2.

Cet ADR ne redéfinit donc pas ce que ces surfaces sont : il tranche comment elles sont réalisées.

## Décisions

### D1 — Rust pour l'orchestrateur et pour le harness

Les deux surfaces sont écrites en Rust. Pour le harness, c'est une nécessité et non une préférence : `harness-profile.v1` prescrit la canonicalisation des chemins, une politique de liens symboliques, des ensembles `readOnly`/`writable`/`denied` et une attestation liant les capacités noyau — des contrôles qu'un runtime TypeScript ne peut pas garantir. Pour l'orchestrateur, le cœur de contrôle existe déjà en Rust, accepté et testé en simulation ; le réécrire créerait la seconde implémentation d'un même domaine que `vision.md` §4.6 interdit.

Conforme à I-06, qui réserve Rust à l'orchestration d'agents et à l'application de politiques.

### D2 — Première capacité ouverte : processus local, sans réseau ni secret

L'existant est borné par ADR-0004 §8 à un cœur simulation-only contre un faux harness. La première capacité réelle ouverte est **l'exécution d'un processus local**, confinée par le harness sur le système de fichiers et les sorties, produisant sa première attestation signée. Restent fermés à ce stade : réseau sortant, secrets, providers, persistance de mission réelle et données de tenant.

Motif : c'est la seule capacité attestable sans dépendre d'un fournisseur ni ouvrir d'egress. Elle éprouve le confinement — la propriété dont tout le reste dépend — avant d'ajouter une surface.

**Ce premier merge est le premier merge sécurité-critique de la couche 2 : c'est un arrêt dur d'amorçage** au sens d'ADR-0011 D4. Le dossier de revue indépendante est produit, puis l'agent s'arrête pour prononcé propriétaire. Les répétitions du même patron se prononcent ensuite automatiquement sur dossier propre.

### D3 — Foyer de spécification : `docs/apps/`, sous Specification Lock

`docs/apps/orchestrator.md` et `docs/apps/harness.md` sont rédigés au standard G1 et ajoutés à la liste vérifiée par `tools/quality/check-specification-lock.ts`.

Précédent direct : `memory` y figure déjà alors que ses acteurs sont des agents et non des humains. Créer une seconde autorité de spécification produit ailleurs coûterait plus que la légère impropriété du mot « apps ».

Conséquence assumée : treize sections obligatoires, au moins trois codes de refus stables, au moins un chemin `contracts/`, aucun marqueur non résolu. Une spécification qui ne tient pas ce standard fait échouer la gate.

### D4 — Worker : Pi d'abord, la remplaçabilité prouvée en sortie de vague

Pi reste le premier worker, conformément à ADR-0004 §3 qui le pose comme worker RPC remplaçable dont les permissions et types ne constituent jamais une frontière de sécurité. L'outillage de revue de la forge le fait déjà tourner en production interne.

L'exigence d'un **second** worker n'entre pas dans le premier work-package : elle devient un **critère de sortie de la vague 3**. Sans lui, « remplaçable » resterait une affirmation ; l'imposer dès le premier incrément doublerait la surface à attester avant que le confinement ne soit éprouvé.

### D5 — Work-packages de la couche 2, et dégel du cardinal

Le plan `docs/transformation/work-packages.v1.json` reçoit les entrées de la couche 2. La gate `tools/quality/check-work-packages.ts` cesse d'exiger **exactement vingt-sept** packages.

Le cardinal est remplacé par les invariants que la gate vérifie déjà et qui, eux, portent une garantie : identifiants uniques, chemins d'écriture mutuellement exclusifs, cohérence phase/groupe parallèle, absence de cycle, dépendances vers des phases antérieures, gate humaine obligatoire sur tout package à risque élevé ou critique. Un décompte figé n'ajoute rien qu'une revue de pull request ne voie déjà, et transforme chaque ajout légitime en échec rouge.

C'est une mutation de garde-fou, donc l'item 3 de la surface humaine fermée (I-17) : elle relève du prononcé propriétaire, comme cet ADR.

## Conséquences

- Deux spécifications entrent sous Specification Lock ; la gate les vérifie dès ce merge.
- Le premier work-package de réalisation de la couche 2 devient exécutable, avec son arrêt dur d'amorçage.
- Radar (vague 4b) reste derrière la gate de sortie de la vague 3, inchangée : la constellation gérée par la méthode en conditions réelles, métriques de couverture publiées, traceur v2.
- Les réserves d'ADR-0004 §6 — concurrence des stores, RLS, exports need-to-know, rétention, suppression et restauration — restent des critères obligatoires de ces work-packages et de leur revue de conformité.
- Aucune capacité au-delà de D2 n'est autorisée : réseau, secrets, providers, persistance réelle et données de tenant exigent chacun leur package et leur revue.
