import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

/**
 * The pilot is exercised as the script it is, against stand-ins for the CLI
 * it drives: the measured repository is not available here, and what is held
 * is the pilot's own judgement, not the CLI's.
 *
 * A scenario is worth its line only if it can come out wrong. Each test hands
 * the pilot a CLI that misbehaves in one way and expects the scenario that
 * covers it, and no other, to say so; the control hands it a CLI that behaves
 * as the specification says, so none of these reds is the red of a pilot that
 * is red on everything.
 *
 * What each test would miss if it went away:
 * - a CLI that accepts a command with a path would pass S4, as it did when
 *   every non-zero exit was read as a refusal and the script named by the
 *   recipe did not exist;
 * - a CLI that did not run at all would pass every scenario whose expected
 *   exit is its own failure to start, and S6, whose expected count is zero.
 */

const PILOT = join(import.meta.dir, "pilote-pi-evidence.sh");
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

type Mode =
  | "faithful"
  | "path-accepted"
  | "path-failed-without-refusal"
  | "verify-silent"
  | "token-leaked";

/**
 * A stand-in CLI with the behaviour the six scenarios rely on, taken from the
 * README and the messages of the measured CLI: the verdict line of `gate` and
 * its exit, the refusal of a command that is not a bare name (exit 2), and
 * the answer of `verify --ci` when no reference is committed.
 */
function stub(mode: Mode): string {
  return `
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MODE: string = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
const cwd = args[args.indexOf("--cwd") + 1] ?? ".";

if (args[0] === "verify") {
  if (MODE !== "verify-silent") console.log("aucune référence à rejouer : no committed bundle");
  process.exit(0);
}
const check = JSON.parse(readFileSync(join(cwd, ".evidence.json"), "utf8")).checks[0];
if (!/^[A-Za-z0-9._+-]+$/.test(check.command)) {
  if (MODE === "path-failed-without-refusal") process.exit(1);
  if (MODE !== "path-accepted") {
    console.error("evidence: checks[0] (c): command must be a bare executable name (no path, no spaces)");
    process.exit(2);
  }
}
let verdict = "INCOMPLETE";
let output = "";
try {
  const run = Bun.spawnSync([check.command, ...check.args], { cwd, stdout: "pipe", stderr: "pipe" });
  verdict = run.exitCode === 0 ? "CONFORMANT" : "FAILED";
  output = run.stdout.toString();
} catch {
  // An executable that does not exist: the required check is unavailable.
}
mkdirSync(join(cwd, ".evidence"), { recursive: true });
// The faithful CLI masks what a check printed; the leaking one records it as it came.
const recorded = MODE === "token-leaked" ? output : "[masked]";
writeFileSync(join(cwd, ".evidence", "bundle.json"), JSON.stringify({ check, output: recorded }));
console.log(\`bundle — verdict \${verdict} (declared recipe, criteria declared)\`);
process.exit(verdict === "CONFORMANT" ? 0 : 1);
`;
}

interface Run {
  readonly code: number;
  /** Scenario id to its state, `ok` or `ECART`, with what was observed. */
  readonly scenarios: Readonly<Record<string, string>>;
  readonly output: string;
}

function pilot(repository: string): Run {
  const scratch = mkdtempSync(join(tmpdir(), "trust-bench-pilot-test-"));
  roots.push(scratch);
  const run = Bun.spawnSync(["sh", PILOT, repository], {
    stdout: "pipe",
    stderr: "pipe",
    // The pilot starts the CLI with `bun`: the one running this test.
    env: {
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
      TMPDIR: scratch,
    },
  });
  const output = run.stdout.toString() + run.stderr.toString();
  const scenarios: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const match = /^(S\d)-\S+ attendu=\S+ observé=(\S+) (ok|ECART)$/.exec(line);
    if (match) scenarios[match[1] as string] = `${match[3]} ${match[2]}`;
  }
  return { code: run.exitCode, scenarios, output };
}

function repositoryWith(mode: Mode): string {
  const root = mkdtempSync(join(tmpdir(), "trust-bench-pilot-stub-"));
  roots.push(root);
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "evidence.ts"), stub(mode));
  return root;
}

const ALL_OK = {
  S1: "ok 0:CONFORMANT",
  S2: "ok 1:FAILED",
  S3: "ok 1:INCOMPLETE",
  S4: "ok 2:recette-refusee",
  S5: "ok 0",
  S6: "ok 0",
};

describe("pilote-pi-evidence", () => {
  test("control: a CLI that behaves as specified passes the six scenarios", () => {
    const run = pilot(repositoryWith("faithful"));
    expect(run.scenarios, run.output).toEqual(ALL_OK);
    expect(run.output).toContain("scénarios joués=6 écarts=0");
    expect(run.code).toBe(0);
  }, 120_000);

  test("a CLI that accepts a command with a path fails S4, and only S4", () => {
    const run = pilot(repositoryWith("path-accepted"));
    // The script the recipe names exists and succeeds: accepted, the gate opens.
    expect(run.scenarios, run.output).toEqual({ ...ALL_OK, S4: "ECART 0:CONFORMANT" });
    expect(run.code).toBe(1);
  }, 120_000);

  test("a gate closed on a command with a path for another reason is not a refusal", () => {
    const run = pilot(repositoryWith("path-failed-without-refusal"));
    expect(run.scenarios, run.output).toEqual({ ...ALL_OK, S4: "ECART 1:sans-verdict" });
    expect(run.code).toBe(1);
  }, 120_000);

  test("a verify that printed nothing did not run: S6 does not pass on an empty output", () => {
    const run = pilot(repositoryWith("verify-silent"));
    expect(run.scenarios, run.output).toEqual({ ...ALL_OK, S6: "ECART non-exécuté(rc=0)" });
    expect(run.code).toBe(1);
  }, 120_000);

  test("a CLI that records the token a check printed fails S5, and only S5", () => {
    const run = pilot(repositoryWith("token-leaked"));
    // One file of the evidence folder carries the token: one leak counted.
    expect(run.scenarios, run.output).toEqual({ ...ALL_OK, S5: "ECART 1" });
    expect(run.code).toBe(1);
  }, 120_000);

  test("a repository that is not there passes no scenario", () => {
    const absent = join(mkdtempSync(join(tmpdir(), "trust-bench-pilot-stub-")), "absent");
    roots.push(dirname(absent));
    const run = pilot(absent);
    expect(Object.keys(run.scenarios).sort(), run.output).toEqual(Object.keys(ALL_OK));
    for (const [id, state] of Object.entries(run.scenarios)) {
      expect(state, `${id}\n${run.output}`).toStartWith("ECART ");
    }
    expect(run.output).toContain("scénarios joués=6 écarts=6");
    expect(run.code).toBe(1);
  }, 120_000);
});
