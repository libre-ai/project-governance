/**
 * Linked version bump for the wave-1 satellites.
 *
 * One shared version across the publish set (`SATELLITE_DIRECTORIES`), bumped
 * together: `bun tools/release/bump-version.ts patch|minor|major|<semver>`.
 * A drifted set (unequal versions) refuses the bump — fix the drift first.
 * Planning is pure (unit-tested); only the CLI writes manifests.
 *
 * Manual by design (owner decision 2026-08-18): run this the day of an npm
 * publish, right before `publish-preflight.ts` and `bun publish` — a version
 * bump is a deliberate release decision, never a scheduled or CI-triggered
 * mutation of a manifest.
 */
import { resolve } from "node:path";
import { SATELLITE_DIRECTORIES } from "./publish-preflight";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function computeNextVersion(current: string, bump: string): string {
  const parsed = SEMVER.exec(current);
  if (parsed === null) throw new Error(`current version is not x.y.z semver: ${current}`);
  const major = Number(parsed[1]);
  const minor = Number(parsed[2]);
  const patch = Number(parsed[3]);
  switch (bump) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default: {
      if (!SEMVER.test(bump)) throw new Error(`bump must be patch|minor|major|x.y.z, got: ${bump}`);
      return bump;
    }
  }
}

export interface ManifestRef {
  readonly path: string;
  readonly name: string;
  readonly version: string;
}

export interface LinkedBumpPlan {
  readonly nextVersion: string;
  readonly updates: readonly { path: string; name: string; nextVersion: string }[];
}

export function planLinkedBump(manifests: readonly ManifestRef[], bump: string): LinkedBumpPlan {
  const reference = manifests[0]?.version;
  if (reference === undefined) throw new Error("no manifests to bump");
  const drifted = manifests.filter((manifest) => manifest.version !== reference);
  if (drifted.length > 0) {
    const detail = drifted.map((m) => `${m.name}@${m.version}`).join(", ");
    throw new Error(`linked-version drift (expected ${reference}): ${detail}`);
  }
  const nextVersion = computeNextVersion(reference, bump);
  return {
    nextVersion,
    updates: manifests.map((manifest) => ({
      path: manifest.path,
      name: manifest.name,
      nextVersion,
    })),
  };
}

if (import.meta.main) {
  const bump = process.argv[2];
  if (bump === undefined) {
    console.error("usage: bun tools/release/bump-version.ts patch|minor|major|<x.y.z>");
    process.exit(1);
  }
  const repositoryRoot = resolve(import.meta.dir, "../..");
  const manifests: ManifestRef[] = [];
  for (const directory of SATELLITE_DIRECTORIES) {
    const path = resolve(repositoryRoot, directory, "package.json");
    const parsed = (await Bun.file(path).json()) as { name: string; version: string };
    manifests.push({ path, name: parsed.name, version: parsed.version });
  }
  const plan = planLinkedBump(manifests, bump);
  for (const update of plan.updates) {
    const manifest = (await Bun.file(update.path).json()) as Record<string, unknown>;
    manifest.version = update.nextVersion;
    await Bun.write(update.path, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`${update.name} -> ${update.nextVersion}`);
  }
  console.log(
    `Linked set bumped to ${plan.nextVersion}. Re-run bun install to refresh the lockfile, ` +
      `then bun run lint to reformat the rewritten manifests before committing.`,
  );
}
