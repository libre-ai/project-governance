# Adoption evidence — proof of independent appropriability

Attestations produced by `verification/adoption/` (positioning L3): can a
third party WITHOUT private assistance take the public repository and verify
it green?

- `YYYY-MM-DD-<short-sha>.json` / `.md` — one blank-room reproduction run:
  verdict, steps, environment, reference-chain digest comparison, and the
  **friction log** (the objective readability backlog, recorded even when the
  run passes). Schema: `libre-ai.adoption-reproduction.v1`
  (`verification/adoption/attestation.ts`).
- `latest.json` — the current reproduction verdict, regenerated on every run.
- `cold-reader-latest.json` — verdict of the heterogeneous cold reader
  (`verification/adoption/cold-reader/`): public surfaces read by a model
  from another provider with zero context, graded against a versioned grid;
  `status: "pending"` until a backend is configured (POLARIS IN-SERVICE vs
  PENDING convention).

Like the rest of `distribution/evidence/`, this directory proves, it does not
decide (authority map: `docs/README.md`).
