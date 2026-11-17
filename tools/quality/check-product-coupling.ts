import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseAllowlist } from "./allowlist";

// Product-coupling guard: shared sources name no consumer product.
//
// Usage: bun tools/quality/check-product-coupling.ts   (no argument)
//
// A shared package that names a product consuming it (its name, its database,
// the host of one of its instances) is no longer shared: the product's
// knowledge leaked into the layer every product links. The guard reads every
// tracked file under the declared shared trees, LINE BY LINE, and reports each
// occurrence of each forbidden pattern as `file:line: pattern: excerpt`.
//
// Everything it judges is data, read from two tracked files:
//
//   - PRODUCT_COUPLING_CONFIG: the shared trees and the named, motivated
//     patterns. No pattern and no tree is written in this code;
//   - PRODUCT_COUPLING_EXEMPTIONS: one file per line with its reason, parsed by
//     `allowlist.ts`. A match in an exempted file is printed and counted as a
//     tolerated warning; an exemption that tolerates nothing is a failure,
//     because a stale exemption waits silently for the next match.
//
// The failures this guard refuses to read as a pass, each one measured on a
// predecessor that did:
//
//   - a declared tree that holds no tracked file (a renamed directory left the
//     old guard green over nothing);
//   - a workspace package of the root manifest outside every declared tree (a
//     hard-coded list of trees omitted three packages out of nine, one of
//     which carried a product name);
//   - an unreadable or non-UTF-8 source (never "zero findings");
//   - a pattern that matches an empty string (one finding per position);
//   - zero file examined.
//
// Source test files are out of scope (`.test.` / `.spec.` before a script extension):
// whether they should be scanned is an open decision, so they are COUNTED as
// excluded on every run instead of disappearing from the volume. Tracked
// symbolic links and submodules are counted apart and never followed. Every
// other tracked file under a tree is scanned, whatever its extension. Paths are
// printed with their control characters replaced, like the excerpts.
//
// Exit codes: 0 pass, 1 anything else (violation, unreadable source, invalid
// data, missing tree).

export const PRODUCT_COUPLING_CONFIG = "tools/quality/product-coupling.v1.json";
export const PRODUCT_COUPLING_EXEMPTIONS = "tools/quality/product-coupling-exemptions.txt";

const GATE = "product-coupling";
const EXCERPT_LIMIT = 200;
// Source test files only. A specification or a data file whose name merely
// carries `.spec.` or `.test.` (`api.spec.md`, `openapi.spec.yaml`) is scanned.
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: replacing control characters is the point.
const CONTROL = /[\u0000-\u001f\u007f]/g;

export interface CouplingPattern {
  readonly name: string;
  /** Compiled with the `g` flag, so every occurrence of a line is found. */
  readonly regex: RegExp;
}

export interface CouplingConfig {
  readonly roots: readonly string[];
  readonly patterns: readonly CouplingPattern[];
}

export type ConfigResult =
  | { readonly ok: true; readonly config: CouplingConfig }
  | { readonly ok: false; readonly error: string };

export interface CouplingFinding {
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  readonly pattern: string;
  /** At most EXCERPT_LIMIT characters around the match, control characters replaced. */
  readonly excerpt: string;
}

export interface CouplingInput {
  readonly config: CouplingConfig;
  /** Workspace package directories of the root manifest, already expanded. */
  readonly workspaces: readonly string[];
  readonly tracked: readonly string[];
  /** Tracked symbolic links and submodules (git modes 120000 and 160000): never read. */
  readonly links: ReadonlySet<string>;
  readonly exempted: ReadonlySet<string>;
  /** The UTF-8 text of a tracked file, or null when it cannot be read as such. */
  readonly read: (path: string) => string | null;
}

export interface CouplingCounts {
  /** Tracked entries under the declared trees = scanned + testsExcluded + unreadable + links. */
  readonly underRoots: number;
  /** Files actually read and examined. */
  readonly scanned: number;
  readonly testsExcluded: number;
  readonly unreadable: number;
  /** Symbolic links and submodules: counted, not followed (their target is not the tracked content). */
  readonly links: number;
  readonly lines: number;
}

export interface CouplingResult {
  readonly violations: readonly CouplingFinding[];
  readonly tolerated: readonly CouplingFinding[];
  readonly missingRoots: readonly string[];
  readonly uncoveredWorkspaces: readonly string[];
  readonly unreadable: readonly string[];
  readonly staleExemptions: readonly string[];
  /** Patterns that produced a zero-length match: invalid data, not findings. */
  readonly emptyMatchPatterns: readonly string[];
  readonly exemptedFiles: number;
  readonly counts: CouplingCounts;
}

/** Whether `path` is a normalised repository-relative path: no "..", no wildcard, not absolute. */
function isRelativePath(path: string): boolean {
  if (path === "" || path !== path.trim() || /[*?[\\]/.test(path) || path.startsWith("/")) {
    return false;
  }
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** Parse and validate the configuration data. Stops at the first defect. */
export function parseCouplingConfig(text: string): ConfigResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  if (!isRecord(data) || !onlyKeys(data, ["roots", "patterns"])) {
    return { ok: false, error: "expected an object with exactly `roots` and `patterns`" };
  }
  const { roots, patterns } = data;
  if (!Array.isArray(roots) || roots.length === 0) {
    return { ok: false, error: "`roots` must list at least one tree" };
  }
  const checkedRoots: string[] = [];
  for (const [index, root] of roots.entries()) {
    if (typeof root !== "string" || !isRelativePath(root)) {
      return { ok: false, error: `roots[${index}] is not a repository-relative path` };
    }
    if (checkedRoots.some((other) => isUnder(root, other) || isUnder(other, root))) {
      return { ok: false, error: `roots[${index}] overlaps another root` };
    }
    checkedRoots.push(root);
  }
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return { ok: false, error: "`patterns` must list at least one pattern" };
  }
  const compiled: CouplingPattern[] = [];
  for (const [index, pattern] of patterns.entries()) {
    const where = `patterns[${index}]`;
    if (!isRecord(pattern) || !onlyKeys(pattern, ["name", "regex", "why"])) {
      return { ok: false, error: `${where} must hold exactly name, regex and why` };
    }
    const { name, regex, why } = pattern;
    if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      return { ok: false, error: `${where}.name must be a kebab-case identifier` };
    }
    if (compiled.some((other) => other.name === name)) {
      return { ok: false, error: `${where}.name duplicates another pattern` };
    }
    if (typeof why !== "string" || why.trim() === "") {
      return { ok: false, error: `${where}.why must say why the pattern is forbidden` };
    }
    if (typeof regex !== "string" || regex === "") {
      return { ok: false, error: `${where}.regex must be a non-empty string` };
    }
    let compiledRegex: RegExp;
    try {
      compiledRegex = new RegExp(regex, "gu");
    } catch {
      return { ok: false, error: `${where}.regex is not a valid regular expression` };
    }
    // A pattern that matches the empty string matches every line.
    if (new RegExp(`^(?:${regex})$`, "u").test("")) {
      return { ok: false, error: `${where}.regex matches the empty string` };
    }
    compiled.push({ name, regex: compiledRegex });
  }
  return { ok: true, config: { roots: checkedRoots, patterns: compiled } };
}

/**
 * Expand the `workspaces` of the root manifest to package directories.
 *
 * Only the two forms this repository can expand exactly are accepted: a
 * literal directory, and `dir/*`. A package directory is one that holds a
 * tracked `package.json`. Anything else is refused rather than guessed: a
 * guessed expansion is how a package drops out of the scan.
 */
export function expandWorkspaces(
  declared: readonly string[],
  tracked: ReadonlySet<string>,
):
  | { readonly ok: true; readonly packages: string[] }
  | { readonly ok: false; readonly error: string } {
  const packages = new Set<string>();
  for (const workspace of declared) {
    if (workspace.endsWith("/*")) {
      const parent = workspace.slice(0, -2);
      if (!isRelativePath(parent)) {
        return { ok: false, error: `workspace "${workspace}" cannot be expanded exactly` };
      }
      for (const path of tracked) {
        const rest = path.startsWith(`${parent}/`) ? path.slice(parent.length + 1) : null;
        const parts = rest?.split("/");
        if (parts?.length === 2 && parts[1] === "package.json") {
          packages.add(`${parent}/${parts[0]}`);
        }
      }
      continue;
    }
    if (!isRelativePath(workspace)) {
      return { ok: false, error: `workspace "${workspace}" cannot be expanded exactly` };
    }
    if (!tracked.has(`${workspace}/package.json`)) {
      return { ok: false, error: `workspace "${workspace}" holds no tracked package.json` };
    }
    packages.add(workspace);
  }
  return { ok: true, packages: [...packages].sort() };
}

function excerptOf(line: string, index: number, length: number): string {
  const before = Math.floor((EXCERPT_LIMIT - Math.min(length, EXCERPT_LIMIT)) / 2);
  const start = Math.max(0, Math.min(index - before, line.length - EXCERPT_LIMIT));
  return line
    .slice(start, start + EXCERPT_LIMIT)
    .replace(CONTROL, "?")
    .trim();
}

/** Judge the tracked files under the declared trees. Pure: every input is handed in. */
export function evaluateCoupling(input: CouplingInput): CouplingResult {
  const { config, exempted } = input;
  const violations: CouplingFinding[] = [];
  const tolerated: CouplingFinding[] = [];
  const unreadable: string[] = [];
  const toleratingFiles = new Set<string>();
  const emptyMatchPatterns = new Set<string>();
  let underRoots = 0;
  let scanned = 0;
  let testsExcluded = 0;
  let links = 0;
  let lineCount = 0;

  const missingRoots = config.roots.filter(
    (root) => !input.tracked.some((path) => isUnder(path, root)),
  );
  const uncoveredWorkspaces = input.workspaces.filter(
    (workspace) => !config.roots.some((root) => isUnder(workspace, root)),
  );

  for (const path of [...input.tracked].sort()) {
    if (!config.roots.some((root) => isUnder(path, root))) continue;
    underRoots += 1;
    if (TEST_FILE.test(path)) {
      testsExcluded += 1;
      continue;
    }
    // A link's target may lie outside the tree, or outside the repository:
    // reading it would attribute foreign content to the link's path.
    if (input.links.has(path)) {
      links += 1;
      continue;
    }
    const text = input.read(path);
    if (text === null) {
      unreadable.push(path);
      continue;
    }
    scanned += 1;
    const lines = text.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    lineCount += lines.length;
    for (const [index, line] of lines.entries()) {
      for (const pattern of config.patterns) {
        for (const match of line.matchAll(pattern.regex)) {
          // A zero-width match (`(?=x)`, `\b`) names no text: the pattern is
          // wrong, and reporting it once per position would bury the cause.
          if (match[0].length === 0) {
            emptyMatchPatterns.add(pattern.name);
            continue;
          }
          const finding: CouplingFinding = {
            path,
            line: index + 1,
            pattern: pattern.name,
            excerpt: excerptOf(line, match.index, match[0].length),
          };
          if (exempted.has(path)) {
            tolerated.push(finding);
            toleratingFiles.add(path);
          } else {
            violations.push(finding);
          }
        }
      }
    }
  }

  return {
    violations,
    tolerated,
    missingRoots,
    uncoveredWorkspaces,
    unreadable,
    staleExemptions: [...exempted].filter((path) => !toleratingFiles.has(path)).sort(),
    emptyMatchPatterns: [...emptyMatchPatterns].sort(),
    exemptedFiles: exempted.size,
    counts: {
      underRoots,
      scanned,
      testsExcluded,
      unreadable: unreadable.length,
      links,
      lines: lineCount,
    },
  };
}

/** A tracked path may hold any byte but NUL: printed raw, a newline in it forges a log line. */
function safePath(path: string): string {
  return path.replace(CONTROL, "?");
}

function render(finding: CouplingFinding): string {
  return `${safePath(finding.path)}:${finding.line}: ${finding.pattern}: ${finding.excerpt}`;
}

/** Pure rendering: `ok` is the verdict, each line says where it goes by its prefix. */
export function renderCoupling(result: CouplingResult): {
  readonly ok: boolean;
  readonly lines: string[];
} {
  const { counts } = result;
  const volume =
    `${counts.underRoots} tracked file(s) under the shared trees = ${counts.scanned} file(s) scanned ` +
    `+ ${counts.testsExcluded} test file(s) excluded + ${counts.unreadable} unreadable ` +
    `+ ${counts.links} link(s) or submodule(s) not followed; ${counts.lines} line(s) read; ` +
    `${result.tolerated.length} tolerated match(es) in ${result.exemptedFiles} exempted file(s)`;
  const lines = result.tolerated.map((finding) => `${GATE}: tolerated: ${render(finding)}`);
  const failures = [
    ...result.violations.map((finding) => render(finding)),
    ...result.missingRoots.map((root) => `declared tree ${safePath(root)} holds no tracked file`),
    ...result.uncoveredWorkspaces.map(
      (workspace) => `workspace package ${safePath(workspace)} lies outside every declared tree`,
    ),
    ...result.unreadable.map((path) => `${safePath(path)} cannot be read as UTF-8 text`),
    ...result.staleExemptions.map(
      (path) =>
        `exemption ${safePath(path)} tolerates no match; remove it from ${PRODUCT_COUPLING_EXEMPTIONS}`,
    ),
    ...result.emptyMatchPatterns.map(
      (name) =>
        `pattern ${name} matched an empty string; fix its regex in ${PRODUCT_COUPLING_CONFIG}`,
    ),
  ];
  if (failures.length === 0 && counts.scanned === 0) {
    failures.push("no file was scanned: a green verdict would carry no evidence");
  }
  if (failures.length > 0) {
    return {
      ok: false,
      lines: [
        ...lines,
        ...failures.map((failure) => `${GATE}: ${failure}`),
        `${GATE} failed: ${failures.length} failure(s) — ${volume}. A product-specific ` +
          "reference belongs to the consuming product or to its runtime configuration.",
      ],
    };
  }
  return { ok: true, lines: [...lines, `${GATE} verified: ${volume}`] };
}

function git(args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args[0] ?? ""} failed: ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(result.stdout);
}

export interface StagedEntries {
  readonly tracked: string[];
  /** Symbolic links (mode 120000) and submodules (mode 160000). */
  readonly links: Set<string>;
}

/**
 * Parse `git ls-files --stage -z`: `<mode> <object> <stage>\t<path>` per NUL-ended
 * record. A conflicted path appears once per stage and is kept once. A record
 * without that shape throws: a guessed parse is how a file drops out of the scan.
 */
export function parseStagedEntries(output: string): StagedEntries {
  const tracked = new Set<string>();
  const links = new Set<string>();
  for (const record of output.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const mode = /^([0-7]{6}) [0-9a-f]+ [0-3]$/.exec(record.slice(0, tab))?.[1];
    if (tab < 0 || mode === undefined) {
      throw new Error("git ls-files --stage printed a record of unknown shape");
    }
    const path = record.slice(tab + 1);
    tracked.add(path);
    if (mode === "120000" || mode === "160000") links.add(path);
  }
  return { tracked: [...tracked], links };
}

function readUtf8(root: string, path: string): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(join(root, path)));
  } catch {
    return null;
  }
}

function main(argv: readonly string[]): number {
  if (argv.length !== 0) {
    console.error(`${GATE}: usage: bun tools/quality/check-product-coupling.ts`);
    return 1;
  }
  let root: string;
  let staged: StagedEntries;
  try {
    root = git(["rev-parse", "--show-toplevel"]).trim();
    staged = parseStagedEntries(git(["-C", root, "ls-files", "--stage", "-z"]));
  } catch (error) {
    console.error(`${GATE}: ${(error as Error).message}`);
    return 1;
  }
  const { tracked, links } = staged;
  const trackedSet = new Set(tracked);

  const sources: Record<string, string> = {};
  for (const path of [PRODUCT_COUPLING_CONFIG, PRODUCT_COUPLING_EXEMPTIONS, "package.json"]) {
    const text = trackedSet.has(path) ? readUtf8(root, path) : null;
    if (text === null) {
      console.error(`${GATE}: ${path} is not a readable tracked file`);
      return 1;
    }
    sources[path] = text;
  }

  const config = parseCouplingConfig(sources[PRODUCT_COUPLING_CONFIG] ?? "");
  if (!config.ok) {
    console.error(`${GATE}: ${PRODUCT_COUPLING_CONFIG}: ${config.error}`);
    return 1;
  }
  // The shared trees hold code: a tolerated file may be code, declared as such.
  const exemptions = parseAllowlist(sources[PRODUCT_COUPLING_EXEMPTIONS] ?? "", trackedSet, {
    notFiles: links,
    admitCode: true,
  });
  if (!exemptions.ok) {
    console.error(
      `${GATE}: ${PRODUCT_COUPLING_EXEMPTIONS} line ${exemptions.error.line}: ${exemptions.error.kind}`,
    );
    return 1;
  }
  let declaredWorkspaces: unknown;
  try {
    declaredWorkspaces = (JSON.parse(sources["package.json"] ?? "") as { workspaces?: unknown })
      .workspaces;
  } catch {
    console.error(`${GATE}: package.json is not valid JSON`);
    return 1;
  }
  const declared = declaredWorkspaces ?? [];
  if (!Array.isArray(declared) || !declared.every((entry) => typeof entry === "string")) {
    console.error(`${GATE}: package.json \`workspaces\` must be a list of strings`);
    return 1;
  }
  const workspaces = expandWorkspaces(declared, trackedSet);
  if (!workspaces.ok) {
    console.error(`${GATE}: package.json: ${workspaces.error}`);
    return 1;
  }

  const result = evaluateCoupling({
    config: config.config,
    workspaces: workspaces.packages,
    tracked,
    links,
    exempted: exemptions.paths,
    read: (path) => readUtf8(root, path),
  });
  const rendered = renderCoupling(result);
  for (const line of rendered.lines) {
    if (rendered.ok && !line.startsWith(`${GATE}: tolerated: `)) console.log(line);
    else console.error(line);
  }
  return rendered.ok ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
