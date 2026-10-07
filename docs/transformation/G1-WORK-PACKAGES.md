# G1 locked work packages

- **Status:** locked package topology; simulation-only `WP-G2-A01` definition reviewed and schedulable
- **Machine authority:** [`work-packages.v1.json`](work-packages.v1.json)
- **Schema:** [`contracts/schemas/work-package-plan.v1.schema.json`](../../contracts/schemas/work-package-plan.v1.schema.json)

G1 defines 27 bounded packages. A package is ready to schedule when its dependencies are merged; `locked` means its repository boundary and acceptance are no longer delegated to an implementation agent.

## Execution rules

- one branch/worktree per package and only its `writePaths` ;
- ADR-0005 is the sole early-path exception: `WP-G3-N01` retains `apps/notebook/**`, while a disabled public-fixture-only Gate B slice may be qualified during G2 without starting G3; root lockfiles still require `WP-G2-T01` integration ;
- authorities in `readAuthorities` are read-only unless architecture/security approve a coordinated contract change ;
- root manifests/catalogs/lockfiles stay under `WP-G2-T01`; later packages submit dependency requests to that integrator instead of editing shared roots ;
- dependency artifact hashes are recorded before work begins ;
- packages in one parallel group may run together only after their shared predecessors merge ;
- every merge report lists files, contract impact, tests/evidence, security/PII impact and remaining debt ;
- a high/critical package cannot self-approve its `humanGates` ;
- for ADR-0003 in solo-maintainer mode, technical review evidence is produced by independent agents under `docs/reviews/AGENT-REVIEW-PROTOCOL.md`; the historical `humanGates` key records owner acceptance gates, not reviewer identity ;
- no `infrastructure/clever-cloud` write or secret operation before `WP-G4-I01` ;
- failed security, data, contract or rollback evidence blocks all dependent packages.

## G2 — foundations

| Group | Package | Result |
| --- | --- | --- |
| `g2-0` | `WP-G2-T01` | production-qualified Bun/Rust toolchain and sole root dependency authority |
| `g2-1` | `WP-G2-C01` | TS/Rust contract projections and validators |
| `g2-2` | `WP-G2-K01` | Knowledge/ecosystem engine |
| `g2-2` | `WP-G2-W01` | Bun/React/design/PWA template |
| `g2-2` | `WP-G2-Z01` | specialized Biscuit capability |
| `g2-2` | `WP-G2-P01` | Proof and Artifact |
| `g2-2` | `WP-G2-S01` | four locked Rust/WASM product boundaries; only Notebook has an experimental engine |
| `g2-3` | `WP-G2-I01` | provider-neutral OIDC and opaque browser sessions |
| `g2-4` | `WP-G2-D01` | PostgreSQL/RLS, retention and deletion platform |
| `g2-5` | `WP-G2-Q01` | clean-checkout integrated foundation evidence |
| `g2-6` | `WP-G2-A01` | deterministic agent control core against a fake harness, without OS/runtime capabilities |

The role-separated definition verdicts for `WP-G2-A01` are recorded under [`../reviews/agent-orchestration-wp-g2-a01/`](../reviews/agent-orchestration-wp-g2-a01/); result conformance remains a separate future gate.

No application reconstruction starts before `WP-G2-Q01`. ADR-0005 does not alter that dependency: it permits only the disabled Notebook product-host slice needed to test the exact Gate B boundary with public fixtures. The canary remains bootstrap-only until `WP-G2-T01` explicitly qualifies a stable Rust-line Bun release. `WP-G2-S01` keeps `notebook-core` as the sole ContextDocument canonicalization authority and creates neither `crates/context` nor an orchestrator inside S01. The separate `WP-G2-A01` may create only a simulation-only control core under its exclusive paths; harness runtime, Pi launch and real Missions execution remain blocked. Practices scoring remains excluded; its WIT stays reserved until a new human-approved package demonstrates a real invariant.

## G3 — parallel experiences

All nine applications run in `g3-1` with exclusive `apps/<name>/**` ownership:

`WP-G3-W01` Website, `WP-G3-P01` Practices, `WP-G3-R01` Radar, `WP-G3-N01` Notebook, `WP-G3-S01` Sessions, `WP-G3-M01` Model Policy, `WP-G3-B01` Boussole, `WP-G3-F01` Specifications and `WP-G3-A01` Missions.

They integrate continuously through locked contracts, never direct database access. Final G3 conformance runs in parallel:

- `WP-G3-X01` — SpecPackage → planning handoff → Mission → Proof/Artifact chain ;
- `WP-G3-X02` — adversarial tenant, RLS, retention, deletion, restore and logging ;
- `WP-G3-X03` — three-browser, accessibility, mobile, offline and degraded-mode qualification.

## G4/G5 — infrastructure, one cutover, distribution

`WP-G4-I01` is the first package allowed to provision Clever Cloud Paris/EU. `WP-G4-H01` qualifies the deployed global candidate and rollback. `WP-G4-C01` performs one human-approved global cutover; it forbids staged product cutovers. `WP-G5-D01` then publishes one-way sovereign distribution artifacts and independent reproduction evidence.

## G1 closure condition

G1 closes when the machine plan validates, dependency graph is acyclic, write paths do not overlap, every application appears exactly once, every critical package has human gates and no pre-G4 package can write infrastructure. Local implementation choices may vary only when they do not change these boundaries or a canonical contract.
