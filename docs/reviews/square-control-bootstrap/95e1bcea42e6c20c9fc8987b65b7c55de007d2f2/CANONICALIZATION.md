# Independent canonical manifest verification

ADR-0038 D2 requires a retained RFC 8785 (JCS) manifest. Here the manifest is produced by
`manifest()`, shell and `jq -S`, kept as `tools/attestation/manifest.sh`. `jq -S` equals
RFC 8785 only on ASCII strings and safe nonnegative integers, so the function fails closed on
any other input. Two implementations that share no code with it re-derive the same bytes.
The signalement recipe is a precedent, not a rule: its digests are not reused.

## The admitted subset

Strings are ASCII, numbers are integers in `0..9007199254740991`, containers are arrays and
objects, keys are unique. In this subset Python's `json.dumps(sort_keys=True,
separators=(",", ":"), ensure_ascii=False)` is RFC 8785: ASCII and UTF-16 key order agree,
primitive encodings agree, array order is kept, and no whitespace or terminal newline is
emitted (RFC 8785 sections 3.1 to 3.2.4). Anything outside the subset fails closed and is
never approximated. The manifest of this candidate holds 0 byte outside `0x00..0x7F`
(87,173 bytes, 205 objects).

## Three derivations, one digest

| Implementation | Source | Command | Result |
| --- | --- | --- | --- |
| Shell + jq (first instrument) | `tools/attestation/manifest.sh` | `REPO=libre-ai/square-control sh tools/attestation/manifest.sh <mirror> \| cmp - evidence/manifest.jcs.json` | exit 0 |
| TypeScript (second) | `buildManifest` in `tools/attestation/git-attestation.ts` | `bun tools/attestation/git-attestation.ts manifest <mirror> libre-ai/square-control \| cmp - evidence/manifest.jcs.json` | exit 0 |
| Python stdlib (third, standalone) | `tools/attestation/canonicalize.py` | `python3 -I tools/attestation/canonicalize.py derive <mirror> libre-ai/square-control evidence/manifest.jcs.json` | `derived 87173 bytes, sha256 765fd6e9…dca9` |

The digest of the retained bytes:

```sh
shasum -a 256 docs/reviews/square-control-bootstrap/95e1bcea42e6c20c9fc8987b65b7c55de007d2f2/evidence/manifest.jcs.json
# 765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9
```

`<mirror>` is a fresh, non-shallow, empty-then-fetched repository (`git init`, then
`git fetch <remote> '+refs/*:refs/*'`). The shell implementation also produced the owner's
copy of this manifest, byte-equal (`cmp` exit 0).

## Re-serialising the retained bytes

```sh
python3 -I tools/attestation/canonicalize.py verify docs/reviews/square-control-bootstrap/95e1bcea42e6c20c9fc8987b65b7c55de007d2f2/evidence/manifest.jcs.json
# verified 87173 bytes, sha256 765fd6e9…dca9
python3 -I tools/attestation/canonicalize.py verify docs/reviews/square-control-bootstrap/95e1bcea42e6c20c9fc8987b65b7c55de007d2f2/evidence/manifest.pre-push.jcs.json
# verified 81044 bytes, sha256 f512f639…3b20
```

`verify` parses with a duplicate-key check, admits only the subset above, re-serialises, and
requires the result to equal the file byte for byte, with no terminal newline.
`red:python-verify` (a newline, an unsorted object, indented JSON, a wrong repository name on
`derive`) shows each refused, and `bun tools/attestation/neutralise-check.ts` shows that removing the
byte-equality assertion turns that test red.

## Two defects the review found, and their proofs

- A path holding a newline was dropped silently by the shell implementation (`jq`'s `.*` does
  not match a newline, so `capture` produced nothing). The match now spans newlines, and the
  function counts the NUL-terminated records of `git ls-tree -z` and refuses when the manifest
  holds fewer (`red:manifest-newline`, `red:manifest-count`). The TypeScript and Python
  implementations already kept the entry; the three agree on a repository with such a path.
- The Python derivation used `assert`, which `python -O` strips: a verifier that exits 0 on
  anything. It now refuses with an explicit exit (`red:python-derive`, `red:python-verify`, each
  run with and without `-O`).

## Why a third implementation

The shell and the TypeScript implementation both ask `git` for the same listing; a flaw in
how that listing is read (tree entry mode padding, ordering, a skipped object) would be
shared by an implementation written by the same hand. The Python derivation reads the raw
object database through different `git` plumbing (`ls-tree -z`, `for-each-ref`) and sorts with
its own comparator. Agreement of the three on 87,173 bytes is the evidence; a bytes-level
disagreement refuses the transition (ADR-0038 D4, D5).
