# Workstreams

These workstreams are organizational groupings, not branch write authority. Executable package boundaries, dependencies and gates are locked in [`G1-WORK-PACKAGES.md`](G1-WORK-PACKAGES.md) and [`work-packages.v1.json`](work-packages.v1.json).

## A — Canonical Core

**Paths :** `ecosystem/`, `contracts/`, `crates/ecosystem-engine`, `tools/`.

**Résultats :** objets versionnés, graphe, règles de dépendance, génération, provenance et projections.

## B — Web Platform

**Paths :** `packages/`, `distribution/templates/bun-app`.

**Résultats :** React UI, Bun runtime, auth web, DB/cache, observabilité, tests, PWA et template.

## C — Specialized Rust

**Paths :** `crates/` hors ecosystem engine.

**Résultats :** Biscuit, quatre frontières produit Rust/WASM candidates, proof, artifact et CLIs système. Aucun moteur Context, Orchestrator ou Practices scoring n’est créé sans nouveau package approuvé.

## D — Experiences

**Paths :** `apps/`.

**Résultats :** website, practices, radar, notebook, sessions, model-policy, boussole, specifications et missions.

## E — Infrastructure and Release

**Paths :** `infrastructure/`, `verification/`, `distribution/`.

**Résultats :** Clever Cloud, PostgreSQL/Redis/Cellar, observabilité, Playwright, SBOM, provenance et release candidate.

## Règles communes

- un owner et un intégrateur par workstream ;
- contrats approuvés avant consommation ;
- branches courtes ;
- changements transverses annoncés avant merge ;
- toute approbation vient d’une passe review-only distincte de la passe auteur ;
- toute solution temporaire possède une suppression avant RC ;
- les gates sécurité précèdent la complétude.
