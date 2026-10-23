import { describe, expect, test } from "bun:test";
import { parseRawDiff, parseTree } from "./git-diff";

// The expected shapes are git's documented output (git-diff(1) "Raw output
// format" with -z: `:<old mode> <new mode> <old sha> <new sha> <status>\0<path>\0`;
// git-ls-tree(1) with -z: `<mode> <type> <sha>\t<path>\0`), not the parser's
// own output.

const Z = "0".repeat(40);
const S = "a".repeat(40);

describe("parseRawDiff", () => {
  test("an empty change set is empty, not unreadable", () => {
    expect(parseRawDiff("")).toEqual({ ok: true, entries: [] });
  });

  test("reads modes, status and path, a non-ASCII path unquoted", () => {
    const output = [
      `:000000 100644 ${Z} ${S} A`,
      ".github/workflows/a.yml",
      `:100644 100644 ${S} ${S} M`,
      "docs/adr/0004-naïve.md",
      `:100644 000000 ${S} ${Z} D`,
      "x",
      `:100644 120000 ${S} ${S} T`,
      "y",
      `:000000 160000 ${Z} ${S} A`,
      "vendor/lib",
      "",
    ].join("\0");
    expect(parseRawDiff(output)).toEqual({
      ok: true,
      entries: [
        { status: "A", path: ".github/workflows/a.yml", oldMode: "000000", newMode: "100644" },
        { status: "M", path: "docs/adr/0004-naïve.md", oldMode: "100644", newMode: "100644" },
        { status: "D", path: "x", oldMode: "100644", newMode: "000000" },
        { status: "T", path: "y", oldMode: "100644", newMode: "120000" },
        { status: "A", path: "vendor/lib", oldMode: "000000", newMode: "160000" },
      ],
    });
  });

  test.each([
    // A rename record carries a score and two paths: it is not this format.
    [
      "a rename, which --no-renames rules out",
      `:100644 100644 ${S} ${S} R100\0old\0`,
      "unexpected raw diff record",
    ],
    ["an unmerged entry", `:100644 100644 ${S} ${S} U\0x\0`, 'unexpected status "U"'],
    ["name-status output instead of raw", "A\0x\0", "unexpected raw diff record"],
    ["output without its final NUL", `:000000 100644 ${Z} ${S} A\0x`, "truncated"],
    ["a record without its path", `:000000 100644 ${Z} ${S} A\0`, "odd field count"],
    ["an empty path", `:000000 100644 ${Z} ${S} A\0\0`, "empty path"],
  ])("%s is unreadable", (_, output, reason) => {
    const read = parseRawDiff(output);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain(reason);
  });
});

describe("parseTree", () => {
  test("reads mode and path, a path with a tab or newline kept whole", () => {
    expect(
      parseTree(
        [
          `120000 blob ${S}\tlinked/package.json`,
          `100644 blob ${S}\ta\tb\nc`,
          `160000 commit ${S}\tvendor/lib`,
          "",
        ].join("\0"),
      ),
    ).toEqual({
      ok: true,
      entries: [
        { mode: "120000", path: "linked/package.json" },
        { mode: "100644", path: "a\tb\nc" },
        { mode: "160000", path: "vendor/lib" },
      ],
    });
  });

  test.each([
    ["output without its final NUL", `100644 blob ${S}\tx`, "does not end with a NUL"],
    ["a record that is not ls-tree's", "x\0", "unexpected ls-tree record"],
  ])("%s is unreadable", (_, output, reason) => {
    const read = parseTree(output);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain(reason);
  });
});
