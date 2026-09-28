<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Libre-AI — RepositoryManifest Specification

## Purpose

Make a repository directly understandable and operable by Forge/Harness without broad LLM discovery.

## Design rules

- machine-readable ;
- versioned ;
- generated documentation allowed ;
- no secret values ;
- repository remains authoritative ;
- manifest may be challenged only with evidence.

## Minimal v1

```yaml
schema_version: 1

repository:
  id: libre-ai/example
  revision_strategy: git
  revision: <full-source-commit>

interfaces:
  cli: []
  api: []
  events: []

canonical_data: []

contracts:
  provides: []
  consumes: []

capabilities:
  build: []
  test:
    targeted: null
    package: null
    full: null
  lint: []
  migrate: []
  restore: []
  release: []

protected: []

rules: []
practices: []
evals: []

reconstruction:
  required_saas: []
  build: null
  restore: null
```

## Freshness

Manifest is tied to:
- repository revision or compatibility range ;
- schema version.

Forge must detect stale manifest assumptions.

## Non-goals

- architecture essay ;
- full dependency lockfile ;
- secret store ;
- product backlog ;
- agent prompt.

## Binding and trust

The consuming task records the manifest content digest, schema version and source revision. A revision field cannot self-reference the commit introducing that same field; bind the inspected source revision in a generated manifest or an external verified envelope.

Command declarations are untrusted data until validated against the effective capability policy. A manifest cannot authorize network access, credentials, protected-path writes or policy changes. Freshness checks compare declared contracts and commands to the inspected revision; disagreement is recorded and tested before affected execution.

The example is an incomplete design shape, not an executable schema or qualified validator. Omitted capabilities mean unavailable, not unrestricted. Schema admission, compatibility and negative fixtures belong to the shared contract authority.
