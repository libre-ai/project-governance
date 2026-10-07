/**
 * Repeat-failure alert (Domain I, Process & CI — mechanizes the "échec
 * observable" column of docs/method/AGENTIC-LOOP-INVENTORY.md for the
 * fleet's periodic drift controls).
 *
 * A red run in a scheduled workflow (adoption-proof, sovereignty-report,
 * truth-drift, fleet-advisories) is only observable to someone who opens the
 * Actions tab — the inventory itself names "absence de ligne récente" as a
 * failure mode indistinguishable from success unless something outside the
 * run surfaces it. This step is that surface: it runs last, gated on
 * `if: failure()`, and turns a red run into a governance issue only when the
 * run BEFORE it was also red — one bad run stays a run (transient, common:
 * a rate limit, a flaky network fetch); two in a row is a pattern worth a
 * human's attention.
 *
 * Deduplicated by exact-title search against open issues: the title is
 * stable across invocations (no date, no run id), so a third, fourth, fifth
 * consecutive failure never files a second issue — it would report against
 * the same open one, which this step deliberately leaves untouched rather
 * than commenting, keeping the mechanism to exactly what chantier 2b asks.
 *
 * `--resolve` is the other half (2026-09-07): gated on `success()`, it closes
 * the issue this alert opened for the same workflow, with the green run's
 * URL as the closing comment. Idempotent by construction — a closed issue is
 * not in the open list, so a second green run finds nothing to close. The
 * two modes share the title, which is the whole contract between them.
 *
 * Every scheduled workflow of this repository carries both steps;
 * scheduled-loop-alerting.test.ts fails when one does not.
 *
 * Analysis (`shouldAlert`, `issueTitle`, `issueBody`, `findOpenIssue`,
 * `previousLoopRun`, `selectMode`, `resolutionComment`) is pure and
 * unit-tested; only the CLI touches the network.
 */

export function shouldAlert(previousConclusion: string | null | undefined): boolean {
  return previousConclusion === "failure";
}

export interface LoopRun {
  readonly conclusion: string;
  readonly url: string;
  readonly event: string;
}

/**
 * A loop's own runs are its scheduled ticks and its manual dispatches (the
 * documented re-run path). Workflows that also run on `push`/`pull_request`
 * (context-conformance, inventory-drift) produce runs that belong to the CI
 * gate, not to the loop: a branch failing twice is not the fleet drifting,
 * and must never be the "previous run" this alert counts.
 */
const LOOP_EVENTS: ReadonlySet<string> = new Set(["schedule", "workflow_dispatch"]);

export function previousLoopRun(runs: readonly LoopRun[]): LoopRun | null {
  return runs.find((run) => LOOP_EVENTS.has(run.event)) ?? null;
}

export function issueTitle(workflowName: string): string {
  return `${workflowName}: two consecutive failed runs`;
}

export function issueBody(
  workflowName: string,
  currentRunUrl: string,
  previousRunUrl: string | null,
): string {
  const lines = [
    `\`${workflowName}\` failed on two consecutive scheduled runs.`,
    "",
    `- Current run: ${currentRunUrl}`,
    previousRunUrl !== null ? `- Previous run: ${previousRunUrl}` : null,
    "",
    "Filed automatically by tools/security/repeat-failure-alert.ts — a single " +
      "red run is not enough to open an issue (docs/method/AGENTIC-LOOP-INVENTORY.md, " +
      '"Contrôle de dérive périodique"); two in a row is.',
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

export interface OpenIssue {
  readonly number: number;
  readonly title: string;
}

/** Exact-title match only — dedup must not silently swallow an unrelated issue. */
export function findOpenIssue(issues: readonly OpenIssue[], title: string): number | null {
  return issues.find((issue) => issue.title === title)?.number ?? null;
}

export type Mode = "alert" | "resolve";

/** The bare invocation alerts (every pre-2026-09-07 workflow); `--resolve` closes. */
export function selectMode(argv: readonly string[]): Mode {
  if (argv.length === 0) return "alert";
  if (argv.length === 1 && argv[0] === "--resolve") return "resolve";
  throw new Error(`repeat-failure-alert: unknown arguments ${JSON.stringify(argv)}`);
}

export function resolutionComment(workflowName: string, greenRunUrl: string): string {
  return [
    `\`${workflowName}\` is green again — closing.`,
    "",
    `- Green run: ${greenRunUrl}`,
    "",
    "Closed automatically by tools/security/repeat-failure-alert.ts --resolve: the failure " +
      "this issue reported no longer reproduces on the loop's own schedule.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// CLI (network I/O — not unit-tested; the logic above is)

if (import.meta.main) {
  const mode = selectMode(process.argv.slice(2));
  const workflowName = process.env.WORKFLOW_NAME;
  const workflowFile = process.env.WORKFLOW_FILE;
  const currentRunUrl = process.env.CURRENT_RUN_URL;
  if (workflowName === undefined || workflowFile === undefined || currentRunUrl === undefined) {
    console.error(
      "repeat-failure-alert: WORKFLOW_NAME, WORKFLOW_FILE and CURRENT_RUN_URL are required",
    );
    process.exit(1);
  }

  const run = (args: string[]): string => {
    const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) {
      throw new Error(`${args.join(" ")} exited ${result.exitCode}: ${result.stderr.toString()}`);
    }
    return new TextDecoder().decode(result.stdout);
  };

  const title = issueTitle(workflowName);
  const listOpenIssues = (): OpenIssue[] =>
    JSON.parse(
      run(["gh", "issue", "list", "--state", "open", "--limit", "100", "--json", "number,title"]),
    ) as OpenIssue[];

  if (mode === "resolve") {
    const open = findOpenIssue(listOpenIssues(), title);
    if (open === null) {
      console.log(`repeat-failure-alert: no open issue titled "${title}" — nothing to close`);
      process.exit(0);
    }
    run([
      "gh",
      "issue",
      "comment",
      String(open),
      "--body",
      resolutionComment(workflowName, currentRunUrl),
    ]);
    run(["gh", "issue", "close", String(open), "--reason", "completed"]);
    console.log(`repeat-failure-alert: closed #${open} — ${title}`);
    process.exit(0);
  }

  // `gh run list` returns most-recent-first, and the current (still
  // in_progress) run is excluded by `--status completed` since it has not
  // finished yet — the first LOOP row here is genuinely the loop run
  // immediately before this one. The limit leaves room for the push and
  // pull_request runs that `previousLoopRun` discards on mixed workflows.
  const previousRuns = JSON.parse(
    run([
      "gh",
      "run",
      "list",
      "--workflow",
      workflowFile,
      "--status",
      "completed",
      "--limit",
      "30",
      "--json",
      "conclusion,url,event",
    ]),
  ) as LoopRun[];
  const previous = previousLoopRun(previousRuns);

  if (previous === null || !shouldAlert(previous.conclusion)) {
    console.log(
      `repeat-failure-alert: previous run concluded "${previous?.conclusion ?? "(none)"}" — not two in a row, no issue filed`,
    );
    process.exit(0);
  }

  const existing = findOpenIssue(listOpenIssues(), title);
  if (existing !== null) {
    console.log(
      `repeat-failure-alert: #${existing} already open with this title — not duplicating`,
    );
    process.exit(0);
  }

  const body = issueBody(workflowName, currentRunUrl, previous.url);
  run(["gh", "issue", "create", "--title", title, "--body", body]);
  console.log(`repeat-failure-alert: filed a new issue — ${title}`);
}
