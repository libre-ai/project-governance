/**
 * Skill non-cascade gate (T3) — the rule docs/method/SKILLS-ANATOMY.md
 * states ("une skill `user-invoked` n'invoque jamais une autre skill
 * `user-invoked`") and that nothing verified until this gate.
 *
 * Why the rule exists: `disable-model-invocation: true` protects an action
 * the user authorises explicitly, every time (a deployment, a publication).
 * If user-invoked skill A could hand off to user-invoked skill B, invoking A
 * would authorise B implicitly, and B's protection would evaporate as soon as
 * it had a caller ahead of it in the chain.
 *
 * What is read: for every user-invoked skill, its SKILL.md body and every
 * Markdown file under its `references/` directory — the files an agent loads
 * when following the skill. `eval.json` is not read: its triggers are what a
 * user types, not what the skill instructs.
 *
 * What counts as a reference to user-invoked skill `x` (case-insensitive):
 *
 * - the Skill tool form: `Skill tool with "x"` (any quote or backtick);
 * - the slash form: `/x` as its own token (not `skills/x/`, not `a/x`);
 * - the instruction form: `invoke x`, `invoke the x skill`, and
 *   `run|use|call|load|trigger the x skill`.
 *
 * A self-reference is not a cascade and is ignored. A reference to a
 * model-invoked skill is allowed by the rule and is ignored too. The corpus
 * is this repository's `skills/`: a user-invoked skill installed only on a
 * machine is outside what this gate can see, and it says so in its volume.
 *
 * A skill whose frontmatter cannot be read is a failure, never a skip: its
 * invocation mode is unknown, so the rule cannot be judged for it.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./lint-skill";

export interface SkillText {
  readonly name: string;
  /** Raw SKILL.md, frontmatter included. */
  readonly skillMarkdown: string;
  /** Other instruction files of the skill, keyed by repository-relative path. */
  readonly references: Readonly<Record<string, string>>;
}

export interface CascadeReference {
  readonly caller: string;
  readonly callee: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface CascadeCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

export interface CascadeResult {
  readonly checks: readonly CascadeCheck[];
  readonly skillsRead: number;
  readonly userInvoked: number;
  readonly filesScanned: number;
  readonly pairsExamined: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The three reference forms for one callee name, as line-level patterns. */
export function referencePatterns(callee: string): readonly RegExp[] {
  const name = escapeRegExp(callee);
  const quote = "[\"'`]?";
  return [
    new RegExp(`skill\\s+tool\\s+with\\s+${quote}${name}${quote}(?![\\w-])`, "i"),
    new RegExp(`(?:^|[\\s(\\[{"'\`])/${name}(?![\\w-])`, "i"),
    new RegExp(`\\binvok\\w*\\s+(?:the\\s+)?${quote}${name}${quote}(?![\\w-])`, "i"),
    new RegExp(
      `\\b(?:run|use|call|load|trigger)\\w*\\s+the\\s+${quote}${name}${quote}\\s+skill\\b`,
      "i",
    ),
  ];
}

/** Every line of `text` that references `callee` in one of the admitted forms. */
export function findReferences(
  caller: string,
  callee: string,
  file: string,
  text: string,
): CascadeReference[] {
  const patterns = referencePatterns(callee);
  const found: CascadeReference[] = [];
  text.split("\n").forEach((content, index) => {
    if (patterns.some((pattern) => pattern.test(content))) {
      found.push({ caller, callee, file, line: index + 1, text: content.trim() });
    }
  });
  return found;
}

function blankFrontmatter(source: string, body: string): string {
  const headerLines = source.split("\n").length - body.split("\n").length;
  return `${"\n".repeat(headerLines)}${body}`;
}

/** Pure verdict over already-read skill texts. */
export function evaluateNonCascade(skills: readonly SkillText[]): CascadeResult {
  const checks: CascadeCheck[] = [];
  const userInvoked: { name: string; files: Record<string, string> }[] = [];

  for (const skill of skills) {
    const parsed = parseFrontmatter(skill.skillMarkdown);
    if ("error" in parsed) {
      checks.push({
        item: `skills/${skill.name}/SKILL.md`,
        ok: false,
        note: `frontmatter unreadable, invocation mode unknown: ${parsed.error} (see T1)`,
      });
      continue;
    }
    if (parsed.frontmatter["disable-model-invocation"] === "true") {
      userInvoked.push({
        name: skill.name,
        // The frontmatter is blanked, not cut, so a reported line number is the
        // file's own line number.
        files: {
          [`skills/${skill.name}/SKILL.md`]: blankFrontmatter(skill.skillMarkdown, parsed.body),
          ...skill.references,
        },
      });
    }
  }

  let filesScanned = 0;
  let pairsExamined = 0;
  for (const caller of userInvoked) {
    const callees = userInvoked.filter((other) => other.name !== caller.name);
    const references: CascadeReference[] = [];
    for (const [file, text] of Object.entries(caller.files)) {
      filesScanned += 1;
      for (const callee of callees) {
        references.push(...findReferences(caller.name, callee.name, file, text));
      }
    }
    pairsExamined += callees.length;
    if (references.length === 0) {
      checks.push({
        item: `skills/${caller.name}`,
        ok: true,
        note: `user-invoked; references none of ${callees.length} other user-invoked skill(s) across ${Object.keys(caller.files).length} file(s)`,
      });
    } else {
      for (const reference of references) {
        checks.push({
          item: `${reference.file}:${reference.line}`,
          ok: false,
          note: `user-invoked "${reference.caller}" references user-invoked "${reference.callee}" (non-cascade rule, SKILLS-ANATOMY.md): "${reference.text}"`,
        });
      }
    }
  }

  return {
    checks,
    skillsRead: skills.length,
    userInvoked: userInvoked.length,
    filesScanned,
    pairsExamined,
  };
}

export function formatCascadeVolume(result: CascadeResult): string {
  return (
    `${result.skillsRead} skill(s) read, ${result.userInvoked} user-invoked, ` +
    `${result.filesScanned} instruction file(s) scanned, ${result.pairsExamined} (caller, callee) pair(s) examined ` +
    "(corpus: this repository's skills/ only)"
  );
}

function listMarkdown(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...listMarkdown(path));
    else if (entry.endsWith(".md")) found.push(path);
  }
  return found;
}

export async function loadSkillTexts(root: string): Promise<SkillText[]> {
  const skills: SkillText[] = [];
  for (const name of readdirSync(root).sort()) {
    const skillPath = join(root, name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const references: Record<string, string> = {};
    for (const path of listMarkdown(join(root, name, "references"))) {
      references[path] = await Bun.file(path).text();
    }
    skills.push({ name, skillMarkdown: await Bun.file(skillPath).text(), references });
  }
  return skills;
}

async function main(): Promise<void> {
  const { concludeGate, GateReport } = await import("../quality/gate-report");
  const gate = "Skills non-cascade (T3)";
  // The root is an argument so the gate can be run against a fixture tree and
  // be seen to fail; the aggregated check passes none and reads skills/.
  const root = process.argv[2] ?? "skills";
  const report = new GateReport();
  if (!existsSync(root)) {
    report.allowEmpty(`no ${root}/ directory in this repository`);
    concludeGate(gate, report);
    return;
  }
  const result = evaluateNonCascade(await loadSkillTexts(root));
  if (result.skillsRead === 0) {
    report.allowEmpty(`${root}/ holds no <name>/SKILL.md — nothing admitted yet`);
  }
  for (const check of result.checks) report.check(check.item, check.ok, check.note);
  if (result.skillsRead > 0 && result.checks.length === 0) {
    report.allowEmpty(
      `${result.skillsRead} skill(s) read, none user-invoked — the rule binds only user-invoked skills`,
    );
  }
  report.volume(formatCascadeVolume(result));
  concludeGate(gate, report);
}

if (import.meta.main) await main();
