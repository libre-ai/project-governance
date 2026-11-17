/**
 * Fleet staleness, pure half: the two states nothing else in this repository
 * reports, because both are an ABSENCE of activity and no gate turns red on
 * something that did not happen.
 *
 *   D1 dormant       an active repository of the inventory whose served branch
 *                    received no commit for more than DORMANT_AFTER_DAYS;
 *   D2 pull-request  a pull request open for more than
 *                    PULL_REQUEST_STALE_AFTER_DAYS.
 *
 * Report only. Nothing here archives, merges, closes or labels: the finding is
 * either acted upon by a human, or declared in
 * ecosystem/staleness-exceptions.v1.yaml with its reason.
 *
 * Three properties this module holds, each one a past incident of a fleet
 * gate:
 *   - the served branch is read through `defaultBranchRef`, never through a
 *     branch name: a literal name reads an empty tree wherever the served
 *     branch is called otherwise;
 *   - an unreadable repository is a named failure, never a healthy one, and
 *     never the end of the run: the other repositories are still judged;
 *   - pull requests are read on one page with `totalCount`: a repository
 *     holding more than the page is unreadable, never truncated.
 *
 * The effectful half (inventory, `gh`, exit code) is
 * ecosystem/check-fleet-staleness.ts.
 */

import { GateReport } from "../tools/quality/gate-report";

/** A served branch untouched for strictly more than this many days is dormant. */
export const DORMANT_AFTER_DAYS = 90;
/** A pull request open for strictly more than this many days is stale. */
export const PULL_REQUEST_STALE_AFTER_DAYS = 30;
/** One page, and no second one: beyond it the repository is unreadable. */
const PULL_REQUEST_PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export const STALENESS_EXCEPTIONS_SCHEMA_VERSION = "libre-ai.staleness-exceptions.v1";
const EXCEPTIONS_FILE = "staleness-exceptions.v1.yaml";

export interface OpenPullRequest {
  readonly number: number;
  /** ISO 8601, as served by the forge. */
  readonly createdAt: string;
  readonly isDraft: boolean;
  readonly url: string;
}

export type RepositoryReading =
  | {
      readonly kind: "read";
      /** `null` when the repository has no served branch at all. */
      readonly headCommittedAt: string | null;
      readonly pullRequests: readonly OpenPullRequest[];
    }
  | { readonly kind: "unreadable"; readonly reason: string };

const STALENESS_KINDS = ["dormant", "pull-request"] as const;
export type StalenessKind = (typeof STALENESS_KINDS)[number];

export interface StalenessException {
  readonly repository: string;
  readonly kind: StalenessKind;
  /** Present for `pull-request`, absent for `dormant`. */
  readonly number?: number;
  readonly because: string;
}

const repoAlias = (index: number): string => `r${index}`;

/**
 * One multi-alias, read-only request for a batch of repositories. The head
 * commit is reached through `defaultBranchRef`, which resolves whatever the
 * served branch is called.
 */
export function buildStalenessQuery(repositories: readonly string[]): string {
  const blocks = repositories.map((repository, index) => {
    const separator = repository.indexOf("/");
    if (separator <= 0 || separator === repository.length - 1) {
      throw new Error(`malformed repository entry, expected "owner/name": ${repository}`);
    }
    const owner = JSON.stringify(repository.slice(0, separator));
    const name = JSON.stringify(repository.slice(separator + 1));
    return [
      `  ${repoAlias(index)}: repository(owner: ${owner}, name: ${name}) {`,
      `    defaultBranchRef { target { ... on Commit { committedDate } } }`,
      `    pullRequests(states: OPEN, first: ${PULL_REQUEST_PAGE_SIZE}) {`,
      `      totalCount`,
      `      nodes { number createdAt isDraft url }`,
      `    }`,
      `  }`,
    ].join("\n");
  });
  return `query {\n${blocks.join("\n")}\n}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

const unreadable = (reason: string): RepositoryReading => ({ kind: "unreadable", reason });

function readRepositoryNode(node: unknown): RepositoryReading {
  if (!isRecord(node)) {
    return unreadable("repository not resolvable (null alias: deleted, renamed or not visible)");
  }
  // `defaultBranchRef: null` is an answer (the repository has no served
  // branch); an ABSENT key is a response that lost the field.
  const branch = node.defaultBranchRef;
  let headCommittedAt: string | null;
  if (branch === null) {
    headCommittedAt = null;
  } else if (
    isRecord(branch) &&
    isRecord(branch.target) &&
    isTimestamp(branch.target.committedDate)
  ) {
    headCommittedAt = branch.target.committedDate;
  } else {
    return unreadable("defaultBranchRef carries no readable head commit date");
  }

  const connection = node.pullRequests;
  if (!isRecord(connection) || !Array.isArray(connection.nodes)) {
    return unreadable("pullRequests connection missing from the response");
  }
  const { totalCount, nodes } = connection;
  if (typeof totalCount !== "number" || !Number.isInteger(totalCount) || totalCount < 0) {
    return unreadable("pullRequests.totalCount missing from the response");
  }
  const pullRequests: OpenPullRequest[] = [];
  for (const candidate of nodes as unknown[]) {
    if (
      !isRecord(candidate) ||
      typeof candidate.number !== "number" ||
      !Number.isInteger(candidate.number) ||
      !isTimestamp(candidate.createdAt) ||
      typeof candidate.isDraft !== "boolean" ||
      typeof candidate.url !== "string"
    ) {
      return unreadable("a pull request node lacks number, createdAt, isDraft or url");
    }
    pullRequests.push({
      number: candidate.number,
      createdAt: candidate.createdAt,
      isDraft: candidate.isDraft,
      url: candidate.url,
    });
  }
  if (totalCount !== pullRequests.length) {
    return unreadable(
      `${totalCount} open pull request(s) announced but ${pullRequests.length} read ` +
        `(one page of ${PULL_REQUEST_PAGE_SIZE}): the list is not complete`,
    );
  }
  return { kind: "read", headCommittedAt, pullRequests };
}

/**
 * The `data` payload of one batch, repository by repository. A defect on one
 * alias makes that repository unreadable and leaves the others as read.
 */
export function parseStalenessResponse(
  repositories: readonly string[],
  data: unknown,
): Map<string, RepositoryReading> {
  const aliases = isRecord(data) ? data : {};
  return new Map(
    repositories.map((repository, index) => [
      repository,
      readRepositoryNode(aliases[repoAlias(index)]),
    ]),
  );
}

const exceptionKey = (repository: string, kind: StalenessKind, number?: number): string =>
  kind === "dormant" ? `${repository} dormant` : `${repository} pull-request #${number}`;

/** The exception register; a malformed entry throws, so the gate never runs on half a register. */
export function parseStalenessExceptions(yamlText: string): StalenessException[] {
  const document: unknown = Bun.YAML.parse(yamlText);
  if (!isRecord(document) || document.schema_version !== STALENESS_EXCEPTIONS_SCHEMA_VERSION) {
    throw new Error(
      `${EXCEPTIONS_FILE}: schema_version must be ${STALENESS_EXCEPTIONS_SCHEMA_VERSION}`,
    );
  }
  const entries = document.exceptions;
  if (!Array.isArray(entries)) {
    throw new Error(`${EXCEPTIONS_FILE}: \`exceptions\` must be a list`);
  }
  const seen = new Set<string>();
  return (entries as unknown[]).map((entry, index) => {
    const at = `${EXCEPTIONS_FILE}: exceptions[${index}]`;
    if (!isRecord(entry)) throw new Error(`${at} must be a mapping`);
    const { repository, kind, number, because } = entry;
    if (typeof repository !== "string" || repository.trim() === "") {
      throw new Error(`${at}.repository is required`);
    }
    if (typeof because !== "string" || because.trim() === "") {
      throw new Error(`${at}.because is required`);
    }
    const known = STALENESS_KINDS.find((candidate) => candidate === kind);
    if (known === undefined) {
      throw new Error(`${at}.kind must be one of ${STALENESS_KINDS.join(", ")}`);
    }
    let exception: StalenessException;
    if (known === "pull-request") {
      if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
        throw new Error(`${at}.number is required for a pull-request exception`);
      }
      exception = { repository, kind: known, number, because };
    } else {
      if (number !== undefined) {
        throw new Error(`${at}.number is only meaningful for a pull-request exception`);
      }
      exception = { repository, kind: known, because };
    }
    const key = exceptionKey(exception.repository, exception.kind, exception.number);
    if (seen.has(key)) throw new Error(`${at} duplicates the entry for ${key}`);
    seen.add(key);
    return exception;
  });
}

export interface StalenessInput {
  /** Injected, so a threshold is tested to the millisecond. */
  readonly now: Date;
  /** Every active repository of the inventory, whatever its visibility. */
  readonly declared: readonly string[];
  /** The declared repositories this token cannot read (private), not queried. */
  readonly excluded: readonly string[];
  readonly readings: ReadonlyMap<string, RepositoryReading>;
  readonly exceptions: readonly StalenessException[];
}

export interface StalenessEvaluation {
  readonly report: GateReport;
  /** One `EXCEPTED …` line per exception applied, printed on every run. */
  readonly excepted: string[];
}

const wholeDays = (ageMs: number): number => Math.floor(ageMs / DAY_MS);

/**
 * Every repository and every open pull request read is one check. A finding
 * is a failed check unless an exception covers it; an exception that covers
 * nothing fails as stale. Both thresholds are strict: exactly the limit is
 * not a finding.
 */
export function evaluateStaleness(input: StalenessInput): StalenessEvaluation {
  const report = new GateReport();
  const excepted: string[] = [];
  const nowMs = input.now.getTime();
  const exceptions = new Map(
    input.exceptions.map((exception) => [
      exceptionKey(exception.repository, exception.kind, exception.number),
      exception,
    ]),
  );
  const applied = new Set<string>();
  /** Repositories whose findings could not be established: their exceptions are not judged. */
  const unjudged = new Set<string>();
  const declared = new Set(input.declared);
  const excluded = new Set(input.excluded);
  const tally = {
    examined: 0,
    excluded: 0,
    unreadable: 0,
    noServedBranch: 0,
    dormant: 0,
    pullRequestsRead: 0,
    stalePullRequests: 0,
    recentPullRequests: 0,
    staleExceptions: 0,
  };

  /** Records one finding: excepted when the register covers it, failed otherwise. */
  const finding = (item: string, key: string, note: string): void => {
    const exception = exceptions.get(key);
    if (exception === undefined) {
      report.check(item, false, note);
      return;
    }
    applied.add(key);
    excepted.push(`EXCEPTED ${item}: ${note} — ${exception.because}`);
    report.check(item, true, `excepted (${exception.because}): ${note}`);
  };

  for (const repository of excluded) {
    if (!declared.has(repository)) {
      report.check(
        `repository '${repository}'`,
        false,
        "excluded but not declared: the exclusion list names a repository outside the universe",
      );
    }
  }

  for (const repository of declared) {
    if (excluded.has(repository)) {
      tally.excluded += 1;
      continue;
    }
    const reading = input.readings.get(repository) ?? unreadable("no reading was returned");
    if (reading.kind === "unreadable") {
      tally.unreadable += 1;
      unjudged.add(repository);
      report.check(`repository '${repository}'`, false, `unreadable: ${reading.reason}`);
      continue;
    }
    tally.examined += 1;

    const item = `dormant '${repository}'`;
    if (reading.headCommittedAt === null) {
      tally.noServedBranch += 1;
      report.check(item, false, "no served branch: the repository has no default branch to read");
    } else {
      const ageMs = nowMs - Date.parse(reading.headCommittedAt);
      const evidence =
        `head of the served branch committed ${reading.headCommittedAt}, ` +
        `${wholeDays(ageMs)} day(s) ago (limit ${DORMANT_AFTER_DAYS})`;
      if (ageMs > DORMANT_AFTER_DAYS * DAY_MS) {
        tally.dormant += 1;
        finding(item, exceptionKey(repository, "dormant"), evidence);
      } else {
        report.check(item, true, evidence);
      }
    }

    for (const pullRequest of reading.pullRequests) {
      tally.pullRequestsRead += 1;
      const pullRequestItem = `pull-request '${repository}#${pullRequest.number}'`;
      const ageMs = nowMs - Date.parse(pullRequest.createdAt);
      const evidence =
        `open for ${wholeDays(ageMs)} day(s) (limit ${PULL_REQUEST_STALE_AFTER_DAYS})` +
        `${pullRequest.isDraft ? ", draft" : ""} — ${pullRequest.url}`;
      if (ageMs > PULL_REQUEST_STALE_AFTER_DAYS * DAY_MS) {
        tally.stalePullRequests += 1;
        finding(
          pullRequestItem,
          exceptionKey(repository, "pull-request", pullRequest.number),
          evidence,
        );
      } else {
        tally.recentPullRequests += 1;
        report.check(pullRequestItem, true, evidence);
      }
    }
  }

  // A permission that no longer covers anything is a standing excuse for the
  // next finding of that name. Not judged where the repository could not be
  // read: that run is already red, and the finding may still be there.
  for (const [key, exception] of exceptions) {
    if (applied.has(key) || unjudged.has(exception.repository)) continue;
    tally.staleExceptions += 1;
    report.check(
      `exception '${key}'`,
      false,
      `stale exception: ecosystem/${EXCEPTIONS_FILE} covers no current finding — remove the entry`,
    );
  }

  const findings = tally.dormant + tally.stalePullRequests;
  report.volume(
    `declared=${declared.size} = examined=${tally.examined} + excluded-private=${tally.excluded} ` +
      `+ unreadable=${tally.unreadable}; no-served-branch=${tally.noServedBranch}; ` +
      `open-pull-requests-read=${tally.pullRequestsRead} = ` +
      `stale-pull-requests=${tally.stalePullRequests} + recent-pull-requests=${tally.recentPullRequests}; ` +
      `dormant=${tally.dormant}; findings=${findings} = failing=${findings - excepted.length} + ` +
      `excepted=${excepted.length}; stale-exceptions=${tally.staleExceptions}`,
  );
  return { report, excepted };
}
