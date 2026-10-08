/**
 * A ref supplied to a request is resolved, never written down.
 *
 * On 2026-10-07/08 one disease produced three symptoms that were first treated
 * separately. Eight gates and tools asked GitHub for a branch they had written
 * into themselves — in the REST contents ref parameter, as a GraphQL expression
 * prefix, in a tree path, in a compare range — while nineteen of the fleet's
 * repositories serve `migrate/recover-code`, whose documentary default branch
 * carries three commits. Measured on one destination's card: the written form
 * answers null where the resolved form answers 8153 bytes.
 *
 * These forms are described here rather than quoted, and that is not
 * fastidiousness: this guard scans its own file, and quoting them made it report
 * its own documentation. A guard that must exempt itself to pass has a blind spot
 * shaped like itself.
 *
 * One of those gates then reported
 * "Fleet pins verified: 2 assertion(s) hold" over a fleet carrying twenty-four
 * drifts, three of them pins on the authority a deletion was about to remove.
 * Five workflows carried `branches: [main]` and so attached no verdict to any
 * merged head. ADR-0041 §7 records the class; this guard is its hard backstop,
 * because a rule that is only written gets missed on the seventh site.
 *
 * WHAT IT REFUSES is narrow on purpose, and the scope is the argument:
 *
 *   - Only a ref handed to a REQUEST — a REST `?ref=`, a GraphQL `<branch>:`
 *     expression, a `trees/<branch>` path, a `compare/…<branch>` range, an
 *     action pinned `@<branch>`. A branch name in prose, in a variable, or in a
 *     message is not a request and is not this guard's business.
 *   - Only in NON-TEST source. A test whose object is the pattern must contain
 *     the pattern: the assertion that locks a fix in place has to name the form
 *     it forbids, and a guard that flagged it would be refusing its own
 *     guardrail. Fixtures are excluded for the same reason —
 *     `rev = "main"` in a patch-rev fixture is the input being refused.
 *
 * Measured before landing: across 257 files in eight roots, the narrow patterns
 * match twice, both on the archived hub, and the broad ones match seventy-nine
 * times of which the overwhelming majority is prose about this very defect. A
 * guard needing seventy allowances is noise; this one needs the two it names.
 *
 * THE EXCEPTION, and its form: a line may carry `allow-hardcoded-ref: <reason>`
 * — the reason is required, because an exception without one is a silent
 * allowance, and the whole point of this guard is that silence is the defect.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Roots that carry gates, tooling and workflows — the surfaces that make requests. */
export const SCANNED_ROOTS = [
  "ecosystem",
  "tools",
  "crates",
  ".github/workflows",
  "distribution",
  "verification",
  "brand",
  "packages",
] as const;

/**
 * Branch names a repository may serve by default. The guard refuses them as
 * written refs; it says nothing about any other branch name, because a feature
 * branch written into a request is a different mistake with a different fix.
 */
export const DEFAULT_BRANCH_NAMES = ["main", "master"] as const;

export const ALLOWANCE_MARKER = "allow-hardcoded-ref:";

const BRANCHES = DEFAULT_BRANCH_NAMES.join("|");

export interface RefPattern {
  readonly id: string;
  readonly pattern: RegExp;
  readonly says: string;
}

/**
 * Each pattern is a ref travelling INTO a request. The resolution that replaces
 * it is named, so a failure tells the reader what to write instead.
 */
export const REF_PATTERNS: readonly RefPattern[] = [
  {
    id: "rest-ref-query",
    pattern: new RegExp(String.raw`\?ref=(?:${BRANCHES})\b`),
    says: "omit `?ref=` — the REST contents endpoint then serves the repository's own default branch",
  },
  {
    id: "graphql-expression",
    pattern: new RegExp(String.raw`expression:\s*["'\`](?:${BRANCHES}):`),
    says: "use `HEAD:<path>` — it resolves whatever branch the repository serves",
  },
  {
    id: "tree-path",
    pattern: new RegExp(String.raw`/(?:git/)?trees/(?:${BRANCHES})\b`),
    says: "use `trees/HEAD`",
  },
  {
    id: "compare-range",
    pattern: new RegExp(String.raw`/compare/[^"'\`\s]*\.\.\.(?:${BRANCHES})\b`),
    says: "compare against the repository's `default_branch`, read from its own metadata",
  },
  {
    id: "action-branch-pin",
    pattern: new RegExp(String.raw`uses:\s*[\w.-]+/[\w.-]+(?:/[^@\s]+)?@(?:${BRANCHES})\b`),
    says: "pin a reusable workflow or action by sha, never by branch",
  },
] as const;

export interface RefFinding {
  readonly file: string;
  readonly line: number;
  readonly id: string;
  readonly says: string;
  readonly text: string;
}

export interface RefScan {
  readonly filesScanned: number;
  readonly findings: readonly RefFinding[];
  /** Lines that matched but carried a reasoned allowance — counted, never hidden. */
  readonly allowed: readonly RefFinding[];
}

/** A test, or a fixture, whose object is the pattern itself. */
export function isPatternSubject(path: string): boolean {
  return (
    /\.test\.[cm]?[jt]s$/.test(path) ||
    path.includes("/tests/") ||
    path.includes("/fixtures/") ||
    path.includes("/__fixtures__/")
  );
}

const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".cjs",
  ".mjs",
  ".sh",
  ".py",
  ".yml",
  ".yaml",
]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", "target", ".git", "dist", "build"]);

export function isScannedFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return SCANNED_EXTENSIONS.has(path.slice(dot));
}

/** The whole decision as a pure function, so every branch is tested without a filesystem. */
export function scanForWrittenRefs(
  files: readonly { readonly path: string; readonly text: string }[],
): RefScan {
  const findings: RefFinding[] = [];
  const allowed: RefFinding[] = [];
  let filesScanned = 0;
  for (const file of files) {
    if (!isScannedFile(file.path) || isPatternSubject(file.path)) continue;
    filesScanned += 1;
    const lines = file.text.split("\n");
    for (const [index, line] of lines.entries()) {
      for (const { id, pattern, says } of REF_PATTERNS) {
        if (!pattern.test(line)) continue;
        const finding: RefFinding = {
          file: file.path,
          line: index + 1,
          id,
          says,
          text: line.trim(),
        };
        // An allowance must state a reason on the same line. A bare marker is
        // exactly the silent exception this guard exists to refuse.
        const marker = line.indexOf(ALLOWANCE_MARKER);
        const reason = marker === -1 ? "" : line.slice(marker + ALLOWANCE_MARKER.length).trim();
        if (reason.length > 0) allowed.push(finding);
        else findings.push(finding);
      }
    }
  }
  return { filesScanned, findings, allowed };
}

/**
 * A workflow that filters `on: push: branches:` must list the branch the
 * repository serves, or it attaches no verdict to a merged head. Five workflows
 * of this repository carried `[main]` alone and had zero push runs on
 * `migrate/recover-code` — every run was a pull_request.
 */
export function findWorkflowsMissingServedBranch(
  workflows: readonly { readonly path: string; readonly text: string }[],
  servedBranch: string,
): readonly string[] {
  const missing: string[] = [];
  for (const workflow of workflows) {
    const match = /^\s*branches:\s*\[([^\]]*)\]/m.exec(workflow.text);
    if (match === null) continue;
    const listed = (match[1] ?? "")
      .split(",")
      .map((name) => name.trim().replace(/^["']|["']$/g, ""));
    if (!listed.includes(servedBranch)) missing.push(workflow.path);
  }
  return missing;
}

/**
 * The branch the REPOSITORY serves, never the branch this checkout happens to be
 * on.
 *
 * The first form of this function asked `git symbolic-ref --short HEAD`, which is
 * the local branch name. On a working branch it reported that branch and flagged
 * every workflow in the repository; on a pull-request checkout, where HEAD is a
 * detached merge ref, it would have reported nothing. It was right only in the one
 * case where the checkout sits on the served branch — this guard committing the
 * very substitution it refuses, found by running it.
 *
 * `refs/remotes/origin/HEAD` is the resolution: a clone sets it, it costs no
 * network and no quota, and it names the remote's default branch rather than a
 * local state. `ls-remote --symref` is the fallback — network, but quota-free, the
 * same escape the orphan-rev gate uses. When neither answers, the workflow
 * assertion is SKIPPED with its reason rather than run against a guess: a finding
 * derived from an unknown branch would be worse than no finding.
 */
export function resolveServedBranch(): string | null {
  const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes).trim();

  const local = Bun.spawnSync(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (local.exitCode === 0) {
    const name = decode(local.stdout);
    const slash = name.indexOf("/");
    if (slash !== -1) return name.slice(slash + 1);
  }

  const remote = Bun.spawnSync(["git", "ls-remote", "--symref", "origin", "HEAD"]);
  if (remote.exitCode === 0) {
    const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(decode(remote.stdout));
    const branch = match?.[1];
    if (branch !== undefined && branch.length > 0) return branch;
  }

  return null;
}

function collect(root: string, into: { path: string; text: string }[]): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return; // A root a repository does not carry is not a defect.
  }
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collect(path, into);
      continue;
    }
    if (!isScannedFile(path)) continue;
    into.push({ path, text: readFileSync(path, "utf8") });
  }
}

if (import.meta.main) {
  const files: { path: string; text: string }[] = [];
  for (const root of SCANNED_ROOTS) collect(root, files);

  const scan = scanForWrittenRefs(files);

  const workflows = files.filter((file) => file.path.startsWith(".github/workflows/"));
  const servedBranch = resolveServedBranch();
  const missing =
    servedBranch === null ? [] : findWorkflowsMissingServedBranch(workflows, servedBranch);

  const { concludeGate, GateReport } = await import("./gate-report");
  const report = new GateReport();

  for (const finding of scan.findings) {
    report.check(
      `${finding.file}:${finding.line}`,
      false,
      `${finding.id}: a ref is written down where it must be resolved — ${finding.says} (or annotate the line \`${ALLOWANCE_MARKER} <reason>\`)`,
    );
  }
  for (const path of missing) {
    report.check(
      path,
      false,
      `on: push: branches: does not list ${servedBranch}, the branch this repository serves — no verdict reaches a merged head`,
    );
  }

  // A guard that examined nothing proves nothing — the rule it enforces applies
  // to itself. A moved directory or a renamed root would otherwise turn this
  // green over an empty set, which is the shape of defect this file exists for.
  if (scan.filesScanned === 0) {
    report.check(
      "resolved refs",
      false,
      `no file was scanned across ${SCANNED_ROOTS.length} declared roots — the roots moved, or the extension set no longer matches anything`,
    );
  }

  // The volume on the success line, not only in a note: a gate that reports
  // "1 assertion(s) hold" cannot be told apart from one that examined nothing.
  if (scan.filesScanned > 0 && scan.findings.length === 0 && missing.length === 0) {
    report.check(
      "resolved refs",
      true,
      servedBranch === null
        ? `${scan.filesScanned} non-test files across ${SCANNED_ROOTS.length} roots carry no written default-branch ref (${REF_PATTERNS.length} patterns, ${scan.allowed.length} reasoned allowance(s)); the ${workflows.length} workflow filter(s) were NOT judged — the served branch could not be resolved from origin/HEAD nor ls-remote`
        : `${scan.filesScanned} non-test files across ${SCANNED_ROOTS.length} roots carry no written default-branch ref (${REF_PATTERNS.length} patterns, ${scan.allowed.length} reasoned allowance(s)), and ${workflows.length} workflow(s) list ${servedBranch} where they filter`,
    );
  }
  console.log(
    `Resolved refs: ${scan.filesScanned} non-test file(s) scanned, ${REF_PATTERNS.length} pattern(s), ${scan.findings.length} written ref(s), ${scan.allowed.length} reasoned allowance(s), ${missing.length} workflow(s) missing the served branch (${servedBranch ?? "served branch unresolved — workflow filters not judged"})`,
  );
  for (const finding of scan.allowed) {
    console.log(`  allowed  ${finding.file}:${finding.line}  ${finding.id}`);
  }
  concludeGate("Resolved refs", report);
}
