// SPDX-FileCopyrightText: 2026 Libre AI contributors
// SPDX-License-Identifier: EUPL-1.2
//
// Proof of the Rust mutation gate (tools/quality/check-mutation-rust.ts).
//
// The gate is run as a process, from a copy placed in a scratch tree beside a
// declaration (toolchains/cargo-mutants.json) that names a stand-in binary: the
// real declaration publishes no binary for every platform the suite runs on,
// and the gate has no flag that would let a caller point it at another
// declaration. The stand-in is a script that records every invocation in a
// call log and plays a scenario per crate: an exit status, a results file, a
// baseline log. `cargo metadata` is the real one, on fixture workspaces built
// here.
//
// The results files have the shape cargo-mutants 27.1.0 wrote when it was run
// on a two-crate workspace: the counters `total_mutants`, `caught`, `missed`,
// `unviable`, `timeout`, and one `outcomes` entry for the baseline plus one per
// mutant. The baseline logs hold lines of that run.
//
// Method of the fleet's gate template (distribution/templates/langgraph-gates):
// a case that carries a mutation is replayed against a MUTANT of the gate in
// which the decisive text is replaced by a no-op. The verdict the case pins
// must hold on the gate and must not hold on the mutant; a mutation that
// matches zero or several places, or changes nothing, fails the suite, and so
// does a mutant that crashes instead of changing the verdict.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

const GATE_SOURCE: string = readFileSync(join(import.meta.dir, "check-mutation-rust.ts"), "utf8");
const DECLARED_VERSION = "27.1.0";
const PLATFORM_KEY = `${process.platform}-${process.arch}`;

const scratch: string = mkdtempSync(join(tmpdir(), "mutation-rust-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// ---------------------------------------------------------------- stand-in tool

const FAKE_DIRECTORY: string = join(scratch, "fake");
const FAKE_BINARY: string = join(FAKE_DIRECTORY, "cargo-mutants");
const CALL_LOG: string = join(FAKE_DIRECTORY, "calls.log");
const SCENARIOS: string = join(FAKE_DIRECTORY, "scenarios");

mkdirSync(SCENARIOS, { recursive: true });
writeFileSync(
  FAKE_BINARY,
  [
    "#!/bin/bash",
    `directory='${FAKE_DIRECTORY}'`,
    'printf \'%s\\n\' "$*" >> "$directory/calls.log"',
    // Like the real binary, a cargo subcommand: anything but `mutants` first is refused.
    'if [ "$1" != "mutants" ]; then',
    '  echo "error: unexpected argument found" >&2',
    "  exit 2",
    "fi",
    'if [ "$2" = "--version" ]; then',
    `  echo "cargo-mutants ${DECLARED_VERSION}"`,
    "  exit 0",
    "fi",
    'package=""',
    'output=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --package) package="$2"; shift ;;',
    '    --output) output="$2"; shift ;;',
    "  esac",
    "  shift",
    "done",
    'scenario="$directory/scenarios/$package"',
    'if [ ! -d "$scenario" ]; then',
    "  exit 1",
    "fi",
    'mkdir -p "$output/mutants.out/log"',
    'if [ -f "$scenario/outcomes.json" ]; then',
    '  cp "$scenario/outcomes.json" "$output/mutants.out/outcomes.json"',
    "fi",
    'if [ -f "$scenario/baseline.log" ]; then',
    '  cp "$scenario/baseline.log" "$output/mutants.out/log/baseline.log"',
    "fi",
    'exit "$(cat "$scenario/status")"',
    "",
  ].join("\n"),
);
chmodSync(FAKE_BINARY, 0o755);
const FAKE_DIGEST: string = createHash("sha256").update(readFileSync(FAKE_BINARY)).digest("hex");

interface Shape {
  readonly caught?: number;
  readonly missed?: number;
  readonly unviable?: number;
  readonly timeout?: number;
  /** `total_mutants`, when it must differ from the sum of the four counters. */
  readonly generated?: number;
  /** Mutant entries that belong to none of the four counters. */
  readonly uncounted?: number;
  /** Mutant entries left out of the list. */
  readonly dropped?: number;
}

/** A results file in the shape cargo-mutants 27.1.0 writes. */
function outcomes(shape: Shape): string {
  const caught = shape.caught ?? 0;
  const missed = shape.missed ?? 0;
  const unviable = shape.unviable ?? 0;
  const timeout = shape.timeout ?? 0;
  const entries: unknown[] = [];
  const add = (summary: string, count: number): void => {
    for (let index = 0; index < count; index += 1) {
      const line = entries.length + 1;
      entries.push({
        scenario: {
          Mutant: {
            name: `src/lib.rs:${line}:1: replace f${line} -> i32 with 0`,
            package: "fixture",
            file: "src/lib.rs",
            replacement: "0",
            genre: "FnValue",
          },
        },
        summary,
        log_path: `log/src__lib.rs_line_${line}_col_1.log`,
        diff_path: `diff/src__lib.rs_line_${line}_col_1.diff`,
        phase_results: [],
      });
    }
  };
  add("CaughtMutant", caught);
  add("MissedMutant", missed);
  add("Unviable", unviable);
  add("Timeout", timeout);
  add("Success", shape.uncounted ?? 0);
  entries.splice(0, shape.dropped ?? 0);
  return JSON.stringify({
    outcomes: [
      {
        scenario: "Baseline",
        summary: "Success",
        log_path: "log/baseline.log",
        diff_path: null,
        phase_results: [],
      },
      ...entries,
    ],
    total_mutants: shape.generated ?? caught + missed + unviable + timeout,
    missed,
    caught,
    timeout,
    unviable,
    success: shape.uncounted ?? 0,
    cargo_mutants_version: DECLARED_VERSION,
  });
}

interface Scenario {
  readonly status: number;
  readonly results?: string;
  readonly baselineLog?: string;
}

const BASELINE_LOG_ASSERTION: string = [
  "running 1 test",
  "test t::t ... FAILED",
  "test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s",
  "*** result: Failure(101)",
  "",
].join("\n");
const BASELINE_LOG_MISSING_FILE: string = [
  "running 1 test",
  "test t::t ... FAILED",
  'called `Result::unwrap()` on an `Err` value: Os { code: 2, kind: NotFound, message: "No such file or directory" }',
  "*** result: Failure(101)",
  "",
].join("\n");

const SCENARIO_BY_CRATE: Readonly<Record<string, Scenario>> = {
  clean: { status: 0, results: outcomes({ caught: 4 }) },
  three: { status: 2, results: outcomes({ caught: 2, missed: 3 }) },
  many: { status: 2, results: outcomes({ caught: 1, missed: 25 }) },
  zero: { status: 0, results: outcomes({}) },
  sumoff: { status: 2, results: outcomes({ caught: 2, missed: 1, generated: 4, uncounted: 1 }) },
  entriesoff: { status: 2, results: outcomes({ caught: 2, missed: 1, dropped: 1 }) },
  slow: { status: 3, results: outcomes({ caught: 3, timeout: 2 }) },
  basered: { status: 4, baselineLog: BASELINE_LOG_ASSERTION },
  basemissing: { status: 4, baselineLog: BASELINE_LOG_MISSING_FILE },
  crash: { status: 70, results: outcomes({ caught: 4 }) },
  nojson: { status: 0 },
  badjson: { status: 0, results: "{" },
  alpha: { status: 0, results: outcomes({ caught: 4 }) },
  beta: { status: 0, results: outcomes({ caught: 4 }) },
};

for (const [crate, scenario] of Object.entries(SCENARIO_BY_CRATE)) {
  const directory = join(SCENARIOS, crate);
  mkdirSync(directory);
  writeFileSync(join(directory, "status"), `${scenario.status}\n`);
  if (scenario.results !== undefined) {
    writeFileSync(join(directory, "outcomes.json"), scenario.results);
  }
  if (scenario.baselineLog !== undefined) {
    writeFileSync(join(directory, "baseline.log"), scenario.baselineLog);
  }
}

// ------------------------------------------------------------ fixture workspaces

function git(repository: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

/** A committed Cargo workspace with one library crate per name. */
function newWorkspace(directoryName: string, crates: readonly string[]): string {
  const root = join(scratch, directoryName);
  mkdirSync(root);
  writeFileSync(
    join(root, "Cargo.toml"),
    `[workspace]\nresolver = "2"\nmembers = [${crates.map((crate) => `"${crate}"`).join(", ")}]\n`,
  );
  for (const crate of crates) {
    mkdirSync(join(root, crate, "src"), { recursive: true });
    writeFileSync(
      join(root, crate, "Cargo.toml"),
      `[package]\nname = "${crate}"\nversion = "0.1.0"\nedition = "2021"\n`,
    );
    writeFileSync(join(root, crate, "src", "lib.rs"), "pub fn two() -> i32 {\n    2\n}\n");
  }
  git(root, "init", "-q");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@t");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

const WORKSPACE: string = newWorkspace(
  "workspace",
  Object.keys(SCENARIO_BY_CRATE).filter((crate) => crate !== "alpha" && crate !== "beta"),
);
const TWO_MEMBERS: string = newWorkspace("two-members", ["alpha", "beta"]);
const NOT_A_WORKSPACE: string = join(scratch, "not-a-workspace");
mkdirSync(NOT_A_WORKSPACE);
/** A temporary directory INSIDE a repository, for the output-location refusal. */
const TEMPORARY_INSIDE: string = join(TWO_MEMBERS, "target-tmp");
mkdirSync(TEMPORARY_INSIDE);

// ------------------------------------------------------------------- gate copies

type Declaration = "matching" | "other-digest" | "other-version" | "other-platform";

let installed = 0;

/** A copy of the gate (or of a mutant of it) beside the declaration it will read. */
function installGate(source: string, declaration: Declaration): string {
  const directory = join(scratch, `gate-${installed++}`);
  mkdirSync(join(directory, "tools", "quality"), { recursive: true });
  mkdirSync(join(directory, "toolchains"));
  const path = join(directory, "tools", "quality", "check-mutation-rust.ts");
  writeFileSync(path, source);
  writeFileSync(
    join(directory, "toolchains", "cargo-mutants.json"),
    JSON.stringify({
      tool: "cargo-mutants",
      version: declaration === "other-version" ? "99.0.0" : DECLARED_VERSION,
      platforms: {
        [declaration === "other-platform" ? "plan9-mips" : PLATFORM_KEY]: {
          executableSha256: declaration === "other-digest" ? "0".repeat(64) : FAKE_DIGEST,
        },
      },
    }),
  );
  return path;
}

let mutants = 0;

/** The gate source with `from` replaced by `to`, exactly once. */
function mutantSource(from: string, to: string): string {
  const first = GATE_SOURCE.indexOf(from);
  if (from === to || first === -1 || GATE_SOURCE.indexOf(from, first + 1) !== -1) {
    throw new Error(`a no-op mutation needs exactly one occurrence of: ${from}`);
  }
  mutants += 1;
  return GATE_SOURCE.replace(from, () => to);
}

const GATES: Readonly<Record<Declaration, string>> = {
  matching: installGate(GATE_SOURCE, "matching"),
  "other-digest": installGate(GATE_SOURCE, "other-digest"),
  "other-version": installGate(GATE_SOURCE, "other-version"),
  "other-platform": installGate(GATE_SOURCE, "other-platform"),
};

// --------------------------------------------------------------------- execution

interface Run {
  readonly exit: number;
  readonly out: string;
  readonly err: string;
  /** One line per invocation of the stand-in, `--version` probes included. */
  readonly calls: readonly string[];
}

interface Case {
  readonly name: string;
  readonly args: readonly string[];
  readonly declaration?: Declaration;
  /** Variables set over the clean environment; `null` removes one. */
  readonly env?: Readonly<Record<string, string | null>>;
  readonly cwd?: string;
  /** The verdict the case pins. It must hold on the gate and fail on the mutant. */
  readonly holds: (run: Run) => boolean;
  /** The no-op: the decisive text of the gate, and what replaces it. */
  readonly mutation?: readonly [from: string, to: string];
}

/** The child environment is built from nothing but what cargo and git need. */
function cleanEnvironment(
  overrides: Readonly<Record<string, string | null>>,
): Record<string, string> {
  const environment: Record<string, string> = { LIBRE_AI_CARGO_MUTANTS: FAKE_BINARY };
  for (const key of ["PATH", "HOME", "CARGO_HOME", "RUSTUP_HOME"]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete environment[key];
    else environment[key] = value;
  }
  return environment;
}

function runGate(gate: string, c: Case): Run {
  rmSync(CALL_LOG, { force: true });
  const result = spawnSync(process.execPath, [gate, ...c.args], {
    cwd: c.cwd ?? scratch,
    env: cleanEnvironment(c.env ?? {}),
    encoding: "utf8",
  });
  const calls = existsSync(CALL_LOG)
    ? readFileSync(CALL_LOG, "utf8")
        .split("\n")
        .filter((line) => line !== "")
    : [];
  return { exit: result.status ?? -1, out: result.stdout, err: result.stderr, calls };
}

const describeRun = (run: Run): string =>
  `exit ${run.exit}\n--- stdout\n${run.out}--- stderr\n${run.err}--- calls\n${run.calls.join("\n")}`;

function prove(cases: readonly Case[]): void {
  test.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const declaration: Declaration = c.declaration ?? "matching";
    const original = runGate(GATES[declaration], c);
    if (!c.holds(original)) throw new Error(`does not hold on the gate:\n${describeRun(original)}`);
    if (c.mutation === undefined) return;

    const mutant = installGate(mutantSource(c.mutation[0], c.mutation[1]), declaration);
    const mutated = runGate(mutant, c);
    // A mutant that crashes proves the mutation broke the program, not that the case checks anything.
    if (/\b(?:TypeError|ReferenceError|SyntaxError)\b|\n\s+at /.test(mutated.err)) {
      throw new Error(
        `the mutant crashed instead of changing the verdict:\n${describeRun(mutated)}`,
      );
    }
    if (c.holds(mutated)) throw new Error(`still holds on the mutant:\n${describeRun(mutated)}`);
  });
}

const linesOf = (run: Run): string[] => run.out.split("\n").filter((line) => line !== "");
const has = (run: Run, ...lines: string[]): boolean =>
  lines.every((line) => linesOf(run).includes(line));
const mutationRuns = (run: Run): string[] =>
  run.calls.filter((call) => call.startsWith("mutants --manifest-path "));

/** Exit code and exact report lines. */
const reports =
  (exit: number, ...lines: string[]) =>
  (run: Run): boolean =>
    run.exit === exit && has(run, ...lines);

/** A configuration refusal: code 2, one cause line, and the stand-in never invoked. */
const refusesConfiguration =
  (cause: string, ...lines: string[]) =>
  (run: Run): boolean =>
    run.exit === 2 &&
    linesOf(run).filter((line) => line.startsWith("cause=")).length === 1 &&
    has(run, `cause=${cause}`, ...lines) &&
    run.calls.length === 0;

const root = (directory: string): string => `--root=${directory}`;
const WS: string = root(WORKSPACE);

// -------------------------------------------------------------------- cold start

// The first run that reaches `cargo metadata` on a CI runner is slow, and it
// used to be paid by a test, inside the 5 000 ms limit of the test runner: the
// verdict then measured the runner, not the gate. It is paid here instead, at
// module level, where no test limit applies, by the command the gate runs and
// in the environment the gate gets. Any test whose gate or mutant reaches cargo
// can be the first one to do so, under a name filter: this is not the affair of
// the first test of the file alone.
//
// Measured on 2026-11-20. On the `Bun quality` job logs of the 60 latest `ci`
// runs, 59 of which hold this file: the first test took 123.84 ms to
// 5 007.32 ms and was killed at the limit 4 times; a later test of the same
// shape (one gate run, one `cargo metadata`) took 34.77 ms to 69.22 ms. In the
// red logs the tests that follow stayed slow when their run reached cargo,
// while a run that stops before cargo, in between, took 31.54 ms. The longest
// cold start (run 44732494384, attempt 1) outlasted three tests killed at the
// limit and ended in a fourth, after 3 357.34 ms. Behind a cargo that logs its
// invocations, 40 of the 50 tests of this file, run one by one, reach it.
//
// The limit below is for a cargo that never answers: a named failure of this
// file, not a job that hangs. It is large against the longest cold start above.
// The line printed gives the duration of each run: read it before these figures
// are trusted again.
const COLD_START_LIMIT_MS = 120_000;

const coldStartBegin: number = performance.now();
const coldStart = spawnSync(
  "cargo",
  [
    "metadata",
    "--no-deps",
    "--format-version",
    "1",
    "--manifest-path",
    join(WORKSPACE, "Cargo.toml"),
  ],
  { cwd: WORKSPACE, env: cleanEnvironment({}), encoding: "utf8", timeout: COLD_START_LIMIT_MS },
);
if (coldStart.status !== 0) {
  const reason =
    coldStart.error?.message ?? (coldStart.stderr.trim() || `exit ${coldStart.status}`);
  throw new Error(
    `the first cargo metadata failed on the fixture workspace (limit ${COLD_START_LIMIT_MS} ms): ${reason}`,
  );
}
console.warn(
  `check-mutation-rust.test: first cargo metadata answered in ${Math.round(performance.now() - coldStartBegin)} ms (limit ${COLD_START_LIMIT_MS} ms)`,
);

// ------------------------------------------------------------------------- cases

describe("the proof harness", () => {
  test("the stand-in is the binary the matching declaration names", () => {
    const run = runGate(GATES.matching, {
      name: "probe",
      args: [WS, "--crates=clean", "--max-missed=0"],
      holds: () => true,
    });
    expect(run.exit).toBe(0);
    expect(run.calls[0]).toBe("mutants --version");
    expect(mutationRuns(run).length).toBe(1);
  });

  test("an ambient variable does not reach the gate", () => {
    process.env.AMBIENT_PROBE = "inherited";
    const environment = cleanEnvironment({});
    delete process.env.AMBIENT_PROBE;
    expect(Object.keys(environment)).not.toContain("AMBIENT_PROBE");
  });
});

describe("configuration is validated before anything is launched", () => {
  prove([
    {
      name: "no threshold at all: threshold-missing, the tool is never invoked",
      args: [WS, "--crates=clean"],
      holds: refusesConfiguration("threshold-missing", "detail=clean"),
      mutation: ["if (threshold === undefined) {", "if (false) {"],
    },
    {
      name: "a map that covers another crate only: threshold-missing names the uncovered crate",
      args: [WS, "--crates=clean three", "--max-missed-by-crate=three=5"],
      holds: refusesConfiguration("threshold-missing", "detail=clean"),
    },
    ...["-1", "1.5", "abc"].map(
      (value): Case => ({
        name: `--max-missed=${value}: max-missed-not-integer`,
        args: [WS, "--crates=clean", `--max-missed=${value}`],
        holds: refusesConfiguration("max-missed-not-integer", `detail=${value}`),
        mutation: ['if (rawMaxMissed !== "" && !INTEGER.test(rawMaxMissed)) {', "if (false) {"],
      }),
    ),
    {
      name: "an empty list: crates-missing",
      args: [WS, "--crates= ", "--max-missed=0"],
      holds: refusesConfiguration("crates-missing"),
      mutation: ["if (crates.length === 0) {", "if (false) {"],
    },
    {
      name: "no --crates at all: crates-missing",
      args: [WS, "--max-missed=0"],
      holds: refusesConfiguration("crates-missing"),
    },
    {
      name: "the same crate twice in the list: crate-duplicate",
      args: [WS, "--crates=clean three clean", "--max-missed=0"],
      holds: refusesConfiguration("crate-duplicate"),
      mutation: ["if (new Set(crates).size !== crates.length) {", "if (false) {"],
    },
    {
      name: "the same crate twice in the map: map-duplicate",
      args: [WS, "--crates=clean", "--max-missed-by-crate=clean=1 clean=2"],
      holds: refusesConfiguration("map-duplicate", "detail=clean"),
      mutation: ["if (own.has(name)) {", "if (false) {"],
    },
    {
      name: "a map naming a crate that is not evaluated: map-names-unevaluated, the name quoted",
      args: [WS, "--crates=clean", "--max-missed=0", "--max-missed-by-crate=ghost=1"],
      holds: refusesConfiguration("map-names-unevaluated", "detail=ghost"),
      mutation: ["if (!crates.includes(name)) {", "if (false) {"],
    },
    ...["clean", "clean=x", "clean=-1", "=3"].map(
      (element): Case => ({
        name: `map element '${element}': map-malformed`,
        args: [WS, "--crates=clean", "--max-missed=0", `--max-missed-by-crate=${element}`],
        holds: refusesConfiguration("map-malformed", `detail=${element}`),
        mutation: ["if (separator < 1 || !INTEGER.test(value)) {", "if (false) {"],
      }),
    ),
    {
      name: "an option that is not recognised: argument-unknown",
      args: [WS, "--crates=clean", "--max-missed=0", "--bogus=1"],
      holds: refusesConfiguration("argument-unknown", "detail=--bogus=1"),
      mutation: ['return { cause: "argument-unknown", detail: argument };', "continue;"],
    },
  ]);
});

describe("the tool must be the declared one", () => {
  prove([
    {
      name: "LIBRE_AI_CARGO_MUTANTS absent: code 3, nothing invoked",
      args: [WS, "--crates=clean", "--max-missed=0"],
      env: { LIBRE_AI_CARGO_MUTANTS: null },
      holds: (run) =>
        reports(3, "cause=tool-unavailable", "generated=unavailable", "verdict=fail")(run) &&
        run.calls.length === 0,
    },
    {
      name: "a relative path, even to the right binary: code 3",
      args: [WS, "--crates=clean", "--max-missed=0"],
      env: { LIBRE_AI_CARGO_MUTANTS: "./cargo-mutants" },
      cwd: FAKE_DIRECTORY,
      holds: (run) => reports(3, "cause=tool-unavailable")(run) && run.calls.length === 0,
      mutation: ["if (!isAbsolute(declared)) {", "if (false) {"],
    },
    {
      name: "a binary whose digest differs from the declaration: code 3, not even probed",
      args: [WS, "--crates=clean", "--max-missed=0"],
      declaration: "other-digest",
      holds: (run) => reports(3, "cause=tool-unavailable")(run) && run.calls.length === 0,
      mutation: ["if (actualDigest !== declaredDigest) {", "if (false) {"],
    },
    {
      name: "a platform the declaration does not publish: code 3",
      args: [WS, "--crates=clean", "--max-missed=0"],
      declaration: "other-platform",
      holds: (run) =>
        reports(3, "cause=tool-unavailable")(run) &&
        run.out.includes(`no binary is declared for ${PLATFORM_KEY}`) &&
        run.calls.length === 0,
    },
    {
      name: "a binary that reports another version: code 3, no mutation run",
      args: [WS, "--crates=clean", "--max-missed=0"],
      declaration: "other-version",
      holds: (run) =>
        reports(3, "cause=tool-unavailable", "version=99.0.0")(run) &&
        mutationRuns(run).length === 0,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the text of the gate, not a template
      mutation: ["if (reportedVersion !== `${TOOL} ${version}`) {", "if (false) {"],
    },
  ]);

  test("the gate holds no download: no fetch call and no URL", () => {
    expect(GATE_SOURCE).not.toMatch(/\bfetch\s*\(|https?:\/\//);
  });
});

describe("one crate: the report and the code of the crate", () => {
  const single = (run: Run): boolean => linesOf(run).every((line) => !line.startsWith("["));

  prove([
    {
      name: "a green crate: code 0, the keys in the fixed order, no prefix",
      args: [WS, "--crates=clean", "--max-missed=0"],
      holds: (run) =>
        run.exit === 0 &&
        linesOf(run).join("\n") ===
          [
            "tool=cargo-mutants",
            `version=${DECLARED_VERSION}`,
            "crate=clean",
            "generated=4",
            "caught=4",
            "missed=0",
            "unviable=0",
            "timeout=0",
            "threshold=0",
            "cause=pass",
            "verdict=pass",
          ].join("\n"),
      mutation: ["const several = crates.length > 1;", "const several = true;"],
    },
    {
      name: "a crate that is not a member: code 4, both members listed",
      args: [root(TWO_MEMBERS), "--crates=gamma", "--max-missed=0"],
      holds: (run) =>
        reports(
          4,
          "cause=crate-unknown",
          "detail=not a member of the workspace; members: alpha beta",
        )(run) && mutationRuns(run).length === 0,
      mutation: ["} else if (!members.names.includes(crate)) {", "} else if (false) {"],
    },
    {
      name: "a glob character is a literal crate name: code 4, no expansion",
      args: [root(TWO_MEMBERS), "--crates=*", "--max-missed=0"],
      holds: (run) =>
        reports(4, "crate=*", "cause=crate-unknown")(run) && mutationRuns(run).length === 0,
    },
    {
      name: "a root that is not a Cargo workspace: code 10",
      args: [root(NOT_A_WORKSPACE), "--crates=clean", "--max-missed=0"],
      holds: (run) => reports(10, "cause=tool-error")(run) && mutationRuns(run).length === 0,
      mutation: ["} else if (!members.readable) {", "} else if (false) {"],
    },
    {
      name: "red tests in the unmutated tree: code 5, no prefix",
      args: [WS, "--crates=basered", "--max-missed=0"],
      holds: (run) => reports(5, "cause=baseline-red", "generated=unavailable")(run) && single(run),
      mutation: ["if (status === BASELINE_FAILED_STATUS) {", "if (false) {"],
    },
    {
      name: "red tests in the unmutated tree and a missing file in the baseline log: code 6",
      args: [WS, "--crates=basemissing", "--max-missed=0"],
      holds: reports(6, "cause=baseline-red-untracked-fixture"),
      mutation: [
        'MISSING_FILE.test(readBaselineLog(join(results, "log", "baseline.log")))',
        "false",
      ],
    },
    {
      name: "zero generated mutant: code 7, never 0",
      args: [WS, "--crates=zero", "--max-missed=0"],
      holds: reports(7, "generated=0", "cause=zero-mutants", "verdict=fail"),
      mutation: ["if (generated === 0) {", "if (false) {"],
    },
    {
      name: "missed equal to the threshold: code 0",
      args: [WS, "--crates=three", "--max-missed=3"],
      holds: reports(0, "missed=3", "threshold=3", "cause=pass"),
    },
    {
      name: "missed one above the threshold: code 8, no prefix",
      args: [WS, "--crates=three", "--max-missed=2"],
      holds: (run) =>
        reports(8, "missed=3", "threshold=2", "cause=missed-above-threshold")(run) &&
        linesOf(run).filter((line) => line.startsWith("survivor=")).length === 3 &&
        single(run),
      mutation: ["if (missed > threshold) {", "if (false) {"],
    },
    {
      name: "25 survivors: at most 20 are printed",
      args: [WS, "--crates=many", "--max-missed=24"],
      holds: (run) =>
        reports(8, "missed=25")(run) &&
        linesOf(run).filter((line) => line.startsWith("survivor=")).length === 20,
      mutation: ["survivors.slice(0, SURVIVOR_LIMIT),", "survivors,"],
    },
    {
      name: "counters that do not sum to generated: code 9",
      args: [WS, "--crates=sumoff", "--max-missed=5"],
      holds: reports(9, "generated=4", "caught=2", "missed=1", "cause=counters-incoherent"),
      mutation: ["if (caught + missed + unviable + timeout !== generated) {", "if (false) {"],
    },
    {
      name: "generated that differs from the number of result entries: code 9",
      args: [WS, "--crates=entriesoff", "--max-missed=5"],
      holds: reports(9, "generated=3", "cause=counters-incoherent"),
      mutation: ["if (generated !== entries) {", "if (false) {"],
    },
    {
      name: "timeouts are reported and do not fail: code 0, timeout=2",
      args: [WS, "--crates=slow", "--max-missed=0"],
      holds: reports(0, "generated=5", "caught=3", "timeout=2", "cause=pass"),
    },
    {
      name: "an exit status of the tool that is not a complete run: code 10",
      args: [WS, "--crates=crash", "--max-missed=0"],
      holds: reports(10, "cause=tool-error", "detail=cargo-mutants exited 70"),
      mutation: ["if (!COMPLETED_STATUSES.includes(status)) {", "if (false) {"],
    },
    {
      name: "no results file: code 10",
      args: [WS, "--crates=nojson", "--max-missed=0"],
      holds: reports(10, "cause=tool-error", "generated=unavailable"),
      mutation: ["if (!readable) {", "if (false) {"],
    },
    {
      name: "a results file that is not JSON: code 10",
      args: [WS, "--crates=badjson", "--max-missed=0"],
      holds: reports(10, "cause=tool-error"),
    },
    {
      name: "the map wins over the global threshold",
      args: [WS, "--crates=three", "--max-missed=0", "--max-missed-by-crate=three=5"],
      holds: reports(0, "missed=3", "threshold=5", "cause=pass"),
      mutation: ["const threshold = own.get(crate) ?? (", "const threshold = ("],
    },
    {
      name: "an empty optional flag is the flag left out",
      args: [
        WS,
        "--crates=clean",
        "--max-missed=0",
        "--max-missed-by-crate=",
        "--timeout=",
        "--file=",
      ],
      holds: (run) =>
        reports(0, "cause=pass")(run) &&
        mutationRuns(run).every((call) => !call.includes("--timeout") && !call.includes("--file")),
    },
    {
      name: "--file and --timeout are handed to the tool as they are",
      args: [
        WS,
        "--crates=clean",
        "--max-missed=0",
        "--file=src/a.rs",
        "--file=src/b *.rs",
        "--timeout=90",
      ],
      holds: (run) =>
        run.exit === 0 &&
        mutationRuns(run).length === 1 &&
        (mutationRuns(run)[0] ?? "").endsWith(
          "--colors never --file src/a.rs --file src/b *.rs --timeout 90",
        ),
    },
  ]);
});

describe("the repository is never written", () => {
  test("after a run the fixture is unchanged and the output directory is outside the root", () => {
    const run = runGate(GATES.matching, {
      name: "probe",
      args: [WS, "--crates=three", "--max-missed=5"],
      holds: () => true,
    });
    expect(run.exit).toBe(0);
    expect(git(WORKSPACE, "status", "--porcelain")).toBe("");
    const call = mutationRuns(run)[0] ?? "";
    const output = /--output (\S+)/.exec(call)?.[1] ?? "";
    expect(isAbsolute(output)).toBe(true);
    expect(relative(WORKSPACE, output).startsWith("..")).toBe(true);
    // The directory handed to the tool is removed once the crate is judged.
    expect(existsSync(output)).toBe(false);
  });

  prove([
    {
      name: "a temporary directory inside the repository: code 10, the tool is not run",
      args: [root(TWO_MEMBERS), "--crates=alpha", "--max-missed=0"],
      env: { TMPDIR: TEMPORARY_INSIDE },
      holds: (run) => reports(10, "cause=tool-error")(run) && mutationRuns(run).length === 0,
      mutation: ["if (isInside(root, scratch)) {", "if (false) {"],
    },
  ]);
});

describe("several crates: all evaluated, then one verdict", () => {
  const table = (run: Run): string[] => {
    const lines = linesOf(run);
    return lines.slice(lines.indexOf("crate | code | cause"));
  };
  const allPrefixed = (run: Run): boolean => {
    const lines = linesOf(run);
    const detail = lines.slice(0, lines.indexOf("crate | code | cause"));
    return detail.length > 0 && detail.every((line) => /^\[(clean|three|slow|many)\] /.test(line));
  };

  prove([
    {
      name: "three crates, one above its threshold: table of three, evaluated=3 failed=1, code 1",
      args: [WS, "--crates=three clean slow", "--max-missed=2"],
      holds: (run) =>
        run.exit === 1 &&
        table(run).join("\n") ===
          [
            "crate | code | cause",
            "three | 8 | missed-above-threshold",
            "clean | 0 | pass",
            "slow | 0 | pass",
            "evaluated=3 failed=1",
          ].join("\n") &&
        allPrefixed(run) &&
        has(run, "[three] cause=missed-above-threshold", "[slow] timeout=2") &&
        mutationRuns(run).length === 3,
      mutation: ["return failed > 0 ? 1 : 0;", "return 0;"],
    },
    {
      name: "every detail line carries the prefix of its crate",
      args: [WS, "--crates=three clean slow", "--max-missed=2"],
      holds: allPrefixed,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the text of the gate, not a template
      mutation: ["console.log(several ? `[${crate}] ${line}` : line);", "console.log(line);"],
    },
    {
      name: "all green: code 0, evaluated=2 failed=0",
      args: [WS, "--crates=clean slow", "--max-missed=0"],
      holds: (run) => run.exit === 0 && has(run, "evaluated=2 failed=0"),
    },
    {
      name: "a crate outside the map falls back on the global threshold",
      args: [WS, "--crates=many three", "--max-missed=0", "--max-missed-by-crate=many=30"],
      holds: (run) =>
        run.exit === 1 &&
        has(
          run,
          "[many] threshold=30",
          "[many] cause=pass",
          "[three] threshold=0",
          "[three] cause=missed-above-threshold",
          "evaluated=2 failed=1",
        ),
    },
    {
      name: "an undeclared tool: every crate is listed at code 3, code 1",
      args: [WS, "--crates=clean slow", "--max-missed=0"],
      env: { LIBRE_AI_CARGO_MUTANTS: null },
      holds: (run) =>
        run.exit === 1 &&
        has(
          run,
          "clean | 3 | tool-unavailable",
          "slow | 3 | tool-unavailable",
          "evaluated=2 failed=2",
        ) &&
        run.calls.length === 0,
    },
  ]);
});

describe("the proof is not vacuous", () => {
  // Counted after every `prove` above has registered its cases: the tests of
  // this file run in order, so this one sees the mutants they built.
  test("every mutation was applied, once each", () => {
    expect(mutants).toBe(32);
  });
});
