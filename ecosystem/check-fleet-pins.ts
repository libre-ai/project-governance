/**
 * Fleet pin gate (K4 WAVE-A-02 / FINAL-01): enumerate every governance
 * revision a repository lets into its required checks, and fail when one is
 * not a 40-character commit sha, when they do not all agree, when the sha is
 * absent from ecosystem/fleet-pins.v1.yaml, or when it is declared but stale
 * — more than two generations behind the most recent one. Network gate by
 * nature (like inventory-drift); repositories that consume no template are
 * skipped by construction — the gate covers what declares a pin. Every
 * non-archived repository in the inventory is audited, not only
 * satellite/authority: a `reserved-product-home` or `active-application` repo
 * that wires the templates is exactly as exposed to an unpinned tooling
 * checkout as a satellite is, and restricting the scan by role is how eight
 * repositories carrying two different undeclared governance commits went
 * unnoticed through the 2026-08-04 generation (K4 WAVE-A/domain-C fleet
 * convergence, 2026-08-18).
 *
 * Four surfaces let a governance revision in, and all four are read:
 *   - `uses: libre-ai/project-governance/...@<ref>` in ANY workflow file, not only
 *     `ci.yml` — every consumer also pins `reusable-context-hygiene.yml` from
 *     `context-hygiene.yml`;
 *   - `tooling_ref:`, which reusable-licensing.yml checks governance out at to
 *     run its tooling: a mutable value there executes unpinned tooling inside
 *     a required check;
 *   - `github:libre-ai/project-governance#<ref>` in package.json;
 *   - `pinned: "github:libre-ai/project-governance#<ref>"` in the repository's own
 *     project card (`project.v1.yaml` at the repository root for every
 *     non-hub repository, per its `card:` entry in repositories.v1.yaml) —
 *     found only during the 2026-08-18 convergence pass, on a repository
 *     (`orchestrator`) whose card had drifted to a generation none of its CI
 *     surfaces ever carried, and another (`harness`) whose card lagged one
 *     generation behind CI surfaces that were otherwise current. The card is
 *     documentation a human reads to learn what a repository depends on;
 *     a sha there that the CI wiring has moved past is exactly the kind of
 *     drift this gate exists to catch, same as any other surface.
 *
 * Reading one occurrence of one of them (the previous implementation matched a
 * single `uses:` in `ci.yml`) let one correct pin answer for a whole
 * repository: an unpinned `@main` beside it was invisible.
 */

import {
  buildIndex,
  type InventoryEntry,
  isPublicCrossRepositoryTarget,
  PRIVATE_CROSS_REPOSITORY_NOTE,
} from "./build-index";

export interface RepositorySources {
  /** Workflow file name -> file text, for every file under .github/workflows. */
  readonly workflows: ReadonlyMap<string, string>;
  /** package.json text, or null when the repository has none. */
  readonly manifest: string | null;
  /** The repository's project card text (its `card:` path), or null when unreadable/absent. */
  readonly projectCard: string | null;
}

export interface PinSighting {
  /** File the pin is written in, e.g. "ci.yml" or "package.json". */
  readonly source: string;
  /** What is pinned, e.g. "reusable-licensing.yml", "tooling_ref". */
  readonly subject: string;
  /** The ref exactly as written. */
  readonly ref: string;
  /**
   * Repository the pin points at. Absent means the current authority, which is
   * what every surface described before `governance` was retired.
   */
  readonly authority?: string;
}

// A pin is a YAML key, never prose: the templates document their own
// consumption as `#   uses: libre-ai/project-governance/...@<sha>`, and governance is
// itself covered by this gate. Anchoring on the key excludes the comment.
// Both the current authority and the retired one. Matching only the current
// name would have made a pin to `governance` INVISIBLE to this gate instead of
// a failure — a repository pinning a repository that is about to disappear
// would have graded clean. A sighting of the retired authority is reported with
// its own message and always fails.
const CURRENT_AUTHORITY = "project-governance";
const RETIRED_AUTHORITY = "governance";
const USES_LINE =
  /^[ \t]*(?:-[ \t]+)?uses:[ \t]*libre-ai\/(project-governance|governance)\/(\S+?)@(\S+?)[ \t\r]*$/;
// The input declaration in the template carries no value on its line, so only
// a consumer supplying one is sighted.
const TOOLING_REF_LINE = /^[ \t]*tooling_ref:[ \t]*(\S+?)[ \t\r]*$/;
const GIT_DEP = /github:libre-ai\/(project-governance|governance)#([^"'\s,}]+)/g;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

export function collectSightings(sources: RepositorySources): PinSighting[] {
  const sightings: PinSighting[] = [];
  for (const name of [...sources.workflows.keys()].sort()) {
    const text = sources.workflows.get(name) as string;
    for (const line of text.split("\n")) {
      const uses = USES_LINE.exec(line);
      if (uses !== null) {
        const authority = uses[1] as string;
        const path = uses[2] as string;
        const ref = uses[3] as string;
        // Emitted only when it names the retired authority, so that `absent`
        // keeps meaning `current` for every surface written before the move.
        sightings.push(
          authority === RETIRED_AUTHORITY
            ? { source: name, subject: path.split("/").pop() as string, ref, authority }
            : { source: name, subject: path.split("/").pop() as string, ref },
        );
        continue;
      }
      const tooling = TOOLING_REF_LINE.exec(line);
      if (tooling !== null) {
        // The input carries no owner of its own; it belongs to whichever
        // authority the surrounding `uses:` names, so it is attributed to the
        // current one and only the ref is judged.
        sightings.push({ source: name, subject: "tooling_ref", ref: tooling[1] as string });
      }
    }
  }
  if (sources.manifest !== null) {
    for (const match of sources.manifest.matchAll(GIT_DEP)) {
      const authority = match[1] as string;
      const ref = match[2] as string;
      sightings.push(
        authority === RETIRED_AUTHORITY
          ? { source: "package.json", subject: "tooling git-dep", ref, authority }
          : { source: "package.json", subject: "tooling git-dep", ref },
      );
    }
  }
  if (sources.projectCard !== null) {
    for (const match of sources.projectCard.matchAll(GIT_DEP)) {
      const authority = match[1] as string;
      const ref = match[2] as string;
      sightings.push(
        authority === RETIRED_AUTHORITY
          ? { source: "project.v1.yaml", subject: "project card pin", ref, authority }
          : { source: "project.v1.yaml", subject: "project card pin", ref },
      );
    }
  }
  return sightings;
}

export function auditRepository(
  repository: string,
  sources: RepositorySources,
  // Declared generations, oldest first — the order they were added to
  // fleet-pins.v1.yaml. Age is measured against this order, so callers must
  // pass it as declared, not resorted.
  generations: readonly string[],
): string[] {
  const sightings = collectSightings(sources);
  if (sightings.length === 0) return [];

  const declared = new Set(generations);
  const failures: string[] = [];
  const pinned: PinSighting[] = [];

  // A pin on the RETIRED authority fails on its own terms, before the sha is
  // even judged. Its sha may well be a declared generation — `pi-evidence`
  // carried one — so a gate that only compared shas would have graded such a
  // repository clean while it pointed at a repository about to disappear. The
  // retirement of an authority is exactly when this gate has to speak.
  for (const sighting of sightings) {
    if (sighting.authority === RETIRED_AUTHORITY) {
      failures.push(
        `${repository}: ${sighting.source} pins ${sighting.subject} on the retired authority ` +
          `libre-ai/${RETIRED_AUTHORITY} — re-point it at libre-ai/${CURRENT_AUTHORITY}`,
      );
    }
  }

  for (const sighting of sightings) {
    if (COMMIT_SHA.test(sighting.ref)) {
      pinned.push(sighting);
      continue;
    }
    failures.push(
      `${repository}: ${sighting.source} pins ${sighting.subject}@${sighting.ref} — not a 40-character commit sha`,
    );
  }

  // The register's invariant: a repository consumes ONE generation, so every
  // surface must carry the same sha. A half-bumped repository runs two
  // generations of the same authority against one commit.
  const distinct = new Set(pinned.map((sighting) => sighting.ref));
  if (distinct.size > 1) {
    const detail = pinned
      .map((sighting) => `${sighting.source}:${sighting.subject}@${sighting.ref.slice(0, 8)}`)
      .join(", ");
    failures.push(`${repository}: pins disagree — ${detail}`);
  }
  for (const ref of [...distinct].sort()) {
    if (!declared.has(ref)) {
      failures.push(
        `${repository}: pin ${ref.slice(0, 8)} is not a declared generation (fleet-pins.v1.yaml)`,
      );
    }
  }

  // Age: a pin can be declared and still be stale — every surface agreeing on
  // a real generation is not the same claim as being current. Computed only
  // when the repository carries a single, declared ref: disagreement and
  // undeclared refs are already named above, and stacking an age claim on a
  // repository already failing for a sharper reason would blur which failure
  // is the one to fix. Two generations of grace matches the fleet's own
  // adoption cadence (one PR per consumer, run sequentially, not all at
  // once) — a repository not yet reached by an in-flight convergence wave is
  // not the same failure as one nobody is converging.
  if (distinct.size === 1) {
    const ref = [...distinct][0] as string;
    const index = generations.indexOf(ref);
    if (index !== -1) {
      const age = generations.length - 1 - index;
      if (age > 2) {
        failures.push(
          `${repository}: pin ${ref.slice(0, 8)} is ${age} generations behind the latest declared (fleet-pins.v1.yaml) — stale beyond the two-generation grace window`,
        );
      }
    }
  }
  return failures;
}

interface FetchOutcome {
  /** File content, or null when the path does not exist. */
  readonly text: string | null;
  /** Transport error: the state is UNKNOWN, never "no pin here". */
  readonly error: string | null;
}

/** Two retries beyond the first attempt — 1s then 3s — same budget as ecosystem/check-context-conformance.ts's ghWithRetry. */
const RETRY_DELAYS_MS = [1000, 3000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** REST fallback, retried, used only when the GraphQL batch below cannot be answered at all. */
async function ghApi(path: string, raw: boolean): Promise<FetchOutcome> {
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const result = Bun.spawnSync([
      "gh",
      "api",
      path,
      ...(raw ? ["-H", "Accept: application/vnd.github.raw+json"] : []),
    ]);
    if (result.exitCode === 0) {
      return { text: new TextDecoder().decode(result.stdout), error: null };
    }
    const stderr = new TextDecoder().decode(result.stderr).trim();
    // A 404 is an answer — the path does not exist. Anything else (rate
    // limit, 5xx, network) leaves the repository unread, and reading that as
    // "no pin" would turn an outage into a green gate.
    if (stderr.includes("(HTTP 404)")) return { text: null, error: null };
    lastError = stderr === "" ? `gh api ${path} failed` : stderr;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  return { text: null, error: lastError };
}

async function readSourcesViaRest(
  repository: string,
  cardPath: string,
): Promise<RepositorySources | { readonly error: string }> {
  const listing = await ghApi(`repos/${repository}/contents/.github/workflows`, false);
  if (listing.error !== null) {
    return { error: `${repository}: cannot list .github/workflows — ${listing.error}` };
  }
  const entries =
    listing.text === null
      ? []
      : (JSON.parse(listing.text) as { name: string; type: string }[]).filter(
          (entry) => entry.type === "file" && /\.ya?ml$/.test(entry.name),
        );
  const workflows = new Map<string, string>();
  for (const entry of entries) {
    const file = await ghApi(`repos/${repository}/contents/.github/workflows/${entry.name}`, true);
    if (file.error !== null) {
      return { error: `${repository}: cannot read ${entry.name} — ${file.error}` };
    }
    if (file.text !== null) workflows.set(entry.name, file.text);
  }
  const manifest = await ghApi(`repos/${repository}/contents/package.json`, true);
  if (manifest.error !== null) {
    return { error: `${repository}: cannot read package.json — ${manifest.error}` };
  }
  const card = await ghApi(`repos/${repository}/contents/${cardPath}`, true);
  if (card.error !== null) {
    return { error: `${repository}: cannot read ${cardPath} — ${card.error}` };
  }
  return { workflows, manifest: manifest.text, projectCard: card.text };
}

// --- GraphQL primary path: same escape from the shared REST quota as
// ecosystem/check-context-conformance.ts's fetchFleetViaGraphQL — one batch
// request (one Tree + two Blob reads per aliased repository) instead of
// gh api --paginate-style per-file REST calls (a directory listing plus one
// call per workflow file plus two more, times every non-archived repo).

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

export interface FleetPinTarget {
  readonly repository: string;
  readonly card: string;
  /**
   * The inventory declared this card path, rather than it being defaulted.
   * A target with no declared card and no readable surface has nothing to
   * measure, which is not the same as a target whose declared card is missing.
   */
  readonly cardDeclared: boolean;
}

/**
 * One aliased block per target, index-aliased (several repository names
 * contain hyphens, invalid in a GraphQL alias). `.github/workflows` is read
 * as a `Tree` (one request lists and fetches every entry, replacing the
 * REST listing call plus one read per file); `package.json` and the card
 * path are single `Blob` reads, matching every other GraphQL-batched gate
 * in this repository.
 */
export function buildFleetPinsQuery(targets: readonly FleetPinTarget[]): string {
  const blocks = targets.map((target, index) => {
    const separator = target.repository.indexOf("/");
    if (separator < 0) {
      throw new Error(`malformed repository entry, expected "owner/name": ${target.repository}`);
    }
    const owner = JSON.stringify(target.repository.slice(0, separator));
    const name = JSON.stringify(target.repository.slice(separator + 1));
    const cardExpression = JSON.stringify(`HEAD:${target.card}`);
    return [
      `  repo${index}: repository(owner: ${owner}, name: ${name}) {`,
      `    workflowsTree: object(expression: "HEAD:.github/workflows") {`,
      `      ... on Tree { entries { name type object { ... on Blob { text } } } }`,
      `    }`,
      `    manifest: object(expression: "HEAD:package.json") { ... on Blob { text } }`,
      `    card: object(expression: ${cardExpression}) { ... on Blob { text } }`,
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
interface GraphQLFleetPinsRepoNode {
  readonly workflowsTree?: { readonly entries?: readonly (GraphQLTreeEntry | null)[] } | null;
  readonly manifest?: { readonly text?: string | null } | null;
  readonly card?: { readonly text?: string | null } | null;
}

/**
 * `null` distinguishes "this alias's `repository(...)` field itself came
 * back null" (unresolvable — retried, then unable-to-verify) from a
 * structurally-present node with empty/absent sub-objects (a real answer:
 * no workflows directory, no package.json, no card at that path — all
 * legitimate on some repository, exactly as the REST path already treated
 * a 404 as "no pin here", never as an error).
 */
export function parseFleetPinsRepoNode(node: unknown): RepositorySources | null {
  const typed = node as GraphQLFleetPinsRepoNode | null | undefined;
  if (typed === null || typed === undefined) return null;
  const workflows = new Map<string, string>();
  for (const entry of typed.workflowsTree?.entries ?? []) {
    if (entry === null || entry === undefined) continue;
    const entryName = entry.name;
    if (typeof entryName !== "string" || !/\.ya?ml$/.test(entryName)) continue;
    if (entry.type !== undefined && entry.type !== "blob") continue;
    const text = entry.object?.text;
    if (typeof text === "string") workflows.set(entryName, text);
  }
  const manifest = typeof typed.manifest?.text === "string" ? typed.manifest.text : null;
  const projectCard = typeof typed.card?.text === "string" ? typed.card.text : null;
  return { workflows, manifest, projectCard };
}

const GRAPHQL_UNRESOLVED_REPO =
  "repository not resolvable via GraphQL (see check-inventory-drift for real deletions/renames)";

export function parseFleetPinsBatchResponse(
  targets: readonly FleetPinTarget[],
  data: Readonly<Record<string, unknown>> | undefined,
): Map<string, RepositorySources | { readonly error: string }> {
  const result = new Map<string, RepositorySources | { readonly error: string }>();
  targets.forEach((target, index) => {
    const node = data?.[`repo${index}`] ?? null;
    const parsed = parseFleetPinsRepoNode(node);
    result.set(
      target.repository,
      parsed ?? { error: `${target.repository}: ${GRAPHQL_UNRESOLVED_REPO}` },
    );
  });
  return result;
}

/**
 * Pure: does this parsed `gh api graphql` response body carry a usable
 * `data` payload? False for a top-level rejection (`{"data": null,
 * "errors": [...]}` — the documented shape of a rate-limited/quota-exhausted
 * response), a response with no `data` key at all, or a non-object body.
 * Accepting `data: null` as success would hand `null` to
 * parseFleetPinsBatchResponse, which reads it as "every repository
 * unresolved" in one pass with no retry and no REST fallback.
 */
export function hasUsableGraphQLData(
  parsed: unknown,
): parsed is { readonly data: Record<string, unknown> } {
  if (typeof parsed !== "object" || parsed === null) return false;
  const data = (parsed as { readonly data?: unknown }).data;
  return typeof data === "object" && data !== null;
}

/** `null` means the whole batch could not be answered at all — caller falls back to REST, never assumes empty sources. */
async function fetchFleetPinSourcesViaGraphQL(
  targets: readonly FleetPinTarget[],
): Promise<Map<string, RepositorySources | { readonly error: string }> | null> {
  const query = buildFleetPinsQuery(targets);
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { stdout, stderr, exitCode } = await ghGraphQLRaw(query);
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (hasUsableGraphQLData(parsed)) {
        return parseFleetPinsBatchResponse(targets, parsed.data);
      }
    } catch {
      // Not valid JSON — fall through to retry/backoff.
    }
    lastError = stderr.trim() || `gh api graphql failed (exit ${exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  console.error(
    `GraphQL fleet-pins batch fetch failed after ${RETRY_DELAYS_MS.length + 1} attempt(s), falling back to per-repository REST: ${lastError}`,
  );
  return null;
}

async function fetchFleetPinSourcesViaRest(
  targets: readonly FleetPinTarget[],
): Promise<Map<string, RepositorySources | { readonly error: string }>> {
  const result = new Map<string, RepositorySources | { readonly error: string }>();
  for (const target of targets) {
    result.set(target.repository, await readSourcesViaRest(target.repository, target.card));
  }
  return result;
}

async function fetchFleetPinSources(
  targets: readonly FleetPinTarget[],
): Promise<Map<string, RepositorySources | { readonly error: string }>> {
  return (
    (await fetchFleetPinSourcesViaGraphQL(targets)) ?? (await fetchFleetPinSourcesViaRest(targets))
  );
}

export function selectFleetPinTargets(
  repositories: readonly Pick<InventoryEntry, "repository" | "visibility" | "lifecycle" | "card">[],
): FleetPinTarget[] {
  return repositories
    .filter((repo) => repo.lifecycle !== "archived" && isPublicCrossRepositoryTarget(repo))
    .map((repo) => ({
      repository: repo.repository,
      card: repo.card ?? "project.v1.yaml",
      // Whether the INVENTORY declares the card, not whether a default was
      // supplied. `libre-ai/.github` is an org-profile repository with no
      // workflow, no manifest and no card, which is a legitimate state: judging
      // it by the defaulted path reported the fleet's own profile repository as
      // unreadable.
      cardDeclared: repo.card !== undefined,
    }));
}

if (import.meta.main) {
  const register = Bun.YAML.parse(
    await Bun.file(new URL("fleet-pins.v1.yaml", import.meta.url)).text(),
  ) as { readonly generations: ReadonlyArray<{ readonly sha: string }> };
  // Oldest first, as declared — auditRepository measures age against this order.
  const generationShas = register.generations.map((generation) => generation.sha);

  const inventory = buildIndex(
    await Bun.file(new URL("repositories.v1.yaml", import.meta.url)).text(),
  );
  // Every non-archived repository is a target, not only satellite/authority:
  // a reserved-product-home or active-application repo that wires the
  // templates is exactly as exposed to an unpinned tooling checkout as a
  // satellite is. Repositories that declare no pin surface are skipped below
  // by construction (sightings.length === 0), so widening this filter costs
  // nothing on a repository that consumes no template.
  const targets = selectFleetPinTargets(inventory.repositories);

  interface Failure {
    readonly repository: string;
    /** "unable-to-verify" must never render as "DRIFT:" — a rate limit is not a finding. */
    readonly kind: "drift" | "unable-to-verify";
    readonly detail: string;
  }

  const fetched = await fetchFleetPinSources(targets);
  const failures: Failure[] = [];
  const unreadable: string[] = [];
  let covered = 0;
  let inspected = 0;
  for (const target of targets) {
    const sources = fetched.get(target.repository) ?? {
      error: `${target.repository}: no fetch outcome recorded for this repository`,
    };
    if ("error" in sources) {
      failures.push({
        repository: target.repository,
        kind: "unable-to-verify",
        detail: sources.error,
      });
      continue;
    }
    const sightings = collectSightings(sources);
    if (sightings.length === 0) {
      // Zero sightings and nothing readable are not the same answer. A
      // repository the inventory declares a card for, whose card, manifest and
      // workflows all came back empty, was not measured -- it was not read.
      // Counting the two alike is how twenty unreadable destinations hid behind
      // the four that still serve `main`: `covered >= 1`, so the anti-empty rule
      // below never fired and the gate reported a green over a fleet carrying
      // twenty-four drifts.
      if (
        target.cardDeclared &&
        sources.workflows.size === 0 &&
        sources.manifest === null &&
        sources.projectCard === null
      ) {
        unreadable.push(target.repository);
      }
      continue;
    }
    covered += 1;
    inspected += sightings.length;
    for (const detail of auditRepository(target.repository, sources, generationShas)) {
      failures.push({ repository: target.repository, kind: "drift", detail });
    }
  }

  // A gate that examined nothing proves nothing: an inventory that stopped
  // naming consumers, or a token that reads no repository, must be red.
  // Only a real answer (zero sightings on every reachable repository) earns
  // this "drift" framing — if nothing was reachable at all, every target
  // already carries its own unable-to-verify entry above, and this would
  // just restate that as a fake finding.
  if (covered === 0 && failures.every((failure) => failure.kind !== "unable-to-verify")) {
    failures.push({
      repository: "fleet pins",
      kind: "drift",
      detail: `no pinned repository observed across ${targets.length} targets — the gate lost its inputs`,
    });
  }

  // One unreadable target is a finding, whatever the others answered. This is
  // the rule the `covered === 0` form could not express.
  for (const repository of unreadable) {
    failures.push({
      repository,
      kind: "unable-to-verify",
      detail: `${repository}: no workflow, manifest or card could be read on the served branch — nothing here was measured`,
    });
  }

  // Merge adaptation: main migrated this gate's verdict to gate-report
  // (wave 2) while this branch rewrote the enumeration. The enumeration —
  // including its own anti-empty rule above, which feeds `failures` — is the
  // branch's; only the reporting shell is converted, so the two changes
  // compose instead of one overwriting the other.
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const report = new GateReport();
  for (const entry of inventory.repositories.filter((repo) => repo.visibility === "private")) {
    report.check(entry.repository, true, PRIVATE_CROSS_REPOSITORY_NOTE);
  }
  for (const failure of failures) {
    report.check(
      failure.repository,
      false,
      failure.kind === "drift" ? `DRIFT: ${failure.detail}` : `unable to verify: ${failure.detail}`,
    );
  }
  if (failures.length === 0) {
    report.check(
      "fleet template pins",
      true,
      `${inspected} pins across ${covered} repositories match the ${generationShas.length} declared generations`,
    );
  }
  // Said on the success line, not in a note only GATE_VERBOSE expands: a
  // "2 assertion(s) hold" stood for a fleet of twenty-four targets. This was an
  // ad-hoc console.log of its own until `GateReport.volume` generalised it.
  report.volume(
    `${inspected} pin(s) read across ${covered} of ${targets.length} target(s), ` +
      `${unreadable.length} unreadable, against ${generationShas.length} declared generation(s)`,
  );
  concludeGate("Fleet pins", report);
}
