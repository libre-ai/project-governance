# Prompt — G2 foundation build

## Mission

Implement the final shared foundation in `libre-ai/libre-ai`.

## Execution order

Execute only locked packages from `docs/transformation/work-packages.v1.json`: `WP-G2-T01` first, then groups `g2-1` through `g2-6`. A package writes only its declared paths.

## Scope

- root Bun/Cargo workspaces ;
- qualified Bun toolchain ;
- Knowledge Engine and canonical contracts ;
- UI, web-runtime, auth-web, database, cache, testing and PWA packages ;
- specialized Rust crates ;
- simulation-only agent orchestration control core, without harness/worker or OS capabilities ;
- Bun app template ;
- Proof, Artifact and deterministic artifact projections ;
- local/CI quality gates.

## Constraints

No Dioxus, no extra web framework, no compatibility names, no second lockfile, no Clever provisioning. Use exact dependencies and public APIs only.

## Acceptance

A clean checkout exercises Bun.serve, React SSR/hydration, Ajv contracts, PostgreSQL/RLS, Biscuit, Rust/WASM, Playwright, Proof, Artifact and a deterministic projection.
