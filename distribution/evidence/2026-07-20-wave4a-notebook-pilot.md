# Wave 4a — Notebook pilot: end-to-end app pattern validated (2026-07-20)

Wave 4a's role (EXECUTION-SEQUENCING, ADR-0011 D1) is to **validate the app
pattern once, end to end** — contract → engine → app → review — before the
parallel replication of wave 4b. This evidence records that the pattern holds
for the Notebook pilot, within the Gate B scope (exact disabled fixture-only
host, qualified 32+ GiB class; no activation, user-data or release authority).

## The four stages, each with its evidence

| Stage        | Artifact                                                                         | Evidence                                                                                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contract** | Notebook Core v2 (`notebook-core-v1/v2` WIT worlds, `notebook-backup.*` schemas) | locked catalog authorities; contract vectors verified by `check:contracts` (green on every main run)                                                                                                                                                          |
| **Engine**   | `crates/notebook-core` (`libre-ai-notebook-core`)                                | Rust tests + capability-free WASM built and **reproducibly** rebuilt (`cmp` + sha256) by the `Rust quality` gate; WASM import/memory-cap check                                                                                                                |
| **App**      | `apps/notebook`                                                                  | 23 unit tests green; fixture-host build green (`bun run build`, backup disabled per Gate B default); consumes the renamed `@libre-ai/ui` cleanly                                                                                                              |
| **Review**   | Gate B                                                                           | **approved in G2** on immutable candidate `9ee3f8d` (PR #106): architecture, security, cryptography-runtime, France/EU privacy, performance/resources and Gate B synthesis all approve; three-engine Playwright crash/kill/restart recovery evidence recorded |

## What is validated

- The pattern **contract → engine → app → review** produces a usable and
  verifiable app: the Notebook fixture host builds and runs, its unit tests
  pass, and its Gate B qualification (the independent review) is approved.
- The wave-1 rename (`@libre-ai/design-system` → `@libre-ai/ui`) is consumed
  by the app without regression.
- The `Rust quality` gate reproducibly rebuilds the Notebook Core WASM on every
  `main` run, so the engine's determinism is continuously proven.

## Scope and honest limits

- **Not re-run here:** the Gate B backup-host Playwright e2e requires the pinned
  qualification node (`NOTEBOOK_QUALIFICATION_NODE`) and a physical 32+ GiB
  device — the qualification harness approved in G2, not reproduced in this
  session. The approved Gate B evidence stands.
- **Still owner-gated (unchanged):** activation, user-data/backup path,
  production, release, infrastructure and deployment each need their own owner
  milestone (STATUS.md). This pilot validates the pattern; it authorizes no
  activation or release.
- **Independence of the porte V3:** wave 4a does not depend on the wave-3
  orchestrator lock (ADR-0011 D1); this validation stands on its own.

## Conclusion

The Notebook pilot validates the end-to-end app pattern once, as wave 4a
requires. The pattern is proven and ready for parallel replication under
Polaris at wave 4b (owner milestone β). No activation or release is granted.
