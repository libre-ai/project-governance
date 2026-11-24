# Threat evidence ledger

- **Status:** ledger read by `tools/quality/check-threat-model-evidence.ts` (`bun run check:threat-model-evidence`); not part of `bun run check`
- **Scope:** the threat rows of [`THREAT-MODEL.md`](THREAT-MODEL.md), section "STRIDE + LINDDUN per surface", and ten agentic risks
- **Date:** 2026-11-17

## What this ledger is, and what the control does not prove

The threat model writes a control in prose next to every threat. This ledger
names, for each threat, the files and the named tests of that control, or says
`residual:` with the reason no evidence is named. The control checks one thing:
that what is named **exists** — a tracked, regular, non-empty file, and a test
of that name that a runner would run.

It does **not** prove that the evidence covers the threat, nor that the test is
green, nor that the control is deployed anywhere. Whether a piece of evidence is
the right one stays a review matter, as it does for the invariant cited in the
model. A `residual:` cell is not a mitigation: it is a threat whose control this
repository cannot show, written down instead of being papered over.

The citations gate declines to keep a threat table in data, because such a table
"would only restate the document a second time and drift with it". This ledger
restates one thing only, the text of the threat, and uses it as the join key;
the control, the residual risk and the invariant stay in the model and are not
copied here. And the drift is not silent: a threat reworded, added or removed in
the model without its row here is counted `unmapped`, a row whose threat is no
longer in the model is counted an `orphan`, and both fail the control.

## Grammar

- A threat id is `T-S<k>-<nn>`: `k` is the rank of the surface (the `###` title
  of the model section, in document order), `nn` a two-digit number. An id is
  unique and is never reassigned.
- The Threat cell is the first cell of the model row, character for character.
- An Evidence, Barrier or Detection cell is either `residual: <reason>`, or a
  comma-separated list of pieces of evidence. A piece of evidence is a target
  in a code span, optionally followed by `::` between spaces and a test name in
  a code span.
- A target is a path relative to the repository root, or a file of another
  repository pinned by its full commit id, in the pinned-citation form the
  decision records already use (owner, repository, 40 hexadecimal digits,
  path). A pinned target is read from a clone given on the command line and
  never from the network; when no clone is given it is `unavailable`, which is
  neither found nor missing.
- A named test is read in `.ts` files (`test("<name>"` or `it("<name>"`, outside
  comments, without `.skip`, `.todo`, `.skipIf`, `.if`, `.failing` or `.each`)
  and in `.rs` files (`fn <name>` under `#[test]`, under no attribute that
  mentions `ignore`, a conditional `cfg_attr` included).
- Criterion is `refusal before execution` or `detection or judgment`. The first
  is a claim the ledger must back with a named test among the barriers; a
  barrier whose refusal no recognised test names is recorded under the second,
  and so is a risk whose Barrier is `residual:`.
- A Detection cell is judged whatever the Barrier: beside a `residual:` barrier,
  a detection that is missing or outside the grammar still makes the risk red.
- A document is never a barrier: a `.md` target in a Barrier cell is refused.

No evidence below is pinned in another repository: no commit of another
repository was read for this first ledger, so every control held outside this
repository is `residual:` rather than supposed.

## Threat evidence

| ID | Threat | Evidence |
| --- | --- | --- |
| T-S1-01 | Injected script modifies local application state | `ecosystem/check-web-headers.ts`, `ecosystem/check-web-headers.test.ts` :: `a relaxed script-src is refused, by token` |
| T-S1-02 | Export JSON modified after generation | residual: the export digest and its verification at import live in the product repositories; this repository holds no file of that control and no commit of theirs was read for this ledger |
| T-S1-03 | Notebook blocks synced to remote without consent | residual: the export flag lives in the Notebook repository; the no-transmission scanner kept here covers other local-only apps, not Notebook |
| T-S2-01 | Browser session cookie stolen / fixed | residual: session rotation, cookie attributes and revocation live in the authentication repository; no commit of it was read for this ledger |
| T-S2-02 | SQL injection via mission command | `ecosystem/check-sql-construction.ts`, `ecosystem/check-sql-construction.test.ts` :: `an untagged template interpolating a variable into SQL is a finding` |
| T-S2-03 | Cross-tenant membership leak (e.g., invite list) | residual: the row-level-security policies and their tenant-boundary tests live in the product repositories; no commit of them was read for this ledger |
| T-S2-04 | LLM provider adapter receives full mission state | residual: token attenuation toward a provider adapter is issued by a runtime outside this repository; nothing here exercises it |
| T-S2-05 | Revocation bypass (cached Biscuit) | `crates/ecosystem-engine/tests/agent_run_authorization.rs` :: `root_block_revocation_and_store_outage_fail_closed` |
| T-S3-01 | Agent token reused across missions | `crates/ecosystem-engine/vendored/authz/agent-runs-v2.datalog`, `crates/ecosystem-engine/tests/agent_run_authorization.rs` :: `selected_biscuit_engine_matches_all_agent_run_v2_vectors` |
| T-S3-02 | Malicious tool output (e.g. fabricated source code) | `packages/classification/src/index.ts`, `packages/classification/src/classification.test.ts` :: `refuses operational data as authority for a source-of-truth write` |
| T-S3-03 | Agent writes to orchestrator lock (e.g., Authority facts) | `tools/quality/check-review-evidence.ts`, `tools/quality/check-review-evidence.test.ts` :: `a gated change with neither signal fails` |
| T-S4-01 | Relay derives epoch key from public metadata | residual: no relay or MLS code exists in this repository, and the red vectors the model requires before any MLS code are not written here |
| T-S4-02 | Member offline, returns with stale epoch; merges conflicting edits | residual: no relay or MLS code exists in this repository; the merge conflict itself is a risk the model records as accepted |
| T-S4-03 | Relay appends fake message to append-only log | residual: no relay or MLS code exists in this repository; sender-signature verification is specified, with no vector here |
| T-S5-01 | `@libre-ai/envelope` HMAC downgrade (old version consumed) | residual: the model records the replay test and the algorithm check as under construction; the package source lives in another repository and no commit of it was read for this ledger |
| T-S5-02 | Transitive dep (`jose`, `biscuit-auth`, `openssl`) has CVE | `tools/security/check-fleet-advisories.ts`, `tools/quality/check-audit-delta.ts`, `ecosystem/check-release-age.ts`, `ecosystem/check-release-age.test.ts` :: `an age below three days fails` |
| T-S6-01 | LLM prompt-injection via evidence text (see §2.1) | residual: isolation by construction is specified and enforced by no runtime; human supervision is the control in force, and it is not a file |
| T-S6-02 | Proof references a revoked authority (K2 deriving from operational) | `packages/classification/src/index.ts`, `packages/classification/src/classification.test.ts` :: `a JSON-deserialized authoritative object is refused at the authority gate` |

## Agentic risks

The ten risks are a list kept by this repository. A barrier is what stands
before the act; a detection is what reads it afterwards.

| ID | Risk | Barrier | Detection | Criterion |
| --- | --- | --- | --- | --- |
| AR-01 | goal hijacking | residual: isolation of untrusted content from a model holding an effectful tool is specified and enforced by no runtime; this repository holds no barrier | residual: no detection case is held by this repository | detection or judgment |
| AR-02 | tool misuse | `crates/ecosystem-engine/vendored/authz/agent-runs-v2.datalog`, `crates/ecosystem-engine/tests/agent_run_authorization.rs` :: `selected_biscuit_engine_matches_all_agent_run_v2_vectors` | residual: no tool-call audit is held by this repository | refusal before execution |
| AR-03 | identity and privilege abuse | `crates/ecosystem-engine/vendored/authz/authority-v2.datalog`, `crates/ecosystem-engine/tests/agent_run_authorization.rs` :: `root_key_rotation_and_registry_outage_fail_closed` | `crates/ecosystem-engine/tests/biscuit_policies.rs` :: `canonical_authority_template_contains_only_minimal_facts_and_expiry` | refusal before execution |
| AR-04 | supply chain | `ecosystem/check-release-age.ts`, `ecosystem/check-release-age.test.ts` :: `an age below three days fails`, `tools/quality/check-dependency-policy.ts` | `tools/security/check-fleet-advisories.ts`, `tools/quality/check-audit-delta.ts` | detection or judgment |
| AR-05 | unexpected code execution | `.github/composition/prepare-composition.py`, `ecosystem/check-action-pins.ts` | `ecosystem/check-action-pins.test.ts` :: `an unpinned reference fails with its line` | detection or judgment |
| AR-06 | memory poisoning | `packages/classification/src/index.ts`, `packages/classification/src/classification.test.ts` :: `refuses operational data as authority for a source-of-truth write` | `packages/classification/src/classification.test.ts` :: `operational taints the derivation: any operational source makes it operational` | refusal before execution |
| AR-07 | inter-agent communication | residual: no inter-agent channel or relay code exists in this repository | residual: no detection case is held by this repository | detection or judgment |
| AR-08 | cascading failures | residual: a circuit breaker or an error budget is a runtime behaviour; this repository holds none | `tools/security/repeat-failure-alert.ts`, `tools/security/repeat-failure-alert.test.ts` :: `alerts when the previous run also failed` | detection or judgment |
| AR-09 | human-agent trust exploitation | `tools/quality/check-review-evidence.ts`, `tools/quality/check-review-evidence.test.ts` :: `a gated change with neither signal fails` | `tools/quality/check-pr-door.ts` | detection or judgment |
| AR-10 | rogue agents | `crates/ecosystem-engine/tests/agent_run_authorization.rs` :: `root_block_revocation_and_store_outage_fail_closed` | residual: no per-agent activity audit is held by this repository | refusal before execution |
