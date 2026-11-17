import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  evaluateOpenPoints,
  type OpenPointsInput,
  type OpenPointsOutcome,
  openPointsExitCode,
  parseCondition,
  REGISTER_PATH,
  SCHEMA_VERSION,
} from "./open-points";

const ROOT = join(import.meta.dir, "..");
const TRACKED = new Set(["docs/a.md", "docs/b.md"]);

type Fields = Record<string, string>;

/** A register text; values are written as JSON strings, which YAML reads as double-quoted scalars. */
function register(points: readonly Fields[], extraRoot = ""): string {
  const lines = [`schema_version: ${SCHEMA_VERSION}`, ...(extraRoot === "" ? [] : [extraRoot])];
  if (points.length === 0) return [...lines, "points: []", ""].join("\n");
  lines.push("points:");
  for (const fields of points) {
    Object.entries(fields).forEach(([key, value], index) => {
      lines.push(`${index === 0 ? "  - " : "    "}${key}: ${JSON.stringify(value)}`);
    });
  }
  return `${lines.join("\n")}\n`;
}

function openPoint(overrides: Fields = {}, omit: readonly string[] = []): Fields {
  const base: Fields = {
    id: "point.sample",
    question: "Is it decided?",
    type: "decision",
    proprietaire: "proprietaire",
    condition: "until=2026-12-31",
    etat: "ouvert",
    source: "docs/a.md",
    ...overrides,
  };
  for (const key of omit) delete base[key];
  return base;
}

function closedPoint(closedBy: string, overrides: Fields = {}): Fields {
  return openPoint({ etat: "clos", clos_par: closedBy, ...overrides });
}

function input(text: string | null, overrides: Partial<OpenPointsInput> = {}): OpenPointsInput {
  return {
    text,
    registerDecisions: new Set(["D1", "D50"]),
    adrNumbers: new Set(["0001", "0042"]),
    isTracked: (path) => TRACKED.has(path),
    today: "2026-11-16",
    pullRequestMerged: async () => false,
    ...overrides,
  };
}

function failedRules(outcome: OpenPointsOutcome): string[] {
  return outcome.report.checks.filter((check) => !check.ok).map((check) => check.item);
}

async function evaluate(points: readonly Fields[], overrides: Partial<OpenPointsInput> = {}) {
  return evaluateOpenPoints(input(register(points), overrides));
}

describe("parseCondition", () => {
  test("reads the three forms", () => {
    expect(parseCondition("until=2026-11-15")).toEqual({ kind: "date", date: "2026-11-15" });
    expect(parseCondition("absent(docs/x.md)")).toEqual({ kind: "absent", path: "docs/x.md" });
    expect(parseCondition("merged(o/r#1)")).toEqual({
      kind: "merged",
      repository: "o/r",
      number: 1,
    });
  });

  test.each([
    "until=demain",
    "until=2026-02-30",
    "absent()",
    "merged(org/repo)",
    "when the owner decides",
  ])("returns null for %p", (text) => {
    expect(parseCondition(text)).toBeNull();
  });
});

describe("evaluateOpenPoints", () => {
  test("a well-formed register passes, one assertion per rule", async () => {
    const outcome = await evaluate([openPoint()]);
    expect(outcome.report.outcome).toBe("pass");
    expect(outcome.report.asserted).toBe(8);
    expect(openPointsExitCode(outcome)).toBe(0);
  });

  test("R5: clos_par D999 absent from the decision register fails", async () => {
    const outcome = await evaluate([closedPoint("D999")]);
    expect(failedRules(outcome)).toEqual(["R5 point.sample"]);
  });

  test("R5: clos_par ADR-9999 absent from docs/adr/ fails", async () => {
    const outcome = await evaluate([closedPoint("ADR-9999")]);
    expect(failedRules(outcome)).toEqual(["R5 point.sample"]);
  });

  test("R5: existing D50 and ADR-0042 close a point", async () => {
    const outcome = await evaluate([
      closedPoint("D50"),
      closedPoint("ADR-0042", { id: "point.other" }),
    ]);
    expect(outcome.report.outcome).toBe("pass");
  });

  test("R5: clos_par on an open point, or none on a closed one, fails", async () => {
    const onOpen = await evaluate([openPoint({ clos_par: "D1" })]);
    expect(failedRules(onOpen)).toEqual(["R5 point.sample"]);
    const missing = await evaluate([openPoint({ etat: "clos" })]);
    expect(failedRules(missing)).toEqual(["R5 point.sample"]);
  });

  test("R5: an unread decision register is a failure, never a zero", async () => {
    const outcome = await evaluate([openPoint()], { registerDecisions: new Set() });
    expect(failedRules(outcome)).toEqual([`R5 ${REGISTER_PATH}`]);
  });

  test("R1/R3: a missing or unknown proprietaire is refused", async () => {
    const missing = await evaluate([openPoint({}, ["proprietaire"])]);
    expect(failedRules(missing)).toEqual(["R1 point.sample"]);
    const unknown = await evaluate([openPoint({ proprietaire: "comite" })]);
    expect(failedRules(unknown)).toEqual(["R3 point.sample"]);
  });

  test("R3: tiers owns a dependance_externe only", async () => {
    const outcome = await evaluate([openPoint({ proprietaire: "tiers" })]);
    expect(failedRules(outcome)).toEqual(["R3 point.sample"]);
  });

  test("R4: a point carrying a malformed condition is a violation", async () => {
    for (const condition of ["until=demain", "until=2026-02-30", "absent()", "merged(org/repo)"]) {
      const outcome = await evaluate([openPoint({ condition })]);
      expect(failedRules(outcome)).toEqual(["R4 point.sample"]);
      expect(openPointsExitCode(outcome)).toBe(1);
    }
  });

  test("R8: until=2026-11-15 is due on 2026-11-16 and pending on 2026-11-15", async () => {
    const point = openPoint({ condition: "until=2026-11-15" });
    const due = await evaluate([point], { today: "2026-11-16" });
    expect(failedRules(due)).toEqual(["R8 point.sample"]);
    const pending = await evaluate([point], { today: "2026-11-15" });
    expect(pending.report.outcome).toBe("pass");
  });

  test("R8: absent(x) is due once x is no longer tracked, pending while it is", async () => {
    const due = await evaluate([openPoint({ condition: "absent(docs/gone.md)" })]);
    expect(failedRules(due)).toEqual(["R8 point.sample"]);
    const pending = await evaluate([openPoint({ condition: "absent(docs/b.md)" })]);
    expect(pending.report.outcome).toBe("pass");
  });

  test("R8: a merged pull request makes the condition due", async () => {
    const outcome = await evaluate([openPoint({ condition: "merged(o/r#1)" })], {
      pullRequestMerged: async () => true,
    });
    expect(failedRules(outcome)).toEqual(["R8 point.sample"]);
  });

  test("an unreadable merged() is unavailable: exit code 3, never 0", async () => {
    const outcome = await evaluate([openPoint({ condition: "merged(o/r#1)" })], {
      pullRequestMerged: async () => null,
    });
    expect(outcome.report.outcome).toBe("pass");
    expect(outcome.unavailable).toBe(1);
    expect(openPointsExitCode(outcome)).toBe(3);
  });

  test("a throwing pull request reader is unavailable too", async () => {
    const outcome = await evaluate([openPoint({ condition: "merged(o/r#1)" })], {
      pullRequestMerged: async () => {
        throw new Error("network");
      },
    });
    expect(openPointsExitCode(outcome)).toBe(3);
  });

  test("R6: a dependance_externe without repli is refused", async () => {
    const external = openPoint({
      type: "dependance_externe",
      proprietaire: "tiers",
      attendu: "an answer",
      critere_acceptation: "a signed reply",
      repli: "we proceed without it",
    });
    expect((await evaluate([external])).report.outcome).toBe("pass");
    const withoutFallback = { ...external };
    delete withoutFallback.repli;
    expect(failedRules(await evaluate([withoutFallback]))).toEqual(["R6 point.sample"]);
  });

  test("R7: an untracked source is refused", async () => {
    const outcome = await evaluate([openPoint({ source: "docs/untracked.md" })]);
    expect(failedRules(outcome)).toEqual(["R7 point.sample"]);
  });

  test("R1: an empty, absent or unknown-keyed register fails", async () => {
    const empty = await evaluateOpenPoints(input(register([])));
    expect(failedRules(empty)).toEqual([`R1 ${REGISTER_PATH}`]);
    const absent = await evaluateOpenPoints(input(null));
    expect(failedRules(absent)).toEqual([`R1 ${REGISTER_PATH}`]);
    expect(openPointsExitCode(absent)).toBe(1);
    const unknownRoot = await evaluateOpenPoints(input(register([openPoint()], "owner: x")));
    expect(failedRules(unknownRoot)).toEqual([`R1 ${REGISTER_PATH}`]);
    const unknownKey = await evaluate([openPoint({ blocking: "yes" })]);
    expect(failedRules(unknownKey)).toEqual(["R1 point.sample"]);
  });

  test("R2: two points with the same id fail", async () => {
    const outcome = await evaluate([openPoint(), openPoint()]);
    expect(failedRules(outcome)).toEqual(["R2 point.sample"]);
  });

  test("R2: an id outside the form fails", async () => {
    const outcome = await evaluate([openPoint({ id: "point.Bad--id" })]);
    expect(failedRules(outcome)).toEqual(["R2 points[0]"]);
  });

  test("the volume sums on a mixed register", async () => {
    const outcome = await evaluate(
      [
        openPoint({ id: "point.pending-date", condition: "until=2026-12-31" }),
        openPoint({ id: "point.due-absent", condition: "absent(docs/gone.md)" }),
        openPoint({ id: "point.unread-merged", condition: "merged(o/r#2)" }),
        closedPoint("D1", { id: "point.closed", condition: "merged(o/r#3)" }),
      ],
      { pullRequestMerged: async () => null },
    );
    expect(outcome.volume).toBe(
      "4 point(s) = 3 ouvert(s) + 1 clos + 0 sans état lisible ; " +
        "4 condition(s) = 1 date + 1 absent + 2 merged + 0 malformée(s) ; " +
        "3 condition(s) de point ouvert = 1 pending + 1 due + 1 unavailable + 0 sans verdict",
    );
    expect(outcome.report.volumeSummary).toBe(outcome.volume);
  });
});

describe("check-open-points.ts", () => {
  test("the shipped register passes (exit 0 or 3) and cites a tracked source", async () => {
    const run = Bun.spawnSync(["bun", "ecosystem/check-open-points.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([0, 3]).toContain(run.exitCode);
    expect(run.stdout.toString()).toContain("Open points verified:");
    const text = await Bun.file(join(ROOT, REGISTER_PATH)).text();
    const parsed = Bun.YAML.parse(text) as { points: { source: string }[] };
    const tracked = Bun.spawnSync(
      ["git", "ls-files", "--error-unmatch", parsed.points[0]?.source ?? ""],
      {
        cwd: ROOT,
      },
    );
    expect(tracked.exitCode).toBe(0);
  });

  test("an argument is a usage error: exit 2", () => {
    const run = Bun.spawnSync(["bun", "ecosystem/check-open-points.ts", "extra"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(2);
  });
});
