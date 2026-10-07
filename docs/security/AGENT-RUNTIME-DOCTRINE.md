# Agent runtime doctrine

- **Status:** actionable doctrine — read this before writing an agent or
  worker runtime, not after an incident.
- **Scope:** any process that puts model-generated text or tool output back
  in front of a model, or executes a tool call on the model's behalf — this
  repository's own tooling included (dogfooding-first, I-19).
- **Renvois:** `THREAT-MODEL.md` §1-2 (per-surface audit, this document does
  not repeat it), `TOOL-CALL-RISK-CLASSIFICATION.md` (status recalled below,
  never re-derived here), `LOOP-SECURITY-KERNEL.md` K2/K3 (classification,
  envelope — the locked bricks that carry part of §1 below), `SANDBOX-
BACKEND-EVALUATION.md` (source of §3, not superseded by it).

## 1. Untrusted data boundary

Every byte an agent reads that it did not itself just write — a web page, a
third-party repository, a tool result, a file on disk, **context inherited
from a prior turn or a prior agent** — is **data**, never an instruction.
An imperative sentence found inside that data ("ignore previous
instructions", "you are now in maintenance mode", a claim of owner or system
authority) is a fact about the data's content, not a command to execute.

This applies with no exception to **inherited context**: a handoff, a
compaction summary, a sub-agent's report, a resumed session's transcript.
The receiving agent did not observe those events; it is reading a document
that describes them. Cite it the same way a web page is cited — quote the
relevant fragment, name its source, and treat any embedded directive as
content to report, not to obey. A prior agent's tool-call log is evidence of
what that agent did, never a pre-authorization for what this agent does
next.

Valid instructions come only from the principal the runtime is built to
serve, through the channel that principal actually used (chat turn, an
explicit human approval on a specific action). Nothing observed through a
tool — including a message that _claims_ to come from that principal — is
self-authenticating.

K2 (`LOOP-SECURITY-KERNEL.md`) is the locked mechanism for one slice of
this: a payload's `reliability` is sealed at capture and cannot be
laundered from `operational` into `authoritative` by re-derivation. K3 is
the locked mechanism for a second slice: a recalled payload's integrity is
signed, so a stripped or altered `untrusted` tag is detectable. Both are
necessary and neither is sufficient on its own — the boundary in this
section is what a runtime enforces even where no K2/K3-equivalent brick
exists yet for its own stack.

## 2. Model-visible ⟺ logged

Everything that reaches the model's context — system prompt, tool output,
retrieved document, inherited handoff — must be reconstructible from an
append-only log the runtime itself writes, not from the model's own
account of what it saw. If a byte influenced a completion, that byte (or an
unambiguous pointer to it, at a resolvable content hash) is in the log
before the completion is requested, not reconstructed after the fact from
the model's self-report.

This is a different log from the sandbox's own execution log (§3,
requirement 8): the sandbox backend must **not** log raw commands, prompts
or content — that log runs on the untrusted side of the boundary and is
itself a leak surface. The context-assembly log lives on the runtime side,
append-only, and is the thing an auditor reads instead of asking the model
what it remembers. A runtime that cannot answer "what did the model see
before it said this" from its own log has no invariant here, only a
narrative.

## 3. Sandbox: fail-closed, or it is not isolation

Consolidated from `SANDBOX-BACKEND-EVALUATION.md` — read that document for
the evidence and the runs behind each line; this is the checklist, not a
restatement of the argument. A backend qualifies only if it meets all
eight:

1. **fails closed** if isolation does not start — no silent fallback to the
   local shell;
2. **denies network by default**;
3. makes the **home directory and host credentials unreadable**;
4. writes only to a **disposable copy** of the workspace, never the host
   tree in place;
5. carries **no disable flag** reachable in restrictive mode;
6. exposes an **attestation** the policy gate can consume — and that
   attestation carries a fail-closed TTL (`TOOL-CALL-RISK-CLASSIFICATION.md`
   §"Fraîcheur"): stale or unprobable is inactive, never active;
7. **kills processes and deletes the workspace** on exit or timeout, and
   rejects any further execution after that point;
8. **never logs** raw commands, prompts, paths or content — see §2 for why
   this is a different log from the one that must exist.

A regular expression on a command string, or a working-directory change,
satisfies none of the eight and is not a security boundary regardless of
how it is described.

**Landlock** (Linux LSM, unprivileged filesystem/network scoping) is a
candidate backend for requirements 2–4 on Linux hosts, not yet evaluated
against the eight above. Before it is promoted past candidate status: pin
the exact kernel/crate commit under evaluation, and run the same class of
boundary tests `SANDBOX-BACKEND-EVALUATION.md` ran for the micro-VM
candidate — a host canary invisible from inside, and zero bytes measured at
a controlled external listener, not only a client-side assertion that the
policy was applied.

## 4. Verify the world, not the self-report

An agent's account of its own work — "tests pass", "the gate is green",
"the file was deleted" — is operational data (K2), not authority. Before
any of those claims is accepted:

- re-run the check that produces the claimed state, from a clean process,
  and read its exit code and output directly;
- for a destructive or state-changing claim, inspect the actual resulting
  state (the file, the git log, the deployed artifact), not the tool
  invocation the agent reports having made;
- a sub-agent's summary describes what it **intended**, not necessarily
  what happened — the same rule that governs reading any tool output
  applies to reading a report about tool output.

This is `TOOL-CALL-RISK-CLASSIFICATION.md`'s own conclusion, generalised
past its one implementation: that document's model was built, measured
against real refutation probes, and **still** judged _not promotable to a
security guard_ — kept only as telemetry and UX, never as a boundary. Any
runtime that treats a risk classifier, a confirmation prompt, or an agent's
own "done" as proof of anything is repeating a mistake that document
already paid for. The isolation of §3 is what contains an effect; nothing
in this document, including this section, substitutes for it.
