/**
 * Wave-1 publish preflight — fail-closed gate before any `bun publish`.
 *
 * For each satellite it runs a REAL `bun pm pack` into a temp dir, then
 * inspects the produced tarball: the manifest must be non-private, licensed,
 * and carry zero `workspace:`/`catalog:` residue in any dependency group
 * (bun materializes them at pack time — this gate proves it happened); the
 * entries must include LICENSE and no test file; the four satellites must
 * share one linked version. Analysis is pure (unit-tested); only the CLI
 * touches the filesystem.
 *
 * Manual by design (owner decision 2026-08-18): run this the day of an npm
 * publish, immediately before `bun publish` — not on a schedule, not in CI.
 * There is nothing to gate between publishes; wiring it to a cron would audit
 * a tarball nobody is about to ship.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const SATELLITE_DIRECTORIES = [
  "packages/contracts",
  "packages/web-platform",
  "packages/ui",
  "packages/auth-web",
] as const;

/**
 * The exact SPDX license each satellite must publish under (ADR-0004): a
 * silent drift (e.g. auth-web flipped to Apache-2.0, or a permissive package
 * relicensed) would otherwise ship undetected — the `license`-non-empty check
 * alone does not catch it. Every satellite name must appear here; an unknown
 * name fails closed.
 */
export const EXPECTED_LICENSES: Record<string, string> = {
  "@libre-ai/contracts": "Apache-2.0",
  "@libre-ai/web-platform": "Apache-2.0",
  "@libre-ai/ui": "Apache-2.0",
  "@libre-ai/auth-web": "EUPL-1.2",
};

interface TarballManifest {
  readonly name?: string;
  readonly version?: string;
  readonly license?: string;
  readonly private?: boolean;
  readonly [key: string]: unknown;
}

const DEPENDENCY_GROUPS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** Manifest rules for a publishable tarball; returns issues (empty = clean). */
export function analyzeTarballManifest(manifest: TarballManifest): string[] {
  const issues: string[] = [];
  if (manifest.private === true) issues.push(`${manifest.name}: manifest is still private`);
  if (typeof manifest.license !== "string" || manifest.license.length === 0) {
    issues.push(`${manifest.name}: missing license field`);
  }
  for (const group of DEPENDENCY_GROUPS) {
    const dependencies = manifest[group];
    if (typeof dependencies !== "object" || dependencies === null) continue;
    for (const [dependency, spec] of Object.entries(dependencies as Record<string, unknown>)) {
      if (typeof spec !== "string") continue;
      if (spec.startsWith("workspace:")) {
        issues.push(`${manifest.name}: ${group}.${dependency} kept a workspace: ref (${spec})`);
      }
      if (spec.startsWith("catalog:") || spec === "catalog") {
        issues.push(`${manifest.name}: ${group}.${dependency} kept a catalog: ref (${spec})`);
      }
    }
  }
  return issues;
}

// A test/spec file in any JS/TS extension family (.test.ts, .spec.tsx,
// .test.js, .test.mjs, .spec.cts, …). Broader than .test.ts(x) so a spec
// helper or a compiled test cannot slip past the `files` negation.
const TEST_ENTRY = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Entry rules: LICENSE shipped, no test/spec file leaked. */
export function analyzeTarballEntries(entries: readonly string[]): string[] {
  const issues: string[] = [];
  if (!entries.includes("LICENSE")) issues.push("LICENSE missing from the tarball");
  for (const entry of entries) {
    if (TEST_ENTRY.test(entry)) issues.push(`test file leaked into the tarball: ${entry}`);
  }
  return issues;
}

/**
 * The manifest's declared license must equal the exact SPDX id pinned for that
 * satellite (fail-closed: an unknown satellite name has no expected license).
 */
export function checkExpectedLicense(manifest: TarballManifest): string[] {
  const name = manifest.name;
  if (typeof name !== "string") return ["manifest without a name has no expected license"];
  const expected = EXPECTED_LICENSES[name];
  if (expected === undefined) {
    return [`${name}: no expected license registered for this satellite`];
  }
  if (manifest.license !== expected) {
    return [`${name}: license ${manifest.license} differs from the required ${expected}`];
  }
  return [];
}

/**
 * Every file an `exports`/`types`/`main` entry points at must be present in the
 * tarball, or a consumer's `import "@libre-ai/ui"` resolves to a file that was
 * never shipped. Recurses through conditional `exports` objects; wildcard
 * subpath targets (containing `*`) are skipped — they cannot be matched against
 * concrete entries. Fail-closed on any missing target.
 */
export function checkExportsResolve(
  manifest: TarballManifest,
  entries: readonly string[],
): string[] {
  const shipped = new Set(entries);
  const targets = new Set<string>();

  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      targets.add(value);
    } else if (value !== null && typeof value === "object") {
      for (const nested of Object.values(value as Record<string, unknown>)) collect(nested);
    }
  };
  collect(manifest.exports);
  if (typeof manifest.types === "string") targets.add(manifest.types);
  if (typeof manifest.main === "string") targets.add(manifest.main);

  const issues: string[] = [];
  for (const target of targets) {
    if (target.includes("*")) continue;
    const normalized = target.replace(/^\.\//, "");
    if (!shipped.has(normalized)) {
      issues.push(`${manifest.name}: exports/types target ${target} is not present in the tarball`);
    }
  }
  return issues;
}

/** The wave-1 satellites version together (linked versioning). */
export function checkVersionCoherence(
  manifests: readonly { name: string; version: string }[],
): string[] {
  const reference = manifests[0]?.version;
  if (reference === undefined) return [];
  return manifests
    .filter((manifest) => manifest.version !== reference)
    .map(
      (manifest) =>
        `${manifest.name}: version ${manifest.version} differs from the linked set (${reference})`,
    );
}

/**
 * A satellite that ships a compiled `dist/` (only `@libre-ai/ui` today) declares
 * a `build` script. The preflight builds it just-in-time before packing and
 * removes the generated `dist/` afterward, so the artifact is transient and the
 * working tree stays free of nested JavaScript (the `check:source` gate only
 * whitelists a repo-root `dist/`). Returns an issue if the build fails.
 */
async function buildIfNeeded(packagePath: string): Promise<{ built: boolean; issues: string[] }> {
  const manifest = (await Bun.file(join(packagePath, "package.json")).json()) as {
    scripts?: Record<string, string>;
  };
  if (typeof manifest.scripts?.build !== "string") return { built: false, issues: [] };
  const build = Bun.spawnSync(["bun", "run", "build"], { cwd: packagePath });
  if (build.exitCode !== 0) {
    return {
      built: false,
      issues: [`${packagePath}: build failed: ${build.stderr.toString().trim()}`],
    };
  }
  return { built: true, issues: [] };
}

async function packAndInspect(
  repositoryRoot: string,
  packageDirectory: string,
): Promise<{ manifest: TarballManifest; issues: string[] }> {
  const packagePath = resolve(repositoryRoot, packageDirectory);
  // Build before creating the temp dir, so a build failure leaks nothing; clean
  // any partial dist the failed build may have left.
  const built = await buildIfNeeded(packagePath);
  if (built.issues.length > 0) {
    await rm(join(packagePath, "dist"), { recursive: true, force: true });
    return { manifest: {}, issues: built.issues };
  }
  const workDirectory = await mkdtemp(join(tmpdir(), "publish-preflight-"));
  try {
    const packed = Bun.spawnSync(["bun", "pm", "pack", "--destination", workDirectory, "--quiet"], {
      cwd: packagePath,
    });
    if (packed.exitCode !== 0) {
      return {
        manifest: {},
        issues: [`${packageDirectory}: bun pm pack failed: ${packed.stderr.toString().trim()}`],
      };
    }
    const tarballs = (await readdir(workDirectory)).filter((name) => name.endsWith(".tgz"));
    const tarballName = tarballs[0];
    if (tarballName === undefined) {
      return { manifest: {}, issues: [`${packageDirectory}: no tarball produced`] };
    }

    const listing = Bun.spawnSync(["tar", "-tzf", join(workDirectory, tarballName)]);
    const entries = listing.stdout
      .toString()
      .split("\n")
      .filter((line) => line.length > 0)
      // npm tarballs prefix every entry with "package/".
      .map((line) => line.replace(/^package\//, ""));

    const extract = Bun.spawnSync([
      "tar",
      "-xzf",
      join(workDirectory, tarballName),
      "-C",
      workDirectory,
      "package/package.json",
    ]);
    if (extract.exitCode !== 0) {
      return { manifest: {}, issues: [`${packageDirectory}: could not read tarball manifest`] };
    }
    const manifest = (await Bun.file(
      join(workDirectory, "package", "package.json"),
    ).json()) as TarballManifest;

    return {
      manifest,
      issues: [
        ...analyzeTarballManifest(manifest),
        ...checkExpectedLicense(manifest),
        ...analyzeTarballEntries(entries),
        ...checkExportsResolve(manifest, entries),
      ],
    };
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
    // Transient build artifact: keep the working tree free of nested JS.
    if (built.built) await rm(join(packagePath, "dist"), { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, "../..");
  const issues: string[] = [];
  const packed: { name: string; version: string }[] = [];

  for (const packageDirectory of SATELLITE_DIRECTORIES) {
    const result = await packAndInspect(repositoryRoot, packageDirectory);
    issues.push(...result.issues);
    if (typeof result.manifest.name === "string" && typeof result.manifest.version === "string") {
      packed.push({ name: result.manifest.name, version: result.manifest.version });
    }
  }
  issues.push(...checkVersionCoherence(packed));

  if (issues.length > 0) {
    for (const issue of issues) console.error(issue);
    console.error("Publish preflight FAILED — nothing may be published.");
    process.exit(1);
  }
  console.log(
    `Publish preflight OK for ${packed.length} satellites at linked version ${packed[0]?.version}`,
  );
}
