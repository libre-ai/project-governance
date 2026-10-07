# Data lifecycle lock

- **Status:** accepted G1 baseline
- **Decision authority:** ADR-0002 section 3
- **Machine policy:** `contracts/data/retention.v1.json`
- **Deletion evidence:** `contracts/schemas/deletion-receipt.v1.schema.json`

## Invariants

1. Each record has exactly one application owner and one authority store.
2. Every server-owned private row has a mandatory opaque `tenant_id`; `public` is not a private tenant.
3. Product APIs, SQL roles and background jobs cannot query across tenants.
4. Cross-product sharing uses versioned contracts and content digests, never direct tables or shared writable schemas.
5. Redis, browser caches, search indexes and projections are disposable and never authoritative.
6. Local-only content never enters server logs, telemetry, backups or support exports.
7. Retention is an executable maximum, not a promise to keep data until that date.

## Store classes

| Store class | Authority | Encryption and isolation | Failure rule |
| --- | --- | --- | --- |
| Git public corpus | reviewed source and contract history | public, signed/reviewed commits | unreviewed content cannot publish |
| IndexedDB local | Practices progress, Notebook, Boussole responses/results | origin isolation; Notebook content/backup encrypted | no network fallback or silent reset |
| PostgreSQL application schema | tenant product records and server sessions | TLS, encrypted volume, one SQL role/schema per owner, RLS | missing tenant context fails transaction |
| Redis | leases, presence, bounded cache and revocation cache | private network, TTL mandatory, no content authority | fall back to authority or fail closed |
| Cellar | explicit artifact/export/evidence blobs | EU bucket, server-side encryption, digest and owner metadata | no anonymous/private bucket listing |
| operational logs | request/resource/rule IDs, timings and outcomes | EU retention, access-controlled | user/session IDs, content, credentials, tokens and PII forbidden |
| encrypted backups | disaster recovery snapshots only | separate keys and access; expiry under 35 days | never selectively restore deleted data |

## Ownership matrix

| Owner | Records | Authority | Tenant/data class | Lifecycle |
| --- | --- | --- | --- | --- |
| Website | reviewed public projections and corrections | Git + release artifact | public | while selected/released |
| Practices | activity/review versions; learner progress | Git/server review refs; IndexedDB progress | public/org refs; local personal | review evidence with release; progress until local delete |
| Radar | subscriptions, rule versions, normalized items, decisions, exports | PostgreSQL; expiring Cellar export | personal tenant | raw body immediate; quarantine 7 d; normalized 90 d configurable 7–365 |
| Notebook | blocks, links, local index, backups/exports | IndexedDB and user-held files | local personal | until local delete; no server copy v1 |
| Sessions | organizations, memberships, sessions, contributions, events, outcomes | PostgreSQL | organization tenant | presence 24 h; content/outcomes 90 d configurable 7–365 |
| Model Policy | policies, sourced snapshots, needs, evaluations | PostgreSQL + artifact refs | organization tenant | referenced snapshots immutable, then 5 y |
| Boussole | public datasets/methods; responses/results | Git/release; IndexedDB | public; local sensitive | public while released; local until delete |
| Specifications | drafts, decisions, reviews, accepted packages, handoffs | PostgreSQL + artifact refs | organization tenant | accepted packages immutable while referenced, then 5 y |
| Missions | mission aggregates, approvals, events, decisions, verdicts | PostgreSQL + Proof/Artifact refs | organization tenant | 1 y configurable up to 6 y |
| auth-web | browser sessions and revocations | PostgreSQL; Redis cache only | mandatory tenant | expiry + 24 h; absolute session maximum 12 h |
| Proof / Artifact | evidence and content-addressed manifests | PostgreSQL metadata + Cellar bytes | owning tenant/public release | while referenced release/decision is retained |

## Tenant and database boundary

Each owner receives a PostgreSQL schema, migration stream and least-privilege runtime role. Every tenant table includes non-null `tenant_id`; primary/unique/foreign keys include or verify tenant ownership. RLS uses transaction-local tenant context set only after browser session or Biscuit authorization. Connection pools clear context before reuse. Owners cannot grant another app direct table access.

Personal server workspaces use `ten_*` opaque IDs exactly like organization workspaces. Local-only Notebook/Boussole data has no synthetic server tenant. Publication services use the distinct service tenant `public`; product-private schemas reject it.

## Retention execution

A daily owner-scoped job selects expired opaque IDs under the machine policy, deletes dependent active records inside bounded transactions, emits aggregate counts and an Evidence Report, then expires associated blobs. Jobs use an attenuated token limited to one tenant, owner and `delete-expired` operation. They never log deleted content.

Tenant-configurable retention is validated between accepted minimum/maximum values. A shorter value applies prospectively and schedules already-expired records immediately. Increasing retention requires an attributable tenant-owner command; values beyond the accepted maximum are refused.

## Explicit deletion

1. Authorize actor, tenant, scope and current revision.
2. Return refusal before mutation if legal hold or unavailable authority prevents a complete active-store deletion.
3. In one command, make records inaccessible, delete active rows/keys and enqueue only content-addressed blob deletion.
4. Remove Redis/search/cache projections; cache failure cannot restore access and is retried.
5. Emit a `DeletionReceipt` containing opaque digests, stores, timestamps, rule IDs and backup-expiry ceiling—never deleted content.
6. Physical compaction may follow, but logical access and encryption keys are removed in the accepted transaction.
7. Encrypted backups expire within 35 days and are not selectively restored. Restore procedures replay deletion receipts before reopening service.

Local applications perform equivalent local deletion and key destruction without sending a receipt to a server. UI must disclose browser/platform limits on secure physical erasure.

## Legal hold

A documented France/EU obligation may block only the affected scope. The receipt records a non-PII reason code, authority reference and expiry. A hold cannot silently extend unrelated records, analytics, logs or backups. Expired holds re-enter deletion automatically.

## Export and portability

Exports are explicit, tenant-scoped, schema-versioned and content-addressed. Cellar download capability is one-use and short-lived. Exports exclude secrets, Biscuit/session material, internal logs and another audience's private content. Creating an export does not extend source retention; the export has its own bounded expiry or becomes a user-held local file.

## Migration, backup and rollback

Schema migration uses expand → migrate → verify → contract. Destructive contraction waits until all readers and rollback artifacts no longer need the old field. Backups are restored only into isolated verification first. Before service reopening, accepted deletion receipts and retention jobs are replayed. Rollback cannot resurrect deleted data, lengthen retention or cross an irreversible migration without an explicit recovery decision.

## Required evidence

- RLS tests with two tenants and missing tenant context ;
- deletion tests covering active rows, blobs, cache/search and restore replay ;
- clock-controlled retention boundary tests and tenant min/max refusal ;
- local no-network/delete/export tests for Practices, Notebook and Boussole ;
- log inspection proving zero content, credential, token or political-position leakage ;
- backup expiry and restore drill under 35 days.
