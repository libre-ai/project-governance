# Polaris — La méthode d'orchestration gouvernable

**Polaris** est la couche 2 du portefeuille Libre AI (ADR-0009, ADR-0011 D2) : la **méthode d'orchestration gouvernable** qui gère une constellation d'agents autonomes sous gates vérifiables et touche humaine réduite aux invariants. Elle réalise le produit zéro (I-13) — non une application, mais la méthode elle-même.

## Essence et posture

La boucle auto-alimentée qui orchestre les agents est elle-même soumise aux cinq invariants de sécurité (K1–K5) qui gouvernent le produit. **Polaris n'automatise que ce qui est governable** ; elle laisse à la touche humaine :

- **Les portes nominatives** (D3 : porte V3 Specification Lock — arrêt dur permanent, jamais auto).
- **Les décisions d'architecture** (brevets stratégiques, choix d'exposition, approbation légale).
- **Le registre des invariants** (mutations via ADR, auteur = propriétaire + witness + ci-gate).

Tout le reste — build, test, revue dual-K4, gates d'entrée/sortie de vague, métriques de couverture — s'automatise sous ces garde-fous immuables.

## La boucle gouvernée : K1–K5

Chaque contrôle est une paire (exigence, réalisation au socle) avec une frontière d'enforcement explicite.

| Noyau  | Exigence                                                                                            | Réalisation socle                                                                                                                                                                                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **K1** | Identité d'agent : flotte / mission / capacités / révocation per-`agent_id`                         | Faits Biscuit lockés + `authority-v2` + `agent-runs-v2` + `AgentRevocationStore` fail-closed                                                                                                                                                                                                    |
| **K2** | Données `operational` jamais autorité ; `classification` scellée, gelée                             | `@libre-ai/classification` — `requireAuthorityFor` fail-closed, mutations gelées                                                                                                                                                                                                                |
| **K3** | Intégrité d'enveloppe signée sur tout rappel : HMAC constant-time + délimiteurs échappés prouvables | `@libre-ai/envelope` (`envelope.v1` locked) — `wrapUntrusted` + `verifyEnvelope` appliqués au rappel modèle                                                                                                                                                                                     |
| **K4** | Mutations couche 3 et garde-fous : revue humaine + signature + rollback borné, pas d'auto-merge     | Revue adversariale documentée + merge propriétaire = signature, appliqué mécaniquement par `tools/quality/check-review-evidence.ts` (ADR-0023, 2026-08-18 — remplace la mention CODEOWNERS/required-reviews qu'aucun réglage réel ne portait : `.github/CODEOWNERS` n'existe pas dans ce dépôt) |
| **K5** | Registre immuable en production : aucune boucle ne mute les invariants hors PR revue                | `docs/decisions/INVARIANTS.md` sous protection main + gate ADR + deny-list signé                                                                                                                                                                                                                |

L'état de chaque contrôle (in service / partial / specified-pending) n'est plus dupliqué ici : la table « Status of the five controls at this lock » de
[`LOOP-SECURITY-KERNEL.md`](../specifications/LOOP-SECURITY-KERNEL.md) en est l'unique source vivante (domain F/H, 2026-08-18 — deux promotions successives
avaient déjà fait diverger cette colonne de la table source avant qu'elle ne soit retirée).

Le noyau K1–K5 est **l'entrée gate de vague 3** (EXECUTION-SEQUENCING, section « Vague 3 ») : orchestrateur et harness lock ne s'ouvrent qu'après.

## Rôles et gates

### Cycle de revue dual-K4

```
Brief → Implémenteur → Commit
                ↓
        Relecteur K4 (archi)
                ↓
        Relecteur K4 (sécu, indépendant)
                ↓
        Dossier de revue (findings + verdict)
                ↓
        Propriétaire (accepte / demande fix)
                ↓
        Merge (gate CI verte)
```

Indépendance signifie **rôle séparé et pass revue-only** (AGENT-REVIEW-PROTOCOL §1), pas forcément agent/session différent en workflow solo-mainteneur.

### Gates d'orchestration (ADR-0011 D4, D6)

- **5 gates CI nominaux** : secret-scan, doctrine (ADR+INVARIANTS), work-package, DCO, référence-chain.
- **D4 – Confiance graduée** : premier merge sécurité-critique d'une couche = arrêt dur (dossier + prononcé propriétaire) ; répétitions = auto-merge sur revue propre (K4).
- **D3 – Arrêt dur permanent** (porte V3) : orchestrator Specification Lock jamais automatisé, acte propriétaire nominatif exclusif.
- **D6 – Plafonds autonomie** :
  - _Liveness_ : ≤ 3 cycles CI/revue par PR ; 3 PR consécutives sans progrès mesurable → STOP.
  - _Coût_ : tokens cumulés par vague (phase 0 : 300 k, G2 : 1,5 M, V1 : 1 M, V2 : 2 M, V4a : 1 M).
  - Dépassement = dossier produit, jamais kill silencieux.

## Preuve auto-documentée (le traceur)

Polaris prouve sa propre gouvernance via trois publics :

1. **gate-acceptance-log.md** — journal public des verdicts de gate, chaque ligne vérifiable par SHA+PR/ADR.
2. **coverage-metrics.ts** — mesure la part des opérations sans touche humaine (genuine automation). Honnête par construction : reporte ce que l'observable merge record montre. T0 baseline (vague 0) = 0 % automation (état avant que la boucle opère réellement) ; vagues 1-3 la font monter.
3. **La forge auto-documentée** — repository comme instrument public de démonstration. Tous les verdicts, dossiers, revues vivant dans `docs/reviews/`, `distribution/evidence/`.

Aucune brique n'est en production sans preuve publiée.

## Ce qui est IN-SERVICE vs SPECIFIED-PENDING

**IN SERVICE aujourd'hui :**

- Noyau K1–K5 spécifié (LOOP-SECURITY-KERNEL.md) et locké.
- Review protocol indépendant et gates CI.
- Registre d'invariants et doctrine governance.
- Traceur v1 (gate-acceptance-log + coverage metrics).

**SPECIFIED-PENDING (vague 3, en cours de construction) :**

- **Orchestrator runtime** — les boucles elles-mêmes qui opèrent agents et flotte sous K1–K5 (work-packages WP-G3-*).
- **Harness runtime** — intégration d'agent-runs-v2, de la mémoire et des métriques dans l'exécutable orchestrateur réel.
- **Merge automation sur revue propre** — l'autorisation permanente d'auto-merge (D4) attend la première wave complète de promotion.

Le noyau gouverne déjà ; son exécution à l'échelle de constellation s'amorce en vague 3, d'où l'état intermédiaire honnête.

## Comment l'adopter sur un autre projet

### Prérequis techniques

1. **Gates CI garantissant K1–K5** : secret-scan, doctrine-register (ADR+INVARIANTS), DCO sur main, work-package boundary-check, lockfile hash-binding.
2. **Review indépendante** : au minimum deux passes K4 (archi + sécu) sur tout code sensible, chacune sur commit immuable, chacune avec verdict documenté.
3. **Registre d'invariants** : document vivant à l'autorité unique sous protection main, mutations via ADR, source de vérité pour la dérive de gouvernance.
4. **Plafonds chiffrés** : liveness (cycles max, PR plateau) et coût (tokens/phase) explicites ; un dépassement arrête le travail autonome et produit un dossier.

### Non-transposable (spécifique Libre AI)

- Les cinq amorçages nominatifs (K1–K5) et leur phasing en vagues : propres au portefeuille.
- Les décisions d'architecture (D01–D27 du registre) : autorités propriétaires.
- La structure de gates doctrine (ADR + Lexicon + Work-Package Lock) : mineure, adaptable.

Ce qui se transpose : la **posture** — réduire l'automation et la délégation à l'essentiel gouvernable, publier la preuve immédiatement, et laisser le jugement où il réside (humain + invariants).

## Non-objectifs de Polaris

Polaris n'automatise pas :

- **Approbations substantielles** — elle applique les garde-fous une fois prononcés, ne les crée pas.
- **Portes nominatives** — actes réservés (D3 : Specification Lock orchestrateur, activations de produit).
- **Chiffrage métier** — elle rapporte la couverture observée, ne la définit pas.

## Références

- `docs/specifications/LOOP-SECURITY-KERNEL.md` — les cinq noyaux de sécurité (K1–K5).
- `docs/reviews/AGENT-REVIEW-PROTOCOL.md` — protocol d'indépendance de revue.
- `distribution/evidence/gate-acceptance-log.md` — le traceur public des verdicts.
- `docs/transformation/EXECUTION-SEQUENCING.md` — phasing en vagues.
- `docs/adr/0009-constellation-portfolio-and-method.md` (constellation-portefeuille), `docs/adr/0011-wave-execution-decisions.md` (couche 2 & gates), `docs/adr/` 0001–0008 (doctrine de foundation).
