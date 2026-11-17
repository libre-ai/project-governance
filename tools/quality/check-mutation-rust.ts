// SPDX-FileCopyrightText: 2026 Libre AI contributors
// SPDX-License-Identifier: EUPL-1.2
//
// Rust mutation gate, per crate, with an explicit survivor threshold.
//
// Usage, from the governance tooling directory:
//   bun tools/quality/check-mutation-rust.ts --root=<dir> --crates="<c1> [c2 ...]" \
//     [--max-missed=<N>] [--max-missed-by-crate="<c>=<N> ..."] [--file=<path>]... [--timeout=<s>]
//
// What it refuses to do, each being a way a hand-written mutation job went
// green over nothing:
//   - no default threshold: a crate with neither a threshold of its own nor a
//     global one is a configuration error, and nothing is launched;
//   - zero generated mutant is a failure, never a pass;
//   - the counters are read from the JSON results of the tool, never from its
//     text, and they must sum to the number of mutants it generated;
//   - every listed crate is evaluated, so a first red crate cannot hide the next.
//
// Where the binary comes from: LIBRE_AI_CARGO_MUTANTS names it, and it must
// match toolchains/cargo-mutants.json of this package (executable digest, then
// reported version). There is no fallback: this script never downloads and
// never builds the tool, since a binary resolved against a mutable registry
// would change the enforcing tool between two runs of the same commit.
//
// The repository under --root is never written: the tool gets an output
// directory under the system temporary directory, checked to be outside the
// root, and tests mutants in its own copy of the tree.
//
// Standard output holds `key=value` lines only; the text of the tool goes to
// standard error. Exit codes — one crate listed: the code of that crate (0, 3
// to 10) or 2; several crates: 0, 1 (at least one crate is not green) or 2.
//
// Field names and exit statuses below were read on cargo-mutants 27.1.0, the
// declared version, by running it: `outcomes.json` carries `total_mutants`,
// `caught`, `missed`, `unviable`, `timeout` and one `outcomes` entry per
// scenario (the baseline, then one per mutant); the process exits 4 when the
// tests fail in the unmutated tree, 2 on missed mutants, 3 on timeouts.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const TOOL = "cargo-mutants";
const PROVIDED_BINARY_ENV = "LIBRE_AI_CARGO_MUTANTS";
/** The declaration shipped with this package (`toolchains` is in `files`). */
const POLICY_PATH = resolve(import.meta.dir, "..", "..", "toolchains", "cargo-mutants.json");

const INTEGER = /^\d+$/;
const MISSING_FILE = /No such file/;
const SURVIVOR_LIMIT = 20;
/** Exit status of the tool when the tests fail in the unmutated tree. */
const BASELINE_FAILED_STATUS = 4;
/** Exit statuses after which the results describe a complete run: clean, missed mutants, timeouts. */
const COMPLETED_STATUSES: readonly number[] = [0, 2, 3];
const UNAVAILABLE = "unavailable";

type ConfigurationCause =
  | "crates-missing"
  | "crate-duplicate"
  | "max-missed-not-integer"
  | "map-malformed"
  | "map-duplicate"
  | "map-names-unevaluated"
  | "threshold-missing"
  | "argument-unknown";

type CrateCause =
  | "pass"
  | "tool-unavailable"
  | "crate-unknown"
  | "baseline-red"
  | "baseline-red-untracked-fixture"
  | "zero-mutants"
  | "missed-above-threshold"
  | "counters-incoherent"
  | "tool-error";

const CRATE_CODES: Readonly<Record<CrateCause, number>> = {
  pass: 0,
  "tool-unavailable": 3,
  "crate-unknown": 4,
  "baseline-red": 5,
  "baseline-red-untracked-fixture": 6,
  "zero-mutants": 7,
  "missed-above-threshold": 8,
  "counters-incoherent": 9,
  "tool-error": 10,
};

interface Configuration {
  readonly root: string;
  readonly crates: readonly string[];
  /** One threshold per listed crate: its own, else the global one. */
  readonly thresholds: ReadonlyMap<string, number>;
  readonly files: readonly string[];
  readonly timeout: string;
}

interface ConfigurationError {
  readonly cause: ConfigurationCause;
  readonly detail: string;
}

interface Counters {
  readonly generated: number;
  readonly caught: number;
  readonly missed: number;
  readonly unviable: number;
  readonly timeout: number;
}

interface CrateVerdict {
  readonly crate: string;
  readonly cause: CrateCause;
  readonly detail: string;
  readonly counters: Counters | null;
  readonly survivors: readonly string[];
}

interface Results {
  readonly readable: boolean;
  readonly counters: Counters;
  /** Number of mutant entries of the results, the baseline entry excluded. */
  readonly entries: number;
  readonly survivors: readonly string[];
}

const NO_COUNTERS: Counters = { generated: 0, caught: 0, missed: 0, unviable: 0, timeout: 0 };
const UNREADABLE_RESULTS: Results = {
  readable: false,
  counters: NO_COUNTERS,
  entries: 0,
  survivors: [],
};

const isConfigurationError = (
  value: Configuration | ConfigurationError,
): value is ConfigurationError => "cause" in value;

/**
 * Validate everything before anything is launched. An empty value of an
 * optional flag is the flag left out: the workflow template forwards its
 * optional inputs as they are, and an input left out arrives empty.
 */
function parseConfiguration(
  argv: readonly string[],
  defaultRoot: string,
): Configuration | ConfigurationError {
  let root = defaultRoot;
  let rawCrates = "";
  let rawMaxMissed = "";
  let rawMap = "";
  let timeout = "";
  const files: string[] = [];
  for (const argument of argv) {
    if (argument.startsWith("--root=")) {
      root = resolve(argument.slice("--root=".length));
    } else if (argument.startsWith("--crates=")) {
      rawCrates = argument.slice("--crates=".length);
    } else if (argument.startsWith("--max-missed=")) {
      rawMaxMissed = argument.slice("--max-missed=".length);
    } else if (argument.startsWith("--max-missed-by-crate=")) {
      rawMap = argument.slice("--max-missed-by-crate=".length);
    } else if (argument.startsWith("--file=")) {
      const file = argument.slice("--file=".length);
      if (file !== "") files.push(file);
    } else if (argument.startsWith("--timeout=")) {
      timeout = argument.slice("--timeout=".length);
    } else {
      return { cause: "argument-unknown", detail: argument };
    }
  }

  // The list is split on white space and nothing else: an element is a crate
  // name taken literally, never a pattern.
  const crates = rawCrates.split(/\s+/).filter((name) => name !== "");
  if (crates.length === 0) {
    return { cause: "crates-missing", detail: "--crates names no crate" };
  }
  if (new Set(crates).size !== crates.length) {
    return { cause: "crate-duplicate", detail: crates.join(" ") };
  }
  if (rawMaxMissed !== "" && !INTEGER.test(rawMaxMissed)) {
    return { cause: "max-missed-not-integer", detail: rawMaxMissed };
  }

  const own = new Map<string, number>();
  for (const element of rawMap.split(/\s+/).filter((item) => item !== "")) {
    const separator = element.lastIndexOf("=");
    const name = element.slice(0, Math.max(separator, 0));
    const value = element.slice(separator + 1);
    if (separator < 1 || !INTEGER.test(value)) {
      return { cause: "map-malformed", detail: element };
    }
    if (own.has(name)) {
      return { cause: "map-duplicate", detail: name };
    }
    if (!crates.includes(name)) {
      return { cause: "map-names-unevaluated", detail: name };
    }
    own.set(name, Number(value));
  }

  const thresholds = new Map<string, number>();
  for (const crate of crates) {
    const threshold = own.get(crate) ?? (rawMaxMissed === "" ? undefined : Number(rawMaxMissed));
    if (threshold === undefined) {
      return { cause: "threshold-missing", detail: crate };
    }
    thresholds.set(crate, threshold);
  }
  return { root, crates, thresholds, files, timeout };
}

interface Tool {
  /** Absolute path of the verified binary, or "" when it is not usable. */
  readonly binary: string;
  /** The declared version, or `unavailable` when the declaration is unreadable. */
  readonly version: string;
  /** Why the binary is not usable; "" when it is. */
  readonly refusal: string;
}

/**
 * The binary named by LIBRE_AI_CARGO_MUTANTS, verified against the
 * declaration: executable digest for this platform, then reported version.
 * Nothing is substituted when one of them differs.
 */
function verifyTool(environment: Readonly<Record<string, string | undefined>>): Tool {
  let version = UNAVAILABLE;
  let declaredDigest = "";
  try {
    const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8")) as {
      readonly tool?: unknown;
      readonly version?: unknown;
      readonly platforms?: Readonly<Record<string, { readonly executableSha256?: unknown }>>;
    };
    if (policy.tool !== TOOL || typeof policy.version !== "string") {
      return { binary: "", version, refusal: `toolchains/${TOOL}.json does not declare ${TOOL}` };
    }
    version = policy.version;
    const digest = policy.platforms?.[`${process.platform}-${process.arch}`]?.executableSha256;
    declaredDigest = typeof digest === "string" ? digest : "";
  } catch (error) {
    return {
      binary: "",
      version,
      refusal: `toolchains/${TOOL}.json is unreadable: ${(error as Error).message}`,
    };
  }

  const declared = environment[PROVIDED_BINARY_ENV] ?? "";
  // A relative path would be resolved against the working directory, which is
  // not where the binary was installed and verified.
  if (!isAbsolute(declared)) {
    return {
      binary: "",
      version,
      refusal: `${PROVIDED_BINARY_ENV} must be the absolute path of the binary, got '${declared}'`,
    };
  }
  let actualDigest: string;
  try {
    actualDigest = createHash("sha256").update(readFileSync(declared)).digest("hex");
  } catch (error) {
    return {
      binary: "",
      version,
      refusal: `${PROVIDED_BINARY_ENV} names ${declared}, which cannot be read: ${(error as Error).message}`,
    };
  }
  if (actualDigest !== declaredDigest) {
    const expected =
      declaredDigest === ""
        ? `no binary is declared for ${process.platform}-${process.arch}`
        : `declared ${declaredDigest}`;
    return {
      binary: "",
      version,
      refusal: `executable digest mismatch: ${expected}, got ${actualDigest}`,
    };
  }
  // The binary is a cargo subcommand: its first argument is always `mutants`,
  // and a bare `--version` is refused (measured on the declared version).
  const reported = spawnSync(declared, ["mutants", "--version"], { encoding: "utf8" });
  const reportedVersion = reported.status === 0 ? reported.stdout.trim() : "";
  if (reportedVersion !== `${TOOL} ${version}`) {
    return {
      binary: "",
      version,
      refusal: `the binary reports '${reportedVersion}', the declaration says '${TOOL} ${version}'`,
    };
  }
  return { binary: declared, version, refusal: "" };
}

interface Members {
  readonly readable: boolean;
  readonly names: readonly string[];
  readonly detail: string;
}

/** The workspace members, from `cargo metadata` read as JSON. */
function workspaceMembers(root: string): Members {
  const metadata = spawnSync(
    "cargo",
    ["metadata", "--no-deps", "--format-version", "1", "--manifest-path", join(root, "Cargo.toml")],
    // From the root: the toolchain file that rustup honours is the one of the
    // repository examined, not the one of the directory this script runs from.
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (metadata.error !== undefined || metadata.status !== 0) {
    const reason = metadata.error?.message ?? metadata.stderr.trim();
    return { readable: false, names: [], detail: `cargo metadata failed: ${reason}` };
  }
  try {
    const parsed = JSON.parse(metadata.stdout) as {
      readonly packages?: readonly { readonly name?: unknown }[];
    };
    const names = (parsed.packages ?? [])
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string")
      .sort();
    return { readable: true, names, detail: "" };
  } catch (error) {
    return {
      readable: false,
      names: [],
      detail: `cargo metadata is not JSON: ${(error as Error).message}`,
    };
  }
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** The results file of the tool; a missing or malformed file is `readable: false`. */
function readResults(path: string): Results {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      readonly total_mutants?: unknown;
      readonly caught?: unknown;
      readonly missed?: unknown;
      readonly unviable?: unknown;
      readonly timeout?: unknown;
      readonly outcomes?: unknown;
    };
    const { total_mutants: generated, caught, missed, unviable, timeout, outcomes } = parsed;
    if (
      !isCount(generated) ||
      !isCount(caught) ||
      !isCount(missed) ||
      !isCount(unviable) ||
      !isCount(timeout) ||
      !Array.isArray(outcomes)
    ) {
      return UNREADABLE_RESULTS;
    }
    const mutants = (
      outcomes as readonly { readonly scenario?: unknown; readonly summary?: unknown }[]
    ).filter(
      (outcome) =>
        typeof outcome === "object" &&
        outcome !== null &&
        typeof outcome.scenario === "object" &&
        outcome.scenario !== null &&
        "Mutant" in outcome.scenario,
    );
    const survivors = mutants
      .filter((outcome) => outcome.summary === "MissedMutant")
      .map((outcome) => {
        const mutant = (outcome.scenario as { readonly Mutant?: { readonly name?: unknown } })
          .Mutant;
        return typeof mutant?.name === "string" ? mutant.name : "unnamed mutant";
      });
    return {
      readable: true,
      counters: { generated, caught, missed, unviable, timeout },
      entries: mutants.length,
      survivors,
    };
  } catch {
    return UNREADABLE_RESULTS;
  }
}

function readBaselineLog(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    // Without its log a red baseline stays a red baseline; only the finer
    // "a file is missing" diagnosis is lost.
    return "";
  }
}

function evaluateCrate(
  crate: string,
  threshold: number,
  configuration: Configuration,
  binary: string,
  output: string,
): CrateVerdict {
  const verdict = (
    cause: CrateCause,
    detail: string,
    counters: Counters | null = null,
    survivors: readonly string[] = [],
  ): CrateVerdict => ({ crate, cause, detail, counters, survivors });

  const run = spawnSync(
    binary,
    [
      "mutants",
      "--manifest-path",
      join(configuration.root, "Cargo.toml"),
      "--package",
      crate,
      "--output",
      output,
      "--colors",
      "never",
      ...configuration.files.flatMap((file) => ["--file", file]),
      ...(configuration.timeout === "" ? [] : ["--timeout", configuration.timeout]),
    ],
    // The text of the tool goes to standard error: standard output is the
    // `key=value` report and nothing else.
    { cwd: configuration.root, stdio: ["ignore", 2, 2] },
  );
  const status = run.status ?? -1;
  const results = join(output, "mutants.out");

  if (status === BASELINE_FAILED_STATUS) {
    const untracked = MISSING_FILE.test(readBaselineLog(join(results, "log", "baseline.log")));
    return untracked
      ? verdict(
          "baseline-red-untracked-fixture",
          "the tests fail in the unmutated tree and the baseline log names a missing file: a fixture the copied tree does not hold",
        )
      : verdict("baseline-red", "the tests fail in the unmutated tree");
  }
  if (!COMPLETED_STATUSES.includes(status)) {
    return verdict(
      "tool-error",
      run.error === undefined ? `${TOOL} exited ${status}` : run.error.message,
    );
  }
  const { readable, counters, entries, survivors } = readResults(join(results, "outcomes.json"));
  if (!readable) {
    return verdict("tool-error", "the results file outcomes.json is missing or unreadable");
  }
  const { generated, caught, missed, unviable, timeout } = counters;
  if (caught + missed + unviable + timeout !== generated) {
    return verdict(
      "counters-incoherent",
      `caught + missed + unviable + timeout = ${caught + missed + unviable + timeout}, generated = ${generated}`,
      counters,
    );
  }
  if (generated !== entries) {
    return verdict(
      "counters-incoherent",
      `generated = ${generated}, the results hold ${entries} mutant entries`,
      counters,
    );
  }
  if (generated === 0) {
    return verdict("zero-mutants", "the tool generated no mutant for this crate", counters);
  }
  if (missed > threshold) {
    return verdict(
      "missed-above-threshold",
      `${missed} survivor(s), threshold ${threshold}`,
      counters,
      survivors.slice(0, SURVIVOR_LIMIT),
    );
  }
  return verdict("pass", "", counters);
}

/** The report of one crate, in the fixed key order. */
function reportLines(verdict: CrateVerdict, version: string, threshold: number): string[] {
  const count = (key: keyof Counters): string =>
    verdict.counters === null ? UNAVAILABLE : String(verdict.counters[key]);
  return [
    `tool=${TOOL}`,
    `version=${version}`,
    `crate=${verdict.crate}`,
    `generated=${count("generated")}`,
    `caught=${count("caught")}`,
    `missed=${count("missed")}`,
    `unviable=${count("unviable")}`,
    `timeout=${count("timeout")}`,
    `threshold=${threshold}`,
    `cause=${verdict.cause}`,
    ...(verdict.detail === "" ? [] : [`detail=${verdict.detail}`]),
    ...verdict.survivors.map((survivor) => `survivor=${survivor}`),
    `verdict=${verdict.cause === "pass" ? "pass" : "fail"}`,
  ];
}

/** True when `directory` is `root` or inside it, symbolic links resolved. */
function isInside(root: string, directory: string): boolean {
  const path = relative(realpathSync(root), realpathSync(directory));
  return !path.startsWith("..") && !isAbsolute(path);
}

function main(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): number {
  const configuration = parseConfiguration(argv, process.cwd());
  if (isConfigurationError(configuration)) {
    console.log(`cause=${configuration.cause}`);
    console.log(`detail=${configuration.detail}`);
    console.log("verdict=fail");
    return 2;
  }
  const { root, crates, thresholds } = configuration;
  const several = crates.length > 1;

  const tool = verifyTool(environment);
  const members: Members =
    tool.refusal === "" ? workspaceMembers(root) : { readable: false, names: [], detail: "" };

  const scratch = mkdtempSync(join(tmpdir(), "mutation-rust-"));
  const verdicts: CrateVerdict[] = [];
  try {
    let outputRefusal = "";
    try {
      if (isInside(root, scratch)) {
        outputRefusal = `the output directory ${scratch} is inside the repository ${root}`;
      }
    } catch (error) {
      outputRefusal = `the repository root cannot be resolved: ${(error as Error).message}`;
    }
    for (const [index, crate] of crates.entries()) {
      const threshold = thresholds.get(crate) as number;
      let verdict: CrateVerdict;
      if (tool.refusal !== "") {
        verdict = {
          crate,
          cause: "tool-unavailable",
          detail: tool.refusal,
          counters: null,
          survivors: [],
        };
      } else if (!members.readable) {
        verdict = {
          crate,
          cause: "tool-error",
          detail: members.detail,
          counters: null,
          survivors: [],
        };
      } else if (!members.names.includes(crate)) {
        verdict = {
          crate,
          cause: "crate-unknown",
          detail: `not a member of the workspace; members: ${members.names.join(" ")}`,
          counters: null,
          survivors: [],
        };
      } else if (outputRefusal !== "") {
        verdict = {
          crate,
          cause: "tool-error",
          detail: outputRefusal,
          counters: null,
          survivors: [],
        };
      } else {
        verdict = evaluateCrate(
          crate,
          threshold,
          configuration,
          tool.binary,
          join(scratch, String(index)),
        );
      }
      verdicts.push(verdict);
      for (const line of reportLines(verdict, tool.version, threshold)) {
        console.log(several ? `[${crate}] ${line}` : line);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const [only] = verdicts;
  if (!several && only !== undefined) {
    return CRATE_CODES[only.cause];
  }
  console.log("crate | code | cause");
  for (const verdict of verdicts) {
    console.log(`${verdict.crate} | ${CRATE_CODES[verdict.cause]} | ${verdict.cause}`);
  }
  const failed = verdicts.filter((verdict) => verdict.cause !== "pass").length;
  console.log(`evaluated=${verdicts.length} failed=${failed}`);
  return failed > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
