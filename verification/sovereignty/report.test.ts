import { describe, expect, test } from "bun:test";
import { buildFixtureReportInputs } from "./fixtures";
import { buildSovereigntyReport, renderReportJson, renderReportMarkdown } from "./report";

describe("buildSovereigntyReport", () => {
  test("nominal inputs: SOV-02/03 pass, SOV-01 and specified checks pending", () => {
    const report = buildSovereigntyReport(buildFixtureReportInputs());
    const statuses = new Map(report.checks.map((c) => [c.id, c.status]));
    expect(statuses.get("SOV-01")).toBe("pending");
    expect(statuses.get("SOV-02")).toBe("pass");
    expect(statuses.get("SOV-03")).toBe("pass");
    expect(statuses.get("SOV-04")).toBe("pending");
    expect(statuses.get("SOV-05")).toBe("pending");
    expect(statuses.get("SOV-06")).toBe("pending");
    expect(statuses.get("SOV-07")).toBe("pending");
    expect(report.summary).toEqual({ pass: 2, fail: 0, pending: 5 });
    expect(report.checks.map((c) => c.id)).toEqual([
      "SOV-01",
      "SOV-02",
      "SOV-03",
      "SOV-04",
      "SOV-05",
      "SOV-06",
      "SOV-07",
    ]);
  });

  test("a published passing attestation turns SOV-01 into a pass", () => {
    const report = buildSovereigntyReport({
      ...buildFixtureReportInputs(),
      attestation: {
        kind: "present",
        path: "distribution/evidence/adoption/latest.json",
        status: "pass",
      },
    });
    const sov01 = report.checks.find((c) => c.id === "SOV-01");
    expect(sov01?.status).toBe("pass");
  });

  test("a non-passing or unverifiable attestation is a fail, never absorbed", () => {
    const inputs = buildFixtureReportInputs();
    const failing = buildSovereigntyReport({
      ...inputs,
      attestation: {
        kind: "present",
        path: "distribution/evidence/adoption/latest.json",
        status: "fail",
      },
    });
    expect(failing.checks.find((c) => c.id === "SOV-01")?.status).toBe("fail");
    const unreadable = buildSovereigntyReport({
      ...inputs,
      attestation: { kind: "unreadable", detail: "attestation is not valid JSON" },
    });
    expect(unreadable.checks.find((c) => c.id === "SOV-01")?.status).toBe("fail");
  });

  test("a failed restore is reported as SOV-02 fail with its detail", () => {
    const report = buildSovereigntyReport({
      ...buildFixtureReportInputs(),
      restore: { kind: "failed", detail: "git bundle exited 128: fatal", data: null },
    });
    const sov02 = report.checks.find((c) => c.id === "SOV-02");
    expect(sov02?.status).toBe("fail");
    expect(sov02?.reason).toBe("git bundle exited 128: fatal");
    expect(report.summary.fail).toBe(1);
  });

  test("an unparseable lockfile is reported as SOV-03 fail", () => {
    const report = buildSovereigntyReport({
      ...buildFixtureReportInputs(),
      inventory: { error: "bun.lock: top-level value is not an object" },
    });
    expect(report.checks.find((c) => c.id === "SOV-03")?.status).toBe("fail");
  });
});

describe("renderers", () => {
  const report = buildSovereigntyReport(buildFixtureReportInputs());

  test("JSON rendering is deterministic, newline-terminated and round-trips", () => {
    const first = renderReportJson(report);
    const second = renderReportJson(report);
    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(JSON.parse(first)).toEqual(JSON.parse(JSON.stringify(report)));
  });

  test("markdown carries the v0 non-over-claim disclaimer", () => {
    const markdown = renderReportMarkdown(report);
    expect(markdown).toContain("le registre de distribution n'est pas la");
    expect(markdown).toContain("jamais une exposition");
    expect(markdown).toContain("Part non couverte (pending)");
  });

  test("JSON output matches the reviewed golden byte for byte", async () => {
    const golden = await Bun.file(new URL("fixtures/golden-report.json", import.meta.url)).text();
    expect(renderReportJson(report)).toBe(golden);
  });

  test("markdown output matches the reviewed golden byte for byte", async () => {
    const golden = await Bun.file(new URL("fixtures/golden-report.md", import.meta.url)).text();
    expect(renderReportMarkdown(report)).toBe(golden);
  });
});
