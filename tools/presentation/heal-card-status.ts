/**
 * Writes the generated project-status section of a repository README from its
 * own `project.v1.yaml`.
 *
 * `renderStatusSection` has produced that section since the card schema existed,
 * deterministically and from the card alone — and until now nothing called it
 * except the gate that compares its output to a committed README and the tests.
 * A repository whose README carried no section had a red gate, a correct
 * expected value, and no way to obtain it but transcription. This is the missing
 * half: the gate says what is wrong, this writes what is right.
 *
 * Two operations, and the boundary between them is the point:
 *
 *   - REPLACING an existing section is a pure function of the card. The section's
 *     eleven lines are derived; no choice is made here, and `--check` proves the
 *     write would be a no-op.
 *   - CHOOSING WHERE a first section goes is not. The three repositories that
 *     already carry one put it under a heading they named themselves — `##
 *     État vérifié` in signalement, `## État du projet` in carriere. Inventing
 *     that heading would be this tool deciding how a repository presents itself.
 *     So without a sentinel pair it refuses and names what it needs; with
 *     `--under "<heading>"` it inserts after that exact heading and nowhere else.
 *
 * Local by construction: no network, no credential, no pull request. It edits a
 * checkout. The cross-repository write path is a separate decision, and
 * `tools/presentation/heal-org-readme.ts` shows what that costs — a dedicated
 * secret, a branch it owns, one pull request it finds by head branch.
 *
 * Usage:
 *   bun tools/presentation/heal-card-status.ts <repo-root> [--check] [--under "## Heading"]
 */

import {
  renderStatusSection,
  STATUS_SECTION_BEGIN,
  STATUS_SECTION_END,
} from "../../ecosystem/project-cards";
import { spliceStatusSection } from "./heal-org-readme";

export const CARD_PATH = "project.v1.yaml";
export const README_PATH = "README.md";

export type HealOutcome =
  | { readonly kind: "unchanged"; readonly readme: string }
  | { readonly kind: "replaced"; readonly readme: string }
  | { readonly kind: "inserted"; readonly readme: string; readonly under: string }
  | { readonly kind: "refused"; readonly reason: string };

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Inserts the section immediately after `under`, which must appear exactly once
 * as a whole line. Exactly once, because a heading that repeats gives this tool
 * a choice to make, and it has none to make.
 */
export function insertUnderHeading(readme: string, section: string, under: string): string | null {
  const heading = under.trim();
  const lines = readme.split("\n");
  const matches = lines.reduce<number[]>((found, line, index) => {
    if (line.trim() === heading) found.push(index);
    return found;
  }, []);
  if (matches.length !== 1) return null;
  const at = matches[0] as number;
  const before = lines.slice(0, at + 1);
  const after = lines.slice(at + 1);
  // One blank line each side, so the section reads as its own block whatever
  // the surrounding prose does.
  while (after.length > 0 && after[0]?.trim() === "") after.shift();
  return [...before, "", section, "", ...after].join("\n");
}

/** The whole decision, as a pure function, so every branch is tested without a filesystem. */
export function healCardStatus(readme: string, card: unknown, under?: string): HealOutcome {
  let section: string;
  try {
    section = renderStatusSection(card);
  } catch (error) {
    return { kind: "refused", reason: `the card does not render: ${(error as Error).message}` };
  }

  const begins = countOccurrences(readme, STATUS_SECTION_BEGIN);
  const ends = countOccurrences(readme, STATUS_SECTION_END);

  if (begins > 1 || ends > 1) {
    return {
      kind: "refused",
      reason: `${README_PATH} carries ${begins} begin and ${ends} end sentinels — one pair is admitted, and choosing which to keep is not this tool's call`,
    };
  }

  if (begins === 1 && ends === 1) {
    const spliced = spliceStatusSection(readme, section);
    if (spliced === null) {
      return { kind: "refused", reason: `${README_PATH} sentinels are present but not in order` };
    }
    return spliced === readme
      ? { kind: "unchanged", readme }
      : { kind: "replaced", readme: spliced };
  }

  if (under === undefined) {
    return {
      kind: "refused",
      reason: `${README_PATH} carries no sentinel pair, and where a first section goes is a presentation choice this tool will not make — re-run with --under "## <heading>" naming the heading it belongs under`,
    };
  }

  const inserted = insertUnderHeading(readme, section, under);
  if (inserted === null) {
    return {
      kind: "refused",
      reason: `${README_PATH} does not carry the heading ${JSON.stringify(under.trim())} exactly once`,
    };
  }
  return { kind: "inserted", readme: inserted, under: under.trim() };
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const root = args.find((arg) => !arg.startsWith("--"));
  const checkOnly = args.includes("--check");
  const underIndex = args.indexOf("--under");
  const under = underIndex === -1 ? undefined : args[underIndex + 1];

  if (root === undefined) {
    console.error(
      `usage: bun tools/presentation/heal-card-status.ts <repo-root> [--check] [--under "## Heading"]`,
    );
    process.exit(2);
  }
  if (underIndex !== -1 && (under === undefined || under.startsWith("--"))) {
    console.error("--under requires the heading it should insert under");
    process.exit(2);
  }

  const cardFile = Bun.file(`${root}/${CARD_PATH}`);
  const readmeFile = Bun.file(`${root}/${README_PATH}`);
  if (!(await cardFile.exists())) {
    console.error(`${root}/${CARD_PATH} does not exist — nothing to render a section from`);
    process.exit(1);
  }
  if (!(await readmeFile.exists())) {
    console.error(`${root}/${README_PATH} does not exist`);
    process.exit(1);
  }

  const card = Bun.YAML.parse(await cardFile.text());
  const readme = await readmeFile.text();
  const outcome = healCardStatus(readme, card, under);

  if (outcome.kind === "refused") {
    console.error(`Card status heal refused: ${outcome.reason}`);
    process.exit(1);
  }
  if (outcome.kind === "unchanged") {
    console.log(`${root}/${README_PATH}: status section already matches the card`);
    process.exit(0);
  }
  if (checkOnly) {
    console.error(
      `${root}/${README_PATH}: the status section would be ${outcome.kind} — run without --check to write it`,
    );
    process.exit(1);
  }
  await Bun.write(readmeFile, outcome.readme);
  const where = outcome.kind === "inserted" ? ` under ${JSON.stringify(outcome.under)}` : "";
  console.log(`${root}/${README_PATH}: status section ${outcome.kind}${where}`);
}
