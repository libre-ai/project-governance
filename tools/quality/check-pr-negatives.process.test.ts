import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The negatives gate run as a process, against a real repository.
 *
 * WHY A PROCESS. The pure tests hand the gate a change set; these show that
 * the change set git actually produces — merge base, `--raw --no-renames`
 * path list with modes, `cat-file` blobs, both trees — is the one the verdict
 * is about, whatever the repository config says. They are black-box on
 * purpose: the probes of the 2026-10-23 review (one `describe` per finding)
 * were run unchanged against the gate before its correction, to show each
 * red there.
 *
 * WHY A FIXTURE REMOTE. The gate fetches `origin <base>`: a throwaway
 * repository over `file://`, no network. Three base branches, none a
 * default-branch name: the served one, one without the rules file, one with a
 * symlinked manifest.
 *
 * WHY A SCRUBBED ENVIRONMENT. On a pull-request run of this repository's own
 * CI, `GITHUB_EVENT_NAME`, `GITHUB_BASE_REF` and `GITHUB_EVENT_PATH` are set; a
 * probe inheriting them would measure the ambient run.
 */

const GATE = join(import.meta.dir, "check-pr-negatives.ts");
const DATA = join(import.meta.dir, "pr-negatives.v1.json");
const DATA_PATH = "tools/quality/pr-negatives.v1.json";
const BASE_BRANCH = "probe/served";
const BARE_BASE = "probe/served-bare";
const LINKED_BASE = "probe/served-linked";
const SHA_A = "a".repeat(40);

const BASE_PACKAGE = {
  name: "probe",
  dependencies: { ajv: "8.20.0" },
  devDependencies: { typescript: "7.0.2" },
};
const BASE_CARGO = '[package]\nname = "probe"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\n';
const CI_WORKFLOW = `name: ci\non: push\npermissions: {}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${SHA_A}\n`;

/** The files of every base branch, path → content. */
const BASE_FILES: Readonly<Record<string, string>> = {
  ".github/workflows/ci.yml": CI_WORKFLOW,
  "package.json": `${JSON.stringify(BASE_PACKAGE, null, 2)}\n`,
  "Cargo.toml": BASE_CARGO,
  "bun.lock": '{ "lockfileVersion": 1 }\n',
  "requirements/dev.txt": "pytest==8.0.0\n",
  "constraints.txt": "urllib3<3\n",
  "environment.yml": "dependencies:\n  - numpy\n",
  "package.json5": "{ name: 'probe' }\n",
  "package.yaml": "name: probe\n",
  "pnpm-workspace.yaml": "packages: []\n",
  ".gitmodules": '[submodule "x"]\n\tpath = x\n\turl = https://example.invalid/x.git\n',
};

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const GIT_ENV = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Negatives Probe",
  GIT_AUTHOR_EMAIL: "probe@invalid",
  GIT_COMMITTER_NAME: "Negatives Probe",
  GIT_COMMITTER_EMAIL: "probe@invalid",
};

function git(cwd: string, argv: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: GIT_ENV,
  });
  if ((result.exitCode ?? 1) !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`fixture setup failed: git ${argv.join(" ")} — ${stderr}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

let workspace: string;
let upstream: string;
let clone: string;
let branchCount = 0;

function write(relative: string, text: string, root = clone): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function read(relative: string): string {
  return readFileSync(join(clone, relative), "utf8");
}

function editJson(relative: string, edit: (value: Record<string, unknown>) => void): void {
  const value = JSON.parse(read(relative)) as Record<string, unknown>;
  edit(value);
  write(relative, `${JSON.stringify(value, null, 2)}\n`);
}

/** Set `value` at the key path `keys` of a JSON file, creating the tables on the way. */
function setJson(relative: string, keys: readonly string[], value: unknown): () => void {
  return () =>
    editJson(relative, (document) => {
      let node: Record<string, unknown> = document;
      for (const key of keys.slice(0, -1)) {
        if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
        node = node[key] as Record<string, unknown>;
      }
      node[keys[keys.length - 1] ?? ""] = value;
    });
}

/** Stage `text` at `path` in the index only: the case of the path is kept even on a case-insensitive disk. */
function stageAt(path: string, mode: string, text: string): void {
  const blob = join(workspace, "blob.tmp");
  writeFileSync(blob, text);
  const sha = git(clone, ["hash-object", "-w", blob]);
  git(clone, ["update-index", "--add", "--cacheinfo", `${mode},${sha},${path}`]);
}

/** A pull-request branch off `base`: `change` edits the working tree (staged with `add -A`) or the index (`index: true`). */
function branchWith(change: () => void, base = BASE_BRANCH, index = false): void {
  branchCount += 1;
  git(clone, [
    "switch",
    "--quiet",
    "--discard-changes",
    "-C",
    `probe/pr-${branchCount}`,
    `origin/${base}`,
  ]);
  change();
  if (!index) git(clone, ["add", "-A"]);
  git(clone, ["commit", "--quiet", "--no-gpg-sign", "--allow-empty", "-m", `probe ${branchCount}`]);
  git(clone, ["reset", "--quiet", "--hard"]);
}

/** Set repository config for one probe, and unset it whatever the probe's outcome. */
function withConfig(entries: Readonly<Record<string, string>>, probe: () => void): void {
  for (const [key, value] of Object.entries(entries)) git(clone, ["config", key, value]);
  try {
    probe();
  } finally {
    for (const key of Object.keys(entries)) git(clone, ["config", "--unset", key]);
  }
}

/**
 * Run the gate on the checked-out branch as a pull_request against `base`.
 * `override` replaces or, with `undefined`, removes a GitHub variable.
 */
function runGate(
  body: string,
  base = BASE_BRANCH,
  override: Readonly<Record<string, string | undefined>> = {},
): Run {
  const eventPath = join(workspace, "event.json");
  writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7, body } }));
  const github: Record<string, string | undefined> = {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_BASE_REF: base,
    GITHUB_EVENT_PATH: eventPath,
    ...override,
  };
  const declared = Object.entries(github).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  const result = Bun.spawnSync(["bun", GATE], {
    cwd: clone,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      GATE_VERBOSE: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      ...Object.fromEntries(declared),
    },
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function commitBase(
  branch: string,
  files: Readonly<Record<string, string>>,
  extra: () => void = () => {},
): void {
  git(upstream, ["switch", "--quiet", "--orphan", branch]);
  git(upstream, ["rm", "-rq", "--ignore-unmatch", "."]);
  for (const [path, text] of Object.entries(files)) write(path, text, upstream);
  extra();
  git(upstream, ["add", "-A"]);
  git(upstream, ["commit", "--quiet", "--no-gpg-sign", "-m", `fixture ${branch}`]);
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "pr-negatives-probe-"));
  upstream = join(workspace, "upstream");
  clone = join(workspace, "clone");
  git(workspace, ["init", "--quiet", "-b", "probe/init", upstream]);
  const data = readFileSync(DATA, "utf8");
  commitBase(BASE_BRANCH, { ...BASE_FILES, [DATA_PATH]: data });
  commitBase(BARE_BASE, BASE_FILES);
  commitBase(
    LINKED_BASE,
    { ...BASE_FILES, [DATA_PATH]: data, "linked/real.json": '{ "name": "linked" }\n' },
    () => {
      symlinkSync("real.json", join(upstream, "linked/package.json"));
    },
  );
  git(workspace, ["clone", "--quiet", `file://${upstream}`, clone]);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function expectFails(run: Run, ...texts: string[]): void {
  expect(run.exitCode).toBe(1);
  for (const text of texts) expect(run.stderr).toContain(text);
}

describe("this pull request's own shape", () => {
  const ownShape = () => {
    write(
      ".github/workflows/pr-negatives.yml",
      `name: pr-negatives\non: pull_request\npermissions: {}\njobs:\n  n:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${SHA_A}\n`,
    );
    write(DATA_PATH, readFileSync(DATA, "utf8"));
    write("tools/quality/check-pr-negatives.ts", "export {};\n");
    editJson("package.json", (manifest) => {
      manifest.scripts = { x: "y" };
    });
  };

  test("it adds a workflow, so it cannot declare `workflow`; its workflow's uses is a dependency added", () => {
    branchWith(ownShape);
    expectFails(
      runGate("Door: two-way\nNot-added: workflow"),
      "workflow file added: .github/workflows/pr-negatives.yml",
    );
    expectFails(
      runGate("Door: two-way\nNot-added: dependency"),
      "uses added: .github/workflows/pr-negatives.yml: actions/checkout",
    );
  });

  test("against a base without the rules, a verifiable negative fails closed; a declarative one passes", () => {
    branchWith(ownShape, BARE_BASE);
    expectFails(
      runGate("Not-added: schema", BARE_BASE),
      "the rules are read at the merge base, never from the head",
    );
    const declarative = runGate("Door: two-way\nNot-added: hosted-service, telemetry", BARE_BASE);
    expect(declarative.exitCode).toBe(0);
    expect(declarative.stdout).toContain("diff not read: no verifiable negative declared");
  });
});

describe("review 2026-10-23, finding 1: a provenance change or an override is a dependency added", () => {
  const cases: readonly (readonly [string, () => void, string])[] = [
    [
      "npm alias",
      setJson("package.json", ["dependencies", "ajv"], "npm:evil-pkg@1.0.0"),
      "provenance changed: package.json: dependencies.ajv",
    ],
    [
      "github shorthand protocol",
      setJson("package.json", ["dependencies", "ajv"], "github:evil/ajv#main"),
      "provenance changed: package.json: dependencies.ajv",
    ],
    [
      "Cargo package rename",
      () =>
        write(
          "Cargo.toml",
          BASE_CARGO.replace('serde = "1"', 'serde = { version = "1", package = "evil-crate" }'),
        ),
      "provenance changed: Cargo.toml: dependencies.serde",
    ],
    [
      "Cargo git source",
      () =>
        write(
          "Cargo.toml",
          BASE_CARGO.replace('serde = "1"', 'serde = { git = "https://example.invalid/serde" }'),
        ),
      "provenance changed: Cargo.toml: dependencies.serde",
    ],
    [
      "Cargo [patch]",
      () =>
        write("Cargo.toml", `${BASE_CARGO}\n[patch.crates-io]\nserde = { path = "../serde" }\n`),
      "entry added: Cargo.toml: patch.crates-io.serde",
    ],
    [
      "Cargo [replace]",
      () =>
        write(
          "Cargo.toml",
          `${BASE_CARGO}\n[replace]\n"serde:1.0.0" = { git = "https://example.invalid/serde" }\n`,
        ),
      "entry added: Cargo.toml: replace.serde:1.0.0",
    ],
    [
      "npm overrides",
      setJson("package.json", ["overrides"], { ajv: "npm:evil@1" }),
      "entry added: package.json: overrides.ajv",
    ],
    [
      "yarn resolutions",
      setJson("package.json", ["resolutions"], { ajv: "1.0.0" }),
      "entry added: package.json: resolutions.ajv",
    ],
    [
      "pnpm overrides",
      setJson("package.json", ["pnpm", "overrides"], { ajv: "1.0.0" }),
      "entry added: package.json: pnpm.overrides.ajv",
    ],
    [
      "bundleDependencies",
      setJson("package.json", ["bundleDependencies"], ["ajv"]),
      "entry added: package.json: bundleDependencies.ajv",
    ],
    [
      "bundledDependencies",
      setJson("package.json", ["bundledDependencies"], ["ajv"]),
      "entry added: package.json: bundledDependencies.ajv",
    ],
  ];

  test.each(cases)("%s", (_, change, expected) => {
    branchWith(change);
    expectFails(runGate("Not-added: dependency"), expected);
  });

  test("control: a version change alone is not a dependency added", () => {
    branchWith(setJson("package.json", ["dependencies", "ajv"], "8.21.0"));
    expect(runGate("Not-added: dependency").exitCode).toBe(0);
  });
});

describe("review 2026-10-23, finding 2: manifests the gate does not read, submodules and uses", () => {
  const unread: string[] = [
    "requirements/dev.txt",
    "constraints.txt",
    "environment.yml",
    "package.json5",
    "package.yaml",
    "pnpm-workspace.yaml",
  ];

  test.each(unread)("%s modified: the negative is unverifiable, named", (path) => {
    branchWith(() => write(path, `${read(path)}# changed\n`));
    expectFails(
      runGate("Not-added: dependency"),
      `manifest of a format this gate does not read: ${path} (M)`,
    );
  });

  test("a submodule added is a dependency added, even when the config hides submodules", () => {
    branchWith(
      () => {
        const head = git(clone, ["rev-parse", "HEAD"]);
        git(clone, ["update-index", "--add", "--cacheinfo", `160000,${head},vendor/lib`]);
      },
      BASE_BRANCH,
      true,
    );
    withConfig({ "diff.ignoreSubmodules": "all" }, () => {
      expectFails(runGate("Not-added: dependency"), "submodule added: vendor/lib");
    });
  });

  test(".gitmodules changed is a dependency added", () => {
    branchWith(() =>
      write(
        ".gitmodules",
        read(".gitmodules").replace("example.invalid/x", "example.invalid/evil"),
      ),
    );
    expectFails(runGate("Not-added: dependency"), ".gitmodules changed: submodule list or URLs");
  });

  test("a new uses: in a modified workflow is a dependency added", () => {
    branchWith(() =>
      write(".github/workflows/ci.yml", `${CI_WORKFLOW}      - uses: evil/action@v1\n`),
    );
    expectFails(
      runGate("Not-added: dependency"),
      "uses added: .github/workflows/ci.yml: evil/action",
    );
  });

  test("control: bumping the sha of an existing uses: is a version change", () => {
    branchWith(() => write(".github/workflows/ci.yml", CI_WORKFLOW.replace(SHA_A, "b".repeat(40))));
    expect(runGate("Not-added: dependency").exitCode).toBe(0);
  });

  test("a vendored manifest added, without a single entry, is a dependency added", () => {
    branchWith(() => write("vendor/x/package.json", '{ "name": "x" }\n'));
    expectFails(runGate("Not-added: dependency"), "manifest added: vendor/x/package.json");
  });
});

describe("review 2026-10-23, finding 3: a declaration visible when rendered is never read as absent", () => {
  const bodies: readonly (readonly [string, string])[] = [
    ["a quote", "> Not-added: workflow"],
    ["a list item", "- Not-added: workflow"],
    ["bold", "**Not-added:** workflow"],
    ["a heading", "## Not-added: workflow"],
    ["a non-breaking hyphen", "Not\u2011added: workflow"],
    ["an en dash", "Not\u2013added: workflow"],
  ];

  test.each(bodies)("%s is refused by name", (_, body) => {
    branchWith(() => write(".github/workflows/new.yml", "name: new\n"));
    expectFails(
      runGate(`Door: two-way\n${body}`),
      'write it as "Not-added:" at the start of its own line',
    );
  });

  test("a leading byte-order mark is removed before reading", () => {
    branchWith(() => write(".github/workflows/new.yml", "name: new\n"));
    expectFails(
      runGate("\uFEFFNot-added: workflow"),
      "workflow file added: .github/workflows/new.yml",
    );
  });
});

describe("review 2026-10-23, finding 4: schema files by every convention", () => {
  const schemas: readonly (readonly [string, string])[] = [
    ["a.SCHEMA.JSON", "{}\n"],
    ["schemas/foo.json", "{}\n"],
    ["schema.json", "{}\n"],
    ["foo.schema.yaml", "type: object\n"],
    [
      "data/meta.json",
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object" }\n',
    ],
  ];

  test.each(schemas)("%s added contradicts `schema`", (path, text) => {
    branchWith(() => write(path, text));
    expectFails(runGate("Not-added: schema"), `schema file added: ${path}`);
  });
});

describe("review 2026-10-23, finding 5: the rules are the base's, not the head's", () => {
  test("a head that neutralises the rules is still judged by the base's", () => {
    branchWith(() => {
      editJson(DATA_PATH, (rules) => {
        const workflow = rules.workflow as Record<string, unknown>;
        workflow.addedPathPatterns = ["^never$"];
        workflow.directory = "never";
      });
      write(".github/workflows/new.yml", "name: new\n");
    });
    expectFails(runGate("Not-added: workflow"), "workflow file added: .github/workflows/new.yml");
  });

  test("rules absent at the merge base fail closed, even when the head carries them", () => {
    branchWith(() => {
      write(DATA_PATH, readFileSync(DATA, "utf8"));
      write(".github/workflows/new.yml", "name: new\n");
    }, BARE_BASE);
    expectFails(
      runGate("Not-added: workflow", BARE_BASE),
      "the rules are read at the merge base, never from the head",
    );
  });
});

describe("review 2026-10-23, finding 6: workflow paths in any case, and through symlinks", () => {
  test.each([
    ".github/Workflows/new.yml",
    ".GITHUB/workflows/new.yml",
  ])("%s added contradicts `workflow`", (path) => {
    branchWith(() => stageAt(path, "100644", "name: new\n"), BASE_BRANCH, true);
    expectFails(runGate("Not-added: workflow"), `workflow file added: ${path}`);
  });

  test(".github/workflows replaced by a symlink contradicts `workflow`", () => {
    branchWith(() => {
      rmSync(join(clone, ".github/workflows"), { recursive: true });
      mkdirSync(join(clone, "elsewhere"), { recursive: true });
      write("elsewhere/new.yml", "name: new\n");
      symlinkSync("../elsewhere", join(clone, ".github/workflows"));
    });
    expectFails(runGate("Not-added: workflow"), "workflow file added: .github/workflows (symlink)");
  });
});

describe("review 2026-10-23, finding 7: the dependency partition sums to the paths examined", () => {
  test("a deleted manifest, a read manifest and another file are each counted once", () => {
    branchWith(() => {
      unlinkSync(join(clone, "Cargo.toml"));
      setJson("package.json", ["dependencies", "ajv"], "8.21.0")();
      write("README.md", "probe\n");
    });
    const run = runGate("Not-added: dependency");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("dependency partition of 3 changed path(s):");
    expect(run.stdout).toContain("1 manifest read,");
    expect(run.stdout).toContain("1 dependency file deleted, 1 other");
  });
});

describe("review 2026-10-23, finding 8: a symlinked manifest cannot be verified", () => {
  test("its target changing while the link does not fails, naming the link", () => {
    branchWith(setJson("linked/real.json", ["dependencies"], { evil: "1.0.0" }), LINKED_BASE);
    expectFails(
      runGate("Not-added: dependency", LINKED_BASE),
      "linked/package.json is a symlink at the base",
    );
  });
});

describe("the change set is git's own", () => {
  test("a devDependency added in package.json contradicts `dependency`", () => {
    branchWith(setJson("package.json", ["devDependencies", "left-pad"], "1.3.0"));
    expectFails(
      runGate("Not-added: dependency"),
      "entry added: package.json: devDependencies.left-pad",
    );
  });

  test("a textconv driver cannot hide the entry: contents are read as blobs", () => {
    branchWith(setJson("package.json", ["devDependencies", "left-pad"], "1.3.0"));
    const driver = join(workspace, "hide-left-pad.sh");
    writeFileSync(driver, '#!/bin/sh\ngrep -v left-pad "$1"\n', { mode: 0o755 });
    write(".git/info/attributes", "package.json diff=hide\n");
    try {
      withConfig({ "diff.hide.textconv": driver }, () => {
        expectFails(
          runGate("Not-added: dependency"),
          "entry added: package.json: devDependencies.left-pad",
        );
      });
    } finally {
      write(".git/info/attributes", "");
    }
  });

  test("only a lockfile modified: not an addition, and named", () => {
    branchWith(() => write("bun.lock", '{ "lockfileVersion": 1, "packages": {} }\n'));
    const run = runGate("Not-added: dependency");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(
      "lockfile(s) modified without a manifest entry added, not judged an addition: bun.lock",
    );
  });

  test("a workflow renamed in, with rename detection configured, is still added", () => {
    branchWith(() => git(clone, ["mv", ".github/workflows/ci.yml", ".github/workflows/build.yml"]));
    withConfig({ "diff.renames": "true" }, () => {
      expectFails(
        runGate("Not-added: workflow"),
        "workflow file added: .github/workflows/build.yml",
      );
    });
  });

  test("a head with no merge base fails instead of reading as an empty change", () => {
    git(clone, ["switch", "--quiet", "--orphan", "probe/orphan"]);
    write("README.md", "unrelated history\n");
    git(clone, ["add", "README.md"]);
    git(clone, ["commit", "--quiet", "--no-gpg-sign", "-m", "orphan"]);
    expectFails(
      runGate("Not-added: schema"),
      `diff: unreadable, nothing verified: could not find the merge base of origin/${BASE_BRANCH} and HEAD`,
    );
  });

  test("no declaration: the diff is not needed, and the gate passes on the orphan head too", () => {
    const run = runGate("Door: two-way");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("diff not read: no negative declared");
  });
});

describe("the event", () => {
  test("a pull_request run without its event payload fails instead of reading an empty body", () => {
    expectFails(
      runGate("Not-added: schema", BASE_BRANCH, { GITHUB_EVENT_PATH: undefined }),
      "GITHUB_EVENT_PATH is unset on a pull_request run",
    );
  });

  test("outside a pull_request run, the gate declares that it judged nothing", () => {
    const run = runGate("Not-added: schema", BASE_BRANCH, { GITHUB_EVENT_NAME: "push" });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(
      "PR negatives verified nothing, as declared: not a pull_request run",
    );
  });
});
