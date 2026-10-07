# Migration des règles Agent Factory

## Sources historiques à remplacer

- `engine/AGENTS.md` et `CLAUDE.md` ;
- `content/domains/stack-authority.md` ;
- `web-boundary.md` ;
- `testing-strategy.md` ;
- `mobile-webview-rust-core.md` ;
- ADR-0033 ;
- `crates/core/src/library.rs` ;
- `crates/core/src/stack.rs` et ses tests ;
- templates init et CI.

## Règles cibles

- Bun/TS possède UI, SSR, BFF, API web, sessions, DB et workers applicatifs ;
- Rust possède uniquement les composants spécialisés justifiés ;
- `Bun.serve` est la frontière web par défaut ;
- React est le renderer web ;
- contrats canoniques dans `contracts/` ;
- Axum/SQLx seulement dans une crate Rust active ;
- Dioxus absent de la cible web ;
- Bun test + Playwright + tests Rust spécialisés ;
- un `bun.lock`, TypeScript strict, aucune source JS ;
- pas de framework web supplémentaire ;
- toute double implémentation expire avant RC.

## Doctrine de décision

Sécurité > qualité > performance > complétude. L’effort historique déjà investi n’est pas un critère de conservation.
