import { describe, expect, test } from "bun:test";
import { GateReport, renderGateReport } from "./gate-report";

// The defect this module closes: a gate that inspects nothing exits 0 and reads
// as verified. It happened twice here — `check-migration-drift` (K4 AUTH-05)
// skipped every remaining path, and `check-specification-lock` emptied its own
// application list once `docs/apps/` left this repository (ADR-0020 dispatch).

describe("GateReport", () => {
  test("derives violations from the failed checks, never from a second list", () => {
    const report = new GateReport()
      .check("docs/apps/orchestrator.md", true, "13 sections present")
      .check("docs/apps/harness.md", false, "missing section Evidence");

    expect(report.asserted).toBe(2);
    expect(report.violations).toEqual(["docs/apps/harness.md: missing section Evidence"]);
    expect(report.outcome).toBe("violations");
  });

  test("keeps the evidence of what passed, not only of what failed", () => {
    const report = new GateReport().check("ecosystem/FORGOTTEN.yaml", true, "12 entries, uncited");

    expect(report.checks).toEqual([
      { item: "ecosystem/FORGOTTEN.yaml", ok: true, note: "12 entries, uncited" },
    ]);
    expect(report.outcome).toBe("pass");
  });

  test("asserting nothing is a failure, not a pass", () => {
    expect(new GateReport().outcome).toBe("empty");
  });

  test("asserting nothing is a pass only when the gate declares why", () => {
    const report = new GateReport().allowEmpty("no application specification lives in this repo");

    expect(report.outcome).toBe("pass");
    expect(report.emptyReason).toBe("no application specification lives in this repo");
  });

  test("a declared-empty gate still fails once a real check fails", () => {
    const report = new GateReport()
      .allowEmpty("nothing to inspect when the register is absent")
      .check("ecosystem/migration-index.v1.yaml", false, "entry without destination");

    expect(report.outcome).toBe("violations");
  });
});

describe("renderGateReport", () => {
  test("a passing gate states how many assertions hold", () => {
    const report = new GateReport().check("a", true, "ok").check("b", true, "ok");
    const rendered = renderGateReport("Specification lock", report);

    expect(rendered.ok).toBe(true);
    expect(rendered.lines).toEqual(["Specification lock verified: 2 assertion(s) hold"]);
  });

  test("verbose mode expands the evidence behind a green verdict", () => {
    const report = new GateReport().check("docs/apps/missions.md", true, "13 sections present");
    const rendered = renderGateReport("Specification lock", report, true);

    expect(rendered.lines).toEqual([
      "Specification lock verified: 1 assertion(s) hold",
      "  docs/apps/missions.md — 13 sections present",
    ]);
  });

  test("a failing gate prints every failed check and its count", () => {
    const report = new GateReport()
      .check("a", true, "ok")
      .check("b", false, "missing section Evidence");
    const rendered = renderGateReport("Specification lock", report);

    expect(rendered.ok).toBe(false);
    expect(rendered.lines).toEqual([
      "Specification lock: b: missing section Evidence",
      "Specification lock failed: 1 of 2 assertion(s) did not hold.",
    ]);
  });

  test("an empty gate fails and says its green result carried no evidence", () => {
    const rendered = renderGateReport("Migration drift", new GateReport());

    expect(rendered.ok).toBe(false);
    expect(rendered.lines).toHaveLength(1);
    expect(rendered.lines[0]).toContain("asserted nothing");
    expect(rendered.lines[0]).toContain("allowEmpty(reason)");
  });

  test("a declared-empty gate passes and prints the declared reason", () => {
    const report = new GateReport().allowEmpty("no docs/apps in this repository");
    const rendered = renderGateReport("Specification lock", report);

    expect(rendered.ok).toBe(true);
    expect(rendered.lines).toEqual([
      "Specification lock verified nothing, as declared: no docs/apps in this repository",
    ]);
  });
});
