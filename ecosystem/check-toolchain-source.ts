/**
 * Toolchain source gate: every `BUN_ARCHIVE_URL` installed by a workflow of
 * the fleet must be the `durableRelease.linuxX64Asset` of the canonical
 * `toolchains/bun.json`, and its `BUN_ARCHIVE_SHA256` the digest that policy
 * declares for the linux-x64 asset.
 *
 * Why here and not in `tools/quality/check-toolchain.ts`: that script resolves
 * the policy through the PINNED governance git-dep
 * (`node_modules/@libre-ai/governance/toolchains/bun.json`), so a repository
 * that has not bumped its pin would compare its stale workflow against an
 * equally stale policy — green while fetching from a dead source. The
 * population a per-repository check covers and the population at risk are
 * disjoint at the moment the source dies. The comparison only means something
 * against the LIVE canonical, which exists in exactly one place: this
 * repository. Same class of invariant, same plumbing and same failure shape as
 * `ecosystem/check-fleet-pins.ts` — one declared fleet value, many observed
 * per-repository copies — so it lives beside it and runs in the same job.
 *
 * What it deliberately also checks: the digest. `sha256sum --check --strict`
 * already runs in every workflow, but it compares the download to the digest
 * declared in the SAME file — a self-referential check that stays green when
 * URL and digest are changed together. Only a comparison to the canonical
 * policy turns "the download matches what this workflow claims" into "this
 * workflow claims what the authority declares".
 */

/**
 * Repositories excluded by name, with the reason. The hub was archived
 * read-only by the owner on 2026-07-30 (ADR-0020, gate-acceptance-log line
 * 3.8): its workflow still carries the pre-migration URL and CANNOT be
 * amended. Sweeping it would make this gate permanently red for a state that
 * no commit can fix. Its history is evidence, not a living source.
 */
export const ARCHIVED_EXCLUSIONS: ReadonlyMap<string, string> = new Map([
  ["libre-ai/libre-ai", "hub archived read-only on 2026-07-30 — workflow no longer amendable"],
]);

export interface DeclaredSource {
  readonly repository: string;
  readonly file: string;
  readonly url: string;
  readonly sha256: string | null;
}

import {
  buildIndex,
  type InventoryEntry,
  isPublicCrossRepositoryTarget,
  PRIVATE_CROSS_REPOSITORY_NOTE,
} from "./build-index";

export interface CanonicalToolchain {
  readonly assetUrl: string;
  readonly assetSha256: string;
}

export interface SourceVerdict {
  readonly asserted: number;
  readonly failures: readonly string[];
}

const URL_LINE = /^\s*BUN_ARCHIVE_URL:\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/;
const SHA_LINE = /^\s*BUN_ARCHIVE_SHA256:\s*(?:"|')?([0-9a-f]{64})(?:"|')?\s*$/;

/**
 * Pair every `BUN_ARCHIVE_URL` of a workflow with the digest of its own env
 * block. A workflow installs the toolchain once per job, so the pairing is
 * positional: each URL takes the digest line that is nearer to it than to any
 * other URL — order-agnostic, and no window constant to tune.
 */
export function extractDeclaredSources(
  repository: string,
  file: string,
  workflow: string,
): DeclaredSource[] {
  const lines = workflow.split("\n");
  const urls: { readonly index: number; readonly value: string }[] = [];
  const digests: { readonly index: number; readonly value: string }[] = [];
  for (const [index, line] of lines.entries()) {
    const url = URL_LINE.exec(line);
    if (url) {
      urls.push({ index, value: url[1] ?? url[2] ?? url[3] ?? "" });
      continue;
    }
    const digest = SHA_LINE.exec(line);
    if (digest?.[1] !== undefined) digests.push({ index, value: digest[1] });
  }
  return urls.map((url, position) => {
    const previous = urls[position - 1]?.index ?? Number.NEGATIVE_INFINITY;
    const next = urls[position + 1]?.index ?? Number.POSITIVE_INFINITY;
    let paired: string | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const digest of digests) {
      if (digest.index <= previous || digest.index >= next) continue;
      const candidate = Math.abs(digest.index - url.index);
      if (candidate < distance) {
        distance = candidate;
        paired = digest.value;
      }
    }
    return { repository, file, url: url.value, sha256: paired };
  });
}

/**
 * Compare observed declarations to the canonical policy. Finding NOTHING is a
 * failure, not a pass: a sweep that matches no declaration proves only that it
 * looked in the wrong place, and a gate that reports success on an empty set
 * is the inert-gate defect this repository has already met twice.
 */
export function verifySources(
  sources: readonly DeclaredSource[],
  canonical: CanonicalToolchain,
): SourceVerdict {
  const failures: string[] = [];
  if (sources.length === 0) {
    failures.push(
      "no BUN_ARCHIVE_URL found anywhere in the swept fleet — the gate compared nothing and would pass silently",
    );
  }
  for (const source of sources) {
    if (source.url !== canonical.assetUrl) {
      failures.push(
        `${source.repository}: ${source.file} installs the Bun toolchain from ${source.url} — canonical source is ${canonical.assetUrl}`,
      );
    }
    if (source.sha256 === null) {
      failures.push(
        `${source.repository}: ${source.file} declares a BUN_ARCHIVE_URL with no BUN_ARCHIVE_SHA256 — the download is unverified`,
      );
    } else if (source.sha256 !== canonical.assetSha256) {
      failures.push(
        `${source.repository}: ${source.file} declares digest ${source.sha256.slice(0, 12)}… — canonical linux-x64 digest is ${canonical.assetSha256.slice(0, 12)}…`,
      );
    }
  }
  return { asserted: sources.length, failures };
}

export interface CanonicalPolicy {
  readonly durableRelease: { readonly url: string; readonly linuxX64Asset: string };
  readonly assets: { readonly "linux-x64": { readonly sha256: string } };
}

/**
 * The oracle is checked before it is trusted: no URL of the canonical durable
 * release may be hosted by a repository this gate excludes as archived, and
 * the asset URL and digest must actually be there. Without this, editing
 * `toolchains/bun.json` back to the archive would turn the whole fleet
 * uniformly green against a dead source.
 */
export function verifyCanonical(policy: CanonicalPolicy): string[] {
  const failures: string[] = [];
  const declared: ReadonlyArray<readonly [string, string]> = [
    ["durableRelease.url", policy.durableRelease?.url ?? ""],
    ["durableRelease.linuxX64Asset", policy.durableRelease?.linuxX64Asset ?? ""],
  ];
  for (const [field, value] of declared) {
    if (value === "") {
      failures.push(`toolchains/bun.json: ${field} is empty — the canonical source is undeclared`);
      continue;
    }
    for (const [repository, reason] of ARCHIVED_EXCLUSIONS) {
      if (!value.includes(`/${repository}/`)) continue;
      failures.push(
        `toolchains/bun.json: ${field} points at ${repository} (${reason}) — the canonical source must be a living repository`,
      );
    }
  }
  if (!/^[0-9a-f]{64}$/.test(policy.assets?.["linux-x64"]?.sha256 ?? "")) {
    failures.push("toolchains/bun.json: assets.linux-x64.sha256 is not a sha256 digest");
  }
  return failures;
}

/** The canonical policy of THIS repository — the only live copy in the fleet. */
export async function readCanonical(): Promise<CanonicalPolicy> {
  return (await Bun.file("toolchains/bun.json").json()) as CanonicalPolicy;
}

export interface WorkflowFile {
  readonly name: string;
  readonly text: string;
}

/**
 * Three-way outcome, not the previous `string[] | null` — collapsing "no
 * .github/workflows directory" (a real, common answer: a private repository
 * or a reserved product home with no CI yet, always treated as skip-by-
 * construction) and "could not verify" (rate limit, other 4xx/5xx, network)
 * into the same `null` meant a rate-limited sweep silently under-inspected
 * the fleet and reported success anyway, unless it happened to fail on
 * every repository (the only case `verifySources`'s empty-set guard could
 * catch). Same 404-is-an-answer contract as every other gate in this file's
 * neighborhood.
 */
export type WorkflowsFetchOutcome =
  | { readonly kind: "found"; readonly files: readonly WorkflowFile[] }
  | { readonly kind: "no-workflows-directory" }
  | { readonly kind: "unable-to-verify"; readonly detail: string };

/** Two retries beyond the first attempt — 1s then 3s — same budget as this file's neighbors. */
const RETRY_DELAYS_MS = [1000, 3000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GhFetchResult {
  readonly text: string | null;
  readonly error: string | null;
}

async function ghWithRetry(args: readonly string[]): Promise<GhFetchResult> {
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode === 0) return { text: stdout, error: null };
    if (stderr.includes("(HTTP 404)")) return { text: null, error: null };
    lastError = stderr.trim() || `gh ${args.join(" ")} failed (exit ${exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  return { text: null, error: lastError };
}

async function fetchWorkflowsViaRest(repository: string): Promise<WorkflowsFetchOutcome> {
  const listing = await ghWithRetry([
    "api",
    `repos/${repository}/contents/.github/workflows`,
    "--jq",
    '.[] | select(.type == "file") | .name',
  ]);
  if (listing.error !== null) return { kind: "unable-to-verify", detail: listing.error };
  if (listing.text === null) return { kind: "no-workflows-directory" };
  const names = listing.text
    .split("\n")
    .map((name) => name.trim())
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
  const files: WorkflowFile[] = [];
  for (const name of names) {
    const file = await ghWithRetry([
      "api",
      `repos/${repository}/contents/.github/workflows/${name}`,
      "-H",
      "Accept: application/vnd.github.raw+json",
    ]);
    if (file.error !== null) return { kind: "unable-to-verify", detail: file.error };
    if (file.text !== null) files.push({ name, text: file.text });
  }
  return { kind: "found", files };
}

// --- GraphQL primary path: same escape from the shared REST quota as
// ecosystem/check-fleet-pins.ts — one Tree read per aliased repository
// instead of a directory listing plus one REST call per workflow file.

async function ghGraphQLRaw(
  query: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["gh", "api", "graphql", "-F", "query=@-"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(query);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export function buildWorkflowsTreeQuery(repositories: readonly string[]): string {
  const blocks = repositories.map((repository, index) => {
    const separator = repository.indexOf("/");
    if (separator < 0) {
      throw new Error(`malformed repository entry, expected "owner/name": ${repository}`);
    }
    const owner = JSON.stringify(repository.slice(0, separator));
    const name = JSON.stringify(repository.slice(separator + 1));
    return [
      `  repo${index}: repository(owner: ${owner}, name: ${name}) {`,
      `    workflowsTree: object(expression: "main:.github/workflows") {`,
      `      ... on Tree { entries { name type object { ... on Blob { text } } } }`,
      `    }`,
      `  }`,
    ].join("\n");
  });
  return `query {\n${blocks.join("\n")}\n}`;
}

interface GraphQLTreeEntry {
  readonly name?: string;
  readonly type?: string;
  readonly object?: { readonly text?: string | null } | null;
}
interface GraphQLWorkflowsRepoNode {
  readonly workflowsTree?: { readonly entries?: readonly (GraphQLTreeEntry | null)[] } | null;
}

/**
 * `undefined`/`null` node (the alias's `repository(...)` field itself came
 * back null) is unable-to-verify — a real NOT_FOUND, a permissions issue or
 * a rename, structurally indistinguishable here. A structurally-present
 * node with `workflowsTree: null` is the real, common "no .github/workflows
 * directory" answer.
 */
export function parseWorkflowsTreeNode(node: unknown): WorkflowsFetchOutcome {
  const typed = node as GraphQLWorkflowsRepoNode | null | undefined;
  if (typed === null || typed === undefined) {
    return {
      kind: "unable-to-verify",
      detail:
        "repository not resolvable via GraphQL (see check-inventory-drift for real deletions/renames)",
    };
  }
  if (typed.workflowsTree === null || typed.workflowsTree === undefined) {
    return { kind: "no-workflows-directory" };
  }
  const files: WorkflowFile[] = [];
  for (const entry of typed.workflowsTree.entries ?? []) {
    if (entry === null || entry === undefined) continue;
    const entryName = entry.name;
    if (typeof entryName !== "string" || !/\.ya?ml$/.test(entryName)) continue;
    if (entry.type !== undefined && entry.type !== "blob") continue;
    const text = entry.object?.text;
    if (typeof text === "string") files.push({ name: entryName, text });
  }
  return { kind: "found", files };
}

export function parseWorkflowsTreeBatchResponse(
  repositories: readonly string[],
  data: Readonly<Record<string, unknown>> | undefined,
): Map<string, WorkflowsFetchOutcome> {
  const result = new Map<string, WorkflowsFetchOutcome>();
  repositories.forEach((repository, index) => {
    result.set(repository, parseWorkflowsTreeNode(data?.[`repo${index}`] ?? null));
  });
  return result;
}

/**
 * Pure: does this parsed `gh api graphql` response body carry a usable
 * `data` payload? False for a top-level rejection (`{"data": null,
 * "errors": [...]}` — the documented shape of a rate-limited/quota-exhausted
 * response), a response with no `data` key at all, or a non-object body.
 * Accepting `data: null` as success would hand `null` to
 * parseWorkflowsTreeBatchResponse, which reads it as "every repository
 * unresolved" in one pass with no retry and no REST fallback.
 */
export function hasUsableGraphQLData(
  parsed: unknown,
): parsed is { readonly data: Record<string, unknown> } {
  if (typeof parsed !== "object" || parsed === null) return false;
  const data = (parsed as { readonly data?: unknown }).data;
  return typeof data === "object" && data !== null;
}

async function fetchWorkflowsViaGraphQL(
  repositories: readonly string[],
): Promise<Map<string, WorkflowsFetchOutcome> | null> {
  const query = buildWorkflowsTreeQuery(repositories);
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { stdout, stderr, exitCode } = await ghGraphQLRaw(query);
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (hasUsableGraphQLData(parsed)) {
        return parseWorkflowsTreeBatchResponse(repositories, parsed.data);
      }
    } catch {
      // Not valid JSON — fall through to retry/backoff.
    }
    lastError = stderr.trim() || `gh api graphql failed (exit ${exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  console.error(
    `GraphQL toolchain-source batch fetch failed after ${RETRY_DELAYS_MS.length + 1} attempt(s), falling back to per-repository REST: ${lastError}`,
  );
  return null;
}

async function fetchWorkflowsForFleet(
  repositories: readonly string[],
): Promise<Map<string, WorkflowsFetchOutcome>> {
  const viaGraphQL = await fetchWorkflowsViaGraphQL(repositories);
  if (viaGraphQL !== null) return viaGraphQL;
  const result = new Map<string, WorkflowsFetchOutcome>();
  for (const repository of repositories) {
    result.set(repository, await fetchWorkflowsViaRest(repository));
  }
  return result;
}

export function selectToolchainTargets(
  repositories: readonly Pick<InventoryEntry, "repository" | "visibility">[],
): string[] {
  return repositories
    .filter(isPublicCrossRepositoryTarget)
    .map((entry) => entry.repository)
    .filter((repository) => !ARCHIVED_EXCLUSIONS.has(repository));
}

if (import.meta.main) {
  const policy = await readCanonical();
  const canonicalFailures = verifyCanonical(policy);
  if (canonicalFailures.length > 0) {
    for (const failure of canonicalFailures) console.error(`DRIFT: ${failure}`);
    console.error("The canonical toolchain policy is not a usable oracle.");
    process.exit(1);
  }
  const canonical: CanonicalToolchain = {
    assetUrl: policy.durableRelease.linuxX64Asset,
    assetSha256: policy.assets["linux-x64"].sha256,
  };

  const inventory = buildIndex(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const targets = selectToolchainTargets(inventory.repositories);
  const privateRepositories = inventory.repositories.filter(
    (entry) => entry.visibility === "private",
  );
  for (const entry of privateRepositories) {
    console.log(`${entry.repository}: ${PRIVATE_CROSS_REPOSITORY_NOTE}`);
  }
  const fetched = await fetchWorkflowsForFleet(targets);

  const sources: DeclaredSource[] = [];
  const unableToVerify: string[] = [];
  let inspected = 0;
  let unreadable = 0;
  for (const repository of targets) {
    const outcome = fetched.get(repository) ?? {
      kind: "unable-to-verify" as const,
      detail: "no fetch outcome recorded for this repository",
    };
    if (outcome.kind === "unable-to-verify") {
      unableToVerify.push(`${repository}: unable to verify .github/workflows — ${outcome.detail}`);
      continue;
    }
    // No workflow directory readable: private repository or a reserved
    // product home with no CI yet. Skipped by construction, like the fleet-pin
    // gate — the sweep covers what declares a toolchain source.
    if (outcome.kind === "no-workflows-directory") {
      unreadable += 1;
      continue;
    }
    inspected += 1;
    for (const file of outcome.files) {
      sources.push(
        ...extractDeclaredSources(repository, `.github/workflows/${file.name}`, file.text),
      );
    }
  }

  // Same guard as ecosystem/check-fleet-pins.ts: an empty `sources` set
  // caused by real unable-to-verify failures already has an honest
  // explanation above — restating it as "the gate compared nothing" would
  // launder a rate limit into a doctrine-shaped finding.
  const verdict =
    sources.length === 0 && unableToVerify.length > 0
      ? { asserted: 0, failures: [] as string[] }
      : verifySources(sources, canonical);
  const excluded = [...ARCHIVED_EXCLUSIONS]
    .map(([repository, reason]) => `${repository} (${reason})`)
    .join(", ");
  if (verdict.failures.length > 0 || unableToVerify.length > 0) {
    for (const failure of verdict.failures) console.error(`DRIFT: ${failure}`);
    for (const failure of unableToVerify) console.error(`UNABLE TO VERIFY: ${failure}`);
    console.error(
      `The fleet installs its Bun toolchain from a source the canonical policy does not declare (${inspected} repositories inspected, ${verdict.asserted} declarations found, ${unableToVerify.length} unable to verify).`,
    );
    process.exit(1);
  }
  console.log(
    `Toolchain source verified: ${verdict.asserted} workflow declarations across ${inspected} repositories match toolchains/bun.json (${unreadable} without a readable workflow directory; excluded: ${excluded})`,
  );
}
