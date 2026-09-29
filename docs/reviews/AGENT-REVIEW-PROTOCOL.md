# Role-separated agent review protocol — solo maintainer

Libre AI is maintained by one human owner with coding and review agents. For candidate engineering work, review independence means separation of **roles and review-only passes**. It does not require a second human, a different agent identity or a different session identifier.

## Independence rule

A review is valid when all of these conditions hold:

- it targets an immutable Git commit and every relevant contract/vector hash;
- it is a dedicated review-only pass with an explicit role or `candidate-integration` scope;
- the reviewed files are not modified during that pass;
- findings, residual risks and one explicit verdict are recorded after evidence is reproduced;
- a generic integration pass cannot satisfy a specialized catalog role;
- each specialized role receives its own pass and verdict.

The same agent and session **MAY** perform authoring and later review passes in a solo-maintainer workflow. Before reviewing, the authoring increment must be committed, the worktree must be clean, and the agent must switch explicitly to review-only mode. Agent/session inequality is not an independence criterion.

CI, generators and tests are evidence, not verdicts. A pass that edits the reviewed authority, combines several required roles into one verdict, or reviews a mutable/uncommitted target is invalid.

## Attributable review record

Each review record includes:

- a stable `reviewPassId` and the review role;
- review mode (`candidate-integration` or one specialized catalog role);
- reviewed Git commit SHA and every relevant contract/vector SHA-256;
- commands and independent recomputation evidence;
- blocking, major, minor and non-blocking findings, plus residual risks;
- exactly one verdict: `approve`, `approve-with-minor-reservations` or `reject`;
- agent/session/provider/model identifiers when the harness exposes them.

Identifiers are audit metadata; equality with authoring identifiers does not invalidate a role-separated pass. Any normative change after a verdict makes affected approval stale and requires a fresh pass.

## Candidate integration

A candidate branch may be merged when:

- the exact qualified toolchain and all repository gates pass;
- a dedicated `candidate-integration` review-only pass covers security, quality, performance, completeness and sovereignty/privacy on the final commit;
- the verdict explicitly states that it is not a role-specific promotion approval;
- the human owner explicitly instructs `continue` or accepts the merge control milestone.

Candidate integration leaves every authority in `pending-independent-agent-review`. It authorizes harness and contract remediation on `main`, not product implementation or release.

## Role-specific promotion review

Each role listed in `contracts/catalog.v1.json` produces a separate review-only verdict. One role pass cannot satisfy another role. Open blocking/major findings, a conditional verdict, missing hashes or stale evidence keep the candidate pending.

Promotion from `candidate` to `locked` requires all catalog roles, green quality gates and a separate promotion/integration pass that verifies the collected records.

## Orchestration mechanics

Validity rules above say nothing about throughput; this section fixes the execution defaults so fan-out waves stay fast and deduplicated (2026-07-21 usage audit: a 25-pass wave ran sequentially over ~12 h where parallel batches would have taken ~1 h, with 12–18 % redundant re-runs and free-text verdicts that resisted aggregation).

- **One job per (commit, role).** The orchestrator (`tools/review/fanout.ts`) launches jobs in parallel batches (default concurrency 5), never sequentially by habit.
- **Deduplication.** A (commit, role) pair with a recorded verdict is not re-launched. Re-running requires an explicit force, and the existing record is never overwritten — it is an immutable audit record; archive it first.
- **Isolation.** Each pass reviews a detached worktree at the target commit. The runner invalidates the pass if the worktree is dirty afterwards, mechanically enforcing the "reviewed files are not modified" rule.
- **Machine-readable verdict.** Each pass ends with exactly one JSON verdict envelope (shape and validation: `tools/review/fanout-core.ts`, `review-verdict.v0.1`) echoing the runner-assigned `reviewPassId`; role, mode and commit are cross-checked against the job to reject mixups. Free-text reports may accompany the envelope; the envelope is the record of note. The shape is promoted to `contracts/` when a second producer emits it.
- **Shared evidence digest.** Reference material is read once from the target commit (with content hashes) and inlined into every prompt, instead of each agent re-reading the repository.

## Human control milestone

The repository owner remains the control authority and explicitly records `accept`, `continue`, `hold` or `reject`. Human control is required before:

- changing a catalog entry from `candidate` to `locked`;
- starting a product-engine implementation against that authority;
- enabling public scoring or personal/tenant data processing;
- adding network, provider, persistence, secret or approval capabilities;
- production or infrastructure deployment.

The human milestone accepts or rejects evidence; it does not replace a missing specialized role verdict.

## Audit trail

GitHub PR comments/issues may hold candidate-integration evidence. Promotion evidence must be durable in the repository review dossier or referenced by immutable URL and content hash. Historical reject verdicts remain immutable audit records. No implementation, CI job or generator may silently change review state.
