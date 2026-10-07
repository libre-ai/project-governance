# WP-G2-Q01 — gap analysis (foundation integration & quality harness)

- **Date :** 2026-07-20 · **Branche :** `feat/wp-g2-q01-quality-harness` (part de la branche D01, non ouverte en PR tant que D01 n'est pas mergé — pas de PR empilée).
- **But du document :** cartographier ce que le CI et le tooling qualité couvrent DÉJÀ contre les trois critères d'acceptation verrouillés de WP-G2-Q01, pour que le reste soit exécuté sans redondance dès la clôture de D01. **Aucune exécution « clean-checkout » n'est construite ici** : elle n'a de sens qu'une fois D01 sur `main` (arrêt dur D4 en attente) — la construire avant serait un contournement.

## Critères d'acceptation (verrouillés, `work-packages.v1.json` WP-G2-Q01)

1. Un checkout vierge exerce Bun.serve, React, contracts, RLS, Biscuit, WIT, Proof, Artifact et Playwright.
2. Toutes les gates licence, advisory, source, secret, accessibilité et build-déterministe passent en CI partagé.
3. Aucune ressource Clever ni claim de production.

`writePaths` autorisés : `.github/workflows/**`, `tools/quality/**`, `verification/harness/**`. `humanGate` : `g2-foundation-acceptance` (gate de sortie G2, pas un arrêt dur sécu-critique — le pattern couche-données a son amorçage via D01).

## Couverture existante (constatée, `bun run check` + `.github/workflows/ci.yml`)

| Exigence Q01       | Déjà couvert par                                                                                                                       | État                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Contracts          | `check:contracts` (+ vecteurs agent-orchestration/policy/radar/notebook/boussole), `check:generated-contracts`, `check:specifications` | ✅ vert en CI                                                |
| Bun.serve + React  | `packages/web-platform` (WP-G2-W01, `bun-app` template, 3-engine Playwright)                                                           | ✅ acquis (W01)                                              |
| Biscuit            | `crates/authz-biscuit` (WP-G2-Z01, revues + tests)                                                                                     | ✅ acquis (Z01)                                              |
| WIT worlds         | `check:contracts` parse les 9 WIT worlds                                                                                               | ✅ vert                                                      |
| Proof / Artifact   | `crates/artifact` + autorités `evidence-report.v1`, `harness-attestation.v1`                                                           | ✅ contrats verrouillés                                      |
| RLS                | **`packages/data` + `packages/testing` (D01, ce cycle)** : 15 tests barrière brute + adapters                                          | ⏳ sur branche D01, à merger (arrêt dur D4)                  |
| Licences           | `check:licenses` (JS) + `cargo deny check licenses` (Rust)                                                                             | ✅ vert                                                      |
| Advisory           | `bun audit` + `cargo deny check advisories`                                                                                            | ✅ vert                                                      |
| Source policy      | `check:source` (`check-source-policy.ts`), `public-source-scanner`                                                                     | ✅ vert                                                      |
| Build déterministe | rust-quality : rebuild WASM Notebook Core + `cmp` + sha256                                                                             | ✅ vert                                                      |
| Playwright         | `@playwright/test` 1.61.1 présent ; configs `tools/qualification/notebook-core-v2/*`                                                   | ⚠️ existe pour Notebook, pas de suite « foundation » unifiée |

## Gaps réels (le seul travail neuf de Q01)

**Faits (indépendants de D01 mergé, livrés sur cette branche) :**

- **G-Q5** (`tools/quality/check-no-clever-production.ts`, gate exécutable acceptance 3, 7 tests) — câblé dans `bun run check`.
- **G-Q2** (`tools/quality/check-secret-scan.ts`, gate secret-scanning tree-wide réutilisant `containsCredentialMarker`, 7 tests) — câblé dans `bun run check`.
- **G-Q1** (`verification/harness/reference-chain.ts`, harness acceptance 1, 7 tests) — cadre modulaire orchestrant la chaîne foundation ; l'étape `rls` est **gated par présence de `packages/data`** : `skipped` sur un checkout main pré-merge, active au merge D01 sans remaniement. Non câblé dans `bun run check` (étapes cargo/Playwright trop lourdes par-check) — c'est le harness de la gate `g2-foundation-acceptance`. **G-Q4 y est absorbé** : l'étape `rls` de la chaîne EST la RLS en évidence reference-chain.

**Post-merge D01, exécution réelle FAITE :** la chaîne complète tourne verte depuis un checkout `main` propre, **RLS et Playwright inclus** (l'étape `playwright` exécute la suite three-engine foundation de W01 — chromium/firefox/webkit : SSR+hydratation, no-JS, PWA offline, reduced-motion, headers de sécurité). L'étape `rls` est passée de `skipped` à `passed` au merge D01. Évidence : `verification/harness/wp-g2-q01-reference-chain-evidence.md`.

**Accessibilité (critère 2) :** partiellement couverte par l'étape `playwright` de la chaîne (`reduced-motion.e2e` + « keyboard interaction remains accessible » de `reference.e2e`), en plus de l'`accessibility-foundation-review` de W01 déjà accepté. **G-Q3** (gate accessibilité partagée dédiée, ex. axe-core sur toutes les surfaces) reste un durcissement futur, browser-dépendant — non requis par l'acceptance verrouillée, qui nomme les gates mais pas d'outil axe spécifique.

| Gap                                                                                                                                                                                                                                         | Nature                   | Dépend de D01 mergé ?                           | writePath                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------- | ------------------------------------------ |
| G-Q1 — **Reference-chain harness** : un point d'entrée unique (`verification/harness/`) qui, depuis un checkout vierge, exécute toute la chaîne (contracts → web → Biscuit → RLS → Proof/Artifact → Playwright) et émet une évidence signée | Orchestration + évidence | **Oui** (doit inclure RLS de D01 depuis `main`) | `verification/harness/**`                  |
| G-Q2 — **Gate secret-scanning** en CI partagé (l'acceptance la nomme ; `.github/workflows` n'a pas de job dédié — le secret-scanning GitHub natif est activé mais non exprimé comme gate de foundation)                                     | Job CI                   | Non                                             | `.github/workflows/**`                     |
| G-Q3 — **Gate accessibilité** au niveau foundation (existe pour Notebook via Playwright ; l'acceptance Q01 la veut comme gate partagée)                                                                                                     | Job CI + config          | Partiel (dépend des surfaces web)               | `.github/workflows/**`, `tools/quality/**` |
| G-Q4 — **RLS dans la chaîne CI partagée** : le job bun-quality exécute `bun test` (dont les tests D01 pglite) — à confirmer vert sur `main` post-merge D01, et à nommer explicitement dans l'évidence reference-chain                       | Assemblage               | **Oui**                                         | `verification/harness/**`                  |
| G-Q5 — **Assertion « no Clever / no production »** exécutable (scanner qui échoue si une ressource Clever Cloud ou un claim de prod apparaît)                                                                                               | tooling                  | Non                                             | `tools/quality/**`                         |

## Ordre d'exécution proposé (dès le prononcé D4 → merge D01)

1. Merge D01 (prononcé propriétaire) → G2 a sa barrière RLS sur `main`.
2. Rebaser cette branche sur `main`, ouvrir la PR Q01.
3. G-Q5, G-Q2 (indépendants de D01) → G-Q4, G-Q1 (assemblage reference-chain incluant RLS) → G-Q3.
4. `g2-foundation-acceptance` (gate de sortie G2) → **G2 clos** → ouverture vague 1.

Rien de G-Q1..G-Q5 n'est un arrêt dur sécu-critique (D01 portait l'amorçage de la couche données). La clôture de G2 est une transition de gate séquentielle, pas un arrêt dur.
