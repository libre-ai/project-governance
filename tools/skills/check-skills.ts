// Skill lint gate (T1) — thin CLI wrapper over lint-skill.ts's pure checks.
//
// Every <name>/SKILL.md under skills/ is linted for frontmatter shape, the
// name/directory/status/licence fields, an inline SPDX header, and at least
// one heading; its eval.json is checked for the admission minimum (3
// positive triggers, 2 negative, 1 behavioral case). See lint-skill.ts for
// what each rule means and why it stops there.

import { existsSync } from "node:fs";
import { concludeGate, GateReport } from "../quality/gate-report";
import {
  BODY_LINE_TARGET,
  BODY_LINE_WARNING,
  bodyLineCount,
  lintEvalFile,
  lintSkillMarkdown,
  parseFrontmatter,
} from "./lint-skill";

const SKILLS_ROOT = "skills";

async function main(): Promise<void> {
  const report = new GateReport();

  if (!existsSync(SKILLS_ROOT)) {
    report.allowEmpty(`no ${SKILLS_ROOT}/ directory in this repository`);
    concludeGate("Skills lint (T1)", report);
    return;
  }

  const glob = new Bun.Glob("*/SKILL.md");
  const dirs: string[] = [];
  for await (const path of glob.scan({ cwd: SKILLS_ROOT, onlyFiles: true })) {
    const dir = path.split("/")[0];
    if (dir) dirs.push(dir);
  }
  dirs.sort();

  if (dirs.length === 0) {
    report.allowEmpty(`${SKILLS_ROOT}/ exists but holds no <name>/SKILL.md — nothing admitted yet`);
    concludeGate("Skills lint (T1)", report);
    return;
  }

  for (const dir of dirs) {
    const skillPath = `${SKILLS_ROOT}/${dir}/SKILL.md`;
    const source = await Bun.file(skillPath).text();
    for (const finding of lintSkillMarkdown(dir, source)) {
      report.check(`${skillPath} — ${finding.rule}`, finding.ok, finding.note);
    }

    const parsed = parseFrontmatter(source);
    if (!("error" in parsed)) {
      const lines = bodyLineCount(parsed.body);
      if (lines > BODY_LINE_WARNING) {
        console.warn(
          `::warning::${skillPath}: body is ${lines} lines, past the ${BODY_LINE_WARNING}-line CI warning (target: ${BODY_LINE_TARGET}) — consider progressive disclosure into references/`,
        );
      }
    }

    const evalPath = `${SKILLS_ROOT}/${dir}/eval.json`;
    if (!existsSync(evalPath)) {
      report.check(
        evalPath,
        false,
        "missing eval.json (3 positive triggers, 2 negative triggers, 1 behavioral case required)",
      );
      continue;
    }
    let raw: unknown;
    try {
      raw = await Bun.file(evalPath).json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.check(evalPath, false, `invalid JSON (${message})`);
      continue;
    }
    for (const finding of lintEvalFile(raw)) {
      report.check(`${evalPath} — ${finding.rule}`, finding.ok, finding.note);
    }
  }

  concludeGate("Skills lint (T1)", report);
}

if (import.meta.main) await main();
