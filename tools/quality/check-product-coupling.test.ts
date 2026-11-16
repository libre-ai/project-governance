import { describe, expect, test } from "bun:test";
import {
  type CouplingConfig,
  type CouplingInput,
  evaluateCoupling,
  expandWorkspaces,
  parseCouplingConfig,
  renderCoupling,
} from "./check-product-coupling";

// Expected values come from the guard's contract, not from its output:
//   - every occurrence of a forbidden pattern in a shared source is a violation
//     named by file:line and pattern, with an excerpt of at most 200 characters;
//   - a declared tree that holds no tracked file is a failure, never a zero;
//   - a workspace package outside every declared tree is a failure (the
//     scanned list cannot silently omit a package);
//   - a file listed as an exemption turns its matches into counted warnings,
//     and an exemption that tolerates nothing is a failure;
//   - test files are out of scope, and counted as excluded rather than ignored;
//   - an unreadable source is a failure;
//   - success prints how many files and lines were examined.

const CONFIG: CouplingConfig = {
  roots: ["packages/shared"],
  patterns: [
    { name: "product-name", regex: /\bwidgetor\b/giu },
    { name: "product-database", regex: /\bWIDGETOR_DB\b/gu },
  ],
};

function input(files: Record<string, string | null>, overrides: Partial<CouplingInput> = {}) {
  const base: CouplingInput = {
    config: CONFIG,
    workspaces: ["packages/shared"],
    tracked: Object.keys(files),
    exempted: new Set(),
    read: (path) => files[path] ?? null,
  };
  return { ...base, ...overrides };
}

describe("evaluateCoupling — forbidden pattern", () => {
  test("a forbidden pattern in a shared source is a violation with file, line and pattern", () => {
    const result = evaluateCoupling(
      input({
        "packages/shared/package.json": "{}\n",
        "packages/shared/src/a.ts": "export const a = 1;\nconst host = 'Widgetor';\n",
      }),
    );
    expect(result.violations).toEqual([
      {
        path: "packages/shared/src/a.ts",
        line: 2,
        pattern: "product-name",
        excerpt: "const host = 'Widgetor';",
      },
    ]);
    const rendered = renderCoupling(result);
    expect(rendered.ok).toBe(false);
    expect(rendered.lines.join("\n")).toContain("packages/shared/src/a.ts:2: product-name");
  });

  test("every occurrence and every pattern of a line is reported, not only the first", () => {
    const result = evaluateCoupling(
      input({
        "packages/shared/package.json": "{}\n",
        "packages/shared/src/a.ts": "widgetor widgetor WIDGETOR_DB\n",
      }),
    );
    // `\bwidgetor\b` does not match inside WIDGETOR_DB: "_" is a word character.
    expect(result.violations.map((finding) => finding.pattern)).toEqual([
      "product-name",
      "product-name",
      "product-database",
    ]);
  });

  test("non-TypeScript sources are scanned too (CSS, JSON, Markdown)", () => {
    const result = evaluateCoupling(
      input({
        "packages/shared/package.json": '{ "description": "for widgetor" }\n',
        "packages/shared/src/theme.css": ".x { content: 'widgetor'; }\n",
        "packages/shared/README.md": "Built for WIDGETOR_DB.\n",
      }),
    );
    expect(result.violations.map((finding) => `${finding.path}:${finding.line}`).sort()).toEqual([
      "packages/shared/README.md:1",
      "packages/shared/package.json:1",
      "packages/shared/src/theme.css:1",
    ]);
  });

  test("the excerpt is bounded to 200 characters and still shows the match", () => {
    const line = `${"x".repeat(500)} widgetor ${"y".repeat(500)}`;
    const result = evaluateCoupling(
      input({ "packages/shared/package.json": "{}\n", "packages/shared/src/a.ts": line }),
    );
    const excerpt = result.violations[0]?.excerpt ?? "";
    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(excerpt).toContain("widgetor");
  });

  test("control characters of the source never reach the log", () => {
    const result = evaluateCoupling(
      input({
        "packages/shared/package.json": "{}\n",
        "packages/shared/src/a.ts": "\u001b[31m widgetor\u0007",
      }),
    );
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting their absence is the point.
    expect(result.violations[0]?.excerpt).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  test("files outside the declared trees are not examined", () => {
    const result = evaluateCoupling(
      input({
        "packages/shared/package.json": "{}\n",
        "packages/shared-extra/a.ts": "widgetor\n",
        "apps/widgetor/a.ts": "widgetor\n",
      }),
    );
    expect(result.violations).toEqual([]);
    expect(result.counts.scanned).toBe(1);
  });

  test("a clean tree passes and prints the examined volume", () => {
    const result = evaluateCoupling(
      input({
        "packages/shared/package.json": "{}\n",
        "packages/shared/src/a.ts": "export const a = 1;\nexport const b = 2;\n",
      }),
    );
    const rendered = renderCoupling(result);
    expect(rendered.ok).toBe(true);
    expect(result.counts).toEqual({ underRoots: 2, scanned: 2, testsExcluded: 0, lines: 3 });
    expect(rendered.lines.join("\n")).toContain("2 file(s) scanned");
    expect(rendered.lines.join("\n")).toContain("3 line(s)");
  });
});

describe("evaluateCoupling — declared trees", () => {
  test("a renamed (absent) declared tree is a failure, not an empty pass", () => {
    const result = evaluateCoupling(
      input({ "packages/renamed/package.json": "{}\n" }, { workspaces: [] }),
    );
    expect(result.missingRoots).toEqual(["packages/shared"]);
    expect(renderCoupling(result).ok).toBe(false);
    expect(renderCoupling(result).lines.join("\n")).toContain("packages/shared");
  });

  test("a workspace package outside every declared tree is a failure", () => {
    const result = evaluateCoupling(
      input(
        { "packages/shared/package.json": "{}\n", "packages/forms/package.json": "{}\n" },
        { workspaces: ["packages/shared", "packages/forms"] },
      ),
    );
    expect(result.uncoveredWorkspaces).toEqual(["packages/forms"]);
    expect(renderCoupling(result).ok).toBe(false);
  });

  test("an unreadable source is a failure, never zero findings", () => {
    const result = evaluateCoupling(
      input({ "packages/shared/package.json": "{}\n", "packages/shared/src/a.ts": null }),
    );
    expect(result.unreadable).toEqual(["packages/shared/src/a.ts"]);
    expect(renderCoupling(result).ok).toBe(false);
  });

  test("test files are excluded and counted, never silently skipped", () => {
    const result = evaluateCoupling(
      input({
        "packages/shared/package.json": "{}\n",
        "packages/shared/src/a.test.ts": "widgetor\n",
        "packages/shared/src/a.process.test.ts": "widgetor\n",
        "packages/shared/src/a.spec.ts": "widgetor\n",
      }),
    );
    expect(result.violations).toEqual([]);
    expect(result.counts).toEqual({ underRoots: 4, scanned: 1, testsExcluded: 3, lines: 1 });
    expect(renderCoupling(result).lines.join("\n")).toContain("3 test file(s) excluded");
  });

  test("a tree holding only test files examined nothing and fails", () => {
    const result = evaluateCoupling(
      input({ "packages/shared/src/a.test.ts": "x\n" }, { workspaces: [] }),
    );
    expect(result.counts.scanned).toBe(0);
    expect(renderCoupling(result).ok).toBe(false);
  });
});

describe("evaluateCoupling — tolerance", () => {
  test("a match in an exempted file is a counted warning, not a violation", () => {
    const result = evaluateCoupling(
      input(
        {
          "packages/shared/package.json": "{}\n",
          "packages/shared/src/a.ts": "widgetor\nwidgetor\n",
        },
        { exempted: new Set(["packages/shared/src/a.ts"]) },
      ),
    );
    expect(result.violations).toEqual([]);
    expect(result.tolerated.map((finding) => finding.line)).toEqual([1, 2]);
    const rendered = renderCoupling(result);
    expect(rendered.ok).toBe(true);
    const text = rendered.lines.join("\n");
    expect(text).toContain("tolerated: packages/shared/src/a.ts:1: product-name");
    expect(text).toContain("2 tolerated match(es) in 1 exempted file(s)");
  });

  test("an exemption that tolerates nothing is a failure", () => {
    const result = evaluateCoupling(
      input(
        { "packages/shared/package.json": "{}\n", "packages/shared/src/a.ts": "clean\n" },
        { exempted: new Set(["packages/shared/src/a.ts"]) },
      ),
    );
    expect(result.staleExemptions).toEqual(["packages/shared/src/a.ts"]);
    expect(renderCoupling(result).ok).toBe(false);
  });
});

describe("parseCouplingConfig", () => {
  const valid = {
    roots: ["packages/shared"],
    patterns: [{ name: "product-name", regex: "\\bwidgetor\\b", why: "a consumer product" }],
  };

  test("accepts roots and named, motivated patterns", () => {
    const result = parseCouplingConfig(JSON.stringify(valid));
    if (!result.ok) throw new Error(result.error);
    expect(result.config.roots).toEqual(["packages/shared"]);
    expect(result.config.patterns.map((pattern) => pattern.name)).toEqual(["product-name"]);
  });

  test.each([
    ["not JSON", "{"],
    ["no root", JSON.stringify({ ...valid, roots: [] })],
    ["no pattern", JSON.stringify({ ...valid, patterns: [] })],
    ["a root escaping the repository", JSON.stringify({ ...valid, roots: ["../outside"] })],
    ["an absolute root", JSON.stringify({ ...valid, roots: ["/packages/shared"] })],
    ["a wildcard root", JSON.stringify({ ...valid, roots: ["packages/*"] })],
    ["nested roots", JSON.stringify({ ...valid, roots: ["packages", "packages/shared"] })],
    [
      "a pattern without reason",
      JSON.stringify({ ...valid, patterns: [{ name: "p", regex: "x", why: "" }] }),
    ],
    [
      "an invalid regular expression",
      JSON.stringify({ ...valid, patterns: [{ name: "p", regex: "(", why: "w" }] }),
    ],
    [
      "a pattern matching the empty string",
      JSON.stringify({ ...valid, patterns: [{ name: "p", regex: "x*", why: "w" }] }),
    ],
    [
      "a duplicate pattern name",
      JSON.stringify({
        ...valid,
        patterns: [
          { name: "p", regex: "x", why: "w" },
          { name: "p", regex: "y", why: "w" },
        ],
      }),
    ],
    ["an unknown key", JSON.stringify({ ...valid, extra: true })],
  ])("refuses %s", (_label, text) => {
    expect(parseCouplingConfig(text).ok).toBe(false);
  });
});

describe("expandWorkspaces", () => {
  const tracked = new Set([
    "packages/a/package.json",
    "packages/a/src/x.ts",
    "packages/b/package.json",
    "packages/c/readme.md",
    "tools/one/package.json",
  ]);

  test("expands 'dir/*' to the directories holding a tracked package.json", () => {
    expect(expandWorkspaces(["packages/*", "tools/one"], tracked)).toEqual({
      ok: true,
      packages: ["packages/a", "packages/b", "tools/one"],
    });
  });

  test("a literal workspace without a tracked package.json is refused", () => {
    expect(expandWorkspaces(["tools/two"], tracked).ok).toBe(false);
  });

  test("a pattern it cannot expand exactly is refused, never guessed", () => {
    expect(expandWorkspaces(["packages/**"], tracked).ok).toBe(false);
    expect(expandWorkspaces(["../x"], tracked).ok).toBe(false);
  });
});
