import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { check, parseRegister, REGISTER_PATH, SCHEMA_VERSION } from "./check-off-code-zones";

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

  test("the register of this repository parses and holds", async () => {
    const text = await Bun.file(join(import.meta.dir, "..", REGISTER_PATH)).text();
    const register = parseRegister(text);
    if (typeof register === "string") throw new Error(register);
    expect(check(register.zones, register.threshold, TODAY).violations).toEqual([]);
  });
});
