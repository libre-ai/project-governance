import { describe, expect, test } from "bun:test";
import {
  findOpenIssue,
  issueBody,
  issueTitle,
  type OpenIssue,
  previousLoopRun,
  resolutionComment,
  selectMode,
  shouldAlert,
} from "./repeat-failure-alert";

describe("shouldAlert", () => {
  test("alerts when the previous run also failed", () => {
    expect(shouldAlert("failure")).toBe(true);
  });

  test("does not alert on a single failure — no previous run", () => {
    expect(shouldAlert(undefined)).toBe(false);
    expect(shouldAlert(null)).toBe(false);
  });

  test("does not alert when the previous run succeeded", () => {
    expect(shouldAlert("success")).toBe(false);
  });

  test("does not alert on a previous cancelled or skipped run — not the same failure pattern", () => {
    expect(shouldAlert("cancelled")).toBe(false);
    expect(shouldAlert("skipped")).toBe(false);
  });
});

describe("issueTitle", () => {
  test("is stable across calls for the same workflow — dedup depends on this", () => {
    expect(issueTitle("Sovereignty report")).toBe(issueTitle("Sovereignty report"));
  });

  test("differs per workflow — one alert per loop, not one shared bucket", () => {
    expect(issueTitle("Sovereignty report")).not.toBe(issueTitle("Adoption proof"));
  });
});

describe("issueBody", () => {
  test("names both runs when a previous one is known", () => {
    const body = issueBody("Sovereignty report", "https://x/runs/2", "https://x/runs/1");
    expect(body).toContain("https://x/runs/2");
    expect(body).toContain("https://x/runs/1");
  });

  test("omits the previous-run line when none is known, rather than printing 'null'", () => {
    const body = issueBody("Sovereignty report", "https://x/runs/2", null);
    expect(body).not.toContain("null");
    expect(body).toContain("https://x/runs/2");
  });
});

describe("findOpenIssue", () => {
  const issues: OpenIssue[] = [
    { number: 12, title: "Sovereignty report: two consecutive failed runs" },
    { number: 15, title: "Adoption proof: two consecutive failed runs" },
  ];

  test("finds an exact title match", () => {
    expect(findOpenIssue(issues, "Sovereignty report: two consecutive failed runs")).toBe(12);
  });

  test("returns null when no issue has that exact title — never a fuzzy/partial match", () => {
    expect(findOpenIssue(issues, "Sovereignty report")).toBeNull();
    expect(findOpenIssue(issues, "Truth drift: two consecutive failed runs")).toBeNull();
  });

  test("returns null against an empty issue list", () => {
    expect(findOpenIssue([], "anything")).toBeNull();
  });
});

describe("selectMode", () => {
  test("defaults to alerting — the historical, argument-free invocation", () => {
    expect(selectMode([])).toBe("alert");
  });

  test("--resolve selects the closing path", () => {
    expect(selectMode(["--resolve"])).toBe("resolve");
  });

  test("refuses an unknown flag rather than silently alerting", () => {
    expect(() => selectMode(["--close"])).toThrow(/--close/);
  });
});

describe("resolutionComment", () => {
  test("names the loop and the green run that closes the issue", () => {
    const comment = resolutionComment("Org README drift", "https://x/runs/3");
    expect(comment).toContain("Org README drift");
    expect(comment).toContain("https://x/runs/3");
  });
});

describe("previousLoopRun", () => {
  const runs = [
    { conclusion: "failure", url: "https://x/runs/9", event: "pull_request" },
    { conclusion: "success", url: "https://x/runs/8", event: "push" },
    { conclusion: "failure", url: "https://x/runs/7", event: "schedule" },
    { conclusion: "success", url: "https://x/runs/6", event: "schedule" },
  ];

  test("skips push and pull_request runs — a branch failing is not the loop failing", () => {
    expect(previousLoopRun(runs)).toEqual({
      conclusion: "failure",
      url: "https://x/runs/7",
      event: "schedule",
    });
  });

  test("counts a manual dispatch as a loop run — it is the documented re-run path", () => {
    const dispatched = {
      conclusion: "success",
      url: "https://x/runs/5",
      event: "workflow_dispatch",
    };
    expect(previousLoopRun([dispatched])).toEqual(dispatched);
  });

  test("returns null when no loop run exists yet", () => {
    expect(previousLoopRun([])).toBeNull();
    expect(
      previousLoopRun([{ conclusion: "failure", url: "https://x/runs/1", event: "push" }]),
    ).toBeNull();
  });
});
