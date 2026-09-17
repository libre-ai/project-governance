<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Contributing to Libre AI

Shared rules and tools for checking contributions before sharing them: tool versions, declared licenses, secrets and personal data in Git-tracked files.

## Run the checks

Use the Bun version specified in `toolchains/`:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Reusable scripts live in `tools/quality/`. Their checks cover defined patterns; they do not replace code review or publication rights review.

The historical decision corpus has not been imported in full. Imported sources are recorded in the [migration record](docs/migration/source.json).

[Français](README.fr.md)
