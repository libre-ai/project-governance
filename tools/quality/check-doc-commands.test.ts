import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CONFIG_PATH,
  type DocCommandsConfig,
  evaluateDocCommands,
  loadDocCommandsInput,
  parseArguments,
  runDocCommands,
  scanCargoOccurrences,
  scanOccurrences,
  validateConfig,
} from "./check-doc-commands";
import {
  type CargoWorkspace,
  classifyCargo,
  loadCargoWorkspace,
  resolveCargo,
} from "./doc-commands-cargo";

const MANIFEST = JSON.stringify({ scripts: { check: "a", lint: "b", "check:bun": "c" } });
const DOC = "docs/a.md";

const CONFIG: DocCommandsConfig = {
  manifest: "package.json",
  documents: [{ path: DOC, because: "test document" }],
  exemptions: [],
};

/** Runs the gate over one document with the test manifest. */
function judge(
  docText: string | null,
  config: DocCommandsConfig = CONFIG,
  manifest: string | null = MANIFEST,
) {
  return evaluateDocCommands(manifest, [{ path: DOC, text: docText }], config);
}

describe("scanOccurrences", () => {
  test("reads a command in a fenced block and in a code span, with its line", () => {
    expect(
      scanOccurrences("intro bun run lint\n```sh\nbun run check:bun\n```\nsee `bun run check`"),
    ).toEqual([
      { kind: "prose", line: 1 },
      { kind: "read", line: 3, name: "check:bun" },
      { kind: "read", line: 5, name: "check" },
    ]);
  });

  test("a backtick that is never closed opens no code span", () => {
    expect(scanOccurrences("`bun run lint and nothing closes it")).toEqual([
      { kind: "prose", line: 1 },
    ]);
  });

  test("a placeholder is a `<` or a name followed by an ellipsis, and reads no script", () => {
    expect(scanOccurrences("`bun run check:…` `bun run <script>` `bun run <x>`")).toEqual([
      { kind: "placeholder", line: 1 },
      { kind: "placeholder", line: 1 },
      { kind: "placeholder", line: 1 },
    ]);
  });
});

describe("evaluateDocCommands", () => {
  test("green: every command shown names a script, and the sums hold", () => {
    const { report, volume } = judge("```sh\nbun run check:bun\n```\nand `bun run lint`");
    expect(report.outcome).toBe("pass");
    expect(volume).toMatchObject({
      occurrences: 2,
      read: 2,
      resolved: 2,
      exempted: 0,
      unresolved: 0,
      declaredRead: 1,
    });
    expect(report.volumeSummary).toContain("2 read = 2 resolved + 0 exempted + 0 unresolved");
  });

  test("a command that names no script turns the gate red, with its document, line and command", () => {
    const { report } = judge("```sh\nbun run check\nbun run gone\n```");
    expect(report.violations).toEqual([
      "docs/a.md:3 bun run gone: bun run gone names no key of scripts in package.json",
    ]);
  });

  test("an exemption with the same document and command admits the unresolved command", () => {
    const config: DocCommandsConfig = {
      ...CONFIG,
      exemptions: [{ path: DOC, command: "bun run gone", because: "renamed in another repo" }],
    };
    const { report, volume } = judge("`bun run gone`", config);
    expect(report.outcome).toBe("pass");
    expect(volume).toMatchObject({
      read: 1,
      resolved: 0,
      exempted: 1,
      unresolved: 0,
      exemptionsStale: 0,
    });
  });

  test("an exemption that admits no command read is stale and turns the gate red", () => {
    const config: DocCommandsConfig = {
      ...CONFIG,
      exemptions: [{ path: DOC, command: "bun run gone", because: "old" }],
    };
    const { report, volume } = judge("`bun run lint`", config);
    expect(report.violations).toEqual([
      "exemption docs/a.md bun run gone: admits no command read in the declared documents — stale, remove it",
    ]);
    expect(volume).toMatchObject({ exemptions: 1, exemptionsStale: 1 });
  });

  test("an exemption that covers only commands that resolve is stale too", () => {
    const config: DocCommandsConfig = {
      ...CONFIG,
      exemptions: [{ path: DOC, command: "bun run lint", because: "not needed" }],
    };
    const { report } = judge("`bun run lint`", config);
    expect(report.violations).toEqual([
      "exemption docs/a.md bun run lint: admits only commands that resolve — stale, remove it",
    ]);
  });

  test("a declared document that cannot be read turns the gate red, never a zero", () => {
    const { report, volume } = judge(null);
    expect(report.violations).toEqual([
      "docs/a.md: declared document could not be read — a missing file is not zero commands",
    ]);
    expect(volume).toMatchObject({ declaredRead: 0, declaredUnreadable: 1, occurrences: 0 });
  });

  test("a manifest that cannot be read, is not JSON, has no scripts, or has none turns the gate red", () => {
    const cases: readonly [string | null, string][] = [
      [null, "manifest could not be read"],
      ["{ not json", "manifest is not valid JSON"],
      ['{"name":"x"}', "manifest has no scripts object"],
      ['{"scripts":[]}', "manifest has no scripts object"],
      ['{"scripts":{}}', "manifest declares no script"],
    ];
    for (const [manifest, reason] of cases) {
      const { report, volume } = judge("`bun run check`", CONFIG, manifest);
      expect(report.violations.join("\n")).toContain(reason);
      expect(volume).toMatchObject({ read: 1, resolved: 0, unresolved: 1 });
    }
  });

  test("a declared document that shows no command turns the gate red", () => {
    const { report } = judge("Plain prose, and a `cargo test` span.");
    expect(report.violations).toEqual([
      'docs/a.md: declared but shows no command (0 occurrence(s) of "bun run ", 1 of "cargo ", none read)',
    ]);
  });

  test("placeholders and bare prose are counted apart and neither verified nor failed", () => {
    const { report, volume } = judge(
      "`bun run check:…`, `bun run <script>`, bun run nope and `bun run lint`",
    );
    expect(report.outcome).toBe("pass");
    expect(volume).toMatchObject({
      occurrences: 4,
      read: 1,
      placeholders: 2,
      bareProse: 1,
      resolved: 1,
      unresolved: 0,
    });
    expect(report.volumeSummary).toContain(
      '4 occurrence(s) of "bun run " = 1 read + 2 placeholder(s) + 1 bare prose',
    );
  });

  test("the sums hold on a mixed document: occurrences and read commands both add up", () => {
    const config: DocCommandsConfig = {
      ...CONFIG,
      exemptions: [{ path: DOC, command: "bun run gone", because: "renamed elsewhere" }],
    };
    const { volume } = judge(
      "`bun run lint` `bun run gone` `bun run missing` `bun run <x>` bun run lost\n```\nbun run check\n```",
      config,
    );
    expect(volume.occurrences).toBe(volume.read + volume.placeholders + volume.bareProse);
    expect(volume.read).toBe(volume.resolved + volume.exempted + volume.unresolved);
    expect(volume).toMatchObject({
      occurrences: 6,
      read: 4,
      placeholders: 1,
      bareProse: 1,
      resolved: 2,
      exempted: 1,
      unresolved: 1,
    });
  });

  test("the success line prints the manifest and document counts", () => {
    const { report } = judge("`bun run lint`");
    expect(report.volumeSummary).toContain("3 script(s) in package.json");
    expect(report.volumeSummary).toContain("1 declared document(s) read, 0 unreadable");
  });
});

describe("validateConfig", () => {
  const exemption = { path: DOC, command: "bun run gone", because: "renamed" };
  const withExemptions = (exemptions: unknown) => ({ ...CONFIG, exemptions: [exemptions] });

  test("the exemptions list is required, written even when empty", () => {
    expect(() => validateConfig({ manifest: "package.json", documents: CONFIG.documents })).toThrow(
      "exemptions",
    );
    expect(validateConfig(CONFIG).exemptions).toEqual([]);
  });

  test("a document needs a path and a reason; the paths are unique", () => {
    expect(() => validateConfig({ ...CONFIG, documents: [{ path: DOC, because: " " }] })).toThrow(
      "non-empty because",
    );
    expect(() =>
      validateConfig({
        ...CONFIG,
        documents: [CONFIG.documents[0], { path: DOC, because: "again" }],
      }),
    ).toThrow("duplicate document");
  });

  test("an exemption names a declared document, a `bun run` or `cargo` command, and a reason", () => {
    expect(validateConfig(withExemptions(exemption)).exemptions).toEqual([exemption]);
    const cargoExemption = { ...exemption, command: "cargo run -p elsewhere" };
    expect(validateConfig(withExemptions(cargoExemption)).exemptions).toEqual([cargoExemption]);
    expect(() => validateConfig(withExemptions({ ...exemption, path: "docs/other.md" }))).toThrow(
      "not a declared document",
    );
    for (const command of ["make test", "cargo", "cargo  run -p x", "bun run a b"]) {
      expect(() => validateConfig(withExemptions({ ...exemption, command }))).toThrow(
        "bun run <name>",
      );
    }
    expect(() => validateConfig(withExemptions({ ...exemption, because: "" }))).toThrow(
      "non-empty because",
    );
    expect(() =>
      validateConfig({ ...CONFIG, exemptions: [exemption, { ...exemption, because: "twice" }] }),
    ).toThrow("duplicate exemption");
  });
});

describe("validateConfig, manifests and containment", () => {
  test("a registry declares a package manifest, a cargo manifest, or both", () => {
    const { manifest: _dropped, ...withoutManifest } = CONFIG;
    expect(() => validateConfig(withoutManifest)).toThrow("manifest and/or cargo");
    expect(validateConfig({ ...withoutManifest, cargo: "Cargo.toml" }).cargo).toBe("Cargo.toml");
  });

  test("no path of a registry leaves the repository", () => {
    for (const path of ["../outside.md", "/etc/hosts", "docs/../../x.md"]) {
      expect(() => validateConfig({ ...CONFIG, manifest: path })).toThrow("inside the repository");
      expect(() => validateConfig({ ...CONFIG, cargo: path })).toThrow("inside the repository");
      expect(() => validateConfig({ ...CONFIG, documents: [{ path, because: "x" }] })).toThrow(
        "inside the repository",
      );
    }
  });
});

describe("classifyCargo", () => {
  test("reads the package and the binary a run, test, build or check names", () => {
    expect(classifyCargo("run -p engine")).toEqual({
      kind: "read",
      command: "cargo run -p engine",
      subcommand: "run",
      packages: ["engine"],
      bins: [],
    });
    expect(classifyCargo("run --bin tool")).toMatchObject({ packages: [], bins: ["tool"] });
    expect(classifyCargo("test -p engine")).toMatchObject({
      kind: "read",
      subcommand: "test",
      packages: ["engine"],
    });
    expect(classifyCargo("build --package=engine --bin=tool")).toMatchObject({
      kind: "read",
      packages: ["engine"],
      bins: ["tool"],
    });
    expect(classifyCargo("check --locked -p a -p b")).toMatchObject({ packages: ["a", "b"] });
  });

  test("what follows `--`, a shell operator or a comment is not cargo's", () => {
    expect(classifyCargo("run --locked -p verifier -- <journal-file>")).toMatchObject({
      kind: "read",
      command: "cargo run --locked -p verifier",
      packages: ["verifier"],
    });
    expect(classifyCargo("test -p engine && echo --bin ghost")).toMatchObject({
      command: "cargo test -p engine",
      bins: [],
    });
    expect(classifyCargo("run -p engine   # --bin ghost")).toMatchObject({ bins: [] });
  });

  test("a placeholder names no target", () => {
    expect(classifyCargo("run -p <crate>")).toEqual({ kind: "placeholder" });
    expect(classifyCargo("test … shell_controls")).toEqual({ kind: "placeholder" });
  });

  test("every other form is not recognised, with its reason, and is never a read", () => {
    const cases: readonly [string, string][] = [
      ["fmt --check", "subcommand `fmt` is not read"],
      ["clippy -p engine", "subcommand `clippy` is not read"],
      ["install --bin tool", "subcommand `install` is not read"],
      ["+nightly run -p engine", "subcommand `+nightly` is not read"],
      ["", "no subcommand"],
      ["test", "names no package and no binary"],
      ["build --locked", "names no package and no binary"],
      ["test -p engine --test integration", "selector `--test` is not read"],
      ["run --example=demo -p engine", "selector `--example` is not read"],
      ["run --manifest-path other/Cargo.toml -p engine", "selector `--manifest-path` is not read"],
      ["run -p", "`-p` is followed by no plain name"],
      ['run -p "$CRATE"', "`-p` is followed by no plain name"],
      ["run --bin=", "`--bin` is followed by no plain name"],
    ];
    for (const [rest, why] of cases) {
      expect(classifyCargo(rest)).toMatchObject({ kind: "unrecognised", why });
    }
  });
});

describe("resolveCargo", () => {
  const packages = [
    { name: "engine", manifest: "crates/engine/Cargo.toml", bins: ["engine", "tool"] },
    { name: "model", manifest: "crates/model/Cargo.toml", bins: [] },
  ];
  const read = (rest: string) => {
    const reading = classifyCargo(rest);
    if (reading.kind !== "read") throw new Error(`not read: ${rest}`);
    return resolveCargo(reading, packages);
  };

  test("a package and a binary that exist resolve", () => {
    expect(read("run -p engine")).toBeNull();
    expect(read("run --bin tool")).toBeNull();
    expect(read("run -p engine --bin tool")).toBeNull();
    expect(read("test -p model")).toBeNull();
  });

  test("a package no manifest names does not resolve", () => {
    expect(read("test -p gone")).toBe("package `gone` is the name of no manifest read");
  });

  test("a binary is looked up in the packages selected, or in all when none is", () => {
    expect(read("run --bin gone")).toBe("binary `gone` is no binary target of any manifest read");
    expect(read("run -p model --bin tool")).toBe(
      "binary `tool` is no binary target of the package(s) selected",
    );
  });

  test("`cargo run` of a package without a binary does not resolve; `cargo test` of it does", () => {
    expect(read("run -p model")).toBe("package `model` holds no binary target to run");
    expect(read("build -p model")).toBeNull();
  });
});

describe("scanCargoOccurrences", () => {
  test("code is read, prose is not, and a code span ends the command", () => {
    const found = scanCargoOccurrences(
      "use cargo run here\n```sh\ncargo run -p engine\n```\n`cargo test -p engine` then --bin x",
    );
    expect(found.map(({ line, reading }) => [line, reading.kind])).toEqual([
      [1, "prose"],
      [3, "read"],
      [5, "read"],
    ]);
    expect(found[2]?.reading).toMatchObject({ command: "cargo test -p engine", bins: [] });
  });

  test("`cargo` inside another word is no occurrence", () => {
    expect(scanCargoOccurrences("`cargo-deny check` `escargo run -p x` `xcargo run`")).toEqual([]);
  });
});

describe("evaluateDocCommands, cargo", () => {
  const cargoConfig: DocCommandsConfig = { ...CONFIG, cargo: "Cargo.toml" };
  const workspace: CargoWorkspace = {
    packages: [{ name: "engine", manifest: "Cargo.toml", bins: ["engine"] }],
    failures: [],
  };
  const judgeCargo = (
    docText: string,
    config: DocCommandsConfig = cargoConfig,
    cargo: CargoWorkspace | null = workspace,
  ) => evaluateDocCommands(MANIFEST, [{ path: DOC, text: docText }], config, cargo);

  test("a resolved cargo command is a held assertion and counts as resolved", () => {
    const { report, volume, unrecognised } = judgeCargo("`cargo run -p engine`");
    expect(report.outcome).toBe("pass");
    expect(unrecognised).toEqual([]);
    expect(volume).toMatchObject({
      cargoPackages: 1,
      cargoOccurrences: 1,
      cargoRead: 1,
      cargoResolved: 1,
      cargoUnresolved: 0,
      cargoUnrecognised: 0,
    });
  });

  test("an unresolved cargo command turns the gate red, with its document, line and reason", () => {
    const { report, volume } = judgeCargo("```\ncargo run -p engine\ncargo test -p gone\n```");
    expect(report.violations).toEqual([
      "docs/a.md:3 cargo test -p gone: cargo test -p gone cannot be resolved: package `gone` is the name of no manifest read",
    ]);
    expect(volume).toMatchObject({ cargoResolved: 1, cargoUnresolved: 1 });
  });

  test("a form that is not recognised is listed and counted apart, never resolved, never a failure", () => {
    const { report, volume, unrecognised } = judgeCargo(
      "`cargo fmt --check` `cargo run -p engine`",
    );
    expect(report.outcome).toBe("pass");
    expect(unrecognised).toEqual(["docs/a.md:1 cargo fmt --check: subcommand `fmt` is not read"]);
    expect(volume).toMatchObject({ cargoRead: 2, cargoResolved: 1, cargoUnrecognised: 1 });
    expect(report.checks.map((check) => check.item)).not.toContain("docs/a.md:1 cargo fmt --check");
    expect(report.volumeSummary).toContain(
      "2 read = 1 resolved + 0 exempted + 0 unresolved + 1 not recognised",
    );
  });

  test("a document that shows only unrecognised forms shows no command", () => {
    const { report } = judgeCargo("`cargo fmt`");
    expect(report.violations).toEqual([
      'docs/a.md: declared but shows no command (0 occurrence(s) of "bun run ", 1 of "cargo ", none read)',
    ]);
  });

  test("an exemption admits an unresolved cargo command, and is stale when it admits none", () => {
    const exempting: DocCommandsConfig = {
      ...cargoConfig,
      exemptions: [{ path: DOC, command: "cargo run -p elsewhere", because: "another repository" }],
    };
    const admitted = judgeCargo("`cargo run -p elsewhere -- now`", exempting);
    expect(admitted.report.outcome).toBe("pass");
    expect(admitted.volume).toMatchObject({ cargoExempted: 1, cargoUnresolved: 0 });
    const stale = judgeCargo("`cargo run -p engine`", exempting);
    expect(stale.report.violations.join("\n")).toContain("stale, remove it");
  });

  test("a cargo command is unresolved when the registry declares no cargo manifest", () => {
    const { report } = judgeCargo("`cargo run -p engine`", CONFIG, null);
    expect(report.violations).toEqual([
      "docs/a.md:1 cargo run -p engine: cargo run -p engine cannot be resolved: the registry declares no cargo manifest",
    ]);
    expect(report.volumeSummary).toContain("no cargo manifest declared");
  });

  test("a bun command is unresolved when the registry declares no package manifest", () => {
    const { manifest: _dropped, ...rustOnly } = cargoConfig;
    const { report } = evaluateDocCommands(
      null,
      [{ path: DOC, text: "`bun run lint` `cargo run -p engine`" }],
      rustOnly,
      workspace,
    );
    expect(report.violations).toEqual([
      "docs/a.md:1 bun run lint: bun run lint cannot be resolved: the registry declares no package manifest",
    ]);
    expect(report.volumeSummary).toContain("no package manifest declared; ");
  });

  test("cargo manifests that could not be read turn the gate red, whatever the documents show", () => {
    const broken: CargoWorkspace = {
      packages: [],
      failures: ["crates/x/Cargo.toml could not be read"],
    };
    expect(judgeCargo("`bun run lint`", cargoConfig, broken).report.violations).toEqual([
      "Cargo.toml: cargo manifests unreadable — crates/x/Cargo.toml could not be read",
    ]);
    expect(judgeCargo("`bun run lint`", cargoConfig, null).report.violations).toEqual([
      "Cargo.toml: cargo manifests unreadable — Cargo.toml was not read",
    ]);
  });

  test("the cargo sums hold on a mixed document, next to the bun ones", () => {
    const exempting: DocCommandsConfig = {
      ...cargoConfig,
      exemptions: [{ path: DOC, command: "cargo test -p far", because: "another repository" }],
    };
    const { volume } = judgeCargo(
      "cargo build in prose `cargo run -p engine` `cargo test -p far` `cargo test -p gone` " +
        "`cargo run -p <crate>` `cargo fmt` `cargo test` `bun run lint` `bun run gone`",
      exempting,
    );
    expect(volume).toMatchObject({
      cargoOccurrences: 7,
      cargoRead: 5,
      cargoPlaceholders: 1,
      cargoBareProse: 1,
      cargoResolved: 1,
      cargoExempted: 1,
      cargoUnresolved: 1,
      cargoUnrecognised: 2,
      occurrences: 2,
      read: 2,
    });
    expect(volume.cargoOccurrences).toBe(
      volume.cargoRead + volume.cargoPlaceholders + volume.cargoBareProse,
    );
    expect(volume.cargoRead).toBe(
      volume.cargoResolved +
        volume.cargoExempted +
        volume.cargoUnresolved +
        volume.cargoUnrecognised,
    );
    expect(volume.read).toBe(volume.resolved + volume.exempted + volume.unresolved);
  });
});

/** A repository written for one test, somewhere that is not this repository. */
function fixtureRoot(files: Readonly<Record<string, string>>): string {
  const scratch = join(tmpdir(), "scratch");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "doc-commands-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const withFixture = async <T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>,
): Promise<T> => {
  const root = fixtureRoot(files);
  try {
    return await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const RUST_FILES: Readonly<Record<string, string>> = {
  "Cargo.toml": '[workspace]\nmembers = ["crates/*", "tools/cli"]\nexclude = ["crates/skipped"]\n',
  "crates/engine/Cargo.toml": '[package]\nname = "fixture-engine"\n',
  "crates/engine/src/main.rs": "fn main() {}\n",
  "crates/engine/src/bin/verify.rs": "fn main() {}\n",
  "crates/engine/src/bin/replay/main.rs": "fn main() {}\n",
  "crates/model/Cargo.toml": '[package]\nname = "fixture-model"\n',
  "crates/model/src/lib.rs": "",
  "crates/skipped/Cargo.toml": '[package]\nname = "fixture-skipped"\n',
  "crates/notes/README.md": "no manifest here\n",
  "tools/cli/Cargo.toml":
    '[package]\nname = "fixture-cli"\nautobins = false\n\n[[bin]]\nname = "fx"\npath = "src/entry.rs"\n',
  "tools/cli/src/main.rs": "fn main() {}\n",
};

describe("loadCargoWorkspace", () => {
  test("reads literal and `<directory>/*` members, their names and their binary targets", async () => {
    const workspace = await withFixture(RUST_FILES, (root) =>
      loadCargoWorkspace(root, "Cargo.toml"),
    );
    expect(workspace.failures).toEqual([]);
    expect(workspace.packages).toEqual([
      {
        name: "fixture-engine",
        manifest: "crates/engine/Cargo.toml",
        bins: ["fixture-engine", "replay", "verify"],
      },
      { name: "fixture-model", manifest: "crates/model/Cargo.toml", bins: [] },
      { name: "fixture-cli", manifest: "tools/cli/Cargo.toml", bins: ["fx"] },
    ]);
  });

  test("a root package is a package, and a path a [[bin]] claims is not discovered twice", async () => {
    const workspace = await withFixture(
      {
        "Cargo.toml":
          '[package]\nname = "solo"\n\n[[bin]]\nname = "renamed"\npath = "src/main.rs"\n',
        "src/main.rs": "fn main() {}\n",
      },
      (root) => loadCargoWorkspace(root, "Cargo.toml"),
    );
    expect(workspace).toEqual({
      packages: [{ name: "solo", manifest: "Cargo.toml", bins: ["renamed"] }],
      failures: [],
    });
  });

  test("an unreadable root, an unreadable member, bad TOML and an unread glob are failures", async () => {
    const cases: readonly [Readonly<Record<string, string>>, string][] = [
      [{ "README.md": "" }, "Cargo.toml could not be read"],
      [{ "Cargo.toml": "[workspace\n" }, "Cargo.toml is not valid TOML"],
      [
        { "Cargo.toml": '[workspace]\nmembers = ["crates/gone"]\n' },
        "crates/gone/Cargo.toml could not be read",
      ],
      [
        { "Cargo.toml": '[workspace]\nmembers = ["crates/a"]\n', "crates/a/Cargo.toml": "[lib]\n" },
        "crates/a/Cargo.toml declares no package name",
      ],
      [
        { "Cargo.toml": '[workspace]\nmembers = ["crates/**/x"]\n' },
        "Cargo.toml: workspace member pattern crates/**/x is not read (only `<directory>/*`)",
      ],
      [
        { "Cargo.toml": '[workspace]\nmembers = ["../sibling"]\n' },
        "Cargo.toml: workspace member ../sibling leaves the repository",
      ],
      [
        { "Cargo.toml": "[workspace]\nmembers = []\n" },
        "Cargo.toml declares neither a package nor a readable workspace member",
      ],
    ];
    for (const [files, failure] of cases) {
      const workspace = await withFixture(files, (root) => loadCargoWorkspace(root, "Cargo.toml"));
      expect(workspace.failures).toEqual([failure]);
    }
  });
});

describe("runDocCommands, against a root that is not this repository", () => {
  const registry = (config: unknown): string => JSON.stringify(config);
  const FLEET_FILES: Readonly<Record<string, string>> = {
    ...RUST_FILES,
    "package.json": JSON.stringify({ scripts: { build: "x" } }),
    "docs/start.md":
      "```sh\nbun run build\ncargo run --locked -p fixture-engine --bin verify -- <file>\ncargo fmt --check\n```\n",
    [CONFIG_PATH]: registry({
      manifest: "package.json",
      cargo: "Cargo.toml",
      documents: [{ path: "docs/start.md", because: "getting started" }],
      exemptions: [],
    }),
  };

  test("green: the registry, the manifests and the documents of that root are the ones read", async () => {
    const result = await withFixture(FLEET_FILES, (root) => runDocCommands(root));
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual([
      "Doc commands: not recognised, counted apart and not resolved — docs/start.md:4 cargo fmt --check: subcommand `fmt` is not read",
      "Doc commands verified: 4 assertion(s) hold — 1 script(s) in package.json; " +
        "1 declared document(s) read, 0 unreadable; " +
        '1 occurrence(s) of "bun run " = 1 read + 0 placeholder(s) + 0 bare prose (neither verified nor a failure); ' +
        "1 read = 1 resolved + 0 exempted + 0 unresolved; " +
        "3 package(s) under Cargo.toml; " +
        '2 occurrence(s) of "cargo " = 2 read + 0 placeholder(s) + 0 bare prose; ' +
        "2 read = 1 resolved + 0 exempted + 0 unresolved + 1 not recognised (counted apart, never as resolved); " +
        "0 exemption(s) declared, 0 stale",
    ]);
  });

  test("red: a command that names a binary the root does not hold, with the counters printed", async () => {
    const files = {
      ...FLEET_FILES,
      "docs/start.md": "`bun run build` `cargo run -p fixture-model --bin verify`",
    };
    const result = await withFixture(files, (root) => runDocCommands(root));
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toStartWith("Doc commands: 1 script(s) in package.json; ");
    expect(result.lines.slice(1)).toEqual([
      "Doc commands: docs/start.md:1 cargo run -p fixture-model --bin verify: cargo run -p fixture-model --bin verify cannot be resolved: binary `verify` is no binary target of the package(s) selected",
      "Doc commands failed: 1 of 4 assertion(s) did not hold.",
    ]);
  });

  test("a registry at another path is read with --registry", async () => {
    const { [CONFIG_PATH]: moved, ...rest } = FLEET_FILES;
    const files = { ...rest, ".github/doc-commands.json": moved as string };
    const result = await withFixture(files, (root) =>
      runDocCommands(root, ".github/doc-commands.json"),
    );
    expect(result.ok).toBe(true);
  });

  test("an absent, unparsable, invalid or escaping registry is a failure, never zero documents", async () => {
    const { [CONFIG_PATH]: _dropped, ...withoutRegistry } = FLEET_FILES;
    const cases: readonly [Readonly<Record<string, string>>, string, string][] = [
      [withoutRegistry, CONFIG_PATH, "could not be read under the root — not zero documents"],
      [{ ...FLEET_FILES, [CONFIG_PATH]: "{ not json" }, CONFIG_PATH, "is not usable: "],
      [{ ...FLEET_FILES, [CONFIG_PATH]: registry({ documents: [] }) }, CONFIG_PATH, "expected {"],
      [FLEET_FILES, "../doc-commands.v1.json", "must be a path inside the root"],
    ];
    for (const [files, path, reason] of cases) {
      const result = await withFixture(files, (root) => runDocCommands(root, path));
      expect(result.ok).toBe(false);
      expect(result.lines.length).toBe(1);
      expect(result.lines[0]).toStartWith("Doc commands failed: registry ");
      expect(result.lines[0]).toContain(reason);
    }
  });

  test("a declared document that is a link out of the root is unreadable, hence a failure", async () => {
    const result = await withFixture(FLEET_FILES, async (root) => {
      const outside = fixtureRoot({ "secret.md": "`bun run build`" });
      try {
        rmSync(join(root, "docs/start.md"));
        symlinkSync(join(outside, "secret.md"), join(root, "docs/start.md"));
        return await runDocCommands(root);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain(
      "docs/start.md: declared document could not be read — a missing file is not zero commands",
    );
  });
});

describe("parseArguments", () => {
  test("an optional root and an optional registry, nothing else", () => {
    expect(parseArguments([])).toEqual({ root: null, registry: CONFIG_PATH });
    expect(parseArguments(["/w", "--registry", "a.json"])).toEqual({
      root: "/w",
      registry: "a.json",
    });
    expect(parseArguments(["--registry", "a.json", "/w"])).toEqual({
      root: "/w",
      registry: "a.json",
    });
    for (const argv of [["/w", "/x"], ["--registry"], ["--registry", "--x"], ["--root", "/w"]]) {
      expect(parseArguments(argv)).toBeNull();
    }
  });
});

describe("the real corpus", () => {
  test("every command the declared documents show names a script of package.json", async () => {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    const config = validateConfig(await Bun.file(join(root, CONFIG_PATH)).json());
    const input = await loadDocCommandsInput(root, config);
    const { report, volume } = evaluateDocCommands(
      input.manifest,
      input.documents,
      config,
      input.cargo,
    );
    expect(volume.cargoOccurrences).toBe(
      volume.cargoRead + volume.cargoPlaceholders + volume.cargoBareProse,
    );
    expect(volume.cargoRead).toBe(
      volume.cargoResolved +
        volume.cargoExempted +
        volume.cargoUnresolved +
        volume.cargoUnrecognised,
    );
    expect(report.violations).toEqual([]);
    expect(volume.declaredRead).toBe(config.documents.length);
    expect(volume.read).toBeGreaterThan(0);
    expect(volume.occurrences).toBe(volume.read + volume.placeholders + volume.bareProse);
    expect(volume.read).toBe(volume.resolved + volume.exempted + volume.unresolved);
  });
});
