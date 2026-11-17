import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkPitfalls,
  checkPitfallsFile,
  parsePitfalls,
  readRepositoryNames,
} from "./toolchain-pitfalls";

const ROOT = join(import.meta.dir, "..", "..");
const DOCUMENT = "docs/toolchain/PITFALLS.md";
const SELF = "tools/quality/toolchain-pitfalls.test.ts";
const OSV_TESTS = ".github/composition/test_download_advisory_database.py";

const HEADER = "| Symptôme | Cause | Parade |";
const RULE = "| --- | --- | --- |";

// The child sees no ambient configuration: a global hooks path, a signing key
// or a locale of the host would make the witnesses measure the host.
const CLEAN_ENV = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  LC_ALL: "C",
};

interface Outcome {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function run(command: string[], cwd: string = ROOT): Outcome {
  const child = Bun.spawnSync(command, {
    cwd,
    env: CLEAN_ENV,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: child.exitCode, out: child.stdout.toString(), err: child.stderr.toString() };
}

function withScratch<T>(body: (scratch: string) => T): T {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "pitfalls-")));
  try {
    return body(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const real = readFileSync(join(ROOT, DOCUMENT), "utf8");
const tracked: ReadonlySet<string> = new Set(
  run(["git", "ls-files"]).out.split("\n").filter(Boolean),
);
const indexText = readFileSync(join(ROOT, "ecosystem/repositories.v1.yaml"), "utf8");
const names = readRepositoryNames(indexText);

/** A substitution that must change the text: a no-op mutation proves nothing. */
function mutate(text: string, from: string, to: string): string {
  expect(text.split(from).length - 1).toBe(1);
  return text.replace(from, to);
}

/** A one-table document; its first row is on line 7. */
function sample(rows: string[], header: string = HEADER, rule: string = RULE): string {
  return ["# Title", "", "## shell", "", header, rule, ...rows, ""].join("\n");
}

const WITNESS = `Témoin : \`${SELF}\``;
const check = (text: string) =>
  checkPitfalls(text, tracked, ["acme/widget-factory", "widget-factory"]);

describe("the catalogue as written", () => {
  const entries = parsePitfalls(real);

  test("carries 9 entries, 5 shell, 3 osv-scanner, 1 bun, every cell filled", () => {
    expect(entries.length).toBe(9);
    expect(entries.map((entry) => entry.family)).toEqual([
      ...Array<string>(5).fill("shell"),
      ...Array<string>(3).fill("osv-scanner"),
      "bun",
    ]);
    for (const entry of entries) {
      expect(entry.symptom).not.toBe("");
      expect(entry.cause).not.toBe("");
      expect(entry.remedy).not.toBe("");
      expect(entry.remedy).not.toContain("Témoin");
    }
  });

  test("cites only tracked test paths: this file, and the osv downloader tests", () => {
    expect(tracked.size).toBeGreaterThan(0);
    expect(entries.map((entry) => entry.testPath)).toEqual([
      ...Array<string>(5).fill(SELF),
      ...Array<string>(3).fill(OSV_TESTS),
      SELF,
    ]);
    for (const entry of entries) expect(tracked.has(entry.testPath)).toBe(true);
  });

  test("names the osv cases, and each of them exists in the cited file", () => {
    const suite = readFileSync(join(ROOT, OSV_TESTS), "utf8");
    for (const name of [
      "test_scanner_that_writes_nothing_is_not_a_green_even_with_a_stale_file",
      "test_empty_database_file_is_refused",
      "test_scanner_failure_fails_closed",
    ]) {
      expect(real).toContain(`\`${name}\``);
      expect(suite).toContain(`def ${name}(self)`);
    }
  });

  test("holds against the tracked tree and the repository index: 9 entries, no violation", () => {
    expect(names.length).toBeGreaterThan(0);
    expect(checkPitfalls(real, tracked, names)).toEqual({ entries: 9, violations: [] });
  });

  test("the command prints entries examined and violations, and fails on an unreadable document", () => {
    const pass = run([process.execPath, "tools/quality/toolchain-pitfalls.ts"]);
    expect(pass.out).toContain(`9 entr(ies) examined in ${DOCUMENT}`);
    expect(pass.out).toContain("0 violation(s)");
    expect(pass.code).toBe(0);

    const absent = run([process.execPath, "tools/quality/toolchain-pitfalls.ts", "docs/ABSENT.md"]);
    expect(absent.code).toBe(1);
    expect(absent.err).toContain("docs/ABSENT.md: unreadable");
    expect(absent.err).toContain("0 entr(ies) examined in docs/ABSENT.md");
    expect(absent.err).toContain("1 violation(s)");
  });

  test("the command fails on sources it cannot read: no tracked tree, no repository index", () => {
    withScratch((scratch) => {
      const outside = run(
        [process.execPath, join(ROOT, "tools/quality/toolchain-pitfalls.ts")],
        scratch,
      );
      expect(outside.code).toBe(1);
      expect(outside.out).toBe("");
      expect(outside.err).toContain("Toolchain pitfalls: git ls-files: exit ");
      expect(outside.err).toContain("ecosystem/repositories.v1.yaml: unreadable");
      expect(outside.err).toContain(`${DOCUMENT}: unreadable`);
      expect(outside.err).toContain("against 0 tracked path(s) and 0 repository name(s)");
    });
  });
});

describe("mutations of the catalogue", () => {
  test("a renamed test path is not tracked", () => {
    const mutated = real.replaceAll(OSV_TESTS, ".github/composition/test_renamed.py");
    expect(mutated).not.toBe(real);
    const result = checkPitfalls(mutated, tracked, names);
    expect(result.entries).toBe(9);
    expect(result.violations.length).toBe(3);
    for (const violation of result.violations) {
      expect(violation).toMatch(
        /^line \d+: test path \.github\/composition\/test_renamed\.py is not tracked by git$/,
      );
    }
  });

  test("a remedy removed from a row leaves no remedy before the test path", () => {
    const mutated = mutate(real, "Chercher une chaîne littérale avec `grep -F`. ", "");
    const line =
      mutated.split("\n").findIndex((text) => text.startsWith("| `grep` ne trouve pas")) + 1;
    expect(line).toBeGreaterThan(0);
    expect(checkPitfalls(mutated, tracked, names)).toEqual({
      entries: 8,
      violations: [`line ${line}: the Parade cell has no remedy before its test path`],
    });
  });

  test("the bun row cannot take bunfig.toml as its witness", () => {
    const bun = parsePitfalls(real).at(-1);
    expect(bun?.family).toBe("bun");
    expect(bun?.testPath).toBe(SELF);
    const row = real.split("\n")[(bun?.line ?? 0) - 1] ?? "";
    expect(row).toContain("`bunfig.toml`");
    const mutated = real.replace(row, row.replace(`\`${SELF}\``, "`bunfig.toml`"));
    expect(checkPitfalls(mutated, tracked, names)).toEqual({
      entries: 8,
      violations: [`line ${bun?.line}: the Parade cell cites no test path in a code span`],
    });
  });

  test("a repository name of the index is refused, qualified or bare", () => {
    const [qualified = "", bare = ""] = names;
    expect(qualified).toContain("/");
    expect(qualified.endsWith(`/${bare}`)).toBe(true);
    const lines = real.split("\n").length;
    expect(checkPitfalls(`${real}Voir ${qualified}.\n`, tracked, names).violations).toEqual([
      `line ${lines}: names the repository ${qualified}`,
    ]);
    expect(checkPitfalls(`${real}Voir ${bare}.\n`, tracked, names).violations).toEqual([
      `line ${lines}: names the repository ${bare}`,
    ]);
  });

  test("a host name, an address, a URL and a machine-local path are refused", () => {
    const lines = real.split("\n").length;
    const host = `line ${lines}: carries a host name, an address or a URL`;
    for (const intruder of ["forge.example.com", "192.0.2.7", "ssh://runner"]) {
      expect(checkPitfalls(`${real}Joindre ${intruder}\n`, tracked, names).violations).toEqual([
        host,
      ]);
    }
    const local = ["", "Users", "someone", "work"].join("/");
    expect(checkPitfalls(`${real}Dans ${local}\n`, tracked, names).violations).toEqual([
      `line ${lines}: carries a machine-local path`,
    ]);
  });
});

describe("structure of a table", () => {
  test("a well-formed row is one entry, read at its line", () => {
    const text = sample([`| It breaks. | Because. | Do this. ${WITNESS} |`]);
    expect(parsePitfalls(text)).toEqual([
      {
        family: "shell",
        symptom: "It breaks.",
        cause: "Because.",
        remedy: "Do this.",
        testPath: SELF,
        line: 7,
      },
    ]);
    expect(check(text)).toEqual({ entries: 1, violations: [] });
  });

  test("a remedy without a test path, and an empty remedy, are named with their line", () => {
    expect(check(sample(["| It breaks. | Because. | Do this. |"]))).toEqual({
      entries: 0,
      violations: ["line 7: the Parade cell cites no test path in a code span"],
    });
    expect(check(sample(["| It breaks. | Because. |  |"]))).toEqual({
      entries: 0,
      violations: ["line 7: empty cell(s): Parade"],
    });
    expect(
      check(sample([`| It breaks. | Because. | Do this. ${WITNESS} and \`a/b.spec.ts\` |`])),
    ).toEqual({
      entries: 0,
      violations: ["line 7: the Parade cell cites 2 test paths, expected exactly one"],
    });
  });

  test("a test path that git does not track is refused", () => {
    const text = sample(["| It breaks. | Because. | Do this. Témoin : `tools/absent.test.ts` |"]);
    expect(check(text)).toEqual({
      entries: 1,
      violations: ["line 7: test path tools/absent.test.ts is not tracked by git"],
    });
  });

  test("the header is exact, and every row has three columns", () => {
    const row = `| It breaks. | Because. | Do this. ${WITNESS} |`;
    const header = `line 5: table header is not exactly '${HEADER}'`;
    expect(check(sample([`${row} note |`], `${HEADER} Note |`, `${RULE} --- |`))).toEqual({
      entries: 0,
      violations: [header],
    });
    expect(check(sample([row], "| Symptome | Cause | Parade |")).violations).toEqual([header]);
    expect(check(sample([row], "| Cause | Symptôme | Parade |")).violations).toEqual([header]);
    expect(check(sample([`${row} note |`])).violations).toEqual([
      "line 7: row has 4 column(s), expected 3",
    ]);
    expect(check(sample([`| Because. | Do this. ${WITNESS} |`])).violations).toEqual([
      "line 7: row has 2 column(s), expected 3",
    ]);
    expect(check(sample([row], HEADER, "| --- | --- |")).violations).toEqual([
      "line 6: table has no three-column rule under its header",
    ]);
  });

  test("no table, no row, no family and an unreadable document are violations, never zero entries in green", async () => {
    expect(check("# Title\n\nProse only.\n")).toEqual({
      entries: 0,
      violations: ["document: no pitfall table"],
    });
    expect(check("")).toEqual({ entries: 0, violations: ["document: no pitfall table"] });
    expect(check(sample([]))).toEqual({ entries: 0, violations: ["line 5: table has no row"] });
    expect(check([HEADER, RULE, `| a | b | c ${WITNESS} |`, ""].join("\n"))).toEqual({
      entries: 0,
      violations: ["line 1: table has no family heading above it"],
    });
    const undecodable = `${real}${String.fromCharCode(0xfffd)}\n`;
    expect(checkPitfalls(undecodable, tracked, names)).toEqual({
      entries: 0,
      violations: ["document: unreadable (NUL or undecodable byte)"],
    });
    expect(checkPitfalls(`${real}${String.fromCharCode(0)}\n`, tracked, names)).toEqual({
      entries: 0,
      violations: ["document: unreadable (NUL or undecodable byte)"],
    });
    const absent = await checkPitfallsFile(join(ROOT, "docs/ABSENT.md"), tracked, names);
    expect(absent.entries).toBe(0);
    expect(absent.violations.length).toBe(1);
    expect(absent.violations[0]).toContain("docs/ABSENT.md: unreadable");
    expect(await checkPitfallsFile(join(ROOT, DOCUMENT), tracked, names)).toEqual({
      entries: 9,
      violations: [],
    });
  });

  test("a row is closed by a bar, and an escaped bar stays inside its cell", () => {
    expect(check(sample([`| It breaks. | Because. | Do this. ${WITNESS}`]))).toEqual({
      entries: 0,
      violations: ["line 7: table row is not closed by a vertical bar"],
    });
    const escaped = parsePitfalls(sample([`| a \\| b | Because. | Do this. ${WITNESS} |`]));
    expect(escaped.map((entry) => entry.symptom)).toEqual(["a | b"]);
  });

  test("a comparison against nothing is a violation", () => {
    const text = sample([`| It breaks. | Because. | Do this. ${WITNESS} |`]);
    expect(checkPitfalls(text, new Set<string>(), ["acme/widget-factory"]).violations).toEqual([
      "document: the set of tracked paths is empty",
      `line 7: test path ${SELF} is not tracked by git`,
    ]);
    expect(checkPitfalls(text, tracked, []).violations).toEqual([
      "document: no repository name to refuse",
    ]);
  });

  test("a bare repository name is refused as a word, not as a path segment", () => {
    const row = `| It breaks. | Because. | Do this. ${WITNESS} |`;
    const only = (text: string) => checkPitfalls(text, tracked, ["acme/tools", "tools"]).violations;
    expect(only(sample([row]))).toEqual([]);
    expect(only(sample([row, "", "The Tools repository."]))).toEqual([
      "line 9: names the repository tools",
    ]);
    expect(only(sample([row, "", "See acme/tools."]))).toEqual([
      "line 9: names the repository acme/tools",
    ]);
    expect(only(sample([row, "", "See acme/tools/README."]))).toEqual([
      "line 9: names the repository acme/tools",
    ]);
  });
});

describe("repository names of the index", () => {
  test("every declared repository is read, qualified and bare", () => {
    const declared = indexText.split("\n").filter((line) => /^\s+- repository: \S/.test(line));
    expect(declared.length).toBeGreaterThan(0);
    expect(names.length).toBe(declared.length * 2);
    expect(readRepositoryNames("repositories:\n  - repository: acme/widget\n")).toEqual([
      "acme/widget",
      "widget",
    ]);
  });

  test("an index without the expected shape throws instead of reading as no name", () => {
    expect(() => readRepositoryNames("repositories: []\n")).toThrow("no non-empty");
    expect(() => readRepositoryNames("other: 1\n")).toThrow("no non-empty");
    expect(() => readRepositoryNames("repositories:\n  - repository: widget\n")).toThrow(
      "entry 1 has no 'owner/name'",
    );
    expect(() => readRepositoryNames("repositories:\n  - card: x\n")).toThrow("entry 1");
    expect(() => readRepositoryNames(`repositories: []${String.fromCharCode(0)}\n`)).toThrow("NUL");
  });
});

describe("witnesses of the shell family", () => {
  test("1: grep -F finds a string that grep reads as a regular expression and misses", () => {
    // Joined so that no string of this file reads as a template placeholder.
    const needle = ["$", "{ITEMS[0]}"].join("");
    withScratch((scratch) => {
      const file = join(scratch, "script.sh");
      writeFileSync(file, `echo "${needle}"\n`);
      const literal = run(["grep", "-F", "-c", needle, file]);
      expect(literal.out.trim()).toBe("1");
      expect(literal.code).toBe(0);
      const regular = run(["grep", "-c", needle, file]);
      expect(regular.out.trim()).toBe("0");
      expect(regular.code).toBe(1);
    });
  });

  test("2: an assignment made behind a pipe is lost; a redirection keeps it", () => {
    const tally = "count=0\ntally() { while IFS= read -r _; do count=$((count + 1)); done; }\n";
    withScratch((scratch) => {
      const file = join(scratch, "lines.txt");
      writeFileSync(file, "a\nb\nc\n");
      const piped = run(["bash", "-c", `${tally}cat "$1" | tally\necho "$count"`, "bash", file]);
      expect(piped).toEqual({ code: 0, out: "0\n", err: "" });
      const redirected = run(["bash", "-c", `${tally}tally < "$1"\necho "$count"`, "bash", file]);
      expect(redirected).toEqual({ code: 0, out: "3\n", err: "" });
      const substituted = run([
        "bash",
        "-c",
        `${tally}tally < <(cat "$1")\necho "$count"`,
        "bash",
        file,
      ]);
      expect(substituted).toEqual({ code: 0, out: "3\n", err: "" });
    });
  });

  test("3: a success message after a failed check runs unguarded, and not when guarded", () => {
    expect(run(["bash", "-c", "false; echo verified"])).toEqual({
      code: 0,
      out: "verified\n",
      err: "",
    });
    expect(run(["bash", "-c", "false && echo verified"])).toEqual({ code: 1, out: "", err: "" });
    expect(run(["bash", "-c", "set -e; false; echo verified"])).toEqual({
      code: 1,
      out: "",
      err: "",
    });
  });

  test("4: git worktree add with an absolute path lands where intended, outside the main repository", () => {
    withScratch((scratch) => {
      const repository = join(scratch, "repository");
      const inside = join(repository, "inside");
      mkdirSync(inside, { recursive: true });
      for (const command of [
        ["git", "init", "-q"],
        ["git", "config", "user.name", "t"],
        ["git", "config", "user.email", "t@t"],
        ["git", "commit", "-q", "--allow-empty", "-m", "base"],
      ]) {
        expect(run(command, repository).code).toBe(0);
      }
      const before = readdirSync(repository).sort();

      const intended = join(scratch, "absolute");
      expect(run(["git", "worktree", "add", "-q", intended], inside).code).toBe(0);
      const listed = run(["git", "worktree", "list", "--porcelain"], repository)
        .out.split("\n")
        .filter((line) => line.startsWith("worktree "));
      expect(listed).toEqual([`worktree ${repository}`, `worktree ${intended}`]);
      expect(readdirSync(repository).sort()).toEqual(before);
      expect(readdirSync(inside)).toEqual([]);

      // The pitfall itself: the same command with a relative path follows the
      // current directory, here into the main repository.
      expect(run(["git", "worktree", "add", "-q", "relative"], inside).code).toBe(0);
      expect(existsSync(join(scratch, "relative"))).toBe(false);
      expect(readdirSync(inside)).toEqual(["relative"]);
    });
  });

  test("5: editing through a temporary file gives the expected content on this host", () => {
    withScratch((scratch) => {
      const file = join(scratch, "settings.txt");
      writeFileSync(file, "value=old\n");
      const remedy = `sed 's/old/new/' "$1" > "$1.tmp" && mv "$1.tmp" "$1"`;
      expect(run(["bash", "-c", remedy, "bash", file])).toEqual({ code: 0, out: "", err: "" });
      expect(readFileSync(file, "utf8")).toBe("value=new\n");
      expect(readdirSync(scratch)).toEqual(["settings.txt"]);

      // The pitfall itself: no host accepts both spellings of the in-place form.
      const edited = (name: string, flags: string[]): boolean => {
        const copy = join(scratch, name);
        writeFileSync(copy, "value=old\n");
        const child = run(["sed", ...flags, "s/old/new/", copy]);
        return child.code === 0 && readFileSync(copy, "utf8") === "value=new\n";
      };
      const separate = edited("separate.txt", ["-i", ""]);
      const attached = edited("attached.txt", ["-i"]);
      expect(separate && attached).toBe(false);
    });
  });
});

describe("witness of the bun family", () => {
  test("bunfig.toml holds a three-day minimum release age and an empty exclusion list", () => {
    const parsed: unknown = Bun.TOML.parse(readFileSync(join(ROOT, "bunfig.toml"), "utf8"));
    expect(parsed).toHaveProperty("install.minimumReleaseAge", 259200);
    expect(parsed).toHaveProperty("install.minimumReleaseAgeExcludes", []);
  });
});
