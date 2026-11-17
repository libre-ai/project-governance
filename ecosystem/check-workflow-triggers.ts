/**
 * Workflow triggers across the fleet: one run per pull-request head.
 *
 * A workflow that runs on `pull_request` and on an unfiltered `push` runs twice
 * for the same head: once when the working branch is pushed, once when the pull
 * request opens. A `push` filter that lists a second branch next to the served
 * one does the same on that branch. `tools/quality/check-resolved-refs.ts` only
 * asks that a filter CONTAINS the served branch, for this repository alone, and
 * skips the question when the served branch cannot be resolved. This gate asks
 * for equality, for every active, public entry of
 * `ecosystem/repositories.v1.yaml`, and fails where it cannot read.
 *
 * `on.push.branches` accepts no expression, so the branch is necessarily
 * written in the workflow. What is checked is that the one written entry equals,
 * byte for byte, the branch the repository serves at the time of the check —
 * resolved by `git ls-remote --symref` (git protocol: no quota, no token).
 *
 * Read at the served branch, for every tracked `.github/workflows/*.y(a)ml`:
 *
 *   1. only the events of `ALLOWED_EVENTS` may create a run;
 *   2. a `push` with no configuration (string, list or empty table form) runs
 *      on every branch: refused;
 *   3. `branches-ignore` is refused;
 *   4. `push.branches` carries exactly one entry, equal to the served branch —
 *      another literal, an extra literal or a glob is refused;
 *   5. a `push` without `branches` is admitted only with `tags` or
 *      `tags-ignore` (tag runs only); `paths` alone is refused;
 *   6. in a workflow triggered by a pull request, a job whose `if:` reads the
 *      event name or the ref can opt out of pull-request runs: refused. Step
 *      conditions are not judged.
 *
 * The gate writes nothing and is wired into no workflow.
 */

import { parseSymrefHead } from "../crates/ecosystem-engine/scripts/check-patch-rev";
import type { ItemCheck } from "./check-action-pins";
import { parseRegistry, type RegistryEntry } from "./check-context-conformance";
import { exemption, type FleetFileReader, readRepositoryFiles } from "./fleet-tree";

export const ALLOWED_EVENTS: readonly string[] = [
  "pull_request",
  "pull_request_target",
  "push",
  "schedule",
  "workflow_dispatch",
  "workflow_call",
];

const PULL_REQUEST_EVENTS: readonly string[] = ["pull_request", "pull_request_target"];

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;

export function isWorkflowDefinition(path: string): boolean {
  return WORKFLOW.test(path);
}

export interface TriggerReview {
  readonly events: readonly string[];
  readonly pushKind: "none" | "served-branch" | "tag-only" | "rejected";
  readonly failures: readonly string[];
  readonly unreadable: string | null;
}

type YamlTable = Readonly<Record<string, unknown>>;

function isTable(value: unknown): value is YamlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unreadableReview(reason: string): TriggerReview {
  return { events: [], pushKind: "none", failures: [], unreadable: reason };
}

/**
 * `Bun.YAML.parse` reads a bare `on` key as the string `on`, as it reads the
 * quoted `'on'` (YAML 1.2: no boolean `on`), so one lookup serves both
 * spellings. A test pins that premise: a parser that turned the bare key into
 * `true` would make every such workflow unreadable here, never silently green.
 */
function triggerNode(document: YamlTable): unknown {
  return document.on;
}

interface Triggers {
  readonly events: readonly string[];
  /** The value under `push` in the table form; `undefined` in the string and list forms. */
  readonly push: unknown;
}

function readTriggers(node: unknown): Triggers | string {
  if (typeof node === "string") return { events: [node], push: undefined };
  if (Array.isArray(node)) {
    const events: string[] = [];
    for (const item of node) {
      if (typeof item !== "string") return "`on` lists an entry that is not an event name";
      events.push(item);
    }
    return { events, push: undefined };
  }
  if (isTable(node)) return { events: Object.keys(node), push: node.push };
  return "`on` is absent or is neither an event name, a list nor a table";
}

const GLOB = /[*?[!]/;

/** A filter value as GitHub reads it: a list of patterns, or one pattern written as a scalar. */
function patterns(value: unknown): readonly string[] | null {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as readonly string[];
  }
  return null;
}

interface PushVerdict {
  readonly kind: "served-branch" | "tag-only" | "rejected";
  readonly failures: readonly string[];
}

function reviewPush(push: unknown, servedBranch: string): PushVerdict {
  if (!isTable(push) || Object.keys(push).length === 0) {
    return {
      kind: "rejected",
      failures: [
        `\`push\` carries no filter, so every pushed branch creates a run — filter it with \`branches: [${servedBranch}]\` or with \`tags\``,
      ],
    };
  }
  if ("branches-ignore" in push) {
    return {
      kind: "rejected",
      failures: [
        "`push.branches-ignore` runs on every branch it does not name — list the served branch under `branches` instead",
      ],
    };
  }
  if (isServedBranchOnly(push.branches, servedBranch))
    return { kind: "served-branch", failures: [] };
  if (!("branches" in push)) {
    if ("tags" in push || "tags-ignore" in push) return { kind: "tag-only", failures: [] };
    return {
      kind: "rejected",
      failures: [
        `\`push\` is filtered by neither \`branches\` nor \`tags\` (${Object.keys(push).join(", ")} only), so every pushed branch can create a run — add \`branches: [${servedBranch}]\``,
      ],
    };
  }
  return { kind: "rejected", failures: describeBranchFilter(push.branches, servedBranch) };
}

/** The one admitted branch filter: a single entry, byte-equal to the resolved served branch. */
function isServedBranchOnly(branches: unknown, servedBranch: string): boolean {
  const entries = patterns(branches);
  return entries !== null && entries.length === 1 && entries[0] === servedBranch;
}

/** Why a refused `branches` filter is refused, naming each offending entry. Never empty. */
function describeBranchFilter(branches: unknown, servedBranch: string): string[] {
  const entries = patterns(branches);
  if (entries === null) {
    return ["`push.branches` is neither a branch name nor a list of branch names"];
  }
  const failures: string[] = [];
  for (const entry of entries) {
    if (GLOB.test(entry)) {
      failures.push(
        `\`push.branches\` entry \`${entry}\` is a glob pattern — the only admitted entry is the served branch \`${servedBranch}\``,
      );
    } else if (entry !== servedBranch) {
      failures.push(
        `\`push.branches\` entry \`${entry}\` is not the served branch \`${servedBranch}\``,
      );
    }
  }
  if (failures.length === 0) {
    failures.push(
      `\`push.branches\` carries ${entries.length} entries — exactly one is admitted, the served branch \`${servedBranch}\``,
    );
  }
  return failures;
}

/** The two contexts a job condition reads to tell a pull-request run from another one. */
const EVENT_READS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "github.event_name", pattern: /\bgithub\.event_name(?![\w])/ },
  { name: "github.ref", pattern: /\bgithub\.ref(?![\w])/ },
];

function reviewJobConditions(jobs: unknown): string[] {
  if (!isTable(jobs)) return [];
  const failures: string[] = [];
  for (const [name, job] of Object.entries(jobs)) {
    if (!isTable(job) || typeof job.if !== "string") continue;
    const condition = job.if;
    for (const read of EVENT_READS) {
      if (read.pattern.test(condition)) {
        failures.push(
          `job \`${name}\` carries \`if:\` reading \`${read.name}\` in a workflow triggered by a pull request — the job can skip pull-request runs; move the condition to a step`,
        );
      }
    }
  }
  return failures;
}

/** Pure review of one workflow text against the branch its repository serves. */
export function reviewTriggers(text: string, servedBranch: string): TriggerReview {
  let document: unknown;
  try {
    document = Bun.YAML.parse(text);
  } catch (error) {
    return unreadableReview(`YAML parse failed: ${(error as Error).message}`);
  }
  if (!isTable(document)) return unreadableReview("the workflow is not a YAML mapping");
  const triggers = readTriggers(triggerNode(document));
  if (typeof triggers === "string") return unreadableReview(triggers);
  if (triggers.events.length === 0) return unreadableReview("`on` declares no event");

  const failures: string[] = [];
  for (const event of triggers.events) {
    if (!ALLOWED_EVENTS.includes(event)) {
      failures.push(`event \`${event}\` is not admitted (admitted: ${ALLOWED_EVENTS.join(", ")})`);
    }
  }
  let pushKind: TriggerReview["pushKind"] = "none";
  if (triggers.events.includes("push")) {
    const verdict = reviewPush(triggers.push, servedBranch);
    pushKind = verdict.kind;
    failures.push(...verdict.failures);
  }
  if (triggers.events.some((event) => PULL_REQUEST_EVENTS.includes(event))) {
    failures.push(...reviewJobConditions(document.jobs));
  }
  return { events: triggers.events, pushKind, failures, unreadable: null };
}

export type ServedBranch =
  | { readonly kind: "resolved"; readonly branch: string }
  | { readonly kind: "unreadable"; readonly reason: string };

export type ServedBranchResolver = (repository: string) => Promise<ServedBranch>;

/** `git ls-remote --symref <url> HEAD`, read through `parseSymrefHead`; any other outcome is unreadable. */
export function servedBranchResolver(urlOf: (repository: string) => string): ServedBranchResolver {
  return async (repository) => {
    const url = urlOf(repository);
    const child = Bun.spawn(["git", "ls-remote", "--symref", url, "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
      // A prompt for credentials would hang the gate; a refusal is an answer.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) {
      return {
        kind: "unreadable",
        reason: `git ls-remote ${url} exited ${code}: ${stderr.trim().split("\n").pop() ?? ""}`,
      };
    }
    try {
      return { kind: "resolved", branch: parseSymrefHead(stdout) };
    } catch (error) {
      return { kind: "unreadable", reason: `${url}: ${(error as Error).message}` };
    }
  };
}

export const resolveServedBranchRemote: ServedBranchResolver = servedBranchResolver(
  (repository) => `https://github.com/${repository}.git`,
);

export interface TriggerTally {
  /** Entries read (not exempt), whether or not their served branch resolved. */
  repositories: number;
  exempt: number;
  /** Read entries whose served branch could not be resolved; their workflows are not judged. */
  unresolved: number;
  filesTracked: number;
  filesExamined: number;
  filesUnreadable: number;
  pushServed: number;
  pushTagOnly: number;
  pushRejected: number;
  /** Rule failures over the examined workflows; one workflow can carry several. */
  violations: number;
}

export function emptyTriggerTally(): TriggerTally {
  return {
    repositories: 0,
    exempt: 0,
    unresolved: 0,
    filesTracked: 0,
    filesExamined: 0,
    filesUnreadable: 0,
    pushServed: 0,
    pushTagOnly: 0,
    pushRejected: 0,
    violations: 0,
  };
}

export function summarizeTriggerVolume(t: TriggerTally): string {
  const push = t.pushServed + t.pushTagOnly + t.pushRejected;
  return `${t.repositories + t.exempt} inventory entries (${t.repositories} read, ${t.exempt} exempt), ${t.unresolved} with an unreadable served branch: ${t.filesTracked} tracked workflow(s) = ${t.filesExamined} examined + ${t.filesUnreadable} unreadable, ${push} push trigger(s) = ${t.pushServed} on the served branch + ${t.pushTagOnly} tag-only + ${t.pushRejected} rejected, ${t.violations} rule violation(s)`;
}

export async function reviewRepositoryTriggers(
  entry: RegistryEntry,
  tally: TriggerTally,
  reader: FleetFileReader = readRepositoryFiles,
  resolve: ServedBranchResolver = resolveServedBranchRemote,
): Promise<ItemCheck[]> {
  const exempt = exemption(entry);
  if (exempt !== null) {
    tally.exempt++;
    return [{ item: entry.repository, ok: true, note: `exempt: ${exempt}` }];
  }
  tally.repositories++;
  const served = await resolve(entry.repository);
  if (served.kind === "unreadable") {
    tally.unresolved++;
    return [
      {
        item: entry.repository,
        ok: false,
        note: `served branch unreadable, workflows not judged: ${served.reason}`,
      },
    ];
  }
  const { listing, files } = await reader(entry.repository, isWorkflowDefinition);
  if (listing.kind === "unreadable") {
    return [
      { item: entry.repository, ok: false, note: `tree unreadable at HEAD: ${listing.reason}` },
    ];
  }
  const workflows = listing.paths.filter(isWorkflowDefinition);
  tally.filesTracked += workflows.length;
  if (workflows.length === 0) {
    return [{ item: entry.repository, ok: true, note: "no workflow tracked" }];
  }
  const checks: ItemCheck[] = [];
  for (const path of workflows) {
    const item = `${entry.repository}:${path}`;
    const read = files.get(path);
    if (read === undefined || read.kind === "unreadable") {
      tally.filesUnreadable++;
      checks.push({
        item,
        ok: false,
        note: `unreadable at HEAD: ${read?.reason ?? "no read outcome recorded"}`,
      });
      continue;
    }
    const review = reviewTriggers(read.text, served.branch);
    if (review.unreadable !== null) {
      tally.filesUnreadable++;
      checks.push({ item, ok: false, note: `unreadable: ${review.unreadable}` });
      continue;
    }
    tally.filesExamined++;
    if (review.pushKind === "served-branch") tally.pushServed++;
    else if (review.pushKind === "tag-only") tally.pushTagOnly++;
    else if (review.pushKind === "rejected") tally.pushRejected++;
    tally.violations += review.failures.length;
    checks.push({
      item,
      ok: review.failures.length === 0,
      note:
        review.failures.length === 0
          ? `events: ${review.events.join(", ")} (served branch ${served.branch})`
          : review.failures.join("; "),
    });
  }
  return checks;
}

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const registry = parseRegistry(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const report = new GateReport();
  const tally = emptyTriggerTally();
  for (const entry of registry) {
    for (const check of await reviewRepositoryTriggers(entry, tally)) {
      report.check(check.item, check.ok, check.note);
    }
  }
  report.volume(summarizeTriggerVolume(tally));
  if (report.outcome !== "pass") {
    console.error(`Workflow triggers volume: ${summarizeTriggerVolume(tally)}`);
  }
  concludeGate("Workflow triggers", report);
}
