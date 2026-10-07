/**
 * Machine-readable repository index generator (positioning L2).
 *
 * repositories.v1.yaml is the single source of the public topology (ADR-0009
 * §7), but YAML with prose comments is hostile to machine consumers (org
 * profile projection, website, drift tooling). This script derives a
 * deterministic JSON index from it: same facts, stable field order, entries
 * sorted by repository name, no execution timestamp — so the committed file
 * only changes when the inventory changes, and a CI regeneration diff is a
 * meaningful drift signal, never noise.
 *
 * Field names stay snake_case to mirror the source YAML keys byte-for-byte:
 * a consumer can trace every index field back to the inventory without a
 * mapping table.
 *
 * Usage: bun ecosystem/build-index.ts
 * Writes: distribution/index/repositories.v1.json
 */

export const INDEX_SCHEMA_VERSION = "libre-ai.repository-index.v2";
export const INVENTORY_SOURCE = "ecosystem/repositories.v1.yaml";
export const PRIVATE_CROSS_REPOSITORY_NOTE =
  "private repository — content gates run in-repository; no cross-repository read token granted";

export type Visibility = "public" | "private";

export const ROLES = [
  "active-application",
  "administrative-private",
  "authority",
  "hub",
  "org-profile",
  "reserved-application-home",
  "reserved-product-home",
  "satellite",
  "standalone-tool",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Closed enum (Domain A re-ratification, 2026-08-18, ADR-0023): a repository
 * is either responsible for its own perimeter now, or archived. There is no
 * third state and no wave token — general activation (ADR-0020 D1) retired
 * the wave mechanism as doctrine on 2026-07-28; this type makes it
 * structurally impossible for a free-form status (a `frozen-until-wave-N`
 * value, or any other one-off string) to re-enter the inventory silently.
 */
export type Lifecycle = "active" | "archived";

export interface InventoryEntry {
  repository: string;
  name: string;
  layer: string;
  role: Role;
  visibility: Visibility;
  lifecycle: Lifecycle;
  card?: string;
  canonical_paths?: string[];
}

export function isPublicCrossRepositoryTarget(entry: Pick<InventoryEntry, "visibility">): boolean {
  return entry.visibility === "public";
}

export interface RepositoryIndex {
  schema_version: typeof INDEX_SCHEMA_VERSION;
  source: typeof INVENTORY_SOURCE;
  source_schema_version: string;
  source_updated_on: string;
  repositories: InventoryEntry[];
}

// @types/bun for the pinned toolchain does not declare Bun.YAML yet; the same
// narrowing cast is already used by tools/quality/check-contracts.ts.
const yamlApi = (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML;

function fail(path: string, expected: string, actual: unknown): never {
  throw new Error(`${INVENTORY_SOURCE}: ${path}: expected ${expected}, got ${typeof actual}`);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "a mapping", value);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(path, "a non-empty string", value);
  }
  return value;
}

function asStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    fail(path, "a sequence of strings", value);
  }
  return value.map((item, i) => asString(item, `${path}[${i}]`));
}

function asVisibility(value: unknown, path: string): Visibility {
  const text = asString(value, path);
  if (text !== "public" && text !== "private") {
    fail(path, '"public" or "private"', value);
  }
  return text;
}

function asRole(value: unknown, path: string): Role {
  const text = asString(value, path);
  if (!(ROLES as readonly string[]).includes(text)) {
    fail(path, "one of the closed roles", value);
  }
  return text as Role;
}

function asLifecycle(value: unknown, path: string): Lifecycle {
  const text = asString(value, path);
  if (text !== "active" && text !== "archived") {
    fail(path, '"active" or "archived"', value);
  }
  return text;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  return record[key] === undefined ? undefined : asString(record[key], `${path}.${key}`);
}

/**
 * The public display name of an entry: the product or application it hosts
 * when it hosts one, otherwise the bare repository name (hub, org profile,
 * standalone tooling).
 */
function publicName(record: Record<string, unknown>, repository: string, path: string): string {
  const product = optionalString(record, "product", path);
  if (product !== undefined) return product;
  const application = optionalString(record, "application", path);
  if (application !== undefined) return application;
  const bare = repository.split("/").at(-1);
  if (bare === undefined || bare.length === 0) {
    fail(`${path}.repository`, "an owner/name repository slug", repository);
  }
  return bare;
}

function toEntry(value: unknown, index: number): InventoryEntry {
  const path = `repositories[${index}]`;
  const record = asRecord(value, path);
  const repository = asString(record.repository, `${path}.repository`);
  const entry: InventoryEntry = {
    repository,
    name: publicName(record, repository, path),
    layer: asString(record.layer, `${path}.layer`),
    role: asRole(record.role, `${path}.role`),
    visibility: asVisibility(record.visibility, `${path}.visibility`),
    lifecycle: asLifecycle(record.lifecycle, `${path}.lifecycle`),
  };
  const card = optionalString(record, "card", path);
  if (card !== undefined) entry.card = card;
  if (record.canonical_paths !== undefined) {
    entry.canonical_paths = asStringArray(record.canonical_paths, `${path}.canonical_paths`);
  }
  if (entry.visibility === "private") {
    const exactPrivateShape =
      entry.repository === "libre-ai/product-research" &&
      entry.role === "administrative-private" &&
      entry.layer === "transverse" &&
      entry.lifecycle === "active" &&
      entry.card === undefined;
    if (!exactPrivateShape) {
      fail(path, "the exact private administrative repository shape", record);
    }
  } else if (entry.role === "administrative-private") {
    fail(path, 'visibility "private" for role "administrative-private"', entry.visibility);
  }
  return entry;
}

export function buildIndex(yamlText: string): RepositoryIndex {
  const document = asRecord(yamlApi.parse(yamlText), "document");
  const rawEntries = document.repositories;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    fail("repositories", "a non-empty sequence", rawEntries);
  }
  const repositories = rawEntries.map(toEntry);

  const seen = new Set<string>();
  for (const entry of repositories) {
    if (seen.has(entry.repository)) {
      throw new Error(`${INVENTORY_SOURCE}: duplicate repository entry ${entry.repository}`);
    }
    seen.add(entry.repository);
  }

  // Code-unit comparison, not localeCompare: the sort must be identical on
  // every machine and locale for the committed index to be reproducible.
  repositories.sort((a, b) => {
    if (a.repository < b.repository) return -1;
    if (a.repository > b.repository) return 1;
    return 0;
  });

  return {
    schema_version: INDEX_SCHEMA_VERSION,
    source: INVENTORY_SOURCE,
    source_schema_version: asString(document.schema_version, "schema_version"),
    source_updated_on: asString(document.updated_on, "updated_on"),
    repositories,
  };
}

export function renderIndex(index: RepositoryIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

if (import.meta.main) {
  const sourceUrl = new URL("repositories.v1.yaml", import.meta.url);
  const targetUrl = new URL("../distribution/index/repositories.v1.json", import.meta.url);
  const index = buildIndex(await Bun.file(sourceUrl).text());
  await Bun.write(targetUrl, renderIndex(index));
  console.log(
    `wrote distribution/index/repositories.v1.json (${index.repositories.length} repositories)`,
  );
}
