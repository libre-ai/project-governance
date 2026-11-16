import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type BoundaryTable,
  checkImportBoundaries,
  type PackageInput,
  parseBoundaryTable,
  readWorkspace,
  TABLE_PATH,
} from "./check-import-boundaries";

// Every expectation below comes from the brief of the gate, not from its output:
// an internal import must match a declared dependency (production, peer or
// development), no import may target a product package even when declared, a
// per-package table of forbidden modules applies even to declared modules
// (exact module and sub-paths), comment lines are not read, and a package
// importing itself is not in violation.

const EMPTY_TABLE: BoundaryTable = { products: [], forbidden: new Map() };

function tableOf(forbidden: Record<string, readonly string[]>): BoundaryTable {
  return { products: [], forbidden: new Map(Object.entries(forbidden)) };
}

function manifest(fields: Record<string, unknown>): string {
  return JSON.stringify({ name: "@libre-ai/alpha", ...fields });
}

function alpha(source: string, manifestText: string | null = manifest({})): PackageInput {
  return {
    dir: "packages/alpha",
    manifest: manifestText,
    files: [{ path: "packages/alpha/src/index.ts", content: source }],
  };
}

describe("rule 1 — an internal import matches a declared dependency", () => {
  test("an undeclared internal import is a violation naming package, file, line and target", () => {
    const result = checkImportBoundaries(
      [alpha('const a = 1;\nimport { b } from "@libre-ai/beta";\n')],
      EMPTY_TABLE,
    );
    expect(result.violations).toEqual([
      {
        package: "@libre-ai/alpha",
        file: "packages/alpha/src/index.ts",
        line: 2,
        target: "@libre-ai/beta",
        reason: expect.stringContaining("not declared"),
      },
    ]);
  });

  test("the same import declared as a development dependency is accepted", () => {
    const result = checkImportBoundaries(
      [
        alpha(
          'import { b } from "@libre-ai/beta";\n',
          manifest({ devDependencies: { "@libre-ai/beta": "1.0.0" } }),
        ),
      ],
      EMPTY_TABLE,
    );
    expect(result.violations).toEqual([]);
    expect(result.counters.internalImports).toBe(1);
  });

  test("production and peer declarations are accepted, and a sub-path resolves to its package", () => {
    const result = checkImportBoundaries(
      [
        alpha(
          'import "@libre-ai/beta/deep/x";\nconst g = require("@libre-ai/gamma");\n',
          manifest({
            dependencies: { "@libre-ai/beta": "1.0.0" },
            peerDependencies: { "@libre-ai/gamma": "1.0.0" },
          }),
        ),
      ],
      EMPTY_TABLE,
    );
    expect(result.violations).toEqual([]);
    expect(result.counters.internalImports).toBe(2);
  });

  test("a package importing itself is not in violation", () => {
    const result = checkImportBoundaries(
      [alpha('export { x } from "@libre-ai/alpha/inner";\n')],
      EMPTY_TABLE,
    );
    expect(result.violations).toEqual([]);
  });

  test("dynamic imports and re-exports are read", () => {
    const result = checkImportBoundaries(
      [alpha('const m = await import("@libre-ai/beta");\nexport * from "@libre-ai/gamma";\n')],
      EMPTY_TABLE,
    );
    expect(result.violations.map((violation) => violation.target)).toEqual([
      "@libre-ai/beta",
      "@libre-ai/gamma",
    ]);
  });

  test("an unreadable manifest fails closed: the manifest and every internal import are violations", () => {
    const result = checkImportBoundaries(
      [alpha('import { b } from "@libre-ai/beta";\n', "{ not json")],
      EMPTY_TABLE,
    );
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]?.file).toBe("packages/alpha/package.json");
    expect(result.violations[1]?.target).toBe("@libre-ai/beta");
  });

  test("a missing manifest fails closed too", () => {
    const result = checkImportBoundaries(
      [alpha('import { b } from "@libre-ai/beta";\n', null)],
      EMPTY_TABLE,
    );
    expect(result.violations).toHaveLength(2);
  });

  // A nameless manifest cannot be bound by the table of forbidden modules, which
  // names packages: reading it as valid would lift every refusal of that package.
  test.each([
    ["no name", JSON.stringify({ dependencies: {} })],
    ["an empty name", JSON.stringify({ name: "  " })],
    ["a non-string name", JSON.stringify({ name: 3 })],
  ])("a manifest with %s fails closed like an unreadable one", (_label, text) => {
    const result = checkImportBoundaries(
      [alpha('import { b } from "@libre-ai/beta";\n', text)],
      EMPTY_TABLE,
    );
    expect(result.violations.map((violation) => violation.file)).toEqual([
      "packages/alpha/package.json",
      "packages/alpha/src/index.ts",
    ]);
  });

  test("a package named like an Object.prototype member is judged, not thrown on", () => {
    const named: PackageInput = {
      dir: "packages/constructor",
      manifest: JSON.stringify({ name: "constructor" }),
      files: [{ path: "packages/constructor/src/a.ts", content: 'import "@libre-ai/beta";\n' }],
    };
    const result = checkImportBoundaries([named], EMPTY_TABLE);
    expect(result.violations.map((violation) => violation.target)).toEqual(["@libre-ai/beta"]);
  });
});

describe("the import reader stays linear", () => {
  // `import` followed by many spaces is the input on which two `\s*` separated
  // by an optional token backtrack quadratically: 80 000 spaces took 19 s.
  test("an import keyword followed by 200 000 spaces is read in well under a second", () => {
    const source = `import${" ".repeat(200_000)}x\nimport "@libre-ai/beta";\n`;
    const started = performance.now();
    const result = checkImportBoundaries([alpha(source)], EMPTY_TABLE);
    const elapsed = performance.now() - started;
    expect(result.violations.map((violation) => violation.line)).toEqual([2]);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("rule 2 — no import targets a product", () => {
  test("an import of a product package is refused even when declared", () => {
    const result = checkImportBoundaries(
      [
        alpha(
          'import { p } from "@libre-ai/notebook/server";\n',
          manifest({ dependencies: { "@libre-ai/notebook": "1.0.0" } }),
        ),
      ],
      { products: ["@libre-ai/notebook"], forbidden: new Map() },
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.target).toBe("@libre-ai/notebook/server");
    expect(result.violations[0]?.reason).toContain("product");
  });

  test("a name that only shares a prefix with a product is not a product", () => {
    const result = checkImportBoundaries(
      [
        alpha(
          'import { p } from "@libre-ai/notebook-kit";\n',
          manifest({ dependencies: { "@libre-ai/notebook-kit": "1.0.0" } }),
        ),
      ],
      { products: ["@libre-ai/notebook"], forbidden: new Map() },
    );
    expect(result.violations).toEqual([]);
  });
});

describe("rule 3 — the table of forbidden modules wins over declarations", () => {
  const table = tableOf({ "@libre-ai/alpha": ["@libre-ai/beta", "node:child_process"] });
  const declared = manifest({ dependencies: { "@libre-ai/beta": "1.0.0" } });

  test("a forbidden module is refused even when declared, sub-paths included", () => {
    const result = checkImportBoundaries(
      [alpha('import "@libre-ai/beta";\nimport { y } from "@libre-ai/beta/sub";\n', declared)],
      table,
    );
    expect(result.violations.map((violation) => [violation.line, violation.reason])).toEqual([
      [1, expect.stringContaining("forbidden")],
      [2, expect.stringContaining("forbidden")],
    ]);
  });

  test("the table applies to non-internal modules as well", () => {
    const result = checkImportBoundaries(
      [alpha('import { spawn } from "node:child_process";\n', declared)],
      table,
    );
    expect(result.violations).toHaveLength(1);
  });

  test("the table binds only the package it names", () => {
    const other: PackageInput = {
      dir: "packages/delta",
      manifest: JSON.stringify({
        name: "@libre-ai/delta",
        dependencies: { "@libre-ai/beta": "1.0.0" },
      }),
      files: [{ path: "packages/delta/src/index.ts", content: 'import "@libre-ai/beta";\n' }],
    };
    const result = checkImportBoundaries([alpha("export {};\n", declared), other], table);
    expect(result.violations).toEqual([]);
    expect(result.counters.boundForbiddenLists).toBe(1);
  });

  // A key that names no package lifts nothing it was meant to refuse: the
  // package it meant was renamed, or the key is misspelt. Either way the
  // refusal is open, so the key itself is the violation.
  test.each([
    ["a misspelt key", "@libre-ai/alhpa", "@libre-ai/alpha"],
    ["a package renamed away from its key", "@libre-ai/alpha", "@libre-ai/alpha2"],
  ])("%s is a violation naming the key", (_label, key, packageName) => {
    const renamed: PackageInput = {
      dir: "packages/alpha",
      manifest: JSON.stringify({ name: packageName }),
      files: [{ path: "packages/alpha/src/index.ts", content: 'import "node:child_process";\n' }],
    };
    const result = checkImportBoundaries([renamed], tableOf({ [key]: ["node:child_process"] }));
    expect(result.violations).toEqual([
      {
        package: key,
        file: TABLE_PATH,
        line: 0,
        target: key,
        reason: expect.stringContaining("names no package of this workspace"),
      },
    ]);
    expect(result.counters.boundForbiddenLists).toBe(0);
  });
});

describe("comment lines are not read", () => {
  test("an import inside a line, block or doc comment is ignored", () => {
    const source = [
      '// import { a } from "@libre-ai/beta";',
      '/* import "@libre-ai/beta"; */',
      "/**",
      ' * import { a } from "@libre-ai/beta";',
      ' import { a } from "@libre-ai/beta";',
      " */",
      "export const ok = 1;",
    ].join("\n");
    const result = checkImportBoundaries([alpha(source)], EMPTY_TABLE);
    expect(result.violations).toEqual([]);
    expect(result.counters.internalImports).toBe(0);
  });

  test("code after a closed block comment is read again", () => {
    const source = '/*\n note\n*/\nimport { a } from "@libre-ai/beta";\n';
    const result = checkImportBoundaries([alpha(source)], EMPTY_TABLE);
    expect(result.violations.map((violation) => violation.line)).toEqual([4]);
  });

  test("code after a block comment closed on the same line is read", () => {
    const source = [
      '/* x */ import { b } from "@libre-ai/beta";',
      "/*",
      ' note */ import "@libre-ai/gamma";',
    ].join("\n");
    const result = checkImportBoundaries([alpha(source)], EMPTY_TABLE);
    expect(result.violations.map((violation) => [violation.line, violation.target])).toEqual([
      [1, "@libre-ai/beta"],
      [3, "@libre-ai/gamma"],
    ]);
  });

  test("a block comment opened after code hides the lines it covers", () => {
    const source = [
      "const a = 1; /* start",
      'import { b } from "@libre-ai/beta";',
      "end */ const c = 2; // trailing",
      'const d = 3; // import "@libre-ai/gamma";',
    ].join("\n");
    const result = checkImportBoundaries([alpha(source)], EMPTY_TABLE);
    expect(result.violations).toEqual([]);
  });

  test("comment openers inside a string do not open a comment", () => {
    const source = [
      'const s = "/*"; import "@libre-ai/beta";',
      'const u = "http://x"; import "@libre-ai/gamma";',
    ].join("\n");
    const result = checkImportBoundaries([alpha(source)], EMPTY_TABLE);
    expect(result.violations.map((violation) => violation.target)).toEqual([
      "@libre-ai/beta",
      "@libre-ai/gamma",
    ]);
  });
});

describe("template-literal specifiers", () => {
  test("a dynamic import written as a plain template literal is read", () => {
    const result = checkImportBoundaries(
      [alpha("const m = await import(`@libre-ai/beta`);\n")],
      EMPTY_TABLE,
    );
    expect(result.violations.map((violation) => violation.target)).toEqual(["@libre-ai/beta"]);
  });

  test("a template literal with a substitution is not a readable specifier", () => {
    const result = checkImportBoundaries(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the substitution is the fixture.
      [alpha("const m = await import(`@libre-ai/${name}`);\n")],
      EMPTY_TABLE,
    );
    expect(result.counters.imports).toBe(0);
  });
});

describe("parseBoundaryTable", () => {
  test("reads a well-formed table", () => {
    const table = parseBoundaryTable(
      JSON.stringify({
        because: "why",
        products: ["@libre-ai/notebook"],
        forbidden: { "@libre-ai/alpha": ["node:fs"] },
      }),
    );
    expect(table).toEqual({
      products: ["@libre-ai/notebook"],
      forbidden: new Map([["@libre-ai/alpha", ["node:fs"]]]),
    });
  });

  test("a __proto__ key is kept as a key, not lost into the prototype", () => {
    const table = parseBoundaryTable(
      '{"because":"x","products":[],"forbidden":{"__proto__":["node:fs"],"constructor":["node:os"]}}',
    );
    expect([...table.forbidden.entries()]).toEqual([
      ["__proto__", ["node:fs"]],
      ["constructor", ["node:os"]],
    ]);
  });

  test.each([
    ["not JSON", "{"],
    ["a missing reason", JSON.stringify({ products: [], forbidden: {} })],
    ["a non-list of products", JSON.stringify({ because: "x", products: "a", forbidden: {} })],
    ["an empty module", JSON.stringify({ because: "x", products: [""], forbidden: {} })],
    [
      "a non-list of forbidden modules",
      JSON.stringify({ because: "x", products: [], forbidden: { a: "b" } }),
    ],
    ["an unknown key", JSON.stringify({ because: "x", products: [], forbidden: {}, extra: 1 })],
    [
      "an empty package key",
      JSON.stringify({ because: "x", products: [], forbidden: { " ": [] } }),
    ],
  ])("refuses %s", (_label, text) => {
    expect(() => parseBoundaryTable(text)).toThrow();
  });

  test("the table of this repository parses", async () => {
    const text = await Bun.file(join(import.meta.dir, "..", "..", TABLE_PATH)).text();
    expect(() => parseBoundaryTable(text)).not.toThrow();
  });
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "import-boundaries-"));
  roots.push(root);
  return root;
}

function put(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

describe("readWorkspace", () => {
  test("reads .ts and .tsx sources of each first-level package, outside dependencies", () => {
    const root = fixtureRoot();
    put(root, "packages/alpha/package.json", manifest({}));
    put(root, "packages/alpha/src/a.ts", "export {};\n");
    put(root, "packages/alpha/src/view/b.tsx", "export {};\n");
    put(root, "packages/alpha/src/notes.md", "text\n");
    put(root, "packages/alpha/src/node_modules/x/index.ts", "export {};\n");
    put(root, "packages/alpha/other/c.ts", "export {};\n");
    put(root, "packages/beta/package.json", "{}");
    symlinkSync(join(root, "packages/alpha/src/a.ts"), join(root, "packages/alpha/src/link.ts"));

    const workspace = readWorkspace(root);
    expect(workspace.packages.map((entry) => entry.dir)).toEqual([
      "packages/alpha",
      "packages/beta",
    ]);
    expect(workspace.packages[0]?.files.map((file) => file.path)).toEqual([
      "packages/alpha/src/a.ts",
      "packages/alpha/src/view/b.tsx",
    ]);
    expect(workspace.packages[0]?.manifest).toBe(manifest({}));
    // A package without a source folder holds zero files, without error.
    expect(workspace.packages[1]?.files).toEqual([]);
    expect(workspace.linksSkipped).toBe(1);
  });

  test("an unreadable manifest is read as null", () => {
    const root = fixtureRoot();
    put(root, "packages/alpha/src/a.ts", "export {};\n");
    expect(readWorkspace(root).packages[0]?.manifest).toBeNull();
  });

  // The brief keeps an unreadable source folder at zero files without error;
  // what it must not do is look like an absent one, so it is counted apart.
  test("an unreadable source folder holds zero files and is counted, an absent one is not", () => {
    const root = fixtureRoot();
    put(root, "packages/alpha/package.json", manifest({}));
    put(root, "packages/alpha/src/a.ts", "export {};\n");
    put(root, "packages/beta/package.json", "{}");
    chmodSync(join(root, "packages/alpha/src"), 0o000);
    try {
      const workspace = readWorkspace(root);
      expect(workspace.packages[0]?.files).toEqual([]);
      expect(workspace.unreadableDirectories).toEqual(["packages/alpha/src"]);
    } finally {
      chmodSync(join(root, "packages/alpha/src"), 0o755);
    }
  });
});

describe("command", () => {
  const command = join(import.meta.dir, "check-import-boundaries.ts");

  function run(root: string): { code: number; stdout: string; stderr: string } {
    const result = Bun.spawnSync(["bun", command], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
    });
    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }

  function table(root: string): void {
    put(root, TABLE_PATH, JSON.stringify({ because: "test", products: [], forbidden: {} }));
  }

  test("exit 0 with the examined volume when every import is declared", () => {
    const root = fixtureRoot();
    table(root);
    put(
      root,
      "packages/alpha/package.json",
      manifest({ dependencies: { "@libre-ai/beta": "1.0.0" } }),
    );
    put(root, "packages/alpha/src/a.ts", 'import "@libre-ai/beta";\n');
    const result = run(root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("1 package(s)");
    expect(result.stdout).toContain("1 file(s)");
    expect(result.stdout).toContain("1 internal import(s)");
    expect(result.stdout).toContain("0 unreadable directory(ies)");
  });

  test("the success line says how many forbidden-module lists bound a package", () => {
    const root = fixtureRoot();
    put(
      root,
      TABLE_PATH,
      JSON.stringify({
        because: "test",
        products: [],
        forbidden: { "@libre-ai/alpha": ["node:child_process"] },
      }),
    );
    put(root, "packages/alpha/package.json", manifest({}));
    put(root, "packages/alpha/src/a.ts", "export {};\n");
    const result = run(root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("1 forbidden-module list(s) bound to a package");
  });

  test("an orphan key of the table fails the command", () => {
    const root = fixtureRoot();
    put(
      root,
      TABLE_PATH,
      JSON.stringify({ because: "test", products: [], forbidden: { "@libre-ai/alhpa": ["x"] } }),
    );
    put(root, "packages/alpha/package.json", manifest({}));
    put(root, "packages/alpha/src/a.ts", "export {};\n");
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("@libre-ai/alhpa");
  });

  test("exit 1 with the list and the total on stderr", () => {
    const root = fixtureRoot();
    table(root);
    put(root, "packages/alpha/package.json", manifest({}));
    put(root, "packages/alpha/src/a.ts", 'import "@libre-ai/beta";\n');
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("packages/alpha/src/a.ts:1");
    expect(result.stderr).toContain("@libre-ai/beta");
    expect(result.stderr).toContain("failed: 1 of");
  });

  test("an unreadable table fails", () => {
    const root = fixtureRoot();
    put(root, "packages/alpha/package.json", manifest({}));
    put(root, "packages/alpha/src/a.ts", "export {};\n");
    expect(run(root).code).toBe(1);
  });

  test("a workspace without any package fails rather than passing over nothing", () => {
    const root = fixtureRoot();
    table(root);
    mkdirSync(join(root, "packages"));
    expect(run(root).code).toBe(1);
  });
});
