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
line), pushes without force and opens the pull request. It never merges: each
consumer's required checks and a reviewer do. A branch that already exists is
left as is. It refuses a target that `fleet-pins.v1.yaml` does not declare.

The workflow `.github/workflows/fleet-bump.yml` runs on every push to the served
branch that changes the register or the tool. Without the secret it runs the dry
run on public repositories, names private ones as excluded, writes the plan to
the job summary and says `apply disabled: no FLEET_BUMP_TOKEN`.

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
