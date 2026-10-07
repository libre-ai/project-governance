# ADR-0028 — Re-ratification du domaine H (Sécurité & données)

- **Statut :** accepted — la ratification est le merge propriétaire de cette
  pull request.
- **Arbitrage :** propriétaire le 2026-08-18, par questions structurées
  (ADR-0022/I-24) — remise à plat de l'écosystème libre-ai, domaine H
  (Sécurité & données).
- **Date :** 2026-08-18
- **Portée :** re-ratification de I-10, I-23, ADR-0012 (D1-D5), ADR-0021 D1 ;
  amendement de I-09 (état par sous-composant) ; correction datée d'ADR-0012
  D4 ; doctrine anti-injection et runtime d'agent consolidée en document
  dédié ; statut télémétrie-seulement de `TOOL-CALL-RISK-CLASSIFICATION.md`
  maintenu ; déclencheur de la cérémonie de clés nommé ; canal de
  signalement de sécurité déplacé sur `governance`, portée flotte, private
  vulnerability reporting activé ; politique de flotte pour les waivers
  d'advisories.
- **Étend :** I-09, I-10, I-21 (par sa source), I-23 (`INVARIANTS.md`) ;
  ADR-0012 ; ADR-0021 (D1).
- **Ne supersède rien :** re-ratification à l'identique de quatre
  décisions/invariants cités, deux amendements datés et nommés (I-09,
  ADR-0012 D4), quatre livrables doctrinaux nouveaux consignés pour
  traçabilité.

Owner-arbitration: 2026-08-18

## 1. Contexte

Le protocole ADR-0022 (I-24) régit la forme des points de décision
propriétaire ; le présent ADR en est une application au domaine H
(Sécurité & données) de la remise à plat de l'écosystème libre-ai — sur le
même patron qu'ADR-0023 (domaine A), ADR-0024 (domaine B) et ADR-0026
(domaine F).

Le chantier K1-K5 (noyau de sécurité des boucles) est concurrent et hors
périmètre : le présent ADR ne modifie ni `docs/security/LOOP-SECURITY-
KERNEL.md`, ni `docs/method/POLARIS.md`, ni `docs/security/THREAT-MODEL.md`.
Il consomme au contraire l'un des garde-fous que ce chantier a posé le même
jour : `check-kernel-status-authority.ts` a rejeté une première rédaction de
l'amendement I-09 (§2.2) qui restait le jeton `K1` sur une ligne portant
déjà un mot de statut — corrigé en pointant vers la table normative du
noyau plutôt qu'en la dupliquant.

## 2. Décisions

### 2.1 I-10, I-23, ADR-0012 (D1-D5), ADR-0021 D1 re-ratifiés tels quels

Re-ratifiés **sans modification** de leur texte, conformes au patron
d'ADR-0023 §2.1, d'ADR-0024 §2.1 et d'ADR-0026 §2.1 :

- **I-10** — cycle de vie des données : rétention exécutable, suppression
  prouvable, local-first où la spec l'exige.
- **I-23** — oubli du contenu : `ecosystem/FORGOTTEN.yaml` au contenu ce
  qu'`INVARIANTS.md` est à la doctrine ; éviction jamais destruction,
  récupérabilité prouvée par garde-fou.
- **ADR-0012 (D1-D5)** — frontière des données personnelles et régime des
  personnes tierces : les cinq décisions restent en vigueur inchangées. Sa
  D4 porte une correction factuelle datée (§2.3 ci-dessous), pas une
  révision de décision.
- **ADR-0021 D1** — un contrôle de flotte périodique, hébergé par
  `governance`, porte l'état du monde des advisories et notifie sans
  bloquer ; D2 et D3 ne sont pas rouverts.

Aucune de ces quatre re-ratifications n'appelait de correction de fond ;
`docs/decisions/INVARIANTS.md` n'est pas modifié par la présente section
(I-09 l'est, §2.2, pour une raison distincte).

### 2.2 I-09 amendé : état par sous-composant (chantier 2, `governance#66`)

I-09 déclarait un unique état pour l'ensemble « OIDC + session + Biscuit +
tenant/RLS », sans distinguer ce qui est réellement consommé de ce qui est
construit et attend un premier consommateur. `governance#66`
(`56f6685`, mergé) ajoute à `docs/decisions/INVARIANTS.md` un état par
sous-composant calqué sur le vocabulaire normatif de `LOOP-SECURITY-
KERNEL.md` (« in service » y garde son sens exact — réalisé et appliqué
aujourd'hui par une brique ou un gate mergé) complété d'un palier que ce
vocabulaire ne couvre pas, introduit ici : « built, not integrated » (la
brique existe, mergée, zéro consommateur) :

- RLS/tenant — **in service** (3 apps consommatrices) ;
- OIDC/session — **built, not integrated** (0 consommateur) ;
- Biscuit — **built, not integrated** (0 consommateur) ;
- identité agent — statut inchangé, pointé vers la table normative de
  `LOOP-SECURITY-KERNEL.md` plutôt que restaté (§1).

### 2.3 ADR-0012 D4 corrigé (chantier 3, `governance#49`)

D4 affirmait « Notebook est local-only et sans primitive sortante » en
s'appuyant sur `check-no-transmission.ts`, garde-fou que le tableau D1 cite
pour la strate des données personnelles — mais à la ratification
(2026-07-25), aucun repository Notebook n'invoquait ce garde-fou : c'était
une affirmation d'architecture, pas un fait vérifié. `governance#49`
(mergé) ajoute une correction datée : le mécanisme devient vrai le
2026-08-18, `notebook#21` (mergé, §2.4) — `check:no-transmission` câblé,
scopé `apps/notebook/src`, dans le script `check` agrégé. Aucune des cinq
décisions D1-D5 ne change.

### 2.4 Notebook câblé sur `check-no-transmission.ts` (chantier 4, `notebook#21`)

`notebook#21` (mergé) câble `check:no-transmission`, scopé
`apps/notebook/src`. Au passage, le pin git-dep de `@libre-ai/governance`
dans `notebook/package.json` s'est révélé antérieur à la réécriture
`--roots`/`--allow` de l'outil (`governance#21`/`#22`) : l'ancien binaire
pinné ignorait silencieusement ces drapeaux et rejouait son ancien scan
codé en dur `apps/{boussole,practices}` — un faux vert, exactement le mode
de panne que l'outil actuel documente lui-même (un scope par défaut
survivant à un déplacement de topologie). Corrigé dans le même chantier :
pin bumpé vers `governance@33dcc5a`, vérifié par `GATE_VERBOSE=1` (25
fichiers effectivement parcourus). Une occurrence de `fetch(` en ligne 47
de `apps/notebook/src/backup/notebook-core-worker.ts` — chargement
same-origin d'un module WASM co-localisé, chemin fourni par le code généré
par le bindgen WIT, aucune donnée utilisateur, aucune cible cross-origin —
est admise par exception nominative via le mécanisme réel de l'outil
(`--allow`, un chemin nommé, jamais un contournement silencieux) et
documentée par un commentaire d'en-tête sur le site d'appel.

### 2.5 Doctrine anti-injection et runtime d'agent consolidée (chantier 1, `governance#48`)

`governance#48` (mergé) ajoute `docs/security/AGENT-RUNTIME-DOCTRINE.md` :
la frontière des données non fiables (tout ce qu'un agent lit, y compris le
contexte hérité d'un handoff ou d'une compaction, est une donnée à citer,
jamais une instruction à exécuter), l'invariant « visible du modèle ⟺
journalisé », les huit exigences de sandbox fail-closed consolidées depuis
`SANDBOX-BACKEND-EVALUATION.md` (plus Landlock noté comme candidat Linux
non évalué, épinglé sur commit avant toute promotion), et « vérifier le
monde, pas l'auto-rapport ». Renvois seulement, sans réécriture, vers
`THREAT-MODEL.md` §1-2 et `TOOL-CALL-RISK-CLASSIFICATION.md`.

### 2.6 Statut télémétrie-seulement de `TOOL-CALL-RISK-CLASSIFICATION.md` maintenu

Aucune modification du fichier. Son verdict d'ensemble (modèle jugé non
promouvable en garde de sécurité, retenu uniquement comme télémétrie et UX,
en laboratoire) reste l'état de doctrine, rappelé — jamais re-dérivé — par
`AGENT-RUNTIME-DOCTRINE.md` §4 (§2.5 ci-dessus).

### 2.7 Cérémonie de clés : déclencheur nommé (chantier 7, `governance#50`)

`governance#50` (mergé) ajoute un unique encart après l'en-tête de
`KEY-CEREMONY-RUNBOOK.md` : exécution au prononcé de l'orchestrator lock
(premier consommateur réel de lignage signé), dormant jusque-là — K3
(`LOOP-SECURITY-KERNEL.md`, non modifié) porte déjà l'intégrité par HMAC
sur tout chemin de rappel model-facing pendant ce temps. Aucune autre ligne
du runbook n'est modifiée.

### 2.8 Canal de signalement de sécurité : `governance`, portée flotte, PVR activé (chantier 5, `governance#53`, `.github#8`)

`governance#53` (mergé) ajoute `SECURITY.md` : signalement de vulnérabilité
privé GitHub sur ce repository, portée l'organisation entière (I-03 —
`governance` est l'autorité de doctrine), engagement de réponse sobre
(aucun SLA fixe promis pour un projet pré-release, maintenu solo).
`.github#8` (mergé) repointe le `SECURITY.md` par défaut de l'organisation
vers `governance` au lieu du hub `libre-ai/libre-ai`, archivé en lecture
seule depuis le 2026-07-30 (ADR-0020) — une intake morte. Private
vulnerability reporting activé sur `governance` (`gh api -X PUT
repos/libre-ai/governance/private-vulnerability-reporting`, confirmé par
`GET` : `{"enabled":true}`) ; l'activation par repository individuel, au
fil de la vague de conformité, reste hors périmètre.

### 2.9 Politique de flotte pour les waivers d'advisories (chantier 6, `governance#51`)

`governance#51` (mergé) ajoute `docs/security/ADVISORY-WAIVER-POLICY.md` :
trois propriétés qu'un waiver d'advisory doit porter dans n'importe quel
repository (daté, référencé, borné dans un horizon), un gate requis qui les
vérifie mécaniquement, et un renvoi vers `feed-radar/scripts/advisory-
waiver-gate.sh` + `feed-radar/docs/adr/0005-dependency-advisory-waivers.md`
(dépôt distinct, numérotation locale à `feed-radar` — pas une citation
`governance`) comme implémentation de référence à porter, pas à réinventer. Aucun nouveau gate n'est écrit par cette pull
request — la politique et le renvoi, comme périmétré. Distincte d'ADR-0021,
qui tranche qui bloque une demande de fusion contre un contrôle de flotte
périodique — non rouverte ici (§2.1).

### 2.10 Exemption de lecture machine — geste de config propriétaire, hors repo, noté pour traçabilité

Une exemption de lecture machine (règle deny affinée) relève de la
configuration locale du propriétaire, hors de ce repository et hors du
périmètre exécutable de cet ADR. Le présent paragraphe n'en fixe ni le
contenu ni la portée ; il consigne seulement qu'un tel geste a été
arbitré le 2026-08-18 dans le cadre de la présente remise à plat, pour
qu'une session future en retrouve l'origine.

## 3. Conséquences

- `docs/decisions/INVARIANTS.md` porte l'état par sous-composant d'I-09
  (`governance#66`) ; I-10 et I-23 ne changent pas de texte.
- `docs/adr/0012-personal-data-boundary-and-third-party-subjects.md` porte
  une correction datée sous D4 (`governance#49`) ; ses décisions D1-D5 ne
  changent pas.
- `libre-ai/notebook` porte désormais le garde-fou que sa D1 lui attribuait
  depuis le 2026-07-25 (`notebook#21`).
- `docs/security/AGENT-RUNTIME-DOCTRINE.md`, `docs/security/ADVISORY-
WAIVER-POLICY.md` et `SECURITY.md` (racine `governance`) sont des
  documents nouveaux.
- `libre-ai/.github`'s `SECURITY.md` pointe vers `governance`, plus jamais
  vers le hub archivé.
- Private vulnerability reporting est actif sur `governance`.
- `docs/decisions/DECISION-REGISTER.md` gagne D35.

## Ce qui n'est pas décidé ici

- `LOOP-SECURITY-KERNEL.md`, `POLARIS.md`, `THREAT-MODEL.md` — chantier
  K1-K5, concurrent et non touché.
- Le pendant tiers de `packages/rgpd-kit` (ADR-0012 D2) reste à construire ;
  D2 le rend bloquant, non rouvert ici.
- L'activation du private vulnerability reporting par repository
  individuel, au-delà de `governance` — vague de conformité, propre à ce
  chantier.
- Le contenu exact de l'exemption de lecture machine (§2.10) — geste de
  config propriétaire, non fixé par cet ADR.
