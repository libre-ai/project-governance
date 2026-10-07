# Bun toolchain qualification

## Runtime policy

- minimum accepted runtime across the root workspace, packages and generated application template: `>=1.4.0` ;
- `engines.bun`, lifecycle guards and the root toolchain gate reject every `1.3.x` runtime ;
- the exact qualified revision remains mandatory in shared CI and reproducibility evidence ; a newer `1.4+` runtime is acceptable for development only, not automatically supply-chain-qualified.

## Current observation

- stable: `1.3.14`, which predates the selected Rust line ;
- pinned canary: `1.4.0-canary.1+57f349f63` ;
- source commit: `57f349f6307cf89dcfb8893f003c1ef421a74589` ;
- pinned WebKit source revision: `4895f45dfbd0d1226c4d41799887bc0ecb9f341b` ;
- official macOS ARM64 and Linux x64 artifacts downloaded and verified locally ;
- exact Bun source archive downloaded and verified locally ;
- verbatim upstream licence and redistribution notice tracked under `toolchains/notices/bun/1.4.0-canary.1+57f349f63/` ;
- local snapshot remains gitignored under `.tools/snapshots/bun/1.4.0-canary.1+57f349f63/`.

## Qualified bootstrap release

Release [`toolchain-bun-1.4.0-canary.1-57f349f63`](https://github.com/libre-ai/libre-ai/releases/tag/toolchain-bun-1.4.0-canary.1-57f349f63) contains:

1. the two unmodified upstream binaries ;
2. the exact Bun source archive ;
3. checksums and the verbatim upstream licence ;
4. the redistribution/relinking notice and pinned WebKit revision.

Shared CI retrieves the Linux asset from that immutable release without `curl | bash`, verifies SHA-256 before extraction, verifies `bun --revision` before dependency installation, then runs frozen installation, root checks and audits. Initial run [`29491575814`](https://github.com/libre-ai/libre-ai/actions/runs/29491575814) passed both Bun and Rust jobs.

The release is a technical compliance and reproducibility record, not legal advice or production approval. External redistribution beyond the public bootstrap archive requires owner or counsel approval. Clever Cloud remains unconfigured until Global Integration.

## Acceptance

- global minimum `1.4.0` declared and executable in every Bun package/template ;
- exact CI version/revision verified ;
- Darwin ARM64 and Linux x64 checksums recorded ;
- exact application source and upstream relinking instructions archived ;
- WebKit source revision recorded ;
- artifact remains retrievable after rolling canary changes ;
- clean runner installs without executing a remote shell script ;
- `bun install --frozen-lockfile`, `bun run check` and audits pass.

**Bootstrap acceptance:** complete.

## G2 checkpoint

`WP-G2-T01` rechecked upstream on 2026-07-16. Stable remains `1.3.14+0d9b296af`, 903 commits behind the selected Rust-line commit and without a root `Cargo.toml`. No stable Rust-line release exists. Evidence and the proposed negative-checkpoint disposition are recorded in [`G2-T01-QUALIFICATION.md`](G2-T01-QUALIFICATION.md).

Human continuation accepted the negative checkpoint on 2026-07-16 and unlocked development foundation work while the exact canary remains bootstrap-only. It did not approve production, another canary or Clever provisioning.

## Replacement rule

Replace the canary with the first qualified stable Rust release, regenerate `bun.lock`, rerun every gate and archive the new checksums. A different canary is forbidden without repeating full binary/source/licence qualification.
