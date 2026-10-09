# Adoption proof (positioning L3)

The doctrine publishes evidence by default (invariant I-20), but publishing is
not appropriability: until now nothing PROVED that a third party without
private assistance can take the public repository, build it, and verify it
green. This directory makes that proof executable and published. Two
independent components feed `distribution/evidence/adoption/`.

## Component 1 — blank-room reproduction loop

`reproduce.ts` re-enacts an unassisted adopter, end to end:

1. fresh temporary directory, **credential-free environment** — deny-by-default
   whitelist documented in `cleanroom.ts`: `PATH` (public toolchain lookup), a
   blank temporary `HOME` (drops `.netrc`, `.gitconfig` credential helpers,
   caches), and explicit public-toolchain homes (`CARGO_HOME`, `RUSTUP_HOME`,
   `PLAYWRIGHT_BROWSERS_PATH`); every token, key and ambient identity is
   removed, and `GIT_TERMINAL_PROMPT=0` turns any authentication attempt into
   a loud failure;
2. anonymous `git clone --depth 1 https://github.com/libre-ai/project-governance`
   (shallow: the loop proves the published HEAD, no chain step needs history,
   and the cloned sha is recorded);
3. `bun install --frozen-lockfile` — the committed lockfile must suffice;
4. the existing reference chain, exactly as its evidence documents it
   (`bun verification/harness/reference-chain.ts`), with the obtained digest
   compared to the one published in
   `verification/harness/wp-g2-q01-reference-chain-evidence.md`.

Until 2026-08-19 this cloned `libre-ai/libre-ai` (the pre-γ hub) and ran a
fifth step, `bun tools/quality/check-policy-core-vectors.ts`. Migration γ
(ADR-0020) froze that hub read-only and moved `verification/harness/` and
`verification/adoption/` to this repository — the loop was still cloning the
frozen hub, so both paths came back "Module not found" for three consecutive
weekly runs (2026-08-05, -12, -19). REPOSITORY_URL now points at
`libre-ai/project-governance`, the repository that actually carries the chain; the
fifth step is retired, not re-pointed — `check-policy-core-vectors.ts` was
deliberately removed from this repository at its 2026-07-29 bootstrap ("belongs
to the contracts authority"), and its successor `tools/quality/
check-contracts.ts` is gated by `libre-ai/schemas-and-contracts`' own CI. Detail and
citations: the module doc in `reproduce.ts`.

Output: `distribution/evidence/adoption/YYYY-MM-DD-<short-sha>.json` (strict
schema in `attestation.ts`), the same rendered as Markdown, and a regenerated
`latest.json`. The **friction log** inside the attestation is the most
important product: the objective readability backlog (implicit prerequisites,
undocumented steps, ambiguous outputs), recorded even when the run passes.

Run it locally from the repository root:

```console
bun verification/adoption/reproduce.ts
```

Prerequisites (public toolchains, by design): git and Bun >= 1.4. The loop
also passes through `CARGO_HOME`/`RUSTUP_HOME`/`PLAYWRIGHT_BROWSERS_PATH` when
present (`cleanroom.ts`), opportunistically, for a future chain step that
needs them — governance's current reference chain spawns neither `cargo` nor
a browser engine.

## Component 2 — heterogeneous cold reader

`cold-reader/` decorrelates the reviewers: the agents that build this
repository share a provider and a context window, so their reading of the
public surfaces cannot count as independent adoption evidence. The runner
submits ONLY the public surfaces (organization profile README of
`libre-ai/.github` and README of `libre-ai/project-governance`, fetched raw
and anonymously on the branch each repository serves — the raw `HEAD`
segment, never a written branch name; `publicRawUrl` in
`cold-reader/cold-reader.ts`) to a model with zero project context,
one request per question, and grades the answers against the versioned grid
`cold-reader/questionnaire.json` (scoring rule and strict parsing in
`cold-reader/grading.ts`; every expected element cites, on `HEAD`, one of the
surfaces the reader is given).

**Target and grid version (owner arbitration, 2026-10-09).** The second
surface used to be the README of the hub `libre-ai/libre-ai`, archived
read-only on 2026-07-30. It now is the README of `project-governance`. The
grid moved with it, to `libre-ai.cold-reader-questionnaire.v2`: measured on
2026-10-09 against the surfaces as they then read, 8 of the 13 v1 elements
were matched by none of their own patterns in the source they cited (the
profile README had changed too), so all 13 were re-sourced on what the two
READMEs state. **A v1 score is not comparable with a v2 score**; the verdict
records the grid version it was graded under, and the parser refuses a v1
grid. Two tests keep the target honest (`cold-reader/cold-reader.test.ts`):
no surface may point at a repository that `ecosystem/repositories.v1.yaml`
does not declare `active` (read from the inventory, not written in the
test), and every grid source must be one of the surfaces the reader is
given.

The backend is pluggable through environment variables — no provider is
hardcoded, so the reviewer can be a self-hosted EU endpoint (sovereignty) and
SHOULD be a different provider than the one building the repository
(heterogeneity):

| Variable               | Role                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `COLD_READER_CMD`      | local command: prompt on stdin, answer on stdout (wins)     |
| `COLD_READER_BASE_URL` | OpenAI-chat-compatible endpoint base URL                    |
| `COLD_READER_MODEL`    | model name (required with `COLD_READER_BASE_URL`)           |
| `COLD_READER_API_KEY`  | optional bearer token (self-hosted endpoints may need none) |

Without any backend configured the runner writes an explicit
`status: "pending"` verdict to
`distribution/evidence/adoption/cold-reader-latest.json` and exits 0 — the
POLARIS.md IN-SERVICE vs PENDING honesty convention: no key is required for
the code to be green.

```console
bun verification/adoption/cold-reader/cold-reader.ts
```

## CI — `.github/workflows/adoption-proof.yml`

Weekly (`cron: 41 5 * * 3`) plus `workflow_dispatch`. The job runs the
reproduction loop on a GitHub runner (a blank environment by nature),
publishes the attestation as a run artifact (`adoption-attestation`) and in
the job summary. It is deliberately secret-free and never exports the default
`GITHUB_TOKEN` to the script: anonymous public access must be sufficient.

**How a CI attestation becomes a committed evidence file** — the workflow
does NOT push to `main` (branch protection; and an attestation that could
rewrite its own evidence trail would weaken it). Current path, manual by
design:

1. download the `adoption-attestation` artifact from the run;
2. place its `*.json`/`*.md` files under `distribution/evidence/adoption/`
   (overwrite `latest.json`);
3. open a pull request — the DCO sign-off and required checks apply, and the
   merge is the human acceptance of the evidence.

A future automated PR (forge-authored, still gated by the required checks)
can replace steps 1–3 once the merge-automation decision (POLARIS D4) lands;
the workflow already produces everything it would need.

## Attestation schema and tests

`attestation.ts` defines and strictly parses the machine schema
(`libre-ai.adoption-reproduction.v1`). The verdict is DERIVED from recorded
facts and re-derived at parse time, so a hand-edited verdict does not parse.
Non-trivial logic is covered by `bun test verification/adoption`:
`attestation.test.ts`, `cleanroom.test.ts`, `chain-report.test.ts`,
`cold-reader/grading.test.ts`.

Attestations are digest-anchored (through the reference chain), not
cryptographically signed: signing waits for the provenance brick (wave 2),
consistent with the P3 lineage deferral.
