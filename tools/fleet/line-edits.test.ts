import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { commentFor, type LineEdit, parseEditList, planFileEdits } from "./line-edits";

const SCRIPT: string = join(import.meta.dir, "line-edits.ts");
const M = "keep: fixture";
const FENCE = "```";

const edit = (
  line: number,
  action: LineEdit["action"],
  argument: string,
  path = "f.md",
): LineEdit => ({ path, line, action, argument });

/** The planned content, or the refusal reasons when the plan is refused. */
function plan(path: string, original: string, edits: readonly LineEdit[]): string | string[] {
  const result = planFileEdits(path, original, edits);
  return result.ok ? result.content : result.refusals.map((r) => `${r.path}:${r.line}`);
}

// --- end to end -----------------------------------------------------------------

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function scratch(): string {
  const directory: string = mkdtempSync(join(tmpdir(), "line-edits-"));
  created.push(directory);
  return directory;
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly root: string;
  readonly read: (path: string) => string;
}

/** A fixed past instant, so an unexpected rewrite shows as a changed mtime. */
const PAST = new Date("2020-01-02T03:04:05Z");

function spawn(args: readonly string[]): { code: number; stdout: string; stderr: string } {
  // Environment built from nothing: the ambient run must not reach the tool.
  const child = Bun.spawnSync([process.execPath, SCRIPT, ...args], {
    env: {},
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: child.exitCode,
    stdout: child.stdout.toString(),
    stderr: child.stderr.toString(),
  };
}

function run(files: Readonly<Record<string, string | Uint8Array>>, rows: readonly string[]): Run {
  const base: string = scratch();
  const root: string = join(base, "tree");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
    utimesSync(join(root, path), PAST, PAST);
  }
  const list: string = join(base, "edits.tsv");
  writeFileSync(list, rows.map((row) => `${row}\n`).join(""));
  return {
    ...spawn([root, list]),
    root,
    read: (path) => readFileSync(join(root, path), "utf8"),
  };
}

const row = (path: string, line: number | string, action: string, argument: string): string =>
  [path, String(line), action, argument].join("\t");

// --- mark -----------------------------------------------------------------------

describe("mark", () => {
  test("a Markdown line outside a fence gets an HTML comment", () => {
    expect(plan("f.md", "one\ntwo\n", [edit(2, "mark", M)])).toBe(`one\ntwo <!-- ${M} -->\n`);
  });

  test("a Markdown line between two ``` delimiters gets a hash comment", () => {
    const original = `intro\n${FENCE}sh\nrun it\n${FENCE}\nafter\n`;
    expect(plan("f.md", original, [edit(3, "mark", M), edit(5, "mark", M)])).toBe(
      `intro\n${FENCE}sh\nrun it # ${M}\n${FENCE}\nafter <!-- ${M} -->\n`,
    );
  });

  test("a ~~~ fence is not closed by ```", () => {
    const original = `~~~\n${FENCE}\nstill inside\n~~~\n`;
    expect(plan("f.md", original, [edit(2, "mark", M), edit(3, "mark", M)])).toBe(
      `~~~\n${FENCE} # ${M}\nstill inside # ${M}\n~~~\n`,
    );
  });

  for (const extension of [".yml", ".yaml", ".sh", ".bash", ".toml", ".py"]) {
    test(`${extension} gets a hash comment`, () => {
      expect(commentFor(`dir/f${extension}`, false, M)).toBe(` # ${M}`);
      expect(plan(`f${extension}`, "x\n", [edit(1, "mark", M)])).toBe(`x # ${M}\n`);
    });
  }

  for (const extension of [".rs", ".js", ".ts"]) {
    test(`${extension} gets a slash comment`, () => {
      expect(commentFor(`dir/f${extension}`, false, M)).toBe(` // ${M}`);
      expect(plan(`f${extension}`, "x\n", [edit(1, "mark", M)])).toBe(`x // ${M}\n`);
    });
  }

  test("commentFor: Markdown depends on the fence, an unknown extension has no form", () => {
    expect(commentFor("f.md", false, M)).toBe(` <!-- ${M} -->`);
    expect(commentFor("f.md", true, M)).toBe(` # ${M}`);
    expect(commentFor("f.sh", true, M)).toBe(` # ${M}`);
    expect(commentFor("f.txt", false, M)).toBeNull();
    expect(commentFor("Makefile", false, M)).toBeNull();
  });

  for (const name of ["notes.txt", "Makefile"]) {
    test(`${name}: refused, exit 1, file unchanged byte for byte`, () => {
      const result = run({ [name]: "x\n" }, [row(name, 1, "mark", M)]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`${name}:1: `);
      expect(readFileSync(join(result.root, name))).toEqual(Buffer.from("x\n"));
    });
  }

  test("a line ending with a backslash is refused, exit 1", () => {
    expect(plan("f.sh", "a \\  \nb\n", [edit(1, "mark", M)])).toEqual(["f.sh:1"]);
    const result = run({ "f.sh": "a \\\nb\n" }, [row("f.sh", 1, "mark", M)]);
    expect(result.code).toBe(1);
    expect(result.read("f.sh")).toBe("a \\\nb\n");
  });

  test("a line that already carries the marker is refused", () => {
    expect(plan("f.sh", `a # ${M}\n`, [edit(1, "mark", M)])).toEqual(["f.sh:1"]);
  });

  test("a ``` delimiter line is refused, opening and closing", () => {
    const original = `${FENCE}\nx\n${FENCE}\n`;
    expect(plan("f.md", original, [edit(1, "mark", M), edit(3, "mark", M)])).toEqual([
      "f.md:1",
      "f.md:3",
    ]);
  });

  test("an empty marker is refused", () => {
    expect(plan("f.sh", "a\n", [edit(1, "mark", "")])).toEqual(["f.sh:1"]);
  });

  test("the fence state is the original one: an inserted ``` does not change the comment", () => {
    expect(plan("f.md", "one\ntwo\n", [edit(1, "insert", FENCE), edit(2, "mark", M)])).toBe(
      `${FENCE}\none\ntwo <!-- ${M} -->\n`,
    );
  });
});

// --- replace, delete, insert ------------------------------------------------------

describe("replace", () => {
  test("only the first occurrence is replaced", () => {
    expect(plan("f.md", "a-a\n", [edit(1, "replace", "a=>b")])).toBe("b-a\n");
  });

  test("the new part is literal and may hold =>", () => {
    expect(plan("f.md", "x\n", [edit(1, "replace", "x=>$&=>y")])).toBe("$&=>y\n");
  });

  test("no =>, an empty old part, an old part absent from the line: refused, exit 1", () => {
    for (const argument of ["ab", "=>b", "z=>b"]) {
      expect(plan("f.md", "a\n", [edit(1, "replace", argument)])).toEqual(["f.md:1"]);
      const result = run({ "f.md": "a\n" }, [row("f.md", 1, "replace", argument)]);
      expect(result.code).toBe(1);
      expect(result.read("f.md")).toBe("a\n");
    }
  });
});

describe("delete", () => {
  test("a line equal to the expected text once both are trimmed is dropped", () => {
    expect(plan("f.md", "a\n  b  \nc\n", [edit(2, "delete", " b ")])).toBe("a\nc\n");
  });

  test("a different line is refused", () => {
    expect(plan("f.md", "a\nb\n", [edit(2, "delete", "bb")])).toEqual(["f.md:2"]);
  });
});

describe("insert", () => {
  test("two lines before a line indented by 4 spaces keep their own indentation", () => {
    expect(plan("f.yml", "a:\n    b: 1\n", [edit(2, "insert", "x:\\n  y: 2")])).toBe(
      "a:\n    x:\n      y: 2\n    b: 1\n",
    );
  });

  test("an empty insert is refused", () => {
    for (const argument of ["", "\\n", "\\n\\n"]) {
      expect(plan("f.md", "a\n", [edit(1, "insert", argument)])).toEqual(["f.md:1"]);
    }
  });
});

// --- whole-file rules -------------------------------------------------------------

describe("planFileEdits", () => {
  test("two edits on one line are both refused, exit 1", () => {
    const edits = [edit(1, "mark", M), edit(1, "replace", "a=>b"), edit(2, "mark", M)];
    expect(plan("f.md", "a\nb\n", edits)).toEqual(["f.md:1", "f.md:1"]);
    const result = run({ "f.md": "a\nb\n" }, [
      row("f.md", 1, "mark", M),
      row("f.md", 1, "replace", "a=>b"),
    ]);
    expect(result.code).toBe(1);
    expect(result.read("f.md")).toBe("a\nb\n");
  });

  test("line numbers stay the original ones across a deletion and an insertion", () => {
    const edits = [edit(2, "delete", "2"), edit(3, "insert", "new"), edit(5, "mark", M)];
    expect(plan("f.md", "1\n2\n3\n4\n5\n6\n", edits)).toBe(`1\nnew\n3\n4\n5 <!-- ${M} -->\n6\n`);
  });

  test("the plan counts the edits it applied", () => {
    const edits = [edit(1, "mark", M), edit(2, "delete", "b")];
    expect(planFileEdits("f.md", "a\nb\n", edits)).toEqual({
      ok: true,
      content: `a <!-- ${M} -->\n`,
      applied: 2,
    });
  });

  test("a file without a final newline does not get one; one that had it keeps it", () => {
    expect(plan("f.md", "a\nb", [edit(2, "mark", M)])).toBe(`a\nb <!-- ${M} -->`);
    expect(plan("f.md", "a\nb\n", [edit(2, "mark", M)])).toBe(`a\nb <!-- ${M} -->\n`);
    expect(plan("f.md", "a\nb", [edit(2, "delete", "b")])).toBe("a");
    expect(plan("f.md", "a\n", [edit(1, "delete", "a")])).toBe("");
  });

  test("a line beyond the end of the file is refused", () => {
    expect(plan("f.md", "a\nb\n", [edit(3, "mark", M)])).toEqual(["f.md:3"]);
    expect(plan("f.md", "", [edit(1, "insert", "x")])).toEqual(["f.md:1"]);
  });

  test("a carriage return refuses every edit of the file", () => {
    expect(plan("f.md", "a\r\nb\r\n", [edit(1, "mark", M), edit(2, "mark", M)])).toEqual([
      "f.md:1",
      "f.md:2",
    ]);
  });
});

// --- edit list --------------------------------------------------------------------

describe("parseEditList", () => {
  test("reads the four fields in order and ignores empty lines", () => {
    expect(parseEditList(`a/b.md\t12\tmark\t${M}\n\nc.sh\t1\tdelete\t\n`)).toEqual({
      ok: true,
      value: [edit(12, "mark", M, "a/b.md"), edit(1, "delete", "", "c.sh")],
    });
  });

  const malformed: readonly (readonly [string, string])[] = [
    ["a non-numeric line number", "f.md\tx\tmark\tm"],
    ["a zero line number", "f.md\t0\tmark\tm"],
    ["a line number with a leading zero", "f.md\t01\tmark\tm"],
    ["3 fields", "f.md\t1\tmark"],
    ["5 fields", "f.md\t1\tmark\tm\textra"],
    ["an unknown action", "f.md\t1\tappend\tm"],
    ["an absolute path", "/f.md\t1\tmark\tm"],
    ["a .. segment", "a/../f.md\t1\tmark\tm"],
    ["an empty path", "\t1\tmark\tm"],
    ["a carriage return", "f.md\t1\tmark\tm\r"],
  ];
  for (const [name, bad] of malformed) {
    test(`${name}: refused with its TSV line, exit 2, nothing written`, () => {
      const parsed = parseEditList(`f.md\t1\tmark\tm\n${bad}\n`);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toStartWith("line 2: ");
      const result = run({ "f.md": "a\n" }, [row("f.md", 1, "mark", M), bad]);
      expect(result.code).toBe(2);
      expect(result.read("f.md")).toBe("a\n");
      expect(statSync(join(result.root, "f.md")).mtimeMs).toBe(PAST.getTime());
    });
  }

  test("a list without any edit is refused, exit 2", () => {
    expect(parseEditList("").ok).toBe(false);
    expect(parseEditList("\n\n").ok).toBe(false);
    expect(run({ "f.md": "a\n" }, []).code).toBe(2);
  });
});

// --- command ----------------------------------------------------------------------

describe("bun tools/fleet/line-edits.ts", () => {
  test("success: exit 0, files rewritten, counters on stdout", () => {
    const result = run({ "f.md": "a\nb\n", "d/g.sh": "x\ny\n", "h.md": "untouched\n" }, [
      row("f.md", 1, "mark", M),
      row("f.md", 2, "delete", "b"),
      row("d/g.sh", 2, "insert", "z"),
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("line-edits: 3 edit(s) read, 3 applied, 2 file(s) written\n");
    expect(result.read("f.md")).toBe(`a <!-- ${M} -->\n`);
    expect(result.read("d/g.sh")).toBe("x\nz\ny\n");
    expect(statSync(join(result.root, "h.md")).mtimeMs).toBe(PAST.getTime());
    // The temporary file of the atomic write is gone.
    expect(readdirSync(result.root).sort()).toEqual(["d", "f.md", "h.md"]);
  });

  test("the mode of a rewritten file is kept", () => {
    const base: string = scratch();
    const root: string = join(base, "tree");
    mkdirSync(root);
    writeFileSync(join(root, "g.sh"), "x\n");
    // Group-writable: a mode the usual umask would strip from a newly created file.
    chmodSync(join(root, "g.sh"), 0o775);
    writeFileSync(join(base, "edits.tsv"), `${row("g.sh", 1, "mark", M)}\n`);
    expect(spawn([root, join(base, "edits.tsv")]).code).toBe(0);
    expect(readFileSync(join(root, "g.sh"), "utf8")).toBe(`x # ${M}\n`);
    expect(statSync(join(root, "g.sh")).mode & 0o7777).toBe(0o775);
  });

  test("a refusal on A and valid edits on B write neither: contents and mtimes unchanged", () => {
    const result = run({ "a.md": "a\n", "b.md": "b\n" }, [
      row("b.md", 1, "mark", M),
      row("a.md", 1, "delete", "not a"),
      row("a.md", 9, "mark", M),
    ]);
    expect(result.code).toBe(1);
    expect(result.read("a.md")).toBe("a\n");
    expect(result.read("b.md")).toBe("b\n");
    expect(statSync(join(result.root, "a.md")).mtimeMs).toBe(PAST.getTime());
    expect(statSync(join(result.root, "b.md")).mtimeMs).toBe(PAST.getTime());
    // One `<path>:<line>: <reason>` line per refusal, and nothing else.
    const lines = result.stderr.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^a\.md:1: \S/);
    expect(lines[1]).toMatch(/^a\.md:9: \S/);
    expect(result.stdout).toBe(
      "line-edits: 3 edit(s) read, 0 applied, 2 refused in 1 file(s), 0 file(s) written\n",
    );
  });

  test("a line beyond the file and an absent file: exit 1", () => {
    const beyond = run({ "f.md": "a\n" }, [row("f.md", 2, "mark", M)]);
    expect(beyond.code).toBe(1);
    expect(beyond.stderr).toStartWith("f.md:2: ");
    const absent = run({ "f.md": "a\n" }, [
      row("f.md", 1, "mark", M),
      row("gone.md", 1, "mark", M),
    ]);
    expect(absent.code).toBe(1);
    expect(absent.stderr).toStartWith("gone.md:1: ");
    expect(absent.read("f.md")).toBe("a\n");
  });

  test("a directory is not a regular file: exit 1", () => {
    const result = run({ "d.md/f.md": "a\n" }, [row("d.md", 1, "mark", M)]);
    expect(result.code).toBe(1);
    expect(result.stderr).toStartWith("d.md:1: ");
  });

  test("a symbolic link that leaves the root: exit 1, target unchanged", () => {
    const outside: string = join(scratch(), "outside.md");
    writeFileSync(outside, "secret\n");
    const base: string = scratch();
    const root: string = join(base, "tree");
    mkdirSync(root);
    symlinkSync(outside, join(root, "link.md"));
    writeFileSync(join(base, "edits.tsv"), `${row("link.md", 1, "mark", M)}\n`);
    const result = spawn([root, join(base, "edits.tsv")]);
    expect(result.code).toBe(1);
    expect(result.stderr).toStartWith("link.md:1: ");
    expect(readFileSync(outside, "utf8")).toBe("secret\n");
  });

  test("two spellings of one file meet in the same plan", () => {
    const result = run({ "d/f.md": "a\nb\n" }, [
      row("d/f.md", 1, "mark", M),
      row("d/./f.md", 1, "mark", "other"),
    ]);
    expect(result.code).toBe(1);
    expect(result.read("d/f.md")).toBe("a\nb\n");
  });

  test("content that is not UTF-8: exit 1, bytes unchanged", () => {
    const bytes = new Uint8Array([0x61, 0xff, 0x0a]);
    const result = run({ "f.md": bytes }, [row("f.md", 1, "mark", M)]);
    expect(result.code).toBe(1);
    expect(result.stderr).toStartWith("f.md:1: ");
    expect(new Uint8Array(readFileSync(join(result.root, "f.md")))).toEqual(bytes);
  });

  test("content with a carriage return: exit 1, not converted", () => {
    const result = run({ "f.md": "a\r\nb\r\n" }, [row("f.md", 1, "mark", M)]);
    expect(result.code).toBe(1);
    expect(result.stderr).toStartWith("f.md:1: ");
    expect(result.read("f.md")).toBe("a\r\nb\r\n");
  });

  test("a number of arguments other than 2: exit 2", () => {
    const base: string = scratch();
    writeFileSync(join(base, "edits.tsv"), `${row("f.md", 1, "mark", M)}\n`);
    expect(spawn([]).code).toBe(2);
    expect(spawn([base]).code).toBe(2);
    expect(spawn([base, join(base, "edits.tsv"), "extra"]).code).toBe(2);
  });

  test("a root that is absent or not a directory, an unreadable edit list: exit 2", () => {
    const base: string = scratch();
    const list: string = join(base, "edits.tsv");
    writeFileSync(list, `${row("f.md", 1, "mark", M)}\n`);
    expect(spawn([join(base, "absent"), list]).code).toBe(2);
    expect(spawn([list, list]).code).toBe(2);
    expect(spawn([base, join(base, "absent.tsv")]).code).toBe(2);
    writeFileSync(join(base, "binary.tsv"), new Uint8Array([0x66, 0xff, 0x0a]));
    expect(spawn([base, join(base, "binary.tsv")]).code).toBe(2);
  });
});
