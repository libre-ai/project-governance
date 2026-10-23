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

// The clock of every verdict below: evaluateDoor never reads one itself.
const NOW = new Date("2026-10-23T12:00:00Z");
const evaluate = (
  body: string,
  label = "pull request description",
  author: string | null = null,
  now: Date = NOW,
) => evaluateDoor(body, label, author, now);

// The Door cases below carry a valid Origin line, so each verdict is the Door
// verdict alone: without it every Door case would fail on the missing Origin,
// and a broken Door rule would hide behind that failure. It comes first,
// followed by a blank line, so the case under test starts a block of its own.
const VALID_ORIGIN = "Origin: proposal";
const okOf = (body: string): boolean => evaluate(`${VALID_ORIGIN}\n\n${body}`).outcome === "pass";
// The converse for the Origin cases: a valid Door line, the Origin line under test.
const originOk = (originBody: string, author: string | null = null): boolean =>
  evaluate(`Door: two-way\n${originBody}\n`, "d", author).outcome === "pass";

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
    const report = evaluate("## Summary\nA fix.\n");
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
    const report = evaluate("Door: one-way\n");
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

  test("CRLF and CR line endings are read", () => {
    expect(okOf("Summary\r\n\r\nDoor: two-way\r\n")).toBe(true);
    expect(okOf("Summary\r\rDoor: two-way\r")).toBe(true);
  });

  // 2026-10-14: Door declaration became required; Dependabot writes its own
  // descriptions, and a version bump is two-way by construction.
  test("an undeclared pull request from an implicit two-way author passes, and says why", () => {
    const report = evaluate("Bumps x from 1 to 2.", "PR #9 description", "dependabot[bot]");
    expect(report.outcome).toBe("pass");
    expect(report.checks[0]?.note).toBe(
      "Door: two-way (implicit: no Door line, author dependabot[bot] is in IMPLICIT_TWO_WAY_AUTHORS)",
    );
    expect(report.volumeSummary).toContain("door implied by author dependabot[bot]");
  });

  test("an undeclared pull request from any other author still fails", () => {
    for (const author of [null, "constantin-jais", "dependabot", "renovate[bot]"]) {
      expect(evaluate("Bumps x.", "d", author).outcome).toBe("violations");
    }
  });

  test("a Door line written by an implicit two-way author is judged as written", () => {
    expect(evaluate("Door: one-way", "d", "dependabot[bot]").outcome).toBe("violations");
    expect(evaluate("Door: sideways", "d", "dependabot[bot]").outcome).toBe("violations");
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
    const report = evaluate("Door: two-way\nOrigin: observed 2026-10-07 PR #135\n", "d");
    expect(report.checks.find((check) => check.item === "d — Origin")?.note).toBe(
      "Origin: observed 2026-10-07 PR #135",
    );
  });

  test("a description without an Origin line fails, and names the vocabulary", () => {
    const report = evaluate("Door: two-way\n", "d");
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("d — Origin: no `Origin:` line");
    expect(report.violations.join("\n")).toContain(
      '"observed", "inspection", "synthetic", "proposal"',
    );
  });

  test("two Origin lines fail, even when they agree", () => {
    expect(originOk("Origin: proposal\nOrigin: proposal")).toBe(false);
    expect(evaluate("Door: two-way\nOrigin: proposal\nOrigin: inspection\n").violations).toEqual([
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
    const report = evaluate("Door: two-way\nOrigin:   \n");
    expect(report.violations.join("\n")).toContain("Origin line carries no value");
  });

  test.each([
    "Origin: proposal mostly",
    "Origin: inspection of check-fleet-pins",
    "Origin: synthetic probe",
    "Origin: proposal 2026-10-07 #1",
  ])("a value other than observed carries nothing else on its line: %s", (line) => {
    const report = evaluate(`Door: two-way\n${line}\n`);
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("carries nothing else on its line");
  });

  test("observed without a date fails, and says what it needs", () => {
    const report = evaluate("Door: two-way\nOrigin: observed\n");
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
    const report = evaluate(`Door: two-way\nOrigin: observed ${date} PR #135\n`);
    expect(report.violations.join("\n")).toContain(
      `observed date "${date}" is not a valid ISO 8601 calendar date`,
    );
  });

  test("observed with a date but no source fails", () => {
    const report = evaluate("Door: two-way\nOrigin: observed 2026-10-07\n");
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
    const report = evaluate(`Door: two-way\nOrigin: observed 2026-10-07 ${source}\n`);
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
    const report = evaluate("Bumps x from 1 to 2.", "PR #9 description", "dependabot[bot]");
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
    expect(evaluate("Door: two-way", "d", "dependabot[bot]").outcome).toBe("pass");
    // Origin written and invalid, Door absent: the door is implied, the origin still fails.
    expect(evaluate("Origin: maybe", "d", "dependabot[bot]").outcome).toBe("violations");
  });
});

// Review of #141 (2026-10-23, separate role): each case below was a probe that
// passed the gate while GitHub renders something else, or not at all.
const verdict = (body: string, author: string | null = null) =>
  evaluateDoor(body, "d", author, NOW);
const passes = (body: string): boolean => verdict(body).outcome === "pass";

describe("finding 1 — an observed source must be visible", () => {
  test.each([
    "​",
    "&#8203;",
    "&nbsp;",
    "<b></b>",
    "<b>​</b>",
    "``",
    "?",
    "⁠⁠",
    "<https://>",
    "<http://>",
  ])("a source with no visible letter or digit fails: %p", (source) => {
    const report = verdict(`Door: two-way\nOrigin: observed 2026-10-07 ${source}\n`);
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("no letter or digit");
  });

  test.each([
    "<https://github.com/libre-ai/project-governance/pull/135>",
    "#7",
    "a.ts:3",
    "note de session Ω",
    "<b>PR #135</b>",
  ])("a visible source passes: %p", (source) => {
    expect(passes(`Door: two-way\nOrigin: observed 2026-10-07 ${source}\n`)).toBe(true);
  });
});

describe("finding 2 — indented code and CommonMark fences", () => {
  test.each([
    ["four spaces", "Door: two-way\n\n    Origin: proposal\n"],
    ["a tab", "Door: two-way\n\n\tOrigin: proposal\n"],
    ["a space then a tab", "Door: two-way\n\n \tOrigin: proposal\n"],
  ])("an indented Origin line is never a declaration (%s)", (_name, body) => {
    const report = verdict(body);
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("indented");
  });

  test("an indented Door line, and an indented Second-instrument, are never declarations", () => {
    expect(passes("Origin: proposal\n\n    Door: two-way\n")).toBe(false);
    expect(
      passes(
        "Origin: proposal\n\nDoor: one-way\n    Second-instrument: git ls-remote over 25 repositories, 0 hits\n",
      ),
    ).toBe(false);
  });

  test("three spaces of indentation still declare", () => {
    expect(passes("   Door: two-way\n   Origin: proposal\n")).toBe(true);
  });

  test("a shorter run inside a longer fence does not close it", () => {
    expect(passes("Door: two-way\n\n````\n```\nOrigin: proposal\n````\n")).toBe(false);
  });

  test("a run followed by text does not close a fence", () => {
    expect(passes("Door: two-way\n\n```\n``` not-a-close\nOrigin: proposal\n")).toBe(false);
  });

  test("a tilde run does not close a backtick fence", () => {
    expect(passes("Door: two-way\n\n```\n~~~\nOrigin: proposal\n")).toBe(false);
  });

  test("a closing run at least as long as the opening one closes the fence", () => {
    expect(passes("~~~~\nx\n~~~\n~~~~~  \n\nDoor: two-way\nOrigin: proposal\n")).toBe(true);
  });

  test("a backtick run whose info string carries a backtick is inline code, not a fence", () => {
    expect(passes("```x```\n\nDoor: two-way\nOrigin: proposal\n")).toBe(true);
  });

  test("a closing run indented four spaces does not close the fence", () => {
    expect(passes("Door: two-way\n\n```\n    ```\nOrigin: proposal\n")).toBe(false);
  });

  test("an indented key line does not open a chain", () => {
    const report = verdict("Origin: proposal\n\n    Door: two-way\nSecond-instrument: none\n");
    expect(report.volumeSummary).toContain("0 Second-instrument line(s)");
  });

  test("a fence indented four spaces is not a fence", () => {
    expect(passes("    ```\n\nDoor: two-way\nOrigin: proposal\n")).toBe(true);
  });
});

describe("finding 3 — the short comments <!--> and <!---> are complete", () => {
  test.each(["<!-->", "<!--->"])("%s does not swallow the lines up to the next -->", (short) => {
    const report = verdict(
      `Door: two-way\nOrigin: proposal\n${short}\nOrigin: observed 2026-10-07\n<!-- -->\n`,
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("2 Origin lines");
  });

  test("<!----> is a complete comment too", () => {
    expect(passes("<!---->\nDoor: two-way\nOrigin: proposal\n")).toBe(true);
  });
});

describe("finding 4 — lines are CommonMark lines, and a declaration starts a block", () => {
  test("U+2028 and U+2029 do not end a line", () => {
    expect(passes("Door: two-way\n\n<code>x Origin: proposal y</code>\n")).toBe(false);
  });

  test("a declaration line carrying U+2028 is still one line, read as GitHub shows it", () => {
    expect(passes("Door: two-way \nOrigin: proposal\n")).toBe(true);
    expect(passes("Door: two-way\nOrigin: proposal observed 2026-10-07 x\n")).toBe(false);
  });

  test("a prose line breaks a chain", () => {
    const report = verdict("Door: two-way\nprose\nOrigin: proposal\n");
    expect(report.volumeSummary).toContain("0 Origin line(s)");
  });

  test("a key line that continues a paragraph does not open a chain either", () => {
    const report = verdict("Summary\nDoor: two-way\nOrigin: proposal\n");
    expect(report.volumeSummary).toContain("0 Door line(s)");
    expect(report.volumeSummary).toContain("0 Origin line(s)");
    expect(report.volumeSummary).toContain("2 key line(s) not read");
  });

  test("a Door line inside a multi-line HTML attribute does not count", () => {
    // GitHub renders `Door: one-way`; the attribute is a tooltip.
    const report = verdict(
      'Origin: proposal\n\n<span title="\nDoor: two-way\n">Door: one-way</span>\n',
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("continues the line above");
  });

  test("a Door line inside a multi-line link title does not count", () => {
    expect(passes('Origin: proposal\n\n[i](https://example.org "tip\nDoor: two-way\n")\n')).toBe(
      false,
    );
  });

  test("a declaration that continues a paragraph is not read, and the refusal says why", () => {
    const report = verdict("Summary\nDoor: two-way\n\nOrigin: proposal\n");
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("line 2 continues the line above");
  });

  test("declaration lines chain: after a blank line, the body start, or another declaration", () => {
    expect(passes("Door: two-way\nOrigin: proposal\n")).toBe(true);
    expect(
      passes(
        "Summary.\n\nOwner-arbitration: 2026-10-23 chat\nNot-added: dependency\nDoor: one-way\nSecond-instrument: git ls-remote over 25 repositories, 0 hits\nOrigin: proposal\n",
      ),
    ).toBe(true);
  });

  test("a line left blank by a removed comment opens a new block, as in the fleet template", () => {
    expect(
      passes(
        "## Origin\n\n<!--\nguidance\n-->\nOrigin: proposal\n\n<!--\nDoor guidance\n-->\nDoor: two-way\n",
      ),
    ).toBe(true);
  });
});

describe("finding 4 — the fleet template shape, one-way", () => {
  test("a Second-instrument copied out of its comment, right after it, is read", () => {
    expect(
      passes(
        "Origin: proposal\n\n<!--\nDoor guidance\n-->\nDoor: one-way\n\nBlast radius: <!-- who -->\n\n<!--\nOne-way door only\n-->\nSecond-instrument: git ls-remote over 25 repositories, 0 hits\n",
      ),
    ).toBe(true);
  });
});

describe("finding 5 — an observed date is neither in the future nor before 1970", () => {
  test.each(["2999-12-31", "2026-10-25", "0000-01-01", "1969-12-31"])("%s is refused", (date) => {
    const report = verdict(`Door: two-way\nOrigin: observed ${date} PR #135\n`);
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toMatch(/is after .* \+ 1 day|is before 1970-01-01/);
  });

  test.each(["2026-10-24", "2026-10-23", "1970-01-01"])("%s is admitted", (date) => {
    expect(passes(`Door: two-way\nOrigin: observed ${date} PR #135\n`)).toBe(true);
  });

  test("the clock is injected: the same date judged at another instant", () => {
    const body = "Door: two-way\nOrigin: observed 2026-10-25 PR #135\n";
    expect(evaluateDoor(body, "d", null, new Date("2026-10-24T00:00:00Z")).outcome).toBe("pass");
    expect(evaluateDoor(body, "d", null, new Date("2026-10-23T23:59:59Z")).outcome).toBe(
      "violations",
    );
  });
});

describe("finding 6 — the line counters sum to the body", () => {
  test("examined + removed = lines of the body, printed as such", () => {
    const report = verdict(
      "<!-- guidance -->\nDoor: one-way\nSecond-instrument: none\nOrigin: proposal\n",
    );
    expect(report.volumeSummary).toBe(
      "5 description line(s) = 4 examined + 1 removed in 1 comment/code block(s); 1 Door line(s), 1 Second-instrument line(s), 1 Origin line(s); 0 key line(s) not read",
    );
  });

  test.each([
    "",
    "a",
    "a\n<!--\nb\n-->\nc\n",
    "```\nx\n\n```\ny <!-- z --> w\n<!-- open",
    "    Door: two-way\nSummary\nDoor: two-way\n",
  ])("the partition holds for %p", (body) => {
    const summary = verdict(body).volumeSummary ?? "";
    const counts = /^(\d+) description line\(s\) = (\d+) examined \+ (\d+) removed/.exec(summary);
    expect(counts).not.toBeNull();
    const [total, examined, removed] = (counts ?? []).slice(1).map(Number);
    expect((examined ?? -1) + (removed ?? -1)).toBe(total ?? -2);
    expect(total).toBe(body === "" ? 0 : body.replace(/\r\n?/g, "\n").split("\n").length);
  });
});

describe("judgeOrigin", () => {
  test("returns the parts of an observed declaration", () => {
    expect(judgeOrigin(" observed  2026-10-07   PR #135 ", NOW)).toEqual({
      ok: true,
      value: "observed",
      date: "2026-10-07",
      source: "PR #135",
    });
  });

  test("returns no date and no source for the other values", () => {
    expect(judgeOrigin("synthetic", NOW)).toEqual({
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

  test("counts the lines it emptied, not the lines it shortened or the blank ones", () => {
    const stripped = stripNonDeclarations("a <!-- x --> b\n<!-- y -->\n\n```\n\n```\n");
    expect(stripped.lines).toEqual(["a  b", "", "", "", "", "", ""]);
    expect(stripped.removedLines).toBe(4);
    expect(stripped.removedBlocks).toBe(3);
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
        '{"pull_request":{"number":3,"body":"A fix.\\n\\nDoor: two-way\\nOrigin: proposal"}}',
      ),
    });
    expect(declared.exitCode).toBe(0);
    expect(declared.output).toContain("4 description line(s) = 4 examined + 0 removed");
    expect(declared.output).toContain("1 Origin line(s)");
  });

  test("the command reads the clock: an observed date far in the future fails end to end", () => {
    const result = run({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventFile(
        '{"pull_request":{"number":6,"body":"Door: two-way\\nOrigin: observed 2999-12-31 PR #1"}}',
      ),
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('observed date "2999-12-31" is after');
  });

  test("a description with Door but without Origin fails end to end, naming Origin", () => {
    const result = run({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventFile(
        '{"pull_request":{"number":5,"body":"A fix.\\n\\nDoor: two-way"}}',
      ),
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
