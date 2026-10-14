# Independent attestation reviews

Independent reviews: pending.

ADR-0038 D5 requires independent security, quality and completeness reviews, run in separate
contexts on an immutable pushed commit of this pull request. They are not written here by the
author of the attestation. The coordinator records each one below, naming:

- the reviewed pull request head (full SHA) and the Governance revision it was reviewed against;
- the candidate OID, `95e1bcea42e6c20c9fc8987b65b7c55de007d2f2`, and the manifest digest
  `765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9`;
- the role (security, quality, completeness), the verdict, and every finding with its state.

| Role | Reviewed head | Governance revision | Verdict |
| --- | --- | --- | --- |
| Security | pending | pending | pending |
| Quality | pending | pending | pending |
| Completeness | pending | pending | pending |

Points the author asks the reviewers to attack, as hypotheses and not as conclusions:

1. Whether `support@github.com` in the Dependabot trailer is acceptable (Open decision 1 in
   `ATTESTATION.md`), and whether a nominative allowlist entry scoped to forge-added commits is
   the right form.
2. Whether the freeze can be reached at all while Dependabot version updates stay configured
   and `refs/pull/*` cannot be restricted (Open decision 2).
3. Whether scanning all 205 objects, including any not reachable from a ref, is the right
   superset of "every accessible object" (here: 0 unreachable).
4. The gitleaks 14-versus-15 reading (patch-less commits are not counted) is a hypothesis.
