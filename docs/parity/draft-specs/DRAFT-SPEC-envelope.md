# Specification: Envelope Brick (Loop-Security Kernel K3)

**Status**: DRAFT for owner review | **Date**: 2026-07-22

## Purpose

The envelope brick (K3) is a structural defense against prompt injection attacks. It wraps untrusted external content (web, email, tool output, MCP descriptions) so that:

1. **Content is tagged as untrusted** — flagged `trusted:false` with source attribution, preventing accidental use as instructions
2. **Integrity is verifiable offline** — HMAC-SHA256 signature allows detection of any content alteration without calling a detection service
3. **Delimiters are unforgeable** — escaped delimiters prevent payloads from injecting closing markers, closing the injection surface at the **structural level** (not heuristic detection)

This brick is **structural** (trustworthy even if model behavior is unpredictable) rather than **detection-based** (relies on classification models to spot injections). It implements **Loop-Security Kernel K3**, enabling safe integration of untrusted data into LLM prompts.

## Surface

### API

```typescript
// Wrap untrusted content with source, label, and integrity signature
wrapUntrusted(input: UntrustedInput, key: EnvelopeKey): UntrustedEnvelope

// Verify envelope integrity; fails closed on any alteration
verifyEnvelope(envelope: UntrustedEnvelope, key: EnvelopeKey): VerifiedEnvelope

// Verify + render envelope as guarded, escaped, model-facing text
renderGuarded(envelope: UntrustedEnvelope, key: EnvelopeKey): string
```

### Contracts

**Input** (`UntrustedInput`):

- `source` — one of: `"web"`, `"email"`, `"memory"`, `"tool-output"`, `"tool-description"`, `"mcp-description"`
- `label` — optional human-readable description (e.g., "search result #3", "gpt4-web-plugin")
- `content` — the untrusted text (can be arbitrarily large; no parsing/validation here)
- `capturedAt` — ISO 8601 timestamp (client-supplied; not verified by this brick)

**Output** (`UntrustedEnvelope`):

- All input fields, plus:
- `schemaVersion` — fixed `"libre-ai.envelope.v1"`
- `trusted` — fixed `false` (structural marker)
- `integrity` — `{ alg: "HMAC-SHA256", keyId: <key-id>, mac: <base64url> }`

**Verification Contract**:

- ✓ Schema version must be `v1`, trusted flag must be `false`
- ✓ Recompute HMAC-SHA256 over canonical fields; must match stored MAC in **constant time** (timing-safe comparison)
- ✗ Fail closed: any mismatch raises `EnvelopeIntegrityError` (no details disclosed; never echo content)

**Rendering Contract**:

- ✓ Verify envelope first (as above)
- ✓ Escape delimiters (`⟦`, `⟧`, `%`) so content cannot forge the closing marker
- ✓ Wrap in guard block:
  ```
  ⟦LAI-UNTRUSTED source=<source> trusted=false [label=...]⟧
  <escaped-content>
  ⟦/LAI-UNTRUSTED⟧
  ```
- ✗ Never render an unverified or tampered envelope

## Capabilities

| Capability                   | Details                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Content integrity**        | HMAC-SHA256 signature detects any alteration (content, source, label, timestamp, schema version)                               |
| **Offline verification**     | No external service required; verification is local and deterministic                                                          |
| **Unforgeable delimiters**   | Escaping (`%u27E6`, `%u27E7`, `%25`) prevents payloads from injecting closing markers; rendering is one-way (never re-decoded) |
| **Canonical serialization**  | Length-prefixed fields prevent field-boundary shifting; `undefined` label is distinct from empty label in signature            |
| **Fail-closed design**       | Integrity errors raise exceptions; no silent mismatches or partial validation                                                  |
| **Structural not heuristic** | Defense is **deterministic and cryptographic**, not dependent on ML models, language patterns, or rule engines                 |
| **Source attribution**       | Wrapping includes source metadata (web, tool, MCP) and optional label for audit trails                                         |

## Non-Goals

- **Content filtering/sanitization** — we do not modify, redact, or clean the payload. Content is wrapped as-is.
- **Detection models** — we do not classify or detect injected prompts using heuristics or fine-tuned models. Defense is structural.
- **Encryption** — we do not encrypt content. HMAC proves integrity; confidentiality is external (use TLS, disk encryption as needed).
- **Key rotation** — not in scope. Key management (ceremony, rotation, storage) is application-level.
- **Canary tokens / out-of-band detection** — not in scope. Integrity verification is local; out-of-band signaling requires external infrastructure.
- **Asymmetric signing** — currently HMAC-SHA256 (symmetric); Ed25519 upgrade is deferred (WP-G2-Z01, aligning with provenance brick).

## Benchmark Parity Analysis

### OWASP LLM01 (Prompt Injection)

| OWASP Defense Category                                        | Our Model                            | Status        | Notes                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Structural delimiting**                                     | ⟦LAI-UNTRUSTED⟧ guard block + escape | ✓ **DÉPASSÉ** | We implement **spotlighting** (OWASP recommended) + **unforgeable delimiters** (escape, non-re-decoded). This exceeds static delimiter approaches because: (1) escaped content cannot forge closing marker, (2) rendering is one-way (no re-interpretation), (3) failed verification is fail-closed (not silent). Static delimiters alone are fragile; ours are cryptographically signed. |
| **Input validation**                                          | Source enum (6 known sources)        | ✓ Couvert     | We validate source against known enum; unknown sources throw `UntrustedSourceError`.                                                                                                                                                                                                                                                                                                      |
| **Output escaping**                                           | Delimiter escape + non-re-decoded    | ✓ **DÉPASSÉ** | Our escape sequence (`%u27E6` for `⟦`) is **intentionally non-standard and display-only**. It cannot be re-decoded downstream because the guard block is never re-parsed. This prevents the escape-bypass attack: injected `%u27E6` bytes remain literal in the prompt.                                                                                                                   |
| **Segregating untrusted content**                             | `trusted:false` + source attribution | ✓ Couvert     | OWASP recommends explicit segregation; we tag all external content `trusted:false` with source, enabling model instructions to treat it as data, not commands.                                                                                                                                                                                                                            |
| **Detection-based methods** (LLM classifiers, Rebuff, Lakera) | Out of scope                         | ✗             | We are **structural, not detection-based**. Detection models are probabilistic and can be evaded; our approach is deterministic (crypto-verified). They are **complementary**, not substitutes.                                                                                                                                                                                           |
| **Human-in-the-loop for high-impact actions**                 | Out of scope                         | ✗             | Policy enforcement (requiring approval for certain actions) is application-level, not our scope.                                                                                                                                                                                                                                                                                          |

**OWASP T1 Priority** (complementary to our structural approach):

1. **Defense-in-depth classification layer** — optional downstream detector (e.g., Lakera Guard, NeMo Guardrails) to flag suspicious patterns in the **already-guarded** content, acting as a second line before execution (currently: single-line defense; T1 = add optional detector gate)
2. **Canary tokens** — embed decoys in the guard block so injected instructions attempting to exfiltrate prove compromise (currently: not in scope; requires external signaling infrastructure)
3. **Role-based access control (RBAC)** — document how to use `source` + `label` metadata in authorization policies (e.g., "tool-output from untrusted APIs requires approval for file operations") (currently: metadata present but not bound to policy)

### Rebuff (Self-Hardening Prompt Injection Detector)

| Rebuff Feature                    | Our Model                  | Status    | Notes                                                                                                                                                  |
| --------------------------------- | -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Heuristic detection**           | Not implemented            | ✗         | Rebuff uses LLM analysis + heuristics to detect injection. We use **structural signing** instead (orthogonal, not competing).                          |
| **Canary tokens**                 | Not implemented            | ⚠ T1      | Rebuff embeds canary tokens that trigger if injected code attempts to exfiltrate. We do not; this is a T1 addition (requires out-of-band signaling).   |
| **Multiple detection techniques** | Single structural approach | ✓ Couvert | We are **simpler**: one cryptographic check. Rebuff combines heuristics; we trade detection breadth for certainty (no false negatives due to evasion). |

**Rebuff Alignment**: Rebuff was archived May 2025 (no longer maintained). Our structural approach is more future-proof because it does not rely on training data for new attack patterns.

### Lakera Guard (Real-Time Prompt Injection Detection)

| Lakera Feature                     | Our Model                               | Status      | Notes                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API-based classification**       | Not applicable                          | ✗           | Lakera Guard is a cloud service that classifies inputs. We are **air-gapped** (no external service).                                                                                           |
| **Real-time threat intel updates** | Not applicable                          | ✗           | Lakera updates models based on attack intelligence; we are static (no model updates).                                                                                                          |
| **Document-level detection**       | We detect **tampering**, not **intent** | ✓ Different | Lakera detects semantic injection attempts; we detect structural tampering (HMAC failure). **Complementary**: Lakera asks "is this prompt injection?"; we ask "has this content been altered?" |

**Lakera Alignment**: Could use Lakera Guard as a second-line detector on already-guarded content (T1 addition). Lakera's classification becomes more reliable when applied to cryptographically verified, source-attributed content.

### NVIDIA NeMo Guardrails (Programmable Conversation Rails)

| NeMo Feature                             | Our Model                                           | Status    | Notes                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Colang DSL for conversation policies** | Not implemented                                     | ✗         | NeMo is a DSL + runtime for policy enforcement. We handle **data integrity**, not **conversation policy**.                                                                                                                                                                      |
| **Safety rails / instruction filtering** | `trusted:false` segregation                         | ✓ Couvert | We separate untrusted data from instructions via the guard block. NeMo's rails enforce that model follows instructions + ignores data-disguised-as-commands. **Complementary**: our envelope prevents the disguise; NeMo enforces the policy if disguise attempts slip through. |
| **Multilingual support**                 | Length-prefixed canonical form is encoding-agnostic | ✓ Couvert | Our HMAC is computed over UTF-8 bytes, so it works with any language. Delimiter escape uses Unicode code points (U+27E6, U+27E7), not locale-specific.                                                                                                                          |

**NeMo Alignment**: Excellent pairing. NeMo Guardrails on top of our envelopes: NeMo's policies can reference `source` and `label` metadata to make context-aware decisions (e.g., "tool-output requires less trust than web content").

### Microsoft Prompt Shields

| Prompt Shields Feature                 | Our Model                          | Status    | Notes                                                                                                                                                                                                          |
| -------------------------------------- | ---------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Classifier for User Prompt attacks** | Not implemented                    | ✗         | Shields uses a probabilistic classifier; we use cryptographic signing.                                                                                                                                         |
| **Classifier for Document attacks**    | We sign documents + tag untrusted  | ✓ Couvert | Shields detects hidden instructions in external documents. We make document origin **explicit** (`source="web"`, `source="tool-output"`) and **verifiable** (HMAC); implicit malice becomes explicit metadata. |
| **Contextual awareness**               | We include source + label metadata | ✓ Couvert | Shields considers context; we provide structured context (`source`, `label`, `capturedAt`) for downstream policy engines.                                                                                      |
| **Integration with Defender XDR**      | Out of scope                       | ✗         | Not applicable to self-hosted deployments.                                                                                                                                                                     |

**Prompt Shields Alignment**: Shields + envelope bricks are complementary. Shields detects semantic injection; we ensure content integrity and source transparency. Use envelope for data **integrity**, Shields for policy **enforcement**.

---

## Security Properties

### Integrity

- **HMAC-SHA256** — any alteration to content, source, label, timestamp, or schema version changes the MAC
- **Constant-time comparison** — `timingSafeEqual()` prevents timing attacks on MAC verification
- **Fail-closed** — verification failure raises `EnvelopeIntegrityError`; no silent mismatches

### Injection Prevention

- **Structural, not heuristic** — defense is deterministic (crypto verification) + deterministic (escape rules), not dependent on pattern matching or model behavior
- **Delimiter escape** — content cannot forge the closing marker (`⟦/LAI-UNTRUSTED⟧`) because:
  1. Delimiters are escaped before wrapping
  2. Escape sequence is intentionally non-standard and display-only
  3. Rendered guard block is never re-parsed or re-decoded
- **Fail-closed on verification failure** — unverified or tampered envelopes are never rendered

### Source Attribution

- **Explicit source metadata** — every enveloperecords where content came from (web, tool, MCP, etc.)
- **Optional labeling** — human-readable labels enable audit trails and policy decisions
- **Metadata is signed** — source and label are part of the MAC, so they cannot be forged independently

### Non-Goals

- **Confidentiality** — content is signed but not encrypted; assume untrusted channels use TLS
- **Freshness** — `capturedAt` is advisory (client-supplied); rely on external timestamp authority if freshness is required
- **Revocation** — HMAC keys cannot be revoked retroactively; key rotation is offline

---

## Implementation Notes

### Key Management

**Current** (WP-G2-Z01, deferred):

- HMAC uses symmetric shared keys (16–32 bytes recommended per NIST SP 800-107)
- Key is shared between producer and verifier (no origin authentication)

**Future** (WP-G2-Z01):

- Ed25519 upgrade: asymmetric signing (only keyholder produces; anyone with public key verifies)
- Aligns with provenance brick (which already uses Ed25519)
- Reduces key management overhead (one signing key, many public keys for verification)

### Canonical Serialization

Fields are serialized as `<length>:<bytes>` to prevent boundary-shifting attacks:

```
<schema-version-bytes-count>:<schema-version>
<trusted-flag-bytes-count>:<"false">
<source-bytes-count>:<source>
<label-presence-count>:<"0" or "1">
<label-bytes-count>:<label or "">
<content-bytes-count>:<content>
<capturedAt-bytes-count>:<capturedAt>
```

This ensures two different envelopes cannot share the same MAC (e.g., swapping source and content would change the byte structure, not just the order of fields).

---

## Registry Note

**Libre AI Envelope Brick v1** is suitable for:

✓ **Structural prompt injection defense** — cryptographically verified, unforgeable delimiters, source-attributed untrusted content
✓ **Air-gapped, self-hosted** — no external detection service required; works offline
✓ **Multi-layered defenses** — pairs with detection models (Lakera, Shields) or policy engines (NeMo Guardrails) as complementary second lines
✓ **Audit compliance** — envelopes create verifiable records of external data ingestion with source attribution

⚠ **Limitations**:

- **Symmetric HMAC** (symmetric — currently) — does not provide origin authentication; upgrade to Ed25519 deferred to WP-G2-Z01
- **No detection component** — does not classify or detect injected prompts; only verifies integrity and segregates untrusted content
- **Delimiter escape non-standard** — intentionally, to prevent re-decoding; consumers must understand this design choice
- **No canary tokens** — does not detect exfiltration attempts; out-of-band monitoring is external

**Complementary Approaches** (not substitutes):

- **Detection models** (Lakera Guard, Microsoft Prompt Shields, NeMo Guardrails) — apply to guarded content as a second line
- **RBAC policies** — use `source` + `label` metadata in authorization decisions
- **Model instructions** — train/prompt models to ignore data inside guard blocks (outside scope here)

**Next Gates** (before v1 stabilization):

- [ ] Upgrade HMAC to Ed25519 (WP-G2-Z01)
- [ ] Document integration with Lakera Guard / Prompt Shields as optional second-line detectors
- [ ] Add optional `canaryToken` field (placeholder for future canary integration)
- [ ] Edge case testing: very large content, Unicode edge cases (delimiters in different scripts), concurrent verification under load

---

## Sources

- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [Defending Against Indirect Prompt Injection Attacks With Spotlighting](https://ceur-ws.org/Vol-3920/paper03.pdf)
- [Microsoft Prompt Shields - Azure AI Content Safety](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/prompt-shields)
- [Lakera Guard: Prompt Injection Detection API](https://lakera.ai/guard)
- [NVIDIA NeMo Guardrails](https://github.com/NVIDIA-NeMo/Guardrails)
- [Structural Template Injection Research](https://arxiv.org/pdf/2602.16958)
- [Prompt Fencing: Cryptographic Approaches](https://arxiv.org/pdf/2511.19727)
