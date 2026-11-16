import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The federated decision-series gate, run as a process against fixture trees.
 *
 * The expectations come from the brief, not from the gate's output: every ADR
 * of every declared series sits in its series table; a declared repository that
 * cannot be read is a failure; the series is read from the checked-out tree
 * (the pull request), never from the default branch; links are relative to the
 * repository carrying the series, without a host.
 *
 * Each child gets a declared environment only, so an inherited `GIT_DIR` or a
 * global git configuration cannot change what the fixture means.
 */

const GATE = join(import.meta.dir, "check-decision-series.ts");

const ENVIRONMENT = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

interface Run {
  readonly exitCode: number;
  readonly output: string;
}

function run(argv: readonly string[], cwd: string): Run {
  const result = Bun.spawnSync([...argv], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: ENVIRONMENT,
  });
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return {
    exitCode: result.exitCode ?? 1,
    output: `${decode(result.stdout)}${decode(result.stderr)}`,
  };
}

function gate(...args: string[]): Run {
  return run(["bun", GATE, ...args], workspace());
}

let scratch: string | null = null;

function workspace(): string {
  if (scratch === null) scratch = mkdtempSync(join(tmpdir(), "decision-series-"));
  return scratch;
}

afterEach(() => {
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** A repository checkout holding the given ADR files under `docs/adr`. */
function repository(name: string, files: readonly string[]): string {
  const root = join(workspace(), name);
  mkdirSync(join(root, "docs", "adr"), { recursive: true });
  for (const file of files) write(join(root, "docs", "adr", file), `# ${file}\n`);
  return root;
}

const HEADER = "| Number | Title | File |\n| --- | --- | --- |\n";

function row(number: string, title: string, target: string, label?: string): string {
  const shown = label ?? target.split("/").at(-1) ?? target;
  return `| ${number} | ${title} | [${shown}](${target}) |\n`;
}

function section(series: string, directory: string, rows: readonly string[]): string {
  return `## ${series} — Decisions (${directory})\n\n${HEADER}${rows.join("")}\n`;
}

/**
 * A second, complete series beside the one under test: without it, a lone
 * unreadable series also trips the "no ADR examined" rule, and a test would
 * stay red even if the unreadable series itself were silently skipped.
 */
function readableSibling(): { readonly section: string; readonly argument: string } {
  const beta = repository("beta", ["0001-other.md"]);
  return {
    section: section("grp/beta", "docs/adr", [row("0001", "Other", "docs/adr/0001-other.md")]),
    argument: `grp/beta=${beta}`,
  };
}

function index(...sections: readonly string[]): string {
  const path = join(workspace(), "index", "DECISION-SERIES.md");
  write(path, `# Decision series\n\nPreamble.\n\n${sections.join("")}`);
  return path;
}

describe("a complete series is green, and says what it examined", () => {
  test("every ADR indexed: exit 0 with counters that sum", () => {
    const alpha = repository("alpha", ["0001-first.md", "0002-second.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [
        row("0001", "First", "docs/adr/0001-first.md"),
        row("0002", "Second", "docs/adr/0002-second.md"),
      ]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("series: declared=1 readable=1 unreadable=0");
    expect(outcome.output).toContain("adr: examined=2 indexed=2 missing=0");
    expect(outcome.output).toContain("rows: read=2 matched=2 stale=0 malformed=0");
    expect(outcome.output).toContain("violations=0");
    expect(outcome.exitCode).toBe(0);
  });

  test("two series in two repositories are both examined", () => {
    const alpha = repository("alpha", ["0001-first.md"]);
    const beta = repository("beta", ["0001-other.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [row("0001", "First", "docs/adr/0001-first.md")]),
      section("grp/beta", "docs/adr", [row("0001", "Other", "docs/adr/0001-other.md")]),
    );
    const outcome = gate(
      "--index",
      path,
      "--repo",
      `grp/alpha=${alpha}`,
      "--repo",
      `grp/beta=${beta}`,
    );
    expect(outcome.output).toContain("series: declared=2 readable=2 unreadable=0");
    expect(outcome.output).toContain("adr: examined=2 indexed=2 missing=0");
    expect(outcome.exitCode).toBe(0);
  });
});

describe("an ADR without an index row is red", () => {
  test("ADR added without its row: exit 1, the file is named", () => {
    const alpha = repository("alpha", ["0001-first.md", "0002-added.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [row("0001", "First", "docs/adr/0001-first.md")]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("adr: examined=2 indexed=1 missing=1");
    expect(outcome.output).toContain("grp/alpha");
    expect(outcome.output).toContain("0002-added.md");
    expect(outcome.exitCode).toBe(1);
  });

  test("a row whose number disagrees with its file does not index it", () => {
    const alpha = repository("alpha", ["0003-third.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [row("0004", "Third", "docs/adr/0003-third.md")]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("0003-third.md");
    expect(outcome.exitCode).toBe(1);
  });

  test("an ADR listed only in another series' table is still missing from its own", () => {
    const alpha = repository("alpha", ["0001-first.md"]);
    const beta = repository("beta", ["0001-first.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [row("0001", "First", "docs/adr/0001-first.md")]),
      section("grp/beta", "docs/adr", []),
    );
    const outcome = gate(
      "--index",
      path,
      "--repo",
      `grp/alpha=${alpha}`,
      "--repo",
      `grp/beta=${beta}`,
    );
    expect(outcome.output).toContain("adr: examined=2 indexed=1 missing=1");
    expect(outcome.exitCode).toBe(1);
  });

  test("a row naming a file the series does not hold is stale", () => {
    const alpha = repository("alpha", ["0001-first.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [
        row("0001", "First", "docs/adr/0001-first.md"),
        row("0002", "Gone", "docs/adr/0002-gone.md"),
      ]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("rows: read=2 matched=1 stale=1 malformed=0");
    expect(outcome.output).toContain("0002-gone.md");
    expect(outcome.exitCode).toBe(1);
  });

  test("a row that is not number | title | link is malformed", () => {
    const alpha = repository("alpha", ["0001-first.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [
        row("0001", "First", "docs/adr/0001-first.md"),
        "| one | no link |\n",
      ]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("rows: read=2 matched=1 stale=0 malformed=1");
    expect(outcome.exitCode).toBe(1);
  });
});

describe("a declared repository that cannot be read is red", () => {
  test("no checkout supplied for a declared series: exit 1, never a skip", () => {
    const alpha = repository("alpha", ["0001-first.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [row("0001", "First", "docs/adr/0001-first.md")]),
      section("grp/absent", "docs/adr", []),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("series: declared=2 readable=1 unreadable=1");
    expect(outcome.output).toContain("grp/absent");
    expect(outcome.exitCode).toBe(1);
  });

  test("checkout supplied but the declared directory is absent: exit 1", () => {
    const sibling = readableSibling();
    const alpha = join(workspace(), "alpha");
    mkdirSync(alpha, { recursive: true });
    const path = index(sibling.section, section("grp/alpha", "docs/adr", []));
    const outcome = gate(
      "--index",
      path,
      "--repo",
      sibling.argument,
      "--repo",
      `grp/alpha=${alpha}`,
    );
    expect(outcome.output).toContain("series: declared=2 readable=1 unreadable=1");
    expect(outcome.output).toContain("adr: examined=1 indexed=1 missing=0");
    expect(outcome.exitCode).toBe(1);
  });

  test("checkout path that does not exist: exit 1", () => {
    const sibling = readableSibling();
    const path = index(sibling.section, section("grp/alpha", "docs/adr", []));
    const missing = join(workspace(), "nowhere");
    const outcome = gate(
      "--index",
      path,
      "--repo",
      sibling.argument,
      "--repo",
      `grp/alpha=${missing}`,
    );
    expect(outcome.output).toContain("unreadable=1");
    expect(outcome.exitCode).toBe(1);
  });

  test("a heading shaped like a declaration that does not parse is unreadable", () => {
    const sibling = readableSibling();
    const path = index(sibling.section, "## grp/alpha without a directory\n\n");
    const outcome = gate("--index", path, "--repo", sibling.argument);
    expect(outcome.output).toContain("series: declared=2 readable=1 unreadable=1");
    expect(outcome.exitCode).toBe(1);
  });

  test("an unreadable index is a failure, not zero series", () => {
    const outcome = gate("--index", join(workspace(), "missing.md"));
    expect(outcome.exitCode).toBe(1);
    expect(outcome.output).toContain("cannot read index");
  });

  test("an index declaring no series is a failure: no green without volume", () => {
    const path = index("## Not a series heading\n\nText.\n");
    const outcome = gate("--index", path);
    expect(outcome.output).toContain("series: declared=0");
    expect(outcome.exitCode).toBe(1);
  });

  test("a readable series with an empty directory examines nothing: red, no green without volume", () => {
    const alpha = repository("alpha", []);
    const path = index(section("grp/alpha", "docs/adr", []));
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("series: declared=1 readable=1 unreadable=0");
    expect(outcome.output).toContain("adr: examined=0 indexed=0 missing=0");
    expect(outcome.output).toContain("no ADR examined");
    expect(outcome.exitCode).toBe(1);
  });

  test("a full declaration whose repository lacks its group is unreadable, not absent", () => {
    const sibling = readableSibling();
    const path = index(sibling.section, section("beta", "docs/adr", []));
    const outcome = gate("--index", path, "--repo", sibling.argument);
    expect(outcome.output).toContain("series: declared=2 readable=1 unreadable=1");
    expect(outcome.output).toContain("## beta — Decisions (docs/adr)");
    expect(outcome.exitCode).toBe(1);
  });

  test("a checkout no declared series consumes is red and named", () => {
    const sibling = readableSibling();
    const typo = repository("typo", ["0001-first.md"]);
    const path = index(sibling.section);
    const outcome = gate("--index", path, "--repo", sibling.argument, "--repo", `grp/typo=${typo}`);
    expect(outcome.output).toContain("checkouts: supplied=2 used=1 unused=1");
    expect(outcome.output).toContain("grp/typo: checkout supplied but no series declares");
    expect(outcome.exitCode).toBe(1);
  });

  test("rows of an unreadable series are counted unjudged, not malformed", () => {
    const sibling = readableSibling();
    const path = index(
      sibling.section,
      section("grp/absent", "docs/adr", [row("0001", "First", "docs/adr/0001-first.md")]),
    );
    const outcome = gate("--index", path, "--repo", sibling.argument);
    expect(outcome.output).toContain("rows: read=2 matched=1 stale=0 malformed=0 unjudged=1");
    expect(outcome.exitCode).toBe(1);
  });
});

describe("every entry of a series directory is accounted for", () => {
  test("a misnamed ADR is red and named, entries sum to the directory", () => {
    const alpha = repository("alpha", [
      "0001-first.md",
      "ADR-0002-second.md",
      "003-third.md",
      "0004_fourth.md",
      "0006-sixth.MD",
      "00007-seventh.md",
    ]);
    const path = index(
      section("grp/alpha", "docs/adr", [row("0001", "First", "docs/adr/0001-first.md")]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("adr: examined=1 indexed=1 missing=0");
    expect(outcome.output).toContain("entries: listed=6 examined=1 misnamed=5 skipped=0");
    for (const name of [
      "ADR-0002-second.md",
      "003-third.md",
      "0004_fourth.md",
      "0006-sixth.MD",
      "00007-seventh.md",
    ]) {
      expect(outcome.output).toContain(`docs/adr/${name} looks like an ADR`);
    }
    expect(outcome.exitCode).toBe(1);
  });

  test("other entries are counted and named, without failing the series", () => {
    const alpha = repository("alpha", ["0001-first.md", "README.md", "sub/0005-fifth.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [row("0001", "First", "docs/adr/0001-first.md")]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("entries: listed=3 examined=1 misnamed=0 skipped=2");
    expect(outcome.output).toContain("skipped docs/adr/README.md");
    expect(outcome.output).toContain("skipped docs/adr/sub/");
    expect(outcome.exitCode).toBe(0);
  });
});

describe("a trailing HTML comment on a row is ignored", () => {
  test("a row carrying an exemption marker still indexes its ADR", () => {
    const alpha = repository("alpha", ["0001-first.md"]);
    const marked = `${row("0001", "First", "docs/adr/0001-first.md").trimEnd()} <!-- isolation: exempt -->\n`;
    const path = index(section("grp/alpha", "docs/adr", [marked]));
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("rows: read=1 matched=1 stale=0 malformed=0");
    expect(outcome.exitCode).toBe(0);
  });

  test("a long run of spaces on a row is read in linear time", () => {
    const alpha = repository("alpha", ["0001-first.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [
        row("0001", "First", "docs/adr/0001-first.md"),
        `|${" ".repeat(200_000)}x\n`,
      ]),
    );
    const started = performance.now();
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    const elapsed = performance.now() - started;
    expect(outcome.output).toContain("rows: read=2 matched=1 stale=0 malformed=1");
    // The quadratic form took about 30 s on this input; the bound is generous on purpose.
    expect(elapsed).toBeLessThan(10_000);
  }, 60_000);
});

describe("the declared directory never leaves its repository", () => {
  test("a parent-relative directory is refused", () => {
    const sibling = readableSibling();
    const alpha = repository("alpha", ["0001-first.md"]);
    repository("outside", ["0001-first.md"]);
    const path = index(
      sibling.section,
      section("grp/alpha", "../outside/docs/adr", [
        row("0001", "First", "../outside/docs/adr/0001-first.md"),
      ]),
    );
    const outcome = gate(
      "--index",
      path,
      "--repo",
      sibling.argument,
      "--repo",
      `grp/alpha=${alpha}`,
    );
    expect(outcome.output).toContain("unreadable=1");
    expect(outcome.exitCode).toBe(1);
  });

  test("an absolute directory is refused", () => {
    const sibling = readableSibling();
    const outside = repository("outside", ["0001-first.md"]);
    const alpha = join(workspace(), "alpha");
    mkdirSync(alpha, { recursive: true });
    const absolute = join(outside, "docs", "adr");
    const path = index(
      sibling.section,
      section("grp/alpha", absolute, [row("0001", "First", `${absolute}/0001-first.md`)]),
    );
    const outcome = gate(
      "--index",
      path,
      "--repo",
      sibling.argument,
      "--repo",
      `grp/alpha=${alpha}`,
    );
    expect(outcome.output).toContain("unreadable=1");
    expect(outcome.exitCode).toBe(1);
  });

  test("a directory that is a symbolic link out of the repository is refused", () => {
    const sibling = readableSibling();
    const outside = repository("outside", ["0001-first.md"]);
    const alpha = join(workspace(), "alpha");
    mkdirSync(join(alpha, "docs"), { recursive: true });
    symlinkSync(join(outside, "docs", "adr"), join(alpha, "docs", "adr"));
    const path = index(
      sibling.section,
      section("grp/alpha", "docs/adr", [row("0001", "First", "docs/adr/0001-first.md")]),
    );
    const outcome = gate(
      "--index",
      path,
      "--repo",
      sibling.argument,
      "--repo",
      `grp/alpha=${alpha}`,
    );
    expect(outcome.output).toContain("unreadable=1");
    expect(outcome.exitCode).toBe(1);
  });
});

describe("links are relative to the repository carrying the series, without a host", () => {
  test("a link with a host does not index the ADR", () => {
    const alpha = repository("alpha", ["0001-first.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [
        row("0001", "First", "https://forge.example/grp/alpha/blob/HEAD/docs/adr/0001-first.md"),
      ]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("adr: examined=1 indexed=0 missing=1");
    expect(outcome.output).toContain("rows: read=1 matched=0 stale=0 malformed=1");
    expect(outcome.exitCode).toBe(1);
  });

  test("a link relative to the index file rather than the repository does not index", () => {
    const alpha = repository("alpha", ["0001-first.md"]);
    const path = index(
      section("grp/alpha", "docs/adr", [row("0001", "First", "../adr/0001-first.md")]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("missing=1");
    expect(outcome.exitCode).toBe(1);
  });
});

describe("the series is read from the checked-out tree, not the default branch", () => {
  /** Run git for the fixture; a failure is a setup failure, not a verdict. */
  function git(cwd: string, ...argv: string[]): void {
    const outcome = run(["git", ...argv], cwd);
    if (outcome.exitCode !== 0) {
      throw new Error(`fixture setup failed: git ${argv.join(" ")} — ${outcome.output.trim()}`);
    }
  }

  function committedWithoutAdrDirectory(): string {
    const root = join(workspace(), "alpha");
    mkdirSync(root, { recursive: true });
    write(join(root, "README.md"), "alpha\n");
    git(root, "init", "-q");
    git(root, "config", "user.name", "t");
    git(root, "config", "user.email", "t@t");
    git(root, "add", "README.md");
    git(root, "commit", "-q", "-m", "base without decisions");
    return root;
  }

  test("an ADR present only in the checkout is examined (red when unindexed)", () => {
    const alpha = committedWithoutAdrDirectory();
    write(join(alpha, "docs", "adr", "0001-first.md"), "# first\n");
    const path = index(section("grp/alpha", "docs/adr", []));
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("series: declared=1 readable=1 unreadable=0");
    expect(outcome.output).toContain("adr: examined=1 indexed=0 missing=1");
    expect(outcome.exitCode).toBe(1);
  });

  test("an ADR present only in the checkout and indexed is green", () => {
    const alpha = committedWithoutAdrDirectory();
    write(join(alpha, "docs", "adr", "0001-first.md"), "# first\n");
    const path = index(
      section("grp/alpha", "docs/adr", [row("0001", "First", "docs/adr/0001-first.md")]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("adr: examined=1 indexed=1 missing=0");
    expect(outcome.exitCode).toBe(0);
  });

  function committedWithTwoAdrs(): string {
    const root = join(workspace(), "alpha");
    write(join(root, "docs", "adr", "0001-first.md"), "# first\n");
    write(join(root, "docs", "adr", "0002-second.md"), "# second\n");
    git(root, "init", "-q");
    git(root, "config", "user.name", "t");
    git(root, "config", "user.email", "t@t");
    git(root, "add", "docs");
    git(root, "commit", "-q", "-m", "base with two decisions");
    rmSync(join(root, "docs", "adr", "0002-second.md"));
    return root;
  }

  test("an ADR committed on the base but deleted in the checkout leaves its row stale", () => {
    const alpha = committedWithTwoAdrs();
    const path = index(
      section("grp/alpha", "docs/adr", [
        row("0001", "First", "docs/adr/0001-first.md"),
        row("0002", "Second", "docs/adr/0002-second.md"),
      ]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("rows: read=2 matched=1 stale=1 malformed=0");
    expect(outcome.exitCode).toBe(1);
  });

  test("the same deletion with its row removed is green", () => {
    const alpha = committedWithTwoAdrs();
    const path = index(
      section("grp/alpha", "docs/adr", [row("0001", "First", "docs/adr/0001-first.md")]),
    );
    const outcome = gate("--index", path, "--repo", `grp/alpha=${alpha}`);
    expect(outcome.output).toContain("adr: examined=1 indexed=1 missing=0");
    expect(outcome.exitCode).toBe(0);
  });
});

describe("usage", () => {
  test("no index argument: exit 2", () => {
    expect(gate().exitCode).toBe(2);
  });

  test("a repository argument that is not group/name=path: exit 2", () => {
    const path = index(section("grp/alpha", "docs/adr", []));
    expect(gate("--index", path, "--repo", "alpha").exitCode).toBe(2);
    expect(gate("--index", path, "--repo", "a/b/c=/x").exitCode).toBe(2);
  });

  test("the same repository given twice: exit 2", () => {
    const alpha = repository("alpha", []);
    const path = index(section("grp/alpha", "docs/adr", []));
    const outcome = gate(
      "--index",
      path,
      "--repo",
      `grp/alpha=${alpha}`,
      "--repo",
      `grp/alpha=${alpha}`,
    );
    expect(outcome.exitCode).toBe(2);
  });
});
