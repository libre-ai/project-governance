---
name: deploy-clever
description: Pre-flight checks before deploying an application to Clever Cloud — clean working tree, green quality gates, Clever Cloud app status, GitHub Actions status on the target commit. User-invoked only; never self-triggered by an agent.
license: Apache-2.0
status: candidate
disable-model-invocation: true
---

<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Déploiement Clever Cloud — pré-vol

`disable-model-invocation: true` : ce skill s'invoque explicitement par l'utilisateur, jamais de la propre initiative d'un agent.

## Pré-vol, dans l'ordre

1. `git status --porcelain` — arbre de travail propre exigé. Un résultat non vide arrête ici : rien ne se déploie avec du travail non commité ou non poussé.
2. `bun run check` (ou l'équivalent déclaré par le dépôt cible) — doit sortir vert. Un gate rouge arrête ici.
3. `clever status` — état de l'application Clever Cloud ciblée (déployée, en cours, en échec). Lire l'état avant d'empiler un déploiement sur un échec déjà en place.
4. Statut GitHub Actions sur le commit à déployer : `gh run list --branch <branche> --limit 5` (ou `gh pr checks` si la branche porte une PR) — les workflows requis doivent être verts sur le commit visé, pas seulement sur un ancien commit de la branche.

## Multi-application

Un dépôt peut porter plusieurs applications Clever Cloud (`clever applications`). Préciser l'application ciblée avant `clever status`/`clever deploy` — ne jamais supposer une application par défaut sur un dépôt multi-app.

## Décision

- Les quatre pré-vols verts : le déploiement peut être proposé — reste un acte explicite de l'utilisateur (`clever deploy`), jamais lancé par ce skill au-delà du pré-vol.
- Un pré-vol rouge : rapporter lequel, avec la sortie brute, et s'arrêter — ne jamais contourner un pré-vol rouge pour déployer quand même.

## Après déploiement (si lancé)

- Un smoke test post-déploiement est attendu par la doctrine de flotte (endpoint santé ou script `smoke` du dépôt cible) — le proposer, jamais l'inventer sans vérifier ce que le dépôt expose déjà.
- Échec post-déploiement : rollback via un redeploy Clever Cloud du commit précédent, jamais un force-push pour « annuler ».

## Portée

Clever Cloud et GitHub Actions uniquement. Ce skill ne connaît aucune autre forge ni aucun autre provider CI, et ne remplace ni `bun run check` local ni la revue de code.
