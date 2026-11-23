<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Toolchain freshness

`.github/workflows/toolchain-freshness.yml` compares, once a week, the
toolchain pins of this repository listed below with the latest release their
tool publishes. It judges no pull request and writes nothing but the
repeat-failure issue described at the end.

Before it, a pin moved only when someone moved it. The existing gates compare
the copies of a pin with each other (`check:toolchain`,
`ecosystem/check-toolchain-source.ts`), never with what the tool has released
since.

## Reading the report locally

```sh
bun run check:toolchain-freshness
```

This reads tracked files and public registries, and writes nothing. Each pin
lands in exactly one state, and the last line prints the counters:

| State | Meaning | Run |
| --- | --- | --- |
| `up-to-date` | the pinned version is the latest release, or a pre-release of a version above it | green |
| `behind` | a higher release exists and is older than the release-age floor | red |
| `too-recent` | a higher release exists and is younger than the release-age floor | green |
| `held` | a higher release exists, and an entry of the exception register holds the pin at exactly this version, until a date that has not passed | green |
| `unreadable` | a listed site is missing, holds no pin or disagrees with another; the pinned text is not an exact version; the source gave no usable answer, dates its latest release in the future, does not list the pinned version, or names a latest release below a stable pin | red |

The release-age floor is the one the fleet holds its dependencies to:
`MINIMUM_RELEASE_AGE_SECONDS` of `ecosystem/check-release-age.ts`, the value
`bunfig.toml` carries as `minimumReleaseAge`. A release younger than it is not
yet something the fleet would install, so it is reported and does not turn the
run red.

"Ahead" is a pre-release only: a pre-release of a version above the latest
stable release is `up-to-date`, and a pre-release of the latest release itself
is `behind` it. A stable pin above the latest release is `unreadable`: either
the pinned release was withdrawn, or the source is not the one the pin comes
from. On crates.io the index lists every version, so a pin that is absent from
it, or yanked, is `unreadable` whatever the latest release is.

The last line sums: `pins` = `up-to-date` + `behind` + `too-recent` + `held` +
`unreadable`. States are counted once per tool, so a tool declared twice breaks
the sum and fails the run. `sites=<read>/<declared>` is the number of listed
sites that were read and held a pin, over the number listed.

Exit status: `0` every pin up to date, too recent or held; `1` a pin behind or
unreadable, an exception that fails, an exception register that cannot be
read, a volume that does not sum, or no pin declared; `2` usage (the command
takes no argument).

## Holding a pin on purpose

`ecosystem/toolchain-freshness-exceptions.v1.yaml` lists the pins that stay
behind knowingly. An entry carries four fields, all required:

| Field | Meaning |
| --- | --- |
| `tool` | the tool, as `TOOLCHAIN_PINS` names it |
| `held_at` | the exact pinned version the entry holds |
| `because` | why the pin stays there, on one line |
| `until` | the last day the entry holds, a quoted `YYYY-MM-DD` date, in UTC |

An applied entry prints one `held` line on every run, with its reason and its
date, and does not turn the run red. An entry fails the run, and leaves its pin
in the state that was measured, when:

- the pin is no longer `held_at` (stale: the entry was written for another version);
- `until` has passed (expired);
- the tool is up to date (dead);
- the tool is not a declared pin (dead).

An entry also holds a pin whose higher release is still `too-recent`: without
that, a held pin would fail as dead for three days after every release of its
tool. The entry of a pin that could not be read is not judged.

Without the register a pin held on purpose keeps the run red, the
repeat-failure issue stays open, and a second pin falling behind then produces
no new signal. With it the run is red only for what nobody decided.

The register is on the guarded surface of
`tools/quality/check-review-evidence.ts`: a pull request that adds, renews or
removes an entry needs review evidence.

## What is compared

The pins are declared in `TOOLCHAIN_PINS` of
`tools/fleet/check-toolchain-freshness.ts`: one entry per tool, with the sites
read for it and the source of its latest release.

| Tool | Sites read | Source |
| --- | --- | --- |
| Bun | `toolchains/bun.json` (`revision`), `.github/composition/install-toolchains.sh`, `docs/LOCAL-COMPOSITION.md` | npm registry |
| Rust toolchain | `rust-toolchain.toml`, `validate-composition.yml`, `docs/LOCAL-COMPOSITION.md`, `.github/composition/check-products.py` | Rust stable channel manifest |
| cargo-deny | `toolchains/cargo-deny.json` (`version` and every release URL), `install-toolchains.sh`, `reusable-dependency-policy.yml` (version and archive URL), `docs/LOCAL-COMPOSITION.md` | crates.io sparse index |
| cargo-audit | `reusable-dependency-policy.yml` (version and archive URL) | crates.io sparse index |
| cargo-semver-checks | `reusable-api-compat.yml` (version and archive URL) | crates.io sparse index |
| cargo-llvm-cov | `validate-composition.yml`, `docs/LOCAL-COMPOSITION.md` | crates.io sparse index |
| cargo-mutants | `toolchains/cargo-mutants.json` (`version` and every release URL), `reusable-mutation-rust.yml` | crates.io sparse index |
| reuse | `tools/licensing/requirements.txt`, `validate-composition.yml`, `docs/LOCAL-COMPOSITION.md` | PyPI JSON document |
| shellcheck | `reusable-shell-lint.yml` | GitHub REST API, latest release |
| osv-scanner | `toolchains/osv-scanner.json` (`version` and every release URL), `install-toolchains.sh`, `docs/LOCAL-COMPOSITION.md`, `docs/toolchain/OSV-ADVISORY-DATABASE.md` | GitHub REST API, latest release |

Every listed site of a tool must write the same version. Two sites that
disagree make the pin `unreadable` rather than letting the report choose one.
The test suite reads every listed site in the tracked tree, so a pin that moves
or changes shape fails the pull request that moves it, not the next scheduled
run.

Sites that carry a version and are not read:

- `package.json` (`packageManager`), `CONTRIBUTING.md`, `REUSE.toml`,
  `docs/architecture/TOOLCHAIN.md`, the other fields of `toolchains/bun.json`
  and the Bun archive URL repeated in the workflows: they write the Bun version
  in other forms (without its revision, inside a tag or a path).
  `check:bun` and `ecosystem/check-toolchain-source.ts` hold the manifests and
  the archive URLs.
- the archive names of `toolchains/cargo-deny.json` and the executable paths
  built from the version in `install-toolchains.sh`;
- the note of a past generation in `ecosystem/fleet-pins.v1.yaml`, which is a
  record and does not move with the pin;
- comments in source files that say on which version a behaviour was measured;
- fixtures, evidence files and dated plans.

## Sources and their limits

Each tool is read where its releases are published, not necessarily where the
fleet installs it from: Bun on the npm registry (this repository installs the
archive of its own durable release), the cargo tools on the crates.io sparse
index, the Rust toolchain on the stable channel manifest, reuse on the PyPI
JSON document (pip resolves the Simple API of the same index). These reads are
anonymous and none has a request quota.

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
- Only crates.io lists every version. On the other sources a pinned version
  that was withdrawn is seen only when it is above the latest release.
- The Rust channel manifest dates a release by its day. The end of that day is
  kept, so a release is never read as older than it is.
- For the five cargo tools the date is the publication of the crate. The
  release archive the fleet downloads may follow it.
- shellcheck is pinned by image digest; the version compared is the comment
  written next to the digest. The digest is not resolved.
- A pinned version is accepted as `x.y.z`, with an optional pre-release and an
  optional build part of at most 32 characters each. The patterns that read a
  site accept any text without a blank; what they capture is then held to that
  form.
- Not compared: Node and the Playwright browsers of
  `toolchains/notebook-qualification.json`, the GitHub Actions pinned by
  commit, and the `rust-toolchain.toml` of the other repositories of the fleet.
  The bun dependencies of this repository are covered by `BUN-UPDATE.md`.

## How a result becomes visible

The workflow has two jobs. The first runs the report with a token that can
only read (`contents: read`). The second, whatever the first concluded, runs
the two steps every scheduled workflow of this repository carries
(`tools/security/repeat-failure-alert.ts`,
`docs/method/AGENTIC-LOOP-INVENTORY.md`), and is the only one whose token may
write an issue: a red run stays a run; the second consecutive red run opens
the issue `Toolchain freshness: two consecutive failed runs`, and the first
green run closes it. The lines of the report are in the log of the first job.

Moving a pin is done by hand, in a pull request: the report proposes nothing.
