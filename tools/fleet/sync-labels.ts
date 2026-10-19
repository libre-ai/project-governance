/**
 * Label synchronisation planner: reads the organisation's label vocabulary
 * (`labels.yml`, held in the `.github` repository) and plans, per repository,
 * which labels would be created, updated or left alone.
 *
 *   bun tools/fleet/sync-labels.ts --labels <path to labels.yml> [--org <name>]
 *
 * The run is a DRY-RUN and nothing else: every call it makes is a read. Labels
 * are created by a script the owner runs with their own token, never by a CI job
 * holding an organisation token (design 2026-10-19-prd-ticketing §5/§11, attack
 * surface), so `--apply` is refused here rather than implemented behind a flag.
 *
 * The universe is derived, not listed: `gh repo list` names it, archived
 * repositories are excluded and counted, and a repository whose labels cannot
 * be read is a named failure — never a zero that looks like "nothing to do".
 *
 * Exit status: 0 when every active repository was read and planned; 1 when any
 * could not be read, when the listing itself failed or may be truncated; 2 on a
 * usage error or a refused `--apply`.
 */

import { readFile } from "node:fs/promises";

import type { Parsed } from "../quality/prd-model";

export interface LabelSpec {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

export interface SyncPlan {
  readonly create: readonly LabelSpec[];
  readonly update: readonly LabelSpec[];
  /** Existing labels left untouched: identical to the vocabulary, or not in it. */
  readonly keep: number;
}

/** GitHub label names are case-insensitive: `Ready` and `ready` are one label. */
const nameKey = (name: string): string => name.toLowerCase();

/** The API returns colors without `#`; a file may carry either case. */
const colorKey = (color: string): string => color.replace(/^#/, "").toLowerCase();

function indexByName(
  labels: readonly LabelSpec[],
  duplicateMessage: string,
): Map<string, LabelSpec> {
  const index = new Map<string, LabelSpec>();
  for (const label of labels) {
    const key = nameKey(label.name);
    if (index.has(key)) throw new Error(`${duplicateMessage}: ${label.name}`);
    index.set(key, label);
  }
  return index;
}

/**
 * Pure planner. A desired or existing set that names one label twice throws:
 * there is no honest plan for an ambiguous vocabulary, and a silent choice
 * would make the counters stop summing to the universe.
 *
 * An existing label that differs only by the case of its name is left alone —
 * renaming the case of a label is not worth rewriting every issue's display.
 * Existing labels outside the vocabulary are counted as kept and never deleted.
 */
export function planLabelSync(
  desired: readonly LabelSpec[],
  existing: readonly LabelSpec[],
): SyncPlan {
  const wanted = indexByName(desired, "desired label declared twice");
  const present = indexByName(existing, "existing label listed twice");
  const create: LabelSpec[] = [];
  const update: LabelSpec[] = [];
  for (const [key, label] of wanted) {
    const current = present.get(key);
    if (current === undefined) {
      create.push(label);
    } else if (
      colorKey(current.color) !== colorKey(label.color) ||
      current.description !== label.description
    ) {
      update.push(label);
    }
  }
  return { create, update, keep: present.size - update.length };
}

// --- labels.yml -------------------------------------------------------------

const KNOWN_KEYS = ["name", "color", "description"] as const;
const HEX_COLOR = /^[0-9a-fA-F]{6}$/;

const refuse = (reason: string): { readonly ok: false; readonly reason: string } => ({
  ok: false,
  reason,
});

/**
 * Reads the vocabulary file. Every defect is a refusal that names its entry:
 * a vocabulary that parses to fewer labels than the file declares would be
 * synchronised as if the missing ones did not exist.
 */
export function parseLabelsFile(text: string): Parsed<readonly LabelSpec[]> {
  let document: unknown;
  try {
    document = Bun.YAML.parse(text);
  } catch (error) {
    return refuse(`labels file is not valid YAML: ${(error as Error).message}`);
  }
  if (!Array.isArray(document)) return refuse("labels file root must be a sequence of labels");
  if (document.length === 0) return refuse("labels file must declare at least one label");

  const labels: LabelSpec[] = [];
  const firstSeen = new Map<string, number>();
  for (const [index, entry] of document.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return refuse(`entry ${index} must be a mapping with name, color and description`);
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
        return refuse(`entry ${index} has an unknown key "${key}"`);
      }
    }
    for (const field of KNOWN_KEYS) {
      if (!(field in record)) return refuse(`entry ${index} has no ${field}`);
      if (typeof record[field] !== "string") {
        return refuse(`entry ${index} ${field} must be a string (quote it in YAML)`);
      }
    }
    const { name, color, description } = record as Record<(typeof KNOWN_KEYS)[number], string>;
    if (name.trim() === "") return refuse(`entry ${index} name must not be empty`);
    if (name !== name.trim()) {
      return refuse(`entry ${index} name has surrounding whitespace: ${JSON.stringify(name)}`);
    }
    if (!HEX_COLOR.test(color)) {
      return refuse(
        `entry ${index} color must be 6 hexadecimal digits without #, got ${JSON.stringify(color)}`,
      );
    }
    const previous = firstSeen.get(nameKey(name));
    if (previous !== undefined) {
      return refuse(
        `entry ${index} name "${name}" duplicates entry ${previous} (case-insensitive)`,
      );
    }
    firstSeen.set(nameKey(name), index);
    labels.push({ name, color: color.toLowerCase(), description });
  }
  return { ok: true, value: labels };
}

// --- orchestration ----------------------------------------------------------

export interface GhResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The only door to the network: replaced by a fake in tests. */
export type RunGh = (args: readonly string[]) => Promise<GhResult>;

export interface SyncIo {
  readonly runGh: RunGh;
  readonly readFile: (path: string) => Promise<string>;
  readonly say: (line: string) => void;
}

const DEFAULT_ORG = "libre-ai";
const LIST_LIMIT = 200;
/** Used for the org and for every repository name that reaches a `gh api` path. */
const PLAIN_NAME = /^[A-Za-z0-9._-]+$/;

interface Options {
  readonly labelsPath: string;
  readonly org: string;
}

type OptionsOutcome =
  | { readonly ok: true; readonly options: Options }
  | { readonly ok: false; readonly message: string };

function parseArguments(argv: readonly string[]): OptionsOutcome {
  let labelsPath: string | null = null;
  let org = DEFAULT_ORG;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] as string;
    const value = (): string | null => {
      const next = argv[index + 1];
      if (next === undefined) return null;
      index += 1;
      return next;
    };
    if (argument === "--apply") {
      return { ok: false, message: "apply is an owner act, not implemented here" };
    }
    if (argument === "--dry-run") continue;
    if (argument === "--labels" || argument === "--org") {
      const given = value();
      if (given === null) return { ok: false, message: `${argument} needs a value` };
      if (argument === "--labels") labelsPath = given;
      else org = given;
    } else {
      return { ok: false, message: `unknown argument ${argument}` };
    }
  }
  if (labelsPath === null) return { ok: false, message: "--labels <path> is required" };
  if (!PLAIN_NAME.test(org)) return { ok: false, message: `--org is not a plain name: ${org}` };
  return { ok: true, options: { labelsPath, org } };
}

interface Repository {
  readonly name: string;
  readonly isArchived: boolean;
  readonly isPrivate: boolean;
}

function parseRepositories(stdout: string): Parsed<readonly Repository[]> {
  let document: unknown;
  try {
    document = JSON.parse(stdout);
  } catch {
    return refuse("the repository listing is not JSON");
  }
  if (!Array.isArray(document)) return refuse("the repository listing is not an array");
  const repositories: Repository[] = [];
  for (const [index, entry] of document.entries()) {
    const record = entry as Record<string, unknown> | null;
    if (
      typeof record !== "object" ||
      record === null ||
      typeof record.name !== "string" ||
      typeof record.isArchived !== "boolean" ||
      typeof record.isPrivate !== "boolean"
    ) {
      return refuse(`repository listing entry ${index} lacks name, isArchived or isPrivate`);
    }
    repositories.push({
      name: record.name,
      isArchived: record.isArchived,
      isPrivate: record.isPrivate,
    });
  }
  return { ok: true, value: repositories };
}

/**
 * `gh api --paginate --slurp` wraps every page in one outer array, so a
 * repository with more than 30 labels is not read as its first page only.
 */
function parseExistingLabels(stdout: string): Parsed<readonly LabelSpec[]> {
  let document: unknown;
  try {
    document = JSON.parse(stdout);
  } catch {
    return refuse("labels response is not JSON");
  }
  if (!Array.isArray(document) || document.length === 0) {
    return refuse("labels response has no page");
  }
  const labels: LabelSpec[] = [];
  for (const page of document) {
    if (!Array.isArray(page)) return refuse("labels response page is not an array");
    for (const entry of page) {
      const record = entry as Record<string, unknown> | null;
      if (
        typeof record !== "object" ||
        record === null ||
        typeof record.name !== "string" ||
        typeof record.color !== "string" ||
        (record.description !== null && typeof record.description !== "string")
      ) {
        return refuse("labels response entry lacks name, color or description");
      }
      labels.push({
        name: record.name,
        color: record.color,
        // The API reports an absent description as null; the vocabulary uses "".
        description: record.description ?? "",
      });
    }
  }
  return { ok: true, value: labels };
}

const detail = (result: GhResult): string => {
  const text = (result.stderr.trim() || result.stdout.trim()).split("\n")[0] ?? "";
  return `gh exited ${result.code}${text === "" ? "" : `: ${text}`}`;
};

interface Planned {
  readonly repository: Repository;
  readonly existing: number;
  readonly plan: SyncPlan;
}

/** Returns the exit status. Writes through `io.say` only; calls `gh` only to read. */
export async function runLabelSync(argv: readonly string[], io: SyncIo): Promise<number> {
  const parsedArguments = parseArguments(argv);
  if (!parsedArguments.ok) {
    io.say(parsedArguments.message);
    return 2;
  }
  const { labelsPath, org } = parsedArguments.options;

  let desired: readonly LabelSpec[];
  try {
    const parsed = parseLabelsFile(await io.readFile(labelsPath));
    if (!parsed.ok) {
      io.say(`${labelsPath}: ${parsed.reason}`);
      return 1;
    }
    desired = parsed.value;
  } catch (error) {
    io.say(`cannot read ${labelsPath}: ${(error as Error).message}`);
    return 1;
  }

  let listing: GhResult;
  try {
    listing = await io.runGh([
      "repo",
      "list",
      org,
      "--limit",
      String(LIST_LIMIT),
      "--json",
      "name,isArchived,isPrivate",
    ]);
  } catch (error) {
    io.say(`cannot list the repositories of ${org}: ${(error as Error).message}`);
    return 1;
  }
  if (listing.code !== 0) {
    io.say(`cannot list the repositories of ${org}: ${detail(listing)}`);
    return 1;
  }
  const repositories = parseRepositories(listing.stdout);
  if (!repositories.ok) {
    io.say(`cannot list the repositories of ${org}: ${repositories.reason}`);
    return 1;
  }
  if (repositories.value.length === 0) {
    io.say(`no repository listed for ${org}: the tool lost its input`);
    return 1;
  }
  if (repositories.value.length >= LIST_LIMIT) {
    // gh truncates silently at --limit: a full page may hide repositories.
    io.say(
      `${repositories.value.length} repositories reach the listing limit of ${LIST_LIMIT}: the universe may be truncated`,
    );
    return 1;
  }

  const planned: Planned[] = [];
  const unreadable: { readonly name: string; readonly reason: string }[] = [];
  let archived = 0;
  for (const repository of repositories.value) {
    if (repository.isArchived) {
      archived += 1;
      continue;
    }
    if (!PLAIN_NAME.test(repository.name)) {
      unreadable.push({ name: repository.name, reason: "name is not a plain identifier" });
      continue;
    }
    let result: GhResult;
    try {
      result = await io.runGh([
        "api",
        "--paginate",
        "--slurp",
        `repos/${org}/${repository.name}/labels`,
      ]);
    } catch (error) {
      unreadable.push({ name: repository.name, reason: (error as Error).message });
      continue;
    }
    if (result.code !== 0) {
      unreadable.push({ name: repository.name, reason: detail(result) });
      continue;
    }
    const existing = parseExistingLabels(result.stdout);
    if (!existing.ok) {
      unreadable.push({ name: repository.name, reason: existing.reason });
      continue;
    }
    try {
      planned.push({
        repository,
        existing: existing.value.length,
        plan: planLabelSync(desired, existing.value),
      });
    } catch (error) {
      unreadable.push({ name: repository.name, reason: (error as Error).message });
    }
  }

  const total = repositories.value.length;
  const sum = (pick: (entry: Planned) => number): number =>
    planned.reduce((acc, entry) => acc + pick(entry), 0);
  const create = sum((entry) => entry.plan.create.length);
  const update = sum((entry) => entry.plan.update.length);
  const keep = sum((entry) => entry.plan.keep);
  const labelsRead = sum((entry) => entry.existing);

  io.say(`Label synchronisation plan for ${org} (dry-run, nothing written)`);
  io.say(`Vocabulary: ${desired.length} label(s) from ${labelsPath}`);
  for (const entry of planned) {
    io.say(
      `- ${entry.repository.name}${entry.repository.isPrivate ? " (private)" : ""}: ` +
        `create ${entry.plan.create.length}, update ${entry.plan.update.length}, keep ${entry.plan.keep}`,
    );
  }
  for (const entry of unreadable) io.say(`- ${entry.name}: UNREADABLE — ${entry.reason}`);
  io.say(
    `${total} dépôts listés, ${archived} archivés exclus, ${planned.length} planifiés, ` +
      `${unreadable.length} illisibles ; créer ${create}, mettre à jour ${update}, conserver ${keep}`,
  );
  io.say(`${labelsRead} labels lus = ${update} à mettre à jour + ${keep} conservés`);

  // The counters must sum to the universe; a mismatch is a bug in this tool.
  if (total !== archived + planned.length + unreadable.length || labelsRead !== update + keep) {
    io.say("counters do not sum to the universe: refusing to report a plan");
    return 1;
  }
  return unreadable.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  const runGh: RunGh = async (args) => {
    const child = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, stdout, stderr };
  };
  const code = await runLabelSync(process.argv.slice(2), {
    runGh,
    readFile: (path) => readFile(path, "utf8"),
    say: (line) => console.log(line),
  });
  process.exit(code);
}
