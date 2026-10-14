/**
 * Mutation proof for tools/attestation (gate-integrity sections 2 and 5).
 *
 * A test added with a check is not evidence until it is shown to fail when the check is
 * neutralised, and a count of neutralised checks says nothing without the number of checks
 * there are. This script therefore does two things.
 *
 * 1. It counts REFUSAL SITES in git-attestation.ts with its own pattern, independently of the
 *    markers: a line that emits a finding (`add("`) or throws (`throw new GitFailure(`,
 *    `throw new Error(`). Each site must have a `// neutralise:<id>` marker within eight
 *    lines above it (one marker covers one site), or a `// neutralise:none <reason>` exemption. It prints sites, marked,
 *    exempt and uncovered, and fails when a site is uncovered or an id is used twice.
 * 2. For every marker it copies the tool and its tests into a throwaway directory, forces that
 *    one condition to false (a no-op substitution, never a deleted line, which would unbalance
 *    the structure and turn everything red for the wrong reason), runs the tests named
 *    `red:<id> `, and requires one to fail BY ASSERTION. A test that only crashes proves the
 *    mutant breaks the program, not that the test checks anything: it is reported as
 *    "crash only" and counted as not caught.
 *
 * The shell, Python and jq files carry no marker: each of their checks is mutated by exact text
 * substitution (`fileMutations`), and a substitution must match exactly once.
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
const sourceName = "git-attestation.ts";

const siteLine = /(?<![.\w])add\(\s*[`"]|\bthrow new (?:GitFailure|Error)\(/;
const markerLine = /\/\/ neutralise:([a-z0-9-]+)(?=\s|$)/;
/** A multi-line condition can put its refusal several lines under the marker. */
const lookback = 8;
const exemptionLine = /\/\/ neutralise:none\s+\S/;

export interface SiteCensus {
  readonly sites: number;
  readonly marked: number;
  readonly exempt: number;
  readonly uncovered: readonly number[];
  readonly ids: readonly string[];
  readonly duplicates: readonly string[];
}

/** Count refusal sites and how each is covered. Pure: takes the source text. */
export function census(source: string): SiteCensus {
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
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    if (!siteLine.test(line)) continue;
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

const frozenCheck = "provider-policy.frozen-check.jq";

function frozen(id: string, find: string, replace: string): FileMutation {
  return { id, file: frozenCheck, edits: [{ find, replace }] };
}

/** Checks outside git-attestation.ts's markers. Every `find` must occur exactly once. */
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
    id: "manifest-ascii",
    file: "manifest.sh",
    edits: [{ find: String.raw`tr -d '\000-\177'`, replace: String.raw`tr -d '\000-\377'` }],
  },
  {
    // The original defect: a plain `.*` silently drops a name holding a newline.
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
      { find: `[ "$(printf '%s' "$trees" | jq 'length')" = "$expected" ] \\`, replace: "true \\" },
    ],
  },
  {
    id: "python-verify",
    file: "canonicalize.py",
    edits: [{ find: "if rebuilt != raw:", replace: "if False:" }],
  },
  {
    id: "python-derive",
    file: "canonicalize.py",
    edits: [{ find: 'if rebuilt != open(argv[3], "rb").read():', replace: "if False:" }],
  },
  {
    id: "window-tail",
    file: sourceName,
    edits: [{ find: "start += windowSize - windowOverlap", replace: "start += windowSize * 1000" }],
  },
  {
    id: "window-overlap",
    file: sourceName,
    edits: [
      { find: "export const windowOverlap = 512;", replace: "export const windowOverlap = 0;" },
    ],
  },
  frozen(
    "frozen-ruleset-exclude",
    '((.conditions.ref_name.exclude | type) == "array" and (.conditions.ref_name.exclude | length) == 0)',
    "true",
  ),
  frozen(
    "frozen-ruleset-bypass",
    '((.bypass_actors | type) == "array" and (.bypass_actors | length) == 0)',
    "true",
  ),
  frozen("frozen-ruleset-can-bypass", '(.current_user_can_bypass == "never")', "true"),
  frozen("frozen-wiki", "(.settings.has_wiki != false)", "false"),
  frozen("frozen-pages", "(.settings.has_pages != false)", "false"),
  frozen("frozen-discussions", "(.settings.has_discussions != false)", "false"),
  frozen("frozen-vulnerability-alerts", "(.security.vulnerability_alerts != false)", "false"),
  frozen("frozen-security-fixes", "(.security.automated_security_fixes != false)", "false"),
  frozen(
    "frozen-collaborator",
    "(((.access.collaborators // []) | map(.login)) != [$expected_collaborator])",
    "false",
  ),
  frozen("frozen-unreadable", "select(.[1] == null)", "select(false)"),
];

function runTests(directory: string, filter?: string): { code: number; output: string } {
  const args = ["bun", "test", join(directory, "tools", "attestation")];
  if (filter !== undefined) args.push("-t", filter);
  const result = Bun.spawnSync(args, { cwd: directory, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

function report(name: string, verdict: Verdict, code: number): boolean {
  console.log(
    `${name}: neutralised -> exit ${code}, ${verdict.assertions} assertion failure(s), ${verdict.crashes} crash(es): ${verdict.label}`,
  );
  return verdict.label === "RED";
}

function main(requested: readonly string[]): number {
  const source = readFileSync(join(here, sourceName), "utf8");
  const found = census(source);
  console.log(
    `refusal sites: ${found.sites}; marked with an id: ${found.marked} (${new Set(found.ids).size} distinct ids); exempt with a stated reason: ${found.exempt}; uncovered: ${found.uncovered.length}`,
  );
  let failures = 0;
  if (found.uncovered.length > 0) {
    console.log(`uncovered refusal sites at lines ${found.uncovered.join(", ")}`);
    failures += found.uncovered.length;
  }
  if (found.duplicates.length > 0) {
    console.log(`duplicate marker ids: ${found.duplicates.join(", ")}`);
    failures += found.duplicates.length;
  }
  const ids = requested.length > 0 ? [...requested] : [...new Set(found.ids)];
  const work = mkdtempSync(join(tmpdir(), "neutralise-"));
  let neutralised = 0;
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
    for (const id of ids) {
      const mutant = neutralise(source, id);
      if (mutant === null) {
        console.log(`${id}: no condition found after the marker`);
        failures += 1;
        continue;
      }
      writeFileSync(join(target, sourceName), mutant);
      const result = runTests(work, `red:${id} `);
      neutralised += 1;
      if (!report(id, judge(result.output, id, result.code), result.code)) failures += 1;
    }
    writeFileSync(join(target, sourceName), source);
    if (requested.length === 0) {
      for (const mutation of fileMutations) {
        const original = readFileSync(join(here, mutation.file), "utf8");
        let mutated = original;
        let matched = true;
        for (const edit of mutation.edits) {
          if (mutated.split(edit.find).length !== 2) matched = false;
          else mutated = mutated.replace(edit.find, () => edit.replace);
        }
        if (!matched) {
          console.log(`${mutation.file} ${mutation.id}: substitution does not match exactly once`);
          failures += 1;
          continue;
        }
        writeFileSync(join(target, mutation.file), mutated);
        const result = runTests(work, `red:${mutation.id} `);
        neutralised += 1;
        const verdict = judge(result.output, mutation.id, result.code);
        if (!report(`${mutation.file} ${mutation.id}`, verdict, result.code)) failures += 1;
        writeFileSync(join(target, mutation.file), original);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(
    `${neutralised} check(s) neutralised (${found.marked} marked sites, ${fileMutations.length} file substitutions, ${found.exempt} exempt), ${failures} problem(s)`,
  );
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
