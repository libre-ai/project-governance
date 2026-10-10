/**
 * SQL construction across the fleet (threat triage 2026-10-09, menace 7; owner
 * arbitration 2026-10-10).
 *
 * The triage found every observed query parameterized, and nothing that keeps
 * it so: the data port exposes a raw `exec(sql)`, and an interpolated template
 * would read exactly like a parameterized one in review. This gate refuses, in
 * every tracked TypeScript/JavaScript and Rust source of every active, public
 * repository of `ecosystem/repositories.v1.yaml`:
 *
 *   - `unsafe-call`               — any `.unsafe(…)` (postgres.js raw SQL);
 *   - `exec-non-constant`         — `.exec(…)` whose first argument is not a
 *                                   constant string (a regex's `.exec` is not
 *                                   a database's and is recognised as such);
 *   - `sql-template-interpolation`— an untagged template literal that reads as
 *                                   SQL and interpolates `${…}` (a tagged
 *                                   `sql\`…\`` parameterizes, so it passes);
 *   - `sql-concatenation`         — a literal that reads as SQL joined by `+`;
 *   - `rust-format-sql`           — `format!` building SQL from an argument
 *                                   that is not a SCREAMING_CASE constant.
 *
 * Each remaining site is recorded in `ecosystem/sql-construction-allowlist.v1.yaml`
 * with the exact count per (repository, path, rule) and the reason it is safe.
 * A count that moves, in either direction, fails: a second interpolation added
 * next to a reviewed one must be reviewed too, and a removed one must leave the
 * register.
 *
 * Sources are read by a shallow `git clone` of the served branch — the
 * protocol, not an API: about 1 300 files across the fleet would cost dozens of
 * GraphQL batches and a quota, where git has neither (gate-integrity §4). A
 * repository that cannot be cloned, or a tracked file that cannot be read,
 * fails; it is never counted as "no SQL". Network: wired in
 * `inventory-drift.yml`, never in `bun run check`.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseRegistry, type RegistryEntry } from "./check-context-conformance";
import { exemption } from "./fleet-tree";
import {
  isScannedSource,
  SQL_RULES,
  type SqlFinding,
  type SqlRule,
  scanSource,
} from "./sql-construction-scanner";

export interface SqlAllowance {
  readonly repository: string;
  readonly path: string;
  readonly rule: SqlRule;
  readonly count: number;
  readonly because: string;
}

/** The allowlist; a malformed entry throws, so the gate never runs on half a register. */
export function parseAllowlist(text: string): SqlAllowance[] {
  const document = Bun.YAML.parse(text) as { readonly allowances?: unknown } | null;
  const entries = document?.allowances;
  if (!Array.isArray(entries)) {
    throw new Error("sql-construction-allowlist.v1.yaml: `allowances` must be a list");
  }
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    const record = entry as Record<string, unknown>;
    const where = `sql-construction-allowlist.v1.yaml: allowances[${index}]`;
    for (const key of ["repository", "path", "rule", "because"]) {
      if (typeof record[key] !== "string" || (record[key] as string).trim() === "") {
        throw new Error(`${where}.${key} is required`);
      }
    }
    if (!SQL_RULES.includes(record.rule as SqlRule)) {
      throw new Error(`${where}.rule must be one of ${SQL_RULES.join(", ")}`);
    }
    if (!Number.isInteger(record.count) || (record.count as number) < 1) {
      throw new Error(`${where}.count must be a positive integer`);
    }
    const key = `${record.repository}\0${record.path}\0${record.rule}`;
    if (seen.has(key)) throw new Error(`${where} duplicates an earlier (repository, path, rule)`);
    seen.add(key);
    return record as unknown as SqlAllowance;
  });
}

export interface ItemCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

export interface SqlTally {
  repositories: number;
  exempt: number;
  filesTracked: number;
  filesScanned: number;
  findings: number;
  allowed: number;
}

export function emptyTally(): SqlTally {
  return { repositories: 0, exempt: 0, filesTracked: 0, filesScanned: 0, findings: 0, allowed: 0 };
}

export function summarizeVolume(t: SqlTally): string {
  return `${t.repositories + t.exempt} inventory entries (${t.repositories} read, ${t.exempt} exempt): ${t.filesScanned} of ${t.filesTracked} tracked TS/JS/Rust source(s) scanned, ${t.findings} raw-SQL construction site(s) found, ${t.allowed} covered by the allowlist, ${t.findings - t.allowed} not`;
}

/**
 * Pure verdict for one repository: findings grouped by (path, rule) against
 * the allowances of that repository.
 */
export function judgeRepository(
  repository: string,
  findings: ReadonlyMap<string, readonly SqlFinding[]>,
  allowances: readonly SqlAllowance[],
  tally: SqlTally,
): ItemCheck[] {
  const checks: ItemCheck[] = [];
  const groups = new Map<string, { path: string; rule: SqlRule; lines: number[] }>();
  for (const [path, list] of findings) {
    for (const finding of list) {
      const key = `${path}\0${finding.rule}`;
      const group = groups.get(key) ?? { path, rule: finding.rule, lines: [] };
      group.lines.push(finding.line);
      groups.set(key, group);
    }
  }
  const own = allowances.filter((a) => a.repository === repository);
  for (const group of groups.values()) {
    tally.findings += group.lines.length;
    const item = `${repository}:${group.path}`;
    const allowance = own.find((a) => a.path === group.path && a.rule === group.rule);
    const where = `line(s) ${group.lines.join(", ")}`;
    if (allowance === undefined) {
      checks.push({
        item,
        ok: false,
        note: `${group.rule} at ${where} — build SQL with parameters, or record the site in ecosystem/sql-construction-allowlist.v1.yaml with the reason it is safe`,
      });
    } else if (allowance.count !== group.lines.length) {
      checks.push({
        item,
        ok: false,
        note: `${group.rule}: the allowlist reviewed ${allowance.count} site(s), the file now has ${group.lines.length} (${where}) — review the change and update the count`,
      });
    } else {
      tally.allowed += group.lines.length;
      checks.push({
        item,
        ok: true,
        note: `${group.rule}: ${group.lines.length} allowlisted site(s) — ${allowance.because}`,
      });
    }
  }
  for (const allowance of own) {
    if (!groups.has(`${allowance.path}\0${allowance.rule}`)) {
      checks.push({
        item: `${repository}:${allowance.path}`,
        ok: false,
        note: `stale allowance: ${allowance.rule} has no site left in this file — remove the entry from ecosystem/sql-construction-allowlist.v1.yaml`,
      });
    }
  }
  return checks;
}

export type SourceSet =
  | { readonly kind: "read"; readonly tracked: number; readonly files: ReadonlyMap<string, string> }
  | {
      readonly kind: "unreadable";
      readonly reason: string;
      readonly unreadableFiles?: readonly string[];
    };

export type SourceReader = (repository: string) => Promise<SourceSet>;

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function git(args: readonly string[]): Promise<Ran> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** Shallow clone of the served branch, its tracked sources, then the clone is removed. */
export const cloneSources: SourceReader = async (repository) => {
  const root = await mkdtemp(join(tmpdir(), "check-sql-construction-"));
  try {
    const target = join(root, "checkout");
    const cloned = await git([
      "clone",
      "--quiet",
      "--depth=1",
      "--no-tags",
      `https://github.com/${repository}`,
      target,
    ]);
    if (cloned.code !== 0) {
      return { kind: "unreadable", reason: `git clone failed: ${cloned.stderr.trim()}` };
    }
    const listed = await git(["-C", target, "ls-files", "-z"]);
    if (listed.code !== 0) {
      return { kind: "unreadable", reason: `git ls-files failed: ${listed.stderr.trim()}` };
    }
    const sources = listed.stdout.split("\0").filter((path) => isScannedSource(path));
    const files = new Map<string, string>();
    const unreadable: string[] = [];
    for (const path of sources) {
      try {
        files.set(path, await readFile(join(target, path), "utf8"));
      } catch {
        // A tracked symlink to a directory, or a file the checkout did not
        // materialize: named, never counted as scanned.
        unreadable.push(path);
      }
    }
    if (unreadable.length > 0) {
      return {
        kind: "unreadable",
        reason: `${unreadable.length} tracked source(s) could not be read`,
        unreadableFiles: unreadable,
      };
    }
    return { kind: "read", tracked: sources.length, files };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

export async function reviewRepository(
  entry: RegistryEntry,
  allowances: readonly SqlAllowance[],
  tally: SqlTally,
  reader: SourceReader = cloneSources,
): Promise<ItemCheck[]> {
  const exempt = exemption(entry);
  if (exempt !== null) {
    tally.exempt++;
    return [{ item: entry.repository, ok: true, note: `exempt: ${exempt}` }];
  }
  tally.repositories++;
  const set = await reader(entry.repository);
  if (set.kind === "unreadable") {
    const named = set.unreadableFiles?.length ? ` (${set.unreadableFiles.join(", ")})` : "";
    return [
      { item: entry.repository, ok: false, note: `sources unreadable: ${set.reason}${named}` },
    ];
  }
  tally.filesTracked += set.tracked;
  const findings = new Map<string, SqlFinding[]>();
  for (const [path, text] of set.files) {
    tally.filesScanned++;
    const found = scanSource(path, text);
    if (found.length > 0) findings.set(path, found);
  }
  const checks = judgeRepository(entry.repository, findings, allowances, tally);
  if (checks.length === 0) {
    checks.push({
      item: entry.repository,
      ok: true,
      note: `${set.files.size} source(s) scanned, no raw-SQL construction`,
    });
  }
  return checks;
}

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const registry = parseRegistry(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const allowances = parseAllowlist(
    await Bun.file("ecosystem/sql-construction-allowlist.v1.yaml").text(),
  );
  const report = new GateReport();
  const tally = emptyTally();
  for (const entry of registry) {
    for (const check of await reviewRepository(entry, allowances, tally)) {
      report.check(check.item, check.ok, check.note);
    }
  }
  // An allowance naming a repository the inventory does not read can never be
  // checked against a site: it is a permission nobody verifies.
  const read = new Set(registry.filter((e) => exemption(e) === null).map((e) => e.repository));
  for (const allowance of allowances.filter((a) => !read.has(a.repository))) {
    report.check(
      `${allowance.repository}:${allowance.path}`,
      false,
      "allowance for a repository this gate does not read (absent, private or archived) — remove it",
    );
  }
  report.volume(summarizeVolume(tally));
  if (report.outcome !== "pass")
    console.error(`SQL construction volume: ${summarizeVolume(tally)}`);
  concludeGate("SQL construction", report);
}
