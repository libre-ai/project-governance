# Fleet policy — stored workflow tokens

- **Status:** proposed — no invariant and no accepted ADR carries this
  document yet. `docs/decisions/INVARIANTS.md` is exhaustive by construction,
  so until one of them cites it, this is a proposal and not doctrine.
- **Scope:** the tokens a workflow of this repository reads from the
  repository's stored secrets. Each fleet repository keeps its own inventory;
  this one covers the workflows of this repository. Not in scope: a secret
  vault, and the variables of a hosted application (see
  [What this policy does not verify](#what-this-policy-does-not-verify)).

## The policy

A stored token is a standing write credential sitting where CI code runs. It
is legitimate only when it is needed, narrow, short-lived and written down.

1. **No stored token where the job's own token is enough.** If the ephemeral
   token of the job can do the work, nothing is stored.
2. **One token, one service, one environment.** A secret name is consumed by
   a single workflow and never serves two services.
3. **Minimal scope.** Named repositories, named permissions, read by default;
   every write permission is justified in the token's inventory row.
4. **Bounded lifetime.** 90 days at most. A token without an expiry is
   refused.
5. **Every stored secret has its inventory row,** and no row carries a value,
   a fingerprint or a fragment of one.

`tools/security/token-policy.test.ts` checks the inventory below against the
workflows of the same tree, on every `bun test`: a name a workflow references
and the inventory lacks, a row no workflow consumes, a name two workflows
consume, a workflow that passes `secrets: inherit`, a maximum lifetime above
90 days, a cell that carries a credential-shaped value, and a section that is
missing or out of order all fail. Its verdict is a function of the tracked
files: it reads neither the clock nor the network.

## Order of preference

1. **The ephemeral token of the job** (`github.token`), with a declared
   `permissions:` block.
2. **An installation token of a forge application,** minted inside the job,
   valid for one hour and never stored as such.
3. **A fine-grained personal access token** limited to named repositories and
   expiring within 90 days.

Two kinds of token are excluded, whatever the rank:

- the classic personal access token, which cannot be limited to named
  repositories;
- any token without an expiry date.

## Inventory

One row per secret name. `Consumer` is the single workflow file that reads the
secret. `Maximum lifetime (days)` is a ceiling, not a reading of the forge.
`Decision (dated)` cites the last recorded decision and the document that
traces it; it does not assert that the secret exists.

| Secret name | Service | Consumer | Scope | Maximum lifetime (days) | Functional owner | Decision (dated) |
| --- | --- | --- | --- | --- | --- | --- |
| `FLEET_BUMP_TOKEN` | Fleet bump | `.github/workflows/fleet-bump.yml` | Fleet repositories only. Contents write (push the bump branch), Pull requests write (open the pull request), Workflows write (a bump edits pinned workflow files) | 90 | Repository owner | Not created: owner decision of 2026-10-14, traced in `docs/toolchain/FLEET-BUMP.md` |
| `ORG_README_HEAL_TOKEN` | Organization README healing | `.github/workflows/org-readme-drift.yml` | The organization profile repository only. Contents write (push the healing branch), Pull requests write (open the pull request) | 90 | Repository owner | Owner action required, recorded on 2026-09-07, traced in `docs/method/AGENTIC-LOOP-INVENTORY.md` |

The two procedures cited in the last column stay the place where the steps to
create each token are written; this policy does not restate them.

## Rotation and exposure

- **Rotation** happens before the deadline, by revoking the token and
  creating a new one under the same secret name.
- **An exposed token** (a log, an agent session transcript, an artifact) is
  revoked without delay, and its inventory row is dated.
- **A token no workflow consumes** is deleted, not renewed.

Creating, rotating and revoking a token are owner acts; no agent performs
them.

## What this policy does not verify

- **Whether a secret actually exists on the forge.** The check reads tracked
  files; `tools/quality/check-secret-scan.ts` keeps values out of the tree and
  says nothing about names.
- **The actual expiry date of a token.** The inventory column is a ceiling;
  reading the real date needs an authorised read of the forge.
- **The variables of a hosted application.** They have no object while
  provisioning is deferred (`STATUS.md`, "Explicitly deferred").
