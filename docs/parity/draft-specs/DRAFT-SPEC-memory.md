# Memory — Agent Persistent Recall

- **Path:** `apps/memory`
- **Owner:** Polaris / Memory (recall service for agent fleets)
- **Runtime:** Bun/TypeScript for API + domain logic; Rust for embedding/canonicalization; PostgreSQL + pgvector for durable storage; optional self-hosted embedding engine (Ollama/Jina) for sovereignty
- **Tenant model:** organization (RLS-enforced; each agent bound to exactly one tenant via Biscuit K1 identity)

## Purpose and actors

Memory is the durable, governed recall layer for the Polaris orchestrator fleet. Agents write operational knowledge (facts recalled from prior runs, tool outputs, interaction summaries); recall and search return context-relevant memories, scoped by agent identity (K1) and tenant isolation (RLS).

**Actors:**

- **Agents** (readers/writers): recall knowledge during execution; record facts, observations, summaries after runs; cannot author authoritative claims (K2 classification enforced).
- **Tenants** (governors): own memory data; configure retention, summarization, and deletion policies per memory type; audit memory lineage (provenance chain).
- **Operators** (auditors): inspect memory provenance chains, export snapshots, validate retention compliance, manually trigger deletion.

**Doctrine constraints:**

1. **Recalled memory is never authoritative** (K2): every memory carries `classification ∈ {operational, derived, historical}`. Only `operational` memories exist; no write to a source of truth (gates, permissions, contracts) may depend on recalled memory alone.
2. **Untrusted recalled content is wrapped in K3 envelope** (`trusted:false`, HMAC-signed, origin-agent recorded). When an agent recalls a memory and feeds it to a model, the model sees the envelope, not raw memory.
3. **Sovereignty — no cloud vector store**: embeddings are computed by self-hosted service (Ollama, Jina, or embedded pgvector) within the tenant's infrastructure boundary. Cross-tenant embedding indices are forbidden; PII-containing memories never leave the tenant's encryption key scope.

## Journeys

1. **Write a memory:** agent records a recalled fact, observation, or summarized interaction. Memory carries source (agent_id, mission_id, interaction_id), confidence level (high/medium/low), TTL, tags, and natural-language text. Classification is assigned (always `operational` for initial writes). Memory is written to PostgreSQL with E2EE at rest if marked sensitive; embedding is computed immediately (async, tenant-scoped embedding service).

2. **Recall under scope:** agent queries memories by entity, recency, semantic relevance, or tag. Queries respect K1 identity (agent must have Biscuit fact for mission_id and memory_read capability); results are filtered by tenant RLS. Semantic retrieval uses multi-strategy: vector similarity + BM25 (keyword) + recency. Results are ranked by relevance + time-decay. Retrieved memories are wrapped in K3 envelope before delivery to agent caller.

3. **Summarize and compact:** episodic memories (interaction-specific facts) are periodically compacted into semantic summaries (general learnings, patterns). Compaction is time-triggered (e.g., weekly) or event-triggered (memory count threshold). New semantic memories are written with `historical` classification, and their provenance chain links to source episodic memories they summarize. Episodic memories age into `historical` tier automatically after TTL expiry (before deletion).

4. **Inspect memory provenance:** auditor retrieves the complete lineage chain of a recalled memory: source interaction (timestamp, agent, mission), summarization steps (if any), recall operations (when, by whom, confidence), and any external mentions (exports, audits). Provenance is immutable and tamper-evident (HMAC-signed envelope applied transitively across the chain).

5. **Forget / Delete with receipt:** agent or tenant requests deletion of specific memories (e.g., RGPD data erasure, retention expiry, manual purge). Deletion is immediate in all active stores (live PostgreSQL + vector index). An immutable tombstone record is issued (signed receipt) recording: deletion requester, timestamp, deleted memory ID, deletion reason (retention_expiry | user_request | compliance | manual). Backups expire within 35 days per ADR-0002. A legal hold can block deletion with auditable reason and deadline.

6. **Export memories:** tenant exports a snapshot of all memories for a given agent/mission/time-window. Export is content-addressed; encryption wraps the export payload. Provenance is included (lineage of each memory). Export digest is cryptographic and immutable; no in-place editing of exports.

## Non-goals

- **Memory as authoritative truth**: recalled memory is never a basis for writes to source-of-truth systems (contracts, permissions, doctrine, gates). Only sealed K2-authoritative payloads grant that.
- **Unbounded retention**: all memories have explicit TTL (default per ADR-0002 memory-type table); no indefinite storage.
- **Cloud vector-store dependency**: Pinecone, Weaviate Cloud, or other managed third-party indices are forbidden; memory is sovereign.
- **Cross-tenant recall**: queries never return memories from other tenants, regardless of semantic relevance. RLS is enforced at the storage layer.
- **Editing memory history**: once written, memory content and provenance are immutable. Corrections appear as new memories with linkage to the original (correction chain).
- **Memory as bearer of identity claims**: exported memories carry no Biscuit; a consumer imports them under its own authorization.

## Domain protocol

**Commands:**

- `WriteMemory(agent_id, mission_id, interaction_id?, text, tags[], sensitivity: bool, confidence: high|medium|low, ttl_days?: int)` → memory_id, embedding_id
- `QueryMemories(agent_id, mission_id, query: string, filters?: {recency, tags, confidence_min}, limit: int, offset: int)` → [Memory + envelope]
- `SummarizeMemories(agent_id, mission_id, memory_ids[], summary_text, tags[])` → semantic_memory_id, lineage_link[]
- `CompactMemories(tenant_id, memory_type: episodic|semantic, age_threshold_days: int)` → compacted_count, new_summary_ids[]
- `RequestDeletion(requester_id, memory_id[], reason: retention_expiry|user_request|compliance|manual, legal_hold?: {reason, expiry})` → deletion_receipt_id
- `ExportMemories(tenant_id, agent_id|mission_id, time_window?: {start, end})` → export_id, digest, encrypted_payload
- `InspectProvenance(requester_id, memory_id)` → lineage_chain, signatures

**Queries:**

- `GetMemory(agent_id, memory_id)` → Memory + envelope
- `SearchMemories(agent_id, query, strategy: semantic|keyword|temporal, limit)` → ranked [Memory + envelope]
- `GetMemoryLineage(memory_id)` → [LineageEntry] (source → summarizations → recalls → exports)
- `GetRetentionPolicy(tenant_id, memory_type)` → {ttl_days, compaction_interval, deletion_limit}
- `ListExports(tenant_id, filter?: {agent_id, mission_id, time_window})` → [ExportMetadata]
- `ListDeletions(tenant_id, filter?: {requester_id, reason, time_window})` → [DeletionReceipt]

**Events:**

- `MemoryWritten(memory_id, agent_id, mission_id, classification, timestamp, tags[])`
- `MemoryRecalled(memory_id, agent_id, requester_id, timestamp, confidence_after_ranking)`
- `MemorySummarized(summary_memory_id, source_memory_ids[], lineage_link_id, timestamp)`
- `MemoryCompacted(episodic_count, semantic_count, timestamp)`
- `DeletionRequested(deletion_receipt_id, memory_id[], requester_id, reason, timestamp)`
- `MemoryDeleted(memory_id, deletion_receipt_id, tombstone_hash, timestamp)`
- `ExportCreated(export_id, tenant_id, agent_id|mission_id, digest, timestamp)`
- `MemoryProvenanceQueried(memory_id, requester_id, lineage_hash, timestamp)`

State machine: memory moves `active` → `aging` (after TTL threshold) → `tombstoned` (after deletion). No direct transition to tombstone; aging requires explicit deletion. Idempotency: repeated `RequestDeletion` on the same memory_id and deletion_receipt_id returns the same receipt; re-requests with different reasons are separate deletions.

## Refusal matrix

| Code                                | Refusal                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `memory.agent_unauthorized`         | agent_id has no capability_scope for memory_read or memory_write                                         |
| `memory.tenant_mismatch`            | memory is not owned by requester's tenant; RLS rejected                                                  |
| `memory.classification_prohibited`  | write attempted with `authoritative` classification; only operational/derived permitted                  |
| `memory.authority_required`         | operand write to memory (edit, deletion claim) requires K2-sealed authoritative instruction              |
| `memory.envelope_tampering`         | K3 envelope HMAC fails verification; memory is corrupted or altered                                      |
| `memory.recall_untrusted_uncovered` | model-facing recall path omits K3 envelope wrapping; refusal to send unwrapped untrusted data            |
| `memory.retention_locked`           | deletion blocked by legal hold; auditable reason + expiry recorded                                       |
| `memory.embedding_unavailable`      | embedding service (sovereign pgvector/Ollama) is unavailable; write queued, recall fails closed          |
| `memory.migration_incomplete`       | memory contract version unsupported; restore requires explicit adapter                                   |
| `memory.export_dependency_missing`  | export references a memory that no longer exists (deleted); export denied or partial export issued       |
| `memory.cross_tenant_query`         | query returns no results; cross-tenant filtering is never visible to requester                           |
| `memory.query_injection`            | query string interpreted as embedding prompt injection; escaping enforced; SQLi/prompt-injection blocked |

Failure never loses immutable lineage or deletion records. On embedding unavailability, write is persisted with null embedding; recall falls back to keyword search. Deletion receipt is always issued, even if embedding index deletion is delayed.

## Data

**Memory entity (mutable during active lifetime; immutable after tombstone):**

```
memory {
  id: UUID,
  tenant_id: UUID (RLS partition),
  agent_id: string (from Biscuit K1),
  mission_id: string (from Biscuit K1),
  interaction_id: UUID? (source interaction, for lineage),
  text: string (natural language, potentially sensitive),
  tags: string[],
  classification: "operational" | "derived" | "historical",
  confidence: "high" | "medium" | "low",
  sensitivity: bool (triggers E2EE at rest),
  embedding: vector(768|1024) (tenant-scoped, self-hosted),
  embedding_timestamp: timestamp,
  ttl_days: int (default per ADR-0002 memory-type table),
  created_at: timestamp,
  expires_at: timestamp (computed: created_at + ttl_days),
  state: "active" | "aging" | "tombstoned",
  last_recalled_at: timestamp?,
  recall_count: int,
  provenance: {
    source_agent: string,
    source_mission: string,
    source_interaction_id: UUID?,
    source_timestamp: timestamp,
    summarized_from: memory_id[]? (if derived from episodic summary),
    exported_in: export_id[]? (audit trail)
  },
  k3_envelope: {
    trusted: false,
    hmac_signature: bytes,
    origin_agent: string,
    label: string (human-readable description),
    created_at: timestamp
  }
}
```

**Deletion receipt (immutable, permanent record):**

```
deletion_receipt {
  id: UUID,
  tenant_id: UUID (RLS partition),
  deleted_memory_id: UUID,
  requester_id: string,
  reason: "retention_expiry" | "user_request" | "compliance" | "manual",
  timestamp: timestamp,
  legal_hold?: {
    reason: string,
    expiry: timestamp
  },
  tombstone_hash: SHA256 (immutable proof of deletion),
  backup_expiry: timestamp (35 days per ADR-0002)
}
```

**Export snapshot (immutable, content-addressed):**

```
export {
  id: UUID,
  tenant_id: UUID,
  agent_id?: string,
  mission_id?: string,
  time_window?: { start: timestamp, end: timestamp },
  export_timestamp: timestamp,
  memory_count: int,
  memory_digests: { memory_id, hash }[],
  lineage_snapshot: [LineageEntry][],
  encrypted_payload: bytes (AES-256-GCM, tenant key),
  digest: SHA256 (immutable),
  created_at: timestamp,
  retention_expires_at: timestamp (same TTL as retained memories)
}
```

**Retention (per ADR-0002):**

- `operational` memories (tool outputs, current run facts): 90 days; configurable per tenant 7–365 days.
- `derived` memories (inferred patterns, summarizations): 90 days; configurable per tenant 7–365 days.
- `historical` memories (archived after compaction): 1 year; configurable per tenant 1–5 years.
- deletion receipts: permanent, immutable record; backup copies expire 35 days after deletion.

Encryption (K3 + sovereignty): memories marked `sensitivity=true` are encrypted at rest with a tenant-specific key (derived via tenant_id + key management service). Embedding vectors are never encrypted (they are derived, not sensitive source). Backups are encrypted with the same tenant key and destroyed at the backup TTL (35 days).

## Authentication and authorization

**K1 agent identity (Biscuit):**

- Every write/read/delete carries a Biscuit token binding `agent_id`, `mission_id`, and `capability_scope` (memory_read, memory_write, memory_delete, memory_export, memory_audit).
- Biscuit authorizer enforces `check if capability_scope(agent_id, "memory_write")` for WriteMemory; similar for other operations.
- Cross-mission access is denied by authorizer `check if mission_agent(agent_id, mission_id)`.

**RLS (row-level security):**

- PostgreSQL RLS policy: `(tenant_id = current_tenant_id)`.
- Every query is wrapped with `SET ROLE tenant_<tenant_id>` to enforce tenant isolation at the database layer.
- No cross-tenant queries are possible, even with admin tokens.

**K2 classification (immutable at write):**

- Only `operational` and `derived` classifications are permitted for WriteMemory; `historical` is assigned by the compaction process.
- Any attempt to write `classification="authoritative"` is rejected (refusal: `memory.classification_prohibited`).

**K3 envelope verification:**

- Every recalled memory seen by an LLM is wrapped via `wrapUntrusted()` before delivery.
- Caller (agent orchestrator) verifies envelope HMAC via `verifyEnvelope()` before using recalled memory.
- Envelope includes `trusted: false` so the model and downstream systems know this is untrusted operational data.

## Runtime boundaries

**TypeScript (Bun):**

- Memory domain logic: WriteMemory, QueryMemories, SummarizeMemories, RequestDeletion.
- RLS enforcement and SQL generation for tenant-scoped queries.
- K3 envelope wrapping/verification on every model-facing recall path.
- K2 classification validation (reject authoritative).
- Biscuit token inspection (K1).
- Provenance chain assembly (immutable lineage).

**Rust (Orchestrator boundary):**

- Embedding computation (pgvector/Ollama integration; candidate: Jina for dense embeddings if sovereignty permits).
- Memory compaction logic (summarization batching, episodic-to-semantic migration).
- Deletion receipt signing (HMAC-SHA256, with origin-agent key material).
- Export encryption/sealing (AES-256-GCM with tenant key from KMS).
- Candidate: canonical JSON serialization of memory for digest determinism (contract: MemoryRecord v1).

**PostgreSQL:**

- Memory table, deletion_receipt table, export table, provenance_lineage table.
- RLS policies enforce tenant isolation on every read/write.
- Triggerless async embedding queue (polled by Rust job).
- Vector index (pgvector HNSW or IVFFlat) for semantic search.
- No shared function/views across tenants.

**Embedding service (self-hosted):**

- Ollama, Jina, or pgvector's built-in embeddings (default: pgvector 0.8+ with llm model support).
- No external cloud service; all embeddings computed within tenant's infrastructure boundary.
- Tenant-scoped embeddings: no cross-tenant index or model sharing.
- Fallback to keyword (BM25) search if embedding unavailable (recall fails gracefully).

**Boundary invariants:**

- No plaintext memory leaks to logs; E2EE at rest for sensitivity=true.
- No Biscuit material in exports; only digests and deletion records.
- Embedding service does not have access to raw memory text for cross-tenant models (each tenant's embedding space is isolated).

## Accessibility and degraded mode

**Timeline of memory events:**

- List view: chronological memory events (written, recalled, deleted) with tags, confidence, state.
- Search UI: semantic + keyword filters, facet by agent/mission/tag/confidence.
- Provenance inspector: tree view of lineage (source interaction → summarizations → exports → deletions).

**Degraded mode (embedding service down):**

- Writes are accepted; embedding is computed async after service recovery.
- Queries fall back to BM25 keyword search (lower recall quality, no semantic ranking).
- Recall responses indicate `embedding_available: false` to caller; model can degrade gracefully.
- Export snapshots include both keyword indices and embedding vectors where available.

**Accessibility (for auditor UI):**

- No color-only state indicators (state: active/aging/tombstoned is always textual).
- Provenance tree is keyboard-navigable; Tab + arrow keys to explore lineage.
- Deletion reasons and legal holds are readable text (not icons).
- Filterable deletion receipt list with date ranges, requester, reason.

## Resource floor

Embedded specification; self-hosted embedding service (pgvector/Ollama) assumes:

- PostgreSQL instance with pgvector extension (0.8+); vector index size ≤ 10× indexed memory count (memory table in GB, vector index in GB).
- Memory text + metadata ≤ 512 bytes per memory (conservative for reasonable facts).
- Embedding dimension: 768 (OpenAI-compatible) or 1024 (Jina); pgvector allocates ~4 KB per vector.
- Embedding latency SLA: ≤ 500 ms per memory (async, non-blocking).
- Recall latency SLA: ≤ 100 ms for vector similarity (HNSW index) + ≤ 50 ms for keyword search (BM25 index).

Tenant class reference (ADR-0006 analogue, candidate): organization-tier memory instance supports ≤ 10k memories before compaction. Compaction reduces episodic memories by 80–90%, converting them to semantic summaries. No resource quota per memory type is enforced in v1; soft limits trigger alerts.

## Contracts

- **Memory Record v1** — `contracts/schemas/memory-record.v1.schema.json` (JSON Schema): memory entity, classification, envelope, provenance, encryption metadata.
- **Deletion Receipt v1** — `contracts/schemas/deletion-receipt.v1.schema.json`: immutable deletion proof (id, memory_id, reason, tombstone_hash, timestamp).
- **Export Snapshot v1** — `contracts/schemas/export-snapshot.v1.schema.json`: content-addressed export (digest, encrypted payload, lineage snapshot, retention metadata).
- **Provenance Lineage v1** — `contracts/schemas/provenance-lineage.v1.schema.json`: immutable chain of memory origins, summarizations, recalls, deletions.
- **K3 Envelope v1** — `contracts/schemas/envelope.v1.schema.json` (already locked in K3 spec; reused here for memory recall path).
- **K2 Classification v1** — `contracts/schemas/classification.v1.schema.json` (already locked in K2 spec; reused to validate operational/derived).
- **Memory APIs** — `contracts/openapi/memory.v1.yaml`: WriteMemory, QueryMemories, SummarizeMemories, RequestDeletion, ExportMemories, InspectProvenance, GetMemory, SearchMemories, etc.
- **Biscuit policies** — `contracts/authz/memory-v1.datalog`: `check if capability_scope(agent_id, "memory_read")`, `check if mission_agent(agent_id, mission_id)`, etc.; RLS tenant enforcement in SQL.

No service-to-service secrets (Biscuit tokens) are logged; operationally sensitive agent_ids and mission_ids are hashed in audit logs (not plaintext).

## Evidence

**Unit tests:**

- Query scoping: agent A cannot see agent B's memories (RLS enforced).
- Classification gate: write with `authoritative` is rejected; only `operational`/`derived` accepted.
- Envelope integrity: recalled memory's HMAC is verified; tampered envelope is rejected before model sees it.
- Provenance chain: summarization links to source episodic memory; export includes full lineage; deletion receipt references source memory_id.
- Retention: memory automatically aged to `aging` state at TTL threshold; explicit deletion moves to `tombstoned` with receipt.
- Embedding fallback: when embedding service is unavailable, keyword search returns results; when available again, vector search is re-enabled.

**Integration tests:**

- End-to-end journey: write memory → recall (with envelope wrapping) → summarize → inspect provenance → delete (with receipt).
- Cross-tenant isolation: tenant A writes memory in scenario X; tenant B queries with identical query returns zero results.
- Legal hold: deletion request is blocked; audit log shows reason and expiry; deletion succeeds after hold expires.
- Export round-trip: export snapshot, decrypt with tenant key, verify lineage hashes match originals.

**Security & authorization tests:**

- Biscuit failure: token missing capability_scope for memory_write; WriteMemory is rejected.
- Mission isolation: agent bound to mission M1 attempts to write memory into mission M2; Biscuit authorizer rejects.
- Envelope tampering: HMAC of recalled memory is corrupted; verifyEnvelope fails; model never sees the altered memory.
- RLS bypass attempt: direct SQL query bypassing application layer; PostgreSQL RLS policy blocks row access.

**Proof of concept (for Gate B candidate):**

- Fixture: synthetic agent memories in a test tenant; 100 episodic memories, 10 semantic summaries.
- Scenario 1: recall top 5 by vector similarity; verify envelope wrapping on each result; verify cross-tenant RLS rejects agent from tenant B.
- Scenario 2: summarize 10 episodic memories into 2 semantic ones; verify provenance chain links new summaries to source episodic IDs.
- Scenario 3: delete 5 memories (3 by retention expiry, 2 by manual request); verify deletion receipts are issued; verify deletion count + reasons in audit log.
- Scenario 4: export snapshot of test agent's memories; verify export is content-addressed (digest is deterministic); verify lineage in export matches live memory lineage.

Critical gaps (not closed by v1):

- **Vector embedding security**: candidate Jina/OpenAI API integration introduces cloud dependency (violates sovereignty). Mitigation: v1 uses pgvector + open-source Ollama; cloud embedding is deferred to v2 gated decision.
- **Embedding model updates**: changing the embedding model invalidates old vectors. Candidate solution: versioned embedding schema (`embedding_model_version` field); re-embedding migration required at v1→v2 transition. Not implemented in v1.
- **Temporal knowledge graph** (Zep-style): Zep's multi-strategy retrieval (semantic + BM25 + graph traversal + temporal) is a superset of this design. Scope: v1 implements semantic + keyword + recency (temporal decay on ranking). Graph-based retrieval (entity relationships, event causality) is deferred to v2 (requires richer schema, candidate: Weaviate or Graphiti).

## Work packages

1. **Contracts and encoding** (Canonical Core): MemoryRecord v1, DeletionReceipt v1, ExportSnapshot v1, ProvenanceLineage v1 schemas + golden vectors. JSON serialization (deterministic for digest).
2. **PostgreSQL persistence & RLS** (Experiences): memory table, deletion_receipt table, export table with RLS policies; pgvector index (HNSW); BM25 index (tsvector).
3. **Memory domain API** (Experiences + Bun): WriteMemory, QueryMemories, SummarizeMemories, RequestDeletion, ExportMemories, InspectProvenance endpoints; Biscuit authorization checks (K1); K2 classification validation; K3 envelope wrapping on every recall path.
4. **Embedding & canonicalization** (Specialized Rust): pgvector/Ollama integration; async embedding queue; tenant-scoped embedding service; export encryption (AES-256-GCM with KMS tenant key); deletion receipt signing; memory compaction (episodic-to-semantic migration).
5. **Auditor UI & compliance** (Web Platform + Experiences): provenance inspector (lineage tree view); deletion receipt log (filters: reason, requester, time window); export snapshots (list, decrypt, inspect lineage); legal hold interface.
6. **Authorization & RLS qualification** (Infrastructure + Release): adversarial tests (cross-tenant bypass, RLS failure, Biscuit forgery, envelope tampering); embedding availability degradation; legal hold enforcement; backup retention (35-day expiry proof).

Milestone gate (candidate): ExportMemories contract + first successful round-trip (write → recall → export → decrypt → verify lineage). Biscuit K1 enforcement in memory.v1.yaml + authorization proof (cross-tenant isolation, capability_scope validation).

## Release and rollback

**Release gates:**

- All six journeys (write, recall, summarize, inspect provenance, delete with receipt, export) must work end-to-end.
- Cross-tenant RLS enforced at storage layer (test: tenant A cannot query tenant B's memories).
- K3 envelope HMAC verified on every model-facing recall path (test: tampered envelope is rejected).
- K2 classification gate (test: authoritative write is rejected).
- Legal hold blocks deletion with auditable reason + expiry (test: deletion succeeds after hold expires).
- Embedding service failure gracefully degrades to keyword search (test: query works while embedding is unavailable).
- Deletion receipt issued for every deletion (immutable proof); backup copies expire within 35 days per ADR-0002.
- Provenance chain is immutable and tamper-evident (test: lineage export round-trips with matching hashes).

**Backward compatibility & migration:**

- v1 contracts (schemas) are locked; future versions (v2) require explicit contract promotion + migration path.
- If embedding model is updated (v1 → v2), re-embedding migration must complete before v2 is enabled (old vectors remain until replacement.
- RLS policy changes require explicit ALTER POLICY; no silent narrowing of access.

**Rollback:**

- Rollback first prevents new writes to memory (close WriteMemory endpoint).
- All active agents gracefully degrade to keyword-only search (no vector queries).
- Deletion operations remain available (cleanup does not require rollback reversal).
- Provenance records and deletion receipts are never rewritten or deleted during rollback.
- Data migration backwards: export snapshot (v2) must deserialize under v1 contract; no one-way upgrades without adapters.

**Evidence of qualifying release:**

- 10k+ memories written across 5 test tenants; cross-tenant queries return zero false positives.
- 1000+ memory recalls, each with K3 envelope verified.
- 100+ deletions (mix of retention expiry, user request, compliance); receipts issued + audit trail verified.
- 10× export snapshots (variable time windows); digests are deterministic; lineage verifiable.
- Embedding service failure simulation: 1 hour downtime; queries fall back to keyword search with <10% recall loss.
- Security review: zero information disclosure, zero RLS bypass, envelope tampering detected.

---

# Benchmark & Feature Parity Table

| Feature                                | Letta (MemGPT)                                                               | Mem0                                            | Zep                                                | Libre-AI Memory                                                                                      | Status          | Trade-off / Arbitrage                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| **Core Memory Types**                  |                                                                              |                                                 |                                                    |                                                                                                      |                 |                                                                                                   |
| Working memory (in-context)            | ✓ (core tier)                                                                | ✗ (implicit in chat history)                    | ✗                                                  | ✗ (agents manage via mission context)                                                                | T2              | Deferred to orchestrator; memory is durable storage, not working set                              |
| Episodic (interaction-specific)        | ✓ (recall tier)                                                              | ✓ (session-scoped facts)                        | ✓                                                  | ✓ (operational memories, tagged by interaction_id)                                                   | ✓               | Matching                                                                                          |
| Semantic (learned facts/patterns)      | ✓ (archival tier, searchable)                                                | ✓ (extracted & deduplicated)                    | ✓                                                  | ✓ (derived memories via summarization)                                                               | ✓               | Matching                                                                                          |
| Procedural (behaviors, rules)          | ✗ (implicit in agent tools)                                                  | ✗                                               | ✓ (graph-encoded behaviors)                        | ✗ (T2 candidate: procedures as tagged memory with source control link)                               | T1              | Out of scope v1; RGPD procedural memory in compliance boundary                                    |
| **Recall & Retrieval**                 |                                                                              |                                                 |                                                    |                                                                                                      |                 |                                                                                                   |
| Vector semantic search                 | ✓ (pgvector+Letta models)                                                    | ✓ (Pinecone/ChromaDB/cloud)                     | ✓ (graph embedding)                                | ✓ (pgvector + self-hosted Ollama/Jina)                                                               | ✓               | **Sovereignty enforced**: no cloud vector store; pgvector only                                    |
| Keyword (BM25/TF-IDF)                  | ✗                                                                            | ✓                                               | ✓ (BM25 fallback)                                  | ✓ (fallback when embedding unavailable)                                                              | ✓               | Matching                                                                                          |
| Temporal/recency ranking               | ✗ (implicit staleness)                                                       | ✓ (time-decay in extraction)                    | ✓ (bitemporal: event time + ingestion time)        | ✓ (recall_count + time-decay in ranking)                                                             | ✓               | Matching                                                                                          |
| Graph traversal (entity relationships) | ✗                                                                            | ✗                                               | ✓ (Graphiti temporal KG)                           | ✗ (T2: lineage chain is immutable, not traversable as live graph)                                    | T1              | Knowledge graph deferred; lineage is audit-trail, not query index                                 |
| **Memory Management**                  |                                                                              |                                                 |                                                    |                                                                                                      |                 |                                                                                                   |
| Agent-driven write/recall API          | ✓ (explicit calls)                                                           | ✗ (auto-extraction from LLM)                    | ✗ (manual + auto-summary)                          | ✓ (explicit WriteMemory + QueryMemories)                                                             | ✓               | Matching                                                                                          |
| Auto-summarization                     | ✗ (manual)                                                                   | ✓ (fact extraction from every turn)             | ✓ (background compaction)                          | ✓ (periodic compaction: episodic → semantic)                                                         | ✓               | **Governance enforced**: summarization is Rust-owned, auditable                                   |
| Deduplication                          | ✗                                                                            | ✓ (adaptive, fact-level)                        | ✓ (entity dedup)                                   | ✓ (via semantic similarity threshold during compaction)                                              | ✓               | Matching                                                                                          |
| **Retention & Deletion**               |                                                                              |                                                 |                                                    |                                                                                                      |                 |                                                                                                   |
| TTL per memory type                    | ✗                                                                            | ✓ (policies configurable)                       | ✓                                                  | ✓ (per ADR-0002: 90 days episodic/derived, 1y semantic)                                              | ✓               | **ADR-0002 aligned**: retention table mandatory                                                   |
| RGPD deletion                          | ✗                                                                            | ✓ (immediate + receipts)                        | ✓                                                  | ✓ (RequestDeletion with signed receipt + tombstone)                                                  | ✓               | **Receipt immutable**: proof of compliance                                                        |
| Legal hold / deletion block            | ✗                                                                            | ✗                                               | ✗                                                  | ✓ (on RequestDeletion with reason + expiry)                                                          | ✓               | **Compliance-centric**: audit trail required                                                      |
| Backup expiry                          | ✗ (Letta is not backup-focused)                                              | ✗                                               | ✗                                                  | ✓ (35-day expiry per ADR-0002)                                                                       | ✓               | Unique to Libre-AI governance                                                                     |
| **Sovereignty & Security**             |                                                                              |                                                 |                                                    |                                                                                                      |                 |                                                                                                   |
| Cloud dependency                       | ✓ (PostgreSQL on customer infra OR cloud Postgres)                           | ✗ (cloud vector stores: Pinecone/etc. required) | ✗ (Zep Cloud SaaS OR self-hosted)                  | ✓ (self-hosted pgvector + Ollama; no cloud vector store)                                             | ✓               | **K1/K2/K3 enforced**: cloud vector store forbidden                                               |
| Tenant isolation (RLS)                 | ✗ (agent-scoped, not org tenant)                                             | ✓ (user/session/agent scoped)                   | ✓ (multi-tenant capable)                           | ✓ (PostgreSQL RLS + Biscuit K1)                                                                      | ✓               | Matching                                                                                          |
| E2EE at rest                           | ✗ (Letta does not encrypt memory)                                            | ✗ (client-side optional)                        | ✗                                                  | ✓ (sensitivity=true triggers AES-256-GCM tenant key)                                                 | ✓               | **K3 envelope + cipher**: untrusted recalled data wrapped                                         |
| Recall-as-untrusted (K3 envelope)      | ✗                                                                            | ✗                                               | ✗                                                  | ✓ (K3 HMAC-signed envelope on every model-facing recall)                                             | ✓               | **Unique**: doctrine constraint (operational never authoritative)                                 |
| Classification (K2)                    | ✗                                                                            | ✗                                               | ✗                                                  | ✓ (operational/derived/historical; no authoritative writes)                                          | ✓               | **Doctrine**: recalled memory can never justify writes to gates/contracts                         |
| **Identity & Authorization**           |                                                                              |                                                 |                                                    |                                                                                                      |                 |                                                                                                   |
| Biscuit-based capability scoping       | ✗                                                                            | ✗                                               | ✗                                                  | ✓ (K1: agent_fleet, mission_agent, capability_scope facts)                                           | ✓               | **Foundation**: Polaris orchestrator prerequisite                                                 |
| Per-agent revocation                   | ✗                                                                            | ✗                                               | ✗                                                  | ✓ (per K1; fail-closed)                                                                              | ✓               | **Doctrine**: revocation cache unavailable → deny                                                 |
| Cross-mission isolation                | ✗                                                                            | ✗                                               | ✗                                                  | ✓ (Biscuit authorizer: mission_agent(agent_id, mission_id))                                          | ✓               | Matching                                                                                          |
| **Provenance & Audit**                 |                                                                              |                                                 |                                                    |                                                                                                      |                 |                                                                                                   |
| Immutable lineage chain                | ✗ (Letta does not track memory provenance)                                   | ✗                                               | ✗                                                  | ✓ (source interaction → summarizations → recalls → exports → deletions)                              | ✓               | **Central to compliance**                                                                         |
| Memory export (content-addressed)      | ✓ (archival export via API)                                                  | ✓ (export via API)                              | ✓ (time-based export)                              | ✓ (digest-locked export + encrypted payload)                                                         | ✓               | Matching                                                                                          |
| Deletion audit trail                   | ✗                                                                            | ✓ (partial)                                     | ✓ (audit log)                                      | ✓ (signed deletion_receipt; permanent record)                                                        | ✓               | **Receipt is immutable proof**                                                                    |
| **Gaps vs. Benchmarks**                |                                                                              |                                                 |                                                    |                                                                                                      |                 |                                                                                                   |
| (Letta) Three-tier memory hierarchy    | Letta has explicit core/recall/archival tiers                                | N/A                                             | N/A                                                | Implicit (mission context ≈ working, operational ≈ recall, historical ≈ archival); no three-tier API | Arbitrage       | Out of scope; tiers are agent's responsibility, not memory service                                |
| (Mem0) Cloud vector stores             | Mem0 supports 10+ managed solutions (Pinecone, AzureAI, etc.)                | Central                                         | N/A                                                | **Forbidden** (sovereignty); pgvector only                                                           | Design decision | **K1 doctrine**: no third-party vector index                                                      |
| (Zep) Graph-based retrieval            | ✗                                                                            | ✗                                               | Zep's Graphiti is the canonical temporal KG engine | Not included (T1 candidate)                                                                          | T2 arbitrage    | Entity-relationship graph deferred; lineage is append-only audit log, not traversable query index |
| (All) Working memory in process        | Letta: core tier is in-context; Mem0: implicit; Zep: working graph in memory | Multi-tier                                      | Multi-tier                                         | Deferred to orchestrator (agents manage via chat history + mission context snapshot)                 | T1              | Memory service owns durable recall; working set is orchestrator concern                           |

**Benchmark note:**

- **T1 (in v1):** Feature included as originally specified.
- **T2 (candidate, post-v1):** Feature deferred; no blocking design decision required to open v1 gate, but arbitrage is explicit (e.g., knowledge graph, procedural memory).
- **Arbitrage:** Design trade-off recorded. Example: "no cloud vector store" (Libre-AI) vs. "Mem0's 10+ managed providers" (Mem0) — Libre-AI chooses sovereignty (K1 doctrine) over convenience.

Registry note: Benchmark frameworks = Letta/MemGPT (Felicis-backed OS), Mem0 (AWS exclusive, 41k ★), Zep (Zep Cloud + Graphiti OS).

---

**DRAFT — Specification Lock pending.** This specification is a locked contract (immutable after pronouncement) under the orchestrator Specification Lock (ADR-0011). Changes to memory schema, classification rules (K2), or envelope integrity (K3) require a new ADR, independent security review, and owner approval. Governance path: Gate → ADR → Specification Lock → Release.

---

## Summary for owner review

**Journeys (6):**

1. Write a memory (agent records operational knowledge)
2. Recall under scope (semantic + keyword search; K3 envelope wrapping)
3. Summarize/compact (episodic → semantic migration; lineage preserved)
4. Inspect provenance (complete immutable chain to source interaction)
5. Forget/delete with receipt (RGPD + retention governance; signed tombstone)
6. Export snapshot (content-addressed, encrypted, immutable)

**Three sharpest sovereignty/classification invariants:**

1. **K2-enforced**: Recalled memory is never `authoritative` — writes to gates/permissions/contracts cannot depend on operational memory alone; only sealed K2-authoritative payloads grant that privilege.
2. **K3-wrapped**: Every recalled memory delivered to a model is HMAC-signed envelope (`trusted: false`) — untrusted operational data cannot be deserialized blindly; wrapper is verified before use.
3. **K1-sovereign**: No cloud vector store (Pinecone/Weaviate Cloud forbidden); all embeddings computed by tenant-scoped pgvector or self-hosted Ollama; embedding indices never cross tenant boundaries; PII-containing memories encrypted at rest with tenant-specific key.

**File path:** `docs/parity/draft-specs/DRAFT-SPEC-memory.md`
