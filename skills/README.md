<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Skills collection — installation

The admitted skills of this directory are governed by ADR-0025 (admission)
and ADR-0050 (observed-failure bar, `working_if`, distribution). Writing a
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

## Known limit

The frontmatter key `status` is ignored by Claude Code but rejected by
validators that admit only the Agent Skills fields (for example a claude.ai
upload). A copy meant for such a surface needs `status` removed; the
canonical file keeps it, since T1 requires it (ADR-0025 D6).
