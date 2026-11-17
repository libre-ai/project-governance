/**
 * Effectful half of the governance open-points gate.
 *
 * Reads what `evaluateOpenPoints` (open-points.ts) is handed: the register
 * text, the `Dnn` of the decision register through `parseRegisterDecisions`
 * (the reader of the brick map, imported, not copied), the decision record
 * numbers from the tracked names of `docs/adr/` (as check-briques.ts derives
 * them), the tracked paths from `git ls-files`, the local date, and the state
 * of a pull request through `gh api graphql`.
 *
 * Exit codes: 0 pass, 1 violation (a malformed register or condition
 * included), 2 usage, 3 no violation but at least one `merged()` condition
 * whose pull request could not be read. An unreadable result is never 0.
 *
 * Not in the `check` chain: wiring a gate there mutates the guard rails
 * (I-17), which goes through an ADR. Run it as `bun run check:open-points`;
 * the `merged()` reading needs `gh` authenticated (GH_TOKEN).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { concludeGate } from "../tools/quality/gate-report";
import { parseRegisterDecisions } from "./briques";
import { gitEnvironment } from "./check-briques";
import { delay, ghGraphQLRaw, hasUsableGraphQLData, RETRY_DELAYS_MS } from "./github-fleet";
import {
  evaluateOpenPoints,
  type OpenPointsInput,
  openPointsExitCode,
  REGISTER_PATH,
} from "./open-points";

const GATE = "Open points";
const DECISION_REGISTER = "docs/decisions/DECISION-REGISTER.md";
const ADR_DIRECTORY = "docs/adr/";

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The tracked paths of the repository at `root`; null when git cannot list them. */
function trackedPaths(root: string): Set<string> | null {
  try {
    const listing = execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
      cwd: root,
      env: gitEnvironment(),
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(listing.split("\0").filter((path) => path !== ""));
  } catch {
    return null;
  }
}

/** The local calendar date, `YYYY-MM-DD`. */
function localToday(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Whether `owner/name#number` is merged, read through GraphQL with the fleet
 * retry budget. Any error or unusable answer is null: unreadable, never false.
 */
async function pullRequestMerged(repository: string, number: number): Promise<boolean | null> {
  const [owner, name] = repository.split("/");
  if (owner === undefined || name === undefined) return null;
  const query =
    `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) ` +
    `{ pullRequest(number: ${number}) { merged } } }`;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const { stdout } = await ghGraphQLRaw(query);
      const parsed: unknown = JSON.parse(stdout);
      if (hasUsableGraphQLData(parsed)) {
        const repositoryData = parsed.data.repository;
        if (typeof repositoryData !== "object" || repositoryData === null) return null;
        const pullRequest = (repositoryData as { readonly pullRequest?: unknown }).pullRequest;
        if (typeof pullRequest !== "object" || pullRequest === null) return null;
        const merged = (pullRequest as { readonly merged?: unknown }).merged;
        return typeof merged === "boolean" ? merged : null;
      }
    } catch {
      // Spawn failure or a body that is not JSON: retried, then unreadable.
    }
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  return null;
}

/**
 * Read the sources of the repository at `root`: the register, the decision
 * register, the tracked paths and the decision record numbers. The date and
 * the pull request reader are handed in, so that a test reads the shipped
 * register without the clock or the network. Unreadable sources become empty
 * collections, which the evaluation fails by name.
 */
export function readOpenPointsInput(
  root: string,
  today: string,
  readPullRequest: OpenPointsInput["pullRequestMerged"],
): OpenPointsInput {
  const tracked = trackedPaths(root) ?? new Set<string>();
  const adrNumbers = new Set(
    [...tracked]
      .map((path) => (path.startsWith(ADR_DIRECTORY) ? path.slice(ADR_DIRECTORY.length) : ""))
      .filter((name) => !name.includes("/"))
      .flatMap((name) => /^([0-9]{4})-.+\.md$/.exec(name)?.[1] ?? []),
  );
  return {
    text: readOrNull(join(root, REGISTER_PATH)),
    registerDecisions: parseRegisterDecisions(readOrNull(join(root, DECISION_REGISTER)) ?? ""),
    adrNumbers,
    isTracked: (path) => tracked.has(path),
    today,
    pullRequestMerged: readPullRequest,
  };
}

if (import.meta.main) {
  if (process.argv.length > 2) {
    console.error(
      `usage: bun ecosystem/check-open-points.ts (no argument; reads ${REGISTER_PATH})`,
    );
    process.exit(2);
  }
  const outcome = await evaluateOpenPoints(
    readOpenPointsInput(process.cwd(), localToday(), pullRequestMerged),
  );
  // A red run prints only its violations: say the volume they were found in.
  if (outcome.report.violations.length > 0 && outcome.volume !== "") {
    console.error(`${GATE} volume: ${outcome.volume}`);
  }
  concludeGate(GATE, outcome.report);
  if (openPointsExitCode(outcome) === 3) {
    console.error(
      `${GATE}: ${outcome.unavailable} merged() condition(s) could not be read; ` +
        "the result is unavailable, not green",
    );
    process.exit(3);
  }
}
