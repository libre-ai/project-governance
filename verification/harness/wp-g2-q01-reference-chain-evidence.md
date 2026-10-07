# WP-G2-Q01 reference-chain evidence

Foundation reference chain (acceptance criterion 1), run end-to-end by
`verification/harness/reference-chain.ts`. Evidence is digest-anchored over
the reproducible facts (ordered `id:status`); volatile durations are recorded
but excluded from the digest.

## 2026-08-19 — post-γ perimeter (current)

Migration γ (ADR-0020, `docs/adr/0020-general-activation-and-hub-dismantling.md`)
split the pre-γ monorepo across repositories and froze the hub
(`libre-ai/libre-ai`) read-only. Every step below is native to
`libre-ai/governance` today; the pre-γ steps that tested components which
left this repository (contracts, generated-contracts, web-react, biscuit,
wit, proof-artifact, rls, playwright) are retired, each with its migration
destination cited in `verification/harness/reference-chain.ts`'s module doc.

- **Status:** `passed` (3/3 steps, no skips)
- **Reproducible digest:** `ac27bd4090ca1d44c1b1e00b954bbd5337ab84bf1c9eceac4e09888e06cbbd01`

| Step        | Status | Evidence                                                                                                                                                                                                                                                                                              |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| check       | passed | `bun run check` — governance's own quality-gate chain (Bun floor, source policy, retired names, forgetting register, project cards, knowledge objects, objectives, specification locks, licenses, dead code, allowances, kernel-status-authority, skills, skills-routing, lint, typecheck, 827 tests) |
| secret-scan | passed | no committed credential markers                                                                                                                                                                                                                                                                       |
| no-clever   | passed | no Clever resource / production claim                                                                                                                                                                                                                                                                 |

Reproduced from a fresh `git worktree add --detach` of `origin/main`
(`53d53d2`), `bun install --frozen-lockfile`, then
`bun verification/harness/reference-chain.ts` — no chain step skipped.

## 2026-07-20 — pre-γ perimeter (historical, superseded)

Run end-to-end from a clean checkout of `main` after the WP-G2-D01 merge
(`43c85e7`), when Bun.serve, React, contracts, RLS, Biscuit, WIT, Proof,
Artifact and Playwright still all lived in the same monorepo checkout. Kept
for history only — this digest is no longer reproducible from
`libre-ai/governance` and is not compared against by `verification/adoption/
reproduce.ts`.

- **Status (historical):** `passed` (10/10 steps, no skips)
- **Historical digest (pre-γ, superseded):** `f45dfad03581f3d56ea53ca74a7b9ac3034ef7ce7013eebe6eac71cc3959a89f`

| Step                | Status | Evidence                                                                                                          |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| contracts           | passed | 85 catalog entries, 59 schema-fixture pairs, 113 HTTP operations                                                  |
| generated-contracts | passed | 60 TypeScript contract projections verified                                                                       |
| web-react           | passed | Bun.serve + React web-platform tests                                                                              |
| biscuit             | passed | 16 authorization tests (attenuation, revocation, rotation, fail-closed)                                           |
| wit                 | passed | 9 WIT worlds parsed via the contract checker                                                                      |
| proof-artifact      | passed | 17 artifact/evidence-binding tests                                                                                |
| secret-scan         | passed | no committed credential markers (acceptance 2)                                                                    |
| no-clever           | passed | no Clever resource / production claim (acceptance 3)                                                              |
| rls                 | passed | 35 tenant-isolation tests over 3 files (raw-SQL barrier, adapters, active deletion)                               |
| playwright          | passed | 9 three-engine e2e (chromium/firefox/webkit): SSR+hydration, no-JS, PWA offline, reduced-motion, security headers |

Not cryptographically signed: signing waits for the provenance brick (wave 2),
consistent with the P3 lineage deferral (no key ceremony authorized,
WP-G2-Z01). The current (2026-08-19) chain reproduces to the same digest on
re-run.
