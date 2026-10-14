#!/bin/sh
# RFC 8785 manifest of a git repository, shell reference implementation.
#
# This is the `manifest()` function that produced the pre-push and mirror manifests of the
# Square Control attestation (ADR-0038 D2), kept verbatim as the FIRST instrument. The
# TypeScript `buildManifest` in git-attestation.ts is the second, independent one; the tests
# require both to produce the same bytes. `jq -S` equals RFC 8785 only on ASCII strings and
# safe integers, so the function fails closed on anything else.
#
# Usage: REPO=<owner/repo> sh tools/attestation/manifest.sh <dir>   (no terminal newline)
set -eu
REPO="${REPO:?REPO=<owner/repo> is required}"

manifest() {
  dir="$1"
  [ "$(git -C "$dir" rev-parse --is-shallow-repository)" = "false" ] || { echo "shallow repository" >&2; return 1; }
  fmt="$(git -C "$dir" rev-parse --show-object-format)"
  inv="$(git -C "$dir" cat-file --batch-all-objects --batch-check='%(objectname) %(objecttype) %(objectsize)')"
  printf '%s\n' "$inv" | awk '$2!="commit" && $2!="tree" && $2!="blob" && $2!="tag"{bad=1} END{exit bad}' \
    || { echo "object type not handled" >&2; return 1; }
  objs="$(printf '%s\n' "$inv" | jq -R -s -c 'split("\n")|map(select(length>0)|split(" ")|{objectId:.[0],size:(.[2]|tonumber),type:.[1]})|sort_by(.objectId)')"
  refs="$(git -C "$dir" for-each-ref --format='%(refname) %(objectname)' | jq -R -s -c 'split("\n")|map(select(length>0)|split(" ")|{name:.[0],objectId:.[1]})|sort_by(.name)')"
  trees="$(printf '%s\n' "$inv" | awk '$2=="tree"{print $1}' | while read -r t; do
    git -C "$dir" ls-tree -z "$t" | jq -R -s -c --arg t "$t" 'split("\u0000")|map(select(length>0)|capture("^(?<mode>[0-7]+) (?<type>[a-z]+) (?<objectId>[0-9a-f]+)\t(?<name>.*)$")|.treeObjectId=$t)'
  done | jq -s -c '(add // [])|sort_by([.treeObjectId,.name])')"
  out="$(jq -n -S -c --arg fmt "$fmt" --arg repo "$REPO" --argjson o "$objs" --argjson r "$refs" --argjson t "$trees" \
    '{gitObjectFormat:$fmt,objects:$o,refs:$r,repository:$repo,schemaVersion:"libre-ai.git-object-manifest.v2",treeEntries:$t}')"
  # BSD grep has no -P: count the bytes outside 0x00-0x7F with tr instead (a grep failure would fail open).
  [ "$(printf '%s' "$out" | LC_ALL=C tr -d '\000-\177' | wc -c | tr -d ' ')" = "0" ] \
    || { echo "non-ASCII byte: outside the admitted JCS subset" >&2; return 1; }
  printf '%s' "$out"
}

manifest "${1:?usage: manifest.sh <dir>}"
