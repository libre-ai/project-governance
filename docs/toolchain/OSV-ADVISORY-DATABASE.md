# osv-scanner and the offline advisory database in the composition

Decision of the owner on 2026-10-23 (project-governance#147, answer 1): the
composition provides the second instrument of the LangGraph advisory gate
(ADR-0058 section 3, condition 1) instead of leaving every consumer to install
it. First consumer: `libre-ai/execution-continuity-evaluator`, whose
`check:langgraph-advisories` needs the scanner binary and a database no older
than 7 days as soon as a package of the LangGraph family is declared.

## What the composition provides

| Item | Where it comes from | What the consumer sees |
| --- | --- | --- |
| `osv-scanner` 2.7.0, linux-x64 | `toolchains/osv-scanner.json`, installed by `.github/composition/install-toolchains.sh` after a sha256 check and a version check | on `PATH`, and its path in `LIBRE_AI_OSV_SCANNER` |
| the npm advisory database | `.github/composition/download-advisory-database.py`, run between the toolchain installation and the checks of `validate-composition.yml` | `<cacheDirectory>/osv-scalibr/npm/all.zip` in the target checkout, whose modification time is the download time of that job |

The database is provided only to the targets listed in
`OFFLINE_ADVISORY_DATABASES` (`.github/composition/prepare-composition.py`),
today `execution-continuity-evaluator`: its lockfile `tools/review/bun.lock`
selects the ecosystem to download and `.cache/osv-advisory-db` is the directory
its gate reads. Any other target prints "not required" and downloads nothing.
The table is static on purpose, like the Cargo sibling sources: a target's own
files do not get to ask the runner for a download. The scanner binary is
installed for every target; it is the one fixed cost, and a 55 MB file.

## What it costs, and how it fails

- The database is a network download made by the scanner at job time, once per
  job: 219,024,873 bytes and between 2 and 5 minutes on 2026-10-24 (two runs
  from a macOS arm64 machine; the consumer's author measured about 3 minutes).
  The composition never ships a database and never reuses one from a previous
  job.
- The step deletes the previous file before downloading: a second
  `--download-offline-databases` leaves an existing file, and its date, untouched.
- The job fails closed. The step is red if the scanner exits with anything but 0
  or 1, or if the file is absent, empty or older than the start of the step after
  the scanner returns. There is no retry and no fallback: a missing database is
  never a green, and the gate of the consumer would also refuse it.
- Exit 1 ("scanned, advisories found") does not fail the step. Judging the
  advisories is the work of the consumer gate; this step only provides the
  instrument.

## What a consumer does

Move the pin of `libre-ai/project-governance/.github/workflows/validate-composition.yml@<sha>`
and its `tooling_ref` input to a commit that contains this change. Both name the
same commit, because the installer, the downloader and `toolchains/osv-scanner.json`
are read from the tooling checkout, not from the composed `project-governance`
(whose ref moves in a later pull request). Nothing else is needed: the consumer
keeps its `sync:osv-advisory-db` script for local use.

## Maintaining the pin

- Bump `toolchains/osv-scanner.json` from the release (`gh api
  repos/google/osv-scanner/releases`), take the digests from the release assets
  and cross-check them against `osv-scanner_SHA256SUMS`, and keep the release at
  least 3 days old (`minimumReleaseAge`, `bunfig.toml`).
- Change `OSV_SCANNER_VERSION` in `install-toolchains.sh` and the digest asserted
  in `test_install_toolchains.py` with it.
- Re-measure `offlineDatabase.file` for the new version; the consumer gate carries
  the same path and reads a layout that moved as "database absent".
- A second consumer is one entry in `OFFLINE_ADVISORY_DATABASES` and its test.

## Limits

- The installer supports linux-x64 only, like the other composition toolchains.
  The `darwin-*` and `linux-arm64` entries of the policy pin the same release for
  a manual local install; no step of this repository installs them.
- The pull request that introduced this runs the changed tests and the
  composition of this repository, where the target `project-governance` does not
  require the database. The download itself runs for the first time in a consumer
  that moved its pin.
