# Independent attestation reviews

ADR-0038 D5 requires independent security, quality and completeness reviews, run in separate
contexts on an immutable pushed commit. Three rounds were run on this pull request, each by
separate reviewer contexts that did not author the change (Claude Opus 5.5, `claude-opus-5-5`,
read-only on GitHub). The records below are reproduced verbatim, apart from machine-local paths,
which are replaced by a generic form ("owner notes", "session scratchpad"), and for the made-up probe
addresses of the reviewers, whose @ is written [at] so that the repository's personal-data gate
stays green; no verdict, finding or
number is altered. They are in order: round 1 at `bd195d65`, round 2 at `a9d6d7fd`, round 3 at
`41dff5a4` (security and completeness as deltas). The author wrote none of them.

| Round | Reviewed head | Security | Quality | Completeness |
| --- | --- | --- | --- | --- |
| 1 | `bd195d65` | PASS WITH NOTES | FAIL (B1 to B3; partial record) | FAIL (G1, G2) |
| 2 | `a9d6d7fd` | PASS WITH NOTES | FAIL (B4) | PASS WITH NOTES |
| 3 | `41dff5a4` | PASS WITH NOTES | FAIL (B5, documentation only) | PASS WITH NOTES |

The head that carries the fixes of round 3 is `a22ad629401b7126449f72d85a864d8977cd9d64`; the record and the table at the end are
in the commit after it. No fourth round was run: the coordinator records that the last quality
blocker (B5) is a count in the documentation, fixed and checked by the tool's own census.

## Round 1 at bd195d65

### Security review

- Reviewed PR head: `bd195d6595cec75d5c62bc9308542601ed09f44d` (`gh pr view 114 -R libre-ai/project-governance --json headRefOid`, re-read at 08:19Z and unchanged)
- Governance revision (served branch `migrate/recover-code`, from `git ls-remote --symref`): `79fec02485697c739c47fe2ef7365fdc6314db0f`, which is ADR-0038 as amended by D78 (#113)
- Candidate: `libre-ai/square-control` `95e1bcea42e6c20c9fc8987b65b7c55de007d2f2`, manifest sha256 `765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9`
- Date: 2026-10-14, 08:14–08:19 UTC
- Reviewer: Claude Opus 5.5 (`claude-opus-5-5`), independent context, read-only

**Verdict: PASS WITH NOTES.** Merging this PR does not expose anything by itself. The attested Git state was reproduced byte for byte and scans clean. The findings below concern the scanner, `frozen_check`, the owner transition script and non-Git surfaces. None makes the current attestation false. F1, F2 and F3 must be addressed before `commands.sh 5` runs.

#### Findings

**F1. Non-blocking for merge; fix before step 5.** `the owner's commands.sh (owner notes):188-197`: step 5 never checks the `HEAD` symref.
- ADR-0038 D2 says `HEAD` is checked separately as a symref to the authorised branch. Step 5 drops the `ref:` line and the `HEAD` line (`awk '$1!="ref:" && $2!="HEAD"'`). The manifest has no `HEAD` either, because the mirror fetch is `+refs/*:refs/*`.
- Failure scenario: the default branch is switched to the Dependabot branch before the switch. Step 5 still passes and the repository goes public with a non-attested default branch. No unattested object is exposed.
- Shown by feeding step 5's own comparisons an `ls-remote` file whose `HEAD` points to `refs/heads/dependabot/...`: `ref-set check: PASS`, `main check: PASS`.
- Fix: add `grep -qx 'ref: refs/heads/main	HEAD' "$MERGED.refs"` and check that the `HEAD` OID equals `$EXPECTED_HEAD`.

**F2. Non-blocking for merge; fix before step 5.** `commands.sh:203-210`: step 6 does not do the "énumération complète" that D5 requires.
- Step 6 runs a plain `git clone`, which fetches heads and tags only, not `refs/pull/*`. It checks `HEAD` and runs the gates. It does not enumerate all advertised refs, does not compare against the merged manifest and does not run the history scan.
- Failure scenario: a ref changes between line 197 (manifest `cmp`) and line 199 (`gh repo edit --visibility public`), for example GitHub regenerating `refs/pull/1/merge`. No ruleset covers that namespace, and the readback shows `mergeable_state: blocked`. The new state becomes public and nothing ever detects it.
- That window cannot be closed before the switch. D5 compensates with the post-exposure check, and that check is missing here.
- Fix: in step 6, run anonymous `ls-remote` plus a `+refs/*:refs/*` mirror, then `manifest | cmp - "$MERGED"`.

**F3. Non-blocking for merge; address before step 5.** No PR file covers this: GitHub Actions run history becomes public at the switch and is neither attested nor scanned.
- There are 8 workflow runs: ci, licensing and Context hygiene on push and on the PR, plus two Dependabot `dynamic` update jobs. Their logs become publicly readable when the repository turns public. Artifacts, caches and releases are 0.
- I did not download the logs, so their content is unmeasured. Low expected risk: 0 Actions secrets and GitHub-hosted runners.
- Command: `gh api "repos/libre-ai/square-control/actions/runs?per_page=100" --jq .total_count` returns `8`.
- Fix: delete the runs before step 5 (this changes no ref), or scan the logs and record the result.
- Also exposed at the switch: the PR #1 body (5,769 chars). I checked it: 0 email addresses.

**F4. Non-blocking.** `tools/attestation/provider-policy.sh:98-101`: the ruleset test can report `frozen = true` on a remote that is still writable.
- It ignores `conditions.ref_name.exclude`.
- It reads a missing `bypass_actors` as empty, because `null | length` is 0. That is a fail-open when the reader is not an admin.
- It does not check `current_user_can_bypass`.
- Mutating the committed readback and re-running the same jq program (lines 88-121) gives:
  - `bypass_actors` deleted → `frozen: true`
  - `exclude=["refs/heads/dependabot/**/*"]` → `frozen: true`
- The committed readback has `exclude: []`, `bypass_actors: []` and `current_user_can_bypass: "never"`, so the current verdict is correct. The defect is in the instrument.

**F5. Non-blocking.** `provider-policy.sh:89-111`: `frozen_check` ignores several surfaces that change exposure or refs.
- Not checked: `has_wiki` (a separate Git repository that goes public with the repo), `has_pages`, `has_discussions`, `automated_security_fixes`, `vulnerability_alerts`, and the identity of the single collaborator (the test is only `length != 1`).
- Setting all five settings to true and renaming the collaborator still gives `frozen: true`.
- Current values are all off or false, so this is a coverage gap only.
- No tag ruleset is required. Tag writes by the sole admin are caught by step 5 only.

**F6. Non-blocking.** Step 5 (`commands.sh:179-200`) does not re-run `provider-policy.sh` immediately before the switch.
- The freeze is recorded once, at 08:08:41Z. A setting re-enabled later (Actions, ruleset) is only detected if a ref has already moved.
- D5's literal check (refs + mirror + manifest) is met. The freeze precondition itself is not re-verified.

**F7. Non-blocking.** `tools/attestation/git-attestation.ts:355-366` (`stripAllowedAddresses`) removes allowlisted addresses as raw substrings, with no local-part boundary.
- A different address whose suffix is an allowlisted one is masked.
- Probe through the exported `contentClasses` with the committed allowlist:
  - `jane.doe.support[at]github.com` in a forge-added message → `[]`
  - `jane-noreply[at]github.com` in a forge-added message → `[]`
  - `jane.doe74049135+constantin-jais@users.noreply.github.com` in a blob or a `main` message → `[]`
  - Control: `jane.doe[at]proton.me` → `["personal-data"]`
- Scope enforcement itself holds: `support@github.com` in a non-forge message gives `["personal-data"]`, the person checks admit forge identities only when `forgeAdded`, and tagger checks always use owner scope.
- On the candidate, the regex `[A-Za-z0-9._%+-](support@github\.com|noreply@github\.com|74049135\+constantin-jais@...)` over all 205 decompressed objects (`git cat-file --batch-all-objects --batch`) finds 0 masked occurrences.
- Fix: strip only when the address is delimited, i.e. not preceded by `[A-Za-z0-9._%+-]`.

**F8. Non-blocking.** `tools/attestation/canonicalize.py:109-117`: every verification is an `assert`. Under `-O` or `PYTHONOPTIMIZE`, the second instrument passes anything.
- `python3 -I -O canonicalize.py derive mirror libre-ai/square-control bogus.json` (where `bogus.json` is `{}`) exits 0 and prints "derived 87173 bytes".
- Without `-O` it raises `AssertionError: derived bytes differ from the retained manifest`.
- Fix: replace the asserts with explicit `if …: sys.exit(1)`.

**F9. Non-blocking.** The governance repository is PUBLIC (`gh repo view libre-ai/project-governance --json visibility`). The pushed PR has therefore already published the private candidate's metadata: all ref names, 205 object IDs and sizes, and all 427 tree paths.
- These are the same surfaces the scan cleared, and a grep of the PR diff for the local user name, `/Users/`, `/var/folders`, `/private/var`, `pm.me` and `proton` finds 0 hits.
- This should be stated as a known property of D5, which archives the manifest in a public repository before exposure.

**F10. Non-blocking (documentation).** `ATTESTATION.md:90`: the surface table says "Commit message | **1 finding**", but lines 70 and 200 and `evidence/scan.json` say 0 findings under the allowlist of record. The "1" is the pre-decision state.

**F11. Residual risks, recorded as such.**
- Object format is SHA-1. Equality of manifests implies equality of content only under SHA-1 collision resistance; git's SHA-1DC detection is the mitigation.
- The scanner decodes blobs as latin1, UTF-16LE (only when the blob has a NUL byte) and UTF-8. It does not decompress archives or images, and it does not decode UTF-16BE. On this candidate it does not matter: 0 of 102 blobs contain a NUL byte, and paths are only text or source files.
- GitHub keeps unadvertised objects fetchable by SHA after a repository goes public. The activity API shows exactly 2 events, both `branch_creation` (main by the owner, then the Dependabot branch), and no force-push or deletion. So no pushed orphan object is known.

#### Checked and holding
- **Ref coverage:** the scan compares every local ref with the attestation in both directions (absent, OID changed, missing) and reads every object from `cat-file --batch-all-objects`. Objects not reachable from any ref are refused.
- **Fail-closed behaviour:**
  - shallow clone → finding;
  - `fsck --strict` failure → finding;
  - any git error → `read/git-failure`;
  - unhandled commit or tag header → finding;
  - non-UTF-8 commit or path → finding;
  - modes outside {100644, 100755, 40000} → finding.
- **Diagnostics never echo the sensitive byte:** git stderr is dropped, and findings carry only surface, class and OID.
- **Forge-only scope:** a commit reachable from `refs/heads/main` never receives forge identities or forge-address stripping. A blob is never stripped of a forge address. Running the scan without `--trusted-ref` gives 9 findings, which shows the scope is what admits the forge identities.
- **Remote state:** the activity API confirms the remote's only history is the owner push and the Dependabot branch creation.

#### Reproduction (raw results)

```
$ git ls-remote https://github.com/libre-ai/square-control.git
95e1bcea42e6c20c9fc8987b65b7c55de007d2f2  HEAD
f192917b55875fc32db5c61bed573770c1fc12ef  refs/heads/dependabot/cargo/cargo-minor-and-patch-c3be8eb6fd
95e1bcea42e6c20c9fc8987b65b7c55de007d2f2  refs/heads/main
f192917b55875fc32db5c61bed573770c1fc12ef  refs/pull/1/head
b583cc527872bb4f20641a67f2c939a65ca7e6da  refs/pull/1/merge
$ git init -q mirror && git -C mirror fetch -q https://github.com/libre-ai/square-control.git '+refs/*:refs/*'   # exit 0
$ git -C mirror rev-parse --is-shallow-repository   -> false
$ git -C mirror fsck --strict --no-dangling          -> exit 0; in-pack: 205
$ shasum -a 256 evidence/manifest.jcs.json           -> 765fd6e9...dca9 (87173 bytes)
$ REPO=libre-ai/square-control sh tools/attestation/manifest.sh mirror | shasum -a 256   -> 765fd6e9...dca9; cmp exit 0
$ bun tools/attestation/git-attestation.ts manifest mirror libre-ai/square-control | cmp - evidence/manifest.jcs.json   -> exit 0
$ python3 -I tools/attestation/canonicalize.py derive mirror libre-ai/square-control evidence/manifest.jcs.json
derived 87173 bytes, sha256 765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9
$ bun tools/attestation/git-attestation.ts scan mirror --identities evidence/identity-allowlist.json --attestation evidence/manifest.jcs.json --trusted-ref refs/heads/main
exit 0; counters {objects 205, commits 17, trees 86, treeEntries 427, blobs 102, blobBytes 366295, tags 0, refs 4, signatures 2, unreachableObjects 0}; findings []; identical to evidence/scan.json (jq -S diff empty)
$ same scan without --trusted-ref   -> exit 1, 9 findings (author/committer name+address on b583cc52 and f192917b, commit-message personal-data on f192917b)
$ bun test tools/attestation   (fresh clone at bd195d6, bun install --frozen-lockfile)
75 pass, 0 fail, 143 expect() calls
$ bun tools/attestation/neutralise-check.ts
41 check(s) neutralised, 0 not caught   (exit 0)
$ gh api "repos/libre-ai/square-control/activity?per_page=100"
2026-10-14T04:43:18Z branch_creation refs/heads/dependabot/... 0000...0000 -> f192917b dependabot[bot]
2026-10-14T04:41:59Z branch_creation refs/heads/main 0000...0000 -> 95e1bcea constantin-jais
$ gh api "repos/libre-ai/square-control/actions/runs?per_page=100" --jq .total_count   -> 8   (artifacts 0, caches 0, releases 0, PR #1 comments 0)
```

### Quality review (partial record)

The quality reviewer's write was interrupted: the file below stops in the middle of a
sentence in finding B2. It is included as it stands. The verdict as reported to the coordinator is
**FAIL with three blocking findings, B1 (mutation proof covers markers, not checks), B2 (the scan
CLI fails open on malformed input) and B3 (`manifest.sh` drops tree entries whose name holds a
newline)**; the full texts of B2 and B3 are not in the file.

### Quality review

- Reviewed OID: `bd195d6595cec75d5c62bc9308542601ed09f44d`. This is the PR head (`gh pr view 114 -R libre-ai/project-governance --json headRefOid`), so it matched the mandate.
- Governance revision: served branch `migrate/recover-code` at `79fec02485697c739c47fe2ef7365fdc6314db0f`, from `git ls-remote --symref https://github.com/libre-ai/project-governance HEAD`. This is also the PR's merge-base.
- Date: 2026-10-14T08:22Z
- Reviewer model: Claude Opus 5.5 (`claude-opus-5-5`), independent quality reviewer (ADR-0038 D5). I did not author the change.
- Environment: fresh clone, `bun install --frozen-lockfile`, Bun 1.4.0, git 2.56.0, jq 1.8.2, macOS.

**Verdict: FAIL.** There are 3 blocking findings. None of them invalidates the retained Square Control evidence, for three reasons:
- The scan ran with valid inputs. The scopes in `identity-allowlist.json` are 1 × `anywhere` and 3 × `forge-added-only`.
- `--attestation` was given a value.
- The shell and TypeScript manifests were byte-equal on the real mirror.

The findings block merging `tools/attestation/*` as reusable tooling, and they block the proof-completeness claim as worded.

#### Claimed counts: reproduced
- `bun run check` exit 0. Full `bun test` inside it: **1995 pass / 0 fail across 91 files**.
- `bun run attestation:neutralise` exit 0: baseline exit 0, then **"41 check(s) neutralised, 0 not caught"**. That is 38 `// neutralise:` markers plus 3 file mutations, matching the committed `neutralisation.txt` line for line.
- `bun run check:reuse`: compliant, 716/716 files with copyright and licence information. `tools/**` is covered by the `REUSE.toml` annotation.
- `canonicalize.py verify` on both retained manifests: 87173 bytes, sha256 `765fd6e9…`; and 81044 bytes, sha256 `f512f639…`. Both match `ATTESTATION.md`.
- `scan.json` counters add up: commits 17 + trees 86 + blobs 102 + tags 0 = objects 205.
- No machine-local absolute paths in the changed files outside `git-attestation.ts`, which builds its detection patterns from parts. `check:context-hygiene` is green.

#### Findings

**B1 (blocking): the mutation proof covers the markers, not the checks, and the source says otherwise.**
- `tools/attestation/git-attestation.ts:23-27` states: "every check is one `if` tagged `neutralise:<id>`". That is false.
- At least 12 refusal branches carry no marker. I mutated 18 sites by exact substitution, one at a time, and ran the full `git-attestation.test.ts` each time. **11 of those 12 unmarked branches stay green (exit 0, 71 pass, 0 fail):**
  - tag `link-missing` (:760)
  - tag `header-not-handled` (:765)
  - tag `not-utf8` (:744)
  - tag `headers-malformed` (:749)
  - commit `headers-malformed` (:703)
  - person `header-malformed` (:663)
  - `unreadable` (:558)
  - the type-not-handled push loop (:536)
  - the `buildManifest` type check (:255)
  - the `readAttestedRefs` validation (:784)
- **Other untested logic, also green under mutation (5 more):**
  - windowing reduced to the first 32 KiB only (:343)
  - window overlap set to 0 (:340)
  - the UTF-8 blob pass disabled (:609)
  - the `.git`/`.`/`..` component test (:648)
- **Reachable in practice:** the tag extra-header refusal can be reached past `git fsck --strict`. A tag object carrying an `x-extra` header gives fsck exit 0, and the scan reports only `tag:header-not-handled`. Neutralise that line and the header's content is never scanned, yet no test turns red.
- **Caught (5 of 18):** pair-mismatch, the number check, address stripping, the git-failure catch, and the 12th unmarked branch. The pair-mismatch branch (:677) is caught only because one `red:person-name` test happens to exercise it.
- Reproduce: copy the clone, apply one substitution, e.g. `if (!known.has(header.value)) add("tag", "link-missing"` → `if (false && !known.has(header.value)) …`, then run `bun test tools/attestation/git-attestation.test.ts`.
- Fix: either add markers and `red:` tests for each refusal branch, or narrow the claim. In both cases, print the unmarked-check count so the 41 has a stated denominator (gate-integrity §2).

**B2 (blocking): the scan CLI fails open on malformed operator input.**
- (a) `option()` at :790-793 takes `args[index+1]` blindly. `scan . --identities ids.json --attestation` with the value missing returns **exit 0, findings `[]`**. The same repo with `

### Completeness review

- Reviewed PR head: `bd195d6595cec75d5c62bc9308542601ed09f44d`. This matches `gh pr view 114 --json headRefOid` at 2026-10-14T08:14:08Z.
- Governance revision (served branch `migrate/recover-code`, resolved with `git ls-remote --symref`): `79fec02485697c739c47fe2ef7365fdc6314db0f`. That commit is the merge of #113 (D78), and it is the PR's merge-base.
- Candidate: `libre-ai/square-control` `95e1bcea42e6c20c9fc8987b65b7c55de007d2f2`. Manifest sha256: `765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9`.
- Date: 2026-10-14, 08:14 to 08:30 UTC.
- Reviewer: Claude Opus 5.5 (`claude-opus-5-5`), separate agent context, read-only.

**Verdict: FAIL.** Two blocking defects, both in the record itself (G1, G2). The record contradicts itself on the commit-message verdict, and the neutralisation evidence file it cites is stale. Every substantive ADR-0038 / I-30 obligation that applies at step 4 checks out on re-run (see the matrix). Fixing G1 and G2 touches only the dossier, not the candidate.

#### Matrix: ADR-0038 (D2 as amended by D78) and I-30 → PR → status

Paths are relative to `docs/reviews/square-control-bootstrap/95e1bcea…/`, written `A:` for `ATTESTATION.md`, `E/` for `evidence/`.

| # | Obligation | Where in PR | Status |
|---|---|---|---|
| D1 | Private staging, outside the portfolio; no inventory entry before the public switch | The PR diff has no file under `ecosystem/` or `distribution/`; the only change outside the dossier and `tools/attestation/` is one script line in `package.json` (`attestation:neutralise`). `E/provider-policy.json:192,222` private | met |
| D1 | Name and enrolment signed first | #108 MERGED 2026-10-14T01:43:55Z (`43ed26e5`) | met |
| D2 | Every advertised ref with its OID, `refs/pull/*` and forge branches included | `A:20-29`; `E/ls-remote.txt`, `E/refs.git.txt`, `E/refs.api.txt` (4 refs, the same in all three). Fresh `ls-remote` at 08:14Z: the same 4 refs plus `HEAD`, same OIDs | met |
| D2 | `HEAD` checked separately as a symref | `E/ls-remote.txt:1`, `A:21-22` | met |
| D2 | Manifest kept in full, not only its digest | `E/manifest.jcs.json`, 87,173 B, no terminal newline, 0 non-ASCII bytes | met |
| D2 | Manifest holds repository, schema, sorted `{ref,oid}`, sorted `{oid,type,size}` | keys `repository, schemaVersion (v2), refs, objects, treeEntries, gitObjectFormat` | met |
| D2 | SHA-256 of the JCS bytes | `A:45`, `CANONICALIZATION.md:31`; recomputed `765fd6e9…dca9` | met |
| D2 | Tool versions, commands, UTC timestamp, verdicts | Versions only as prose (`A:184-185`), reproduction commands at `A:189-195`, verdicts at `A:197-203`. Single time range "05:12 to 08:10 UTC". No machine-readable verification record (the precedent has `evidence/verification.json`). Evidence files carry no per-file timestamp or command, except `E/provider-policy.json` (`observed_at`) and `E/gitleaks.txt` (commands) | partially (G4) |
| D2 | Only commit/tree/blob/tag; fail closed on missing, shallow, unreadable, unknown type, ref outside the attestation, ref with a different OID | `A:95-101`; tests `red:object-type`, `red:shallow`, `red:fsck`, `red:ref-absent`, `red:ref-oid-changed`, `red:ref-missing` (each filter run: 1 pass). Scan against `manifest.pre-push.jcs.json` → exit 1, finding `ref-set` | met |
| D2 | Archived under `docs/reviews/` | yes | met |
| D3 | Blob bytes, including a blob deleted later | `A:84`; `git-attestation.test.ts:245` | met |
| D3 | Ref name bytes, tree path bytes, entry type and mode | `A:85-87`; `red:ref-name`, `red:tree-path*` (`test.ts:384-391`, templated ids), `red:tree-mode`, `red:tree-type` | met |
| D3 | Author name, author address, committer name, committer address, message, each separately | `A:88-90`; `test.ts:419-422, 490, 496` | met, but `A:90` contradicts the verdict (G1) |
| D3 | Tagger name, address, message (synthetic tag) | `A:93-94`; `test.ts:557, 563, 572`; `red:tagger-missing`, `red:tag-name` pass | met |
| D3 | Content classes: local paths, secrets, cookies, PII, capture artefacts, instance config | `A:104-112`; `red:content-${klass}` (`test.ts:238`) | met |
| D3 | Nominative identity allowlist, no open category | `E/identity-allowlist.json` (4 entries: owner `anywhere`, 3 `forge-added-only`) | met. The scope rule discriminates: without `support@github.com` there is 1 finding (`commit-message/personal-data`, `f192917b`); with only the owner entry there are 9 findings across author/committer/message |
| D3 | Diagnostics never echo the sensitive byte | `E/scan.json` and the probe output hold surface, kind and OID only | met |
| D3 | A positive result and a red counter-proof per surface | `A:82-102`. 75 tests pass. `neutralise-check.ts` re-run: 41 neutralised, 0 not caught | met; the cited evidence file is stale (G2) |
| D4 | Push by exact OID with an empty lease | `A:16-17`; `manifest.pre-push.jcs.json` (193 objects, 1 ref) is a strict subset of the attested set (0 objects missing; 12 added = 2 commits, 6 trees, 4 blobs) | met, as asserted (the owner act is not independently observable) |
| D4 | Fresh non-shallow `+refs/*:refs/*` mirror reproduces refs, objects and manifest | Re-run: shallow=false, `fsck --strict` 0, 205 objects (17 commits, 86 trees, 102 blobs); `manifest.sh`, TS and Python derivations each byte-equal (`cmp` 0) | met |
| D4 | Candidate gates on the mirror | `E/candidate-gates.txt` (reuse 80/80, `check.sh` exit 0) | met (not re-run by this reviewer) |
| D4 | Provider API equality | `E/refs.api.txt` equals `E/refs.git.txt` | met |
| D5 | Attestation names remote OIDs, keeps the manifest, positive results and red counter-proofs | `A:13-102` | met |
| D5 | Independent security, quality and completeness reviews | `REVIEW.md:14-18` all pending | missing (expected at this stage; gate item 6 is open) |
| D5 | Frozen remote with no write capability; readback after the freeze | `E/provider-policy.json:115-124`: `frozen=true`, 0 blockers, `observed_at 08:08:41Z`, after the ruleset `created_at 08:06:12Z`; Actions disabled, ruleset on `~ALL` with no bypass, `lock_branch` and `enforce_admins` set, sole collaborator is the owner. Re-read at 08:15Z: ruleset still active, repository private | met |
| D5 | Residual risks named | `A:167-180`, `E/provider-policy.json:118-122`: Dependabot weekly run next 2026-10-19T04:00Z (the config reads Monday 06:00 Europe/Paris, CEST → 04:00Z: correct), `refs/pull/*`, owner admin | met (G5 adds one) |
| D5 | Says it does not attest public availability, and that any different ref, object, head or manifest invalidates it | `A:5-8`, `A:205-207` | met |
| D5 | Recheck right before the switch; anonymous check after it, not counted as protection | `A:206-207` | met (as stated obligations) |
| Gate 1 | Name and enrolment plus I-30 merged | #108; `INVARIANTS.md:36` | met |
| Gate 2 | Tree and history pass, with a red case per surface | see D3 | met |
| Gate 3 | Kept RFC 8785 manifest covers refs, tree entries, objects | 427 tree entries (178 / 197 / 52 by mode), 205 objects | met |
| Gate 4 | Attested OIDs pushed by exact refspec with lease | `A:16-17` | met (asserted) |
| Gate 5 | Fresh private clone reproduces every verdict | re-run, see D4 | met |
| Gate 6 | Attestation reviewed, then merged | `REVIEW.md` pending | open |
| Gates 7-8 | Pre-switch recheck, public switch, anonymous check | after merge | n/a at step 4 |
| I-30 | Three owner acts, every ref attested, manifest, unexcluded scan, nominative identities, red proofs, refspec and lease, fail-closed equality, frozen recheck | as above | met except review recording |
| Owner decision: D78 amendment | `A:10-11`; `DECISION-REGISTER.md:84`; ADR-0038 amendment section | met |
| Owner decision: forge-trailer allowlist | `A:141-147` (prose, "chat"), `E/identity-allowlist.json:17-21` | partially (G6) |
| Checklist item 4: `ci.json` on the pushed SHA | `E/ci.json` (5 entries, no SHA, run id or time); not cited in `ATTESTATION.md` | partially (G3) |
| Checklist: gitleaks 14 vs 15 reconciled | `A:118-127`, `E/gitleaks.txt` (labelled a hypothesis) | met |
| Checklist: candidate SECURITY surface before step 5 | not addressed; the candidate tree has no `SECURITY*` file | open (G7) |
| Precedent layout | `ATTESTATION` / `CANONICALIZATION` / `REVIEW` / `evidence/` match the signalement dossier. The frozen-state content of the precedent's "Final transition" section is here as "Frozen state". There is no `verification.json` | partially (G4) |

#### Gaps

1. **G1 (blocking).** `ATTESTATION.md:90` says Commit message: **1 finding**. This contradicts `E/scan.json` (`findings: []`), `A:70` ("exit 0, 0 finding") and `A:199-200`. The row was left over from before the 2026-10-14 trailer decision. A signed record must not contain a contradictory verdict on a D3 surface. Change it to "0 finding (1 before the owner trailer decision, see Owner decision)".
2. **G2 (blocking).** `ATTESTATION.md:80` cites "`evidence/neutralisation.txt`: 41 checks, 41 RED". That file says `40 check(s) neutralised` (`E/neutralisation.txt:42`) and has no `strip-scope` line. The dossier-root duplicate `neutralisation.txt` does have 41 and `strip-scope: … 2 red test(s): RED`. The stale copy is the one cited, and the line it lacks is the proof behind the owner trailer admission (`A:72-74`). My re-run gives 41 with `strip-scope` RED, matching the root copy. Replace the evidence copy and remove the duplicate.
3. **G3 (non-blocking).** `E/ci.json` does not name the head SHA, run ids, URL or time; the precedent's `ci.json` names `head`, `run_id` and `url`. `ATTESTATION.md` never cites it. What I measured with `gh api …/actions/runs`: push runs 38512743466 (licensing), 38512743471 (Context hygiene) and 38512743473 (ci) on `95e1bcea…`, all success, created 2026-10-14T04:42:06Z. Dependabot `dynamic` runs 38512751604 (cargo) and 38512751951 (github_actions) ran on the same SHA.
4. **G4 (non-blocking).** D2 lists versions, commands, UTC timestamp and verdicts. They exist only as prose and one time range (`A:184-185`). No evidence file ties each verdict to its command, version and time; the precedent uses `verification.json`. `A:163-164` says `ls-remote.txt` and `refs.api.txt` were "re-read identical" after the freeze, but neither file is timestamped, so the post-freeze reading cannot be told apart from the 05:1xZ one.
5. **G5 (non-blocking).** `E/provider-policy.json:190` shows `has_pull_requests: true`, and it is not named as a residual risk. Any pull request opened by the admin would create `refs/pull/2/*`. Step 5 would then refuse, so the failure mode is safe, but the frozen state does not list it.
6. **G6 (non-blocking).** The forge-trailer allowlist decision is recorded only as prose in `A:141-147`, with no `DECISION-REGISTER` entry and no `Owner-arbitration:` line; D78 itself is registered. D3's "attested nominative allowlist" arguably makes per-candidate recording enough. Whether it needs a register entry is an owner choice.
7. **G7 (non-blocking).** The checklist item "candidate SECURITY surface says the same before step 5" (`next-steps.md:54`) is not addressed, and the candidate's `main` has no `SECURITY*` file. It is due before step 5, not at step 4.
8. **G8 (non-blocking).** `tools/attestation/provider-policy.sh` ships in the PR but `ATTESTATION.md` never names it as the producer of `E/provider-policy.json`, so the readback has no reproduction command.
9. **G9 (non-blocking).** `A:153` says the freeze ran at "about 08:05Z", but the ruleset `created_at` is 08:06:12Z. The readback at 08:08:41Z comes after both, so the conclusion holds.
10. **G10 (open, process).** `REVIEW.md:16-18` has all three reviews pending. Gate item 6 is unmet until they are recorded.

#### Commands run (raw results)

```
gh pr view 114 … --json headRefOid        → bd195d6595cec75d5c62bc9308542601ed09f44d, base migrate/recover-code
git ls-remote --symref …/project-governance HEAD → ref: refs/heads/migrate/recover-code; 79fec024…
git ls-remote …/square-control.git (08:14Z) → HEAD 95e1bcea; dependabot/… f192917b; main 95e1bcea; pull/1/head f192917b; pull/1/merge b583cc52
git merge-base HEAD origin/migrate/recover-code → 79fec024…
gh pr view 108 → MERGED 2026-10-14T01:43:55Z 43ed26e5
shasum -a 256 E/manifest.jcs.json E/manifest.pre-push.jcs.json → 765fd6e9…dca9 / f512f639…3b20; 87173 / 81044 bytes; last byte 0x7d; non-ASCII lines 0 / 0
jq counts: attested 205 objects {blob 102, commit 17, tree 86}, 427 entries {040000:178, 100644:197, 100755:52}, 4 refs; pre-push 193 {98, 15, 80}, 397 entries, 1 ref
comm pre vs post objects → 0 missing; added {blob 4, commit 2, tree 6}
git init mirror && git fetch '+refs/*:refs/*' → 4 refs as above; is-shallow false; fsck --strict --no-dangling exit 0; cat-file: 102 blob, 17 commit, 86 tree; git 2.56.0
REPO=… sh tools/attestation/manifest.sh mirror | cmp - E/manifest.jcs.json → 0
bun tools/attestation/git-attestation.ts manifest mirror … | cmp → 0
python3 -I canonicalize.py derive … → derived 87173 bytes, sha256 765fd6e9…dca9 (exit 0)
python3 -I canonicalize.py verify E/manifest.pre-push.jcs.json → verified 81044 bytes, f512f639…3b20
git-attestation.ts scan (allowlist of record) → exit 0, byte-equal to E/scan.json, findings []
scan without support@github.com → [{"surface":"commit-message","kind":"personal-data","oid":"f192917b…"}]
scan with owner entry only → 9 findings; surfaces author-address, author-name, commit-message, committer-address, committer-name
scan --attestation manifest.pre-push → exit 1, surface ref-set
bun test tools/attestation (bun 1.4.0) → 75 pass, 0 fail, 143 expect()
per-id -t 'red:<id> ' (tree-path, -capture, -config, -unsafe, ref-name, blob-limit, ref-absent, ref-oid-changed, ref-missing, trusted-ref, object-type, shallow, fsck, unreachable, tagger-missing, tag-name) → 1 pass each; strip-scope → 2 pass
bun tools/attestation/neutralise-check.ts → exit 0, "41 check(s) neutralised, 0 not caught"
diff root neutralisation.txt vs E/neutralisation.txt → evidence lacks "strip-scope: … RED", says 40
gh api …/actions/runs → push runs on 95e1bcea success 04:42:06Z; dynamic Dependabot runs on 95e1bcea; PR runs on f192917b success
gh api …/rulesets → 25062758 frozen-staging-adr-0038 active; repo private=true, has_pull_requests=true
gh pr checks 114 → 11 checks pass (Bun quality, Door declaration, Doctrine governance ×2, …)
```

## Round 2 at a9d6d7fd

### Security review

- Reviewed PR head: `a9d6d7fdd3c1d178047d1351635d283dcffaa2dc` (`gh pr view 114 -R libre-ai/project-governance --json headRefOid`, read at the start and again at the end, unchanged). This is a re-review of the fix commit `bd195d65..a9d6d7fd` (one commit, 22 files, +2040/−320) against the first security review at `bd195d65` (F1–F11).
- Governance revision: served branch `migrate/recover-code` at `79fec02485697c739c47fe2ef7365fdc6314db0f` (`git ls-remote --symref`, unchanged since the first review).
- Candidate: `libre-ai/square-control` `95e1bcea42e6c20c9fc8987b65b7c55de007d2f2`. Remote refs re-read and unchanged: 4 refs plus `HEAD`. Manifest sha256 `765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9`, 87173 bytes.
- Owner script reviewed: `the owner's commands.sh (owner notes)` (18711 bytes, mtime 2026-10-14 10:58 local). Steps 5 and 6 were read. Only their comparison fragments were replayed locally on synthetic inputs; neither step was run.
- Date: 2026-10-14, 08:58–09:04 UTC.
- Reviewer: Claude Opus 5.5 (`claude-opus-5-5`). Independent context, read-only on GitHub.

**Verdict: PASS WITH NOTES.** Merging the PR is safe. On a fresh mirror the attested state reproduces byte for byte in all three implementations, and the scan exits 0. Of the eleven findings, nine are fixed and verified by reproduction (F1, F2, F4, F5, F6, F7, F8, F9, F10). F3 and F11 are accepted residuals with evidence. The fix to F6 introduces one new defect, **N1**: as written, step 5 always aborts before the visibility call. The failure is closed (nothing is exposed), but the owner script must be corrected before step 5 is run. N1 does not touch the PR diff.

#### Findings F1–F11 at `a9d6d7fd`

| Id | Status | Evidence |
| --- | --- | --- |
| F1 HEAD symref not checked in step 5 | **Fixed** (owner script) | `commands.sh:198-199`: `grep -qx "ref: refs/heads/main<TAB>HEAD"` (byte checked with `od -c`: a real TAB) and the `HEAD` OID equal to `$EXPECTED_HEAD`. Replay of lines 198–204 on three `ls-remote` files: real → PASS; `HEAD` symref and OID moved to the Dependabot branch → REFUSE(symref); symref moved but OID unchanged → REFUSE(symref). |
| F2 step 6 not a full enumeration | **Fixed** (owner script) | `commands.sh:230-245`: anonymous `ls-remote --symref`, symref check, ref set compared with the merged manifest, `+refs/*:refs/*` mirror, `manifest | cmp - merged.json`. Replay of lines 237–240: real → PASS; `refs/pull/1/merge` OID changed → INCIDENT(refs); `refs/pull/2/head` added → INCIDENT(refs). The `manifest()` copy in `commands.sh:46-72` is identical to `tools/attestation/manifest.sh:14-40` (`diff` empty). The switch-to-step-6 window still exists by construction; step 6 names a change in it and cannot prevent one, as D5 says. |
| F3 Actions run logs exposed, unscanned | **Accepted residual, with evidence** | The author downloaded all 8 run logs, scanned them with the same content classes (`git-attestation.ts text`) and recorded the result in `evidence/actions-logs.txt`. Hits: 310 `/home/runner/`, 9 `/home/dependabot/`, 2 `noreply@github.com`, 1 `support@github.com`. No credential, cookie, instance-config or denied-literal hit. No run was deleted. I did not download the logs again, so the log content is the author's measurement and not mine. Run count re-read: `8`, unchanged. |
| F4 ruleset predicate fail-open | **Fixed** | `provider-policy.frozen-check.jq`, `def frozen_ruleset`: requires `exclude` to be an array of length 0, `bypass_actors` to be an array of length 0, and `current_user_can_bypass == "never"`. Each mutation of the committed readback was fed to the jq file: `bypass_actors` deleted or null, `exclude` set or deleted, `current_user_can_bypass` set to `always` or deleted, `enforcement=evaluate`, `rulesets=[]` or `null`. Every one gives `frozen:false`; the baseline gives `frozen:true` with 0 blockers. |
| F5 surfaces ignored by `frozen_check` | **Fixed** (one part remains a residual, see N4) | Wiki, Pages, discussions, projects, vulnerability alerts and automated security fixes are now blockers, and so is a collaborator set that is not exactly `[owner login]`. Unreadable controls stay `null` and become blockers. Mutations of `has_wiki`, `has_pages`, `has_discussions`, `automated_security_fixes` and `vulnerability_alerts`, a renamed collaborator, and `collaborators`, `settings`, `actions.permissions`, `branch_protection` or `runs_in_progress` set to null all give `frozen:false`. Still no tag ruleset is required (N4). |
| F6 freeze not re-read before the switch | **Fixed, with a new defect (N1)** | `commands.sh:209-216` re-runs `provider-policy.sh` and requires `frozen == true` with 0 blockers before `gh repo edit`. As written it cannot complete (N1). |
| F7 allowlisted address stripped without boundary | **Fixed** | `git-attestation.ts`, function `stripAddress` (called by `stripAllowedAddresses`), strips only delimited occurrences. Probes through the exported `contentClasses` with the committed allowlist, all giving `["personal-data"]`: `jane.doe.support[at]github.com` (forge), `jane-noreply[at]github.com` (forge), owner noreply address with a glued local part (blob), `support[at]github.com.attacker.net` and `support[at]github.com-attacker.net` (forge), the uppercase `SUPPORT[at]GITHUB.COM` (forge), a glued owner address straddling the 32 KiB window start (blob). Delimited legitimate uses (`<support@github.com>.`, `<owner>`, owner address followed by a sentence dot) give `[]`. Scope enforcement holds: `support@github.com` in a non-forge message gives `["personal-data"]`. |
| F8 Python asserts stripped under `-O` | **Fixed** | `canonicalize.py`, `main()`, uses explicit `refuse()` → `sys.exit(1)`. `python3 -I -O canonicalize.py derive mirror … bogus.json` (`{}`) gives `refused: derived bytes differ from the retained manifest`, exit 1. The real derive under `-O` exits 0 with the expected digest. `verify` on `{}` exits 0, which is correct: `{}` is canonical JSON, and `verify` checks serialisation only. |
| F9 public disclosure of candidate metadata | **Fixed (documented)** | `ATTESTATION.md` gains a "Disclosure by design (ADR-0038 D5)" paragraph. Grep of the added lines of the diff: `/Users/` 0, local user name 0, `/var/folders` 0, `/private/var` 0, `pm.me` 0, `proton` 0. The 3 `/home/` hits are the runner and Dependabot prefixes quoted in the F3 evidence. `project-governance` visibility is `public`. |
| F10 "1 finding" in the surface table | **Fixed** | The row now reads "0 finding (1 before the owner trailer decision, see Owner decision)". |
| F11 SHA-1, decoder coverage, unadvertised objects | **Accepted residual, unchanged** | Object format is still SHA-1. The blob decoders are still latin1, UTF-16LE when a NUL byte is present, and UTF-8; there is still no UTF-16BE or archive decoding, and 0 blobs in the candidate contain a NUL byte. The activity API was re-read and still shows exactly 2 `branch_creation` events, with no force-push and no deletion. |

#### New findings

**N1. Medium. Fails closed, but blocks step 5.** `commands.sh:211-214`: step 5 downloads only `tools/attestation/provider-policy.sh` into a temporary directory and runs it there. At `a9d6d7fd`, that script ends with `jq … -f "$HERE/provider-policy.frozen-check.jq"`, where `HERE="$(dirname "$0")"`. The `.jq` file is not downloaded.
- Reproduction (read-only GETs only): `cp tools/attestation/provider-policy.sh <empty dir>/ && sh <empty dir>/provider-policy.sh libre-ai/square-control > policy.json` gives `jq: Could not open …/provider-policy.frozen-check.jq`, exit 2, and a 0-byte output.
- Under `set -eu`, line 214 therefore aborts step 5 before `gh repo edit`. Nothing is exposed.
- The risk is in the correction. Done under time pressure, the obvious shortcut is to delete the re-check, which would reopen F6.
- Fix: fetch `provider-policy.frozen-check.jq` into the same directory as well. Preferably fetch both files at the merge commit of this PR (`?ref=<merge sha>`) rather than from the served branch at run time (see N3).
- Control: the same script run from the clone, where the `.jq` file is present, exits 0 and gives `frozen:true` with 0 blockers (`observed_at` 2026-10-14T09:03:08Z).

**N2. Low.** Step 5 order: the freeze re-read (lines 209–216, about 25 API calls) runs after the ref and manifest comparison (lines 196–208) and before the switch (line 218). This widens the window between the last ref comparison and the visibility call, and that window is the one F2 is about. Step 6 detects any change in it after the fact. Running the freeze re-read first and the ref/manifest comparison last, right before `gh repo edit`, would shorten the window.

**N3. Low.** `commands.sh:212-214` executes a script fetched from the served branch of a public repository at the moment of step 5, not the reviewed revision. A later merge to `migrate/recover-code` would change which code decides the freeze verdict. Pin it to the merge commit of #114 (resolved at run time, e.g. from `gh pr view 114 --json mergeCommit`).

**N4. Low, residual carried over from F5.** The only ruleset targets `branch`. No tag ruleset is required, and `residual_risks` does not name the tag namespace. The sole collaborator is the owner and Actions are disabled, so the exposure is limited to the owner's own writes. Step 5 refuses a new tag through the ref-set comparison. Naming it in `residual_risks` would make the record complete.

#### Checked and holding at `a9d6d7fd`
- `manifest.sh` keeps tree entries whose name contains a newline (`[\s\S]*\z`) and refuses when the manifest holds fewer entries than the NUL-terminated `ls-tree -z` records. Covered by `red:manifest-newline` and `red:manifest-count`.
- The CLI refuses unknown flags, missing or duplicate values, non-canonical base64 and malformed identities with exit 2, distinct from exit 1 (finding). The messages carry no argument values.
- `provider-policy.sh` records unreadable endpoints as `null`. `present()` maps 404 to `false` and any other failure to `null`.
- The mutation proof is now wired into `bun run check` as `check:attestation`. It counts refusal sites independently of the markers: 65 = 59 marked + 6 exempt, 0 uncovered. 91 checks are neutralised, 0 problems.
- All required checks on PR #114 pass (11 listed by `gh pr checks`).

#### Commands run (raw results)

```
$ gh pr view 114 -R libre-ai/project-governance --json headRefOid   -> a9d6d7fdd3c1d178047d1351635d283dcffaa2dc (start and end)
$ git ls-remote --symref https://github.com/libre-ai/project-governance HEAD
ref: refs/heads/migrate/recover-code	HEAD
79fec02485697c739c47fe2ef7365fdc6314db0f	HEAD
$ git ls-remote https://github.com/libre-ai/square-control.git
95e1bcea42e6c20c9fc8987b65b7c55de007d2f2	HEAD
f192917b55875fc32db5c61bed573770c1fc12ef	refs/heads/dependabot/cargo/cargo-minor-and-patch-c3be8eb6fd
95e1bcea42e6c20c9fc8987b65b7c55de007d2f2	refs/heads/main
f192917b55875fc32db5c61bed573770c1fc12ef	refs/pull/1/head
b583cc527872bb4f20641a67f2c939a65ca7e6da	refs/pull/1/merge
$ git log --oneline bd195d65..a9d6d7fd   -> 1 commit; git diff --stat: 22 files, 2040 insertions(+), 320 deletions(-)
$ bun install --frozen-lockfile   (bun 1.4.0, fresh clone at a9d6d7fd)   -> 30 packages installed
$ bun test tools/attestation   -> 141 pass, 0 fail, 324 expect() calls, 3 files
$ bun tools/attestation/neutralise-check.ts   -> exit 0
refusal sites: 65; marked with an id: 59 (73 distinct ids); exempt with a stated reason: 6; uncovered: 0
91 check(s) neutralised (59 marked sites, 18 file substitutions, 6 exempt), 0 problem(s)
$ git init -q mirror && git -C mirror fetch -q https://github.com/libre-ai/square-control.git '+refs/*:refs/*'   -> exit 0
$ git -C mirror rev-parse --is-shallow-repository   -> false
$ git -C mirror fsck --strict --no-dangling          -> exit 0; in-pack: 205
$ shasum -a 256 evidence/manifest.jcs.json            -> 765fd6e9…dca9, 87173 bytes
$ REPO=libre-ai/square-control sh tools/attestation/manifest.sh mirror | cmp - evidence/manifest.jcs.json        -> exit 0
$ bun tools/attestation/git-attestation.ts manifest mirror libre-ai/square-control | cmp - evidence/manifest.jcs.json   -> exit 0
$ python3 -I tools/attestation/canonicalize.py derive mirror libre-ai/square-control evidence/manifest.jcs.json
derived 87173 bytes, sha256 765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9   (exit 0; same under -O)
$ python3 -I -O tools/attestation/canonicalize.py derive mirror libre-ai/square-control bogus.json   ({})
refused: derived bytes differ from the retained manifest   (exit 1)
$ bun tools/attestation/git-attestation.ts scan mirror --identities evidence/identity-allowlist.json --attestation evidence/manifest.jcs.json --trusted-ref refs/heads/main
exit 0; counters {objects 205, commits 17, trees 86, treeEntries 427, blobs 102, blobBytes 366295, tags 0, refs 4, signatures 2, unreachableObjects 0}; findings []
jq -S '{counters,findings}' diff against evidence/scan.json   -> empty
$ same scan without --trusted-ref   -> exit 1, 9 findings
$ F7 probe (contentClasses with the committed allowlist)   -> 7 bypass shapes and the non-forge scope control give ["personal-data"], 3 delimited legitimate uses give [], RFC 2606 control gives [] by design
$ F4/F5 probe (mutated evidence/provider-policy.json | jq -f provider-policy.frozen-check.jq --arg expected_collaborator <owner>)
baseline frozen:true b:0; all 20 fail-direction mutations frozen:false; has_pull_requests=true alone stays frozen:true (listed as residual)
$ sh tools/attestation/provider-policy.sh libre-ai/square-control   (from the clone, read-only GETs)   -> exit 0, frozen:true, blockers [], observed_at 2026-10-14T09:03:08Z
$ provider-policy.sh copied alone into an empty dir and run, as commands.sh step 5 does   -> "jq: Could not open …/provider-policy.frozen-check.jq", exit 2, 0-byte output   (N1)
$ commands.sh step 5 lines 198-204 replayed on synthetic ls-remote files   -> real PASS; HEAD symref+OID moved REFUSE(symref); symref moved only REFUSE(symref)
$ commands.sh step 6 lines 237-240 replayed on synthetic ls-remote files   -> real PASS; refs/pull/1/merge moved INCIDENT(refs); refs/pull/2/head added INCIDENT(refs)
$ diff tools/attestation/manifest.sh:14-40 commands.sh:46-72   -> identical
$ git diff bd195d65..a9d6d7fd | grep '^+' | grep -c -F <marker>   -> /Users/ 0, local user name 0, /var/folders 0, /private/var 0, pm.me 0, proton 0, /home/ 3 (runner/dependabot prefixes quoted as evidence)
$ gh api "repos/libre-ai/square-control/actions/runs?per_page=100" --jq .total_count   -> 8
$ gh api "repos/libre-ai/square-control/activity?per_page=100"   -> 2 events: 04:43:18Z branch_creation dependabot/…, 04:41:59Z branch_creation main
$ gh api repos/libre-ai/project-governance --jq .visibility   -> public
$ gh pr checks 114 -R libre-ai/project-governance   -> 11 checks, all pass
```

### Quality review

- Reviewed OID: `a9d6d7fdd3c1d178047d1351635d283dcffaa2dc`. This is the PR head (`gh pr view 114 -R libre-ai/project-governance --json headRefOid`). There is one commit since the first review, `bd195d65..a9d6d7fd`: 22 files, +2040/-320.
- Governance revision: served branch `migrate/recover-code` at `79fec02485697c739c47fe2ef7365fdc6314db0f` (`git ls-remote --symref https://github.com/libre-ai/project-governance HEAD`). This is also the merge-base.
- Date: 2026-10-14T09:16Z
- Reviewer model: Claude Opus 5.5 (`claude-opus-5-5`). I am the independent quality re-reviewer (ADR-0038 D5) and did not author the change.
- Environment: fresh clone, `bun install --frozen-lockfile`, Bun 1.4.0, git 2.56.0, jq 1.8.2, Python 3.14, macOS. All mutation probes ran on a separate scratch copy. The clone under review stayed clean (`git status --short` was empty).

**Verdict: FAIL.** There is 1 blocking finding, B4. It is small to fix.

The first review's B1 to B3 are fixed for the TypeScript scanner. All 10 branches that were previously unmarked now turn red under my own mutations. The census and the harness reproduce exactly.

The problem is the claim about the other instruments. The neutralise harness says "each of [the shell, Python and jq files'] checks is mutated" (`neutralise-check.ts:20-21`). That is false:
- 8 real checks in those files stay green under mutation, and `provider-policy.sh` is not executed by any test.
- They include 4 blocker predicates of the D5 frozen verdict, which gates the irreversible visibility switch.
- They include the Python subset guard.

This is the same failure class as the original B1, moved to the files that the census does not count. None of the findings invalidates the retained Square Control evidence:
- Both manifests re-verify under `python -O`.
- Recomputing the frozen verdict from `evidence/provider-policy.json` gives `frozen=true` with 0 blockers.

#### Author's claims: reproduced

| Claim | Result |
| --- | --- |
| `bun run check` green | exit 0. The full `bun test` inside it: **2061 pass / 0 fail across 92 files**. |
| 65 refusal sites = 59 marked + 6 exempt + 0 uncovered | Reproduced. Output: `refusal sites: 65; marked with an id: 59 (73 distinct ids); exempt with a stated reason: 6; uncovered: 0`. No other `add(`/`throw` form exists outside the census pattern; the only other `throw` is the rethrow at `:562`. |
| 91 neutralisations, all RED by assertion, 0 crash-only | Reproduced: `91 check(s) neutralised (59 marked sites, 18 file substitutions, 6 exempt), 0 problem(s)`. 91 lines end in `: RED`. Same result in `evidence/neutralisation.txt`. |
| `check:attestation` wired into `bun run check` | Yes, in `package.json` `check`. It ran inside my `bun run check`. |
| 141 tests in `tools/attestation` | `bun test tools/attestation`: **141 pass, 0 fail, 324 expect() calls, 3 files**. |
| Exit 2 = refused to run, exit 1 = finding | Holds for 17 of my 20 CLI probes. The exceptions are probe f (exit 0, N10a), probe k (exit 1, N6) and probe p (no finding, N10b). |
| REUSE | `bun run check:reuse`: 719/719 files have copyright and licence information. |
| Local paths | No machine-local path was added. The `/home/runner/` and `/home/dependabot/` strings in the diff are documented counts of CI-log hits. `check:context-hygiene` is green. |
| Retained manifests | `canonicalize.py verify` under `-O`: 87173 bytes, sha256 `765fd6e9…dca9`; 81044 bytes, sha256 `f512f639…3b20`. |

#### Prior findings

| Id | Status | Evidence |
| --- | --- | --- |
| B1 mutation proof covered markers, not checks | **Fixed for `git-attestation.ts`**. Not fixed for the sh/py/jq instruments; see B4. | I ran my own substitutions, not the author's, on the 10 previously-unmarked branches. Each is RED (exit 1, 140 pass / 1 fail): tag `link-missing`, tag `header-not-handled`, tag `not-utf8`, tag `headers-malformed`, commit `headers-malformed`, person `header-malformed`, `unreadable`, the type-not-handled `push`, the `assertHandledTypes` throw, and the `readAttestedRefs` ref-shape check. Windowing and path logic, mutated differently from the harness, are also RED: overlap 512→1, dropping `.`/`..` from the dot regex, the boundary `after === "."` clause, backslash `0x5c`, tree modes widened to `120000`/`160000`, ref-name scan, signature scan, forge-added inversion, and reachability `--all`→`--branches`. |
| B2 CLI fail-open on operator input | **Fixed**, with residuals N9 and N10 and one untested branch. | Each case exits 2 with a fixed-text message: missing `--attestation`/`--trusted-ref` value, non-canonical base64 (`c2VjcmV0K`, `c2VjcmV0==`), scope typo `anywher`, an extra identity key, a duplicate flag, an extra positional, a single-dash flag, and an attestation of the wrong shape. The `value.startsWith("--")` half of `cli-flag-value` has no test: probe U08 drops it and the suite stays **green** (141/0). |
| B3 `manifest.sh` dropped newline names | **Fixed.** A different fail-open on the same output path remains; see N8. | On a repository with a path `n\nl`, the shell, TypeScript and Python implementations give byte-identical output (`cmp` SAME, 4 tree entries, Python `derived 1317 bytes`). `red:manifest-newline` and `red:manifest-count` are RED in the harness. |
| N1 `canonicalize.py` asserts off under `-O` | **Fixed.** | Under `python3 -O -I`, each of these exits 1: a non-ASCII value, the integer 99999999999999999999, a terminal newline, and a duplicate key. |
| N2 `provider-policy.sh` untested and coercing unreadable probes | **Partially fixed.** | The coercion is fixed in code: `probe` gives `null`, `present` gives `true`/`false`/`null`, and `secrets`/`variables`/`environments` give `null`. 14 tests cover the jq verdict. **No test runs `provider-policy.sh` itself** (`probe`/`present`, the `HTTP 404` stderr match). 4 jq blocker predicates are untested; see B4. |
| N3 crash vs assertion | **Fixed.** | `judge()` classifies failures. Tests at `neutralise-check.test.ts:132-149` cover RED, crash-only, still green, and context reset. The evidence shows 0 crash-only. |
| N4 harness not wired; duplicate ids | **Fixed.** | Wired into `check`. The duplicate-marker test is at `neutralise-check.test.ts:98`. Accepted residual: duplicates are detected within the TypeScript markers only. `manifest-shallow` and `manifest-ascii` are both a marker id and a file-mutation id. That is intentional, because the same `red:` tests drive both implementations, but the union is not checked. |
| N5 unchecked casts | **Partially fixed. Accepted (low).** | The identities cast is gone: `parseIdentities` narrows field by field. Remaining casts: `git-attestation.ts:265,267` (object after array narrowing), `:331-332` (treeEntries typed `Json[]` then cast; avoidable with a typed record array), `:948`, and `neutralise-check.ts:57,66` (index access within bounds). |
| N6 diagnostics and exit codes | **Mostly fixed.** | Exit 2 vs 1 is reproduced for 17 of 20 CLI probes. Residuals: a nonexistent `<dir>` exits **1** with a `git-failure` finding instead of 2. An unreadable identities file echoes its path (`ENOENT … open '/nonexistent'`). Python refusals mix `refuse()` (exit 1, one line) with an uncaught `ValueError`/`CalledProcessError` traceback (also exit 1). |
| N7 memory not bounded by the blob limit | **Not fixed.** A new measurement makes it sharper; see N11. | `readObjects` still loads every handled object in one `cat-file --batch` buffer of up to `maxBuffer: 1 << 30` (`:113`). `maximumBlobBytes` applies only after the read (`:670`). |

#### New findings

**B4 (blocking): the mutation proof of the shell, Python and jq instruments covers listed substitutions, not checks, and the source claims otherwise.** Failure class: proof claim larger than coverage, with no denominator (gate-integrity §2 and §5).

The claim:
- `neutralise-check.ts:20-21` reads: "each of their checks is mutated by exact text substitution".
- `ATTESTATION.md` says the frozen check "now requires … projects … off … 0 secrets, variables, environments, webhooks" and that `main` is locked.

What I measured: I made 19 exact substitutions outside `git-attestation.ts`, one at a time, and ran the whole `tools/attestation` suite after each. **7 turned red and 12 stayed green (exit 0, 141 pass, 0 fail).** Of those 12:
- **4 are equivalent mutants or dead code, so they are not gaps:**
  - P01 terminal newline (`canonicalize.py:118`)
  - P02 round-trip decode (`:120`)
  - P03 duplicate key (`:30`); all three are unreachable once the byte-equality check `:116` has passed
  - J09 (`teams` removed from the unreadable list), which is still blocked by the `// 1` rule
- **8 are real untested checks.** The shell readback has no test either:

| Probe | Site | Mutation | Reachable effect |
| --- | --- | --- | --- |
| J03 | `frozen-check.jq:41` | drop the `lock_branch` clause | an unlocked default branch with `enforce_admins` derives `frozen=true` |
| J06 | `:57` | `has_projects` blocker → `false` | enabled projects pass |
| J07 | `:51` | drop `(.actions.secrets // 1) != 0 or` | Actions secrets present pass |
| J11 | `:49` | drop the `webhooks` clause | a webhook present passes |
| P04 | `canonicalize.py:46` | integer range → `False` | a manifest holding 99999999999999999999 verifies (measured refused by the original) |
| P05 | `canonicalize.py:37` | `isascii` → `False` | a non-ASCII manifest verifies, because `ensure_ascii=False` gives byte equality (measured refused by the original) |
| P06 | `canonicalize.py:75` | type check → `False` | defence in depth (git cannot list such an object) |
| S01 | `manifest.sh:19` | awk `bad=1` → `bad=0` | defence in depth, same reason |
| — | `provider-policy.sh` | — | not executed by any test (see N2) |

Required fix:
1. Add `red:` tests for J03, J06, J07, J11, P04 and P05, and add their substitutions to `fileMutations`.
2. Either test or delete the Python dead branches P01–P03.
3. Replace "each of their checks" with the actual count, and print a per-file denominator, as the TypeScript census already does.

How to reproduce: copy the clone, replace `(.branch_protection.lock_branch.enabled // false) != true or ` with the empty string in `provider-policy.frozen-check.jq`, then run `bun test tools/attestation`. Result: 141 pass, 0 fail.

**N8 (medium): `manifest.sh` exits 0 and silently drops the entries of a tree that `git ls-tree` cannot read.** Failure class: fail-open, with a guard that shares the failing source. Not fixed.
- The script uses `set -eu` without `pipefail`. `git ls-tree` runs inside `$( … | while …; do git ls-tree … | jq; done | jq -s )`, so its exit status is lost.
- The newline guard added for B3 (`:29-33`) counts records from the same failing `ls-tree`. That gives 0 = 0, so the guard is fooled.
- Measured: I truncated the loose object of one subtree to 16 bytes. `batch-check` still lists it.
  - `sh manifest.sh` printed `sh exit 0` with 3 tree entries instead of 4.
  - TypeScript `manifest` gave exit 2 (`git cat-file exited 128`).
  - Python `derive` gave exit 1 (`CalledProcessError`).
- The retained evidence is not affected: all three implementations agreed on the real mirror.
- Fix: check each `git ls-tree` exit status explicitly (or use `set -o pipefail` where `sh` supports it), and add a `red:` test with a corrupt tree.

**N9 (medium, security axis): an unknown-flag error echoes the deny literal.** Failure class: diagnostic leak that contradicts a stated invariant. Not fixed.
- The source says `git-attestation.ts:1024-1025` "Messages carry flag names and fixed text, never an argument value", and `:915` "The value is never echoed in an error".
- `scan . --identities ids.json --deny-b64=c2VjcmV0` prints `unknown flag --deny-b64=c2VjcmV0` and exits 2. That puts the owner's base64-encoded denied literal into stderr, which means the CI log.
- Fix: print only the part before `=`, or a fixed text.

**N10 (low): operator-input residuals.** Not fixed.
- (a) The `text` command silently ignores the `scan`-only flags: `text a --identities ids.json --attestation /nonexistent --trusted-ref x` gives exit 0.
- (b) `readAttestedRefs` accepts duplicate ref names. The `Map` keeps the last one, so an attestation listing `refs/heads/trunk` twice with conflicting OIDs raises no `ref-set` finding.
- (c) The `text` command reads UTF-8 leniently (`toString("utf8")`), has no UTF-16 pass and no size limit, unlike `scanBlob`. Its UTF-8 pass is untested: probe U12 stays green.

**N11 (low-medium): the `git()` verdict trusts exit 0 although Bun can return truncated stdout with exit 0. The stated reason for three of the six exemptions is therefore inaccurate.** Failure class: wrong unreachability argument for load-bearing branches.

Bun 1.4.0 behaviour, measured: `Bun.spawnSync(["head","-c","200000","/dev/zero"], {maxBuffer: 1000})` returns `exitCode: 0`, `success: true`, `exitedDueToMaxBuffer: true`, and 66536 of 200000 bytes. `git()` (`:107-119`) does not read `exitedDueToMaxBuffer`.

Effect on the scanner: I built a 2004-object repository and made `maxBuffer` injectable in my scratch copy.
- At 1000, `inventory()` read **1372 of 2004 lines with exit 0**. The truncated last line is what reaches the `neutralise:none` branch at `:163`.
- At 70000, `readObjects` truncated.
- With the three truncation exemptions also disabled (`:163`, `:183`, `:198`), the scan still reported `git-failure`, so I found no fail-open.

The finding stands on two points:
- Those three exemptions say "no test can reach them with a working `git`". A working `git` whose output exceeds `maxBuffer` reaches them, and they are what makes the tool fail closed. Probe U23 (accepting a `null` exit code) also stays green.
- Fix: refuse in `git()` when `exitedDueToMaxBuffer` is set, make `maxBuffer` injectable, and turn those exemptions into marked, tested sites. Bounding reads per object would also close N7.

**N12 (low): documentation drift.**
- `git-attestation.ts:25` says a marker sits "within the four lines above it". The census uses `lookback = 8` (`neutralise-check.ts:39`), and its own docstring says eight.
- `provider-policy.sh` hard-codes `REPO` and `EXPECTED_COLLABORATOR` defaults and a `.default_branch // "main"` fallback (`:15-16`, `:52`). This is harmless today, because unreadable settings are already a blocker, but reusable tooling should require these arguments (resolve-never-hardcode).

**Other untested TypeScript logic** (green under mutation; low, outside the refusal-site claim):
- U05: an orphan continuation line, `return null` → `continue`
- U07: an unanchored person regex
- U08: a flag value starting with `--`
- U11: `GIT_NO_REPLACE_OBJECTS` removed. This is security-relevant, because a replace ref would substitute the bytes read for an OID.
- U17: `fsck --strict` → `fsck`
- U23: as in N11

U05 and U07 are also caught by `fsck --strict` in practice.

#### Commands run (raw results)

```
gh pr view 114 -R libre-ai/project-governance --json headRefOid
  -> a9d6d7fdd3c1d178047d1351635d283dcffaa2dc (base migrate/recover-code, OPEN)
git ls-remote --symref https://github.com/libre-ai/project-governance HEAD
  -> ref: refs/heads/migrate/recover-code; 79fec02485697c739c47fe2ef7365fdc6314db0f
bun run check
  -> exit 0; 2061 pass 0 fail (92 files)
  -> refusal sites: 65; marked with an id: 59 (73 distinct ids); exempt with a stated reason: 6; uncovered: 0
  -> baseline: exit 0
  -> 91 check(s) neutralised (59 marked sites, 18 file substitutions, 6 exempt), 0 problem(s)
bun test tools/attestation
  -> 141 pass, 0 fail, 324 expect() calls, 3 files
bun run check:reuse
  -> 719/719 copyright and licence; compliant with REUSE 3.3
python3 -O -I tools/attestation/canonicalize.py verify <both retained manifests>
  -> verified 87173 bytes sha256 765fd6e9…dca9
  -> verified 81044 bytes sha256 f512f639…3b20
jq -S --arg expected_collaborator constantin-jais -f provider-policy.frozen-check.jq evidence/provider-policy.json
  -> frozen true, 0 blockers

Reviewer probes (one exact substitution each, full tools/attestation suite):
  R01-R10 (previously unmarked TypeScript refusal branches): 10/10 RED
  TypeScript logic U01-U23: 16 RED, 7 STILL GREEN (U05 U07 U08 U11 U12 U17 U23)
  Non-TypeScript P01-P06, S01, J01-J12 (19 probes): 7 RED (J01 J02 J04 J05 J08 J10 J12),
      12 STILL GREEN (P01-P06, S01, J03, J06, J07, J09, J11; P01-P03 and J09 are equivalent mutants)

CLI probes (exit, stderr):
  a: --attestation without value      -> 2 "--attestation needs a value"
  b: --deny-b64 c2VjcmV0K             -> 2 "not canonical base64"
  c: scope "anywher"                  -> 2 "identity scope must be …"
  d: --deny-b64=c2VjcmV0              -> 2 "unknown flag --deny-b64=c2VjcmV0"   (N9)
  f: text … --attestation /nonexistent --trusted-ref x -> 0                    (N10a)
  k: scan /nonexistent                -> 1 findings ["git-failure"]           (N6)
  p: duplicate attested ref name      -> 1, no ref-set finding                 (N10b)

Shell manifest on corrupt subtree (loose object truncated to 16 bytes):
  sh manifest.sh -> exit 0, treeEntries 3 (of 4)                               (N8)
  ts manifest    -> exit 2 "git cat-file exited 128"
  py derive      -> exit 1 CalledProcessError

Bun 1.4.0 spawnSync maxBuffer 1000:
  5000 B   -> exitCode 0, len 5000,  exitedDueToMaxBuffer true
  200000 B -> exitCode 0, len 66536, exitedDueToMaxBuffer true
  50 MB    -> exitCode null, SIGTERM, len 66536
Scan of a 2004-object repository, maxBuffer injected (scratch copy only):
  1 GiB -> objects 2004, findings [credential+local-path]
  70000 -> findings [git-failure]
  1000  -> findings [git-failure] (inventory read 1372/2004 lines with exit 0)
```

The probe definitions and runner live in the reviewer's session scratchpad as `probes.json` and `probe.ts`. Each probe is one `{file, find, replace}` that must match exactly once, and the original file is restored after each run.

### Completeness review

- Reviewed PR head: `a9d6d7fdd3c1d178047d1351635d283dcffaa2dc`. This matches `gh pr view 114 --json headRefOid` at 2026-10-14T09:00Z. The only commit since the first review is `a9d6d7f` ("Address the three independent reviews … (bd195d65)").
- Governance revision (served branch `migrate/recover-code`, resolved with `git ls-remote --symref`): `79fec02485697c739c47fe2ef7365fdc6314db0f`. This is the PR merge-base. The doctrine is therefore unchanged since the first review.
- Candidate: `libre-ai/square-control` `95e1bcea42e6c20c9fc8987b65b7c55de007d2f2`. Manifest sha256: `765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9`.
- Date: 2026-10-14, 09:00 to 09:05 UTC.
- Reviewer: Claude Opus 5.5 (`claude-opus-5-5`). Separate agent context, read-only on GitHub. Did not author the PR.

**Verdict: PASS WITH NOTES.** Both blocking gaps from the first review are fixed: G1 (the contradictory commit-message verdict) and G2 (the stale neutralisation evidence). Of the non-blocking gaps, G3, G4, G5, G8 and G9 are fixed. G6 and G7 are recorded as named owner points. G10 is open by design: REVIEW.md is filled after this pass. Every number in `ATTESTATION.md` that I cross-checked against the evidence files or a fresh measurement holds. The three new gaps are all low severity, and all are wording or count labels. None of them touches a verdict.

#### Matrix: ADR-0038 (D2 as amended by D78), acceptance gate and I-30 → PR → status

Paths are relative to `docs/reviews/square-control-bootstrap/95e1bcea…/`. `A:` means `ATTESTATION.md` and `E/` means `evidence/`.

| # | Obligation | Where in PR | Status |
|---|---|---|---|
| D1 | Private staging, outside the portfolio; no inventory entry before the public switch | `git diff --name-only 79fec024..HEAD` outside the dossier and `tools/attestation/` touches only `package.json`, which adds `check:attestation` to `check`. Nothing under `ecosystem/`. Live: `private=true visibility=private` | met |
| D1 | Name and enrolment signed first | #108 merged (`43ed26e5`), `INVARIANTS.md:36` | met |
| D2 | Every advertised ref with its OID, `refs/pull/*` and forge branches included | `A:27-36`; `E/ls-remote.txt`, `E/refs.git.txt`, `E/refs.api.txt` (4 refs, `cmp` equal). Fresh `ls-remote` at 09:01Z gives the same 4 refs + HEAD symref with the same OIDs | met |
| D2 | `HEAD` checked separately as a symref | `E/ls-remote.txt:1`, `A:28-29` | met |
| D2 | Manifest kept in full | `E/manifest.jcs.json` 87,173 B; `E/manifest.pre-push.jcs.json` 81,044 B (`A:51-52`) | met |
| D2 | SHA-256 of the JCS bytes | `A:52` = `shasum` `765fd6e9…dca9`; pre-push `f512f639…3b20` = `A:51` | met |
| D2 | Tool versions, commands, UTC timestamp, verdicts | `E/verification.json`: 14 entries, each with `claim`, `command`, `exit_code`, `tool`, `utc` (08:51:06Z–08:52:15Z); `A:9`, `A:251-256` | met (G4 fixed) |
| D2 | Only commit/tree/blob/tag; fail closed (missing, shallow, unreadable, unknown type, ref outside the attestation or with a different OID) | `A:113-119`; `red:object-type`, `red:manifest-type`, `red:shallow`, `red:fsck`, `red:ref-absent`, `red:ref-oid-changed`, `red:ref-missing` all RED in `E/neutralisation.txt` | met |
| D3 | Blob bytes, incl. a blob deleted later | `A:102`, `A:120` | met |
| D3 | Ref name, tree path bytes, entry type and mode | `A:103-105`, `A:121` | met |
| D3 | Author / committer name and address, message, each separately | `A:106-108` (message now "0 finding (1 before the owner trailer decision)") | met (G1 fixed) |
| D3 | Tagger, tag message (synthetic) | `A:111-112` | met |
| D3 | Content classes | `A:127-135` | met |
| D3 | Nominative identity allowlist, scope enforced | `E/identity-allowlist.json` (owner `anywhere`, 3 `forge-added-only`); `A:75-83`; `red:strip-scope` (2 assertion failures), `red:strip-boundary` RED | met |
| D3 | A red counter-proof per surface, proven by neutralisation | `A:85-98`: 65 sites = 59 marked + 6 exempt, 0 uncovered; 91 neutralised, 91 RED, 0 crash. Re-run output is byte-identical to `E/neutralisation.txt`. Every `red:<id>` cited in `A:100-125` exists as a neutralised id; the wildcard families `cli-*` 9, `identities-*` 7, `frozen-*` 10 and `content-*` 6 match the counts stated | met (G2 fixed); see N1 for the summary label |
| D4 | Push by exact OID with an empty lease; pre-push ⊂ attested | `A:23-24`, `A:41-43`: 193 objects (15/80/98), 397 entries, 1 ref, matching `jq` | met (asserted owner act) |
| D4 | Fresh non-shallow `+refs/*:refs/*` mirror reproduces refs, objects and manifest | Re-run 09:01Z: shallow=false, `fsck --strict` 0, 205 objects (102 blob / 17 commit / 86 tree), `for-each-ref` `cmp` `E/refs.git.txt` 0. Shell, TS and Python derivations all byte-equal, Python prints sha256 `765fd6e9…dca9`. Scan exit 0, output `cmp` `E/scan.json` 0 | met |
| D4 | Candidate gates on the mirror | `E/candidate-gates.txt` (now timestamped 08:49:15Z–08:50:08Z), `A:151-152`; not re-run by me | met |
| D4 | Provider API equality | `cmp E/refs.git.txt E/refs.api.txt` 0 | met |
| D5 | Attestation names the OIDs, keeps the manifest, positive results and red counter-proofs | `A:20-135` | met |
| D5 | Independent security, quality and completeness reviews | `REVIEW.md:14-18` all `pending` | open (G10, expected) |
| D5 | Frozen remote, readback after the freeze | `E/provider-policy.json`: `observed_at 08:52:02Z`, after ruleset `created_at 2026-10-14T10:06:12.405+02:00` (= 08:06:12Z); `frozen_check.frozen=true`, `blockers=[]`. `frozen_check` re-derived with `provider-policy.frozen-check.jq --arg expected_collaborator constantin-jais` from the stripped readback: identical. Live at 09:02Z: ruleset 25062758 active, Actions `enabled=false`, repository private | met |
| D5 | Residual risks named | `A:223-234`, `E/provider-policy.json` `frozen_check.residual_risks` (4): Dependabot weekly, next 2026-10-19T04:00:00Z (`A:227`); `refs/pull/*`; `has_pull_requests` (`A:231-232`); owner admin (`A:233-234`) | met (G5 fixed); see N3 for the 3-vs-4 count |
| D5 | Says it does not attest public availability; any different ref/object/head/manifest invalidates it | `A:6-8`, `A:236-237`, `A:276-278` | met |
| D5 | Recheck right before the switch; anonymous check after, not counted as protection | `A:239-249`, consistent with `commands.sh` (below) | met |
| Gate 1-5 | as in the first review | unchanged evidence, re-measured above | met |
| Gate 6 | Reviewed, then merged | `REVIEW.md` pending | open (G10) |
| Gate 7-8 | Pre-switch recheck, switch, anonymous check | after merge | n/a at step 4 |
| I-30 | Three owner acts, all refs attested, manifest, unexcluded scan, nominative identities, red proofs, refspec + lease, fail-closed equality, frozen recheck | as above | met except review recording |
| Owner decision D78 | `A:17-18`; ADR-0038 l.9, l.117-129 (`Owner-arbitration:` l.119); `DECISION-REGISTER.md:84` | met |
| Owner decision: forge trailer | `A:174-180` (date, scope, second instrument signalement `030add73`), `E/identity-allowlist.json` entry 4, `A:186-188` names the register question as an owner point | met as recorded; register entry open as owner point (G6) |
| Exposure window vs `commands.sh` steps 5-6 | `A:244-249`. In `commands.sh`, `HEAD` symref and OID are checked at l.198-199, the exact ref set at l.200-204, and the mirror `cmp` against the merged manifest at l.205-208. The frozen state is re-read via served-branch `provider-policy.sh` and `jq -e frozen==true and blockers==0` before `gh repo edit --visibility public` (l.209-218). Step 6 runs anonymous `ls-remote --symref`, a ref-set `cmp`, an anonymous `+refs/*:refs/*` mirror and a manifest `cmp` (l.233-245). Its `manifest()` (l.42-72) is byte-identical in logic to `tools/attestation/manifest.sh:14-40`, newline fix included | consistent (read only; steps 5 and 6 not run) |
| CI on the pushed SHA | `E/ci.json`: 8 runs with `head`, `run_id`, `url`, `created_at`. It equals the live `actions/runs` (8 runs; push and dynamic on `95e1bcea`, pull_request on `f192917b`, all success). Cited at `A:170-171` | met (G3 fixed) |
| Actions logs (become public) | `E/actions-logs.txt`: 8/8 logs, per-log classes (8 local-path, 2 personal-data) = `verification.json` `actions-logs` result; enumeration 310 + 9 home prefixes = `A:157-158` (319); 2 + 1 addresses = `A:159` | met |
| gitleaks reconciliation | `E/gitleaks.txt` 14 / 15, two patch-less commits, labelled hypothesis (`A:141-150`) | met |
| Candidate SECURITY surface before step 5 | `A:189-193` names it as an owner point | open as owner point (G7) |

#### Status of G1-G10 (first review at `bd195d65`)

| Gap | Status | Evidence |
|---|---|---|
| G1 commit-message verdict contradicted scan | **fixed** | `A:108` "0 finding (1 before the owner trailer decision, see Owner decision)"; consistent with `A:77`, `A:271`, `E/scan.json` `findings: []` |
| G2 stale `evidence/neutralisation.txt`, duplicate at root | **fixed** | the root copy is deleted (`git diff --stat`: `neutralisation.txt` -43). `E/neutralisation.txt` is byte-identical to my re-run of `bun tools/attestation/neutralise-check.ts` (exit 0). `strip-scope` is at line 12. `A:91-98` matches it (65 = 59 + 6, 91 RED) |
| G3 `ci.json` lacked head/run id/URL/time, uncited | **fixed** | `E/ci.json` keys `head, run_id, url, created_at, event, conclusion`; equals the live API; cited `A:170-171` |
| G4 no machine-readable verification record | **fixed** | `E/verification.json` (14 timestamped entries); post-freeze re-reads `ls-remote` 08:51:06Z, `refs-git-api` 08:51:07Z (`A:218-221`) |
| G5 `has_pull_requests: true` not named | **fixed** | `A:231-232`; `E/provider-policy.json` `frozen_check.residual_risks[2]` |
| G6 trailer decision not in the register | **open, named owner point** | `A:186-188` |
| G7 no candidate SECURITY surface | **open, named owner point** | `A:189-193` (adding it would change the OID and force a new attestation) |
| G8 `provider-policy.sh` not named as producer | **fixed** | `A:206-208`, `E/verification.json` `provider-policy` command |
| G9 freeze time "about 08:05Z" vs `created_at` 08:06:12Z | **fixed** | `A:199-200` "between about 08:05Z and the creation of the ruleset at 08:06:12Z (the ruleset's `created_at`)" |
| G10 reviews pending | **open (process)** | `REVIEW.md:14-18`; to be filled by the coordinator after this pass |

#### New gaps

1. **N1 (low).** The neutralisation summary label does not add up. `E/neutralisation.txt:94`, `E/verification.json:117` and the source `tools/attestation/neutralise-check.ts:337` all print "91 check(s) neutralised (59 marked sites, 18 file substitutions, 6 exempt)". But 59 + 18 + 6 = 83, and exempt sites are not neutralised. The 91 lines are 73 marker ids plus 18 file substitutions (`grep -c` gives 73 and 18). `A:95-96` already gives the correct split. Suggested fix: print `${ids} marker ids + ${fileMutations.length} substitutions` in the summary. The evidence would then need regenerating.
2. **N2 (low).** `tools/attestation/manifest.sh:4-5` says the function is "kept verbatim" as the one that "produced the pre-push and mirror manifests". The newline fix (`[\s\S]*` plus the record count, l.24-33) was added in `a9d6d7f`, after step 2 had produced the pre-push manifest. `CANONICALIZATION.md` correctly describes it as a review fix. The bytes are unaffected because the candidate has no newline path. Suggested wording: "the function of step 2, plus the newline fix found by review".
3. **N3 (low).** `A:223` says the residual risks are "listed in `frozen_check.residual_risks`" and gives 3 items, and `A:272` says "the three residual risks". `E/provider-policy.json` lists 4, and `E/verification.json:126` says "residual risks=4". The content is the same: `A` item 2 merges JSON items 1 and 2. Either say "four (two merged under item 2)" or split them.

The three are independent of each other and none blocks the merge. The coordinator decides whether they are fixed before or after the merge.

#### Commands run (raw results)

```
gh pr view 114 … --json headRefOid         → a9d6d7fdd3c1d178047d1351635d283dcffaa2dc, base migrate/recover-code, OPEN
git ls-remote --symref …/project-governance HEAD → ref: refs/heads/migrate/recover-code; 79fec02485697c739c47fe2ef7365fdc6314db0f
git merge-base HEAD origin/migrate/recover-code → 79fec024…
git log bd195d65..HEAD → a9d6d7f (1 commit); diff --stat 22 files +2040 -320
git ls-remote …/square-control.git (09:00Z) → HEAD 95e1bcea; dependabot/… f192917b; main 95e1bcea; pull/1/head f192917b; pull/1/merge b583cc52
shasum -a 256 E/manifest.jcs.json E/manifest.pre-push.jcs.json → 765fd6e9…dca9 / f512f639…3b20; 87173 / 81044 B
jq counts → attested 4 refs, 205 objects {blob 102, commit 17, tree 86}, 427 entries {040000 178, 100644 197, 100755 52}; pre-push 1 ref, 193 {98,15,80}, 397
cmp E/refs.git.txt E/refs.api.txt → 0
git init mirror && git fetch '+refs/*:refs/*' (09:01:08Z) → is-shallow false; fsck --strict --no-dangling 0; for-each-ref cmp E/refs.git.txt 0; cat-file 102 blob / 17 commit / 86 tree
REPO=… sh tools/attestation/manifest.sh mirror | cmp - E/manifest.jcs.json → 0
bun tools/attestation/git-attestation.ts manifest mirror … | cmp → 0
python3 -I canonicalize.py derive … → derived 87173 bytes, sha256 765fd6e9…dca9, exit 0
python3 -I canonicalize.py verify E/manifest.pre-push.jcs.json → verified 81044 bytes, f512f639…3b20, exit 0
git-attestation.ts scan (allowlist of record) → exit 0; cmp E/scan.json 0
bun install --frozen-lockfile → 0; bun test tools/attestation (bun 1.4.0-canary.1) → 141 pass, 0 fail, 324 expect(), 3 files
bun tools/attestation/neutralise-check.ts → exit 0; diff with E/neutralisation.txt → identical
grep -c ': RED$' E/neutralisation.txt → 91; marker lines 73, substitution lines 18
red:<id> cited in ATTESTATION vs neutralised ids → none missing (families cli- 9, identities- 7, frozen- 10, content- 6)
jq 'del(.frozen_check)' E/provider-policy.json | jq --arg expected_collaborator constantin-jais -f provider-policy.frozen-check.jq → frozen_check identical
E/provider-policy.json → observed_at 2026-10-14T08:52:02Z; ruleset created_at 2026-10-14T10:06:12.405+02:00; actions.permissions.enabled false; bypass_actors []; exclude []; current_user_can_bypass never; has_pull_requests true; residual_risks 4
jq E/ci.json vs gh api …/actions/runs → same 8 {run_id, head} pairs (key order only differs)
git diff --name-only 79fec024..HEAD outside dossier/tools → package.json only (check:attestation)
grep local paths in dossier .md, owner-freeze-commands.sh, tools/attestation/*.sh → none
commands.sh l.187-249 read (steps 5-6 NOT executed); manifest() l.42-72 matches tools/attestation/manifest.sh:14-40
gh pr checks 114 → 11 pass
gh api repos/libre-ai/square-control (09:02:51Z) → private, has_pull_requests true; ruleset 25062758 active; actions enabled false
```

## Round 3 at 41dff5a4

### Security review (delta)

- Reviewed PR head: `41dff5a4f0a69522b36120fbe784e27dd9a1f667` (`gh pr view 114 -R libre-ai/project-governance --json headRefOid`, read at start and end, unchanged).
- Base of the delta: `a9d6d7fdd3c1d178047d1351635d283dcffaa2dc` (previous security record: PASS WITH NOTES, N1-N4). Delta: 1 commit, 15 files, +1585/-462.
- Governance revision: served branch `migrate/recover-code` at `79fec02485697c739c47fe2ef7365fdc6314db0f` (`git ls-remote --symref`, unchanged).
- Candidate: `libre-ai/square-control` `95e1bcea42e6c20c9fc8987b65b7c55de007d2f2`, visibility `private`, remote refs unchanged (4 refs plus `HEAD`).
- Owner script: `the owner's commands.sh (owner notes)` (20988 bytes, mtime 2026-10-14 11:42 local). Step 5 and step 6 were read. Only fragments of step 5 were replayed: read-only GETs and comparisons on synthetic `ls-remote` files. Neither step was run, and no visibility call was made.
- Date: 2026-10-14, 09:43-09:49 UTC.
- Reviewer: Claude Opus 5.5 (`claude-opus-5-5`). Independent context, read-only on GitHub.

**Verdict: PASS WITH NOTES.** Merging is safe, and once #114 is merged step 5 can complete as written. On a fresh mirror the attested state reproduces byte for byte with all three implementations, and the scan exits 0. N1, N2 and N3 are fixed in the owner script and were verified by replay. N4 is now a named residual. The delta introduces one Low regression (N5) in the `text` subcommand. It does not affect any recorded evidence and does not block.

#### N1-N4

| Id | Status | Evidence |
| --- | --- | --- |
| N1 step 5 aborts: `.jq` not downloaded | **Fixed** | `commands.sh:238-239` fetch `provider-policy.sh` and `provider-policy.frozen-check.jq` into the same `$WORK`. Replay: both files fetched raw at `?ref=41dff5a4` into an empty directory, `cmp` equal to the clone. `sh $WORK/provider-policy.sh libre-ai/square-control <gh user>` exits 0. The `jq -e` gate of line 243 exits 0 (`frozen:true`, 0 blockers, 5 residuals, `observed_at` 2026-10-14T09:47:34Z). |
| N2 freeze re-read between the last ref check and the switch | **Fixed** | Order is now: freeze re-read (238-244), then `ls-remote`, symref, `HEAD` OID, ref set, `main` (247-255), then mirror fetch and manifest `cmp` (256-259), then `gh repo edit` (261). Only the visibility precondition (260) sits between the last ref read and the switch. |
| N3 tools fetched from the moving branch tip | **Fixed** | `ATT_REV` = `commits?path=$ATT&per_page=1` → `.[0].sha` (line 228). It is guarded by `^[0-9a-f]{40}$` (229), and every governance read uses `?ref=$ATT_REV` (233). Replay before merge: `ATT_REV` is empty and the guard exits 1, so the step is refused. The merged-attestation existence check (224) also exits 1. A missing file at the revision makes `gh api` exit 1, which aborts under `set -eu`. The second argument is resolved from `gh api user`, not typed. `provider-policy.sh` now requires both arguments (`${1:?}`/`${2:?}`); called with one argument it exits 1 with a usage message. |
| N4 tag namespace not named | **Fixed as a named residual** | `frozen-check.jq` adds `frozen-residual-tags`. The committed readback carries the residual "no tag ruleset: …step 5 would refuse it through the ref-set comparison". Replay: adding an active `tag` ruleset removes it (count 0). Step 5 refuses a new tag: the synthetic `ls-remote` with `refs/tags/v0` added gives REFUSE(refs). |

Other step-5 replays (lines 249-255, synthetic files): real advertisement PASS; symref moved to the Dependabot branch REFUSE(symref); `HEAD` OID moved with symref intact REFUSE(head-oid). Line 249 contains a literal TAB (checked with `od -c`). The `manifest*()` functions in `commands.sh:50-105` are identical to `tools/attestation/manifest.sh` at 41dff5a4, apart from the latter's final invocation line (`diff`).

#### Delta checked, holding
- **Fail-closed paths.** `manifest.sh` no longer runs git inside a pipeline. Each read goes to a file and its exit status is tested, which closes the lost-`pipefail` path. `git-attestation.ts` refuses a truncated `spawnSync` output (`exitedDueToMaxBuffer` → finding `git-output-limit`), which closes a silent partial read in Bun 1.4.0. `readAttestedRefs` refuses a duplicate ref name. `canonicalize.py` replaces the duplicate-key hook with byte equality to the re-serialisation, which still refuses duplicates; it refuses non-ASCII tree paths and checks the git exit code explicitly. `text` refuses `--attestation`/`--trusted-ref`, and a file above 64 MiB becomes `resource-limit` (exit 1).
- **Diagnostics.** `main()` prints only `Refusal` messages. Any other error, including `JSON.parse` and `GitFailure`, prints `refused: unexpected failure`. Probes: a non-existent directory, an unreadable identities file, a malformed attestation and `--identities=VALUE` print respectively "repository directory not found", "identities file cannot be read", "refused: unexpected failure" and "unknown flag --identities". None of them echoes the path or value. Exit code 2 in every case.
- **frozen_check strictness.** The jq checks were split one per marker; the predicates are unchanged. With the owner login, the committed readback gives `frozen:true` with 0 blockers. With another login it gives `frozen:false` ("the collaborators are not exactly the owner"). `rulesets=null` gives `frozen:false`. `provider-policy.sh` now reads `default_branch` from the readback it already holds; when that is unreadable, protection is `null`, which is a blocker.
- **Forge-only allowlist scope.** `stripAllowedAddresses` and the identity scopes are not in the delta. The scan with `--trusted-ref refs/heads/main` exits 0 with 0 findings, identical to `evidence/scan.json`. Without `--trusted-ref` it exits 1.
- **Mutation proof.** 202 tests pass. `neutralise-check` covers 130 sites (118 marked, 12 exempt, 0 uncovered) and neutralises 141 checks with 0 problems.
- **Disclosure.** The added lines contain 0 hits for `/Users/`, the local user name, `/var/folders`, `/private/var`, `pm.me`, `proton` and `/home/`.

#### New findings

**N5. Low. Regression in the `text` subcommand (scanner coverage). Not fixed.** `git-attestation.ts`, `run()` → `classesOfBytes`. Before, `text` read each file as latin1 plus lossy UTF-8. It now uses the blob decoders, where UTF-8 is strict (`TextDecoder fatal`). A single invalid byte anywhere in a log therefore drops the UTF-8 reading for the whole file, and with it the detection of compatibility forms such as fullwidth characters. Probe: a fullwidth address alone gives `personal-data` at both heads. The same line plus one `0xFF` byte gives `personal-data` at a9d6d7fd and `[]` at 41dff5a4. ASCII hits are unaffected, because the latin1 reading keeps them. Impact on this attestation: none. `evidence/actions-logs.txt` was produced at a9d6d7fd, is not re-derived in this delta, and is not re-read by step 5. Blobs have had the same strict-UTF-8 behaviour since before this delta, so that part belongs to the F11 decoder residual. Suggested fix: in `classesOfBytes`, fall back to a lossy UTF-8 reading when the strict decode fails, or record a `non-utf8` class.

**N6. Informational.** Step 6 (`commands.sh:277`) reads the merged attestation from the served-branch tip, while step 5 reads it at `$ATT_REV`. If a later commit rewrote the file, step 6 would compare against different bytes than step 5. This is a detection step, so the risk is a false INCIDENT or a missed one, not an exposure. Reusing `$ATT_REV` would align the two steps.

**N7. Informational.** The tag residual (`frozen-residual-tags`) is silenced by any active ruleset with `target == "tag"`, whatever its bypass actors or rules. Only the residual's wording depends on it, not the verdict, and step 5's ref-set comparison is the actual control.

#### Commands run (raw results)

```
$ gh pr view 114 -R libre-ai/project-governance --json headRefOid   -> 41dff5a4f0a69522b36120fbe784e27dd9a1f667 (start and end)
$ git ls-remote --symref https://github.com/libre-ai/project-governance.git HEAD
ref: refs/heads/migrate/recover-code	HEAD
79fec02485697c739c47fe2ef7365fdc6314db0f	HEAD
$ git ls-remote https://github.com/libre-ai/square-control.git
95e1bcea42e6c20c9fc8987b65b7c55de007d2f2	HEAD
f192917b55875fc32db5c61bed573770c1fc12ef	refs/heads/dependabot/cargo/cargo-minor-and-patch-c3be8eb6fd
95e1bcea42e6c20c9fc8987b65b7c55de007d2f2	refs/heads/main
f192917b55875fc32db5c61bed573770c1fc12ef	refs/pull/1/head
b583cc527872bb4f20641a67f2c939a65ca7e6da	refs/pull/1/merge
$ git log --oneline a9d6d7fd..41dff5a4   -> 1 commit; --stat: 15 files, 1585 insertions(+), 462 deletions(-)
$ bun install --frozen-lockfile (bun 1.4.0)   -> 30 packages
$ bun test tools/attestation   -> 202 pass, 0 fail, 496 expect() calls, 3 files
$ bun tools/attestation/neutralise-check.ts   -> exit 0
  git-attestation.ts 70 = 64 marked + 6 exempt + 0 uncovered; manifest.sh 9 = 6 + 3 + 0; provider-policy.sh 5 = 5 + 0 + 0;
  canonicalize.py 10 = 7 + 3 + 0; provider-policy.frozen-check.jq 36 = 36 + 0 + 0
  141 check(s) neutralised = 122 marker-driven + 19 substitutions; 0 problem(s)
$ git init -q mirror && git -C mirror fetch -q https://github.com/libre-ai/square-control.git '+refs/*:refs/*'   -> exit 0
$ git -C mirror rev-parse --is-shallow-repository -> false ; git -C mirror fsck --strict --no-dangling -> exit 0
$ shasum -a 256 evidence/manifest.jcs.json -> 765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9, 87173 bytes
$ REPO=libre-ai/square-control sh tools/attestation/manifest.sh mirror | cmp - evidence/manifest.jcs.json   -> exit 0
$ bun tools/attestation/git-attestation.ts manifest mirror libre-ai/square-control | cmp - evidence/manifest.jcs.json   -> exit 0
$ python3 -I tools/attestation/canonicalize.py derive mirror libre-ai/square-control evidence/manifest.jcs.json
derived 87173 bytes, sha256 765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9   (exit 0)
$ python3 -I -O tools/attestation/canonicalize.py verify evidence/manifest.jcs.json   -> verified 87173 bytes, same sha256 (exit 0)
$ bun tools/attestation/git-attestation.ts scan mirror --identities evidence/identity-allowlist.json --attestation evidence/manifest.jcs.json --trusted-ref refs/heads/main
exit 0; counters {objects 205, commits 17, trees 86, treeEntries 427, blobs 102, blobBytes 366295, tags 0, refs 4, signatures 2, unreachableObjects 0}; findings []
jq -S '{counters,findings}' diff against evidence/scan.json   -> empty
$ same scan without --trusted-ref   -> exit 1
$ diff <manifest.sh from manifest_tree()> <commands.sh lines 50-105>   -> only manifest.sh's final invocation line differs
$ sed -n 249p commands.sh | od -c   -> "main \t HEAD" (real TAB)
$ step-5 fragment replay (read-only): gh api contents/<ATT> (served tip) -> exit 1 (not merged); commits?path=<ATT>&per_page=1 .[0].sha -> "" ; 40-hex guard -> exit 1
$ gh api -H raw contents/{provider-policy.sh,provider-policy.frozen-check.jq,<ATT>}?ref=41dff5a4 | cmp clone   -> equal; missing path -> exit 1
$ sh <empty dir>/provider-policy.sh libre-ai/square-control   -> exit 1 "usage: provider-policy.sh <owner/repo> <owner-login>"
$ sh <empty dir>/provider-policy.sh libre-ai/square-control <gh api user .login>   -> exit 0; jq -e gate of line 243 -> exit 0; frozen true, residuals 5
$ lines 249-255 on synthetic ls-remote files: real PASS; +refs/tags/v0 REFUSE(refs); symref->dependabot REFUSE(symref); HEAD OID moved REFUSE(head-oid)
$ evidence/provider-policy.json | del(.frozen_check) | jq -f frozen-check.jq --arg expected_collaborator <owner>   -> frozen true, 0 blockers
  same with another login -> frozen false ["the collaborators are not exactly the owner"]; rulesets=null -> frozen false;
  + active tag ruleset -> tag residual count 0
$ CLI diagnostics probes -> "repository directory not found" / "identities file cannot be read" / "refused: unexpected failure" / "unknown flag --identities" / "text does not take --attestation or --trusted-ref", all exit 2, no value echoed
$ N5 probe, text subcommand at a9d6d7fd vs 41dff5a4: fullwidth address -> [personal-data] / [personal-data]; same + 0xFF byte -> [personal-data] / []; ASCII /Users/ path + 0xFF -> [local-path] / [local-path]
$ git diff a9d6d7fd..41dff5a4 | grep '^+' | grep -c -F <marker>   -> /Users/ 0, local user name 0, /var/folders 0, /private/var 0, pm.me 0, proton 0, /home/ 0
$ gh pr checks 114 -R libre-ai/project-governance   -> 11 pass
$ gh api repos/libre-ai/square-control/actions/runs --jq .total_count -> 8 ; activity length -> 2 ; visibility -> private
```

### Quality review

- Reviewed OID: `41dff5a4f0a69522b36120fbe784e27dd9a1f667`. This is the PR head (`gh pr view 114 -R libre-ai/project-governance --json headRefOid`), so it matches the mandate. There is one commit since the previous quality review, `a9d6d7fd..41dff5a4`: 15 files, +1585/-462.
- Governance revision: served branch `migrate/recover-code` at `79fec02485697c739c47fe2ef7365fdc6314db0f` (`git ls-remote --symref https://github.com/libre-ai/project-governance HEAD`). This is also the merge-base.
- Date: 2026-10-14T09:58Z
- Reviewer model: Claude Opus 5.5 (`claude-opus-5-5`). I am the independent quality reviewer for the third pass (ADR-0038 D5) and did not author the change.
- Environment: fresh clone in its own `mktemp -d`, `bun install --frozen-lockfile`, Bun 1.4.0, git 2.56.0, jq 1.8.2, Python 3.14, macOS. All mutations ran on throwaway copies. The clone stayed clean (`git status --short` was empty), and every scratch directory was removed with `scratch-clean`.

**Verdict: FAIL, on one blocking finding (B5).** B5 is documentation only and needs a one-number fix.

- **Code and evidence:** they pass.
  - Every prior blocking item is fixed and was verified with my own mutations, in all five instruments.
  - The retained manifest re-derives to sha256 `765fd6e9…dca9` from a fresh `+refs/*:refs/*` mirror, with all three implementations.
  - The step-5 comparison refuses a non-matching remote.
  - The frozen verdict recomputes to `frozen=true`, 0 blockers.
- **Why B5 still blocks:** the mandate's severity discipline makes a false stated proof claim blocking. B5 is one: the exemption count is given as **15**, but the harness's own denominators sum to **12**.

#### Author's claims: reproduced

| Claim | Result |
| --- | --- |
| `bun run check` green | Exit 0. The full `bun test` inside it gives **2122 pass / 0 fail across 92 files**. |
| Per-file denominators: ts 70/64/6, manifest.sh 9/6/3, provider-policy.sh 5/5/0, canonicalize.py 10/7/3, jq 36/36/0 | Reproduced exactly. `uncovered` is 0 in every file. 70+9+5+10+36 = 130 sites. |
| 141 neutralisations, all red by assertion | Reproduced: `141 check(s) neutralised = 122 marker-driven + 19 substitutions; 0 problem(s)`. Per file, mutated / red: ts 86/86, py 7/7, jq 36/36, manifest.sh 7/7, provider-policy.sh 5/5. This is identical to `evidence/neutralisation.txt`. |
| 202 tests in `tools/attestation` | `bun test tools/attestation`: **202 pass, 0 fail, 496 expect() calls, 3 files**. There is no `.only`, `.skip` or `skipIf`, and the one fixture is tracked. |
| **15 exempt with a reason** (PR body, `ATTESTATION.md:101`, commit message) | **False: 12.** The census prints 6+3+0+3+0. The table on `ATTESTATION.md:93-99` itself sums to 12. The prose that follows lists 6 + mktemp + object type ×2 + jq + 2 except = 12. See B5. |
| Retained manifest re-derives from a fresh full mirror | `python3 -O -I canonicalize.py derive` gives **87173 bytes, sha256 765fd6e9…dca9**. `sh manifest.sh` and `bun … manifest` are byte-identical to `evidence/manifest.jcs.json` (`cmp` SAME, both). `verify` of the pre-push manifest gives 81044 bytes, sha256 `f512f639…3b20`. |
| Scan of record reproduces | On the fresh mirror, with the allowlist, the attestation and `--trusted-ref refs/heads/main`: exit 0, `findings: []`. The counters are identical to `evidence/scan.json` (205 objects, 17 commits, 86 trees, 427 entries, 102 blobs, 4 refs, 0 unreachable). |
| Frozen verdict derived, residual count five | Recomputing the frozen verdict from `provider-policy.json` without its `frozen_check` gives `frozen=true`, 0 blockers, 5 residual risks. That is byte-identical to the committed `frozen_check`. The only ruleset is `source_type: Repository`, active, `~ALL`, with no bypass and all 4 rules. |

#### Prior items

| Id | Status | Evidence (own probes) |
| --- | --- | --- |
| B4: sh/py/jq proof covered substitutions, not checks | **Fixed.** | Census and per-file denominators now exist for all five files, and the substitutions cover the shell. My own forms, which differ from the harness's: Q01 lock `// false`→`// true` RED; J06 projects (harness `false`) RED in the harness, and in mine see N15; J07b secrets `!= 0`→`> 1` RED; J11b webhooks `> 1` RED; Y02 drop integer upper bound RED; Y01 ASCII only when len>1 RED; Y03 `isinstance` (admits bool) RED. The P01–P03 dead branches were removed: duplicate keys and terminal newlines are now refused by byte equality (Y06 `.strip()` RED). P06 (py) and S01 (sh) object-type guards are now declared exemptions; I accept them. `provider-policy.sh` now runs against a stub `gh`: R01 403-as-absent RED, R02 ruleset-null-test RED, R04 collaborators `[]` RED, R05 hooks `0` RED. |
| B2 residual (U08 `startsWith("--")`) | **Fixed.** | U08 `value === "--"` gives RED (2 tests). |
| N2 provider-policy.sh unexecuted | **Fixed**, with residual N15 (untested `.total_count` projections). | See above. |
| N5 casts | **Fixed** for treeEntries (typed `TreeRecord[]`). | Remaining: `:297` and `:299` (object after array narrowing) and `:1025` (index within bounds). Accepted. |
| N6 diagnostics / exit codes | **Fixed for the scanner.** A Python residual remains (low). | Nonexistent dir gives exit 2 `repository directory not found`. Unreadable identities gives exit 2 `identities file cannot be read`, with no path. Non-JSON attestation gives exit 2 `refused: unexpected failure`. Residual: `canonicalize.py verify <missing>` still exits 1 with a `FileNotFoundError` traceback that echoes the path. The commit message says "missing directories and files exit 2 without their path", which is true of the scanner only. |
| N7 memory not bounded by blob limit | **Accepted limit, now documented with numbers** (`git-attestation.ts:200-207`, `ATTESTATION.md` limits (a)). Fails closed. | Seam probe on the real mirror: limit 1 GiB gives no read finding; 70000 gives `git-failure`; 1000 gives `git-output-limit`. |
| N8 manifest.sh drops entries of an unreadable tree | **Fixed.** | Subtree loose object truncated to 16 bytes: sh exit 1 `git read failed`, ts exit 2, py exit 1 `refused: git read failed`. Mutants S01 (inventory unchecked) and S05 (skip a tree) are RED. |
| N9 unknown flag echoes value | **Fixed for `=`.** A glued residual remains (low, N14). | `--deny-b64=c2VjcmV0` gives `unknown flag --deny-b64`, exit 2. T04 (`arg.slice(0,24)`) is RED. |
| N10a `text` ignores scan flags | **Fixed.** | Exit 2 `text does not take --attestation or --trusted-ref`. T08 (`||`→`&&`) is RED. |
| N10b duplicate attested ref names | **Fixed.** | Exit 2 `attestation lists a ref name twice`. T03 (dedupe on objectId) is RED. |
| N10c `text` lenient UTF-8, no UTF-16, no size limit | **Fixed.** | `text` now uses `classesOfBytes` plus the 64 MiB limit. T07 (limit ×4) is RED. |
| N11 Bun truncated stdout with exit 0 | **Fixed.** | `git()` refuses on `exitedDueToMaxBuffer`, and the seam is injectable. T02 (`&& exitCode !== 0`, which models Bun's real behaviour) is RED. The 6 scanner exemptions now cite `git-output-limit` (see Exemptions). |
| N12 doc drift | **Fixed.** | The docstring says "eight lines", matching `lookback = 8`. `provider-policy.sh` requires both arguments, and the `// "main"` fallback is gone (now `// empty` and a null protection). |
| U05, U07, U11, U17 | **Fixed** (harness substitutions `headers-orphan`, `person-anchor`, `git-no-replace`, `fsck-strict`, all RED). | — |
| U12 | **Fixed** through `classesOfBytes` (blob-utf8 marker). | — |
| U23 (`null` exit code) | **Declared limit** (`ATTESTATION.md` limits (b)). | T01 and T19 (accept `null`) are STILL GREEN, as declared. When this happens through maxBuffer, it is refused by `git-output-limit` first. |

#### Exemptions (12, judged one by one)

All 12 are acceptable. Each one stays fail-closed in the code, and its reason is accurate:

- **6 in `git-attestation.ts`:** `:188`, `:216`, `:226`, `:231`, `:269`, `:356`. These cover the git output contract and the tree just listed. Truncation is now refused upstream, as measured above.
- **3 in `manifest.sh`:**
  - `:29` jq: the `|| return 1` remains. A jq failure loses that tree's line while its record count is still appended, so the count guard catches it. The site is equivalent under mutation.
  - `:58` mktemp.
  - `:64` object type.
- **3 in `canonicalize.py`:**
  - `:57` and `:124`: these `except` clauses forward the message of guards that are tested. The non-JSON case is covered by `red:python-verify`.
  - `:85` object type.

#### New findings

**B5 (blocking, by the stated discipline; documentation only): the exemption count in the proof claim is false.** Failure class: a stated proof number that does not match the instrument.
- Locations: the PR body ("15 exempt with a reason"), `ATTESTATION.md:101` ("The 15 exemptions say why…") and the commit message of `41dff5a4` ("15 exempt with a reason").
- The harness prints `6 + 3 + 0 + 3 + 0` exempt. The table directly above (`ATTESTATION.md:93-99`) sums to 12, and the enumeration that follows it names 12.
- This understates nothing about coverage: 130 = 118 marked + 12 exempt + 0 uncovered.
- Fix: write 12 in the PR body and in `ATTESTATION.md`.
- Reproduce: `bun tools/attestation/neutralise-check.ts 2>&1 | sed -n 1,7p`.

**N13 (low): shell substitutions are not anchored to their marker.**
- `neutralise-check.ts:431-440` only checks that the set of marker ids equals the set of substitution ids. A substitution could edit a different line from the one under its marker, and the census would still count that site as marked.
- I checked by hand that all 11 shell substitutions edit the site directly under their marker:
  - `manifest.sh`: 28, 38, 61, 63, 70, 77, plus `manifest-newline`
  - `provider-policy.sh`: 26, 37, 39, 56, 67
- Not fixed. This is structural only.

**N14 (low): residual of N9.** A value glued to a flag without `=` is still echoed: `--deny-b64c2VjcmV0` gives `unknown flag --deny-b64c2VjcmV0`, exit 2. This needs an operator typo. Fix: print a fixed text, or only the known-flag prefix.

**N15 (low-medium, coverage, not claimed): partial weakenings stay green.** Each harness mutation forces a check to its permissive value, and all of those are RED. But **28 of my 73 alternative mutations stay green**. One of them, J25, is equivalent; two, T01 and T19, are a declared limit. None makes this attestation false: the code under review is correct in every case, and I verified each case directly where it is reachable.

- **jq null and absent-field arms (absent key passes):**
  - Q08: `enabled == true`, an absent `enabled` passes
  - Q09: token `== "write"`
  - Q10: `runs_queued // 0`. This is the only guard for an unreadable queued count, because `runs_queued` is not in the unreadable list.
  - Q11, J06b, J22: issues, projects and wiki `== true`
  - Q02: absent `include` defaults to `~ALL`
  - Q15: target `!= "tag"`
  - J20: visibility `== "public"`
- **provider-policy.sh projections outside the census pattern:** R03 secrets and R07 queued, each with `.total_count // 0`. Under R03, an unreadable secrets endpoint becomes 0, is not null, and so derives `frozen=true`. Nothing tests that.
- **Scanner forge scope:**
  - T11: with no trusted ref, every commit is treated as forge-added
  - T12: only the tip of the trusted ref is trusted

  Both leave forge identities admitted on owner history. Measured on the real code: a `dependabot[bot] <support@github.com>` commit behind main's tip is refused (4× `not-allowlisted`), with or without `--trusted-ref`. The tests only use the tip, so the author's question 1 ("refused in a commit main reaches") is answered by the code, not by a test.
- **Ordering and the third instrument:**
  - Y11 and S06: Python and shell `treeEntries` left unsorted. No fixture has a git tree order that differs from byte order (for example a directory `a` beside `a.b`).
  - Y12: Python derives `refs/heads` only. The Python cross-check fixture has no non-head ref.
  - Y07: the Python derive comparison checks only length.

  On the real mirror, all three implementations are byte-equal.
- **Other:**
  - T05: `requireDirectory` accepts any path. A file then fails as `git-failure`, exit 1.
  - T09: `main()` would print any `Error` message.
  - T15: case-insensitive `.GIT`. `fsck --strict` also refuses it.
  - T16: a control character between 0x0a and 0x1f in a path is not tested on the scan side.
  - T18: ambient `HOME` or global config.
  - T30: window overlap 64.
  - T31: tree length off by one.
  - Y08: Python `GIT_NO_REPLACE_OBJECTS`.
  - T01 and T19 are declared (U23).
- Suggested fix: add `red:` cases for Q10 and R03 (the two whose mutants would flip a blocker to pass), and for T11 and T12. Treat the rest as known gaps.

#### Regressions (`git diff a9d6d7fd..41dff5a4`)

None found:
- `Error`→`Refusal` changes what `main()` prints: only `Refusal` text, everything else `refused: unexpected failure`. The 9 CLI probes I re-ran (listed under Commands) all exit 2 or 1 as intended.
- The `provider-policy.json` refresh changes only `observed_at` and the new tag residual.
- `owner-freeze-commands.sh` changes only the documented invocation (the new required owner argument).
- The Python duplicate-key and newline guards were replaced by byte equality, which is still refused (Y06 RED).

#### Commands run (raw results)

```
gh pr view 114 -R libre-ai/project-governance --json headRefOid
  -> 41dff5a4f0a69522b36120fbe784e27dd9a1f667 (base migrate/recover-code, OPEN)
git ls-remote --symref https://github.com/libre-ai/project-governance HEAD
  -> ref: refs/heads/migrate/recover-code; 79fec02485697c739c47fe2ef7365fdc6314db0f
bun install --frozen-lockfile -> 0 ; bun run check -> exit 0
  bun test: 2122 pass, 0 fail (92 files)
  git-attestation.ts: 70 sites = 64 marked + 6 exempt + 0 uncovered; 79 marker ids
  manifest.sh: 9 sites = 6 marked + 3 exempt + 0 uncovered; 6 marker ids
  provider-policy.sh: 5 sites = 5 marked + 0 exempt + 0 uncovered; 5 marker ids
  canonicalize.py: 10 sites = 7 marked + 3 exempt + 0 uncovered; 7 marker ids
  provider-policy.frozen-check.jq: 36 sites = 36 marked + 0 exempt + 0 uncovered; 36 marker ids
  141 check(s) neutralised = 122 marker-driven + 19 substitutions; 0 problem(s)
bun test tools/attestation -> 202 pass, 0 fail, 496 expect() calls, 3 files
grep -c 'neutralise:none ' over the five files -> 7 3 0 3 0 (ts line 26 is the doc comment) = 12 sites

git init --bare m; git -C m fetch https://github.com/libre-ai/square-control '+refs/*:refs/*'
  refs: dependabot/cargo/... f192917b, main 95e1bcea, pull/1/head f192917b, pull/1/merge b583cc52; shallow false
python3 -O -I canonicalize.py derive m libre-ai/square-control evidence/manifest.jcs.json
  -> derived 87173 bytes, sha256 765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9
REPO=libre-ai/square-control sh manifest.sh m        -> exit 0, cmp SAME
bun git-attestation.ts manifest m libre-ai/square-control -> exit 0, cmp SAME
canonicalize.py verify (both)  -> 87173 765fd6e9…dca9 ; 81044 f512f639…3b20
scan m --identities identity-allowlist.json --attestation manifest.jcs.json --trusted-ref refs/heads/main
  -> exit 0, findings [], counters identical to evidence/scan.json
jq frozen-check on provider-policy.json minus frozen_check -> frozen true, 0 blockers, 5 residuals, SAME

Step 5 on a copy of the mirror:
  + refs/heads/extra            -> exit 1 [ref-absent-from-attestation]
  refs/pull/1/merge moved       -> [attested-ref-oid-changed, unreachable-from-refs]
  refs/pull/1/merge deleted     -> [attested-ref-missing, unreachable-from-refs]
CLI: duplicate ref -> 2 ; non-JSON attestation -> 2 "refused: unexpected failure" ;
  nonexistent dir -> 2 ; --deny-b64=c2VjcmV0 -> 2 "unknown flag --deny-b64" ;
  --deny-b64c2VjcmV0 -> 2 "unknown flag --deny-b64c2VjcmV0" (N14) ;
  text … --attestation x -> 2 ; missing identities -> 2 "identities file cannot be read"
Corrupt subtree (loose object truncated to 16 B): sh exit 1, ts exit 2, py exit 1
git output limit seam on the mirror: 1 GiB [] ; 70000 [git-failure] ; 1000 [git-output-limit]
Forge identity on main~1 (not tip): with and without --trusted-ref -> 4x not-allowlisted

Reviewer mutation probes (one exact substitution set each, full tools/attestation suite
minus the harness's own tests = 184 tests; 73 probes):
  RED (45): T02 T03 T04 T06 T07 T08 T10 T13 T20 T21 T22 T24 T28 U08 Y01 Y02 Y03 Y04 Y05 Y06
            S01 S02 S03 S05 R01 R02 R04 R05 Q01 Q03 Q04 Q05 Q06 Q07 Q12 Q13 Q14 Q16 Q17 Q18
            J07b J11b J21 J23 J24   (separately, the harness's own 141 forms: all RED in bun run check)
  STILL GREEN (28): T01 T05 T09 T11 T12 T15 T16 T18 T19 T30 T31 Y07 Y08 Y11 Y12 S06
            R03 R07 Q02 Q08 Q09 Q10 Q11 Q15 J06b J20 J22 J25
            (T01/T19 declared; J25 equivalent: vulnerability_alerts null is in the unreadable list)
```

The probe definitions (`probes.json`, `probes2.json`) and the runner (`probe.ts`) are in the reviewer's session scratchpad. Each probe is a list of `{find, replace}` pairs, and each pair must match exactly once.

### Completeness review (delta)

- Reviewed PR head: `41dff5a4f0a69522b36120fbe784e27dd9a1f667` (`gh pr view 114 --json headRefOid`, 2026-10-14T09:40Z). PR state OPEN, base `migrate/recover-code`.
- Base of the delta: `a9d6d7fdd3c1d178047d1351635d283dcffaa2dc` (previous completeness record, PASS WITH NOTES). The delta is one commit, `41dff5a` "Close the second review round of the Square Control attestation (a9d6d7fd)", 15 files, +1585 / -462.
- Governance revision: served branch `migrate/recover-code` (`git ls-remote --symref`), `79fec02485697c739c47fe2ef7365fdc6314db0f`, which is still the PR merge-base. The doctrine is unchanged since the previous pass.
- Candidate: `libre-ai/square-control` `95e1bcea42e6c20c9fc8987b65b7c55de007d2f2`. Manifest sha256 `765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9`.
- Date: 2026-10-14, 09:40 to 09:48 UTC.
- Reviewer: Claude Opus 5.5 (`claude-opus-5-5`). Separate agent context, read-only on GitHub. Did not author the PR.

**Verdict: PASS WITH NOTES.** N1, N2 and N3 are fixed. Every manifest, ref, object, scan, frozen-state and neutralisation number I cross-checked holds against the evidence files and against fresh measurements. The manifest, scan and neutralisation outputs re-derive byte-identical. The "Exposure window" section matches `commands.sh` steps 5 and 6, which I read and did not run. G6 and G7 remain named owner points. There is no inventory entry, and `REVIEW.md` is pending as expected. I found four new gaps, all low severity and all count or label wording in `ATTESTATION.md`. One of them (N4, "15 exemptions" where the evidence sums to 12) belongs to the same class as N1. None of them touches a verdict.

Paths are relative to `docs/reviews/square-control-bootstrap/95e1bcea…/`. `A:` means `ATTESTATION.md` and `E/` means `evidence/`.

#### Status of N1-N3 (raised at `a9d6d7fd`)

| Gap | Status | Evidence |
|---|---|---|
| N1: neutralisation summary did not add up (91 = 59 + 18 + 6) | **fixed** | `E/neutralisation.txt:155` now reads "141 check(s) neutralised = 122 marker-driven + 19 substitutions; 0 problem(s)". Line counts: 79 scanner marker lines + 7 Python + 36 jq = 122; 7 `manifest.sh` + 5 `provider-policy.sh` + 7 scanner substitutions = 19; 122 + 19 = 141 = `grep -c ': RED$'`. The per-file block (86 + 7 + 36 + 7 + 5 = 141) matches `A:112-113`. Exemptions are no longer mixed into the neutralised count. |
| N2: `manifest.sh` claimed "kept verbatim" | **fixed** | `tools/attestation/manifest.sh:4-13` now reads "the `manifest()` function of step 2 … PLUS two fixes found by review" (the newline fix and the pipefail fix), and says the retained bytes are unaffected. `grep -rni verbatim tools/attestation docs/reviews/square-control-bootstrap` gives no hit. `CANONICALIZATION.md` adds the third defect (pipefail) with its red ids. |
| N3: "three residual risks" vs 4 in JSON | **fixed** | `A:254` "Five residual risks", five numbered items `A:257-268`, `A:313` "the five residual risks". `E/provider-policy.json` `frozen_check.residual_risks` has 5 entries (the tag-namespace risk was added). `E/verification.json` reads "residual risks=5". The list now maps one to one to the JSON. |

#### Number cross-check (ATTESTATION.md vs evidence at `41dff5a4`)

| Claim in A | Evidence / measurement | Match |
|---|---|---|
| 4 refs, OIDs `95e1bcea` ×1, `f192917b` ×2, `b583cc52` ×1, HEAD symref to main (`A:27-36`) | `E/ls-remote.txt` = fresh `git ls-remote --symref` at 09:44:45Z (`cmp` 0); mirror `for-each-ref '%(refname) %(objectname)'` `cmp` `E/refs.git.txt` 0; `cmp E/refs.git.txt E/refs.api.txt` 0 | yes |
| 205 objects: 17 commits, 86 trees, 102 blobs, 0 tags; 427 entries (`A:38-40`) | fresh mirror `cat-file --batch-all-objects`: 102 blob / 17 commit / 86 tree; scan counters `objects 205, treeEntries 427` | yes |
| Pre-push 193 objects, 397 entries, 81,044 B, `f512f639…3b20` (`A:41,51`) | `wc -c` 81044; `shasum` f512f639…3b20; `canonicalize.py verify` exit 0 | yes |
| Attested manifest 87,173 B, `765fd6e9…dca9` (`A:52`) | `wc -c` 87173; `shasum` 765fd6e9…dca9; file unchanged since `a9d6d7fd` (`git diff --quiet` 0) | yes |
| Shell, TS and Python reproduce the manifest | fresh mirror: `manifest.sh` `cmp` 0; `git-attestation.ts manifest` `cmp` 0; `canonicalize.py derive` "derived 87173 bytes, sha256 765fd6e9…dca9" exit 0 | yes |
| Scan: 0 finding, counters 17/86/427/102 (366,295 B)/4 refs/2 signatures/0 tags/0 unreachable (`A:71-77`) | re-run scan exit 0, output `cmp E/scan.json` 0, `findings` 0, same counters | yes |
| Denominators per file 70/9/5/10/36; marked 64/6/5/7/36; exempt 6/3/0/3/0; 0 uncovered (`A:93-99`) | `E/neutralisation.txt:2-6`, `E/verification.json` neutralisation entry; `grep -c 'neutralise:none'`: scanner 6 (+1 doc comment), `manifest.sh` 3, `canonicalize.py` 3 | yes (but see N4) |
| 141 = 122 + 19; per file 86/7/36/7/5; 0 crash (`A:109-114`) | `E/neutralisation.txt:149-155`; re-run `bun tools/attestation/neutralise-check.ts` exit 0, `diff` with `E/neutralisation.txt` identical | yes |
| `red:cli-*` 13, `red:identities-*` 7, `red:frozen-*` 36, `content-<class>` 6 (`A:128,148,155`) | neutralised ids: cli- 13, identities- 7, frozen- 36, content- 6. All 77 concrete `red:<id>` cited in A are among the 139 unique neutralised ids. The 4 remaining cited tokens are the wildcard families | yes |
| Frozen: 25 blockers + 7 ruleset clauses + 4 residual (`A:155`) | jq markers: 7 `frozen-ruleset-*`, 25 blocker ids (`frozen-unreadable` … `frozen-security-fixes`), 4 `frozen-residual-*`; the fifth residual (owner authority) is unconditional, `frozen-check.jq:77` | yes (but see N6) |
| `strip-scope` 2 tests, `strip-boundary` five probes (`A:81-83`) | `git-attestation.test.ts:471,477` (2 tests; neutralised → 2 assertion failures); `:933-942` 5 expected `personal-data` probes | yes |
| `red:blob-content` (9 cases) (`A:128`) | `git-attestation.test.ts:241` (7 cases in the loop) + `:255` = 8 tests; neutralised → 8 assertion failures | **no** (N5) |
| provider-policy `observed_at` 09:34:19Z, `frozen=true`, 0 blockers (`A:234-235,313`) | `E/provider-policy.json` `observed_at 2026-10-14T09:34:19Z`; `frozen_check` re-derived from the stripped readback with `provider-policy.frozen-check.jq --arg expected_collaborator constantin-jais`: `cmp` 0. The readback body differs from `a9d6d7fd` only in `observed_at` and the added residual risk | yes |
| Five residual risks, tags named (`A:254-268`) | 5 entries in JSON, item 4 = "no tag ruleset … step 5 would refuse it through the ref-set comparison" | yes |
| `verification.json` ties every verdict to command, tool, UTC | 14 entries, 09:33:00Z–09:34:30Z (candidate gates 08:51:28Z); tests "202 pass 0 fail"; my re-run: 202 pass, 0 fail, 496 expect(), 3 files | yes |
| Live frozen state | 09:47Z: `private=true`, ruleset 25062758 `frozen-staging-adr-0038` active, Actions `enabled=false`, `has_pull_requests=true` | yes |

#### Exposure window vs `commands.sh` (read only; steps 5 and 6 NOT run)

| A bullet (`A:278-290`) | `commands.sh` | Match |
|---|---|---|
| Step 5: HEAD is a symref to main, and its OID is the attested one | l.249 `grep -qx "ref: refs/heads/main\tHEAD"`; l.250 HEAD OID = `$EXPECTED_HEAD` | yes |
| Step 6: anonymous enumeration of every ref, `+refs/*:refs/*` mirror, byte `cmp` with the merged manifest | l.279-288 (`env -i`, `GIT_CONFIG_GLOBAL=/dev/null`, ls-remote, ref-set `cmp`, mirror fetch, `manifest … \| cmp`) | yes |
| Step 5: frozen re-read FIRST, with repository + owner login, `frozen==true` and no blocker, before the ref and manifest comparisons, which come last before the visibility call | l.238-244 (`provider-policy.sh "$REPO" "$OWNER_LOGIN"`, `jq -e '.frozen_check.frozen == true and (.frozen_check.blockers\|length)==0'`), then l.247-259 refs and mirror, then l.260-261 visibility | yes |
| Step 5: governance files read at the merge revision (`commits?path=<manifest>&per_page=1`), `provider-policy.sh` and `frozen-check.jq` downloaded side by side | l.228-229 `ATT_REV` resolved and validated as 40 hex; l.233 `gov_raw … ?ref=$ATT_REV`; l.238-239 both files into `$WORK` | yes |
| `manifest()` in the script equals the reviewed `manifest.sh` | `commands.sh:51-105` vs `manifest.sh:26-80` (`manifest_tree()` to the end of `manifest()`): `diff` exit 0. The script header names "PR 114 head 41dff5a4" | yes |

Not a gap, recorded for the owner: step 6 reads the merged manifest from the served branch (`contents/$ATT` without `?ref=`). Step 5 reads it at `ATT_REV`. Both copies are the same file unless a later commit edits it, and `A` claims the merge-revision property for step 5 only.

#### Owner points, scope, process

- G6 (trailer decision in the register) and G7 (no candidate `SECURITY` surface) are still named owner points, `A:212-223`.
- No inventory entry. Outside the dossier and `tools/attestation/`, `git diff --name-only 79fec024..HEAD` gives only `package.json` (`check:attestation` wired into `check`). `grep -rl square-control ecosystem/` gives no file.
- `REVIEW.md`: Security, Quality and Completeness all `pending` (expected, filled by the coordinator).
- `gh pr checks 114`: 11 SUCCESS.
- No machine-local path in the dossier `.md` files, `owner-freeze-commands.sh` or `tools/attestation/*.sh|*.py`. The only `/home/` hit is `A:187`, which quotes the hosted-runner prefixes.

#### New gaps

1. **N4 (low; same class as N1).** `A:101` says "The 15 exemptions". The table directly above it (`A:95-99`) and `E/neutralisation.txt:2-6` give 6 + 3 + 0 + 3 + 0 = **12**. `grep -c 'neutralise:none'` confirms 6 + 3 + 3 on the source (the seventh scanner hit is the doc comment at `git-attestation.ts:26`). The prose that follows enumerates exactly 12: six in the scanner, `mktemp`, the invalid object type in `manifest.sh` and `canonicalize.py`, `jq`, and two `except` clauses. The commit message repeats "15 exempt". Fix: "The 12 exemptions". A number in the record that does not add up is what N1 was.
2. **N5 (low, pre-existing, missed by the previous pass).** `A:128`: "`red:blob-content` (9 cases)". There are 8 tests: the 7-case loop at `git-attestation.test.ts:241`, plus the deleted-blob test at `:255`. Neutralising the marker gives "8 assertion failure(s)" (`E/neutralisation.txt:35`). Fix: "8 cases".
3. **N6 (low).** `A:155` says "4 residual risks" in the frozen-verdict row, while `A:254` and `A:313` say five. Both statements are true: 4 are conditional and carry a marker and a red test, and the fifth (owner authority, `frozen-check.jq:77`) is unconditional, so no test can make it disappear. The row should say so, for example "4 conditional residual risks (the fifth, owner authority, is unconditional)", so a reader does not reopen N3.
4. **N7 (low).** `A:295`: "Evidence time: 2026-10-14, 05:12 to 08:52 UTC". The final re-reads in `E/verification.json` run from 09:33:00Z to 09:34:30Z, and the frozen readback is 09:34:19Z (`A:234`). The same sentence points to `verification.json`, so nothing is hidden, but the stated range is stale. Fix: "05:12 to 09:34 UTC".

The four are independent of each other, and none blocks the merge. If N4 to N7 are fixed in the record only (no evidence regeneration needed), a further delta pass needs only `ATTESTATION.md`.

#### Commands run (raw results)

```
gh pr view 114 -R libre-ai/project-governance --json headRefOid,… → 41dff5a4f0a69522b36120fbe784e27dd9a1f667, base migrate/recover-code, OPEN, 30 files
gh repo view libre-ai/project-governance --json defaultBranchRef → migrate/recover-code
git ls-remote --symref origin HEAD → ref: refs/heads/migrate/recover-code; 79fec02485697c739c47fe2ef7365fdc6314db0f
git merge-base HEAD origin/migrate/recover-code → 79fec02485697c739c47fe2ef7365fdc6314db0f
git log --oneline a9d6d7fd..HEAD → 41dff5a (1 commit); diff --stat 15 files +1585 -462
git diff --quiet a9d6d7fd..HEAD -- E/manifest*.json E/scan.json E/refs.*.txt E/ls-remote.txt E/ci.json E/identity-allowlist.json → 0 (unchanged)
bun install --frozen-lockfile → 0; bun 1.4.0; bun test tools/attestation → 202 pass, 0 fail, 496 expect(), 3 files
git ls-remote --symref https://github.com/libre-ai/square-control.git (09:44:45Z) | cmp - E/ls-remote.txt → 0
git init mirror && git fetch '+refs/*:refs/*' → is-shallow false; fsck --strict --no-dangling 0; cat-file 102 blob / 17 commit / 86 tree
for-each-ref '%(refname) %(objectname)' | cmp - E/refs.git.txt → 0; cmp E/refs.git.txt E/refs.api.txt → 0
shasum -a 256 / wc -c → 765fd6e9…dca9 87173; f512f639…3b20 81044
REPO=libre-ai/square-control sh tools/attestation/manifest.sh mirror | cmp - E/manifest.jcs.json → 0
bun tools/attestation/git-attestation.ts manifest mirror libre-ai/square-control | cmp - E/manifest.jcs.json → 0
python3 -I tools/attestation/canonicalize.py derive mirror … → derived 87173 bytes, sha256 765fd6e9…dca9, exit 0
python3 -I tools/attestation/canonicalize.py verify E/manifest.pre-push.jcs.json → verified 81044 bytes, f512f639…3b20, exit 0
git-attestation.ts scan mirror --identities … --attestation … --trusted-ref refs/heads/main → exit 0; cmp E/scan.json 0; findings 0
bun tools/attestation/neutralise-check.ts → exit 0; diff with E/neutralisation.txt → identical
grep -c ': RED$' E/neutralisation.txt → 141; scanner marker 79, py 7, jq 36, manifest.sh 7, provider-policy.sh 5, scanner substitutions 7
grep -c 'neutralise:none' → git-attestation.ts 7 (1 doc comment), manifest.sh 3, canonicalize.py 3, provider-policy.sh 0, jq 0
red:<id> cited in A vs neutralised ids → 81 cited tokens, 139 unique neutralised; only cli/content/frozen/identities wildcards absent
grep 'red:blob-content' git-attestation.test.ts → l.241 (7-case loop), l.255 → 8 tests
jq 'del(.frozen_check)' E/provider-policy.json | jq --arg expected_collaborator constantin-jais -f provider-policy.frozen-check.jq → frozen_check cmp 0
E/provider-policy.json → observed_at 2026-10-14T09:34:19Z; frozen true; blockers []; residual_risks 5 (tags item added)
jq E/verification.json → 14 verdicts, 09:33:00Z–09:34:30Z (+ candidate gates 08:51:28Z); residual risks=5; tests 202 pass
commands.sh l.218-295 read (steps 5-6 NOT executed); manifest_tree()..manifest() l.51-105 diff tools/attestation/manifest.sh l.26-80 → 0
grep -rni verbatim tools/attestation docs/reviews/square-control-bootstrap → none
git diff --name-only 79fec024..HEAD outside dossier/tools → package.json only; grep -rl square-control ecosystem/ → none
grep local paths in dossier .md, owner-freeze-commands.sh, tools/attestation/*.sh|*.py → only A:187 (/home/runner, /home/dependabot quoted)
gh pr checks 114 → 11 SUCCESS
gh api repos/libre-ai/square-control (09:47:29Z) → private true, has_pull_requests true; actions enabled false; ruleset 25062758 active
```

## Disposition of the findings of the final round

"Fixed in `a22ad629`" is the commit that carries the code, evidence and
`ATTESTATION.md` corrections; the earlier rounds' findings were fixed in `a9d6d7fd` and
`41dff5a4`, as the round-3 records verify.

| Finding | Disposition |
| --- | --- |
| Quality B5: exemption count 15, harness says 12 | Fixed in `a22ad629`: 12 in `ATTESTATION.md` and in the pull request body. The commit message of `41dff5a4` cannot be changed after the push and carries the wrong number; `a22ad629` says so in its message. |
| Quality N13: shell substitutions not anchored to their marker | Accepted residual: structural only. The reviewer checked by hand that all 11 substitutions edit the site directly under their marker; the set of marker ids equals the set of substitution ids. |
| Quality N14: a value glued to a flag without `=` is echoed | Fixed in `a22ad629`: an unknown flag prints a fixed text and never the token (`red:cli-flag-echo`, glued and attached cases). |
| Quality N15: partial weakenings stay green (28 of 73) | Fixed in `a22ad629` for the four the reviewer asked for: an unreadable queued-run count and an unreadable secrets count (`red:frozen-counts`, `red:readback-secrets`, `red:readback-queued`), the forge scope with no trusted ref and behind the tip (`red:forge-trusted-ref`, `red:forge-trusted-history`). Accepted residual for the rest, listed in `ATTESTATION.md` limit (d): absent-field arms whose present-field arm is proven, tree-entry ordering with no fixture, the Python `refs/heads`-only fixture, `.GIT` casing (`fsck --strict` also refuses it), ambient `HOME`; T01/T19 are the declared null-exit-code limit. |
| Quality N6 residual: `canonicalize.py verify` on a missing file prints a traceback with the path | Fixed in `a22ad629` (`red:python-file`, `red:python-file-derive`). |
| Security N5: `text` loses the UTF-8 reading when one byte is invalid | Fixed in `a22ad629`: lossy UTF-8 fallback in the shared byte reader, for blobs and for `text` (`red:blob-utf8-lossy`). Actions logs rescanned with the fixed command. |
| Security N6: step 6 reads the merged attestation from the served tip, step 5 at `$ATT_REV` | Owner script, informational (detection step, no exposure): left to the owner's `commands.sh`; not part of this pull request's diff. |
| Security N7: the tag residual is silenced by any active tag ruleset | Accepted residual: only the wording of a residual depends on it, not the verdict; the ref-set comparison of step 5 is the control. |
| Completeness N4: "15 exemptions" | Fixed in `a22ad629` (12). |
| Completeness N5: `red:blob-content` has 8 cases | Fixed in `a22ad629`. |
| Completeness N6: "4 residual risks" row vs five | Fixed in `a22ad629`: the row says 4 conditional, the fifth (owner authority) unconditional. |
| Completeness N7: evidence time range | Fixed in `a22ad629`: 05:12 to 10:07 UTC. |
| G6: register entry for the forge-trailer decision | Owner point, named in `ATTESTATION.md`. |
| G7: no `SECURITY` surface in the candidate | Owner point, named in `ATTESTATION.md` (adding it changes the OID and forces a new attestation). |

