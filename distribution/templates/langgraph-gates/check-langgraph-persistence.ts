// Fleet gate template — ADR-0058 section 3, condition 5.
//
// Copied by a repository that adds `@langchain/langgraph` (see docs/method/LANGGRAPH-ENTRY-GATES.md).
// Self-contained on purpose: one file, `node:` and `Bun` only.
//
// Usage: bun check-langgraph-persistence.ts [--root=<dir>]
//
//   --root   the repository to examine (default: the current directory). It must be a git work
//            tree: the universe is its TRACKED manifests and lockfiles.
//
// What it refuses, by name, in every tracked `package.json` and lockfile: the checkpointer
// packages of the publisher — `-postgres`, `-redis`, `-mongodb`, `-sqlite` — and any other package
// under the same prefix. The prefix is the rule, the four names are its instances: the stores of
// the publisher ship inside those packages (GHSA-8p8h-xj5r-m5wf is a store-namespace defect of the
// Postgres and Redis ones), and a backend published tomorrow lands under the same prefix. The
// package without a suffix, `@langchain/langgraph-checkpoint`, is the transitive base of
// `@langchain/langgraph` and is not a persistence backend: it stays admitted.
//
// The sweep is textual, over the whole file, so a dependency, an override, an alias
// (`npm:<name>@<range>`) and a lockfile entry are all seen under the same rule.
//
// What it does NOT see: a persistence layer written by hand (a database client of the consumer
// used to store graph state), and a package that reaches the product by an import of a source
// file never declared in a manifest. The persistence of a run belongs to the fleet's own
// projections (I-09, I-10); this gate refuses the publisher's packages, nothing more.

import { lstatSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const MANIFESTS = new Set(["package.json"]);
const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const REFUSED_PACKAGE = /@langchain\/langgraph-checkpoint-[a-z0-9][a-z0-9._-]*/gi;

export interface Finding {
  readonly line: number;
  readonly name: string;
}

export function scanText(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const match of line.matchAll(REFUSED_PACKAGE)) {
      findings.push({ line: index + 1, name: match[0].toLowerCase() });
    }
  }
  return findings;
}

export interface Arguments {
  readonly root: string;
}

export function parseArguments(argv: readonly string[]): Arguments {
  let root = ".";
  for (const argument of argv) {
    if (argument.startsWith("--root=")) root = argument.slice("--root=".length);
    else throw new Error(`unknown argument '${argument}'`);
  }
  return { root: resolve(root) };
}

function trackedFiles(root: string): string[] {
  const result = Bun.spawnSync(["git", "-C", root, "ls-files", "-z"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    // Not "no manifest": the inventory itself could not be taken.
    throw new Error(
      `git ls-files failed in ${root}: ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter((path) => path !== "");
}

/** The counters sum to `tracked`: each tracked path lands in exactly one of them. */
export interface Sweep {
  readonly tracked: number;
  readonly manifests: number;
  readonly lockfiles: number;
  readonly outOfScope: number;
  readonly unreadable: readonly string[];
  readonly refused: readonly string[];
}

export function sweep(root: string): Sweep {
  const tracked = trackedFiles(root);
  const unreadable: string[] = [];
  const refused: string[] = [];
  let manifests = 0;
  let lockfiles = 0;
  let outOfScope = 0;
  for (const path of tracked) {
    const name = basename(path);
    const isManifest = MANIFESTS.has(name);
    if (!isManifest && !LOCKFILES.has(name)) {
      outOfScope += 1;
      continue;
    }
    const absolute = join(root, path);
    let text: string;
    try {
      if (!lstatSync(absolute).isFile()) {
        // A manifest behind a link is versioned as the link: it cannot be read here, so it fails.
        unreadable.push(`${path} (not a regular file)`);
        continue;
      }
      // latin1: package names are ASCII, and a binary lockfile must be swept, not skipped.
      text = readFileSync(absolute).toString("latin1");
    } catch {
      unreadable.push(`${path} (unreadable)`);
      continue;
    }
    if (isManifest) manifests += 1;
    else lockfiles += 1;
    for (const finding of scanText(text)) refused.push(`${path}:${finding.line}: ${finding.name}`);
  }
  return { tracked: tracked.length, manifests, lockfiles, outOfScope, unreadable, refused };
}

export function verdict(result: Sweep): string[] {
  const failures: string[] = [];
  for (const refusal of result.refused) failures.push(`refused package ${refusal}`);
  for (const path of result.unreadable)
    failures.push(`${path}: a declared source that was not read`);
  if (result.manifests === 0)
    failures.push("read 0 manifest(s): the gate examined no package.json");
  if (result.lockfiles === 0)
    failures.push("read 0 lockfile(s): the resolved graph was not examined");
  return failures;
}

if (import.meta.main) {
  let result: Sweep;
  try {
    result = sweep(parseArguments(Bun.argv.slice(2)).root);
  } catch (error) {
    console.error(`LangGraph persistence: ${(error as Error).message}`);
    process.exit(2);
  }
  console.log(
    `LangGraph persistence: ${result.tracked} tracked file(s): ${result.manifests} manifest(s) and ` +
      `${result.lockfiles} lockfile(s) read, ${result.outOfScope} out of scope, ` +
      `${result.unreadable.length} unreadable; ${result.refused.length} refused package reference(s)`,
  );
  console.log(
    "LangGraph persistence: not seen — a persistence layer written by hand, an import of a " +
      "package no manifest declares",
  );
  const failures = verdict(result);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`LangGraph persistence: ${failure}`);
    console.error(`LangGraph persistence failed: ${failures.length} problem(s).`);
    process.exit(1);
  }
  console.log("LangGraph persistence verified: no refused package in any manifest or lockfile.");
}
