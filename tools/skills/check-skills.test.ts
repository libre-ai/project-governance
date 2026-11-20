import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GateOutcome, GateReport, renderGateReport } from "../quality/gate-report";
import {
  formatSkillsLintVolume,
  lintSkillsCollection,
  lintSkillsFromArguments,
  listSkillsRoot,
  SkillsRootEntryUnaccounted,
  type SkillsRootListing,
  splitSkillsRoot,
} from "./check-skills";
import { BODY_LINE_WARNING, SPDX_LICENSE_LINE } from "./lint-skill";

const GATE = "Skills lint (T1)";
const SCRIPT: string = join(import.meta.dir, "check-skills.ts");
const REAL_ROOT: string = join(import.meta.dir, "..", "..", "skills");

const VALID_EVAL = {
  positive: ["a", "b", "c"],
  negative: ["d", "e"],
  behavioral: { scenario: "s", expected: "e" },
};

const workspaces: string[] = [];

afterAll(() => {
  for (const path of workspaces) rmSync(path, { recursive: true, force: true });
});

function skillMarkdown(name: string): string {
  return `---\nname: ${name}\ndescription: Do the ${name} thing. Use when ${name} is needed.\nlicense: Apache-2.0\nmetadata:\n  status: candidate\n---\n\n<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->\n<!-- ${SPDX_LICENSE_LINE} -->\n\n# ${name}\n\nSome guidance.\n`;
}

/** A skills root holding one valid skill per name; `evalJson` is written as given, `null` omits it. */
function fixtureRoot(skills: Record<string, string | null>): string {
  const root = mkdtempSync(join(tmpdir(), "skills-lint-fixture-"));
  workspaces.push(root);
  for (const [name, evalJson] of Object.entries(skills)) {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, "SKILL.md"), skillMarkdown(name));
    if (evalJson !== null) writeFileSync(join(root, name, "eval.json"), evalJson);
  }
  return root;
}

const VALID = JSON.stringify(VALID_EVAL);

/**
 * One valid skill, `alpha`, among five entries the glob does not match. The
 * expected split is written here from how the tree is built, not read back
 * from the gate.
 */
function rootWithSetAsideEntries(): string {
  const root = fixtureRoot({ alpha: VALID });
  mkdirSync(join(root, "no-skill-file"));
  writeFileSync(join(root, "no-skill-file", "notes.md"), "# notes\n");
  mkdirSync(join(root, "misspelt"));
  writeFileSync(join(root, "misspelt", "SKILLS.md"), skillMarkdown("misspelt"));
  mkdirSync(join(root, ".dotted"));
  writeFileSync(join(root, ".dotted", "SKILL.md"), skillMarkdown("dotted"));
  writeFileSync(join(root, "README.md"), "# index\n");
  symlinkSync(join(root, "nowhere"), join(root, "dangling"));
  return root;
}

const SET_ASIDE_SPLIT: SkillsRootListing = {
  entries: [".dotted", "README.md", "alpha", "dangling", "misspelt", "no-skill-file"],
  skills: ["alpha"],
  setAside: [
    { name: ".dotted", kind: "directory" },
    { name: "README.md", kind: "other" },
    { name: "dangling", kind: "symlink" },
    { name: "misspelt", kind: "directory" },
    { name: "no-skill-file", kind: "directory" },
  ],
};

/**
 * The skill directories the report holds at least one check for, on one of a
 * skill's two files. Read from the items of the checks, so it says what was
 * linted whatever the volume line claims.
 */
function lintedSkills(report: GateReport, root: string, file: "SKILL.md" | "eval.json"): string[] {
  const names = new Set<string>();
  for (const check of report.checks) {
    if (!check.item.startsWith(`${root}/`)) continue;
    const [name, rest] = check.item.slice(root.length + 1).split("/");
    if (name && (rest === file || rest?.startsWith(`${file} — `))) names.add(name);
  }
  return [...names].sort();
}

/** The items of the failed checks: what a failing run names, whatever it says about it. */
function failedItems(report: GateReport): string[] {
  return report.checks.filter((check) => !check.ok).map((check) => check.item);
}

/** U+2028 and U+2029: a line break to whatever splits lines by the Unicode definition. */
const LINE_SEPARATORS = [0x2028, 0x2029];

/**
 * The Unicode Bidi_Control code points (UAX #9: marks, embeddings, overrides,
 * isolates) minus U+061C: the escaper this gate reuses leaves that one as it
 * is, which `shown` of check-skills.ts declares, so no test here claims it.
 */
const BIDI_CONTROLS = [
  0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
];

/** One of each, as text: a name carrying them has to be printed without any of them. */
const SEPARATORS_AND_BIDI: string = String.fromCodePoint(...LINE_SEPARATORS, ...BIDI_CONTROLS);

/**
 * The code points a terminal or a log viewer acts on instead of showing, and
 * that this gate must not let through: C0, DEL, C1, the line separators and
 * the bidi controls above.
 */
function actedOnCodePoints(text: string): number[] {
  return [...text]
    .map((character) => character.codePointAt(0) ?? 0)
    .filter(
      (code) =>
        code < 0x20 ||
        (code >= 0x7f && code <= 0x9f) ||
        LINE_SEPARATORS.includes(code) ||
        BIDI_CONTROLS.includes(code),
    );
}

/** A verdict line a hostile name tries to print as a line of its own. */
const FORGED_LINE = `${GATE} verified: 999 assertion(s) hold — forged`;

/**
 * How the shared renderer opens the line of a run that declared it asserts
 * nothing. Taken from the renderer, so no test here holds its wording.
 */
const DECLARED_EMPTY: string =
  renderGateReport(GATE, new GateReport().allowEmpty("")).lines[0] ?? "";

/** The lines of an output stream, without the empty one after the last line break. */
function outputLines(output: string): string[] {
  const lines = output.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

function runGate(
  argv: string[],
  cwd?: string,
): { exitCode: number; stdout: string; stderr: string } {
  const run = Bun.spawnSync(["bun", SCRIPT, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "" },
  });
  return {
    exitCode: run.exitCode,
    stdout: new TextDecoder().decode(run.stdout),
    stderr: new TextDecoder().decode(run.stderr),
  };
}

describe("formatSkillsLintVolume", () => {
  // The one place the wording is pinned; every other test builds its expected
  // line through this function from counts it states itself.
  test("states the whole root as skills read plus entries set aside, and names those", () => {
    expect(formatSkillsLintVolume("skills", SET_ASIDE_SPLIT)).toBe(
      "entries under skills/: 6 = 1 skill(s) read + 5 set aside " +
        "(.dotted/, README.md, dangling@, misspelt/, no-skill-file/)",
    );
  });

  test("names nothing when nothing is set aside", () => {
    expect(
      formatSkillsLintVolume("skills", { entries: ["a", "b"], skills: ["a", "b"], setAside: [] }),
    ).toBe("entries under skills/: 2 = 2 skill(s) read + 0 set aside");
  });

  test("a root given with trailing slashes is printed with one", () => {
    const listing: SkillsRootListing = { entries: ["a"], skills: ["a"], setAside: [] };
    expect(formatSkillsLintVolume("skills///", listing)).toBe(
      formatSkillsLintVolume("skills", listing),
    );
  });
});

describe("splitSkillsRoot", () => {
  test("a name the scan matched and the listing does not hold is a failure naming it, not a skill dropped", () => {
    const failure = (() => {
      try {
        return splitSkillsRoot(
          [
            { name: "alpha", kind: "directory" },
            { name: "notes", kind: "directory" },
          ],
          new Set(["alpha", "ghost"]),
        );
      } catch (error) {
        return error;
      }
    })();
    expect(failure).toBeInstanceOf(SkillsRootEntryUnaccounted);
    expect((failure as SkillsRootEntryUnaccounted).entry).toBe("ghost");
  });

  test("when every matched name is listed, the split covers the listing with nothing left over", () => {
    expect(
      splitSkillsRoot(
        [
          { name: "alpha", kind: "directory" },
          { name: "notes", kind: "directory" },
        ],
        new Set(["alpha"]),
      ),
    ).toEqual({
      entries: ["alpha", "notes"],
      skills: ["alpha"],
      setAside: [{ name: "notes", kind: "directory" }],
    });
  });
});

describe("listSkillsRoot", () => {
  test("every entry of the root is either a skill read or an entry set aside by name", async () => {
    expect(await listSkillsRoot(rootWithSetAsideEntries())).toEqual(SET_ASIDE_SPLIT);
  });

  test("a skill reached only through a symbolic link is set aside, not read", async () => {
    const elsewhere = fixtureRoot({ linked: VALID });
    const root = fixtureRoot({ alpha: VALID });
    symlinkSync(join(elsewhere, "linked"), join(root, "linked"));
    expect(await listSkillsRoot(root)).toEqual({
      entries: ["alpha", "linked"],
      skills: ["alpha"],
      setAside: [{ name: "linked", kind: "symlink" }],
    });
  });

  test("a directory named SKILL.md does not make its parent a skill", async () => {
    const root = fixtureRoot({ alpha: VALID });
    mkdirSync(join(root, "folder", "SKILL.md"), { recursive: true });
    expect(await listSkillsRoot(root)).toEqual({
      entries: ["alpha", "folder"],
      skills: ["alpha"],
      setAside: [{ name: "folder", kind: "directory" }],
    });
  });

  test("a directory that cannot be opened under a root that lists is named by the error", async () => {
    const root = fixtureRoot({ alpha: VALID, locked: VALID });
    chmodSync(join(root, "locked"), 0o000);
    try {
      const failure = await listSkillsRoot(root).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(SkillsRootEntryUnaccounted);
      expect((failure as SkillsRootEntryUnaccounted).entry).toBe("locked");
    } finally {
      chmodSync(join(root, "locked"), 0o755);
    }
  });
});

describe("lintSkillsCollection", () => {
  test("the success line accounts for every entry of the root", async () => {
    const root = rootWithSetAsideEntries();
    const report = await lintSkillsCollection(root, "argument");
    expect(renderGateReport(GATE, report).lines).toEqual([
      `${GATE} verified: ${report.asserted} assertion(s) hold — ${formatSkillsLintVolume(root, SET_ASIDE_SPLIT)}`,
    ]);
  });

  test("every skill counted as read was linted, on both of its files, and nothing else was", async () => {
    const root = fixtureRoot({ alpha: VALID, beta: VALID, gamma: VALID });
    const names = ["alpha", "beta", "gamma"];
    const report = await lintSkillsCollection(root, "argument");
    expect(lintedSkills(report, root, "SKILL.md")).toEqual(names);
    expect(lintedSkills(report, root, "eval.json")).toEqual(names);
    expect(report.volumeSummary).toBe(
      formatSkillsLintVolume(root, { entries: names, skills: names, setAside: [] }),
    );
  });

  test("an entry set aside is not linted, whatever it holds", async () => {
    const elsewhere = fixtureRoot({ linked: VALID });
    const root = rootWithSetAsideEntries();
    symlinkSync(join(elsewhere, "linked"), join(root, "linked"));
    mkdirSync(join(root, "folder", "SKILL.md"), { recursive: true });
    const report = await lintSkillsCollection(root, "argument");
    expect(report.outcome).toBe("pass");
    expect(lintedSkills(report, root, "SKILL.md")).toEqual(["alpha"]);
    expect(lintedSkills(report, root, "eval.json")).toEqual(["alpha"]);
  });

  test("a SKILL.md that breaks a rule fails, on that file", async () => {
    const root = fixtureRoot({ alpha: VALID, beta: VALID });
    writeFileSync(join(root, "alpha", "SKILL.md"), "# alpha\n\nNo frontmatter at all.\n");
    const report = await lintSkillsCollection(root, "argument");
    expect(report.outcome).toBe("violations");
    expect(report.violations.length).toBeGreaterThan(0);
    for (const violation of report.violations) {
      expect(violation).toStartWith(`${root}/alpha/SKILL.md — `);
    }
  });

  test("an eval.json under the admission minimum fails, on that file", async () => {
    const underMinimum = JSON.stringify({ ...VALID_EVAL, positive: ["a"], negative: [] });
    const root = fixtureRoot({ alpha: underMinimum, beta: VALID });
    const report = await lintSkillsCollection(root, "argument");
    expect(report.outcome).toBe("violations");
    expect(report.violations.length).toBeGreaterThan(0);
    for (const violation of report.violations) {
      expect(violation).toStartWith(`${root}/alpha/eval.json — `);
    }
  });

  test("a SKILL.md that cannot be read fails by name, and the other skills are still linted", async () => {
    const root = fixtureRoot({ alpha: VALID, beta: VALID });
    chmodSync(join(root, "alpha", "SKILL.md"), 0o000);
    const report = await lintSkillsCollection(root, "argument");
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith(`${root}/alpha/SKILL.md: `);
    expect(lintedSkills(report, root, "SKILL.md")).toEqual(["alpha", "beta"]);
  });

  test("a directory that cannot be opened under the root is the item of the failure, not the root", async () => {
    const root = fixtureRoot({ alpha: VALID, locked: VALID });
    chmodSync(join(root, "locked"), 0o000);
    try {
      const report = await lintSkillsCollection(root, "argument");
      expect(report.outcome).toBe("violations");
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]).toStartWith(`${root}/locked: `);
      expect(report.volumeSummary).toBeNull();
    } finally {
      chmodSync(join(root, "locked"), 0o755);
    }
  });

  test("a root given with a trailing slash reads the same and prints no doubled slash", async () => {
    const root = rootWithSetAsideEntries();
    const withSlash = await lintSkillsCollection(`${root}/`, "argument");
    const without = await lintSkillsCollection(root, "argument");
    expect(without.asserted).toBeGreaterThan(0);
    expect(withSlash.checks).toEqual(without.checks);
    expect(withSlash.volumeSummary).toBe(without.volumeSummary);
    expect(withSlash.volumeSummary).not.toContain("//");
  });

  test("no name printed by a failing run carries a control character", async () => {
    const parent = fixtureRoot({});
    const root = join(parent, `r\n${FORGED_LINE}\u001b[8m`);
    const skill = `s\r${FORGED_LINE}`;
    mkdirSync(join(root, skill), { recursive: true });
    writeFileSync(join(root, skill, "SKILL.md"), skillMarkdown("s"));
    const reports = [
      await lintSkillsCollection(root, "argument"),
      await lintSkillsCollection(join(root, "absent"), "argument"),
      await lintSkillsCollection(join(root, skill), "argument"),
      await lintSkillsFromArguments([root, `b\n${FORGED_LINE}`]),
    ];
    for (const report of reports) {
      expect(report.outcome).toBe("violations");
      const { lines } = renderGateReport(GATE, report, true);
      expect(lines.flatMap(actedOnCodePoints)).toEqual([]);
      expect(lines.join("\n")).toContain(FORGED_LINE);
    }
  });

  test("a declared-empty run names what it set aside without a control character, and stays one line", async () => {
    const root = fixtureRoot({});
    mkdirSync(join(root, `x)\n${FORGED_LINE}`));
    mkdirSync(join(root, `evil\u001b[2K\r${FORGED_LINE}`));
    const report = await lintSkillsCollection(root, "default");
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(0);
    const { lines } = renderGateReport(GATE, report, true);
    expect(lines).toHaveLength(1);
    expect(lines.flatMap(actedOnCodePoints)).toEqual([]);
    expect((lines[0] ?? "").split(FORGED_LINE)).toHaveLength(3);
  });

  test("line separators and bidi controls in a name reach none of the lines the gate renders", async () => {
    const parent = fixtureRoot({});
    const hostile = `n${SEPARATORS_AND_BIDI}`;
    // Success line (volume): a skill read, the hostile name set aside.
    const passing = join(parent, "passing");
    mkdirSync(join(passing, "alpha"), { recursive: true });
    writeFileSync(join(passing, "alpha", "SKILL.md"), skillMarkdown("alpha"));
    writeFileSync(join(passing, "alpha", "eval.json"), VALID);
    mkdirSync(join(passing, hostile));
    // Declared-empty line: no skill, the hostile name set aside.
    const empty = join(parent, "empty");
    mkdirSync(join(empty, hostile), { recursive: true });
    // Failed checks: the hostile name is the skill directory, without an eval.json.
    const failing = join(parent, "failing");
    mkdirSync(join(failing, hostile), { recursive: true });
    writeFileSync(join(failing, hostile, "SKILL.md"), skillMarkdown("n"));

    const outcomes: [GateReport, GateOutcome][] = [
      [await lintSkillsCollection(passing, "argument"), "pass"],
      [await lintSkillsCollection(empty, "default"), "pass"],
      [await lintSkillsCollection(failing, "argument"), "violations"],
    ];
    for (const [report, outcome] of outcomes) {
      expect(report.outcome).toBe(outcome);
      const { lines } = renderGateReport(GATE, report, true);
      expect(lines.flatMap(actedOnCodePoints)).toEqual([]);
    }
    // The name was read, not lost: each run lists it among its entries.
    for (const root of [passing, empty, failing]) {
      expect((await listSkillsRoot(root)).entries).toContain(hostile);
    }
  });

  test("an escape sequence quoted from a SKILL.md reaches no line either, on a passing run or a failing one", async () => {
    // Passing: the description is quoted by a check that holds, printed in verbose.
    const passingRoot = fixtureRoot({ alpha: VALID });
    writeFileSync(
      join(passingRoot, "alpha", "SKILL.md"),
      skillMarkdown("alpha").replace("Do the", "Do\u001b[8m the"),
    );
    // Failing: the name no longer matches the directory, and the failed check quotes it.
    const failingRoot = fixtureRoot({ alpha: VALID });
    writeFileSync(
      join(failingRoot, "alpha", "SKILL.md"),
      skillMarkdown("alpha").replace("name: alpha", "name: al\u001b[8mpha"),
    );
    const passing = await lintSkillsCollection(passingRoot, "argument");
    const failing = await lintSkillsCollection(failingRoot, "argument");
    expect(passing.outcome).toBe("pass");
    expect(failing.outcome).toBe("violations");
    for (const report of [passing, failing]) {
      const { lines } = renderGateReport(GATE, report, true);
      expect(lines.flatMap(actedOnCodePoints)).toEqual([]);
      // The quoted text is still there, around the escaped character.
      expect(lines.join("\n")).toContain("[8m");
    }
  });

  test("a line break is written the same way wherever a text is printed", async () => {
    const absent = join(fixtureRoot({}), "absent\nroot");
    const [named] = failedItems(await lintSkillsFromArguments([absent]));
    expect(named).toBeDefined();
    const tooMany = await lintSkillsFromArguments([absent, "second-argument"]);
    expect(tooMany.violations.join("\n")).toContain(named ?? "");
  });

  test("a name holding an escape written out and a name holding the character it stands for print apart", async () => {
    const parent = fixtureRoot({});
    const withLineBreak = failedItems(
      await lintSkillsCollection(join(parent, "tw\nin"), "argument"),
    );
    expect(withLineBreak).toHaveLength(1);
    // The second name is the first one as it was printed: the escape, spelled out in plain characters.
    const printedName = (withLineBreak[0] ?? "").slice(parent.length + 1);
    expect(printedName).not.toBe("tw\nin");
    const withEscapeText = failedItems(
      await lintSkillsCollection(join(parent, printedName), "argument"),
    );
    expect(withEscapeText).toHaveLength(1);
    expect(withEscapeText).not.toEqual(withLineBreak);
  });

  test("a missing eval.json fails by name instead of lowering the count in silence", async () => {
    const root = fixtureRoot({ alpha: VALID, beta: null });
    const report = await lintSkillsCollection(root, "argument");
    expect(report.outcome).toBe("violations");
    expect(failedItems(report)).toEqual([`${root}/beta/eval.json`]);
  });

  test("an eval.json that is not JSON fails by name", async () => {
    const root = fixtureRoot({ alpha: "{ not json" });
    const report = await lintSkillsCollection(root, "argument");
    expect(report.outcome).toBe("violations");
    expect(failedItems(report)).toEqual([`${root}/alpha/eval.json`]);
  });

  test("the default root may be absent: nothing asserted, as declared, no volume claimed", async () => {
    const report = await lintSkillsCollection(join(fixtureRoot({}), "absent"), "default");
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(0);
    expect(report.emptyReason).not.toBeNull();
    expect(report.volumeSummary).toBeNull();
  });

  test("a root named as an argument and absent is a failure naming that root", async () => {
    const absent = join(fixtureRoot({}), "absent");
    const report = await lintSkillsCollection(absent, "argument");
    expect(report.outcome).toBe("violations");
    expect(report.emptyReason).toBeNull();
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith(`${absent}: `);
  });

  test("a root that exists and cannot be listed is a failure naming that root", async () => {
    const notADirectory = join(fixtureRoot({}), "skills");
    writeFileSync(notADirectory, "not a directory\n");
    const report = await lintSkillsCollection(notADirectory, "default");
    expect(report.outcome).toBe("violations");
    expect(failedItems(report)).toEqual([notADirectory]);
  });

  const ORPHAN_ONLY: SkillsRootListing = {
    entries: ["orphan"],
    skills: [],
    setAside: [{ name: "orphan", kind: "directory" }],
  };

  test("the default root holding no skill asserts nothing and still names what it set aside", async () => {
    const root = fixtureRoot({});
    mkdirSync(join(root, "orphan"));
    const report = await lintSkillsCollection(root, "default");
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(0);
    expect(report.emptyReason).toEndWith(`(${formatSkillsLintVolume(root, ORPHAN_ONLY)})`);
  });

  test("a root named as an argument and holding no skill is a failure naming that root", async () => {
    const root = fixtureRoot({});
    mkdirSync(join(root, "orphan"));
    const report = await lintSkillsCollection(root, "argument");
    expect(report.outcome).toBe("violations");
    expect(report.emptyReason).toBeNull();
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith(`${root}: `);
    expect(report.violations[0]).toEndWith(`(${formatSkillsLintVolume(root, ORPHAN_ONLY)})`);
  });

  test("the parent of a skills root, named as an argument, is a failure and not an empty collection", async () => {
    const parent = fixtureRoot({});
    mkdirSync(join(parent, "skills", "alpha"), { recursive: true });
    writeFileSync(join(parent, "skills", "alpha", "SKILL.md"), skillMarkdown("alpha"));
    writeFileSync(join(parent, "skills", "alpha", "eval.json"), VALID);
    expect((await lintSkillsCollection(join(parent, "skills"), "argument")).outcome).toBe("pass");
    const report = await lintSkillsCollection(parent, "argument");
    expect(report.outcome).toBe("violations");
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith(`${parent}: `);
  });
});

describe("lintSkillsFromArguments", () => {
  test("one argument names the root to lint", async () => {
    const root = fixtureRoot({ alpha: VALID });
    const report = await lintSkillsFromArguments([root]);
    expect(report.outcome).toBe("pass");
    expect(lintedSkills(report, root, "SKILL.md")).toEqual(["alpha"]);
  });

  test("a second argument is a failure showing every argument received, and nothing is linted", async () => {
    const root = fixtureRoot({ alpha: VALID });
    const report = await lintSkillsFromArguments([root, "second-argument"]);
    expect(report.outcome).toBe("violations");
    expect(lintedSkills(report, root, "SKILL.md")).toEqual([]);
    expect(lintedSkills(report, root, "eval.json")).toEqual([]);
    const said = report.violations.join("\n");
    expect(said).toContain(root);
    expect(said).toContain("second-argument");
  });
});

describe("CLI", () => {
  test("on a fixture tree, the gate process prints the volume on its success line", () => {
    const root = rootWithSetAsideEntries();
    const run = runGate([root]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toEndWith(` — ${formatSkillsLintVolume(root, SET_ASIDE_SPLIT)}\n`);
  });

  test("a root argument that does not exist exits 1 and names the root", () => {
    const absent = join(fixtureRoot({}), "absent");
    const run = runGate([absent]);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(`${GATE}: ${absent}: `);
  });

  test("without an argument, a repository holding no skills/ still exits 0, as declared", () => {
    const run = runGate([], fixtureRoot({}));
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe("");
    expect(outputLines(run.stdout)).toHaveLength(1);
    expect(run.stdout).toStartWith(DECLARED_EMPTY);
  });

  test("without an argument, a skills/ holding no skill still exits 0, as declared, and names what it holds", () => {
    const cwd = fixtureRoot({});
    mkdirSync(join(cwd, "skills", "orphan"), { recursive: true });
    const run = runGate([], cwd);
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe("");
    expect(outputLines(run.stdout)).toHaveLength(1);
    expect(run.stdout).toStartWith(DECLARED_EMPTY);
    expect(run.stdout).toContain("orphan");
  });

  test("a root argument holding no skill exits 1 and names the root", () => {
    const empty = fixtureRoot({});
    const run = runGate([empty]);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(`${GATE}: ${empty}: `);
  });

  test("a second argument exits 1 and shows every argument received", () => {
    const root = fixtureRoot({ alpha: VALID });
    const run = runGate([root, "second-argument"]);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(root);
    expect(run.stderr).toContain("second-argument");
  });

  test("set-aside names carrying a line break or an escape sequence leave one verdict line and no control byte", () => {
    const root = fixtureRoot({ alpha: VALID });
    mkdirSync(join(root, `x)\n${FORGED_LINE}`));
    mkdirSync(join(root, `evil\u001b[2K\r${FORGED_LINE}\u001b[8m`));
    const run = runGate([root]);
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe("");
    const lines = outputLines(run.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`${GATE} verified: `);
    expect(actedOnCodePoints(lines[0] ?? "")).toEqual([]);
    // Both names are still shown, forged text included, inside that one line.
    expect((lines[0] ?? "").split(FORGED_LINE)).toHaveLength(3);
  });

  test("a hostile root argument and skill name print no line of their own on the failure output", () => {
    const root = join(fixtureRoot({}), `r\n${FORGED_LINE}\u001b[8m`);
    // The skill name reaches the body-length warning, the one line printed outside the report.
    const skill = `s\n::error::forged${SEPARATORS_AND_BIDI}`;
    mkdirSync(join(root, skill), { recursive: true });
    writeFileSync(
      join(root, skill, "SKILL.md"),
      `${skillMarkdown("s")}${"A line of guidance.\n".repeat(BODY_LINE_WARNING + 1)}`,
    );
    const run = runGate([root]);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe("");
    const lines = outputLines(run.stderr);
    expect(lines.flatMap(actedOnCodePoints)).toEqual([]);
    // One workflow command, the real warning; every other line is the gate's own.
    expect(lines.filter((line) => line.startsWith("::"))).toHaveLength(1);
    expect(lines[0]).toStartWith("::warning::");
    for (const line of lines.slice(1, -1)) expect(line).toStartWith(`${GATE}: `);
    expect(lines.at(-1)).toStartWith(`${GATE} failed: `);
    expect(lines.length).toBeGreaterThan(2);
  });
});

describe("real corpus", () => {
  // The expected universe comes from a plain directory listing, not from the
  // glob the gate selects with: the split has to cover it with nothing left
  // over and nothing counted twice. Whether the corpus lints clean is the
  // gate's verdict, not this test's — and so is whether it holds a skill at
  // all: the gate declares "no skills/" and "no skill admitted" legitimate,
  // so this test asks for neither.
  test("the split of skills/ covers every entry once, and every skill of the split is linted", async () => {
    const report = await lintSkillsCollection(REAL_ROOT, "default");
    if (!existsSync(REAL_ROOT)) {
      expect(report.asserted).toBe(0);
      expect(report.emptyReason).not.toBeNull();
      return;
    }
    const onDisk = readdirSync(REAL_ROOT).sort();
    const listing = await listSkillsRoot(REAL_ROOT);
    expect(listing.entries).toEqual(onDisk);
    expect([...listing.skills, ...listing.setAside.map((entry) => entry.name)].sort()).toEqual(
      onDisk,
    );
    expect(lintedSkills(report, REAL_ROOT, "SKILL.md")).toEqual([...listing.skills]);
    expect(report.emptyReason === null).toBe(listing.skills.length > 0);
  });
});
