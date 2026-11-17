import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Behaviour test of tools/quality/check-shell-lint.sh.
//
// shellcheck itself is not run here: a stand-in launcher records the arguments
// it receives and exits with the code the test chose. What is proved is the
// part this repository owns: which files are handed over, with which options,
// what the exit code of the launcher becomes, and that a missing prerequisite
// is a refusal rather than a pass. The verdict of the real shellcheck image on
// a real finding is proved on a runner only.

const SCRIPT: string = join(import.meta.dir, "check-shell-lint.sh");
const BASH: string = Bun.which("bash") ?? "/bin/bash";
const GIT: string = Bun.which("git") ?? "/usr/bin/git";

const DIGEST: string = "0123456789abcdef".repeat(4);
const IMAGE: string = `example.test/lint/shellcheck@sha256:${DIGEST}`;

const created: string[] = [];

afterAll(() => {
  for (const directory of created) rmSync(directory, { recursive: true, force: true });
});

function scratchDirectory(prefix: string): string {
  const scratch: string = join(tmpdir(), "scratch");
  mkdirSync(scratch, { recursive: true });
  const directory: string = mkdtempSync(join(scratch, prefix));
  created.push(directory);
  return directory;
}

function cleanEnv(): Record<string, string> {
  // A git hook or a CI run exports GIT_DIR / GIT_INDEX_FILE; the probe must
  // measure its own repository, not the ambient one.
  return {
    PATH: process.env.PATH ?? "",
    HOME: tmpdir(),
    GIT_CEILING_DIRECTORIES: join(tmpdir(), "scratch"),
  };
}

function git(root: string, args: readonly string[]): void {
  const result = Bun.spawnSync([GIT, "-C", root, ...args], { env: cleanEnv() });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

/** A git repository whose `tracked` files are added; `untracked` ones are written afterwards. */
function repository(
  tracked: Record<string, string>,
  untracked: Record<string, string> = {},
): string {
  const root: string = scratchDirectory("shell-lint-");
  git(root, ["init", "-q"]);
  const write = (files: Record<string, string>): void => {
    for (const [path, content] of Object.entries(files)) {
      const absolute: string = join(root, path);
      mkdirSync(join(absolute, ".."), { recursive: true });
      writeFileSync(absolute, content);
    }
  };
  write(tracked);
  git(root, ["add", "--", "."]);
  write(untracked);
  return root;
}

interface Launcher {
  /** The executable to hand to SHELLCHECK_BIN, or to find on PATH under the name `docker`. */
  readonly path: string;
  readonly directory: string;
  /** The arguments of the single call, or null when the launcher was never called. */
  readonly calls: () => string[] | null;
}

/** A stand-in launcher: it records its arguments, NUL-separated, and exits with FAKE_EXIT. */
function launcher(name: string = "shellcheck-stand-in"): Launcher {
  const directory: string = scratchDirectory("launcher-");
  const path: string = join(directory, name);
  const record: string = join(directory, "record");
  writeFileSync(path, `#!${BASH}\nprintf '%s\\0' "$@" > '${record}'\nexit "$FAKE_EXIT"\n`);
  chmodSync(path, 0o755);
  return {
    path,
    directory,
    calls: (): string[] | null => {
      if (!existsSync(record)) return null;
      const fields: string[] = readFileSync(record, "utf8").split("\0");
      return fields.slice(0, -1);
    },
  };
}

interface Outcome {
  readonly code: number;
  readonly out: string[];
  readonly err: string;
}

function run(root: string, env: Record<string, string>): Outcome {
  const result = Bun.spawnSync([BASH, SCRIPT], { cwd: root, env: { ...cleanEnv(), ...env } });
  return {
    code: result.exitCode,
    out: new TextDecoder()
      .decode(result.stdout)
      .split("\n")
      .filter((line: string): boolean => line !== ""),
    err: new TextDecoder().decode(result.stderr),
  };
}

const TRACKED: Record<string, string> = {
  "a.sh": "#!/bin/sh\necho a\n",
  "dir/sub/b.sh": "#!/bin/sh\necho b\n",
  "with space.sh": "#!/bin/sh\necho c\n",
  "notes.txt": "not a shell file\n",
  "bin/run": "#!/bin/sh\necho no extension\n",
};
const UNTRACKED: Record<string, string> = { "untracked.sh": "#!/bin/sh\necho u\n" };
const TRACKED_SHELL: readonly string[] = ["a.sh", "dir/sub/b.sh", "with space.sh"];

describe("the verdict follows the launcher", () => {
  test("a launcher that exits 1 (an error-severity finding) makes the script exit 1", () => {
    const fake: Launcher = launcher();
    const outcome: Outcome = run(repository(TRACKED, UNTRACKED), {
      SHELLCHECK_IMAGE: IMAGE,
      SHELLCHECK_BIN: fake.path,
      FAKE_EXIT: "1",
    });
    expect(outcome.code).toBe(1);
    expect(outcome.out).toEqual(["shell files tracked: 3"]);
  });

  test("a launcher that exits 0 makes the script exit 0 and print its counters", () => {
    const fake: Launcher = launcher();
    const outcome: Outcome = run(repository(TRACKED, UNTRACKED), {
      SHELLCHECK_IMAGE: IMAGE,
      SHELLCHECK_BIN: fake.path,
      FAKE_EXIT: "0",
    });
    expect(outcome.code).toBe(0);
    expect(outcome.out).toEqual([
      `shell files tracked: ${TRACKED_SHELL.length}`,
      `shell files checked: ${TRACKED_SHELL.length}`,
      "severity: error",
      `image: ${IMAGE}`,
    ]);
  });

  // shellcheck exits 2 to 4 when it could not process a file or its options,
  // docker 125 to 127 when the container did not run: none of them is a verdict.
  test.each([
    "2",
    "3",
    "4",
    "125",
    "127",
  ])("a launcher that exits %s is no verdict: exit 2", (code) => {
    const fake: Launcher = launcher();
    const outcome: Outcome = run(repository(TRACKED), {
      SHELLCHECK_IMAGE: IMAGE,
      SHELLCHECK_BIN: fake.path,
      FAKE_EXIT: code,
    });
    expect(outcome.code).toBe(2);
    expect(outcome.out).toEqual(["shell files tracked: 3"]);
  });
});

describe("what the launcher is handed", () => {
  test("the one threshold, then every tracked shell file and nothing else", () => {
    const fake: Launcher = launcher();
    run(repository(TRACKED, UNTRACKED), {
      SHELLCHECK_IMAGE: IMAGE,
      SHELLCHECK_BIN: fake.path,
      FAKE_EXIT: "0",
    });
    // Exact equality: no --exclude, no --include, no second severity, no file
    // that is untracked or lacks the extension, a name with a space kept whole.
    expect(fake.calls()).toEqual(["--severity=error", "--", ...TRACKED_SHELL]);
  });

  test("without SHELLCHECK_BIN, the container runs offline on a read-only mount", () => {
    const fake: Launcher = launcher("docker");
    const root: string = repository(TRACKED, UNTRACKED);
    const outcome: Outcome = run(root, {
      SHELLCHECK_IMAGE: IMAGE,
      FAKE_EXIT: "0",
      PATH: `${fake.directory}:${process.env.PATH ?? ""}`,
    });
    expect(outcome.code).toBe(0);
    expect(fake.calls()).toEqual([
      "run",
      "--rm",
      "--network",
      "none",
      "--volume",
      `${realpathSync(root)}:/mnt:ro`,
      "--workdir",
      "/mnt",
      IMAGE,
      "--severity=error",
      "--",
      ...TRACKED_SHELL,
    ]);
  });

  test("without SHELLCHECK_BIN, a container that exits 1 makes the script exit 1", () => {
    const fake: Launcher = launcher("docker");
    const outcome: Outcome = run(repository(TRACKED), {
      SHELLCHECK_IMAGE: IMAGE,
      FAKE_EXIT: "1",
      PATH: `${fake.directory}:${process.env.PATH ?? ""}`,
    });
    expect(outcome.code).toBe(1);
  });
});

describe("the image must be referenced by digest", () => {
  const refused: readonly [string, Record<string, string>][] = [
    ["absent", {}],
    ["empty", { SHELLCHECK_IMAGE: "" }],
    ["the tag latest", { SHELLCHECK_IMAGE: "example.test/lint/shellcheck:latest" }],
    ["a version tag", { SHELLCHECK_IMAGE: "example.test/lint/shellcheck:v0.10.0" }],
    ["no tag at all", { SHELLCHECK_IMAGE: "example.test/lint/shellcheck" }],
    [
      "a digest of 63 hex",
      { SHELLCHECK_IMAGE: `example.test/shellcheck@sha256:${DIGEST.slice(1)}` },
    ],
    ["a digest of 65 hex", { SHELLCHECK_IMAGE: `example.test/shellcheck@sha256:${DIGEST}0` }],
    [
      "an uppercase digest",
      { SHELLCHECK_IMAGE: `example.test/shellcheck@sha256:${DIGEST.toUpperCase()}` },
    ],
    ["another algorithm", { SHELLCHECK_IMAGE: `example.test/shellcheck@sha512:${DIGEST}` }],
    [
      "a tag after the digest",
      { SHELLCHECK_IMAGE: `example.test/shellcheck@sha256:${DIGEST}:latest` },
    ],
    ["a second line", { SHELLCHECK_IMAGE: `example.test/shellcheck:latest\nx@sha256:${DIGEST}` }],
    ["an option in place of the repository", { SHELLCHECK_IMAGE: `--privileged@sha256:${DIGEST}` }],
  ];

  test.each(refused)("%s: exit 2, launcher never called", (_name, image) => {
    const fake: Launcher = launcher();
    const outcome: Outcome = run(repository(TRACKED), {
      ...image,
      SHELLCHECK_BIN: fake.path,
      FAKE_EXIT: "0",
    });
    expect(outcome.code).toBe(2);
    expect(outcome.out).toEqual([]);
    expect(fake.calls()).toBeNull();
  });
});

describe("a repository without any shell file", () => {
  test("exit 0, and it says so: zero tracked, launcher never called", () => {
    const fake: Launcher = launcher();
    const outcome: Outcome = run(repository({ "notes.txt": "x\n" }, UNTRACKED), {
      SHELLCHECK_IMAGE: IMAGE,
      SHELLCHECK_BIN: fake.path,
      FAKE_EXIT: "1",
    });
    expect(outcome.code).toBe(0);
    expect(outcome.out).toEqual([
      "shell files tracked: 0",
      "shell files checked: 0",
      "no tracked shell file: nothing to lint",
    ]);
    expect(fake.calls()).toBeNull();
  });
});

describe("a missing prerequisite is a refusal, never a pass", () => {
  test("SHELLCHECK_BIN that does not exist: exit 2", () => {
    const outcome: Outcome = run(repository(TRACKED), {
      SHELLCHECK_IMAGE: IMAGE,
      SHELLCHECK_BIN: join(scratchDirectory("absent-"), "shellcheck"),
    });
    expect(outcome.code).toBe(2);
    expect(outcome.out).toEqual([]);
  });

  test("no docker on PATH: exit 2", () => {
    const bin: string = scratchDirectory("path-");
    symlinkSync(GIT, join(bin, "git"));
    const outcome: Outcome = run(repository(TRACKED), { SHELLCHECK_IMAGE: IMAGE, PATH: bin });
    expect(outcome.code).toBe(2);
    expect(outcome.err).toContain("launcher not found: docker");
    expect(outcome.out).toEqual([]);
  });

  test("outside a git work tree: exit 2, launcher never called", () => {
    const fake: Launcher = launcher();
    const outcome: Outcome = run(scratchDirectory("bare-"), {
      SHELLCHECK_IMAGE: IMAGE,
      SHELLCHECK_BIN: fake.path,
      FAKE_EXIT: "0",
    });
    expect(outcome.code).toBe(2);
    expect(fake.calls()).toBeNull();
  });

  test("an index that git cannot list: exit 2, not an empty repository", () => {
    const fake: Launcher = launcher();
    const root: string = repository(TRACKED);
    writeFileSync(join(root, ".git", "index"), "not an index\n");
    const outcome: Outcome = run(root, {
      SHELLCHECK_IMAGE: IMAGE,
      SHELLCHECK_BIN: fake.path,
      FAKE_EXIT: "0",
    });
    expect(outcome.code).toBe(2);
    expect(outcome.err).toContain("git ls-files failed");
    expect(fake.calls()).toBeNull();
  });
});

describe("a tracked shell file that cannot be read", () => {
  test("deleted from the work tree: exit 2, launcher never called", () => {
    const fake: Launcher = launcher();
    const root: string = repository(TRACKED);
    rmSync(join(root, "dir/sub/b.sh"));
    const outcome: Outcome = run(root, {
      SHELLCHECK_IMAGE: IMAGE,
      SHELLCHECK_BIN: fake.path,
      FAKE_EXIT: "0",
    });
    expect(outcome.code).toBe(2);
    expect(outcome.out).toEqual(["shell files tracked: 3"]);
    expect(outcome.err).toContain("missing or unreadable: dir/sub/b.sh");
    expect(fake.calls()).toBeNull();
  });

  // The owner bit is ignored for the super-user, who reads every file.
  test.skipIf(process.getuid?.() === 0)("unreadable: exit 2, launcher never called", () => {
    const fake: Launcher = launcher();
    const root: string = repository(TRACKED);
    chmodSync(join(root, "with space.sh"), 0o000);
    const outcome: Outcome = run(root, {
      SHELLCHECK_IMAGE: IMAGE,
      SHELLCHECK_BIN: fake.path,
      FAKE_EXIT: "0",
    });
    chmodSync(join(root, "with space.sh"), 0o644);
    expect(outcome.code).toBe(2);
    expect(outcome.err).toContain("missing or unreadable: with space.sh");
    expect(fake.calls()).toBeNull();
  });
});
