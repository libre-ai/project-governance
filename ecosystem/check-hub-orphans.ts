/**
 * Hub orphan gate (γ 3.7, design §3.6/§7.2 — « rien n'est perdu »).
 *
 * Every path still tracked in the hub archive must be accounted for:
 * covered by a migration-index entry (prefix or exact), listed in a
 * replacements entry, recorded in the forgetting register, or named in the
 * ARCHIVE_RESIDUALS list below. A tracked hub path matching none of these
 * is an orphan — content that would silently die with the archive — and
 * fails the gate.
 */

export const ARCHIVE_RESIDUALS: ReadonlySet<string> = new Set([
  // The archive's own identity and machine registers.
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  "REUSE.toml",
  ".gitignore",
  ".github/CODEOWNERS",
  // The two remaining workflows and the minimal chain that keeps the
  // archive verifiable (manifests, configs, the quality-tool remainder).
  ".github/workflows/ci.yml",
  ".github/workflows/context-hygiene.yml",
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "biome.json",
  "tsconfig.json",
]);

export const RESIDUAL_PREFIXES: readonly string[] = [
  // Licence texts referenced by the remaining annotations.
  "LICENSES/",
  // Registers the archive owns (the index, the forgetting register, the card).
  "ecosystem/",
  // The minimal chain tools — their canonical copies live here in governance
  // (tools/ index entry, dual presence kept so the archive stays runnable).
  "tools/quality/",
  // Toolchain policy and notices: dual presence kept so the archive chain
  // stays self-verifiable (canonical copy adopted here, §5.4.3).
  "toolchains/",
];

export interface OrphanReport {
  readonly covered: number;
  readonly orphans: readonly string[];
}

export function findOrphans(
  hubPaths: readonly string[],
  indexPrefixes: readonly string[],
  replacementPaths: readonly string[],
  forgottenPaths: readonly string[],
): OrphanReport {
  const orphans: string[] = [];
  let covered = 0;
  for (const path of hubPaths) {
    const accounted =
      ARCHIVE_RESIDUALS.has(path) ||
      RESIDUAL_PREFIXES.some((p) => path.startsWith(p)) ||
      indexPrefixes.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p)) ||
      replacementPaths.includes(path) ||
      forgottenPaths.some((p) => path === p || path.startsWith(`${p}/`));
    if (accounted) covered += 1;
    else orphans.push(path);
  }
  return { covered, orphans };
}

/** Two retries beyond the first attempt — 1s then 3s — same budget as this file's neighbors. */
const RETRY_DELAYS_MS = [1000, 3000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GhFetchResult {
  readonly text: string | null;
  readonly error: string | null;
}

/**
 * REST fallback, retried, used only when the GraphQL paths below cannot be
 * answered at all — the shared installation REST quota was observed
 * exhausted even for a single fixed call (2026-08-19, same CI job,
 * ecosystem/check-migration-drift.ts's hub-index read), so "three fixed
 * requests" does not exempt this file from the same GraphQL escape as the
 * fleet-wide sweeps beside it in the same CI job.
 */
async function ghWithRetry(args: readonly string[]): Promise<GhFetchResult> {
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const result = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode === 0) {
      return { text: new TextDecoder().decode(result.stdout), error: null };
    }
    const stderr = new TextDecoder().decode(result.stderr).trim();
    if (stderr.includes("(HTTP 404)")) return { text: null, error: null };
    lastError = stderr || `gh ${args.join(" ")} failed (exit ${result.exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  return { text: null, error: lastError };
}

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

/** GraphQL primary for a single blob, REST+retry fallback — same shape as this file's neighbors. */
async function fetchBlobWithFallback(path: string): Promise<GhFetchResult> {
  const expression = JSON.stringify(`main:${path}`);
  const query = `query { repository(owner: "libre-ai", name: "libre-ai") { object(expression: ${expression}) { ... on Blob { text } } } }`;
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { stdout, stderr, exitCode } = await ghGraphQLRaw(query);
    try {
      const parsed = JSON.parse(stdout) as {
        data?: { repository?: { object?: { text?: string | null } | null } | null };
      };
      const repository = parsed.data?.repository;
      if (repository !== undefined && repository !== null) {
        return { text: repository.object?.text ?? null, error: null };
      }
    } catch {
      // fall through to retry/backoff
    }
    lastError = stderr.trim() || `gh api graphql failed (exit ${exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  console.error(
    `GraphQL blob fetch failed after retries for libre-ai/libre-ai:${path}, falling back to REST: ${lastError}`,
  );
  return ghWithRetry([
    "api",
    `repos/libre-ai/libre-ai/contents/${path}?ref=main`,
    "-H",
    "Accept: application/vnd.github.raw+json",
  ]);
}

// --- Recursive hub tree, via a breadth-first GraphQL walk — same pattern
// as ecosystem/check-migration-drift.ts (no direct GraphQL equivalent of
// REST's git/trees?recursive=1; one query per depth level, batching every
// directory discovered at that depth).

interface TreeWaveEntry {
  readonly name: string;
  readonly type: string;
}

function waveAlias(index: number): string {
  return `dir${index}`;
}

export function buildTreeWaveQuery(ref: string, directories: readonly string[]): string {
  const fields = directories.map((dir, index) => {
    const expression = JSON.stringify(dir === "" ? `${ref}:` : `${ref}:${dir}`);
    return `    ${waveAlias(index)}: object(expression: ${expression}) { ... on Tree { entries { name type } } }`;
  });
  return [
    `query {`,
    `  repository(owner: "libre-ai", name: "libre-ai") {`,
    ...fields,
    `  }`,
    `}`,
  ].join("\n");
}

export function parseTreeWaveResponse(
  directories: readonly string[],
  data: Readonly<Record<string, unknown>> | undefined,
): Map<string, readonly TreeWaveEntry[]> | null {
  const repository = data?.repository as Record<string, unknown> | null | undefined;
  if (repository === undefined || repository === null) return null;
  const result = new Map<string, readonly TreeWaveEntry[]>();
  directories.forEach((dir, index) => {
    const node = repository[waveAlias(index)] as
      | { entries?: readonly TreeWaveEntry[] }
      | null
      | undefined;
    result.set(dir, node?.entries ?? []);
  });
  return result;
}

async function fetchTreeWave(
  ref: string,
  directories: readonly string[],
): Promise<Map<string, readonly TreeWaveEntry[]> | null> {
  const query = buildTreeWaveQuery(ref, directories);
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { stdout, stderr, exitCode } = await ghGraphQLRaw(query);
    try {
      const parsed = JSON.parse(stdout) as { data?: Record<string, unknown> };
      if (parsed.data !== undefined) {
        const wave = parseTreeWaveResponse(directories, parsed.data);
        if (wave !== null) return wave;
      }
    } catch {
      // fall through to retry/backoff
    }
    lastError = stderr.trim() || `gh api graphql failed (exit ${exitCode})`;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  console.error(`GraphQL tree wave fetch failed after retries for libre-ai/libre-ai: ${lastError}`);
  return null;
}

const MAX_TREE_WAVES = 30; // safety cap: 30 directory levels is far beyond any real repository

async function hubTreePathsViaGraphQL(ref: string): Promise<string[] | null> {
  const result: string[] = [];
  let frontier: string[] = [""];
  let wave = 0;
  for (; wave < MAX_TREE_WAVES && frontier.length > 0; wave++) {
    const waveResult = await fetchTreeWave(ref, frontier);
    if (waveResult === null) return null;
    const nextFrontier: string[] = [];
    for (const dir of frontier) {
      for (const entry of waveResult.get(dir) ?? []) {
        const fullPath = dir === "" ? entry.name : `${dir}/${entry.name}`;
        if (entry.type === "blob") result.push(fullPath);
        else if (entry.type === "tree") nextFrontier.push(fullPath);
      }
    }
    frontier = nextFrontier;
  }
  if (wave === MAX_TREE_WAVES && frontier.length > 0) {
    // The walk exhausted its depth budget with directories still
    // unprocessed: `result` is a real but TRUNCATED subset, indistinguishable
    // from the complete hub tree to any caller that just reads the array —
    // a silent-partial-result failure this gate exists to prevent (a
    // truncated listing could hide a real orphan as covered, or the reverse).
    // Never return it. `null` routes through the same path as any other
    // GraphQL failure: the REST fallback below, which has no depth limit.
    console.error(
      `GraphQL tree walk for libre-ai/libre-ai@${ref} exceeded ${MAX_TREE_WAVES} directory levels — unable to verify via GraphQL (tree deeper than ${MAX_TREE_WAVES} levels), falling back to REST`,
    );
    return null;
  }
  return result;
}

async function hubTreePathsViaRest(ref: string): Promise<GhFetchResult> {
  return ghWithRetry([
    "api",
    `repos/libre-ai/libre-ai/git/trees/${ref}?recursive=1`,
    "--jq",
    '.tree[] | select(.type == "blob") | .path',
  ]);
}

if (import.meta.main) {
  const viaGraphQL = await hubTreePathsViaGraphQL("main");
  let hubPaths: string[];
  if (viaGraphQL !== null) {
    hubPaths = viaGraphQL;
  } else {
    const rest = await hubTreePathsViaRest("main");
    if (rest.text === null) {
      console.error(`unable to verify the hub tree — ${rest.error ?? "not found at main"}`);
      process.exit(1);
    }
    hubPaths = rest.text.split("\n").filter((l) => l.length > 0);
  }
  const indexResult = await fetchBlobWithFallback("ecosystem/migration-index.v1.yaml");
  const forgottenResult = await fetchBlobWithFallback("ecosystem/FORGOTTEN.yaml");
  if (indexResult.text === null || forgottenResult.text === null) {
    console.error(
      `unable to verify the hub registers — index: ${indexResult.error ?? "not found at main"}; forgotten: ${forgottenResult.error ?? "not found at main"}`,
    );
    process.exit(1);
  }
  const indexText = indexResult.text;
  const forgottenText = forgottenResult.text;
  const yamlApi = (Bun as unknown as { YAML: { parse(t: string): unknown } }).YAML;
  const index = yamlApi.parse(indexText) as {
    entries: readonly { hub_path: string }[];
    replacements: readonly { hub_paths: readonly string[] }[];
  };
  const forgotten = yamlApi.parse(forgottenText) as {
    entries?: readonly { evicted_paths?: readonly string[] }[];
  };
  const report = findOrphans(
    hubPaths,
    index.entries.map((e) => e.hub_path),
    index.replacements.flatMap((r) => [...r.hub_paths]),
    (forgotten.entries ?? []).flatMap((e) => [...(e.evicted_paths ?? [])]),
  );
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const gate = new GateReport();
  for (const orphan of report.orphans) {
    gate.check(orphan, false, "hub path with no destination, replacement or eviction");
  }
  if (report.orphans.length === 0) {
    // The coverage ratio is the verdict's evidence: zero tracked paths would
    // mean the hub listing itself broke, and that is a red, not a green.
    gate.check(
      "hub tracked paths",
      hubPaths.length > 0,
      hubPaths.length > 0
        ? `${report.covered}/${hubPaths.length} accounted for by a destination, replacement or eviction`
        : "the hub listing returned no path — the reconciliation asserted nothing",
    );
  }
  concludeGate("Hub orphans", gate);
}
