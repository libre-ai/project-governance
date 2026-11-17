/**
 * Fleet staleness (monthly, `.github/workflows/fleet-staleness.yml`).
 *
 * Reads, and only reads, the active public repositories of the inventory
 * (ecosystem/repositories.v1.yaml) and reports the two states defined in
 * ecosystem/fleet-staleness.ts: a served branch without a commit for more
 * than 90 days, and a pull request open for more than 30 days.
 *
 * This script sends no mutation and files no issue. A red run is surfaced by
 * the loop's own alert (tools/security/repeat-failure-alert.ts): an issue at
 * the second consecutive red run, closed by the first green one.
 *
 * Private repositories are excluded and counted: the workflow runs with the
 * repository's installation token, which reads public repositories only (the
 * blind spot check-inventory-drift.ts documents). An unreadable repository,
 * or a whole batch that could not be answered, is a named failure; the run
 * goes on with the others.
 *
 * Usage: bun ecosystem/check-fleet-staleness.ts   (requires `gh` + GH_TOKEN)
 */

import { concludeGate } from "../tools/quality/gate-report";
import { buildIndex } from "./build-index";
import {
  buildStalenessQuery,
  evaluateStaleness,
  parseStalenessExceptions,
  parseStalenessResponse,
  type RepositoryReading,
} from "./fleet-staleness";
import { delay, ghGraphQLRaw, hasUsableGraphQLData, RETRY_DELAYS_MS } from "./github-fleet";

/** Repositories per request: one alias each, with up to 100 pull requests. */
export const STALENESS_BATCH_SIZE = 10;

/** The effects `readFleetStaleness` needs, injectable so no test reaches a forge. */
export interface StalenessTransport {
  readonly graphql: (
    query: string,
  ) => Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
  readonly retryDelaysMs: readonly number[];
}

async function readBatch(
  repositories: readonly string[],
  transport: StalenessTransport,
): Promise<Map<string, RepositoryReading>> {
  const query = buildStalenessQuery(repositories);
  let lastError = "";
  for (let attempt = 0; attempt <= transport.retryDelaysMs.length; attempt++) {
    const { stdout, stderr, exitCode } = await transport.graphql(query);
    try {
      const parsed: unknown = JSON.parse(stdout);
      // Read whatever the exit code: a NOT_FOUND on one alias makes `gh` exit
      // non-zero with a complete `data` for every other alias.
      if (hasUsableGraphQLData(parsed)) return parseStalenessResponse(repositories, parsed.data);
    } catch {
      // Not JSON: retried below.
    }
    lastError = stderr.trim() || `gh api graphql failed (exit ${exitCode})`;
    const wait = transport.retryDelaysMs[attempt];
    if (wait !== undefined) await delay(wait);
  }
  // No fallback and no shorter fleet: every repository of the batch is named
  // as unreadable, and the other batches are still read.
  const reason = `batch not answered after ${transport.retryDelaysMs.length + 1} attempt(s): ${lastError}`;
  return new Map(repositories.map((repository) => [repository, { kind: "unreadable", reason }]));
}

/** One reading per repository asked, in batches; never fewer entries than asked. */
export async function readFleetStaleness(
  repositories: readonly string[],
  transport: StalenessTransport,
): Promise<Map<string, RepositoryReading>> {
  const readings = new Map<string, RepositoryReading>();
  for (let start = 0; start < repositories.length; start += STALENESS_BATCH_SIZE) {
    const batch = repositories.slice(start, start + STALENESS_BATCH_SIZE);
    for (const [repository, reading] of await readBatch(batch, transport)) {
      readings.set(repository, reading);
    }
  }
  return readings;
}

if (import.meta.main) {
  // Before anything else: without a token `gh` either fails on every call or
  // reads with whatever identity the machine holds.
  if ((process.env.GH_TOKEN ?? "").trim() === "") {
    console.error(
      "Fleet staleness: GH_TOKEN is not set — refusing to read the fleet without an explicit token.",
    );
    process.exit(2);
  }

  const inventory = await Bun.file(new URL("repositories.v1.yaml", import.meta.url)).text();
  const active = buildIndex(inventory).repositories.filter((entry) => entry.lifecycle === "active");
  const declared = active.map((entry) => entry.repository);
  const excluded = active
    .filter((entry) => entry.visibility === "private")
    .map((entry) => entry.repository);
  const exceptions = parseStalenessExceptions(
    await Bun.file(new URL("staleness-exceptions.v1.yaml", import.meta.url)).text(),
  );

  const readings = await readFleetStaleness(
    declared.filter((repository) => !excluded.includes(repository)),
    { graphql: ghGraphQLRaw, retryDelaysMs: RETRY_DELAYS_MS },
  );
  const { report, excepted } = evaluateStaleness({
    now: new Date(),
    declared,
    excluded,
    readings,
    exceptions,
  });
  for (const line of excepted) console.log(line);
  // The success line carries the volume; a red run must show it as well, or
  // its findings cannot be read against what was examined.
  if (report.outcome !== "pass") console.log(`Fleet staleness volume: ${report.volumeSummary}`);
  concludeGate("Fleet staleness", report);
}
