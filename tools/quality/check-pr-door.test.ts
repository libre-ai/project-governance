import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateDoor,
  isIsoCalendarDate,
  judgeOrigin,
  readPullRequestEvent,
  stripNonDeclarations,
} from "./check-pr-door";

// The Door cases below carry a valid Origin line, so each verdict is the Door
// verdict alone: without it every Door case would fail on the missing Origin,
// and a broken Door rule would hide behind that failure.
const VALID_ORIGIN = "Origin: proposal";
const okOf = (body: string): boolean =>
  evaluateDoor(`${body}\n${VALID_ORIGIN}\n`).outcome === "pass";
// The converse for the Origin cases: a valid Door line, the Origin line under test.
const originOk = (originBody: string, author: string | null = null): boolean =>
  evaluateDoor(`Door: two-way\n${originBody}\n`, "d", author).outcome === "pass";

describe("evaluateDoor", () => {
  test("a two-way door passes alone", () => {
    expect(okOf("## Summary\nA fix.\n\nDoor: two-way\n")).toBe(true);
  });

  test("a one-way door with a substantive second instrument passes", () => {
    expect(
      okOf(
        "Door: one-way\nSecond-instrument: git ls-remote over the 29 repositories, 0 references left\n",
      ),
    ).toBe(true);
  });

  test("a description without a Door line fails", () => {
    const report = evaluateDoor("## Summary\nA fix.\n");
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("no `Door: one-way` or `Door: two-way` line");
  });

  test("an empty description fails", () => {
    expect(okOf("")).toBe(false);
  });

  test("the unfilled template line fails", () => {
    expect(okOf("Door: one-way | two-way\n")).toBe(false);
  });

  test.each([
    "Door: maybe",
    "Door: Two-Way",
    "Door: two-way, mostly",
    "Door:",
  ])("an invalid value fails: %s", (line) => {
    expect(okOf(`${line}\n`)).toBe(false);
  });

  test("two Door lines fail, even when they agree", () => {
    expect(okOf("Door: two-way\nDoor: two-way\n")).toBe(false);
  });

  test("a one-way door without a second instrument fails", () => {
    const report = evaluateDoor("Door: one-way\n");
    expect(report.violations.join("\n")).toContain("needs a `Second-instrument:` line");
  });

  test.each([
    "",
    "<instrument and result>",
    "n/a",
    "none",
    "TBD",
    "-",
    "short one",
  ])("a one-way door with a placeholder second instrument fails: %p", (value) => {
    expect(okOf(`Door: one-way\nSecond-instrument: ${value}\n`)).toBe(false);
  });

  test("a Door line inside an HTML comment does not count", () => {
    expect(okOf("<!--\nDoor: two-way\n-->\n")).toBe(false);
  });

  test("a Door line inside a fenced code block does not count", () => {
    expect(okOf("```\nDoor: two-way\n```\n")).toBe(false);
  });

  test("a Door line after a closed code block counts", () => {
    expect(okOf("```sh\nbun run check\n```\n\nDoor: two-way\n")).toBe(true);
  });

  test("a Door line not at the start of its line does not count", () => {
    expect(okOf("We think Door: two-way\n")).toBe(false);
  });

  test("CRLF line endings are read", () => {
    expect(okOf("Summary\r\nDoor: two-way\r\n")).toBe(true);
  });

  test("the volume names lines, removed blocks and the three declaration counts", () => {
    const report = evaluateDoor(
      "<!-- guidance -->\nDoor: one-way\nSecond-instrument: none\nOrigin: proposal\n",
    );
    expect(report.volumeSummary).toBe(
      "5 description line(s) examined after removing 1 comment/code block(s); 1 Door line(s), 1 Second-instrument line(s), 1 Origin line(s)",
    );
  });

  // 2026-10-14: Door declaration became required; Dependabot writes its own
  // descriptions, and a version bump is two-way by construction.
  test("an undeclared pull request from an implicit two-way author passes, and says why", () => {
    const report = evaluateDoor("Bumps x from 1 to 2.", "PR #9 description", "dependabot[bot]");
    expect(report.outcome).toBe("pass");
    expect(report.checks[0]?.note).toBe(
      "Door: two-way (implicit: no Door line, author dependabot[bot] is in IMPLICIT_TWO_WAY_AUTHORS)",
    );
    expect(report.volumeSummary).toContain("door implied by author dependabot[bot]");
  });

  test("an undeclared pull request from any other author still fails", () => {
    for (const author of [null, "constantin-jais", "dependabot", "renovate[bot]"]) {
      expect(evaluateDoor("Bumps x.", "d", author).outcome).toBe("violations");
    }
  });

  test("a Door line written by an implicit two-way author is judged as written", () => {
    expect(evaluateDoor("Door: one-way", "d", "dependabot[bot]").outcome).toBe("violations");
    expect(evaluateDoor("Door: sideways", "d", "dependabot[bot]").outcome).toBe("violations");
  });
});

// ADR-0056 D1: every pull request declares the origin of the problem it treats.
describe("evaluateDoor — Origin", () => {
  test.each([
    "Origin: inspection",
    "Origin: synthetic",
    "Origin: proposal",
    "Origin: observed 2026-10-07 libre-ai/project-governance#135",
    "Origin: observed 2026-10-07 tools/quality/check-pr-door.ts:61",
    "Origin: observed 2026-10-07 session note of the fleet-pins drill",
    "Origin: observed 2026-10-07 <https://github.com/libre-ai/project-governance/pull/135>",
    "Origin: observed 2024-02-29 #12",
    "  Origin: proposal",
  ])("a valid Origin line passes: %s", (line) => {
    expect(originOk(line)).toBe(true);
  });

  test("the passing verdict restates the declared origin", () => {
    const report = evaluateDoor("Door: two-way\nOrigin: observed 2026-10-07 PR #135\n", "d");
    expect(report.checks.find((check) => check.item === "d — Origin")?.note).toBe(
      "Origin: observed 2026-10-07 PR #135",
    );
  });

  test("a description without an Origin line fails, and names the vocabulary", () => {
    const report = evaluateDoor("Door: two-way\n", "d");
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("d — Origin: no `Origin:` line");
    expect(report.violations.join("\n")).toContain(
      '"observed", "inspection", "synthetic", "proposal"',
    );
  });

  test("two Origin lines fail, even when they agree", () => {
    expect(originOk("Origin: proposal\nOrigin: proposal")).toBe(false);
    expect(
      evaluateDoor("Door: two-way\nOrigin: proposal\nOrigin: inspection\n").violations,
    ).toEqual([
      'pull request description — Origin: 2 Origin lines ("proposal", "inspection") — declare exactly one',
    ]);
  });

  test.each([
    "Origin:",
    "Origin: maybe",
    "Origin: Proposal",
    "Origin: OBSERVED 2026-10-07 #1",
    "Origin: observation 2026-10-07 #1",
    "Origin: proposal,",
  ])("a value outside the vocabulary fails: %s", (line) => {
    expect(originOk(line)).toBe(false);
  });

  test("the unfilled template line fails", () => {
    expect(originOk("Origin: observed | inspection | synthetic | proposal")).toBe(false);
  });

  test("an empty Origin line is refused as carrying no value", () => {
    const report = evaluateDoor("Door: two-way\nOrigin:   \n");
    expect(report.violations.join("\n")).toContain("Origin line carries no value");
  });

  test.each([
    "Origin: proposal mostly",
    "Origin: inspection of check-fleet-pins",
    "Origin: synthetic probe",
    "Origin: proposal 2026-10-07 #1",
  ])("a value other than observed carries nothing else on its line: %s", (line) => {
    const report = evaluateDoor(`Door: two-way\n${line}\n`);
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("carries nothing else on its line");
  });

  test("observed without a date fails, and says what it needs", () => {
    const report = evaluateDoor("Door: two-way\nOrigin: observed\n");
    expect(report.violations.join("\n")).toContain("observed needs its date and its source");
  });

  test.each([
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-10-00",
    "2026-10-7",
    "20261007",
    "07/10/2026",
    "2026-10-07T12:00:00Z",
    "yesterday",
  ])("observed with an invalid ISO date fails: %s", (date) => {
    const report = evaluateDoor(`Door: two-way\nOrigin: observed ${date} PR #135\n`);
    expect(report.violations.join("\n")).toContain(
      `observed date "${date}" is not a valid ISO 8601 calendar date`,
    );
  });

  test("observed with a date but no source fails", () => {
    const report = evaluateDoor("Door: two-way\nOrigin: observed 2026-10-07\n");
    expect(report.violations.join("\n")).toContain("needs a source after its date");
  });

  test.each([
    "<source>",
    "n/a",
    "none",
    "TBD",
    "-",
    "...",
  ])("observed with a placeholder source fails: %p", (source) => {
    const report = evaluateDoor(`Door: two-way\nOrigin: observed 2026-10-07 ${source}\n`);
    expect(report.violations.join("\n")).toContain("is a placeholder");
  });

  test("an Origin line inside an HTML comment does not count", () => {
    expect(originOk("<!--\nOrigin: proposal\n-->")).toBe(false);
  });

  test("an Origin line inside a fenced code block does not count", () => {
    expect(originOk("```\nOrigin: proposal\n```")).toBe(false);
  });

  test("an Origin line not at the start of its line does not count", () => {
    expect(originOk("We think Origin: proposal")).toBe(false);
  });

  test("the key is case-sensitive, as Door's is", () => {
    expect(originOk("origin: proposal")).toBe(false);
    expect(okOf("door: two-way")).toBe(false);
  });

  test("an implicit two-way author writing no Origin line is waived, and says so", () => {
    const report = evaluateDoor("Bumps x from 1 to 2.", "PR #9 description", "dependabot[bot]");
    expect(report.outcome).toBe("pass");
    expect(report.checks.find((check) => check.item === "PR #9 description — Origin")?.note).toBe(
      "Origin: waived (no Origin line, author dependabot[bot] is in IMPLICIT_TWO_WAY_AUTHORS)",
    );
    expect(report.volumeSummary).toContain("origin waived for author dependabot[bot]");
  });

  test("an undeclared Origin from any other author still fails", () => {
    for (const author of [null, "constantin-jais", "dependabot", "renovate[bot]"]) {
      expect(originOk("", author)).toBe(false);
    }
  });

  test("an Origin line written by an implicit two-way author is judged as written", () => {
    expect(originOk("Origin: maybe", "dependabot[bot]")).toBe(false);
    expect(originOk("Origin: observed 2026-02-30 #1", "dependabot[bot]")).toBe(false);
    expect(originOk("Origin: proposal", "dependabot[bot]")).toBe(true);
  });

  test("a Door line by an implicit author does not waive the Origin check, nor the reverse", () => {
    // Door written, Origin absent: the door is judged, the origin is waived.
    expect(evaluateDoor("Door: two-way", "d", "dependabot[bot]").outcome).toBe("pass");
    // Origin written and invalid, Door absent: the door is implied, the origin still fails.
    expect(evaluateDoor("Origin: maybe", "d", "dependabot[bot]").outcome).toBe("violations");
  });
});

describe("judgeOrigin", () => {
  test("returns the parts of an observed declaration", () => {
    expect(judgeOrigin(" observed  2026-10-07   PR #135 ")).toEqual({
      ok: true,
      value: "observed",
      date: "2026-10-07",
      source: "PR #135",
    });
  });

  test("returns no date and no source for the other values", () => {
    expect(judgeOrigin("synthetic")).toEqual({
      ok: true,
      value: "synthetic",
      date: null,
      source: null,
    });
  });
});

describe("isIsoCalendarDate", () => {
  test.each([
    ["2026-10-07", true],
    ["2024-02-29", true],
    ["2000-02-29", true],
    ["0099-12-31", true],
    ["1900-02-29", false],
    ["2026-04-31", false],
    ["2026-10-07 ", false],
  ])("%p is %p", (value, expected) => {
    expect(isIsoCalendarDate(value)).toBe(expected);
  });
});

describe("stripNonDeclarations", () => {
  test("keeps the line count stable so the rest of the body is untouched", () => {
    const { text, removedBlocks } = stripNonDeclarations("a\n<!--\nb\n-->\nc\n");
    expect(text.split("\n")).toEqual(["a", "", "", "", "c", ""]);
    expect(removedBlocks).toBe(1);
  });

  test("an unclosed comment swallows the rest, never leaks a declaration", () => {
    expect(stripNonDeclarations("<!-- Door: two-way").text).not.toContain("Door");
  });
});

describe("readPullRequestEvent", () => {
  test("reads number and body", () => {
    expect(readPullRequestEvent('{"pull_request":{"number":7,"body":"Door: two-way"}}')).toEqual({
      ok: true,
      number: 7,
      body: "Door: two-way",
      author: null,
    });
  });

  test("reads the author login", () => {
    const read = readPullRequestEvent(
      '{"pull_request":{"number":7,"body":"","user":{"login":"dependabot[bot]"}}}',
    );
    expect(read).toEqual({ ok: true, number: 7, body: "", author: "dependabot[bot]" });
  });

  test("a null body reads as empty, then fails the door check", () => {
    const read = readPullRequestEvent('{"pull_request":{"number":7,"body":null}}');
    expect(read).toEqual({ ok: true, number: 7, body: "", author: null });
  });

  test.each([
    "not json",
    "{}",
    '{"pull_request":null}',
    '{"pull_request":{"body":3}}',
  ])("an unreadable payload is a failure, never an empty body: %s", (payload) => {
    expect(readPullRequestEvent(payload).ok).toBe(false);
  });
});

describe("CLI", () => {
  const script = `${import.meta.dir}/check-pr-door.ts`;
  const run = (env: Record<string, string>) => {
    const result = Bun.spawnSync(["bun", script], {
      stdout: "pipe",
      stderr: "pipe",
      // A clean environment: a CI run already carries GITHUB_EVENT_* for its
      // own event, which would make this probe measure the ambient run.
      env: { PATH: process.env.PATH ?? "", ...env },
    });
    return {
      exitCode: result.exitCode,
      output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
    };
  };
  const eventFile = (payload: string): string => {
    const path = join(mkdtempSync(join(tmpdir(), "pr-door-")), "event.json");
    writeFileSync(path, payload);
    return path;
  };

  test("outside a pull_request run it declares it judged nothing", () => {
    const result = run({ GITHUB_EVENT_NAME: "push" });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("verified nothing, as declared");
  });

  test("a pull_request run without an event path fails", () => {
    expect(run({ GITHUB_EVENT_NAME: "pull_request" }).exitCode).toBe(1);
  });

  test("a pull_request run with a missing event file fails", () => {
    const result = run({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: "/nonexistent/event.json",
    });
    expect(result.exitCode).toBe(1);
  });

  test("a description without Door fails; with Door it passes and prints its volume", () => {
    const missing = run({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventFile('{"pull_request":{"number":3,"body":"A fix."}}'),
    });
    expect(missing.exitCode).toBe(1);
    expect(missing.output).toContain("PR #3 description — Door");

    const declared = run({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventFile(
        '{"pull_request":{"number":3,"body":"A fix.\\nDoor: two-way\\nOrigin: proposal"}}',
      ),
    });
    expect(declared.exitCode).toBe(0);
    expect(declared.output).toContain("3 description line(s) examined");
    expect(declared.output).toContain("1 Origin line(s)");
  });

  test("a description with Door but without Origin fails end to end, naming Origin", () => {
    const result = run({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventFile('{"pull_request":{"number":5,"body":"A fix.\\nDoor: two-way"}}'),
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("PR #5 description — Origin: no `Origin:` line");
  });

  test("an undeclared Dependabot pull request passes end to end", () => {
    const bot = run({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventFile(
        '{"pull_request":{"number":4,"body":"Bumps x.","user":{"login":"dependabot[bot]"}}}',
      ),
    });
    expect(bot.exitCode).toBe(0);
    expect(bot.output).toContain("door implied by author dependabot[bot]");
  });
});
