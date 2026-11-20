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

export interface SkillLintCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

export interface SkillLint {
  readonly checks: readonly SkillLintCheck[];
  /** Body length of SKILL.md, or null when its frontmatter cannot be read. */
  readonly bodyLines: number | null;
}

/**
 * Every T1 check of one skill directory: its SKILL.md, then its eval.json.
 * One function for the gate below and for the admission receipt
 * (build-skills-admission.ts), so the receipt records the verdict of this
 * gate and not of a second reading of the same rules.
 */
export async function lintSkillDirectory(root: string, dir: string): Promise<SkillLint> {
  const checks: SkillLintCheck[] = [];
  const skillPath = `${root}/${dir}/SKILL.md`;
  const source = await Bun.file(skillPath).text();
  for (const finding of lintSkillMarkdown(dir, source)) {
    checks.push({ item: `${skillPath} — ${finding.rule}`, ok: finding.ok, note: finding.note });
  }

  const parsed = parseFrontmatter(source);
  const status = "error" in parsed ? undefined : parsed.metadata.status;
  const bodyLines = "error" in parsed ? null : bodyLineCount(parsed.body);

  const evalPath = `${root}/${dir}/eval.json`;
  if (!existsSync(evalPath)) {
    checks.push({
      item: evalPath,
      ok: false,
      note: "missing eval.json (3 positive triggers, 2 negative triggers, 1 behavioral case required)",
    });
    return { checks, bodyLines };
  }
  let raw: unknown;
  try {
    raw = await Bun.file(evalPath).json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ item: evalPath, ok: false, note: `invalid JSON (${message})` });
    return { checks, bodyLines };
  }
  for (const finding of lintEvalFile(raw, status)) {
    checks.push({ item: `${evalPath} — ${finding.rule}`, ok: finding.ok, note: finding.note });
  }
  return { checks, bodyLines };
}

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
    const lint = await lintSkillDirectory(SKILLS_ROOT, dir);
    for (const check of lint.checks) report.check(check.item, check.ok, check.note);
    if (lint.bodyLines !== null && lint.bodyLines > BODY_LINE_WARNING) {
      console.warn(
        `::warning::${SKILLS_ROOT}/${dir}/SKILL.md: body is ${lint.bodyLines} lines, past the ${BODY_LINE_WARNING}-line CI warning (target: ${BODY_LINE_TARGET}) — consider progressive disclosure into references/`,
      );
    }
  }

  concludeGate("Skills lint (T1)", report);
}

if (import.meta.main) await main();
