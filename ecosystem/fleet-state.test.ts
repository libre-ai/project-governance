import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RegistryEntry } from "./check-context-conformance";
import { type DetectorDescriptor, type Discovery, discoverDetectors } from "./fleet-gates";
import {
  type DetectorRun,
  type DetectorTarget,
  expectedMeasures,
  type FleetReader,
  findingLines,
  localFleetReader,
  measure,
  PARK_REPOSITORY,
  parseStateTsv,
  proofFile,
  proofPath,
  readState,
  renderStateTsv,
  repositoryNameError,
  runState,
  runTickets,
  type StateDependencies,
  StateReadError,
  sumError,
  summaryLine,
  tallyOf,
  ticketStatus,
  verdictOf,
} from "./fleet-state";

/**
 * Measured fleet state (lot L093, option B decided by the owner on
 * 2026-11-17). The expected values come from the brief: verdicts conforme,
 * info, écart, erreur, exempté; a finding exits 0 and an error exits 1 with
 * one ERREUR line and no proof; usage 2; unreadable inventory 4; private and
 * archived repositories exempt without a read; the proof of a `parc` measure
 * named `parc`; tickets ERREUR and ABSENT, a header count equal to the state
 * lines minus the header, an absent or empty state 4; counters that sum.
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `fleet-state-${prefix}-`));
  roots.push(root);
  return root;
}

function detector(
  id: string,
  target: number | null,
  scope: "repo" | "parc" = "repo",
): DetectorDescriptor {
  return { id, title: `Title of ${id}`, fragility: "f", target, scope, path: `/nowhere/${id}.sh` };
}

function entry(
  repository: string,
  visibility: "public" | "private" = "public",
  lifecycle = "active",
): RegistryEntry {
  return { repository, role: "satellite", layer: "product", lifecycle, visibility };
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

interface Spy extends FleetReader {
  readonly calls: string[];
}

/** A reader answering from a table `detector repository -> run`; every read is recorded. */
function fakeReader(
  runs: Record<string, DetectorRun>,
  heads: Record<string, string | null> = {},
): Spy {
  const calls: string[] = [];
  return {
    calls,
    async head(repository) {
      calls.push(`head ${repository}`);
      const sha = heads[repository] === undefined ? SHA : heads[repository];
      return sha === null ? { ok: false, reason: "no worktree" } : { ok: true, sha };
    },
    async run(d: DetectorDescriptor, target: DetectorTarget) {
      const where = target.scope === "repo" ? target.repository : PARK_REPOSITORY;
      calls.push(`run ${d.id} ${where}`);
      return runs[`${d.id} ${where}`] ?? { ok: true, lines: [] };
    },
  };
}

const INVENTORY = `schema_version: libre-ai.repositories.v2
updated_on: 2026-11-17
repositories:
  - repository: o/alpha
    role: satellite
    layer: product
    visibility: public
    lifecycle: active
  - repository: o/beta
    role: satellite
    layer: product
    visibility: public
    lifecycle: active
  - repository: o/frozen
    role: satellite
    layer: product
    visibility: public
    lifecycle: archived
  - repository: libre-ai/product-research
    role: administrative-private
    layer: transverse
    visibility: private
    lifecycle: active
`;

interface Bench {
  readonly root: string;
  readonly out: string;
  readonly args: (extra?: readonly string[]) => string[];
}

function bench(): Bench {
  const root = scratch("bench");
  mkdirSync(join(root, "worktrees"));
  mkdirSync(join(root, "snapshot"));
  writeFileSync(join(root, "inventory.yaml"), INVENTORY);
  const out = join(root, "out");
  return {
    root,
    out,
    args: (extra = []) => [
      "--detectors",
      join(root, "detectors"),
      "--worktrees",
      join(root, "worktrees"),
      "--snapshot",
      join(root, "snapshot"),
      "--out",
      out,
      "--label",
      "l1",
      "--inventory",
      join(root, "inventory.yaml"),
      ...extra,
    ],
  };
}

function discovered(detectors: readonly DetectorDescriptor[]): () => Promise<Discovery> {
  return async () => ({
    ok: true,
    detectors,
    examined: detectors.length,
    ignored: 0,
    links: 0,
    folders: 0,
    registered: detectors.length,
  });
}

function deps(
  detectors: readonly DetectorDescriptor[],
  reader: FleetReader,
): StateDependencies & { readonly discover: () => Promise<Discovery> } {
  return {
    discover: discovered(detectors),
    reader: () => reader,
    now: () => new Date("2026-11-17T10:00:00.000Z"),
    defaultInventory: "/nowhere/repositories.v1.yaml",
  };
}

describe("verdicts", () => {
  test("conforme, écart, info and erreur follow the target and the status", () => {
    expect(verdictOf("ok", 0, 0)).toBe("conforme");
    expect(verdictOf("ok", 2, 2)).toBe("conforme");
    expect(verdictOf("ok", 0, 1)).toBe("écart");
    expect(verdictOf("ok", 3, 1)).toBe("écart");
    expect(verdictOf("ok", null, 7)).toBe("info");
  });

  test("an informative detector in error is erreur, not info", () => {
    expect(verdictOf("erreur", null, 0)).toBe("erreur");
  });

  test("an informative detector in error is measured erreur", async () => {
    const { measures } = await measure(
      [detector("size", null)],
      [entry("o/alpha")],
      fakeReader({ "size o/alpha": { ok: false, reason: "unreadable" } }),
    );
    expect(measures.map((m) => [m.verdict, m.status])).toEqual([["erreur", "erreur"]]);
  });
});

describe("measure", () => {
  test("zero detectors measure nothing and the counters are zero", async () => {
    const spy = fakeReader({});
    const { measures, heads } = await measure([], [entry("o/alpha")], spy);
    expect(measures).toEqual([]);
    expect(heads.size).toBe(0);
    expect(spy.calls).toEqual([]);
    expect(tallyOf([])).toEqual({
      measures: 0,
      conforme: 0,
      info: 0,
      ecart: 0,
      erreur: 0,
      exempte: 0,
    });
  });

  test("a private or archived repository is one exempté line per detector, never read", async () => {
    const spy = fakeReader({});
    const { measures } = await measure(
      [detector("pins", 0)],
      [entry("o/private", "private"), entry("o/frozen", "public", "archived"), entry("o/alpha")],
      spy,
    );
    expect(measures.map((m) => [m.repository, m.verdict, m.status, m.count])).toEqual([
      ["o/private", "exempté", "exempté", null],
      ["o/frozen", "exempté", "exempté", null],
      ["o/alpha", "conforme", "ok", 0],
    ]);
    expect(spy.calls).toEqual(["head o/alpha", "run pins o/alpha"]);
  });

  test("a parc detector runs once, on the measured repositories only", async () => {
    const seen: (readonly string[])[] = [];
    const reader: FleetReader = {
      head: async () => ({ ok: true, sha: SHA }),
      run: async (_d, target) => {
        if (target.scope === "parc") seen.push(target.repositories);
        return { ok: true, lines: ["one"] };
      },
    };
    const { measures } = await measure(
      [detector("fleet", 1, "parc")],
      [entry("o/alpha"), entry("o/frozen", "public", "archived")],
      reader,
    );
    expect(measures.map((m) => [m.repository, m.verdict, m.detail])).toEqual([
      [PARK_REPOSITORY, "conforme", "preuves/fleet/parc.txt"],
    ]);
    expect(seen).toEqual([["o/alpha"]]);
  });

  test("an unreadable worktree is an error for each of its measures, read once, never run", async () => {
    const spy = fakeReader({}, { "o/alpha": null });
    const { measures, heads } = await measure(
      [detector("a", 0), detector("b", null)],
      [entry("o/alpha"), entry("o/beta")],
      spy,
    );
    expect(measures.map((m) => [m.detector, m.repository, m.verdict])).toEqual([
      ["a", "o/alpha", "erreur"],
      ["a", "o/beta", "conforme"],
      ["b", "o/alpha", "erreur"],
      ["b", "o/beta", "info"],
    ]);
    expect(spy.calls.filter((call) => call === "head o/alpha")).toHaveLength(1);
    expect(spy.calls.filter((call) => call.startsWith("run") && call.endsWith("o/alpha"))).toEqual(
      [],
    );
    expect([...heads]).toEqual([["o/beta", SHA]]);
  });
});

describe("counters", () => {
  test("measures = conformes + info + écarts + erreurs + exemptés", () => {
    const tally = tallyOf(["conforme", "info", "écart", "écart", "erreur", "exempté"]);
    expect(tally).toEqual({ measures: 6, conforme: 1, info: 1, ecart: 2, erreur: 1, exempte: 1 });
    expect(sumError(tally, 6)).toBeNull();
  });

  test("a sum that does not hold is named", () => {
    const tally = { measures: 3, conforme: 1, info: 0, ecart: 0, erreur: 0, exempte: 0 };
    expect(sumError(tally, 3)).toBe("inconsistent sum: 1 verdicts for 3 measures");
    const whole = tallyOf(["conforme", "conforme"]);
    expect(sumError(whole, 3)).toBe("inconsistent sum: 2 measures where 3 were expected");
  });

  test("the universe is one measure per repo detector and entry, one per parc detector", () => {
    const entries = [entry("o/alpha"), entry("o/beta"), entry("o/p", "private")];
    expect(expectedMeasures([detector("a", 0), detector("p", 0, "parc")], entries)).toBe(4);
    expect(expectedMeasures([], entries)).toBe(0);
  });
});

describe("state command", () => {
  test("a repository with a single finding exits 0 with verdict écart", async () => {
    const b = bench();
    const reader = fakeReader({ "pins o/alpha": { ok: true, lines: ["a.yml:3 unpinned"] } });
    const outcome = await runState(
      b.args(["--repos", "o/alpha"]),
      deps([detector("pins", 0)], reader),
    );
    expect(outcome.code).toBe(0);
    const rows = parseStateTsv(await Bun.file(join(b.out, "l1", "state.tsv")).text());
    expect(rows.map((row) => [row.repository, row.count, row.target, row.verdict])).toEqual([
      ["o/alpha", 1, 0, "écart"],
    ]);
    expect(await Bun.file(join(b.out, "l1", proofPath("pins", "o/alpha"))).text()).toBe(
      "a.yml:3 unpinned\n",
    );
    expect(outcome.stderr).toEqual([]);
  });

  test("a detector whose reader answers unreadable exits 1, one ERREUR line, no proof", async () => {
    const b = bench();
    const reader = fakeReader({
      "pins o/alpha": { ok: false, reason: "unreadable: tree" },
      "pins o/beta": { ok: true, lines: [] },
    });
    const outcome = await runState(
      b.args(["--repos", "o/alpha,o/beta"]),
      deps([detector("pins", 0)], reader),
    );
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toEqual(["ERREUR pins o/alpha: unreadable: tree"]);
    expect(existsSync(join(b.out, "l1", proofPath("pins", "o/alpha")))).toBe(false);
    expect(existsSync(join(b.out, "l1", proofPath("pins", "o/beta")))).toBe(true);
    const rows = parseStateTsv(await Bun.file(join(b.out, "l1", "state.tsv")).text());
    expect(rows.map((row) => row.verdict)).toEqual(["erreur", "conforme"]);
  });

  test("the proof of a parc measure is named parc", async () => {
    const b = bench();
    const reader = fakeReader({ "fleet *": { ok: true, lines: ["x"] } });
    const outcome = await runState(b.args(), deps([detector("fleet", null, "parc")], reader));
    expect(outcome.code).toBe(0);
    expect(await Bun.file(join(b.out, "l1", "preuves", "fleet", "parc.txt")).text()).toBe("x\n");
  });

  test("the summary prints counters that sum to the measures", async () => {
    const b = bench();
    const reader = fakeReader({
      "a o/alpha": { ok: true, lines: ["f"] },
      "b o/beta": { ok: false, reason: "boom" },
    });
    const outcome = await runState(
      b.args(),
      deps([detector("a", 0), detector("b", 0), detector("c", null, "parc")], reader),
    );
    expect(outcome.code).toBe(1);
    // 4 inventory entries x 2 repo detectors + 1 parc detector: 2 exempt per detector.
    expect(outcome.stdout[0]).toBe(
      "fleet state l1: measures=9 conforme=2 info=1 ecart=1 erreur=1 exempte=4",
    );
    const counts = (outcome.stdout[0] ?? "").match(/=(\d+)/g)?.map((text) => Number(text.slice(1)));
    const [measures, ...parts] = counts ?? [];
    expect(parts.reduce((sum, value) => sum + value, 0)).toBe(measures ?? -1);
  });

  test("an unknown option exits 2", async () => {
    const b = bench();
    const outcome = await runState(b.args(["--colour", "red"]), deps([], fakeReader({})));
    expect(outcome.code).toBe(2);
  });

  test("a missing --out exits 2", async () => {
    const b = bench();
    const args = b.args();
    args.splice(args.indexOf("--out"), 2);
    const outcome = await runState(args, deps([detector("a", 0)], fakeReader({})));
    expect(outcome.code).toBe(2);
    expect(outcome.stderr[0]).toBe("missing option(s): --out");
  });

  test("a repository outside the inventory and a label already used exit 2", async () => {
    const b = bench();
    const d = deps([detector("a", 0)], fakeReader({}));
    expect((await runState(b.args(["--repos", "o/ghost"]), d)).code).toBe(2);
    expect((await runState(b.args(), d)).code).toBe(0);
    const again = await runState(b.args(), d);
    expect(again.code).toBe(2);
    expect(again.stderr[0]).toContain("already exists");
  });

  test("an unreadable inventory exits 4", async () => {
    const b = bench();
    const args = b.args();
    args[args.indexOf("--inventory") + 1] = join(b.root, "absent.yaml");
    const absent = await runState(args, deps([detector("a", 0)], fakeReader({})));
    expect(absent.code).toBe(4);
    writeFileSync(join(b.root, "inventory.yaml"), "repositories: [");
    const malformed = await runState(b.args(), deps([detector("a", 0)], fakeReader({})));
    expect(malformed.code).toBe(4);
  });

  test("a label that is not a plain name exits 2", async () => {
    const b = bench();
    for (const label of ["../x", "a/b", ".hidden"]) {
      const args = b.args();
      args[args.indexOf("--label") + 1] = label;
      const outcome = await runState(args, deps([detector("a", 0)], fakeReader({})));
      expect(outcome.code).toBe(2);
      expect(outcome.stderr[0]).toContain("is not a plain name");
    }
    expect(existsSync(join(b.root, "x"))).toBe(false);
  });

  test("an inventory name that is not a plain owner/name exits 4, nothing read or written", async () => {
    for (const name of ["o/../../../../pwn", "o/a\\tb", "o/..", "./x", "o/b/c", "o/a b"]) {
      const b = bench();
      writeFileSync(
        join(b.root, "inventory.yaml"),
        `schema_version: libre-ai.repositories.v2\nupdated_on: 2026-11-17\nrepositories:\n  - repository: "${name}"\n    role: satellite\n    layer: product\n    visibility: public\n    lifecycle: active\n`,
      );
      const spy = fakeReader({});
      const outcome = await runState(b.args(), deps([detector("a", 0)], spy));
      expect([name, outcome.code]).toEqual([name, 4]);
      expect(spy.calls).toEqual([]);
      expect(existsSync(b.out)).toBe(false);
    }
  });

  test("a state directory created between the measure and the rename is refused, never replaced", async () => {
    const b = bench();
    const reader: FleetReader = {
      head: async () => ({ ok: true, sha: SHA }),
      run: async () => {
        // An empty directory: a bare rename would silently replace it.
        mkdirSync(join(b.out, "l1"), { recursive: true });
        return { ok: true, lines: [] };
      },
    };
    const outcome = await runState(
      b.args(["--repos", "o/alpha"]),
      deps([detector("a", 0)], reader),
    );
    expect(outcome.code).toBe(1);
    expect(outcome.stderr.at(-1)).toContain("l1 appeared meanwhile");
    expect(existsSync(join(b.out, "l1", "state.tsv"))).toBe(false);
  });

  test("an absent worktrees root or snapshot directory exits 4", async () => {
    const b = bench();
    rmSync(join(b.root, "snapshot"), { recursive: true });
    const outcome = await runState(b.args(), deps([detector("a", 0)], fakeReader({})));
    expect(outcome.code).toBe(4);
    expect(outcome.stderr[0]).toContain("--snapshot");
  });

  test("a refused discovery (zero detectors) exits 1 with the counters at zero, nothing written", async () => {
    const b = bench();
    const outcome = await runState(b.args(), {
      ...deps([], fakeReader({})),
      discover: async () => ({ ok: false, errors: ["no detector found"] }),
    });
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toEqual([summaryLine("l1", tallyOf([]))]);
    expect(outcome.stdout[0]).toContain("measures=0");
    expect(existsSync(join(b.out, "l1"))).toBe(false);
  });

  test("the repository's own registry, empty today, refuses the run with zero counters", async () => {
    const b = bench();
    mkdirSync(join(b.root, "detectors"));
    const outcome = await runState(b.args(), {
      ...deps([], fakeReader({})),
      discover: discoverDetectors,
    });
    expect(outcome.code).toBe(1);
    expect(outcome.stdout[0]).toBe(
      "fleet state l1: measures=0 conforme=0 info=0 ecart=0 erreur=0 exempte=0",
    );
  });
});

describe("state table", () => {
  test("columns and cells round-trip, and a malformed line is refused", () => {
    const text = renderStateTsv([
      {
        repository: "o/a",
        detector: "d",
        count: null,
        target: null,
        verdict: "erreur",
        status: "erreur",
        detail: "x\\u0009y",
        lines: [],
      },
    ]);
    expect(text).toBe(
      "dépôt\tdétecteur\tcompte\tcible\tverdict\tstatut\tdétail\no/a\td\t-\tinfo\terreur\terreur\tx\\u0009y\n",
    );
    expect(parseStateTsv(text)[0]?.verdict).toBe("erreur");
    expect(() => parseStateTsv(text.replace("erreur\terreur", "bad\terreur"))).toThrow(
      StateReadError,
    );
    expect(() => parseStateTsv(text.replace("\t-\t", "\t-\textra\t"))).toThrow(StateReadError);
  });

  test("a proof path that would resolve outside the state is refused", () => {
    const dir = scratch("proof");
    expect(proofFile(dir, "d", "o/a")).toBe(join(dir, "preuves", "d", "o", "a.txt"));
    expect(proofFile(dir, "d", PARK_REPOSITORY)).toBe(join(dir, "preuves", "d", "parc.txt"));
    expect(() => proofFile(dir, "d", "o/../../../../pwn")).toThrow("resolves outside the state");
    expect(() => proofFile(dir, "../../..", "x")).toThrow("resolves outside the state");
  });

  test("repository names: owner/name from a closed alphabet, no . or .. segment", () => {
    expect(repositoryNameError("libre-ai/project.governance_2")).toBeNull();
    // A leading "-" would read as an option where the name is an argument (a replay command).
    for (const name of [
      "o/..",
      "../o",
      "o/.",
      "o/a/b",
      "o",
      "o/a\tb",
      "o/a\nb",
      "/o/a",
      "o/",
      "-o/a",
      "--label/a",
    ]) {
      expect([name, repositoryNameError(name) === null]).toEqual([name, false]);
    }
  });

  test("finding lines drop blank lines and carriage returns", () => {
    expect(findingLines("a\r\n\nb\n")).toEqual(["a", "b"]);
    expect(findingLines("")).toEqual([]);
  });
});

describe("tickets", () => {
  async function stateWith(
    detectors: readonly DetectorDescriptor[],
    runs: Record<string, DetectorRun>,
  ): Promise<string> {
    const b = bench();
    const outcome = await runState(
      b.args(["--repos", "o/alpha,o/beta"]),
      deps(detectors, fakeReader(runs)),
    );
    expect(outcome.code === 0 || outcome.code === 1).toBe(true);
    return join(b.out, "l1");
  }

  test("a detector with a measure in error is ERREUR, one without a line is ABSENT", async () => {
    const measured = [detector("broken", 0), detector("drift", 0), detector("ok", 0)];
    const dir = await stateWith(measured, {
      "broken o/beta": { ok: false, reason: "boom" },
      "drift o/alpha": { ok: true, lines: ["one", "two"] },
    });
    const outcome = await runTickets([dir, "--detectors", "/d"], {
      discover: discovered([...measured, detector("later", null)]),
    });
    expect(outcome.code).toBe(0);
    const markdown = outcome.stdout.join("\n");
    expect(markdown).toContain("| broken | Title of broken | 0 | — | 0 | ERREUR |");
    expect(markdown).toContain("| drift | Title of drift | 0 | o/alpha | 2 | à corriger |");
    expect(markdown).toContain("| ok | Title of ok | 0 | — | 0 | conforme |");
    expect(markdown).toContain("| later | Title of later | info | — | 0 | ABSENT |");
    expect(markdown).toContain(
      "Détecteurs : 4 (conforme 1, à corriger 1, informatif 0, ERREUR 1, EXEMPTÉ 0, ABSENT 1)",
    );
  });

  test("the header's measure count is the state lines minus the header", async () => {
    const measured = [detector("a", 0), detector("p", null, "parc")];
    const dir = await stateWith(measured, {});
    const lines = (await Bun.file(join(dir, "state.tsv")).text()).trimEnd().split("\n");
    const outcome = await runTickets([dir, "--detectors", "/d"], {
      discover: discovered(measured),
    });
    expect(outcome.stdout[0]).toContain(
      `Mesuré le 2026-11-17T10:00:00.000Z · ${lines.length - 1} mesures`,
    );
    expect(lines.length - 1).toBe(3);
    expect(outcome.stdout[0]).toContain("# Tickets de flotte — l1");
  });

  test("an absent directory or an empty state.tsv exits 4", async () => {
    const root = scratch("tickets");
    const discover = discovered([detector("a", 0)]);
    expect((await runTickets([join(root, "absent"), "--detectors", "/d"], { discover })).code).toBe(
      4,
    );
    const dir = await stateWith([detector("a", 0)], {});
    writeFileSync(join(dir, "state.tsv"), "");
    expect((await runTickets([dir, "--detectors", "/d"], { discover })).code).toBe(4);
    writeFileSync(
      join(dir, "state.tsv"),
      "dépôt\tdétecteur\tcompte\tcible\tverdict\tstatut\tdétail\n",
    );
    expect((await runTickets([dir, "--detectors", "/d"], { discover })).code).toBe(4);
  });

  test("usage errors exit 2", async () => {
    const discover = discovered([]);
    expect((await runTickets([], { discover })).code).toBe(2);
    expect((await runTickets(["/s"], { discover })).code).toBe(2);
    expect((await runTickets(["/s", "--detectors", "/d", "--x", "y"], { discover })).code).toBe(2);
  });

  test("only exempt lines measured nothing: EXEMPTÉ, neither conforme nor ABSENT", () => {
    const row = {
      repository: "o/p",
      detector: "a",
      count: null,
      target: 0,
      verdict: "exempté" as const,
      status: "exempté" as const,
      detail: "",
    };
    expect(ticketStatus([row])).toBe("EXEMPTÉ");
    // ABSENT stays the brief's: a detector without any line in the state.
    expect(ticketStatus([])).toBe("ABSENT");
    expect(ticketStatus([row, { ...row, verdict: "info", status: "ok", count: 3 }])).toBe(
      "informatif",
    );
  });
});

describe("local reader (worktrees and detector scripts, no network)", () => {
  function git(cwd: string, ...args: string[]): void {
    const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }

  function worktreeRoot(): string {
    // Resolved: the scripts print `pwd -P`, and the temporary directory may sit behind a link.
    const root = realpathSync(scratch("worktrees"));
    const repo = join(root, "o", "alpha");
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "-q");
    git(repo, "config", "user.name", "t");
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "file.txt"), "x\n");
    git(repo, "add", "file.txt");
    git(repo, "commit", "-q", "-m", "init");
    // A directory inside a repository that is not its root.
    mkdirSync(join(root, "o", "nested"), { recursive: true });
    const parent = join(root, "o");
    git(parent, "init", "-q");
    git(parent, "config", "user.name", "t");
    git(parent, "config", "user.email", "t@t");
    git(parent, "config", "commit.gpgsign", "false");
    git(parent, "commit", "-q", "--allow-empty", "-m", "parent");
    return root;
  }

  function script(body: string): DetectorDescriptor {
    const dir = scratch("detector");
    const path = join(dir, "d.sh");
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return { ...detector("d", 0), path };
  }

  test("HEAD is read at the worktree root; a missing or nested worktree is unreadable", async () => {
    const root = worktreeRoot();
    const reader = localFleetReader({ worktrees: root, snapshot: root, environment: {} });
    const head = await reader.head("o/alpha");
    expect(head.ok && /^[0-9a-f]{40}$/.test(head.sha)).toBe(true);
    expect((await reader.head("o/absent")).ok).toBe(false);
    const nested = await reader.head("o/nested");
    expect(nested.ok ? "" : nested.reason).toContain("not the root of a git repository");
  });

  test("each non-empty output line is a finding; the environment carries no token", async () => {
    const root = worktreeRoot();
    const reader = localFleetReader({
      worktrees: root,
      snapshot: "/snap",
      environment: { PATH: process.env.PATH, GH_TOKEN: "secret-value" },
    });
    const run = await reader.run(
      script(
        'pwd -P; printf "%s\\n" "$FLEET_REPOSITORY" "$FLEET_SNAPSHOT" "token=$GH_TOKEN"; echo',
      ),
      { scope: "repo", repository: "o/alpha" },
    );
    expect(run).toEqual({
      ok: true,
      lines: [join(root, "o", "alpha"), "o/alpha", "/snap", "token="],
    });
  });

  test("a parc run starts at the worktrees root with the measured repositories", async () => {
    const root = worktreeRoot();
    const reader = localFleetReader({ worktrees: root, snapshot: root, environment: {} });
    const run = await reader.run(script('pwd -P; printf "%s\\n" "$FLEET_REPOSITORIES"'), {
      scope: "parc",
      repositories: ["o/alpha", "o/beta"],
    });
    expect(run).toEqual({ ok: true, lines: [root, "o/alpha", "o/beta"] });
  });

  test("a non-zero exit, an output that is not UTF-8 and a missing script are errors", async () => {
    const root = worktreeRoot();
    const reader = localFleetReader({ worktrees: root, snapshot: root, environment: {} });
    const target = { scope: "repo", repository: "o/alpha" } as const;
    const failed = await reader.run(script("echo finding; echo broken >&2; exit 3"), target);
    expect(failed).toEqual({ ok: false, reason: "detector exit 3: broken" });
    const binary = await reader.run(script("printf '\\377\\n'"), target);
    expect(binary).toEqual({ ok: false, reason: "detector output is not UTF-8" });
    const missing = await reader.run({ ...detector("m", 0), path: join(root, "none.sh") }, target);
    expect(missing.ok).toBe(false);
  });

  test("a worktree reached through a symbolic link is unreadable and never run", async () => {
    const root = worktreeRoot();
    const outside = realpathSync(scratch("outside"));
    symlinkSync(join(root, "o", "alpha"), join(root, "o", "link"));
    mkdirSync(join(outside, "alpha"));
    symlinkSync(outside, join(root, "evil"));
    const reader = localFleetReader({ worktrees: root, snapshot: root, environment: {} });
    for (const repository of ["o/link", "evil/alpha"]) {
      const head = await reader.head(repository);
      expect([repository, head.ok ? "" : head.reason]).toEqual([
        repository,
        `${repository}: ${repository.split("/")[repository === "o/link" ? 1 : 0]} is a symbolic link`,
      ]);
    }
    const marker = join(outside, "ran");
    const run = await reader.run(script(`touch ${marker}`), {
      scope: "repo",
      repository: "o/link",
    });
    expect(run.ok).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  test("a worktree that differs from HEAD is unreadable: modified or untracked", async () => {
    for (const dirt of ["modified", "untracked"] as const) {
      const root = worktreeRoot();
      const repo = join(root, "o", "alpha");
      writeFileSync(join(repo, dirt === "modified" ? "file.txt" : "new.txt"), "y\n");
      const head = await localFleetReader({
        worktrees: root,
        snapshot: root,
        environment: {},
      }).head("o/alpha");
      expect([dirt, head.ok ? "" : head.reason]).toEqual([
        dirt,
        "o/alpha: the working tree differs from HEAD (modified or untracked files)",
      ]);
    }
  });

  test("reading HEAD never rewrites the measured index, even when its stat data is stale", async () => {
    const root = worktreeRoot();
    const repo = join(root, "o", "alpha");
    // Same content, new mtime: `git status` would refresh and rewrite the index.
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(repo, "file.txt"), later, later);
    const index = join(repo, ".git", "index");
    const before = readFileSync(index);
    const head = await localFleetReader({
      worktrees: root,
      snapshot: root,
      environment: { PATH: process.env.PATH },
    }).head("o/alpha");
    expect(head.ok).toBe(true);
    expect(readFileSync(index).equals(before)).toBe(true);
  });

  test("a detector past its (injected) timeout is an error", async () => {
    const root = worktreeRoot();
    const reader = localFleetReader({
      worktrees: root,
      snapshot: root,
      environment: { PATH: process.env.PATH },
      timeoutMs: 300,
    });
    const run = await reader.run(script("sleep 3; echo late"), {
      scope: "repo",
      repository: "o/alpha",
    });
    expect(run).toEqual({ ok: false, reason: "detector timeout after 300 ms" });
  }, 10_000);

  test("an output over the bound is an error, never a truncation", async () => {
    const root = worktreeRoot();
    const reader = localFleetReader({
      worktrees: root,
      snapshot: root,
      environment: { PATH: process.env.PATH },
      maxStdoutBytes: 8,
    });
    const target = { scope: "repo", repository: "o/alpha" } as const;
    expect(await reader.run(script("echo 1234567"), target)).toEqual({
      ok: true,
      lines: ["1234567"],
    });
    expect(await reader.run(script("echo 12345678"), target)).toEqual({
      ok: false,
      reason: "detector output exceeds 8 bytes",
    });
  });

  test("the detector's process group dies with it; later output is not counted", async () => {
    const root = worktreeRoot();
    const pidFile = join(scratch("pid"), "pid");
    const reader = localFleetReader({
      worktrees: root,
      snapshot: root,
      environment: { PATH: process.env.PATH },
      timeoutMs: 5_000,
    });
    const started = Date.now();
    const run = await reader.run(script(`(sleep 3; echo late) & echo $! > ${pidFile}; echo now`), {
      scope: "repo",
      repository: "o/alpha",
    });
    expect(run).toEqual({ ok: true, lines: ["now"] });
    expect(Date.now() - started).toBeLessThan(2_500);
    const pid = Number((await Bun.file(pidFile).text()).trim());
    let alive = true;
    for (let attempt = 0; attempt < 20 && alive; attempt += 1) {
      try {
        process.kill(pid, 0);
        await Bun.sleep(50);
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  }, 10_000);

  test("a process that left the group and holds the output is an error, its output ignored", async () => {
    const root = worktreeRoot();
    const reader = localFleetReader({
      worktrees: root,
      snapshot: root,
      environment: { PATH: process.env.PATH },
      timeoutMs: 8_000,
    });
    // setsid moves the grandchild out of the detector's group, out of reach of the kill.
    const run = await reader.run(
      script(
        `perl -MPOSIX -e 'fork and exit; POSIX::setsid(); sleep 3; print "late\\n"'; echo now`,
      ),
      { scope: "repo", repository: "o/alpha" },
    );
    expect(run).toEqual({
      ok: false,
      reason: "detector a process left by the program kept its output open after it exited",
    });
  }, 10_000);

  test("end to end: discovered detectors on a worktree, then the tickets", async () => {
    const root = worktreeRoot();
    const dir = scratch("detectors");
    const header = (id: string, cible: string) =>
      `#!/bin/sh\n# identifiant: ${id}\n# titre: T ${id}\n# fragilite: f\n# cible: ${cible}\n# portee: repo\n`;
    writeFileSync(join(dir, "count.sh"), `${header("count", "0")}echo finding\n`);
    writeFileSync(join(dir, "size.sh"), `${header("size", "info")}echo one; echo two\n`);
    chmodSync(join(dir, "count.sh"), 0o755);
    chmodSync(join(dir, "size.sh"), 0o755);
    const registry = join(dir, "..", `${dir.split("/").at(-1)}.yaml`);
    writeFileSync(
      registry,
      "version: 1\ndetecteurs:\n  - identifiant: count\n    fichier: count.sh\n  - identifiant: size\n    fichier: size.sh\n",
    );
    roots.push(registry);
    const out = scratch("out");
    writeFileSync(join(out, "inventory.yaml"), INVENTORY);
    const stateDeps: StateDependencies = {
      discover: discoverDetectors,
      reader: (sources) =>
        localFleetReader({ ...sources, environment: { PATH: process.env.PATH } }),
      now: () => new Date("2026-11-17T10:00:00.000Z"),
      defaultInventory: join(out, "inventory.yaml"),
    };
    const outcome = await runState(
      [
        "--detectors",
        dir,
        "--registry",
        registry,
        "--worktrees",
        root,
        "--snapshot",
        root,
        "--out",
        out,
        "--label",
        "e2e",
        "--repos",
        "o/alpha,libre-ai/product-research",
      ],
      stateDeps,
    );
    expect(outcome.stderr).toEqual([]);
    expect(outcome.code).toBe(0);
    const state = await readState(join(out, "e2e"));
    expect(state.rows.map((row) => [row.detector, row.repository, row.verdict, row.count])).toEqual(
      [
        // Inventory order, which buildIndex sorts by repository.
        ["count", "libre-ai/product-research", "exempté", null],
        ["count", "o/alpha", "écart", 1],
        ["size", "libre-ai/product-research", "exempté", null],
        ["size", "o/alpha", "info", 2],
      ],
    );
    expect([...state.heads.keys()]).toEqual(["o/alpha"]);
    const tickets = await runTickets(
      [join(out, "e2e"), "--detectors", dir, "--registry", registry],
      {
        discover: discoverDetectors,
      },
    );
    expect(tickets.code).toBe(0);
    expect(tickets.stdout[0]).toContain("| count | T count | 0 | o/alpha | 1 | à corriger |");
    expect(tickets.stdout[0]).toContain("| size | T size | info | — | 2 | informatif |");
  });
});
