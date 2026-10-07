# WP-G2-T01 — Bun production toolchain qualification

- **Checkpoint:** 2026-07-16
- **Status:** completed negative checkpoint; human gate accepted 2026-07-16
- **Current pin:** `1.4.0-canary.1+57f349f63` (bootstrap/shared CI only)
- **Latest upstream stable:** `1.3.14+0d9b296af`
- **Production status:** blocked

## Question

Does a stable Bun release contain the accepted Rust-line build introduced before/at commit `57f349f6307cf89dcfb8893f003c1ef421a74589`?

## Evidence

1. GitHub `releases/latest` returns [`bun-v1.3.14`](https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14), published 2026-05-13, target commit `0d9b296af33f2b851fcbf4df3e9ec89751734ba4`.
2. The official macOS ARM64 stable artifact verifies against upstream SHA-256 `d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620` and reports `1.3.14+0d9b296af`.
3. The official Linux x64 stable artifact declares upstream SHA-256 `951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f`.
4. GitHub compare reports the selected Rust-line commit **903 commits ahead**, zero behind, with the stable commit as merge base. Stable `1.3.14` is therefore an ancestor predating the selected line.
5. Upstream root `Cargo.toml` is absent (`404`) at stable commit `0d9b296a` and present at selected commit `57f349f63` (`sha 3d43080b43ff533b6497940cc61ad089fdb762d4`).
6. No stable release newer than `1.3.14` exists at the checkpoint. Recent stable release metadata contains only `1.3.x`; the moving `canary` tag is not a stable release.

## Verdict

**No stable Rust-line Bun release is available.** Stable `1.3.14` is not a candidate and must not replace the current bootstrap pin. A newer canary is also forbidden without repeating binary/source/licence qualification.

The existing canary remains reproducible in the immutable Libre AI release and shared CI, but it remains prohibited for production. No Clever Cloud configuration, secret or runtime environment may be created from this result.

## Recommended disposition

Accept `WP-G2-T01` as a **completed negative qualification checkpoint**:

- retain exact canary `1.4.0-canary.1+57f349f63` for development/bootstrap CI only ;
- keep production and G4 provisioning blocked ;
- allow `WP-G2-C01` and later G2 foundation packages to proceed against the locked bootstrap toolchain ;
- rerun this gate when upstream publishes the first stable `1.4.x` (or another stable containing root Cargo/Rust build evidence) ;
- require a new human production-toolchain acceptance after archive, clean-checkout, browser and supply-chain qualification of that stable.

Halting all G2 work until upstream publishes a stable is safer but provides no additional evidence and leaves the accepted architecture unimplemented. Replacing the pin with another canary is not recommended.

## Human gate outcome

Human continuation on 2026-07-16 accepted the recommended negative-checkpoint disposition. `WP-G2-C01` is unlocked for development against the exact bootstrap toolchain. This acceptance does **not** approve production, another canary or Clever provisioning.
