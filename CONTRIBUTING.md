# Contributing

This repository accepts contributions under the Developer Certificate of
Origin 1.1 (DCO). There is no Contributor Licence Agreement (CLA): the DCO
does not assign copyright and does not grant a right to proprietary
relicensing (see `LICENSING.md`).

## Developer Certificate of Origin

Every commit must carry a `Signed-off-by: Name <email>` trailer matching its
author, added with `git commit -s`. This is verified two ways:

- On a pull request, every commit in the PR's range is checked individually
  for an author-matching trailer.
- On push, the same range is checked, except for a forge-generated
  integration commit (a squash merge or merge commit, always authored by
  GitHub) — that commit is instead checked for any valid maintainer
  `Signed-off-by` trailer in its own message.

## Merge flow

Pull requests are merged with a GitHub squash merge. Because the squash
commit is forge-generated, its message must itself carry a maintainer
`Signed-off-by` trailer (see above) — this is added when the merge is
performed, not by the contributor.

## Before opening a pull request

```sh
bun install --frozen-lockfile
bun run check
```

`bun run check` runs this repository's full gate suite (doctrine and source
checks, REUSE/licence checks, dead-code, lint, typecheck, tests) and must
pass locally first. The exact Bun revision this repository is built and
tested against is pinned in `toolchains/bun.json` (currently an archived
pre-release, `1.4.0-canary.1+57f349f63`) — CI provisions it from a governance
GitHub Release; `bun run check:toolchain` and `check:bun:runtime` fail loudly
on a mismatch rather than running silently against a different Bun.

## Where doctrine and contracts live

- `docs/decisions/INVARIANTS.md` — the invariant register.
- `docs/adr/` — architecture decision records.
- `docs/decisions/LEXICON.md` — vocabulary.

A structural or doctrine-affecting change needs a corresponding ADR or
invariant update, not only code. Canonical contracts and schemas are not
owned here: `libre-ai/contracts` is the other authority for those.

## External contributions

There is no separate or lighter path for contributions from outside the
project. The same required checks — DCO sign-off, `reuse lint`, the
declared-vs-effective licence gate, `bun run check`, and this repository's
other fleet gates — apply regardless of who opens the pull request.
