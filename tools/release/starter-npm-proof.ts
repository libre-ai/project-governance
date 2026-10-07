/**
 * Wave-1 exit gate: real-usage proof for the starter template.
 *
 * The starter is never published; it only INSTALLS from the npm registry,
 * proving that the four satellites (@libre-ai/contracts, web-platform, ui,
 * auth-web) are consumable real packages. This tool rewrites the template's
 * manifest to use registry versions, runs a real `bun install`, executes the
 * unit tests, and on success writes dated evidence. Pre-publication: graceful
 * failure (the packages are not on npm yet).
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "bun";

interface ManifestDep {
  [key: string]: unknown;
}

interface Manifest {
  readonly name?: string;
  readonly private?: boolean;
  readonly dependencies?: ManifestDep;
  readonly devDependencies?: ManifestDep;
  readonly peerDependencies?: ManifestDep;
  readonly optionalDependencies?: ManifestDep;
  readonly [key: string]: unknown;
}

interface RegistryRewriteOpts {
  readonly linkedVersion: string;
  readonly catalog: Record<string, string>;
  readonly testingCatalog: Record<string, string>;
}

const DEPENDENCY_GROUPS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Rewrite the starter manifest for registry consumption: replace workspace:*
 * refs with the linked version, and catalog:/catalog:testing refs with
 * resolved versions from the root catalogs. Fail-closed on unresolvable refs.
 */
export function rewriteManifestForRegistry(
  manifest: Manifest,
  opts: RegistryRewriteOpts,
): Manifest {
  const result: Manifest = JSON.parse(JSON.stringify(manifest));

  for (const group of DEPENDENCY_GROUPS) {
    const deps = result[group];
    if (typeof deps !== "object" || deps === null) continue;
    const depDict = deps as ManifestDep;

    for (const [name, spec] of Object.entries(depDict)) {
      if (typeof spec !== "string") continue;

      if (spec.startsWith("workspace:")) {
        // Only @libre-ai/* workspace refs are allowed; anything else is an error.
        if (!name.startsWith("@libre-ai/")) {
          throw new Error(`non-libre-ai workspace ref not allowed: ${name} ${spec}`);
        }
        depDict[name] = `^${opts.linkedVersion}`;
      } else if (spec === "catalog:" || spec.startsWith("catalog:")) {
        // Resolve from the appropriate catalog.
        if (spec === "catalog:") {
          const resolved = opts.catalog[name];
          if (resolved === undefined) {
            throw new Error(`unresolvable catalog ref: ${name} (not in root catalog)`);
          }
          depDict[name] = resolved;
        } else if (spec === "catalog:testing") {
          const resolved = opts.testingCatalog[name];
          if (resolved === undefined) {
            throw new Error(`unresolvable catalog:testing ref: ${name} (not in testing catalog)`);
          }
          depDict[name] = resolved;
        } else {
          throw new Error(`unknown catalog ref format: ${name} ${spec}`);
        }
      }
    }
  }

  return result;
}

/**
 * A `bun install` failure is the *expected* pre-publication state only when the
 * registry returns 404/E404 for an `@libre-ai` package (they are not published
 * yet). Requiring BOTH the not-found code AND the scope avoids misreading a real
 * post-publication failure that merely mentions `@libre-ai` as "not published".
 */
export function isPrePublicationFailure(stderr: string): boolean {
  return /\b(?:404|E404)\b/.test(stderr) && stderr.includes("@libre-ai");
}

async function readManifest(path: string): Promise<Manifest> {
  const file = await Bun.file(path).json();
  return file as Manifest;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    // Skip node_modules, dist, test-results.
    if (["node_modules", "dist", "test-results"].includes(entry.name)) continue;
    if (entry.name === ".git" || entry.name === ".gitignore") continue;

    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      const content = await Bun.file(srcPath).arrayBuffer();
      await Bun.write(destPath, content);
    }
  }
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, "../..");

  // Parse arguments for optional --date.
  let dateArg = new Date().toISOString().split("T")[0];
  for (let i = 2; i < process.argv.length; i += 2) {
    if (process.argv[i] === "--date" && process.argv[i + 1] !== undefined) {
      dateArg = process.argv[i + 1];
    }
  }

  try {
    // 1. Read root package.json and extract catalogs + linked version.
    const rootManifest = await readManifest(resolve(repositoryRoot, "package.json"));
    const workspaces = rootManifest.workspaces as {
      catalog?: Record<string, string>;
      catalogs?: { testing?: Record<string, string> };
    };
    const catalog = workspaces?.catalog || {};
    const testingCatalog = workspaces?.catalogs?.testing || {};

    // Get linked version from packages/contracts.
    const contractsManifest = await readManifest(
      resolve(repositoryRoot, "packages/contracts/package.json"),
    );
    const linkedVersion = contractsManifest.version as string;

    // 2. Copy starter template to temp directory.
    const tempDir = await mkdtemp(join(tmpdir(), "starter-npm-proof-"));
    const starterSrc = resolve(repositoryRoot, "distribution/templates/starter");
    const starterDest = join(tempDir, "starter");

    console.log(`Preparing starter template in ${starterDest}...`);
    await copyDir(starterSrc, starterDest);

    // 3. Rewrite the manifest and write it back.
    const starterManifestPath = join(starterDest, "package.json");
    const starterManifest = await readManifest(starterManifestPath);
    const rewritten = rewriteManifestForRegistry(starterManifest, {
      linkedVersion,
      catalog,
      testingCatalog,
    });
    await writeFile(starterManifestPath, `${JSON.stringify(rewritten, null, 2)}\n`);
    console.log("Manifest rewritten for registry consumption.");

    // 4. Run bun install in the temp copy (registry access).
    console.log("Running bun install from npm registry...");
    const install = spawnSync(["bun", "install", "--frozen-lockfile"], {
      cwd: starterDest,
    });
    if (install.exitCode !== 0) {
      const stderr = install.stderr.toString().trim();
      if (isPrePublicationFailure(stderr)) {
        console.error(
          "starter npm-proof: @libre-ai packages not on the registry yet — run after the owner's npm day (WAVE1-PUBLICATION-RUNBOOK step 4).",
        );
        process.exit(1);
      }
      console.error(`bun install failed: ${stderr}`);
      process.exit(1);
    }
    console.log("Registry install OK.");

    // 5. Run unit tests (skip e2e; they need playwright browsers).
    console.log("Running unit tests (test:e2e skipped — requires browsers)...");
    const test = spawnSync(["bun", "test"], {
      cwd: starterDest,
    });
    if (test.exitCode !== 0) {
      console.error(`Tests failed:\n${test.stdout.toString()}`);
      process.exit(1);
    }
    const testOutput = test.stdout.toString();
    console.log(testOutput);

    // 6. Write evidence JSON (only on success).
    const evidenceDir = resolve(repositoryRoot, "distribution/evidence");
    await mkdir(evidenceDir, { recursive: true });
    const evidencePath = join(evidenceDir, `starter-npm-proof-${dateArg}.json`);

    const evidence = {
      date: dateArg,
      linkedVersion,
      installOk: true,
      testsOk: true,
      packages: [
        "@libre-ai/contracts",
        "@libre-ai/web-platform",
        "@libre-ai/ui",
        "@libre-ai/auth-web",
      ],
    };

    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Evidence written to ${evidencePath}`);
    console.log(`PROOF OK: starter consumed from npm registry.`);

    // Cleanup.
    await rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(`Error: ${String(error)}`);
    }
    process.exit(1);
  }
}
