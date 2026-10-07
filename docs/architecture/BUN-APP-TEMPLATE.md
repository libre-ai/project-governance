# Spécification du template Bun canonique

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
