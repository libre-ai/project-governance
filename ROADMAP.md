# Roadmap

Progress is tracked by gates in [`GOALS.md`](GOALS.md), not by dates or issue count.

G0, G1 and G2 are closed. The Big Bang reconstruction (register D01) stays in force, but the
seven-step sequencing this file used to carry is replaced by the milestone γ roadmap below: ADR-0020
supersedes G3 to G5 and the wave ordering of `docs/transformation/EXECUTION-SEQUENCING.md`.

| Phase                          | Objective                                                                                                  | State                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| γ 3.0 — Housekeeping           | leftovers settled, hub reference chain replayed green one last time                                        | **closed** (2026-07-28) — 10/10 steps, digest `f45dfad0…` byte-identical to the G2 closure digest |
| γ 3.1 — Doctrinal act          | ADR-0020, invariants, decision register, LEXICON, stale document authorities                               | **closed** (2026-07-28) — PR #273, merge was the owner signature (hard stop)                      |
| γ 3.2 — Card system            | `project.v1` schema, validator, aggregator, generators; dependency test bench executed                     | **closed** (2026-07-29) — PRs #274/#275, dependency bench evidence recorded                       |
| γ 3.3 — Authorities            | create `governance` and `contracts`, migrate with preserved history, institute the migration index         | **closed** (2026-07-29) — PR #277, both repositories born green                                   |
| γ 3.4 — Shared-code satellites | nineteen repositories in dependency-graph order, dependencies pinned by SHA, vendored-contract drift gates | **closed** (2026-07-29) — PRs #279–#283, nineteen satellites born green                           |
| γ 3.5 — Products               | eight product repositories plus the layer-2 `missions` application, grafted onto their frozen history      | **closed** — migration index carries non-`pending` removal commits for all nine destinations      |
| γ 3.6 — Presentation           | cards, generated READMEs, org README, home page, dated comparisons, GitHub descriptions                    | **closed** — 33/34 repositories carry a card, 0 presentation-versus-card divergences              |
| γ 3.7 — Coherence              | cross-repository coherence gate run from `governance`, final report                                        | **closed** (2026-07-30) — PRs hub #289/#291, final report published                               |
| γ 3.8 — Hub archiving          | hub emptied, every path traced to a destination, banner plus migration index, archive                      | **closed** (2026-07-30) — PR hub #293, `libre-ai/libre-ai` archived                               |

Milestone γ is closed. There is no central roadmap. Each repository carries its own in its
`project.v1.yaml` card, aggregated and verified by `governance` (I-08 as amended by ADR-0020). The
engineering work milestone γ did not itself deliver — the Polaris method work packages, the product
engines that are not implemented — is the roadmap of the repository that owns it.
