# G0 canonical repository bootstrap evidence

Date: 2026-07-16

## Canonical authority

- repository: <https://github.com/libre-ai/libre-ai> ;
- visibility: public ;
- default branch: `main` ;
- GitHub remains the accepted forge under decision D03 ;
- no Clever Cloud resource, DNS record, runtime secret or production environment was created.

GitHub is a US service and is not treated as sovereign runtime infrastructure. The repository contains public source, public toolchain archives and CI metadata only. Runtime and data residency decisions remain deferred to Clever Cloud Paris/UE at G4.

## Qualified bootstrap toolchain

The repository-wide runtime floor is Bun `>=1.4.0`; shared CI additionally requires the exact qualified revision below.

Prerelease [`toolchain-bun-1.4.0-canary.1-57f349f63`](https://github.com/libre-ai/libre-ai/releases/tag/toolchain-bun-1.4.0-canary.1-57f349f63) preserves:

- Linux x64 and macOS ARM64 upstream binaries ;
- exact Bun source commit `57f349f6307cf89dcfb8893f003c1ef421a74589` ;
- pinned WebKit revision `4895f45dfbd0d1226c4d41799887bc0ecb9f341b` ;
- upstream licence, relinking notice and SHA-256 checksums.

The release is bootstrap-only and does not qualify the canary for production.

## Continuous integration

Workflow `.github/workflows/ci.yml` uses actions pinned by immutable commit, downloads the Bun binary from the canonical release, verifies its SHA-256 and revision before frozen dependency installation, then runs Bun and Rust quality/supply-chain gates.

- initial qualification run: [`29491575814`](https://github.com/libre-ai/libre-ai/actions/runs/29491575814) ;
- final G0 run on `28b478a`: [`29491734252`](https://github.com/libre-ai/libre-ai/actions/runs/29491734252) ;
- required job contexts: `Bun quality`, `Rust quality` ;
- both runs passed.

## Main protection

GitHub branch protection for `main` enforces:

- changes through pull requests, including administrators ;
- strict successful `Bun quality` and `Rust quality` checks ;
- stale review dismissal ;
- conversation resolution ;
- no force-push ;
- no branch deletion.

No approval count or CODEOWNERS review is required during the solo bootstrap. `.github/CODEOWNERS` records target teams, but enforcement must remain disabled until those teams exist and at least two maintainers can review without deadlocking their own changes.

## Security configuration

Enabled repository controls:

- private vulnerability reporting ;
- secret scanning ;
- secret scanning push protection ;
- vulnerability alerts ;
- automated security fixes ;
- web commit sign-off ;
- automatic deletion of merged branches.

Wiki and Projects are disabled to keep goals, decisions and work status inside versioned repository files.
