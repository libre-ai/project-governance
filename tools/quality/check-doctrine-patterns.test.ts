import { describe, expect, test } from "bun:test";

import { $ } from "bun";

/**
 * Every `superseded` deny-list motif of the doctrine-governance workflow
 * must match at least one NORMATIVE tracked Markdown file — outside
 * `docs/reviews/` (review artefacts are explicitly non-normative) and
 * outside the two superseding acts, which are allowed to cite the motifs
 * and would otherwise keep a paraphrase alive. A motif with no normative
 * match is inert: it was derived from a paraphrase instead of the origin
 * text it is supposed to forbid, and the gate it feeds is green on nothing.
 *
 * Origin: K4 review of ADR-0020 (2026-07-28) found two such inert motifs;
 * the K4 pass on this guard then found three more, kept "alive" only by a
 * non-normative review artefact. The `preventive` family (purged texts,
 * banned brands/domains) carries no such requirement: zero matches is its
 * healthy state.
 *
 * The oracle is the gate's own engine: motifs are evaluated with `grep -E`,
 * not `new RegExp` — POSIX classes like [[:digit:]] and JS-only escapes
 * like \d diverge between the two, and what validates a motif must be what
 * executes it. The corpus is `git ls-files` (tracked files): a subset of
 * the working tree the gate scans, deliberately — proving a match on a
 * tracked file is the stronger condition, and untracked files are staged
 * before gates anyway (AGENTS.md).
 */

const WORKFLOW_PATH = ".github/workflows/doctrine-governance.yml";

/** The two superseding acts, allowed citers that must not carry a motif alone. */
const SUPERSEDING_ACTS = [
  "docs/adr/0020-general-activation-and-hub-dismantling.md",
  "docs/superpowers/specs/2026-07-28-multi-repo-activation-design.md",
];

/** Split a grep -E pattern on top-level `|` only (never inside a group or a class). */
export function splitTopLevelAlternatives(pattern: string): string[] {
  const alternatives: string[] = [];
  let depth = 0;
  let inClass = false;
  let current = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      current += char + (pattern[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      current += char;
      continue;
    }
    if (char === "[") inClass = true;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "|" && depth === 0) {
      alternatives.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  alternatives.push(current);
  return alternatives;
}

/**
 * True when the ERE pattern matches at least one of the files — evaluated by
 * the same grep that runs the gate. Exit 0 = match, 1 = none, 2 = bad pattern.
 */
export function matchesAnyFile(
  pattern: string,
  files: readonly string[],
  ignoreCase = false,
): boolean {
  const args = ["grep", "-lE", ...(ignoreCase ? ["-i"] : []), pattern, ...files];
  const result = Bun.spawnSync(args);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`grep -E rejected the pattern «${pattern}»: ${result.stderr.toString()}`);
  }
  return result.exitCode === 0;
}

async function loadWorkflow(): Promise<string> {
  return await Bun.file(WORKFLOW_PATH).text();
}

/** Extract a single-occurrence capture; ambiguity is an error, not a pick. */
function extractPattern(workflow: string, marker: RegExp): string {
  const matches = [...workflow.matchAll(new RegExp(marker, "g"))];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new Error(
      `doctrine-governance workflow: expected exactly one deny-list marker (${marker}), found ${matches.length}`,
    );
  }
  return matches[0][1];
}

async function trackedMarkdownFiles(): Promise<string[]> {
  return (await $`git ls-files -- "*.md"`.text()).trim().split("\n").filter(Boolean);
}

describe("splitTopLevelAlternatives", () => {
  test("splits on top-level pipes only, keeping groups, classes and escapes intact", () => {
    expect(splitTopLevelAlternatives("a|b(c|d)e|f\\|g")).toEqual(["a", "b(c|d)e", "f\\|g"]);
    expect(splitTopLevelAlternatives("[a|b]c|d")).toEqual(["[a|b]c", "d"]);
  });
});

describe("matchesAnyFile", () => {
  test("counter-proof: an invented motif matches nothing, which the guard must flag", async () => {
    const files = await trackedMarkdownFiles();
    expect(matchesAnyFile("xyzzy-motif-inerte", files)).toBe(false);
  });

  test("rejects an invalid ERE instead of silently passing it", async () => {
    const files = await trackedMarkdownFiles();
    expect(() => matchesAnyFile("broken(paren", files)).toThrow(/rejected/);
  });
});

describe("doctrine-governance deny-list effectiveness", () => {
  test("every superseded motif matches at least one normative tracked Markdown file", async () => {
    const workflow = await loadWorkflow();
    const pattern = extractPattern(workflow, /\bsuperseded="([^"]+)"/);
    const normative = (await trackedMarkdownFiles()).filter(
      (path) => !path.startsWith("docs/reviews/") && !SUPERSEDING_ACTS.includes(path),
    );
    const inert = splitTopLevelAlternatives(pattern).filter(
      (alternative) => !matchesAnyFile(alternative, normative),
    );
    expect(
      inert,
      `Inert deny-list motifs (no match in any normative tracked .md — docs/reviews/ and the superseding acts excluded): ${inert.join(" ⏐ ")} — re-derive each from the origin text it is supposed to forbid, or reclassify it as preventive if that text was purged.`,
    ).toEqual([]);
  });

  test("every preventive motif is a valid ERE for the gate's grep", async () => {
    const workflow = await loadWorkflow();
    const pattern = extractPattern(workflow, /\bpreventive="([^"]+)"/);
    const files = await trackedMarkdownFiles();
    for (const alternative of splitTopLevelAlternatives(pattern)) {
      expect(alternative.trim().length).toBeGreaterThan(0);
      // Evaluate for validity only — zero matches is the healthy state here.
      matchesAnyFile(alternative, files);
    }
  });

  test("every retired-brand motif matches at least one normative tracked Markdown file", async () => {
    const workflow = await loadWorkflow();
    const pattern = extractPattern(workflow, /matches=\$\(grep -rniE '([^']+)'/);
    const normative = (await trackedMarkdownFiles()).filter(
      (path) => !path.startsWith("docs/reviews/") && !SUPERSEDING_ACTS.includes(path),
    );
    const inert = splitTopLevelAlternatives(pattern).filter(
      (alternative) => !matchesAnyFile(alternative, normative, true),
    );
    expect(
      inert,
      `Inert retired-brand motifs (no match in any normative tracked .md): ${inert.join(" ⏐ ")} — the historical registers the LEXICON lists must carry each name at least once.`,
    ).toEqual([]);
  });
});
