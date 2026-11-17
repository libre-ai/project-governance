import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  check,
  MAX_THRESHOLD_DAYS,
  parseRegister,
  REGISTER_PATH,
  SCHEMA_VERSION,
} from "./check-off-code-zones";

// Expectations come from the rule (R12): owner, version and fingerprint each
// required; review date missing, malformed, future or strictly older than the
// declared threshold is a violation; the threshold is inclusive.

const TODAY = "2026-11-17";
const THRESHOLD = 365;

/** A complete zone reviewed `reviewedOn`; every case below starts green from it. */
function zone(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "off-code.signing-module-firmware",
    owner: "owner",
    version: "4.2.1",
    fingerprint: "sha256:0123456789abcdef",
    reviewed_on: "2026-11-01",
    ...overrides,
  };
}

function messagesOf(zones: readonly unknown[], threshold: unknown = THRESHOLD): string[] {
  return check(zones, threshold, TODAY).violations.map((v) => `${v.path}: ${v.message}`);
}

describe("check", () => {
  test("a complete zone reviewed recently produces no violation", () => {
    const evaluation = check([zone()], THRESHOLD, TODAY);
    expect(evaluation.violations).toEqual([]);
    expect(evaluation).toMatchObject({ zonesRead: 1, compliant: 1, violating: 0 });
  });

  test("a review exactly at the threshold is accepted", () => {
    // 2025-11-17 to 2026-11-17 is 365 days.
    expect(messagesOf([zone({ reviewed_on: "2025-11-17" })])).toEqual([]);
  });

  test("a review one day beyond the threshold is a violation naming age and threshold", () => {
    expect(messagesOf([zone({ reviewed_on: "2025-11-16" })])).toEqual([
      "zones.off-code.signing-module-firmware: review date 2025-11-16 is 366 day(s) old, beyond the threshold of 365 day(s)",
    ]);
  });

  test("a review several years old is a violation", () => {
    const messages = messagesOf([zone({ reviewed_on: "2019-03-01" })]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("beyond the threshold of 365 day(s)");
  });

  test("a review in the future is a violation", () => {
    expect(messagesOf([zone({ reviewed_on: "2026-11-18" })])).toEqual([
      "zones.off-code.signing-module-firmware: review date 2026-11-18 is in the future (1 day(s) ahead)",
    ]);
  });

  test("a zone without a review date is a violation", () => {
    const { reviewed_on: _dropped, ...withoutDate } = zone();
    expect(messagesOf([withoutDate])).toEqual([
      "zones.off-code.signing-module-firmware: no review date (reviewed_on)",
    ]);
  });

  test("a malformed or impossible review date is a violation, whatever its age", () => {
    for (const reviewedOn of ["2026-02-30", "17/11/2026", "2026-11-1", 20261101]) {
      const messages = messagesOf([zone({ reviewed_on: reviewedOn })]);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("malformed review date");
    }
  });

  test("each missing owner, version or fingerprint is its own violation", () => {
    expect(messagesOf([zone({ owner: undefined, version: "", fingerprint: "  " })])).toEqual([
      "zones.off-code.signing-module-firmware: no owner",
      "zones.off-code.signing-module-firmware: no version",
      "zones.off-code.signing-module-firmware: no fingerprint",
    ]);
  });

  test("a zone without id, or a duplicate id, is reported at its index", () => {
    expect(messagesOf([zone({ id: undefined }), zone(), zone()])).toEqual([
      "zones[0]: no id",
      "zones[2]: duplicate id off-code.signing-module-firmware",
    ]);
  });

  test("counters sum to the zones read", () => {
    const evaluation = check(
      [zone(), zone({ id: "off-code.b", owner: "" }), zone({ id: "off-code.c" })],
      THRESHOLD,
      TODAY,
    );
    expect(evaluation).toMatchObject({ zonesRead: 3, compliant: 2, violating: 1 });
  });

  test("a threshold that is not a whole number of days, or a bad reference date, fails", () => {
    expect(messagesOf([], "365")).toEqual([
      'review_max_age_days: "365" is not a whole number of days',
    ]);
    expect(check([], THRESHOLD, "2026-13-01").violations.map((v) => v.path)).toEqual([
      "reference date",
    ]);
  });

  test("a threshold above the ceiling set in code is a violation", () => {
    expect(MAX_THRESHOLD_DAYS).toBe(365);
    expect(messagesOf([zone()], 1e9)).toEqual([
      "review_max_age_days: 1000000000 day(s) exceeds the ceiling of 365 day(s) set in code",
    ]);
    expect(messagesOf([zone()], 366)).toHaveLength(1);
    expect(messagesOf([zone()], 365)).toEqual([]);
  });

  test("an owner, version or fingerprint that is not a string must be quoted", () => {
    // `version: 1.0` reaches the check as the number 1: the field is there, unquoted.
    const text = `schema_version: ${SCHEMA_VERSION}\nreview_max_age_days: 365\nzones:\n  - id: off-code.a\n    owner: owner\n    version: 1.0\n    fingerprint: sha256:00\n    reviewed_on: 2026-11-01\n`;
    const register = parseRegister(text);
    if (typeof register === "string") throw new Error(register);
    expect(messagesOf(register.zones)).toEqual([
      "zones.off-code.a: version must be a quoted string",
    ]);
    expect(messagesOf([zone({ owner: 42, version: 4, fingerprint: true })])).toEqual([
      "zones.off-code.signing-module-firmware: owner must be a quoted string",
      "zones.off-code.signing-module-firmware: version must be a quoted string",
      "zones.off-code.signing-module-firmware: fingerprint must be a quoted string",
    ]);
  });

  test("zones whose review cannot be judged are counted apart, never compliant", () => {
    expect(check([zone()], "365", TODAY)).toMatchObject({
      zonesRead: 1,
      compliant: 0,
      violating: 0,
      unjudged: 1,
    });
    expect(
      check([zone(), zone({ id: "off-code.b", owner: "" })], THRESHOLD, "2026-13-01"),
    ).toMatchObject({
      zonesRead: 2,
      compliant: 0,
      violating: 1,
      unjudged: 1,
    });
    expect(check([zone()], 1e9, TODAY)).toMatchObject({ compliant: 0, unjudged: 1 });
  });
});

describe("the gate run", () => {
  const workspaces: string[] = [];
  afterAll(() => {
    for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
  });

  function runGate(register: string): { code: number; stdout: string; stderr: string } {
    const cwd = mkdtempSync(join(tmpdir(), "off-code-zones-"));
    workspaces.push(cwd);
    mkdirSync(join(cwd, "ecosystem"));
    writeFileSync(join(cwd, REGISTER_PATH), register);
    const run = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, "check-off-code-zones.ts"), `--today=${TODAY}`],
      { cwd, env: { PATH: process.env.PATH ?? "" } },
    );
    return { code: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
  }

  const header = `schema_version: ${SCHEMA_VERSION}\nreview_max_age_days: 365\n`;

  test("an empty register asserts nothing and says so, with its counters", () => {
    const run = runGate(`${header}zones: []\n`);
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain("assertion(s) hold");
    expect(run.stdout).toContain("verified nothing, as declared: aucune zone déclarée");
    expect(run.stdout).toContain("read=0 compliant=0 violating=0 unjudged=0");
  });

  test("a register with a compliant zone holds one assertion per zone", () => {
    const run = runGate(
      `${header}zones:\n  - id: off-code.a\n    owner: o\n    version: "1"\n    fingerprint: f\n    reviewed_on: 2026-11-01\n`,
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("read=1 compliant=1 violating=0 unjudged=0");
  });

  test("a doubled threshold key fails the gate", () => {
    const run = runGate(
      `schema_version: ${SCHEMA_VERSION}\nreview_max_age_days: 365\nreview_max_age_days: 99999\n` +
        'zones:\n  - id: off-code.a\n    owner: o\n    version: "1"\n    fingerprint: f\n    reviewed_on: 2019-01-01\n',
    );
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("written twice");
  });
});

describe("parseRegister", () => {
  const header = `schema_version: ${SCHEMA_VERSION}\nreview_max_age_days: 365\n`;

  test("reads the threshold and the zones", () => {
    const register = parseRegister(
      `${header}zones:\n  - id: off-code.a\n    reviewed_on: 2026-11-01\n`,
    );
    expect(register).toEqual({
      threshold: 365,
      zones: [{ id: "off-code.a", reviewed_on: "2026-11-01" }],
    });
  });

  test("refuses a character the YAML parser would read differently", () => {
    expect(parseRegister(`${header}zones: []\u{0}\n`)).toContain("U+0000");
  });

  test("refuses a wrong schema, a non-list zones, and unparseable YAML", () => {
    expect(parseRegister("schema_version: other\nzones: []\n")).toContain("schema_version");
    expect(parseRegister(`${header}zones: none\n`)).toBe("zones is not a list");
    expect(parseRegister("zones: [\n")).toContain("unreadable YAML");
  });

  test("refuses a root key written twice: the parser keeps only the last, loosest one", () => {
    const text =
      `schema_version: ${SCHEMA_VERSION}\nreview_max_age_days: 365\n` +
      "review_max_age_days: 99999\nzones: []\n";
    expect(parseRegister(text)).toContain("written twice");
    expect(parseRegister(text)).toContain("review_max_age_days");
  });

  test("refuses a zone key written twice", () => {
    const text =
      `${header}zones:\n  - id: off-code.a\n    reviewed_on: 2019-01-01\n` +
      "    reviewed_on: 2026-11-01\n";
    expect(parseRegister(text)).toContain("written twice");
    expect(parseRegister(text)).toContain("reviewed_on");
  });

  test("refuses a key written outside the bare block form the line reading sees", () => {
    for (const text of [
      `${header}"review_max_age_days": 99999\nzones: []\n`,
      `${header}? review_max_age_days\n: 99999\nzones: []\n`,
      `${header}zones: [{id: off-code.a, reviewed_on: 2019-01-01, reviewed_on: 2026-11-01}]\n`,
      `${header}zones:\n  - {id: off-code.a}\n`,
    ]) {
      const register = parseRegister(text);
      expect(typeof register).toBe("string");
    }
  });

  test("the register of this repository parses and holds", async () => {
    const text = await Bun.file(join(import.meta.dir, "..", REGISTER_PATH)).text();
    const register = parseRegister(text);
    if (typeof register === "string") throw new Error(register);
    expect(check(register.zones, register.threshold, TODAY).violations).toEqual([]);
  });
});
