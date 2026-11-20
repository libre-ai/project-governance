import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The launcher is exercised as the process it is, on a throwaway repository:
 * its two stops are exits, and an exit is only observable from outside.
 *
 * What each test would miss if it went away:
 * - a corpus whose substitution matches nothing, or twice, would be measured
 *   up to the broken case and leave a partial run that reads like a result;
 * - a layer red on the healthy revision would "catch" every case, and the
 *   bench would publish a layer's own failure as its detection rate.
 */

const LAUNCHER = join(import.meta.dir, "lanceur.ts");
const SOURCE = "const x = 1;\nconst y = 1;\n";
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function git(copy: string, ...args: string[]): string {
  const run = Bun.spawnSync(["git", "-C", copy, ...args], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
  return run.stdout.toString();
}

interface Bench {
  readonly copy: string;
  readonly marker: string;
  readonly results: string;
  readonly corpus: string;
}

/** A committed one-file repository, and paths outside it for what a run writes. */
function bench(): Bench {
  const root = mkdtempSync(join(tmpdir(), "trust-bench-test-"));
  roots.push(root);
  const copy = join(root, "copy");
  mkdirSync(join(copy, "src"), { recursive: true });
  git(copy, "init", "-q");
  git(copy, "config", "user.name", "bench");
  git(copy, "config", "user.email", "bench@example.com");
  git(copy, "config", "commit.gpgsign", "false");
  writeFileSync(join(copy, "src", "a.ts"), SOURCE);
  git(copy, "add", "-A");
  git(copy, "commit", "-q", "-m", "init");
  return {
    copy,
    marker: join(root, "marker"),
    results: join(root, "results.jsonl"),
    corpus: join(root, "corpus.json"),
  };
}

interface Outcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** How many times a layer command ran: one line per run. */
  readonly layerRuns: number;
  readonly resultsWritten: boolean;
  readonly copyStatus: string;
}

function launch(
  b: Bench,
  layer: string,
  cas: readonly Record<string, unknown>[],
  options: readonly string[] = [],
): Outcome {
  // The layer leaves one line per run in a file outside the copy, so "no
  // measure was taken" is observed, not inferred from the exit code.
  const commande = ["sh", "-c", `echo run >> '${b.marker}'; ${layer}`];
  writeFileSync(
    b.corpus,
    JSON.stringify({ depot: "fixture", couches: [{ id: "L", cout: 1, commande }], cas }),
  );
  const command = [process.execPath, LAUNCHER, b.corpus, b.copy, b.results, ...options];
  const run = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  return {
    code: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
    layerRuns: existsSync(b.marker) ? readFileSync(b.marker, "utf8").trim().split("\n").length : 0,
    resultsWritten: existsSync(b.results),
    copyStatus: git(b.copy, "status", "--short"),
  };
}

/** What a written line says of one run: the fields a reader of the results decides on. */
interface Line {
  readonly cas: string;
  readonly code: number | null;
  readonly attrape: boolean;
  readonly delai: boolean;
  readonly signal: string | null;
  readonly instable: boolean;
}

function written(b: Bench): Line[] {
  return readFileSync(b.results, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Line)
    .map(({ cas, code, attrape, delai, signal, instable }) => ({
      cas,
      code,
      attrape,
      delai,
      signal,
      instable,
    }));
}

const GREEN = { code: 0, attrape: false, delai: false, signal: null, instable: false };
const CATCHES_DEFECT = "! grep -q 'x = 2' src/a.ts";
const ON_DEFECT = "grep -q 'x = 2' src/a.ts";
const VALID = {
  id: "D01",
  attendu: true,
  nature: "valid case",
  fichier: "src/a.ts",
  cherche: "const x = 1;",
  remplace: "const x = 2;",
};

describe("lanceur", () => {
  test("control: a valid corpus is measured, one line per case and layer", () => {
    const b = bench();
    const outcome = launch(b, CATCHES_DEFECT, [VALID]);
    expect(outcome.stderr).toBe("");
    expect(outcome.code).toBe(0);
    expect(written(b)).toEqual([
      { cas: "SAIN", ...GREEN },
      { cas: "D01", ...GREEN, code: 1, attrape: true },
    ]);
    // The healthy revision once, the red of D01 and its replay.
    expect(outcome.layerRuns).toBe(3);
    expect(outcome.copyStatus).toBe("");
  }, 60_000);

  test("a red that turns green on its replay is written green, and marked unstable", () => {
    const b = bench();
    // Red on the second run of the layer only: the first submission of D01.
    const outcome = launch(b, `[ "$(grep -c run '${b.marker}')" -ne 2 ]`, [VALID]);
    expect(outcome.stderr).toBe("");
    expect(outcome.code).toBe(0);
    expect(written(b)).toEqual([
      { cas: "SAIN", ...GREEN },
      { cas: "D01", ...GREEN, instable: true },
    ]);
    expect(outcome.layerRuns).toBe(3);
  }, 60_000);

  test("a layer that outlives its delay is neither caught nor green: a state of its own", () => {
    const b = bench();
    const outcome = launch(
      b,
      `if ${ON_DEFECT}; then exec sleep 20; fi`,
      [VALID],
      ["--delai-ms", "500"],
    );
    expect(written(b)).toEqual([
      { cas: "SAIN", ...GREEN },
      { cas: "D01", ...GREEN, code: null, delai: true },
    ]);
    // Not a verdict, so not replayed; and the run says it, by its exit and its count.
    expect(outcome.layerRuns).toBe(2);
    expect(outcome.stdout).toContain("délais dépassés : 1, couches tuées par signal : 0");
    expect(outcome.code).toBe(1);
    expect(outcome.copyStatus).toBe("");
  }, 60_000);

  test("a layer killed by a signal is neither a delay nor a miss: named apart", () => {
    const b = bench();
    const outcome = launch(b, `if ${ON_DEFECT}; then kill -9 $$; fi`, [VALID]);
    expect(written(b)).toEqual([
      { cas: "SAIN", ...GREEN },
      { cas: "D01", ...GREEN, code: null, signal: "SIGKILL" },
    ]);
    expect(outcome.layerRuns).toBe(2);
    expect(outcome.stdout).toContain("délais dépassés : 0, couches tuées par signal : 1");
    expect(outcome.code).toBe(1);
  }, 60_000);

  test("a layer killed on the healthy revision stops the bench like a red one", () => {
    const b = bench();
    const outcome = launch(b, "kill -9 $$", [VALID]);
    expect(outcome.code).toBe(3);
    expect(outcome.stderr).toContain("banc interrompu : la couche L");
    expect(outcome.stderr).toContain("SIGKILL");
    expect(outcome.layerRuns).toBe(1);
    expect(outcome.resultsWritten).toBe(false);
  }, 60_000);

  test("a delay that is not a positive number of milliseconds is refused", () => {
    const b = bench();
    const outcome = launch(b, CATCHES_DEFECT, [VALID], ["--delai-ms", "bientôt"]);
    expect(outcome.code).toBe(2);
    expect(outcome.layerRuns).toBe(0);
  }, 60_000);

  test("a substitution whose text is absent stops the bench before any measure", () => {
    const b = bench();
    const absent = { ...VALID, id: "D02", cherche: "const z = 1;" };
    // The broken case comes second: a launcher that validated case by case
    // would have measured the healthy revision and D01 before reaching it.
    const outcome = launch(b, CATCHES_DEFECT, [VALID, absent]);
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("D02 : 0 occurrence(s)");
    expect(outcome.layerRuns).toBe(0);
    expect(outcome.resultsWritten).toBe(false);
    expect(outcome.copyStatus).toBe("");
  }, 60_000);

  test("an ambiguous substitution stops the bench before any measure", () => {
    const b = bench();
    const ambiguous = { ...VALID, id: "D02", cherche: " = 1;" };
    const outcome = launch(b, CATCHES_DEFECT, [VALID, ambiguous]);
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("D02 : 2 occurrence(s)");
    expect(outcome.layerRuns).toBe(0);
    expect(outcome.resultsWritten).toBe(false);
  }, 60_000);

  test("a copy with work not committed is refused, and left as it was", () => {
    const b = bench();
    const edited = "const x = 1;\nconst y = 3;\n";
    writeFileSync(join(b.copy, "src", "a.ts"), edited);
    writeFileSync(join(b.copy, "notes.txt"), "not committed\n");
    const outcome = launch(b, CATCHES_DEFECT, [VALID]);
    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toContain("2 entrée(s)");
    expect(outcome.layerRuns).toBe(0);
    expect(outcome.resultsWritten).toBe(false);
    // The restore of the launcher would have wiped both: they are still there, unchanged.
    expect(readFileSync(join(b.copy, "src", "a.ts"), "utf8")).toBe(edited);
    expect(readFileSync(join(b.copy, "notes.txt"), "utf8")).toBe("not committed\n");
  }, 60_000);

  test("a case named like the healthy revision, or twice the same id, is refused", () => {
    for (const [cas, motif] of [
      [[{ ...VALID, id: "SAIN" }], "SAIN : identifiant réservé"],
      [
        [VALID, { ...VALID, cherche: "const y = 1;", remplace: "const y = 2;" }],
        "D01 : identifiant en double",
      ],
      [[{ ...VALID, id: "../D01" }], "../D01 : identifiant invalide"],
    ] as const) {
      const b = bench();
      const outcome = launch(b, CATCHES_DEFECT, cas);
      expect(outcome.code, outcome.stderr).toBe(2);
      expect(outcome.stderr).toContain(motif);
      expect(outcome.layerRuns).toBe(0);
      expect(outcome.resultsWritten).toBe(false);
    }
  }, 60_000);

  test("a substitution whose file leaves the copy is refused before anything is written", () => {
    for (const fichier of ["../outside.ts", "src/../../outside.ts", "/tmp/outside.ts"]) {
      const b = bench();
      const outside = join(b.copy, "..", "outside.ts");
      const outcome = launch(b, CATCHES_DEFECT, [{ ...VALID, fichier, cherche: "" }]);
      expect(outcome.code, `${fichier}\n${outcome.stderr}`).toBe(2);
      expect(outcome.stderr).toContain(`${fichier} sort de la copie`);
      expect(outcome.layerRuns).toBe(0);
      expect(existsSync(outside)).toBe(false);
    }
  }, 60_000);

  test("a layer red on the healthy revision stops the bench, and no result is written", () => {
    const b = bench();
    const outcome = launch(b, "exit 1", [VALID]);
    expect(outcome.code).toBe(3);
    expect(outcome.stderr).toContain("banc interrompu : la couche L sort en 1");
    // The red is replayed once, on the healthy revision only: D01 is never submitted.
    expect(outcome.layerRuns).toBe(2);
    expect(outcome.resultsWritten).toBe(false);
    expect(outcome.copyStatus).toBe("");
  }, 60_000);
});
