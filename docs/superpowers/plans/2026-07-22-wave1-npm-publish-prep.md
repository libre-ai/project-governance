# Wave-1 npm publication prep — implementation plan

**Goal:** everything publish-ready so the owner's npm day next week reduces to:
npm org 2FA/token, GitHub environment secret, satellite repo creation, and
running the release workflow. No package is published by this change.

**Trigger:** the `@libre-ai` npm scope is now reserved (owner, 2026-07-22) —
the documented condition that kept `private: true` on the satellites.

**Verified facts this plan builds on (empirical + bun source):**

- `bun publish`/`bun pm pack` materialize `workspace:*` (lockfile version) and
  `catalog:` refs into real semver in the published `package.json`, across all
  dependency groups (dependencies/dev/peer/optional). No custom tooling needed.
- `bun pm pack` respects `files` **including `!` negation** (verified: test
  files excluded on this repo's bun 1.4.0-canary.1).
- `private: true` blocks publish (not pack); `--access`, `--tag`, `--otp`,
  `--dry-run` exist; **no `--provenance`** in this bun (deferred, runbook note).
- `packages/auth-web` consumes `secureResponse` from `@libre-ai/web-platform`
  (security-hardening helper — duplication would create drift on a security
  surface) → **`@libre-ai/web-platform` joins the publish set** (dependency
  closure; documented as owner-vetoable since EXECUTION-SEQUENCING names only
  ui/auth/sdk-ts).

## Decisions taken (owner-vetoable, recorded in runbook)

1. **Publish set = 4 packages**: `@libre-ai/contracts` (sdk-ts), `@libre-ai/ui`,
   `@libre-ai/auth-web`, `@libre-ai/web-platform` (closure).
2. **Bun-first TS-source publishing**: ship `src/` TypeScript directly (exports
   already point to `.ts`; bun consumers run it natively, modern TS resolves
   source-as-types). `types` field added. A `dist` build can be added later
   without breaking. Documented in each vitrine.
3. **Linked versioning**: the 4 packages share one version (0.1.0), bumped
   together by the release tool.
4. **Peers**: `react`(+`react-dom`) become `peerDependencies` of `ui` and
   `web-platform` (published component/foundation libs must not carry their own
   React); `tailwindcss` becomes an optional peer of `ui` (only the
   `./tailwind` export needs it).
5. **Publish auth**: GitHub environment `npm-publish` + `NPM_TOKEN` secret
   (owner-created); provenance/trusted-publishing deferred (no bun flag).

## Tasks

1. **Package metadata ×4** — remove `private`, add `files` (src + README +
   LICENSE, `!**/*.test.*`), `types`, per-package `LICENSE` copied from
   `LICENSES/` (Apache-2.0: ui/contracts/web-platform; EUPL-1.2: auth-web),
   peer moves (decision 4), keep `publishConfig.access: "public"`.
2. **`tools/release/publish-preflight.ts` (+ test, TDD)** — fail-closed gate:
   for each satellite, real `bun pm pack` into a temp dir, then inspect the
   tarball's `package.json`: no `workspace:`/`catalog:` residue, not private,
   version coherence across the set, LICENSE present in tarball, zero
   `*.test.*` entries. Pure analysis functions unit-tested; CLI entry.
3. **`tools/release/bump-version.ts` (+ test, TDD)** — linked bump across the
   4 manifests (patch/minor/major or explicit version), refuses drift.
4. **`.github/workflows/release.yml`** — `workflow_dispatch` (input `dry_run`,
   default true): job `preflight` (no secrets: install frozen, tests of the 4
   packages, publish-preflight); job `publish` (needs preflight, environment
   `npm-publish`, skipped when dry_run) publishing in dependency order
   contracts → web-platform → ui → auth-web via `bun publish --access public`.
5. **`tools/release/mirror-satellites.sh` (documented, not executed)** —
   `git subtree split` per package → push to `libre-ai/{sdk-ts,ui,auth}` mirror
   repos (created by owner); read-only posture documented (mirror README banner
   - no direct pushes).
6. **Vitrines ×4 + runbook** — update publication paragraphs (scope reserved,
   publish-ready, TS-source note, peers note); write
   `docs/transformation/WAVE1-PUBLICATION-RUNBOOK.md` with the owner's exact
   step-by-step for next week + the decision log above + wave-1 exit checklist
   (usage réel, coverage metrics publiées, évidence scellée).
7. **Coverage evidence snapshot** — regenerate a dated coverage JSON via the
   existing `distribution/evidence/coverage-metrics.ts`.
8. **Gates + review** — full sweep (tests, tsc, biome, check:licenses,
   check:source), one adversarial K4 review with supply-chain/licensing lens,
   PR, CI green, merge.
