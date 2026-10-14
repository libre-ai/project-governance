# Derives the frozen verdict (ADR-0038 D5) from a provider readback. Input: the readback object
# built by provider-policy.sh. Argument: $expected_collaborator, the one login allowed to hold
# access. Output: the input plus `frozen_check` = {frozen, blockers, residual_risks}.
#
# Fail-closed rules this file keeps:
#   - a control that could not be read is null, never an empty list or a false, and is a blocker;
#   - an absent field is not a satisfied condition: every ruleset predicate states the type it
#     expects before it reads the value (`null | length` is 0, which would pass as "empty").
# What cannot be frozen (Dependabot configured in the tree, refs/pull/*, tags, owner authority) is
# reported under residual_risks and does not turn `frozen` false: it is named, not hidden.
#
# Every check is one `(if ... then "message" else empty end)` or one `and (...)` clause of the
# ruleset predicate, and carries a `# neutralise:<id>` marker. neutralise-check.ts counts them
# with its own pattern and, for each marker, replaces the condition by its permissive value and
# requires the test `red:<id>` (provider-policy.test.ts) to fail by assertion.

def frozen_ruleset:
  true
  # neutralise:frozen-ruleset-enforcement
  and (.enforcement == "active")
  # neutralise:frozen-ruleset-target
  and (.target == "branch")
  # neutralise:frozen-ruleset-include
  and (((.conditions.ref_name.include // []) | index("~ALL")) != null)
  # neutralise:frozen-ruleset-exclude
  and ((.conditions.ref_name.exclude | type) == "array" and (.conditions.ref_name.exclude | length) == 0)
  # neutralise:frozen-ruleset-bypass
  and ((.bypass_actors | type) == "array" and (.bypass_actors | length) == 0)
  # neutralise:frozen-ruleset-can-bypass
  and (.current_user_can_bypass == "never")
  # neutralise:frozen-ruleset-rules
  and (((.rules // []) | map(.type)) as $types
       | ["creation", "update", "deletion", "non_fast_forward"]
       | all(. as $required | $types | index($required) != null));

. + {frozen_check: (
  ([
    ["settings", .settings], ["rulesets", .rulesets], ["actions permissions", .actions.permissions],
    ["workflow token", .actions.workflow_token], ["collaborators", .access.collaborators],
    ["invitations", .access.pending_invitations], ["teams", .access.teams],
    ["webhooks", .access.webhooks], ["deploy keys", .access.deploy_keys],
    ["secrets", .actions.secrets], ["variables", .actions.variables],
    ["environments", .actions.environments], ["workflow runs", .actions.runs_in_progress],
    ["vulnerability alerts", .security.vulnerability_alerts],
    ["automated security fixes", .security.automated_security_fixes],
    ["dependabot file", .dependabot.config_file.present], ["open pull requests", .dependabot.open_pull_requests]
  ] | map(select(.[1] == null) | .[0])) as $unreadable
  | [
    # neutralise:frozen-unreadable
    (if ($unreadable | length) > 0 then "controls could not be read: \($unreadable | join(", "))" else empty end),
    # neutralise:frozen-visibility
    (if .settings.visibility != "private" then "repository is not private" else empty end),
    # neutralise:frozen-actions
    (if .actions.permissions.enabled != false then "Actions are not disabled (allowed_actions=\(.actions.permissions.allowed_actions))" else empty end),
    # neutralise:frozen-token
    (if .actions.workflow_token.default_workflow_permissions != "read" then "default workflow token is not read-only" else empty end),
    # neutralise:frozen-runs-in-progress
    (if (.actions.runs_in_progress // 1) != 0 then "workflow runs in progress" else empty end),
    # neutralise:frozen-runs-queued
    (if (.actions.runs_queued // 1) != 0 then "workflow runs queued" else empty end),
    # neutralise:frozen-lock
    (if (.branch_protection.lock_branch.enabled // false) != true then "default branch is not locked" else empty end),
    # neutralise:frozen-enforce-admins
    (if (.branch_protection.enforce_admins.enabled // false) != true then "default branch protection is not enforced on administrators" else empty end),
    # neutralise:frozen-ruleset
    (if ([.rulesets[]? | select(frozen_ruleset)] | length) == 0
     then "no active ruleset without bypass forbids creating, updating, deleting or force-pushing any branch" else empty end),
    # neutralise:frozen-dependabot-actions
    (if (.dependabot.config_file.present == true) and (.actions.permissions.enabled != false)
     then "Dependabot version updates are configured in the tree and Actions are enabled" else empty end),
    # neutralise:frozen-collaborator
    (if (((.access.collaborators // []) | map(.login)) != [$expected_collaborator])
     then "the collaborators are not exactly the owner" else empty end),
    # neutralise:frozen-invitations
    (if (.access.pending_invitations // 1) != 0 then "pending invitations present" else empty end),
    # neutralise:frozen-teams
    (if (.access.teams // 1) != 0 then "teams present" else empty end),
    # neutralise:frozen-webhooks
    (if (.access.webhooks // 1) != 0 then "webhooks present" else empty end),
    # neutralise:frozen-deploy-keys
    (if (.access.deploy_keys // 1) != 0 then "deploy keys present" else empty end),
    # neutralise:frozen-secrets
    (if (.actions.secrets // 1) != 0 then "Actions secrets present" else empty end),
    # neutralise:frozen-variables
    (if (.actions.variables // 1) != 0 then "Actions variables present" else empty end),
    # neutralise:frozen-environments
    (if (.actions.environments // 1) != 0 then "Actions environments present" else empty end),
    # neutralise:frozen-issues
    (if (.settings.has_issues != false) then "issues are enabled" else empty end),
    # neutralise:frozen-wiki
    (if (.settings.has_wiki != false) then "the wiki is enabled (a separate repository that goes public with this one)" else empty end),
    # neutralise:frozen-pages
    (if (.settings.has_pages != false) then "Pages are enabled" else empty end),
    # neutralise:frozen-discussions
    (if (.settings.has_discussions != false) then "discussions are enabled" else empty end),
    # neutralise:frozen-projects
    (if (.settings.has_projects != false) then "projects are enabled" else empty end),
    # neutralise:frozen-vulnerability-alerts
    (if (.security.vulnerability_alerts != false) then "vulnerability alerts are enabled (they can open pull requests)" else empty end),
    # neutralise:frozen-security-fixes
    (if (.security.automated_security_fixes != false) then "automated security fixes are enabled (they open branches and pull requests)" else empty end)
  ] as $blockers
  | [
    # neutralise:frozen-residual-dependabot
    (if .dependabot.config_file.present == true
     then "Dependabot version updates remain configured in the tree (weekly); removing the file would change the OID. Their inability to run rests on Actions being disabled and the ruleset, which is not measured until a scheduled run passes" else empty end),
    # neutralise:frozen-residual-open-pr
    (if (.dependabot.open_pull_requests | length) > 0
     then "\(.dependabot.open_pull_requests | length) open pull request(s): refs/pull/* is a provider-managed namespace that no ruleset restricts and the owner cannot delete" else empty end),
    # neutralise:frozen-residual-pull-requests
    (if .settings.has_pull_requests == true
     then "pull requests are enabled: a new pull request creates refs/pull/N/* that no ruleset restricts; step 5 would refuse and a new attestation would be required" else empty end),
    # neutralise:frozen-residual-tags
    (if (((.rulesets // []) | map(select(.target == "tag" and .enforcement == "active")) | length) == 0)
     then "no tag ruleset: the only ruleset targets branches, so a tag could be created by the owner; step 5 would refuse it through the ref-set comparison" else empty end),
    "the owner keeps administrative authority over every setting above"
  ] as $residual
  | {frozen: ($blockers | length == 0), blockers: $blockers, residual_risks: $residual}
)}
