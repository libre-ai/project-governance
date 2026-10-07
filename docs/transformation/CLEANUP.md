# Cleanup and global freeze

## Purpose

Produce a reliable final reference of every historical repository, not a new release of the old architecture.

**Status:** complete. All 18 repositories are archived. Final SHAs, branch-tip preservation and qualification evidence are recorded in [`G0-FREEZE-EVIDENCE.md`](G0-FREEZE-EVIDENCE.md).

## Per-repository procedure

1. read AGENTS/ADR/readiness and actual Git state ;
2. enumerate branch, worktree, staged, unstaged and untracked changes ;
3. scan secrets/PII and machine-local paths ;
4. preserve ambiguous work in a local WIP branch or patch before any reset ;
5. merge already accepted remote work ;
6. classify remaining changes: keep, superseded, generated, machine-local or discard ;
7. run the smallest relevant verification suite ;
8. create a final cleanup commit only for accepted changes ;
9. record final SHA, dirty state, tests, licences, data and contracts ;
10. archive and redirect future work to `libre-ai/libre-ai`.

## Prohibited

- rewriting historical architecture ;
- introducing Bun into historical repositories ;
- deleting unreviewed work ;
- claiming old products production-ready ;
- provisioning Clever Cloud ;
- importing Git history into the canonical monorepo.

## Website special case — archived

Option B was explicitly approved. The dirty tree was committed directly, then `origin/main` and the six-commit `impl/epic-2-corpus` branch were merged. Conflicts favored local visual work for the first merge and corpus work for the second. Component contracts, media provenance, catalogue schema, publication tests and the dependency graph were repaired afterward. GitHub PR #61 passed all four required checks and produced final remote SHA `0318c92`. Local and remote `main` are aligned and the repository is archived.

## Design System special case — archived

The coherent visual/motion set was regenerated, reviewed and committed at `c8fb246`. Product and motion outputs are reproducible, CI regenerates both families, licences/provenance are present and the full pinned builder path is green. Website consumer evidence was reconciled against this revision, local and remote `main` are aligned and the repository is archived.
