#!/bin/sh
# OWNER commands to freeze libre-ai/square-control (ADR-0038 D5). NOT EXECUTED by the agent.
#
# Written 2026-10-14 from the readback `provider-policy.json` of the attestation pull request
# (frozen_check.frozen = false, 6 blockers). Every command below changes a provider setting, so
# each is an owner act (I-17). Run them one at a time, in this order, then run section Z.
#
# What each blocker is, and the command that answers it:
#   1. Actions enabled, allowed_actions=all     -> F1
#   2. main neither locked nor under a ruleset  -> F2 (ruleset) and/or F3 (classic lock)
#   3. no ruleset on other refs                 -> F2
#   4. Dependabot version updates configured    -> cannot be switched off by API, see "Dependabot"
#   5. open pull request #1 (refs/pull/1/*)     -> do not touch it, see "Pull request 1"
#   6. issues enabled                           -> F4
#
# WHAT CAN AND CANNOT BE FROZEN
#   Can:    Actions (F1), branch creation/update/deletion on every branch (F2), main lock (F3),
#           issues/wiki/projects (F4), secret scanning where the plan offers it (F5).
#   Cannot: refs/pull/* (GitHub-managed namespace: no ruleset or protection applies to it, and
#           the owner cannot delete it; D78 records that only GitHub support can).
#           The owner themselves: the sole collaborator is an admin and keeps the power to undo
#           every setting below. ADR-0038 D5 forbids contributors, workflows and automatisms
#           with write capability; it cannot forbid the owner, and the attestation says so.
#   Dependabot version updates have NO API switch: the only toggle is the file
#           .github/dependabot.yml, and deleting it changes the tree, hence the OID, hence the
#           attestation (D4: recomputed manifest must equal the frozen one). So the freeze
#           works by making a run unable to write, not by removing the schedule:
#             - F1 (Actions disabled): Dependabot version-update jobs run as Actions workflows
#               ("Dependabot Updates", event "dynamic" in the run list). HYPOTHESIS, not measured:
#               with Actions disabled they do not run. Verify with Z2 below before relying on it.
#             - F2 (ruleset on ~ALL branches, no bypass): a run that does start cannot create
#               its dependabot/* branch. HYPOTHESIS, not measured: Dependabot's app may or may not
#               be subject to the ruleset; the readback after the next scheduled run decides.
#   Scheduled run: weekly, Monday 06:00 Europe/Paris, i.e. 2026-10-19T04:00:00Z (CEST, UTC+2).
#   Measured 2026-10-14: the FIRST run happened at the first push, not at the schedule, so a
#   run can also be triggered by any event that touches the manifest set.
#
# CONSEQUENCE UNDER AMENDED D2 (ADR-0038, D78): the attestation covers every advertised ref,
# refs/pull/* and forge branches included. If ANY ref appears, disappears or changes OID between
# the attestation merge and `commands.sh 5`, step 5 stops ("advertised refs differ from the
# merged attestation") and a new attestation is required. Dependabot rebasing PR #1 after a
# change of main, or opening a new PR, is such a move. A refused switch is the designed outcome,
# not a failure of the freeze.
#
# Pull request 1: leave it open and untouched. Closing it, commenting, or asking Dependabot to
# rebase can move refs/pull/1/*; whether closing deletes refs/pull/1/merge is UNMEASURED.

set -eu
R=libre-ai/square-control

# --- F1. Disable GitHub Actions for the repository -------------------------------------------
# Stops the three workflows (ci, Context hygiene, licensing) and, by hypothesis, Dependabot jobs.
# Precedent: signalement attestation, "After the green run, Actions were disabled".
f1() {
  gh api -X PUT "repos/$R/actions/permissions" -F enabled=false
}

# --- F2. Ruleset: no creation, update, deletion or force push on any branch, no bypass -------
# bypass_actors is empty on purpose: the owner can still edit or delete the ruleset (admin), but
# no push, including the owner's, succeeds while it is active. Remove it only to re-attest.
f2() {
  gh api -X POST "repos/$R/rulesets" --input - <<'JSON'
{
  "name": "frozen-staging-adr-0038",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~ALL"], "exclude": [] } },
  "rules": [
    { "type": "creation" },
    { "type": "update" },
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ],
  "bypass_actors": []
}
JSON
}

# --- F3. Classic protection: lock main read-only (signalement precedent) ----------------------
# Redundant with F2 for pushes; kept because the attestation readback reads lock_branch directly.
f3() {
  gh api -X PUT "repos/$R/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "lock_branch": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
}

# --- F4. Issues, wiki, projects off ------------------------------------------------------------
# Signalement kept its issue tracker disabled through the transition; the security destination is
# the fleet channel in project-governance, because private vulnerability reporting exists only on
# public repositories (readback: private_vulnerability_reporting = null).
f4() {
  gh repo edit "$R" --enable-issues=false --enable-wiki=false --enable-projects=false
}

# --- F5. Secret scanning and push protection (plan-dependent) ----------------------------------
# Readback 2026-10-14: both "disabled". Signalement had both enabled. If the plan does not offer
# them on private repositories the call is refused; then say so in the attestation, do not retry.
f5() {
  gh api -X PATCH "repos/$R" \
    -f 'security_and_analysis[secret_scanning][status]=enabled' \
    -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
}

case "${1:-}" in
  f1) f1 ;;
  f2) f2 ;;
  f3) f3 ;;
  f4) f4 ;;
  f5) f5 ;;
  *)
    echo "usage: sh $0 <f1|f2|f3|f4|f5>   (one at a time; see the header; then section Z)" >&2
    exit 2
    ;;
esac

# --- Z. After the freeze (read-only) -----------------------------------------------------------
# Z1. Refresh the readback and require frozen = true. Commit the refreshed file to the
#     attestation pull request BEFORE it is merged (a merged attestation with frozen=false is
#     an attestation of an unfrozen remote).
#       sh tools/attestation/provider-policy.sh libre-ai/square-control constantin-jais \
#         > docs/reviews/square-control-bootstrap/<OID>/evidence/provider-policy.json
#       jq -e '.frozen_check.frozen' docs/reviews/square-control-bootstrap/<OID>/evidence/provider-policy.json
# Z2. Prove the Dependabot hypotheses instead of assuming them: after F1/F2, wait for (or note the
#     absence of) a "Dependabot Updates" run, then compare the advertised refs with the attested
#     ones: `git ls-remote https://github.com/libre-ai/square-control.git | cmp - <attested>`.
#     The authoritative proof is step 5 of commands.sh, which refuses on any difference.
# Z3. Re-attest (new dossier directory is NOT needed if only refs differ and the tree is the same:
#     recompute manifest.jcs.json from a fresh mirror and refresh the evidence in the same PR).
