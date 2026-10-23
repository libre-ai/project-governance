// Proof of the three LangGraph entry-gate templates (ADR-0058 section 3; gate-integrity section 5).
//
// Method of the fleet's gate template: every red case is replayed against a MUTANT of the gate in
// which the decisive condition is replaced by a no-op (never a deleted line, which would
// unbalance the structure and turn everything red for the wrong reason). A case is a pair — the
// verdict it pins holds on the gate, and does not hold on the mutant. A mutation that matches
// zero or several places, or changes nothing, fails the suite: the mutant must differ, once.
//
// The child process gets an environment built from nothing (PATH to find git, a scratch HOME),
// so an ambient variable of the CI run cannot decide a verdict. The fixtures are built at run
// time in throwaway git repositories; the names the first gate refuses are assembled from parts,
// so no tracked file of the template carries one.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { parseFloor } from "./check-langgraph-advisory-floor";

const HERE = import.meta.dir;
const ENV_GATE = join(HERE, "check-langsmith-env.ts");
const PERSISTENCE_GATE = join(HERE, "check-langgraph-persistence.ts");
const FLOOR_GATE = join(HERE, "check-langgraph-advisory-floor.ts");
const FLOOR_FILE = join(HERE, "langgraph-advisory-floor.v1.txt");

const scratch = mkdtempSync(join(tmpdir(), "langgraph-gates-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const CLEAN_ENV = { PATH: process.env.PATH ?? "", HOME: scratch };

interface Run {
  readonly exit: number;
  readonly out: string;
  readonly err: string;
}

function spawnClean(cmd: string[]): Run {
  const result = Bun.spawnSync(cmd, { env: CLEAN_ENV, stdout: "pipe", stderr: "pipe" });
  return {
    exit: result.exitCode ?? -1,
    out: new TextDecoder().decode(result.stdout),
    err: new TextDecoder().decode(result.stderr),
  };
}

function git(repo: string, ...args: string[]): void {
  const result = spawnClean(["git", "-C", repo, ...args]);
  if (result.exit !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.err}`);
}

type Entry = string | Buffer | { readonly link: string };

function writeEntry(repo: string, path: string, entry: Entry): void {
  const absolute = join(repo, path);
  mkdirSync(dirname(absolute), { recursive: true });
  if (typeof entry === "string" || Buffer.isBuffer(entry)) writeFileSync(absolute, entry);
  else symlinkSync(entry.link, absolute);
}

/** A throwaway git repository whose files are all staged: `git ls-files` sees them. */
function newRepo(files: Record<string, Entry>): string {
  const repo = mkdtempSync(join(scratch, "repo-"));
  git(repo, "init", "-q");
  for (const [path, entry] of Object.entries(files)) writeEntry(repo, path, entry);
  git(repo, "add", "-A");
  return repo;
}

let mutants = 0;

/** The gate with `from` replaced by `to`, exactly once, in its own directory. */
function mutantOf(gate: string, from: string, to: string): string {
  const source = readFileSync(gate, "utf8");
  const first = source.indexOf(from);
  if (from === to || first === -1 || source.indexOf(from, first + 1) !== -1) {
    throw new Error(`a no-op mutation needs exactly one occurrence of: ${from}`);
  }
  const directory = join(scratch, `mutant-${mutants++}`);
  mkdirSync(directory);
  const path = join(directory, basename(gate));
  writeFileSync(
    path,
    source.replace(from, () => to),
  );
  return path;
}

interface Case {
  readonly name: string;
  readonly files: Record<string, Entry>;
  /** Runs after the files are staged: delete a tracked file, add an untracked one. */
  readonly prepare?: (repo: string) => void;
  /** `plain`: the root is a directory that is not a git work tree. */
  readonly root?: "plain";
  readonly args?: readonly string[];
  /** The verdict the case pins. It must hold on the gate and fail on the mutant. */
  readonly holds: (run: Run) => boolean;
  /** The no-op: the decisive text of the gate, and what replaces it. */
  readonly mutation: readonly [from: string, to: string];
}

const describeRun = (run: Run) => `exit ${run.exit}\n--- stdout\n${run.out}--- stderr\n${run.err}`;

function prove(gate: string, cases: readonly Case[]): void {
  test.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const repo = c.root === "plain" ? mkdtempSync(join(scratch, "plain-")) : newRepo(c.files);
    c.prepare?.(repo);
    const args = [`--root=${repo}`, ...(c.args ?? [])];

    const original = spawnClean([process.execPath, gate, ...args]);
    if (!c.holds(original)) throw new Error(`does not hold on the gate:\n${describeRun(original)}`);

    const mutant = mutantOf(gate, c.mutation[0], c.mutation[1]);
    const mutated = spawnClean([process.execPath, mutant, ...args]);
    // A mutant that crashes proves the mutation broke the program, not that the case checks anything.
    if (/\b(?:TypeError|ReferenceError|SyntaxError)\b|\n\s+at /.test(mutated.err)) {
      throw new Error(
        `the mutant crashed instead of changing the verdict:\n${describeRun(mutated)}`,
      );
    }
    if (c.holds(mutated)) throw new Error(`still holds on the mutant:\n${describeRun(mutated)}`);
  });
}

type Needle = string | RegExp;
const found = (text: string, needle: Needle) =>
  typeof needle === "string" ? text.includes(needle) : needle.test(text);
const refuses =
  (...needles: Needle[]) =>
  (run: Run) =>
    run.exit === 1 && needles.every((needle) => found(run.err, needle));
const accepts =
  (...needles: Needle[]) =>
  (run: Run) =>
    run.exit === 0 && needles.every((needle) => found(run.out, needle));

describe("the proof harness", () => {
  test("the child environment is built from nothing", () => {
    process.env.AMBIENT_PROBE = "inherited";
    const run = spawnClean([
      process.execPath,
      "-e",
      "console.log(Object.keys(process.env).sort().join(','))",
    ]);
    delete process.env.AMBIENT_PROBE;
    expect(run.exit).toBe(0);
    expect(run.out.trim()).toBe("HOME,PATH");
  });

  test("a mutation that matches nowhere, twice, or changes nothing is refused", () => {
    expect(() => mutantOf(ENV_GATE, "no such text anywhere", "x")).toThrow();
    expect(() => mutantOf(ENV_GATE, "const", "let")).toThrow();
    expect(() => mutantOf(ENV_GATE, "scanned += 1;", "scanned += 1;")).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// check-langsmith-env
// ---------------------------------------------------------------------------------------------

const PREFIX = `${"LANGSMITH"}${"_"}`;
const ALIAS = (suffix: string) => `${"LANGCHAIN"}${"_"}${suffix}`;

/** `N tracked file(s): ...` counters of the first gate: each tracked path lands in one counter. */
function sweepSumsToTracked(run: Run): boolean {
  const match = run.out.match(
    /(\d+) tracked file\(s\): (\d+) scanned, (\d+) prose.*?, (\d+) excluded.*?, (\d+) binary, (\d+) not regular.*?, (\d+) unreadable;/,
  );
  if (match === null) return false;
  const [tracked, ...rest] = match.slice(1).map(Number) as [number, ...number[]];
  return run.exit === 0 && rest.reduce((sum, count) => sum + count, 0) === tracked;
}

const ENV_SOURCE_MUTATION: readonly [string, string] = [`\${PREFIX}[A-Za-z0-9_]*|`, ""];

describe("check-langsmith-env: refuses the telemetry switch", () => {
  prove(ENV_GATE, [
    {
      name: "a name with the prefix in code",
      files: { "src/client.ts": `const key = process.env.${PREFIX}API_KEY;\n` },
      holds: refuses(`src/client.ts:1: ${PREFIX}API_KEY`),
      mutation: ENV_SOURCE_MUTATION,
    },
    {
      name: "a name with the prefix in an environment file",
      files: { ".env.production": `# comment\n${PREFIX}TRACING=true\n` },
      holds: refuses(`.env.production:2: ${PREFIX}TRACING`),
      mutation: ENV_SOURCE_MUTATION,
    },
    {
      name: "a name with the prefix in a workflow",
      files: { ".github/workflows/ci.yml": `env:\n  ${PREFIX}PROJECT: x\n` },
      holds: refuses(`.github/workflows/ci.yml:2: ${PREFIX}PROJECT`),
      mutation: ENV_SOURCE_MUTATION,
    },
    {
      name: "a name with the prefix in a configuration file",
      files: { "config/app.toml": `[env]\n${PREFIX}ENDPOINT = "x"\n` },
      holds: refuses(`config/app.toml:2: ${PREFIX}ENDPOINT`),
      mutation: ENV_SOURCE_MUTATION,
    },
    {
      name: "a name with the prefix in a file without extension",
      files: { Dockerfile: `ENV ${PREFIX}TRACING=true\n` },
      holds: refuses(`Dockerfile:1: ${PREFIX}TRACING`),
      mutation: ENV_SOURCE_MUTATION,
    },
    {
      name: "the bare prefix",
      files: { "src/a.ts": `// ${PREFIX}\n` },
      holds: refuses(`src/a.ts:1: ${PREFIX}`),
      mutation: ENV_SOURCE_MUTATION,
    },
    ...[
      ["TRACING_V2", '"TRACING_V2"'],
      ["TRACING", '"TRACING"'],
      ["API_KEY", '"API_KEY"'],
      ["ENDPOINT", '"ENDPOINT"'],
      ["CALLBACKS_BACKGROUND", '"CALLBACKS_BACKGROUND"'],
    ].map(
      ([suffix, token]): Case => ({
        name: `the alias ${ALIAS(suffix as string)}`,
        files: { ".env.local": `${ALIAS(suffix as string)}=1\n` },
        holds: refuses(`.env.local:1: ${ALIAS(suffix as string)}`),
        mutation: [token as string, '"NO_SUCH_ALIAS"'],
      }),
    ),
  ]);
});

describe("check-langsmith-env: what it must not refuse, and what it counts", () => {
  prove(ENV_GATE, [
    {
      name: "a name that merely contains the prefix is a different variable",
      files: { ".env": `MY_${PREFIX}KEY=1\n`, "a.ts": "export {};\n" },
      holds: accepts("0 refused name(s)"),
      mutation: ["(?<![A-Za-z0-9_])", ""],
    },
    {
      name: "an alias followed by more name characters is a different variable",
      files: { ".env": `${ALIAS("TRACING")}_EXTRA=1\n` },
      holds: accepts("0 refused name(s)"),
      mutation: ["(?![A-Za-z0-9_])", ""],
    },
    {
      name: "prose documentation is counted and not scanned",
      files: { "README.md": `Never set ${PREFIX}TRACING.\n`, "a.ts": "export {};\n" },
      holds: accepts("1 prose (not scanned)", "1 scanned"),
      mutation: ["PROSE_EXTENSIONS.has(extname(path).toLowerCase())", "false"],
    },
    {
      name: "a fixture of the gate is counted and excluded",
      files: { "fixtures/red.env": `${PREFIX}A=1\n`, "a.ts": "export {};\n" },
      args: ["--exclude=fixtures"],
      holds: accepts("1 excluded (gate fixtures)", "0 refused name(s)"),
      mutation: ["if (isExcluded(path, exclude)) {", "if (false) {"],
    },
    {
      name: "a directory prefix does not exclude a sibling that shares its first letters",
      files: { "fixtures-other/red.env": `${PREFIX}A=1\n`, "a.ts": "export {};\n" },
      args: ["--exclude=fixtures"],
      holds: refuses(`fixtures-other/red.env:1: ${PREFIX}A`),
      mutation: [`prefix.endsWith("/") ? prefix : \`\${prefix}/\``, "prefix"],
    },
    {
      name: "a symlink is counted and named, its target is not followed",
      files: { "a.ts": "export {};\n", "link.ts": { link: "a.ts" } },
      holds: accepts("1 not regular: link.ts"),
      mutation: ["if (!regular) {", "if (false) {"],
    },
    {
      name: "a binary file is counted and not scanned",
      files: { "a.ts": "export {};\n", "blob.bin": Buffer.from(`\0${PREFIX}A=1`) },
      holds: accepts("1 binary", "0 refused name(s)"),
      mutation: ["bytes.includes(0)", "false"],
    },
    {
      name: "an untracked file is not examined and not counted",
      files: { "a.ts": "export {};\n" },
      prepare: (repo) => writeEntry(repo, "untracked.env", `${PREFIX}A=1\n`),
      holds: accepts("1 tracked file(s): 1 scanned"),
      mutation: ['"ls-files", "-z"', '"ls-files", "-z", "--others"'],
    },
    {
      name: "the counters sum to the tracked files (scanned)",
      files: {
        "a.ts": "export {};\n",
        "b.json": "{}\n",
        "README.md": "x\n",
        "fixtures/f.env": "x=1\n",
        "link.ts": { link: "a.ts" },
        "blob.bin": Buffer.from("\0\0"),
      },
      args: ["--exclude=fixtures"],
      holds: sweepSumsToTracked,
      mutation: ["scanned += 1;", "scanned += 0;"],
    },
    {
      name: "the counters sum to the tracked files (prose)",
      files: { "a.ts": "export {};\n", "README.md": "x\n", "docs/b.md": "y\n" },
      holds: sweepSumsToTracked,
      mutation: ["prose += 1;", "prose += 0;"],
    },
    {
      name: "the counters sum to the tracked files (excluded)",
      files: { "a.ts": "export {};\n", "fixtures/f.env": "x=1\n" },
      args: ["--exclude=fixtures"],
      holds: sweepSumsToTracked,
      mutation: ["excluded += 1;", "excluded += 0;"],
    },
    {
      name: "the counters sum to the tracked files (binary)",
      files: { "a.ts": "export {};\n", "blob.bin": Buffer.from("\0\0") },
      holds: sweepSumsToTracked,
      mutation: ["binary += 1;", "binary += 0;"],
    },
  ]);
});

describe("check-langsmith-env: fails closed", () => {
  prove(ENV_GATE, [
    {
      name: "a tracked file that cannot be read is a failure, not a zero",
      files: { "a.ts": "export {};\n", "gone.ts": "export {};\n" },
      prepare: (repo) => rmSync(join(repo, "gone.ts")),
      holds: refuses("gone.ts: tracked but unreadable"),
      mutation: ["of result.unreadable)", "of [])"],
    },
    {
      name: "a run that scanned nothing is a failure",
      files: { "README.md": "x\n" },
      holds: refuses("scanned 0 file(s)"),
      mutation: ["result.scanned === 0", "false"],
    },
    {
      name: "a root that is not a git work tree is unusable (exit 2), not clean",
      files: {},
      root: "plain",
      holds: (run) => run.exit === 2 && run.err.includes("git ls-files failed"),
      mutation: ["process.exit(2);", "process.exit(0);"],
    },
    {
      name: "the line that holds a refused name is never printed",
      files: { ".env": `${PREFIX}API_KEY=lsv2_pt_SECRETVALUE\n` },
      holds: (run) =>
        refuses(`.env:1: ${PREFIX}API_KEY`)(run) && !(run.out + run.err).includes("SECRETVALUE"),
      mutation: ["name: match[0]", "name: line"],
    },
  ]);
});

// ---------------------------------------------------------------------------------------------
// check-langgraph-persistence
// ---------------------------------------------------------------------------------------------

const GRAPH = "@langchain/langgraph";
const CHECKPOINT = "@langchain/langgraph-checkpoint";

const manifest = (dependencies: Record<string, string>) =>
  `${JSON.stringify({ name: "consumer", dependencies }, null, 2)}\n`;

function bunLock(packages: Record<string, string>): string {
  const lines = Object.entries(packages).map(
    ([key, spec]) =>
      `    ${JSON.stringify(key)}: [${JSON.stringify(spec)}, "", {}, "sha512-AAAA"],`,
  );
  return `{\n  "lockfileVersion": 2,\n  "workspaces": { "": { "name": "x" } },\n  "packages": {\n${lines.join("\n")}\n  },\n}\n`;
}

const CLEAN_MANIFEST = manifest({ [GRAPH]: "1.5.2" });
const CLEAN_BUN_LOCK = bunLock({ [GRAPH]: `${GRAPH}@1.5.2`, [CHECKPOINT]: `${CHECKPOINT}@1.2.1` });

const BACKENDS = ["postgres", "redis", "mongodb", "sqlite"];
const REFUSED_REGEX_MUTATION: readonly [string, string] = [
  "langgraph-checkpoint-[a-z0-9]",
  "langgraph-nothing-[a-z0-9]",
];

describe("check-langgraph-persistence: refuses the publisher persistence packages", () => {
  prove(PERSISTENCE_GATE, [
    ...BACKENDS.map(
      (backend): Case => ({
        name: `${CHECKPOINT}-${backend} in a manifest`,
        files: {
          "package.json": manifest({ [GRAPH]: "1.5.2", [`${CHECKPOINT}-${backend}`]: "1.0.12" }),
          "bun.lock": CLEAN_BUN_LOCK,
        },
        holds: refuses(new RegExp(`package\\.json:\\d+: ${CHECKPOINT}-${backend}`)),
        mutation: REFUSED_REGEX_MUTATION,
      }),
    ),
    {
      name: "a backend published later under the same prefix",
      files: {
        "package.json": manifest({ [`${CHECKPOINT}-dynamodb`]: "1.0.0" }),
        "bun.lock": CLEAN_BUN_LOCK,
      },
      holds: refuses(`${CHECKPOINT}-dynamodb`),
      mutation: REFUSED_REGEX_MUTATION,
    },
    {
      name: "an alias that installs a persistence package under another name",
      files: {
        "package.json": manifest({ store: `npm:${CHECKPOINT}-postgres@1.0.6` }),
        "bun.lock": CLEAN_BUN_LOCK,
      },
      holds: refuses(`package.json:4: ${CHECKPOINT}-postgres`),
      mutation: REFUSED_REGEX_MUTATION,
    },
    {
      name: "the transitive base package without a suffix stays admitted",
      files: { "package.json": CLEAN_MANIFEST, "bun.lock": CLEAN_BUN_LOCK },
      holds: accepts("0 refused package reference(s)"),
      mutation: [
        "langgraph-checkpoint-[a-z0-9][a-z0-9._-]*",
        "langgraph-checkpoint(?:-[a-z0-9][a-z0-9._-]*)?",
      ],
    },
    ...(
      [
        [
          "bun.lock",
          bunLock({ [`${CHECKPOINT}-postgres`]: `${CHECKPOINT}-postgres@1.0.5` }),
          '"bun.lock",',
        ],
        [
          "package-lock.json",
          `{"lockfileVersion":3,"packages":{"node_modules/${CHECKPOINT}-redis":{"version":"1.0.1"}}}\n`,
          '"package-lock.json",',
        ],
        [
          "npm-shrinkwrap.json",
          `{"lockfileVersion":3,"packages":{"node_modules/${CHECKPOINT}-sqlite":{"version":"1.0.1"}}}\n`,
          '"npm-shrinkwrap.json",',
        ],
        [
          "pnpm-lock.yaml",
          `packages:\n  /${CHECKPOINT}-mongodb@1.5.0:\n    resolution: {}\n`,
          '"pnpm-lock.yaml",',
        ],
        ["yarn.lock", `"${CHECKPOINT}-postgres@^1.0.5":\n  version "1.0.5"\n`, '"yarn.lock",'],
        ["bun.lockb", Buffer.from(`\0\0${CHECKPOINT}-postgres\0`), '"bun.lockb",'],
      ] as const
    ).map(
      ([file, content, token]): Case => ({
        name: `a persistence package in ${file} only`,
        // Another lockfile keeps the lockfile count above zero when the mutant stops reading `file`.
        files: {
          "package.json": CLEAN_MANIFEST,
          ...(file === "bun.lock" ? {} : { "bun.lock": CLEAN_BUN_LOCK }),
          [file]: content,
        },
        holds: refuses(new RegExp(`${file.replace(".", "\\.")}:\\d+: ${CHECKPOINT}-`)),
        mutation: [token, `"unread-${file}",`],
      }),
    ),
    {
      name: "a persistence package in a nested workspace manifest",
      files: {
        "package.json": CLEAN_MANIFEST,
        "bun.lock": CLEAN_BUN_LOCK,
        "packages/worker/package.json": manifest({ [`${CHECKPOINT}-redis`]: "1.0.12" }),
      },
      holds: refuses(`packages/worker/package.json:4: ${CHECKPOINT}-redis`),
      mutation: ["const name = basename(path);", "const name = path;"],
    },
  ]);
});

describe("check-langgraph-persistence: counts and fails closed", () => {
  prove(PERSISTENCE_GATE, [
    {
      name: "the counters sum to the tracked files (out of scope)",
      files: { "package.json": CLEAN_MANIFEST, "bun.lock": CLEAN_BUN_LOCK, "README.md": "x\n" },
      holds: accepts(
        "3 tracked file(s): 1 manifest(s) and 1 lockfile(s) read, 1 out of scope, 0 unreadable",
      ),
      mutation: ["outOfScope += 1;", "outOfScope += 0;"],
    },
    {
      name: "the counters sum to the tracked files (manifests)",
      files: { "package.json": CLEAN_MANIFEST, "bun.lock": CLEAN_BUN_LOCK },
      holds: accepts("1 manifest(s) and 1 lockfile(s) read"),
      mutation: ["manifests += 1;", "manifests += 0;"],
    },
    {
      name: "the counters sum to the tracked files (lockfiles)",
      files: { "package.json": CLEAN_MANIFEST, "bun.lock": CLEAN_BUN_LOCK },
      holds: accepts("1 manifest(s) and 1 lockfile(s) read"),
      mutation: ["lockfiles += 1;", "lockfiles += 0;"],
    },
    {
      name: "a repository with no manifest is a failure, not a zero",
      files: { "bun.lock": CLEAN_BUN_LOCK },
      holds: refuses("read 0 manifest(s)"),
      mutation: ["result.manifests === 0", "false"],
    },
    {
      name: "a repository with no lockfile is a failure, not a zero",
      files: { "package.json": CLEAN_MANIFEST },
      holds: refuses("read 0 lockfile(s)"),
      mutation: ["result.lockfiles === 0", "false"],
    },
    {
      name: "a tracked manifest that cannot be read is a failure",
      files: {
        "package.json": CLEAN_MANIFEST,
        "bun.lock": CLEAN_BUN_LOCK,
        "packages/a/package.json": "{}\n",
      },
      prepare: (repo) => rmSync(join(repo, "packages/a/package.json")),
      holds: refuses("packages/a/package.json (unreadable)"),
      mutation: ["of result.unreadable)", "of [])"],
    },
    {
      name: "a lockfile behind a symlink is a failure, not read as clean",
      files: {
        "package.json": CLEAN_MANIFEST,
        "real.lock": "{}\n",
        "bun.lock": { link: "real.lock" },
      },
      holds: refuses("bun.lock (not a regular file)"),
      mutation: ["!lstatSync(absolute).isFile()", "false"],
    },
    {
      name: "an untracked manifest is not examined and not counted",
      files: { "package.json": CLEAN_MANIFEST, "bun.lock": CLEAN_BUN_LOCK },
      prepare: (repo) =>
        writeEntry(repo, "packages/b/package.json", manifest({ [`${CHECKPOINT}-postgres`]: "1" })),
      holds: accepts("2 tracked file(s): 1 manifest(s) and 1 lockfile(s) read"),
      mutation: ['"ls-files", "-z"', '"ls-files", "-z", "--others"'],
    },
    {
      name: "a root that is not a git work tree is unusable (exit 2), not clean",
      files: {},
      root: "plain",
      holds: (run) => run.exit === 2 && run.err.includes("git ls-files failed"),
      mutation: ["process.exit(2);", "process.exit(0);"],
    },
  ]);
});

// ---------------------------------------------------------------------------------------------
// check-langgraph-advisory-floor
// ---------------------------------------------------------------------------------------------

const FLOOR_PATH = "tools/quality/langgraph-advisory-floor.v1.txt";
const CORE = "@langchain/core";
const TEST_FLOOR = `# test floor\n${GRAPH} 1.4.21 GHSA-wp87-994x-j95x\n${CORE} 1.1.8 GHSA-r399-636x-v7f6\n`;
const lock = (graph: string, core = "1.3.0") =>
  bunLock({ [GRAPH]: `${GRAPH}@${graph}`, [CORE]: `${CORE}@${core}` });
const npmLock = (packages: Record<string, unknown>) =>
  `${JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } })}\n`;

const withFloor = (floor: string, ...rest: [string, Entry][]): Record<string, Entry> => ({
  [FLOOR_PATH]: floor,
  "bun.lock": lock("1.5.2"),
  ...Object.fromEntries(rest),
});

describe("check-langgraph-advisory-floor: compares the lockfile to the floor", () => {
  prove(FLOOR_GATE, [
    {
      name: "a version equal to its minimum is accepted and the volume is printed",
      files: { [FLOOR_PATH]: TEST_FLOOR, "bun.lock": lock("1.4.21", "1.1.8") },
      holds: accepts(
        "2 row(s) over 2 package(s)",
        "1 of 1 lockfile(s) read, 2 entr(ies) listed, 2 row-by-entry comparison(s)",
        "2 row(s) resolved, 0 absent from the lockfile(s), 0 below the floor",
      ),
      mutation: [
        "Bun.semver.order(entry.version, row.minimum) < 0",
        "Bun.semver.order(entry.version, row.minimum) <= 0",
      ],
    },
    {
      name: "a version below its minimum",
      files: { [FLOOR_PATH]: TEST_FLOOR, "bun.lock": lock("1.4.20") },
      holds: refuses(`bun.lock: ${GRAPH}@1.4.20 (${GRAPH}) is below 1.4.21 (GHSA-wp87-994x-j95x)`),
      mutation: ["Bun.semver.order(entry.version, row.minimum) < 0", "false"],
    },
    {
      name: "versions compare as semver, not as strings",
      files: { [FLOOR_PATH]: TEST_FLOOR, "bun.lock": lock("1.4.9") },
      holds: refuses(`${GRAPH}@1.4.9 `),
      mutation: ["Bun.semver.order(entry.version, row.minimum) < 0", "entry.version < row.minimum"],
    },
    {
      name: "a pre-release of the minimum is below it",
      files: { [FLOOR_PATH]: TEST_FLOOR, "bun.lock": lock("1.4.21-alpha.1") },
      holds: refuses(`${GRAPH}@1.4.21-alpha.1 `),
      mutation: [
        "Bun.semver.order(entry.version, row.minimum) < 0",
        'Bun.semver.order(entry.version.split("-")[0] as string, row.minimum) < 0',
      ],
    },
    {
      name: "every resolved version counts, not the first one",
      files: {
        [FLOOR_PATH]: TEST_FLOOR,
        "bun.lock": bunLock({
          [GRAPH]: `${GRAPH}@1.5.2`,
          [CORE]: `${CORE}@1.3.0`,
          [`worker/${CORE}`]: `${CORE}@1.1.7`,
        }),
      },
      holds: refuses(`(worker/${CORE}) is below 1.1.8`),
      mutation: ["resolved += 1;", "resolved += 1; if (resolved > 1) continue;"],
    },
    {
      name: "an alias is judged under the real package name",
      files: {
        [FLOOR_PATH]: TEST_FLOOR,
        "bun.lock": bunLock({ lg: `${GRAPH}@1.4.0`, [CORE]: `${CORE}@1.3.0` }),
      },
      holds: refuses(`${GRAPH}@1.4.0 (lg) is below 1.4.21`),
      mutation: ["{ name: spec.slice(0, at)", "{ name: where"],
    },
    {
      name: "a floor package that is not a version cannot be compared",
      files: {
        [FLOOR_PATH]: TEST_FLOOR,
        "bun.lock": bunLock({ [GRAPH]: `${GRAPH}@github:acme/graph`, [CORE]: `${CORE}@1.3.0` }),
      },
      holds: refuses("is not a version this gate can compare to 1.4.21"),
      // Not `false`: Bun.semver.order throws on a non-version, so that mutant crashes. The defect
      // is dropped instead, which leaves the branch taken and the verdict green.
      mutation: [
        `defects.push(\n            \`\${lock.file}: \${entry.name}@\${entry.version} (\${entry.where}) is not a version`,
        `[].push(\n            \`\${lock.file}: \${entry.name}@\${entry.version} (\${entry.where}) is not a version`,
      ],
    },
    {
      name: "a package the lockfile does not resolve satisfies its row and is counted absent",
      files: { [FLOOR_PATH]: TEST_FLOOR, "bun.lock": bunLock({ [GRAPH]: `${GRAPH}@1.5.2` }) },
      holds: accepts("1 row(s) resolved, 1 absent from the lockfile(s)"),
      mutation: ["if (resolved === 0) absentRows += 1;", "if (false) absentRows += 1;"],
    },
    {
      name: "the comparisons are counted",
      files: { [FLOOR_PATH]: TEST_FLOOR, "bun.lock": lock("1.5.2") },
      holds: accepts("2 row-by-entry comparison(s)"),
      mutation: ["entriesCompared += 1;", "entriesCompared += 0;"],
    },
    {
      name: "a floor that matches no resolved package compared nothing",
      files: { [FLOOR_PATH]: TEST_FLOOR, "bun.lock": bunLock({ left: "left@1.0.0" }) },
      holds: refuses("no floor package is resolved in any lockfile"),
      mutation: ["evaluation.resolvedRows === 0", "false"],
    },
    {
      name: "every lockfile is read",
      files: withFloor(TEST_FLOOR, [
        "package-lock.json",
        npmLock({ [`node_modules/${GRAPH}`]: { version: "1.4.20" } }),
      ]),
      holds: refuses(`package-lock.json: ${GRAPH}@1.4.20 `),
      mutation: ["for (const lock of locks) {", "for (const lock of locks.slice(0, 1)) {"],
    },
  ]);
});

describe("check-langgraph-advisory-floor: reads an npm lockfile", () => {
  prove(FLOOR_GATE, [
    {
      name: "a package under node_modules below its minimum",
      files: {
        [FLOOR_PATH]: TEST_FLOOR,
        "package-lock.json": npmLock({ [`node_modules/${GRAPH}`]: { version: "1.4.20" } }),
      },
      holds: refuses(`package-lock.json: ${GRAPH}@1.4.20 (node_modules/${GRAPH}) is below 1.4.21`),
      mutation: ['where.lastIndexOf("node_modules/")', "-1"],
    },
    {
      name: "a nested package is judged under its installed name",
      files: {
        [FLOOR_PATH]: TEST_FLOOR,
        "package-lock.json": npmLock({
          [`node_modules/${GRAPH}`]: { version: "1.5.2" },
          [`node_modules/worker/node_modules/${CORE}`]: { version: "1.1.7" },
        }),
      },
      holds: refuses(`${CORE}@1.1.7 `),
      mutation: ['where.lastIndexOf("node_modules/")', "-1"],
    },
    {
      name: "an alias with a name field is judged under that name",
      files: {
        [FLOOR_PATH]: TEST_FLOOR,
        "package-lock.json": npmLock({ "node_modules/lg": { name: GRAPH, version: "1.4.20" } }),
      },
      holds: refuses(`${GRAPH}@1.4.20 (node_modules/lg)`),
      mutation: ['typeof value.name === "string" ? value.name : installed', "installed"],
    },
    {
      name: "a workspace link without a version is skipped",
      files: {
        [FLOOR_PATH]: TEST_FLOOR,
        "package-lock.json": npmLock({
          [`node_modules/${GRAPH}`]: { version: "1.5.2" },
          "node_modules/local": { resolved: "packages/local", link: true },
        }),
      },
      holds: accepts("1 of 1 lockfile(s) read, 1 entr(ies) listed"),
      mutation: ["value.link === true", "false"],
    },
    {
      name: "an entry without a version is a failure, not skipped",
      files: {
        [FLOOR_PATH]: TEST_FLOOR,
        "package-lock.json": npmLock({
          [`node_modules/${GRAPH}`]: { version: "1.5.2" },
          "node_modules/odd": {},
        }),
      },
      holds: refuses("entry 'node_modules/odd' has no version"),
      mutation: ['typeof value.version !== "string"', "false"],
    },
    {
      name: "a lockfileVersion 1 file lists no packages table and is a failure",
      files: withFloor(TEST_FLOOR, [
        "package-lock.json",
        '{"lockfileVersion":1,"dependencies":{}}\n',
      ]),
      holds: refuses(
        "package-lock.json: lockfile has no packages table (lockfileVersion 1 is not read)",
      ),
      mutation: ["if (Object.keys(packages).length === 0) {", "if (false) {"],
    },
    {
      name: "a lockfile that does not parse as JSON is a failure",
      files: withFloor(TEST_FLOOR, ["package-lock.json", "{{{\n"]),
      holds: refuses("package-lock.json: lockfile does not parse as JSON"),
      mutation: [
        `return { error: \`does not parse as JSON: \${(error as Error).message}\` };`,
        "return { entries: [] };",
      ],
    },
  ]);
});

describe("check-langgraph-advisory-floor: fails closed on what it cannot read", () => {
  prove(FLOOR_GATE, [
    {
      name: "a bun.lock that does not parse as JSONC",
      files: withFloor(TEST_FLOOR, ["bun.lock", "{{{\n"]),
      holds: refuses("bun.lock: lockfile does not parse as JSONC"),
      mutation: [
        `return { error: \`does not parse as JSONC: \${(error as Error).message}\` };`,
        "return { entries: [] };",
      ],
    },
    {
      name: "a bun.lock with no packages table",
      files: withFloor(TEST_FLOOR, ["bun.lock", '{"lockfileVersion":2}\n']),
      holds: refuses("bun.lock: lockfile has no packages table"),
      mutation: ["if (Object.keys(packages).length === 0) return", "if (false) return"],
    },
    {
      name: "a bun.lock entry without name@version",
      files: withFloor(TEST_FLOOR, [
        "bun.lock",
        bunLock({ [GRAPH]: `${GRAPH}@1.5.2`, odd: "@langchain/odd" }),
      ]),
      holds: refuses("entry 'odd' has no name@version"),
      mutation: ["at <= 0", "false"],
    },
    ...["pnpm-lock.yaml", "yarn.lock"].map(
      (file): Case => ({
        name: `${file} is a format this gate does not read`,
        files: withFloor(TEST_FLOOR, [file, "lockfile: {}\n"]),
        holds: refuses(`${file}: lockfile format '${file}' is not read by this gate`),
        mutation: [
          `return { error: \`format '\${name}' is not read by this gate\` };`,
          "return { entries: [] };",
        ],
      }),
    ),
    {
      name: "bun.lockb (binary) is a format this gate does not read",
      files: withFloor(TEST_FLOOR, ["bun.lockb", Buffer.from("\0\0")]),
      holds: refuses("bun.lockb: lockfile format 'bun.lockb' is not read by this gate"),
      mutation: [
        `return { error: \`format '\${name}' is not read by this gate\` };`,
        "return { entries: [] };",
      ],
    },
    {
      name: "a repository with no lockfile is a failure, not a zero",
      files: { [FLOOR_PATH]: TEST_FLOOR },
      holds: refuses("0 lockfile(s) tracked"),
      mutation: ["lockfiles.length === 0", "false"],
    },
    {
      name: "a root that is not a git work tree is unusable (exit 2), not clean",
      files: {},
      root: "plain",
      holds: (run) => run.exit === 2 && run.err.includes("git ls-files failed"),
      mutation: ["process.exit(2);", "process.exit(0);"],
    },
  ]);
});

describe("check-langgraph-advisory-floor: the floor is a tracked, parsed data file", () => {
  prove(FLOOR_GATE, [
    {
      name: "a line that is not three fields",
      files: withFloor(`${GRAPH} 1.4.21\n`),
      holds: refuses(`${FLOOR_PATH}: line 1: expected '<package> <minimum version> <advisory id>'`),
      mutation: ["fields.length !== 3", "false"],
    },
    {
      name: "a name that is not a package name",
      files: withFloor("Not_A_Package 1.0.0 GHSA-wp87-994x-j95x\n"),
      holds: refuses("'Not_A_Package' is not a package name"),
      mutation: ["!PACKAGE_NAME.test(name)", "false"],
    },
    {
      name: "a minimum that is not an x.y.z version",
      files: withFloor(`${CORE} ^1.1.8 GHSA-r399-636x-v7f6\n`),
      holds: refuses("'^1.1.8' is not an x.y.z version"),
      mutation: ["!MINIMUM_VERSION.test(minimum)", "false"],
    },
    {
      name: "an advisory id that is not a GHSA identifier",
      files: withFloor(`${CORE} 1.1.8 CVE-2025-68665\n`),
      holds: refuses("'CVE-2025-68665' is not a GHSA identifier"),
      mutation: ["!ADVISORY_ID.test(advisory)", "false"],
    },
    {
      name: "the same package and advisory twice",
      files: withFloor(`${CORE} 1.1.8 GHSA-r399-636x-v7f6\n${CORE} 1.1.9 GHSA-r399-636x-v7f6\n`),
      holds: refuses(`line 2: ${CORE} GHSA-r399-636x-v7f6 is already a row`),
      mutation: [`seen.has(\`\${name} \${advisory}\`)`, "false"],
    },
    {
      name: "a floor with no row compares nothing",
      files: withFloor("# only a comment\n"),
      holds: refuses("the floor has 0 row(s)"),
      mutation: ["floor.rows.length === 0 && failures.length === 0", "false"],
    },
    {
      name: "a floor that is not a tracked file is not policy",
      files: { "bun.lock": lock("1.5.2") },
      prepare: (repo) => writeEntry(repo, FLOOR_PATH, TEST_FLOOR),
      holds: refuses(`${FLOOR_PATH}: the floor is not a tracked file`),
      mutation: ["!tracked.includes(args.floor)", "false"],
    },
    {
      name: "a tracked floor that cannot be read is a failure",
      files: withFloor(TEST_FLOOR),
      prepare: (repo) => rmSync(join(repo, FLOOR_PATH)),
      holds: refuses(`${FLOOR_PATH}: floor unreadable`),
      mutation: [
        `failures.push(\`\${args.floor}: floor unreadable (\${(error as Error).message})\`);`,
        "void error;",
      ],
    },
    {
      name: "a floor kept elsewhere is named by --floor",
      files: { "ci/floor.txt": TEST_FLOOR, "bun.lock": lock("1.5.2") },
      args: ["--floor=ci/floor.txt"],
      holds: accepts("from ci/floor.txt"),
      mutation: ['else if (argument.startsWith("--floor="))', "else if (false)"],
    },
  ]);
});

describe("the committed floor", () => {
  const committed = readFileSync(FLOOR_FILE, "utf8");
  const TICKET_ROWS = [
    [GRAPH, "1.4.21", "GHSA-wp87-994x-j95x"],
    [GRAPH, "1.4.12", "GHSA-j87f-x5h5-gr75"],
    [CHECKPOINT, "1.1.4", "GHSA-j87f-x5h5-gr75"],
    [CORE, "1.1.8", "GHSA-r399-636x-v7f6"],
  ] as const;
  const carriesTicketRows = (text: string) =>
    TICKET_ROWS.every(([name, minimum, advisory]) =>
      parseFloor(text).rows.some(
        (row) => row.package === name && row.minimum === minimum && row.advisory === advisory,
      ),
    );

  test("parses without a defect", () => {
    expect(parseFloor(committed).errors).toEqual([]);
    expect(parseFloor(committed).rows.length).toBeGreaterThan(0);
  });

  test("carries the four rows of the governance ticket, and a copy without one does not", () => {
    expect(carriesTicketRows(committed)).toBe(true);
    expect(carriesTicketRows(committed.replace(/^@langchain\/core .*\n/m, ""))).toBe(false);
  });

  test("is accepted by the gate against a lockfile at the current versions", () => {
    const repo = newRepo({
      [FLOOR_PATH]: committed,
      "bun.lock": bunLock({
        [GRAPH]: `${GRAPH}@1.5.2`,
        [CORE]: `${CORE}@1.3.0`,
        [CHECKPOINT]: `${CHECKPOINT}@1.2.1`,
        "@langchain/langgraph-sdk": "@langchain/langgraph-sdk@1.12.6",
      }),
    });
    const run = spawnClean([process.execPath, FLOOR_GATE, `--root=${repo}`]);
    expect(run.exit).toBe(0);
    const { rows } = parseFloor(committed);
    const packages = new Set(rows.map((row) => row.package)).size;
    expect(run.out).toContain(`${rows.length} row(s) over ${packages} package(s)`);
  });
});
