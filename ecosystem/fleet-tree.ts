/**
 * Read a repository's tracked tree and the text of chosen files at its served
 * branch — the two reads the fleet file gates (`check-release-age`,
 * `check-action-pins`) share.
 *
 * Both reads name `HEAD`, never a branch: the fleet serves
 * `migrate/recover-code`, whose `main` is a documentary ancestor, and a gate
 * that read `main:` measured an empty tree and reported it green
 * (docs: `check-fleet-pins.ts`, 2026-10-07).
 *
 * Every outcome keeps "I could not read" apart from "there is nothing": a
 * truncated tree, an unparsable response or a blob GitHub declines to render
 * is `unreadable`, and the gates turn `unreadable` into a failure. A gate that
 * counted an unreadable repository as "no bunfig.toml" would report a green
 * over a repository it never saw.
 */

import { PRIVATE_CROSS_REPOSITORY_NOTE } from "./build-index";
import { ghWithRetry, type RegistryEntry } from "./check-context-conformance";
import { delay, ghGraphQLRaw, hasUsableGraphQLData, RETRY_DELAYS_MS } from "./github-fleet";

/**
 * Why an inventory entry is not read, or `null` when it is. Exemptions are
 * returned as a note so the gates count and print them — an exempt entry is
 * never silently skipped. A private repository is exempt for the reason every
 * cross-repository gate states: the CI token cannot read it, so its own
 * in-repository gates carry the rule. An archived one refuses every write, so
 * no finding there could be corrected.
 */
export function exemption(entry: RegistryEntry): string | null {
  if (entry.visibility === "private") return PRIVATE_CROSS_REPOSITORY_NOTE;
  if (entry.lifecycle === "archived") {
    return "archived — content frozen read-only, no finding could be corrected";
  }
  return null;
}

export type TreeListing =
  | { readonly kind: "listed"; readonly paths: readonly string[] }
  | { readonly kind: "unreadable"; readonly reason: string };

interface GitTreeResponse {
  readonly truncated?: boolean;
  readonly tree?: readonly { readonly path?: string; readonly type?: string }[];
}

/**
 * The recursive git-trees response, reduced to its blob paths. A listing that
 * does not say it is complete (`truncated !== false`) is unreadable: the gates
 * built on it claim "every tracked file was examined", and a partial listing
 * cannot support that claim.
 */
export function parseTreePaths(text: string): TreeListing {
  let parsed: GitTreeResponse;
  try {
    parsed = JSON.parse(text) as GitTreeResponse;
  } catch {
    return { kind: "unreadable", reason: "git tree response is not JSON" };
  }
  if (!Array.isArray(parsed.tree)) {
    return { kind: "unreadable", reason: "git tree response carries no `tree` array" };
  }
  if (parsed.truncated !== false) {
    return {
      kind: "unreadable",
      reason: "git tree listing is truncated or does not say it is complete",
    };
  }
  const paths = parsed.tree
    .filter((node) => node.type === "blob" && typeof node.path === "string")
    .map((node) => node.path as string);
  return { kind: "listed", paths };
}

/** The recursive tree of the served branch, through one REST request. */
export async function listTrackedPaths(repository: string): Promise<TreeListing> {
  const result = await ghWithRetry(["api", `repos/${repository}/git/trees/HEAD?recursive=1`]);
  if (result.error !== null) return { kind: "unreadable", reason: result.error };
  if (result.text === null) return { kind: "unreadable", reason: "served-branch tree not found" };
  return parseTreePaths(result.text);
}

export type BlobRead =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "unreadable"; readonly reason: string };

/** Paths per GraphQL request: bounded so one response never approaches the API's size limits. */
export const BLOB_BATCH_SIZE = 50;

function blobAlias(index: number): string {
  return `f${index}`;
}

/**
 * One aliased `object(expression: "HEAD:<path>")` per path. Aliases are by
 * index: GraphQL alias syntax refuses the dots and slashes a path carries.
 */
export function buildBlobQuery(repository: string, paths: readonly string[]): string {
  const separator = repository.indexOf("/");
  if (separator < 0) {
    throw new Error(`malformed repository entry, expected "owner/name": ${repository}`);
  }
  const owner = JSON.stringify(repository.slice(0, separator));
  const name = JSON.stringify(repository.slice(separator + 1));
  const fields = paths.map(
    (path, index) =>
      `    ${blobAlias(index)}: object(expression: ${JSON.stringify(`HEAD:${path}`)}) { ... on Blob { text isBinary isTruncated } }`,
  );
  return `query {\n  repository(owner: ${owner}, name: ${name}) {\n${fields.join("\n")}\n  }\n}`;
}

interface GraphQLBlob {
  readonly text?: string | null;
  readonly isBinary?: boolean | null;
  readonly isTruncated?: boolean | null;
}

/**
 * Every path was listed by the tree, so a `null` object is not an absence: the
 * branch moved between the two reads, or the path is not a blob. Either way the
 * file was not read, and the result says so.
 */
export function parseBlobResponse(
  paths: readonly string[],
  data: Readonly<Record<string, unknown>>,
): Map<string, BlobRead> {
  const result = new Map<string, BlobRead>();
  const repository = data.repository as Record<string, unknown> | null | undefined;
  for (const [index, path] of paths.entries()) {
    if (repository === null || repository === undefined) {
      result.set(path, { kind: "unreadable", reason: "repository not resolvable via GraphQL" });
      continue;
    }
    const blob = repository[blobAlias(index)] as GraphQLBlob | null | undefined;
    if (blob === null || blob === undefined) {
      result.set(path, {
        kind: "unreadable",
        reason: "listed in the tree but HEAD:<path> resolved to no blob",
      });
    } else if (blob.isBinary === true) {
      result.set(path, { kind: "unreadable", reason: "GitHub reports the blob as binary" });
    } else if (blob.isTruncated === true || typeof blob.text !== "string") {
      result.set(path, {
        kind: "unreadable",
        reason: "GitHub returned a truncated or absent text",
      });
    } else {
      result.set(path, { kind: "text", text: blob.text });
    }
  }
  return result;
}

async function readBatch(
  repository: string,
  paths: readonly string[],
): Promise<Map<string, BlobRead>> {
  const query = buildBlobQuery(repository, paths);
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { stdout, stderr, exitCode } = await ghGraphQLRaw(query);
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (hasUsableGraphQLData(parsed)) return parseBlobResponse(paths, parsed.data);
    } catch {
      // Not JSON — retried below.
    }
    lastError = stderr.trim() || `gh api graphql failed (exit ${exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  return new Map(paths.map((path) => [path, { kind: "unreadable", reason: lastError }]));
}

/** The text of each path at the served branch; every path gets an outcome. */
export async function readBlobsAtHead(
  repository: string,
  paths: readonly string[],
): Promise<Map<string, BlobRead>> {
  const result = new Map<string, BlobRead>();
  for (let start = 0; start < paths.length; start += BLOB_BATCH_SIZE) {
    const batch = paths.slice(start, start + BLOB_BATCH_SIZE);
    for (const [path, read] of await readBatch(repository, batch)) result.set(path, read);
  }
  return result;
}

/** What a fleet file gate needs from one repository: its tracked paths and the chosen files. */
export interface RepositoryFiles {
  readonly listing: TreeListing;
  readonly files: ReadonlyMap<string, BlobRead>;
}

export type FileSelector = (path: string) => boolean;

export type FleetFileReader = (
  repository: string,
  select: FileSelector,
) => Promise<RepositoryFiles>;

/** Tree first, then the selected blobs; an unreadable tree reads no blob. */
export const readRepositoryFiles: FleetFileReader = async (repository, select) => {
  const listing = await listTrackedPaths(repository);
  if (listing.kind === "unreadable") return { listing, files: new Map() };
  const files = await readBlobsAtHead(repository, listing.paths.filter(select));
  return { listing, files };
};
