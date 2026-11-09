# Review record — libre-ai/project-governance#159, round 4

- reviewPassId: pr159-round4-247bfda
- Role: independent adversarial reviewer, review-only (not the author)
- Mode: candidate-integration
- Reviewed commit: 247bfda745058083bf7d3025f37cae771812f009 (head of #159, resolved with `gh pr view 159 -R libre-ai/project-governance --json headRefOid`)
- Served branch: migrate/recover-code (`git ls-remote --symref origin HEAD`), at a5cd2b4680584fe040b290c79216dfa7da0e22a2
- Previous reviewed heads: 30e8ce1 (reject), f1fe73f (reject, F1 major), fd4a477 (approve-with-minor-reservations, S1–S4)
- Out of verdict: MAJOR-2 (surface drawn in unguarded code). The owner keeps the written limit, and the decision waits for ADR-0060.
- Harness: Claude Code subagent, model claude-opus-5-5; session identifier not exposed

## Scope

`git diff --stat a5cd2b4 247bfda`: 7 files, 1523 insertions, 11 deletions, all files of this pull request:
package.json, tools/quality/check-data-inventory.ts, tools/quality/check-data-inventory.test.ts,
tools/quality/check-data-inventory.process.test.ts, tools/quality/check-empty-allowances.ts,
tools/quality/check-review-evidence.ts, tools/quality/check-review-evidence.test.ts.

Merge 444fb06: `git diff --stat fd4a477 444fb06` and `git diff --stat 066ef49 a5cd2b4` both give
4 files, 449 insertions, 14 deletions, so the merge adds exactly the base changes. The commit carries a
`Signed-off-by` trailer. GitHub reports `{"verified":false,"reason":"unsigned"}` for 444fb06 and 247bfda.

## Measurements

- `bun run check:data-inventory`, exit 0:
  `Data-file inventory verified: 55 assertion(s) hold — 782 tracked file(s): 501 source or Markdown outside the universe, 281 data file(s) = 21 gated + 260 declared (6 awaiting owner arbitration: Cargo.toml, REUSE.toml, biome.json, crates/ecosystem-engine/Cargo.toml, package.json, tsconfig.json) + 0 undeclared; 55 declaration(s); 0 gated symbolic link(s)`
- Tests: check-data-inventory.test.ts 39 pass, 0 fail; check-data-inventory.process.test.ts 2 pass, 0 fail;
  check-review-evidence.test.ts 63 pass, 0 fail; check-review-evidence.process.test.ts 10 pass, 0 fail.
- CI (`gh pr checks 159`): 13 checks, all pass, on pull_request runs with head_sha 247bfda
  (runs 40305872173 ci, 40306003303 pr-door, 40305872131 Code validation checked by `gh api .../actions/runs/<id>`).
  Merge state: MERGEABLE / CLEAN.

## S1 — grep of limit 2

- The author's command (`tools/quality/check-data-inventory.ts:53`) replayed: 40 lines in 24 files.
- The 13 exclusions were read one by one. 4 name a data file (ALLOWLIST_PATH, EXEMPTIONS_PATH,
  isToolchainAllowList, EXEMPTIONS_SCHEMA). 8 parse a format or name a marker (exemptionLine, ALLOWED_PATTERN,
  EXEMPT_CLASS, EXEMPT_TRAILER, IGNORE_FLAG, EXEMPT_VALUE, ALLOWANCE_MARKER, LINE_EXEMPTION_MARKER).
  1 matches by accident (SHALLOW_REFUSAL). Classification holds. 27 remain, in 16 files.
- Second instrument: every top-level `const X = [ | new Set([ | new Map([` in non-test TypeScript under
  tools/, ecosystem/, distribution/, verification/, brand/ (171 lines), minus the author's 40, read by name.
  Top-level allowlists the command misses, because they are named by other stems:
  - tools/quality/check-pr-door.ts:147 IMPLICIT_TWO_WAY_AUTHORS (authors exempt from the Door declaration);
  - tools/quality/check-personal-data-boundary.ts:200 FIXTURE_BEARING_PATHS (files out of the identifier scan);
  - tools/quality/check-personal-data-boundary.ts:208-209 IDENTIFIER_OUT_OF_SCOPE_PREFIXES, _SUFFIXES;
  - tools/quality/check-js-licenses.ts:28 firstPartyLicences (licences accepted for first-party code);
  - tools/quality/public-source-scanner.ts:71 exactRfc2606ExampleDomains (domains the scanner admits).
- `.sh` (assignments with allow/exempt/ignore/skip/exclu/trust/permit/whitelist stems), `.rs` (const/static
  with the same stems), `.jq`: 0 allowlist bindings. Top-level Python literal collections: 17, none an allowlist.

## S2 — process test

- Mutant X2 (`entry.mode === "120755"` in the `main` filter): the new process test is the only failure.
  `(fail) a gated path tracked as a symbolic link > the gate run on an index where a gated file became a link exits 1 and names it`; 40 pass, 1 fail.
  Restored: 41 pass.
- Control is not vacuous:
  - V1, the control fed half the index bytes: fixture setup fails (`malformed index info`), red;
  - V1b, the control index without the `llms.txt` record: control red (stale declaration), 1 pass, 1 fail;
  - V2, an undeclared data file staged in the real checkout: both tests red, 0 pass, 2 fail;
  - V3, an unstaged file in the working tree: 2 pass. The gate reads the index by design (header of the gate).

## Mutants

| Mutant | Result |
| --- | --- |
| X2, symlink filter of `main` never matches | 40 pass, 1 fail: the process test |
| X1, stale extensions computed on `covered` (`fd4a477:tools/quality/check-data-inventory.ts:466`) | 41 pass, 0 fail: survives |

## Findings

| Id | Severity | Disposition (ADR-0056 D2) | Location | Finding |
| --- | --- | --- | --- | --- |
| R4-1 | minor | suggestion | tools/quality/check-data-inventory.ts:49-90 | Limit 2 lists "the allowlists", but its command finds only those named by its stems; at least 6 top-level allowlists in 4 files escape it (see S1). Add them, or state that the command finds the stem-named ones only. |
| R4-2 (S3) | non-blocking | suggestion | fd4a477:tools/quality/check-data-inventory.ts:466 | Mutant X1 survives: an extension held only by a gated file would stay declared. No such case on the tree today. |
| R4-3 | non-blocking | suggestion | commit 444fb06 | DCO sign-off only; GitHub reports it unsigned. Factual, no gate requires more. |
| S4 | non-blocking | suggestion | fd4a477:tools/quality/check-data-inventory.ts:264-268 | Unchanged from round 3: an extensionless dotfile under `toolchains/notices/` is covered; a symlinked parent directory of a gated path is caught as undeclared, not by the symlink rule. |

No blocking or major finding is open, and no required evidence is open.

## Verdict

approve-with-minor-reservations — MAJOR-2 excluded by owner decision. Without MAJOR-2, the pull request is approvable.
