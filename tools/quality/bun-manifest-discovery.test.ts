import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FIXED_MANIFEST_PATTERNS,
  pathToRoot,
  reconcileManifests,
  scanManifestPatterns,
  trackedNestedManifests,
  workspaceManifestPatterns,
} from "./bun-manifest-discovery";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tree(files: readonly string[], symlinks: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "bunfloor-discovery-"));
  roots.push(root);
  for (const file of files) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "{}");
  }
  for (const [link, target] of Object.entries(symlinks)) symlinkSync(target, join(root, link));
  return root;
}

describe("workspaceManifestPatterns", () => {
  test("array form, normalised to manifest globs", () => {
    expect(workspaceManifestPatterns(["packages/*", "./libs/*/", "apps/one"])).toEqual({
      patterns: ["packages/*/package.json", "libs/*/package.json", "apps/one/package.json"],
      failures: [],
    });
  });

  test("{ packages } form", () => {
    expect(workspaceManifestPatterns({ packages: ["libs/*"], catalog: {} }).patterns).toEqual([
      "libs/*/package.json",
    ]);
  });

  test("absent workspaces: no pattern, no failure", () => {
    expect(workspaceManifestPatterns(undefined)).toEqual({ patterns: [], failures: [] });
  });

  test("a negation, a non-string and a wrong shape are failures, never dropped", () => {
    expect(workspaceManifestPatterns(["!packages/x", 3, ""]).failures).toHaveLength(3);
    expect(workspaceManifestPatterns("packages/*").failures).toHaveLength(1);
    expect(workspaceManifestPatterns({ packages: "libs/*" }).failures).toHaveLength(1);
  });
});

describe("scanManifestPatterns", () => {
  test("dot directories and symlinked members are found, as bun runs them", async () => {
    const root = tree(["packages/a/package.json", "packages/.z/package.json", "v/s/package.json"]);
    symlinkSync("../v/s", join(root, "packages/s"));
    expect(await scanManifestPatterns(root, FIXED_MANIFEST_PATTERNS)).toEqual([
      "packages/.z/package.json",
      "packages/a/package.json",
      "packages/s/package.json",
    ]);
  });

  test("the fixed patterns alone miss libs/* and a nested group; the workspaces reach them", async () => {
    const root = tree(["libs/x/package.json", "packages/group/y/package.json"]);
    expect(await scanManifestPatterns(root, FIXED_MANIFEST_PATTERNS)).toEqual([]);
    const declared = workspaceManifestPatterns(["libs/*", "packages/group/*"]).patterns;
    expect(await scanManifestPatterns(root, declared)).toEqual([
      "libs/x/package.json",
      "packages/group/y/package.json",
    ]);
  });
});

describe("trackedNestedManifests", () => {
  test("outside a git work tree it throws instead of answering empty", () => {
    expect(() => trackedNestedManifests(tree(["package.json"]))).toThrow("git ls-files failed");
  });
});

describe("reconcileManifests", () => {
  test("the union of both sources is read; counters sum to the universe", () => {
    const inventory = reconcileManifests(
      ["tools/review/package.json", "packages/a/package.json", "x/node_modules/q/package.json"],
      ["packages/a/package.json", "packages/.z/package.json"],
    );
    expect(inventory.read).toEqual([
      "packages/.z/package.json",
      "packages/a/package.json",
      "tools/review/package.json",
    ]);
    expect(inventory.skippedNodeModules).toEqual(["x/node_modules/q/package.json"]);
    expect(inventory.untracked).toBe(1);
    expect(inventory.read.length + inventory.skippedNodeModules.length).toBe(inventory.universe);
    expect(inventory.universe).toBe(4);
  });

  test("the root manifest is never a nested one", () => {
    expect(reconcileManifests(["package.json"], ["package.json"]).read).toEqual([]);
  });
});

test("pathToRoot climbs as many directories as the member sits deep", () => {
  expect(pathToRoot("packages/a/package.json")).toBe("../..");
  expect(pathToRoot("crates/store/check/package.json")).toBe("../../..");
  expect(pathToRoot("tools/package.json")).toBe("..");
});
