# Recovery composition baseline

The CI manifest pins the public recovery revisions inspected on 2026-09-29.
Repository identity and full commit IDs are defined in
`.github/composition/manifest.json`; branch tips are never substituted implicitly.
The governance and database pins include the two reviewed, published candidates
for portfolio documentation and the missing EUPL license text respectively.
Those candidates have not yet been merged into their recovery branches.

This manifest is a reproducible source selection, not a portfolio admission.
The candidate target revision overrides only its own pin. Changes in several
repositories require separate review and qualification of the resulting complete
composition before advancing its immutable pins. Never reuse a previous green
result after changing the sources, recipe, toolchain or platform.

Database validation includes all optional features for both clippy and tests.
Native, WASM and browser recipes retain their separate outcomes. The Linux
sandbox still lacks admitted network/filesystem confinement. The toolkit's Linux
browser failure remains unresolved despite green macOS reproduction attempts.
Neither limitation may be reported as a passed product or execution gate.

Original sources and recovery receipts remain preserved. Selecting these refs
neither archives a donor nor authorizes deleting its repositories or branches.

`bun run check` also runs the composition tool tests from the checked-out target.
This is necessary because a reusable workflow can still be pinned to older
governance tooling while reviewing a candidate that changes those scripts.
The candidate's own parser, manifest and recipes must be exercised as well.
