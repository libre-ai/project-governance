# WP-G2-T01 — W01 web dependency intake

- **Checkpoint:** 2026-07-16
- **Requesting package:** `WP-G2-W01`
- **Status:** automated evidence passes; `supply-chain-license-review` accepted by human disposition on 2026-07-16
- **Production status:** blocked by `G2-T01-QUALIFICATION.md`

## Atomic integration disposition

W01 owns the three package manifests. T01 remains the sole writer of the root `bun.lock`.
A lock-only branch cannot pass `bun install --frozen-lockfile` before the corresponding Bun
workspaces exist, so the manifest and lock changes must land atomically.

The 0BSD licence used by `tslib` was not in the existing closed allow-list. The human disposition
on 2026-07-16 authorized one anticipatory Q01 change, limited to adding the reviewed `0BSD` SPDX
identifier in `tools/quality/check-js-licenses.ts`. This resolves the dependency cycle without
starting Q01 or approving its future `g2-foundation-acceptance` gate.

## Direct catalog entries

| Package | Exact version | Licence | Purpose |
| --- | --- | --- | --- |
| `react` | `19.2.7` | MIT | document and client component runtime |
| `react-dom` | `19.2.7` | MIT | SSR and hydration |
| `react-aria-components` | `1.19.0` | Apache-2.0 | accessible interaction primitive |
| `tailwindcss` | `4.3.2` | MIT | bounded deterministic utility compiler |
| `@playwright/test` | `1.61.1` | Apache-2.0 | existing three-engine browser evidence |

All versions were already pinned in the root catalogs. The lock adds no second package manager,
lockfile, registry override, install script or runtime service.

## Added transitive dependency review

- Apache-2.0: `@internationalized/date@3.12.2`, `@internationalized/number@3.6.7`,
  `@internationalized/string@3.2.9`, `@react-types/shared@3.36.0`, `@swc/helpers@0.5.23`,
  `react-aria@3.50.0`, `react-stately@3.48.0`.
- MIT: `aria-hidden@1.2.6`, `client-only@0.0.1`, `clsx@2.1.1`, `scheduler@0.27.0`,
  `use-sync-external-store@1.6.0` plus the direct MIT packages above.
- 0BSD: `tslib@2.8.1`. Its notice permits use, copy, modification and distribution for any
  purpose, with or without fee, and contains only warranty/liability disclaimers. It is permissive,
  OSI-compatible and introduces no copyleft, source-available or network-service obligation.

The Bun lock records registry integrity hashes for every package. No package accesses product data,
creates an external processor, provisions infrastructure or introduces a proprietary data format.

## Automated evidence

```text
bun install --frozen-lockfile                PASS (with W01 manifests present)
bun run check:licenses                       PASS — 40 package identities
bun audit                                    PASS — no vulnerabilities found
bun run check                                PASS (qualification rerun before publication)
bun run --cwd distribution/templates/bun-app test:e2e
                                             PASS — browser evidence recorded by W01
```

## Human review outcome

The repository owner accepted the web dependency closure, lock delta and permissive 0BSD licence by
explicit human disposition on 2026-07-16. This closes `supply-chain-license-review` for W01 only.

The following remains deliberately unapproved:

- production use of the Bun canary;
- G2 foundation acceptance;
- any Clever Cloud provisioning.
