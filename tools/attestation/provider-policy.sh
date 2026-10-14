#!/bin/sh
# Read-only readback of the provider-side controls of a staging repository (ADR-0038 D5).
#
# D5 requires the private remote to be FROZEN between the attestation and the visibility switch:
# no contributor, workflow or automatism with write capability. This script reads every control
# that bears on that sentence and DERIVES the verdict from the readback; nothing here writes to
# the provider, and the verdict is computed, never typed. A control that cannot be read is
# recorded as null and listed as a blocker: an unreadable control is not a passing control.
#
# Usage: sh tools/attestation/provider-policy.sh [owner/repo] > provider-policy.json
# Needs: gh (authenticated, repository admin read access) and jq.
set -eu

REPO="${1:-libre-ai/square-control}"
OBSERVED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# JSON of an endpoint, or null when the provider refuses it (404 "not enabled", 409, 403).
probe() {
  out="$(gh api "repos/$REPO$1" 2>/dev/null)" && printf '%s' "$out" || printf 'null'
}

# true when the provider answers 2xx, false otherwise (endpoints that signal state by status).
enabled() {
  if gh api "repos/$REPO$1" --silent >/dev/null 2>&1; then printf 'true'; else printf 'false'; fi
}

settings="$(probe "" | jq -c '{
  visibility, private, archived, disabled, default_branch,
  has_issues, has_discussions, has_wiki, has_projects, has_pages, has_pull_requests,
  allow_forking, allow_merge_commit, allow_squash_merge, allow_rebase_merge, allow_auto_merge,
  web_commit_signoff_required,
  security_and_analysis: (.security_and_analysis // null)
}')"
rulesets="$(probe "/rulesets?includes_parents=true")"
protection="$(probe "/branches/$(probe "" | jq -r .default_branch)/protection")"
actions_permissions="$(probe "/actions/permissions")"
actions_workflow="$(probe "/actions/permissions/workflow")"
selected_actions="$(probe "/actions/permissions/selected-actions")"
workflows="$(probe "/actions/workflows" | jq -c '[.workflows[]? | {name, path, state}]')"
collaborators="$(probe "/collaborators" | jq -c '[.[]? | {login, role_name, permissions}]')"
# `null | length` is 0: an unreadable list must stay null, or it would read as an empty one.
invitations="$(probe "/invitations" | jq -c 'if . == null then null else length end')"
teams="$(probe "/teams" | jq -c 'if . == null then null else length end')"
hooks="$(probe "/hooks" | jq -c 'if . == null then null else length end')"
keys="$(probe "/keys" | jq -c 'if . == null then null else length end')"
secrets="$(probe "/actions/secrets" | jq -c '.total_count')"
variables="$(probe "/actions/variables" | jq -c '.total_count')"
environments="$(probe "/environments" | jq -c '.total_count')"
branches="$(probe "/branches?per_page=100" | jq -c '[.[]? | {name, protected}]')"
open_pulls="$(probe "/pulls?state=open&per_page=100" | jq -c '[.[]? | {number, user: .user.login, head: .head.ref, head_sha: .head.sha}]')"
dependabot_file="$(probe "/contents/.github/dependabot.yml" | jq -c '{present: (. != null), sha: (.sha // null)}')"
in_progress_runs="$(probe "/actions/runs?status=in_progress" | jq -c '.total_count')"
queued_runs="$(probe "/actions/runs?status=queued" | jq -c '.total_count')"
vulnerability_alerts="$(enabled "/vulnerability-alerts")"
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
  --argjson dependabot_file "$dependabot_file" \
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
    dependabot: {config_file: $dependabot_file, open_pull_requests: $open_pulls},
    branches: $branches
  }
  | . + {frozen_check: (
      [
        (if .settings.visibility != "private" then "repository is not private" else empty end),
        (if .actions.permissions == null then "Actions permissions unreadable"
         elif .actions.permissions.enabled != false then "Actions are enabled: workflows can run and write (allowed_actions=\(.actions.permissions.allowed_actions))" else empty end),
        (if .actions.workflow_token == null then "workflow token permissions unreadable"
         elif .actions.workflow_token.default_workflow_permissions != "read" then "default workflow token is not read-only" else empty end),
        (if .actions.runs_in_progress != 0 or .actions.runs_queued != 0 then "workflow runs in progress or queued" else empty end),
        (if (.branch_protection == null or (.branch_protection.lock_branch.enabled // false) != true) and ((.rulesets // []) | length) == 0
         then "default branch is neither locked nor covered by a ruleset" else empty end),
        (if ((.rulesets // []) | length) == 0 then "no ruleset restricts creation or update of other refs" else empty end),
        (if .dependabot.config_file.present == true and (.actions.permissions.enabled != false)
         then "Dependabot version updates are configured in the tree and nothing prevents a run" else empty end),
        (if (.dependabot.open_pull_requests | length) > 0 then "\(.dependabot.open_pull_requests | length) open pull request(s): their refs/pull/* can still move" else empty end),
        (if (.access.collaborators | length) != 1 then "collaborators other than the owner" else empty end),
        (if [.access.pending_invitations, .access.teams, .access.webhooks, .access.deploy_keys, .actions.secrets, .actions.variables, .actions.environments] | any(. == null)
         then "an access or Actions control could not be read" else empty end),
        (if (.access.pending_invitations // 0) != 0 or (.access.teams // 0) != 0 or (.access.webhooks // 0) != 0 or (.access.deploy_keys // 0) != 0
         then "pending invitations, teams, webhooks or deploy keys present" else empty end),
        (if (.actions.secrets // 0) != 0 or (.actions.variables // 0) != 0 or (.actions.environments // 0) != 0 then "Actions secrets, variables or environments present" else empty end),
        (if .settings.has_issues == true then "issues enabled" else empty end)
      ] as $blockers
      | {frozen: ($blockers | length == 0), blockers: $blockers}
    )}
'
