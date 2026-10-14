#!/bin/sh
# RFC 8785 manifest of a git repository, shell reference implementation.
#
# This is the `manifest()` function of step 2 of the Square Control circuit, which produced the
# pre-push and mirror manifests of the attestation (ADR-0038 D2), PLUS two fixes found by review:
#   - a tree entry whose name holds a newline was dropped silently (jq's `.` does not match a
#     newline); the match now spans newlines and the number of entries is checked against the
#     NUL-terminated records `git ls-tree -z` printed;
#   - POSIX sh has no portable `pipefail`, so a `git ls-tree` that failed inside a pipeline lost
#     its exit status and its entries vanished while the count guard read the same failing
#     command. Every git read now goes to a file and its exit status is tested.
# The bytes retained for the candidate are unaffected by both fixes (it has no such path and no
# unreadable tree; they were re-derived equal by the shell, TypeScript and Python
# implementations). The TypeScript `buildManifest` in git-attestation.ts is the second,
# independent instrument; the tests require both to produce the same bytes. `jq -S` equals
# RFC 8785 only on ASCII strings and safe integers, so the function fails closed on anything else.
#
# Each `return 1` carries a `# neutralise:<id>` marker: neutralise-check.ts counts them and
# requires a red test per marker (or an exemption with a reason).
#
# Usage: REPO=<owner/repo> sh tools/attestation/manifest.sh <dir>   (no terminal newline)
set -eu
REPO="${REPO:?REPO=<owner/repo> is required}"

# One tree: append its entries as a JSON array line and its NUL-terminated record count.
manifest_tree() { # $1 repository, $2 scratch directory, $3 tree id
  # neutralise:manifest-ls-tree
  git -C "$1" ls-tree -z "$3" > "$2/ls" || return 1
  # neutralise:none jq cannot fail on an entry git printed: a line that does not match yields nothing and is caught by the record count
  jq -R -s -c --arg t "$3" 'split("\u0000")|map(select(length>0)|capture("^(?<mode>[0-7]+) (?<type>[a-z]+) (?<objectId>[0-9a-f]+)\t(?<name>[\\s\\S]*)\\z")|.treeObjectId=$t)' < "$2/ls" >> "$2/trees" || return 1
  LC_ALL=C tr -cd '\000' < "$2/ls" | wc -c | tr -d ' ' >> "$2/expected"
}

# Every tree listed in the inventory.
manifest_trees() { # $1 repository, $2 scratch directory
  for t in $(awk '$2=="tree"{print $1}' "$2/inv"); do
    # neutralise:manifest-tree
    manifest_tree "$1" "$2" "$t" || return 1
  done
}

# Every read of the repository, each exit status tested: no pipeline hides a git failure.
manifest_read() { # $1 repository, $2 scratch directory
  git -C "$1" rev-parse --show-object-format > "$2/fmt" &&
    git -C "$1" cat-file --batch-all-objects --batch-check='%(objectname) %(objecttype) %(objectsize)' > "$2/inv" &&
    git -C "$1" for-each-ref --format='%(refname) %(objectname)' > "$2/refs" &&
    jq -R -s -c 'split("\n")|map(select(length>0)|split(" ")|{objectId:.[0],size:(.[2]|tonumber),type:.[1]})|sort_by(.objectId)' < "$2/inv" > "$2/objs.json" &&
    jq -R -s -c 'split("\n")|map(select(length>0)|split(" ")|{name:.[0],objectId:.[1]})|sort_by(.name)' < "$2/refs" > "$2/refs.json" &&
    : > "$2/trees" &&
    : > "$2/expected" &&
    manifest_trees "$1" "$2"
}

manifest_clean() { rm -f "$tmp"/*; rmdir "$tmp"; }

manifest() {
  dir="$1"
  # neutralise:none mktemp failing is an environment fault, not a property of the repository
  tmp="$(mktemp -d)" || return 1
  # neutralise:manifest-shallow
  [ "$(git -C "$dir" rev-parse --is-shallow-repository)" = "false" ] || { manifest_clean; echo "shallow repository" >&2; return 1; }
  # neutralise:manifest-read
  manifest_read "$dir" "$tmp" || { manifest_clean; echo "git read failed" >&2; return 1; }
  # neutralise:none git refuses to list an object type outside commit/tree/blob/tag (invalid object type), so this guards only a future git
  awk '$2!="commit" && $2!="tree" && $2!="blob" && $2!="tag"{bad=1} END{exit bad}' "$tmp/inv" \
    || { manifest_clean; echo "object type not handled" >&2; return 1; }
  trees="$(jq -s -c '(add // [])|sort_by([.treeObjectId,.name])' < "$tmp/trees")"
  expected="$(awk '{n+=$1} END{print n+0}' "$tmp/expected")"
  # neutralise:manifest-count
  [ "$(printf '%s' "$trees" | jq 'length')" = "$expected" ] \
    || { manifest_clean; echo "tree entries dropped: manifest does not hold every ls-tree record" >&2; return 1; }
  out="$(jq -n -S -c --arg fmt "$(cat "$tmp/fmt")" --arg repo "$REPO" --slurpfile o "$tmp/objs.json" --slurpfile r "$tmp/refs.json" --argjson t "$trees" \
    '{gitObjectFormat:$fmt,objects:$o[0],refs:$r[0],repository:$repo,schemaVersion:"libre-ai.git-object-manifest.v2",treeEntries:$t}')"
  manifest_clean
  # BSD grep has no -P: count the bytes outside 0x00-0x7F with tr instead (a grep failure would fail open).
  # neutralise:manifest-ascii
  [ "$(printf '%s' "$out" | LC_ALL=C tr -d '\000-\177' | wc -c | tr -d ' ')" = "0" ] \
    || { echo "non-ASCII byte: outside the admitted JCS subset" >&2; return 1; }
  printf '%s' "$out"
}

manifest "${1:?usage: manifest.sh <dir>}"
