# Orchestrator Run-Control Persistence — Phase 4B Design

- **Status:** approved for implementation — owner, 2026-09-11; authority ADR-0040/D45
- **Date:** 2026-09-11
- **Dependency amendment:** owner choice C, 2026-09-11 — direct unmodified
  `sqlx-core`/`sqlx-postgres` 0.9.0 profile, still pending Governance merge
- **Programme authority:** ADR-0011, ADR-0018, ADR-0034, ADR-0036 and
  ADR-0037
- **Scope:** the first bounded persistence slice of `WP-G3-O01`, implemented
  as an isolated Rust crate inside `libre-ai/orchestrator`
- **Explicit exclusion:** service exposure, Biscuit authorization, Missions or
  Harness integration, worker invocation, real effects, runtime diagnostics,
  deployment and any LangGraph, LangChain or LangSmith dependency

## 1. Decision being specified

The owner selected option A on 2026-09-11: add an isolated Rust persistence
crate at `crates/agent-orchestrator-run/` in the existing Orchestrator
repository. The accepted pure decision crate remains effect-free and is
consumed as a dependency. PostgreSQL serializes accepted state applications,
enforces organization isolation and preserves the canonical event evidence;
it does not decide graph, authorization, retry, transfer, budget or effect
semantics.

The alternative of opening the complete runtime service was rejected because
it would combine storage, authorization, network exposure, effects and
operational diagnostics before the storage barrier has an independent proof.
A TypeScript adapter was rejected because ADR-0018 selected Rust for this
boundary and because sharing the TypeScript data implementation would create
coupling without strengthening the database barrier.

The earlier working label `ADR-0038/D44` is no longer available: Governance
assigns ADR-0038 to private-first repository publication and D44 to that
decision. Current `main` also assigns ADR-0039 to private product research.
This design therefore reserves the next free ADR identifier with the existing
free decision identifier, `ADR-0040/D45`, subject to the normal mechanical
registry checks. This correction is bookkeeping, not a new architecture
choice.

The dependency-profile diagnostic then corrected one premise without changing
that architecture. SQLx 0.9.0's facade dependency unconditionally selects
`sqlx-core/migrate` even with facade default features disabled; `migrate`
selects `sqlx_core::testing`, which has two direct `eprintln!` sites. This
source fact does not prove an observed API leak, but it contradicts the
original selected-source refusal. The owner therefore selected option C on
2026-09-11: use the unmodified registry components directly and retain the
same strict no-emission boundary. This amendment remains candidate Governance
authority until merge, exactly like the initial declaration.

The isolated diagnostic proved compile availability and known module exclusion
only; it is not an end-to-end or complete dependency-source proof. Its
compile-only success did not open PostgreSQL, exercise errors or collectors,
or close any production blocker. The authoritative upstream inputs are pinned
to SQLx v0.9.0:
[facade manifest](https://docs.rs/crate/sqlx/0.9.0/source/Cargo.toml),
[core module selection](https://docs.rs/crate/sqlx-core/0.9.0/source/src/lib.rs)
and [testing module](https://docs.rs/crate/sqlx-core/0.9.0/source/src/testing/mod.rs).

This document authorizes no implementation by itself. Governance must first
merge ADR-0040/D45 to bind this bounded slice of the existing locked
`WP-G3-O01`. It creates no overlapping work package and must not mark the
complete runtime package proven; authorization consumption, execution and
service capabilities remain closed inside that package.

This slice depends on the accepted `WP-G3-O02` pure core. It is the only
`WP-G3-O01` slice allowed to begin while `WP-G3-H01` is not proven on the
current Harness `main`, because it imports no Harness API, exposes no service
and cannot invoke a worker or effect. `WP-G3-H01` remains a prerequisite for
every later `WP-G3-O01` slice and for declaring `WP-G3-O01` complete. This is
a narrow dependency split, not a statement that Harness confinement exists.

## 2. Payoff and proof boundary

Phase 4A proved deterministic decisions in memory. Phase 4B turns those
decisions into durable evidence while preserving the distinction between
authority and mechanism:

- the pure core remains the only native interpreter of locked Contracts
  semantics;
- canonical event bytes remain independently replayable rather than being
  replaced by mutable relational projections;
- PostgreSQL provides atomicity, concurrency serialization and row-level
  organization isolation;
- retention, explicit deletion and restore ordering become testable against a
  real database;
- a later service, worker or LangGraph adapter can be added or removed without
  changing the stored authority.

The result still cannot execute a mission or an external effect. It proves one
smaller claim: given validated authority and explicit observations, durable
run-control state cannot be partially appended, crossed between organizations,
silently rewritten or resurrected after accepted deletion.

## 3. Authority and repository boundaries

### 3.1 Governance

`libre-ai/governance` owns the opening act, the bounded work package, this
design and the implementation plan. ADR-0011 D4 remains applicable: the first
security-critical persistence barrier requires an independent adversarial
review dossier and a hard stop for owner pronouncement before merge.

### 3.2 Contracts and SDK Rust

`libre-ai/contracts` remains the only authority for event schemas, digest
preimages, closed outcomes, retention classes and restore order. The runtime
crate consumes the same pinned Contracts/SDK Rust lineage as the pure core. It
does not edit, fork or translate a wire contract.

The authoritative retention facts are:

- an orchestrator execution record defaults to `P1Y`, may be configured up to
  `P6Y`, and equals the owning mission retention;
- a content-free execution-deletion tombstone is retained for at least `P35D`
  and until independent snapshot-retirement evidence permits its removal;
- restore applies deletion tombstones and snapshot-retirement evidence before
  execution records.

`MissionRetentionFact` is a bounded native input carrying the mission id,
retention years and a UTC observation instant exactly representable at
PostgreSQL microsecond precision. A future caller must authenticate the Missions
fact before constructing it; this slice does not authenticate Missions or
define a wire contract. The store derives a versioned digest from those three
fields only to identify and replay the local observation. That digest is not
policy authority.

### 3.3 Orchestrator

`libre-ai/orchestrator` owns both crates but keeps their capabilities separate:

```text
Contracts / SDK Rust
        |
        v
+----------------------------+       proposed applications
| pure orchestrator core     | ------------------------------+
| validation + decisions     |                               |
| no I/O capability          |                               v
+----------------------------+        +--------------------------------+
                                      | agent-orchestrator-run         |
                                      | transactions + RLS + lifecycle |
                                      +----------------+---------------+
                                                       |
                                                       v
                                           local PostgreSQL proof
```

The root package remains a normal package and a workspace root. The workspace
adds `crates/agent-orchestrator-run` as a member. Existing capability gates keep
scanning the pure root `src/`; an additional gate explicitly limits the new
crate to its authorized database capability.

For the Orchestrator satellite, the machine work-package map prospectively
transfers six exact shared support paths needed by this slice from completed
`WP-G3-O02` to `WP-G3-O01`: `Cargo.toml`, `Cargo.lock`, `package.json`,
`README.md`, `docs/apps/orchestrator.md` and `project.v1.yaml`. It assigns the
exact `.github/workflows/ci.yml` path to O01 for the first time under the
ADR-0020 satellite rule; this is not rewritten as a historical O02 transfer.
`WP-G3-O01` additionally owns only its named review, coverage-gate and
verification paths. Historical `WP-G3-O02` commits remain
unchanged; `bun.lock`, root `src/**`, pure-core tests, compatibility evidence
and its authority gate remain owned by `WP-G3-O02`. Before each implementation
commit, a structural gate compares every changed path with the exact current
`WP-G3-O01.writePaths` list and refuses any unlisted or overlapping edit.

`WP-G2-T01`, `WP-G2-Q01` and `WP-G2-A01` retain broad hub-era path records in
the original plan. Under ADR-0020's repository-satellite migration, those
hub-era paths are not concurrent satellite write authority: for current
Orchestrator work the exact prospective O01/O02 lists above are authoritative,
and no branch under those completed packages may modify the transferred paths
concurrently. This precedence rule preserves historical package evidence while
removing active co-ownership; changing it requires a new Governance decision.

Phase 4B does not change the root crate's API or introduce a native checkpoint.
The Phase 4A decision deliberately left persisted state projections closed
until separately authorized. The persistence proof therefore calls the
existing whole-chain replay API over canonical events; it does not duplicate
the private state reducer inside the runtime crate. In particular, persistence
does not persist replay phase, generation-derived state or private budget
counters, and it does not add accessors to expose them.

No new repository is created. The canonical lexicon and the locked work
package already place `crates/agent-orchestrator-run/**` in the Orchestrator
repository, and a repository split would not create an additional runtime
security boundary.

### 3.4 Data-layer pattern

The Rust crate reuses the proven structural PostgreSQL barrier from
`@libre-ai/data`: every application transaction sets the restricted
`libre_ai_app` role and the local `app.tenant_id` setting. Before reuse, pooled
connections clear SQLx's client-side prepared-statement cache and then execute
unprepared `DISCARD ALL`; either failure destroys the connection. It does not
depend on the TypeScript package or copy its domain policy.

Domain and public Rust names use `OrganizationId`. Database columns retain
`tenant_id` and the `app.tenant_id` setting so the shared RLS barrier remains
consistent across services. The mapping is explicit and local to persistence;
it does not reintroduce “tenant” into product or API language.

## 4. Capability envelope

The new crate may:

- consume caller-built SQLx `PgConnectOptions` with an explicit Unix-domain
  socket and bounded pool limits;
- construct and own one private PostgreSQL pool per authority role, with the
  mandatory connection-scrubbing hook;
- open transactions through those private pools;
- encode already validated event documents as RFC 8785 JCS bytes;
- calculate and compare SHA-256 digests;
- return typed, bounded pages and constant public error codes.

It may not:

- load or inspect environment variables, secrets, ordinary files or process
  state;
- create its own connection configuration or discover a database endpoint;
- open TCP or negotiate TLS;
- expose its pool or a raw SQLx transaction;
- call an HTTP, RPC, worker, Missions, Harness or effect endpoint;
- read the host wall clock; the closed PostgreSQL deletion guard is the sole
  clock owner for its post-lock effective deletion instant;
- emit logs, traces, metrics labels or raw database errors;
- authorize a run, actor, deletion or retention policy;
- accept a preclassified semantic verdict from an adapter.

The caller injects connection options, explicit lifecycle/expiry observation
times and already established authority facts, but never the effective
deletion instant. It resolves the local endpoint outside this crate and must
not place a real secret in the proof-only options. Before SQLx
I/O, the crate requires `PgConnectOptions::get_socket()` to be `Some`, refuses
caller startup `options`, then replaces password, application name and all
file/inline certificate and key fields with fixed non-secret values. It forces
`PgSslMode::Disable`, applies `disable_statement_logging()` as defense in depth
and never invokes `to_url_lossy` or any other option formatter. Thus hostile
synthetic secret fields are neither inspected nor transmitted by the store;
real secret ingestion remains unauthorized.

Pool construction is inside the crate because accepting an opaque prebuilt
pool would make the mandatory `DISCARD ALL` return hook unverifiable. The crate
still recomputes every comparison it owns. Future remote endpoint/TLS and
secret loading, zeroizing ownership and request authorization require separate
packages.

Migration SQL belongs to the crate, but the library does not read or execute
migration files at runtime. CI and future deployment tooling apply the exact
versioned files under an explicitly authorized migration identity. This keeps
filesystem and schema-owner capabilities out of the application process.

## 5. Dependencies and portability

The persistence crate uses Rust and directly pins the unmodified registry
components `sqlx-core` and `sqlx-postgres` exactly at `0.9.0`, with default
features disabled. Core enables only `_rt-tokio`, `json` and `chrono`;
Postgres enables only `json` and `chrono`. The `sqlx` facade is absent. Every
selected final consumer graph forbids `migrate`, `offline`, `any`, macros,
other drivers, TLS, `ipnet` and every extra component feature. Direct
dependencies already used for canonicalization, digests and time values are
pinned consistently with the pure crate.
Every TLS implementation and certificate-discovery feature remains absent.

```toml
sqlx-core = { version = "=0.9.0", default-features = false, features = ["_rt-tokio", "json", "chrono"] }
sqlx-postgres = { version = "=0.9.0", default-features = false, features = ["json", "chrono"] }
```

The implementation imports component APIs rather than facade re-exports:

```rust
use sqlx_core::connection::ConnectOptions;
use sqlx_core::connection::Connection;
use sqlx_core::query_scalar::query_scalar;
use sqlx_core::raw_sql::raw_sql;
use sqlx_postgres::{PgConnectOptions, PgConnection, PgPool, PgPoolOptions, PgSslMode, Postgres};
```

`sqlx-core` explicitly describes its API as semver-exempt, and `_rt-tokio` is
a private implementation feature. This proof accepts both only because the
two component versions and their effective features are exact; it requires
complete requalification on every component update. This is a quality and
maintenance cost, not a performance or production-readiness claim.

Exact normal dependencies on `log` 0.4.33 and `tracing` 0.1.44 enable
`max_level_off` and `release_max_level_off`; normal-build const assertions
require `log::STATIC_MAX_LEVEL == Off` and
`tracing::level_filters::STATIC_MAX_LEVEL == OFF`. Cargo feature unification
therefore compiles logging-facade macro callsites out of the exact active graph in
debug and release, including a test graph that additionally enables
`tracing/log-always`. `disable_statement_logging()` remains a second barrier,
not the primary claim.

This mechanism has a deliberate global downstream effect on the unified
package instances: every same-graph consumer of those `log` and `tracing`
instances loses its diagnostics. A duplicate package version or any other
graph change invalidates the proof. That cost is acceptable only for this
non-production proof. No production consumer may remove the static-off
features until a separately proven upstream option or driver preserves safe
downstream diagnostics while suppressing SQLx query, notice, pool and error
emissions. The no-emission claim applies only to the exact feature graph.

Graph qualification distinguishes resolution inventory from selected build
inputs: the Cargo metadata package superset is not the selected build graph,
and lockfile-only packages are not selected-graph failures. The gate derives
the effective component versions, features and source files separately for
debug, release and dev `tracing/log-always`. It fails closed if a separate
same-graph consumer reintroduces the facade or activates core/postgres
`migrate`, if component versions duplicate, or if TLS or any extra feature is
selected. `sqlx-postgres` may make `sqlx-core/default` appear in that effective
closure; it is empty in 0.9.0 and is accepted only with that concrete meaning.
The gate compares complete effective feature closures, not isolated feature
names. Source audit may exclude truly unselected `cfg` branches, but not a
directory merely named `testing` and not a call path asserted unreachable.

`sqlx-core` and `sqlx-postgres` 0.9.0 are MIT OR Apache-2.0 and support the
repository's Rust toolchain.
PostgreSQL is the only storage engine in scope. Tests use an ordinary
PostgreSQL 14-or-newer server through the mode-0700 private Unix-domain socket
and never require a Docker Hub image. Clever Cloud PostgreSQL in Paris/EU is a
future production candidate, not a proven target. This local-only package
cannot reach it: remote WebPKI `verify-full`, secret ownership and transport
verification must be authorized and proved separately.

The schema uses PostgreSQL's `pgcrypto` extension only for the database-side
SHA-256 deletion-subject check. The migration preflight must prove the
extension is present before changing schema; it may not attempt an unreviewed
fallback. Clever Cloud documents PostgreSQL extensions and its restricted user
administration model here:
<https://www.clever.cloud/developers/doc/deploy/databases/postgresql/>.

Role-provisioning compatibility is a separate production blocker. Before any
production adapter or deployment, an immutable provider attestation executed
on the selected target must prove the four global `NOLOGIN NOSUPERUSER
NOBYPASSRLS` roles, three separate login identities, exact memberships and
grants, RLS/guard-function privileges, and required `pgcrypto` extension in the
target catalog after provider-authorized provisioning. A local superuser
bootstrap or an unrecorded support assurance is not target evidence. If Clever
Cloud cannot produce that proof, a compatible EU PostgreSQL provider must be
selected and authorized separately; changing provider does not weaken the role
model.

The non-secret attestation report must query the explicit role matrix below:
`pg_roles.rolcanlogin`, `pg_roles.rolsuper`, `pg_roles.rolinherit`,
`pg_roles.rolcreaterole`, `pg_roles.rolcreatedb`,
`pg_roles.rolreplication`, `pg_roles.rolbypassrls`,
`pg_roles.rolconnlimit`, `pg_roles.rolvaliduntil` and `pg_roles.rolconfig`. It
reads `pg_auth_members` for exact inbound and outbound memberships. On
PostgreSQL 14/15, `admin_option` must be false and the member identity's
`NOINHERIT` attribute carries the inheritance barrier. On PostgreSQL 16 or
newer, `admin_option = false`, `inherit_option = false` and `set_option = true`
are all mandatory. Ownership and raw ACLs
come from `pg_namespace.nspowner`/`nspacl`,
`pg_class.relowner`/`relacl`, `pg_attribute.attacl`,
`pg_proc.proowner`/`proacl`, `pg_database.datdba`/`datacl`,
`pg_extension.extowner` and `pg_default_acl`; `pg_extension` also proves
`pgcrypto` presence. On PostgreSQL 15 or newer, the report additionally reads
every relevant `pg_parameter_acl` entry and refuses any parameter grant to the
seven restricted principals or `PUBLIC`. It cross-checks table, column and routine grants through
`information_schema.table_privileges`,
`information_schema.column_privileges` and
`information_schema.routine_privileges`, after first proving that the audit
identity can see the complete relevant ACL set. Effective positive and
negative checks include `has_table_privilege`, `has_column_privilege`,
`has_function_privilege`, `has_schema_privilege` and
`has_database_privilege` for every application identity and assumable role.
On PostgreSQL 15 or newer, `has_parameter_privilege` must prove that none can
`SET` or `ALTER SYSTEM` for `session_replication_role`; the raw parameter ACL
check remains authoritative for every other explicit parameter grant. Version
branches use `server_version_num` and refuse an absent catalog or column rather
than treating it as an older server. Each connection identity must also prove
in a rollback-only transaction that its exact `SET LOCAL ROLE` succeeds, that
no capability privilege is effective before it, and that no other capability
role can be selected.
Because `pg_roles.rolconfig` omits role-and-database defaults, the report also
enumerates raw `pg_db_role_setting`: it refuses every row for any of the seven
principals across all databases and every database-wide default for the
selected database. The effective session probe below covers server-wide
defaults. Missing catalog visibility is a failure, never an empty result.
The report fails closed when ACL visibility is incomplete, ownership is
unexpected, or any attribute, membership or privilege is missing or
additional. It records no login secret or provider account identifier and
binds the provider-authorized provisioning reference plus target configuration
revision.

The exact principal matrix is:

- each of `libre_ai_app`, `libre_ai_retention`, `libre_ai_restore` and
  `libre_ai_tombstone_guard` has `NOLOGIN NOSUPERUSER NOINHERIT NOCREATEROLE
  NOCREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0`, null
  `rolvaliduntil`, empty `rolconfig` and no outbound role membership;
- the deployment-bound app, retention and restore connection identities each
  have `LOGIN NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB NOREPLICATION
  NOBYPASSRLS`, an explicit positive `rolconnlimit` no greater than their
  reviewed pool limit, the exact `rolvaliduntil` fixed by the separately
  authorized credential policy, empty `rolconfig`, and exactly one membership
  in their matching capability role with `admin_option = false`; PostgreSQL
  16+ additionally requires `inherit_option = false` and `set_option = true`;
- no connection identity owns any database, extension, schema, relation,
  column, sequence or routine. None receives a direct object grant beyond the
  exact database connection boundary. The schema owner/migrator owns the
  schema and ordinary objects, the guard role owns only its exact reviewed
  closed routines, and the target configuration names the expected
  non-application owners for the database and `pgcrypto` extension.

These choices preserve a standard, replaceable PostgreSQL/JCS boundary and add
no US hyperscaler or proprietary control plane.

## 6. Database principals and transaction barrier

Product migrations create schemas, tables, functions, policies and grants but
do not create cluster-global roles. Deployment/bootstrap authority provisions:

- a schema owner/migrator that is never used by the application;
- `libre_ai_app`, with only the operations required for run persistence;
- `libre_ai_retention`, with the additional lifecycle operations required for
  expiry and explicit deletion;
- a `NOLOGIN` tombstone-guard role that owns the closed lineage-deletion,
  anti-resurrection and bounded-expiration functions, and receives only the
  table privileges and forced-RLS policies those functions require;
- `libre_ai_restore`, a `NOLOGIN` pre-open recovery role with bounded
  cross-organization `SELECT`/`DELETE` policies and no insert, update, schema
  or application capability.

The connection principal receives only the right to assume its intended role.
No application pool connects as a superuser, table owner or role with
`BYPASSRLS`.

Every live application or retention method opens a private transaction and
performs, before any table access:

1. `BEGIN ISOLATION LEVEL READ COMMITTED`;
2. `SET LOCAL ROLE libre_ai_app` (or the retention role);
3. `SELECT set_config('app.tenant_id', $1, true)` with the explicit
   organization identifier;
4. the bounded query or mutation;
5. commit or rollback.

Lifecycle methods use physically separate, store-owned pools and set either
`libre_ai_retention` for organization-scoped live lifecycle work or
`libre_ai_restore` for pre-open recovery. Restore begins explicitly at
`REPEATABLE READ`, but only after its external writer fence; live writers never
use a transaction-wide stale snapshot. Pool release executes `DISCARD ALL`;
before that server reset it calls `clear_cached_statements`, and the reset uses
`sqlx_core::raw_sql::raw_sql` so it creates no new persistent prepared entry.
A connection that cannot complete either step is discarded. Store construction overrides any
caller statement/slow-statement logging level with
`disable_statement_logging()`. The exact unified dependency graph also
compiles all `log`/`tracing` facade macros to `OFF`; this covers SQLx query,
pool, error and PostgreSQL notice paths that statement-level disabling alone
does not suppress. The capability gate rejects direct logger/event APIs,
stdout/stderr macros and every SQLx feature outside the allow-list, including
`ipnet` and its optional raw `println!` path. Tests intentionally poison a
pooled session, exercise rollback and cancellation paths, reuse the same bound
query across a scrub, inject each scrub failure, and prove that neither cached
statement, role, organization context nor SQL text survives or reaches any
collector.

Every initial or replacement connection, every checkout before the first
business statement, and every connection after `DISCARD ALL` must prove
`session_replication_role = 'origin'`. Each transaction helper repeats the
effective check after `BEGIN`, literal `SET LOCAL ROLE` and tenant setup, but
before reading or mutating a product relation. Any other value destroys or
refuses the connection; the crate never attempts a privileged correction.

All pool constructors first require an explicit Unix-domain socket, reject
caller startup options, overwrite secret-capable option fields with fixed
non-secret values and force `PgSslMode::Disable`. The exact SQLx graph contains
no TLS implementation. `get_socket() == None` refuses before pool or network
I/O; a present socket is SQLx's non-fallback UDS path even if the inert host is
malformed. The same rule applies to every initial and replacement connection.

`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` apply to every
organization-scoped table. Policies require both a non-empty local setting and
exact equality with `tenant_id` for read and write. The restricted roles have
no ability to disable RLS, change policies or mutate schema.

Before inspecting tombstones or touching any lineage table, every app or
retention lifecycle writer and every guard-owned lineage-deletion function
verifies `current_setting('transaction_isolation') = 'read committed'` and
acquires the same transaction-level advisory lock derived from the first eight
bytes of the versioned deletion-subject digest. The `VOLATILE` guard functions
and trigger refuse every other live isolation level; their post-lock lookup at
`READ COMMITTED` must see a tombstone committed while the lock waited. A collision can only
over-serialize unrelated lineages; it cannot allow concurrent mutation. The
anti-resurrection insert trigger acquires the same lock before its tombstone
lookup, so direct SQL and the absent-first-run case cannot bypass it. Writers
then acquire the `run_lifecycle` row lock, when the row exists, before `runs`.
This common order serializes append, policy observation, explicit deletion and
expiry without giving retention raw `UPDATE` or `DELETE` on `runs`.
No role receives table-wide `UPDATE` on `runs`: app receives column grants only
for the mutable execution projection, while app and retention receive column
grants only for the mutable lifecycle projection. Row locking remains possible
because each writer has `UPDATE` on the columns it is permitted to maintain.

## 7. Persisted model

All contract identifiers and digests have matching length and format checks;
internal storage digests use the versioned preimages defined here. Timestamps
are UTC instants. No prompt, tool argument, tool-observation payload, path,
destination, comment, free-form error or personal identity is stored.

### 7.1 `runs`

One row is the current query projection for a run. Its composite primary key is
`(tenant_id, run_id)`. It stores only bounded immutable identifiers and contract
digests mechanically extracted from validated canonical events, creation and
last-event instants, head sequence and head event digest. Lifecycle deadlines
are deliberately absent. It does not persist replay phase, readiness,
completion, quarantine, active generation or current budget state.

The row is not replay authority. It is updated in the same transaction as each
event and can be rebuilt from the immutable event chain. Identity and creation
columns are immutable; only app may update the mechanical head and last-event
columns. Retention never updates or directly deletes this relation; the
guard-owned closed deletion function removes it and its dependent projections
atomically.

Deferred coherence triggers require, at commit, that the run head matches the
maximum immutable event and that every ledger row is bound to its same
immutable event sequence and digest. This permits a tentative first projection
during atomic append but prevents the application role from committing a head
mutation, event or ledger row without its corresponding evidence.

### 7.2 `run_retention_facts`

This append-only relation records each already-authenticated retention
observation applied to a run: organization/run/mission identifiers, validated
years, observation instant and a versioned internal fact digest. It stores no
Missions payload, actor, comment or policy rationale. Its key makes an exact
repeat idempotent and rejects a different value at the same observation
instant: the primary key is `(tenant_id, run_id, observed_at)`, followed by an
explicit digest comparison on conflict. An observation older than the latest
stored instant is rejected, so
concurrent or delayed delivery cannot roll policy backward.

The digest preimage is internal storage framing, not a wire contract:

```text
SHA-256(
  "libre-ai.mission-retention-observation.v1\0" ||
  u32be(byte_length(mission_id_utf8)) || mission_id_utf8 ||
  u8(retention_years) || i64be(observed_at_unix_microseconds)
)
```

The relation is the durable local replay evidence for lifecycle state, not an
authority for choosing retention. Inserts and reads remain organization-scoped
under forced RLS; updates and deletes are denied except for cascade deletion of
the whole authorized lineage. Insert triggers recompute the internal digest,
bind the stored mission, acquire the lifecycle row lock themselves and reject
observations older than the newest immutable fact. A caller cannot make a stale
insert pass by temporarily rewinding the mutable projection.

### 7.3 `run_lifecycle`

One row per run stores the current retention years, deadline, latest fact
instant and fact digest. It is a disposable projection rebuilt deterministically
from `run_retention_facts` ordered by observation instant. Both app append and
live retention may update only these lifecycle columns after acquiring this
row `FOR UPDATE`; neither receives table-wide `UPDATE`. Identity and mission
binding columns are immutable by grants and trigger. The deadline index lives
on `(tenant_id, retention_until, run_id)`. Deferred coherence triggers require
at commit that its latest instant/digest/years/deadline equal the newest
immutable retention observation; neither a fact nor a lifecycle update can be
committed alone.

### 7.4 `run_events`

One row stores one authoritative canonical event with:

- `(tenant_id, run_id, sequence)` as the ordered primary key;
- a unique event identity and event digest within the organization;
- predecessor digest and bounded event kind as extracted indexes;
- `canonical_jcs BYTEA` as the immutable authority;
- the authoritative event occurrence instant and persistence instant.

The restricted application role can insert and select but cannot update or
delete events. A trigger rejects updates even if a future grant is widened by
mistake. Extracted columns are mechanically compared with the parsed canonical
bytes before insert and never override them.

### 7.5 `budget_ledger`

The ledger is append-only and keyed by event sequence. It stores the bounded,
schema-validated budget deltas and resulting counters mechanically extracted
from the canonical event for independent audit. It binds the event digest and
never computes phase, routing or policy. Whole-chain pure replay remains the
only validator of budget semantics; no current budget projection exists in
`runs`, and no caller supplies a “budget accepted” verdict.

### 7.6 `attestation_refs`

This append-only relation stores only opaque contract references, digests,
profile identifiers and their binding sequence. It never stores an
attestation payload, signature private material, artifact contents, effect
destination or actor identity. Need-to-know queries must explicitly request
this projection and remain organization-scoped.

### 7.7 `execution_deletion_tombstones`

A tombstone contains only a content-free subject digest, deletion receipt
digest, effective database deletion instant and earliest expiry-eligibility
instant. `P35D` is represented in
PostgreSQL as exact elapsed `interval '840 hours'`, never calendar
`interval '35 days'`, so a poisoned session timezone or DST boundary cannot
shorten the barrier. Mission-retention years remain a distinct UTC calendar
calculation. The caller supplies no deletion timestamp. After acquiring every
lineage lock, the guard captures `clock_timestamp()` immediately before the
first tombstone insert and derives expiry from that stored effective instant;
an old authorization receipt therefore still creates a full new `P35D`
barrier. An existing same-receipt tombstone is idempotent and keeps its original
effective instant and expiry rather than extending them. It deliberately has no foreign
key to a run: deleting the run cannot delete the evidence that prevents its
restore. The application role cannot read, insert, update or delete this
table. The retention role has no raw insert, select, update or delete grant: it
invokes guard-owned functions that derive the subject from its
transaction-local organization context, insert or compare one tombstone and
return only a closed outcome. Its separate bounded expiration function returns
only a count. An RLS policy and database trigger both block deletion before
`P35D`; the closed function additionally refuses without an exact independently
authenticated `SnapshotRetirementFact`. Elapsed wall time is necessary but
never sufficient.

The deletion-subject digest has one versioned internal preimage:

```text
SHA-256(
  "libre-ai.execution-deletion-subject.v1\0" ||
  u32be(byte_length(organization_id_utf8)) || organization_id_utf8 ||
  u32be(byte_length(run_id_utf8))          || run_id_utf8
)
```

Length framing prevents concatenation ambiguity. Rust and PostgreSQL
implementations must match fixed cross-language vectors. The schema owner
installs tombstone-guard-owned `SECURITY DEFINER` functions and trigger with a
fixed safe `search_path`. The insertion trigger recomputes this digest for every
attempted `runs` insertion and rejects any retained matching tombstone without
disclosing its presence to the application role.

The guard-owned `SECURITY DEFINER VOLATILE lock_lineage` function derives the
same subject, refuses unless transaction isolation is `read committed`, and
calls `pg_advisory_xact_lock` on its first signed 64 bits. Public and restore
execution are revoked; app and retention may execute it only after setting
their transaction-local organization context. Cross-language fixed vectors
bind the lock key to the subject digest, and the insert trigger calls this same
function before every anti-resurrection lookup.

The guard-owned `delete_lineage_with_tombstone` function derives the subject
from the transaction-local organization context, acquires the common advisory
lock and then the lifecycle row lock when present, inserts or compares the
receipt, and deletes the run cascade in the same transaction. A
divergent receipt refuses before deletion. `FORCE RLS` remains active: policies
and grants give the `NOLOGIN` guard only the tombstone `SELECT`/`INSERT`, expired
tombstone `DELETE`, organization-scoped lifecycle `SELECT` plus column-scoped
`UPDATE(retention_until)` solely to authorize `SELECT ... FOR UPDATE`, and
`SELECT(tenant_id, run_id)` plus organization-scoped `DELETE` on `runs`
required by those closed functions. A schema-owner trigger refuses any actual
lifecycle value change under the guard role. Every other run column and
operation is denied. The guard has no tombstone `UPDATE`, no other relation
privilege, no login and no connection-principal member. Public and restore
execution of every guard function is revoked; app receives only
`lock_lineage`, while retention receives only `lock_lineage`,
`delete_lineage_with_tombstone` and the bounded tombstone-expiry function.
The retention role has no raw `DELETE` on runs, dependent projections or
tombstones.
Expiration binds injected time, a bounded exact snapshot-retirement fact,
total index order and batch size. The restore
role receives the separate content-free lookup and pre-open lineage deletion
policies required for recovery.

## 8. Public Rust surface

The crate exposes typed stores, not SQL primitives:

```rust
pub struct RunStore { /* private PgPool + embedded ContractRegistry */ }
pub struct LifecycleStore { /* separate private PgPool */ }
pub struct RestoreStore { /* separate pre-open-only PgPool */ }
pub struct DeletionRegistryFact { /* private validated fields */ }
pub struct SnapshotRetirementFact { /* private validated backup-authority fields */ }
pub struct RestoreBatchSize(NonZeroU16);
pub struct TombstoneExpiryBatchSize(NonZeroU16);
pub struct EventPageRequest { /* private event cursor + limit */ }
pub struct LedgerPageRequest { /* private ledger cursor + limit */ }
pub struct ReferencePageRequest { /* private reference cursor + limit */ }
pub struct RunSweepPageRequest { /* private sweep cursor + limit */ }

pub async fn connect(
    options: PgConnectOptions,
    limits: PoolLimits,
) -> Result<Self, StoreError>;

pub async fn append_event(
    &self,
    organization_id: &OrganizationId,
    graph_document: &serde_json::Value,
    event_document: &serde_json::Value,
    mission_retention: &MissionRetentionFact,
    observed_at: DateTime<Utc>,
) -> Result<AppendOutcome, StoreError>;

pub async fn get_run(
    &self,
    organization_id: &OrganizationId,
    run_id: &RunId,
) -> Result<Option<RunSnapshot>, StoreError>;

pub async fn list_events(
    &self,
    organization_id: &OrganizationId,
    run_id: &RunId,
    page: EventPageRequest,
) -> Result<EventPage, StoreError>;

pub async fn replay_tombstones(
    &self,
    registry: &DeletionRegistryFact,
    observed_at: DateTime<Utc>,
    batch_size: RestoreBatchSize,
) -> Result<RestoreOutcome, StoreError>;

pub async fn expire_tombstones(
    &self,
    retirement: &SnapshotRetirementFact,
    observed_at: DateTime<Utc>,
    batch_size: TombstoneExpiryBatchSize,
) -> Result<TombstoneExpiryOutcome, StoreError>;
```

Budget and attestation-reference queries follow the same organization-scoped,
cursor-bounded shape. Lifecycle methods accept explicit authoritative time and
an explicit deletion command whose authorization has already been verified by
a future caller. That deletion command contains organization, run and receipt
digest only; it cannot inject the effective deletion or expiry time. The
methods do not expose a public bypass flag or reuse the application pool.

`RunSnapshot` exposes only `run_id`, `head_sequence`, `head_event_digest` and
the joined `retention_until`. It cannot expose phase, ready step, completion,
quarantine, generation or current budget counters. Those values remain
available only while the unchanged pure replay result is evaluated in memory.

`MissionRetentionFact` binds the owning mission identifier, a validated
`P1Y` through `P6Y` duration and its observation time. Every append compares
that mission with the event/run, derives the internal observation digest and
computes retention from run creation, not from the latest append.
`LifecycleStore::apply_mission_retention` records the same bounded fact and may
update `run_lifecycle` after the last execution event when Missions changes its
policy; it never updates `runs`. Both paths reject an unrecorded stale
observation, treat an exact repeated observation as idempotent and refuse a
divergent value at the same instant. An exact event retry may reference an older
fact only when the exact retention observation is already recorded in the
immutable journal; it performs no lifecycle write. Neither method accepts a
caller-classified “policy valid” boolean.

`PoolLimits` has closed minimum/maximum bounds for connection count and
acquisition timeout. All store constructors install the same `after_release`
hook and return a closed `StoreError` if initial connection or session
scrubbing fails. Neither `PgConnectOptions`, `PgPool`, nor a raw connection is
recoverable from a constructed store. `RestoreStore` exposes only tombstone
replay and its blocking proof query; it has no event, export or append method.

`DeletionRegistryFact` binds the execution-snapshot instant, the instant at
which all writers were authoritatively fenced, the independently protected
deletion registry's coverage-through instant, the exact execution-snapshot
reference, tombstone count and set digest, plus the snapshot-catalog revision
and retirement-proof digest governing any omitted tombstone. The digest
preimage is `libre-ai.execution-deletion-registry.v1\0`, followed by the
big-endian `i64` execution-snapshot instant, fixed 32-byte execution-snapshot
digest, big-endian `i64` writer-fence and coverage instants, fixed 32-byte
snapshot-catalog and retirement-proof digests, big-endian `u64` row count and,
for every row ordered lexicographically by subject digest, the fixed 32-byte
subject digest, fixed 32-byte receipt digest and big-endian `i64`
Unix-microsecond deletion and expiry instants. Restore methods recompute count and digest over every locally restored
tombstone in cursor-bounded pages inside one repeatable-read transaction, require
`snapshot_at <= writers_fenced_at <= observed_at`, require registry coverage
through the writer fence and refuse a snapshot older than `P35D`. They replay
every retained tombstone regardless of temporal eligibility. A registry may
omit a purged tombstone only when its authenticated retirement proof binds the
selected execution snapshot and proves that no admissible execution snapshot
can contain that subject's lineage. The package validates only bounds, ordering
and internal digests. It does not infer catalog authenticity or freshness and
cannot compare a declared snapshot digest with the actual backup artifact. A
future pre-open gate must authenticate the catalog, prove membership of the
selected artifact and validate the retirement semantics before constructing
the fact. Restore accepts no caller-classified “registry complete” boolean;
this package opens none of those external capabilities.

`SnapshotRetirementFact` is a bounded, content-free fact from the independent
backup authority. It binds an immutable snapshot-catalog revision, an exact
sorted set of subject/receipt digests, its count and set digest, and the
observation instant. Its semantics are stronger than age: no admissible
execution snapshot can contain any listed lineage. Tombstone expiry recomputes
the exact selected set and refuses an absent, malformed, partial or internally
mismatched fact. Catalog admission and freshness are external authority
preconditions, not storage inferences. Its set digest is SHA-256 over
`libre-ai.snapshot-retirement.v1\0`, the fixed snapshot-catalog digest,
big-endian `i64` observation instant, big-endian `u16` count, then every sorted
fixed subject/receipt digest pair. If the external fact is unavailable, the content-free tombstone remains
active beyond `P35D`; this fail-closed over-retention is visible and cannot be
reclassified as successful expiry.

Construction builds the fail-closed `ContractRegistry` once from SDK Rust's
embedded canonical schemas. Each append validates the supplied graph and
candidate event, proves that their graph digests match, then validates every
stored event during replay. The graph remains an input from the future
authority-owning caller; this package neither discovers nor stores a second
copy of the plan/graph authority.

The crate does not claim the caller's authorization is valid; it records a
strict precondition in the type and still validates the deletion subject,
retention limits and current database state. Until a Biscuit-authorized caller
is separately implemented and proven, no production path may construct that
command.

Events, ledger entries, attestation references and expiry candidates use
distinct request/cursor types; a cursor for one query cannot parse as another.
Each binary cursor starts with a one-byte type/version tag and a 32-byte scope
digest, then carries its complete order key:

- event: run scope, `(sequence, event_digest)`;
- ledger: run scope, `sequence`;
- reference: run scope, `(sequence, kind, id, digest)`;
- sweep: organization scope, `(retention_until, run_id)`.

Run scope is
`SHA-256("libre-ai.run-cursor-scope.v1\0" || u32be(org_len) || org ||
u32be(run_len) || run)`; organization scope is
`SHA-256("libre-ai.organization-cursor-scope.v1\0" || u32be(org_len) || org)`.
Cursor tags are respectively `0x01`, `0x02`, `0x03` and `0x04` in the order
above. Reference kinds use explicit stable codes 1 through 8 in the declared
`ReferenceKind` order, never Rust enum ordinals. Variable cursor strings are
`u16be` length-framed, integers are big-endian, instants are signed
Unix-microseconds, and the complete bytes use Base64 URL-safe encoding without
padding. These tuples exactly match their relation's unique key and SQL
`ORDER BY`, so every order is total. Fixed vectors prove tags, framing,
round-trip, cross-type/scope refusal and canonical re-encoding. “Opaque” means
caller-independent, not confidential; only bounded non-PII identifiers enter a
cursor.

All page types enforce a closed limit range of 1 through 100 and return a
`{ data, meta }`-shaped Rust result. Offset pagination and unbounded exports are
absent. Each page is fetched with one bounded query; related ledger/reference
projections use explicit separate methods rather than N+1 loading.

## 9. Atomic append protocol

`append_event` executes one database transaction:

1. validate and normalize the supplied graph and candidate event through the
   existing pure core, prove their graph digests match, bind the explicit
   mission-retention fact, canonicalize the event with RFC 8785 and recompute
   its event digest;
2. begin explicitly at `READ COMMITTED`, establish restricted role and
   organization context, then call `lock_lineage` as a distinct statement
   before any lineage read or insert;
3. create the first `runs` and `run_lifecycle` keys with
   `INSERT ... ON CONFLICT DO NOTHING` when absent, lock `run_lifecycle` first
   and then lock the `(tenant_id, run_id)` execution projection with
   `SELECT ... FOR UPDATE`; every writer locks lifecycle first, only append
   explicitly locks `runs`, and the speculative rows remain inside the same
   transaction;
4. classify an existing event identity as exact only when identity, sequence,
   digest and canonical bytes all match, but do not return yet; a divergent
   collision aborts;
5. load the complete existing canonical event chain in sequence order under
   the same lock and revalidate every stored document;
6. call the existing pure whole-chain replay with the validated graph, adding
   the candidate in memory only when it is new; any integrity, causal, phase,
   routing, generation or budget refusal aborts the append;
7. require the replay state's public sequence and event digest to match the
   candidate for a new event, or the maximum stored immutable event and current
   `runs` head for an exact historical duplicate; after that duplicate check,
   return idempotent success without writes only if its exact retention
   observation is already recorded, whether or not a later observation is
   current; refuse an unrecorded observation on this retry path so standalone
   policy changes use `LifecycleStore` rather than event idempotency;
8. for a new event, append its
   retention observation when needed, update `run_lifecycle`, insert the
   immutable event, mechanically extracted budget row and allowed opaque
   references, then update only the mechanical `runs` head fields;
9. commit once.

Any divergent identity/sequence collision returns a closed conflict and writes
nothing. Any validation, serialization, constraint, RLS, timeout or connection
failure rolls back the complete transaction. No retry occurs inside the store;
a future caller may retry only the same immutable input and must observe the
idempotent result.

The first-event race is proven with concurrent transactions. Exactly one
canonical lineage is committed; an exact duplicate is idempotent and a
divergent candidate is refused. Isolation level and SQL shape must be selected
from this proof, not assumed from library defaults.

Whole-chain replay is intentionally `O(n)` in event count and bytes for this
proof slice. It is safer than persisting an unauthorized state format or
duplicating the reducer, but the locked event sequence ceiling is too large to
claim production suitability from boundedness alone. Benchmarks must publish
the scaling curve and maximum-memory observation. No production service may
consume this store until a later governance decision either authorizes a
native, derived incremental checkpoint with an independent rebuild proof or
demonstrates an enforceable authoritative run bound that keeps the complete
replay path within the measured envelope. A LangGraph checkpoint cannot
satisfy that requirement.

## 10. Canonical evidence and projections

`canonical_jcs` is the sole persisted replay authority because JSONB is free to
normalize representation and therefore cannot prove byte-identical replay.
The store reparses JCS bytes through the locked registry before replay. Invalid
stored bytes, a digest mismatch or disagreement with extracted columns fails
closed as integrity corruption; it is never repaired in place.

The `runs`, ledger, reference and `run_lifecycle` relations are disposable
projections. A deterministic rebuild into an empty projection schema rebuilds
the execution projections from `run_events` and the lifecycle projection from
`run_retention_facts`, first replaying the event chain through the pure core,
requiring its public sequence and event digest to match the reconstructed head,
then applying retention observations in ascending instant order against the
mechanically extracted creation instant and refusing equal-instant divergence.
Rebuild never overwrites either immutable source. An independent test compares
canonical event bytes and every mechanical execution/lifecycle projection
field byte-for-byte; it does not encode or reproduce private native state.

## 11. Retention, deletion and restore

The crate represents the locked policy as validated values: default `P1Y`,
maximum `P6Y`, equality with the owning mission retention, and tombstone
retention `P35D`. It does not select a mission policy. A caller must provide
the already-authoritative mission retention fact; the store rejects values
outside the locked bounds or unequal execution/mission retention.

Expiry uses a two-stage, bounded sweep:

1. select a bounded candidate page with a cursor and no payload export;
2. in one explicit `READ COMMITTED` transaction, derive every candidate's
   signed advisory key, sort and deduplicate those keys by their immutable
   numeric value, and acquire all of them in that order before any lifecycle
   row lock; the mutable deadline cursor order is never a lock order;
3. recheck each lifecycle row against injected authoritative time, then invoke
   `delete_lineage_with_tombstone`, which reacquires its already-held advisory
   lock reentrantly, inserts or compares the tombstone and deletes the run
   cascade atomically.

Explicit deletion uses that same closed guard function. Retention has no raw
`DELETE` path around it. A tombstone is committed before or with run deletion,
never afterward. Its effective deletion time is captured inside the guard only
after the advisory and lifecycle locks; neither public API nor direct function
call accepts a time argument. The subject digest is derived from the closed
organization/run lineage; raw identifiers do not enter the tombstone. Deletion
is idempotent for the same receipt and refuses a divergent receipt before any
lineage removal.

Automatic run expiry derives, in Rust and PostgreSQL, a deterministic internal
receipt rather than inventing an external authorization receipt:

```text
SHA-256(
  "libre-ai.execution-retention-expiry-receipt.v1\0" ||
  subject_digest || i64be(retention_until_unix_microseconds)
)
```

Fixed cross-language vectors bind that preimage. Explicit deletion continues
to require its caller-authenticated receipt digest; the two receipt sources are
not interchangeable.

While that tombstone is retained, the tombstone-guard insertion trigger refuses
recreation of the deleted organization/run lineage. This closes both the live
append path and restore races even though the application role cannot query
tombstones. Temporal eligibility alone never deactivates the barrier. Run
identifiers remain non-reusable authority identifiers; the future authorization
layer must enforce that invariant after authenticated snapshot retirement has
permitted physical purge.

Restore has a mandatory pre-open phase under the dedicated restore authority:

1. fence every role that can mutate runs or tombstones outside this package,
   including retention expiry;
2. restore the tombstone relation and snapshot-retirement evidence first from
   an independently protected deletion registry, not from the execution
   snapshot alone;
3. verify its authoritative manifest: row count and deterministic set
   digest match, coverage reaches the writer fence, and the execution snapshot
   is no older than the `P35D` backup ceiling;
4. replay every retained tombstone against restored execution records and
   accept an omitted tombstone only through the exact retirement proof bound to
   the selected execution snapshot;
5. delete every matching restored lineage and its projections;
6. verify that no suppressed lineage remains;
7. only then permit the application role or service traffic.

Because tombstones intentionally contain no reversible organization or run
identifier, `RestoreStore` opens one repeatable-read transaction, verifies the
registry, then scans every restored run key in internally cursor-bounded pages,
recomputes each subject digest inside PostgreSQL, deletes matches and obtains
the final suppressed-lineage count before its single commit. The caller chooses
only a validated batch size from 1 through 100; it cannot stop after a partial
page or inject a cursor. Cross-organization RLS policies permit only the reads
and deletes required by this operation. The crate supplies the bounded-memory
replay operation and proof query. Both require `DeletionRegistryFact` and refuse
before scanning execution rows when the locally recomputed registry manifest
or time relationships disagree. A zero suppressed-lineage count is necessary
but not sufficient without this completeness/freshness proof. The crate does
not authenticate that fact, fence writers or control service startup. Future
deployment tooling must make writer fencing, authoritative registry restore,
manifest authentication and successful replay a blocking startup gate, and
must not retain restore-role membership in the application identity.
Once a tombstone is physically purged, an authenticated snapshot-retirement
fact has proved that no admissible backup can contain that lineage. Purge is
therefore a retention-authority operation, not a normal application sweep.

`expire_tombstones` is a separate global, content-free retention operation. It
accepts injected time, an exact `SnapshotRetirementFact` and a validated batch
size of 1 through 100, deletes in
the total order `(expires_at, subject_digest)` without `RETURNING`, and exposes
only the deleted count. The SQL predicate requires both `expires_at <=
observed_at` and `expires_at <= transaction_timestamp()`; the database trigger
also refuses any deletion before exact elapsed `P35D`, expressed as 840 hours,
or outside the exact retired subject/receipt set. The anti-resurrection barrier
remains active while the row exists, even after temporal eligibility.
Fixed Rust/PostgreSQL vectors straddle Europe/Paris spring and autumn DST
transitions and are repeated after poisoning the session timezone. The `(expires_at,
subject_digest)` index bounds selection. App and restore cannot call the method
or assume its role.

## 12. Error and diagnostic discipline

`StoreError` exposes only closed, constant categories such as invalid input,
conflict, unavailable, integrity failure and internal persistence failure.
`Display` and `Debug` contain the code only. SQL text, database messages,
constraint names, connection details, organization/run identifiers, digests,
event documents and rejected values never enter a public error.

The underlying SQLx error may remain a private non-formatting source solely for
control flow classification. No API in this package logs it. Error-code and
aggregate-counter allow-listing belongs to the later runtime-diagnostics
package and cannot be inferred from this design.

## 13. Verification strategy

All non-trivial behavior is test-first. The implementation must provide:

- a disposable PostgreSQL harness that uses only a mode-0700 private Unix
  socket, has an empty `listen_addresses`, configures every host HBA rule as
  `reject`, and fails before tests if either property cannot be proved;

### 13.1 Unit and property tests

- identifier, digest, cursor and retention-bound validation;
- canonicalization and stored-digest equality;
- constant-only `Display` and `Debug` for every public error;
- cursor monotonicity and limit bounds;
- mechanical budget-field extraction and event/ledger binding without policy
  derivation;
- generated canonical documents proving property-order independence.

### 13.2 Real PostgreSQL integration tests

- migrations apply from an empty PostgreSQL 14-or-newer database;
- every table has enabled and forced RLS;
- organization A cannot select, update, delete, infer or conflict against
  organization B through any public method;
- missing or poisoned organization context fails closed;
- role and context do not survive pool release;
- rollback, task cancellation and scrub failure cannot return a poisoned
  connection to either pool;
- permissive tracing and log collectors first receive a positive control
  through direct collector APIs rather than compiled-out macros; after capture
  is cleared, caller-enabled statement/slow-statement logging, every store and
  pool lifecycle path, failures, cancellation, backend termination and
  PostgreSQL `RAISE INFO`, `NOTICE` and `WARNING` produce zero event, including
  target `sqlx::postgres::notice`, and never evaluate a sensitive formatter;
- the same no-emission proof passes in debug, release and the dev-unified
  `tracing/log-always` graph, while normal-build assertions keep both
  `STATIC_MAX_LEVEL` values at `OFF` and an exact-graph audit rejects direct
  logger/event/stdout bypasses or any extra SQLx feature; independent negative
  selected-graph fixtures introduce the `sqlx` facade through another
  consumer, activate direct `sqlx-core/migrate` or
  `sqlx-postgres/migrate`, duplicate either component version, or add TLS or
  another feature, and every case fails closed;
- absent socket, TCP-only options and caller startup options return constant
  `InvalidInput` before pool, socket or SQL I/O;
- an explicit private socket combined with `host("[")`, password and distinct
  file/inline certificate and key sentinels connects without panic, TLS,
  filesystem access, option serialization, sentinel emission or transmission;
- the resolved dependency graph contains no TLS implementation, all pools
  force `PgSslMode::Disable`, and the harness proves private UDS operation with
  empty `listen_addresses` and rejecting host HBA rules;
- clearing either the client prepared-statement cache or the unprepared server
  session fails by destroying the connection;
- live writers prove the lock order advisory then lifecycle then run at
  `READ COMMITTED`; a transaction whose snapshot predates concurrent deletion
  observes the committed tombstone after waiting, while direct app/retention
  writes at `REPEATABLE READ` or `SERIALIZABLE` refuse before mutation;
- the app role cannot update/delete events, access tombstones or alter schema;
- all seven restricted principals match the exact role attributes and
  memberships; PostgreSQL 16+ proves membership options
  `admin/inherit/set = false/false/true`, PostgreSQL 15+ proves no parameter
  ACL and no effective `session_replication_role` privilege, raw
  `pg_db_role_setting` has no role-and-database or target database-wide default,
  every initial/replacement/checked-out/reset session proves
  `session_replication_role = 'origin'`, and every login
  can select only its intended role;
- the tombstone-guard role is `NOLOGIN`, lacks `BYPASSRLS`, cannot update a
  tombstone, has only the tombstone access, lifecycle lock and
  organization-scoped run deletion its closed owned functions require, and
  cannot read any other relation; early/raw deletion and every
  connection-principal membership are refused;
- the restore role is `NOLOGIN`, lacks `BYPASSRLS`, cannot insert/update or
  access application methods, and its cross-organization policies cover only
  bounded tombstone replay;
- app and retention have only column-scoped lifecycle `UPDATE`; retention has
  no raw `UPDATE` or `DELETE` on `runs`, and neither role can mutate lifecycle
  identity or mission binding;
- application attempts to recreate a tombstoned run fail without revealing
  whether the tombstone exists;
- a direct execution-head mutation without the corresponding immutable event
  and ledger evidence cannot commit, while a later authenticated retention
  observation changes only the lifecycle projection;
- concurrent first append and concurrent next append commit exactly one
  lineage, while exact duplicates remain idempotent;
- a concurrent deletion and first append of the same absent lineage always
  leaves an active tombstone and no live run, in both lock-acquisition orders;
- a delayed deletion receipt and a deletion resumed after a lock wait each
  receive a fresh database-owned effective instant and a full 840-hour barrier;
  same-receipt retry does not extend it and direct SQL cannot backdate it;
- a snapshot taken between tombstone capture and deletion commit keeps the
  tombstone active past `P35D` until an exact retirement fact proves that
  snapshot inadmissible; restore cannot ignore or omit the tombstone on age
  alone;
- injected failure at each SQL boundary leaves no partial event, ledger,
  reference or projection write.

### 13.3 End-to-end persistence proof

The locked authorized-execution vectors are validated by the pure core,
persisted through the public store, loaded only through organization-scoped
queries and replayed into byte-identical state. The proof also covers a broken
predecessor, divergent collision, maximum bounded graph/run, budget overflow
and unavailable database observation.

No test invokes a real worker, Harness, effect or mission. All fixtures are
synthetic and checked for forbidden content.

### 13.4 Lifecycle proof

- `P1Y` default and equal mission retention are enforced;
- a value greater than `P6Y` is refused;
- selection followed by a concurrent retention change is rechecked under
  lock;
- retention after the last execution event changes only `run_lifecycle`; all
  `runs` columns remain byte-identical;
- stale and equal-instant divergent observations are refused, while exact
  repeats are idempotent;
- lifecycle rebuild from the immutable observation journal is byte-identical
  to the live lifecycle projection;
- deletion and tombstone creation are atomic; `P35D` after the effective
  database time is only the earliest expiry eligibility, while authenticated
  snapshot retirement is also mandatory;
- tombstones are content-free and inaccessible to the app role;
- fixed vectors prove Rust/PostgreSQL deletion-subject digest equality;
- restore applies tombstones first and cannot resurrect deleted lineage;
- restore refuses an execution snapshot older than `P35D`, a registry whose
  coverage does not reach the writer fence, and any count/digest mismatch;
- restoring both execution rows and tombstones from a snapshot predating a
  later deletion refuses pre-open rather than reporting a misleading zero;
- restore-role credentials cannot be used through `RunStore` or
  `LifecycleStore` constructors without their role/grant probes failing;
- tombstones cannot expire before `P35D` or without exact snapshot-retirement
  evidence;
- automatic run expiry uses the versioned deterministic receipt and tombstone
  expiry processes at most its validated batch in total index order;
- the proof query blocks service opening while any restored lineage survives.

### 13.5 Performance proof

Append and page-query SQL statement counts are constant with run length. The
append path nevertheless reads and validates `O(n)` canonical bytes, as
declared in section 9. The hot append, replay-load and bounded-page paths
receive reproducible PostgreSQL benchmarks without hardware-dependent blocking
latency thresholds. The report includes event count, total bytes, peak memory
and percentile latency at each fixed fixture size. Checked query plans must use
the organization/run/sequence indexes and may not show an unbounded sequential
scan for the representative maximum fixture.

The pre-open benchmark independently varies tombstone and restored-run counts.
Registry verification plus the lookup/reconciliation decision has the declared bound
`O(tombstones + runs * log(tombstones))`: the registry is scanned once and
each restored run performs one primary-key B-tree tombstone lookup. Checked
plans must use that index and reject a hash join, hash aggregate or other
materialization of the complete tombstone set. Physical cascade deletion adds
linear work in the dependent rows actually removed, so the full bound is
`O(tombstones + runs * log(tombstones) + purged_rows)`.
The production loop returns a private `ScanStats` value containing processed,
page and maximum-current-page row counts; `RestoreStore` uses the processed
count but exposes none of these diagnostics. Every fetch enters a private
single-page lease whose owned row type is non-Clone; the consumer borrows rows,
no owner can escape and the lease drops before the next fetch. Before consuming
a fetched page, that same loop returns a closed integrity error if its row count
exceeds the validated batch size. Unit tests colocated with the private loop
use drop-counted rows and prove oversized-page refusal, zero prior live rows at
every subsequent fetch, `max_buffered_rows <= batch_size` and identical maxima
at a fixed batch size as total rows grow. The statistic alone proves only the
page-size bound; the lease/type/drop proof establishes row-owner release. A
real-PostgreSQL E2E successfully processes more than two pages at batch 100, so
an unbounded SQL fetch is caught by the same production check. The two largest
fixtures must traverse multiple pages. This tests the exact production loop
without a public or feature-gated test hook. A
Linux CI wrapper separately runs each externally visible benchmark fixture in
a new process via GNU `/usr/bin/time -v` and publishes normalized peak RSS
bytes; missing collector output fails the evidence job, while no
hardware-dependent RSS threshold is treated as correctness.

## 14. Quality gates

The implementation merge is blocked on, at minimum:

- formatting and Clippy with zero warnings for the entire Rust workspace;
- the complete Rust unit, integration, E2E and documentation-test suites;
- repository TypeScript/governance checks, including capability and authority
  pin gates;
- generated workspace and new-crate coverage reports, each independently
  meeting the repository's blocking line and function thresholds, so strong
  coverage elsewhere cannot hide a run-store regression;
- dependency license/advisory/source review with an exact lockfile;
- reproducible clean-schema migration and restore tests on real PostgreSQL;
- independent security, privacy, quality/performance and completeness verdicts
  over the exact implementation commit `I`; if evidence is tracked, one direct
  child `E` may change only the allow-listed dossier/status paths while a gate
  proves every implementation byte equals `I`;
- owner pronouncement at the ADR-0011 D4 hard stop before the first merge.

An integration test that silently skips because PostgreSQL is unavailable is
not green proof. CI must provision the database from a trusted operating-system
package or an independently attested source, run the test target and fail if
the barrier is absent.

## 15. Sovereignty assessment

### PASS

- Rust, direct unmodified `sqlx-core`/`sqlx-postgres`, `log`, `tracing`,
  PostgreSQL, `pgcrypto`, RFC 8785 and SHA-256 are open building blocks with
  acceptable licenses; the semver-exempt core API and private `_rt-tokio`
  coupling are accepted only under exact 0.9.0 pins and full requalification,
  and the selected production target must attest `pgcrypto` before schema
  change.
- The local-only proof has no TLS/native-certificate-store dependency and uses
  only the harness's mode-0700 Unix-domain socket with TCP disabled.
- Clever Cloud in the declared EU region remains a future candidate; this
  local-only proof neither connects to it nor proves its role provisioning.
- RLS, forced least privilege, content-free storage, bounded exports,
  retention, deletion and restore are designed as blocking proofs.
- The pure authority remains independent of the persistence library and any
  orchestration framework.

### WARN — intentional closed boundary

Biscuit request authorization, secret acquisition, endpoint construction,
zero-PII runtime observability, service startup orchestration and an authorized
incremental-state boundary are not yet implemented. In the exact graph, the
proof's static-off dependency features also disable safe diagnostics globally
for every consumer of the unified package instances. The store is also
Unix-domain socket only and deliberately has no remote TLS implementation.
Remote TLS transport is therefore a separate production blocker. Current
provider documentation does not prove that the required global roles, login
identities, memberships and grants can be provisioned on the Clever Cloud
candidate; target-side role-provisioning compatibility is a fourth production
blocker.
These four production blockers remain unchanged by the dependency amendment.
Consequently this crate cannot be wired to a production request or open a real
run. Treating injected construction of a deletion command as production
authorization, treating the `O(n)` proof append as an unmeasured production hot
path, merely removing static `OFF` without a proven safe SQLx logging boundary,
or enabling TCP/TLS without a WebPKI `verify-full` and secret-boundary proof
would be a security/quality violation, not an integration shortcut.

### FAIL

No known sovereignty failure is accepted by this design. Introducing a US
hyperscaler control plane, AGPL/SSPL dependency, application superuser,
unbounded export, raw-content column, framework checkpoint or mutable event
would invalidate the design and require a new decision.

## 16. Rollback and migration discipline

Code rollback removes the crate consumer while leaving already persisted
canonical evidence readable. Applied migrations are never reversed by a down
migration that deletes evidence or tombstones. Schema correction is additive
and forward-only. Event bytes are never rewritten to fit a new implementation;
a new contract generation must append new evidence under separately authorized
semantics.

This makes application rollback high-reversibility and evidence rollback
deliberately impossible. The asymmetry is required for audit integrity.

## 17. Rejected alternatives

### Complete runtime service now

Rejected on security and quality. It would make RLS, request authorization,
secret handling, runtime logs and external-effect boundaries fail together and
would prevent attributing a proof failure to one authority.

### TypeScript persistence adapter

Rejected on quality and architectural authority. It conflicts with the Rust
runtime decision, duplicates native domain conversion and makes the future
service dependent on an implementation pattern rather than the PostgreSQL
barrier itself.

### Store JSONB as replay authority

Rejected on quality. JSONB is useful for queries but cannot preserve the exact
canonical byte evidence required by the locked replay acceptance. Extracted
relational columns are sufficient for bounded queries.

### Put persistence in the pure root crate

Rejected on security. It would widen a reviewed effect-free capability
boundary and make every pure consumer transitively depend on database runtime
features.

### Introduce a generic repository or event-store abstraction

Rejected as premature abstraction. Only PostgreSQL is authorized, and fewer
than three concrete backends exist. A generic layer would hide transaction/RLS
semantics that must remain explicit and reviewed.

### Filter SQLx events with a scoped subscriber

Rejected on security. A poll-scoped subscriber is not a Drop-scoped security
boundary, does not cover pool background tasks, and interacts globally with
tracing dispatcher and log-fallback state. It cannot prove that PostgreSQL
notices or asynchronous pool errors remain inside the scope.

### Maintain a local SQLx fork

Rejected for this non-production slice on quality and security. A fork could
remove every emission site, but it would create a large, persistent upstream
audit and supply-chain surface. The exact-graph static-off proof is narrower
and reversible; production must choose a proven upstream control or a driver
with safe diagnostics rather than silently inheriting this compromise.

### Keep the `sqlx` facade and waive known unreachable sources

Rejected on security. In 0.9.0 the facade's non-optional core dependency
selects `migrate`, which selects the `testing` module and its two direct
`eprintln!` sites. Neither a testing-directory exemption nor a call-graph
waiver preserves the existing fail-closed source rule. Direct components
remove that known selection while leaving reactivation by another final
consumer explicitly testable.

### Infer certificate variants through serialized connection options

Rejected on security and quality. SQLx serializes file and inline material
under the same keys, its formatter can panic on caller fields, and serializing
inline private keys creates additional non-zeroized secret buffers. The
non-production proof instead avoids option serialization and TLS entirely.

## 18. Acceptance and stopping point

The design is satisfied only when the exact reviewed implementation proves:

1. canonical events append atomically and replay byte-identically;
2. concurrent writers cannot create two accepted successors;
3. forced RLS denies cross-organization access through every public path;
4. application privilege cannot mutate evidence or access tombstones;
5. queries and exports are cursor-bounded and need-to-know;
6. retention is equal to the mission fact and bounded by `P6Y`;
7. deletion writes a content-free `P35D` tombstone atomically;
8. restore applies tombstones before records and proves non-resurrection;
   the deletion registry is independently protected, authenticated by a
   future caller and locally verified complete/fresh through the writer fence;
9. every store is Unix-domain socket only, forces TLS disabled, sanitizes
   secret-capable option fields without formatting them, and the exact graph
   contains no TLS implementation;
10. the exact selected debug, release and dev `tracing/log-always` dependency
   graphs use only the pinned direct SQLx components and allowed features,
   refuse facade or feature reactivation by any final consumer, compile all
   logging-facade emissions out, expose no direct bypass and evaluate no
   sensitive formatter;
11. public diagnostics contain only closed codes, while the global static-off
    effect remains an explicit production blocker;
12. the pure crate API/capability and locked Contracts authority remain
    unchanged;
13. no service, effect, worker or framework capability has entered scope;
14. absent target-side provider attestation for the exact production roles,
    identities, memberships, grants and required extensions remains an
    explicit production blocker;
15. all repository, coverage, dependency and real-PostgreSQL gates are green.

After all verdicts accept implementation commit `I` and its mechanically
restricted direct evidence child `E` is green, work stops before merge for the
owner's ADR-0011 D4 pronouncement naming both. The next packages — native incremental
checkpointing, Biscuit authorization, runtime service/connection construction,
Harness execution safety, zero-PII operational diagnostics and deployment —
remain separately closed. LangGraph continues to serve only as a removable
oracle of questions and failure scenarios.
