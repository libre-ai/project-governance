import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";

export interface Relationship {
  type: string;
  target: string;
  status: "proposed" | "accepted" | "rejected" | "superseded";
}

export interface KnowledgeObject {
  schemaVersion: "libre-ai.knowledge-object.v1";
  kind: string;
  id: string;
  name: string;
  purpose: string;
  version?: string;
  status: "draft" | "reviewed" | "accepted" | "deprecated" | "archived" | "untrusted";
  trust: "external" | "observed" | "reviewed" | "normative";
  authority: { path: string; owners: string[] };
  relationships?: Relationship[];
  provenance: {
    authors: string[];
    createdAt: string;
    reviewedAt?: string;
    legacyRepository?: string;
    legacyRevision?: string;
  };
  validFrom?: string;
  validUntil?: string;
  supersedes?: string;
}

export interface KnowledgeProjection {
  schemaVersion: "libre-ai.knowledge-projection.v1";
  sourceSchemaVersion: "libre-ai.knowledge-object.v1";
  selectionDigest: string;
  objects: KnowledgeObject[];
}

export class KnowledgeProjectionError extends Error {
  constructor(
    readonly code:
      | "knowledge.projection_invalid"
      | "knowledge.projection_digest_mismatch"
      | "knowledge.projection_duplicate_id"
      | "knowledge.projection_unresolved_relationship",
    readonly issues: Array<{ instancePath: string; schemaPath: string; keyword: string }> = [],
  ) {
    super(code);
    this.name = "KnowledgeProjectionError";
  }
}

function safeIssues(errors: ErrorObject[] | null | undefined): KnowledgeProjectionError["issues"] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath || "/",
    schemaPath: error.schemaPath,
    keyword: error.keyword,
  }));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}

export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(sortJson(value));
  if (encoded === undefined) throw new TypeError("Value is not JSON serializable");
  return encoded;
}

function sha256(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export class KnowledgeIndex {
  readonly #objects: ReadonlyMap<string, KnowledgeObject>;

  constructor(objects: KnowledgeObject[]) {
    const indexed = new Map<string, KnowledgeObject>();
    for (const object of objects) {
      if (indexed.has(object.id)) {
        throw new KnowledgeProjectionError("knowledge.projection_duplicate_id");
      }
      indexed.set(object.id, object);
    }
    for (const object of objects) {
      if (object.supersedes && !indexed.has(object.supersedes)) {
        throw new KnowledgeProjectionError("knowledge.projection_unresolved_relationship");
      }
      for (const relationship of object.relationships ?? []) {
        if (!indexed.has(relationship.target)) {
          throw new KnowledgeProjectionError("knowledge.projection_unresolved_relationship");
        }
      }
    }
    this.#objects = indexed;
  }

  get(id: string): KnowledgeObject | undefined {
    return this.#objects.get(id);
  }

  all(): KnowledgeObject[] {
    return [...this.#objects.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  related(id: string, relationshipType?: string): KnowledgeObject[] {
    const object = this.#objects.get(id);
    if (!object) return [];
    return (object.relationships ?? [])
      .filter((relationship) => !relationshipType || relationship.type === relationshipType)
      .map((relationship) => this.#objects.get(relationship.target))
      .filter((target): target is KnowledgeObject => target !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}

export async function loadKnowledgeProjection(
  projectionPath: string,
  schemaDirectory: string,
): Promise<{ projection: KnowledgeProjection; index: KnowledgeIndex }> {
  const [objectSchema, projectionSchema, projection] = await Promise.all([
    Bun.file(resolve(schemaDirectory, "knowledge-object.schema.json")).json(),
    Bun.file(resolve(schemaDirectory, "knowledge-projection.schema.json")).json(),
    Bun.file(projectionPath).json(),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(objectSchema);
  const validate = ajv.compile(projectionSchema);
  if (!validate(projection)) {
    throw new KnowledgeProjectionError("knowledge.projection_invalid", safeIssues(validate.errors));
  }

  const typed = projection as KnowledgeProjection;
  const digest = sha256(canonicalJson(typed.objects));
  if (digest !== typed.selectionDigest) {
    throw new KnowledgeProjectionError("knowledge.projection_digest_mismatch");
  }
  const frozen = deepFreeze(typed);
  return { projection: frozen, index: new KnowledgeIndex(frozen.objects) };
}

/**
 * Root of the authority carrying the canonical schemas and projections — this
 * repository. It used to be a pinned `@libre-ai/governance` git-dep because
 * this reader lived in its own repository; that dependency is now the tree it
 * runs in.
 *
 * Why a TypeScript reader at all, next to the Rust engine that produces the
 * projection: the digest is then computed TWICE, by two independent
 * implementations in two languages, and `check:projection:digest` fails if they
 * disagree. The Rust `--check` proves the bytes reproduce from the objects; this
 * proves the committed `selectionDigest` is the digest of those same bytes under
 * a canonicalisation written by someone else.
 */
export function canonicalRepositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function loadCanonicalKnowledgeProjection(repositoryRoot = canonicalRepositoryRoot()) {
  return loadKnowledgeProjection(
    resolve(repositoryRoot, "ecosystem/projections/public.v1.json"),
    resolve(repositoryRoot, "ecosystem/schemas"),
  );
}
