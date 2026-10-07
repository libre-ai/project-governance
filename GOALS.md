# Transformation goals

**Authority note.** This file is a hub document and stops being a phase authority. ADR-0020 moves
the doctrine to the `governance` repository: `GOALS.md`, `STATUS.md` and `ROADMAP.md` migrate there
with the rest of the doctrine, and when the hub is archived its own surface becomes
`ecosystem/migration-index.v1.yaml` — the migration index, not this file. After milestone γ there is
no central goal list at all: each repository carries its objectives, weighted acceptance criteria
and dated evidence in its own `project.v1.yaml` card (I-08 as amended by ADR-0020).

## Closed history — G0 to G2

| Goal                           | Status   | Outcome                                                                                                                                                                        | Evidence                                                                                                                      |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| G0 — Legacy cleanup and freeze | complete | the historical repositories were reconciled, aligned and archived at recorded SHAs, with no unreviewed local work lost                                                         | `docs/transformation/G0-FREEZE-EVIDENCE.md`, `ecosystem/LEGACY-MANIFEST.yaml`, gate log 2026-07-16                            |
| G1 — Specification Lock        | complete | contracts, data ownership, identity/authorization, application specifications and naming locked after role-separated reviews; the bounded ADR-0003 amendment opened and closed | `contracts/catalog.v1.json` (85 locked authorities at closure — the catalog is the count of record, I-14), ADR-0001/0002/0003 |
| G2 — Canonical foundations     | complete | the reference chain builds and verifies green from a clean checkout, 10/10 steps, reproducible digest `f45dfad0…`, without any Clever Cloud resource                           | PR #132 (`5ea34f9`), `verification/harness/wp-g2-q01-reference-chain-evidence.md`, gate log 2026-07-20 (« G2 CLOS »)          |

Nothing in G0–G2 granted activation, production, release or user-data authority; those controls are
unchanged by the present goals.

## G3, G4 and G5 are superseded

G3 (parallel reconstruction), G4 (global integration and cutover) and G5 (distribution), as written,
assumed a single monorepo reconstructed in place and satellites activated wave by wave. ADR-0020
(owner decisions D1–D4, 2026-07-28) replaces that reading: activation is general, the hub is
dismantled into an archive plus a migration index, doctrine and contracts move to two separated
authority repositories, and the migration is integral in one wave. The successor of G3–G5 is the
milestone γ phase list below. What those goals still carried and milestone γ does not itself deliver
— global integration, distribution to registries, the unimplemented product engines — becomes the
roadmap of the repository that owns it, never a phase of this file.

## Milestone γ — general activation and hub dismantling

Each phase carries one objective, one exit criterion and its owner hard stops. No date and no
percentage: a gate is crossed by a green run, an owner checkpoint by an explicit act.

### γ 3.0 — Housekeeping — closed

- **Objective:** settle every session leftover before any split, and photograph the hub reference
  chain green one last time.
- **Exit criterion (met):** every leftover settled under role-separated review — seven pull requests
  merged (#261, #265, #266, #267, #268, #269, #271), one set of review findings requalified as
  backlog issue #270 — and the reference chain replayed 10/10 green on `5c1bf05` with digest
  `f45dfad03581f3d56ea53ca74a7b9ac3034ef7ce7013eebe6eac71cc3959a89f`, byte-identical to the
  WP-G2-Q01 closure digest (PR #132, 2026-07-20).
- **Evidence:** `distribution/evidence/2026-07-28-milestone-gamma-housekeeping.md`, gate log entry
  2026-07-28.

### γ 3.1 — Doctrinal act — closed

- **Objective:** enact the general activation in doctrine — ADR-0020 with its bounded supersessions,
  the invariant amendments, the LEXICON amendment, the nominative regularisation of the `website`
  activation, and the rewrite of every document authority the act makes stale.
- **Exit criterion (met):** the ADR is accepted and each surface it names in its §3 is brought in line by
  the same pull request, with the doctrine gates green.
- **Hard stop (crossed 2026-07-28):** merging that pull request **was** the owner signature (ADR-0020
  status line, design §5.6 step 2).
- **Evidence:** PR #273, `distribution/evidence/gate-acceptance-log.md` entry 2026-07-28 (phase 3.1).

### γ 3.2 — Project-card system — closed

- **Objective:** build the `project.v1` card schema, its validator, the progress aggregator and the
  generated sections inside the hub (they migrate later with `governance`), and prove the
  cross-repository dependency mechanics empirically.
- **Exit criterion (met):** schema, validator and aggregator run green in the hub, and the dependency
  test bench (design §5.2.6, five cases — including `tsc --noEmit` through a git-dep and the
  `[sources.allow-org]` key on the CI's cargo-deny version) has actually been executed with its
  results recorded.
- **Evidence:** PR #274, #275 (merge `1c1a1fae`), `distribution/evidence/2026-07-29-dependency-bench.md`,
  gate-acceptance-log entries 2026-07-29 (phase 3.2, dependency bench).

### γ 3.3 — Authorities — closed

- **Objective:** create `governance` and `contracts`, migrate the doctrine and the canonical
  contracts with preserved history (`git filter-repo` by default, never a squash), and institute
  `ecosystem/migration-index.v1.yaml`.
- **Exit criterion (met):** both repositories green on their migrated content, the CI template
  published by `governance` as SHA-pinned reusable workflows, and the migration index in service with
  its orphan gate running.
- **Hard stop (crossed):** creating the batch of GitHub repositories was an owner checkpoint (class 9).
- **Evidence:** PR #277 (merge `52f567d9`), gate-acceptance-log entry 2026-07-29 (phase 3.3).

### γ 3.4 — Shared-code satellites (19) — closed

- **Objective:** migrate the shared-code satellites, one repository per package or crate, in the
  order imposed by the real dependency graph (`sdk-ts`, `web-platform`, `testing`, `sdk-rs` and
  `envelope` first; `starter` only after the four bricks it consumes).
- **Exit criterion (met):** each satellite's CI green on its migrated content **before** the path left
  the hub (design §5.4), inter-repository dependencies pinned by SHA, and a byte-exact drift gate on
  every vendored contract copy.
- **Evidence:** PRs #279–#283 (merge `d3cfcc47`), gate-acceptance-log entry 2026-07-29 (phase 3.4).

### γ 3.5 — Products (8) and the layer-2 application — closed

- **Objective:** migrate the eight layer-1 product repositories and the `missions` application,
  grafting the migrated tree onto their frozen history by a merge of unrelated histories.
- **Exit criterion (met):** each repository green, no force push anywhere, the frozen history still
  fully reachable, and the DCO bound asserted as the graft merge itself and cross-checked against the
  migration index.
- **Hard stop (crossed):** the first description or visibility switch of each product repository was
  an owner checkpoint.
- **Evidence:** `ecosystem/migration-index.v1.yaml` entries for the nine destinations (`feed-radar`,
  `notebook`, `policy`, `boussole-politique`, `ai-practices`, `sessions`, `spec-studio`, `missions`)
  carry non-`pending` `hub_removal_commit` values (`ba3761b4…`, `42dffb47…`); gate-acceptance-log entry
  2026-07-30 (phase 3.7) records the same two removal waves (PRs hub #289/#291) that carried this
  content out of the hub. `carriere` is a reserved product home with no legacy hub content to migrate
  (owner decision 2026-07-23).

### γ 3.6 — Presentation — closed

- **Objective:** one `project.v1.yaml` card per repository, generated README sections, the org
  README, the home page and dated comparisons on `website`, and GitHub descriptions updated.
- **Exit criterion (met):** every card valid against the schema, every generated section identical to
  its card under the coherence gate, and progress computed only from accepted weighted criteria backed
  by evidence — projects without a stable perimeter display « not computable », which is information,
  not a defect.
- **Evidence:** `docs/reports/2026-07-30-general-activation-final-report.md` (33/34 repositories carry
  a card, 1/33 non-computable — `carriere`, 0 presentation-versus-card divergences at the fleet gate);
  two named non-blocking leftovers tracked from this closure (CL36-03, CL36-06).

### γ 3.7 — Coherence and final report — closed

- **Objective:** run the cross-repository coherence gate from `governance` and produce the final
  report: claims without evidence, non-computable percentages, phases without exit criteria, projects
  without a user or an outcome, presentation-versus-code divergences, stale evidence, undocumented
  dependencies.
- **Exit criterion (met):** the fleet gate green and the report published, with the three reading
  levels verified — understand, evaluate, verify.
- **Evidence:** PRs hub #289/#291, `docs/reports/2026-07-30-general-activation-final-report.md`,
  gate-acceptance-log entry 2026-07-30 (phase 3.7).

### γ 3.8 — Hub archiving — closed

- **Objective:** empty the hub, trace every path to its destination, replace its remaining surfaces
  by the archive banner plus the migration index, and archive the repository.
- **Exit criterion (met):** the orphan gate green — not one tracked path without a destination — and
  the archive still clonable, so the `recoverable_at` references of I-23 keep resolving.
- **Hard stop (crossed 2026-07-30):** archiving the hub was a nominative owner act, the final hard
  stop of the milestone.
- **Evidence:** PR hub #293, gate-acceptance-log entry 2026-07-30 (phase 3.8);
  `libre-ai/libre-ai` reads `archived: true` on the GitHub API as of this writing.

## After milestone γ

There is no successor phase list here. The roadmap lives per repository, in its `project.v1.yaml`
card, aggregated and verified by `governance`. The engineering work that milestone γ does not itself
deliver — the Polaris method work packages, the product engines that are not implemented — becomes
the roadmap of the repository that owns it (`orchestrator`, the product repositories), and its state
is read from that repository's card, never declared centrally.
