import { afterAll, describe, expect, test } from "bun:test";

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { applyMutant, classify, parseCatalogue, SiteError } from "./mutant";

// The expected values below come from the lot brief (L062), not from the tool's output:
// exit codes 0 all killed, 1 otherwise, 2 red base, 3 usage or invalid site, 130 interrupt;
// totals `mutants = killed + survived + invalid`; a failure before any assertion is invalid.

const TOOL = join(import.meta.dir, "mutant.ts");
const SCRATCH_PREFIX = join(tmpdir(), "mutant-test-");
const scratch = mkdtempSync(SCRATCH_PREFIX);

afterAll(() => {
  // Only ever the directory mkdtempSync just returned: a recursive delete must never reach
  // anything else.
  if (scratch.startsWith(SCRATCH_PREFIX)) rmSync(scratch, { recursive: true, force: true });
});

describe("applyMutant", () => {
  test("replaces the single occurrence of the anchor", () => {
    expect(applyMutant("a\nreturn x > 0;\nb\n", "return x > 0;", "return true;")).toBe(
      "a\nreturn true;\nb\n",
    );
  });

  test("an absent anchor is an error", () => {
    expect(() => applyMutant("return x;\n", "return y;", "return z;")).toThrow(SiteError);
    expect(() => applyMutant("return x;\n", "return y;", "return z;")).toThrow("found 0 times");
  });

  test("an anchor present twice is an error", () => {
    expect(() => applyMutant("f(x);\nf(x);\n", "f(x);", "g(x);")).toThrow("found 2 times");
  });

  test("overlapping occurrences count: `aa` is twice in `aaa`, so the site is ambiguous", () => {
    expect(() => applyMutant("aaa\n", "aa", "bb")).toThrow("found 2 times");
    expect(() => applyMutant("abab ab\n", "abab", "cdcd")).not.toThrow();
    expect(() => applyMutant("ababab\n", "abab", "cdcd")).toThrow("found 2 times");
  });

  test("a substitution identical to the anchor is an error", () => {
    expect(() => applyMutant("f(x);\n", "f(x);", "f(x);")).toThrow("identical");
  });

  test("a substitution that deletes instead of replacing is an error", () => {
    expect(() => applyMutant("f(x);\n", "f(x);", "   ")).toThrow("deletes");
    expect(() => applyMutant("a();\nb();\n", "a();\nb();", "a();")).toThrow("deletes");
  });
});

describe("parseCatalogue", () => {
  const mutant = {
    id: "guard-open",
    file: "guard.ts",
    anchor: "return value > 0;",
    substitution: "return true;",
    oracle: { tests: ["guard.test.ts"] },
  };

  test("accepts a well-formed catalogue", () => {
    const catalogue = parseCatalogue({ schema: "mutants.v1", mutants: [mutant] });
    expect(catalogue.mutants.length).toBe(1);
    expect(catalogue.mutants[0]?.oracle.trace).toBeUndefined();
  });

  test("refuses a path that leaves the repository or is absolute", () => {
    for (const file of ["../guard.ts", "/etc/passwd", "a/../../b.ts", "a\\b.ts", "./guard.ts"]) {
      expect(() =>
        parseCatalogue({ schema: "mutants.v1", mutants: [{ ...mutant, file }] }),
      ).toThrow("path");
    }
    expect(() =>
      parseCatalogue({
        schema: "mutants.v1",
        mutants: [{ ...mutant, oracle: { tests: ["../x.test.ts"] } }],
      }),
    ).toThrow("path");
  });

  test("refuses unknown keys, duplicate ids, a wrong schema and an empty oracle", () => {
    expect(() =>
      parseCatalogue({ schema: "mutants.v1", mutants: [{ ...mutant, extra: 1 }] }),
    ).toThrow("unknown key");
    expect(() => parseCatalogue({ schema: "mutants.v1", mutants: [mutant, mutant] })).toThrow(
      "duplicate id",
    );
    expect(() => parseCatalogue({ schema: "mutants.v2", mutants: [] })).toThrow("schema");
    expect(() =>
      parseCatalogue({ schema: "mutants.v1", mutants: [{ ...mutant, oracle: { tests: [] } }] }),
    ).toThrow("oracle");
  });
});

const report = (tests: number, failures: string[]): string =>
  [
    `<testsuites name="bun test" tests="${tests}" assertions="1" failures="${failures.length}" skipped="0">`,
    ...failures.map((type) => `<failure type="${type}" message="m">x</failure>`),
    "</testsuites>",
  ].join("\n");

describe("classify", () => {
  test("a red run with an assertion failure kills the mutant", () => {
    expect(classify(1, report(3, ["AssertionError"]), "", undefined).verdict).toBe("killed");
  });

  test("a failure before any assertion is invalid, not killed", () => {
    // Load failure: bun writes no report at all.
    expect(classify(1, null, "error: Cannot find module", undefined).verdict).toBe("invalid");
    // A thrown error is not an assertion.
    expect(classify(1, report(3, ["Error"]), "", undefined).verdict).toBe("invalid");
    // An unreadable report proves nothing.
    expect(classify(1, "garbage", "", undefined).verdict).toBe("invalid");
  });

  test("a red run without the expected trace is invalid", () => {
    expect(classify(1, report(3, ["AssertionError"]), "Received: 1", "Received: 999").verdict).toBe(
      "invalid",
    );
    expect(
      classify(1, report(3, ["AssertionError"]), "Received: 999", "Received: 999").verdict,
    ).toBe("killed");
  });

  test("a green run with tests is survived; a green run with no test is invalid", () => {
    expect(classify(0, report(3, []), "", undefined).verdict).toBe("survived");
    expect(classify(0, report(0, []), "", undefined).verdict).toBe("invalid");
    expect(classify(0, null, "", undefined).verdict).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------------------------
// End to end, on a throwaway git repository.

const GUARD = "export function allow(value: number): boolean {\n  return value > 0;\n}\n";
const GUARD_TEST = [
  'import { expect, test } from "bun:test";',
  'import { allow } from "./guard";',
  'test("refuses a negative value", () => { expect(allow(-1)).toBe(false); });',
  'test("accepts a positive value", () => { expect(allow(1)).toBe(true); });',
  // Inherited from the launcher's environment unless the child's environment is purged.
  'test("ambient environment is purged", () => { expect(process.env.MUTANT_AMBIENT).toBeUndefined(); });',
  "",
].join("\n");

interface MutantEntry {
  id: string;
  file: string;
  anchor: string;
  substitution: string;
  oracle: { tests: string[]; trace?: string };
}

const entry = (
  id: string,
  substitution: string,
  extra: Partial<MutantEntry> = {},
): MutantEntry => ({
  id,
  file: "guard.ts",
  anchor: "return value > 0;",
  substitution,
  oracle: { tests: ["guard.test.ts"] },
  ...extra,
});

interface FixtureSetup {
  /** Run before `git add -A`: what it creates is tracked (symbolic links included). */
  readonly before?: (root: string) => void;
  /** Run after `git add -A`: what it creates exists on disk but is not tracked. */
  readonly after?: (root: string) => void;
}

let fixtures = 0;
function fixture(
  mutants: MutantEntry[],
  files: Record<string, string> = {},
  setup: FixtureSetup = {},
): string {
  fixtures += 1;
  const root = join(scratch, `repo-${fixtures}`);
  mkdirSync(root, { recursive: true });
  const all: Record<string, string> = {
    "guard.ts": GUARD,
    "guard.test.ts": GUARD_TEST,
    "mutants.v1.json": `${JSON.stringify({ schema: "mutants.v1", mutants }, null, 2)}\n`,
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  setup.before?.(root);
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
  ]) {
    const result = Bun.spawnSync(["git", "-C", root, ...args]);
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
  }
  setup.after?.(root);
  return root;
}

/** A file outside every fixture repository, to prove the launcher never writes there. */
function outsideFile(name: string, content: string): string {
  const dir = join(scratch, `outside-${fixtures + 1}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

interface Run {
  code: number;
  output: string;
  tmp: string;
}

function launch(root: string, args: string[]) {
  // TMPDIR is watched for leftovers of the work copy; HOME is apart, the runtime writes there.
  const tmp = mkdtempSync(join(scratch, "tmp-"));
  const home = mkdtempSync(join(scratch, "home-"));
  const child = Bun.spawn(
    [process.execPath, TOOL, "run", "--catalogue", join(root, "mutants.v1.json"), ...args],
    {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: tmp, MUTANT_AMBIENT: "leaked" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return { child, tmp };
}

async function run(root: string, args: string[] = []): Promise<Run> {
  const { child, tmp } = launch(root, args);
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, output: `${stdout}${stderr}`, tmp };
}

describe("mutant run (end to end)", () => {
  test("a mutant killed by assertion: exit 0, totals sum, work copy removed, tree intact", async () => {
    const root = fixture([entry("guard-open", "return true;")]);
    const result = await run(root);
    expect(result.output).toContain("mutant id=guard-open verdict=killed");
    expect(result.output).toContain("restored=identical");
    expect(result.output).toContain("mutants=1 killed=1 survived=0 invalid=0 restored_identical=1");
    expect(result.code).toBe(0);
    expect(readFileSync(join(root, "guard.ts"), "utf8")).toBe(GUARD);
    expect(readdirSync(result.tmp)).toEqual([]);
  }, 60_000);

  test("a surviving mutant is red", async () => {
    const root = fixture([entry("guard-equivalent", "return 0 < value;")]);
    const result = await run(root);
    expect(result.output).toContain("mutant id=guard-equivalent verdict=survived");
    expect(result.output).toContain("mutants=1 killed=0 survived=1 invalid=0");
    expect(result.code).toBe(1);
  }, 60_000);

  test("an empty list is red", async () => {
    const root = fixture([]);
    const result = await run(root);
    expect(result.output).toContain("mutants=0 killed=0 survived=0 invalid=0");
    expect(result.code).toBe(1);
  }, 60_000);

  test("a failure before any assertion is invalid and red, never killed", async () => {
    const root = fixture([
      entry("guard-syntax", "return value > ;"),
      entry("guard-throws", 'throw new Error("not an assertion");'),
    ]);
    const result = await run(root);
    expect(result.output).toContain("mutant id=guard-syntax verdict=invalid");
    expect(result.output).toContain("mutant id=guard-throws verdict=invalid");
    expect(result.output).toContain("mutants=2 killed=0 survived=0 invalid=2");
    expect(result.code).toBe(1);
  }, 60_000);

  test("a red run without the declared trace is invalid", async () => {
    const root = fixture([
      entry("guard-open", "return true;", {
        oracle: { tests: ["guard.test.ts"], trace: "trace-that-never-prints" },
      }),
    ]);
    const result = await run(root);
    expect(result.output).toContain("mutant id=guard-open verdict=invalid");
    expect(result.code).toBe(1);
  }, 60_000);

  test("a red base stops everything with exit 2 before any mutant", async () => {
    const root = fixture([entry("guard-open", "return true;")], {
      "guard.test.ts": GUARD_TEST.replace("allow(1)).toBe(true)", "allow(0)).toBe(true)"),
    });
    const result = await run(root);
    expect(result.output).not.toContain("mutant id=");
    expect(result.code).toBe(2);
  }, 60_000);

  test("an invalid site (absent, double, identical) exits 3, in run and in --validate", async () => {
    const root = fixture([
      entry("absent", "return 1;", { anchor: "return nothing;" }),
      entry("double", "x", { anchor: "e" }),
      entry("identical", "return value > 0;"),
    ]);
    const validate = await run(root, ["--validate"]);
    expect(validate.output).toContain("site id=absent anchors=0 verdict=invalid");
    expect(validate.output).toContain("verdict=invalid (anchor found");
    expect(validate.output).toContain("site id=identical anchors=1 verdict=invalid");
    expect(validate.output).toContain("sites=3 valid=0 invalid=3");
    expect(validate.code).toBe(3);
    expect((await run(root)).code).toBe(3);
  }, 60_000);

  test("--validate on a valid catalogue exits 0 and runs nothing", async () => {
    const root = fixture([entry("guard-open", "return true;")]);
    const result = await run(root, ["--validate"]);
    expect(result.output).toContain("sites=1 valid=1 invalid=0");
    expect(result.output).not.toContain("mutant id=");
    expect(result.code).toBe(0);
  }, 60_000);

  test("--id runs one mutant; an unknown id and an unknown flag are usage errors", async () => {
    const root = fixture([
      entry("guard-open", "return true;"),
      entry("guard-eq", "return 0 < value;"),
    ]);
    const one = await run(root, ["--id", "guard-open"]);
    expect(one.output).toContain("mutants=1 killed=1");
    expect(one.output).not.toContain("guard-eq");
    expect(one.code).toBe(0);
    expect((await run(root, ["--id", "nope"])).code).toBe(3);
    expect((await run(root, ["--bogus"])).code).toBe(3);
  }, 60_000);

  test("a mutated file outside the repository is refused with exit 3", async () => {
    const root = fixture([entry("escape", "return true;", { file: "../guard.ts" })]);
    expect((await run(root, ["--validate"])).code).toBe(3);
  }, 60_000);

  test("a file on disk but not tracked is refused with exit 3, as file and as oracle", async () => {
    const asFile = fixture(
      [entry("untracked-file", "return true;", { file: "loose.ts" })],
      {},
      {
        after: (root) => writeFileSync(join(root, "loose.ts"), GUARD),
      },
    );
    const asOracle = fixture(
      [entry("untracked-oracle", "return true;", { oracle: { tests: ["loose.test.ts"] } })],
      {},
      { after: (root) => writeFileSync(join(root, "loose.test.ts"), GUARD_TEST) },
    );
    for (const [root, path] of [
      [asFile, "loose.ts"],
      [asOracle, "loose.test.ts"],
    ] as const) {
      const validate = await run(root, ["--validate"]);
      expect(validate.output).toContain(`${path} is not a tracked file`);
      expect(validate.code).toBe(3);
      const full = await run(root);
      expect(full.output).toContain(`${path} is not a tracked file`);
      expect(full.output).not.toContain("mutant id=");
      expect(full.code).toBe(3);
    }
  }, 60_000);

  test("a tracked symbolic link leaving the repository is refused; the outside file is untouched", async () => {
    const outside = outsideFile("guard.ts", GUARD);
    const link = (root: string) => symlinkSync(outside, join(root, "link.ts"));
    const asFile = fixture(
      [entry("link-file", "return true;", { file: "link.ts" })],
      {},
      {
        before: link,
      },
    );
    const asOracle = fixture(
      [entry("link-oracle", "return true;", { oracle: { tests: ["link.ts"] } })],
      {},
      { before: link },
    );
    for (const root of [asFile, asOracle]) {
      const validate = await run(root, ["--validate"]);
      expect(validate.output).toContain("link.ts is not a regular file");
      expect(validate.code).toBe(3);
      const full = await run(root);
      expect(full.output).toContain("link.ts is not a regular file");
      expect(full.output).not.toContain("mutant id=");
      expect(full.code).toBe(3);
    }
    expect(readFileSync(outside, "utf8")).toBe(GUARD);
  }, 60_000);

  test("a tracked path under a directory that now leads outside is refused", async () => {
    const outside = outsideFile("other.ts", "export const other = 1;\n");
    const root = fixture(
      [
        entry("escape-dir", "export const other = 2;", {
          file: "sub/other.ts",
          anchor: "export const other = 1;",
        }),
      ],
      { "sub/other.ts": "export const other = 1;\n" },
      {
        // The index still lists sub/other.ts; on disk, sub now points outside the repository.
        after: (dir) => {
          rmSync(join(dir, "sub", "other.ts"));
          rmdirSync(join(dir, "sub"));
          symlinkSync(dirname(outside), join(dir, "sub"));
        },
      },
    );
    const validate = await run(root, ["--validate"]);
    expect(validate.output).toContain("sub/other.ts resolves outside the repository");
    expect(validate.code).toBe(3);
    expect(readFileSync(outside, "utf8")).toBe("export const other = 1;\n");
  }, 60_000);

  test("a mutated file turned into a link outside the copy between two mutants is never written", async () => {
    const outside = outsideFile("other.ts", "export const other = 1;\n");
    // When guard.ts is mutated, this oracle replaces other.ts in the copy by a link outside.
    const sabotage = [
      'import { expect, test } from "bun:test";',
      'import { rmSync, symlinkSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { allow } from "./guard";',
      'test("refuses a negative value", () => {',
      "  if (allow(-1)) {",
      '    rmSync(join(import.meta.dir, "other.ts"));',
      `    symlinkSync(${JSON.stringify(outside)}, join(import.meta.dir, "other.ts"));`,
      "  }",
      "  expect(allow(-1)).toBe(false);",
      "});",
      "",
    ].join("\n");
    const root = fixture(
      [
        entry("guard-open", "return true;", { oracle: { tests: ["sabotage.test.ts"] } }),
        entry("other", "export const other = 2;", {
          file: "other.ts",
          anchor: "export const other = 1;",
        }),
      ],
      { "sabotage.test.ts": sabotage, "other.ts": "export const other = 1;\n" },
    );
    const result = await run(root);
    expect(result.output).toContain("mutant id=guard-open verdict=killed");
    expect(result.output).toContain("other.ts is not a regular file");
    expect(result.code).toBe(3);
    expect(readFileSync(outside, "utf8")).toBe("export const other = 1;\n");
  }, 60_000);

  test("a restoration that differs is reported and red even when the mutant is killed", async () => {
    // When guard.ts is mutated, this oracle replaces it in the copy by a link to /dev/null:
    // the original bytes written back go nowhere, and reading the file back gives nothing.
    const sabotage = [
      'import { expect, test } from "bun:test";',
      'import { rmSync, symlinkSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { allow } from "./guard";',
      'test("refuses a negative value", () => {',
      "  if (allow(-1)) {",
      '    rmSync(join(import.meta.dir, "guard.ts"));',
      '    symlinkSync("/dev/null", join(import.meta.dir, "guard.ts"));',
      "  }",
      "  expect(allow(-1)).toBe(false);",
      "});",
      "",
    ].join("\n");
    const root = fixture(
      [entry("guard-open", "return true;", { oracle: { tests: ["sabotage.test.ts"] } })],
      { "sabotage.test.ts": sabotage },
    );
    const result = await run(root);
    expect(result.output).toContain("mutant id=guard-open verdict=killed");
    expect(result.output).toContain("restored=different");
    expect(result.output).toContain("mutants=1 killed=1 survived=0 invalid=0 restored_identical=0");
    expect(result.code).toBe(1);
    expect(readFileSync(join(root, "guard.ts"), "utf8")).toBe(GUARD);
  }, 60_000);

  test("restoration never writes through a link the oracle left: a real outside file stays intact", async () => {
    // The oracle replaces the mutated file (or its directory) by a link to a real file outside
    // the copy, holding different bytes. Writing the original back through that link would
    // overwrite the outside file, and reading it back through the same link would say identical.
    const OUTSIDE = "export const outside = 'must stay';\n";
    const sabotage = (victim: string, target: string): string =>
      [
        'import { expect, test } from "bun:test";',
        'import { rmSync, symlinkSync } from "node:fs";',
        'import { join } from "node:path";',
        `import { allow } from "./${victim}";`,
        'test("refuses a negative value", () => {',
        "  if (allow(-1)) {",
        `    rmSync(join(import.meta.dir, ${JSON.stringify(target)}), { recursive: true });`,
        `    symlinkSync(LINK, join(import.meta.dir, ${JSON.stringify(target)}));`,
        "  }",
        "  expect(allow(-1)).toBe(false);",
        "});",
        "",
      ].join("\n");
    const asFile = outsideFile("guard.ts", OUTSIDE);
    const fileRoot = fixture(
      [entry("guard-open", "return true;", { oracle: { tests: ["sabotage.test.ts"] } })],
      {
        "sabotage.test.ts": sabotage("guard", "guard.ts").replace("LINK", JSON.stringify(asFile)),
      },
    );
    const asDir = outsideFile("guard.ts", OUTSIDE);
    const dirRoot = fixture(
      [
        entry("guard-open", "return true;", {
          file: "sub/guard.ts",
          oracle: { tests: ["sabotage.test.ts"] },
        }),
      ],
      {
        "sub/guard.ts": GUARD,
        "sabotage.test.ts": sabotage("sub/guard", "sub").replace(
          "LINK",
          JSON.stringify(dirname(asDir)),
        ),
      },
    );
    for (const [root, outside, path] of [
      [fileRoot, asFile, "guard.ts"],
      [dirRoot, asDir, "sub/guard.ts"],
    ] as const) {
      const result = await run(root);
      expect(readFileSync(outside, "utf8")).toBe(OUTSIDE);
      expect(result.output).toContain(`restore id=guard-open tampered (${path}`);
      expect(result.output).toContain("restored=different");
      expect(result.output).toContain("restored_identical=0");
      expect(result.code).toBe(1);
      expect(readFileSync(join(root, path), "utf8")).toBe(GUARD);
    }
  }, 60_000);

  test("a base oracle that fails to load is red: exit 2, no mutant run", async () => {
    const root = fixture(
      [entry("guard-open", "return true;", { oracle: { tests: ["broken.test.ts"] } })],
      { "broken.test.ts": 'import "./does-not-exist";\n' },
    );
    const result = await run(root);
    expect(result.output).toContain("base oracles=1 green=0 red=1");
    expect(result.output).not.toContain("mutant id=");
    expect(result.code).toBe(2);
  }, 60_000);

  test("--validate on an empty catalogue is red", async () => {
    const result = await run(fixture([]), ["--validate"]);
    expect(result.output).toContain("sites=0 valid=0 invalid=0");
    expect(result.code).toBe(1);
  }, 60_000);

  test("interrupt: the child is killed, the copy is removed, the tree is intact, exit 130", async () => {
    const pidFile = join(scratch, `hang-${fixtures + 1}.pid`);
    const hang = [
      'import { test } from "bun:test";',
      'import { writeFileSync } from "node:fs";',
      'import "./guard";',
      `test("hangs", async () => { writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); await new Promise(() => {}); }, 600_000);`,
      "",
    ].join("\n");
    const root = fixture(
      [entry("guard-open", "return true;", { oracle: { tests: ["hang.test.ts"] } })],
      {
        "hang.test.ts": hang,
      },
    );
    const { child, tmp } = launch(root, []);
    const deadline = Date.now() + 30_000;
    while (!existsSync(pidFile) && Date.now() < deadline) await Bun.sleep(25);
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    child.kill("SIGINT");
    expect(await child.exited).toBe(130);
    // ESRCH, not any error: EPERM would mean the process is alive but not signalable.
    let probe: unknown = null;
    try {
      process.kill(pid, 0);
    } catch (error) {
      probe = error;
    }
    expect((probe as NodeJS.ErrnoException | null)?.code).toBe("ESRCH");
    expect(readdirSync(tmp)).toEqual([]);
    expect(readFileSync(join(root, "guard.ts"), "utf8")).toBe(GUARD);
    // Working tree against the index: nothing the tool did shows up in the repository.
    expect(Bun.spawnSync(["git", "-C", root, "diff", "--name-only"]).stdout.toString()).toBe("");
  }, 60_000);
});
