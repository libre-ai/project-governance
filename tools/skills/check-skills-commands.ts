/**
 * Skill commands gate (T5) — the git commands a skill prescribes, replayed in
 * a trapped repository.
 *
 * T4 reads what a skill tells the agent to run and refuses the obvious forms
 * of a risky instruction. None of the skill gates runs a prescribed command,
 * so a `git diff` written in prose is never seen doing what it does in a
 * real checkout: running the external diff helper, the textconv driver or
 * the pager the user configured, or colouring an output an agent then parses.
 * This gate extracts every `git …` command of every Markdown file under
 * `skills/` (fenced blocks and inline code spans), classifies it, and replays
 * the read-only ones in a fresh repository whose configuration is a set of
 * traps. A trap that fires, or a repository state that differs after the
 * command, is a failure.
 *
 * Method taken from the drill of 2026-11-23 (an upstream test replays the git
 * commands of its own prose in a trapped repository), rewritten: no line is
 * copied. Two things are stricter here. The upstream pager trap runs without
 * a terminal, where git never starts a pager, so it cannot fire; this gate
 * replays every command a second time under a pseudo-terminal and fails when
 * it cannot open one. And the state is compared before and after each replay.
 *
 * Classes, each extracted command in exactly one:
 *
 * - `replay`: a read-only subcommand, every word literal. Replayed through
 *   both channels, `pipe` and `terminal`, each in a fresh fixture.
 * - `write`: any other subcommand, including those with a listing mode
 *   (`branch`, `stash`, `config`) and those this gate does not know. Never run.
 * - `not-executable`: a word the gate cannot take literally (a placeholder
 *   `<servie>`, a shell expansion, a redirection, a glob), a global option
 *   other than `--no-pager`, or an option that names a program or a file
 *   outside the fixture (`--upload-pack`, `--output`, `grep -O`). Never run.
 *
 * Threat model of the replay: the argv comes from repository content. It is
 * run without a shell, as an argv, with a purged environment (`PATH` alone is
 * kept), `HOME` in the fixture, no system config, inside a temporary
 * directory. Anyone able to change `skills/` can change a test file that
 * `bun test` runs, so the replay adds no reach a pull request did not have;
 * the refused options are defence in depth, not a sandbox.
 *
 * Limits: a code span that breaks across lines is not read; a command inside
 * `$( … )` is not extracted; an exit status other than git's own refusal
 * (128, 129) is not judged, since `check-ignore` and `merge-base
 * --is-ancestor` answer through it.
 */

import { mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { loadSkillTree } from "./check-skills-security";

export type CommandClass = "replay" | "write" | "not-executable";
export type ReplayChannel = "pipe" | "terminal";
export const REPLAY_CHANNELS: readonly ReplayChannel[] = ["pipe", "terminal"];

/** Subcommands without a writing mode. Anything else is never run. */
const READ_ONLY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "annotate",
  "blame",
  "cat-file",
  "check-attr",
  "check-ignore",
  "check-ref-format",
  "cherry",
  "count-objects",
  "describe",
  "diff",
  "diff-files",
  "diff-index",
  "diff-tree",
  "for-each-ref",
  "grep",
  "log",
  "ls-files",
  "ls-remote",
  "ls-tree",
  "merge-base",
  "name-rev",
  "range-diff",
  "rev-list",
  "rev-parse",
  "shortlog",
  "show",
  "show-branch",
  "show-ref",
  "status",
  "var",
  "whatchanged",
]);

/** Global options that only make a command more hermetic. */
const REPLAYED_GLOBAL_OPTIONS: ReadonlySet<string> = new Set([
  "--no-pager",
  "-P",
  "--no-optional-locks",
]);

/** Long options that run a program or write a file outside the fixture. */
const REFUSED_LONG_OPTIONS: readonly string[] = [
  "--exec",
  "--open-files-in-pager",
  "--output",
  "--receive-pack",
  "--upload-pack",
];

/** Short options with the same effect, per subcommand (`-u` is `--patch` for log). */
const REFUSED_SHORT_OPTIONS: Readonly<Record<string, string>> = {
  grep: "O",
  "ls-remote": "u",
};

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export interface CodeFragment {
  /** Line the fragment starts on, 1-based. */
  readonly line: number;
  readonly kind: "fence" | "span";
  readonly text: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_SPAN = /(`+)([\s\S]*?[^`])\1(?!`)/g;

/** Fenced blocks (one fragment per block) and inline code spans outside them. */
export function codeFragments(content: string): CodeFragment[] {
  const lines = content.split("\n");
  const fragments: CodeFragment[] = [];
  let fence: { marker: string; start: number; body: string[] } | null = null;
  lines.forEach((line, index) => {
    const opener = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence.marker;
      const closes =
        opener !== null &&
        opener[1]?.[0] === marker[0] &&
        (opener[1]?.length ?? 0) >= marker.length &&
        line.trim() === opener[1];
      if (closes) {
        fragments.push({ line: fence.start, kind: "fence", text: fence.body.join("\n") });
        fence = null;
      } else {
        fence.body.push(line);
      }
      return;
    }
    if (opener !== null && opener[1] !== undefined) {
      fence = { marker: opener[1], start: index + 1, body: [] };
      return;
    }
    for (const match of line.matchAll(INLINE_SPAN)) {
      const text = match[2]?.trim() ?? "";
      if (text.length > 0) fragments.push({ line: index + 1, kind: "span", text });
    }
  });
  // An unclosed fence runs to the end of the file, as CommonMark reads it.
  if (fence !== null) {
    const open: { start: number; body: string[] } = fence;
    fragments.push({ line: open.start, kind: "fence", text: open.body.join("\n") });
  }
  return fragments;
}

export interface Word {
  readonly text: string;
  /** Why the word cannot be taken literally; empty when it can. */
  readonly blockers: readonly string[];
}

export interface SimpleCommand {
  readonly words: readonly Word[];
  /** Offset of the first character of the command in the text it was read from. */
  readonly offset: number;
}

const OPERATORS = new Set([";", "&", "|", "(", ")", "\n"]);
const WHITESPACE = new Set([" ", "\t", "\r"]);

/**
 * The simple commands of a shell text, words unquoted as a POSIX shell would:
 * a subset that never expands anything. Whatever a shell would expand or
 * redirect is kept as written and marks its word with a blocker.
 */
export function simpleCommands(text: string): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  let words: Word[] = [];
  let current = "";
  let blockers: string[] = [];
  let inWord = false;
  let commandStart = -1;

  const endWord = (): void => {
    if (inWord) words.push({ text: current, blockers });
    current = "";
    blockers = [];
    inWord = false;
  };
  const endCommand = (): void => {
    endWord();
    if (words.length > 0) commands.push({ words, offset: commandStart });
    words = [];
    commandStart = -1;
  };
  const startWord = (index: number): void => {
    if (!inWord && commandStart === -1) commandStart = index;
    inWord = true;
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === "\\" && text[index + 1] === "\n") {
      index += 2; // line continuation
      continue;
    }
    if (OPERATORS.has(char)) {
      endCommand();
      index += 1;
      continue;
    }
    if (WHITESPACE.has(char)) {
      endWord();
      index += 1;
      continue;
    }
    if (char === "#" && !inWord) {
      // A comment runs to the end of the line.
      const lineEnd = text.indexOf("\n", index);
      index = lineEnd === -1 ? text.length : lineEnd;
      continue;
    }
    startWord(index);
    if (char === "'") {
      const close = text.indexOf("'", index + 1);
      if (close === -1) {
        blockers.push("unterminated quote");
        current += text.slice(index + 1);
        index = text.length;
      } else {
        current += text.slice(index + 1, close);
        index = close + 1;
      }
      continue;
    }
    if (char === '"') {
      let cursor = index + 1;
      let closed = false;
      while (cursor < text.length) {
        const inner = text[cursor] ?? "";
        if (inner === '"') {
          closed = true;
          break;
        }
        if (inner === "\\" && '$`"\\\n'.includes(text[cursor + 1] ?? "")) {
          current += text[cursor + 1];
          cursor += 2;
          continue;
        }
        if (inner === "$" || inner === "`") blockers.push("shell expansion");
        current += inner;
        cursor += 1;
      }
      if (!closed) blockers.push("unterminated quote");
      index = cursor + 1;
      continue;
    }
    if (char === "\\") {
      current += text[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (char === "<" || char === ">") blockers.push("redirection or placeholder");
    else if (char === "$" || char === "`") blockers.push("shell expansion");
    else if (char === "*" || char === "?" || char === "[") blockers.push("glob");
    else if (char === "…") blockers.push("placeholder");
    else if (char === "~" && current.length === 0) blockers.push("tilde expansion");
    current += char;
    index += 1;
  }
  endCommand();
  return commands;
}

export interface ClassifiedCommand {
  readonly kind: CommandClass;
  readonly reason: string;
  /** The argv to replay; null unless the command is replayed. */
  readonly argv: readonly string[] | null;
}

function refusedOption(subcommand: string, argument: string): boolean {
  if (
    REFUSED_LONG_OPTIONS.some((option) => argument === option || argument.startsWith(`${option}=`))
  ) {
    return true;
  }
  const short = REFUSED_SHORT_OPTIONS[subcommand];
  return (
    short !== undefined &&
    /^-[A-Za-z]+/.test(argument) &&
    !argument.startsWith("--") &&
    argument.slice(1).includes(short)
  );
}

/** Exactly one class per command whose first word is `git`. Pure. */
export function classifyGitCommand(command: SimpleCommand): ClassifiedCommand {
  const words = command.words;
  let index = 1;
  while (index < words.length && (words[index]?.text ?? "").startsWith("-")) {
    const option = words[index]?.text ?? "";
    if (!REPLAYED_GLOBAL_OPTIONS.has(option)) {
      return {
        kind: "not-executable",
        reason: `global option ${option} is not replayed: it can name a program or another repository`,
        argv: null,
      };
    }
    index += 1;
  }
  const subcommand = words[index];
  if (subcommand === undefined) {
    return { kind: "not-executable", reason: "no subcommand", argv: null };
  }
  if (subcommand.blockers.length > 0) {
    return {
      kind: "not-executable",
      reason: `subcommand is not literal (${subcommand.blockers[0]})`,
      argv: null,
    };
  }
  if (!READ_ONLY_SUBCOMMANDS.has(subcommand.text)) {
    return {
      kind: "write",
      reason: `${subcommand.text} is not a read-only subcommand: never replayed`,
      argv: null,
    };
  }
  const blocked = words.find((word) => word.blockers.length > 0);
  if (blocked !== undefined) {
    return {
      kind: "not-executable",
      reason: `${blocked.blockers[0]} in "${blocked.text}"`,
      argv: null,
    };
  }
  const refused = words.slice(index + 1).find((word) => refusedOption(subcommand.text, word.text));
  if (refused !== undefined) {
    return {
      kind: "not-executable",
      reason: `option ${refused.text} can run a program or write outside the fixture`,
      argv: null,
    };
  }
  return { kind: "replay", reason: "read-only, literal", argv: words.map((word) => word.text) };
}

export interface ExtractedCommand extends ClassifiedCommand {
  readonly path: string;
  readonly line: number;
  /** The command as read, words joined by a space. */
  readonly text: string;
}

/** Every git command of a Markdown file, classified. Pure. */
export function extractGitCommands(path: string, content: string): ExtractedCommand[] {
  const extracted: ExtractedCommand[] = [];
  for (const fragment of codeFragments(content)) {
    // In a fence, a prompt sign is not part of the command.
    const text =
      fragment.kind === "fence" ? fragment.text.replace(/^(\s*)\$ /gm, "$1") : fragment.text;
    for (const command of simpleCommands(text)) {
      if (command.words[0]?.text !== "git") continue;
      const before = text.slice(0, command.offset);
      const lineOffset = fragment.kind === "fence" ? before.split("\n").length : 0;
      extracted.push({
        path,
        line: fragment.line + lineOffset,
        text: command.words.map((word) => word.text).join(" "),
        ...classifyGitCommand(command),
      });
    }
  }
  return extracted;
}

// ---------------------------------------------------------------------------
// Trapped repository
// ---------------------------------------------------------------------------

/** Trap name → the witness file its program writes when git runs it. */
const TRAPS = {
  GIT_EXTERNAL_DIFF: "external-diff",
  GIT_PAGER: "git-pager",
  "core.pager": "core-pager",
  "diff.trap.textconv": "textconv",
  "filter.trap.clean": "filter-clean",
  "filter.trap.smudge": "filter-smudge",
} as const;

type TrapName = keyof typeof TRAPS;

export interface TrappedRepository {
  readonly root: string;
  readonly repository: string;
  readonly witnesses: string;
  /** The whole environment of every child: nothing of the parent but PATH. */
  readonly env: Readonly<Record<string, string>>;
}

/** Characters a path may hold here: git runs trap programs through a shell. */
const SHELL_SAFE_PATH = /^[A-Za-z0-9_./-]+$/;

function runGit(args: readonly string[], cwd: string, env: Record<string, string>): string {
  const run = Bun.spawnSync(["git", ...args], {
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (run.exitCode !== 0) {
    throw new Error(
      `fixture: git ${args.join(" ")} exited ${run.exitCode}: ${new TextDecoder().decode(run.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(run.stdout);
}

/** A date long before any index write, so no entry is racily clean. */
const PAST = new Date("2001-01-01T00:00:00Z");

function writePast(path: string, content: string): void {
  writeFileSync(path, content);
  utimesSync(path, PAST, PAST);
}

/**
 * A repository built under `root` (an empty directory the caller owns), with
 * two commits, a served branch pushed to a local `origin`, one tracked file
 * changed in the working tree, and every trap armed after the history is
 * written. Every file is dated in the past so `git status` never re-reads a
 * file through the clean filter on its own.
 */
export function buildTrappedRepository(root: string): TrappedRepository {
  if (!SHELL_SAFE_PATH.test(root)) {
    throw new Error(`fixture: ${root} holds a character a shell would read`);
  }
  const repository = join(root, "repository");
  const origin = join(root, "origin.git");
  const witnesses = join(root, "witnesses");
  const bin = join(root, "bin");
  const home = join(root, "home");
  // git writes the blobs it hands to an external diff or a textconv driver in
  // TMPDIR: a directory of the fixture, never the machine's.
  const temporary = join(root, "tmp");
  for (const directory of [repository, witnesses, bin, home, temporary]) mkdirSync(directory);
  writeFileSync(join(home, ".gitconfig"), "");

  const programs = {} as Record<TrapName, string>;
  for (const [trap, witness] of Object.entries(TRAPS) as [TrapName, string][]) {
    const program = join(bin, witness);
    writeFileSync(program, `#!/bin/sh\n: > '${join(witnesses, witness)}'\nexit 0\n`, {
      mode: 0o755,
    });
    programs[trap] = program;
  }

  const base: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
    TERM: "xterm-256color",
    TMPDIR: temporary,
  };

  runGit(["init", "--quiet", "--bare", "--initial-branch=served", origin], root, base);
  runGit(["init", "--quiet", "--initial-branch=served", repository], root, base);
  const git = (...args: string[]): string => runGit(args, repository, base);
  git("config", "user.name", "t");
  git("config", "user.email", "t@t");
  writePast(join(repository, "a.txt"), "one\n");
  writePast(join(repository, "b.dat"), "data\n");
  git("add", "a.txt", "b.dat");
  git("commit", "--quiet", "-m", "first");
  git("remote", "add", "origin", origin);
  git("push", "--quiet", "origin", "served");
  writePast(join(repository, "a.txt"), "one\ntwo\n");
  git("add", "a.txt");
  git("commit", "--quiet", "-m", "second");
  git("fetch", "--quiet", "origin");
  // A tracked file changed in the working tree: `git diff` has a patch to show.
  writePast(join(repository, "a.txt"), "one\ntwo\nthree\n");

  // Traps armed after the history is written, so building it fires none.
  writeFileSync(
    join(repository, ".git", "info", "attributes"),
    "*.txt diff=trap\n*.dat filter=trap\n",
  );
  git("config", "core.pager", programs["core.pager"]);
  git("config", "diff.trap.textconv", programs["diff.trap.textconv"]);
  git("config", "filter.trap.clean", programs["filter.trap.clean"]);
  git("config", "filter.trap.smudge", programs["filter.trap.smudge"]);
  git("config", "color.ui", "always");

  return {
    root,
    repository,
    witnesses,
    env: {
      ...base,
      GIT_EXTERNAL_DIFF: programs.GIT_EXTERNAL_DIFF,
      GIT_PAGER: programs.GIT_PAGER,
    },
  };
}

/** The parts of the repository a read-only command must leave as they were. */
function snapshot(repository: TrappedRepository): Record<string, string> {
  const git = (...args: string[]): string =>
    runGit(["--no-pager", "--no-optional-locks", ...args], repository.repository, {
      ...repository.env,
    });
  return {
    status: git(
      "status",
      "--porcelain=v2",
      "--branch",
      "--untracked-files=all",
      "--ignored=matching",
      "-z",
    ),
    refs: git("for-each-ref", "--format=%(refname) %(objectname)") + git("rev-parse", "HEAD"),
    head: git("symbolic-ref", "HEAD"),
    config: git("config", "--local", "--list", "-z"),
    worktrees: git("worktree", "list", "--porcelain"),
  };
}

function firedTraps(repository: TrappedRepository): string[] {
  const fired = new Set(readdirSync(repository.witnesses));
  return (Object.entries(TRAPS) as [TrapName, string][])
    .filter(([, witness]) => fired.has(witness))
    .map(([trap]) => trap);
}

export interface TerminalProbe {
  readonly available: boolean;
  readonly reason: string;
}

let terminalProbe: TerminalProbe | null = null;

/** Whether a pseudo-terminal can be opened here; asked once per process. */
export function probeTerminal(): TerminalProbe {
  if (terminalProbe !== null) return terminalProbe;
  try {
    const probe = Bun.spawn(["true"], { terminal: { cols: 80, rows: 24 } });
    probe.terminal?.close();
    terminalProbe = { available: true, reason: "" };
  } catch (error) {
    terminalProbe = {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return terminalProbe;
}

export interface ReplayOutcome {
  readonly exitCode: number | null;
  /** Every reason the replay fails the gate; empty when it passes. */
  readonly problems: readonly string[];
}

const REPLAY_TIMEOUT_MS = 10_000;
const TERMINAL_DRAIN_MS = 2_000;
const ESCAPE = "\u001b[";

/**
 * Run one argv in the trapped repository through one channel and report
 * every trap it fired and every part of the state it changed.
 */
export async function replayInTrappedRepository(
  repository: TrappedRepository,
  argv: readonly string[],
  channel: ReplayChannel,
): Promise<ReplayOutcome> {
  if (channel === "terminal") {
    const terminal = probeTerminal();
    if (!terminal.available) {
      return { exitCode: null, problems: [`terminal unavailable: ${terminal.reason}`] };
    }
  }
  const before = snapshot(repository);
  const armed = firedTraps(repository);
  if (armed.length > 0) {
    throw new Error(`fixture: traps fired before the replay: ${armed.join(", ")}`);
  }

  let output = "";
  const decoder = new TextDecoder();
  // The terminal may still hold output when the process exits: its end of
  // stream, not the exit, says that everything was read.
  let endOfTerminal: () => void = () => {};
  const terminalDrained = new Promise<void>((resolve) => {
    endOfTerminal = resolve;
  });
  const child =
    channel === "terminal"
      ? Bun.spawn([...argv], {
          cwd: repository.repository,
          env: { ...repository.env },
          terminal: {
            cols: 200,
            rows: 50,
            data(_terminal, data) {
              output += decoder.decode(data, { stream: true });
            },
            exit() {
              endOfTerminal();
            },
          },
        })
      : Bun.spawn([...argv], {
          cwd: repository.repository,
          env: { ...repository.env },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, REPLAY_TIMEOUT_MS);
  if (channel === "pipe") {
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout as ReadableStream).text(),
      new Response(child.stderr as ReadableStream).text(),
    ]);
    output = stdout + stderr;
  }
  const exitCode = await child.exited;
  if (channel === "terminal") {
    await Promise.race([terminalDrained, Bun.sleep(TERMINAL_DRAIN_MS)]);
  }
  clearTimeout(timer);
  child.terminal?.close();

  const problems: string[] = [];
  if (timedOut) problems.push(`did not finish within ${REPLAY_TIMEOUT_MS / 1000} s`);
  for (const trap of firedTraps(repository)) problems.push(`trap fired: ${trap}`);
  if (output.includes(ESCAPE)) problems.push("trap fired: color.ui=always coloured the output");
  const after = snapshot(repository);
  for (const part of Object.keys(before)) {
    if (before[part] !== after[part]) problems.push(`changed the repository state (${part})`);
  }
  if (problems.length === 0 && (exitCode === 128 || exitCode === 129)) {
    problems.push(`git refused it on the fixture (exit ${exitCode}): the replay proved nothing`);
  }
  return { exitCode, problems };
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/** The skill a path belongs to: its first directory under the root. */
function skillOf(root: string, path: string): string {
  const [first, ...rest] = relative(root, path).split(sep);
  return rest.length === 0 ? "(root)" : (first ?? "(root)");
}

export interface SkillCounts {
  extracted: number;
  replay: number;
  write: number;
  "not-executable": number;
}

export function formatSkillCounts(skill: string, counts: SkillCounts): string {
  return (
    `${skill}: ${counts.extracted} = ${counts.replay} replayed + ${counts.write} write + ` +
    `${counts["not-executable"]} not-executable`
  );
}

async function main(): Promise<void> {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { concludeGate, GateReport } = await import("../quality/gate-report");
  const gate = "Skills commands (T5)";
  const root = process.argv[2] ?? "skills";
  const report = new GateReport();

  const read = loadSkillTree(root);
  const markdown = read.scanned.filter((file) => file.path.endsWith(".md"));
  for (const path of read.undecodable) {
    report.check(path, false, "not valid UTF-8 text: its commands cannot be read");
  }
  for (const path of read.symlinks) {
    report.check(path, false, "symbolic link, not followed: its commands are not part of the tree");
  }
  for (const { path, reason } of read.unreadable) report.check(path, false, reason);

  const commands = markdown.flatMap((file) => extractGitCommands(file.path, file.content));
  const perSkill = new Map<string, SkillCounts>();
  for (const command of commands) {
    const skill = skillOf(root, command.path);
    const counts = perSkill.get(skill) ?? {
      extracted: 0,
      replay: 0,
      write: 0,
      "not-executable": 0,
    };
    counts.extracted += 1;
    counts[command.kind] += 1;
    perSkill.set(skill, counts);
  }

  const terminal = probeTerminal();
  const replayable = commands.filter((command) => command.argv !== null).length;
  if (!terminal.available && replayable > 0) {
    report.check(
      "terminal channel",
      false,
      `no pseudo-terminal (${terminal.reason}): git starts no pager without one, so the pager traps cannot fire`,
    );
  }

  const scratch = mkdtempSync(join(tmpdir(), "skills-commands-"));
  try {
    let fixtures = 0;
    for (const command of commands) {
      const where = `${relative(root, command.path)}:${command.line} \`${command.text}\``;
      if (command.argv === null) {
        report.check(where, true, `${command.kind}: ${command.reason}`);
        continue;
      }
      for (const channel of REPLAY_CHANNELS) {
        if (channel === "terminal" && !terminal.available) continue;
        fixtures += 1;
        const fixtureRoot = join(scratch, String(fixtures));
        mkdirSync(fixtureRoot);
        const outcome = await replayInTrappedRepository(
          buildTrappedRepository(fixtureRoot),
          command.argv,
          channel,
        );
        report.check(
          `${where} (${channel})`,
          outcome.problems.length === 0,
          outcome.problems.length === 0
            ? `no trap fired, state unchanged, exit ${outcome.exitCode}`
            : outcome.problems.join("; "),
        );
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const files =
    read.scanned.length + read.undecodable.length + read.symlinks.length + read.unreadable.length;
  const breakdown = [...perSkill.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([skill, counts]) => formatSkillCounts(skill, counts));
  const total = commands.length;
  const volume =
    `entries=${files} (markdown=${markdown.length}), commands=${total} ` +
    `(replayed ${replayable} × ${terminal.available ? 2 : 1} channel(s), traps=${Object.keys(TRAPS).length + 1})`;
  // Printed on failure too: a failing run says what it examined, per skill.
  console.log(`${gate} examined: ${volume}`);
  for (const line of breakdown) console.log(`  ${line}`);
  report.volume(volume);
  if (total === 0 && report.asserted === 0) {
    report.allowEmpty(`no git command in the Markdown files of ${root}/`);
  }
  concludeGate(gate, report);
}

if (import.meta.main) await main();
