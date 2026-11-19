import { join } from "node:path";
import { parseAllowlist, type SqlAllowance } from "./check-sql-construction";
import {
  DetectorInputError,
  type DetectorResult,
  describeRead,
  findingLine,
  readTrackedFiles,
  requiredVariable,
  runDetectorCommand,
} from "./fleet-detector-io";
import { isScannedSource, type SqlFinding, scanSource } from "./sql-construction-scanner";

/**
 * Fleet detector `sql-construction` (run by `ecosystem/fleet-detectors/
 * sql-construction.sh`): the rules of `check-sql-construction.ts`, read on one
 * measured worktree instead of a fresh clone of every repository.
 *
 * The scanner and the allowlist are that gate's own (`scanSource`,
 * `parseAllowlist`, `ecosystem/sql-construction-allowlist.v1.yaml`): the
 * detector adds no rule and no exemption. A (path, rule) group whose site count
 * equals its allowance is reviewed and is not a finding; any other group — no
 * allowance, or a count that moved either way — yields one finding per site, so
 * the reviewer sees every line the review must cover again.
 *
 * An allowance with no site left is a defect of the register, which lives here,
 * not of the measured repository: it is counted on stderr and stays the gate's
 * to refuse.
 */

export const ALLOWLIST_PATH = join(import.meta.dir, "sql-construction-allowlist.v1.yaml");

export interface SqlJudgement {
  readonly findings: readonly string[];
  readonly sites: number;
  readonly allowed: number;
  readonly stale: number;
}

/** Pure: the finding lines of one repository's sites against its allowances. */
export function judgeSqlSites(
  repository: string,
  sites: ReadonlyMap<string, readonly SqlFinding[]>,
  allowances: readonly SqlAllowance[],
): SqlJudgement {
  const groups = new Map<string, { path: string; rule: string; lines: number[] }>();
  let count = 0;
  for (const [path, found] of sites) {
    for (const site of found) {
      count += 1;
      const key = `${path}\0${site.rule}`;
      const group = groups.get(key) ?? { path, rule: site.rule, lines: [] };
      group.lines.push(site.line);
      groups.set(key, group);
    }
  }
  const own = allowances.filter((allowance) => allowance.repository === repository);
  const findings: string[] = [];
  let allowed = 0;
  for (const group of groups.values()) {
    const allowance = own.find((a) => a.path === group.path && a.rule === group.rule);
    if (allowance !== undefined && allowance.count === group.lines.length) {
      allowed += group.lines.length;
      continue;
    }
    for (const line of group.lines) findings.push(findingLine(group.path, line, group.rule));
  }
  const stale = own.filter((a) => !groups.has(`${a.path}\0${a.rule}`)).length;
  return { findings, sites: count, allowed, stale };
}

export async function measureSqlConstruction(
  environment: Readonly<Record<string, string | undefined>>,
  allowlistPath: string = ALLOWLIST_PATH,
): Promise<DetectorResult> {
  const worktree = requiredVariable(environment, "FLEET_WORKTREE");
  const repository = requiredVariable(environment, "FLEET_REPOSITORY");
  let allowances: SqlAllowance[];
  try {
    allowances = parseAllowlist(await Bun.file(allowlistPath).text());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DetectorInputError(`allowlist unreadable: ${reason}`);
  }
  const read = await readTrackedFiles(worktree, isScannedSource);
  const sites = new Map<string, SqlFinding[]>();
  for (const file of read.files) {
    const found = scanSource(file.path, file.text);
    if (found.length > 0) sites.set(file.path, found);
  }
  const judged = judgeSqlSites(repository, sites, allowances);
  return {
    findings: judged.findings,
    volume: `${describeRead(read)} TS/JS/Rust source(s); ${judged.sites} site(s) = ${judged.allowed} allowlisted + ${judged.findings.length} finding(s); ${judged.stale} stale allowance(s) for this repository`,
  };
}

if (import.meta.main) {
  await runDetectorCommand("sql-construction", () => measureSqlConstruction(process.env));
}
