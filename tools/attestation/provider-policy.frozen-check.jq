# Derives the frozen verdict (ADR-0038 D5) from a provider readback. Input: the readback object
# built by provider-policy.sh. Argument: $expected_collaborator, the one login allowed to hold
# access. Output: the input plus `frozen_check` = {frozen, blockers, residual_risks}.
#
# Fail-closed rules this file keeps:
#   - a control that could not be read is null, never an empty list or a false, and is a blocker;
#   - an absent field is not a satisfied condition: every ruleset predicate states the type it
#     expects before it reads the value (`null | length` is 0, which would pass as "empty").
# What cannot be frozen (Dependabot configured in the tree, refs/pull/*, owner authority) is
# reported under residual_risks and does not turn `frozen` false: it is named, not hidden.

def frozen_ruleset:
  (.enforcement == "active")
  and (.target == "branch")
  and (((.conditions.ref_name.include // []) | index("~ALL")) != null)
  and ((.conditions.ref_name.exclude | type) == "array" and (.conditions.ref_name.exclude | length) == 0)
  and ((.bypass_actors | type) == "array" and (.bypass_actors | length) == 0)
  and (.current_user_can_bypass == "never")
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
    (if ($unreadable | length) > 0 then "controls could not be read: \($unreadable | join(", "))" else empty end),
    (if .settings.visibility != "private" then "repository is not private" else empty end),
    (if .actions.permissions.enabled != false then "Actions are not disabled (allowed_actions=\(.actions.permissions.allowed_actions))" else empty end),
    (if .actions.workflow_token.default_workflow_permissions != "read" then "default workflow token is not read-only" else empty end),
    (if (.actions.runs_in_progress // 1) != 0 or (.actions.runs_queued // 1) != 0 then "workflow runs in progress or queued" else empty end),
    (if (.branch_protection.lock_branch.enabled // false) != true or (.branch_protection.enforce_admins.enabled // false) != true
     then "default branch is not locked with administrators enforced" else empty end),
    (if ([.rulesets[]? | select(frozen_ruleset)] | length) == 0
     then "no active ruleset without bypass forbids creating, updating, deleting or force-pushing any branch" else empty end),
    (if (.dependabot.config_file.present == true) and (.actions.permissions.enabled != false)
     then "Dependabot version updates are configured in the tree and Actions are enabled" else empty end),
    (if (((.access.collaborators // []) | map(.login)) != [$expected_collaborator])
     then "the collaborators are not exactly the owner" else empty end),
    (if (.access.pending_invitations // 1) != 0 or (.access.teams // 1) != 0 or (.access.webhooks // 1) != 0 or (.access.deploy_keys // 1) != 0
     then "pending invitations, teams, webhooks or deploy keys present" else empty end),
    (if (.actions.secrets // 1) != 0 or (.actions.variables // 1) != 0 or (.actions.environments // 1) != 0
     then "Actions secrets, variables or environments present" else empty end),
    (if (.settings.has_issues != false) then "issues are enabled" else empty end),
    (if (.settings.has_wiki != false) then "the wiki is enabled (a separate repository that goes public with this one)" else empty end),
    (if (.settings.has_pages != false) then "Pages are enabled" else empty end),
    (if (.settings.has_discussions != false) then "discussions are enabled" else empty end),
    (if (.settings.has_projects != false) then "projects are enabled" else empty end),
    (if (.security.vulnerability_alerts != false) then "vulnerability alerts are enabled (they can open pull requests)" else empty end),
    (if (.security.automated_security_fixes != false) then "automated security fixes are enabled (they open branches and pull requests)" else empty end)
  ] as $blockers
  | [
    (if .dependabot.config_file.present == true
     then "Dependabot version updates remain configured in the tree (weekly); removing the file would change the OID. Their inability to run rests on Actions being disabled and the ruleset, which is not measured until a scheduled run passes" else empty end),
    (if (.dependabot.open_pull_requests | length) > 0
     then "\(.dependabot.open_pull_requests | length) open pull request(s): refs/pull/* is a provider-managed namespace that no ruleset restricts and the owner cannot delete" else empty end),
    (if .settings.has_pull_requests == true
     then "pull requests are enabled: a new pull request creates refs/pull/N/* that no ruleset restricts; step 5 would refuse and a new attestation would be required" else empty end),
    "the owner keeps administrative authority over every setting above"
  ] as $residual
  | {frozen: ($blockers | length == 0), blockers: $blockers, residual_risks: $residual}
)}
