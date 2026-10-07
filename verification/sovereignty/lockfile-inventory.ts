/**
 * SOV-03 dependency-jurisdiction-inventory (sovereignty.v1): parse the two
 * root lockfiles and aggregate every resolved package by distribution
 * registry. This is a v0 heuristic by design — the distribution registry
 * (npm, crates.io: US-operated infrastructure) is NOT the jurisdiction of the
 * code (free licenses, mirrorable): the inventory measures distribution-channel
 * concentration, never legal exposure. The disclaimer is repeated in the
 * generated report so downstream readers cannot over-claim.
 */

export type Ecosystem = "bun" | "cargo";

export type RegistryClass =
  | "npm"
  | "crates-io"
  | "git"
  | "url"
  | "workspace"
  | "path-or-vendored"
  | "registry-other"
  | "unknown";

/** Registries considered "standard" distribution channels for this repo. */
const STANDARD_REGISTRIES: readonly RegistryClass[] = [
  "npm",
  "crates-io",
  "workspace",
  "path-or-vendored",
];

export interface DependencyRecord {
  readonly name: string;
  readonly version: string;
  readonly ecosystem: Ecosystem;
  readonly registry: RegistryClass;
  readonly direct: boolean;
  /** Raw source locator, kept only when it is not a standard registry. */
  readonly source?: string;
}

export interface RegistryCount {
  readonly registry: RegistryClass;
  readonly count: number;
}

export interface EcosystemInventory {
  readonly ecosystem: Ecosystem;
  /** Resolved packages excluding first-party (workspace / path) entries. */
  readonly totalExternal: number;
  /** External packages declared by a workspace manifest (heuristic, see spec). */
  readonly directExternal: number;
  /** Workspace members and path/vendored packages. */
  readonly firstParty: number;
  readonly byRegistry: readonly RegistryCount[];
  readonly nonStandard: readonly DependencyRecord[];
  readonly packages: readonly DependencyRecord[];
}

export interface DependencyInventory {
  readonly bun: EcosystemInventory;
  readonly cargo: EcosystemInventory;
}

/**
 * Bun >= 1.3 text lockfiles are JSON with trailing commas. A char-level scan
 * (not a regex) drops commas that directly precede a closing bracket, because
 * resolution strings may legally contain ",]" or ",}" sequences.
 */
export function stripJsoncTrailingCommas(source: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source.charAt(i);
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      // Lookahead past whitespace: a comma whose next token closes a scope is
      // a JSONC trailing comma and must be dropped for JSON.parse.
      let j = i + 1;
      while (j < source.length && /\s/.test(source.charAt(j))) {
        j += 1;
      }
      const next = source.charAt(j);
      if (next === "}" || next === "]") {
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortRecords(records: DependencyRecord[]): DependencyRecord[] {
  return records.sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
}

function aggregate(ecosystem: Ecosystem, records: DependencyRecord[]): EcosystemInventory {
  const sorted = sortRecords(records);
  const counts = new Map<RegistryClass, number>();
  for (const record of sorted) {
    counts.set(record.registry, (counts.get(record.registry) ?? 0) + 1);
  }
  const byRegistry = [...counts.entries()]
    .map(([registry, count]) => ({ registry, count }))
    .sort((a, b) => a.registry.localeCompare(b.registry));
  const firstPartyClasses: readonly RegistryClass[] = ["workspace", "path-or-vendored"];
  const external = sorted.filter((r) => !firstPartyClasses.includes(r.registry));
  return {
    ecosystem,
    totalExternal: external.length,
    directExternal: external.filter((r) => r.direct).length,
    firstParty: sorted.length - external.length,
    byRegistry,
    nonStandard: sorted.filter((r) => !STANDARD_REGISTRIES.includes(r.registry)),
    packages: sorted,
  };
}

const BUN_WORKSPACE_DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function collectBunDirectNames(workspaces: Record<string, unknown>): ReadonlySet<string> {
  const direct = new Set<string>();
  for (const workspace of Object.values(workspaces)) {
    if (!isRecord(workspace)) {
      continue;
    }
    for (const field of BUN_WORKSPACE_DEPENDENCY_FIELDS) {
      const deps = workspace[field];
      if (!isRecord(deps)) {
        continue;
      }
      for (const [name, spec] of Object.entries(deps)) {
        // workspace: specs point at first-party packages, not external deps.
        if (typeof spec === "string" && !spec.startsWith("workspace:")) {
          direct.add(name);
        }
      }
    }
  }
  return direct;
}

function classifyBunResolution(version: string): RegistryClass {
  if (version.startsWith("workspace:")) {
    return "workspace";
  }
  if (version.startsWith("git+") || version.startsWith("github:")) {
    return "git";
  }
  if (version.startsWith("http://") || version.startsWith("https://")) {
    return "url";
  }
  // Bun writes plain semver for default-registry (npm) resolutions. Anything
  // else stays "unknown" and surfaces in nonStandard instead of being
  // silently absorbed into a reassuring bucket.
  if (/^\d/.test(version)) {
    return "npm";
  }
  return "unknown";
}

export function parseBunLock(text: string): EcosystemInventory {
  const parsed: unknown = JSON.parse(stripJsoncTrailingCommas(text));
  if (!isRecord(parsed)) {
    throw new Error("bun.lock: top-level value is not an object");
  }
  const workspaces = parsed.workspaces;
  const packages = parsed.packages;
  if (!isRecord(workspaces) || !isRecord(packages)) {
    throw new Error("bun.lock: missing workspaces or packages section");
  }
  const directNames = collectBunDirectNames(workspaces);

  const records: DependencyRecord[] = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") {
      throw new Error(`bun.lock: package entry for ${key} has no resolution string`);
    }
    const resolution = entry[0];
    const at = resolution.lastIndexOf("@");
    if (at <= 0) {
      throw new Error(`bun.lock: unparseable resolution ${resolution}`);
    }
    const name = resolution.slice(0, at);
    const version = resolution.slice(at + 1);
    const registry = classifyBunResolution(version);
    const record: DependencyRecord = {
      name,
      version,
      ecosystem: "bun",
      registry,
      direct: registry !== "workspace" && directNames.has(name),
    };
    records.push(STANDARD_REGISTRIES.includes(registry) ? record : { ...record, source: version });
  }
  return aggregate("bun", records);
}

interface CargoPackage {
  readonly name: string;
  readonly version: string;
  readonly source: string | null;
  readonly dependencies: readonly string[];
}

/**
 * Minimal line-based parser for the machine-generated Cargo.lock (version 4).
 * Hand-rolled on purpose: the subset is tiny and stable, and it avoids relying
 * on runtime TOML support that the strict type surface does not declare.
 */
function parseCargoPackages(text: string): CargoPackage[] {
  const packages: CargoPackage[] = [];
  let current: { name?: string; version?: string; source?: string; deps: string[] } | null = null;
  let inDependencies = false;

  const flush = (): void => {
    if (current === null) {
      return;
    }
    if (current.name === undefined || current.version === undefined) {
      throw new Error("Cargo.lock: package block without name/version");
    }
    packages.push({
      name: current.name,
      version: current.version,
      source: current.source ?? null,
      dependencies: current.deps,
    });
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (inDependencies) {
      if (line === "]") {
        inDependencies = false;
        continue;
      }
      const dep = line.match(/^"([^"]+)",?$/);
      if (dep?.[1] !== undefined && current !== null) {
        // Disambiguated entries read "name version": keep the crate name only.
        const [depName] = dep[1].split(" ");
        if (depName !== undefined) {
          current.deps.push(depName);
        }
      }
      continue;
    }
    if (line === "[[package]]") {
      flush();
      current = { deps: [] };
      continue;
    }
    if (current === null) {
      continue;
    }
    const name = line.match(/^name = "(.+)"$/);
    if (name?.[1] !== undefined) {
      current.name = name[1];
      continue;
    }
    const version = line.match(/^version = "(.+)"$/);
    if (version?.[1] !== undefined) {
      current.version = version[1];
      continue;
    }
    const source = line.match(/^source = "(.+)"$/);
    if (source?.[1] !== undefined) {
      current.source = source[1];
      continue;
    }
    if (line === "dependencies = [") {
      inDependencies = true;
    }
  }
  flush();
  return packages;
}

const CRATES_IO_SOURCE = "registry+https://github.com/rust-lang/crates.io-index";

function classifyCargoSource(source: string | null): RegistryClass {
  if (source === null) {
    // Workspace members and vendored patches are both source-less in the
    // lockfile; they are indistinguishable here (documented v0 heuristic).
    return "path-or-vendored";
  }
  if (source === CRATES_IO_SOURCE) {
    return "crates-io";
  }
  if (source.startsWith("registry+")) {
    return "registry-other";
  }
  if (source.startsWith("git+")) {
    return "git";
  }
  return "unknown";
}

export function parseCargoLock(text: string): EcosystemInventory {
  const packages = parseCargoPackages(text);
  // Direct heuristic: everything a source-less (workspace/vendored) package
  // depends on. Cargo.lock does not distinguish manifest-declared deps from
  // transitive ones anywhere else without reading every Cargo.toml.
  const directNames = new Set<string>();
  const firstPartyNames = new Set<string>();
  for (const pkg of packages) {
    if (pkg.source === null) {
      firstPartyNames.add(pkg.name);
      for (const dep of pkg.dependencies) {
        directNames.add(dep);
      }
    }
  }
  const records: DependencyRecord[] = packages.map((pkg) => {
    const registry = classifyCargoSource(pkg.source);
    const record: DependencyRecord = {
      name: pkg.name,
      version: pkg.version,
      ecosystem: "cargo",
      registry,
      direct: !firstPartyNames.has(pkg.name) && directNames.has(pkg.name),
    };
    return STANDARD_REGISTRIES.includes(registry) || pkg.source === null
      ? record
      : { ...record, source: pkg.source };
  });
  return aggregate("cargo", records);
}

export function buildDependencyInventory(
  bunLockText: string,
  cargoLockText: string,
): DependencyInventory {
  return {
    bun: parseBunLock(bunLockText),
    cargo: parseCargoLock(cargoLockText),
  };
}
