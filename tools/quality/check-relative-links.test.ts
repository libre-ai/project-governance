import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  countersSum,
  EXIT,
  extractLinks,
  headingAnchors,
  parseFallbackExtensions,
  run,
} from "./check-relative-links";
import { runGit } from "./git-diff";

/**
 * Every expectation below comes from the brief of the gate, not from what the
 * code prints: a broken link on a line with two, a link right only from the
 * repository root, a four-backtick fence holding a three-backtick line, and an
 * extension list refused before any launch.
 */

const created: string[] = [];

/** A throwaway git repository whose files are all staged: the gate reads `git ls-files`. */
function repository(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "relative-links-"));
  created.push(dir);
  expect(runGit(["-C", dir, "init", "-q"]).exitCode).toBe(0);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  expect(runGit(["-C", dir, "add", "-A"]).exitCode).toBe(0);
  return dir;
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe("usage and option refusals", () => {
  test("no argument is a usage error", () => {
    expect(run([]).exitCode).toBe(EXIT.usage);
  });

  test("an unknown option is a usage error", () => {
    expect(run(["somewhere", "--frobnicate"]).exitCode).toBe(EXIT.usage);
  });

  test("an exclusion without a reason is a usage error", () => {
    const dir = repository({ "a.md": "# A\n" });
    expect(run([dir, "--exclude", "legacy"]).exitCode).toBe(EXIT.usage);
    expect(run([dir, "--exclude", "legacy="]).exitCode).toBe(EXIT.usage);
  });

  test("an exclusion prefix that leaves the repository is a usage error", () => {
    const dir = repository({ "a.md": "# A\n" });
    expect(run([dir, "--exclude", "../x=why"]).exitCode).toBe(EXIT.usage);
    expect(run([dir, "--exclude", "/x=why"]).exitCode).toBe(EXIT.usage);
  });

  test("md,,mdx is refused before anything is launched", () => {
    // The repository does not exist: a refusal that reached the repository check would say 2
    // (usage) and git would say 8; only the extension refusal says 9.
    const result = run(["/nonexistent/repository", "--fallback-ext", "md,,mdx"]);
    expect(result.exitCode).toBe(EXIT.extensions);
  });

  test("the `check` subcommand of the brief is accepted before the repository", () => {
    const dir = repository({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });
    expect(run(["check", dir]).exitCode).toBe(EXIT.ok);
    expect(run(["check", dir, "--fallback-ext", "md,,mdx"]).exitCode).toBe(EXIT.extensions);
    expect(run(["check"]).exitCode).toBe(EXIT.usage);
  });

  test("an empty value, a dotted value and a separator are refused", () => {
    for (const bad of ["", ".md", "md,.mdx", "md;mdx", "md mdx", "md/mdx", ",md", "md,"]) {
      expect(parseFallbackExtensions(bad).ok).toBe(false);
    }
    expect(parseFallbackExtensions("md,mdx")).toEqual({ ok: true, extensions: ["md", "mdx"] });
  });
});

describe("what a link is", () => {
  test("two links on one line are both extracted, the broken first one does not hide the second", () => {
    const links = extractLinks("see [a](missing.md) and [b](present.md)\n");
    expect(links.map((link) => link.dest)).toEqual(["missing.md", "present.md"]);
  });

  test("a four-backtick fence holding a three-backtick line stays open", () => {
    const text = [
      "````md",
      "[x](inside-one.md)",
      "```",
      "[y](inside-two.md)",
      "````",
      "[z](after.md)",
      "",
    ].join("\n");
    expect(extractLinks(text).map((link) => link.dest)).toEqual(["after.md"]);
  });

  test("a tilde fence is closed only by tildes", () => {
    const text = ["~~~", "```", "[x](inside.md)", "~~~", "[z](after.md)", ""].join("\n");
    expect(extractLinks(text).map((link) => link.dest)).toEqual(["after.md"]);
  });

  test("inline code is not navigation", () => {
    expect(extractLinks("use `[x](nowhere.md)` here, and ``[y](`nowhere.md`)`` too\n")).toEqual([]);
  });

  test("angle brackets, titles and balanced parentheses", () => {
    const text = "[a](<my file.md> \"title\") [b](plain.md 'title') [c](dir/a_(1).md)\n";
    expect(extractLinks(text).map((link) => link.dest)).toEqual([
      "my file.md",
      "plain.md",
      "dir/a_(1).md",
    ]);
  });

  test("an unclosed link is not a link", () => {
    expect(extractLinks("[a](broken.md and nothing else\n")).toEqual([]);
  });

  test("a link inside an HTML comment is not navigation, one after it on the line is", () => {
    const text = [
      "<!-- [x](gone.md) -->",
      "<!-- start",
      "[y](gone-two.md)",
      "end --> [z](after.md)",
      "`<!--` [w](kept.md)",
      "",
    ].join("\n");
    expect(extractLinks(text)).toEqual([
      { line: 4, dest: "after.md" },
      { line: 5, dest: "kept.md" },
    ]);
  });

  test("a front matter that is not YAML is prose, so its links are read", () => {
    const text = ["---", "", "[gone](missing.md)", "---", "[b](b.md)", ""].join("\n");
    expect(extractLinks(text).map((link) => link.dest)).toEqual(["missing.md", "b.md"]);
  });

  test("a YAML front matter is still skipped", () => {
    const text = ["---", "title: T", "tags:", "  - [a](x.md)", "# c", "---", "[b](b.md)", ""].join(
      "\n",
    );
    expect(extractLinks(text).map((link) => link.dest)).toEqual(["b.md"]);
  });

  test("line numbers count the fenced lines", () => {
    const text = ["```", "x", "```", "[a](b.md)"].join("\n");
    expect(extractLinks(text)).toEqual([{ line: 4, dest: "b.md" }]);
  });
});

describe("headings and anchors", () => {
  test("GitHub style slugs, with numbered duplicates", () => {
    const anchors = headingAnchors(
      [
        "# Hello, World!",
        "## Hello, World!",
        "## Hello, World!",
        "### `code` and *emphasis* [link](x.md)",
        "",
      ].join("\n"),
    );
    expect(anchors.has("hello-world")).toBe(true);
    expect(anchors.has("hello-world-1")).toBe(true);
    expect(anchors.has("hello-world-2")).toBe(true);
    expect(anchors.has("code-and-emphasis-link")).toBe(true);
  });

  test("underscore emphasis is dropped from a slug, a lone underscore is kept", () => {
    const anchors = headingAnchors(
      [
        "# The _word_ here",
        "# Use __init__ now",
        "# a _private name",
        "# snake_case_name",
        "",
      ].join("\n"),
    );
    expect(anchors.has("the-word-here")).toBe(true);
    expect(anchors.has("use-init-now")).toBe(true);
    expect(anchors.has("a-_private-name")).toBe(true);
    expect(anchors.has("snake_case_name")).toBe(true);
  });

  test("a heading or an anchor inside an HTML comment is not an anchor", () => {
    const anchors = headingAnchors(
      ["<!--", "# Hidden", '<a name="ghost"></a>', "-->", "# Shown", ""].join("\n"),
    );
    expect(anchors.has("shown")).toBe(true);
    expect(anchors.has("hidden")).toBe(false);
    expect(anchors.has("ghost")).toBe(false);
  });

  test("setext headings, explicit html anchors; not headings inside fences or front matter", () => {
    const anchors = headingAnchors(
      [
        "---",
        "title: Not a heading",
        "---",
        "Setext Title",
        "============",
        "",
        '<a name="explicit"></a>',
        "```",
        "# in fence",
        "```",
        "",
      ].join("\n"),
    );
    expect(anchors.has("setext-title")).toBe(true);
    expect(anchors.has("explicit")).toBe(true);
    expect(anchors.has("in-fence")).toBe(false);
    expect(anchors.has("title-not-a-heading")).toBe(false);
  });
});

describe("the gate over a repository", () => {
  test("two links on a line, the first broken: it is reported, the second is not", () => {
    const dir = repository({ "a.md": "[gone](missing.md) and [here](b.md)\n", "b.md": "# B\n" });
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.brokenLink);
    expect(result.err).toContain("a.md:1: link target not found: missing.md");
    expect(result.err.filter((line) => line.includes("b.md"))).toEqual([]);
  });

  test("two broken links on a line are both reported", () => {
    const dir = repository({ "a.md": "[x](m1.md) [y](m2.md)\n" });
    const result = run([dir]);
    expect(result.err.filter((line) => line.startsWith("a.md:1:")).length).toBe(2);
  });

  test("a link right only from the repository root is reported", () => {
    const dir = repository({
      "docs/a.md": "[b](docs/b.md)\n",
      "docs/b.md": "# B\n",
    });
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.brokenLink);
    expect(result.err).toContain("docs/a.md:1: link target not found: docs/b.md");
  });

  test("a target present on disk but ignored by git is not tracked, so the link is broken", () => {
    const dir = repository({
      ".gitignore": "build/\n",
      "a.md": "[o](build/out.md) [d](build/) [t](b.md)\n",
      "b.md": "# B\n",
      "build/out.md": "# Out\n",
    });
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.brokenLink);
    expect(result.err).toContain("a.md:1: link target not tracked: build/out.md");
    expect(result.err).toContain("a.md:1: link target not tracked: build/");
    expect(result.out.join("\n")).toContain("ok=1");
  });

  test("a target left untracked (never added) is not tracked either", () => {
    const dir = repository({ "a.md": "[n](new.md) [dir](sub/) [root](.)\n", "sub/x.txt": "x\n" });
    writeFileSync(join(dir, "new.md"), "# N\n");
    mkdirSync(join(dir, "empty"));
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.brokenLink);
    expect(result.err).toEqual(["a.md:1: link target not tracked: new.md"]);
  });

  test("the same link written relative to its source resolves, with and without ./", () => {
    const dir = repository({
      "docs/a.md": "[b](b.md) [c](./b.md) [d](../README.md)\n",
      "docs/b.md": "# B\n",
      "README.md": "# R\n",
    });
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.ok);
    expect(result.out.join("\n")).toContain("ok=3");
  });

  test("a broken link inside a four-backtick fence is ignored, one after it is not", () => {
    const dir = repository({
      "a.md": [
        "````md",
        "[x](inside-one.md)",
        "```",
        "[y](inside-two.md)",
        "````",
        "[z](after.md)",
        "",
      ].join("\n"),
    });
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.brokenLink);
    expect(result.err.filter((line) => line.startsWith("a.md:"))).toEqual([
      "a.md:6: link target not found: after.md",
    ]);
  });

  test("a percent-encoded name written between angle brackets is resolved", () => {
    const dir = repository({
      "a.md": '[x](<my%20file.md>) [y](<my file.md>) [z](my%20file.md "t")\n',
      "my file.md": "# M\n",
    });
    expect(run([dir]).exitCode).toBe(EXIT.ok);
  });

  test("an invalid percent sequence is a broken link, not a crash", () => {
    const dir = repository({ "a.md": "[x](bad%zz.md)\n" });
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.brokenLink);
    expect(result.err.join("\n")).toContain("invalid percent-encoding");
  });

  test("a missing anchor exits 6, a present one does not", () => {
    const dir = repository({
      "a.md": "[good](b.md#the-section) [same](#top-of-a) [bad](b.md#absent)\n\n# Top of A\n",
      "b.md": "# B\n\n## The Section\n",
    });
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.brokenAnchor);
    expect(result.err.filter((line) => line.startsWith("a.md:"))).toEqual([
      "a.md:1: anchor not found: b.md#absent",
    ]);
  });

  test("a link broken and a link with a bad anchor: the broken link decides the code, both are printed", () => {
    const dir = repository({
      "a.md": "[x](gone.md) [y](b.md#absent)\n",
      "b.md": "# B\n",
    });
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.brokenLink);
    expect(result.err.filter((line) => line.startsWith("a.md:")).length).toBe(2);
  });

  test("an anchor on a non-Markdown target is not checkable and is accepted", () => {
    const dir = repository({
      "a.md": "[x](code.ts#L10) [d](sub/)\n",
      "code.ts": "export {};\n",
      "sub/f.txt": "x\n",
    });
    expect(run([dir]).exitCode).toBe(EXIT.ok);
  });

  test("a Markdown without a relative link is green but visibly empty", () => {
    const dir = repository({
      "a.md": "# Nothing to follow\n\nplain text, [site](https://example.invalid/x)\n",
    });
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.ok);
    const text = result.out.join("\n");
    expect(text).toContain("ok=0");
    expect(text).toContain("EMPTY GREEN");
    expect(text).not.toMatch(/^OK$/m);
  });

  test("a green run with real links says plain OK", () => {
    const dir = repository({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });
    const result = run([dir]);
    expect(result.out).toContain("OK");
  });

  test("external links are counted and declared not verified, never fetched", () => {
    const dir = repository({
      "a.md":
        "[a](https://example.invalid/x) [b](http://example.invalid) [c](mailto:x@example.invalid) [d](//example.invalid/y)\n",
      "b.md": "[site-absolute](/docs/x.md) [ftp](ftp://example.invalid/f) [empty]()\n",
    });
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.ok);
    const text = result.out.join("\n");
    expect(text).toContain("external=4 (not verified)");
    expect(text).toContain("other=3 (not verified)");
  });

  test("counters sum: tracked = examined + excluded + non-regular, total = ok + errors + external + other", () => {
    const dir = repository({
      "a.md": "[b](b.md) [gone](gone.md) [bad](b.md#nope) [w](https://example.invalid) [o](/abs)\n",
      "b.md": "# B\n",
      "legacy/old.md": "[x](gone.md)\n",
      "notes.txt": "not markdown\n",
    });
    const result = run([dir, "--exclude", "legacy=imported export, links are fixtures"]);
    const text = result.out.join("\n");
    expect(text).toContain("tracked=3 examined=2 excluded=1 non-regular=0");
    expect(text).toContain(
      "total=5 ok=1 errors=2 (broken=1 anchors=1) external=1 (not verified) other=1 (not verified)",
    );
  });

  test("a prefix matches whole path segments only", () => {
    const dir = repository({ "legacy2/a.md": "[x](gone.md)\n", "b.md": "# B\n" });
    const result = run([dir, "--exclude", "legacy=reason"]);
    expect(result.exitCode).toBe(EXIT.brokenLink);
    expect(result.err.join("\n")).toContain("exclusion prefix legacy");
  });

  test("everything excluded: zero files examined is a failure", () => {
    const dir = repository({ "legacy/a.md": "[x](gone.md)\n" });
    const result = run([dir, "--exclude", "legacy=all of it is legacy"]);
    expect(result.exitCode).toBe(EXIT.noFiles);
  });

  test("a repository with no Markdown at all is a failure, not a green", () => {
    const dir = repository({ "a.txt": "x\n" });
    expect(run([dir]).exitCode).toBe(EXIT.noFiles);
  });

  test("an exclusion prefix that matches nothing is a named warning, not a failure", () => {
    const dir = repository({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });
    const result = run([dir, "--exclude", "absent-dir=reason"]);
    expect(result.exitCode).toBe(EXIT.ok);
    expect(result.err.join("\n")).toContain(
      "exclusion prefix absent-dir matches no tracked Markdown file",
    );
  });

  test("a link leaving the repository is reported", () => {
    const dir = repository({ "a.md": "[x](../outside.md)\n" });
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.brokenLink);
    expect(result.err.join("\n")).toContain("outside the repository");
  });

  test("a tracked symlink escaping the repository does not satisfy a link", () => {
    const outside = mkdtempSync(join(tmpdir(), "relative-links-outside-"));
    created.push(outside);
    writeFileSync(join(outside, "secret.md"), "# S\n");
    const dir = repository({ "a.md": "[x](escape.md)\n" });
    symlinkSync(join(outside, "secret.md"), join(dir, "escape.md"));
    expect(runGit(["-C", dir, "add", "-A"]).exitCode).toBe(0);
    const result = run([dir]);
    expect(result.exitCode).toBe(EXIT.brokenLink);
    expect(result.err.join("\n")).toContain("outside the repository");
    // The symlink is itself a tracked Markdown path: counted, never read.
    expect(result.out.join("\n")).toContain("non-regular=1");
  });

  test("fallback extensions resolve extensionless routes, say so, and skip names with a dot", () => {
    const dir = repository({
      "site/a.md": "[g](guide) [v](v1.2) [m](page)\n",
      "site/guide.md": "# G\n",
      "site/page.mdx": "# P\n",
      "site/v1.2.md": "# V\n",
    });
    const strict = run([dir]);
    expect(strict.exitCode).toBe(EXIT.brokenLink);
    expect(strict.err.filter((line) => line.startsWith("site/a.md:")).length).toBe(3);

    const lenient = run([dir, "--fallback-ext", "md,mdx"]);
    expect(lenient.out.join("\n")).toContain("fallback-ext=md,mdx");
    expect(lenient.err.filter((line) => line.startsWith("site/a.md:"))).toEqual([
      "site/a.md:1: link target not found: v1.2",
    ]);
  });

  test("a directory that is not a git repository is a git failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "relative-links-nogit-"));
    created.push(dir);
    expect(run([dir]).exitCode).toBe(EXIT.git);
  });

  test("a tracked file missing from the working tree is a failure, not a skipped file", () => {
    const dir = repository({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });
    rmSync(join(dir, "a.md"));
    expect(run([dir]).exitCode).toBe(EXIT.git);
  });
});

describe("the counter check", () => {
  const consistent = {
    tracked: 5,
    examined: 3,
    excluded: 1,
    nonRegular: 1,
    extracted: 10,
    ok: 4,
    broken: 2,
    anchors: 1,
    external: 2,
    other: 1,
  };

  test("consistent counters sum", () => {
    expect(countersSum(consistent)).toBe(true);
  });

  test("a file counted nowhere, or a link counted nowhere, is a mismatch", () => {
    expect(countersSum({ ...consistent, examined: 2 })).toBe(false);
    expect(countersSum({ ...consistent, other: 0 })).toBe(false);
    expect(countersSum({ ...consistent, ok: 5 })).toBe(false);
  });
});

describe("as a process", () => {
  test("the exit code and the error line reach the caller", () => {
    const dir = repository({ "a.md": "[x](gone.md)\n" });
    const child = Bun.spawnSync(["bun", join(import.meta.dir, "check-relative-links.ts"), dir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode).toBe(EXIT.brokenLink);
    expect(new TextDecoder().decode(child.stderr)).toContain(
      "a.md:1: link target not found: gone.md",
    );
  });
});
