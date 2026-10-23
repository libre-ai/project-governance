import { describe, expect, test } from "bun:test";
import { parseNameStatus } from "./git-diff";

// The expected shapes are git's documented `--name-status -z` output
// (`<status>\0<path>\0` per entry, git-diff(1) "Raw output format"), not the
// parser's own output.

describe("parseNameStatus", () => {
  test("an empty change set is empty, not unreadable", () => {
    expect(parseNameStatus("")).toEqual({ ok: true, entries: [] });
  });

  test("reads status and path pairs, a non-ASCII path unquoted", () => {
    expect(
      parseNameStatus("A\0.github/workflows/a.yml\0M\0docs/adr/0004-naïve.md\0D\0x\0T\0y\0"),
    ).toEqual({
      ok: true,
      entries: [
        { status: "A", path: ".github/workflows/a.yml" },
        { status: "M", path: "docs/adr/0004-naïve.md" },
        { status: "D", path: "x" },
        { status: "T", path: "y" },
      ],
    });
  });

  test.each([
    // A rename record carries two paths: alone it leaves an odd field count,
    // followed by any entry it shifts every later status onto a path.
    ["a rename, which --no-renames rules out", "R100\0old\0new\0", "odd field count"],
    ["a rename followed by an entry", "R100\0old\0new\0A\0x\0y\0", 'unexpected name-status "R100"'],
    ["an unmerged entry", "U\0x\0", 'unexpected name-status "U"'],
    ["output without its final NUL", "A\0x", "truncated"],
    ["a status without its path", "A\0", "odd field count"],
    ["an empty path", "A\0\0", "empty path"],
  ])("%s is unreadable", (_, output, reason) => {
    const read = parseNameStatus(output);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain(reason);
  });
});
