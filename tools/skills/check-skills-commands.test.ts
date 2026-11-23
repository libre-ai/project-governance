import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTrappedRepository,
  type CommandClass,
  classifyGitCommand,
  codeFragments,
  extractGitCommands,
  probeTerminal,
  type ReplayChannel,
  replayInTrappedRepository,
  simpleCommands,
} from "./check-skills-commands";

const GATE: string = join(import.meta.dir, "check-skills-commands.ts");

const scratch: string = mkdtempSync(join(tmpdir(), "skills-commands-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let fixtureCount = 0;
function freshRoot(): string {
  fixtureCount += 1;
  const root = join(scratch, `fixture-${fixtureCount}`);
  mkdirSync(root);
  return root;
}

/** The class of the first git command of a text, with the reason it carries. */
function classOf(text: string): { kind: CommandClass; reason: string } {
  const [command] = simpleCommands(text).filter((candidate) => candidate.words[0]?.text === "git");
  if (command === undefined) throw new Error(`no git command in ${text}`);
  const classified = classifyGitCommand(command);
  return { kind: classified.kind, reason: classified.reason };
}

describe("code fragments", () => {
  test("inline spans outside fences, and every line of a fence, with their line numbers", () => {
    const content = [
      "Run `git status --porcelain` first.", // 1
      "", // 2
      "```sh", // 3
      "git log --oneline", // 4
      "git diff \\", // 5
      "  --stat", // 6
      "```", // 7
      "Then ``git show HEAD`` again.", // 8
    ].join("\n");
    const fragments = codeFragments(content);
    expect(fragments.map((fragment) => [fragment.line, fragment.kind])).toEqual([
      [1, "span"],
      [3, "fence"],
      [8, "span"],
    ]);
    const commands = extractGitCommands("x/SKILL.md", content);
    expect(commands.map((command) => [command.line, command.text])).toEqual([
      [1, "git status --porcelain"],
      [4, "git log --oneline"],
      [5, "git diff --stat"],
      [8, "git show HEAD"],
    ]);
  });

  test("a span inside a fence is not read twice, and a tilde fence counts", () => {
    const content = ["~~~", "echo `git status`", "~~~"].join("\n");
    expect(codeFragments(content).map((fragment) => fragment.kind)).toEqual(["fence"]);
  });

  test("an unclosed fence runs to the end of the file", () => {
    const content = ["```", "git status"].join("\n");
    expect(extractGitCommands("x/SKILL.md", content).map((command) => command.text)).toEqual([
      "git status",
    ]);
  });
});

describe("simple commands", () => {
  test("split on unquoted operators, never inside quotes", () => {
    const commands = simpleCommands(
      `git check-ignore -q .env || { echo ".env n'est pas ignoré par git : arrêt" >&2; exit 1; }`,
    );
    expect(commands[0]?.words.map((word) => word.text)).toEqual([
      "git",
      "check-ignore",
      "-q",
      ".env",
    ]);
    expect(commands.filter((command) => command.words[0]?.text === "git")).toHaveLength(1);
  });

  test("quotes and backslashes are undone as a shell would", () => {
    const [single] = simpleCommands("git log --format='%h %an %cn %s' HEAD");
    expect(single?.words.map((word) => word.text)).toEqual([
      "git",
      "log",
      "--format=%h %an %cn %s",
      "HEAD",
    ]);
    const [escaped] = simpleCommands("git log -1 --format=%an\\ %ae");
    expect(escaped?.words.map((word) => word.text)).toEqual([
      "git",
      "log",
      "-1",
      "--format=%an %ae",
    ]);
  });

  test("a git command after an operator is found", () => {
    const commands = simpleCommands("cd repo && git status; git log | head");
    expect(commands.map((command) => command.words[0]?.text)).toEqual(["cd", "git", "git", "head"]);
  });

  test("a comment ends the text", () => {
    expect(simpleCommands("git status # then git log")).toHaveLength(1);
  });
});

describe("classification", () => {
  const cases: ReadonlyArray<readonly [string, CommandClass]> = [
    ["git status --porcelain", "replay"],
    ["git log -1 --format=%an\\ %ae", "replay"],
    ["git ls-remote --symref origin HEAD", "replay"],
    ["git --no-pager log -p", "replay"],
    ["git add", "write"],
    ["git commit -s -F message.txt", "write"],
    ["git branch --list", "write"],
    ["git merge --signoff origin/<servie>", "write"],
    ["git diff --name-only origin/<servie>...HEAD", "not-executable"],
    ["git show origin/<servie>:docs/adr/x.md", "not-executable"],
    ['git log "$range"', "not-executable"],
    ["git log $(git rev-parse HEAD)", "not-executable"],
    ["git diff -- *.ts", "not-executable"],
    ["git diff > out.patch", "not-executable"],
    ["git log …", "not-executable"],
    ["git -c core.pager=cat log", "not-executable"],
    ["git -C elsewhere status", "not-executable"],
    ["git diff --output=/tmp/x", "not-executable"],
    ["git ls-remote --upload-pack=evil origin", "not-executable"],
    ["git ls-remote -u evil origin", "not-executable"],
    ["git grep -O less needle", "not-executable"],
    ["git grep -nO needle", "not-executable"],
    ["git", "not-executable"],
    ["git <sous-commande>", "not-executable"],
    ["git status 'unterminated", "not-executable"],
  ];
  for (const [text, expected] of cases) {
    test(`${text} → ${expected}`, () => {
      expect(classOf(text).kind).toBe(expected);
    });
  }

  test("an unknown subcommand is never replayed", () => {
    expect(classOf("git frobnicate --all")).toEqual({
      kind: "write",
      reason: "frobnicate is not a read-only subcommand: never replayed",
    });
  });
});

describe("trapped replay", () => {
  // The traps fire through the pipe channel on every machine; the terminal
  // channel needs a pseudo-terminal, which a sandbox may refuse.
  const channel: ReplayChannel = "pipe";

  test("a hermetic read leaves the traps and the state untouched", async () => {
    const repository = buildTrappedRepository(freshRoot());
    const outcome = await replayInTrappedRepository(
      repository,
      ["git", "status", "--porcelain"],
      channel,
    );
    expect(outcome.problems).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });

  test("git diff without --no-ext-diff runs GIT_EXTERNAL_DIFF", async () => {
    const repository = buildTrappedRepository(freshRoot());
    const outcome = await replayInTrappedRepository(repository, ["git", "diff"], channel);
    expect(outcome.problems).toContain("trap fired: GIT_EXTERNAL_DIFF");
  });

  test("git diff --no-ext-diff still runs textconv", async () => {
    const repository = buildTrappedRepository(freshRoot());
    const outcome = await replayInTrappedRepository(
      repository,
      ["git", "diff", "--no-ext-diff"],
      channel,
    );
    expect(outcome.problems).toEqual(["trap fired: diff.trap.textconv"]);
  });

  test("an output coloured by color.ui=always is a trap", async () => {
    const repository = buildTrappedRepository(freshRoot());
    const outcome = await replayInTrappedRepository(
      repository,
      ["git", "log", "--oneline"],
      channel,
    );
    expect(outcome.problems).toEqual(["trap fired: color.ui=always coloured the output"]);
  });

  test("git log -p runs textconv", async () => {
    const repository = buildTrappedRepository(freshRoot());
    const outcome = await replayInTrappedRepository(repository, ["git", "log", "-p"], channel);
    expect(outcome.problems).toContain("trap fired: diff.trap.textconv");
  });

  test("the hermetic form of the same diff passes", async () => {
    const repository = buildTrappedRepository(freshRoot());
    const outcome = await replayInTrappedRepository(
      repository,
      ["git", "--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--no-color"],
      channel,
    );
    expect(outcome.problems).toEqual([]);
  });

  test("a filter driver is a trap", async () => {
    const repository = buildTrappedRepository(freshRoot());
    const outcome = await replayInTrappedRepository(
      repository,
      ["git", "cat-file", "--filters", "HEAD:b.dat"],
      channel,
    );
    expect(outcome.problems).toContain("trap fired: filter.trap.smudge");
  });

  test("a command that moves a ref is caught by the state comparison", async () => {
    const repository = buildTrappedRepository(freshRoot());
    const outcome = await replayInTrappedRepository(
      repository,
      ["git", "update-ref", "refs/heads/moved", "HEAD"],
      channel,
    );
    expect(outcome.problems).toContain("changed the repository state (refs)");
  });

  test("a command that writes a file is caught by the state comparison", async () => {
    const repository = buildTrappedRepository(freshRoot());
    const outcome = await replayInTrappedRepository(
      repository,
      ["git", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--output=written.patch"],
      channel,
    );
    expect(outcome.problems).toContain("changed the repository state (status)");
  });

  test("a command git refuses proves nothing, and says so", async () => {
    const repository = buildTrappedRepository(freshRoot());
    const outcome = await replayInTrappedRepository(repository, ["git", "check-ignore"], channel);
    expect(outcome.problems).toEqual([
      "git refused it on the fixture (exit 128): the replay proved nothing",
    ]);
  });

  test("the child sees no variable of the parent", async () => {
    const repository = buildTrappedRepository(freshRoot());
    expect(Object.keys(repository.env).sort()).toEqual(
      [
        "GIT_CONFIG_NOSYSTEM",
        "GIT_EXTERNAL_DIFF",
        "GIT_PAGER",
        "GIT_TERMINAL_PROMPT",
        "HOME",
        "LC_ALL",
        "PATH",
        "TERM",
        "TMPDIR",
      ].sort(),
    );
    expect(repository.env.HOME?.startsWith(repository.root)).toBe(true);
    expect(repository.env.TMPDIR?.startsWith(repository.root)).toBe(true);
  });

  // The pager only runs when git writes to a terminal: without one, the trap
  // is inert, and the gate refuses to call that a pass.
  const terminal = probeTerminal();
  test(`terminal channel: ${terminal.available ? "git log pages" : "unavailable here, named"}`, async () => {
    const repository = buildTrappedRepository(freshRoot());
    const outcome = await replayInTrappedRepository(
      repository,
      ["git", "log", "--format=%h %s"],
      "terminal",
    );
    if (terminal.available) {
      expect(outcome.problems).toContain("trap fired: GIT_PAGER");
    } else {
      expect(outcome.problems).toEqual([`terminal unavailable: ${terminal.reason}`]);
    }
  });
});

describe("gate process", () => {
  function runGate(root: string): { exitCode: number | null; output: string } {
    const run = Bun.spawnSync(["bun", GATE, root], {
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      // TMPDIR alone is passed on: the gate builds its fixtures under it, and
      // a sandbox may refuse the system default.
      env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
    });
    return {
      exitCode: run.exitCode,
      output: `${new TextDecoder().decode(run.stdout)}${new TextDecoder().decode(run.stderr)}`,
    };
  }

  function skillTree(files: Readonly<Record<string, string>>): string {
    const root = freshRoot();
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  }

  test("a skill prescribing a trappable command fails, naming the skill and the trap", () => {
    const root = skillTree({ "alpha/SKILL.md": "Inspect with `git log -p`.\n" });
    const { exitCode, output } = runGate(root);
    expect(exitCode).toBe(1);
    expect(output).toContain("alpha/SKILL.md:1 `git log -p` (pipe)");
    expect(output).toContain("trap fired: diff.trap.textconv");
  });

  test("the volume sums per skill: extracted = replayed + write + not-executable", () => {
    const root = skillTree({
      "alpha/SKILL.md": [
        "1. `git status --porcelain`",
        "2. `git add`",
        "3. `git diff origin/<servie>...HEAD`",
      ].join("\n"),
    });
    const { output } = runGate(root);
    expect(output).toContain("alpha: 3 = 1 replayed + 1 write + 1 not-executable");
  });

  test("a tree with no git command is declared, not passed silently", () => {
    const root = skillTree({ "alpha/SKILL.md": "No command here.\n" });
    const { exitCode, output } = runGate(root);
    expect(exitCode).toBe(0);
    expect(output).toContain("no git command");
  });

  test("an undecodable file is a named failure", () => {
    const root = skillTree({ "alpha/SKILL.md": "`git status`\n" });
    writeFileSync(join(root, "alpha", "notes.md"), new Uint8Array([0xff, 0xfe, 0x00]));
    const { exitCode, output } = runGate(root);
    expect(exitCode).toBe(1);
    expect(output).toContain("alpha/notes.md");
  });
});
