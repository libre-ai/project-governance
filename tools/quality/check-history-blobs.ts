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
 * `names` reads an inventory of group and project paths, one per line, on
 * standard input, and flags every path having a SEGMENT equal to a tool name.
 * The convention is to name what a thing does, not the tool that does it. The
 * inventory comes from the caller on purpose: a tool that listed groups itself
 * would inherit the forge's page size, and an inventory larger than one page is
 * truncated without a word. An empty inventory is a failure here, not a green:
 * it is what a truncated or failed listing looks like from this side.
 *
 * Exit codes: 0 report produced (and, with --strict, no violation), 1 --strict
 * with at least one violation, 2 usage error or unreadable source.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    for (const segment of path.toLowerCase().split(/[/_-]/)) {
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
    const slash = entry.path.indexOf("/");
    const segment = slash === -1 ? "." : entry.path.slice(0, slash);
    const share = shares.get(segment) ?? { segment, count: 0, bytes: 0 };
    share.count += 1;
    share.bytes += entry.size;
    shares.set(segment, share);
    versions.set(entry.path, (versions.get(entry.path) ?? 0) + 1);
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

/** Output of `cat-file --batch-check` fed with `rev-list --objects`: blobs only. */
function parseBlobLines(output: string): BlobEntry[] {
  const entries: BlobEntry[] = [];
  for (const line of output.split("\n")) {
    const match = /^blob (\d+) ([0-9a-f]{40,64}) (.+)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) continue;
    entries.push({ sha: match[2], size: Number(match[1]), path: match[3] });
  }
  return entries;
}

// Only these transports clone: `ext::` and its kin run commands.
const GIT_ENV_KEYS = ["PATH", "HOME", "SSH_AUTH_SOCK", "TMPDIR"];

function gitEnvironment(): Record<string, string> {
  const env: Record<string, string> = {
    GIT_ALLOW_PROTOCOL: "file:https:ssh",
    GIT_TERMINAL_PROMPT: "0",
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
  const child = spawn("git", args, { env: gitEnvironment(), stdio: ["pipe", "pipe", "ignore"] });
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
  return Buffer.concat(chunks).toString("utf8");
}

export async function listHistoryBlobs(
  repository: string,
  threshold: number,
  workParent: string = tmpdir(),
): Promise<BlobReport> {
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
    const objects = await git(["-C", mirror, "rev-list", "--objects", "--all"]);
    const checked = await git(
      ["-C", mirror, "cat-file", "--batch-check=%(objecttype) %(objectsize) %(objectname) %(rest)"],
      // The sha leads each line; `%(rest)` hands back the path that follows it.
      objects,
    );
    return analyzeBlobs(parseBlobLines(checked), threshold);
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

/** A path from a repository is data: no control character may reach a terminal. */
function printable(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: neutralising control characters is the point
  return text.replace(/[\u0000-\u001f\u007f]/g, "?");
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
  let report: BlobReport;
  try {
    report = await listHistoryBlobs(repository, parseThreshold(rawThreshold));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { code: 2, out: "", err: `${printable(reason)}\n` };
  }
  const lines = [
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
  if (command === "names") return runNames(args, readStdin);
  if (command === "blobs") return runBlobs(args);
  return usageError(command === undefined ? "missing command" : "unknown command");
}

if (import.meta.main) {
  const result = await run(process.argv.slice(2), () => Bun.stdin.text());
  process.stdout.write(result.out);
  process.stderr.write(result.err);
  process.exit(result.code);
}
