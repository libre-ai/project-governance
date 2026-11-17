import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveEntries } from "./check-identifier-fingerprints";

/**
 * The identifier-fingerprint gate run as a process, against real indexes.
 *
 * WHY A PROCESS. The counters, the read of the data file and the symlink
 * branch live in the effectful half of the module; a unit test that builds the
 * entries itself proves only the pure half.
 *
 * WHY A BUILT REPOSITORY, NOT A COPY OF THIS INDEX. Unlike the data-file
 * inventory, this gate reads file contents from the working tree, and a copied
 * index has none. Each fixture is a small repository whose files are written
 * here, then staged; `git ls-files` reads the index only, so no commit (and no
 * identity) is needed.
 *
 * WHY A SCRUBBED ENVIRONMENT. A child inheriting `GIT_DIR`, `GIT_INDEX_FILE`
 * or a global git config would read another index than the fixture's, and
 * `GATE_VERBOSE` would change the output, so each child gets only what it
 * declares.
 *
 * Every identifier is synthetic.
 */

const MODULE = join(import.meta.dir, "check-identifier-fingerprints.ts");
const ROOT = join(import.meta.dir, "..", "..");
const DATA_PATH = "tools/quality/identifier-fingerprints.v1.json";
const GATE_NAME = "Identifier fingerprints";
const IDENTIFIER = "zzprocess-alpha";

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const CHILD_ENV = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, argv: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: CHILD_ENV,
  });
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(
      `fixture setup failed: git ${argv.join(" ")} — ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(result.stdout);
}

function run(cwd: string, argv: readonly string[] = []): Run {
  const result = Bun.spawnSync(["bun", MODULE, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: CHILD_ENV,
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function dataText(exemptPaths: readonly { path: string; because: string }[] = []): string {
  const { entries } = deriveEntries("tenant", [IDENTIFIER]);
  return `${JSON.stringify({ because: "fixture", entries, exemptPaths }, null, 2)}\n`;
}

interface Fixture {
  readonly files?: Record<string, string | Uint8Array>;
  readonly links?: Record<string, string>;
  readonly data?: string | null;
}

/** A repository holding the given files and links, all staged. */
function repository(name: string, fixture: Fixture): string {
  const path = join(workspace, name);
  git(workspace, ["init", "--quiet", path]);
  const files: Record<string, string | Uint8Array> = {
    "README.txt": "a clean file\n",
    ...(fixture.files ?? {}),
  };
  if (fixture.data !== null) files[DATA_PATH] = fixture.data ?? dataText();
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(path, file, ".."), { recursive: true });
    writeFileSync(join(path, file), content);
  }
  for (const [link, target] of Object.entries(fixture.links ?? {})) {
    symlinkSync(target, join(path, link));
  }
  git(path, ["add", "--all"]);
  return path;
}

function trackedCount(path: string): number {
  return git(path, ["ls-files", "-s", "-z"])
    .split("\0")
    .filter((record) => record !== "").length;
}

function counters(stdout: string): Record<string, number> {
  const values: Record<string, number> = {};
  for (const match of stdout.matchAll(/\b([a-z]+)=(\d+)/g)) {
    values[match[1] ?? ""] = Number(match[2]);
  }
  return values;
}

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "identifier-fingerprints-probe-"));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("the gate on a fixture repository", () => {
  test("a staged symlink is counted, and the five counters sum to git ls-files -s -z", () => {
    const path = repository("summed", {
      files: {
        "docs/exempt.md": `${IDENTIFIER} quoted on purpose\n`,
        "blob.bin": new Uint8Array([0x7a, 0x00, ...new TextEncoder().encode(IDENTIFIER)]),
        "marked.txt": `${IDENTIFIER} allow-identifier-fingerprint\n`,
      },
      links: { "link-to-readme": "README.txt" },
      data: dataText([{ path: "docs/exempt.md", because: "fixture exemption" }]),
    });
    const mode = git(path, ["ls-files", "-s", "--", "link-to-readme"]).slice(0, 6);
    if (mode !== "120000") throw new Error(`fixture setup failed: the link has mode ${mode}`);

    const result = run(path);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${GATE_NAME} verified:`);
    const count = counters(result.stdout);
    const tracked = trackedCount(path);
    expect(count.tracked).toBe(tracked);
    expect(
      (count.examined ?? -1) +
        (count.exempt ?? -1) +
        (count.binary ?? -1) +
        (count.symlink ?? -1) +
        (count.other ?? -1),
    ).toBe(tracked);
    expect(count).toMatchObject({ symlink: 1, exempt: 1, binary: 1, examined: 3, other: 0 });
    expect(result.stdout).toContain("marker lines=1");
    expect(result.stdout).toContain(
      "fingerprints=1 (tenant=1, group=0, person=0, provider=0, reference=0)",
    );
  });

  test("a listed identifier in a file exits 1 with position, class and action only", () => {
    const path = repository("found", { files: { "notes/a.txt": `x\nhost ZZPROCESS.alpha\n` } });
    const result = run(path);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `${GATE_NAME}: notes/a.txt:2:6: tenant — move this content to the repository of that organization`,
    );
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).not.toContain("zzprocess");
  });

  test("a symlink target carrying a listed identifier exits 1", () => {
    const path = repository("link-target", { links: { pointer: `../${IDENTIFIER}/x` } });
    const result = run(path);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${GATE_NAME}: pointer:1:4: tenant`);
  });

  test("an absent data file exits 1 and names the expected path", () => {
    const path = repository("absent", { data: null });
    const result = run(path);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${GATE_NAME}: ${DATA_PATH}: the data file is absent`);
  });

  test("an exempt path absent from the index exits 1", () => {
    const path = repository("stale-exemption", {
      data: dataText([{ path: "docs/gone.md", because: "the file left the tree" }]),
    });
    const result = run(path);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${GATE_NAME}: ${DATA_PATH}: exemptPaths[0]: untracked`);
  });

  test("an exempt path naming a symlink exits 1: it would exempt nothing", () => {
    const path = repository("exempt-link", {
      links: { "link-to-readme": "README.txt" },
      data: dataText([{ path: "link-to-readme", because: "a link" }]),
    });
    const result = run(path);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${DATA_PATH}: exemptPaths[0]: not-a-file`);
  });

  test("an exempt path naming a code file exits 1: exemptions are data files only", () => {
    const path = repository("exempt-code", {
      files: { "tools/quote.ts": `export const x = "${IDENTIFIER}";\n` },
      data: dataText([{ path: "tools/quote.ts", because: "quoted on purpose" }]),
    });
    const result = run(path);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${DATA_PATH}: exemptPaths[0]: not-data`);
  });
});

describe("the gate on this repository", () => {
  test("exits 0 with the delivered data file", () => {
    const result = run(ROOT);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${GATE_NAME} verified:`);
  });
});

describe("--derive", () => {
  test("a source list outside every repository prints the entries", () => {
    const list = join(workspace, "outside-list.txt");
    writeFileSync(list, `${IDENTIFIER}\n`);
    const result = run(workspace, ["--derive", "tenant", list]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(deriveEntries("tenant", [IDENTIFIER]).entries);
  });

  test("a source list under the root of this repository is refused, nothing on stdout", () => {
    const result = run(workspace, ["--derive", "tenant", join(ROOT, "package.json")]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("refuses a source list inside a repository tree");
  });

  test("a source list inside the repository of the current directory is refused", () => {
    const path = repository("derive-cwd", {});
    const list = join(path, "list.txt");
    writeFileSync(list, `${IDENTIFIER}\n`);
    const result = run(path, ["--derive", "tenant", list]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  test("a source list inside another repository than the current one is refused", () => {
    // The current directory is outside every repository, and the list lives in
    // a repository that is neither this one nor the current directory's.
    const other = repository("derive-other", {});
    mkdirSync(join(other, "nested"), { recursive: true });
    const list = join(other, "nested", "list.txt");
    writeFileSync(list, `${IDENTIFIER}\n`);
    const result = run(workspace, ["--derive", "tenant", list]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("refuses a source list inside a repository tree");
  });

  test("a refused identifier is named by its line number, nothing on stdout", () => {
    const list = join(workspace, "short-list.txt");
    writeFileSync(list, `${IDENTIFIER}\nzz\n`);
    const result = run(workspace, ["--derive", "tenant", list]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--derive: line 2: fewer than 4 characters");
  });
});
