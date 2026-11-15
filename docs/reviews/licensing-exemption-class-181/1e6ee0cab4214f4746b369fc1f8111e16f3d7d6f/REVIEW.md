# Review record — libre-ai/project-governance#181, round 1

- reviewPassId: pr181-round1-1e6ee0c
- Role: independent adversarial reviewer, review-only (not the author)
- Mode: candidate-integration
- Reviewed commit: `1e6ee0cab4214f4746b369fc1f8111e16f3d7d6f` (`gh pr view 181 --json headRefOid`)
- Base / merge-base: `d2999cb0dc00c0f740b2fc521f4eef05c659d13b`
- Served branch: `migrate/recover-code` at `d2999cb0dc00c0f740b2fc521f4eef05c659d13b` (`git ls-remote --symref … HEAD`); the PR is one commit on top of the served head
- Harness: Claude Code subagent launched without the authoring session's history, model claude-opus-5-5; session identifier not exposed
- Toolchain: local Bun 1.4.4 (CI pins 1.4.0)

## Scope

`git diff --stat d2999cb..1e6ee0c`:

```
 docs/specifications/WORK-PACKAGES.md      |   1 +
 ecosystem/work-package-policy.v1.yaml     |  14 +++
 tools/quality/licensing-class.test.ts     | 185 ++++++++++++++++++++++++++++++
 tools/quality/work-package-policy.test.ts |   8 ++
 4 files changed, 208 insertions(+)
```

Gate code unchanged. The `Not-added: dependency, schema, workflow` declaration is consistent with the diff.

## Measurements

| Command | Output (verbatim counters) |
| --- | --- |
| `bun test` licensing-class, work-package-policy, fleet-bump-class, check-work-package-link @head | `645 pass / 1 fail / Ran 646 tests across 4 files`; only failure `premise: Bun.YAML.parse silently truncates at a NUL ending a value line` |
| Same three pre-existing files @base | `626 pass / 1 fail / Ran 627 tests across 3 files`, same failure |
| `bun test` licensing-class + work-package-policy @head | `116 pass / 1 fail / Ran 117 tests across 2 files` |
| Neutralisation: class key renamed `licensing-neutralised` | `108 pass / 9 fail` |
| Mutant A: `LICENSES/*.txt` → `LICENSES/**/*.txt` | `115 pass / 2 fail` (only the literal copy test and the NUL premise) |
| Mutant B: `LICENSES/*.txt` → `LICENSES/**` | `114 pass / 3 fail` (killed by `refuses a licence text that is not .txt`) |
| Mutant C: `LICENSE` → `LICENSE*` | `114 pass / 3 fail` (killed by `refuses a file that merely starts like a surface`) |
| Mutant D: `LICENSE` → `**/LICENSE` | `113 pass / 4 fail` (killed by `refuses a nested LICENSE`, `admits no nested variant`) |
| Mutant E: `REUSE.toml` → `{REUSE.toml,.reuse/dep5}` | `115 pass / 2 fail` (only the literal copy and the NUL premise) |
| Full `bun test` @head | `4782 pass / 9 fail / Ran 4791 tests across 115 files` |
| Full `bun test` @base | `4763 pass / 9 fail / Ran 4772 tests across 114 files`; the 9 failures are the same names (shell/Python manifest derivations, langgraph advisory floor, NUL premise); head = base + 19 |
| `bun run typecheck` / `bun run lint` @head | rc=0 / rc=0, `Found 1 warning` (also 1 on base) |
| `bun run check:data-inventory` @head | `… 6 awaiting owner arbitration: Cargo.toml, REUSE.toml, biome.json, crates/ecosystem-engine/Cargo.toml, package.json, tsconfig.json …` |
| `gh pr checks 181` | 14 pass, 2 fail: `Bun quality` (ci) and `Index freshness and GitHub reconciliation` |
| `gh run view 43707336875 --job 132791143902 --log-failed` | `Review evidence: ecosystem/work-package-policy.v1.yaml: neither the pull request description nor a line the pull request adds to the gated files references an existing docs/reviews/** artefact or carries an 'Owner-arbitration: YYYY-MM-DD' marker …` |

Claims of the description: replayed and matching for 645/1, 626/1, neutralisation 108/9 against 116/1, lint warning count and typecheck. The full suite gives 4782/9 here against the stated 4781/10 (the description attributes its extra failure to a 5 s timeout); same failure set as base. The libre-ai/pelote `reuse lint` 45/45 measurement is in another repository: not replayed. One red check is `Bun quality`, failing on review evidence for `ecosystem/work-package-policy.v1.yaml`, a guarded path (`tools/quality/check-review-evidence.ts:146`); that one is tied to this diff.

## Findings

| Id | Severity | Disposition (ADR-0056 D2) | Location |
| --- | --- | --- | --- |
| F1 | major | required evidence | `ecosystem/work-package-policy.v1.yaml:60-64`; `docs/specifications/WORK-PACKAGES.md:134-135,176`; `tools/quality/check-declared-licenses.ts:1-18`; `.github/workflows/reusable-licensing.yml`; `tools/quality/check-data-inventory.ts:154-157`; `docs/decisions/INVARIANTS.md:17` |
| F2 | minor | suggestion | `docs/specifications/WORK-PACKAGES.md:133-134`; `tools/quality/check-work-package-link.ts:229-246`; `tools/quality/check-declared-licenses.ts:231-235` |
| F3 | minor | suggestion | `tools/quality/licensing-class.test.ts:131-153,168-177`; `tools/quality/work-package-policy.test.ts:22-26` |
| F4 | non-blocking | suggestion | PR CI, `Bun quality` job |

**F1 — The class lets any author relicense a whole repository without an owner gate, and its limits do not say so.** A `REUSE.toml` `override` annotation can relicense every file, third-party annotations included, with no work package and no owner `ready`, even under `Door: one-way` (`WORK-PACKAGES.md:135`). The stated mitigation (« the licensing gate still runs ») covers only `reuse lint` (one unambiguous licence per file) and manifest-against-REUSE consistency; no fleet gate compares the chosen licence with I-11 (EUPL / Apache-2.0 / CC BY): `grep -n "MIT\|allowed" check-declared-licenses.ts` hits only header prose (lines 8, 15). This repository lists `REUSE.toml` as a gate-loosening file whose guarding is « awaiting owner arbitration » (`check-data-inventory.ts:154-157`), and the cargo-deny licence policy `deny.toml` is already guarded (`check-review-evidence.ts:149-150`); the class moves `REUSE.toml` in the opposite direction from that pending decision. The structured question quoted in the PR body did not put these residuals before the owner. Precedents (context, not excuse): `docs-only` already covers `LICENSING.md`, and `fleet-bump` covers `package.json`, also « awaiting ». Lifted by either an `Owner-arbitration:` decision that accepts these residuals written into the norm's limits, or an allowed-licence check (I-11 set plus a declared `LicenseRef-*` allowlist) in `reusable-licensing.yml` before the class ships.

**F2 — The norm overstates where SPDX headers can go next.** « they follow in a `docs-only` or `fleet-bump` pull request » tells authors to declare `fleet-bump`, defined as « moves governance pins and nothing else » (`:133`), for a non-bump change. It holds only for pelote's file set: SPDX headers in `*.ts`/`*.rs` or nested files, and `Cargo.toml` licence fields, fit neither class. Unstated limit: one declaration per range (`check-work-package-link.ts:234-242`); in a repository with a publishable manifest, a `REUSE.toml` switch without `package.json` turns the declared-licence check red, and adding the manifest leaves `licensing`, so the class is usable alone only where no manifest is publishable (inferred from code, not run on a fixture repository). Fix: reword to « in libre-ai/pelote the headers sat in Markdown, workflows and `package.json`; elsewhere they need a work package », state the publishable-manifest limit, drop the `fleet-bump` advice.

**F3 — Some refusal tests do not show why they refuse.** The 12 refusal cases assert only `outcome === "violations"`; they stay green with the class removed (« class not listed » also refuses), so they do not distinguish a glob refusal from an unlisted class or a guarded-path refusal. Mutants A and E survive every behavioural test and are killed only by the literal copy `SHIPPED_LICENSING`, which pins data, not behaviour. Mutant A admits `LICENSES/sub/x.txt`, against the norm's « directly under `LICENSES/` »; the `deep/dir/` probe never nests inside `LICENSES/`. Fix: assert the violation names the path as outside the class globs (not « not listed »), and add a `LICENSES/sub/MIT.txt` refusal case.

**F4 — Review-evidence check red.** `check-review-evidence` is red because the PR carries no `docs/reviews/**` reference and no `Owner-arbitration:` marker for the guarded policy file. Expected before review; cleared by a committed review record or an owner marker, not by code.

Open: one major finding (F1), one required-evidence item (F1).

## Residual risks

- Like every `paths` class, it proves where a change landed, not what it wrote: any content in `LICENSE` or `LICENSES/*.txt` passes (stated in the PR). The root-`LICENSE` content gate of ADR-0061 D3 (`check-root-license`) is not implemented (`git grep 0061 -- .github tools`: no implementation hit), so `LICENSE` can be emptied or rewritten unnoticed. Whether `reuse lint` reads the root `LICENSE` at all is inferred, not measured.
- An exempt pull request that also changes a guarded path is refused (`WORK-PACKAGES.md:176`); not re-measured for this class, covered by existing gate tests.
- The effect per consumer depends on a generation bump; no consumer pins one yet (stated, not measured).

## Verdict

**reject.** Under ADR-0056 D2 the open major finding F1, disposed as required evidence, does not allow `approve` or `approve-with-minor-reservations`. It is lifted by the owner arbitration or the allowed-licence check described in F1. The class mechanics, the test counts and the neutralisation claim hold as measured above. This is a candidate-integration pass only, not a role-specific promotion approval.
