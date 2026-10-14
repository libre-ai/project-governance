#!/bin/sh
# Read-only readback of the provider-side controls of a staging repository (ADR-0038 D5).
#
# D5 requires the private remote to be FROZEN between the attestation and the visibility switch:
# no contributor, workflow or automatism with write capability. This script reads every control
# that bears on that sentence and DERIVES the verdict from the readback with
# provider-policy.frozen-check.jq; nothing here writes to the provider, and the verdict is
# computed, never typed. A control that cannot be read is recorded as null and listed as a
# blocker: an unreadable control is not a passing control, and is never coerced to an empty list.
#
# Usage: sh tools/attestation/provider-policy.sh [owner/repo] [owner-login] > provider-policy.json
# Needs: gh (authenticated, repository admin read access) and jq.
set -eu

REPO="${1:-libre-ai/square-control}"
EXPECTED_COLLABORATOR="${2:-constantin-jais}"
OBSERVED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HERE="$(dirname "$0")"

# JSON of an endpoint, or null when the provider refuses it (403, 404, 409, network).
probe() {
  out="$(gh api "repos/$REPO$1" 2>/dev/null)" && printf '%s' "$out" || printf 'null'
}

# For endpoints whose status carries the answer: true on 2xx, false on HTTP 404, null on any
# other failure (an unreadable control is not an absent one).
present() {
  if err="$(gh api "repos/$REPO$1" --silent 2>&1 >/dev/null)"; then
    printf 'true'
  else
    case "$err" in *"HTTP 404"*) printf 'false' ;; *) printf 'null' ;; esac
  fi
}

settings="$(probe "" | jq -c 'if . == null then null else {
  visibility, private, archived, disabled, default_branch,
  has_issues, has_discussions, has_wiki, has_projects, has_pages, has_pull_requests,
  allow_forking, allow_merge_commit, allow_squash_merge, allow_rebase_merge, allow_auto_merge,
  web_commit_signoff_required,
  security_and_analysis: (.security_and_analysis // null)
} end')"
# The list endpoint omits rules and conditions: read each ruleset in full. An unreadable list
# stays null; a readable empty list is [].
ruleset_list="$(probe "/rulesets?includes_parents=true")"
if [ "$ruleset_list" = "null" ]; then
  rulesets="null"
else
  rulesets="$(
    for id in $(printf '%s' "$ruleset_list" | jq -r '.[]?.id'); do probe "/rulesets/$id"; echo; done | jq -s -c '.'
  )"
fi
protection="$(probe "/branches/$(probe "" | jq -r '.default_branch // "main"')/protection")"
actions_permissions="$(probe "/actions/permissions")"
actions_workflow="$(probe "/actions/permissions/workflow")"
selected_actions="$(probe "/actions/permissions/selected-actions")"
workflows="$(probe "/actions/workflows" | jq -c 'if . == null then null else [.workflows[]? | {name, path, state}] end')"
collaborators="$(probe "/collaborators" | jq -c 'if . == null then null else [.[]? | {login, role_name, permissions}] end')"
invitations="$(probe "/invitations" | jq -c 'if . == null then null else length end')"
teams="$(probe "/teams" | jq -c 'if . == null then null else length end')"
hooks="$(probe "/hooks" | jq -c 'if . == null then null else length end')"
keys="$(probe "/keys" | jq -c 'if . == null then null else length end')"
secrets="$(probe "/actions/secrets" | jq -c '.total_count')"
variables="$(probe "/actions/variables" | jq -c '.total_count')"
environments="$(probe "/environments" | jq -c '.total_count')"
branches="$(probe "/branches?per_page=100" | jq -c 'if . == null then null else [.[]? | {name, protected}] end')"
open_pulls="$(probe "/pulls?state=open&per_page=100" | jq -c 'if . == null then null else [.[]? | {number, user: .user.login, head: .head.ref, head_sha: .head.sha}] end')"
dependabot_present="$(present "/contents/.github/dependabot.yml")"
dependabot_sha="$(probe "/contents/.github/dependabot.yml" | jq -c '.sha // null')"
in_progress_runs="$(probe "/actions/runs?status=in_progress" | jq -c '.total_count')"
queued_runs="$(probe "/actions/runs?status=queued" | jq -c '.total_count')"
vulnerability_alerts="$(present "/vulnerability-alerts")"
automated_security_fixes="$(probe "/automated-security-fixes" | jq -c '.enabled')"
private_vulnerability_reporting="$(probe "/private-vulnerability-reporting" | jq -c '.enabled')"

jq -n -S \
  --arg repository "$REPO" --arg observed_at "$OBSERVED_AT" \
  --argjson settings "$settings" --argjson rulesets "$rulesets" --argjson protection "$protection" \
  --argjson actions_permissions "$actions_permissions" --argjson actions_workflow "$actions_workflow" \
  --argjson selected_actions "$selected_actions" --argjson workflows "$workflows" \
  --argjson collaborators "$collaborators" --argjson invitations "$invitations" --argjson teams "$teams" \
  --argjson hooks "$hooks" --argjson keys "$keys" --argjson secrets "$secrets" \
  --argjson variables "$variables" --argjson environments "$environments" \
  --argjson branches "$branches" --argjson open_pulls "$open_pulls" \
  --argjson dependabot_present "$dependabot_present" --argjson dependabot_sha "$dependabot_sha" \
  --argjson in_progress_runs "$in_progress_runs" --argjson queued_runs "$queued_runs" \
  --argjson vulnerability_alerts "$vulnerability_alerts" \
  --argjson automated_security_fixes "$automated_security_fixes" \
  --argjson private_vulnerability_reporting "$private_vulnerability_reporting" '
  {
    repository: $repository,
    observed_at: $observed_at,
    provider: "GitHub",
    settings: $settings,
    rulesets: $rulesets,
    branch_protection: $protection,
    actions: {permissions: $actions_permissions, workflow_token: $actions_workflow, selected: $selected_actions, workflows: $workflows, secrets: $secrets, variables: $variables, environments: $environments, runs_in_progress: $in_progress_runs, runs_queued: $queued_runs},
    access: {collaborators: $collaborators, pending_invitations: $invitations, teams: $teams, webhooks: $hooks, deploy_keys: $keys},
    security: {vulnerability_alerts: $vulnerability_alerts, automated_security_fixes: $automated_security_fixes, private_vulnerability_reporting: $private_vulnerability_reporting},
    dependabot: {config_file: {present: $dependabot_present, sha: $dependabot_sha}, open_pull_requests: $open_pulls},
    branches: $branches
  }
' | jq -S --arg expected_collaborator "$EXPECTED_COLLABORATOR" -f "$HERE/provider-policy.frozen-check.jq"
