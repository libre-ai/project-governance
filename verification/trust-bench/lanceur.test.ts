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
  readonly stderr: string;
  /** How many times a layer command ran: one line per run. */
  readonly layerRuns: number;
  readonly resultsWritten: boolean;
  readonly copyStatus: string;
}

function launch(b: Bench, layer: string, cas: readonly Record<string, unknown>[]): Outcome {
  // The layer leaves one line per run in a file outside the copy, so "no
  // measure was taken" is observed, not inferred from the exit code.
  const commande = ["sh", "-c", `echo run >> '${b.marker}'; ${layer}`];
  writeFileSync(
    b.corpus,
    JSON.stringify({ depot: "fixture", couches: [{ id: "L", cout: 1, commande }], cas }),
  );
  const run = Bun.spawnSync([process.execPath, LAUNCHER, b.corpus, b.copy, b.results], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: run.exitCode,
    stderr: run.stderr.toString(),
    layerRuns: existsSync(b.marker) ? readFileSync(b.marker, "utf8").trim().split("\n").length : 0,
    resultsWritten: existsSync(b.results),
    copyStatus: git(b.copy, "status", "--short"),
  };
}

const CATCHES_DEFECT = "! grep -q 'x = 2' src/a.ts";
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
    const lines = readFileSync(b.results, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { cas: string; attrape: boolean });
    expect(lines.map(({ cas, attrape }) => ({ cas, attrape }))).toEqual([
      { cas: "SAIN", attrape: false },
      { cas: "D01", attrape: true },
    ]);
    expect(outcome.copyStatus).toBe("");
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
