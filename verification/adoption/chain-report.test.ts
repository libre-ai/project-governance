import { describe, expect, test } from "bun:test";
import { parseChainReportFromOutput } from "./chain-report";

/**
 * Positioning L3 — the reference chain prints its JSON report on stdout, but
 * its sub-commands inherit that stream and write their own output first. The
 * extractor must therefore recover the LAST valid report from a noisy stream,
 * and reject look-alikes, without ever guessing a digest.
 */

const REPORT = {
  schemaVersion: "libre-ai.reference-chain.v1",
  status: "passed",
  steps: [{ id: "contracts", status: "passed", durationMs: 12 }],
  skipped: [],
  digest: "e".repeat(64),
};

describe("parseChainReportFromOutput", () => {
  test("recovers the report from a stream polluted by sub-command output", () => {
    const stdout = [
      "85 catalog entries verified",
      "some tool printed { not json",
      JSON.stringify(REPORT, null, 2),
      "",
    ].join("\n");
    const report = parseChainReportFromOutput(stdout);
    expect(report?.digest).toBe("e".repeat(64));
    expect(report?.status).toBe("passed");
    expect(report?.skipped).toEqual([]);
  });

  test("takes the last report when several JSON objects appear", () => {
    const earlier = { ...REPORT, digest: "a".repeat(64) };
    const stdout = `${JSON.stringify(earlier, null, 2)}\nnoise\n${JSON.stringify(REPORT, null, 2)}`;
    expect(parseChainReportFromOutput(stdout)?.digest).toBe("e".repeat(64));
  });

  test("returns null when no report is present (recorded as friction upstream)", () => {
    expect(parseChainReportFromOutput("test output only\n42 passed")).toBeNull();
  });

  test("rejects a JSON object with the wrong schema version", () => {
    const impostor = { ...REPORT, schemaVersion: "libre-ai.other.v1" };
    expect(parseChainReportFromOutput(JSON.stringify(impostor, null, 2))).toBeNull();
  });

  test("rejects a report with a malformed digest instead of trusting it", () => {
    const broken = { ...REPORT, digest: "not-a-digest" };
    expect(parseChainReportFromOutput(JSON.stringify(broken, null, 2))).toBeNull();
  });

  test("surfaces the skipped step ids for the friction log", () => {
    const withSkips = {
      ...REPORT,
      status: "passed-with-skips",
      skipped: ["rls", "playwright"],
    };
    const report = parseChainReportFromOutput(JSON.stringify(withSkips, null, 2));
    expect(report?.status).toBe("passed-with-skips");
    expect(report?.skipped).toEqual(["rls", "playwright"]);
  });
});
