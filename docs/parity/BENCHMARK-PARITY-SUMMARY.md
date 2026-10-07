# Benchmark-Parity Elevation — Summary Report

## Provenance-Proof Brick (couche 3)

**Where We EXCEED Benchmark**:

- ✓ **Canonical serialization** — length-prefixed form prevents field-boundary attacks; exceeds SLSA/in-toto plain JSON serialization
- ✓ **Fail-closed verification** — explicit error on any tampering; no silent mismatches (exceeds permissive parsing)
- ✓ **Asymmetric signing** — Ed25519 provides origin authentication (unlike HMAC in envelope); suitable for self-hosted without key ceremony complexity

**Top 3 T1 Priorities** (adoption timeline):

1. **Publish as in-toto predicate** — register `AgentContributorLineage` as standard in-toto predicate type (enables integration with existing in-toto verifier chains; opens compatibility with SLSA attestation ecosystems)
2. **SLSA level self-assessment field** — add optional `slsaLevel` (0–3 metadata) so builders can declare their control posture; formal parity with SLSA framework
3. **Key ID → public key resolver interface** — formalize how consumers map `signingKeyId` to public key (currently implicit); enables key registry + audit trail for key rotations

**File Path**: `docs/parity/draft-specs/DRAFT-SPEC-provenance-proof.md`

---

## Envelope Brick (K3 — Loop-Security Kernel)

**Where We EXCEED Benchmark**:

- ✓ **Unforgeable delimiters** — escaped (`%u27E6`, `%u27E7`), non-re-decoded guard block exceeds static delimiter approaches (Lakera, Shields only detect semantic injection; we prevent structural injection)
- ✓ **Structural not heuristic** — cryptographic verification + deterministic escape rules beat detection models (no evasion by new patterns; no model updates required)
- ✓ **Offline verification** — HMAC signing with no external service dependency (exceeds Lakera Guard / Prompt Shields API-based approaches)

**Top 3 T1 Priorities** (adoption timeline):

1. **Defense-in-depth classification gate** — optional downstream detector (Lakera Guard or Prompt Shields) applied to already-guarded content as second line; documents complementary use (currently single-line defense; T1 = add optional dual-layer)
2. **Upgrade HMAC → Ed25519** (WP-G2-Z01 decision) — align with provenance brick; asymmetric signing for producer/consumer separation; reduces key management overhead
3. **RBAC + source metadata binding** — document how `source` + `label` integrate with authorization policies (e.g., "tool-output from untrusted APIs requires approval"); currently metadata present but unbound to policy

**File Path**: `docs/parity/draft-specs/DRAFT-SPEC-envelope.md`

---

## Status

Both specs are **DRAFT for owner review**. Benchmark research complete. Specs include:

- Formal capabilities inventory
- Parity tables (SLSA, in-toto, Sigstore; OWASP, Rebuff, Lakera, NeMo, Prompt Shields)
- T1 adoption roadmap
- Security properties + non-goals
- Registry notes for deployment guidance

Next: owner validation → formalize predicates + publish.
