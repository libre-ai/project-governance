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

## Disposition of each finding

Each finding also carries one disposition — blocking defect, required evidence, suggestion or ready — defined by `docs/adr/0056-method-origin-review-dispositions-live-install-refusals-negatives.md` D2, which is the only authority on them and is not restated here. Its re-review rule sets the starting point of the fresh pass required above and never replaces it. How dispositions combine with the severity scale and the verdicts above is also fixed by that ADR's D2, owner-arbitrated on 2026-10-23: it narrows which findings may be called a suggestion and which verdicts may stand while required evidence is open. Read it there; it is not restated here.

A pull request whose declared negative (ADR-0056 D5: it adds no dependency, schema or workflow) is contradicted by its own diff carries a finding of severity `blocking`.

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

## Reviewer isolation

A reviewer reads content that anyone able to open a pull request can write: the diff, the files of the reviewed tree, commit messages, the pull request title and description. That content is untrusted in the sense of I-32 (`docs/decisions/INVARIANTS.md`), and a review pass is held to I-32 like any other model call. The five rules below apply it to review; they were decided by the owner on 2026-11-23. This section is placed last so that the line citations other review dossiers make into this file stay valid.

1. **No effect tool.** The reviewer holds no tool with a `write`, `execute` or `network` effect in the sense of I-32, whatever adds it: built in, configured, or served by a plugin or tool server. A tool whose effect is not declared counts as an effect tool (`docs/security/TOOL-CALL-RISK-CLASSIFICATION.md`: the unknown is risky, not neutral). A tool server started for the reviewer is one of its tools and inherits no credential from the runner's environment. The reviewer's only tools read. They are bounded to the reviewed tree: a path is resolved, symbolic links included, before the bound is checked, and a path that resolves outside the tree is refused. They refuse secret paths (environment files, credential, key and token stores) in the tool itself, so a file excluded when the review set is selected cannot be read back by name.
2. **Structured output, publication by code.** The reviewer returns the verdict envelope of "Orchestration mechanics" and nothing else is its output. Comments, review status and every other write to the forge are made by deterministic code from the validated envelope; the model never holds the write credential and never chooses the action. The target pull request and commit come from the job, never from the envelope. An envelope that fails validation publishes nothing, and the pass fails.
3. **Prompt built in one pass.** The reviewed content enters the prompt inside an envelope whose delimiter is drawn for each review from a cryptographically secure random source, so the content cannot predict it; content that contains the drawn delimiter is refused. The prompt is assembled in a single pass over its template: each field is placed once, and text already inserted is never scanned again for fields. Successive replacement of fields is forbidden. Counter-example, read in the source of a review tool inspected on 2026-11-23 (`alibaba/open-code-review`) and not executed: its template fields are replaced one after another, so a diff that contains the name of a later field is itself substituted, and a file path that contains the field of the diffs receives them. A prompt builder is accepted with a test whose reviewed content contains every field name of the template and a forged closing delimiter, and whose prompt carries that content once, verbatim, inside the envelope. The instruction that enveloped content is data stays in the prompt; it is defence in depth and counts for none of these rules.
4. **Second judge, monotone, closed on failure.** A model placed in second, after the reviewer or after a deterministic gate, sees neither the reasoning of the agent it judges nor any tool result. Its answer is a closed value validated by schema. It can add a refusal (a refused call, a `reject` verdict), never lift one: a refusal already given stands whatever it answers. Its failure, and the failure of a scanner — timeout, error, unreadable answer — counts as a refusal, never as a pass. Counter-example: `huggingface/safeagents`, inspected on 2026-11-23, lets the call through by default when its judge or its scanner fails.
5. **A tool-call gate is defence in depth.** A gate at the level of the tool call (classification, argument policy, scanner) replaces neither rule 1 nor rule 2. If it judges a network destination, the provenance of that destination is decided by value: a destination is admitted only when its value comes from the job, the owner's instruction or the configuration, and a value that appears in untrusted content — the reviewed content, tool results and the model's own turns included — never makes it admitted. Counter-example: the same `safeagents` counts tool results as conversation, so a host quoted in a tool result becomes an admitted destination. Its log keeps only what I-33 allows, never raw arguments.

A pass that breaks rule 1, 2 or 3 is invalid, like a pass that edits the reviewed authority.
