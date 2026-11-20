/**
 * Local working clones of the fleet: clone what the inventory declares and is
 * missing on disk, and audit, read-only, how each clone stands against its
 * upstream.
 *
 *   bun tools/fleet/local-clones.ts clone --root <absolute path> [--dry-run]
 *   bun tools/fleet/local-clones.ts audit --root <absolute path>
 *
 * This is NOT the pinned composition (docs/LOCAL-COMPOSITION.md): that recipe
 * checks out the revisions of a manifest into a fresh folder. This tool keeps
 * working clones at whatever line the remote serves, and refuses a root that
 * carries the composition receipt.
 *
 * Single source: the repository list is the inventory, read through
 * `buildIndex` from the location of this file. There is no forge call, no
 * repository list and no branch written here. An unreadable inventory is a
 * failure, never an empty list.
 *
 * Every inventory entry lands in exactly one state, first true condition:
 * archived, private (excluded by doctrine, which is not "unreadable"), unsafe
 * (a slug that is not two plain segments), then
 *   clone: present | occupied | cloned (would-clone under --dry-run) | failed
 *   audit: absent | occupied | examined
 *
 * `clone` only ever creates: an existing path is never fetched, checked out or
 * written to. `audit` runs one read-only git command per clone and creates no
 * file; the commands it prints are for a person to copy, it runs none of them.
 *
 * Exit status: 2 on a usage error or an invalid root; 1 on a composition root,
 * an unreadable inventory, counters that do not sum, or any entry that is
 * unsafe, occupied, failed or unreadable; 0 otherwise. Absent, archived and
 * private entries, and clones that need an arbitration, do not fail the run.
 */

import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { buildIndex, INVENTORY_SOURCE } from "../../ecosystem/build-index";
import { findUnreadableCharacter } from "../quality/yaml-text-guard";
import {
  CLONE_CATEGORIES,
  type CloneCategory,
  type CloneState,
  classifyClone,
} from "./clone-state";

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface LocalClonesIo {
  /** The only door to git: replaced by a fake in tests. `cwd` is null for a clone. */
  readonly runGit: (args: readonly string[], cwd: string | null) => Promise<GitResult>;
  /** Slug to remote URL: the second door, so no test reaches a forge. */
  readonly remoteUrl: (slug: string) => string;
  readonly readInventory: () => string;
  readonly say: (line: string) => void;
  readonly warn: (line: string) => void;
}

type Verb = "clone" | "audit";

interface Options {
  readonly verb: Verb;
  readonly root: string | null;
  readonly dryRun: boolean;
}

const USAGE =
  "usage: local-clones.ts clone --root <absolute path> [--dry-run] | audit --root <absolute path>";

/** Returns the options, or the reason the command line is refused. */
function parseArguments(argv: readonly string[]): Options | string {
  const verb = argv[0];
  if (verb !== "clone" && verb !== "audit") return `unknown verb ${printable(verb ?? "(none)")}`;
  let root: string | null = null;
  let dryRun = false;
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index] as string;
    if (argument === "--root") {
      const value = argv[index + 1];
      if (value === undefined) return "--root needs a value";
      if (root !== null) return "--root given twice";
      root = value;
      index += 1;
    } else if (argument === "--dry-run" && verb === "clone") {
      dryRun = true;
    } else {
      return `unknown argument ${printable(argument)} for ${verb}`;
    }
  }
  return { verb, root, dryRun };
}

/** Control characters never reach a terminal through a slug or a git message. */
function printable(text: string): string {
  return text.replace(/\p{Cc}/gu, "?");
}

const firstLine = (text: string): string => printable(text.trim().split("\n")[0] ?? "");

const message = (error: unknown): string =>
  firstLine(error instanceof Error ? error.message : String(error));

/** The direct children of a valid root, or the reason the root is refused. */
function readRoot(root: string): readonly string[] | string {
  if (!isAbsolute(root)) return "the root must be an absolute path";
  try {
    if (realpathSync(root) !== root) return "the root must be canonical (no link, no dot segment)";
    // A root that is not a directory fails here too: there is nothing to list.
    return readdirSync(root);
  } catch (error) {
    return `the root cannot be read: ${message(error)}`;
  }
}

const PLAIN_SEGMENT = /^[A-Za-z0-9._-]+$/;
/** Compared in lower case: a file system that folds case makes `.Git` the `.git` directory. */
const RESERVED_SEGMENTS: readonly string[] = [".", "..", ".git"];

/**
 * The directory name of a slug, or null when the slug is not exactly two plain
 * segments. A null name is never joined to the root: that is what keeps a slug
 * holding a dot segment or a separator from naming a path outside it.
 */
function directoryName(slug: string): string | null {
  const segments = slug.split("/");
  if (segments.length !== 2) return null;
  for (const segment of segments) {
    if (!PLAIN_SEGMENT.test(segment) || RESERVED_SEGMENTS.includes(segment.toLowerCase())) {
      return null;
    }
  }
  return segments[1] as string;
}

type PathShape = "missing" | "clone" | "occupied";

/**
 * `lstat`, never `stat`: a link is occupied, not followed. A directory whose
 * `.git` is a file is a linked worktree, whose history lives elsewhere: it is
 * occupied too, never treated as a clone.
 */
function shapeOf(path: string): PathShape {
  try {
    if (!lstatSync(path).isDirectory()) return "occupied";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "occupied";
  }
  try {
    return lstatSync(join(path, ".git")).isDirectory() ? "clone" : "occupied";
  } catch {
    return "occupied";
  }
}

/**
 * A door that answers with neither zero nor another whole number has said
 * neither "done" nor "failed". The entry is then left out of every counter, so
 * the sum check refuses the report instead of filing it under a guess.
 */
function outcomeOf(result: GitResult): "ok" | "error" | null {
  if (!Number.isInteger(result.code)) return null;
  return result.code === 0 ? "ok" : "error";
}

const gitDetail = (result: GitResult): string => {
  const text = firstLine(result.stderr) || firstLine(result.stdout);
  return `git exited ${result.code}${text === "" ? "" : `: ${text}`}`;
};

const sumsTo = (total: number, parts: readonly number[]): boolean =>
  parts.reduce((sum, part) => sum + part, 0) === total;

/**
 * Global options first. `--git-dir` and `--work-tree` name the clone itself:
 * started from its directory alone, git walks up to the first repository it
 * finds, and a `.git` that is not a repository would be read as the one that
 * encloses the root. `--no-optional-locks` keeps `status` from refreshing the
 * index on disk, and `core.fsmonitor=false` keeps it from running the command a
 * clone's own configuration may name there: reading a state must neither write
 * nor execute.
 */
const statusArgs = (clone: string): readonly string[] => [
  `--git-dir=${join(clone, ".git")}`,
  `--work-tree=${clone}`,
  "--no-optional-locks",
  "-c",
  "core.fsmonitor=false",
  "status",
  "--porcelain=v2",
  "--branch",
  "--untracked-files=all",
];

interface Reading {
  readonly state: CloneState;
  readonly modified: number;
  readonly untracked: number;
}

const UNREADABLE_STATE: CloneState = {
  head: "unreadable",
  branch: null,
  upstream: false,
  behind: 0,
  ahead: 0,
  dirty: false,
};

/**
 * Reads `git status --porcelain=v2 --branch`. Ahead and behind come from the
 * local references only. An upstream that is configured but whose reference is
 * gone carries no `branch.ab` line and is read as no upstream: `@{upstream}`
 * does not resolve there either.
 */
function readStatus(stdout: string): Reading {
  let head: string | null = null;
  let counts: { readonly ahead: number; readonly behind: number } | null = null;
  let modified = 0;
  let untracked = 0;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      head = line.slice("# branch.head ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
      if (match === null) return { state: UNREADABLE_STATE, modified: 0, untracked: 0 };
      counts = { ahead: Number(match[1]), behind: Number(match[2]) };
    } else if (line.startsWith("? ")) {
      untracked += 1;
    } else if (/^[12u] /.test(line)) {
      modified += 1;
    }
  }
  if (head === null || head === "") return { state: UNREADABLE_STATE, modified: 0, untracked: 0 };
  const detached = head === "(detached)";
  return {
    state: {
      head: detached ? "detached" : "branch",
      branch: detached ? null : head,
      upstream: counts !== null,
      behind: counts?.behind ?? 0,
      ahead: counts?.ahead ?? 0,
      dirty: modified + untracked > 0,
    },
    modified,
    untracked,
  };
}

/** Returns the exit status. Writes through `io.say` and `io.warn` only. */
export async function runLocalClones(argv: readonly string[], io: LocalClonesIo): Promise<number> {
  const options = parseArguments(argv);
  if (typeof options === "string") {
    io.warn(`cause=usage ${options}`);
    io.warn(USAGE);
    return 2;
  }
  if (options.root === null) {
    io.warn("cause=usage --root <absolute path> is required, there is no default");
    io.warn(USAGE);
    return 2;
  }
  const { verb, root, dryRun } = options;
  const children = readRoot(root);
  if (typeof children === "string") {
    io.warn(`cause=invalid-root ${children}`);
    return 2;
  }
  if (children.includes(".composition-state.json")) {
    io.warn(
      "cause=composition-root the root carries .composition-state.json: it is a pinned composition, not read and not written here",
    );
    return 1;
  }

  let entries: ReturnType<typeof buildIndex>["repositories"];
  try {
    const text = io.readInventory();
    // Before the parser: it stops at a NUL without saying so, and an inventory
    // cut short would be cloned and audited as if the rest did not exist.
    const unreadable = findUnreadableCharacter(text);
    if (unreadable !== null) {
      throw new Error(`unreadable character ${unreadable.codePoint} on line ${unreadable.line}`);
    }
    entries = buildIndex(text).repositories;
  } catch (error) {
    io.warn(`cause=inventory-unreadable ${message(error)}`);
    return 1;
  }

  const declared = entries.length;
  // Folded like `claimed` below: on a file system that folds case, `Alpha` on
  // disk is the path of the entry `alpha`, not a clone outside the inventory.
  const inventoryNames = new Set<string>();
  for (const entry of entries) {
    const name = directoryName(entry.repository);
    if (name !== null) inventoryNames.add(name.toLowerCase());
  }

  let archived = 0;
  let excludedPrivate = 0;
  let unsafe = 0;
  let present = 0;
  let occupied = 0;
  let cloned = 0;
  let failed = 0;
  let absent = 0;
  let examined = 0;
  const categories: Record<CloneCategory, number> = {
    unreadable: 0,
    detached: 0,
    "no-upstream": 0,
    "up-to-date": 0,
    "behind-dirty": 0,
    diverged: 0,
    "fast-forwardable": 0,
  };
  // Two slugs may end in one name, and a file system may fold case: the first
  // entry owns the path, the next one is occupied rather than a second clone.
  const claimed = new Set<string>();

  if (verb === "audit") {
    io.say(
      "# ahead and behind reflect the last fetch the user ran: this audit reads local references and never fetches",
    );
  }

  for (const entry of entries) {
    const slug = entry.repository;
    if (entry.lifecycle === "archived") {
      archived += 1;
      io.say(`- ${printable(slug)} archived`);
      continue;
    }
    if (entry.visibility === "private") {
      excludedPrivate += 1;
      io.say(`- ${printable(slug)} private`);
      continue;
    }
    const name = directoryName(slug);
    if (name === null) {
      unsafe += 1;
      io.say(`! ${JSON.stringify(printable(slug))} unsafe`);
      io.warn(`cause=unsafe-path ${JSON.stringify(printable(slug))} is not two plain segments`);
      continue;
    }
    const path = join(root, name);
    const key = name.toLowerCase();
    const shape: PathShape = claimed.has(key) ? "occupied" : shapeOf(path);
    const alreadyClaimed = claimed.has(key);
    claimed.add(key);

    if (shape === "occupied") {
      occupied += 1;
      io.say(`! ${name} occupied`);
      io.warn(
        `cause=occupied-path ${name} ${
          alreadyClaimed
            ? "is already the path of another inventory entry"
            : "exists and is not a clone with its own .git directory"
        }`,
      );
      continue;
    }

    if (verb === "clone") {
      if (shape === "clone") {
        present += 1;
        io.say(`= ${name} present`);
        continue;
      }
      if (dryRun) {
        cloned += 1;
        io.say(`+ would-clone ${slug} -> ${name}`);
        continue;
      }
      let result: GitResult;
      try {
        // No branch is named: the remote announces the line it serves. `--`
        // ends the options, so neither the URL nor the path is read as one.
        result = await io.runGit(["clone", "--", io.remoteUrl(slug), path], null);
      } catch (error) {
        failed += 1;
        io.say(`! ${name} failed`);
        io.warn(`cause=clone-failed ${name}: ${message(error)}`);
        continue;
      }
      const outcome = outcomeOf(result);
      if (outcome === "ok") {
        cloned += 1;
        io.say(`+ clone ${slug} -> ${name}`);
      } else if (outcome === "error") {
        failed += 1;
        io.say(`! ${name} failed`);
        io.warn(`cause=clone-failed ${name}: ${gitDetail(result)}`);
      }
      continue;
    }

    if (shape === "missing") {
      absent += 1;
      io.say(`- ${name} absent`);
      continue;
    }
    let reading: Reading;
    let failure: string | null = null;
    try {
      const result = await io.runGit(statusArgs(path), path);
      const outcome = outcomeOf(result);
      if (outcome === null) continue;
      if (outcome === "ok") {
        reading = readStatus(result.stdout);
        if (reading.state.head === "unreadable") failure = "git status gave no readable head";
      } else {
        reading = { state: UNREADABLE_STATE, modified: 0, untracked: 0 };
        failure = gitDetail(result);
      }
    } catch (error) {
      reading = { state: UNREADABLE_STATE, modified: 0, untracked: 0 };
      failure = message(error);
    }
    const verdict = classifyClone(reading.state, path);
    examined += 1;
    categories[verdict.category] += 1;
    if (verdict.category === "unreadable") {
      io.warn(`cause=unreadable-state ${name}: ${failure ?? "the state read is not coherent"}`);
    }
    io.say(
      [
        name,
        reading.state.head === "branch"
          ? printable(reading.state.branch ?? "-")
          : `(${reading.state.head})`,
        `modified=${reading.modified}`,
        `untracked=${reading.untracked}`,
        `ahead=${reading.state.ahead}`,
        `behind=${reading.state.behind}`,
        verdict.category,
        verdict.command ?? "-",
      ].join("\t"),
    );
  }

  const failing = unsafe + occupied + failed + categories.unreadable > 0;

  if (verb === "clone") {
    if (!sumsTo(declared, [cloned, present, occupied, archived, excludedPrivate, unsafe, failed])) {
      io.warn(
        `cause=counters-mismatch declared=${declared} is not the sum of the clone counters: refusing to report`,
      );
      return 1;
    }
    io.say(
      `declared=${declared} ${dryRun ? "would-clone" : "cloned"}=${cloned} present=${present} ` +
        `occupied=${occupied} archived=${archived} private=${excludedPrivate} unsafe=${unsafe} failed=${failed}`,
    );
    return failing ? 1 : 0;
  }

  const categoryCounts = CLONE_CATEGORIES.map((category) => categories[category]);
  if (
    !sumsTo(declared, [examined, absent, occupied, archived, excludedPrivate, unsafe]) ||
    !sumsTo(examined, categoryCounts)
  ) {
    io.warn(
      `cause=counters-mismatch declared=${declared} examined=${examined} are not the sums of the audit counters: refusing to report`,
    );
    return 1;
  }
  // Counted, never named: a clone outside the inventory may be one the
  // inventory keeps unnamed on purpose.
  const outside = children.filter(
    (child) => !inventoryNames.has(child.toLowerCase()) && shapeOf(join(root, child)) === "clone",
  ).length;
  io.say(
    `declared=${declared} examined=${examined} absent=${absent} occupied=${occupied} ` +
      `archived=${archived} private=${excludedPrivate} unsafe=${unsafe}`,
  );
  io.say(
    `categories: ${CLONE_CATEGORIES.map((category) => `${category}=${categories[category]}`).join(" ")}`,
  );
  io.say(`outside-inventory=${outside}`);
  return failing ? 1 : 0;
}

/**
 * The real git door. Every inherited `GIT_*` variable is dropped: under a hook,
 * git exports the directory and index of the repository it is running for, and
 * every clone would then be read as that one repository. The prompt is turned
 * off so a clone that needs credentials fails instead of waiting on a terminal.
 */
export async function runGitProcess(
  args: readonly string[],
  cwd: string | null,
): Promise<GitResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  env.GIT_TERMINAL_PROMPT = "0";
  const child = Bun.spawn(["git", ...args], {
    ...(cwd === null ? {} : { cwd }),
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

if (import.meta.main) {
  const inventory = new URL(`../../${INVENTORY_SOURCE}`, import.meta.url);
  const code = await runLocalClones(process.argv.slice(2), {
    runGit: runGitProcess,
    remoteUrl: (slug) => `https://github.com/${slug}.git`,
    readInventory: () => readFileSync(inventory, "utf8"),
    say: (line) => console.log(line),
    warn: (line) => console.error(line),
  });
  process.exit(code);
}
