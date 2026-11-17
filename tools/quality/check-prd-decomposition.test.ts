import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CommandOutcome,
  evaluatePrdDecomposition,
  evaluateWithPolicyText,
  type PrdCommit,
  readArguments,
  runCommand,
} from "./check-prd-decomposition";
import type { Fact, LinkPorts } from "./check-work-package-link";
import { type GateReport, renderGateReport } from "./gate-report";
import type { MaturityLevel } from "./prd-model";
import type { GitInvocation, GitResult, RunGit } from "./work-package-ports";

const SHA: string = "0123456789abcdef0123456789abcdef01234567";
const REF: PrdCommit = { repo: "example-owner/example-repo", sha: SHA };
const PRD_PATH = "docs/prd.md";
const REQUIREMENTS_PATH = "docs/cahier-des-charges.md";

// ---------------------------------------------------------------------------
// Documents, written from the grammar of docs/specifications/WORK-PACKAGES.md.
// ---------------------------------------------------------------------------

/** A PRD with the given maturity line (null: no line) and one table row per entry. */
function prd(maturity: string | null, rows: readonly (readonly [string, string])[]): string {
  return [
    "# Product requirements",
    "",
    ...(maturity === null ? [] : [`Maturité du document : ${maturity}`, ""]),
    "| WP | CA-n couverts | Périmètre (chemins, globs) | Vérification (commande) | Porte anticipée |",
    "|---|---|---|---|---|",
    ...rows.map(
      ([id, criteria]: readonly [string, string]): string =>
        `| ${id} | ${criteria} | src/** | \`bun test\` | two-way |`,
    ),
    "",
  ].join("\n");
}

/** A specification: one bullet per id, with its `Validation :` clause unless listed in `bare`. */
function requirements(ids: readonly string[], bare: readonly string[] = []): string {
  return [
    "# Requirements",
    "",
    ...ids.map((id: string): string =>
      bare.includes(id)
        ? `- ${id} The behaviour holds.`
        : `- ${id} The behaviour holds. Validation : \`bun test\``,
    ),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Ports in memory. The three ports the command must never call throw.
// ---------------------------------------------------------------------------

interface Scenario {
  readonly prd?: Fact<string>;
  readonly requirements?: Fact<string>;
  readonly ancestry?: Fact<boolean>;
  readonly floor?: MaturityLevel;
}

interface Evaluated {
  readonly report: GateReport;
  readonly counters: Readonly<Record<string, string>>;
  readonly calls: readonly string[];
}

const text = (value: string): Fact<string> => ({ ok: true, value });
const unreadable = (reason: string): { readonly ok: false; readonly reason: string } => ({
  ok: false,
  reason,
});

function memoryPorts(scenario: Scenario): { readonly ports: LinkPorts; readonly calls: string[] } {
  const calls: string[] = [];
  const files: Readonly<Record<string, Fact<string>>> = {
    [PRD_PATH]: scenario.prd ?? text(prd("décision", [["WP-1", "CA-1"]])),
    [REQUIREMENTS_PATH]: scenario.requirements ?? text(requirements(["CA-1"])),
  };
  const never = (name: string) => (): never => {
    throw new Error(`${name} must not be called by the decomposition control`);
  };
  const ports: LinkPorts = {
    readIssue: never("readIssue"),
    commitTrailers: never("commitTrailers"),
    changedFiles: never("changedFiles"),
    readFileAt: async (repo: string, sha: string, path: string): Promise<Fact<string>> => {
      calls.push(`readFileAt ${repo} ${sha} ${path}`);
      return files[path] ?? unreadable(`${path} is not a document of the fixture`);
    },
    isAncestorOfServedHead: async (repo: string, sha: string): Promise<Fact<boolean>> => {
      calls.push(`isAncestorOfServedHead ${repo} ${sha}`);
      return scenario.ancestry ?? { ok: true, value: true };
    },
  };
  return { ports, calls };
}

const VOLUME: RegExp =
  /^criteria declared: (\S+), work packages read: (\S+), covered: (\S+), uncovered: (\S+), without validation: (\S+), cited undeclared: (\S+), maturity: (.+)$/;
const NUMBER: RegExp = /^\d+$/;

/** The seven counters of a volume line; the line must hold exactly them. */
function countersOf(report: GateReport): Readonly<Record<string, string>> {
  const match: RegExpExecArray | null = VOLUME.exec(report.volumeSummary ?? "");
  if (match === null) {
    throw new Error(`volume line without its seven counters: ${String(report.volumeSummary)}`);
  }
  return {
    declared: match[1] ?? "",
    workPackages: match[2] ?? "",
    covered: match[3] ?? "",
    uncovered: match[4] ?? "",
    withoutValidation: match[5] ?? "",
    citedUndeclared: match[6] ?? "",
    maturity: match[7] ?? "",
  };
}

/**
 * Every case goes through here, so every case holds the counter invariant:
 * covered + uncovered = criteria declared whenever both documents were read,
 * and `unreadable` (never a number) for the three coverage counters otherwise.
 */
async function evaluate(scenario: Scenario = {}): Promise<Evaluated> {
  const { ports, calls } = memoryPorts(scenario);
  const report: GateReport = await evaluatePrdDecomposition(
    REF,
    scenario.floor ?? "décision",
    ports,
  );
  const counters: Readonly<Record<string, string>> = countersOf(report);
  const bothRead: boolean =
    NUMBER.test(counters.declared ?? "") && NUMBER.test(counters.workPackages ?? "");
  if (bothRead) {
    expect(Number(counters.covered) + Number(counters.uncovered)).toBe(Number(counters.declared));
    expect(counters.citedUndeclared).toMatch(NUMBER);
  } else {
    expect(counters.covered).toBe("unreadable");
    expect(counters.uncovered).toBe("unreadable");
    expect(counters.citedUndeclared).toBe("unreadable");
  }
  return { report, counters, calls };
}

const violationsNaming = (report: GateReport, fragment: string): readonly string[] =>
  report.violations.filter((violation: string): boolean => violation.includes(fragment));

// ---------------------------------------------------------------------------

describe("coverage of the declared criteria", () => {
  test("a fully covered, approved PRD passes and prints its seven counters", async () => {
    const { report, counters } = await evaluate({
      prd: text(
        prd("décision", [
          ["WP-1", "CA-1"],
          ["WP-2", "CA-2, CA-1"],
        ]),
      ),
      requirements: text(requirements(["CA-1", "CA-2"])),
    });
    expect(report.violations).toEqual([]);
    expect(counters).toEqual({
      declared: "2",
      workPackages: "2",
      covered: "2",
      uncovered: "0",
      withoutValidation: "0",
      citedUndeclared: "0",
      maturity: "décision",
    });
    const rendered = renderGateReport("PRD decomposition", report);
    expect(rendered.ok).toBe(true);
    expect(rendered.lines[0]).toContain("criteria declared: 2, work packages read: 2");
  });

  test("CA-2 cited by no row is one violation naming it; CA-1, cited, has none", async () => {
    const { report, counters } = await evaluate({
      prd: text(prd("décision", [["WP-1", "CA-1"]])),
      requirements: text(requirements(["CA-1", "CA-2"])),
    });
    expect(report.outcome).toBe("violations");
    expect(renderGateReport("PRD decomposition", report).ok).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("CA-2 coverage");
    expect(report.violations[0]).toContain("cited by no row");
    expect(violationsNaming(report, "CA-1 ")).toEqual([]);
    expect(counters.covered).toBe("1");
    expect(counters.uncovered).toBe("1");
  });

  test("a row citing CA-1 does not cover CA-10", async () => {
    const { report } = await evaluate({
      prd: text(prd("décision", [["WP-1", "CA-1"]])),
      requirements: text(requirements(["CA-1", "CA-10"])),
    });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("CA-10 coverage");
  });

  test("a row citing CA-10 does not cover CA-1", async () => {
    const { report } = await evaluate({
      prd: text(prd("décision", [["WP-1", "CA-10"]])),
      requirements: text(requirements(["CA-1", "CA-10"])),
    });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("CA-1 coverage");
  });

  test("an id is compared as written: CA-01 declared and CA-1 cited are two faults", async () => {
    const { report, counters } = await evaluate({
      prd: text(prd("décision", [["WP-1", "CA-1"]])),
      requirements: text(requirements(["CA-01"])),
    });
    expect(report.violations).toHaveLength(2);
    expect(violationsNaming(report, "CA-01 coverage")).toHaveLength(1);
    expect(violationsNaming(report, "WP-1 cites CA-1:")).toHaveLength(1);
    expect(counters.uncovered).toBe("1");
    expect(counters.citedUndeclared).toBe("1");
  });

  test("a row citing a criterion the specification does not declare names the row and the id", async () => {
    const { report, counters } = await evaluate({
      prd: text(
        prd("décision", [
          ["WP-1", "CA-1"],
          ["WP-2", "CA-9, CA-9"],
        ]),
      ),
      requirements: text(requirements(["CA-1"])),
    });
    expect(report.violations).toEqual([
      `PRD ${REF.repo}@${SHA} — WP-2 cites CA-9: ${REQUIREMENTS_PATH} does not declare it`,
    ]);
    expect(counters.citedUndeclared).toBe("1");
  });
});

describe("the specification itself", () => {
  test("a specification without any criterion bullet is a violation, never a pass", async () => {
    const { report, counters } = await evaluate({
      requirements: text("# Requirements\n\nNothing is specified yet.\n"),
    });
    expect(report.outcome).toBe("violations");
    expect(violationsNaming(report, "declares no criterion")).toHaveLength(1);
    expect(counters.declared).toBe("0");
    expect(counters.covered).toBe("0");
  });

  test("a criterion without its Validation clause is named with its line, even when cited", async () => {
    const { report, counters } = await evaluate({
      prd: text(prd("décision", [["WP-1", "CA-1, CA-2"]])),
      requirements: text(requirements(["CA-1", "CA-2"], ["CA-2"])),
    });
    expect(report.violations).toEqual([
      `PRD ${REF.repo}@${SHA} — CA-2 validation: declared at line 4 without a \`Validation :\` clause`,
    ]);
    expect(counters.withoutValidation).toBe("1");
    expect(counters.uncovered).toBe("0");
  });
});

describe("approval of the PRD", () => {
  const approvalViolations = (report: GateReport): readonly string[] =>
    report.violations.filter(
      (violation: string): boolean =>
        violation.includes("— maturity") || violation.includes("— served branch"),
    );

  test("a maturity at the threshold, on the served branch: both approval checks hold", async () => {
    const { report, counters } = await evaluate({ prd: text(prd("décision", [["WP-1", "CA-1"]])) });
    expect(approvalViolations(report)).toEqual([]);
    expect(report.checks.filter((check) => check.item.endsWith("— maturity"))).toHaveLength(1);
    expect(report.checks.filter((check) => check.item.endsWith("— served branch"))).toHaveLength(1);
    expect(counters.maturity).toBe("décision");
  });

  test("a maturity above the threshold is approved", async () => {
    const { report, counters } = await evaluate({
      prd: text(prd("prototype", [["WP-1", "CA-1"]])),
    });
    expect(report.violations).toEqual([]);
    expect(counters.maturity).toBe("prototype");
  });

  test("a maturity below the threshold is a violation", async () => {
    const { report, counters } = await evaluate({
      prd: text(prd("proposition", [["WP-1", "CA-1"]])),
    });
    expect(approvalViolations(report)).toHaveLength(1);
    expect(report.violations[0]).toContain("maturity proposition is below décision");
    expect(counters.maturity).toBe("proposition");
  });

  test("no maturity line is a violation, and the counter reads none", async () => {
    const { report, counters } = await evaluate({ prd: text(prd(null, [["WP-1", "CA-1"]])) });
    expect(approvalViolations(report)).toHaveLength(1);
    expect(counters.maturity).toBe("none");
  });

  test("a level outside the ladder is a violation, and the counter reads none", async () => {
    const { report, counters } = await evaluate({
      prd: text(prd("approuvé", [["WP-1", "CA-1"]])),
    });
    expect(approvalViolations(report)).toHaveLength(1);
    expect(counters.maturity).toBe("none");
  });

  test("the threshold is the approvedFrom of the policy text", async () => {
    const policy = (level: string): string =>
      `approvedFrom: "${level}"\nexempt: {}\nowners:\n  - example-owner\n`;
    const atDecision: string = prd("décision", [["WP-1", "CA-1"]]);
    const lower: GateReport = await evaluateWithPolicyText(
      REF,
      policy("décision"),
      memoryPorts({ prd: text(atDecision) }).ports,
    );
    expect(lower.violations).toEqual([]);
    const higher: GateReport = await evaluateWithPolicyText(
      REF,
      policy("prototype"),
      memoryPorts({ prd: text(atDecision) }).ports,
    );
    expect(higher.violations).toHaveLength(1);
    expect(higher.violations[0]).toContain("maturity décision is below prototype");
  });

  test("an unreadable policy is a violation and nothing is read", async () => {
    const { ports, calls } = memoryPorts({});
    const report: GateReport = await evaluateWithPolicyText(REF, "approvedFrom: [", ports);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("work-package policy unreadable");
    expect(calls).toEqual([]);
  });

  test("a commit that is not on the served branch is a violation", async () => {
    const { report } = await evaluate({ ancestry: { ok: true, value: false } });
    expect(approvalViolations(report)).toHaveLength(1);
    expect(report.violations[0]).toContain("is not on the served branch");
  });

  test("an ancestry that cannot be evaluated is a violation carrying the reason", async () => {
    const { report } = await evaluate({ ancestry: unreadable("ls-remote exited with code 128") });
    expect(approvalViolations(report)).toHaveLength(1);
    expect(report.violations[0]).toContain("ls-remote exited with code 128");
  });

  test("an ancestry that is not the boolean true does not approve", async () => {
    const { report } = await evaluate({
      ancestry: { ok: true, value: "true" as unknown as boolean },
    });
    expect(approvalViolations(report)).toHaveLength(1);
  });
});

describe("an unreadable source is a violation, never a zero", () => {
  test("docs/prd.md absent at the commit", async () => {
    const { report, counters } = await evaluate({ prd: unreadable("no such blob") });
    expect(report.violations).toEqual([
      `PRD ${REF.repo}@${SHA} — ${PRD_PATH}: ${PRD_PATH} unreadable (no such blob)`,
    ]);
    expect(counters.workPackages).toBe("unreadable");
    expect(counters.maturity).toBe("unreadable");
    expect(counters.declared).toBe("1");
  });

  test("docs/cahier-des-charges.md absent at the commit", async () => {
    const { report, counters } = await evaluate({ requirements: unreadable("no such blob") });
    expect(report.violations).toEqual([
      `PRD ${REF.repo}@${SHA} — ${REQUIREMENTS_PATH}: ${REQUIREMENTS_PATH} unreadable (no such blob)`,
    ]);
    expect(counters.declared).toBe("unreadable");
    expect(counters.withoutValidation).toBe("unreadable");
    expect(counters.workPackages).toBe("1");
  });

  test("a PRD outside the alphabet is refused with its line", async () => {
    const { report, counters } = await evaluate({
      prd: text(`${prd("décision", [["WP-1", "CA-1"]])}\nBudget : 10 \u{20ac}\n`),
    });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain(`${PRD_PATH} unreadable as a PRD (line `);
    expect(report.violations[0]).toContain("U+20AC");
    expect(counters.workPackages).toBe("unreadable");
    expect(counters.maturity).toBe("unreadable");
  });

  test("a PRD without a work-package table", async () => {
    const { report, counters } = await evaluate({
      prd: text("# Product requirements\n\nMaturité du document : décision\n"),
    });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain(`work-package table of ${PRD_PATH} unreadable (`);
    expect(counters.workPackages).toBe("unreadable");
    expect(counters.maturity).toBe("décision");
  });

  test("a specification holding a refused criterion form", async () => {
    const { report, counters } = await evaluate({
      requirements: text(`${requirements(["CA-1"])}\n1. CA-2 An ordered item.\n`),
    });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain(`${REQUIREMENTS_PATH} unreadable as criteria (line `);
    expect(counters.declared).toBe("unreadable");
  });

  test("both documents unreadable: two violations, every counter unreadable", async () => {
    const { report, counters } = await evaluate({
      prd: unreadable("first"),
      requirements: unreadable("second"),
    });
    expect(report.violations).toHaveLength(2);
    expect(new Set(Object.values(counters))).toEqual(new Set(["unreadable"]));
  });
});

describe("what the control reads, and in which order it reports", () => {
  test("only readFileAt, for the two documents, and isAncestorOfServedHead are called", async () => {
    const { report, calls } = await evaluate();
    expect(report.outcome).toBe("pass");
    expect([...calls].sort()).toEqual([
      `isAncestorOfServedHead ${REF.repo} ${SHA}`,
      `readFileAt ${REF.repo} ${SHA} ${REQUIREMENTS_PATH}`,
      `readFileAt ${REF.repo} ${SHA} ${PRD_PATH}`,
    ]);
  });

  test("criteria are reported by number whatever the order of the specification, then the rows in table order", async () => {
    const scenario: Scenario = {
      prd: text(
        prd("décision", [
          ["WP-7", "CA-10"],
          ["WP-3", "CA-2"],
        ]),
      ),
      requirements: text(requirements(["CA-10", "CA-1", "CA-2"])),
    };
    const first: Evaluated = await evaluate(scenario);
    const second: Evaluated = await evaluate(scenario);
    expect(second.report.checks).toEqual(first.report.checks);
    const prefix: string = `PRD ${REF.repo}@${SHA} — `;
    const items: readonly string[] = first.report.checks.map((check): string =>
      check.item.slice(prefix.length),
    );
    expect(items).toEqual([
      "served branch",
      "maturity",
      REQUIREMENTS_PATH,
      "CA-1 validation",
      "CA-2 validation",
      "CA-10 validation",
      "CA-1 coverage",
      "CA-2 coverage",
      "CA-10 coverage",
      "WP-7 cites CA-10",
      "WP-3 cites CA-2",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The command line.
// ---------------------------------------------------------------------------

const scratchDirectories: string[] = [];

function scratch(prefix: string): string {
  const directory: string = mkdtempSync(join(tmpdir(), prefix));
  scratchDirectories.push(directory);
  return directory;
}

afterAll((): void => {
  for (const directory of scratchDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const BAD_COMMAND_LINES: readonly (readonly [string, readonly string[]])[] = [
  ["no argument", []],
  ["two arguments", [`${REF.repo}@${SHA}`, `${REF.repo}@${SHA}`]],
  ["a short commit", [`${REF.repo}@0123456`]],
  ["an upper-case commit", [`${REF.repo}@${SHA.toUpperCase()}`]],
  ["a PRD-ref with its path suffix", [`${REF.repo}@${SHA}:docs/prd.md`]],
  ["no owner", [`example-repo@${SHA}`]],
  ["a dot-dot repository", [`example-owner/..@${SHA}`]],
  ["an option", ["--help"]],
];

describe("readArguments", () => {
  test("one <owner>/<repo>@<40 lowercase hex> is read", () => {
    expect(readArguments([`${REF.repo}@${SHA}`])).toEqual({ ok: true, value: REF });
  });

  test.each(BAD_COMMAND_LINES)("%s is refused", (_name: string, argv: readonly string[]) => {
    expect(readArguments(argv).ok).toBe(false);
  });
});

describe("runCommand", () => {
  function countingGit(): { readonly run: RunGit; readonly invocations: GitInvocation[] } {
    const invocations: GitInvocation[] = [];
    const run: RunGit = async (invocation: GitInvocation): Promise<GitResult> => {
      invocations.push(invocation);
      return { exitCode: 1, stdout: new Uint8Array(), stderr: "stand-in git" };
    };
    return { run, invocations };
  }

  test.each(
    BAD_COMMAND_LINES,
  )("%s: usage, and git is never invoked", async (_name: string, argv: readonly string[]) => {
    const { run, invocations } = countingGit();
    const outcome: CommandOutcome = await runCommand(argv, {}, scratch("prd-decomposition-"), run);
    expect(outcome.kind).toBe("usage");
    expect(invocations).toHaveLength(0);
  });

  test("a well-formed argument reaches git, and unreadable sources are violations", async () => {
    const { run, invocations } = countingGit();
    const outcome: CommandOutcome = await runCommand(
      [`${REF.repo}@${SHA}`],
      { PATH: "", GITHUB_TOKEN: "not-a-real-token" },
      scratch("prd-decomposition-"),
      run,
    );
    expect(invocations.length).toBeGreaterThan(0);
    // The token of the environment reaches the remote reads through the git
    // environment (the ports set one config entry for it), never an argument.
    expect(invocations.some((invocation) => invocation.env.GIT_CONFIG_COUNT === "1")).toBe(true);
    expect(invocations.every((invocation) => !invocation.args.includes("not-a-real-token"))).toBe(
      true,
    );
    if (outcome.kind !== "report") throw new Error("expected a report");
    expect(outcome.report.violations).toHaveLength(3);
    expect(outcome.report.violations.join("\n")).not.toContain("not-a-real-token");
    expect(new Set(Object.values(countersOf(outcome.report)))).toEqual(new Set(["unreadable"]));
  });
});

describe("the process", () => {
  const SCRIPT: string = join(import.meta.dir, "check-prd-decomposition.ts");

  /** Runs the command with a stand-in `git` as the whole PATH; the stand-in leaves a marker. */
  function launch(argv: readonly string[]): {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly gitWasInvoked: boolean;
  } {
    const bin: string = scratch("prd-decomposition-bin-");
    const marker: string = join(bin, "invoked");
    writeFileSync(join(bin, "git"), ["#!/bin/sh", `echo x > '${marker}'`, "exit 1", ""].join("\n"));
    chmodSync(join(bin, "git"), 0o755);
    const child = Bun.spawnSync([process.execPath, SCRIPT, ...argv], {
      cwd: scratch("prd-decomposition-cwd-"),
      env: { PATH: bin },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: child.exitCode,
      stdout: new TextDecoder().decode(child.stdout),
      stderr: new TextDecoder().decode(child.stderr),
      gitWasInvoked: existsSync(marker),
    };
  }

  // The four command lines of the brief; the grammar itself is tested above, in process.
  test.each(
    BAD_COMMAND_LINES.slice(0, 4),
  )("%s: exit 2, usage on stderr, no git", (_name: string, argv: readonly string[]) => {
    const result = launch(argv);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "usage: bun tools/quality/check-prd-decomposition.ts <owner>/<repo>@",
    );
    expect(result.stdout).toBe("");
    expect(result.gitWasInvoked).toBe(false);
  });

  test("a well-formed argument whose sources cannot be read: exit 1, with the counters on stderr", () => {
    const result = launch([`${REF.repo}@${SHA}`]);
    expect(result.exitCode).toBe(1);
    expect(result.gitWasInvoked).toBe(true);
    expect(result.stderr).toContain("PRD decomposition examined: criteria declared: unreadable");
    expect(result.stderr).toContain("PRD decomposition failed: 3 of 3 assertion(s) did not hold.");
  });
});
