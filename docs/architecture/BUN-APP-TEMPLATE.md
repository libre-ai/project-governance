# Spécification du template Bun canonique

## Champ d’application

Ce gabarit décrit les produits **Bun fullstack** : React 19 SSR, `Bun.serve` direct, PostgreSQL et les interdits ci-dessous.

Exception nommée : **P02** (veille de flux, domaine Connaissance) n’est pas un produit Bun fullstack. Son serveur est entièrement en Rust (axum, sqlx, PostgreSQL) et son web est une PWA React 19, TypeScript strict et Vite (ADR-0054 §1 et §3, qui amendent I-06 et ADR-0042 §5 pour P02 seul ; ligne D86 de `docs/decisions/DECISION-REGISTER.md`). Le gabarit ne lui est pas opposable, et la liste « Interdits » ne s’applique pas à P02. Aucun autre produit n’est excepté.

Owner-arbitration: 2026-10-23 — arbitrage en chat, option « PR doctrine : exception P02 » : le gabarit vaut pour les produits Bun fullstack, P02 en est excepté par ADR-0054.

## Stack

- Bun épinglé ;
- TypeScript strict ;
- React 19 SSR/hydratation ;
- React Aria Components ;
- Tailwind v4 ;
- `Bun.serve` direct ;
- Ajv strict pour JSON Schema ;
- Biome ;
- Bun test et Playwright.

## Structure

```text
src/server/          Bun.serve, routes et adaptateurs
src/client/          React et hydratation
src/domain/          domaine TypeScript pur
src/application/     cas d’usage
src/infrastructure/  PostgreSQL, Redis, Cellar
src/contracts/       artefacts générés
src/shared/          types sérialisables réellement partagés
public/              assets locaux
migrations/          SQL versionné
tests/               Bun unit/intégration
e2e/                 Playwright
scripts/             orchestration locale minimale
```

## Gates

1. toolchain exacte ;
2. `bun install --frozen-lockfile` ;
3. Biome CI ;
4. `tsc --noEmit` ;
5. tests Bun ;
6. contrats ;
7. PostgreSQL/RLS/CSRF/Biscuit négatifs ;
8. Playwright Chromium/Firefox/WebKit/mobile ;
9. build release ;
10. Clever smoke, SBOM et provenance.

## Interdits

- Next, Vite, Astro, Hono, Express, Fastify, Elysia ;
- API Bake privée ou `wip` ;
- fichiers source JavaScript ;
- token navigateur lisible par JavaScript ;
- ORM sans ADR ;
- remote fonts ;
- dépendance AWS implicite ;
- second lockfile.
