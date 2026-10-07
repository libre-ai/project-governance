# Source Ingestion — Citable Attachments for Sessions

- **Path:** `apps/sessions/src/ingestion` (module inside the `sessions` repository — recommended location, Design decision 1)
- **Owner:** Experiences / Sessions (ingestion sub-domain)
- **Runtime:** Bun/TypeScript for request validation, neutralization and evidence assembly; native/WASM parser selection for the two heaviest formats stays an open, separately-gated decision (Design decision 4)
- **Tenant model:** organization (inherits Sessions' RLS; every extract carries `tenantId`)

## Purpose and actors

Source ingestion turns a document a facilitator attaches to a session into two things the session can act on: a `sourceReference` the session can cite, and one or more citable extracts a synthesis (or a human) can quote without ever handing a model raw, unreviewed tier-3 bytes. `AttachSource` already exists in Sessions' domain protocol (`docs/apps/sessions.md`, `sessions` repository) — this draft specs the capability behind that command name, it does not invent a new product. Sessions' own `project.v1.yaml` already describes the app as sessions "anchored in cited sources" — ingestion is the missing half of that claim.

Actors: **facilitator** (attaches a document, sees named refusals on rejection), **participant** (reads/cites attached extracts under the session's audience policy), **generation provider adapter** (receives only enveloped extracts, never raw source bytes), **auditor** (inspects the evidence report an ingestion run produced, without needing the original file).

## Design decisions

Four decisions this draft locks a recommendation for, in the structured-options form ADR-0022/I-24 requires: genuine alternatives, consequences, one recommendation only where a real one exists, trivial choices decided alone and flagged.

### 1. Where the capability lives

| Option                                                                                        | Consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — New couche-3 satellite repository (sibling of `provenance`, `classification`, `envelope`) | Matches the granularity precedent for trust-boundary bricks and puts the code under K4's elevated review discipline immediately. But it has **zero second consumer today**: `missions`/`agent-board`, `spec-studio` and `orchestrator`/`memory` all already consume `evidence-report.v1`, and none of them ingest documents — `agent-board.md` only links evidence, `spec-studio`'s `AttachContract` routes large blobs through Artifact/Cellar manifests (a different mechanism), `orchestrator/memory.md` writes agent-recalled text, never parses a file. Building a shared brick now is speculative — against I-19's need-capture rule. Adds a git-dep pin and a separate release cycle for exactly one consumer. |
| **B — Module inside `apps/sessions` (recommended)**                                           | Matches I-19 dogfooding-first — Sessions is the only proven consumer, `AttachSource` is already in its protocol — and the owner's own granularity re-ratification today (ADR-0023, ADR-0025; both 2026-08-18): no new repository unless a boundary truly forces one. It also mirrors the historical shape: the retired ingestion/memory crates (Design decision 4) lived as separate crates _inside_ the same repository as their one caller, never as an external dependency. Isolate the code as its own subpackage (`apps/sessions/src/ingestion/`, parallel to the existing `src/rgpd`, `src/authz` boundaries), never inline in command handlers, so a later extraction is a `git filter-repo`, not a rewrite.   |
| C — Extend `data` (couche-4 lifecycle brick)                                                  | Rejected. `data`'s real surface (`retention-bounds`, `tenant-row-guard`, `deletion-receipt`, RLS adapters) is retention/tenancy mechanics with zero parsing; conflating "how long a row lives" with "how untrusted bytes get neutralized" breaks the single-responsibility precedent every other couche-3/4 brick follows.                                                                                                                                                                                                                                                                                                                                                                                            |
| D — Extend `provenance` (couche-3, agent-contributor lineage)                                 | Rejected. `provenance`'s one schema (`AgentContributorLineage v1`, Ed25519-signed) answers "which agents touched this artifact." A source extract answers "what does this external document say, and is it safe to show a model" — a different question over a different trust boundary (external/untrusted input, not internal agent attestation).                                                                                                                                                                                                                                                                                                                                                                   |

Two named triggers promote B → A later, applying the same need-capture discipline this decision already used once: (i) a second product requests ingestion through need-capture (I-19) — `spec-studio`'s `AttachContract` and `missions`' evidence linking are the candidates most likely to ask first; (ii) the untrusted-parsing surface needs a sandbox boundary the Bun app process cannot itself provide (`AGENT-RUNTIME-DOCTRINE.md` §3 — network-denied, disposable-workspace, fail-closed isolation) — a deployment-topology question, not a code-sharing one, but one that forces the module out of the request-handling process regardless of how many consumers exist by then.

### 2. The contract

**Input:** raw bytes (or a URL, once network egress is a named, separately-gated decision — see Design decision 4) plus a declared `mediaType`, a caller-declared `licence`, and an `ExtractionPolicy` (`maxBytes`, `allowedMediaTypes`, network policy).

**Output:** one `sourceReference` — reusing `contracts/schemas/common.v1.schema.json#/$defs/sourceReference` exactly as it stands (`uri`, `retrievedAt`, `digest`, `licence`): this is not a new type to design, it is already the shape `session-export.v1.schema.json#/properties/sources` expects, which means `AttachSource` was already contractually committed to emitting it — plus N `SourceExtract` records (new schema, `source-extract.v1`, to be authored in `contracts`) and one `evidence-report.v1` object whose `checks[]` are exactly the refusal-matrix codes below, `reasonCode`-populated on `fail`/`indeterminate` as that schema already requires.

Every `SourceExtract`'s public reference is constrained to fit `common.v1.schema.json#/$defs/artifactReference` (`id`, `digest`, `mediaType`, no other properties) — the same shape `evidence-report.v1.checks[].evidence` and `session-export.v1.approvedOutcomes[]` already use, so a citable extract slots into `RequestSynthesis`'s evidence list without inventing a new reference type. `mediaType` on every extract is **always** `text/plain`: enforced by construction — neutralization has exactly one output format — not by a scanner. This is the same structural-not-heuristic posture the envelope brick already takes for delimiter escaping (`DRAFT-SPEC-envelope.md`: "structural, not detection-based").

Named mechanical refusals are specified in full under **Refusal matrix** below (`ingestion.*`, mirroring the `memory.*`/`sessions.*` domain-prefix convention); the three the mission named explicitly are `ingestion.unsupported_format`, `ingestion.document_too_large` and `ingestion.active_content_detected`.

One mechanical consequence worth naming here rather than burying in a table: `sourceReference.licence` is a **required** field in the existing, already-locked `common.v1` contract. Ingestion cannot default it — a facilitator must declare a licence at attach time, or the attach is refused (`ingestion.licence_missing`). This is not a new policy this draft invents; it is a pre-existing contract requirement that document ingestion is the first capability forced to actually satisfy.

### 3. The security boundary

Two invariants from `AGENT-RUNTIME-DOCTRINE.md`, made concrete for this capability:

- **Untrusted data boundary / tier-3 neutralization before exposure (§1).** An attached document is external, unreviewed content from the instant it arrives — no different in kind from a web page or a tool result. Neutralization happens once, inside the ingestion module, before any extract exists: active content (script/handler/embedded-object/macro) is refused outright, not stripped-and-continued (a deliberate deviation from the retired code's behavior — see Design decision 4); text is validated as UTF-8; every extract's reliability is sealed `operational` via `@libre-ai/classification`'s `classify()` at creation, never `authoritative`, and any sink that would need authority fails closed through `requireAuthorityFor` by construction, not by caller discipline.

  A named kill predicate governs this, on the precedent of `travel-agent`'s ADR-0002 `injection-relay` ("a test proves it, and the kill predicate is a condition of the product's existence, not a nice-to-have"): `ingestion.injection-relay` fails the build if any reachable path lets an ingested extract's content reach a model's context without first going through `wrapUntrusted`/`renderGuarded`. This is not optional hardening layered on afterward; it is the reason the module is allowed to exist at all — exactly the role the travel-agent predicate plays for its own agentic surface.

- **Model-visible ⟺ logged (§2).** Every extract byte that reaches `RequestSynthesis`'s model call must already be present in Sessions' append-only event stream (`SourceAttached`, carrying the extract digests) before the completion is requested — reconstructible from that log, never from the model's own account of what it read.

One concrete contract gap this draft surfaces rather than papers over: `@libre-ai/envelope`'s `UntrustedSource` enum (`envelope/src/index.ts`) is closed to `"web" | "email" | "memory" | "tool-output" | "tool-description" | "mcp-description"` — none of these fit "a document a facilitator attached to a session." Shipping this module needs a new enum member (candidate: `"attachment"`) added to `envelope.v1`. That is itself a K3 mutation, and therefore falls under K4's review discipline (human review + signature + bounded rollback, `LOOP-SECURITY-KERNEL.md` K4) — a cross-repository dependency of this spec on `envelope` that this draft cannot resolve unilaterally.

`THREAT-MODEL.md` surface 2 ("Server + RLS apps") already lists "LLM prompt-injection via untrusted tool output" for Sessions, but its threat surface does not yet itemize parsing-layer risk (decompression bombs, malformed-file crashes, active-content execution) as distinct from the LLM-injection risk already covered there. Recommend a follow-on line in that entry once implementation starts against this draft; adding it now is out of this PR's single-file scope.

### 4. What the retired history hands back

The two Rust crates removed from the `sessions` repository's working tree in commit `2536ad1` (2026-07-30) — a document/text-extraction crate and a local-first source-and-memory-custody crate, both vendored (`5cc2657`) under MIT from `libre-ai/context-kit` (upstream repository no longer exists, 404; rev `f0c10bf3`) — remain reachable at `2536ad1^` for archaeology. Their own names are retired brand tokens (`LEXICON.md` §6.1, I-04) and are not repeated in this document; the verdicts below cite them by function, not by name.

Corrected size: **3,958 lines** of Rust source (the mission's ~3,649 figure counted only the two crates' `lib.rs` files and missed a 309-line ingestion-glue module) plus two byte-tiny fixtures whose only job is proving the PDF/Office paths fail closed regardless of content — nobody ever parses their bytes.

| Module                                                                                   | Verdict                                            | Why                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text/Markdown/HTML normalizer (~700 lines)                                               | Design reusable, code partially portable           | The contract shape (canonical document + evidence report + hash-chained provenance) and the fail-closed-on-policy pattern are worth keeping. The HTML stripper is a hand-rolled, nesting-blind tag remover — replace with a real parser, do not port it.                                                                                   |
| PDF / Office extraction                                                                  | Neither portable nor reusable                      | Permanently-failing stubs by design — no parser was ever selected (blocked on an unresolved dependency-advisory / sandboxing decision that was apparently never made). Only the function signatures and error-variant shape are worth keeping.                                                                                             |
| Feed parser (RSS/Atom/JSON Feed, ~230 lines)                                             | Code directly portable                             | Hand-rolled, zero-dependency XML/JSON string search; fragile on malformed or deeply nested feeds but adequate for well-formed ones.                                                                                                                                                                                                        |
| Security scanner (prompt-injection/PII/secret regex + entropy heuristics, ~250 lines)    | Idea reusable, code not trustworthy as a sole gate | English-only, label-gated PII detection (requires an `email:`/`phone:` prefix) misses most real PII. Useful as a first-pass signal layered under the structural K3 envelope, never as the boundary itself — the same "detection is telemetry, not a guard" conclusion `AGENT-RUNTIME-DOCTRINE.md` §4 already reaches for risk classifiers. |
| Content-addressed custody ledger + crash-safe multi-record mutation journal (~700 lines) | Design and most code directly portable             | The single most reusable piece: atomic multi-record writes with journal-replay crash recovery, three explicit crash-simulation tests, storage-backend-agnostic by construction (a trait, not a concrete store).                                                                                                                            |
| Reference JSON-file store                                                                | Portable as a dev/test backend only                | Linear-scan lookups, no concurrent-writer story past a single in-process lock; fine as a zero-dependency test double, not as a production store.                                                                                                                                                                                           |
| Embedding / code-graph schema fields                                                     | Schema-only, nothing to reuse                      | Fields exist (an embedding-model reference, code-graph types); no embedding computation and no graph-building parser exists anywhere in this crate history.                                                                                                                                                                                |
| RGPD soft-delete/anonymize path                                                          | Design directly reusable                           | Soft-delete-with-audit-trail via the same custody-mutation path; text is nulled on anonymize with an explicit never-resurrect comment.                                                                                                                                                                                                     |

None of this is adopted by this draft — the mission scopes reuse to a verdict, not an extraction. The one design decision this history forces onto Decisions 2 and 3 above: **PDF, Office and URL-fetch stay named, fail-closed refusals in the first shippable increment** (`ingestion.unsupported_format` / `ingestion.source_unreachable`), continuing the exact posture the retired code already committed to, rather than reopening the parser-selection/sandboxing question this draft is not scoped to answer.

## Journeys

1. **Attach a source:** facilitator submits a document to a session; ingestion validates policy, neutralizes, extracts, seals every extract `operational` (K2), and emits `sourceReference` + extracts + evidence report. On `status: pass`, Sessions' `AttachSource` persists the result and emits `SourceAttached`. On `fail` or `indeterminate`, the facilitator sees the exact refusal code and reason; nothing is persisted.
2. **Cite an extract in synthesis:** `RequestSynthesis` reads only extracts already attached and approved — it cannot bypass attached-source IDs (`docs/apps/sessions.md` already states this as a non-goal for RAG/vector retrieval). Each extract is wrapped via `wrapUntrusted`/`renderGuarded` before a model sees it; the append-only log records exactly which extract digests were included, before the completion call is made.
3. **Audit an ingestion run:** auditor retrieves the `evidence-report.v1` object for a given source and sees every check (format, size, UTF-8, active-content, licence) with its `pass`/`fail`/`reasonCode` — without needing the original file.
4. **Delete or anonymize an attached source (RGPD):** mirrors the retired custody ledger's soft-delete-with-trail design (Design decision 4) — extract text is nulled, the `sourceReference` digest and event trail are retained for provenance, and the text is never resurrected.

## Non-goals

- PDF and Office extraction in v1 — named, fail-closed refusal (Design decision 4), not a missing feature to apologize for;
- URL fetch / network egress in v1 — named, fail-closed refusal; SSRF and egress-policy questions are unresolved and out of this draft's scope;
- embeddings, vector indexing or RAG retrieval — `docs/apps/sessions.md` already states RAG/vector retrieval is not authority and cannot bypass attached-source IDs; ingestion produces citable text, not a search index;
- becoming a shared couche-3 brick before a second concrete consumer exists (Design decision 1);
- detection-based content moderation as _the_ security boundary — heuristics inform, the K2 seal + K3 envelope + fail-closed refusal are the actual boundary (Design decision 3);
- resurrecting the retired crates' names, or their code, wholesale — Design decision 4 is a verdict, not an extraction plan.

## Domain protocol

**Commands:** `IngestSource(tenantId, sessionId, input, policy)` → `{sourceReference, extracts[], evidenceReport}` — internal, called by Sessions' own `AttachSource` (already in `docs/apps/sessions.md`'s protocol; this draft does not add a new session-level command).

**Queries:** `GetSourceExtracts(sourceId)`, `GetIngestionEvidence(sourceId)`.

**Events:** none new. `SourceAttached` (Sessions' existing event) carries the `sourceReference` and extract ids; ingestion does not own a second event stream for the same fact — Sessions' append-only stream remains the one authority (matches `docs/apps/sessions.md`: "Authoritative session stream is append-only by tenant/session revision").

An ingestion run is synchronous and stateless from the caller's perspective: `pass` → attach; `fail`/`indeterminate` → nothing persisted, mirroring `evidence-report.v1`'s own status semantics (all `checks[]` must pass for an overall `pass`; any `fail` forces overall `fail`).

## Refusal matrix

| Code                                  | Refusal                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ingestion.unsupported_format`        | media type not in the policy allowlist, or a format whose parser is not yet qualified (PDF, Office — Design decision 4)                 |
| `ingestion.document_too_large`        | byte length exceeds `policy.maxBytes`                                                                                                   |
| `ingestion.non_utf8_input`            | text-like input is not valid UTF-8; no transcoding is attempted                                                                         |
| `ingestion.active_content_detected`   | script/handler/embedded-object/macro detected; refused outright, never stripped-and-continued                                           |
| `ingestion.licence_missing`           | `sourceReference.licence` not supplied — the locked `common.v1` contract requires it, ingestion cannot default it                       |
| `ingestion.source_unreachable`        | URL fetch failed or was blocked by network policy (`Disabled` is the only policy this draft ships — Design decision 4)                  |
| `ingestion.digest_mismatch`           | retrieved bytes' digest does not match a previously recorded `sourceReference.digest`                                                   |
| `ingestion.tenant_mismatch`           | ingestion invoked outside the caller's RLS tenant                                                                                       |
| `ingestion.classification_prohibited` | attempted write with a reliability other than `operational` — K2 mirror of `memory.classification_prohibited`                           |
| `ingestion.envelope_missing`          | a model-facing path renders an extract without `wrapUntrusted`/`renderGuarded` first — K3 mirror of `memory.recall_untrusted_uncovered` |

Failure never loses the evidence report: a `fail` still returns the full `checks[]` list with `reasonCode`s, so a facilitator sees exactly what to fix without resubmitting blind.

## Data

PostgreSQL (Sessions' existing tenant database) owns `SourceExtract` rows (tenant-scoped, RLS) and the ingestion evidence report per source. Raw uploaded bytes are **not** retained after extraction — only the `sourceReference` digest and the produced extracts persist. This matches `spec-studio`'s own pattern of never persisting raw production data server-side, and it minimizes how much tier-3 material stays at rest at all. Retention follows ADR-0002 section 3, as the rest of Sessions' content already does.

## Authentication and authorization

Attenuated Biscuit, `capability_scope ∈ {source_ingest, source_read}`, exact resource `session/<id>`. Ingestion never receives more than the session-scoped attenuation Sessions' generation-call pattern already uses (`docs/apps/sessions.md`: "attenuated Biscuit limited to one session, permitted source/contribution IDs and draft"). RLS is checked on every `SourceExtract` row and every evidence-report read.

## Runtime boundaries

TypeScript (Bun) owns request validation, the text/HTML/Markdown/feed normalizer, the security-scan heuristics, evidence-report assembly, and the K2/K3 calls. No Rust crate currently exists in the `sessions` repository for parsing (`crates/server` is frozen-home debris carried only for its `static/` directory, not a live crate). If and when PDF/Office parsing is unblocked, both the historical precedent (Design decision 4) and I-06 (Rust reserved for "moteurs spécialisés, sécurité, preuve") argue for a Rust or WASM-sandboxed parser rather than a pure-TypeScript one — but selecting that parser and its sandbox is explicitly out of this draft's scope, exactly as it was left unresolved historically.

## Accessibility and degraded mode

Refusals are textual, never color- or icon-only, matching Sessions' existing accessibility invariant. A facilitator sees the exact `reasonCode` and can retry with a corrected document. Ingestion outage degrades to manual sourced outcomes exactly as `docs/apps/sessions.md` already specifies for provider outage — a session remains usable without new attachments.

## Contracts

- Source Reference — `contracts/schemas/common.v1.schema.json#/$defs/sourceReference` (reused as-is, no change);
- Artifact Reference — `contracts/schemas/common.v1.schema.json#/$defs/artifactReference` (reused as-is for every extract's public reference);
- Source Extract v1 — `contracts/schemas/source-extract.v1.schema.json` (to be authored);
- Evidence Report v1 — `contracts/schemas/evidence-report.v1.schema.json` (reused; this module's own audit output);
- Session Export v1 — `contracts/schemas/session-export.v1.schema.json` (already expects `sources[]: sourceReference[]` — confirms the target shape, no schema change needed there);
- `@libre-ai/classification` — `classify`, `requireAuthorityFor` (K2, reused as-is);
- `@libre-ai/envelope` — `wrapUntrusted`, `verifyEnvelope`, `renderGuarded` (see `LOOP-SECURITY-KERNEL.md` K3) — this module cannot call it until the `UntrustedSource` enum gains a new member (Design decision 3, cross-repository, gated by the K4 review discipline);
- Biscuit policy — `contracts/authz/sessions-v1.datalog` extension for `source_ingest`/`source_read` capability scopes (to be authored).

## Evidence

**Unit tests:** one fixture per named refusal code, including PDF/DOCX/URL fixtures that assert the fail-closed path fires regardless of content (the retired crates already proved this pattern with two byte-tiny fixtures; the intent is worth keeping even though the code is not).

**Security tests:** the `ingestion.injection-relay` kill-predicate test — an extract's content never reaches a model call unwrapped, under adversarial fixtures (embedded script, embedded macro marker, prompt-injection phrasing); active-content detection refuses rather than silently strips; cross-tenant RLS denial on `SourceExtract` reads.

**Integration tests:** `RequestSynthesis` cannot cite an extract whose source was never attached to the session (mirrors the existing sessions.md non-goal); crash-recovery test for the custody-mutation-style write path if Design decision 4's ledger design is adopted for extract persistence.

## Work packages

1. Source-extract schema + evidence-report wiring — Canonical Core (`contracts`).
2. Text/Markdown/HTML/feed normalizer and security-scan port — Experiences (`sessions` repository, `src/ingestion`).
3. K2/K3 integration, including the `envelope.v1` `UntrustedSource` enum addition — cross-repository (`sessions` + `envelope` + `contracts`), under the K4 review discipline.
4. Biscuit `capability_scope` + RLS wiring — Experiences + Rust authorizer (Sessions' existing Biscuit boundary).
5. Evidence/audit UI surface for facilitators and auditors — Experiences.
6. Qualification: refusal-matrix fixtures, kill-predicate test, cross-tenant denial, `RequestSynthesis` source-bypass denial — Infrastructure and Release.

Work package 3 is gated on the `envelope` repository accepting the enum addition (Design decision 3) before any extract can be shown to a model; work packages 1–2 can proceed in parallel once the source-extract schema is accepted.

## Release and rollback

Release requires: every named refusal has a fixture proving it fires; the `ingestion.injection-relay` kill-predicate test is green; cross-tenant RLS denial on `SourceExtract` is proven; `RequestSynthesis` is proven unable to cite an unattached source. Rollback disables `IngestSource` first — existing attached sources and extracts remain readable — and never rewrites a persisted extract or evidence report, matching Sessions' own append-only-events-never-rewritten rule.

---

**DRAFT — Specification Lock pending.** This specification is a locked contract (immutable after pronouncement) under the orchestrator Specification Lock (ADR-0011). Changes to the source-extract schema, classification rules (K2), or envelope integrity (K3) require a new ADR, independent security review, and owner approval. Governance path: Gate → ADR → Specification Lock → Release.

---

## Summary for owner review

**Decisions (4), recommended:**

1. **Where it lives:** module inside `apps/sessions` (`src/ingestion`), not a new couche-3 repository — no second consumer exists yet (I-19 need-capture), matches today's granularity re-ratification (ADR-0023/ADR-0025). Two named triggers promote it to a satellite later.
2. **The contract:** reuse `common.v1`'s `sourceReference` and `artifactReference` as-is — no new provenance type needed; one new schema (`source-extract.v1`) for the extract itself; ingestion's own audit trail is an `evidence-report.v1` object.
3. **The security boundary:** tier-3 neutralization before any extract exists (fail-closed on active content, not strip-and-continue); K2 seals every extract `operational`; K3 wraps every model-facing extract; a named kill predicate (`ingestion.injection-relay`, on the `travel-agent` ADR-0002 precedent) makes an envelope bypass a build failure, not a bug ticket. Requires a K3 enum addition in `envelope` first — a cross-repository, K4-gated dependency.
4. **Historical reuse:** design of the custody ledger and the RGPD soft-delete path is directly reusable; the text/HTML/feed normalizers are portable with rework; PDF/Office/security-scan code is not — those paths were permanently-failing stubs or weak heuristics, not working implementations. Nothing is extracted in this PR.

**File path:** `docs/parity/draft-specs/DRAFT-SPEC-source-ingestion.md`
