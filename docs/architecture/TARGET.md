# Architecture cible

## Autorité

Deux autorités séparées portent le partagé (ADR-0020, amendement I-03) : le repo `governance` — doctrine, décisions, invariants, LEXICON, index d’écosystème, schéma des fiches projet, outillage d’écosystème, evidence, gates de flotte — et le repo `contracts` — les autorités canoniques de contrats, le catalog, la compatibilité et leurs gates. La règle « un sujet = une autorité unique » demeure : c’est le porteur qui change, pas le principe. GitHub reste la forge canonique déjà arbitrée.

La topologie multi-repository est l’**état courant en migration** (I-02 amendé ; ADR-0008 étendu par ADR-0020, dont le §5 est supersédé) : chaque repo est responsable de son périmètre — les deux autorités, les repos produits (application + crates produit + spécifications), l’application de couche 2, les satellites de code partagé (un repo par package ou crate), le site, l’outil d’inspection et le profil d’organisation. La liste normative des repos et de leurs périmètres n’est pas recopiée ici : elle vit au design d’activation générale `docs/superpowers/specs/2026-07-28-multi-repo-activation-design.md` §4, et les noms canoniques au LEXICON §2 et §8.

Le hub `libre-ai/libre-ai` a cessé d’être l’autorité unique : il est en **démantèlement** (ADR-0020 D2/D4), passe en « démantèlement en cours » à la première bascule, puis devient **archive + index de migration** — `ecosystem/migration-index.v1.yaml`, chaque chemin relié à sa destination et vérifié par un gate machine d’orphelins — à l’arrêt dur propriétaire final. La règle dure de bascule s’applique : un chemin ne quitte le hub qu’après preuve verte côté destination. Les anciens repositories d’outillage restent retirés après capture vérifiée ; les homes produits gelés reçoivent leur histoire migrée par greffe, sans réécriture. Clever Cloud reste la cible runtime Paris/UE, sans configuration ni provisioning pendant le cleanup et la Specification Lock.

## Plans

| Plan                      | Ownership                               |
| ------------------------- | --------------------------------------- |
| Connaissance et graphe    | `ecosystem/`, `crates/ecosystem-engine` |
| Applications web          | `apps/*` — Bun/TypeScript/React         |
| Plateforme web partagée   | `packages/*`                            |
| Moteurs spécialisés       | `crates/*` — Rust                       |
| Contrats                  | `contracts/`                            |
| Vérification indépendante | `verification/`, `crates/proof`         |
| Artefacts et releases     | `crates/artifact`, `distribution/`      |
| Infrastructure            | `infrastructure/`                       |

Les chemins ci-dessus sont ceux du hub en cours de démantèlement : la répartition par plan ne change pas, mais chaque chemin rejoint le repo responsable de son périmètre à l’activation générale (design §4 et §4.5, destination tracée à l’index de migration).

## Dépendances autorisées

```text
apps → packages → contracts
apps → adaptateurs versionnés → crates
packages ↛ apps
proof → contrats et artefacts publics
futur agent-orchestrator → seulement après lock exécution/contrôle/harness ; jamais UI produit ni DB partagée
ecosystem-engine ↛ logique métier produit
```

## Application Bun

Toute application et tout package exécutable déclarent `engines.bun: ">=1.4.0"`. Le manifeste racine de chaque repo sélectionne la révision qualifiée par défaut et les lifecycle guards refusent Bun 1.3. Les qualifications qui exigent explicitement Node restent isolées de la stack applicative Bun.

```text
Browser
  ↓ HTTPS
Bun.serve adapter
  ↓
Application use case
  ├── TypeScript domain
  ├── Rust/WASM bounded core
  ├── Bun.sql + PostgreSQL/RLS
  ├── Redis non autoritatif
  └── Cellar endpoint explicite
```

Les objets Bun HTTP ne traversent pas la couche application. Les migrations et données appartiennent au produit.

## Interop Rust

1. WASM/WIT pour domaine pur in-process ;
2. CLI JSON pour tooling ;
3. HTTP pour isolation ou scaling indépendant ;
4. FFI uniquement par ADR.

## Auth

- OIDC fournisseur-neutre Authorization Code + PKCE via BFF ;
- session navigateur opaque en cookie `__Host-` HttpOnly, CSRF et rotation ;
- Biscuit Ed25519 attenué, court et révocable pour autorisation interne ;
- tenant obligatoire et RLS en défense en profondeur.

## Workspaces

- un workspace Bun et/ou Cargo **par repo** (D07 amendé par ADR-0020) : chaque repo porte ses propres racines — `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`, `biome.json`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `.cargo/` ;
- chaque repo est responsable de ses pins : le catalogue central meurt avec le hub et les manifestes migrés sont réécrits en **versions concrètes épinglées**, les protocoles `catalog:` et `workspace:` ne traversant pas une dépendance git ;
- dépendances inter-repos par **git-deps GitHub épinglées par SHA**, bornées à l’organisation (`github:libre-ai/<repo>#<sha>` côté Bun, `git = "https://github.com/libre-ai/<repo>", rev = "<sha>"` côté Cargo). Décision de sécurité ADR-0020 §2.5 : le `deny.toml` de chaque repo Rust déclare `[sources.allow-org] github = ["libre-ai"]` (confiance bornée à l’organisation, chaque bump de SHA passant par une pull request revue) ; la quarantaine `minimumReleaseAge` ne s’applique pas aux git-deps intra-organisation, remplacée par ce régime pin-SHA + revue, et reste en vigueur pour tout paquet de registre ;
- contrats consommés à la compilation : **copie vendorée byte-exacte** dans le repo consommateur, sous gate de dérive octet-par-octet contre la révision épinglée de `contracts`. Ces copies sont des projections vérifiées (I-05) : jamais éditées à la main, jamais canoniques ;
- le patch cryptographique `aes` (avec `third_party/` et son `PATCH.md`) est re-déclaré par chaque workspace final dont le graphe le contient, et `.cargo/config.toml` (`+simd128`) suit tout repo qui construit une cible wasm32 ;
- versions publiques indépendantes et tags namespacés.
