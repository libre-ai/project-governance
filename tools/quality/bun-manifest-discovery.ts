/**
 * Which package manifests the Bun-floor gate has to read, and proof that it
 * read them.
 *
 * Until 2026-10-09 the gate found nested manifests through three fixed globs
 * (`apps/*`, `packages/*`, `distribution/templates/*`) scanned with the
 * `Bun.Glob` defaults — no dot entries, no symlinks — and never read the root
 * `workspaces`. Every one of these was executed by `bun run --filter` and seen
 * by nothing (adversarial review of PR #55): a `libs/*` workspace, a
 * `packages/group/*` one, `packages/.z`, a symlinked `packages/s`. The gate
 * said "1 manifest read" and printed no count of what it had not read, so the
 * blind spot was indistinguishable from an empty tree.
 *
 * Discovery now has two independent sources, and the gate reads their union:
 *
 *   1. the workspace patterns — the fixed ones above plus every pattern of the
 *      root `workspaces` (array or `{ packages }` form), scanned with dot
 *      entries and symlinks followed, because that is what bun executes;
 *   2. the tracked tree — every `package.json` git knows, because a manifest
 *      that is not a workspace member is still runnable (`bun run --cwd`,
 *      `cd x && bun run y`) and the workspace list is exactly the input an
 *      attacker, or a mistake, edits.
 *
 * A workspace pattern this module cannot honour (a negation, a non-string) is
 * a failure, not an omission; so is a tracked tree git cannot list.
 */

import { relative } from "node:path";

/** Patterns read in every repository, workspace declaration or not. */
export const FIXED_MANIFEST_PATTERNS: readonly string[] = [
  "apps/*/package.json",
  "packages/*/package.json",
  "distribution/templates/*/package.json",
];

export interface WorkspacePatterns {
  readonly patterns: readonly string[];
  readonly failures: readonly string[];
}

/**
 * The manifest globs a root manifest's `workspaces` declares, in bun's two
 * accepted shapes. Anything else is reported, never silently dropped.
 */
export function workspaceManifestPatterns(workspaces: unknown): WorkspacePatterns {
  if (workspaces === undefined || workspaces === null) return { patterns: [], failures: [] };
  const entries: unknown =
    Array.isArray(workspaces) || typeof workspaces !== "object"
      ? workspaces
      : (workspaces as { packages?: unknown }).packages;
  if (!Array.isArray(entries)) {
    return {
      patterns: [],
      failures: ["workspaces must be an array of patterns or an object with a packages array"],
    };
  }
  const patterns: string[] = [];
  const failures: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.trim() === "") {
      failures.push(`workspaces entry ${JSON.stringify(entry)} is not a pattern`);
      continue;
    }
    if (entry.startsWith("!")) {
      // An exclusion would let a declared member escape the gate by name.
      failures.push(`workspaces entry ${entry} is a negation, which this gate does not honour`);
      continue;
    }
    const base = entry.replace(/^\.\//, "").replace(/\/+$/, "");
    patterns.push(base.endsWith("package.json") ? base : `${base}/package.json`);
  }
  return { patterns, failures };
}

function underNodeModules(path: string): boolean {
  return path.split("/").includes("node_modules");
}

/** Manifests the patterns reach, with dot entries and symlinks, as bun does. */
export async function scanManifestPatterns(
  cwd: string,
  patterns: readonly string[],
): Promise<string[]> {
  const found = new Set<string>();
  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({ cwd, onlyFiles: true, dot: true, followSymlinks: true })) {
      found.add(path);
    }
  }
  return [...found].sort();
}

/** Every tracked `package.json` but the root one. Throws when git cannot answer. */
export function trackedNestedManifests(cwd: string): string[] {
  const listing = Bun.spawnSync(["git", "ls-files", "-z", "--", ":(glob)**/package.json"], {
    cwd,
  });
  if (listing.exitCode !== 0) {
    throw new Error(
      `git ls-files failed (exit ${listing.exitCode}): ${listing.stderr.toString().trim()}`,
    );
  }
  return listing.stdout
    .toString()
    .split("\0")
    .filter((path) => path !== "" && path !== "package.json")
    .sort();
}

export interface ManifestInventory {
  /** Manifests to read, sorted. */
  readonly read: readonly string[];
  /** Paths either source named, but under node_modules: not this repository's code. */
  readonly skippedNodeModules: readonly string[];
  readonly tracked: number;
  readonly workspaceMatched: number;
  /** Read paths git does not track (ignored or untracked workspace members). */
  readonly untracked: number;
  /** Every path either source named: `read` plus `skippedNodeModules`. */
  readonly universe: number;
}

/**
 * The union of both sources. Every tracked manifest is read or skipped for the
 * one stated reason (node_modules) BY CONSTRUCTION — `read` is the union, not
 * the glob result checked against git afterwards — so a separate "tracked but
 * unread" assertion could never fire (a mutation removing it survived every
 * test, 2026-10-09) and is not written. The counters printed by the gate sum
 * to the universe: read + skipped = universe.
 */
export function reconcileManifests(
  tracked: readonly string[],
  workspaceMatched: readonly string[],
): ManifestInventory {
  const universe = new Set([...tracked, ...workspaceMatched]);
  universe.delete("package.json");
  const skippedNodeModules = [...universe].filter(underNodeModules).sort();
  const read = [...universe].filter((path) => !underNodeModules(path)).sort();
  const trackedSet = new Set(tracked);
  return {
    read,
    skippedNodeModules,
    tracked: tracked.length,
    workspaceMatched: workspaceMatched.length,
    untracked: read.filter((path) => !trackedSet.has(path)).length,
    universe: universe.size,
  };
}

/** `..`-path from a nested manifest's directory back to the repository root. */
export function pathToRoot(manifestPath: string): string {
  const directory = manifestPath.replace(/\/?package\.json$/, "");
  return relative(directory, ".") || ".";
}
