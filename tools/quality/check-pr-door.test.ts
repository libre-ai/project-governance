import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  constructOpenedBy,
  evaluateDoor,
  isIsoCalendarDate,
  judgeOrigin,
  readDeclarationBlocks,
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
const passes = (body: string, author: string | null = null): boolean =>
  evaluate(body, "d", author).outcome === "pass";
const violations = (body: string, author: string | null = null): string =>
  evaluate(body, "d", author).violations.join("\n");

// Invisible characters are written by code point: a literal one cannot be read in review.
const BOM = String.fromCodePoint(0xfeff);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const WORD_JOINER = String.fromCodePoint(0x2060);
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const HANGUL_FILLERS = [0x115f, 0x1160, 0x3164, 0xffa0].map((code) => String.fromCodePoint(code));

const SPDX =
  "<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->\n<!-- SPDX-License-Identifier: CC-BY-4.0 -->\n";
// The fleet template once the coordinator moves the block to the top (2026-10-24).
const TEMPLATE = (block: string): string =>
  `${SPDX}${block}\n<!--\nguidance…\n\nSecond-instrument: <instrument, what it measured, and its result>\nNot-added: dependency, schema\nOwner-arbitration: YYYY-MM-DD <where>\n-->\n\n## Summary\n`;
// A block with the line(s) under test, the other judged keys valid around them.
const withOrigin = (originLine: string): string => `Door: two-way\n${originLine}\n\nBody.\n`;
const withDoor = (doorLines: string): string => `${doorLines}\nOrigin: proposal\n\nBody.\n`;
const withBoth = (line: string): string => `Door: two-way\n${line}\nOrigin: proposal\n\nBody.\n`;

describe("T1 — the declaration block opens the description", () => {
  test("the fleet template, filled, passes, and the block is a check of its own", () => {
    const report = evaluate(TEMPLATE("Door: two-way\nOrigin: proposal\n"), "d");
    expect(report.outcome).toBe("pass");
    expect(report.checks.find((check) => check.item === "d — declaration block")?.note).toBe(
      "declaration block: lines 3-4",
    );
  });

  test("the fleet template, unfilled, fails on its two placeholders", () => {
    const report = evaluate(
      TEMPLATE(
        "Door: one-way | two-way\nOrigin: observed YYYY-MM-DD <source> | inspection | synthetic | proposal\n",
      ),
    );
    expect(report.outcome).toBe("violations");
    const text = report.violations.join("\n");
    expect(text).toContain('Door value "one-way | two-way" is neither');
    expect(text).toContain(
      "line 4: the Origin value carries '<' that is not a complete http(s) autolink",
    );
  });

  test("the fleet template, one-way, with its Second-instrument in the block, passes", () => {
    expect(
      passes(
        TEMPLATE(
          "Door: one-way\nSecond-instrument: git ls-remote over the 25 repositories, 0 references left\nOrigin: proposal\n",
        ),
      ),
    ).toBe(true);
  });

  test("no header line is needed, and a block that ends the body needs no blank line", () => {
    expect(passes("Door: two-way\nOrigin: proposal")).toBe(true);
    expect(passes("Door: two-way\nOrigin: proposal\n")).toBe(true);
  });

  test("a BOM before the body is removed", () => {
    expect(passes(`${BOM}Door: two-way\nOrigin: proposal\n\nBody.\n`)).toBe(true);
    expect(passes(`${BOM}${SPDX}Door: two-way\nOrigin: proposal\n\nBody.\n`)).toBe(true);
  });

  test("CRLF and CR line endings are read", () => {
    expect(passes("Door: two-way\r\nOrigin: proposal\r\n\r\nBody.\r\n")).toBe(true);
    expect(passes("Door: two-way\rOrigin: proposal\r\rBody.\r")).toBe(true);
  });

  test.each([
    ["a summary first", "## Summary\n\nDoor: two-way\nOrigin: proposal\n", 1],
    ["a blank line before the block", "\nDoor: two-way\nOrigin: proposal\n", 1],
    ["a blank line after the headers", `${SPDX}\nDoor: two-way\nOrigin: proposal\n`, 3],
    ["an indented key", "  Door: two-way\nOrigin: proposal\n", 1],
    ["a lowercase key", "door: two-way\nOrigin: proposal\n", 1],
    ["the short comment <!-->", "<!-->\nDoor: two-way\nOrigin: proposal\n", 1],
    ["the short comment <!--->", "<!--->\nDoor: two-way\nOrigin: proposal\n", 1],
    ["text after a comment", "<!-- a --> x\nDoor: two-way\nOrigin: proposal\n", 1],
    ["two comments on a line", "<!-- a --><!-- b -->\nDoor: two-way\nOrigin: proposal\n", 1],
    [
      "a comment closed before the line ends",
      "<!-- a --> b -->\nDoor: two-way\nOrigin: proposal\n",
      1,
    ],
    ["a comment opened twice", "<!-- a <!-- b -->\nDoor: two-way\nOrigin: proposal\n", 1],
    ["text after <!-->", "<!-->x-->\nDoor: two-way\nOrigin: proposal\n", 1],
    ["text after <!--->", "<!--->x-->\nDoor: two-way\nOrigin: proposal\n", 1],
    ["an indented comment", " <!-- a -->\nDoor: two-way\nOrigin: proposal\n", 1],
    ["a comment closed early by --!>", "<!-- a --!> b -->\nDoor: two-way\nOrigin: proposal\n", 1],
    ["a multi-line comment", "<!--\na\n-->\nDoor: two-way\nOrigin: proposal\n", 1],
  ])("a body that does not open with declarations is refused by name: %s", (_name, body, line) => {
    const text = violations(body);
    expect(text).toContain("declarations must be the first lines of the description");
    expect(text).toContain(
      `line ${line} is the first line that is neither a header comment nor a declaration`,
    );
  });

  test("a key line after a non-opening body is also named outside the block", () => {
    expect(violations("## Summary\n\nDoor: two-way\nOrigin: proposal\n")).toContain(
      "line 3: a `Door:` line outside the declaration block",
    );
  });

  test("the block must end with a blank line", () => {
    expect(violations("Door: two-way\nOrigin: proposal\nSummary\n")).toContain(
      "the declaration block must end with a blank line: line 3 is not a declaration",
    );
    expect(violations("Door: two-way\nOrigin: proposal\n  Second-instrument: x\n")).toContain(
      "line 3 is not a declaration (a declaration starts at column 0)",
    );
  });

  test("a blank line made of spaces ends the block", () => {
    expect(passes("Door: two-way\nOrigin: proposal\n   \nBody.\n")).toBe(true);
  });

  test("<!----> is a complete comment, and a header", () => {
    expect(passes("<!---->\nDoor: two-way\nOrigin: proposal\n")).toBe(true);
  });

  test("an empty description names that it holds nothing", () => {
    expect(violations("")).toContain("the description holds no line after its header comments");
    expect(violations(SPDX)).toContain("the description holds no line after its header comments");
  });
});

describe("T2' — no value opens a construct over the next line", () => {
  test.each([
    ["a closed code span", "Second-instrument: `git ls-remote` over 25 repositories"],
    ["two-backtick code spans", "Second-instrument: ``a`b`` and ``c``"],
    ["a longer run inside a code span", "Second-instrument: ``a```b`` measured"],
    ["refused characters inside a code span", 'Second-instrument: `<details> [ ( " ~~ ]` read'],
    ["an escaped backtick", "Second-instrument: a \\` literal backtick"],
    ["escaped inert punctuation", 'Second-instrument: \\( \\" \\* \\_ escaped'],
    ["parentheses, even unbalanced", "Second-instrument: (see (a) and (b"],
    ["quotes, even odd", 'Second-instrument: the "two" quotes and "one'],
    ["an autolink", "Second-instrument: <https://example.com/x?y=1> and <http://example.org>"],
  ])("admitted: %s", (_name, line) => {
    expect(passes(withBoth(line))).toBe(true);
  });

  // Re-review 4, verbatim: GitHub hides Door, Origin or Second-instrument in
  // a link title or an image alt; each passed ce7248e's successor 109438b.
  const SPDX_LINES =
    "<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->\n<!-- SPDX-License-Identifier: CC-BY-4.0 -->\n";
  test.each([
    [
      "E1",
      `${SPDX_LINES}Not-added: hosted-service [a](https://h.example ')\nDoor: two-way\nOrigin: proposal\nNot-added: (x')\n\n## Summary\n\nBody.\n`,
    ],
    [
      "E2",
      `${SPDX_LINES}Not-added: hosted-service [a](https://h.example\` "x\`)\nDoor: two-way\nOrigin: proposal\nNot-added: (") "\n`,
    ],
    [
      "E3",
      `${SPDX_LINES}Not-added: hosted-service ![x [a](https://h.example "]")\nDoor: two-way\nOrigin: proposal\nNot-added: [b](https://h.example "[") ](https://h.example/i.png)\n`,
    ],
    [
      "E4",
      `${SPDX_LINES}Door: one-way\nNot-added: hosted-service [a](https://h.example ')\nSecond-instrument: none was taken at all here\nNot-added: (x')\nOrigin: proposal\n`,
    ],
    [
      "E5",
      `${SPDX_LINES}Second-instrument: see [the run](https://h.example ')\nDoor: two-way\nOrigin: proposal\nSecond-instrument: (x')\n`,
    ],
    [
      "E6",
      `${SPDX_LINES}Second-instrument: ![x [a](https://h.example "]")\nDoor: two-way\nOrigin: proposal\nSecond-instrument: [b](https://h.example "[") ](https://h.example/i.png)\n`,
    ],
  ])("re-review 4 %s fails: a link or image is refused, and nothing after it is read", (_name, body) => {
    expect(passes(body)).toBe(false);
    expect(violations(body)).toContain("value carries '[' (no link, image, strikethrough or math");
  });

  // What is guaranteed: no link, title, HTML or math can carry text the line
  // does not show (T2'), and only visible letters and digits count toward the
  // minimum (entities, Hangul fillers, shortcodes, U+200B and blanks do not).
  // Other rendering tricks are not modelled.
  test("a Second-instrument cannot reach its minimum length with hidden text", () => {
    for (const value of [
      "n/a [ ](https://h.example 'a long hidden title')",
      "n/a <span title='a long hidden title'></span>",
      "n/a ![a long hidden alt](https://h.example/i.png)",
    ]) {
      expect(passes(withDoor(`Door: one-way\nSecond-instrument: ${value}`))).toBe(false);
    }
    expect(passes(withDoor("Door: one-way\nSecond-instrument: `n/a`"))).toBe(false);
  });

  test.each([
    ["an unclosed code span", "Second-instrument: see `x", "opens a code span"],
    ["a run with no run of its length", "Second-instrument: ``a` b", "opens a code span"],
    ["a run followed only by a longer run", "Second-instrument: `a`` b", "opens a code span"],
    [
      "a run whose only partners are longer runs",
      "Second-instrument: `a``b``",
      "opens a code span",
    ],
    ["an open bracket", "Second-instrument: see [doc", "carries '['"],
    ["a closing bracket", "Second-instrument: doc] here", "carries ']'"],
    ["a link", "Second-instrument: see [doc](https://example.com/a)", "carries '['"],
    ["a reference link", "Second-instrument: see [doc] or [doc][1]", "carries '['"],
    ["an image", "Second-instrument: ![a](https://example.com/i.png)", "carries '['"],
    ["an escaped bracket", "Second-instrument: \\[ not a link", "carries '[' (escaped or not)"],
    ["a strikethrough (S1)", "Second-instrument: ~~gone", "carries '~'"],
    ["a paired strikethrough", "Second-instrument: ~~was~~ is", "carries '~'"],
    ["a single tilde", "Second-instrument: about ~25 repositories", "carries '~'"],
    ["an escaped tilde", "Second-instrument: about \\~25", "carries '~' (escaped or not)"],
    ["an escaped less-than", "Second-instrument: \\<details>", "carries '<' (escaped or not)"],
    ["a tag", "Second-instrument: <b>x</b>", "carries '<'"],
    ["details", "Second-instrument: <details>", "carries '<'"],
    ["a bare less-than", "Second-instrument: a < b", "carries '<'"],
    ["an autolink without host", "Second-instrument: <https://>", "carries '<'"],
    ["an autolink of another scheme", "Second-instrument: <ftp://example.com>", "carries '<'"],
    ["a backtick inside an autolink", "Second-instrument: <https://example.com/`x>", "carries '<'"],
    ["an unclosed autolink", "Second-instrument: <https://example.com", "carries '<'"],
    // Reconstructed from re-review 3: a <details> behind an escaped backtick.
    ["details behind an escaped backtick", "Second-instrument: \\`<details>`", "carries '<'"],
  ])("refused by name: %s", (_name, line, reason) => {
    const text = violations(withBoth(line));
    expect(text).toContain("line 2: the Second-instrument value");
    expect(text).toContain(reason);
  });

  test.each([
    "Owner-arbitration",
    "Not-added",
    "Door",
    "Origin",
  ])("T2 applies to every key: %s", (key) => {
    expect(violations(`${key}: x <b>\n\nBody.\n`)).toContain(
      `line 1: the ${key} value carries '<'`,
    );
  });

  test("probes B1-B3 of review 2 are refused", () => {
    expect(
      passes(
        'Door: two-way\nSecond-instrument: n/a <span title="\nOrigin: proposal\n"\\>x</span>\n',
      ),
    ).toBe(false);
    expect(
      passes(
        'Door: two-way\nSecond-instrument: see [doc](https://example.com "\nOrigin: proposal\n")\n',
      ),
    ).toBe(false);
    expect(passes("Door: two-way\nSecond-instrument: see `x\nOrigin: proposal\n`\n")).toBe(false);
  });

  // Measured by this round's differential: GitHub collapses the Origin line
  // under the <details> of the refused line above it.
  test("a refused line stops the block: nothing after it is read", () => {
    const body = "Door: two-way\nSecond-instrument: \\`<details>`\nOrigin: proposal\n\nBody.\n";
    expect(readDeclarationBlocks(body).values.Origin).toEqual([]);
    expect(readDeclarationBlocks(body).values["Second-instrument"]).toEqual([]);
    expect(violations(body)).toContain(
      "line 3: the Origin value is not read: it follows line 2, refused",
    );
  });

  // Reconstructed from re-review 3: a code span opened on the previous line.
  test("a code span opened on one block line cannot close on the next", () => {
    expect(passes("Door: two-way\nSecond-instrument: see `x\nOrigin: `<details>`\n")).toBe(false);
  });

  test("an Origin source may carry a code span or an autolink, not a link (T2')", () => {
    expect(
      passes(withOrigin("Origin: observed 2026-10-07 `tools/quality/check-pr-door.ts:61`")),
    ).toBe(true);
    expect(
      passes(
        withOrigin(
          "Origin: observed 2026-10-07 <https://github.com/libre-ai/project-governance/pull/123>",
        ),
      ),
    ).toBe(true);
    expect(
      passes(
        withOrigin(
          "Origin: observed 2026-10-07 [#123](https://github.com/libre-ai/project-governance/pull/123)",
        ),
      ),
    ).toBe(false);
  });

  // Regression measured by re-review 3 on the 139 pull requests of the repository.
  test.each([
    [
      108,
      "scan of the candidate's complete history (15 commits, 193 git objects counted on 2026-10-14 with `git cat-file --batch-all-objects --batch-check`; `gitleaks git` reports 14 commits scanned on a rerun, 1 fewer than 15, unexplained: hypothesis, the commit without tree change has no diff to scan; the attestation must reconcile it) by a second tool, `gitleaks 8.30.1` in `git` mode over all commits and in `dir` mode over the tree, result no leaks; plus an object-level read of every object (`git cat-file --batch-all-objects`) for the local path prefix, the local user name, the former personal address and the local working-directory name, result 0 occurrence each, where the first instrument was a pattern scan of `git log -p --all` (private-key headers, `.p12`, token formats) whose only hit is a shell variable reference `pass:$transport` with no value. The scans exclude by construction anything outside the candidate clone: the signing keychain directory, which was not read, and the former local source repository, which is unchanged.",
    ],
    [
      113,
      "mirror fetch of libre-ai/square-control into a fresh repo with `git fetch '+refs/*:refs/*'` on 2026-10-14. `git for-each-ref` returns 4 refs (`refs/heads/dependabot/cargo/cargo-minor-and-patch-c3be8eb6fd` f192917b, `refs/heads/main` 95e1bcea, `refs/pull/1/head` f192917b, `refs/pull/1/merge` b583cc52); `git ls-remote` returns the same 4 refs plus HEAD; `git rev-list --objects --all | wc -l` = 205; `git rev-list --objects --all --not refs/heads/main | wc -l` = 12; `git rev-parse --is-shallow-repository` = false.",
    ],
    [
      114,
      "the manifest is rederived by four implementations that share no code (the owner's shell `manifest()` run, my re-run of it, a TypeScript `buildManifest`, a standalone Python `canonicalize.py derive`): byte-equal, 87,173 bytes, sha256 765fd6e932f826843c9fa2def6b965742287136abe0a8ce884fc5ff52459dca9, re-fetched after the freeze; ref set equal in `git ls-remote` and the provider API; gitleaks 8.30.1 finds no leak and its 14-versus-15 commit count is reconciled by a cat-file object read.",
    ],
    [
      116,
      'source of the scanner, not the attestation prose. `tools/attestation/git-attestation.ts`: `IdentityScope = "anywhere" | "forge-added-only"` (l. 57); `stripAllowedAddresses` skips a `forge-added-only` identity unless the commit is forge-added (l. 484-485, `neutralise:strip-scope`); `checkPerson` admits only `anywhere` identities on a commit the trusted ref reaches (l. 791-793). `evidence/identity-allowlist.json` of the square-control dossier: owner `anywhere`; `dependabot[bot]` noreply, `GitHub <noreply@github.com>` and `dependabot[bot] <support@github.com>` all `forge-added-only`.',
    ],
    [
      123,
      "not required on a two-way door; reverting the squash removes the added files and the one `package.json` script line.",
    ],
  ])("the real Second-instrument value of #%p is admitted", (number, value) => {
    expect(constructOpenedBy(value)).toBeNull();
    const door = number === 123 ? "two-way" : "one-way";
    expect(passes(`Door: ${door}\nSecond-instrument: ${value}\nOrigin: proposal\n\nBody.\n`)).toBe(
      true,
    );
  });
});

describe("T3 — key lines elsewhere in the body", () => {
  test("a key line at column 0 after the block fails by name", () => {
    expect(
      violations("Door: two-way\nOrigin: proposal\n\nBody.\nOrigin: observed 2026-10-07 x\n"),
    ).toContain("line 5: a `Origin:` line outside the declaration block");
  });

  test("key lines inside comments and fences after the block are counted, never failing", () => {
    const report = evaluate(TEMPLATE("Door: two-way\nOrigin: proposal\n"));
    expect(report.outcome).toBe("pass");
    expect(report.volumeSummary).toContain(
      "3 key line(s) outside the block (3 inside comments or code)",
    );
    expect(passes("Door: two-way\nOrigin: proposal\n\n```\nDoor: one-way\n```\n")).toBe(true);
  });

  test("an indented key line elsewhere is neither read nor refused", () => {
    expect(passes("Door: two-way\nOrigin: proposal\n\n    Door: one-way\n")).toBe(true);
  });

  test("only the block is read, whatever follows it", () => {
    const blocks = readDeclarationBlocks(
      "Door: two-way\nOrigin: proposal\n\n<details>\n\nDoor: one-way\n\n</details>\n",
    );
    expect(blocks.values.Door).toEqual(["two-way"]);
  });

  // Re-review 3, verbatim as the reviewer wrote them (B is the block).
  const B = "Door: two-way\nOrigin: proposal\n";
  test.each([
    ["E1", "<br>\n```\n\n```\n\n" + B],
    ["E1b", "<hr>\n```\n\n```\n\n" + B],
    ["E1c", "<img src=x>\n~~~\n\n~~~\n\n" + B],
    ["E2", "`<!--`\n\n```\n-->\n\n" + B],
    ["E3", "<!-- a --> <!-- b\n\nx -->\n\n" + B],
    ["E3b", "<!-- a --> <!-- b\n\n`-->`\n\n" + B],
    ["E5", "<hr>\n```\n\n<!--\n```\n\n" + B],
    ["E6", "\\`<details>`\n\n" + B],
    ["E7", "a `\nx` <details> `y`\n\n" + B],
    ["E11", "<br>\n<!--\n\n-->\n\n" + B],
  ])("re-review 3 %s fails: declarations must be the first lines", (_name, body) => {
    expect(passes(body)).toBe(false);
    expect(violations(body)).toContain("declarations must be the first lines of the description");
  });

  test("re-review 3 I1: the whole verdict of evaluateDoor fails", () => {
    const body = "`<!--`\n\n```\n-->\n\n" + B + "```\n";
    expect(evaluate(body).outcome).toBe("violations");
    expect(violations(body)).toContain("declarations must be the first lines of the description");
  });

  test("re-review 3 I2: the whole verdict of evaluateDoor fails on the E1 form", () => {
    const body = "<br>\n```\n\n```\n\n" + B;
    expect(evaluate(body).outcome).toBe("violations");
    expect(violations(body)).toContain("declarations must be the first lines of the description");
  });

  // M1/M2: GitHub displays `Door: two-way` and `Door: one-way`. A key line
  // outside the block is ignored only in a comment or fence opened at column
  // 0, at the start of its line, right after a raw blank line.
  test.each([
    [
      "M1, a `<!--` in a code span",
      "Door: two-way\nOrigin: proposal\n\n`<!--`\n\nDoor: one-way\n\n-->\n",
    ],
    [
      "M2, a comment indented four spaces",
      "Door: two-way\nOrigin: proposal\n\n    <!--\n\nDoor: one-way\n\n-->\n",
    ],
  ])("re-review 3 %s: the Door line elsewhere fails", (_name, body) => {
    expect(passes(body)).toBe(false);
    expect(violations(body)).toContain("line 6: a `Door:` line outside the declaration block");
    expect(readDeclarationBlocks(body).values.Door).toEqual(["two-way"]);
  });

  test.each([
    ["a comment opened mid-line", "x <!--\nDoor: one-way\n-->\n"],
    ["a comment opened after a non-blank line", "x\n<!--\nDoor: one-way\n-->\n"],
    ["a second comment of its line", "<!-- a --><!-- b\nDoor: one-way\n-->\n"],
    ["a fence indented three spaces", "   ```\nDoor: one-way\n```\n"],
    ["a fence opened after a non-blank line", "x\n```\nDoor: one-way\n```\n"],
  ])("a key line in %s is not exempt", (_name, after) => {
    expect(violations(`${B}\n${after}`)).toContain("a `Door:` line outside the declaration block");
  });

  // Re-review 4, finding 2, verbatim: HTML5 closes the comment on `--!>`, and
  // GitHub displays the key line after it.
  test("re-review 4: a comment closed by --!> exempts nothing after it", () => {
    const body = "Door: two-way\nOrigin: proposal\n\n<!-- x --!>\nOwner-arbitration: tk1q\n-->\n";
    expect(passes(body)).toBe(false);
    expect(violations(body)).toContain(
      "line 5: a `Owner-arbitration:` line outside the declaration block",
    );
    expect(stripNonDeclarations(body).inside[4]).toBe(false);
  });

  test.each([
    "<pre>",
    "<PRE class=x>",
    "<script>",
    "<style>",
    "<textarea>",
    "   <pre",
  ])("re-review 4: after a type-1 HTML block opener %p, no key line is exempt", (opener) => {
    const body = `${B}\n${opener}\n\n\`\`\`\nDoor: one-way\n\`\`\`\n\n<!--\nDoor: one-way\n-->\n`;
    const text = violations(body);
    expect(text).toContain("line 7: a `Door:` line outside the declaration block");
    expect(text).toContain("line 11: a `Door:` line outside the declaration block");
  });

  test("a tag that only starts like a type-1 opener exempts as before", () => {
    expect(passes(`${B}\n<preview>\n\n\`\`\`\nDoor: one-way\n\`\`\`\n`)).toBe(true);
  });

  test.each([
    ["a comment", "<!--\nDoor: one-way\n-->\n"],
    ["a backtick fence", "```\nDoor: one-way\n```\n"],
    ["a tilde fence", "~~~\nDoor: one-way\n~~~\n"],
  ])("a key line in %s opened at column 0 after a blank line is exempt", (_name, after) => {
    expect(passes(`${B}\n${after}`)).toBe(true);
  });

  test("readDeclarationBlocks keeps its name and .values for #144", () => {
    const blocks = readDeclarationBlocks("Not-added: dependency, schema\nDoor: two-way\n\nBody.\n");
    expect(blocks.values["Not-added"]).toEqual(["dependency, schema"]);
    expect(blocks.block).toEqual({ first: 1, last: 2 });
  });
});

describe("re-review 5", () => {
  // C1, verbatim: cmark keeps these HTML blocks open across blank lines, the
  // browser shows what follows, so the fence after them exempts nothing.
  test.each([
    "Door: two-way\nOrigin: proposal\n\n<? >\n\n```\nDoor: one-way\n```\n\n?>\n",
    "Door: two-way\nOrigin: proposal\n\n<![CDATA[ >\n\n```\nDoor: one-way\n```\n]]>\n",
    "Door: two-way\nOrigin: proposal\n\n<!-- x --!>\n\n```\nDoor: one-way\n```\n-->\n",
    "Door: two-way\nOrigin: proposal\n\n<!-- guidance --!>\n\n```\nDoor: one-way\nSecond-instrument: none\n```\n\n## Summary\n\nBody.\n",
    "Door: two-way\nOrigin: proposal\n\n<?x >\n\n~~~\nDoor: one-way\n~~~\n",
  ])("C1: after an HTML block cmark leaves open, a fence exempts nothing: %p", (body) => {
    expect(passes(body)).toBe(false);
    expect(violations(body)).toContain("a `Door:` line outside the declaration block");
  });

  test.each([
    ["type 4 declaration", "<!X a"],
    ["type 4 doctype", "<!DOCTYPE html"],
  ])("C1: an unclosed %s block ends the exemptions too", (_name, opener) => {
    expect(
      passes(`Door: two-way\nOrigin: proposal\n\n${opener}\n\n\`\`\`\nDoor: one-way\n\`\`\`\n`),
    ).toBe(false);
  });

  test.each([
    ["<?php ?>", "<?php ?>"],
    ["<!DOCTYPE html>", "<!DOCTYPE html>"],
    ["<![CDATA[ x ]]>", "<![CDATA[ x ]]>"],
  ])("C1 control: %s, closed on its line, keeps the exemption", (_name, line) => {
    expect(
      passes(`Door: two-way\nOrigin: proposal\n\n${line}\n\n\`\`\`\nDoor: one-way\n\`\`\`\n`),
    ).toBe(true);
  });

  // C2: TeX letters show nothing; `$` is refused outside code spans.
  test.each([
    "$\\quad$",
    "$\\phantom{PR}$",
    "$\\color{transparent}{PR 12}$",
  ])("C2: an Origin source in math is refused: %s", (source) => {
    const text = violations(withOrigin(`Origin: observed 2026-10-07 ${source}`));
    expect(text).toContain("the Origin value carries '$'");
  });

  test("C2: $ is refused in any value outside code spans, escaped too, admitted inside", () => {
    expect(violations(withBoth("Second-instrument: costs $5 over 25 repositories"))).toContain(
      "carries '$' (no link, image, strikethrough or math",
    );
    expect(violations(withBoth("Second-instrument: costs \\$5 over 25 repositories"))).toContain(
      "carries '$' (escaped or not)",
    );
    expect(passes(withBoth("Second-instrument: `echo $HOME` over 25 repositories"))).toBe(true);
  });

  test("C2: a shortcode is not a letter of the source", () => {
    expect(violations(withOrigin("Origin: observed 2026-10-07 :smile:"))).toContain(
      "is a placeholder or has no letter or digit",
    );
    expect(violations(withOrigin("Origin: observed 2026-10-07 :smile::+1:"))).toContain(
      "is a placeholder or has no letter or digit",
    );
    expect(passes(withOrigin("Origin: observed 2026-10-07 :smile: PR 12"))).toBe(true);
  });

  // C3: an invisible Second-instrument on a one-way door.
  test.each([
    ["math", "$\\phantom{xxxxxxxxxxxx}$"],
    ["entities", "&#x200B;&#x200B;&#x200B;"],
    ["12 zero-width spaces", String.fromCodePoint(0x200b).repeat(12)],
    ["12 Hangul fillers", String.fromCodePoint(0x3164).repeat(12)],
    ["non-breaking spaces", "&nbsp;&nbsp;&nbsp;"],
    ["a code span of 12 blanks", "`            `"],
    ["n/a and entities", "n/a &#x200B;&#x200B;"],
    ["shortcodes", ":white_check_mark: :white_check_mark:"],
  ])("C3: an invisible Second-instrument fails: %s", (_name, value) => {
    expect(passes(withDoor(`Door: one-way\nSecond-instrument: ${value}`))).toBe(false);
  });

  test("C3: twelve visible letters or digits are enough, code spans included", () => {
    expect(passes(withDoor("Door: one-way\nSecond-instrument: `ls-remote` 25 repos"))).toBe(true);
    expect(passes(withDoor("Door: one-way\nSecond-instrument: abcdef 123456"))).toBe(true);
    expect(passes(withDoor("Door: one-way\nSecond-instrument: abcdef 12345"))).toBe(false);
  });
});

describe("Door", () => {
  test("a one-way door with a substantive second instrument passes", () => {
    expect(
      passes(
        withDoor(
          "Door: one-way\nSecond-instrument: git ls-remote over the 29 repositories, 0 references left",
        ),
      ),
    ).toBe(true);
  });

  test("a description without a Door line fails", () => {
    expect(violations("Origin: proposal\n\nBody.\n")).toContain(
      "no `Door: one-way` or `Door: two-way` line in the declaration block (lines 1-1)",
    );
  });

  test.each([
    "Door: maybe",
    "Door: Two-Way",
    "Door: two-way, mostly",
    "Door:",
    "Door: one-way | two-way",
  ])("an invalid value fails: %s", (line) => {
    expect(passes(withDoor(line))).toBe(false);
  });

  test("two Door lines fail, even when they agree", () => {
    expect(passes(withDoor("Door: two-way\nDoor: two-way"))).toBe(false);
  });

  test("a one-way door without a second instrument fails", () => {
    expect(violations(withDoor("Door: one-way"))).toContain("needs a `Second-instrument:` line");
  });

  test.each([
    "",
    "n/a",
    "none",
    "TBD",
    "-",
    "short one",
  ])("a one-way door with a placeholder second instrument fails: %p", (value) => {
    expect(passes(withDoor(`Door: one-way\nSecond-instrument: ${value}`))).toBe(false);
  });

  test("a refused Second-instrument names its line in the absence", () => {
    expect(violations(withDoor("Door: one-way\nSecond-instrument: see `x"))).toContain(
      "in the declaration block (lines 1-3); refused: line 2",
    );
  });

  test("a value carrying U+2028 is still one line", () => {
    expect(passes(`Door: two-way${LINE_SEPARATOR}\nOrigin: proposal\n`)).toBe(true);
  });

  // 2026-10-14: Door declaration became required; Dependabot writes its own
  // descriptions, and a version bump is two-way by construction.
  test("an undeclared pull request from an implicit two-way author passes, and says why", () => {
    const report = evaluate("Bumps x from 1 to 2.", "PR #9 description", "dependabot[bot]");
    expect(report.outcome).toBe("pass");
    expect(report.checks.find((check) => check.item === "PR #9 description — Door")?.note).toBe(
      "Door: two-way (implicit: no Door line, author dependabot[bot] is in IMPLICIT_TWO_WAY_AUTHORS)",
    );
    expect(report.volumeSummary).toContain("door implied by author dependabot[bot]");
  });

  test("an undeclared pull request from any other author still fails", () => {
    for (const author of [null, "constantin-jais", "dependabot", "renovate[bot]"]) {
      expect(passes("Bumps x.", author)).toBe(false);
    }
  });

  test("a Door line written by an implicit two-way author is judged as written", () => {
    expect(passes("Door: one-way", "dependabot[bot]")).toBe(false);
    expect(passes("Door: sideways", "dependabot[bot]")).toBe(false);
    expect(passes("Bumps x.\nDoor: two-way\n", "dependabot[bot]")).toBe(false);
  });
});

describe("Origin (ADR-0056 D1)", () => {
  test.each([
    "Origin: inspection",
    "Origin: synthetic",
    "Origin: proposal",
    "Origin: observed 2026-10-07 libre-ai/project-governance#135",
    "Origin: observed 2026-10-07 tools/quality/check-pr-door.ts:61",
    "Origin: observed 2026-10-07 session note of the fleet-pins drill",
    "Origin: observed 2026-10-07 <https://github.com/libre-ai/project-governance/pull/135>",
    "Origin: observed 2024-02-29 #12",
    "Origin: observed 2026-10-07 note de session Ω",
  ])("a valid Origin line passes: %s", (line) => {
    expect(passes(withOrigin(line))).toBe(true);
  });

  test("the passing verdict restates the declared origin", () => {
    const report = evaluate(withOrigin("Origin: observed 2026-10-07 PR #135"), "d");
    expect(report.checks.find((check) => check.item === "d — Origin")?.note).toBe(
      "Origin: observed 2026-10-07 PR #135",
    );
  });

  test("a block without an Origin line fails, and names the vocabulary", () => {
    const text = violations("Door: two-way\n\nBody.\n");
    expect(text).toContain("d — Origin: no `Origin:` line");
    expect(text).toContain('"observed", "inspection", "synthetic", "proposal"');
  });

  test("two Origin lines fail, even when they agree", () => {
    expect(violations("Door: two-way\nOrigin: proposal\nOrigin: inspection\n")).toContain(
      'd — Origin: 2 Origin lines ("proposal", "inspection") — declare exactly one',
    );
  });

  test.each([
    "Origin:",
    "Origin: maybe",
    "Origin: Proposal",
    "Origin: OBSERVED 2026-10-07 #1",
    "Origin: observation 2026-10-07 #1",
    "Origin: proposal,",
  ])("a value outside the vocabulary fails: %s", (line) => {
    expect(passes(withOrigin(line))).toBe(false);
  });

  test("an empty Origin line is refused as carrying no value", () => {
    expect(violations(withOrigin("Origin:   "))).toContain("Origin line carries no value");
  });

  test.each([
    "Origin: proposal mostly",
    "Origin: inspection of check-fleet-pins",
    "Origin: synthetic probe",
  ])("a value other than observed carries nothing else on its line: %s", (line) => {
    expect(violations(withOrigin(line))).toContain("carries nothing else on its line");
  });

  test("observed without a date fails, and says what it needs", () => {
    expect(violations(withOrigin("Origin: observed"))).toContain(
      "observed needs its date and its source",
    );
  });

  test.each([
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-10-7",
    "20261007",
    "2026-10-07T12:00:00Z",
    "yesterday",
  ])("observed with an invalid ISO date fails: %s", (date) => {
    expect(violations(withOrigin(`Origin: observed ${date} PR #135`))).toContain(
      `observed date "${date}" is not a valid ISO 8601 calendar date`,
    );
  });

  test.each([
    "2999-12-31",
    "2026-10-25",
    "0000-01-01",
    "1969-12-31",
  ])("an observed date in the future or before 1970 is refused: %s", (date) => {
    expect(violations(withOrigin(`Origin: observed ${date} PR #135`))).toMatch(
      /is after .* \+ 1 day|is before 1970-01-01/,
    );
  });

  test.each(["2026-10-24", "2026-10-23", "1970-01-01"])("%s is admitted", (date) => {
    expect(passes(withOrigin(`Origin: observed ${date} PR #135`))).toBe(true);
  });

  test("the clock is injected: the same date judged at another instant", () => {
    const body = withOrigin("Origin: observed 2026-10-25 PR #135");
    expect(evaluate(body, "d", null, new Date("2026-10-24T00:00:00Z")).outcome).toBe("pass");
    expect(evaluate(body, "d", null, new Date("2026-10-23T23:59:59Z")).outcome).toBe("violations");
  });

  test("observed with a date but no source fails", () => {
    expect(violations(withOrigin("Origin: observed 2026-10-07"))).toContain(
      "needs a source after its date",
    );
  });

  test.each([
    "n/a",
    "none",
    "TBD",
    ZERO_WIDTH_SPACE,
    "&#8203;",
    "&nbsp;",
    "?",
    `${WORD_JOINER}${WORD_JOINER}`,
    ...HANGUL_FILLERS,
    `${HANGUL_FILLERS[2]}${HANGUL_FILLERS[2]} #`,
  ])("observed with a placeholder or invisible source fails: %p", (source) => {
    expect(violations(withOrigin(`Origin: observed 2026-10-07 ${source}`))).toContain(
      "is a placeholder or has no letter or digit",
    );
  });

  test("the template placeholder <source> is refused by T2", () => {
    expect(violations(withOrigin("Origin: observed 2026-10-07 <source>"))).toContain(
      "the Origin value carries '<'",
    );
  });

  test("the key is case-sensitive, as Door's is", () => {
    expect(passes("Door: two-way\norigin: proposal\n")).toBe(false);
  });

  test("an implicit two-way author writing no Origin line is waived, and says so", () => {
    const report = evaluate("Bumps x from 1 to 2.", "PR #9 description", "dependabot[bot]");
    expect(report.checks.find((check) => check.item === "PR #9 description — Origin")?.note).toBe(
      "Origin: waived (no Origin line, author dependabot[bot] is in IMPLICIT_TWO_WAY_AUTHORS)",
    );
    expect(report.volumeSummary).toContain("origin waived for author dependabot[bot]");
  });

  test("an Origin line written by an implicit two-way author is judged as written", () => {
    expect(passes("Door: two-way\nOrigin: maybe\n", "dependabot[bot]")).toBe(false);
    expect(passes("Door: two-way\nOrigin: proposal\n", "dependabot[bot]")).toBe(true);
    expect(passes("Origin: maybe\n", "dependabot[bot]")).toBe(false);
  });
});

describe("judgeOrigin and isIsoCalendarDate", () => {
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

describe("the volume line", () => {
  test("names the partition, the headers, the block and the counts", () => {
    expect(evaluate(`${SPDX}Door: two-way\nOrigin: proposal\n\n<!-- x -->\n`).volumeSummary).toBe(
      "6 description line(s) = 3 examined + 3 removed in 3 comment/code block(s); 2 header comment line(s), declaration block lines 3-4; 1 Door line(s), 0 Second-instrument line(s), 1 Origin line(s); 0 key line(s) outside the block (0 inside comments or code)",
    );
  });

  test.each([
    ["", 0],
    ["\n", 1],
    ["Door: two-way", 1],
    ["Door: two-way\n", 1],
    ["Door: two-way\r\n", 1],
    ["a\n\n", 2],
    [`${BOM}a\n`, 1],
    ["```\nx\n\n```\ny <!-- z --> w\n<!-- open", 6],
  ])("%p has %p line(s), and examined + removed sums to it", (body, lines) => {
    const summary = evaluate(body).volumeSummary ?? "";
    const counts = /^(\d+) description line\(s\) = (\d+) examined \+ (\d+) removed/.exec(summary);
    const [total, examined, removed] = (counts ?? []).slice(1).map(Number);
    expect(total).toBe(lines);
    expect((examined ?? -1) + (removed ?? -1)).toBe(total ?? -2);
  });
});

describe("stripNonDeclarations (T3 and #144)", () => {
  test("keeps the line layout so the rest of the body is untouched", () => {
    const { text, removedBlocks } = stripNonDeclarations("a\n<!--\nb\n-->\nc\n");
    expect(text.split("\n")).toEqual(["a", "", "", "", "c", ""]);
    expect(removedBlocks).toBe(1);
  });

  test("counts the lines it emptied, not the lines it shortened or the blank ones", () => {
    const stripped = stripNonDeclarations("a <!-- x --> b\n<!-- y -->\n\n```\n\n```\n");
    expect(stripped.lines).toEqual(["a  b", "", "", "", "", ""]);
    expect(stripped.text).toBe("a  b\n\n\n\n\n\n");
    expect(stripped.removedLines).toBe(4);
    expect(stripped.removedBlocks).toBe(3);
  });

  test("an unclosed comment swallows the rest", () => {
    expect(stripNonDeclarations("<!-- Door: two-way").text).not.toContain("Door");
  });

  test("short comments are complete, fences follow CommonMark", () => {
    expect(stripNonDeclarations("<!-->\nx\n<!--->\ny\n").lines).toEqual(["", "x", "", "y"]);
    expect(stripNonDeclarations("````\n```\nx\n````\ny\n").lines).toEqual(["", "", "", "", "y"]);
    expect(stripNonDeclarations("```\n~~~\nx\n").lines).toEqual(["", "", ""]);
    expect(stripNonDeclarations("```x```\ny\n").lines).toEqual(["```x```", "y"]);
    expect(stripNonDeclarations("    ```\ny\n").lines).toEqual(["    ```", "y"]);
    expect(stripNonDeclarations("```\n``` x\n    ```\ny\n").inside).toEqual([
      false,
      true,
      true,
      true,
    ]);
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

  test("a null body reads as empty", () => {
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
  const eventFile = (payload: unknown): string => {
    const path = join(mkdtempSync(join(tmpdir(), "pr-door-")), "event.json");
    writeFileSync(path, JSON.stringify(payload));
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

  test("a description without the block fails; with it, it passes and prints its volume", () => {
    const missing = run({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventFile({ pull_request: { number: 3, body: "A fix." } }),
    });
    expect(missing.exitCode).toBe(1);
    expect(missing.output).toContain("PR #3 description — Door");

    const declared = run({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventFile({
        pull_request: { number: 3, body: "Door: two-way\nOrigin: proposal\n\nA fix." },
      }),
    });
    expect(declared.exitCode).toBe(0);
    expect(declared.output).toContain("4 description line(s) = 4 examined + 0 removed");
    expect(declared.output).toContain("declaration block lines 1-2");
  });

  test("the command reads the clock: an observed date far in the future fails end to end", () => {
    const result = run({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventFile({
        pull_request: { number: 6, body: "Door: two-way\nOrigin: observed 2999-12-31 PR #1" },
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('observed date "2999-12-31" is after');
  });

  test("an undeclared Dependabot pull request passes end to end", () => {
    const bot = run({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventFile({
        pull_request: { number: 4, body: "Bumps x.", user: { login: "dependabot[bot]" } },
      }),
    });
    expect(bot.exitCode).toBe(0);
    expect(bot.output).toContain("door implied by author dependabot[bot]");
  });
});
