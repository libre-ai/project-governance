---
name: context-conformity
description: Verify a fleet repository's conformity before concluding work — quality gates green, pinned reusable governance workflows consumed, and the required repo-identity files non-empty. Use before declaring a repo-scoped task done or before opening a pull request in any libre-ai fleet repository.
license: Apache-2.0
status: candidate
---

<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Conformité de contexte (flotte)

La source de vérité est l'environnement réel du dépôt courant, jamais une liste recopiée dans ce fichier : la flotte évolue, un instantané figé ici dérive en silence dès le premier ajout de gate.

## Quand l'utiliser

- Avant de conclure un travail sur un dépôt de la flotte libre-ai (hors `governance`/`contracts`, qui portent leurs propres gates de doctrine).
- Avant d'ouvrir une pull request qui se prétend verte.

## Vérifications, dans l'environnement du dépôt cible

1. **Gates de qualité.** Lire `package.json` `scripts.check` (ou l'équivalent Rust/`Cargo.toml`) du dépôt cible et l'exécuter — `bun run check` n'est pas universel, c'est la convention la plus fréquente, pas une supposition à appliquer aveuglément. Ne jamais déclarer un travail terminé sur la seule lecture du code.
2. **Workflows réutilisables consommés.** `grep -rn "libre-ai/governance/.github/workflows/reusable-" .github/workflows/` — un dépôt de flotte consomme au moins `reusable-licensing.yml` et `reusable-context-hygiene.yml`, par SHA épinglé, jamais par tag mobile ni dupliqué en local. Une CI locale qui réinvente licensing/hygiene au lieu de consommer `governance` est une dérive à signaler, jamais à corriger silencieusement.
3. **Fichiers d'identité non vides.** `AGENTS.md`, `REUSE.toml`, `project.v1.yaml` existent et portent un contenu substantif, pas un gabarit vide. `AGENTS.md` est la source canonique du périmètre du dépôt ; un `CLAUDE.md` de dépôt n'est qu'un adaptateur (`@AGENTS.md`), jamais une doctrine parallèle.
4. **DCO.** Le dernier commit local porte un trailer `Signed-off-by` cohérent avec l'auteur (`git log -1 --format=%an\ %ae`).

## Ce qui n'est pas une conformité générique

- Les gates propres au domaine du dépôt (`reuse lint`, un contrat OpenAPI, un test e2e navigateur) ne s'énumèrent pas ici : lire le manifeste du dépôt cible plutôt que supposer un socle générique partagé.
- Ce skill ne remplace jamais le gate local : il vérifie qu'il existe et qu'il tourne, jamais à sa place.

## Constat, pas correction automatique

Ce skill diagnostique, il ne modifie rien de lui-même. Une dérive trouvée (workflow non consommé, fichier d'identité vide, gate rouge) se rapporte avec le chemin exact avant toute proposition de correction.
