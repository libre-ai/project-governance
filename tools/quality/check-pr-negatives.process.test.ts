import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The negatives gate run as a process, against a real repository.
 *
 * WHY A PROCESS. The pure tests hand the gate a change set; these show that
 * the change set git actually produces — merge base, `--raw --no-renames`
 * path list with modes, `cat-file` blobs, both trees — is the one the verdict
 * is about, whatever the repository config says. They are black-box on
 * purpose: the probes of the second review of 2026-10-23 (one `describe` per
 * finding N1 to N10) were run unchanged against the gate it reviewed
 * (961880b), to show each red there.
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
/** A base whose `.cargo` is a DIRECTORY symlink (third review, point 1). */
const DIRLINK_BASE = "probe/served-dirlink";
/** A base with a symlink inside `.github/workflows` (third review, point 5). */
const WFLINK_BASE = "probe/served-wflink";
const SHA_A = "a".repeat(40);

const BASE_PACKAGE = `${JSON.stringify(
  {
    name: "probe",
    workspaces: ["packages/*"],
    dependencies: { ajv: "8.20.0" },
    devDependencies: { typescript: "7.0.2" },
  },
  null,
  2,
)}\n`;
const CI_WORKFLOW = `name: ci\non: push\npermissions: {}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${SHA_A}\n`;

/** The files of every base branch, path → content. */
const BASE_FILES: Readonly<Record<string, string>> = {
  ".github/workflows/ci.yml": CI_WORKFLOW,
  "package.json": BASE_PACKAGE,
  "bun.lock": '{ "lockfileVersion": 1 }\n',
  "bunfig.toml": "[install]\n",
  "vendor/evil/package.json": '{ "name": "evil", "scripts": { "postinstall": "true" } }\n',
  "vendor/lib": "a plain file, before it becomes a gitlink\n",
  "config/app.yaml": "name: probe\n",
  "data/plain.json": '{ "a": 1 }\n',
  "docs/readme.md": "probe\n",
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
  commitBase(
    DIRLINK_BASE,
    { ...BASE_FILES, [DATA_PATH]: data, "config/cargo/config.toml": "[net]\n" },
    () => {
      symlinkSync("config/cargo", join(upstream, ".cargo"));
    },
  );
  commitBase(
    WFLINK_BASE,
    { ...BASE_FILES, [DATA_PATH]: data, "config/shared.yml": "name: shared\n" },
    () => {
      symlinkSync("../../config/shared.yml", join(upstream, ".github/workflows/shared.yml"));
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

function expectPasses(run: Run, ...texts: string[]): void {
  expect(run.exitCode).toBe(0);
  for (const text of texts) expect(run.stdout).toContain(text);
}

const addWorkflow = () => write(".github/workflows/new.yml", "name: new\n");

describe("second review, N1: a duplicated JSON key", () => {
  test("package.json touched: `dependency` cannot be verified", () => {
    branchWith(() =>
      write(
        "package.json",
        '{"name":"probe","workspaces":["packages/*"],"dependencies":{"ajv":"npm:evil@1","ajv":"8.20.0"},"devDependencies":{"typescript":"7.0.2"}}\n',
      ),
    );
    expectFails(runGate("Not-added: dependency"), "cannot verify: package.json (M,");
  });
});

describe("second review, N2: an npm spec without `/` that npm reads as a path", () => {
  test.each(["..", ".evil", "evil.tgz"])("%j: `dependency` cannot be verified", (spec) => {
    branchWith(() => write("package.json", BASE_PACKAGE.replace('"8.20.0"', JSON.stringify(spec))));
    expectFails(runGate("Not-added: dependency"), "cannot verify: package.json (M,");
  });
});

describe("second review, N3: an existing package.json brought into the workspace", () => {
  test("workspaces widened: `dependency` cannot be verified", () => {
    branchWith(() =>
      write("package.json", BASE_PACKAGE.replace('"packages/*"', '"packages/*", "vendor/*"')),
    );
    expectFails(runGate("Not-added: dependency"), "cannot verify: package.json (M,");
  });

  test("a directory symlinked into the workspace: `dependency` cannot be verified", () => {
    branchWith(() => {
      mkdirSync(join(clone, "packages"), { recursive: true });
      symlinkSync("../vendor/evil", join(clone, "packages/evil"));
    });
    expectFails(runGate("Not-added: dependency"), "cannot verify: packages/evil (A, symlink)");
  });
});

describe("second review, N4: registry configurations", () => {
  test.each([
    [".npmrc", "registry=https://registry.example.invalid/\n", "A"],
    ["bunfig.toml", '[install]\nregistry = "https://registry.example.invalid/"\n', "M"],
    [".cargo/config.toml", '[source.crates-io]\nreplace-with = "evil"\n', "A"],
  ])("%s changed: `dependency` cannot be verified", (path, text, status) => {
    branchWith(() => write(path, text));
    expectFails(runGate("Not-added: dependency"), `cannot verify: ${path} (${status},`);
  });
});

describe("second review, N5: escaped forms of the key that GitHub renders", () => {
  test.each([
    ["a backslash escape", "Not\\-added: workflow"],
    ["an HTML entity", "Not&#45;added: workflow"],
    ["an empty tag", "Not-<b></b>added: workflow"],
    ["a zero-width space (Cf)", "Not\u200b-added: workflow"],
    ["a soft hyphen", "Not\u00adadded: workflow"],
    ["a list item with an entity", "- Not&#x2D;added: workflow"],
  ])("%s is refused by name", (_, line) => {
    branchWith(addWorkflow);
    expectFails(
      runGate(`Door: two-way\n${line}`),
      'write it as "Not-added:" at the start of its own line',
    );
  });

  test("declared limit: a homoglyph is neither a declaration nor refused", () => {
    branchWith(addWorkflow);
    expectPasses(
      runGate("Door: two-way\nN\u043et-added: workflow"),
      "0 Not-added line(s), 0 misplaced key(s)",
    );
  });
});

describe("second review, N6: prose that mentions the key in the middle of a line", () => {
  test("the sentence #143 and #145 were refused for passes", () => {
    branchWith(() => write("docs/readme.md", "changed\n"));
    const body =
      "Door: two-way\n- `langsmith` reads variables which neither ADR-0058 section 3.4 nor the ticket lists. Not added: the gate refuses exactly the list of them.\n";
    expectPasses(runGate(body), "0 Not-added line(s), 0 misplaced key(s)");
  });
});

describe("second review, N7: a workflow the YAML reader would truncate", () => {
  test("a workflow touched, whatever it holds: `dependency` cannot be verified", () => {
    branchWith(() =>
      write(
        ".github/workflows/ci.yml",
        `${CI_WORKFLOW.trimEnd()}\u0000\n      - uses: evil/action@v1\n`,
      ),
    );
    expectFails(runGate("Not-added: dependency"), "cannot verify: .github/workflows/ci.yml (M,");
  });
});

describe("second review, N8: manifest names in any case", () => {
  test("PACKAGE.JSON added: `dependency` cannot be verified", () => {
    // Off every path rule (not under vendor/ since the third review widened
    // it), so only the case-insensitive file name can make it a contact.
    branchWith(
      () => stageAt("pkgs/x/PACKAGE.JSON", "100644", '{ "dependencies": { "evil": "1" } }\n'),
      BASE_BRANCH,
      true,
    );
    expectFails(runGate("Not-added: dependency"), "cannot verify: pkgs/x/PACKAGE.JSON (A,");
  });
});

describe("second review, N9: $schema in any JSON or YAML added or modified", () => {
  test.each([
    [
      "config/app.yaml",
      "$schema: https://json-schema.org/draft/2020-12/schema\nname: probe\n",
      "M",
    ],
    ["tsconfig.jsonc", '{ "$schema": "https://json.schemastore.org/tsconfig" }\n', "A"],
    ["data/plain.json", '{ "\\u0024schema": "https://json-schema.org/draft-07/schema#" }\n', "M"],
  ])("%s: `schema` cannot be verified", (path, text, status) => {
    branchWith(() => write(path, text));
    expectFails(runGate("Not-added: schema"), `cannot verify: ${path} (${status}, content carries`);
  });
});

describe("second review, N10: a gitlink by type change", () => {
  test("named as a gitlink contact, never as `submodule added`", () => {
    branchWith(() => stageAt("vendor/lib", "160000", ""), BASE_BRANCH, true);
    const run = runGate("Not-added: dependency");
    expectFails(run, "cannot verify: vendor/lib (T, gitlink)");
    expect(run.stderr).not.toContain("submodule added");
  });
});

describe("third review, point 1: a directory symlink at a surface path", () => {
  test("`.cargo` linked to a directory whose content changes: `dependency` cannot be verified", () => {
    branchWith(
      () => write("config/cargo/config.toml", '[source.crates-io]\nreplace-with = "evil"\n'),
      DIRLINK_BASE,
    );
    expectFails(
      runGate("Not-added: dependency", DIRLINK_BASE),
      "cannot verify: .cargo (base, a symlink in the base tree)",
    );
  });
});

describe("third review, point 2: any requirements file", () => {
  test.each([
    "toolchains-x/reuse-requirements.txt",
    "dev-requirements.txt",
    "requirements.in",
  ])("%s added: `dependency` cannot be verified", (path) => {
    branchWith(() => write(path, "evil==1.0\n"));
    expectFails(runGate("Not-added: dependency"), `cannot verify: ${path} (A,`);
  });
});

describe("third review, point 3: the tooling pins and version files", () => {
  test.each([
    "crates/ecosystem-engine/contracts-authority.pin.json",
    "toolchains/bun.json",
    ".nvmrc",
    ".tool-versions",
    "rust-toolchain.toml",
    "gradle/wrapper/gradle-wrapper.properties",
  ])("%s added: `dependency` cannot be verified", (path) => {
    branchWith(() => write(path, "x\n"));
    expectFails(runGate("Not-added: dependency"), `cannot verify: ${path} (A,`);
  });
});

describe("third review, point 4: locks, manager configurations, third-party code, actions, images", () => {
  test.each([
    "scripts/x.py.lock",
    "pylock.toml",
    "go.work",
    "gradle/libs.versions.toml",
    "settings.gradle.kts",
    ".pnpmfile.cjs",
    ".yarn/releases/yarn.cjs",
    "uv.toml",
    "pip.ini",
    "import_map.json",
    "node_modules/x/index.js",
    "vendor/x/lib.go",
    "third_party/x/a.c",
    "patches/x.patch",
    "tools/a/action.yml",
    "Dockerfile",
    "images/Containerfile.dev",
  ])("%s added: `dependency` cannot be verified", (path) => {
    branchWith(() => write(path, "x\n"));
    expectFails(runGate("Not-added: dependency"), `cannot verify: ${path} (A,`);
  });

  test("a .py carrying a PEP 723 block: `dependency` cannot be verified", () => {
    branchWith(() =>
      write("scripts/run.py", '# /// script\n# dependencies = ["evil"]\n# ///\nprint(1)\n'),
    );
    expectFails(
      runGate("Not-added: dependency"),
      "cannot verify: scripts/run.py (A, content carries # /// script)",
    );
  });
});

describe("third review, point 5: workflow symlinks in either tree", () => {
  test("a workflow linked at the base, whose target changes: `workflow` cannot be verified", () => {
    branchWith(() => write("config/shared.yml", "name: shared\non: push\n"), WFLINK_BASE);
    expectFails(
      runGate("Not-added: workflow", WFLINK_BASE),
      "cannot verify: .github/workflows/shared.yml (base, a symlink under .github in the base tree)",
    );
  });
});

describe("third review, point 6: escaped or bare schema content", () => {
  test.each([
    ["data/plain.json", '{ "\\u0024\\u0073chema": "x" }\n', "M", "\\u"],
    ["data/new.json5", "{ $schema: 'x' }\n", "A", "schema"],
    ["config/app.yaml", '"\\x24\\x73chema": x\n', "M", "\\x"],
    ["data/version.json", '{ "schemaVersion": 1 }\n', "A", "schema"],
  ])("%s: `schema` cannot be verified", (path, text, status, marker) => {
    branchWith(() => write(path, text));
    expectFails(
      runGate("Not-added: schema"),
      `cannot verify: ${path} (${status}, content carries ${marker})`,
    );
  });
});

describe("third review, point 8: more markup prefixes", () => {
  test.each([
    "[Not-added:](#) dependency",
    "`Not-added:` dependency",
    "~~Not-added:~~ dependency",
  ])("%s is refused by name", (line) => {
    branchWith(() => write("docs/readme.md", "changed\n"));
    expectFails(
      runGate(`Door: two-way\n${line}`),
      'write it as "Not-added:" at the start of its own line',
    );
  });
});

describe("witnesses", () => {
  test("a pull request touching only docs/ declares all three verifiable negatives and passes", () => {
    branchWith(() => write("docs/readme.md", "changed\n"));
    expectPasses(
      runGate("Door: two-way\nNot-added: dependency, schema, workflow"),
      "the dependency surface is not touched by any of 1 changed path(s)",
      "the schema surface is not touched",
      "the workflow surface is not touched",
    );
  });

  test("no line: the gate passes and does not read the diff", () => {
    expectPasses(runGate("Door: two-way"), "diff not read: no negative declared");
  });
});

describe("this pull request's own shape", () => {
  const ownShape = () => {
    write(
      ".github/workflows/pr-negatives.yml",
      `name: pr-negatives\non: pull_request\npermissions: {}\njobs:\n  n:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${SHA_A}\n`,
    );
    write(DATA_PATH, readFileSync(DATA, "utf8"));
    write("tools/quality/check-pr-negatives.ts", "export {};\n");
    write(
      "package.json",
      BASE_PACKAGE.replace('"name": "probe",', '"name": "probe",\n  "scripts": { "x": "y" },'),
    );
  };

  test("it adds a workflow and touches package.json: `workflow` and `dependency` cannot be verified", () => {
    branchWith(ownShape);
    expectFails(
      runGate("Not-added: workflow"),
      "cannot verify: .github/workflows/pr-negatives.yml (A, workflow file",
    );
    expectFails(
      runGate("Not-added: dependency"),
      "cannot verify: .github/workflows/pr-negatives.yml (A,",
      "cannot verify: package.json (M,",
    );
  });

  test("against a base without the rules, a verifiable negative fails closed; a declarative one passes", () => {
    branchWith(ownShape, BARE_BASE);
    expectFails(
      runGate("Not-added: schema", BARE_BASE),
      "the rules are read at the merge base, never from the head",
    );
    expectPasses(
      runGate("Door: two-way\nNot-added: hosted-service, telemetry", BARE_BASE),
      "diff not read: no verifiable negative declared",
    );
  });
});

describe("the change set is git's own", () => {
  test("a head that neutralises the rules is still judged by the base's", () => {
    branchWith(() => {
      const rules = JSON.parse(read(DATA_PATH));
      rules.workflow.directory = "never";
      write(DATA_PATH, `${JSON.stringify(rules, null, 2)}\n`);
      addWorkflow();
    });
    expectFails(runGate("Not-added: workflow"), "cannot verify: .github/workflows/new.yml (A,");
  });

  test("a submodule hidden by the config is still a gitlink contact", () => {
    branchWith(() => stageAt("vendor/sub", "160000", ""), BASE_BRANCH, true);
    withConfig({ "diff.ignoreSubmodules": "all" }, () => {
      expectFails(runGate("Not-added: dependency"), "cannot verify: vendor/sub (A, gitlink)");
    });
  });

  test("a textconv driver cannot hide $schema: contents are read as blobs", () => {
    branchWith(() =>
      write("data/plain.json", '{ "$schema": "https://json-schema.org/draft-07/schema#" }\n'),
    );
    const driver = join(workspace, "hide-schema.sh");
    writeFileSync(driver, '#!/bin/sh\ngrep -v schema "$1"\n', { mode: 0o755 });
    write(".git/info/attributes", "*.json diff=hide\n");
    try {
      withConfig({ "diff.hide.textconv": driver }, () => {
        expectFails(
          runGate("Not-added: schema"),
          "cannot verify: data/plain.json (M, content carries schema)",
        );
      });
    } finally {
      write(".git/info/attributes", "");
    }
  });

  test("a lockfile only modified touches the surface", () => {
    branchWith(() => write("bun.lock", '{ "lockfileVersion": 1, "packages": {} }\n'));
    expectFails(runGate("Not-added: dependency"), "cannot verify: bun.lock (M,");
  });

  test("a workflow renamed in, with rename detection configured, is still added", () => {
    branchWith(() => git(clone, ["mv", ".github/workflows/ci.yml", ".github/workflows/build.yml"]));
    withConfig({ "diff.renames": "true" }, () => {
      const run = runGate("Not-added: workflow, dependency");
      expectFails(
        run,
        "cannot verify: .github/workflows/build.yml (A,",
        "cannot verify: .github/workflows/ci.yml (D,",
      );
    });
  });

  test("a symlinked manifest unchanged in the diff is a contact through the tree", () => {
    branchWith(
      () => write("linked/real.json", '{ "dependencies": { "evil": "1" } }\n'),
      LINKED_BASE,
    );
    expectFails(
      runGate("Not-added: dependency", LINKED_BASE),
      "cannot verify: linked/package.json (base, a symlink in the base tree)",
    );
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
});

describe("the event", () => {
  test("a pull_request run without its event payload fails instead of reading an empty body", () => {
    expectFails(
      runGate("Not-added: schema", BASE_BRANCH, { GITHUB_EVENT_PATH: undefined }),
      "GITHUB_EVENT_PATH is unset on a pull_request run",
    );
  });

  test("outside a pull_request run, the gate declares that it judged nothing", () => {
    expectPasses(
      runGate("Not-added: schema", BASE_BRANCH, { GITHUB_EVENT_NAME: "push" }),
      "PR negatives verified nothing, as declared: not a pull_request run",
    );
  });
});
