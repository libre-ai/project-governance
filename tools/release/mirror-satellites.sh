#!/usr/bin/env bash
# Read-only satellite mirrors (EXECUTION-SEQUENCING vague 1: "miroirs en
# lecture seule"). Pushes a `git subtree split` of each satellite package to
# its mirror repository. The hub stays the single source of truth: mirrors
# receive history, never contributions (enable branch protection + disable
# issues/PRs on each mirror; its README banner must say so).
#
# Prerequisites (owner): the mirror repositories exist and the local git
# identity may push to them. Run from anywhere inside the hub clone:
#   tools/release/mirror-satellites.sh            # push all mirrors
#   tools/release/mirror-satellites.sh sdk-ts     # push one mirror
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

# package directory -> mirror repository (names reserved in LEXICON §2.1).
# web-platform has no reserved mirror name: published on npm only, until the
# owner reserves one (documented in the wave-1 runbook).
mirror_of() {
  case "$1" in
    sdk-ts) echo "packages/contracts libre-ai/sdk-ts" ;;
    ui) echo "packages/ui libre-ai/ui" ;;
    auth) echo "packages/auth-web libre-ai/auth" ;;
    starter) echo "distribution/templates/starter libre-ai/starter" ;;
    *) echo "" ;;
  esac
}

targets=("sdk-ts" "ui" "auth" "starter")
if [ "$#" -ge 1 ]; then targets=("$@"); fi

for target in "${targets[@]}"; do
  entry="$(mirror_of "$target")"
  if [ -z "$entry" ]; then
    echo "unknown mirror target: $target (expected sdk-ts | ui | auth | starter)" >&2
    exit 1
  fi
  package_dir="${entry% *}"
  mirror_repo="${entry#* }"
  branch="mirror/${target}"

  echo "Splitting ${package_dir} -> ${branch}"
  git subtree split --prefix="$package_dir" -b "$branch"
  echo "Pushing ${branch} -> ${mirror_repo}:main"
  git push "git@github.com:${mirror_repo}.git" "${branch}:main"
  git branch -D "$branch"
done

echo "Mirrors updated. Source of truth remains the hub monorepo."
