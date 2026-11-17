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
  countPitfalls,
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

  test("names the osv cases, and every case it cites exists in the cited file", () => {
    const suite = readFileSync(join(ROOT, OSV_TESTS), "utf8");
    const cited = [...real.matchAll(/`(test_\w+)`/g)].map((match) => match[1] ?? "");
    expect(cited).toEqual([
      "test_scanner_that_writes_nothing_is_not_a_green_even_with_a_stale_file",
      "test_empty_database_file_is_refused",
      "test_file_not_written_by_this_run_is_refused",
      "test_scanner_failure_fails_closed",
    ]);
    for (const name of cited) expect(suite).toContain(`def ${name}(self)`);
  });

  test("holds against the tracked tree and the repository index: 9 entries, no violation", () => {
    expect(names.length).toBeGreaterThan(0);
    expect(checkPitfalls(real, tracked, names)).toEqual({ entries: 9, violations: [] });
  });

  test("the command prints entries examined and violations, and fails on an unreadable document", () => {
    const pass = run([process.execPath, "tools/quality/toolchain-pitfalls.ts"]);
    expect(pass.out).toContain(`9 entr(ies) examined in ${DOCUMENT}`);
    expect(pass.out).toContain("0 violation(s)");
    expect(pass.out).toContain("(tables=3 rows=9 entries=9 rejected=0)");
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
  // A line appended after a blank line: the document ends on a table row, and
  // a line directly under it would be read as a table line out of form.
  const appended = (line: string): string => `${real}\n${line}\n`;
  const lastLine = real.split("\n").length + 1;

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
    // A qualified name also carries its bare name after the slash.
    expect(checkPitfalls(appended(`Voir ${qualified}.`), tracked, names).violations).toContain(
      `line ${lastLine}: names the repository ${qualified}`,
    );
    expect(checkPitfalls(appended(`Voir ${qualified}.`), tracked, names).violations).toContain(
      `line ${lastLine}: names the repository ${bare}`,
    );
    expect(checkPitfalls(appended(`Voir ${bare}.`), tracked, names).violations).toEqual([
      `line ${lastLine}: names the repository ${bare}`,
    ]);
  });

  test("a host name, an address, a URL and a machine-local path are refused", () => {
    const host = `line ${lastLine}: carries a host name, an address or a URL`;
    for (const intruder of ["forge.example.com", "192.0.2.7", "ssh://runner"]) {
      expect(checkPitfalls(appended(`Joindre ${intruder}`), tracked, names).violations).toEqual([
        host,
      ]);
    }
    const local = ["", "Users", "someone", "work"].join("/");
    expect(checkPitfalls(appended(`Dans ${local}`), tracked, names).violations).toEqual([
      `line ${lastLine}: carries a machine-local path`,
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
    // With no tracked extension, every dotted name reads as a host.
    expect(checkPitfalls(text, new Set<string>(), ["acme/widget-factory"]).violations).toEqual([
      "document: the set of tracked paths is empty",
      `line 7: test path ${SELF} is not tracked by git`,
      "line 7: carries a host name, an address or a URL",
    ]);
    expect(checkPitfalls(text, tracked, []).violations).toEqual([
      "document: no repository name to refuse",
    ]);
  });

  test("a bare repository name is refused as a word, and a tracked path that holds it is not", () => {
    const row = `| It breaks. | Because. | Do this. ${WITNESS} |`;
    const only = (text: string) => checkPitfalls(text, tracked, ["acme/tools", "tools"]).violations;
    expect(only(sample([row]))).toEqual([]);
    expect(only(sample([row, "", "The Tools repository."]))).toEqual([
      "line 9: names the repository tools",
    ]);
    expect(only(sample([row, "", "See acme/tools."]))).toEqual([
      "line 9: names the repository acme/tools",
      "line 9: names the repository tools",
    ]);
    expect(only(sample([row, "", "See acme/tools/README."]))).toEqual([
      "line 9: names the repository acme/tools",
      "line 9: names the repository tools",
    ]);
  });
});

describe("lines a renderer reads as a table", () => {
  const row = `| It breaks. | Because. | Do this. ${WITNESS} |`;
  const outOfForm = (at: number) => `line ${at}: table line out of form`;

  test("a line under a table, without a blank line, is a table line out of form", () => {
    expect(check(sample([row, "A failure | no cause | no witness"]))).toEqual({
      entries: 1,
      violations: [outOfForm(8)],
    });
    expect(check(sample([row, "  | It breaks. | Because. | Do this. |"]))).toEqual({
      entries: 1,
      violations: [outOfForm(8)],
    });
    // A renderer keeps the table open until a blank line: a bar is not needed.
    expect(check(sample([row, "Trailing prose", row]))).toEqual({
      entries: 2,
      violations: [outOfForm(8)],
    });
  });

  test("an indented table and a table without outer bars are out of form", () => {
    const indented = ["## shell", "", `  ${HEADER}`, `  ${RULE}`, `  ${row}`, ""].join("\n");
    expect(check(indented).violations).toEqual([
      outOfForm(3),
      outOfForm(4),
      outOfForm(5),
      "document: no pitfall table",
    ]);
    const bare = ["## shell", "", "Symptôme | Cause | Parade", "--- | --- | ---", "a | b | c", ""];
    expect(check(bare.join("\n")).violations).toEqual([outOfForm(4), "document: no pitfall table"]);
  });

  test("a table under a heading that is not a family of the catalogue is refused", () => {
    expect(check(sample([row]).replace("## shell", "## docker"))).toEqual({
      entries: 0,
      violations: ["line 5: family 'docker' is not one of shell, osv-scanner, bun"],
    });
  });

  test("counts tables, rows, entries and rejected rows, and the counts sum", () => {
    const counts = countPitfalls(sample([row, "| a | b |", "x | y"]));
    expect(counts).toEqual({ tables: 1, rows: 3, entries: 1, rejected: 2 });
    expect(countPitfalls(real)).toEqual({ tables: 3, rows: 9, entries: 9, rejected: 0 });
  });
});

describe("host forms beyond a closed list of suffixes", () => {
  test("every host form is refused with the tracked tree of this repository", () => {
    const lines = real.split("\n").length + 1;
    for (const intruder of [
      "forge.example.de",
      "host.ch",
      "git.example.co.uk",
      "runner.corp",
      "localhost",
      "localhost:8080",
      "runner:8443",
    ]) {
      expect(checkPitfalls(`${real}\nJoindre ${intruder}\n`, tracked, names).violations).toEqual([
        `line ${lines}: carries a host name, an address or a URL`,
      ]);
    }
  });

  test("a file name whose suffix is a tracked extension is not a host", () => {
    const lines = ["", "See `bunfig.toml`, `a/b.test.ts`, -i.bak, 1.4.0 and 12:30."];
    expect(check(sample([`| It breaks. | Because. | Do this. ${WITNESS} |`, ...lines]))).toEqual({
      entries: 1,
      violations: [],
    });
  });
});

describe("bare repository names next to a slash or a dot", () => {
  const only = (text: string) =>
    checkPitfalls(text, tracked, ["acme/tools", "tools", "acme/.github", ".github"]).violations;
  const row = `| It breaks. | Because. | Do this. ${WITNESS} |`;

  test("a bare name before a slash or after a slash or a dot is counted", () => {
    expect(only(sample([row, "", "Clone tools/ first."]))).toEqual([
      "line 9: names the repository tools",
    ]);
    expect(only(sample([row, "", "See fork/tools here."]))).toEqual([
      "line 9: names the repository tools",
    ]);
    expect(only(sample([row, "", "See .tools here."]))).toEqual([
      "line 9: names the repository tools",
    ]);
    expect(only(sample([row, "", "See .github/ here."]))).toEqual([
      "line 9: names the repository .github",
    ]);
  });

  test("a name that prefixes a tracked path cited in a code span is not counted", () => {
    const context = `Context: \`${OSV_TESTS}\`, \`tools/quality\` and \`tools/quality/new.ts\`.`;
    expect(only(sample([row, "", context]))).toEqual([]);
    expect(only(sample([row, "", "Elsewhere: `fork/tools/run.sh`."]))).toEqual([
      "line 9: names the repository tools",
    ]);
    expect(only(sample([row, "", "Elsewhere: `tools`."]))).toEqual([]);
    expect(only(sample([row, "", "Elsewhere: `tools` and tools."]))).toEqual([
      "line 9: names the repository tools",
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

      // The pitfall itself: no host accepts both spellings of the in-place form
      // that leave no backup file behind.
      const edited = (name: string, flags: string[]): boolean => {
        const copy = join(scratch, name);
        writeFileSync(copy, "value=old\n");
        const child = run(["sed", ...flags, "s/old/new/", copy]);
        return child.code === 0 && readFileSync(copy, "utf8") === "value=new\n";
      };
      const separate = edited("separate.txt", ["-i", ""]);
      const attached = edited("attached.txt", ["-i"]);
      expect(separate && attached).toBe(false);

      // The form with an attached suffix holds on both, at the cost of a
      // backup file that has to be removed afterwards.
      expect(edited("suffixed.txt", ["-i.bak"])).toBe(true);
      expect(readFileSync(join(scratch, "suffixed.txt.bak"), "utf8")).toBe("value=old\n");

      // The catalogue offers the form this witness shows to hold.
      const row = parsePitfalls(real).find((entry) => entry.symptom.includes("`sed -i`"));
      expect(row?.remedy).toContain("`sed -i.bak");
      expect(row?.cause).not.toContain("BSD exige");
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
