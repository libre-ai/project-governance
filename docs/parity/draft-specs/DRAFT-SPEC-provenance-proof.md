# Specification: Provenance-Proof Brick (couche 3)

**Status**: DRAFT for owner review | **Date**: 2026-07-22

## Purpose

The provenance-proof brick (couche 3) records and cryptographically verifies the contributor lineage of autonomous agent work. It captures:

- **Who** contributed (agent identity + role: author, executor, fixer, editor)
- **What** they contributed (per-contribution SHA-256 digest)
- **Proof** of authenticity (Ed25519 signature over canonical lineage record)

This brick implements **AgentContributorLineage v1 (BOT-C)**, enabling supply-chain integrity for AI-authored code, decisions, and attestations. It sits alongside the envelope (K3) to separate two concerns: integrity of untrusted **content** (envelope) vs. **provenance** of trusted agent actions (this brick).

## Surface

### API

```typescript
// Build a signed lineage record (producer side)
buildLineage(input: LineageInput, key: SigningKey): AgentContributorLineage

// Verify lineage integrity (consumer side)
verifyLineage(record: AgentContributorLineage, key: VerifyKey): { valid: true }

// Render lineage as JSON-serializable record
// (implicitly: JSON.stringify(record) for storage/transmission)
```

### Contracts

**Input** (`LineageInput`):

- `id`, `tenantId`, `missionId` — identifiers
- `subjectDigest` — SHA-256 of the work being attested (commit, file, decision)
- `contributors` — array of agent contributions (agentId, roles, per-contribution digest)
- `observations` — metadata links (external refs to code, design docs, test results)
- `generatedAt` — ISO 8601 timestamp

**Output** (`AgentContributorLineage`):

- All input fields, plus:
- `schemaVersion` — fixed `"libre-ai.agent-contributor-lineage.v1"`
- `signingKeyId` — identifies the signing key (owner ceremony)
- `lineageDigest` — canonical SHA-256 of record content (length-prefixed canonical form)
- `signature` — Ed25519 signature over `lineageDigest` (base64url-encoded)

**Verification Contract**:

- ✓ Schema version must match `v1`
- ✓ Recompute `lineageDigest` from fields; must match stored digest
- ✓ Verify Ed25519 signature over digest using the public key
- ✗ Fail closed: any mismatch raises `LineageIntegrityError` (no details disclosed)

## Capabilities

| Capability                   | Details                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Agent lineage recording**  | Capture multi-agent contributions (author, executor, fixer, editor) with per-contribution work digests            |
| **Canonical form**           | Length-prefixed serialization prevents field-boundary shifting attacks; role order is canonical (not input order) |
| **Asymmetric signing**       | Ed25519 signatures enable origin authentication (only keyholder produces; anyone with public key verifies)        |
| **Fail-closed verification** | Integrity errors are detected and raised; no silent mismatches or partial validation                              |
| **Duplicate rejection**      | Enforces uniqueness of contributors and observations; duplicate entries trigger RangeError (not silent dedup)     |
| **Observation linking**      | Attestation can reference external artifacts (code, docs, test results) via digest + mediaType                    |

## Non-Goals

- **Key rotation** — Not in scope. The key ceremony (owner-gated, WP-G2-Z01) handles key selection and rotation offline.
- **Revocation/transparency log** — Not in scope. This brick signs locally; a transparency log (like Rekor) is a separate deployment choice.
- **Timestamping authority** — Not in scope. `generatedAt` is client-supplied; trust in timestamp depends on the caller's time source (system clock, external TSA).
- **SBOM generation** — Not in scope. Observations can reference SBOMs, but this brick does not generate or parse them.
- **Fine-grained role definitions** — Fixed to 4 roles; domain-specific roles are out of scope.

## Benchmark Parity Analysis

### SLSA Framework

| SLSA Feature                     | Our Model                      | Status    | Notes                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provenance predicate**         | AgentContributorLineage v1     | ✓ Couvert | Captures builder identity, input digests, output digest (subject), timestamp; structured per SLSA provenance predicate shape                                                                                         |
| **Build integrity levels (0–3)** | Self-assessment only           | ⚠ T1      | We do not enforce SLSA levels (requirements for environment isolation, CI/CD controls, etc.); we provide the **attestation format**. Levels 2–3 require external controls (CI gating, audit trail, hermetic builds). |
| **Attestation envelope (DSSE)**  | Length-prefixed canonical form | ✓ Couvert | Our canonical serialization + signature pattern parallels DSSE (deterministic serialization + signing); we do not wrap in DSSE JSON, but the principle is equivalent                                                 |
| **Subject digests**              | SHA-256 per artifact           | ✓ Couvert | `subjectDigest` + `contributions.contributionDigest` + `observations[].digest` follow SLSA subject/digest model                                                                                                      |

**SLSA T1 Priority**:

1. **Integrate SLSA level self-assessment** — add optional `slsaLevel` field to LineageInput (metadata, not enforced here) so consumers can declare the level of control under which the record was built
2. **Formalize predicate shape** — publish `libre-ai.agent-contributor-lineage.v1` as a registered in-toto predicate type (standardizes interop with SLSA-compliant verifiers)
3. **Add builder identity attestation** — currently we capture agentId; add optional `builder` object (name, URI, environment) to match SLSA provenance spec

### in-toto Framework

| in-toto Feature            | Our Model               | Status    | Notes                                                                                                                                                                                                                                |
| -------------------------- | ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Link metadata**          | AgentContributorLineage | ✓ Couvert | Each LineageInput record is equivalent to a Link: materials (input observations), command (roles/agentId), products (subject), materials/products digests                                                                            |
| **Functionary signatures** | Ed25519 per-record      | ✓ Couvert | Each record is signed by a single key (the owner key ceremony); in-toto links are also per-functionary. Our structure: 1 record per attestation moment, N contributors referenced within (different shape, same information density) |
| **Layout enforcement**     | Out of scope            | ✗         | in-toto layouts define supply-chain policy (step order, authorized functionaries, inspections); we do not enforce layouts. Policy is external.                                                                                       |
| **Immutability/chain**     | Per-record integrity    | ✓ Couvert | Each record is immutable (crypto-verified); chaining multiple records into a timeline is application logic (not our scope)                                                                                                           |

**in-toto T1 Priority**:

1. **Publish as in-toto predicate** — register `AgentContributorLineage` as a standard in-toto-compatible predicate type, allowing integration with in-toto verifier chains
2. **Support link-style timestamp chaining** — optional `previousRecordDigest` field to link records in a causal chain (not enforced, but enables in-toto timeline reconstruction)
3. **Layout interface** — document how external tools can implement in-toto layouts on top of our records (e.g., policy enforcement: "author must be followed by executor")

### Sigstore (cosign/Fulcio/Rekor)

| Sigstore Feature             | Our Model                   | Status    | Notes                                                                                                                                                                        |
| ---------------------------- | --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keyless signing**          | Not applicable              | ✗         | We use long-lived Ed25519 keys (owner ceremony). Sigstore's Fulcio provides short-lived certs + OIDC identity. Our model is suitable for self-hosted, non-OIDC environments. |
| **Transparency log (Rekor)** | Out of scope                | ✗         | Rekor provides public append-only logging; we do not depend on it. Deployment choice: self-run Rekor instance, Sigstore's public log, or no transparency log (air-gapped).   |
| **Signing attestations**     | Ed25519 over canonical form | ✓ Couvert | We use deterministic signing (canonical serialization) + asymmetric crypto, aligning with Sigstore's security model (but not the specific infrastructure)                    |
| **Certificate binding**      | `signingKeyId` reference    | ✓ Couvert | We include `signingKeyId` to bind the record to a specific key; consumers must validate keyId ↔ public key mapping offline (no Fulcio integration)                           |

**Sigstore T1 Priority**:

1. **Optional Rekor integration** — add optional `rekorEntryId` field (if a self-run Rekor is deployed) to link the record to its transparency log entry
2. **Key ID → public key resolver** — document how consumers resolve `signingKeyId` to the actual public key (currently implicit; could be formalized as a key registry interface)
3. **Upgrade to asymmetric encryption** (already done) — envelope brick uses HMAC; document timeline for envelope Ed25519 upgrade (WP-G2-Z01) so both bricks converge on asymmetric keys

---

## Security Properties

### Integrity

- **Canonical serialization** — length-prefixed fields prevent reordering or content-boundary attacks
- **Fail-closed verification** — any tampering (field alteration, signature forgery, wrong key) raises `LineageIntegrityError`; no partial or silent validation

### Origin Authentication

- **Ed25519 signatures** — only the key holder can produce a valid signature; any verifier with the public key can check it
- **Key ceremony** — signing key is owner-gated (WP-G2-Z01); distribution of public key is external (trust model depends on deployment)

### Non-Goals

- **Confidentiality** — records are signed but not encrypted; all fields are in plaintext (suitable for audit logging)
- **Freshness** — no nonce or counter; records can be replayed (check `generatedAt` timestamp externally if freshness is required)

---

## Registry Note

**Libre AI Provenance Brick v1** is suitable for:

✓ **Self-hosted, air-gapped environments** — no dependency on Sigstore or public transparency logs
✓ **Compliance auditing** — immutable, signed records with clear contributor lineage
✓ **SLSA self-assessment** — provides the attestation format; external controls determine the SLSA level
✓ **multi-agent systems** — captures roles and per-contribution digests for complex workflows

⚠ **Limitations**:

- Key rotation is offline (owner-managed); no built-in key rollover mechanism
- No transparency log (Rekor-style); auditability depends on record retention at the edge
- Timestamp trust depends on client's time source (no TSA integration)

**Next Gates** (before v1 stabilization):

- [ ] Publish as in-toto predicate type
- [ ] Formalize SLSA level self-assessment field
- [ ] Document key registry interface for `signingKeyId` resolution
- [ ] Edge case testing: very large contributor lists, long observation chains, concurrent signing

---

## Sources

- [SLSA Framework - slsa.dev](https://slsa.dev/)
- [in-toto Supply Chain Security](https://in-toto.io/)
- [Sigstore Documentation](https://docs.sigstore.dev/)
- [DSSE (Dead Simple Signing Envelope)](https://github.com/secure-systems-lab/dsse)
