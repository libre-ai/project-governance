# Review record — libre-ai/project-governance#159, round 5 (delta)

- reviewPassId: pr159-round5-b74808b
- Role: independent adversarial reviewer, review-only (not the author)
- Mode: candidate-integration, delta from 9b8b31c
- Reviewed commit: b74808b724f486ed31f894a65f9a97e5f072012f (head of #159, resolved with `gh pr view 159 -R libre-ai/project-governance --json headRefOid`)
- Served branch: migrate/recover-code, at ac0d68e2ff18e97d83b9c5df7b38343c338bdb74
- Out of verdict: MAJOR-2, by owner decision (the written limit stays; the decision waits for ADR-0060)
- Harness: Claude Code subagent, model claude-opus-5-5; session identifier not exposed

## Scope

- `git diff --stat 9b8b31c b74808b`: 2 files, tools/quality/check-data-inventory.test.ts (+21) and skills/pr-body/SKILL.md (+55/-13).
- Merge b74808b adds only the base: `git diff --stat 11bf9f7 b74808b` and `git diff --stat a5cd2b4 ac0d68e` both give skills/pr-body/SKILL.md, 55 insertions, 13 deletions.
- b74808b carries a `Signed-off-by` trailer; GitHub reports `{"verified":false,"reason":"unsigned"}`.

## Measurements

- `bun run check:data-inventory`, exit 0:
  `Data-file inventory verified: 55 assertion(s) hold — 783 tracked file(s): 502 source or Markdown outside the universe, 281 data file(s) = 21 gated + 260 declared (6 awaiting owner arbitration: Cargo.toml, REUSE.toml, biome.json, crates/ecosystem-engine/Cargo.toml, package.json, tsconfig.json) + 0 undeclared; 55 declaration(s); 0 gated symbolic link(s)`
- Tests: check-data-inventory.test.ts 40 pass; check-data-inventory.process.test.ts 2 pass; check-review-evidence.test.ts 63 pass; check-review-evidence.process.test.ts 10 pass; 0 fail.
- CI (`gh pr checks 159`): 13 checks pass; 11 runs completed success with head_sha b74808b. Merge state: CLEAN.

## Mutants and probes

| Probe | Result |
| --- | --- |
| X1, `covered` for `coveredDeclared` in the stale-extension loop (tools/quality/check-data-inventory.ts:506) | 41 pass, 1 fail: `defects of the list > a declared extension that only a gated file of the directory carries is stale, and the gate fails`; restored 42 pass |
| Equivalent refactor of the same loop (set of extensions of covered non-gated files, `.has`) | 42 pass, 0 fail |
| X2, `main` symlink filter compares `"120755"` | 41 pass, 1 fail: the process test `… exits 1 and names it` |
| V1, control fed half the index bytes | fixture setup fails (`malformed index info`) |
| V1b, control index without the `llms.txt` record | control red, 1 pass, 1 fail |
| V2, undeclared data file staged in the checkout | 0 pass, 2 fail |
| V3, unstaged file in the working tree | 2 pass (the gate reads the index by design) |

## Findings

| Id | Severity | Disposition (ADR-0056 D2) | Location | Finding |
| --- | --- | --- | --- | --- |
| R4-2 (X1) | non-blocking | ready | tools/quality/check-data-inventory.test.ts:307-326 | Killed: the new test fails on X1 alone and stays green under an equivalent refactor. |
| R4-3 | non-blocking | suggestion | commits 444fb06, b74808b | DCO sign-off only; GitHub reports them unsigned. |
| S4 | non-blocking | suggestion | fd4a477:tools/quality/check-data-inventory.ts:264-268 | Unchanged from round 3. |

No blocking or major finding is open, and no required evidence is open.

## Verdict

approve-with-minor-reservations — MAJOR-2 excluded by owner decision. Without MAJOR-2, the pull request is approvable.
