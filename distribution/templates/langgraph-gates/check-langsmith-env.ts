// Fleet gate template — ADR-0058 section 3, condition 4, first mechanism.
//
// Copied by a repository that adds `@langchain/langgraph` (see docs/method/LANGGRAPH-ENTRY-GATES.md).
// Self-contained on purpose: one file, `node:` and `Bun` only, so a consumer copies it without
// importing anything from the governance repository.
//
// Usage: bun check-langsmith-env.ts [--root=<dir>] [--exclude=<repo-relative path or directory>]...
//
//   --root     the repository to examine (default: the current directory). It must be a git work
//              tree: the universe is its TRACKED files, so an untracked file is not examined.
//   --exclude  a fixture of THIS gate, as a path or a directory prefix, relative to the root. It is
//              counted and printed. The consumer's package script carries it, so that a reviewer
//              reads which paths the gate does not look at.
//
// What it refuses: a variable name that starts with the LangSmith prefix, and five historical
// aliases of the same switch, anywhere in a tracked text file other than prose documentation.
//
// The file does not contain the names it refuses: they are assembled from parts, because the gate
// scans its own repository and would otherwise refuse itself. Its test builds its fixtures the
// same way, so no tracked file of the template carries a refused name.
//
// What it does NOT see, and prints on every run: a name built at run time (a concatenation, a
// template string, a computed key), a name written in prose documentation, an untracked file. The
// second mechanism of the condition — the harness refusing a connection to a publisher telemetry
// host, counted in its events — is the only control for those, and no textual gate replaces it.

import { lstatSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const PREFIX = `${"LANGSMITH"}${"_"}`;
const ALIAS_SUFFIXES = ["TRACING_V2", "TRACING", "API_KEY", "ENDPOINT", "CALLBACKS_BACKGROUND"];
const ALIASES = ALIAS_SUFFIXES.map((suffix) => `LANGCHAIN${"_"}${suffix}`);

// A name only counts when it is a whole name: `MY_<name>` does not start with the prefix, and an
// alias followed by more name characters is a different variable.
const REFUSED_NAME = new RegExp(
  `(?<![A-Za-z0-9_])(?:${PREFIX}[A-Za-z0-9_]*|${ALIASES.join("|")})(?![A-Za-z0-9_])`,
  "g",
);

// Prose documents the refusal; it does not configure a process.
const PROSE_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".txt", ".rst", ".adoc"]);

export interface Finding {
  readonly line: number;
  readonly name: string;
}

/** The refused names of a text, with their line. The line itself is never kept: a `.env` line may carry a key. */
export function scanText(text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(REFUSED_NAME)) {
      findings.push({ line: index + 1, name: match[0] });
    }
  }
  return findings;
}

export interface Arguments {
  readonly root: string;
  readonly exclude: readonly string[];
}

export function parseArguments(argv: readonly string[]): Arguments {
  let root = ".";
  const exclude: string[] = [];
  for (const argument of argv) {
    if (argument.startsWith("--root=")) root = argument.slice("--root=".length);
    else if (argument.startsWith("--exclude=")) exclude.push(argument.slice("--exclude=".length));
    else throw new Error(`unknown argument '${argument}'`);
  }
  return { root: resolve(root), exclude };
}

function trackedFiles(root: string): string[] {
  const result = Bun.spawnSync(["git", "-C", root, "ls-files", "-z"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    // Not "no files": the inventory itself could not be taken.
    throw new Error(
      `git ls-files failed in ${root}: ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter((path) => path !== "");
}

function isExcluded(path: string, exclude: readonly string[]): boolean {
  return exclude.some(
    (prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
}

/** How the tracked tree was swept. The counters sum to `tracked`: each path lands in exactly one. */
export interface Sweep {
  readonly tracked: number;
  readonly scanned: number;
  readonly prose: number;
  readonly excluded: number;
  readonly binary: number;
  readonly notRegular: readonly string[];
  readonly unreadable: readonly string[];
  readonly refused: readonly string[];
}

export function sweep(root: string, exclude: readonly string[]): Sweep {
  const tracked = trackedFiles(root);
  const notRegular: string[] = [];
  const unreadable: string[] = [];
  const refused: string[] = [];
  let scanned = 0;
  let prose = 0;
  let excluded = 0;
  let binary = 0;
  for (const path of tracked) {
    if (isExcluded(path, exclude)) {
      excluded += 1;
      continue;
    }
    const absolute = join(root, path);
    let regular: boolean;
    try {
      regular = lstatSync(absolute).isFile();
    } catch {
      unreadable.push(path);
      continue;
    }
    if (!regular) {
      // The repository versions the link, not its target: the target is swept if it is tracked.
      notRegular.push(path);
      continue;
    }
    if (PROSE_EXTENSIONS.has(extname(path).toLowerCase())) {
      prose += 1;
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(absolute);
    } catch {
      unreadable.push(path);
      continue;
    }
    if (bytes.includes(0)) {
      binary += 1;
      continue;
    }
    scanned += 1;
    for (const finding of scanText(bytes.toString("utf8"))) {
      refused.push(`${path}:${finding.line}: ${finding.name}`);
    }
  }
  return {
    tracked: tracked.length,
    scanned,
    prose,
    excluded,
    binary,
    notRegular,
    unreadable,
    refused,
  };
}

export function verdict(result: Sweep): string[] {
  const failures: string[] = [];
  for (const refusal of result.refused) failures.push(`refused name ${refusal}`);
  for (const path of result.unreadable) failures.push(`${path}: tracked but unreadable`);
  if (result.scanned === 0) failures.push("scanned 0 file(s): the gate examined nothing");
  return failures;
}

if (import.meta.main) {
  let args: Arguments;
  let result: Sweep;
  try {
    args = parseArguments(Bun.argv.slice(2));
    result = sweep(args.root, args.exclude);
  } catch (error) {
    console.error(`LangSmith env: ${(error as Error).message}`);
    process.exit(2);
  }
  const named = result.notRegular.length === 0 ? "" : `: ${result.notRegular.join(", ")}`;
  console.log(
    `LangSmith env: ${result.tracked} tracked file(s): ${result.scanned} scanned, ` +
      `${result.prose} prose (not scanned), ${result.excluded} excluded (gate fixtures), ` +
      `${result.binary} binary, ${result.notRegular.length} not regular${named}, ` +
      `${result.unreadable.length} unreadable; ${result.refused.length} refused name(s)`,
  );
  console.log(
    "LangSmith env: not seen — a name built at run time, a name in prose documentation, an " +
      "untracked file; the harness egress refusal is the control for those",
  );
  const failures = verdict(result);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`LangSmith env: ${failure}`);
    console.error(`LangSmith env failed: ${failures.length} problem(s).`);
    process.exit(1);
  }
  console.log("LangSmith env verified: no refused name in the scanned files.");
}
