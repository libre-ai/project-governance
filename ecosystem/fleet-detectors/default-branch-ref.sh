#!/usr/bin/env bash
# identifiant: default-branch-ref
# titre: Default branch written into a request
# fragilite: a written default branch reads the wrong tree on a repository that serves another one
# cible: 0
# portee: repo
#
# One finding per written default-branch ref handed to a request, and per
# workflow whose push filter omits the branch the forge snapshot says the
# repository serves. The forms and the allow-hardcoded-ref marker are those of
# tools/quality/check-resolved-refs.ts; the logic lives in
# ecosystem/detect-default-branch-refs.ts and its test.
#
# Bun runs from this repository, never from the measured worktree, so that a
# bunfig.toml or a package.json of the measured repository configures nothing.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec bun ecosystem/detect-default-branch-refs.ts
