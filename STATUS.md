# Transformation status

**Current phase:** milestone γ — general multi-repository activation and hub dismantling (ADR-0020,
owner decisions D1–D4 of 2026-07-28) — **closed 2026-07-30**. All eight phases (3.0 housekeeping through
3.8 hub archiving) are closed; `libre-ai/libre-ai` is archived and the organization carries 34
repositories, 33 of them non-archived.

**Authority note.** This file stops being a phase authority. It migrates to the `governance`
repository with the rest of the doctrine, and when the hub is archived the state of a project is read
from its own `project.v1.yaml` card while the state of the hub is read from
`ecosystem/migration-index.v1.yaml`. Until then, every line below is meant to be true at the moment
it is written and traceable to a pull request, an ADR or a piece of recorded evidence.

## Milestone γ — where the work stands

- **3.0 housekeeping — closed (2026-07-28).** Every leftover of the preceding sessions was settled
  under role-separated review: the activation design merged after a five-revision K4 cycle with two
  independent reviewers (#268), the content-forgetting primitive merged (#265), two live security
  defects closed through a reject → remediation → confirmation cycle (#269), the `policy` visibility
  line and the secrets/PII re-audit evidence merged (#261, #271), the colour-system exploration
  committed and merged after a full-tree audit (#267), and the model-policy delivery phases merged by
  a parallel session with their K4 findings requalified as backlog issue #270 (#266). The hub
  reference chain was then replayed on `5c1bf05`: **10/10 steps passed, digest
  `f45dfad03581f3d56ea53ca74a7b9ac3034ef7ce7013eebe6eac71cc3959a89f`, byte-identical to the
  WP-G2-Q01 closure digest of 2026-07-20** — the final photograph reproduces the G2 evidence exactly.
  One split precondition surfaced and is recorded: the template end-to-end run resolves `@libre-ai/ui`
  through an export condition pointing at an untracked `dist/`, so the chain needs that build first —
  exactly the class of problem design §5.2.2 names for git-dep consumers. Evidence:
  `distribution/evidence/2026-07-28-milestone-gamma-housekeeping.md`.
- **3.1 doctrinal act — closed (2026-07-28).** PR #273 added ADR-0020 and amended, in the same
  change, the invariants register (I-02, I-03, I-04, I-05, I-08, I-15, I-16, plus an application note
  on I-23), the decision register (D07 amended, scoping note on D02, new D29), the LEXICON and the
  authority map. Merging the pull request **was** the owner signature.
- **3.2 card system and dependency test bench — closed (2026-07-29).** Schema, validator, aggregator
  and generator landed with TDD green (PR #274, merge `1c1a1fae`; anti-inert-pattern test PR #275);
  the dependency test bench (design §5.2.6) ran with results recorded
  (`distribution/evidence/2026-07-29-dependency-bench.md`).
- **3.3 the two authority repositories — closed (2026-07-29).** `governance` (375 commits via
  `git filter-repo`) and `contracts` (149 commits) were created and born green; the migration index
  was instituted (PR #277, merge `52f567d9`).
- **3.4 the nineteen shared-code satellites — closed (2026-07-29).** All nineteen satellites born
  green in dependency-graph order, three generations of pins recorded in
  `ecosystem/fleet-pins.v1.yaml` (PRs #279–#283, merge `d3cfcc47`).
- **3.5 the eight product repositories plus `missions` — closed.** Grafted onto their frozen history;
  `ecosystem/migration-index.v1.yaml` records a non-`pending` `hub_removal_commit` for each of the nine
  destinations.
- **3.6 the presentation wave — closed.** 33 of 34 repositories carry a validated `project.v1.yaml`
  card (the org-profile repository `.github` has none by design); zero presentation-versus-card
  divergences at the fleet gate (`docs/reports/2026-07-30-general-activation-final-report.md`).
- **3.7 the cross-repository coherence report — closed (2026-07-30).** The hub was emptied from 1,596
  to 50 tracked files across two reviewed removal waves (PRs hub #289/#291), the orphan gate ran
  50/50 paths accounted with zero orphans, and the final report was published
  (`docs/reports/2026-07-30-general-activation-final-report.md`).
- **3.8 the hub archiving — closed (2026-07-30).** `libre-ai/libre-ai` was archived under the owner's
  advance GO (PR hub #293); it reads `archived: true` on the GitHub API as of this writing.

Their objectives, exit criteria and hard stops are in [`GOALS.md`](GOALS.md); their order in
[`ROADMAP.md`](ROADMAP.md).

34 repositories exist in the organization, 33 of them non-archived (`libre-ai/libre-ai` is the sole
archived one); the migration index (`ecosystem/migration-index.v1.yaml`) traces 88 hub-path entries to
their destinations, 5 of them still `pending` as documented, legitimate dual-presence entries (archive
registries, minimal chain, toolchain) that the orphan gate covers nominatively.

## Completed

The complete record is the Git history and `distribution/evidence/gate-acceptance-log.md`, which
holds every gate verdict with its verifiable reference. This section keeps only the load-bearing
lines.

- **G0 closed (2026-07-16):** the historical repositories aligned and archived at recorded SHAs,
  unmerged local branch tips preserved as archive tags, `ecosystem/LEGACY-MANIFEST.yaml` complete.
- **G1 closed (2026-07-16/17):** Specification Lock — 85 catalog authorities locked at closure after
  role-separated reviews, the bounded ADR-0003 amendment opened and closed, cross-cutting product
  decisions recorded in ADR-0002.
- **Licensing and contribution governance accepted (ADR-0004):** differentiated EUPL / Apache-2.0 /
  CC BY, DCO required, REUSE compliance, protected `main`, secret scanning and push protection,
  private vulnerability reporting.
- **G2 closed (2026-07-20, PR #132 / `5ea34f9`):** the reference chain runs the full foundation chain
  green from a clean checkout — 10/10 steps, reproducible digest `f45dfad0…` — with tree-wide secret
  and no-Clever gates, after an independent acceptance review.
- **Notebook Gate B is approved on immutable candidate `9ee3f8d`** for the exact disabled
  fixture-only host and the qualified 32+ GiB class (ADR-0005/0006/0007); it grants no activation, no
  user-data path and no release.
- **Data layer (PR #123, `43c85e7`):** application layer plus the mandatory PostgreSQL barrier —
  isolated owner migrations, forced row-level security, append-only receipts, retention ceiling —
  merged as the owner-pronounced bootstrap of the graduated-trust regime (ADR-0011 D4).
- **Identity and authorization:** the web authentication foundation (PR #111) and the Biscuit
  authorization capability with bounded attenuation, deny-by-default policies, verified revocation
  and two-key Ed25519 rotation (PR #101) are closed.
- **K1 in service (2026-07-20):** `authority-v2` and `agent-runs-v2` promoted `candidate → locked`
  with two real consumers; per-agent revocation enforced at issuance (PR #149).
- **K3 in service (2026-07-22):** `envelope-v1` promoted `candidate → locked`, its first real
  consumer being the review fan-out that the forge itself uses.
- **LEXICON signed (2026-07-20, PR #130)** as the name map of the ecosystem, and amended by ADR-0020
  in the current pull request — new authority names, identifiers born after the map, the reversal of
  its no-satellite reading, and the `agent-board` → `missions` regularisation.
- **Wave-1 satellite publish-readiness re-verified (2026-07-24)** on the then-current `main`, on the
  tarballs actually packed; no publication was performed — the registry day stays an owner act.
- **Milestone γ phase 3.0 closed (2026-07-28)**, as detailed above.

The tree carries the packages, crates and applications recorded by the inventory; counts are derived
from it and never graven here (I-14).

## Explicitly deferred

- Clever Cloud provisioning, secrets, databases, DNS and deployment: deferred to global integration.
  I-07 names G4 for it and ADR-0020 does not amend that invariant, even though the G4 phase label is
  superseded as a sequencing device.
- Publication to npm and crates.io: an owner checkpoint outside milestone γ. Pinned GitHub git-deps
  make it unnecessary for the migration itself, and the wave-1 publication runbook stays ready.
- Live-token invalidation of a revoked agent: a validation-side control that lands with the agent
  runtime consumer, in the `orchestrator` repository after γ. Until then a revoked agent's
  outstanding tokens lapse under the ≤ 900 s TTL ceiling; issuance-side revocation is in service.
- `capability_scope` tool and write-path enforcement: a responsibility of the agent runtime, which is
  not built. The token carries the fact; the runtime must check it.
- The six reserved names that are not instantiated — `proof`, `memory`, `harness`, `mcp-server`,
  `corpus`, `docs` — stay reserved; no repository is created for them in milestone γ.

## Current risks

- **The product engines do not exist.** The applications are real, with tests and end-to-end
  coverage; Radar, Boussole, Practices and the others have no engine, and only Notebook Core has a
  qualification gate. The product repositories will carry their real application with engine phases
  `not_started`, and their cards must say so — no inflated progress anywhere.
- **The dependency mechanics are not yet proven by execution.** The test bench of design §5.2.6 (five
  cases, including `tsc --noEmit` through a git-dep and the `[sources.allow-org]` key on the CI's
  cargo-deny version) has not been run; the conclusions rest on Bun's source and Cargo's documented
  semantics. It is a precondition of the migration plan, not an afterthought.
- **Splitting the workspaces multiplies the continuous-integration surface** to roughly thirty-four
  repositories. Mitigation: reusable workflows published by `governance` and pinned by SHA, plus a
  template-drift gate; the bump cost is assumed.
- **Pinned git-deps disarm two existing guards** — `cargo deny check sources` and the npm quarantine
  delay. Bounded by an organisation-scoped source allowance, one reviewed pull request per SHA bump,
  and the quarantine kept for every registry package (ADR-0020 §2.5).
- **The fleet gates concentrate in `governance`**: cross-repository coherence, inventory and truth
  drift, orphan detection, template drift and vendored-contract drift all run from one repository. It
  is a single point of failure by construction, and its own availability is part of the risk.
- **The hub reference chain stops being replayable** once the hub is dismantled. Mitigation: the
  final green photograph and its digest are recorded, and the hub archive stays clonable.
- **Vendored contract copies can drift** from their canonical source. Mitigation: a byte-exact drift
  gate per consuming repository, pinned on a revision of the `contracts` repository.
- **No migrated history is DCO-verified anywhere in the fleet.** The graft bound is named and traced
  by ADR-0020 §2.6, asserted at each run against the migration index; I-11 is not amended — the DCO
  stays mandatory on every new contribution.
- **Three red windows are structural during the split** (repository creation versus inventory drift,
  the hub in dismantling mode, re-hosting the toolchain asset). They are bounded, traced in the
  milestone evidence, and never hidden.
- **Bun stable remains `1.3.14`** while the selected Rust-line commit exists only in a canary; the
  Bun archive is a bootstrap-only compliance path.
- **GitHub forge and CI remain an accepted US-service exception** for public code only, never runtime
  data or secrets.
