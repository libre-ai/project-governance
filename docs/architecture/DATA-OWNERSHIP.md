# Data ownership

Normative lifecycle: [`docs/specifications/DATA-LIFECYCLE.md`](../specifications/DATA-LIFECYCLE.md). Machine retention authority: [`contracts/data/retention.v1.json`](../../contracts/data/retention.v1.json).

| Data | Owner | Authority |
| --- | --- | --- |
| Knowledge Objects and public corpus | ecosystem | reviewed canonical Git source |
| Practices learner progress | Practices user | local IndexedDB only |
| Notebook blocks/context/backups | Notebook user | local IndexedDB and user-held encrypted files only |
| Boussole responses/results | Boussole user | local IndexedDB only |
| Product tenant records | owning app | isolated PostgreSQL schema + migrations + RLS |
| Browser session | auth-web | keyed-digest server session record; Redis cache is non-authoritative |
| Authorization policy | authz-biscuit + resource owner | versioned Datalog policy contracts |
| Cache, lease and presence | owning app | expiring Redis; never authoritative |
| Blobs and exports | owning app | content-addressed Cellar object with explicit expiry |
| Evidence | Proof | immutable Evidence Report and artifact reference |
| Releases | Artifact | content-addressed release manifest and registry |
| Retention/deletion proof | owning app + Proof | machine policy and deletion/evidence receipt |

Every private server row has a mandatory opaque tenant. Cross-product database tables and cross-tenant product queries are forbidden. Sharing occurs through cataloged versioned contracts and digests, never direct table access. `public` is a service tenant only and is rejected by private product schemas.
