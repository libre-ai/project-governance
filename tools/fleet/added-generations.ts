/**
 * The generations a change adds to ecosystem/fleet-pins.v1.yaml.
 *
 *   bun tools/fleet/added-generations.ts <previous commit>
 *   bun tools/fleet/added-generations.ts --latest      # the most recent declared generation
 *
 * Prints one full sha per line: the `generations[].sha` of the working tree
 * that the register at <previous commit> does not list. The coherence workflow
 * replays the composition of each before the declaration merges.
 *
 * Both registers are read as YAML, and each parse is held against a count of
 * the `- sha:` lines of the same text: a line-matching extraction that finds
 * nothing is indistinguishable from "nothing was declared", which is how a
 * declaration would escape its replay. A count that differs, an unreadable
 * register or a sha that is not 40 hex characters is a failure, never an empty
 * list.
 */

import { readFileSync } from "node:fs";

const REGISTER = "ecosystem/fleet-pins.v1.yaml";
const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA_LINE = /^\s*-\s+sha:\s*\S+\s*$/gm;

/** The shas of `generations`, parsed, and checked against the textual count. */
export function generationShas(text: string): string[] {
  const document = Bun.YAML.parse(text) as {
    generations?: ReadonlyArray<{ sha?: unknown }>;
  } | null;
  const generations = document?.generations;
  if (!Array.isArray(generations)) throw new Error("the register has no generations list");
  const shas = generations.map((generation) => generation?.sha);
  for (const sha of shas) {
    if (typeof sha !== "string" || !FULL_SHA.test(sha)) {
      throw new Error(`a generation is a full commit sha, got: ${String(sha)}`);
    }
  }
  const lines = (text.match(SHA_LINE) ?? []).length;
  if (lines !== shas.length) {
    throw new Error(
      `the register parses to ${shas.length} generation(s) but has ${lines} sha line(s)`,
    );
  }
  return shas as string[];
}

export function addedGenerations(base: string, head: string): string[] {
  const known = new Set(generationShas(base));
  return generationShas(head).filter((sha) => !known.has(sha));
}

if (import.meta.main) {
  const previous = process.argv[2] ?? "";
  if (previous === "--latest") {
    try {
      const shas = generationShas(readFileSync(REGISTER, "utf8"));
      const latest = shas[shas.length - 1];
      if (latest === undefined) throw new Error("the register declares no generation");
      console.log(latest);
      process.exit(0);
    } catch (error) {
      console.error(`added-generations: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(previous)) {
    console.error("usage: added-generations.ts <40-character previous commit>");
    process.exit(2);
  }
  const shown = Bun.spawnSync(["git", "show", `${previous}:${REGISTER}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (shown.exitCode !== 0) {
    console.error(
      `cannot read ${REGISTER} at ${previous}: ${new TextDecoder().decode(shown.stderr).trim()}`,
    );
    process.exit(1);
  }
  try {
    const head = readFileSync(REGISTER, "utf8");
    const added = addedGenerations(new TextDecoder().decode(shown.stdout), head);
    for (const sha of added) console.log(sha);
    console.error(
      `${generationShas(head).length} generation(s) declared, ${added.length} added since ${previous.slice(0, 8)}`,
    );
  } catch (error) {
    console.error(`added-generations: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
