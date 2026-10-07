/**
 * Org profile README self-heal (owner decision 2026-09-07: "the gate opens
 * the fix pull request when the correction is mechanical").
 *
 * The correction IS mechanical — splice the freshly rendered status section
 * between the sentinels of `libre-ai/.github`'s `profile/README.md` — but it
 * lands in another repository, and two documented GitHub limits decide how
 * this can honestly be done:
 *
 *   1. "The token's permissions are limited to the repository that contains
 *      your workflow" (docs.github.com, GITHUB_TOKEN concept page): the
 *      default token of a governance run cannot write to `.github` at all.
 *   2. "When a workflow using GITHUB_TOKEN creates or updates a pull request,
 *      the resulting pull_request event creates workflow runs in an
 *      approval-required state", and a push made with it "will not run" any
 *      workflow (docs.github.com, "Trigger a workflow", "Triggering a
 *      workflow from a workflow"). `.github`'s `main` requires two status
 *      checks (REUSE compliance, context hygiene), so even a pull request
 *      opened with a repository-scoped default token would sit unmergeable
 *      until a human approves its runs.
 *
 * So the write path is gated on a dedicated credential, `ORG_README_HEAL_TOKEN`
 * (a fine-grained personal access token or GitHub App installation token,
 * scoped to `libre-ai/.github` only, Contents + Pull requests read/write —
 * docs/method/AGENTIC-LOOP-INVENTORY.md records the owner action). Without
 * it, this script still does everything that needs no secret: it computes
 * the healed README, writes it to `HEAL_OUT` for the run's artifact, and
 * says `skipped: secret ORG_README_HEAL_TOKEN absent` in the log and the job
 * summary. Never a silent green: the run is already red from the drift
 * step, and the skip line names what is missing.
 *
 * With the token: a fixed branch `heal/org-readme` in `.github` (recreated
 * from `main` when no pull request is open from it, appended to otherwise),
 * one commit through the Contents API with the token's identity as author
 * and a matching `Signed-off-by` trailer, one pull request — found by head
 * branch, never duplicated. Idempotent: a branch already carrying the
 * healed content gets no second commit.
 *
 * Pure parts (`spliceStatusSection`, `skipMessage`, `healCommitMessage`,
 * `findOpenPullRequest`) are unit-tested; the API calls are not, and the
 * first live run with the secret is the proof this module still owes.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATUS_SECTION_BEGIN, STATUS_SECTION_END } from "../../ecosystem/project-cards";
import { checkOrgReadmeDrift, isLiveState, readLiveState } from "./check-org-readme-drift";

export const HEAL_SECRET = "ORG_README_HEAL_TOKEN";
export const HEAL_BRANCH = "heal/org-readme";
export const HEAL_REPOSITORY = "libre-ai/.github";
export const HEAL_PATH = "profile/README.md";
export const HEAL_PR_TITLE = "docs(profile): sync the status section with the live fleet cards";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * The healed README: the live one with exactly the sentinel-delimited
 * section replaced. `null` when the sentinels are absent or duplicated —
 * that README needs a human, not a splice.
 */
export function spliceStatusSection(liveReadme: string, freshSection: string): string | null {
  if (
    countOccurrences(liveReadme, STATUS_SECTION_BEGIN) !== 1 ||
    countOccurrences(liveReadme, STATUS_SECTION_END) !== 1
  ) {
    return null;
  }
  const begin = liveReadme.indexOf(STATUS_SECTION_BEGIN);
  const end = liveReadme.indexOf(STATUS_SECTION_END) + STATUS_SECTION_END.length;
  if (end <= begin) return null;
  return liveReadme.slice(0, begin) + freshSection + liveReadme.slice(end);
}

export function skipMessage(healedPath: string): string {
  return (
    `skipped: secret ${HEAL_SECRET} absent — the healed ${HEAL_REPOSITORY} ${HEAL_PATH} was written ` +
    `to ${healedPath} (run artifact "org-readme-healed"); paste it, or configure the secret ` +
    "(docs/method/AGENTIC-LOOP-INVENTORY.md, « Auto-guérison du README d'organisation ») so the " +
    "next red run opens the pull request itself"
  );
}

export interface Identity {
  readonly name: string;
  readonly email: string;
}

export function healCommitMessage(runUrl: string, signOff: Identity): string {
  return [
    HEAL_PR_TITLE,
    "",
    "Mechanical resync of the generated project-status section from the live",
    "project.v1.yaml cards, opened by governance's Org README drift loop.",
    "",
    `Source run: ${runUrl}`,
    "",
    `Signed-off-by: ${signOff.name} <${signOff.email}>`,
  ].join("\n");
}

export interface OpenPullRequest {
  readonly number: number;
  readonly headRefName: string;
}

/** Exact head-branch match: the heal owns one branch, so one pull request. */
export function findOpenPullRequest(pulls: readonly OpenPullRequest[]): number | null {
  return pulls.find((pull) => pull.headRefName === HEAL_BRANCH)?.number ?? null;
}

// ---------------------------------------------------------------------------
// CLI (network I/O — not unit-tested; the logic above is)

// Synchronous on purpose: the callers exit right after, and a pending
// asynchronous write would be the one line the operator never sees.
function appendSummary(line: string): void {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary === undefined) return;
  appendFileSync(summary, `${line}\n`);
}

interface Api {
  readonly json: (args: readonly string[]) => unknown;
  readonly run: (args: readonly string[], stdin?: string) => string;
}

function apiWith(token: string): Api {
  // The token travels only through the environment of the child process:
  // never on a command line, never in a log line.
  const env = { ...process.env, GH_TOKEN: token };
  const run = (args: readonly string[], stdin?: string): string => {
    const result = Bun.spawnSync(["gh", ...args], {
      env,
      stdin: stdin === undefined ? undefined : Buffer.from(stdin, "utf8"),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `gh ${args.join(" ")} exited ${result.exitCode}: ${result.stderr.toString()}`,
      );
    }
    return new TextDecoder().decode(result.stdout);
  };
  return { run, json: (args) => JSON.parse(run(args)) as unknown };
}

function refExists(api: Api, branch: string): boolean {
  try {
    api.run(["api", `repos/${HEAL_REPOSITORY}/git/ref/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function openPullRequest(api: Api, healed: string, runUrl: string): string {
  const user = api.json(["api", "user"]) as { login: string; id: number };
  const identity: Identity = {
    name: user.login,
    email: `${user.id}+${user.login}@users.noreply.github.com`,
  };

  const pulls = api.json([
    "pr",
    "list",
    "-R",
    HEAL_REPOSITORY,
    "--state",
    "open",
    "--head",
    HEAL_BRANCH,
    "--json",
    "number,headRefName",
  ]) as OpenPullRequest[];
  const existing = findOpenPullRequest(pulls);

  // No open pull request: the branch, if any, is a leftover of a merged or
  // closed one — recreate it from main so the diff is exactly this heal.
  if (existing === null) {
    if (refExists(api, HEAL_BRANCH)) {
      api.run(["api", "-X", "DELETE", `repos/${HEAL_REPOSITORY}/git/refs/heads/${HEAL_BRANCH}`]);
    }
    const mainSha = (
      api.json(["api", `repos/${HEAL_REPOSITORY}/git/ref/heads/main`]) as {
        object: { sha: string };
      }
    ).object.sha;
    api.run([
      "api",
      "-X",
      "POST",
      `repos/${HEAL_REPOSITORY}/git/refs`,
      "-f",
      `ref=refs/heads/${HEAL_BRANCH}`,
      "-f",
      `sha=${mainSha}`,
    ]);
  }

  const current = api.json([
    "api",
    `repos/${HEAL_REPOSITORY}/contents/${HEAL_PATH}?ref=${HEAL_BRANCH}`,
  ]) as { sha: string; content: string };
  const currentText = Buffer.from(current.content, "base64").toString("utf8");
  if (currentText === healed) {
    console.log(
      `heal-org-readme: ${HEAL_BRANCH} already carries the healed README — no new commit`,
    );
  } else {
    // `--input -` reads the JSON body from stdin, so the README content never
    // goes through argv (size limit, and it would be visible in `ps`).
    const body = JSON.stringify({
      message: healCommitMessage(runUrl, identity),
      content: Buffer.from(healed, "utf8").toString("base64"),
      sha: current.sha,
      branch: HEAL_BRANCH,
      committer: identity,
      author: identity,
    });
    api.run(
      ["api", "-X", "PUT", `repos/${HEAL_REPOSITORY}/contents/${HEAL_PATH}`, "--input", "-"],
      body,
    );
    console.log(`heal-org-readme: committed the healed README to ${HEAL_BRANCH}`);
  }

  if (existing !== null) {
    return `https://github.com/${HEAL_REPOSITORY}/pull/${existing}`;
  }
  return api
    .run([
      "pr",
      "create",
      "-R",
      HEAL_REPOSITORY,
      "--base",
      "main",
      "--head",
      HEAL_BRANCH,
      "--title",
      HEAL_PR_TITLE,
      "--body",
      `Opened automatically by governance's Org README drift loop.\n\nSource run: ${runUrl}\n\n` +
        "The section between the project-status sentinels is regenerated from the live " +
        "project.v1.yaml cards (tools/presentation/heal-org-readme.ts); nothing else changes.",
    ])
    .trim();
}

if (import.meta.main) {
  const runUrl = process.env.CURRENT_RUN_URL ?? "(run URL not provided)";
  const outDirectory =
    process.env.HEAL_OUT ?? join(process.env.RUNNER_TEMP ?? ".", "org-readme-healed");

  const state = await readLiveState();
  if (!isLiveState(state)) {
    for (const failure of state.unreadable) console.error(`heal-org-readme: ${failure}`);
    console.error("heal-org-readme: live state unreadable — nothing can be healed mechanically");
    process.exit(1);
  }

  const drift = checkOrgReadmeDrift(state.readme, state.freshSection);
  if (drift.length === 0) {
    console.log(
      `heal-org-readme: ${HEAL_REPOSITORY} ${HEAL_PATH} already matches the live cards — nothing to ` +
        "heal there (a stale ecosystem/projections/fleet-status.v1.json is fixed in THIS repository: " +
        "bun ecosystem/render-fleet-status.ts)",
    );
    process.exit(0);
  }

  const healed = spliceStatusSection(state.readme, state.freshSection);
  if (healed === null) {
    console.error(`heal-org-readme: ${drift.join("; ")} — not a mechanical fix, no pull request`);
    process.exit(1);
  }

  const healedPath = join(outDirectory, "profile-README.md");
  mkdirSync(dirname(healedPath), { recursive: true });
  await Bun.write(healedPath, healed);

  const token = process.env[HEAL_SECRET];
  if (token === undefined || token.length === 0) {
    const message = skipMessage(healedPath);
    console.log(`heal-org-readme: ${message}`);
    appendSummary(`**Org README heal** — ${message}`);
    process.exit(0);
  }

  const url = openPullRequest(apiWith(token), healed, runUrl);
  console.log(`heal-org-readme: pull request ${url}`);
  appendSummary(`**Org README heal** — pull request ${url}`);
}
