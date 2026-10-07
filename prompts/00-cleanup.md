# Prompt — G0 cleanup and freeze

You operate under `~/Documents/libre-ai`.

## Mission

Preserve, reconcile, verify and archive the historical repositories so all new work can move to `libre-ai/libre-ai`.

## Rules

- Read repository instructions before changes.
- Never overwrite staged, unstaged, untracked or worktree changes.
- Ask for human validation when provenance or intended disposition is ambiguous.
- Do not modernize architecture or introduce Bun in legacy repositories.
- Do not configure Clever Cloud.
- GitHub remains the canonical forge.
- Record observed, declared, inferred and decided facts separately.

## Output per repository

- current branch/SHA/remote divergence ;
- dirty work and preservation method ;
- accepted merges ;
- discarded/generated files with reason ;
- tests run and results ;
- contracts/data/licences to preserve ;
- final SHA and archive readiness ;
- update to `ecosystem/LEGACY-MANIFEST.yaml`.

## Gate

No user work lost, no secret committed, no unexplained dirty state, and no future work still targeting the legacy repository.
