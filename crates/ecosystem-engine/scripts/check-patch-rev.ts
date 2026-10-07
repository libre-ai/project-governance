/**
 * Orphan-rev gate for intra-organisation `[patch.*]` git dependencies
 * (ADR-0031 D2 + D3).
 *
 * A `{ git = "https://github.com/libre-ai/<repo>", rev = "<sha>" }` patch
 * keeps building for as long as GitHub serves the sha — and GitHub keeps
 * pull-request refs after a branch is deleted, so a rev pinned on a feature
 * branch never stops resolving. Nothing in cargo tells the consumer that
 * `main` of the producing repository does not contain the code it depends
 * on. This gate does: every such rev must be an ancestor of (or equal to) the
 * producer's `main`, as reported by the GitHub compare API
 * (`repos/<owner>/<repo>/compare/<default branch>...<rev>` -> status `identical` or
 * `behind`). `ahead` and `diverged` mean the rev is not on `main`: red.
 *
 * Pin rule (D2): `rev` is a full lowercase 40-hex commit sha, never a branch
 * name, a tag or a short sha; `branch =` and `tag =` are refused outright on an
 * organisation source. The manifest is read with a real TOML parser
 * (`Bun.TOML.parse`), so key order, quoting, spacing, the inline-table and the
 * dedicated-table (`[patch.crates-io.<crate>]`) forms are all the same entry,
 * and every `[patch.<source>]` section is scanned, not only `crates-io`.
 *
 * A gate that is green on what it cannot read is not a gate (D3): the number
 * of patch entries of every kind is printed so that a zero is a verifiable
 * fact; an entry the parser does not understand is red ("cannot parse"); and
 * the count of organisation git sources found in the raw text is compared to
 * the count found in the parsed tree, so a lenient parser cannot drop one
 * silently.
 *
 * Re-pin sequence after the producer squash-merges (ADR-0031): read the merge
 * commit on `main`, replace `rev`, `cargo update -p <crate>` (that package
 * only), run this gate, open the bump pull request.
 */

const ORGANISATION = "libre-ai";
const FULL_SHA = /^[0-9a-f]{40}$/;
const ORGANISATION_SOURCE = new RegExp(`github\\.com[/:]${ORGANISATION}/`, "gi");

export interface GitPatch {
  /** Patched source: `crates-io` or the URL of a `[patch."https://…"]` section. */
  readonly section: string;
  readonly crate: string;
  readonly owner: string;
  readonly repo: string;
  readonly rev: string;
}

export interface PatchRejection {
  readonly section: string;
  readonly crate: string;
  readonly reason: string;
}

export interface PatchScan {
  /** Every entry under every `[patch.<source>]` table, whatever its kind. */
  readonly entries: number;
  /** Organisation git sources found in the parsed tree, anywhere in the manifest. */
  readonly organisationSources: number;
  /** Intra-organisation git patches pinned by a full sha: the ones the network check runs on. */
  readonly patches: GitPatch[];
  /** Intra-organisation git patches that violate the pin rule or cannot be read. */
  readonly rejections: PatchRejection[];
}

export type CompareStatus = "identical" | "behind" | "ahead" | "diverged";

export type TomlParser = (input: string) => unknown;

/** The manifest, or one of its patch tables, cannot be read: the gate must not report zero. */
export class CargoTomlParseError extends Error {
  override readonly name = "CargoTomlParseError";
}

type TomlTable = Record<string, unknown>;

function isTable(value: unknown): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface OrganisationRepository {
  readonly owner: string;
  readonly repo: string;
}

/**
 * Owner and repository of a GitHub git source, in its `https://`, `ssh://` or
 * scp-like (`git@github.com:owner/repo`) spelling; null for any other host.
 */
function parseGitHubSource(git: string): OrganisationRepository | null {
  const scpLike = git.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (scpLike !== null) {
    const [, owner, repo] = scpLike;
    if (owner !== undefined && repo !== undefined) return { owner, repo };
    return null;
  }
  let url: URL;
  try {
    url = new URL(git);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== "github.com") return null;
  const [owner, repoSegment] = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (owner === undefined || repoSegment === undefined) return null;
  return { owner, repo: repoSegment.replace(/\.git$/i, "") };
}

function isOrganisationSource(git: string): boolean {
  const source = parseGitHubSource(git);
  return source !== null && source.owner.toLowerCase() === ORGANISATION;
}

/** Counts organisation git sources among the string values of a parsed TOML tree. */
function countOrganisationSourcesInTree(value: unknown): number {
  if (typeof value === "string") return isOrganisationSource(value) ? 1 : 0;
  if (Array.isArray(value))
    return value.reduce<number>((n, v) => n + countOrganisationSourcesInTree(v), 0);
  if (isTable(value)) {
    // Keys count too: a `[patch."https://github.com/libre-ai/<repo>"]` header is a source.
    return Object.entries(value).reduce<number>(
      (n, [key, v]) => n + (isOrganisationSource(key) ? 1 : 0) + countOrganisationSourcesInTree(v),
      0,
    );
  }
  return 0;
}

/**
 * Removes `#` comments from a TOML text, keeping `#` inside basic (`"`) and
 * literal (`'`) strings. Multi-line strings are not special-cased: a comment
 * marker inside one is a false negative of the cross-check, never a false
 * positive, and Cargo manifests do not carry git URLs in multi-line strings.
 */
function stripComments(toml: string): string {
  let out = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < toml.length; i += 1) {
    const char = toml[i] ?? "";
    if (quote === null) {
      if (char === "#") {
        while (i < toml.length && toml[i] !== "\n") i += 1;
        out += "\n";
        continue;
      }
      if (char === '"' || char === "'") quote = char;
    } else if (char === "\\" && quote === '"') {
      out += char + (toml[i + 1] ?? "");
      i += 1;
      continue;
    } else if (char === quote) {
      quote = null;
    }
    out += char;
  }
  return out;
}

function countOrganisationSourcesInText(toml: string): number {
  return stripComments(toml).match(ORGANISATION_SOURCE)?.length ?? 0;
}

function classifyEntry(
  section: string,
  crate: string,
  entry: unknown,
): GitPatch | PatchRejection | null {
  if (!isTable(entry)) {
    // A string here is a registry version spec cargo would refuse under [patch],
    // and anything else is a shape this gate does not know: both are "cannot parse".
    const text = typeof entry === "string" ? entry : JSON.stringify(entry);
    if (text.match(ORGANISATION_SOURCE) === null) return null;
    return {
      section,
      crate,
      reason: `cannot parse: expected a table, found ${JSON.stringify(entry)}`,
    };
  }
  const git = entry.git;
  if (git === undefined) return null;
  if (typeof git !== "string") {
    return { section, crate, reason: `cannot parse: git = ${JSON.stringify(git)} is not a string` };
  }
  const source = parseGitHubSource(git);
  if (source === null || source.owner.toLowerCase() !== ORGANISATION) return null;
  for (const key of ["branch", "tag"] as const) {
    const value = entry[key];
    if (value !== undefined) {
      return {
        section,
        crate,
        reason: `${key} = ${JSON.stringify(value)} is forbidden on an organisation source: pin a full 40-hex commit sha with rev (ADR-0031 D2)`,
      };
    }
  }
  const rev = entry.rev;
  if (rev === undefined) {
    return { section, crate, reason: "no rev: pin a full 40-hex commit sha (ADR-0031 D2)" };
  }
  if (typeof rev !== "string" || !FULL_SHA.test(rev)) {
    return {
      section,
      crate,
      reason: `rev ${JSON.stringify(rev)} is not a full lowercase 40-hex sha: a branch, a tag or a short sha is not a pin (ADR-0031 D2)`,
    };
  }
  return { section, crate, owner: source.owner, repo: source.repo, rev };
}

/**
 * Reads every `[patch.<source>]` entry of a Cargo manifest and sorts the
 * intra-organisation git ones into accepted pins and named rejections.
 *
 * @throws CargoTomlParseError when the manifest or a patch table cannot be read,
 *   or when the raw text mentions more organisation git sources than the parsed tree.
 */
export function scanPatches(cargoToml: string, parse: TomlParser = Bun.TOML.parse): PatchScan {
  let document: unknown;
  try {
    document = parse(cargoToml);
  } catch (error) {
    throw new CargoTomlParseError(`Cargo.toml: ${(error as Error).message}`);
  }
  if (!isTable(document)) throw new CargoTomlParseError("Cargo.toml: not a TOML table");

  const inText = countOrganisationSourcesInText(cargoToml);
  const inTree = countOrganisationSourcesInTree(document);
  if (inText > inTree) {
    throw new CargoTomlParseError(
      `Cargo.toml: ${inText} organisation git source(s) in the text, ${inTree} in the parsed manifest — the parser dropped one`,
    );
  }

  const scan = { entries: 0, organisationSources: inTree, patches: [], rejections: [] } as {
    entries: number;
    organisationSources: number;
    patches: GitPatch[];
    rejections: PatchRejection[];
  };
  const patch = document.patch;
  if (patch === undefined) return scan;
  if (!isTable(patch)) throw new CargoTomlParseError("Cargo.toml: [patch] is not a table");

  for (const [section, table] of Object.entries(patch)) {
    if (!isTable(table)) {
      throw new CargoTomlParseError(
        `Cargo.toml: [patch.${JSON.stringify(section)}] is not a table`,
      );
    }
    for (const [crate, entry] of Object.entries(table)) {
      scan.entries += 1;
      const classified = classifyEntry(section, crate, entry);
      if (classified === null) continue;
      if ("rev" in classified) scan.patches.push(classified);
      else scan.rejections.push(classified);
    }
  }
  return scan;
}

/**
 * A rev is acceptable only when the producer's released line already contains
 * it — `identical` or `behind` against that line's tip.
 */
export function isOnMain(status: CompareStatus): boolean {
  return status === "identical" || status === "behind";
}

function apiHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "libre-ai-ecosystem-engine-check-patch-rev",
  };
  if (token !== undefined && token.length > 0) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * The producer's own default branch, never a hardcoded `main`.
 *
 * I-28 asks whether the producer's released line contains the pinned rev. The
 * released line is whichever branch that repository serves, and the 2026-10-07
 * consolidation moved the fleet's default branches to `migrate/recover-code`,
 * whose documentary `main` is an ancestor. Comparing against a literal `main`
 * would have declared every correctly pinned rev orphaned — the gate would
 * fail on conformant input, which is worse than not running.
 */
async function defaultBranch(patch: GitPatch, token: string | undefined): Promise<string> {
  const url = `https://api.github.com/repos/${patch.owner}/${patch.repo}`;
  const response = await fetch(url, { headers: apiHeaders(token) });
  if (!response.ok) {
    throw new Error(`GitHub repository ${url} -> HTTP ${response.status}`);
  }
  const body = (await response.json()) as { default_branch?: unknown };
  const branch = body.default_branch;
  if (typeof branch !== "string" || branch.length === 0) {
    throw new Error(`GitHub repository ${url} -> no default branch reported`);
  }
  return branch;
}

async function compareStatus(patch: GitPatch, token: string | undefined): Promise<CompareStatus> {
  const base = await defaultBranch(patch, token);
  const url = `https://api.github.com/repos/${patch.owner}/${patch.repo}/compare/${encodeURIComponent(base)}...${patch.rev}`;
  const response = await fetch(url, { headers: apiHeaders(token) });
  if (!response.ok) {
    throw new Error(`GitHub compare ${url} -> HTTP ${response.status}`);
  }
  const body = (await response.json()) as { status?: unknown };
  const status = body.status;
  if (
    status !== "identical" &&
    status !== "behind" &&
    status !== "ahead" &&
    status !== "diverged"
  ) {
    throw new Error(`GitHub compare ${url} -> unexpected status ${String(status)}`);
  }
  return status;
}

// Repository-root relative, like every other `check:*` of this repository.
// The manifest this gate reads is the absorbed crate's, not a root workspace:
// `project-governance` has no root Cargo.toml, so an unqualified "Cargo.toml"
// resolved to nothing once the crate moved under `crates/`.
const CARGO_MANIFEST = "crates/ecosystem-engine/Cargo.toml";

if (import.meta.main) {
  const cargoToml = await Bun.file(CARGO_MANIFEST).text();
  let scan: PatchScan;
  try {
    scan = scanPatches(cargoToml);
  } catch (error) {
    console.error(`Orphan-rev gate: CANNOT PARSE ${(error as Error).message}`);
    console.error("Orphan-rev gate: FAILED");
    process.exit(1);
  }
  console.log(
    `Orphan-rev gate: ${scan.entries} patch entr${scan.entries === 1 ? "y" : "ies"} under [patch.*] (all sources), ${scan.organisationSources} github.com/${ORGANISATION} URL(s) in the manifest (text and parsed tree agree), ${scan.patches.length} intra-organisation patch(es) pinned by a full sha, ${scan.rejections.length} rejected`,
  );
  let failures = 0;
  for (const rejection of scan.rejections) {
    console.error(`  FAIL ${rejection.crate} [patch.${rejection.section}]: ${rejection.reason}`);
    failures += 1;
  }
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  for (const patch of scan.patches) {
    let status: CompareStatus;
    try {
      status = await compareStatus(patch, token);
    } catch (error) {
      console.error(`  CANNOT CHECK ${patch.crate}: ${(error as Error).message}`);
      failures += 1;
      continue;
    }
    if (isOnMain(status)) {
      console.log(
        `  OK   ${patch.crate} -> ${patch.owner}/${patch.repo}@${patch.rev.slice(0, 7)} is on main (${status})`,
      );
    } else {
      console.error(
        `  FAIL ${patch.crate} -> ${patch.owner}/${patch.repo}@${patch.rev.slice(0, 7)} is NOT on main (${status}): re-pin to the merge commit before merging`,
      );
      failures += 1;
    }
  }
  if (failures > 0) {
    console.error("Orphan-rev gate: FAILED");
    process.exit(1);
  }
  console.log("Orphan-rev gate: OK");
}
