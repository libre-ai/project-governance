# Square Control private publication candidate

Status: private staging state measured on 2026-10-14. **Not yet signable**: two decisions
are open (sections "Open decision 1" and "Open decision 2"), and the remote is not frozen
(section "Frozen state"). This document does not attest public availability. Merging it
is the owner signature of the exact private state it names (ADR-0038 D5) and of nothing
else: any different ref, object, head or manifest invalidates it.

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
(`git fetch '+refs/*:refs/*'` into an empty repository, bounded read access, `git fsck
--strict --no-dangling` exit 0) and is byte-equal to the copy the owner's verification
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

Result on the candidate under the allowlist of the brief (owner noreply identity; the two
forge identities for forge-added commits only): `evidence/scan.strict.json`, exit 1,
**1 finding**, see "Open decision 1". Every other surface returns 0 finding.

Each surface has a positive result on the candidate and a distinct failure on a synthetic
temporary repository (never the candidate). `bun test tools/attestation -t 'red:<id> '`
exits 0 when the scan reports the failure; `bun tools/attestation/neutralise-check.ts`
forces the check to false in a throwaway copy and requires the matching test to fail
(`evidence/neutralisation.txt`: 40 checks, 40 RED, 0 not caught).

| Surface (ADR-0038 D3) | Candidate | Red counter-proof (test id) |
| --- | --- | --- |
| Blob bytes, incl. a blob deleted later and UTF-16 text | 102 blobs, 0 finding | `red:blob-content` (9 cases), `red:content-<class>` (local-path, credential, cookie, personal-data, instance-config, denied-literal), `red:blob-limit` |
| Ref names | 4 refs, 0 finding | `red:ref-name` |
| Tree paths (bytes, UTF-8, component safety, capture and config file names) | 427 entries, 0 finding | `red:tree-path`, `red:tree-path-config`, `red:tree-path-capture`, `red:tree-path-unsafe`, `red:tree-path-bytes` |
| Tree entry mode and type | modes 040000/100644/100755 only, 0 finding | `red:tree-mode` (symlink, gitlink), `red:tree-type`, `red:tree-target-missing` |
| Author name, author address | 0 finding | `red:person-name`, `red:person-address` (author cases) |
| Committer name, committer address | 0 finding | `red:person-name`, `red:person-address` (committer cases) |
| Commit message | **1 finding** | `red:commit-message` (credential, personal address) |
| Commit signature header | 2 signatures, 0 finding | `red:commit-signature` |
| Unhandled commit header, non-UTF-8 commit, absent parent | 0 finding | `red:commit-header`, `red:commit-utf8`, `red:commit-link` |
| Tagger name, tagger address | no annotated tag; synthetic tag | `red:person-name`, `red:person-address` (tagger cases), `red:tagger-missing` |
| Tag message, tag name | no annotated tag; synthetic tag | `red:tag-message`, `red:tag-name` |
| Ref absent from the attestation | 0 | `red:ref-absent` |
| Attested ref whose OID changed | 0 | `red:ref-oid-changed` |
| Attested ref missing at the remote | 0 | `red:ref-missing` |
| Trusted ref missing | 0 | `red:trusted-ref` |
| Object type other than commit, tree, blob, tag | 0 | `red:object-type`; a loose object of type `bogus` makes `git cat-file` fail ("invalid object type"), which the scan reports as `object-store/fsck-failed` + `read/git-failure` |
| Shallow clone | not shallow | `red:shallow`, `red:manifest-shallow` |
| Unreadable or missing object, object no ref reaches | `git fsck --strict` exit 0, 0 unreachable | `red:fsck`, `red:unreachable`, `red:tree-target-missing`, `red:commit-link` |
| Manifest ASCII subset, manifest serialisation | ASCII only | `red:manifest-ascii`, `red:python-verify` |

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

### Forge-added history

Two commits, reached by no trusted ref: `f192917b55875fc32db5c61bed573770c1fc12ef`
(Dependabot bump of the `cargo-minor-and-patch` group, 1 parent `main`) and
`b583cc527872bb4f20641a67f2c939a65ca7e6da` (test merge of pull request 1). Identities,
`evidence/identities.forge.txt`: `dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>`
and `GitHub <noreply@github.com>`. Both commits carry a GitHub signature header (scanned, 0 hit).
CI on the Dependabot head: `evidence/ci.dependabot-head.json`. Its diff against `main` touches
only `Cargo.lock` and `Cargo.toml` files (`git diff --stat`, reproduced from the mirror).

## Open decision 1: one address in a Dependabot trailer

The only finding is on `f192917b…`: its message ends with the trailer
`Signed-off-by: dependabot[bot] <support@github.com>`. `support@github.com` is not in the
nominative allowlist, so the scan correctly refuses it as an email address in a commit
message. My assessment, a hypothesis and not a measurement of GitHub's intent, is that it
is GitHub's public support address, not personal data, and that Dependabot writes it on
every commit. The allowlist of the brief is nominative; widening it is the owner's act:

- accept it: the merge of this pull request with `evidence/identity-allowlist.with-forge-trailer.json`
  as the allowlist of record (adds `support@github.com`, forge-added commits only;
  `evidence/scan.with-forge-trailer.json`: exit 0, 0 finding);
- refuse it: the forge-added commit cannot be attested while its message carries that address.
  Removing it means removing the Dependabot commit, which GitHub does not allow for
  `refs/pull/1/*` (D78), so the candidate could not be published as it stands.

## Open decision 2: remote not frozen

ADR-0038 D5 requires a private remote with no contributor, workflow or automatism holding
write capability between this merge and the switch. `evidence/provider-policy.json`
(read-only readback, 2026-10-14T05:17:19Z, `frozen_check.frozen = false`) names six blockers:

1. GitHub Actions are enabled with `allowed_actions: all` (the three workflows ran on the push).
2. `main` has no classic protection and no ruleset covers any branch (the owner is the sole
   collaborator, admin, and can push).
3. Dependabot version updates are configured in the tree (`.github/dependabot.yml`, weekly,
   Monday 06:00 Europe/Paris, next run 2026-10-19T04:00:00Z), and ran immediately on the
   first push.
4. Pull request 1 is open: `refs/pull/1/*` is a GitHub-managed namespace that no ruleset
   can restrict and the owner cannot delete.
5. Issues are enabled.
6. Rulesets: none, so creation of other refs is not blocked.

Also read back: default workflow token `read`, no workflow-created approvals, 0 secrets, 0
variables, 0 environments, 0 webhooks, 0 deploy keys, 0 teams, 0 pending invitations, secret
scanning and push protection `disabled`, vulnerability alerts and automated security fixes
disabled, private vulnerability reporting not available on a private repository.

What can and cannot be frozen, and the owner commands, are in the owner freeze script
delivered with this pull request (`owner-freeze-commands.sh`, commented, not executed by me;
no setting was changed). In short: Actions can be disabled and a ruleset can forbid creating,
updating or deleting any branch; Dependabot version updates have no switch other than
deleting the file, which changes the tree and therefore the OID, so the freeze rests on
two hypotheses I did not measure (with Actions disabled the Dependabot jobs do not run; a
branch ruleset without bypass stops the Dependabot app from creating its branch).
Consequence under the amended D2: any ref that appears, disappears or moves before step 5
makes step 5 refuse and a new attestation is required. That refusal is the designed outcome.

The owner freeze happens before merge. The readback is then refreshed with
`sh tools/attestation/provider-policy.sh libre-ai/square-control` and this pull request must
carry a file with `frozen_check.frozen = true`; a merge on the present file attests an
unfrozen remote. The owner keeps administrative authority over every setting; it is not
represented as revocable by these controls.

## Tools and versions

git 2.56.0, jq 1.8.2, gitleaks 8.30.1, reuse 6.2.0, cargo 1.97.0, cargo-deny 0.19.5, bun 1.4.0,
Python 3.14.8, macOS 26.6.2. Evidence time: 2026-10-14, 05:12 to 05:20 UTC.

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
- Attested set (4 refs, 205 objects): one finding, pending Open decision 1.
- Frozen remote: **no**, pending Open decision 2.
- Manifest: reproduced by four derivations, digest `765fd6e9…dca9`.
- Reviews: pending, `REVIEW.md`.

This record introduces no candidate or policy change. It must be reviewed and merged in
Governance under ADR-0038 before public visibility. The frozen-private recheck immediately
before exposure and the anonymous check after it remain mandatory.
