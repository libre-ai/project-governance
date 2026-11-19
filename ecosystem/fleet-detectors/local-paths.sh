#!/usr/bin/env bash
# identifiant: local-paths
# titre: Workstation home path in a tracked file
# fragilite: an absolute path of one machine leaks a user name and breaks on every other machine
# cible: 0
# portee: repo
#
# One finding per tracked text line naming a macOS or Linux home, unless the
# line carries the allow-local-path marker. The finding names the line, never
# the path found. The logic lives in ecosystem/detect-local-paths.ts and its
# test.
#
# Bun runs from this repository, never from the measured worktree, so that a
# bunfig.toml or a package.json of the measured repository configures nothing.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec bun ecosystem/detect-local-paths.ts
