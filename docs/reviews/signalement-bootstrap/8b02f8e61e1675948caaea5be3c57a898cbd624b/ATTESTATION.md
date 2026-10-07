# Signalement private publication candidate

Status: private candidate verified on 2026-09-15; awaiting Governance merge before
public exposure. This document does not attest public availability.

## Candidate and authorization

The owner requested publication, selected historical sanitization in an isolated copy,
then authorized one bounded private fast-forward with Actions stopped and branch guards
restored immediately. The original checkout is preserved.

- Candidate: `8b02f8e61e1675948caaea5be3c57a898cbd624b`.
- Historical sanitized base: `480b71141e4495547ddf1a38ff903be74aeca05f`.
- Original preserved revision: `a49a9683b0e805fae0f11f2bea4534ce1f57b47e`.
- RFC 8785 canonical manifest: `evidence/manifest.jcs.json` (no terminal newline).
- JCS SHA-256: `492f8d648354c7af217a2eb8d673b952e4e5b9c321462085db3a22dd306f0d79`.
- Native verifier serialization: `evidence/manifest.json` (one terminal newline).
- Native verifier SHA-256, excluding that newline: `b63c266142ffba8955ee4206a14d0212273f74827c2e6bde5ff95c7667e27c7e`.
- Exact admitted ref: `refs/heads/main` at the candidate.
- Reachable objects: 19 commits, 120 blobs, 224 objects, 717 tree entries.

The original 18 commits retain their messages, contributor metadata, ordering and parent
relationships. Two synthetic expressions in three historical test blobs use the same
character construction already present in the current source. Their evaluated strings
are unchanged. The sanitized base tree is byte-identical to the original final tree.
One subsequent commit fixes the CI checkout integration and removes a license text unused
by the current tree; no existing source file changes license.

## Local evidence

The full product gate completed with exit status 0: 282 tests, 562 assertions and no
failure. The complete post-commit history scan and canonical manifest generation completed
with exit status 0 and no findings. REUSE reported no missing or unused licenses and
complete attribution. Bun revision: `1.4.0-canary.1+57f349f63`; Git: `2.55.0`.
All 19 commits separately passed author-matching DCO trailer verification; this closes
the workflow-dispatch event's absence of a pushed-commit DCO range.

The suite includes real temporary Git repositories exercising rejected historical data,
metadata, unexpected refs, unsafe tree entries, malformed objects, resource limits,
private/public access policy, exact Git/API ref comparison and manifest determinism.
The checkout integration adds 12 cases and 133 assertions. They reproduce the original
scanner rejection, accept the exact duplicate checkout ref after preparation, and reject
unexpected or divergent refs without mutation. The scanner policy is unchanged.

The independent review found that the product's native deterministic serialization is
not JCS: two top-level keys are in the wrong order. The native bytes and digest remain
retained for the existing verifier, while `CANONICALIZATION.md` supplies the independent
canonicalization recipe and the byte-exact JCS artifact required by ADR-0038. Both decode
to exactly the same complete manifest. A successful native mirror equality is necessary;
the independently verified JCS equality is also required before exposure. This is not a
claim that the product serializer itself conforms to RFC 8785.

## Independent reviews

Two separate reviewer contexts inspected immutable inputs in the same OpenAI Codex
session. These are role-separated reviews, not model-diversity or provider-qualification
evidence; the exact runtime model identifier was not exposed to the reviewers.

The historical review compared every original/mapped commit and independently confirmed
metadata, topology, evaluated-expression and final-tree equality. The second review
examined the final five-file delta at the candidate SHA, reran all 12 integration tests,
and reported no critical or important issue. It confirmed the compare-and-swap ref
transaction, unchanged scanner, and accurate license boundary.

Reviewed artifact SHA-256 values:

- Checkout helper: `85778a4a9383330c11d576682f5ff7a84927c093cc095d86172d59cf52437265`.
- Integration tests: `6b7dcea746a82b33723b9e4e030b79613c377ed23c55592568607cb4ccc0af7f`.
- Workflow: `c8ba1b2dade96edc094b837ac4001d96b09f6e0bf011f472ff97efcf0a5b8c47`.

## Product and protocol limits

This publishes a specification and its security tooling, not an installable extension,
API, connector or execution service. The bootstrap workflow intentionally admits only
the exact main checkout; ordinary pull-request development requires an explicit successor
workflow. No blocking coverage threshold exists in this foundation; test success is not
a claim that every broader product quality requirement is already delivered.

GitHub private vulnerability reporting is available only for public repositories.
Signalement's issue tracker stays disabled through the visibility transition until that
reporting control is activated and read back. The already-active fleet reporting channel
in Governance is the security destination named by the candidate documentation.

## Final transition

The exact-head private mirror attestation completed with exit status 0 and reproduced
the canonical manifest and complete product gate from a fresh non-shallow checkout.
Git advertisement and provider API agreed on the sole admitted ref and exact candidate.
The verifier's private access policy supplies GitHub authentication solely for the
private clone; its public profile strips credential-bearing environment variables.

Linux CI run [34939340384](https://github.com/libre-ai/signalement/actions/runs/34939340384)
passed both quality and licensing jobs at the exact candidate. The normalized result
is retained in `evidence/ci.json`; provider controls are in `evidence/provider-policy.json`.
Main requires both actual GitHub Actions check names and pull requests, including for
administrators. Force pushes and deletion are disabled. Secret scanning and push
protection are enabled. Actions admit only the three exact pinned dependencies and
use read-only tokens without review approval rights.

After the green run, Actions were disabled and main locked read-only. The provider
inventory showed one owner collaborator, no teams, deploy keys or webhooks. The owner
retains administrative configuration authority; it is not represented as revocable by
these branch controls.

This record must be reviewed and merged in Governance under ADR-0038 before public
visibility. The frozen private mirror proof is repeated immediately before exposure.
Anonymous verification follows exposure and is not substituted for the pre-disclosure
proof. Any different ref, object, head or manifest invalidates this candidate.
