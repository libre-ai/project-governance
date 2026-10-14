/**
 * Mutation proof for git-attestation.ts (gate-integrity section 5).
 *
 * A test added with a check is not evidence until it is shown to fail when the check is
 * neutralised. Every check in git-attestation.ts carries a `// neutralise:<id>` marker on the
 * line above its `if`. For each marker this script copies the tool and its tests into a
 * throwaway directory, forces that single condition to false (a no-op substitution, never a
 * deleted line, which would unbalance the structure and turn everything red for the wrong
 * reason), runs the tests whose name starts with `red:<id> `, and requires at least one of
 * them to fail. The copy is the only thing mutated: the files under review are never touched.
 *
 * Usage: bun tools/attestation/neutralise-check.ts [id ...]     (default: every marker)
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const here = import.meta.dir;
const repositoryRoot = resolve(here, "..", "..");
const sourceName = "git-attestation.ts";
const testName = "git-attestation.test.ts";

export function markers(source: string): string[] {
  return [...source.matchAll(/\/\/ neutralise:([a-z0-9-]+)/g)].map((match) => match[1] as string);
}

/**
 * Neutralise the check on the line below the marker: force its `if` condition to false, or, when
 * that line is a bare `add(...)` call, route the call to a function that discards it. Only the
 * very next line is considered: a search that ran on would silently mutate an unrelated check.
 */
export function neutralise(source: string, id: string): string | null {
  const marker = source.indexOf(`// neutralise:${id}\n`);
  if (marker < 0) return null;
  const lineStart = source.indexOf("\n", marker) + 1;
  const lineEnd = source.indexOf("\n", lineStart);
  const line = source.slice(lineStart, lineEnd);
  if (/^\s*add\(/.test(line)) {
    const call = lineStart + line.indexOf("add(");
    return `${source.slice(0, call)}discard(${source.slice(call + "add(".length)}\nfunction discard(..._ignored: unknown[]): void {}\n`;
  }
  const ifOffset = line.search(/(?:^|\s)if \(/);
  if (ifOffset < 0) return null;
  const start = lineStart + ifOffset + line.slice(ifOffset).indexOf("if (");
  const open = start + "if (".length - 1;
  let depth = 0;
  let close = -1;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) return null;
  const condition = source.slice(open + 1, close);
  return `${source.slice(0, open + 1)}false && (${condition})${source.slice(close)}`;
}

interface FileMutation {
  readonly id: string;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
}

/**
 * The shell and Python implementations carry no marker: each check is mutated by exact text
 * substitution, and the substitution must match exactly once or the proof is void.
 */
const fileMutations: readonly FileMutation[] = [
  {
    id: "manifest-shallow",
    file: "manifest.sh",
    find: '[ "$(git -C "$dir" rev-parse --is-shallow-repository)" = "false" ] ||',
    replace: "true ||",
  },
  {
    id: "manifest-ascii",
    file: "manifest.sh",
    find: String.raw`tr -d '\000-\177'`,
    replace: String.raw`tr -d '\000-\377'`,
  },
  {
    id: "python-verify",
    file: "canonicalize.py",
    find: "assert rebuilt == raw,",
    replace: "assert True or rebuilt == raw,",
  },
];

function runTests(directory: string, filter?: string): { code: number; output: string } {
  const args = ["bun", "test", join(directory, "tools", "attestation", testName)];
  if (filter !== undefined) args.push("-t", filter);
  const result = Bun.spawnSync(args, { cwd: directory, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

function main(requested: readonly string[]): number {
  const source = readFileSync(join(here, sourceName), "utf8");
  const ids = requested.length > 0 ? [...requested] : [...new Set(markers(source))];
  const work = mkdtempSync(join(tmpdir(), "neutralise-"));
  let failures = 0;
  try {
    const target = join(work, "tools", "attestation");
    cpSync(here, target, {
      recursive: true,
      filter: (path) => !path.endsWith("neutralise-check.ts"),
    });
    symlinkSync(join(repositoryRoot, "tools", "quality"), join(work, "tools", "quality"));
    symlinkSync(join(repositoryRoot, "node_modules"), join(work, "node_modules"));
    const baseline = runTests(work);
    console.log(`baseline: exit ${baseline.code}`);
    if (baseline.code !== 0) return 1;
    for (const id of ids) {
      const mutant = neutralise(source, id);
      if (mutant === null) {
        console.log(`${id}: no condition found after the marker`);
        failures += 1;
        continue;
      }
      writeFileSync(join(target, sourceName), mutant);
      const result = runTests(work, `red:${id} `);
      const failed = result.output
        .split("\n")
        .filter((line) => line.startsWith("(fail) ") && line.includes(`red:${id} `));
      const verdict = result.code !== 0 && failed.length > 0 ? "RED" : "STILL GREEN";
      if (verdict !== "RED") failures += 1;
      console.log(
        `${id}: neutralised -> exit ${result.code}, ${failed.length} red test(s): ${verdict}`,
      );
    }
    writeFileSync(join(target, sourceName), source);
    if (requested.length === 0) {
      for (const mutation of fileMutations) {
        const original = readFileSync(join(here, mutation.file), "utf8");
        if (original.split(mutation.find).length !== 2) {
          console.log(`${mutation.file} ${mutation.id}: substitution does not match exactly once`);
          failures += 1;
          continue;
        }
        writeFileSync(
          join(target, mutation.file),
          original.replace(mutation.find, () => mutation.replace),
        );
        const result = runTests(work, `red:${mutation.id} `);
        const failed = result.output
          .split("\n")
          .filter((line) => line.startsWith("(fail) ") && line.includes(`red:${mutation.id} `));
        const verdict = result.code !== 0 && failed.length > 0 ? "RED" : "STILL GREEN";
        if (verdict !== "RED") failures += 1;
        console.log(
          `${mutation.file} ${mutation.id}: substituted -> exit ${result.code}, ${failed.length} red test(s): ${verdict}`,
        );
        writeFileSync(join(target, mutation.file), original);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(
    `${ids.length + (requested.length === 0 ? fileMutations.length : 0)} check(s) neutralised, ${failures} not caught`,
  );
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
