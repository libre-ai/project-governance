import { describe, expect, test } from "bun:test";
import { PRIVATE_CROSS_REPOSITORY_NOTE } from "./build-index";
import { buildBlobQuery, exemption, parseBlobResponse, parseTreePaths } from "./fleet-tree";

describe("parseTreePaths", () => {
  test("keeps blob paths only", () => {
    const listing = parseTreePaths(
      JSON.stringify({
        truncated: false,
        tree: [
          { path: "packages", type: "tree" },
          { path: "packages/a/bunfig.toml", type: "blob" },
          { path: "vendor/sub", type: "commit" },
          { path: "bunfig.toml", type: "blob" },
        ],
      }),
    );
    expect(listing).toEqual({ kind: "listed", paths: ["packages/a/bunfig.toml", "bunfig.toml"] });
  });

  test("a truncated listing is unreadable, never a shorter tree", () => {
    expect(parseTreePaths(JSON.stringify({ truncated: true, tree: [] })).kind).toBe("unreadable");
  });

  test("a listing that does not say whether it is complete is unreadable", () => {
    expect(parseTreePaths(JSON.stringify({ tree: [] })).kind).toBe("unreadable");
  });

  test("a non-JSON body is unreadable", () => {
    expect(parseTreePaths("<html>rate limited</html>").kind).toBe("unreadable");
  });
});

describe("buildBlobQuery", () => {
  test("reads the served branch through HEAD:, never a branch name", () => {
    const query = buildBlobQuery("libre-ai/x", ["bunfig.toml", "a/b/bunfig.toml"]);
    expect(query).toContain('f0: object(expression: "HEAD:bunfig.toml")');
    expect(query).toContain('f1: object(expression: "HEAD:a/b/bunfig.toml")');
    expect(query).not.toContain("main:");
    expect(query).toContain('repository(owner: "libre-ai", name: "x")');
  });

  test("refuses a malformed repository name", () => {
    expect(() => buildBlobQuery("no-owner", ["a"])).toThrow("owner/name");
  });
});

describe("parseBlobResponse", () => {
  const paths = ["a", "b", "c", "d"];

  test("text, absent, binary and truncated blobs each get their own outcome", () => {
    const result = parseBlobResponse(paths, {
      repository: {
        f0: { text: "x = 1\n", isBinary: false, isTruncated: false },
        f1: null,
        f2: { text: null, isBinary: true, isTruncated: false },
        f3: { text: "partial", isBinary: false, isTruncated: true },
      },
    });
    expect(result.get("a")).toEqual({ kind: "text", text: "x = 1\n" });
    expect(result.get("b")?.kind).toBe("unreadable");
    expect(result.get("c")?.kind).toBe("unreadable");
    expect(result.get("d")?.kind).toBe("unreadable");
  });

  test("an unresolved repository leaves every path unreadable", () => {
    const result = parseBlobResponse(paths, { repository: null });
    expect([...result.values()].every((read) => read.kind === "unreadable")).toBe(true);
    expect(result.size).toBe(paths.length);
  });
});

describe("exemption", () => {
  const entry = { repository: "libre-ai/x", role: "r", layer: "l", lifecycle: "active" };

  test("an active public entry is read", () => {
    expect(exemption({ ...entry, visibility: "public" })).toBeNull();
  });

  test("private and archived entries are exempt with a stated reason", () => {
    expect(exemption({ ...entry, visibility: "private" })).toBe(PRIVATE_CROSS_REPOSITORY_NOTE);
    expect(exemption({ ...entry, lifecycle: "archived" })).toContain("archived");
  });
});
