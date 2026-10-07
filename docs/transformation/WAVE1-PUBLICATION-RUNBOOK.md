# Wave-1 publication runbook — the owner's npm day

Everything below the "Owner steps" line is prepared and CI-proven; nothing is
published until the owner runs it. Trigger recorded: the npm `@libre-ai` scope
was reserved by the owner on 2026-07-22.

## What is already prepared (this repository)

- **Publish set (4, linked version 0.1.0):** `@libre-ai/contracts` (sdk-ts),
  `@libre-ai/web-platform`, `@libre-ai/ui`, `@libre-ai/auth-web`.
  `web-platform` is in the set by dependency closure (auth-web consumes its
  `secureResponse` hardening helper); EXECUTION-SEQUENCING names only
  ui/auth/sdk-ts — **owner-vetoable** (veto = re-adding `private: true` and
  dropping it from `tools/release/publish-preflight.ts`).
- **Self-contained tarballs:** contracts vendors the 61 canonical schemas
  (`schemas/`, byte-exact drift gate in `generate:check`); the registry loads
  the packaged copy by default — the old default resolved the monorepo root
  and would have broken every npm install.
- **Metadata:** `private` lifted (trigger satisfied), `types`, `files` (tests
  excluded — verified empirically), per-package `LICENSE` (Apache-2.0:
  contracts/ui/web-platform; EUPL-1.2: auth-web, per ADR-0004),
  `publishConfig.access=public`, react/react-dom (+optional tailwindcss) as
  peers on the libraries.
- **Materialization proven:** `bun publish`/`bun pm pack` rewrite
  `workspace:*` and `catalog:` refs into real semver in every dependency group
  (verified against bun's source and empirically on these packages).
- **`@libre-ai/ui` dual runtime:** ships a compiled `dist/` (ESM, React
  automatic runtime, react/react-dom/react-aria-components external) for
  Node/Vite/Next consumers, plus `src/` for Bun (the `bun` export condition) and
  for types. The `dist/` is built just before its pack (release-time only, never
  committed); the other three satellites stay TS-source (their consumers run on
  the Bun server runtime).
- **Gates:** `tools/release/publish-preflight.ts` packs each satellite for
  real and fails closed on any workspace:/catalog: residue, private flag,
  missing LICENSE, leaked test file, version drift, wrong per-package SPDX
  license, or an `exports`/`types` target absent from the tarball. Green on all 4.
- **Automation:** `.github/workflows/release.yml` (manual dispatch, dry-run by
  default; the publish job needs the `npm-publish` environment) and
  `tools/release/bump-version.ts` (linked bump).
- **Mirrors:** `tools/release/mirror-satellites.sh` (git subtree split → push;
  not executed — repos do not exist yet).

## Owner steps (next week, in order)

1. **npm org hygiene** — on npmjs.com: enforce 2FA on the `@libre-ai` org;
   create a **granular access token** scoped to publish the four packages
   (expiry short; store nowhere but the GitHub environment below).
2. **GitHub environment** — repo Settings → Environments → create
   `npm-publish`; add secret `NPM_TOKEN`; (recommended) require your manual
   approval on the environment.
3. **Dry run** — Actions → "Release satellites" → Run workflow with
   `dry_run: true` (default). Green = preflight re-proven on CI hardware.
4. **Publish** — re-run with `dry_run: false`; approve the environment gate.
   Order is dependency-safe (contracts → web-platform → ui → auth-web).
   Auth path: the workflow packs each satellite with `bun pm pack` and publishes
   the tarball with `npm publish <tgz> --access public --provenance` — the
   battle-tested npm auth path. `actions/setup-node` writes the registry
   `.npmrc`; the token is passed as `NODE_AUTH_TOKEN` (the secret `NPM_TOKEN`).
   The `--provenance` flag needs the job's `id-token: write` permission (already
   declared) and a public repository; it attaches a signed build attestation
   linking each package to this workflow run. `@libre-ai/ui` is built to `dist/`
   just before its pack (release-time only).
   OTP: if the token strategy requires it, publish locally instead —
   `cd packages/<p> && bun pm pack && npm publish <tgz> --access public --otp <code>`
   in the same order (build `ui` first with `bun run --cwd packages/ui build`).
5. **Wave-1 exit gate (real-usage proof)** — run `bun tools/release/starter-npm-proof.ts`
   to extract the starter template out of the workspace and install it from the npm
   registry; on success, a dated evidence JSON is written to `distribution/evidence/`.
   Commit the produced evidence.
6. **Mirror repositories** — create `libre-ai/sdk-ts`, `libre-ai/ui`,
   `libre-ai/auth`, `libre-ai/starter` (public, empty, no README); disable issues/PRs;
   then run `tools/release/mirror-satellites.sh`; protect `main` on each mirror.
   Decide whether `web-platform` gets a reserved mirror name (npm-only until
   then).
7. **Inventory + evidence** — update `ecosystem/repositories.v1.yaml`
   (satellites → published state), append the publication entry to
   `distribution/evidence/gate-acceptance-log.md`, regenerate a coverage
   snapshot (`bun distribution/evidence/coverage-metrics.ts`).

## Wave-1 exit checklist (after publication)

- [ ] Each published brick consumed by real usage outside the hub workspace
      (extracted and installed from npm) — the wave's exit gate, proven by the
      starter template installation (`starter-npm-proof` evidence committed to
      `distribution/evidence/`).
- [ ] Coverage metrics published (share of operations without human touch).
- [ ] Evidence sealed (gate-acceptance-log + dated coverage JSON + starter proof).

## Deferred / explicitly not done here

- `sdk-rs` satellite (EXECUTION-SEQUENCING defers it).
- Per-package NOTICE files aggregating dependency licenses (LICENSE ships;
  deps' licenses are visible on npm) — add if the licensing gate evolves.
- A compiled `dist/` for `contracts`/`web-platform`/`auth-web`: not done — their
  real consumers run on the Bun server runtime, so TS-source publishing fits.
  Only `@libre-ai/ui` (browser React components consumed by Node/Vite/Next) ships
  a `dist/`.
