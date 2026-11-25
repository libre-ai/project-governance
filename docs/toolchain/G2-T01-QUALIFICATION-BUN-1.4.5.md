<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# WP-G2-T01 — Bun stable qualification, candidate 1.4.5 (draft)

- **Checkpoint:** 2026-11-24
- **Status:** draft. It holds what a machine can measure. `toolchain-production-acceptance` and `supply-chain-license-review` are **not done**; no line of this document is an acceptance, an approval of a licence or a decision of the owner.
- **Current pin:** `1.4.0-canary.1+57f349f63`, unchanged by this document (bootstrap and shared CI only)
- **Candidate:** the latest upstream stable, `1.4.5+a7733435c`
- **Production status:** blocked, unchanged

## Question

[`G2-T01-QUALIFICATION.md`](G2-T01-QUALIFICATION.md) closed the 2026-07-16 checkpoint with: rerun this gate when upstream publishes a stable `1.4.x`, and require a new human production-toolchain acceptance after archive, clean-checkout, browser and supply-chain qualification of that stable. Upstream has published six: `1.4.0` to `1.4.5`. This document is the rerun, on the latest of them, opened on 2026-11-24 by an agent session mandated to open the qualification. It answers two questions: does that stable carry the Rust line the pin carries, and which of the qualification steps can be measured without a human.

## Upstream criteria, measured

Each row is a stable release, resolved with `gh release list --repo oven-sh/bun --limit 30 --exclude-drafts --exclude-pre-releases`, its tag resolved with `git ls-remote https://github.com/oven-sh/bun.git refs/tags/<tag>`. The tree columns come from a treeless bare clone of `oven-sh/bun` (`git clone --bare --filter=tree:0`), then `git ls-tree` at each commit; the ancestry columns from `git merge-base --is-ancestor 57f349f6307cf89dcfb8893f003c1ef421a74589 <commit>` and `git rev-list --count 57f349f…..<commit>`.

| Release | Commit | Pin is an ancestor | Commits ahead of the pin | Root `Cargo.toml` | Paths ending `.zig` |
| --- | --- | --- | --- | --- | --- |
| `bun-v1.3.14` | `0d9b296af33f2b851fcbf4df3e9ec89751734ba4` | no | 0 (the pin is 903 ahead of it: `git rev-list --count 0d9b296…..57f349f…`) | absent | 1299 |
| `bun-v1.4.0` | `34cbb9a40b4bd1bd767d134a7065e66c2432a676` | yes | 1133 | present | 0 |
| `bun-v1.4.1` | `4661e494f052c83c80dade1318e5710238340be6` | yes | 1609 | present | 0 |
| `bun-v1.4.2` | `744846f844374847c902b5e7fd59b4342a51ef99` | yes | 1621 | present | 0 |
| `bun-v1.4.3` | `c6da4a4d3010e5553438c60f6bd76d981976867c` | yes | 2133 | present | 0 |
| `bun-v1.4.4` | `38afee6c84fcf48c0edb2466aa4b27d287a59c30` | yes | 2305 | present | 0 |
| **`bun-v1.4.5`** | `a7733435cf40429e3b35c36072769df2052b80f1` | **yes** | **2329** | **present** | **0** |

The candidate, in detail:

| Criterion | Measure | Command |
| --- | --- | --- |
| Release is stable | `draft: false`, `prerelease: false`, `published_at` 2026-11-19T08:47:28Z, `immutable: false` | `gh api repos/oven-sh/bun/releases/tags/bun-v1.4.5 --jq '{draft, prerelease, published_at, immutable}'` |
| Tag target | `a7733435cf40429e3b35c36072769df2052b80f1`, the `target_commitish` of the release | `git ls-remote https://github.com/oven-sh/bun.git refs/tags/bun-v1.4.5` |
| Root `Cargo.toml` | blob `985da8472b40d4c1fb52c88608774bdaa904e7fb` at the candidate; `3d43080b43ff533b6497940cc61ad089fdb762d4` at the pin | `git ls-tree <commit> -- Cargo.toml` |
| No Zig sources | 0 paths ending `.zig`, no `build.zig` at the root, at the candidate and at the pin; 13 paths of the candidate carry `zig` in their name (`src/jsc/ZigException.rs`, `src/jsc/bindings/ZigException.cpp`, …), none ends in `.zig` | `git ls-tree -r --name-only <commit> \| grep -c '\.zig$'` |
| Ancestry, first instrument | the pin is an ancestor of the candidate; the candidate is not an ancestor of the pin; merge base is the pin; 2329 ahead, 0 behind | `git merge-base --is-ancestor`, `git rev-list --count` |
| Ancestry, second instrument | GitHub compare: `status=ahead ahead_by=2329 behind_by=0`, merge base `57f349f6307cf89dcfb8893f003c1ef421a74589` | `gh api repos/oven-sh/bun/compare/57f349f…...a7733435… --jq '…'` |
| Same version on the registry the freshness gate reads | npm `dist-tags.latest` is `1.4.5`, published 2026-11-19T08:54:36.807Z | `curl -s https://registry.npmjs.org/bun \| jq -r '."dist-tags".latest, .time["1.4.5"]'`; `bun run check:toolchain-freshness` prints `held: bun 1.4.0-canary.1+57f349f63: 1.4.5 was published 2026-11-19T08:54:36.807Z; held until 2026-12-31` |
| Age against the floor | 425442 s at 2026-11-24T06:58:10Z, floor 259200 s (`bunfig.toml` `minimumReleaseAge`): older than the floor | `date -u`, `grep minimumReleaseAge bunfig.toml` |

What these measures do not show: that the build of `1.4.5` invokes no Zig toolchain (only the tree was read, not the build scripts), and that the root `Cargo.toml` is the workspace the pin's was. The 2026-07-16 checkpoint used the same two measures (root `Cargo.toml`, ancestry) and had no Zig measure; the Zig row is added here because it separates `1.3.14` (1299 files) from every `1.4.x` (0).

## Archives of the platforms the manifest lists

`toolchains/bun.json` lists `darwin-arm64` and `linux-x64`. Archives downloaded with `gh release download bun-v1.4.5 --repo oven-sh/bun -p bun-darwin-aarch64.zip -p bun-linux-x64.zip -p SHASUMS256.txt`.

| Platform | Archive | Bytes | SHA-256 computed on the download | Equals `SHASUMS256.txt` of the release | Equals the `digest` of the asset on the releases API |
| --- | --- | --- | --- | --- | --- |
| `darwin-arm64` | `bun-darwin-aarch64.zip` | 39827261 | `b5d6bc2e13caf14e57c89661e89efd073ff16165b41bfe43882616410609cd10` | yes (`shasum -a 256 -c`: `OK`) | yes |
| `linux-x64` | `bun-linux-x64.zip` | 51336055 | `94559b3b528995a49452f9f2404cec74f2efd7d06e0a000a8cd214b02c3666eb` | yes (`shasum -a 256 -c`: `OK`) | yes |

The API column is `gh api repos/oven-sh/bun/releases/tags/bun-v1.4.5 --jq '.assets[] | "\(.name)\t\(.digest)"'`. The `darwin-arm64` binary, extracted, reports `1.4.5+a7733435c` (`bun --revision`), the first nine characters of the tag commit. The `linux-x64` binary was **not executed**: the measuring host is macOS. The signature `SHASUMS256.txt.asc` was fetched; its signer is `F3DCC08A8572C0749B3E18888EAB4D40A7B22B59` (EdDSA), `gpg --verify` answers `Can't check signature: No public key`, and no key was obtained: **the signature is not verified**. The cleartext it signs equals `SHASUMS256.txt` byte for byte, up to the final newline the clearsign format adds.

For comparison, the pin's `darwin-arm64` archive is `4d4bdb8e3ca1b41dede0ce423871b3804424bd785c6435e43c625a60a49f2f02` and its `linux-x64` archive `83144e2542c33aaae541cf16b42f8cf1c55c3b94c5395fc776417fa27e95bcbf`, both read from the durable release `toolchain-bun-1.4.0-canary.1-57f349f63`.

## The repository under the candidate

Binaries: pin `1.4.0-canary.1+57f349f63`, candidate `1.4.5+a7733435c`, both `bun-darwin-aarch64.zip`, extracted into a scratch directory; each command run with that directory first on `PATH`. Base: `cbd768cc7518bf145a29f3cdcd7c2952e3a334e9`, a fresh clone.

| Command | Under the pin | Under 1.4.5 |
| --- | --- | --- |
| `bun install --frozen-lockfile` | exit 0 | exit 0, `bun.lock` unchanged (`git status --short` empty), same 16 packages in `node_modules/.bun` |
| `bun test` (full) | 9627 pass, 1 skip, 56 fail | 9626 pass, 1 skip, 57 fail |
| `bun run lint` and `bun run typecheck` | exit 0 | exit 0 |
| the 42 other steps of `scripts.check` run one by one (`jq -r .scripts.check package.json`) | 40 exit 0, 2 exit 1: `check:attestation`, `check:skills-commands` | 39 exit 0, 3 exit 1: the same two, and `check:toolchain` |

Replayed against the base, each red under 1.4.5:

| Red under 1.4.5 | Same step under the pin on the same base | Cause |
| --- | --- | --- |
| `check:attestation` | red | git and network refused by the measuring sandbox |
| `check:skills-commands` | red | no pseudo-terminal in the measuring sandbox |
| 55 of the 57 failing tests | the same 55 fail | the sandbox, `mkdtemp` and git refused |
| `tools/quality/work-package-policy.test.ts`, premise test | green | `Bun.YAML.parse` throws on a NUL where the pin truncates |
| `distribution/templates/langgraph-gates/langgraph-gates.test.ts`, « a minimum that is not an x.y.z version » | green | `Bun.semver.order` throws on a range where the pin orders it |
| `check:toolchain` | green | three assertions: `Bun version 1.4.5 does not match 1.4.0`, `Bun revision 1.4.5+a7733435c does not match 1.4.0-canary.1+57f349f63`, `Bun revision does not contain the pinned source commit`. This is the exact-pin gate: it is the site the replacement moves, not a defect |

The base fails 56 tests under the pin and 57 under 1.4.5 on a fresh clone: the difference is the two above, minus one test of `check-rule-feedback.test.ts` that depends on a fetch and passes or fails with the state of the fetch cache.

The two behavioural reds are removed by `libre-ai/project-governance#324`, written for this qualification (measured on its head `9ccea05c8903c5fe7b07e50fe647a07266fd214d`, before a merge of the served branch). On that head, `bun test` gives 9669 pass, 1 skip, 55 fail under each binary, with identical lists of failing tests. The same pull request records a differential of `Bun.semver.order` over 480249 pairs of valid versions: 28922 differ between the two binaries as written, 0 once build metadata is cut. Until #324 is merged, the two reds above stand.

## What the upstream licence file declares

The candidate's `LICENSE.md` is not the file tracked under `toolchains/notices/bun/1.4.0-canary.1+57f349f63/BUN-LICENSE.md`. Facts only; the review is the human gate.

| | Pin | Candidate |
| --- | --- | --- |
| `LICENSE.md` bytes | 5500 | 14778 |
| `LICENSE.md` SHA-256 | `38892ba0953585b366646ed0ffd9c22ca072e08a211b167a4768cf16c1a4dbce` (equals the tracked `BUN-LICENSE.md`) | `362fe32c954ec829240bd7429c53d705eef08c6bfa45ffc2d02005f857cba4dd` |
| Difference | | 1 line changed (`libicu` 72 to 78), 32 lines added (`diff` of the two files): ports and uses of `typescript-go`, ESLint, `typescript-eslint`, `esquery`, oxlint, Prettier, the Biome and oxc formatters and others, each with its licence column (Apache 2.0, MIT, BSD 3-Clause, BSD 2-Clause, ISC) |

Command: `git show <commit>:LICENSE.md | shasum -a 256`, then `diff` of the two files. WebKit source revision pinned by Bun (`scripts/build/deps/webkit.ts`, `WEBKIT_VERSION`): `4895f45dfbd0d1226c4d41799887bc0ecb9f341b` at the pin (equal to the tracked notice), `d6375c72affe0f70222cdcb45012b10f0bf3a9d5` at the candidate.

## Sites that move at replacement

Counted on the base with `git grep -c -E '<forms>'`, the forms being the pinned version without and with its revision (`1.4.0-canary.1`, `57f349f63`), the 40-character source commit, and the three SHA-256 values of `assets.darwin-arm64`, `assets.linux-x64` and `sourceArchive` of `toolchains/bun.json`: **72 files, 184 lines**. The list of files is `git grep -c -E '<forms>' | sort`.

| Area | Files | Lines | Kind (hypothesis, to be settled at replacement) |
| --- | --- | --- | --- |
| `.github/workflows` | 24 | 87 | moves: version, revision, archive URL, SHA-256 of the install step |
| `.github/composition` | 3 | 7 | moves: `check-products.py`, `install-toolchains.sh`, `test_install_toolchains.py` |
| `toolchains/bun.json` | 1 | 11 | moves: the manifest itself |
| `toolchains/notices` | 2 | 5 | a new directory per revision (`NOTICE.md`, `BUN-LICENSE.md`, `SHA256SUMS`); the present one stays as the record of the pin |
| `package.json` | 1 | 1 | moves: `packageManager` |
| `CONTRIBUTING.md`, `REUSE.toml`, `docs/LOCAL-COMPOSITION.md` | 3 | 4 | moves |
| `docs/toolchain` | 2 | 9 | `BUN-QUALIFICATION.md` moves; `G2-T01-QUALIFICATION.md` is a dated record |
| `ecosystem/toolchain-freshness-exceptions.v1.yaml` | 1 | 1 | the entry holding the pin until 2026-12-31: removal is an edit of a gated surface (`GATED_PATH_PATTERNS`), not made here |
| `ecosystem/check-toolchain-source.test.ts`, `tools/fleet/check-toolchain-freshness.test.ts`, `tools/quality/bootstrap.test.ts`, `tools/quality/bun-version.test.ts`, `tools/quality/check-personal-data-boundary.test.ts`, `tools/security/advisories.test.ts` | 6 | 12 | fixtures and expected values: to be read one by one |
| `tools/quality/toml-document.ts`, `tools/security/advisories.ts`, `tools/attestation/neutralise-check.ts` | 3 | 4 | code that names a version in a comment or a message: to be read one by one |
| `tools/fleet/fixtures` | 5 | 13 | fixtures of past generations: expected to stay |
| `docs/reviews`, `docs/adr`, `docs/superpowers`, `docs/transformation`, `docs/migration`, `docs/security`, `docs/architecture` | 21 | 30 | dated records: expected to stay |

Sites outside the tree: the durable release `toolchain-bun-<version>` (unmodified binaries, source archive, checksums, notices) that the CI install step downloads, the gitignored local snapshot `.tools/snapshots/bun/<revision>`, and a regenerated `bun.lock` (`bun install --frozen-lockfile` leaves it unchanged under 1.4.5 today).

## What remains

None of these is done, and none is asserted by this document.

| Item | Why it is not done here |
| --- | --- |
| Durable archive of the candidate: unmodified binaries, exact source archive and its SHA-256, checksums, verbatim licence and redistribution notice | creates a release of this organisation; an act outside the repository |
| Clean Linux x64 checkout that verifies the exact binaries, source, notices and checksums (`WP-G2-T01` acceptance 1) | the measuring host is macOS; the `linux-x64` binary was not executed |
| Bun, TypeScript, browser and Cargo gates in CI without a bootstrap-only exception (`WP-G2-T01` acceptance 2) | CI runs from a pull request that replaces the pin, which this one does not |
| Browser qualification (the three Playwright engines of `toolchains/notebook-qualification.json`) | not run |
| Verification of the signature of `SHASUMS256.txt.asc` | no public key for `F3DCC08A8572C0749B3E18888EAB4D40A7B22B59` was obtained or trusted |
| `supply-chain-license-review` (human gate) | the licence file differs from the tracked one (see above); the review is a human act |
| `toolchain-production-acceptance` (human gate) | a human act; production and Clever provisioning stay blocked |
| Replacement of the pin, regeneration of `bun.lock`, removal of the freshness exception, move of the sites above | after the gates, in a separate pull request |

Failure of any item leaves production and Clever provisioning explicitly blocked (`WP-G2-T01` acceptance 4).
