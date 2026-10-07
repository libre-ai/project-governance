---
name: review-fanout
description: Launch a parallel multi-agent review fan-out (security, architecture, quality roles) over an immutable commit before merging candidate work. Use when a candidate branch needs independent role-separated review passes, not a single solo checklist.
license: Apache-2.0
status: candidate
---

<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Review fan-out

Ce skill est un pointeur. Il ne reformule jamais `docs/reviews/AGENT-REVIEW-PROTOCOL.md` : ce fichier reste l'unique autorité du protocole de revue. Le lire en entier avant de lancer une passe, ne jamais travailler sur une paraphrase.

## Quand l'utiliser

- Une branche candidate a besoin de passes de revue indépendantes par rôle (sécurité, architecture, qualité, complétude) avant merge.
- Le besoin dépasse une passe solo : c'est le fan-out multi-agent, pas un simple `review`/`code-review`.

## Ce que fait l'outil

- Orchestrateur : `tools/review/fanout.ts`, dans le dépôt `libre-ai/orchestrator` — pas dans `governance`, où vit ce skill. `tools/review/fanout.ts` n'existe pas ici ; la commande ci-dessous échoue sur fichier introuvable si elle est lancée depuis `governance`.
- Depuis un clone de `libre-ai/orchestrator`, à sa racine : `bun tools/review/fanout.ts <plan.json> [--dry-run] [--force]`.
- Concurrence par défaut : 5 passes en parallèle, jamais séquentiel par habitude.
- Chaque passe vise un commit immuable et un rôle, dans un worktree détaché ; une passe s'invalide elle-même si le worktree ressort sale.
- Verdict machine-lisible : une enveloppe JSON par passe, forme `review-verdict.v0.1` (validation dans `tools/review/fanout-core.ts`), exactement un verdict parmi `approve`, `approve-with-minor-reservations`, `reject`.
- Déduplication : une paire (commit, rôle) déjà verdictée n'est pas relancée sans `--force` ; un record existant n'est jamais écrasé, il s'archive avant relance.

## Avant de lancer

1. Lire `docs/reviews/AGENT-REVIEW-PROTOCOL.md` en entier.
2. Vérifier que le commit visé est immuable — poussé, aucun travail en cours dessus.
3. Construire le `plan.json` (rôles requis, commit, concurrence à ajuster si besoin).

## Après la passe

- Le milestone de contrôle humain reste propriétaire (`accept`/`continue`/`hold`/`reject`) — ce skill ne le remplace pas.
- Une revue candidate-integration ne vaut jamais promotion d'un rôle catalogue spécifique.

## Ce que ce skill ne fait jamais

- Réécrire le protocole de rôles ou décider des rôles requis à la place de `contracts/catalog.v1.json`.
- Merger à sa place — le merge reste un acte propriétaire.
