#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Libre AI contributors
# SPDX-License-Identifier: Apache-2.0
#
# Context hygiene — blocks private identifiers and machine-local paths from
# the public tree. One file run by .github/workflows/context-hygiene.yml and
# by `bun run check` (2026-10-14): the checks used to live as inline shell in
# the workflow only, so a local `bun run check` could not see them.
#
# Deny patterns are stored base64-encoded so this file never carries them in
# human-readable form (obfuscation, not encryption: the goal is zero readable
# mention, plus grep-proof compliance of the tree). Text files only (-I):
# identifiers embedded in binary evidence would escape these checks.
# Exemptions: lines carrying the 'allow-local-path' marker, and SHA-sealed
# Gate A evidence reports (immutable records, digest-verified by
# check:notebook-core-v2) — exempted file by file, never whole directories.
#
# Scope is the tracked tree (`git grep`, `git ls-files`): a file must be added
# to be judged.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
banned="$(printf '%s' 'W2Rdb3hhbGxpYQ==' | base64 -d)"
user_pat="$(printf '%s' 'W2ldZmk2NTY3' | base64 -d)"
tracked=$(git ls-files | wc -l | tr -d ' ')

# --- Banned private identifiers ---------------------------------------------
if git grep -I -n -i -E -e "$banned" -- .; then
  echo "Banned private identifier found in tracked files."
  fail=1
fi

# --- Machine-local identifiers and paths ------------------------------------
generic='/Users/[A-Za-z0-9._-]+' # allow-local-path (pattern definition)
hits="$(git grep -I -n -E -e "$generic" -e "$user_pat" -- . \
  | grep -v 'allow-local-path' \
  | grep -vE '^docs/reviews/notebook-core-v2/gate-a/a28e116/(ARCHITECTURE|SECURITY|CRYPTOGRAPHY)\.md:' || true)"
if [ -n "$hits" ]; then
  printf '%s\n' "$hits"
  echo "Machine-local identifier or path found in tracked files."
  fail=1
fi

# --- Symlink targets ---------------------------------------------------------
links=0
hits=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  links=$((links + 1))
  t="$(readlink "$f" || true)"
  if printf '%s' "$t" | grep -qiE -e "$banned" -e "$user_pat" -e '/Users/'; then
    hits="${hits}${f} -> ${t}
"
  fi
done < <(git ls-files -s | awk -F'\t' '$1 ~ /^120000/ {print $2}')
if [ -n "$hits" ]; then
  printf '%s' "$hits"
  echo "Symlink target carries a machine-local or private identifier."
  fail=1
fi

if [ "$tracked" -eq 0 ]; then
  echo "Context hygiene examined nothing: 0 tracked file(s)"
  exit 1
fi
if [ "$fail" -ne 0 ]; then
  echo "Context hygiene failed."
  exit 1
fi
echo "Context hygiene verified: $tracked tracked file(s) scanned for 2 identifier classes, $links symlink target(s) checked"
