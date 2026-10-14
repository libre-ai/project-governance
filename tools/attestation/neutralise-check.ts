/**
 * Mutation proof for tools/attestation (gate-integrity sections 2 and 5).
 *
 * A test added with a check is not evidence until it is shown to fail when the check is
 * neutralised, and a count of neutralised checks says nothing without the number of checks
 * there are. For each of the four instruments (the TypeScript scanner, the shell manifest, the
 * Python derivation and the jq frozen verdict) this script does two things.
 *
 * 1. It counts REFUSAL SITES with a pattern of its own, independently of the markers:
 *      TypeScript  a line that emits a finding (`add("`) or throws (`throw new GitFailure(`,
 *                  `throw new Refusal(`);
 *      shell       a `return 1`, or a readback decision (`printf 'null'`, `printf 'false'`, `="null"`);
 *      Python      a `refuse(` call or a `raise ValueError(`;
 *      jq          an `else empty end` (one blocker or residual risk) or an `and (` clause of
 *                  the ruleset predicate.
 *    Each site must have a `neutralise:<id>` marker within the eight lines above it (one marker
 *    covers one site) or a `neutralise:none <reason>` exemption. It prints sites, marked, exempt
 *    and uncovered per file, and fails when a site is uncovered or an id is used twice in a file.
 * 2. For every marker it copies the tool and its tests into a throwaway directory, forces that one
 *    check to its permissive value (a no-op substitution, never a deleted line, which would
 *    unbalance the structure and turn everything red for the wrong reason), runs the tests named
 *    `red:<id> `, and requires one to fail BY ASSERTION. A test that only crashes proves the
 *    mutant breaks the program, not that the test checks anything: it is reported as "crash
 *    only" and counted as a problem. The shell checks are mutated by exact text substitution
 *    (`fileMutations`), and the marker ids of that file must equal the substitution ids.
 *
 * The same `red:` test may serve a TypeScript marker and a shell marker of the same id (the
 * shallow and ASCII refusals are asserted on both implementations); that overlap is listed.
 *
 * The copy is the only thing mutated; the files under review are never touched.
 *
 * Usage: bun tools/attestation/neutralise-check.ts [id ...]     (default: everything)
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const here = import.meta.dir;
const repositoryRoot = resolve(here, "..", "..");

export type Language = "ts" | "sh" | "py" | "jq";

interface Instrument {
  readonly file: string;
  readonly language: Language;
}

const instruments: readonly Instrument[] = [
  { file: "git-attestation.ts", language: "ts" },
  { file: "manifest.sh", language: "sh" },
  { file: "provider-policy.sh", language: "sh" },
  { file: "canonicalize.py", language: "py" },
  { file: "provider-policy.frozen-check.jq", language: "jq" },
];

const sitePatterns: Record<Language, RegExp> = {
  ts: /(?<![.\w])add\(\s*[`"]|\bthrow new (?:GitFailure|Refusal)\(/,
  sh: /\breturn 1\b|printf '(?:null|false)'|="null"/,
  py: /^\s*(?:raise ValueError\(|refuse\()/,
  jq: /\belse empty end\b|^\s*and \(/,
};
const commentStarts: Record<Language, readonly string[]> = {
  ts: ["//", "*", "/*"],
  sh: ["#"],
  py: ["#"],
  jq: ["#"],
};
const markerLine = /(?:\/\/|#) neutralise:([a-z0-9-]+)(?=\s|$)/;
const exemptionLine = /(?:\/\/|#) neutralise:none\s+\S/;
/** A multi-line condition can put its refusal several lines under the marker. */
const lookback = 8;

export interface SiteCensus {
  readonly sites: number;
  readonly marked: number;
  readonly exempt: number;
  readonly uncovered: readonly number[];
  readonly ids: readonly string[];
  readonly duplicates: readonly string[];
}

/** Count refusal sites and how each is covered. Pure: takes the source text. */
export function census(source: string, language: Language = "ts"): SiteCensus {
  const lines = source.split("\n");
  const ids: string[] = [];
  for (const line of lines) {
    const match = markerLine.exec(line);
    if (match !== null && match[1] !== "none") ids.push(match[1] as string);
  }
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  let open: { line: number; text: string } | undefined;
  let sites = 0;
  let marked = 0;
  let exempt = 0;
  const uncovered: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (markerLine.test(line)) open = { line: index, text: line };
    const trimmed = line.trim();
    if (commentStarts[language].some((start) => trimmed.startsWith(start))) continue;
    if (!sitePatterns[language].test(line)) continue;
    sites += 1;
    const covering = open !== undefined && index - open.line <= lookback ? open.text : undefined;
    // A marker covers ONE site: a second site under the same marker is uncovered.
    open = undefined;
    if (covering === undefined) uncovered.push(index + 1);
    else if (exemptionLine.test(covering)) exempt += 1;
    else marked += 1;
  }
  return { sites, marked, exempt, uncovered, ids, duplicates };
}

export function markers(source: string): string[] {
  return census(source).ids.slice();
}

function findLine(
  source: string,
  id: string,
  comment: string,
): { start: number; end: number } | null {
  const marker = source.indexOf(`${comment} neutralise:${id}\n`);
  if (marker < 0) return null;
  const start = source.indexOf("\n", marker) + 1;
  return { start, end: source.indexOf("\n", start) };
}

/** Index of the parenthesis closing the one opened at `open`, or -1. */
function closingParenthesis(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Neutralise the TypeScript check on the line below the marker: force its `if` condition to
 * false, or, when that line is a bare `add(...)` call (or `if (cond) {` followed by one), route
 * the call to a function that discards it. Only the very next line is considered: a search that
 * ran on would silently mutate an unrelated check.
 */
export function neutralise(source: string, id: string): string | null {
  const located = findLine(source, id, "//");
  if (located === null) return null;
  const { start: lineStart, end: lineEnd } = located;
  const line = source.slice(lineStart, lineEnd);
  if (/^\s*add\(/.test(line)) {
    const call = lineStart + line.indexOf("add(");
    return `${source.slice(0, call)}discard(${source.slice(call + "add(".length)}\nfunction discard(..._ignored: unknown[]): void {}\n`;
  }
  const ifOffset = line.search(/(?:^|\s)if \(/);
  if (ifOffset < 0) return null;
  // `if (cond) {` then `add(...)`: drop the finding, keep the `return` or `continue` that follows.
  // Forcing the condition false would let the program run on with the value it just refused
  // and crash, which proves the mutant is broken but not that a test checks the refusal.
  if (line.trimEnd().endsWith("{")) {
    const next = source.slice(lineEnd + 1, source.indexOf("\n", lineEnd + 1));
    if (/^\s*add\(/.test(next)) {
      const call = lineEnd + 1 + next.indexOf("add(");
      return `${source.slice(0, call)}discard(${source.slice(call + "add(".length)}\nfunction discard(..._ignored: unknown[]): void {}\n`;
    }
  }
  const open = lineStart + ifOffset + line.slice(ifOffset).indexOf("if (") + "if (".length - 1;
  const close = closingParenthesis(source, open);
  if (close < 0) return null;
  const condition = source.slice(open + 1, close);
  return `${source.slice(0, open + 1)}false && (${condition})${source.slice(close)}`;
}

/** Python: the `if`/`elif` condition below the marker becomes `False`. */
export function neutralisePython(source: string, id: string): string | null {
  const located = findLine(source, id, "#");
  if (located === null) return null;
  const line = source.slice(located.start, located.end);
  const match = /^(\s*(?:if|elif) )(.*)(:\s*)$/.exec(line);
  if (match === null) return null;
  return `${source.slice(0, located.start)}${match[1]}False${match[3]}${source.slice(located.end)}`;
}

/**
 * jq: the condition of the `(if ... then` below the marker becomes `false`, or the `and (...)`
 * clause below it becomes `and (true)`.
 */
export function neutraliseJq(source: string, id: string): string | null {
  const located = findLine(source, id, "#");
  if (located === null) return null;
  const line = source.slice(located.start, located.end);
  const indent = line.length - line.trimStart().length;
  const trimmed = line.trimStart();
  if (trimmed.startsWith("(if ")) {
    const from = located.start + indent + "(if ".length;
    const then = /\sthen\s/.exec(source.slice(from));
    if (then === null) return null;
    return `${source.slice(0, from)}false${source.slice(from + then.index)}`;
  }
  if (trimmed.startsWith("and (")) {
    const open = located.start + indent + "and ".length;
    const close = closingParenthesis(source, open);
    if (close < 0) return null;
    return `${source.slice(0, open)}(true)${source.slice(close + 1)}`;
  }
  return null;
}

export interface Verdict {
  readonly label: "RED" | "RED (crash only)" | "STILL GREEN";
  readonly assertions: number;
  readonly crashes: number;
}

/** Classify the failures of a `bun test` run for one id. Pure: takes the raw output. */
export function judge(output: string, id: string, exitCode: number): Verdict {
  let assertions = 0;
  let crashes = 0;
  let chunk: string[] = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("(fail) ")) {
      if (line.includes(`red:${id} `)) {
        if (chunk.some((text) => /error: expect\(/.test(text))) assertions += 1;
        else crashes += 1;
      }
      chunk = [];
    } else if (line.startsWith("(pass) ")) chunk = [];
    else chunk.push(line);
  }
  if (exitCode === 0 || assertions + crashes === 0)
    return { label: "STILL GREEN", assertions, crashes };
  return { label: assertions > 0 ? "RED" : "RED (crash only)", assertions, crashes };
}

interface Edit {
  readonly find: string;
  readonly replace: string;
}

interface FileMutation {
  readonly id: string;
  readonly file: string;
  readonly edits: readonly Edit[];
}

const scanner = "git-attestation.ts";

/**
 * Checks that are not an `if` below a marker: the shell checks (exact substitutions, the marker
 * ids of manifest.sh must equal the ids here) and TypeScript logic that has no refusal site.
 * Every `find` must occur exactly once.
 */
const fileMutations: readonly FileMutation[] = [
  {
    id: "manifest-shallow",
    file: "manifest.sh",
    edits: [
      {
        find: '[ "$(git -C "$dir" rev-parse --is-shallow-repository)" = "false" ] ||',
        replace: "true ||",
      },
    ],
  },
  {
    id: "manifest-read",
    file: "manifest.sh",
    edits: [
      { find: 'manifest_read "$dir" "$tmp" ||', replace: 'manifest_read "$dir" "$tmp"; true ||' },
    ],
  },
  {
    id: "manifest-ls-tree",
    file: "manifest.sh",
    edits: [
      {
        find: 'git -C "$1" ls-tree -z "$3" > "$2/ls" || return 1',
        replace: 'git -C "$1" ls-tree -z "$3" > "$2/ls" || true',
      },
    ],
  },
  {
    id: "manifest-tree",
    file: "manifest.sh",
    edits: [
      {
        find: 'manifest_tree "$1" "$2" "$t" || return 1',
        replace: 'manifest_tree "$1" "$2" "$t" || true',
      },
    ],
  },
  {
    id: "manifest-ascii",
    file: "manifest.sh",
    edits: [{ find: String.raw`tr -d '\000-\177'`, replace: String.raw`tr -d '\000-\377'` }],
  },
  {
    // The original defect: a plain `.*` silently drops a name holding a newline. With the
    // match alone mutated, the count guard must make the shell fail closed.
    id: "manifest-newline",
    file: "manifest.sh",
    edits: [{ find: String.raw`(?<name>[\\s\\S]*)\\z`, replace: String.raw`(?<name>.*)$` }],
  },
  {
    // The same defect with the safety net removed too: the shell must never succeed with
    // bytes that differ from the other implementations.
    id: "manifest-count",
    file: "manifest.sh",
    edits: [
      { find: String.raw`(?<name>[\\s\\S]*)\\z`, replace: String.raw`(?<name>.*)$` },
      {
        find: `[ "$(printf '%s' "$trees" | jq 'length')" = "$expected" ] \\`,
        replace: "true \\",
      },
    ],
  },
  {
    id: "readback-probe",
    file: "provider-policy.sh",
    edits: [{ find: "printf 'null'\n}", replace: "printf '{}'\n}" }],
  },
  {
    id: "readback-404",
    file: "provider-policy.sh",
    edits: [{ find: `*"HTTP 404"*) printf 'false' ;;`, replace: `*"HTTP 404"*) printf 'null' ;;` }],
  },
  {
    id: "readback-other",
    file: "provider-policy.sh",
    edits: [{ find: "*) printf 'null' ;;", replace: "*) printf 'false' ;;" }],
  },
  {
    id: "readback-rulesets",
    file: "provider-policy.sh",
    edits: [{ find: 'rulesets="null"', replace: 'rulesets="[]"' }],
  },
  {
    id: "readback-protection",
    file: "provider-policy.sh",
    edits: [{ find: 'protection="null"', replace: 'protection="{}"' }],
  },
  {
    id: "window-tail",
    file: scanner,
    edits: [{ find: "start += windowSize - windowOverlap", replace: "start += windowSize * 1000" }],
  },
  {
    id: "window-overlap",
    file: scanner,
    edits: [
      { find: "export const windowOverlap = 512;", replace: "export const windowOverlap = 0;" },
    ],
  },
  {
    id: "cli-flag-echo",
    file: scanner,
    edits: [{ find: 'arg.split("=")[0]', replace: "arg" }],
  },
  {
    id: "git-no-replace",
    file: scanner,
    edits: [{ find: 'GIT_NO_REPLACE_OBJECTS: "1",', replace: "" }],
  },
  {
    id: "headers-orphan",
    file: scanner,
    edits: [
      {
        find: "if (last === undefined) return null;",
        replace: "if (last === undefined) continue;",
      },
    ],
  },
  {
    id: "person-anchor",
    file: scanner,
    edits: [
      {
        find: "/^(.*) <([^<>]*)> \\d+ [+-]\\d{4}$/",
        replace: "/^(.*) <([^<>]*)> \\d+ [+-]\\d{4}/",
      },
    ],
  },
  {
    id: "fsck-strict",
    file: scanner,
    edits: [{ find: '"--strict",', replace: "" }],
  },
];

function runTests(directory: string, filter?: string): { code: number; output: string } {
  const args = ["bun", "test", join(directory, "tools", "attestation")];
  if (filter !== undefined) args.push("-t", filter);
  const result = Bun.spawnSync(args, { cwd: directory, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

function mutantOf(instrument: Instrument, source: string, id: string): string | null {
  if (instrument.language === "ts") return neutralise(source, id);
  if (instrument.language === "py") return neutralisePython(source, id);
  if (instrument.language === "jq") return neutraliseJq(source, id);
  return null;
}

function main(requested: readonly string[]): number {
  let problems = 0;
  const targets: Array<{
    instrument: Instrument;
    source: string;
    found: SiteCensus;
    ids: string[];
  }> = [];
  console.log("Denominators (refusal sites found by the harness's own pattern):");
  for (const instrument of instruments) {
    const source = readFileSync(join(here, instrument.file), "utf8");
    const found = census(source, instrument.language);
    const ids = [...new Set(found.ids)];
    console.log(
      `  ${instrument.file}: ${found.sites} sites = ${found.marked} marked + ${found.exempt} exempt + ${found.uncovered.length} uncovered; ${ids.length} marker ids`,
    );
    if (found.uncovered.length > 0) {
      console.log(`    uncovered at lines ${found.uncovered.join(", ")}`);
      problems += found.uncovered.length;
    }
    if (found.duplicates.length > 0) {
      console.log(`    duplicate marker ids: ${found.duplicates.join(", ")}`);
      problems += found.duplicates.length;
    }
    if (instrument.language === "sh") {
      const mutated = new Set(
        fileMutations.filter((m) => m.file === instrument.file).map((m) => m.id),
      );
      for (const id of ids)
        if (!mutated.has(id)) {
          console.log(`    marker ${id} has no substitution`);
          problems += 1;
        }
    }
    targets.push({ instrument, source, found, ids });
  }
  const work = mkdtempSync(join(tmpdir(), "neutralise-"));
  let markerRuns = 0;
  let substitutionRuns = 0;
  const tally = new Map<string, { mutated: number; red: number }>();
  const count = (file: string, red: boolean): void => {
    const entry = tally.get(file) ?? { mutated: 0, red: 0 };
    entry.mutated += 1;
    if (red) entry.red += 1;
    tally.set(file, entry);
  };
  try {
    const target = join(work, "tools", "attestation");
    cpSync(here, target, {
      recursive: true,
      filter: (path) => !/neutralise-check(\.test)?\.ts$/.test(path),
    });
    symlinkSync(join(repositoryRoot, "tools", "quality"), join(work, "tools", "quality"));
    symlinkSync(join(repositoryRoot, "node_modules"), join(work, "node_modules"));
    const baseline = runTests(work);
    console.log(`baseline: exit ${baseline.code}`);
    if (baseline.code !== 0) return 1;
    const run = (
      label: string,
      file: string,
      original: string,
      mutant: string,
      id: string,
    ): void => {
      writeFileSync(join(target, file), mutant);
      const result = runTests(work, `red:${id} `);
      writeFileSync(join(target, file), original);
      const verdict = judge(result.output, id, result.code);
      const red = verdict.label === "RED";
      count(file, red);
      if (!red) problems += 1;
      console.log(
        `${label}: neutralised -> exit ${result.code}, ${verdict.assertions} assertion failure(s), ${verdict.crashes} crash(es): ${verdict.label}`,
      );
    };
    for (const { instrument, source, ids } of targets) {
      if (instrument.language === "sh") continue;
      for (const id of ids) {
        if (requested.length > 0 && !requested.includes(id)) continue;
        const mutant = mutantOf(instrument, source, id);
        if (mutant === null) {
          console.log(`${instrument.file} ${id}: no check found below the marker`);
          problems += 1;
          continue;
        }
        markerRuns += 1;
        run(`${instrument.file} ${id}`, instrument.file, source, mutant, id);
      }
    }
    for (const mutation of fileMutations) {
      if (requested.length > 0 && !requested.includes(mutation.id)) continue;
      const original = readFileSync(join(here, mutation.file), "utf8");
      let mutated = original;
      let matched = true;
      for (const edit of mutation.edits) {
        if (mutated.split(edit.find).length !== 2) matched = false;
        else mutated = mutated.replace(edit.find, () => edit.replace);
      }
      if (!matched) {
        console.log(`${mutation.file} ${mutation.id}: substitution does not match exactly once`);
        problems += 1;
        continue;
      }
      substitutionRuns += 1;
      run(`${mutation.file} ${mutation.id}`, mutation.file, original, mutated, mutation.id);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log("Neutralised per file (mutated / red by assertion):");
  let total = 0;
  for (const [file, entry] of tally) {
    total += entry.mutated;
    console.log(`  ${file}: ${entry.mutated} / ${entry.red}`);
  }
  console.log(
    `${total} check(s) neutralised = ${markerRuns} marker-driven + ${substitutionRuns} substitutions; ${problems} problem(s)`,
  );
  return problems === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
