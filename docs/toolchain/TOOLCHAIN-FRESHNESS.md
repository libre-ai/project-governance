<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Toolchain freshness

`.github/workflows/toolchain-freshness.yml` compares, once a week, every
toolchain pin of this repository with the latest release its tool publishes.
It judges no pull request and writes nothing but the repeat-failure issue
described below.

Before it, a pin moved only when someone moved it. The existing gates compare
the copies of a pin with each other (`check:toolchain`,
`ecosystem/check-toolchain-source.ts`), never with what the tool has released
since.

## Reading the report locally

```sh
bun run check:toolchain-freshness
```

This reads tracked files and public registries, and writes nothing. Each pin
lands in exactly one state, and the last line prints the counters, which sum to
the number of pins:

| State | Meaning | Run |
| --- | --- | --- |
| `up-to-date` | the pinned version is the latest release, or ahead of it | green |
| `behind` | a higher release exists and is older than the release-age floor | red |
| `too-recent` | a higher release exists and is younger than the release-age floor | green |
| `unreadable` | a site is missing, holds no pin or disagrees with another site; the pinned text is not an exact version; or the source gave no usable answer | red |

The release-age floor is the one the fleet holds its dependencies to:
`MINIMUM_RELEASE_AGE_SECONDS` of `ecosystem/check-release-age.ts`, the value
`bunfig.toml` carries as `minimumReleaseAge`. A release younger than it is not
yet something the fleet would install, so it is reported and does not turn the
run red.

A pre-release pinned ahead of the latest stable release is `up-to-date`: the
fleet is not late on a release it is past. A pre-release of the latest release
itself is `behind` it.

Exit status: `0` every pin up to date or too recent; `1` a pin behind or
unreadable, or no pin declared; `2` usage (the command takes no argument).

## What is compared

The pins are declared in `TOOLCHAIN_PINS` of
`tools/fleet/check-toolchain-freshness.ts`: one entry per tool, with every
tracked site that writes its version and the source of its latest release.

| Tool | Sites | Source |
| --- | --- | --- |
| Bun | `toolchains/bun.json`, `.github/composition/install-toolchains.sh` | npm registry |
| Rust toolchain | `rust-toolchain.toml`, `validate-composition.yml` | Rust stable channel manifest |
| cargo-deny | `toolchains/cargo-deny.json`, `install-toolchains.sh`, `reusable-dependency-policy.yml` | crates.io sparse index |
| cargo-audit | `reusable-dependency-policy.yml` | crates.io sparse index |
| cargo-semver-checks | `reusable-api-compat.yml` | crates.io sparse index |
| cargo-llvm-cov | `validate-composition.yml` | crates.io sparse index |
| cargo-mutants | `toolchains/cargo-mutants.json`, `reusable-mutation-rust.yml` | crates.io sparse index |
| reuse | `tools/licensing/requirements.txt`, `validate-composition.yml` | PyPI JSON document |
| shellcheck | `reusable-shell-lint.yml` | GitHub REST API, latest release |
| osv-scanner | `toolchains/osv-scanner.json`, `install-toolchains.sh` | GitHub REST API, latest release |

Every site of a tool must write the same version. Two sites that disagree make
the pin `unreadable` rather than letting the report choose one. The test suite
reads every declared site in the tracked tree, so a pin that moves or changes
shape fails the pull request that moves it, not the next scheduled run.

## Sources and their limits

A tool published on a registry is read there, anonymously, through the document
its own installer resolves. None of these has a request quota.

shellcheck and osv-scanner publish on GitHub Releases only. They are read
through `GET /repos/<owner>/<repository>/releases/latest`, which has one: 60
requests an hour for an anonymous address, 1000 an hour for the token of a
workflow run. The report sends two such requests. `GH_TOKEN`, when set, is sent
to `api.github.com` and to no other host; without it the same read is
anonymous. A refused request makes the pin `unreadable`, never `up-to-date`.

No redirect is followed, on any source. Every source is a third party
`ecosystem/third-parties.v1.yaml` already lists.

Declared limits:

- Only the latest release is compared. A pin behind an older release, while
  the latest is younger than the floor, reads `too-recent` until that latest
  passes the floor.
- The Rust channel manifest dates a release by its day. The end of that day is
  kept, so a release is never read as older than it is.
- For the five cargo tools the date is the publication of the crate. The
  release archive the fleet downloads may follow it.
- shellcheck is pinned by image digest; the version compared is the comment
  written next to the digest. The digest is not resolved.
- The Bun archive URL repeated in the workflows is not read here:
  `ecosystem/check-toolchain-source.ts` holds every copy to `toolchains/bun.json`.
- Not compared: Node and the Playwright browsers of
  `toolchains/notebook-qualification.json`, the GitHub Actions pinned by
  commit, and the `rust-toolchain.toml` of the other repositories of the fleet.
  The bun dependencies of this repository are covered by `BUN-UPDATE.md`.

## How a result becomes visible

The workflow carries the two steps every scheduled workflow of this repository
carries (`tools/security/repeat-failure-alert.ts`,
`docs/method/AGENTIC-LOOP-INVENTORY.md`): a red run stays a run; the second
consecutive red run opens the issue `Toolchain freshness: two consecutive
failed runs`, and the first green run closes it. The lines of the report are in
the log of the run.

Moving a pin is done by hand, in a pull request: the report proposes nothing.
