# Square Control private publication candidate

Status: private staging state measured on 2026-10-14, remote frozen by the owner the same
day (section "Frozen state"), scan clean under the owner-arbitrated allowlist (section
"Owner decision"). Reviews are pending (`REVIEW.md`); two points are left to the owner
(section "Open points for the owner"). This document does not attest public availability.
Merging it is the owner signature of the exact private state it names (ADR-0038 D5) and of
nothing else: any different ref, object, head or manifest invalidates it. Every verdict below
is tied to its command, tool version and UTC time in `evidence/verification.json`.

Disclosure by design (ADR-0038 D5): this pull request lands in a public repository before the
candidate is exposed. It publishes the manifest, that is every ref name, 205 object IDs with
their sizes, and all 427 tree paths of the private candidate. The scan cleared exactly those
surfaces (ref names, tree paths, object metadata) before this record was written; the content
of the blobs is not published.

Authority: ADR-0038 as amended on 2026-10-14 by D78 (D2 attests every advertised ref,
`refs/pull/*` and forge-created branches included). Step 4 of the I-30 circuit.

## Candidate

- Repository: `libre-ai/square-control`, private staging, default branch `main`.
- Frozen candidate: `95e1bcea42e6c20c9fc8987b65b7c55de007d2f2` (`refs/heads/main`), pushed by
  the owner by exact-OID refspec with an empty-remote lease (ADR-0038 D4).
- 15 commits reachable from `main`. 17 commits in the attested set: the other two are
  forge-added (below).
- Attested ref set, 4 refs, equal in `git ls-remote --symref` and in the provider API
  (`evidence/ls-remote.txt`, `evidence/refs.git.txt`, `evidence/refs.api.txt`; `HEAD` is a
  symref to `refs/heads/main`):

  | Ref | OID | Origin |
  | --- | --- | --- |
  | `refs/heads/main` | `95e1bcea42e6c20c9fc8987b65b7c55de007d2f2` | owner push |
  | `refs/heads/dependabot/cargo/cargo-minor-and-patch-c3be8eb6fd` | `f192917b55875fc32db5c61bed573770c1fc12ef` | Dependabot, on the first push |
  | `refs/pull/1/head` | `f192917b55875fc32db5c61bed573770c1fc12ef` | pull request 1 |
  | `refs/pull/1/merge` | `b583cc527872bb4f20641a67f2c939a65ca7e6da` | pull request 1, test merge |

- Objects: 205 (17 commits, 86 trees, 102 blobs, 0 tags), 427 tree entries
  (178 trees mode 040000, 197 blobs mode 100644, 52 blobs mode 100755). No symlink, no
  gitlink, no annotated tag.
- Pre-push (frozen before the push): 193 objects (15 commits, 80 trees, 98 blobs), 397 tree
  entries, `refs/heads/main` only. All 193 are present on the remote with the same type and
  size; 12 objects were added by the forge (2 commits, 6 trees, 4 blobs).

## Manifest

RFC 8785 (JCS), schema `libre-ai.git-object-manifest.v2`, kept in full, no terminal newline.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `evidence/manifest.pre-push.jcs.json` (frozen before the push) | 81,044 | `f512f639fa8ec20d5ff57b4350e3f9f1e40fff5329805b9798c6328264233b20` |
| `evidence/manifest.jcs.json` (fresh mirror of all four refs) | 87,173 | `765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9` |

`manifest.jcs.json` is the attested manifest, the one the transition recomputes and compares
byte for byte. It was recomputed for this pull request from a fresh non-shallow mirror
(plain `git fetch '+refs/*:refs/*'` into an empty repository with the credential helper
configured globally, `git fsck --strict --no-dangling` exit 0) and is byte-equal to the copy the owner's verification
produced (`cmp` exit 0, same digest): the shell `manifest()` of that step, re-run on my
mirror, gives the same bytes. Two independent implementations give the same bytes and the
same digest: the TypeScript `buildManifest` and the standalone Python `canonicalize.py derive`
(see `CANONICALIZATION.md`). The pre-push manifest differs from the attested one only by the three
forge refs and the 12 forge objects; `manifest.pre-push.jcs.json` is the proof that the
owner's push reached the remote intact.

## Scans

Tool: `tools/attestation/git-attestation.ts` (reviewed in this pull request), run on the
mirror with `--trusted-ref refs/heads/main --attestation evidence/manifest.jcs.json` and the
nominative identity allowlist `evidence/identity-allowlist.json`. It reads every object
`cat-file --batch-all-objects` lists (205), a superset of the objects reachable from the four
refs; 0 objects are unreachable. Counters: 17 commits, 86 trees, 427 tree entries, 102
blobs (366,295 bytes), 4 refs, 2 commit signatures, 0 tags. Diagnostics carry a surface, a
class and an OID, never the matched bytes.

Result on the candidate under the allowlist of record (owner noreply identity anywhere; the
two forge identities and the forge trailer address for forge-added commits only):
`evidence/scan.json`, exit 0, 0 finding. Under the first allowlist, without the trailer
address, the same scan had exactly one finding (the trailer, below). The scope restriction
is enforced by the scanner: a forge-only address is removed from a message only when the
commit is not reachable from `refs/heads/main`, and never from a blob
(`red:strip-scope`, 2 tests, red when neutralised). Only delimited occurrences are removed: an
address glued to a longer local part or domain is a different address and stays visible
(`red:strip-boundary`, five bypass probes).

Each surface has a positive result on the candidate and a distinct failure on a synthetic
temporary repository (never the candidate). `bun test tools/attestation -t 'red:<id> '`
exits 0 when the scan reports the failure. `bun tools/attestation/neutralise-check.ts`
(wired into `bun run check` as `check:attestation`) states its denominator and then proves the
tests: it counts the refusal sites of the scanner with its own pattern, independently of the
markers (a line that emits a finding or throws), and requires each to carry a marker or an
exemption with a stated reason. `evidence/neutralisation.txt`: **65 refusal sites = 59
marked + 6 exempt, 0 uncovered**, no duplicate marker id. The 6 exemptions are the branches
that only guard the output contract of `git` itself (five lines of `cat-file` and
`for-each-ref` output, and a tree just listed by `--batch-all-objects`); no test can reach them
with a working `git`, and each says so in the source. Then **91 checks are neutralised in a
throwaway copy (73 marker ids and 18 text substitutions in the shell, Python, jq and window
code), 91 fail by assertion, 0 only crash, 0 stay green**. A failure that only crashes is
reported separately and does not count as caught.

| Surface (ADR-0038 D3) | Candidate | Red counter-proof (test id) |
| --- | --- | --- |
| Blob bytes, incl. a blob deleted later and UTF-16 text | 102 blobs, 0 finding | `red:blob-content` (9 cases), `red:content-<class>` (local-path, credential, cookie, personal-data, instance-config, denied-literal), `red:blob-limit` |
| Ref names | 4 refs, 0 finding | `red:ref-name` |
| Tree paths (bytes, UTF-8, component safety, capture and config file names) | 427 entries, 0 finding | `red:tree-path`, `red:tree-path-config`, `red:tree-path-capture`, `red:tree-path-unsafe`, `red:tree-path-bytes` |
| Tree entry mode and type | modes 040000/100644/100755 only, 0 finding | `red:tree-mode` (symlink, gitlink), `red:tree-type`, `red:tree-target-missing` |
| Author name, author address | 0 finding | `red:person-name`, `red:person-address` (author cases) |
| Committer name, committer address | 0 finding | `red:person-name`, `red:person-address` (committer cases) |
| Commit message | 0 finding (1 before the owner trailer decision, see Owner decision) | `red:commit-message` (credential, personal address), `red:strip-scope`, `red:strip-boundary` |
| Commit signature header | 2 signatures, 0 finding | `red:commit-signature` |
| Unhandled commit header, non-UTF-8 commit, malformed headers, absent parent, malformed person line | 0 finding | `red:commit-header`, `red:commit-utf8`, `red:commit-headers`, `red:commit-link`, `red:person-malformed`, `red:person-pair` |
| Tagger name, tagger address | no annotated tag; synthetic tag | `red:person-name`, `red:person-address` (tagger cases), `red:tagger-missing` |
| Tag message, tag name, extra header (passes `fsck --strict`), non-UTF-8, malformed headers, absent target | no annotated tag; synthetic tags | `red:tag-message`, `red:tag-name`, `red:tag-header`, `red:tag-utf8`, `red:tag-headers`, `red:tag-link` |
| Ref absent from the attestation | 0 | `red:ref-absent` |
| Attested ref whose OID changed | 0 | `red:ref-oid-changed` |
| Attested ref missing at the remote | 0 | `red:ref-missing` |
| Trusted ref missing | 0 | `red:trusted-ref` |
| Object type other than commit, tree, blob, tag | 0 | `red:object-type`, `red:manifest-type`; a loose object of type `bogus` makes `git cat-file` fail ("invalid object type"), which the scan reports as `object-store/fsck-failed` + `read/git-failure` |
| Shallow clone | not shallow | `red:shallow`, `red:manifest-shallow` |
| Unreadable or missing object, object no ref reaches, git failure | `git fsck --strict` exit 0, 0 unreachable | `red:fsck`, `red:unreachable`, `red:unreadable`, `red:tree-target-missing`, `red:tree-malformed`, `red:git-exit`, `red:git-failure` |
| Blob reading: UTF-16, UTF-8 compatibility forms, 32 KiB windows and their overlap | 102 blobs, 0 finding | `red:blob-utf16`, `red:blob-utf8`, `red:window-tail`, `red:window-overlap` |
| `.git`, `.` and `..` path components | 0 | `red:tree-path-dot` |
| Operator input: flags, base64 literals, identities file, attestation file | the committed inputs are accepted | `red:cli-*` (9), `red:identities-*` (7), `red:attestation-refs`, `red:attestation-ref`; every refusal exits 2, distinct from 1 (finding) |
| Manifest ASCII subset, serialisation, number subset | ASCII only | `red:manifest-ascii`, `red:manifest-number`, `red:python-verify`, `red:python-derive` (also under `python -O`) |
| Path holding a newline in the shell manifest (a defect found by review: the entry was dropped silently) | none in the candidate | `red:manifest-newline`, `red:manifest-count` |
| Frozen verdict: ruleset exclusions, bypass, wiki, Pages, discussions, alerts, security fixes, collaborator identity, unreadable controls | frozen = true | `red:frozen-*` (10), `provider-policy.test.ts` |

Content classes covered in blobs, paths, ref names, names and messages: machine-local paths
(home directories of three operating systems, temporary and volume paths), credentials
(the repository's own `containsCredentialMarker`, reused from
`tools/quality/public-source-scanner.ts`), cookies, personal data (any email address outside
the allowlist, French phone numbers, French IBAN), instance configuration (cloud endpoints,
`*_ADDON_URI`, `_authToken`, private network addresses, `.env`, key and state file names),
capture artefacts (`.har`, `.pcap`, browser stores). Three owner-specific literals (the local
user name, the former personal address domain, the private-context identifier) were passed
at run time as base64 `--deny-b64` arguments and are not written in this repository: 0 hit.

### Second instruments

- `gitleaks 8.30.1` on the mirror: no leak, on `refs/heads/main` and on every ref
  (`evidence/gitleaks.txt`).
- Reconciliation of the commit counts noted in the preparation (14 scanned, 15 counted):
  `git rev-list --count refs/heads/main` is 15 and gitleaks scans 14 there; over all refs it
  scans 15 of 17. The object-level read (`cat-file --batch-all-objects`) finds exactly two
  commits whose default patch is empty: `5db493842ede445da9ead13cc010bfb6d01450b8` (its tree
  equals its parent's tree) and the pull-request merge commit
  `b583cc527872bb4f20641a67f2c939a65ca7e6da` (two parents). 15 - 1 = 14 and 17 - 2 = 15.
  That a patch-less commit is not counted by gitleaks is a hypothesis consistent with both
  numbers; gitleaks source was not read. It leaves no byte unscanned, because the object
  scan reads blobs from the object database and neither commit introduces a blob or a tree
  that another commit does not already carry.
- Candidate gates reproduced from a clone of the mirror (`evidence/candidate-gates.txt`):
  `reuse lint` exit 0 (80/80 files), `scripts/check.sh` (fmt, clippy, tests, cargo-deny) exit 0.

- Actions run logs (S-F3 of the security review): the 8 workflow runs become public with the
  repository. Their logs were downloaded read-only (`gh run view <id> --log`, no run deleted),
  scanned with the same content classes (`git-attestation.ts text`) and kept out of this
  repository. Hits: 319 home-directory prefixes (310 `/home/runner/`, 9 `/home/dependabot/`,
  accounts of the hosted runner and of the Dependabot container, not a person) and 3 address
  occurrences (`noreply@github.com` twice, `support@github.com` once, the forge identities
  already admitted). No credential, cookie, instance-configuration or denied-literal hit
  (`evidence/actions-logs.txt`). PR 1's body holds no email address (checked by the security reviewer).

### Forge-added history

Two commits, reached by no trusted ref: `f192917b55875fc32db5c61bed573770c1fc12ef`
(Dependabot bump of the `cargo-minor-and-patch` group, 1 parent `main`) and
`b583cc527872bb4f20641a67f2c939a65ca7e6da` (test merge of pull request 1). Identities,
`evidence/identities.forge.txt`: `dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>`
and `GitHub <noreply@github.com>`. Both commits carry a GitHub signature header (scanned, 0 hit).
CI of every run, with head SHA, run id, URL and time: `evidence/ci.json` (8 runs, all success: push
runs on `95e1bcea…`, Dependabot update jobs, and pull-request runs on `f192917b…`). Its diff against `main` touches
only `Cargo.lock` and `Cargo.toml` files (`git diff --stat`, reproduced from the mirror).

## Owner decision

Owner decision 2026-10-14 (chat): forge trailer `dependabot[bot] <support@github.com>` admitted
for forge-added commits only (commits not reachable from `refs/heads/main`); `main` stays under
the owner noreply identity alone; same trailer measured on libre-ai/signalement Dependabot
commit 030add73 (second instrument). Before the decision the scan had one finding, on
`f192917b…`, whose message ends with that trailer.

### Open points for the owner

Two points are decided by the owner, not by this record, and stay open here:

1. The trailer decision above is recorded in this record and in `evidence/identity-allowlist.json`
   only; whether it also needs an entry in the decision register (with an `Owner-arbitration:`
   line, as D78 has) is the owner's choice.
2. The candidate's `main` carries no `SECURITY` file. The preparation noted that the security
   reporting surface must say, before step 5, that private vulnerability reporting exists only on
   public repositories and that the fleet channel is the destination. Nothing here changes the
   candidate, so the owner decides whether the surface is added (which would change the OID and
   force a new attestation) or accepted as is.

## Frozen state

ADR-0038 D5 requires a private remote with no contributor, workflow or automatism holding
write capability between this merge and the switch. The owner ran the five freeze commands of
`owner-freeze-commands.sh` on 2026-10-14 between about 08:05Z and the creation of the ruleset
at 08:06:12Z (the ruleset's `created_at`); I changed no setting. Before them the
readback (05:17:19Z) had `frozen = false` with six blockers: Actions enabled, `main` unprotected,
no ruleset, Dependabot configured with Actions enabled, PR 1 open, issues enabled.

After them, `evidence/provider-policy.json` (read-only readback, 2026-10-14T08:52:02Z, first
taken at 08:08:41Z and refreshed with the stricter check below): `frozen_check.frozen = true`, 0
blocker. The file is produced by `sh tools/attestation/provider-policy.sh libre-ai/square-control >
evidence/provider-policy.json`, which reads the controls and derives the verdict with
`provider-policy.frozen-check.jq` (tested in `provider-policy.test.ts`). The check now requires
that the ruleset excludes nothing, has a present and empty bypass list, and cannot be bypassed by the
reader; that wiki, Pages, discussions, projects, vulnerability alerts and automated security fixes
are off; that the sole collaborator is the owner by login; and an unreadable control is a blocker,
never an empty list. Read back: Actions `enabled = false`; ruleset
`frozen-staging-adr-0038` active on `~ALL` branches, rules creation, update, deletion and
non_fast_forward, no bypass actor; `main` classic protection with `lock_branch` and
`enforce_admins`; issues, wiki and projects off; secret scanning and push protection enabled;
default workflow token read-only; 0 secrets, variables, environments, webhooks, deploy keys,
teams, invitations; the owner is the sole collaborator. The advertised refs are unchanged (4
refs plus `HEAD`, same OIDs). Post-freeze re-reads, each timestamped in `evidence/verification.json`
(`ls-remote`, `refs-git-api`, `mirror-fsck`, `manifest-*`): `ls-remote.txt` and `refs.api.txt`
identical to the retained files, and a fresh mirror gives the same manifest bytes and sha256
`765fd6e9…dca9` in the shell, TypeScript and Python implementations.

Residual risks, listed in `frozen_check.residual_risks` and not hidden by `frozen = true`
(they cannot be removed without changing the OID or by the owner alone):

1. Dependabot version updates stay configured in the tree (weekly, Monday 06:00 Europe/Paris,
   next 2026-10-19T04:00:00Z). That they cannot run rests on Actions being disabled and on the
   ruleset; both are hypotheses not measured until a scheduled run passes. Step 5 refuses on any
   ref difference, so the failure mode is a refused switch and a new attestation.
2. Pull request 1 is open: `refs/pull/*` is provider-managed, no ruleset restricts it and the
   owner cannot delete it. Pull requests stay enabled on the repository: a new pull request would
   create `refs/pull/2/*`, which step 5 would refuse (a new attestation, not a leak).
3. The owner keeps administrative authority over every setting; it is not represented as
   revocable by these controls.

Consequence under the amended D2: any ref that appears, disappears or moves before step 5 makes
step 5 refuse and a new attestation is required.

## Exposure window: properties of the owner script

Three properties the security review asked of `commands.sh` (steps 5 and 6), fixed in the
owner's script and not part of this pull request's diff:

- step 5 checks that `HEAD` is a symref to `refs/heads/main` and that its OID is the attested one,
  not only the refs listed in the manifest;
- step 6 enumerates every ref anonymously, fetches a `+refs/*:refs/*` mirror and compares its
  manifest byte for byte with the merged one, instead of a plain clone that skips `refs/pull/*`;
- step 5 re-reads the frozen state (`provider-policy.sh`, `frozen = true`) immediately before the
  visibility call.

## Tools and versions

git 2.56.0, jq 1.8.2, gitleaks 8.30.1, reuse 6.2.0, cargo 1.97.0, cargo-deny 0.19.5, bun 1.4.0,
Python 3.14.8, macOS 26.6.2. Evidence time: 2026-10-14, 05:12 to 08:52 UTC; the final re-reads are in
`evidence/verification.json`. The mirror was fetched with plain `git fetch`, the credential helper
configured globally, no per-command configuration.

Reproduction, from a checkout of this pull request:

```sh
git init mirror && git -C mirror fetch https://github.com/libre-ai/square-control.git '+refs/*:refs/*'
REPO=libre-ai/square-control sh tools/attestation/manifest.sh mirror | cmp - docs/reviews/square-control-bootstrap/95e1bcea42e6c20c9fc8987b65b7c55de007d2f2/evidence/manifest.jcs.json
bun tools/attestation/git-attestation.ts manifest mirror libre-ai/square-control | cmp - docs/reviews/square-control-bootstrap/95e1bcea42e6c20c9fc8987b65b7c55de007d2f2/evidence/manifest.jcs.json
python3 -I tools/attestation/canonicalize.py derive mirror libre-ai/square-control docs/reviews/square-control-bootstrap/95e1bcea42e6c20c9fc8987b65b7c55de007d2f2/evidence/manifest.jcs.json
bun tools/attestation/git-attestation.ts scan mirror --identities docs/reviews/square-control-bootstrap/95e1bcea42e6c20c9fc8987b65b7c55de007d2f2/evidence/identity-allowlist.json --attestation docs/reviews/square-control-bootstrap/95e1bcea42e6c20c9fc8987b65b7c55de007d2f2/evidence/manifest.jcs.json --trusted-ref refs/heads/main
```

## Verdicts

- Candidate main `95e1bcea…` content (blobs, paths, modes, owner-authored history): no finding.
- Attested set (4 refs, 205 objects): 0 finding under the allowlist of record.
- Frozen remote: yes (`frozen = true`, 08:52:02Z), with the three residual risks above.
- Manifest: reproduced by four derivations, digest `765fd6e9…dca9`.
- Reviews: pending, `REVIEW.md`.

This record introduces no candidate or policy change. It must be reviewed and merged in
Governance under ADR-0038 before public visibility. The frozen-private recheck immediately
before exposure and the anonymous check after it remain mandatory.
