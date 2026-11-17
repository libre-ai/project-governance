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
 *      event name or the ref can opt out of pull-request runs: refused, in any
 *      case and through the index syntax (`github['ref']`). Step conditions are
 *      not judged, nor other contexts (`github.ref_name`): the brief fixes the
 *      list at these two reads.
 *
 * A key written twice in one mapping (`on`, `branches`, …) makes the workflow
 * unreadable, never judged on the occurrence the parser happened to keep.
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

/**
 * A read of `github.<property>` as GitHub evaluates it: context and property
 * names compare without regard to case, and the index syntax
 * (`github['ref']`, `github["ref"]`) reaches the same value as the dot.
 */
function contextRead(property: string): RegExp {
  return new RegExp(
    `\\bgithub\\s*(?:\\.\\s*${property}(?![\\w-])|\\[\\s*(['"])${property}\\1\\s*\\])`,
    "i",
  );
}

/** The two contexts a job condition reads to tell a pull-request run from another one. */
const EVENT_READS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "github.event_name", pattern: contextRead("event_name") },
  { name: "github.ref", pattern: contextRead("ref") },
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

/*
 * Duplicate keys. `Bun.YAML.parse` keeps the last of two equal keys in
 * silence, so `push: branches: [other]` followed by `branches: [served]` reads
 * green. The text is therefore read a second time, line by line, for every
 * mapping it writes — block style by indentation, flow style (`{ … }`, also
 * inside `[ … ]`) on its line — and any key written twice in one mapping makes
 * the workflow unreadable. What this reading cannot follow is refused rather
 * than skipped: a flow collection continued past its line, an explicit `? `
 * key, a merge key `<<`.
 */

type LayoutProblem = string | null;

/** `"…"` (backslash escapes) or `'…'` (`''` escape) starting at `start`; the index after it, or -1. */
function quotedEnd(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (quote === '"' && c === "\\") {
      i++;
    } else if (c === quote) {
      if (quote === "'" && text[i + 1] === "'") i++;
      else return i + 1;
    }
  }
  return -1;
}

type FlowScan =
  | { readonly kind: "read"; readonly end: number }
  | { readonly kind: "problem"; readonly reason: string };

function skipSpaces(text: string, i: number): number {
  let at = i;
  while (text[at] === " " || text[at] === "\t") at++;
  return at;
}

/** A plain scalar in flow context ends at `,`, a closing bracket, or a `:` followed by a space. */
function plainFlowEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === "," || c === "]" || c === "}" || c === "[" || c === "{") break;
    if (c === ":" && /[\s,\]}]/.test(text[i + 1] ?? " ")) break;
    if (c === "#" && (text[i - 1] === " " || text[i - 1] === "\t")) break;
    i++;
  }
  return i;
}

/** One flow node (collection or scalar) at `start`; nested mappings are checked for duplicates. */
function scanFlowNode(text: string, start: number, line: number): FlowScan & { key?: string } {
  const i = skipSpaces(text, start);
  const c = text[i];
  if (c === "{" || c === "[") return scanFlowCollection(text, i, line);
  if (c === '"' || c === "'") {
    const end = quotedEnd(text, i);
    if (end < 0)
      return {
        kind: "problem",
        reason: `a quoted scalar inside a flow collection is continued past line ${line}, which this reading does not follow`,
      };
    return { kind: "read", end, key: text.slice(i + 1, end - 1) };
  }
  const end = plainFlowEnd(text, i);
  return { kind: "read", end, key: text.slice(i, end).trim() };
}

function scanFlowCollection(text: string, open: number, line: number): FlowScan {
  const mapping = text[open] === "{";
  const close = mapping ? "}" : "]";
  const keys = new Set<string>();
  let i = skipSpaces(text, open + 1);
  while (i < text.length) {
    if (text[i] === close) return { kind: "read", end: i + 1 };
    const first = scanFlowNode(text, i, line);
    if (first.kind === "problem") return first;
    i = skipSpaces(text, first.end);
    let isPair = false;
    if (text[i] === ":") {
      isPair = true;
      const value = scanFlowNode(text, i + 1, line);
      if (value.kind === "problem") return value;
      i = skipSpaces(text, value.end);
    }
    if (mapping || isPair) {
      const key = first.key;
      if (key === undefined) {
        return {
          kind: "problem",
          reason: `a flow mapping on line ${line} has a collection as a key, which this reading does not follow`,
        };
      }
      if (mapping && keys.has(key)) {
        return {
          kind: "problem",
          reason: `key \`${key}\` is written twice in one mapping (line ${line}): YAML keeps one of them in silence`,
        };
      }
      keys.add(key);
    }
    if (text[i] === ",") i = skipSpaces(text, i + 1);
    else if (text[i] !== close) break;
  }
  return {
    kind: "problem",
    reason: `a flow collection opened on line ${line} is not closed on its line, or holds a form this reading does not follow`,
  };
}

/** A flow collection standing as a whole value at `start`; only a comment may follow it. */
function flowValueProblem(text: string, start: number, line: number): LayoutProblem {
  const scan = scanFlowCollection(text, start, line);
  if (scan.kind === "problem") return scan.reason;
  const rest = text.slice(scan.end).trim();
  if (rest !== "" && !rest.startsWith("#")) {
    return `text follows a flow collection on line ${line}, which this reading does not follow`;
  }
  return null;
}

const PLAIN_KEY = /^([^\s#'"{}[\],&*!|>%@`?:](?:[^:\s]|[ \t]+(?=[^\s#])|:(?=\S))*?)[ \t]*:(?=\s|$)/;
const BLOCK_SCALAR = /^[|>][-+0-9]*[ \t]*(?:#.*)?$/;
const PROPERTIES = /^(?:[&!]\S*[ \t]+)*/;

/** The key written at the start of `rest`, and the text after its colon; null when `rest` is not a key. */
function splitKey(rest: string): { readonly key: string; readonly value: string } | null {
  if (rest.startsWith('"') || rest.startsWith("'")) {
    const end = quotedEnd(rest, 0);
    if (end < 0) return null;
    const after = rest.slice(end);
    const colon = /^[ \t]*:(?=\s|$)/.exec(after);
    if (colon === null) return null;
    return { key: rest.slice(1, end - 1), value: after.slice(colon[0].length).trim() };
  }
  const plain = PLAIN_KEY.exec(rest);
  if (plain?.[1] === undefined) return null;
  return { key: plain[1], value: rest.slice(plain[0].length).trim() };
}

interface Frame {
  readonly indent: number;
  readonly keys: Set<string>;
}

/** The first key written twice in one mapping, or the first construct this reading refuses. */
function findLayoutProblem(text: string): LayoutProblem {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  let frames: Frame[] = [];
  /** Lines indented deeper than this belong to a block scalar. */
  let blockScalarParent: number | null = null;
  /** A quoted scalar opened on an earlier line and not closed yet. */
  let openQuote: string | null = null;

  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    if (openQuote !== null) {
      const closing = quotedEnd(`${openQuote}${line}`, 0);
      if (closing >= 0) openQuote = null;
      continue;
    }
    if (blockScalarParent !== null) {
      if (content === "" || indent > blockScalarParent) continue;
      blockScalarParent = null;
    }
    if (content === "" || content.startsWith("#")) continue;
    if (/^(?:---|\.\.\.)(?:\s|$)/.test(line)) {
      frames = [];
      continue;
    }
    frames = frames.filter((frame) => frame.indent <= indent);

    // Sequence entries: each `- ` opens a new item; a key after them opens its mapping.
    let column = indent;
    let rest = content;
    let entry = false;
    for (
      let dash = /^-(?:[ \t]+|$)/.exec(rest);
      dash !== null;
      dash = /^-(?:[ \t]+|$)/.exec(rest)
    ) {
      entry = true;
      column += dash[0].length;
      rest = rest.slice(dash[0].length);
    }
    if (rest === "" || rest.startsWith("#")) continue;
    if (rest.startsWith("? ") || rest === "?") {
      return `an explicit \`?\` key on line ${number} is not read`;
    }
    const body = rest.replace(PROPERTIES, "");
    const pair = splitKey(body);
    if (pair === null) {
      if (BLOCK_SCALAR.test(body)) {
        blockScalarParent = indent;
      } else if (body.startsWith("{") || body.startsWith("[")) {
        const problem = flowValueProblem(body, 0, number);
        if (problem !== null) return problem;
      } else if ((body.startsWith('"') || body.startsWith("'")) && quotedEnd(body, 0) < 0) {
        openQuote = body[0] ?? null;
      }
      continue;
    }
    if (pair.key === "<<") return `a merge key \`<<\` on line ${number} is not read`;

    const top = frames.at(-1);
    if (!entry && top !== undefined && top.indent === column) {
      if (top.keys.has(pair.key)) {
        return `key \`${pair.key}\` is written twice in one mapping (line ${number}): YAML keeps one of them in silence`;
      }
      top.keys.add(pair.key);
    } else {
      frames = frames.filter((frame) => frame.indent < column);
      frames.push({ indent: column, keys: new Set([pair.key]) });
    }

    const value = pair.value.replace(PROPERTIES, "");
    if (BLOCK_SCALAR.test(value)) {
      blockScalarParent = column;
    } else if (value.startsWith("{") || value.startsWith("[")) {
      const problem = flowValueProblem(value, 0, number);
      if (problem !== null) return problem;
    } else if ((value.startsWith('"') || value.startsWith("'")) && quotedEnd(value, 0) < 0) {
      openQuote = value[0] ?? null;
    }
  }
  return null;
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
  const layout = findLayoutProblem(text);
  if (layout !== null) return unreadableReview(layout);
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
