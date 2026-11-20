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

`skills-admission.v1.json` is the admission receipt of the skills collection (ADR-0072): for each
skill of `skills/`, the fingerprint of its directory, the result of every known check on that
fingerprint, and the admission state those results derive. It holds no date and no machine path.
`bun run build:skills-admission` regenerates it; `bun run check:skills-admission` writes nothing and
fails, naming the skill, if the committed file is not the one the tree generates.
