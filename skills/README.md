<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Skills collection — installation

The admitted skills of this directory are governed by ADR-0025 (admission),
ADR-0050 (observed-failure bar, `working_if`, distribution) and ADR-0072
(admission state derived from evidence). Writing a
skill: `docs/method/SKILLS-ANATOMY.md`. Installing one is an act of the
harness, never of this repository.

## Claude Code — plugin marketplace

`.claude-plugin/marketplace.json` is generated from this directory
(`bun run build:skills-manifest`) and held equal to it by
`bun run check:skills-manifest`. Its one plugin, `libre-ai-skills`, lists the
admitted skills explicitly, so an install loads those skills and nothing else
of the repository.

```sh
claude plugin marketplace add libre-ai/project-governance
claude plugin install libre-ai-skills@libre-ai
```

The entry carries no `version`: the installed version is the commit sha of
the served branch, and `claude plugin update libre-ai-skills@libre-ai` follows
it. After an install or an update, the collision check of ADR-0050 D4 is due.

## Codex and Pi — documented copy

Copy a skill's directory as it stands (`SKILL.md`, and `references/` when
present) into the harness's user skill directory — for Codex,
`$HOME/.agents/skills/<name>/`, or `.agents/skills/<name>/` inside a
repository. `eval.json` is this repository's admission evidence, not part of
the skill, and need not be copied.

The inline SPDX header travels with the file (ADR-0025 D1). A copy is
compared to the canonical file here, byte for byte, before it is trusted:

```sh
diff -r <harness skill directory>/<name> skills/<name> -x eval.json
```

## Admission state — derived, never declared

Since ADR-0072 the admission state of a skill is computed from the checks it
passed, on the fingerprint of its directory, and written in the generated
receipt `ecosystem/projections/skills-admission.v1.json`:

- `candidate`: every required check passed on that fingerprint;
- `incomplete`: a required check failed, could not judge, or left no result.
  A check that was not run is never a dispensation.

`promoted` stays an act of the owner, bound to a fingerprint. No tool writes
it, no promotion is recorded yet, and a skill that declares it fails the gate
until the promotion record of ADR-0072 D6 exists.

After any change under `skills/<name>/`, regenerate the receipt in the same
commit:

```sh
bun run build:skills-admission
```

The generator exits with the verdict of the gate on what it wrote. When a
required check does not pass, it writes a receipt that says `incomplete`,
names the check and fails: generating again changes nothing, repair the skill
or the check.

`bun run check:skills-admission`, part of `bun run check`, fails and names the
skill when the receipt is not the one the tree generates (one changed byte is
enough), or when the `metadata.status` of a skill is not its derived state.
The frontmatter follows the derived state, never the reverse: repair the skill
or the check, not the word. It also fails, naming the file, when a file under
`skills/` is not tracked by git (ignored, or never added): `git add` it or
remove it. The gate and the generator ask git, so they run in a clone, not in
an exported copy.

The fingerprint recipe, `libre-ai.skill-fingerprint.v1`, is written in
`tools/skills/skill-fingerprint.ts`. It covers every file of the directory,
`eval.json` included, since the checks read it; a copy made without
`eval.json` is compared with the `diff -r` above, not by fingerprint. A
symbolic link, a special file or an unreadable file in a skill directory is
refused by name, never skipped. The required checks are listed in
`tools/skills/skills-admission-policy.v1.json`.

## Frontmatter and the Agent Skills validators

Since ADR-0053 the frontmatter carries only the Agent Skills fields, and
`status` lives under `metadata`, in block form (the reference validator
rejects the inline `{ }` form):

```yaml
metadata:
  status: candidate
```

That line is a copy of the derived state above, held equal to it by the gate
(ADR-0072 D5); it is not where the state is decided. T1 refuses any other
top-level key. Six skills pass the Agent Skills
reference validator as they stand (`uvx --from skills-ref agentskills
validate skills/<name>`).

Known limit: `deploy-clever` and `wizard` carry `disable-model-invocation:
true`, which keeps them user-invoked in Claude Code and which the reference
validator rejects. A copy of either meant for a surface that enforces the
Agent Skills fields (for example a claude.ai upload) loses that guarantee
once the key is removed, so it is not portable as is.
