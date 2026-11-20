import { lstatSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { concludeGate, GateReport } from "./gate-report";
import { type GitRead, readGit } from "./git-diff";

/**
 * Long and old governance documents.
 *
 * A document of thousands of lines nobody has edited for months becomes a
 * phantom source of truth: it contradicts the doctrine that is maintained, and
 * it pollutes search and every agent that reads it. This command lists every
 * tracked document that is BOTH longer than `maxLines` AND without a useful
 * edit for more than `maxAgeDays`; each one goes through a human audit with
 * three outcomes — migrate (content taken up elsewhere, original archived),
 * archive (moved out of this repository into a quarterly archive folder,
 * renamed with its date, alongside a migration index mapping its old sections
 * to their maintained targets), or reconfirm (a useful edit that resets the
 * counter). The eviction decision stays human; this command only lists.
 *
 * Definitions the brief left open, fixed here so they are testable:
 *
 * - **Useful edit**: any commit touching the file, except the commits listed
 *   in `nonUsefulCommits` (reformatting, a pure move), each with its reason.
 *   A path touched only by such commits keeps the date of its OLDEST one: it
 *   has existed unedited at least since then.
 * - **Age**: whole days between the committer date of that commit and now.
 *   "More than 60 days" means 61 or more; "more than 500 lines" means 501.
 * - **A shallow clone fails.** Its history stops at the graft, so every age
 *   read from it is the age of the graft, not of the document.
 * - A rename resets the counter (the log runs `--no-renames`): a move commit
 *   that should not count is declared in `nonUsefulCommits`.
 * - **A merge commit carries no edit.** `git log --name-only` prints no path
 *   for a merge, so a rewrite made only while resolving a merge does not reset
 *   the counter; the commits of the merged branch do, at their own dates. The
 *   error goes toward listing a document that was in fact edited (a human
 *   audit then reconfirms it), never toward a false green.
 * - Documents are matched case-insensitively (`:(icase)*.md`): `NOTES.MD` is
 *   a document like `notes.md`. The exclusion of ADRs ignores case the same
 *   way: `DOCS/ADR/` is excluded like `docs/adr/`.
 * - **Lines are those of the tracked content**, the blob the index records
 *   (`git ls-files -s`, then one `git cat-file --batch`), never the working
 *   tree: a parent directory swapped for a link, or an unstaged shortening,
 *   would otherwise make a long document read as short. A blob missing from
 *   the object store is a failure.
 * - **An index in a merge conflict is refused.** Its stages 1, 2 and 3 are
 *   three versions of one path; the audit runs on a resolved index.
 * - **A last useful edit dated in the future** by more than
 *   `futureToleranceSeconds` (clock skew) is a named failure: its age would
 *   be negative and the document would never be listed.
 *
 * ADRs are outside the policy: a decision record is immutable by design, and
 * its age is the point.
 *
 * The thresholds live in `STALENESS_POLICY` below, as data a reviewer reads in
 * the diff — not in a JSON file, because every tracked data file must be
 * declared to the data-inventory gate, and doing that is a change to a guard
 * in service.
 *
 * With `--archives <dir>`, the command also checks archive/index parity in an
 * archive tree laid out as `<dir>/<YYYY-Qn>/<archive folder>/<index file>`:
 * every archive folder holds its own migration index, no index lies outside a
 * folder, and no archived file lies directly in a quarter (it would have no
 * folder to hold its index), so the number of folders equals the number of
 * indexes. Its counters stand on the success line; an empty tree passes.
 *
 * Usage: bun tools/quality/check-document-staleness.ts [--archives <dir>]
 */

export interface NonUsefulCommit {
  /** Full 40-hex commit id. */
  readonly sha: string;
  readonly because: string;
}

export interface StalenessPolicy {
  /** A document is long when it has MORE lines than this. */
  readonly maxLines: number;
  /** A document is old when its last useful edit is MORE days ago than this. */
  readonly maxAgeDays: number;
  /** The git pathspec of the governance documents. */
  readonly documentPathspec: string;
  /** Repository-relative prefixes outside the policy. */
  readonly excludedPrefixes: readonly string[];
  readonly nonUsefulCommits: readonly NonUsefulCommit[];
  readonly migrationIndexFileName: string;
  /** How far ahead of now a commit date may be (clock skew) before it is a failure. */
  readonly futureToleranceSeconds: number;
}

export const STALENESS_POLICY: StalenessPolicy = {
  maxLines: 500,
  maxAgeDays: 60,
  documentPathspec: ":(icase)*.md",
  excludedPrefixes: ["docs/adr/"],
  nonUsefulCommits: [],
  migrationIndexFileName: "migration-index.v1.yaml",
  // One day: covers a committer clock or a time zone set wrong, not a date
  // written months ahead.
  futureToleranceSeconds: 86_400,
};

const FULL_SHA = /^[0-9a-f]{40}$/;
const SECONDS_PER_DAY = 86_400;

/** Every reason the policy cannot be applied; empty when it can. */
export function validatePolicy(policy: StalenessPolicy): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(policy.maxLines) || policy.maxLines < 1) {
    problems.push(`maxLines must be a positive integer, got ${policy.maxLines}`);
  }
  if (!Number.isInteger(policy.maxAgeDays) || policy.maxAgeDays < 1) {
    problems.push(`maxAgeDays must be a positive integer, got ${policy.maxAgeDays}`);
  }
  if (!Number.isInteger(policy.futureToleranceSeconds) || policy.futureToleranceSeconds < 0) {
    problems.push(
      `futureToleranceSeconds must be a non-negative integer, got ${policy.futureToleranceSeconds}`,
    );
  }
  for (const prefix of policy.excludedPrefixes) {
    if (
      prefix === "" ||
      isAbsolute(prefix) ||
      prefix.split("/").includes("..") ||
      !prefix.endsWith("/")
    ) {
      problems.push(
        `excluded prefix "${prefix}" must be a repository-relative directory ending with /`,
      );
    }
  }
  for (const commit of policy.nonUsefulCommits) {
    if (!FULL_SHA.test(commit.sha))
      problems.push(`non-useful commit "${commit.sha}" is not a full commit id`);
    if (commit.because.trim() === "")
      problems.push(`non-useful commit "${commit.sha}" has no reason`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(policy.migrationIndexFileName)) {
    problems.push(
      `migration index file name "${policy.migrationIndexFileName}" must be a plain file name`,
    );
  }
  return problems;
}

const NEWLINE = 0x0a;

/** Lines of a blob, counted on its bytes: a final line without a newline counts. */
export function countLines(content: Uint8Array): number {
  let newlines = 0;
  for (const byte of content) if (byte === NEWLINE) newlines += 1;
  if (content.length === 0) return 0;
  return content[content.length - 1] === NEWLINE ? newlines : newlines + 1;
}

export type DocumentClass = "excluded" | "triggered" | "below" | "uncommitted" | "future";

export interface DocumentFacts {
  readonly path: string;
  readonly lines: number;
  /** Committer time (seconds) of the last useful edit; null before the first commit. */
  readonly lastUsefulEdit: number | null;
}

export function ageInDays(lastUsefulEdit: number, nowSeconds: number): number {
  return Math.floor((nowSeconds - lastUsefulEdit) / SECONDS_PER_DAY);
}

/** Outside the policy (ADRs): the one site that decides it. */
function isExcluded(path: string, policy: StalenessPolicy): boolean {
  // Case-insensitive like the `:(icase)` selection: a document selected under
  // DOCS/ADR/ is an ADR all the same.
  const folded = path.toLowerCase();
  return policy.excludedPrefixes.some((prefix) => folded.startsWith(prefix.toLowerCase()));
}

/** Both criteria must hold; ADRs never qualify; a date ahead of the clock has no age. */
export function classifyDocument(
  facts: DocumentFacts,
  policy: StalenessPolicy,
  nowSeconds: number,
): DocumentClass {
  if (isExcluded(facts.path, policy)) return "excluded";
  if (facts.lastUsefulEdit === null) return "uncommitted";
  if (facts.lastUsefulEdit - nowSeconds > policy.futureToleranceSeconds) return "future";
  const long = facts.lines > policy.maxLines;
  const old = ageInDays(facts.lastUsefulEdit, nowSeconds) > policy.maxAgeDays;
  return long && old ? "triggered" : "below";
}

export type EditLogRead =
  | { readonly ok: true; readonly edits: ReadonlyMap<string, number> }
  | { readonly ok: false; readonly reason: string };

const LOG_HEADER = /^([0-9a-f]{40}) (\d+)$/;

/**
 * Pure parse of `git log -z --format=%x01%H %ct --name-only`:
 * `\x01<sha> <time>\0\n<path>\0<path>\0`, repeated. Returns, per path, the
 * latest committer time among its useful commits, or the earliest among all
 * its commits when none is useful. The order of the records does not matter.
 */
export function parseUsefulEditLog(output: string, nonUseful: ReadonlySet<string>): EditLogRead {
  const useful = new Map<string, number>();
  const oldest = new Map<string, number>();
  if (output !== "" && !output.startsWith("\x01")) {
    return { ok: false, reason: "git log output does not start with a commit record" };
  }
  for (const record of output.split("\x01").slice(1)) {
    const headerEnd = record.indexOf("\0");
    const header = headerEnd < 0 ? record : record.slice(0, headerEnd);
    const match = header.match(LOG_HEADER);
    if (match === null) return { ok: false, reason: `unexpected git log record "${header}"` };
    const [, sha = "", time = ""] = match;
    const committedAt = Number(time);
    const paths = record
      .slice(headerEnd + 1)
      .replace(/^\n/, "")
      .split("\0")
      .filter((path) => path !== "");
    // Compared by date, not by position: git log walks the graph, and a commit
    // dated before its parent is listed after a newer-dated one.
    for (const path of paths) {
      oldest.set(path, Math.min(oldest.get(path) ?? committedAt, committedAt));
      if (!nonUseful.has(sha)) {
        useful.set(path, Math.max(useful.get(path) ?? committedAt, committedAt));
      }
    }
  }
  const edits = new Map(oldest);
  for (const [path, time] of useful) edits.set(path, time);
  return { ok: true, edits };
}

export interface TriggeredDocument {
  readonly path: string;
  readonly lines: number;
  readonly ageDays: number;
  readonly lastUsefulEdit: number;
}

export interface FutureDocument {
  readonly path: string;
  readonly lastUsefulEdit: number;
}

export interface AuditCounts {
  /** tracked = excluded + nonRegular + triggered + below + uncommitted + future */
  readonly tracked: number;
  readonly excluded: number;
  readonly nonRegular: number;
  readonly triggered: number;
  readonly below: number;
  readonly uncommitted: number;
  readonly future: number;
}

export type AuditRead =
  | {
      readonly ok: true;
      readonly triggered: readonly TriggeredDocument[];
      readonly future: readonly FutureDocument[];
      readonly counts: AuditCounts;
    }
  | { readonly ok: false; readonly reason: string };

const REGULAR_FILE_MODES: ReadonlySet<string> = new Set(["100644", "100755"]);
const STAGE_ENTRY = /^([0-7]{6}) ([0-9a-f]+) (\d)\t(.+)$/s;

/** One git process; stdout stays bytes because a blob's size is counted in bytes. */
export interface GitProcess {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

/** How git is run: `spawnGit` in the command, a runner with a pinned environment in tests. */
export type GitRunner = (argv: readonly string[], stdin?: Uint8Array) => GitProcess;

/** Run git with an argument vector, never through a shell. */
export function spawnGit(argv: readonly string[], stdin?: Uint8Array): GitProcess {
  const result = Bun.spawnSync(["git", ...argv], {
    stdin: stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function readText(git: GitRunner, argv: readonly string[], what: string): GitRead {
  const run = git(argv);
  if (run.exitCode !== 0) return { ok: false, reason: `could not ${what}: ${run.stderr.trim()}` };
  return { ok: true, stdout: new TextDecoder().decode(run.stdout) };
}

export type BlobLinesRead =
  | { readonly ok: true; readonly lines: ReadonlyMap<string, number> }
  | { readonly ok: false; readonly reason: string };

const BATCH_HEADER = /^([0-9a-f]+) (\S+) (\d+)$/;

/**
 * Pure parse of `git cat-file --batch` answering `requested`, in that order:
 * `<oid> blob <size>\n<size bytes>\n` per object. A missing object, another
 * type, a truncated body or trailing bytes are failures, never a zero.
 */
export function parseBlobBatch(output: Uint8Array, requested: readonly string[]): BlobLinesRead {
  const decoder = new TextDecoder();
  const lines = new Map<string, number>();
  let offset = 0;
  for (const objectId of requested) {
    const headerEnd = output.indexOf(NEWLINE, offset);
    if (headerEnd < 0) return { ok: false, reason: `cat-file stopped before ${objectId}` };
    const header = decoder.decode(output.subarray(offset, headerEnd));
    const match = header.match(BATCH_HEADER);
    if (match === null) return { ok: false, reason: `blob ${objectId} unreadable ("${header}")` };
    const [, id = "", type = "", size = ""] = match;
    if (id !== objectId) return { ok: false, reason: `cat-file answered ${id} for ${objectId}` };
    if (type !== "blob") {
      return { ok: false, reason: `object ${objectId} is a ${type}, not a blob` };
    }
    const start = headerEnd + 1;
    const end = start + Number(size);
    if (end >= output.length || output[end] !== NEWLINE) {
      return { ok: false, reason: `blob ${objectId} truncated in the cat-file output` };
    }
    lines.set(objectId, countLines(output.subarray(start, end)));
    offset = end + 1;
  }
  if (offset !== output.length) return { ok: false, reason: "cat-file printed more than asked" };
  return { ok: true, lines };
}

/** Read the tracked documents of `root` and their history; list the ones due for an audit. */
export function auditDocuments(
  root: string,
  policy: StalenessPolicy,
  nowSeconds: number,
  runner: GitRunner = spawnGit,
): AuditRead {
  const problems = validatePolicy(policy);
  if (problems.length > 0) return { ok: false, reason: `invalid policy: ${problems.join("; ")}` };
  const git = (argv: readonly string[], what: string): GitRead => readText(runner, argv, what);

  // ls-files prints paths relative to the current directory, log prints them
  // relative to the top: from a subdirectory no path would match, every
  // document would read as uncommitted, and the audit would pass over nothing.
  const prefix = git(["-C", root, "rev-parse", "--show-prefix"], "locate the root");
  if (!prefix.ok) return prefix;
  if (prefix.stdout.trim() !== "") {
    return {
      ok: false,
      reason: `${root} is not the top of its repository (prefix "${prefix.stdout.trim()}")`,
    };
  }

  const shallow = git(
    ["-C", root, "rev-parse", "--is-shallow-repository"],
    "tell whether the clone is shallow",
  );
  if (!shallow.ok) return shallow;
  if (shallow.stdout.trim() !== "false") {
    return {
      ok: false,
      reason:
        "shallow clone: ages read from a truncated history are wrong — fetch the full history first",
    };
  }

  const listed = git(
    ["-C", root, "ls-files", "-z", "-s", "--", policy.documentPathspec],
    "list tracked documents",
  );
  if (!listed.ok) return listed;
  const entries: { mode: string; objectId: string; path: string }[] = [];
  const unmerged = new Set<string>();
  for (const line of listed.stdout.split("\0").filter((entry) => entry !== "")) {
    const match = line.match(STAGE_ENTRY);
    if (match === null) return { ok: false, reason: `unexpected ls-files entry "${line}"` };
    const [, mode = "", objectId = "", stage = "", path = ""] = match;
    if (isAbsolute(path) || path.split("/").includes("..")) {
      return { ok: false, reason: `tracked path "${path}" leaves the repository root` };
    }
    // Stages 1-3 are the versions of a conflicted path: one path, up to three entries.
    if (stage !== "0") unmerged.add(path);
    else entries.push({ mode, objectId, path });
  }
  if (unmerged.size > 0) {
    return {
      ok: false,
      reason: `unmerged paths in the index (${[...unmerged].join(", ")}): resolve the merge first`,
    };
  }

  // A repository without a commit has no HEAD and no history: every tracked
  // document is uncommitted. Any other failure to read the log is a failure.
  const hasHead = git(["-C", root, "rev-parse", "--verify", "-q", "HEAD"], "resolve HEAD").ok;
  // One log over the whole pathspec rather than one per document: no N+1.
  const log = hasHead
    ? git(
        [
          "-C",
          root,
          "log",
          "-z",
          "--no-renames",
          "--format=%x01%H %ct",
          "--name-only",
          "HEAD",
          "--",
          policy.documentPathspec,
        ],
        "read the history of tracked documents",
      )
    : ({ ok: true, stdout: "" } as const);
  if (!log.ok) return log;
  const parsed = parseUsefulEditLog(
    log.stdout,
    new Set(policy.nonUsefulCommits.map((commit) => commit.sha)),
  );
  if (!parsed.ok) return parsed;

  const counts = {
    tracked: entries.length,
    excluded: 0,
    nonRegular: 0,
    triggered: 0,
    below: 0,
    uncommitted: 0,
    future: 0,
  };
  const readable: { objectId: string; path: string }[] = [];
  for (const { mode, objectId, path } of entries) {
    // Decided before the read: an ADR is never opened, so it cannot fail the run.
    if (isExcluded(path, policy)) counts.excluded += 1;
    // A symlink or a gitlink is not read through: the verdict would be about its target.
    else if (!REGULAR_FILE_MODES.has(mode)) counts.nonRegular += 1;
    else readable.push({ objectId, path });
  }

  // The tracked content, not the working tree: one cat-file for every blob, no N+1.
  const objectIds = [...new Set(readable.map((entry) => entry.objectId))];
  let blobLines: ReadonlyMap<string, number> = new Map();
  if (objectIds.length > 0) {
    const batch = runner(
      ["-C", root, "cat-file", "--batch"],
      new TextEncoder().encode(`${objectIds.join("\n")}\n`),
    );
    if (batch.exitCode !== 0) {
      return { ok: false, reason: `could not read tracked blobs: ${batch.stderr.trim()}` };
    }
    const read = parseBlobBatch(batch.stdout, objectIds);
    if (!read.ok) return read;
    blobLines = read.lines;
  }

  const triggered: TriggeredDocument[] = [];
  const future: FutureDocument[] = [];
  for (const { objectId, path } of readable) {
    const lines = blobLines.get(objectId);
    if (lines === undefined) return { ok: false, reason: `${path}: blob ${objectId} not read` };
    const facts: DocumentFacts = { path, lines, lastUsefulEdit: parsed.edits.get(path) ?? null };
    const verdict = classifyDocument(facts, policy, nowSeconds);
    counts[verdict] += 1;
    if (facts.lastUsefulEdit === null) continue;
    if (verdict === "future") future.push({ path, lastUsefulEdit: facts.lastUsefulEdit });
    if (verdict === "triggered") {
      triggered.push({
        path,
        lines: facts.lines,
        ageDays: ageInDays(facts.lastUsefulEdit, nowSeconds),
        lastUsefulEdit: facts.lastUsefulEdit,
      });
    }
  }
  return { ok: true, triggered, future, counts };
}

/**
 * Every entry of the archive root is a quarter or unexpected; every entry of a
 * quarter is a folder or loose: the counters sum to what was read.
 */
export interface ArchiveLayout {
  /** `<quarter>`, the root entries named `YYYY-Qn` that are directories. */
  readonly quarters: readonly string[];
  /** `<quarter>/<folder>` */
  readonly folders: readonly string[];
  /** `<quarter>/<file>`: an archived document laid without its folder, hence without its index. */
  readonly loose: readonly string[];
  /** Every file named as the migration index, anywhere under the root, relative to it. */
  readonly indexes: readonly string[];
  /** Entries at the root that are not quarter directories. */
  readonly unexpected: readonly string[];
}

export type ArchiveLayoutRead =
  | { readonly ok: true; readonly layout: ArchiveLayout }
  | { readonly ok: false; readonly reason: string };

const QUARTER = /^\d{4}-Q[1-4]$/;

/** Walk an archive root without following links; a link or an unreadable directory is a failure. */
export function readArchiveLayout(root: string, indexFileName: string): ArchiveLayoutRead {
  const quarters: string[] = [];
  const folders: string[] = [];
  const loose: string[] = [];
  const indexes: string[] = [];
  const unexpected: string[] = [];
  const walk = (relative: string): string | null => {
    const entries = readdirSync(join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) return `${child}: a link inside the archive tree is not followed`;
      if (entry.isDirectory()) {
        const failure = walk(child);
        if (failure !== null) return failure;
      } else if (entry.name === indexFileName) {
        indexes.push(child);
      }
    }
    return null;
  };
  try {
    if (!lstatSync(root).isDirectory()) return { ok: false, reason: `${root}: not a directory` };
    for (const quarter of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!quarter.isDirectory() || !QUARTER.test(quarter.name)) {
        unexpected.push(quarter.name);
        continue;
      }
      quarters.push(quarter.name);
      for (const folder of readdirSync(join(root, quarter.name), { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        // A link here is refused by the walk below; anything else that is not
        // a directory is an archive with no folder to hold its index.
        if (folder.isDirectory()) folders.push(`${quarter.name}/${folder.name}`);
        else loose.push(`${quarter.name}/${folder.name}`);
      }
    }
    const failure = walk("");
    if (failure !== null) return { ok: false, reason: failure };
  } catch (error) {
    return {
      ok: false,
      reason: `archive tree unreadable (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  return { ok: true, layout: { quarters, folders, loose, indexes, unexpected } };
}

export interface ArchiveParity {
  readonly folders: number;
  readonly indexes: number;
  readonly problems: readonly string[];
}

/** The archive counters, for the success line: an empty tree says it is empty. */
function describeArchiveLayout(layout: ArchiveLayout): string {
  return (
    `quarters=${layout.quarters.length} folders=${layout.folders.length} ` +
    `indexes=${layout.indexes.length} loose=${layout.loose.length} unexpected=${layout.unexpected.length}`
  );
}

/** Each archive folder holds exactly its own index, and no index lies elsewhere. */
export function compareArchiveParity(layout: ArchiveLayout, indexFileName: string): ArchiveParity {
  const problems: string[] = [];
  const expected = new Set(layout.folders.map((folder) => `${folder}/${indexFileName}`));
  for (const folder of layout.folders) {
    if (!layout.indexes.includes(`${folder}/${indexFileName}`))
      problems.push(`${folder}: archive without migration index`);
  }
  for (const index of layout.indexes) {
    if (!expected.has(index)) problems.push(`${index}: migration index outside an archive folder`);
  }
  for (const file of layout.loose)
    problems.push(`${file}: archived file outside an archive folder`);
  for (const entry of layout.unexpected)
    problems.push(`${entry}: not a quarter directory (YYYY-Qn)`);
  return { folders: layout.folders.length, indexes: layout.indexes.length, problems };
}

function parseArguments(argv: readonly string[]): { archives: string | null } | null {
  if (argv.length === 0) return { archives: null };
  if (argv.length === 2 && argv[0] === "--archives" && argv[1] !== undefined && argv[1] !== "") {
    return { archives: argv[1] };
  }
  return null;
}

if (import.meta.main) {
  const gate = "Document staleness";
  const args = parseArguments(process.argv.slice(2));
  if (args === null) {
    console.error(
      `${gate}: usage: bun tools/quality/check-document-staleness.ts [--archives <dir>]`,
    );
    process.exit(2);
  }
  const top = readGit(["rev-parse", "--show-toplevel"], "find the repository root");
  if (!top.ok) {
    console.error(`${gate}: ${top.reason}`);
    process.exit(1);
  }
  const report = new GateReport();
  const volume: string[] = [];
  const audit = auditDocuments(top.stdout.trim(), STALENESS_POLICY, Math.floor(Date.now() / 1000));
  if (!audit.ok) {
    report.check("documents", false, audit.reason);
  } else {
    for (const document of audit.triggered) {
      report.check(
        document.path,
        false,
        `${document.lines} lines, no useful edit for ${document.ageDays} days (since ` +
          `${new Date(document.lastUsefulEdit * 1000).toISOString()}) — audit it: migrate, archive with a migration index, or reconfirm`,
      );
    }
    for (const document of audit.future) {
      report.check(
        document.path,
        false,
        `last useful edit dated ${new Date(document.lastUsefulEdit * 1000).toISOString()}, more than ` +
          `${STALENESS_POLICY.futureToleranceSeconds} s ahead of now — its age cannot be read; check the committer clock`,
      );
    }
    const { counts } = audit;
    // Printed on success as the volume, and on failure inside the failed check:
    // a red run says what it examined as much as a green one.
    const examined =
      `tracked=${counts.tracked} excluded=${counts.excluded} non-regular=${counts.nonRegular} ` +
      `triggered=${counts.triggered} below=${counts.below} uncommitted=${counts.uncommitted} ` +
      `future=${counts.future} ` +
      `(thresholds: more than ${STALENESS_POLICY.maxLines} lines and ${STALENESS_POLICY.maxAgeDays} days)`;
    report.check(
      "documents",
      counts.tracked > 0 && counts.triggered === 0 && counts.future === 0,
      counts.tracked === 0
        ? `no tracked document matches ${STALENESS_POLICY.documentPathspec}`
        : examined,
    );
    volume.push(examined);
  }
  if (args.archives !== null) {
    const layout = readArchiveLayout(args.archives, STALENESS_POLICY.migrationIndexFileName);
    if (!layout.ok) {
      report.check("archives", false, layout.reason);
    } else {
      const parity = compareArchiveParity(layout.layout, STALENESS_POLICY.migrationIndexFileName);
      for (const problem of parity.problems) report.check("archives", false, problem);
      // An empty archive tree is legitimate (nothing archived yet): it passes,
      // and its zero counters stand on the success line rather than in a note.
      const archived = describeArchiveLayout(layout.layout);
      report.check("archives", parity.problems.length === 0, archived);
      volume.push(`archives: ${archived}`);
    }
  }
  if (volume.length > 0) report.volume(volume.join("; "));
  concludeGate(gate, report);
}
