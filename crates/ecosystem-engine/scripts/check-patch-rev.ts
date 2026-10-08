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
 * tip of the branch the producer serves, established with git against the
 * public remote -- `ls-remote --symref` for that branch, then
 * `merge-base --is-ancestor` both ways, named `identical` / `behind` / `ahead`
 * / `diverged`. `ahead` and `diverged` mean the rev is not on the served line:
 * red. No API, so no quota and no token (see `classifyContainment`).
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

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** A defect in what the gate READ, as opposed to a defect in a pin it found. */
export interface CorpusDefect {
  readonly item: string;
  readonly detail: string;
}

/** Does this manifest carry the `[workspace]` table that makes it the root? */
export function declaresWorkspace(cargoToml: string, parse: TomlParser = Bun.TOML.parse): boolean {
  let document: unknown;
  try {
    document = parse(cargoToml);
  } catch {
    return false;
  }
  return isTable(document) && isTable(document.workspace);
}

/**
 * Manifests that declare a `[patch.*]` table Cargo will never read.
 *
 * Cargo reads `[patch]` at the workspace root only. A patch table in a member
 * manifest is silently ignored — the build resolves to the registry crate and
 * the pin is neither applied nor checked. Reading only the root is therefore
 * correct AND insufficient: the root can lose its `[patch]` to a member and
 * nothing says so.
 */
export function findStrayPatchTables(
  manifests: readonly { readonly path: string; readonly text: string }[],
  parse: TomlParser = Bun.TOML.parse,
): string[] {
  const stray: string[] = [];
  for (const manifest of manifests) {
    let document: unknown;
    try {
      document = parse(manifest.text);
    } catch {
      // Unreadable here is reported by the root scan when it is the root, and
      // is not this predicate's question otherwise.
      continue;
    }
    if (isTable(document) && document.patch !== undefined) stray.push(manifest.path);
  }
  return stray;
}

/** One inspected item of the corpus the gate read, verdict and evidence. */
export interface CorpusAssertion extends CorpusDefect {
  readonly ok: boolean;
}

/** Said out loud when the root manifest declares no patch at all. */
export const NO_PATCH_NOTE =
  "declares no [patch.*] entry: zero intra-organisation pin is a legitimate answer here, and " +
  "the orphan-rev rule of ADR-0031 D2 holds vacuously. What keeps that from being a green over " +
  "nothing is the rest of this report: the manifest above IS the workspace root Cargo reads " +
  "[patch] from, checked rather than assumed, and every member manifest was inspected for a " +
  "[patch.*] Cargo would ignore. An unreadable manifest and a manifest with no patch are two " +
  "different answers and this gate gives them two different lines";

/**
 * Everything the gate inspected about WHAT IT READ, before any network call.
 *
 * Until 2026-10-08 this gate printed `Orphan-rev gate: OK` and exited 0 over an
 * empty set — probed with a `Cargo.toml` carrying no `[patch.*]` at all, and
 * the file's own comment records that the defect had already happened once: the
 * relocation of the crate under `crates/` made an unqualified `"Cargo.toml"`
 * resolve to nothing.
 *
 * The fix is not "empty fails". A repository may legitimately carry no patch,
 * and forcing a red there would be a verdict on nothing in the other
 * direction. What the gate owed was the distinction D3 names — green on what
 * it cannot read is not a gate — so the two facts it can be wrong about are
 * asserted on every run, whatever the patch count: the manifest it read is the
 * workspace root, and no member manifest hides a `[patch.*]` where Cargo
 * ignores it. A zero patch count is then reported as a zero, with its reason.
 */
export function inspectCorpus(input: {
  readonly manifest: string;
  readonly declaresWorkspace: boolean;
  readonly scan: PatchScan;
  readonly memberManifests: readonly string[];
  readonly strayPatchManifests: readonly string[];
}): CorpusAssertion[] {
  const assertions: CorpusAssertion[] = [
    {
      item: input.manifest,
      ok: input.declaresWorkspace,
      detail: input.declaresWorkspace
        ? "is the workspace root: it carries a [workspace] table, so the [patch] section read here is the one Cargo reads"
        : "read as the workspace root but it carries no [workspace] table: Cargo reads [patch] at the workspace root only, so this gate is measuring a patch section Cargo ignores. The crate's relocation under crates/ already made this path resolve to nothing once",
    },
  ];
  const stray = new Set(input.strayPatchManifests);
  for (const member of input.memberManifests) {
    assertions.push({
      item: member,
      ok: !stray.has(member),
      detail: stray.has(member)
        ? "declares a [patch.*] table outside the workspace root, where Cargo silently ignores it: the pin is neither applied to the build nor checked here. Move it to the workspace root"
        : "declares no [patch.*] table, which is what a member manifest must not carry: Cargo would ignore it there",
    });
  }
  if (input.scan.entries === 0) {
    assertions.push({ item: input.manifest, ok: true, detail: NO_PATCH_NOTE });
  }
  return assertions;
}

/**
 * A rev is acceptable only when the producer's released line already contains
 * it — `identical` or `behind` against that line's tip.
 */
export function isOnMain(status: CompareStatus): boolean {
  return status === "identical" || status === "behind";
}

/**
 * Containment is asked of git, not of an API.
 *
 * Until 2026-10-07 this gate asked `repos/<owner>/<repo>/compare/...`, which
 * made its verdict depend on a quota shared by every job leaving the runner's
 * address: sixty requests an hour without a token. CI then reported
 * `CANNOT CHECK biscuit-auth: HTTP 403` for a repository that exists and a rev
 * that is on its released line. Failing closed on "I could not ask" was the
 * right reflex, and that is exactly what makes the defect serious: a red that
 * means nothing is how a red that means something gets waved through.
 *
 * Adding a token would have made the blip rarer, not the verdict deterministic.
 * git answers the same question with no quota, no token and so nothing to leak,
 * and answers it more precisely: `merge-base --is-ancestor` IS containment,
 * where the compare status is a four-valued summary of it. A rev the producer
 * cannot serve at all stops being indistinguishable from a quota refusal — it
 * is the finding the gate exists to make.
 */

/** Ancestry, named in the compare vocabulary the register and `isOnMain` use. */
export function classifyContainment(options: {
  readonly equal: boolean;
  readonly revIsAncestorOfTip: boolean;
  readonly tipIsAncestorOfRev: boolean;
}): CompareStatus {
  if (options.equal) return "identical";
  if (options.revIsAncestorOfTip) return "behind";
  if (options.tipIsAncestorOfRev) return "ahead";
  return "diverged";
}

/**
 * The rev is not obtainable from the producer: force-pushed away, or never
 * pushed there. Distinct from an unreachable producer, because this one is a
 * finding about the pin and not about the network.
 */
export class UnreachableRevError extends Error {}

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(args: readonly string[]): Promise<Ran> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** The symbolic HEAD of the producer, never a hardcoded `main`. */
export function parseSymrefHead(lsRemoteStdout: string): string {
  const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(lsRemoteStdout);
  const branch = match?.[1];
  if (branch === undefined || branch.length === 0) {
    throw new Error("ls-remote reported no symbolic HEAD");
  }
  return branch;
}

/**
 * Commits without blobs: ancestry needs the commit graph and nothing else, and
 * a producer carrying fifty thousand files must not be downloaded whole to
 * answer one ancestry question. A git or a server that refuses the filter is
 * retried unfiltered, so a refused filter never reads as a missing rev.
 */
async function fetchRefspec(gitDir: string, refspec: string): Promise<Ran> {
  const fetchArgs = ["--git-dir", gitDir, "fetch", "--quiet", "--no-tags"];
  const filtered = await run([...fetchArgs, "--filter=blob:none", "origin", refspec]);
  if (filtered.code === 0) return filtered;
  return await run([...fetchArgs, "origin", refspec]);
}

async function compareStatus(patch: GitPatch): Promise<CompareStatus> {
  const url = `https://github.com/${patch.owner}/${patch.repo}`;
  const gitDir = await mkdtemp(join(tmpdir(), "check-patch-rev-"));
  try {
    const init = await run(["init", "--bare", "--quiet", gitDir]);
    if (init.code !== 0)
      throw new Error(`cannot initialise a scratch repository: ${init.stderr.trim()}`);
    // A named remote with `extensions.partialClone` is what makes `--filter` legal.
    const remote = await run(["--git-dir", gitDir, "remote", "add", "origin", url]);
    if (remote.code !== 0) throw new Error(`cannot address ${url}: ${remote.stderr.trim()}`);
    await run(["--git-dir", gitDir, "config", "extensions.partialClone", "origin"]);

    const head = await run(["--git-dir", gitDir, "ls-remote", "--symref", url, "HEAD"]);
    if (head.code !== 0) throw new Error(`cannot reach ${url}: ${head.stderr.trim()}`);
    const branch = parseSymrefHead(head.stdout);

    const tip = await fetchRefspec(gitDir, `refs/heads/${branch}:refs/pinned/tip`);
    if (tip.code !== 0) {
      throw new Error(`cannot fetch ${url} ${branch}: ${tip.stderr.trim()}`);
    }
    const rev = await fetchRefspec(gitDir, `${patch.rev}:refs/pinned/rev`);
    if (rev.code !== 0) {
      throw new UnreachableRevError(
        `${url} does not serve ${patch.rev}: ${rev.stderr.trim().split("\n").pop() ?? "fetch refused"}`,
      );
    }

    const resolve = async (ref: string): Promise<string> => {
      const parsed = await run(["--git-dir", gitDir, "rev-parse", ref]);
      if (parsed.code !== 0) throw new Error(`cannot resolve ${ref}: ${parsed.stderr.trim()}`);
      return parsed.stdout.trim();
    };
    const ancestor = async (earlier: string, later: string): Promise<boolean> => {
      // Exit 1 is an answer, not a failure; anything else is.
      const asked = await run(["--git-dir", gitDir, "merge-base", "--is-ancestor", earlier, later]);
      if (asked.code === 0) return true;
      if (asked.code === 1) return false;
      throw new Error(`cannot compare ${earlier} to ${later}: ${asked.stderr.trim()}`);
    };

    const [revSha, tipSha] = await Promise.all([
      resolve("refs/pinned/rev"),
      resolve("refs/pinned/tip"),
    ]);
    if (revSha !== patch.rev) {
      throw new Error(
        `${url} served ${revSha} for ${patch.rev}: a rev must be the commit it names`,
      );
    }
    if (revSha === tipSha)
      return classifyContainment({
        equal: true,
        revIsAncestorOfTip: true,
        tipIsAncestorOfRev: true,
      });
    const [revIsAncestorOfTip, tipIsAncestorOfRev] = await Promise.all([
      ancestor("refs/pinned/rev", "refs/pinned/tip"),
      ancestor("refs/pinned/tip", "refs/pinned/rev"),
    ]);
    return classifyContainment({ equal: false, revIsAncestorOfTip, tipIsAncestorOfRev });
  } finally {
    await rm(gitDir, { recursive: true, force: true });
  }
}

// Repository-root relative, like every other `check:*` of this repository, and
// the workspace root: Cargo reads `[patch]` there and nowhere else, so that is
// where this gate must look for it.
//
// The sentence this comment replaced said `project-governance` has no root
// Cargo.toml. That was true for one window — the absorption of the engine put
// the manifest under `crates/` and an unqualified "Cargo.toml" resolved to
// nothing — and it is false since the workspace root was reintroduced. Both
// halves were kept side by side, which is how a comment stops being evidence.
// `declaresWorkspace` now checks the claim instead of asserting it.
const CARGO_MANIFEST = "Cargo.toml";

// Member manifests are read too, for a `[patch.*]` Cargo would ignore there.
const MEMBER_MANIFESTS = "crates/*/Cargo.toml";

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("../../../tools/quality/gate-report");
  const report = new GateReport();

  const cargoToml = await Bun.file(CARGO_MANIFEST).text();
  let scan: PatchScan;
  try {
    scan = scanPatches(cargoToml);
  } catch (error) {
    report.check(CARGO_MANIFEST, false, `CANNOT PARSE ${(error as Error).message}`);
    concludeGate("Orphan-rev", report);
    throw new Error("unreachable: concludeGate exits on a failing report");
  }

  const members: { path: string; text: string }[] = [];
  for await (const path of new Bun.Glob(MEMBER_MANIFESTS).scan({ cwd: ".", onlyFiles: true })) {
    members.push({ path, text: await Bun.file(path).text() });
  }

  const corpus = inspectCorpus({
    manifest: CARGO_MANIFEST,
    declaresWorkspace: declaresWorkspace(cargoToml),
    scan,
    memberManifests: members.map((member) => member.path),
    strayPatchManifests: findStrayPatchTables(members),
  });
  for (const assertion of corpus) report.check(assertion.item, assertion.ok, assertion.detail);

  for (const rejection of scan.rejections) {
    report.check(`${rejection.crate} [patch.${rejection.section}]`, false, rejection.reason);
  }

  for (const patch of scan.patches) {
    const subject = `${patch.crate} -> ${patch.owner}/${patch.repo}@${patch.rev.slice(0, 7)}`;
    let status: CompareStatus;
    try {
      status = await compareStatus(patch);
    } catch (error) {
      // Two reds, named apart: a pin the producer cannot serve is a finding to
      // act on, an unreachable producer is a condition to look into. Both fail.
      const label = error instanceof UnreachableRevError ? "FAIL" : "CANNOT CHECK";
      report.check(subject, false, `${label}: ${(error as Error).message}`);
      continue;
    }
    report.check(
      subject,
      isOnMain(status),
      isOnMain(status)
        ? `is on the producer's served line (${status})`
        : `is NOT on the served line (${status}): re-pin to the merge commit before merging`,
    );
  }

  // The volume on the success line, not in a note no operator reads: a count of
  // assertions does not say whether one pin was checked or none at all.
  report.volume(
    `${scan.entries} patch entr${scan.entries === 1 ? "y" : "ies"} under [patch.*] of ` +
      `${CARGO_MANIFEST}, ${scan.organisationSources} github.com/${ORGANISATION} URL(s) ` +
      `(text and parsed tree agree), ${scan.patches.length} intra-organisation pin(s) compared ` +
      `to their producer's served line, ${scan.rejections.length} rejected, ` +
      `${members.length} member manifest(s) inspected for a stray [patch.*]`,
  );
  concludeGate("Orphan-rev", report);
}
