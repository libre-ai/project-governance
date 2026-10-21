# Fleet generation bump

`tools/fleet/bump-generation.ts` automates step 3 of the procedure written at the
head of `ecosystem/fleet-pins.v1.yaml` (commit in governance → declare the
generation → **bump consumers** → retire the old generation). It plans, for every
non-archived repository of `ecosystem/repositories.v1.yaml` except this one, the
exact edit set that moves its pin surfaces to the target generation, and refuses
any repository where that edit set cannot be computed safely.

## Running it

```sh
bun tools/fleet/bump-generation.ts                    # dry run to the most recent declared generation
bun tools/fleet/bump-generation.ts --to <sha>         # dry run to any authority commit (plan only)
bun tools/fleet/bump-generation.ts --only libre-ai/signalement,libre-ai/carriere
bun tools/fleet/bump-generation.ts --public-only      # names private repositories as excluded
bun tools/fleet/bump-generation.ts --apply            # needs FLEET_BUMP_TOKEN and a declared target
```

`--dry-run` is the default and writes nothing. Every consumer is read through one
GraphQL batch of `HEAD:<path>` expressions, so the served branch is used whatever
it is called. The final line prints the volume examined — repositories to bump, up
to date, without surface, refused, unreadable and excluded, and the number of
sites read in how many files. The exit status is non-zero when any repository is
refused or unreadable, or when no site at all was observed.

The surfaces it recognises, the refusals and their reasons are documented at the
head of `tools/fleet/bump-plan.ts`. Data the tool needs and no repository can
tell it — the commit identity, the secret name, the historical sites never to
move — lives in `tools/fleet/bump-generation.v1.yaml`, never in the code.

What it refuses rather than edits, among others: surfaces that disagree; an
occurrence of the old generation on no recognised surface; a Cargo source whose
`rev` is coupled to a composed ref the target moves (that bump needs the
`Cargo.toml`, `Cargo.lock` and `sdk-input-pin.json` work, which is not a pin
edit); a `bun.lock` resolution whose dependencies the target changes.

## `--apply`

For each repository planned as `bump`, `--apply` clones the served branch,
re-plans on the clone (a second instrument, and a full-tree count of the old
generation), refuses when the two plans disagree, commits on `work/bump-<gen8>`
with `-s` and the identity of `bump-generation.v1.yaml` (sign-off as the last
line), pushes without force and opens the pull request. The commit message ends with
the declaration `Exempt: fleet-bump` in the same trailer block as the sign-off, which
the work-package link gate reads; the tool re-reads the written message and refuses
the repository when the sign-off is not the last line or the declaration is missing. It never merges: each
consumer's required checks and a reviewer do. A branch that already exists is
left as is. It refuses a target that `fleet-pins.v1.yaml` does not declare.

The workflow `.github/workflows/fleet-bump.yml` runs on every push to the served
branch that changes the register or the tool. Without the secret it runs the dry
run on public repositories, names private ones as excluded, writes the plan to
the job summary and says `apply disabled: no FLEET_BUMP_TOKEN`.

## Generation coherence, before a declaration and before `--apply`

A generation is a governance commit whose composition manifest composes one ref
per repository, and nothing used to run those refs against each other.
`.github/composition/check-generation-coherence.py` does: it fetches every
composed repository at its composed ref into one new root, lists the gate roots
of each target (every tracked `package.json` whose `check:bun` runs
`check-bun-manifests.ts`), runs `bun install --frozen-lockfile --ignore-scripts`
and then the `check-bun-manifests.ts` of the **composed** governance from each
root. Generation Q composed a toolkit whose `packages/ui` carries a
`prepublishOnly` the composed governance refuses; the declaration merged green
because the composition check of this repository composes itself at the pull
request head, and `check-composed-paths.py` only asks whether a path exists.

```sh
python3 -B .github/composition/check-generation-coherence.py --root "$(mktemp -d)/root"
python3 -B .github/composition/check-generation-coherence.py --declaration <sha> --root "$(mktemp -d)/root"
```

`--declaration <sha>` replays the manifest that governance commit composes, which
is what declaring that sha as a generation declares. It prints its counters
(targets declared = verified + failed + not applicable, gate roots replayed and
passed) and exits non-zero on any failure; a ref that cannot be fetched, an
install that fails, a target with no gate root and a governance without the gate
are failures, never skips. The one exempt kind is a target whose composition runs
no Bun install and which tracks no `package.json` (today
`database-policy-inspector`), counted and named. It builds nothing: the toolkit's
UI build is a product gate, not a manifest gate. It also prints how the tracked
`package.json` files split (gate roots + covered by a root + not examined, the
latter named), and with `--declaration` it fails when the gate files of the
declared commit differ from those of the composed governance it replays.

What it executes, and what it does not contain: the targets are other
repositories' code. Every `bun` call runs under `--config=<empty file outside the
target>`, because Bun reads the `bunfig.toml` of its working directory and a
`preload` there runs the target's own file in the gate's process (probed: it wrote
an environment variable to a file; under `--config` it no longer does). The
processes run with an allow-listed environment (`PATH`, `HOME`, `TMPDIR`,
`LANG`, `LC_ALL` and git's own settings), and `--ignore-scripts` keeps
lifecycle scripts out of the install. That is a reduction, not a sandbox: the
install still reads the target's lockfile and `.npmrc`, and a scrubbed
environment protects only what the process was not handed. A secret must
therefore never be present where the guard runs.

Where it runs:

- `.github/workflows/generation-coherence.yml`, on every pull request (so that
  its check can be required), and on a push that changes the manifest, the
  register of generations or the guard: on the manifest of the commit, and, for
  every `sha:` the change adds to `ecosystem/fleet-pins.v1.yaml`
  (`tools/fleet/added-generations.ts`, from the YAML of both registers), on the
  manifest that sha composes — before the declaration merges (step 2 of the
  procedure). It holds no secret.
- `.github/workflows/fleet-bump.yml`, job `coherence`: the target generation is
  replayed in a job that holds neither `FLEET_BUMP_TOKEN` nor a persisted
  checkout credential, and the `plan` job (the one that applies) `needs` it. A red
  composition therefore opens nothing and plans nothing.
- `--apply` of this tool replays the same guard again before the first consumer
  pull request is opened (step 3), with the environment scrubbed of the write
  token: a second barrier for a local `--apply`, not a replacement for the job
  above, since the process that holds the token is the wrong place to run another
  repository's install.

## Apply stays local: no fleet write token in CI

Owner decision 2026-10-14: the `FLEET_BUMP_TOKEN` secret is not created. A token
that can push to every fleet repository, stored where CI code runs, is a write
credential the fleet does without; the workflow therefore stays plan-only and
says `apply disabled: no FLEET_BUMP_TOKEN` on each run, which is the expected
state, not a missing step. A generation is applied by running
`bun tools/fleet/bump-generation.ts --apply` locally, under the owner's own `gh`
authentication for that one command (how generation R reached its 17 consumers),
or by bumping refused repositories by hand. Nothing else changes: each consumer's
required checks still decide the merge.

The steps below are kept for a reversal of that decision.

## Owner steps to enable apply

Creating the credential is an owner act; no agent creates it.

1. Create a **fine-grained personal access token** with resource owner
   `libre-ai`, repository access limited to the fleet repositories (every
   non-archived repository of `ecosystem/repositories.v1.yaml`, private ones
   included), and these repository permissions:
   - Contents: Read and write (push the bump branch);
   - Pull requests: Read and write (open the pull request);
   - Workflows: Read and write (a bump edits `.github/workflows/*.yml`; GitHub
     refuses such a push without it);
   - Metadata: Read (implied).
   Set an expiry; the workflow fails visibly once it lapses.
2. Store it as the repository secret `FLEET_BUMP_TOKEN` of
   `libre-ai/project-governance` (Settings → Secrets and variables → Actions).
   The name is read from `apply_token_secret` in `bump-generation.v1.yaml`.
3. Check the plan before the first apply: dispatch **Fleet bump** with no input
   and read the job summary — with the secret present the run applies, so run
   the tool locally in dry run first if in doubt.

A GitHub App is the alternative to step 1 (permissions identical, installed on
the same repositories). Its installation tokens expire after one hour, so it
cannot be stored as `FLEET_BUMP_TOKEN` directly: the workflow would need a
token-minting step before the tool runs, which is a change to this repository.

After an apply, two consumer-side acts stay manual: refused repositories (the
Cargo-coupled ones, chiefly) are bumped by hand, and `product-research`'s action
allow-list setting is realigned on its `toolchains/github-actions.json`.
