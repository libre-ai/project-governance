// Skill lint gate (T1) — thin CLI wrapper over lint-skill.ts's pure checks.
//
// Every <name>/SKILL.md under skills/ is linted for frontmatter shape, the
// name/directory/status/licence fields, an inline SPDX header, and at least
// one heading; its eval.json is checked for the admission minimum (3
// positive triggers, 2 negative, 1 behavioral case). See lint-skill.ts for
// what each rule means and why it stops there.

import { existsSync, readdirSync } from "node:fs";
import { printable } from "../../ecosystem/fleet-gates";
import { concludeGate, GateReport } from "../quality/gate-report";
import {
  BODY_LINE_TARGET,
  BODY_LINE_WARNING,
  bodyLineCount,
  lintEvalFile,
  lintSkillMarkdown,
  parseFrontmatter,
} from "./lint-skill";

const GATE = "Skills lint (T1)";
const SKILLS_ROOT = "skills";

/**
 * Where the root came from. The default root may be absent — a repository
 * before its first admitted skill has no skills/ — but a root somebody named
 * on the command line and that does not exist is a wrong path: answering
 * "verified nothing, as declared" to it would turn a typo into a green run.
 * The same holds for a named root that exists and holds no skill: an empty
 * directory, or the wrong level (the parent of skills/), is a wrong path too.
 */
export type SkillsRootOrigin = "default" | "argument";

/**
 * A text this gate did not write, made safe to print on one line and read
 * back without ambiguity. `printable`, shared with the fleet gates, writes
 * C0, DEL, C1, U+2028, U+2029, U+200E, U+200F, U+202A to U+202E and U+2066
 * to U+2069 as `\uXXXX`. The backslash is doubled first: without it a name
 * holding the six characters `\u000a` prints like a name holding a line
 * break. One notation, so a line break is `\u000a` wherever it is printed.
 *
 * Left as they are, and still able to mislead a reader: U+061C, a bidi
 * control `printable` does not list; zero-width characters; every other
 * printable non-ASCII text.
 */
function shown(text: string): string {
  return printable(text.replaceAll("\\", "\\\\"));
}

/**
 * Every text this gate prints comes through `shown`, here or at the
 * body-length warning, and nowhere else: escaped once, since a second pass
 * would double the backslashes again.
 *
 * That covers what a message quotes from a SKILL.md or an eval.json as well
 * as the names read from the file system, although only the names are new to
 * this gate's output. A skill under admission is text somebody else wrote:
 * an escape sequence in its frontmatter repaints the verdict line as surely
 * as one in a directory name. The price is that a message quoting a tab, a
 * carriage return or a backslash shows it escaped where it showed it raw.
 */
class PrintableGateReport extends GateReport {
  override check(item: string, ok: boolean, note: string): this {
    return super.check(shown(item), ok, shown(note));
  }

  override allowEmpty(because: string): this {
    return super.allowEmpty(shown(because));
  }

  override volume(summary: string): this {
    return super.volume(shown(summary));
  }
}

/**
 * A path under `root`, joined by exactly one slash whatever trailing slashes
 * the argument carried. Not `node:path` join: it folds `..` in the text, and
 * the text would then name another path than the one the file system
 * resolved when a segment is a symbolic link.
 */
function under(root: string, path: string): string {
  return `${root.replace(/\/+$/, "")}/${path}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The root was listed, and its entries could then not be accounted for: the
 * scan for SKILL.md failed on something under it, or matched a name the
 * listing does not hold. `entry` is that path, relative to the root, when
 * one is known; the message says which of the two happened.
 */
export class SkillsRootEntryUnaccounted extends Error {
  readonly entry: string | null;

  constructor(entry: string | null, message: string) {
    super(message);
    this.entry = entry;
  }
}

export type SetAsideKind = "directory" | "symlink" | "other";

export interface SetAsideEntry {
  readonly name: string;
  readonly kind: SetAsideKind;
}

/**
 * The entries directly under the skills root, split in two with nothing left
 * over: `skills` are the names whose SKILL.md the gate's glob matched, each
 * linted; `setAside` is every other entry, none of them linted. Both are
 * filtered from `entries`, so the two parts sum to it by construction.
 */
export interface SkillsRootListing {
  readonly entries: readonly string[];
  readonly skills: readonly string[];
  readonly setAside: readonly SetAsideEntry[];
}

/** `ls -F` marks: a trailing `/` for a directory, `@` for a symbolic link. */
function setAsideLabel(entry: SetAsideEntry): string {
  if (entry.kind === "directory") return `${entry.name}/`;
  if (entry.kind === "symlink") return `${entry.name}@`;
  return entry.name;
}

/**
 * An assertion count is not a corpus size (gate-report.ts, `volume`), and a
 * count of matched skills is not the size of skills/ either: a directory the
 * glob does not match (no SKILL.md, a misspelt one, a dotted name) would be
 * neither linted nor mentioned. So the line states the whole directory —
 * entries = skills read + set aside — and names what was set aside, because
 * a legitimate one (.out-of-scope/, README.md) and a skill lost to a typo
 * look the same as a bare number.
 *
 * "read" covers both files of a skill: a missing or unparseable eval.json is
 * a failed check, so no success line is printed over a skill half read.
 *
 * The names are returned as read: the report escapes them where it prints.
 */
export function formatSkillsLintVolume(root: string, listing: SkillsRootListing): string {
  const named =
    listing.setAside.length === 0 ? "" : ` (${listing.setAside.map(setAsideLabel).join(", ")})`;
  return (
    `entries under ${under(root, "")}: ${listing.entries.length} = ${listing.skills.length} skill(s) read ` +
    `+ ${listing.setAside.length} set aside${named}`
  );
}

/**
 * Split what the directory listing holds (`listed`, each entry with its kind)
 * against the names the glob matched. The three arrays returned are all
 * filtered from the listing, so they sum by construction.
 *
 * A name the glob matched and the listing does not hold belongs to none of
 * them: filtered away, it would be a skill neither linted nor counted, on a
 * line that still sums. The two readings are taken one after the other, so a
 * directory created in between is enough. It is a failure naming the name.
 */
export function splitSkillsRoot(
  listed: readonly SetAsideEntry[],
  matched: ReadonlySet<string>,
): SkillsRootListing {
  const entries = listed.map((entry) => entry.name);
  const unlisted = [...matched].filter((name) => !entries.includes(name)).sort();
  const [firstUnlisted] = unlisted;
  if (firstUnlisted !== undefined) {
    throw new SkillsRootEntryUnaccounted(
      firstUnlisted,
      `the scan matched ${unlisted.length} name(s) the listing of the skills root does not hold ` +
        `(${unlisted.join(", ")}) — the two readings of the root disagree, so nothing was linted`,
    );
  }
  return {
    entries,
    skills: entries.filter((name) => matched.has(name)),
    setAside: listed.filter((entry) => !matched.has(entry.name)),
  };
}

/**
 * Read the root twice and split the first reading against the second: a
 * directory listing, then the gate's glob. The glob stays the selector, so
 * which skills are linted does not depend on the listing; the listing only
 * accounts for what the glob left out.
 *
 * Throws when the root cannot be listed, and a `SkillsRootEntryUnaccounted`
 * when the scan fails under a root that was listed or matches a name the
 * listing does not hold — the caller turns each into a failure naming it.
 */
export async function listSkillsRoot(root: string): Promise<SkillsRootListing> {
  const listed: SetAsideEntry[] = readdirSync(root, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((dirent) => ({
      name: dirent.name,
      kind: dirent.isDirectory() ? "directory" : dirent.isSymbolicLink() ? "symlink" : "other",
    }));

  const matched = new Set<string>();
  const glob = new Bun.Glob("*/SKILL.md");
  try {
    for await (const path of glob.scan({ cwd: root, onlyFiles: true })) {
      const dir = path.split("/")[0];
      if (dir) matched.add(dir);
    }
  } catch (error) {
    const path = (error as { path?: unknown }).path;
    throw new SkillsRootEntryUnaccounted(
      typeof path === "string" ? path : null,
      `the skills root was listed, the scan for <name>/SKILL.md then failed under it (${messageOf(error)})`,
    );
  }

  return splitSkillsRoot(listed, matched);
}

/**
 * Lint every skill under `root`. The root is a parameter so the gate can be
 * run against a fixture tree; the aggregated check passes none and reads
 * skills/.
 */
export async function lintSkillsCollection(
  root: string,
  origin: SkillsRootOrigin,
): Promise<GateReport> {
  const report = new PrintableGateReport();

  if (!existsSync(root)) {
    if (origin === "argument") {
      report.check(
        root,
        false,
        "the skills root passed as an argument does not exist — a named root that is absent is a wrong path, not an empty collection",
      );
      return report;
    }
    report.allowEmpty(`no ${under(root, "")} directory in this repository`);
    return report;
  }

  let listing: SkillsRootListing;
  try {
    listing = await listSkillsRoot(root);
  } catch (error) {
    // Neither is an empty collection, and each names what it could not read:
    // an entry under a root that was listed, or the root itself.
    if (error instanceof SkillsRootEntryUnaccounted) {
      report.check(error.entry === null ? root : under(root, error.entry), false, error.message);
      return report;
    }
    report.check(root, false, `cannot list the skills root (${messageOf(error)})`);
    return report;
  }

  if (listing.skills.length === 0) {
    const volume = formatSkillsLintVolume(root, listing);
    if (origin === "argument") {
      report.check(
        root,
        false,
        "the skills root passed as an argument holds no <name>/SKILL.md — a named root is expected to hold " +
          `skills, so an empty directory or the wrong level is a wrong path (${volume})`,
      );
      return report;
    }
    report.allowEmpty(
      `${under(root, "")} exists but holds no <name>/SKILL.md — nothing admitted yet (${volume})`,
    );
    return report;
  }

  for (const dir of listing.skills) {
    const skillPath = under(root, `${dir}/SKILL.md`);
    let source: string;
    try {
      source = await Bun.file(skillPath).text();
    } catch (error) {
      // Selected by the scan, then unreadable: a skill not read is a failure, not one skill fewer.
      report.check(skillPath, false, `cannot read SKILL.md (${messageOf(error)})`);
      continue;
    }
    for (const finding of lintSkillMarkdown(dir, source)) {
      report.check(`${skillPath} — ${finding.rule}`, finding.ok, finding.note);
    }

    const parsed = parseFrontmatter(source);
    const status = "error" in parsed ? undefined : parsed.metadata.status;
    if (!("error" in parsed)) {
      const lines = bodyLineCount(parsed.body);
      if (lines > BODY_LINE_WARNING) {
        console.warn(
          shown(
            `::warning::${skillPath}: body is ${lines} lines, past the ${BODY_LINE_WARNING}-line CI warning (target: ${BODY_LINE_TARGET}) — consider progressive disclosure into references/`,
          ),
        );
      }
    }

    const evalPath = under(root, `${dir}/eval.json`);
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
      report.check(evalPath, false, `invalid JSON (${messageOf(error)})`);
      continue;
    }
    for (const finding of lintEvalFile(raw, status)) {
      report.check(`${evalPath} — ${finding.rule}`, finding.ok, finding.note);
    }
  }

  report.volume(formatSkillsLintVolume(root, listing));
  return report;
}

/**
 * The gate as the command line states it: no argument reads skills/, one
 * argument names the root. Anything past the first was ignored in silence,
 * so `check-skills.ts a b` linted `a` and said nothing of `b`.
 */
export async function lintSkillsFromArguments(args: readonly string[]): Promise<GateReport> {
  if (args.length > 1) {
    return new PrintableGateReport().check(
      "arguments",
      false,
      `expected at most one, the skills root; got ${args.length}: ` +
        args.map((argument) => `« ${argument} »`).join(" "),
    );
  }
  const [argument] = args;
  return argument === undefined
    ? lintSkillsCollection(SKILLS_ROOT, "default")
    : lintSkillsCollection(argument, "argument");
}

async function main(): Promise<void> {
  concludeGate(GATE, await lintSkillsFromArguments(process.argv.slice(2)));
}

if (import.meta.main) await main();
