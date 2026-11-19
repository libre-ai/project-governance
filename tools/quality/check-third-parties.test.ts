import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  evaluateThirdParties,
  REGISTER_PATH,
  regularTrackedFiles,
  SCHEMA_VERSION,
} from "./check-third-parties";
import type { GateReport } from "./gate-report";
import { readGit } from "./git-diff";

/**
 * Expected verdicts come from the L111 brief (its violations list and testable
 * criteria) and ADR-0070, not from the gate's output. Pure evaluation: no
 * clock, no network; the last block reads the tracked register and `git ls-files`.
 */

const NOW = new Date("2026-06-15T12:00:00Z");
const PROCEDURE = "docs/security/third-party-exits/example.md";
const TRACKED: ReadonlySet<string> = new Set([PROCEDURE]);

interface ExerciseLines {
  readonly planned_on?: string;
  readonly procedure?: string;
  readonly last_executed_on?: string;
}

const FUTURE: ExerciseLines = {
  planned_on: "2026-07-01",
  procedure: PROCEDURE,
  last_executed_on: "null",
};

function exerciseBlock(exercise: ExerciseLines): string {
  return [
    "    exit_exercise:",
    ...Object.entries(exercise).map(([key, value]) => `      ${key}: ${value}`),
  ].join("\n");
}

function entry(id: string, exercise: ExerciseLines = FUTURE): string {
  return [`  - id: ${id}`, "    subject: un service", exerciseBlock(exercise)].join("\n");
}

function register(...entries: readonly string[]): string {
  return [`schema_version: ${SCHEMA_VERSION}`, "third_parties:", ...entries, ""].join("\n");
}

function judge(text: string | null, now: Date = NOW): GateReport {
  return evaluateThirdParties(text, TRACKED, now);
}

const ID = "third-party.example";

function withExercise(exercise: ExerciseLines): GateReport {
  return judge(register(entry(ID, exercise)));
}

describe("a well-formed entry", () => {
  test("a future exercise with a tracked procedure holds", () => {
    const report = judge(register(entry(ID)));
    expect(report.violations).toEqual([]);
    expect(report.outcome).toBe("pass");
  });

  test("an exercise due today is not past due, even with no execution", () => {
    expect(withExercise({ ...FUTURE, planned_on: "2026-06-15" }).violations).toEqual([]);
  });

  test("a past exercise executed two days after its date holds", () => {
    const report = withExercise({
      ...FUTURE,
      planned_on: "2026-06-01",
      last_executed_on: "2026-06-03",
    });
    expect(report.violations).toEqual([]);
  });

  test("an execution on the planned date and one on the reference date both hold", () => {
    const planned = { ...FUTURE, planned_on: "2026-06-01" };
    expect(withExercise({ ...planned, last_executed_on: "2026-06-01" }).violations).toEqual([]);
    expect(withExercise({ ...planned, last_executed_on: "2026-06-15" }).violations).toEqual([]);
  });

  test("an earlier execution does not disturb an exercise still to come", () => {
    expect(withExercise({ ...FUTURE, last_executed_on: "2026-01-10" }).violations).toEqual([]);
  });
});

describe("the exit exercise", () => {
  test("a missing exercise is exactly one violation, named by the entry", () => {
    const text = register(`  - id: ${ID}\n    subject: un service`);
    expect(judge(text).violations).toEqual([`third_parties.${ID}: exercice de sortie absent`]);
  });

  test("a past exercise with no execution is a violation", () => {
    const report = withExercise({ ...FUTURE, planned_on: "2026-06-14" });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain(`third_parties.${ID}`);
    expect(report.violations[0]).toContain("sans exécution enregistrée");
  });

  test("an execution before the planned date does not cover a past exercise", () => {
    const report = withExercise({
      ...FUTURE,
      planned_on: "2026-06-01",
      last_executed_on: "2026-05-31",
    });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("sans exécution enregistrée");
  });

  test("an execution after the reference date is a violation", () => {
    const past = withExercise({
      ...FUTURE,
      planned_on: "2026-06-01",
      last_executed_on: "2026-06-16",
    });
    expect(past.violations).toHaveLength(1);
    expect(past.violations[0]).toContain("postérieure");
    const upcoming = withExercise({ ...FUTURE, last_executed_on: "2026-06-16" });
    expect(upcoming.violations).toHaveLength(1);
    expect(upcoming.violations[0]).toContain("postérieure");
  });

  test.each(["2026-02-30", "2026-1-5", "null", "soon"])("planned_on %s is a violation", (value) => {
    const report = withExercise({ ...FUTURE, planned_on: value });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("planned_on");
  });

  test("a missing planned_on is a violation", () => {
    const { planned_on: _omitted, ...rest } = FUTURE;
    expect(withExercise(rest).violations[0]).toContain("planned_on");
  });

  test("a malformed last_executed_on is a violation", () => {
    const report = withExercise({ ...FUTURE, last_executed_on: "2026-02-30" });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("last_executed_on");
  });

  test("an omitted last_executed_on is a violation: it is always written", () => {
    const { last_executed_on: _omitted, ...rest } = FUTURE;
    const report = withExercise(rest);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("s'écrit toujours");
  });

  test("an empty procedure is a violation", () => {
    const report = withExercise({ ...FUTURE, procedure: '""' });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("doit nommer un fichier suivi");
  });

  test("a procedure that is not tracked is a violation", () => {
    const report = withExercise({ ...FUTURE, procedure: "docs/absent.md" });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("docs/absent.md");
  });

  test("an unknown exercise key is a violation", () => {
    const text = register(`${entry(ID)}\n      owner: quelqu'un`);
    expect(judge(text).violations.join("\n")).toContain("owner");
  });
});

describe("the register fails closed, never zero", () => {
  test("an absent register", () => {
    expect(judge(null).violations).toEqual([`${REGISTER_PATH}: registre absent ou illisible`]);
  });

  test("an empty list", () => {
    const text = `schema_version: ${SCHEMA_VERSION}\nthird_parties: []\n`;
    expect(judge(text).violations).toHaveLength(1);
    expect(judge(text).violations[0]).toContain("aucune entrée");
    expect(judge(text).outcome).toBe("violations");
  });

  test("a list key with no value is not an empty success", () => {
    const text = `schema_version: ${SCHEMA_VERSION}\nthird_parties:\n`;
    expect(judge(text).violations).toEqual([
      `${REGISTER_PATH}: \`third_parties\` doit être une liste`,
    ]);
  });

  test("an empty document", () => {
    expect(judge("").violations).toEqual([
      `${REGISTER_PATH}: la racine du registre n'est pas une table`,
    ]);
  });

  test("a list written in flow is not read by the line scan, so the counts disagree", () => {
    const flow = `schema_version: ${SCHEMA_VERSION}\nthird_parties: [{id: ${ID}}]\n`;
    expect(judge(flow).violations.join("\n")).toContain(
      "0 entrée(s) lue(s) ligne à ligne, 1 par le parseur",
    );
  });

  test("a parse error", () => {
    expect(judge('schema_version: "open\nthird_parties: []\n').violations[0]).toContain(
      "YAML illisible",
    );
  });

  test("a character the parser and the line scan read differently", () => {
    const report = judge(register(entry(ID)).replace("un service", "un\u{A0}service"));
    expect(report.violations[0]).toContain("U+00A0");
  });

  test("an unknown root key", () => {
    expect(judge(`extra: 1\n${register(entry(ID))}`).violations.join("\n")).toContain("extra");
  });

  test("a wrong schema version", () => {
    const text = register(entry(ID)).replace(SCHEMA_VERSION, "libre-ai.third-parties.v2");
    expect(judge(text).violations.join("\n")).toContain("schema_version");
  });

  test("an unknown entry key", () => {
    const text = register(`${entry(ID)}\n    vendor: quelqu'un`);
    expect(judge(text).violations.join("\n")).toContain("vendor");
  });

  test("a duplicated id", () => {
    const report = judge(register(entry(ID), entry(ID)));
    expect(report.violations).toEqual([`third_parties.${ID}: \`id\` en double : ${ID}`]);
  });

  test.each(["forge", "third-party.Forge", "third-party.a--b"])("the id %s is refused", (id) => {
    expect(judge(register(entry(id))).violations.join("\n")).toContain("`id` doit s'écrire");
  });

  test("an empty subject", () => {
    const text = register(entry(ID)).replace("un service", '""');
    expect(judge(text).violations.join("\n")).toContain("subject");
  });

  test("the same key twice in an entry, which the parser alone would hide", () => {
    const text = register(entry(ID).replace("    subject:", "    subject: autre\n    subject:"));
    expect(judge(text).violations.join("\n")).toContain("garde que la dernière : subject");
  });

  test("the same key twice in an exercise, which the parser alone would hide", () => {
    const text = register(`${entry(ID)}\n      planned_on: 2026-07-02`);
    expect(judge(text).violations.join("\n")).toContain("garde que la dernière : planned_on");
  });

  test("the same root key twice", () => {
    const text = `schema_version: ${SCHEMA_VERSION}\n${register(entry(ID))}`;
    expect(judge(text).violations.join("\n")).toContain("racine écrite(s) deux fois");
  });

  test("an exercise written in flow escapes the line reading, so it is refused", () => {
    const flow = `  - id: ${ID}\n    subject: un service\n    exit_exercise: {planned_on: 2026-07-01, planned_on: 2026-07-02}`;
    expect(judge(register(flow)).violations[0]).toContain("hors du style bloc");
  });

  test("a quoted key escapes the line reading, so it is refused", () => {
    const text = register(entry(ID).replace("    subject:", '    "subject":'));
    expect(judge(text).violations[0]).toContain("hors du style bloc");
  });
});

describe("the printed volume", () => {
  const report = judge(
    register(
      entry("third-party.past", {
        ...FUTURE,
        planned_on: "2026-06-01",
        last_executed_on: "2026-06-02",
      }),
      entry("third-party.today", { ...FUTURE, planned_on: "2026-06-15" }),
      entry("third-party.later"),
    ),
  );

  test("says how many entries were examined, past due and to come", () => {
    expect(report.volumeSummary).toBe(
      "3 entrée(s) examinée(s) = 1 échéance(s) passée(s) + 2 à venir + 0 sans date lisible",
    );
  });

  test("its counters sum to the entries, an unreadable date included", () => {
    const mixed = judge(
      register(
        entry("third-party.past", { ...FUTURE, planned_on: "2026-06-01" }),
        entry("third-party.bad", { ...FUTURE, planned_on: "2026-02-30" }),
        `  - id: third-party.none\n    subject: un service`,
        entry("third-party.later"),
      ),
    );
    const counters = /^(\d+) .* = (\d+) .* \+ (\d+) à venir \+ (\d+) sans date lisible$/.exec(
      mixed.volumeSummary ?? "",
    );
    expect(counters?.slice(1).map(Number)).toEqual([4, 1, 1, 2]);
  });
});

describe("regularTrackedFiles", () => {
  const sha = "a".repeat(40);

  test("keeps regular files and drops a symbolic link and a gitlink", () => {
    const listing = [
      `100644 ${sha} 0\tdocs/a.md`,
      `100755 ${sha} 0\ttools/b.sh`,
      `120000 ${sha} 0\tdocs/link.md`,
      `160000 ${sha} 0\tvendor/module`,
      "",
    ].join("\0");
    expect([...(regularTrackedFiles(listing) ?? [])]).toEqual(["docs/a.md", "tools/b.sh"]);
  });

  test("an unreadable or empty listing is null, never an empty set", () => {
    expect(regularTrackedFiles("not a record\0")).toBeNull();
    expect(regularTrackedFiles("")).toBeNull();
  });
});

describe("the tracked register", () => {
  const text = readFileSync(REGISTER_PATH, "utf8");
  const listed = readGit(["ls-files", "-s", "-z"], "list the tracked files");
  const tracked = listed.ok ? regularTrackedFiles(listed.stdout) : null;

  /**
   * The replay clock is the latest date the register itself proves has
   * happened, never the wall clock: with today's date this test would turn the
   * suite red on the first planned date, and so wire into `bun run check` a
   * gate ADR-0070 keeps out of it until the owner accepts it.
   */
  function replayClock(): Date {
    const executed = [...text.matchAll(/last_executed_on: (\d{4}-\d{2}-\d{2})/g)].map(
      (match) => match[1] ?? "",
    );
    return new Date(`${["2026-11-18", ...executed].sort().at(-1)}T12:00:00Z`);
  }

  test("holds, and every procedure it names is a tracked regular file", () => {
    expect(tracked).not.toBeNull();
    const report = evaluateThirdParties(text, tracked ?? new Set<string>(), replayClock());
    expect(report.violations).toEqual([]);
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBeGreaterThan(0);
  });
});
