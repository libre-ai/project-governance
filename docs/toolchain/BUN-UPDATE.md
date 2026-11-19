<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Bun dependency updates

**Status: enabled, by hand only.** ADR-0069 was accepted on 2026-11-19. The
workflow has no `schedule`; it opens pull requests only once the repository
setting "Allow GitHub Actions to create and approve pull requests" is on, which
the owner sets.

`.github/workflows/bun-update.yml` proposes the patch and minor bumps of this
repository's bun dependencies, one pull request per bump, with the job's own
`GITHUB_TOKEN`. It starts by hand only (`workflow_dispatch`, from the served branch).

## Reading the plan locally

```sh
bun tools/fleet/plan-bun-update.ts --root .
```

This reads the manifests and the npm registry, and writes nothing. Each direct
dependency lands in exactly one state, and the last lines print the counters:

| State | Meaning |
| --- | --- |
| `up-to-date` | no higher version is published |
| `proposable` | a patch or minor older than the release-age floor exists |
| `major-only` | only a breaking version exists: listed, never applied |
| `too-recent` | the only candidates are younger than the release-age floor |
| `not-examined` | not an exact release version, a peer range, pinned by `overrides` or `resolutions`, or the name of a workspace member |
| `unreadable` | the registry gave no usable or coherent answer (another package's name, a `latest` below the declared version): the run fails |

Below 1.0.0 a minor counts as breaking, and below 0.1.0 a patch does too.

Exit status: `0` plan complete; `1` a dependency unreadable or a bundle not
prepared; `2` usage.

## What the workflow does

1. `plan` (`contents: read`) classifies the dependencies and prepares one bundle per
   proposal: the edited manifests and a `bun.lock` regenerated with
   `--lockfile-only --ignore-scripts`.
2. `propose` (`contents: write`, `pull-requests: write`) installs nothing, re-verifies
   each bundle with `tools/fleet/propose-bun-update.ts`, then commits with
   `--signoff`, pushes `work/bun-update/<package>@<version>` without force and opens
   the pull request. It never merges. The re-verification reads the target's existence
   and age from the public registry without a token, and parses `bun.lock`: no URL, no
   other table changed, no package changed outside the target's dependencies.

`propose` exits `0` when every proposal is opened or already open, `1` when one is
refused or fails, `2` on usage, and `3` while ADR-0069 is not accepted.

## Reviewing a proposed bump

A pull request opened with `GITHUB_TOKEN` starts its checks in an approval-required
state. Someone with write access selects **Approve workflows to run**, then reviews
the result.

Every proposal edits `bun.lock`, so merging one puts the others in conflict. Close the
conflicting pull request, delete its branch and run the workflow again: an existing
branch is never rewritten.

## Repository setting

The repository setting "Allow GitHub Actions to create and approve pull requests" is
off. While it stays off, `propose` pushes the branch, fails naming the setting, and
prints the compare URL from which a person can open the pull request. Turning it on is
an owner decision recorded in ADR-0069.
