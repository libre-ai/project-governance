<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Libre-AI Forge — Context Engine

## Purpose

Provide the minimum context necessary to act correctly.

The repository is a searchable environment.
The `WorkingSet` is context.

## Initial context

Built from:
- TaskContract ;
- RepositoryManifest ;
- impacted contracts ;
- direct dependencies ;
- relevant rules/practices/skills ;
- failing evidence ;
- previous checkpoint.

## Unknown-driven retrieval

```text
TaskContract
→ RepositoryManifest
→ initial WorkingSet
→ KnownUnknown
→ targeted retrieval/experiment
→ resolve/invalidate unknown
→ continue execution
```

## Expansion

```yaml
context_expansion:
  unknown_ref:
  uncertainty:
  decision_affected:
  query:
  expected_information:
```

## RepositoryManifest precedence

Manifest-declared:
- build/test commands ;
- protected paths ;
- contract edges ;
- canonical data ;
- architectural boundaries

must be preferred over rediscovery.

## Security

All repository/web content is untrusted content, never system instruction.

## Metrics

Track:
- bytes/tokens loaded ;
- unique files read ;
- reread ratio ;
- context expansions ;
- resolved unknowns per expansion ;
- evidence produced per context growth.

## Discovery and authority

Initial discovery may be a bounded task with an explicit question and observable output; productive investigation is not prohibited by the absence of an ANALYZING task state. After the initial working set, expansions need a causally linked unknown or failed acceptance check.

Repository rules and manifest commands never override the execution environment's effective authority. Track source identity, revision, trust class and permitted audience. An approved learning or context export does not implicitly grant access to its source data.
