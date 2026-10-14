import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateDoor, readPullRequestEvent, stripNonDeclarations } from "./check-pr-door";

const okOf = (body: string): boolean => evaluateDoor(body).outcome === "pass";

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

  test("the volume names lines, removed blocks and both declaration counts", () => {
    const report = evaluateDoor("<!-- guidance -->\nDoor: one-way\nSecond-instrument: none\n");
    expect(report.volumeSummary).toBe(
      "4 description line(s) examined after removing 1 comment/code block(s); 1 Door line(s), 1 Second-instrument line(s)",
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
      GITHUB_EVENT_PATH: eventFile('{"pull_request":{"number":3,"body":"A fix.\\nDoor: two-way"}}'),
    });
    expect(declared.exitCode).toBe(0);
    expect(declared.output).toContain("2 description line(s) examined");
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
