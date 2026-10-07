# G0 historical repository freeze evidence

Date: 2026-07-16

## Outcome

All 18 historical GitHub repositories are archived. Every local `main` worktree is clean and aligned with its final remote revision. No Git history is imported into the canonical monorepo.

Local branches not merged into `main` were preserved as archive history through annotated remote tags under `archive/local-branch/*`. This retained 33 branch tips without reopening development branches.

## Final revisions

| Repository | Final `main` | Preserved branch tips | Qualification evidence |
| --- | --- | ---: | --- |
| agent-board | `6fc9f2068b9a5319495999db4900560cc02d8975` | 0 | final GitHub hygiene run green |
| agent-factory | `ec38d4af2bea8a39de7daed2a2800f94c26588b4` | 0 | final GitHub CI green |
| ai-practices | `b2fe67b48a77a192f7e920d98b4e0596ad1e90fb` | 10 | final CI, hygiene and database-inspection runs green |
| artifact-supply | `85598ba380ef7b10b5a0398181910e1f6627fe41` | 0 | final GitHub CI green |
| benchmarks | `cba052256fc2edad7d02ffbfa7e795a8ebd40893` | 3 | final CI and demo publication runs green |
| boussole-politique | `18f011df333a81fd4dfcfc048f6b9a3d8d9f17b4` | 0 | final GitHub CI green |
| client-kit | `d0d22998f571a13802686099198514b9c063b885` | 1 | final GitHub CI green |
| context-kit | `18a3ca170afe359d5c9e5ac88fb13d15e807fed5` | 0 | final GitHub CI green |
| design-system | `c8fb246c213b2ac962491c316ce807322d692a6e` | 0 | deterministic 76-SVG rebuild, 22 targeted tests, distribution and pinned-builder gates green |
| dioxus-app-template | `b93ee56a40b04099f6b4cd39fba67fcf61652e47` | 0 | final CI and static demo runs green |
| feed-radar | `b81b269b0610a9143ad5372928974aee533df1c5` | 7 | final Rust CI, contracts, security and database-inspection runs green |
| gear | `0c7f35f8dc511d5d4f6a81ccdd8ee323a70b7bde` | 3 | recreated archive remote; 179 local Rust tests and boundary gate green |
| notebook | `dde02ed8e9a02381518c71cedf447c684b82d2de` | 0 | final GitHub hygiene runs green |
| policy | `f97b3b2e8d59e2bf3d9d1e351461559c938db154` | 1 | final CI, hygiene and browser runs green |
| proof-kit | `04cae1130f45d2f0638349a9cd2208e88a87d730` | 1 | final GitHub CI green |
| sessions | `541a2f61ac97a9848d01e7c4b706e33cf8cb9b68` | 6 | final CI and security runs green |
| spec-studio | `e8eb1fbadc35021d21e01e345b8162e38060ff5d` | 1 | final CI and hygiene runs green |
| website | `0318c92b5b0f4fed82cc64b75e5132db04ea04e3` | 0 | PR #61: four required checks green; local unit, build, browser and supply-chain gates green |

## Reconciliation actions

- Closed superseded dependency PRs: ai-practices #26, benchmarks #14, dioxus-app-template #9 and spec-studio #23.
- Uploaded all referenced Git LFS objects while preserving AI Practices branch tips.
- Recreated the missing `libre-ai/gear` remote solely as an archive, pushed final `main` and three preserved branch tags, then archived it.
- Reviewed secret-scan candidates on preserved tips. Matches were examples, explicit test fixtures, type/variable names or CI scan rules; no real credential or personal machine path was pushed.
- Confirmed every historical GitHub repository reports `isArchived: true`.

## Interpretation

A green historical gate proves only that the frozen reference is internally coherent. It is not a production-readiness claim and does not authorize reuse of its runtime architecture. Future implementation, dependency updates and releases belong exclusively to `libre-ai/libre-ai`.
