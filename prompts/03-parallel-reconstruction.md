# Prompt — G3 parallel reconstruction

## Mission

Build target applications in final `apps/*` paths from accepted specifications.

## Work model

- execute the nine `g3-1` app packages and three `g3-2` conformance packages from `docs/transformation/work-packages.v1.json` ;
- one bounded work package per branch/worktree ;
- paths and contracts declared before edit ;
- integrate frequently into canonical main ;
- cross-app changes only through approved packages/contracts ;
- no historical parity beyond selected invariants ;
- no temporary implementation survives the release candidate.

## Evidence

Each package reports files changed, contracts affected, tests run, evidence generated, security/PII impact, remaining debt and integration dependency.

## Gate

All apps compile, critical journeys pass, old names/stacks are absent, and no app accesses another product’s database directly.
