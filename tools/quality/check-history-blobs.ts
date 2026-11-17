/**
 * Read-only audits of a repository fleet: heavy objects in history, and
 * project names that name a tool instead of a function.
 *
 *   bun tools/quality/check-history-blobs.ts blobs <repository> [threshold-bytes]
 *   <inventory> | bun tools/quality/check-history-blobs.ts names [--json] [--strict]
 *
 * `blobs` clones the repository as a mirror into a temporary directory, lists
 * the objects of history above the threshold, and recommends what to do with
 * them. Nothing is modified: the source is only read, the clone is removed on
 * every exit path, and nothing is rewritten — a history rewrite is recommended,
 * never performed.
 *
 * Coverage of `blobs`, printed with every report: every object of the mirror's
 * store is examined (packed and loose, reachable or not); the path is the one
 * history gives, and an object no ref reaches is listed as "(unreachable)". A
 * clone from a local path copies the source's whole object store; a clone over
 * a transport (file://, https, ssh) receives only what the refs reach, so the
 * source's unreachable objects are out of sight there. Large file storage
 * content is never covered, only its pointers: when a `.gitattributes` of
 * history declares `filter=lfs`, the report says so. A mirror holding no object
 * at all is exit 2, not an empty green.
 *
 * `names` reads an inventory of group and project paths, one per line, on
 * standard input, and flags every path having a SEGMENT equal to a tool name.
 * Segments are separated by slash, hyphen, underscore and dot.
 * The convention is to name what a thing does, not the tool that does it. The
 * inventory comes from the caller on purpose: a tool that listed groups itself
 * would inherit the forge's page size, and an inventory larger than one page is
 * truncated without a word. An empty inventory is a failure here, not a green:
 * it is what a truncated or failed listing looks like from this side.
 *
 * Known gap: the name list and its path exceptions are the constant
 * DEFAULT_NAME_RULES; the command line takes neither, so an exception is a code
 * change. `parseNameRules` validates the shape a future `--rules` file would take.
 *
 * Exit codes: 0 report produced (and, with --strict, no violation), 1 --strict
 * with at least one violation, 2 usage error, unreadable source, or nothing
 * examined.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HARDENING_FLAGS, hardenedGitEnvironment } from "./check-pinned-citations";

const MIB = 1024 * 1024;
export const DEFAULT_THRESHOLD = 5 * MIB;
const REWRITE_ABOVE = 50 * MIB;
const RECURRING_VERSIONS = 50;
const TOP_BLOBS = 30;
const TOP_SEGMENTS = 10;
/** Media, fonts and documents: payload that an object store serves better than a history does. */
const STATIC_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "mp4",
  "mov",
  "webm",
  "mp3",
  "wav",
  "pdf",
  "woff",
  "woff2",
  "ttf",
]);

// ---------------------------------------------------------------- names ----

export interface NameRules {
  tools: string[];
  exceptions: string[];
}

export interface NameViolation {
  path: string;
  tool: string;
}

export interface NamesReport {
  examined: number;
  exempted: number;
  clean: number;
  flagged: number;
  violations: NameViolation[];
}

/**
 * The list is code, not a data file: a data file would join the repository's
 * data-file inventory and its gate, which is a decision of the owner. Exceptions
 * are full paths, rare, each one a naming debt acknowledged.
 */
export const DEFAULT_NAME_RULES: NameRules = {
  tools: [
    // orchestrators
    "kubernetes",
    "k8s",
    "nomad",
    "airflow",
    "argo",
    // databases
    "postgres",
    "postgresql",
    "mysql",
    "mariadb",
    "mongodb",
    "redis",
    "sqlite",
    "clickhouse",
    // forges and infrastructure
    "gitlab",
    "github",
    "gitea",
    "terraform",
    "ansible",
    "docker",
    // languages and runtimes
    "rust",
    "python",
    "golang",
    "typescript",
    "java",
    "node",
    "nodejs",
    "bun",
    "deno",
    // observability
    "grafana",
    "prometheus",
    "loki",
    "jaeger",
  ],
  exceptions: [],
};

export function parseNameRules(value: unknown): NameRules {
  if (typeof value !== "object" || value === null) throw new Error("rules: not an object");
  const { tools, exceptions } = value as Record<string, unknown>;
  if (!Array.isArray(tools) || tools.length === 0) throw new Error("rules: tools is empty");
  if (!Array.isArray(exceptions)) throw new Error("rules: exceptions is not an array");
  const parsedTools = tools.map((tool) => {
    // A tool holding a separator could never equal a single segment.
    if (typeof tool !== "string" || !/^[A-Za-z0-9]+$/.test(tool)) {
      throw new Error(`rules: tool ${JSON.stringify(tool)} must be one word of letters and digits`);
    }
    return tool.toLowerCase();
  });
  const parsedExceptions = exceptions.map((path) => {
    if (typeof path !== "string" || path === "") throw new Error("rules: exception is not a path");
    return path;
  });
  return { tools: parsedTools, exceptions: parsedExceptions };
}

export function auditNames(paths: readonly string[], rules: NameRules): NamesReport {
  const tools = new Set(rules.tools);
  const exceptions = new Set(rules.exceptions.map((path) => path.toLowerCase()));
  const violations: NameViolation[] = [];
  let exempted = 0;
  let clean = 0;
  let flagged = 0;
  for (const path of paths) {
    if (exceptions.has(path.toLowerCase())) {
      exempted += 1;
      continue;
    }
    const found = new Set<string>();
    for (const segment of path.toLowerCase().split(/[/_.-]/)) {
      if (tools.has(segment)) found.add(segment);
    }
    if (found.size === 0) {
      clean += 1;
      continue;
    }
    flagged += 1;
    for (const tool of found) violations.push({ path, tool });
  }
  return { examined: paths.length, exempted, clean, flagged, violations };
}

// ---------------------------------------------------------------- blobs ----

export interface BlobEntry {
  sha: string;
  size: number;
  path: string;
}

export interface SegmentShare {
  segment: string;
  count: number;
  bytes: number;
}

export interface BlobReport {
  threshold: number;
  total: number;
  top: BlobEntry[];
  bySegment: SegmentShare[];
  recommendations: string[];
}

/** What the listing saw: the counters sum, examined = reachable + unreachable. */
export interface HistoryCoverage {
  examined: number;
  reachable: number;
  unreachable: number;
  blobs: number;
  /** Versions of a `.gitattributes` in history that declare `filter=lfs`. */
  lfsAttributes: number;
}

export interface HistoryReport extends BlobReport {
  coverage: HistoryCoverage;
}

/** Path given to an object that no ref reaches: history does not name it. */
export const UNREACHABLE_PATH = "(unreachable)";

export function parseThreshold(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_THRESHOLD;
  const value = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(value)) {
    throw new Error(`threshold must be a positive integer of bytes, got ${JSON.stringify(raw)}`);
  }
  return value;
}

export function analyzeBlobs(entries: readonly BlobEntry[], threshold: number): BlobReport {
  const above = entries
    .filter((entry) => entry.size > threshold)
    .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));

  const shares = new Map<string, SegmentShare>();
  const versions = new Map<string, number>();
  for (const entry of above) {
    const unreachable = entry.path === UNREACHABLE_PATH;
    const slash = entry.path.indexOf("/");
    const segment = unreachable
      ? UNREACHABLE_PATH
      : slash === -1
        ? "."
        : entry.path.slice(0, slash);
    const share = shares.get(segment) ?? { segment, count: 0, bytes: 0 };
    share.count += 1;
    share.bytes += entry.size;
    shares.set(segment, share);
    // Unrelated unreachable objects share the marker, not a path: never versions of one file.
    if (!unreachable) versions.set(entry.path, (versions.get(entry.path) ?? 0) + 1);
  }
  const bySegment = [...shares.values()]
    .sort((a, b) => b.bytes - a.bytes || a.segment.localeCompare(b.segment))
    .slice(0, TOP_SEGMENTS);

  const recommendations: string[] = [];
  if (above.some((entry) => entry.size > REWRITE_ABOVE)) {
    recommendations.push(
      "An object above 50 MiB weighs on every clone: a history rewrite is recommended (not performed by this audit).",
    );
  }
  if ([...versions.values()].some((count) => count >= RECURRING_VERSIONS)) {
    recommendations.push(
      `A path with ${RECURRING_VERSIONS} versions or more above the threshold: move it to large file storage.`,
    );
  }
  if (
    above.some((entry) => STATIC_EXTENSIONS.has(entry.path.split(".").pop()?.toLowerCase() ?? ""))
  ) {
    recommendations.push("Static resources (media, fonts, documents) belong in object storage.");
  }

  return {
    threshold,
    total: above.length,
    top: above.slice(0, TOP_BLOBS),
    bySegment,
    recommendations,
  };
}

/** Output of `rev-list --objects --all`: every reachable object, with its path when it has one. */
function parseReachable(output: string): Map<string, string> {
  const reachable = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = /^([0-9a-f]{40,64})(?: (.*))?$/.exec(line);
    if (match?.[1] === undefined) continue;
    if (!reachable.has(match[1])) reachable.set(match[1], match[2] ?? "");
  }
  return reachable;
}

/** Output of `cat-file --batch-all-objects --batch-check`: every object of the store. */
function parseStoreLines(output: string): { type: string; size: number; sha: string }[] {
  const objects: { type: string; size: number; sha: string }[] = [];
  for (const line of output.split("\n")) {
    if (line === "") continue;
    const match = /^([a-z]+) (\d+) ([0-9a-f]{40,64})$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
      // An unparsed line would be an object neither counted nor examined.
      throw new Error("cat-file returned a line that is not an object");
    }
    objects.push({ type: match[1], size: Number(match[2]), sha: match[3] });
  }
  return objects;
}

/** An attribute line (not a comment) that sets the lfs filter on a pattern. */
const LFS_FILTER = /^[^#\n]*\sfilter=lfs(\s|$)/m;

/** Output of `cat-file --batch`: counts the contents that declare `filter=lfs`. */
function countLfsDeclarations(output: Buffer): number {
  let count = 0;
  let offset = 0;
  while (offset < output.length) {
    const eol = output.indexOf(0x0a, offset);
    if (eol === -1) break;
    const header = output.subarray(offset, eol).toString("utf8");
    const match = /^[0-9a-f]{40,64} [a-z]+ (\d+)$/.exec(header);
    if (match?.[1] === undefined) throw new Error("cat-file returned an unexpected header");
    const size = Number(match[1]);
    const content = output.subarray(eol + 1, eol + 1 + size).toString("utf8");
    if (LFS_FILTER.test(content)) count += 1;
    offset = eol + 1 + size + 1;
  }
  return count;
}

// Same hardening as the citation resolver (no user or system config, no prompt,
// transport list). Only these transports clone: `ext::` and its kin run commands.
// HOME and SSH_AUTH_SOCK are kept on purpose: a private repository over ssh needs
// the caller's key and known_hosts; BatchMode keeps a host-key question from blocking.
const GIT_ENV_KEYS = ["SSH_AUTH_SOCK", "TMPDIR"];
export const GIT_FLAGS: readonly string[] = HARDENING_FLAGS.filter((flag) => flag !== "-c");
export const GIT_TIMEOUT_MS = 600_000;

export function gitEnvironment(): Record<string, string> {
  const env: Record<string, string> = {
    ...hardenedGitEnvironment(process.env.HOME ?? tmpdir(), "file:https:ssh"),
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
  };
  for (const key of GIT_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Runs git without a shell, arguments as an array. The error carries the exit
 * code only: git's stderr can echo a remote URL, and a URL can hold credentials.
 */
async function git(args: string[], input?: string): Promise<string> {
  return (await gitBytes(args, input)).toString("utf8");
}

/** Same as `git`, raw bytes: `cat-file --batch` sizes count bytes, not characters. */
async function gitBytes(args: string[], input?: string): Promise<Buffer> {
  const hardening = GIT_FLAGS.flatMap((flag) => ["-c", flag]);
  const child = spawn("git", [...hardening, ...args], {
    env: gitEnvironment(),
    stdio: ["pipe", "pipe", "ignore"],
    timeout: GIT_TIMEOUT_MS,
  });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stdin.on("error", () => {
    // A git that exits before reading its input reports through the exit code.
  });
  child.stdin.end(input ?? "");
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`git ${args[0] ?? ""} failed (exit ${code ?? "signal"})`);
  return Buffer.concat(chunks);
}

export async function listHistoryBlobs(
  repository: string,
  threshold: number,
  workParent: string = tmpdir(),
): Promise<HistoryReport> {
  // A leading dash would be read by git as an option, a control character has no
  // place in a location; neither is a repository.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (repository === "" || repository.startsWith("-") || /[\u0000-\u001f]/.test(repository)) {
    throw new Error("invalid repository argument");
  }
  const dir = mkdtempSync(join(workParent, "history-blobs-"));
  try {
    const mirror = join(dir, "mirror.git");
    await git(["clone", "--mirror", "--quiet", "--", repository, mirror]);
    // Paths come from history; the objects themselves come from the whole store,
    // so that a packed or loose object no ref reaches is examined too.
    const reachable = parseReachable(await git(["-C", mirror, "rev-list", "--objects", "--all"]));
    const store = parseStoreLines(
      await git([
        "-C",
        mirror,
        "cat-file",
        "--batch-all-objects",
        "--batch-check=%(objecttype) %(objectsize) %(objectname)",
      ]),
    );
    const entries: BlobEntry[] = [];
    const attributes = new Set<string>();
    let unreachable = 0;
    for (const object of store) {
      const path = reachable.get(object.sha);
      if (path === undefined) unreachable += 1;
      if (object.type !== "blob") continue;
      entries.push({ sha: object.sha, size: object.size, path: path ?? UNREACHABLE_PATH });
      if (path !== undefined && (path === ".gitattributes" || path.endsWith("/.gitattributes"))) {
        attributes.add(object.sha);
      }
    }
    const lfsAttributes =
      attributes.size === 0
        ? 0
        : countLfsDeclarations(
            await gitBytes(
              ["-C", mirror, "cat-file", "--batch"],
              `${[...attributes].join("\n")}\n`,
            ),
          );
    return {
      ...analyzeBlobs(entries, threshold),
      coverage: {
        examined: store.length,
        reachable: store.length - unreachable,
        unreachable,
        blobs: entries.length,
        lfsAttributes,
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ CLI ----

export interface RunResult {
  code: number;
  out: string;
  err: string;
}

const USAGE = "usage: blobs <repository> [threshold-bytes] | names [--json] [--strict]";
const INVENTORY_PATH = /^[A-Za-z0-9._/-]+$/;

/**
 * A path from a repository is data: no control character may reach a terminal.
 * Replaced: C0, DEL and C1 controls (Cc, U+009B is a terminal's CSI), format
 * characters (Cf: bidi embeddings, overrides and isolates, direction marks,
 * zero-width characters), and the line and paragraph separators (Zl, Zp).
 */
export function printable(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "?");
}

function usageError(message: string): RunResult {
  return { code: 2, out: "", err: `${message}\n${USAGE}\n` };
}

async function runNames(args: string[], readStdin: () => Promise<string>): Promise<RunResult> {
  const known = new Set(["--json", "--strict"]);
  const unknown = args.find((arg) => !known.has(arg));
  if (unknown !== undefined) return usageError(`unknown argument ${printable(unknown)}`);
  const json = args.includes("--json");
  const strict = args.includes("--strict");

  const rules = parseNameRules(DEFAULT_NAME_RULES);

  const paths = (await readStdin())
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (paths.length === 0) {
    return { code: 2, out: "", err: "inventory is empty: nothing was examined\n" };
  }
  const bad = paths.find((path) => !INVENTORY_PATH.test(path));
  if (bad !== undefined) {
    return {
      code: 2,
      out: "",
      err: `inventory holds a line that is not a path: ${printable(bad)}\n`,
    };
  }

  const report = auditNames(paths, rules);
  const counters =
    `paths=${report.examined} exempted=${report.exempted} clean=${report.clean} ` +
    `flagged=${report.flagged} violations=${report.violations.length}\n`;
  const code = strict && report.violations.length > 0 ? 1 : 0;
  if (json) {
    return { code, out: `${JSON.stringify(report.violations, null, 2)}\n`, err: counters };
  }
  const lines = report.violations.map((v) => `${v.path}: ${v.tool}\n`);
  return { code, out: `${lines.join("")}${counters}`, err: "" };
}

async function runBlobs(args: string[]): Promise<RunResult> {
  const [repository, rawThreshold, ...extra] = args;
  if (repository === undefined || extra.length > 0) return usageError("blobs takes a repository");
  let report: HistoryReport;
  try {
    report = await listHistoryBlobs(repository, parseThreshold(rawThreshold));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { code: 2, out: "", err: `${printable(reason)}\n` };
  }
  const { coverage } = report;
  const examined =
    `objects examined=${coverage.examined} reachable=${coverage.reachable} ` +
    `unreachable=${coverage.unreachable} blobs=${coverage.blobs}`;
  if (coverage.examined === 0) {
    // An empty store and a clean one would otherwise print the same report.
    return {
      code: 2,
      out: "",
      err: `${examined}: the clone holds no object, nothing was examined\n`,
    };
  }
  const lines = [
    examined,
    "coverage: a local path copies the whole object store; a transport (file://, https, ssh) sends only what the refs reach",
    coverage.lfsAttributes > 0
      ? `lfs: filter=lfs declared in ${coverage.lfsAttributes} .gitattributes version(s): large file storage content is not covered, only its pointers`
      : "lfs: no filter=lfs in the .gitattributes of history",
    `threshold=${report.threshold} bytes, objects above=${report.total}, listed=${report.top.length}`,
    ...report.top.map((b) => `${b.size}\t${b.sha.slice(0, 12)}\t${printable(b.path)}`),
    "by first path segment:",
    ...report.bySegment.map((s) => `${s.bytes}\t${s.count}\t${printable(s.segment)}`),
    "recommendations:",
    ...(report.recommendations.length === 0 ? ["none"] : report.recommendations),
  ];
  return { code: 0, out: `${lines.join("\n")}\n`, err: "" };
}

export async function run(argv: string[], readStdin: () => Promise<string>): Promise<RunResult> {
  const [command, ...args] = argv;
  try {
    if (command === "names") return await runNames(args, readStdin);
    if (command === "blobs") return await runBlobs(args);
  } catch (error) {
    // A broken source is exit 2, never the exit 1 of --strict with a violation.
    const reason = error instanceof Error ? error.message : String(error);
    return { code: 2, out: "", err: `${printable(reason)}\n` };
  }
  return usageError(command === undefined ? "missing command" : "unknown command");
}

if (import.meta.main) {
  const result = await run(process.argv.slice(2), () => Bun.stdin.text());
  process.stdout.write(result.out);
  process.stderr.write(result.err);
  process.exit(result.code);
}
