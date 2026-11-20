#!/usr/bin/env bash
# identifiant: sql-construction
# titre: SQL built from non-constant text
# fragilite: an interpolated or concatenated query reads like a parameterized one in review
# cible: 0
# portee: repo
#
# One finding per raw-SQL construction site not covered, at its exact count, by
# ecosystem/sql-construction-allowlist.v1.yaml. The scanner and the allowlist
# are those of ecosystem/check-sql-construction.ts; the logic lives in
# ecosystem/detect-sql-construction.ts and its test.
#
# Bun runs from this repository, never from the measured worktree, so that a
# bunfig.toml or a package.json of the measured repository configures nothing.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec bun ecosystem/detect-sql-construction.ts
