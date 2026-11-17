import { afterAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { discoverDetectors } from "../../../ecosystem/fleet-gates";
import { localFleetReader, runState } from "../../../ecosystem/fleet-state";
import {
  cover,
  DECISION_COLUMNS,
  EXIT,
  isolatedArgv,
  MANIFEST_COLUMNS,
  numstatTotals,
  parseDecisions,
  parseFinding,
  predictLines,
  replayCommand,
  residueProblem,
  runKit,
} from "./kit";

/**
 * Remediation kit (lot L069, idea h-plugins-cycle-14). The expected values
 * come from the idea: codes 0 kit written, 1 proof, 2 usage, 3 stale input or
 * detector in error, 4 inconsistent decisions; a complete kit of 3 findings
 * and 3 modifications; a patch changing 2 lines for 3 findings prints
 * « attendu 3 / 3 »; a residue of the same count on other paths fails; a
 * detector exiting 2 on the patched copy is never green. Each bench is a real
 * measure: a git worktree, a registered detector and `fleet-state.ts state`.
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const TICKET = "bad";
const LABEL = "l1";
const REPOSITORY = "o/alpha";
const GIT_DIRECTORY = dirname(Bun.which("git") ?? "/usr/bin/git");

/** Environment of every git call of the bench: no user or system configuration. */
function purged(home: string): Record<string, string> {
  return {
    PATH: `${GIT_DIRECTORY}:/usr/bin:/bin`,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

function git(home: string, cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: purged(home),
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.toString();
}

const GREP_BAD = "git grep -n BAD || test $? -eq 1";

const CONF = "a: BAD\nb: ok\nc: BAD\nd: BAD\n";

interface BenchOptions {
  readonly files?: Readonly<Record<string, string>>;
  readonly detector?: string;
  readonly scope?: "repo" | "parc";
}

interface Bench {
  readonly root: string;
  readonly home: string;
  readonly repo: string;
  readonly work: string;
  readonly kits: string;
  readonly servedBranch: string;
  readonly ghLog: string;
  readonly env: Record<string, string>;
  readonly decisions: (rows: readonly (readonly string[])[]) => void;
  readonly companions: (rows: readonly (readonly string[])[]) => void;
  readonly run: (argv?: readonly string[]) => ReturnType<typeof runKit>;
}

async function bench(options: BenchOptions = {}): Promise<Bench> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kit-bench-")));
  roots.push(root);
  const home = join(root, "home");
  mkdirSync(home);

  const repo = join(root, "worktrees", "o", "alpha");
  mkdirSync(repo, { recursive: true });
  git(home, repo, "init", "-q");
  git(home, repo, "config", "user.name", "t");
  git(home, repo, "config", "user.email", "t@t");
  git(home, repo, "config", "commit.gpgsign", "false");
  for (const [path, content] of Object.entries(options.files ?? { "conf.yml": CONF })) {
    writeFileSync(join(repo, path), content);
  }
  git(home, repo, "add", "--all");
  git(home, repo, "commit", "-q", "-m", "init");

  // A served branch named in the test, never a usual default name.
  const servedBranch = `trunk-${Math.random().toString(36).slice(2, 8)}`;
  mkdirSync(join(root, "snapshot", "o"), { recursive: true });
  writeFileSync(
    join(root, "snapshot", "o", "alpha.json"),
    JSON.stringify({ default_branch: servedBranch }),
  );

  const detectors = join(root, "detectors");
  mkdirSync(detectors);
  writeFileSync(
    join(detectors, "bad.sh"),
    `#!/bin/sh\n# identifiant: ${TICKET}\n# titre: BAD lines\n# fragilite: f\n# cible: 0\n# portee: ${options.scope ?? "repo"}\n${options.detector ?? GREP_BAD}\n`,
  );
  chmodSync(join(detectors, "bad.sh"), 0o755);
  const registry = join(root, "registry.yaml");
  writeFileSync(
    registry,
    `version: 1\ndetecteurs:\n  - identifiant: ${TICKET}\n    fichier: bad.sh\n`,
  );
  const inventory = join(root, "inventory.yaml");
  writeFileSync(
    inventory,
    "schema_version: libre-ai.repositories.v2\nupdated_on: 2026-11-17\nrepositories:\n  - repository: o/alpha\n    role: satellite\n    layer: product\n    visibility: public\n    lifecycle: active\n",
  );

  const states = join(root, "states");
  const measured = await runState(
    [
      "--detectors",
      detectors,
      "--registry",
      registry,
      "--worktrees",
      join(root, "worktrees"),
      "--snapshot",
      join(root, "snapshot"),
      "--out",
      states,
      "--label",
      LABEL,
      "--inventory",
      inventory,
    ],
    {
      discover: discoverDetectors,
      reader: (sources) =>
        localFleetReader({
          ...sources,
          environment: { PATH: purged(home).PATH, HOME: home },
        }),
      now: () => new Date("2026-11-17T10:00:00.000Z"),
      defaultInventory: inventory,
    },
  );
  if (measured.code !== 0) throw new Error(`state: ${measured.stderr.join("; ")}`);

  const work = join(root, "work");
  mkdirSync(join(work, TICKET), { recursive: true });
  const fakeBin = join(root, "fake-bin");
  mkdirSync(fakeBin);
  const ghLog = join(root, "gh.log");
  writeFileSync(join(fakeBin, "gh"), `#!/bin/sh\necho "gh $*" >> ${ghLog}\n`);
  chmodSync(join(fakeBin, "gh"), 0o755);
  const env = {
    ...purged(home),
    PATH: `${fakeBin}:${purged(home).PATH}`,
    REMEDIATION_WORK_DIR: work,
    FLEET_STATES_DIR: states,
    FLEET_WORKTREES_DIR: join(root, "worktrees"),
    FLEET_SNAPSHOT_DIR: join(root, "snapshot"),
    FLEET_DETECTORS_DIR: detectors,
    FLEET_GATES_REGISTRY: registry,
  };
  const table = (file: string) => (rows: readonly (readonly string[])[]) =>
    writeFileSync(
      join(work, TICKET, file),
      `${[DECISION_COLUMNS.join("\t"), ...rows.map((row) => row.join("\t"))].join("\n")}\n`,
    );
  return {
    root,
    home,
    repo,
    work,
    kits: join(work, "kits"),
    servedBranch,
    ghLog,
    env,
    decisions: table("decisions.tsv"),
    companions: table("companions.tsv"),
    run: (argv = [TICKET, LABEL]) => runKit(argv, { environment: env }),
  };
}

const fix = (line: string, action = "replace", argument = "BAD=>GOOD"): string[] => [
  REPOSITORY,
  "conf.yml",
  line,
  action,
  argument,
  "the reason",
];

describe("a complete kit", () => {
  test("3 findings, 3 modifications: exit 0, one manifest line, counters, no forge write, worktree untouched", async () => {
    const b = await bench();
    b.decisions([fix("*")]);
    const head = git(b.home, b.repo, "rev-parse", "HEAD").trim();
    const refsBefore = git(b.home, b.repo, "for-each-ref");
    const worktreesBefore = git(b.home, b.repo, "worktree", "list", "--porcelain");

    const outcome = await b.run();
    expect(outcome.stderr).toEqual([]);
    expect(outcome.code).toBe(EXIT.ok);
    expect(outcome.stdout.at(-1)).toContain(
      "repositories=1 findings=3 edited=3 kept=0 manual=0 added=3 removed=3 forge-writes=0",
    );

    const manifest = readFileSync(join(b.kits, TICKET, "manifest.tsv"), "utf8").split("\n");
    expect(manifest[0]).toBe(MANIFEST_COLUMNS.join("\t"));
    expect(manifest[1]?.split("\t")).toEqual([
      TICKET,
      REPOSITORY,
      b.servedBranch,
      head,
      "o/alpha.patch",
      "3",
      "3",
      "0",
      replayCommand(REPOSITORY, true),
      "edits=3 companions=0",
    ]);
    expect(manifest.length).toBe(3);

    // No forge write: the fake gh first on PATH was never called.
    expect(existsSync(b.ghLog)).toBe(false);
    // The measured worktree is only read.
    expect(git(b.home, b.repo, "status", "--porcelain", "--untracked-files=all")).toBe("");
    expect(git(b.home, b.repo, "rev-parse", "HEAD").trim()).toBe(head);
    expect(git(b.home, b.repo, "for-each-ref")).toBe(refsBefore);
    expect(git(b.home, b.repo, "worktree", "list", "--porcelain")).toBe(worktreesBefore);
    // The patch written applies on the measured sha.
    git(b.home, b.repo, "apply", "--check", join(b.kits, TICKET, "o", "alpha.patch"));
  });

  test("a kit is never replaced: a second run exits 2", async () => {
    const b = await bench();
    b.decisions([fix("*")]);
    expect((await b.run()).code).toBe(EXIT.ok);
    const again = await b.run();
    expect(again.code).toBe(EXIT.usage);
    expect(again.stderr[0]).toContain("already exists");
  });

  test("several findings on one line are one modification", async () => {
    const b = await bench({
      files: { "conf.yml": "a: BAD BAD\n" },
      detector: "git grep -n -o BAD || test $? -eq 1",
    });
    b.decisions([fix("1", "replace", "BAD BAD=>GOOD")]);
    const outcome = await b.run();
    expect(outcome.stderr).toEqual([]);
    expect(outcome.code).toBe(EXIT.ok);
    expect(outcome.stdout.at(-1)).toContain(
      "findings=2 edited=2 kept=0 manual=0 added=1 removed=1",
    );
  });

  test("a manual patch is proven like the others", async () => {
    const b = await bench();
    b.decisions([fix("*", "manual", "")]);
    mkdirSync(join(b.work, TICKET, "manual", "o"), { recursive: true });
    writeFileSync(
      join(b.work, TICKET, "manual", "o", "alpha.patch"),
      "diff --git a/conf.yml b/conf.yml\n--- a/conf.yml\n+++ b/conf.yml\n@@ -1,4 +1,4 @@\n-a: BAD\n+a: GOOD\n b: ok\n-c: BAD\n-d: BAD\n+c: GOOD\n+d: GOOD\n",
    );
    const outcome = await b.run();
    expect(outcome.stderr).toEqual([]);
    expect(outcome.code).toBe(EXIT.ok);
    expect(outcome.stdout.at(-1)).toContain(
      "findings=3 edited=0 kept=0 manual=3 added=3 removed=3",
    );
  });

  test("no repository in écart: exit 0, nothing written", async () => {
    const b = await bench({ files: { "conf.yml": "b: ok\n" } });
    const outcome = await b.run();
    expect(outcome.code).toBe(EXIT.ok);
    expect(outcome.stdout).toContain(
      `kit ${TICKET} ${LABEL}: no repository in écart, nothing written`,
    );
    expect(existsSync(b.kits)).toBe(false);
  });
});

describe("decisions inconsistent: code 4, nothing written", () => {
  const refused = async (rows: readonly (readonly string[])[], expected: string) => {
    const b = await bench();
    b.decisions(rows);
    const outcome = await b.run();
    expect(outcome.code).toBe(EXIT.decisions);
    expect(outcome.stderr.join("\n")).toContain(expected);
    expect(existsSync(b.kits)).toBe(false);
  };

  test("a finding covered by no decision is named", () =>
    refused([fix("1"), fix("3")], "finding not covered: o/alpha conf.yml:4:d: BAD"));

  test("a finding covered twice", () => refused([fix("1"), fix("1"), fix("*")], "covered twice"));

  test("an unknown action", () => refused([fix("*", "fix-it")], "unknown action « fix-it »"));

  test("a dead decision", () =>
    refused([fix("*"), fix("2")], "dead decision: o/alpha conf.yml:2 replace"));

  test("manual mixed with another action", () =>
    refused([fix("1", "manual", ""), fix("*")], "« manual » mixed"));

  test("every finding kept", () => refused([fix("*", "keep", "")], "every finding is kept"));

  test("an empty reason", () =>
    refused([[REPOSITORY, "conf.yml", "*", "replace", "BAD=>GOOD", " "]], "the reason is empty"));

  test("an edit the line editor refuses", () =>
    refused([fix("*", "replace", "ABSENT=>GOOD")], "the line editor refuses"));
});

describe("proof failed: code 1, nothing written", () => {
  test("a patch changing 2 lines for 3 findings prints « attendu 3 / 3 »", async () => {
    const b = await bench();
    b.decisions([fix("1"), fix("3"), fix("4", "replace", "BAD=>BAD")]);
    const outcome = await b.run();
    expect(outcome.code).toBe(EXIT.proof);
    expect(outcome.stderr.join("\n")).toContain("attendu 3 / 3, patch 2 / 2");
    expect(existsSync(b.kits)).toBe(false);
  });

  test("a detector still finding after the patch", async () => {
    const b = await bench();
    b.decisions([fix("*", "mark", "reviewed")]);
    const outcome = await b.run();
    expect(outcome.code).toBe(EXIT.proof);
    expect(outcome.stderr.join("\n")).toContain("the detector returns 3 finding(s)");
    expect(existsSync(b.kits)).toBe(false);
  });

  const IGNORING =
    'for f in $(git ls-files); do grep -q IGNORE-FILE "$f" || grep -n BAD "$f" | sed "s|^|$f:|"; done';
  const KEEP_FILES = {
    "conf.yml": "a: BAD\nb: ok\n",
    "other.yml": "x: BAD\nz: ok\n",
    "third.yml": "y: ok\n",
  };

  test("kept findings: the residue is exactly them, exit 0", async () => {
    const b = await bench({ files: KEEP_FILES, detector: IGNORING });
    b.decisions([fix("1"), [REPOSITORY, "other.yml", "1", "keep", "", "kept on purpose"]]);
    const outcome = await b.run();
    expect(outcome.stderr).toEqual([]);
    expect(outcome.code).toBe(EXIT.ok);
    expect(outcome.stdout.at(-1)).toContain("findings=2 edited=1 kept=1 manual=0");
  });

  test("a residue of the same count on other paths: code 1", async () => {
    const b = await bench({ files: KEEP_FILES, detector: IGNORING });
    b.decisions([fix("1"), [REPOSITORY, "other.yml", "1", "keep", "", "kept on purpose"]]);
    b.companions([
      [REPOSITORY, "other.yml", "2", "insert", "# IGNORE-FILE", "silences the kept file"],
      [REPOSITORY, "third.yml", "1", "insert", "w: BAD", "a finding elsewhere"],
    ]);
    const outcome = await b.run();
    expect(outcome.code).toBe(EXIT.proof);
    expect(outcome.stderr.join("\n")).toContain(
      "the detector returns 1 finding(s) on [third.yml], the kept ones are 1 on [other.yml]",
    );
  });

  test("a repository's own verification that fails: code 1, its output relayed", async () => {
    const b = await bench();
    b.decisions([fix("*")]);
    const verify = join(b.work, TICKET, "verify", "o", "alpha");
    mkdirSync(dirname(verify), { recursive: true });
    writeFileSync(verify, "#!/bin/sh\necho 'suite: 1 failing'\nexit 1\n");
    chmodSync(verify, 0o755);
    const outcome = await b.run();
    expect(outcome.code).toBe(EXIT.proof);
    expect(outcome.stderr.join("\n")).toContain("verification failed (exit 1)");
    expect(outcome.stderr.join("\n")).toContain("suite: 1 failing");
    expect(existsSync(b.kits)).toBe(false);
  });
});

describe("stale or unreadable input: code 3, never green", () => {
  test("a detector exiting 2 on the patched copy", async () => {
    const b = await bench({
      detector: `if git grep -q GOOD; then echo broken >&2; exit 2; fi; ${GREP_BAD}`,
    });
    b.decisions([fix("*")]);
    const outcome = await b.run();
    expect(outcome.code).toBe(EXIT.input);
    expect(outcome.stderr.join("\n")).toContain(
      "detector in error on the patched copy: detector exit 2: broken",
    );
    expect(existsSync(b.kits)).toBe(false);
  });

  test("a worktree that moved since the state", async () => {
    const b = await bench();
    b.decisions([fix("*")]);
    writeFileSync(join(b.repo, "later.txt"), "x\n");
    git(b.home, b.repo, "add", "later.txt");
    git(b.home, b.repo, "commit", "-q", "-m", "later");
    const outcome = await b.run();
    expect(outcome.code).toBe(EXIT.input);
    expect(outcome.stderr.join("\n")).toContain("the worktree moved since the state");
  });

  test("a proof whose lines differ from the count of the state", async () => {
    const b = await bench();
    b.decisions([fix("*")]);
    appendFileSync(
      join(b.root, "states", LABEL, "preuves", TICKET, "o", "alpha.txt"),
      "conf.yml:9:z: BAD\n",
    );
    const outcome = await b.run();
    expect(outcome.code).toBe(EXIT.input);
    expect(outcome.stderr.join("\n")).toContain("the proof holds 4 line(s), the state counts 3");
  });

  test("a ticket no detector declares", async () => {
    const b = await bench();
    const outcome = await b.run(["absent", LABEL]);
    expect(outcome.code).toBe(EXIT.input);
    expect(outcome.stderr[0]).toContain("0 detector(s) declare it");
  });

  test("a parc detector: a kit is per repository", async () => {
    const b = await bench({ scope: "parc", detector: "true" });
    const outcome = await b.run();
    expect(outcome.code).toBe(EXIT.input);
    expect(outcome.stderr[0]).toContain("a parc detector has no kit per repository");
  });

  test("a decisions file absent while a repository is in écart", async () => {
    const b = await bench();
    const outcome = await b.run();
    expect(outcome.code).toBe(EXIT.input);
    expect(outcome.stderr[0]).toContain("decisions.tsv: absent");
  });
});

describe("usage: code 2", () => {
  test("a ticket or a label holding a slash or starting with a dot, a wrong count", async () => {
    const b = await bench();
    for (const argv of [["a/b", LABEL], [TICKET, ".l1"], [TICKET], [TICKET, LABEL, "x"]]) {
      expect([argv.join(" "), (await b.run(argv)).code]).toEqual([argv.join(" "), EXIT.usage]);
    }
  });

  test("a required variable absent or empty", async () => {
    const b = await bench();
    const outcome = await runKit([TICKET, LABEL], {
      environment: { ...b.env, FLEET_WORKTREES_DIR: "" },
    });
    expect(outcome.code).toBe(EXIT.usage);
    expect(outcome.stderr[0]).toBe("FLEET_WORKTREES_DIR is not set");
  });
});

describe("pure parts", () => {
  test("findings are path:line:text", () => {
    expect(parseFinding("a/b.yml:12:text: x")).toEqual({
      path: "a/b.yml",
      line: 12,
      raw: "a/b.yml:12:text: x",
    });
    expect(parseFinding("no line here")).toBeNull();
    expect(parseFinding("a.yml:0:zero")).toBeNull();
  });

  test("the prediction: mark and replace +1/-1, delete -1, insert one plus one per literal \\n", () => {
    const edit = (action: "mark" | "replace" | "delete" | "insert", argument = "x") => ({
      path: "f",
      line: 1,
      action,
      argument,
    });
    expect(predictLines([edit("mark"), edit("replace")])).toEqual({
      added: 2,
      removed: 2,
    });
    expect(predictLines([edit("delete")])).toEqual({ added: 0, removed: 1 });
    expect(predictLines([edit("insert", "a\\nb\\nc")])).toEqual({
      added: 3,
      removed: 0,
    });
  });

  test("numstat sums; a binary entry is unreadable", () => {
    expect(numstatTotals("2\t1\ta\n0\t3\tb\n")).toEqual({
      added: 2,
      removed: 4,
    });
    expect(numstatTotals("-\t-\tbin\n")).toBeNull();
  });

  test("the residue compares paths, not only the count", () => {
    const kept = [{ path: "a", line: 1, raw: "a:1:x" }];
    expect(residueProblem(kept, ["a:7:x"])).toBeNull();
    expect(residueProblem(kept, ["b:1:x"])).not.toBeNull();
    expect(residueProblem(kept, [])).not.toBeNull();
  });

  test("a numbered decision wins over the * of its file", () => {
    const read = parseDecisions(
      `${DECISION_COLUMNS.join("\t")}\no/a\tf\t*\treplace\tX=>Y\tr\no/a\tf\t2\tkeep\t\tr\n`,
      "d",
      false,
    );
    if (!read.ok) throw new Error(read.errors.join("; "));
    const finding = (line: number) => ({ path: "f", line, raw: `f:${line}:X` });
    const result = cover(
      [{ repository: "o/a", findings: [finding(1), finding(2)] }],
      read.decisions,
      [],
    );
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.plans[0]?.kept.map((f) => f.line)).toEqual([2]);
    expect(result.plans[0]?.edits.map((e) => e.line)).toEqual([1]);
  });

  test("companions take numbered edits only", () => {
    const read = parseDecisions(
      `${DECISION_COLUMNS.join("\t")}\no/a\tf\t*\tkeep\t\tr\n`,
      "c",
      true,
    );
    expect(read.ok ? [] : read.errors).toEqual([
      "c:2: line « * » is not a positive number",
      "c:2: a companion is an edit (mark, replace, delete, insert), not « keep »",
    ]);
  });

  test("a Python detector runs in an isolated interpreter", () => {
    expect(isolatedArgv(["/d/x.PY", "a"])).toEqual(["python3", "-I", "/d/x.PY", "a"]);
    expect(isolatedArgv(["/d/x.sh"])).toEqual(["/d/x.sh"]);
  });
});
