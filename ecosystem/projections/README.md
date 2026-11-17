# Knowledge projections

Generated, read-only views of accepted Knowledge Objects. Source objects and schemas remain the
authority. `public.v1.json` is deterministic, contains no generation timestamp and is checked by the
Rust test suite and `ecosystem-project --check`.

`invariant-matrix.v1.json` says, for each row of `docs/decisions/INVARIANTS.md`, whether a gate of
this repository enforces the invariant and whether that gate has a test. The register stays the
authority on the invariants; `ecosystem/invariant-gates.v1.yaml` carries the reviewed
invariant → gate → test correspondence. `bun ecosystem/render-invariant-matrix.ts` regenerates the
file; with `--check` it writes nothing and fails if the committed file differs. An invariant shown
« sans gate » is in force and held by no gate named here.
