// Perimeter of ADR-0068 D2: which changed paths keep a pull request out of an
// agent merge. A path is refused when it matches GATED_PATH_PATTERNS or one line
// of the `excluded-paths` block of the ADR; every other path is admitted.
//
// Run it from a checkout of the served branch, never from the head under review:
// the head could have weakened the ADR block, GATED_PATH_PATTERNS or this file.
//
// Usage: git diff --name-only origin/<servie>...<sha> | bun tools/skills/bounded-merge-scope.ts
// Exit: 0 every path admitted; 1 at least one path refused; 2 no path read, or the
// ADR or its block unreadable, which an agent reads as "no merge" (ADR-0068 D1).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GATED_PATH_PATTERNS } from "../quality/check-review-evidence";

const ADR_PATH = join(import.meta.dir, "..", "..", "docs", "adr", "0068-bounded-agent-merge.md");

/** The regular expressions of the fenced `excluded-paths` block; empty when it is absent. */
export function excludedPatterns(adr: string): RegExp[] {
  const block = /```text excluded-paths\n([\s\S]*?)```/.exec(adr)?.[1] ?? "";
  return block
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => new RegExp(line));
}

/** The paths an agent merge may not carry, in input order. */
export function refusedPaths(
  paths: readonly string[],
  gated: readonly RegExp[],
  excluded: readonly RegExp[],
): string[] {
  const guards = [...gated, ...excluded];
  return paths.filter((path) => guards.some((guard) => guard.test(path)));
}

async function main(): Promise<void> {
  const paths = (await Bun.stdin.text()).split("\n").filter((line) => line.length > 0);
  let excluded: RegExp[];
  try {
    excluded = excludedPatterns(readFileSync(ADR_PATH, "utf8"));
  } catch (error) {
    console.error(`ADR-0068 unreadable: ${String(error)}`);
    process.exit(2);
  }
  if (paths.length === 0 || excluded.length === 0) {
    console.error(`Nothing examined: paths=${paths.length} excluded-patterns=${excluded.length}`);
    process.exit(2);
  }
  const refused = refusedPaths(paths, GATED_PATH_PATTERNS, excluded);
  for (const path of refused) console.log(`refused ${path}`);
  console.log(
    `examined=${paths.length} admitted=${paths.length - refused.length} refused=${refused.length}` +
      ` gated-patterns=${GATED_PATH_PATTERNS.length} excluded-patterns=${excluded.length}`,
  );
  process.exit(refused.length === 0 ? 0 : 1);
}

if (import.meta.main) await main();
