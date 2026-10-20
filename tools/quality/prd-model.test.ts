import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  atLeast,
  blankFencesAndComments,
  MATURITY_LADDER,
  type MaturityLevel,
  type Parsed,
  parseCriteria,
  parseWorkPackages,
  readDocumentMaturity,
  type WorkPackage,
} from "./prd-model";

const TABLE_HEADER =
  "| WP | CA-n couverts | Périmètre (chemins, globs) | Vérification (commande) | Porte anticipée |";
const TABLE_RULE = "| --- | --- | --- | --- | --- |";

function table(...rows: string[]): string {
  return [TABLE_HEADER, TABLE_RULE, ...rows].join("\n");
}

// The level a readable document declares; a refusal here is a test failure.
function maturityOf(markdown: string): MaturityLevel | null {
  const read: Parsed<MaturityLevel | null> = readDocumentMaturity(markdown);
  if (!read.ok) throw new Error(`unexpected refusal: ${read.reason}`);
  return read.value;
}

// The text a readable document gives the parsers; a refusal here is a test failure.
function blanked(markdown: string): string {
  const read: Parsed<string> = blankFencesAndComments(markdown);
  if (!read.ok) throw new Error(`unexpected refusal: ${read.reason}`);
  return read.value;
}

describe("parseCriteria", () => {
  test('reads "- CA-1 … Validation : …" bullets', () => {
    const result = parseCriteria(
      "- CA-1 The daemon refuses an unsigned call. Validation : cargo test\n",
    );
    expect(result).toEqual({
      ok: true,
      value: [{ id: "CA-1", line: 1, hasValidation: true }],
    });
  });

  test('a bullet without "Validation :" is hasValidation:false', () => {
    const result = parseCriteria("# Cahier\n\n- CA-1 The daemon refuses an unsigned call.\n");
    expect(result).toEqual({
      ok: true,
      value: [{ id: "CA-1", line: 3, hasValidation: false }],
    });
  });

  test("a Validation clause on a wrapped continuation line still counts", () => {
    const result = parseCriteria(
      "- CA-2 The gate prints its volume.\n  Validation : bun test\n- CA-3 Another.\n",
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { id: "CA-2", line: 1, hasValidation: true },
        { id: "CA-3", line: 3, hasValidation: false },
      ],
    });
  });

  test("a duplicated CA id is ok:false naming the id and both lines", () => {
    const result = parseCriteria("- CA-1 First. Validation : a\n\n- CA-1 Again. Validation : b\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("CA-1");
      expect(result.reason).toContain("1");
      expect(result.reason).toContain("3");
    }
  });

  test("CA ids inside fenced code blocks and HTML comments are ignored", () => {
    const markdown = [
      "- CA-1 Real. Validation : a",
      "```",
      "- CA-2 Inside a fence. Validation : b",
      "```",
      "<!--",
      "- CA-3 Inside a comment. Validation : c",
      "-->",
      "- CA-4 Real too. Validation : d",
    ].join("\n");
    expect(parseCriteria(markdown)).toEqual({
      ok: true,
      value: [
        { id: "CA-1", line: 1, hasValidation: true },
        { id: "CA-4", line: 8, hasValidation: true },
      ],
    });
  });

  test("a document without any criterion is ok:true with zero entries, never an error", () => {
    expect(parseCriteria("# Nothing here\n")).toEqual({ ok: true, value: [] });
  });
});

describe("parseWorkPackages", () => {
  test("reads the table WP | CA-n | Périmètre | Vérification | Porte", () => {
    const markdown = table(
      "| `WP-1` | `CA-3`, `CA-15` | `crates/work-supervision-daemon/**`, `docs/x.md` | `cargo test -p work-supervision-daemon --locked` | `two-way` |",
      "| `WP-2` | `CA-4` | `tools/**` | `bun test` | `one-way` |",
    );
    expect(parseWorkPackages(markdown)).toEqual({
      ok: true,
      value: [
        {
          id: "WP-1",
          criteria: ["CA-3", "CA-15"],
          scope: ["crates/work-supervision-daemon/**", "docs/x.md"],
          verify: "cargo test -p work-supervision-daemon --locked",
          door: "two-way",
        },
        {
          id: "WP-2",
          criteria: ["CA-4"],
          scope: ["tools/**"],
          verify: "bun test",
          door: "one-way",
        },
      ],
    });
  });

  test("a row whose Porte is not one-way|two-way is ok:false naming the row", () => {
    const result = parseWorkPackages(table("| `WP-1` | `CA-3` | `a/**` | `bun test` | `maybe` |"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("WP-1");
      expect(result.reason).toContain("maybe");
    }
  });

  test("a duplicated WP is ok:false naming the id", () => {
    const result = parseWorkPackages(
      table(
        "| `WP-1` | `CA-3` | `a/**` | `bun test` | `two-way` |",
        "| `WP-1` | `CA-4` | `b/**` | `bun test` | `two-way` |",
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("WP-1");
  });

  test("a document without the work-package table is ok:false, never an empty success", () => {
    const result = parseWorkPackages("# PRD\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(result.ok).toBe(false);
  });

  test("a row with the wrong cell count is ok:false naming the row", () => {
    const result = parseWorkPackages(table("| `WP-1` | `CA-3` | `a/**` |"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("WP-1");
  });

  test("a row with an empty scope or no cited criterion is ok:false", () => {
    expect(parseWorkPackages(table("| `WP-1` | `CA-3` |  | `bun test` | `two-way` |")).ok).toBe(
      false,
    );
    expect(parseWorkPackages(table("| `WP-1` |  | `a/**` | `bun test` | `two-way` |")).ok).toBe(
      false,
    );
  });

  test("a comma inside braces does not split a scope entry", () => {
    const result = parseWorkPackages(
      table("| `WP-1` | `CA-3` | `src/{a,b}/**` | `bun test` | `two-way` |"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.scope).toEqual(["src/{a,b}/**"]);
  });

  test("a plain comma-separated scope list still gives separate entries", () => {
    const result = parseWorkPackages(
      table("| `WP-1` | `CA-3` | `a/**, b/**` | `bun test` | `two-way` |"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.scope).toEqual(["a/**", "b/**"]);
  });

  test("braces next to a list split only on the commas outside them", () => {
    const result = parseWorkPackages(
      table("| `WP-1` | `CA-3` | `src/{a,b}/**, docs/**` | `bun test` | `two-way` |"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.scope).toEqual(["src/{a,b}/**", "docs/**"]);
  });

  test.each([
    "src/{a,b/**",
    "src/a,b}/**",
    "src/{{a,b}/**",
  ])("unbalanced braces in %p are ok:false naming the row and line", (scope) => {
    const result = parseWorkPackages(
      table(`| \`WP-1\` | \`CA-3\` | \`${scope}\` | \`bun test\` | \`two-way\` |`),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("WP-1 (line 3)");
  });

  // The id of a row has the grammar of the trailer that declares it
  // (`WP-[1-9][0-9]{0,8}`): a row no trailer can name is refused at the row.
  test.each([
    "WP-01",
    "WP-0",
    "WP-1234567890",
  ])("a row named %p, which no trailer can declare, is ok:false naming the row and line", (id: string) => {
    const result: Parsed<readonly WorkPackage[]> = parseWorkPackages(
      table(`| \`${id}\` | \`CA-3\` | \`a/**\` | \`bun test\` | \`two-way\` |`),
    );
    expect(result).toEqual({
      ok: false,
      reason: `work package ${id} (line 3): identifier must be WP- and a positive integer of at most nine digits without a leading zero`,
    });
  });

  test("a row named with nine digits is accepted", () => {
    const result: Parsed<readonly WorkPackage[]> = parseWorkPackages(
      table("| `WP-123456789` | `CA-3` | `a/**` | `bun test` | `two-way` |"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.id).toBe("WP-123456789");
  });

  test("a table inside a fenced block is ignored", () => {
    const fenced = [
      "```",
      table("| `WP-1` | `CA-3` | `a/**` | `bun test` | `two-way` |"),
      "```",
    ].join("\n");
    expect(parseWorkPackages(fenced).ok).toBe(false);
  });
});

describe("readDocumentMaturity", () => {
  test('reads only "Maturité du document :" and ignores "Maturité :"', () => {
    const markdown: string = [
      "Maturité : prototype",
      "Maturité du document : proposition",
      "",
    ].join("\n");
    expect(readDocumentMaturity(markdown)).toEqual({ ok: true, value: "proposition" });
  });

  test('"Maturité :" alone yields no level (pilot PRD case)', () => {
    expect(readDocumentMaturity("Maturité : industrialisation\n")).toEqual({
      ok: true,
      value: null,
    });
  });

  test("tolerates bullets, bold markers and a trailing remark", () => {
    expect(maturityOf("- **Maturité du document :** décision (arbitrage du 2026-10-19)\n")).toBe(
      "décision",
    );
  });

  test("prefers the longest level name", () => {
    expect(maturityOf("Maturité du document : mise en service\n")).toBe("mise en service");
  });

  test("an unknown level, or two lines that disagree, yield no level", () => {
    expect(maturityOf("Maturité du document : excellente\n")).toBeNull();
    expect(
      maturityOf("Maturité du document : décision\nMaturité du document : prototype\n"),
    ).toBeNull();
  });

  test("a declaration inside a fenced block or an HTML comment is ignored", () => {
    expect(maturityOf("```\nMaturité du document : décision\n```\n")).toBeNull();
    expect(maturityOf("<!-- Maturité du document : décision -->\n")).toBeNull();
  });
});

// A fence opens on 0-3 spaces and three or more backticks (an info string
// without a backtick) or tildes; it closes only on a line of the SAME
// character, at least as long, followed by nothing but spaces or tabs.
// A reader that closes on any line starting with three backticks lets an
// example inside a PRD declare a maturity or a criterion (wave G, G1).
describe("fenced blocks and HTML comments, as the readers see them", () => {
  const FOUR: string = "````";
  const THREE: string = "```";

  test("(a) an info-string line inside a fence does not close it", () => {
    const markdown: string = [
      "# PRD",
      `${THREE}markdown`,
      `${THREE}js`,
      "Maturité du document : décision",
      THREE,
      "Maturité du document : proposition",
      "",
    ].join("\n");
    expect(maturityOf(markdown)).toBe("proposition");
  });

  test("(b) a three-backtick line inside a four-backtick fence does not close it", () => {
    const markdown: string = [
      "# PRD",
      `${FOUR}markdown`,
      THREE,
      "Maturité du document : décision",
      FOUR,
      "Maturité du document : proposition",
      "",
    ].join("\n");
    expect(maturityOf(markdown)).toBe("proposition");
  });

  test("(c) a criterion inside a four-backtick fence holding a three-backtick fence is not declared", () => {
    const markdown: string = [
      "- CA-1 Real. Validation : a",
      `${FOUR}markdown`,
      THREE,
      "- CA-2 Phantom. Validation : b",
      THREE,
      FOUR,
      "- CA-3 Real too. Validation : c",
    ].join("\n");
    expect(parseCriteria(markdown)).toEqual({
      ok: true,
      value: [
        { id: "CA-1", line: 1, hasValidation: true },
        { id: "CA-3", line: 7, hasValidation: true },
      ],
    });
  });

  test("a closing line that carries an info string does not close the fence", () => {
    const markdown: string = [
      THREE,
      `${THREE}text`,
      "Maturité du document : décision",
      `${THREE}   `,
      "Maturité du document : proposition",
    ].join("\n");
    expect(maturityOf(markdown)).toBe("proposition");
  });

  test("a tilde fence is not closed by backticks", () => {
    const markdown: string = [
      "~~~",
      THREE,
      "Maturité du document : décision",
      "~~~",
      "Maturité du document : proposition",
    ].join("\n");
    expect(maturityOf(markdown)).toBe("proposition");
  });

  test("an unclosed fence hides everything to the end, so the maturity is absent", () => {
    const markdown: string = ["# PRD", THREE, "Maturité du document : décision", ""].join("\n");
    expect(maturityOf(markdown)).toBeNull();
  });

  test("a line indented by four spaces is not a fence: its keywords count", () => {
    const markdown: string = [
      `    ${THREE}`,
      "Maturité du document : décision",
      `    ${THREE}`,
    ].join("\n");
    expect(maturityOf(markdown)).toBe("décision");
  });

  test("a comment opener inside a fence opens no comment", () => {
    const markdown: string = [THREE, "<!--", THREE, "Maturité du document : décision", ""].join(
      "\n",
    );
    expect(maturityOf(markdown)).toBe("décision");
  });

  test("a comment on several lines hides them, and the text after its end on the same line counts", () => {
    const markdown: string = [
      "- CA-1 Real. Validation : a",
      "<!-- start",
      "- CA-2 Hidden. Validation : b",
      "end --> - CA-3 After the comment. Validation : c",
      "<!-- not this --> Maturité du document : décision",
      "Maturité du document : décision",
    ].join("\n");
    expect(parseCriteria(markdown)).toEqual({
      ok: true,
      value: [
        { id: "CA-1", line: 1, hasValidation: true },
        { id: "CA-3", line: 4, hasValidation: true },
      ],
    });
    expect(maturityOf(markdown)).toBe("décision");
  });

  test("an unterminated comment hides everything to the end", () => {
    expect(maturityOf("<!-- open\nMaturité du document : décision\n")).toBeNull();
  });

  // Mutant X3: a closer indented by four spaces or a tab is not a closer.
  test("a fence is not closed by a run indented by four spaces or a tab", () => {
    for (const indent of ["    ", "\t", "  \t"]) {
      const markdown: string = [
        THREE,
        `${indent}${THREE}`,
        "Maturité du document : décision",
        THREE,
        "Maturité du document : proposition",
      ].join("\n");
      expect(maturityOf(markdown)).toBe("proposition");
    }
  });

  // Mutant X4: inside an open comment a fence line opens no fence, so the
  // comment's `-->` ends it and the text after it counts.
  test("a fence line inside an open comment opens no fence", () => {
    const markdown: string = [
      "<!--",
      THREE,
      "-->",
      "Maturité du document : décision",
      THREE,
      "Maturité du document : proposition",
    ].join("\n");
    expect(maturityOf(markdown)).toBe("décision");
  });

  test("CRLF and a lone CR keep the line numbers", () => {
    const crlf: string = ["# Cahier", THREE, "- CA-9 x", THREE, "- CA-1 Real. Validation : a"].join(
      "\r\n",
    );
    expect(parseCriteria(crlf)).toEqual({
      ok: true,
      value: [{ id: "CA-1", line: 5, hasValidation: true }],
    });
    const cr: string = ["# Cahier", THREE, "- CA-9 x", THREE, "- CA-1 Real. Validation : a"].join(
      "\r",
    );
    expect(parseCriteria(cr)).toEqual({
      ok: true,
      value: [{ id: "CA-1", line: 5, hasValidation: true }],
    });
  });

  test("blankFencesAndComments keeps every line, normalises line ends and blanks with spaces", () => {
    const source: string = ["<!-- x --> keep", "~~~~", "~~~", "hidden", "~~~~ ", "after"].join(
      "\r\n",
    );
    expect(blankFencesAndComments(source)).toEqual({
      ok: true,
      value: ["           keep", "    ", "   ", "      ", "     ", "after"].join("\n"),
    });
    expect(blanked("a\rb\r\nc\n").split("\n")).toEqual(["a", "b", "c", ""]);
  });

  test("a fence opener needs 0-3 spaces and at least three backticks or tildes", () => {
    expect(blanked("   ```\nx\n```")).toBe("      \n \n   ");
    expect(blanked("``\nx")).toBe("``\nx");
    expect(blanked("``` a`b\nx")).toBe("``` a`b\nx");
    expect(blanked("~~~ a`b\nx")).toBe("       \n ");
  });

  test("a PRD with an ordinary code block reads its maturity, table and criteria", () => {
    const markdown: string = [
      "# PRD",
      "",
      "Maturité du document : décision",
      "",
      "- CA-1 The daemon refuses an unsigned call. Validation : cargo test",
      "",
      `${THREE}sh`,
      "cargo test -p daemon",
      THREE,
      "",
      table("| `WP-1` | `CA-1` | `crates/**` | `cargo test` | `two-way` |"),
      "",
    ].join("\n");
    expect(maturityOf(markdown)).toBe("décision");
    expect(parseCriteria(markdown)).toEqual({
      ok: true,
      value: [{ id: "CA-1", line: 5, hasValidation: true }],
    });
    const packages: Parsed<readonly WorkPackage[]> = parseWorkPackages(markdown);
    expect(packages.ok).toBe(true);
    if (packages.ok)
      expect(packages.value.map((row: WorkPackage): string => row.id)).toEqual(["WP-1"]);
  });
});

// Wave H (C1, C1 bis, Important): a construction the reader does not model
// would make it read a quoted example as live, so the document is refused,
// with the line, by the common entry point of the three parsers. Never a
// level, an empty list or a table read from the wrong place.
describe("constructions the reader refuses", () => {
  const THREE: string = "```";
  const FOUR: string = "````";
  const REAL_TABLE: string = table("| `WP-1` | `CA-1` | `a/**` | `bun test` | `one-way` |");

  function expectRefused(markdown: string, line: number, cause: string): void {
    const results: readonly Parsed<unknown>[] = [
      blankFencesAndComments(markdown),
      readDocumentMaturity(markdown),
      parseCriteria(markdown),
      parseWorkPackages(markdown),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain(`line ${line}`);
        expect(result.reason).toContain(cause);
      }
    }
  }

  const FENCE_AFTER_MARKER: string = "a fence after a list or quote marker";

  test.each([
    ["a bullet", `- ${THREE}markdown`],
    ["a star bullet", `* ${THREE}`],
    ["an ordered item", `2. ${FOUR}`],
    ["an ordered item with a parenthesis", `1) ${THREE}`],
    ["a quote", `> ${THREE}`],
    ["a quote without a space", `>${THREE}`],
    ["a quote holding a bullet", `> - ${THREE}`],
    ["a tilde run after a bullet", "- ~~~"],
    ["an indented bullet", `   - ${THREE}`],
  ])("(C1 a) %s that opens a fence is refused", (_label: string, opener: string) => {
    const markdown: string = [
      "# PRD",
      opener,
      "  Maturité du document : décision",
      `  ${THREE}`,
      "Maturité du document : proposition",
    ].join("\n");
    expectRefused(markdown, 2, FENCE_AFTER_MARKER);
  });

  test("(C1 a) the attack of the review: an example in a list item hid the real line", () => {
    const markdown: string = [
      "# PRD",
      `- ${THREE}markdown`,
      "  Maturité du document : décision",
      `  ${THREE}`,
      "Maturité du document : proposition",
    ].join("\n");
    expect(readDocumentMaturity(markdown).ok).toBe(false);
  });

  test("a bullet whose text merely holds backticks later is not a fence", () => {
    expect(maturityOf("- run ``` here\nMaturité du document : décision")).toBe("décision");
    expect(maturityOf("-```\nMaturité du document : décision")).toBe("décision");
  });

  test("a fence after a marker inside a fence or a comment is content, not refused", () => {
    expect(
      maturityOf([THREE, `- ${THREE}`, THREE, "Maturité du document : décision"].join("\n")),
    ).toBe("décision");
    expect(
      maturityOf(["<!--", `> ${THREE}`, "-->", "Maturité du document : décision"].join("\n")),
    ).toBe("décision");
  });

  const COMMENT_NOT_AT_START: string = '"<!--" that does not start the line';

  test.each([
    ["a code span", "Use `<!--` to hide a line."],
    ["a block indented by four spaces", "    <!--"],
    ["a tab before it", "\t<!--"],
    ["prose before it", "Maturité du document : <!-- x --> décision"],
    ["a quote", "> <!--"],
    ["a second comment after a closed one", "<!-- a --> b <!-- c -->"],
  ])("(C1 b) %s opening a comment is refused", (_label: string, line: string) => {
    const markdown: string = [
      "# PRD",
      line,
      "Maturité du document : proposition",
      "and `-->` ends it.",
    ].join("\n");
    expectRefused(markdown, 2, COMMENT_NOT_AT_START);
  });

  test("(C1 b) the attack of the review: a code span hid the real line", () => {
    const markdown: string = [
      "Use `<!--` to open a comment.",
      "Maturité du document : proposition",
      "and `-->` to end it.",
      "Maturité du document : décision",
    ].join("\n");
    expect(readDocumentMaturity(markdown).ok).toBe(false);
  });

  test("a comment opener after at most three spaces is read as before", () => {
    expect(maturityOf("   <!-- x -->\nMaturité du document : décision")).toBe("décision");
  });

  test("a comment opener inside an open comment opens nothing more and is not refused", () => {
    expect(maturityOf("<!-- a\nquote `<!--` here\n-->\nMaturité du document : décision")).toBe(
      "décision",
    );
  });

  test.each([
    "<!-->",
    "<!--->",
    "  <!--> trailing",
    "<!--->-->",
  ])("(C1 c) the complete comment %p is refused", (opener: string) => {
    const markdown: string = [
      opener,
      "Maturité du document : proposition",
      "-->",
      "Maturité du document : décision",
    ].join("\n");
    expectRefused(markdown, 1, "complete empty comment");
  });

  test.each([
    ["U+2028", String.fromCodePoint(0x2028)],
    ["U+2029", String.fromCodePoint(0x2029)],
    ["U+0085", String.fromCodePoint(0x0085)],
  ])("(Important) a document holding %s is refused with its line", (code: string, char: string) => {
    const markdown: string = [
      "Maturité du document : proposition",
      `The reader reads${char}Maturité du document : décision`,
    ].join("\r\n");
    expectRefused(markdown, 2, code);
  });

  test("(Important) a line separator after the real line no longer forges the level", () => {
    const separator: string = String.fromCodePoint(0x2028);
    expect(
      readDocumentMaturity(`Prose that reads${separator}Maturité du document : décision`).ok,
    ).toBe(false);
  });

  test("a no-break space is still accepted", () => {
    const nbsp: string = String.fromCodePoint(0x00a0);
    expect(maturityOf(`${nbsp}${THREE}\nMaturité du document : décision\n${nbsp}${THREE}`)).toBe(
      "décision",
    );
  });

  test("(C1 bis) two work-package table headers are refused, naming both lines", () => {
    const markdown: string = [
      "# PRD",
      "",
      "    | WP | CA-n | Périmètre | Vérification | Porte |",
      "    | --- | --- | --- | --- | --- |",
      "    | `WP-1` | `CA-1` | `**` | `true` | `two-way` |",
      "",
      REAL_TABLE,
    ].join("\n");
    const result: Parsed<readonly WorkPackage[]> = parseWorkPackages(markdown);
    expect(result).toEqual({
      ok: false,
      reason:
        "work-package table header at lines 3 and 7: a PRD holds exactly one work-package table",
    });
  });

  test("(C1 bis) the same header twice, even with an identical table, is refused", () => {
    const result: Parsed<readonly WorkPackage[]> = parseWorkPackages(
      [REAL_TABLE, "", REAL_TABLE].join("\n"),
    );
    expect(result.ok).toBe(false);
  });

  test("(C1 bis) a header quoted in a fence is not a second header", () => {
    const markdown: string = [THREE, REAL_TABLE, THREE, "", REAL_TABLE].join("\n");
    const result: Parsed<readonly WorkPackage[]> = parseWorkPackages(markdown);
    expect(result.ok).toBe(true);
  });

  test("the reader stays linear: 200 000 mixed lines in under a second", () => {
    const block: readonly string[] = [
      "<!-- a",
      "b -->",
      THREE,
      "x",
      THREE,
      "- CA-1 a. Validation : b",
      "text `code` more",
      "~~~~",
      "~~~~",
      "Maturité du document : décision",
    ];
    const lines: string[] = [];
    for (let index = 0; index < 20_000; index += 1) lines.push(...block);
    const markdown: string = lines.join("\n");
    const started: number = performance.now();
    const read: Parsed<string> = blankFencesAndComments(markdown);
    const elapsed: number = performance.now() - started;
    expect(read.ok).toBe(true);
    expect(lines.length).toBe(200_000);
    expect(elapsed).toBeLessThan(1000);
  });
});

// The attacks of the earlier reviews that the reader already resisted: they
// must stay green after the refusals above.
describe("attacks that stay read correctly", () => {
  const THREE: string = "```";
  test("a closer followed by a tab closes", () => {
    expect(
      maturityOf(
        `${THREE}\nMaturité du document : décision\n${THREE}\t\nMaturité du document : proposition`,
      ),
    ).toBe("proposition");
  });
  test("a longer closing run closes", () => {
    expect(
      maturityOf(
        `${THREE}\nMaturité du document : décision\n\`\`\`\`\`\nMaturité du document : proposition`,
      ),
    ).toBe("proposition");
  });
  test("a lone --> opens nothing and hides nothing", () => {
    expect(maturityOf("-->\nMaturité du document : décision")).toBe("décision");
  });
  test("mixed CRLF, CR and LF keep the line numbers", () => {
    const mixed: string = `# Cahier\r\n${THREE}\r- CA-9 x\n${THREE}\r\n- CA-1 Real. Validation : a`;
    expect(parseCriteria(mixed)).toEqual({
      ok: true,
      value: [{ id: "CA-1", line: 5, hasValidation: true }],
    });
  });
  test("a refusal names the line of the original text under CRLF and CR", () => {
    const result: Parsed<string> = blankFencesAndComments("a\r\nb\rc\n- ```");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("line 4");
  });
});

describe("atLeast", () => {
  test("compares along the ladder", () => {
    expect(atLeast("prototype", "décision")).toBe(true);
    expect(atLeast("proposition", "décision")).toBe(false);
    expect(atLeast("décision", "décision")).toBe(true);
  });

  // A floor read from YAML/JSON and cast must never pass every document.
  test("a level absent from the ladder is false, never true", () => {
    const unknown = "not-a-level" as MaturityLevel;
    expect(atLeast(unknown, "décision")).toBe(false);
    expect(atLeast("décision", unknown)).toBe(false);
    expect(atLeast(unknown, unknown)).toBe(false);
  });

  test("the ladder keeps the brief order", () => {
    expect(MATURITY_LADDER).toEqual([
      "exploration",
      "hypothèse",
      "proposition",
      "décision",
      "prototype",
      "mise en service",
      "industrialisation",
      "standardisation",
    ]);
  });
});

// The norm is read by people and by the gate; its examples are the only place
// where the two could drift apart. These tests feed the examples of the norm
// to the parsers, so that a sentence of the norm cannot contradict them.
const NORM_PATH: string = join(import.meta.dir, "../../docs/specifications/WORK-PACKAGES.md");

async function readNorm(): Promise<string> {
  return Bun.file(NORM_PATH).text();
}

// The text INSIDE the one fenced block `markdown <label>`: the parsers ignore
// fenced blocks, so an example must be handed to them without its fence.
function exampleOf(norm: string, label: string, language: string = "markdown"): string {
  const pattern = new RegExp(`^\`\`\`${language} ${label}\\n([\\s\\S]*?)\\n\`\`\`$`, "gm");
  const blocks: RegExpMatchArray[] = [...norm.matchAll(pattern)];
  if (blocks.length !== 1) {
    throw new Error(`expected exactly one "${label}" block in the norm, found ${blocks.length}`);
  }
  return blocks[0]?.[1] ?? "";
}

describe("the work-package norm", () => {
  test("the norm's example parses", async () => {
    const norm: string = await readNorm();
    const criteria = parseCriteria(exampleOf(norm, "criteria-example"));
    expect(criteria.ok).toBe(true);
    if (!criteria.ok) return;
    expect(criteria.value.map((criterion) => criterion.id)).toEqual(["CA-3", "CA-15", "CA-16"]);
    expect(criteria.value.every((criterion) => criterion.hasValidation)).toBe(true);

    const packages = parseWorkPackages(exampleOf(norm, "work-package-table-example"));
    expect(packages.ok).toBe(true);
    if (!packages.ok) return;
    expect(packages.value).toHaveLength(2);
    expect(packages.value[0]).toEqual({
      id: "WP-1",
      criteria: ["CA-3", "CA-15"],
      scope: ["crates/work-supervision-daemon/**"],
      verify: "cargo test -p work-supervision-daemon --locked",
      door: "two-way",
    });
    expect(packages.value[1]?.door).toBe("one-way");

    // Every criterion a work package cites is declared by the criteria example.
    const declared = new Set(criteria.value.map((criterion) => criterion.id));
    for (const workPackage of packages.value) {
      for (const cited of workPackage.criteria) expect(declared.has(cited)).toBe(true);
    }
  });

  test("the maturity example reads as the level it shows", async () => {
    const norm: string = await readNorm();
    expect(maturityOf(exampleOf(norm, "maturity-example"))).toBe("décision");
  });

  // Pins the header sentence of the norm: the WP cell is exact, the four others
  // only have to begin with their word.
  test("the WP header cell must be exactly WP, the other four only begin with their word", () => {
    const row: string = "| `WP-1` | `CA-3` | `a/**` | `bun test` | `two-way` |";
    const withHeader = (first: string, last: string): string =>
      [
        `| ${first} | CA-n couverts | Périmètre (chemins, globs) | Vérification (commande) | ${last} |`,
        TABLE_RULE,
        row,
      ].join("\n");
    expect(parseWorkPackages(withHeader("WP (id)", "Porte anticipée")).ok).toBe(false);
    expect(parseWorkPackages(withHeader("WP", "Porte anticipée")).ok).toBe(true);
    expect(parseWorkPackages(withHeader("WP", "Porte")).ok).toBe(true);
    expect(parseWorkPackages(withHeader("WP", "Porte anticipée (voir note)")).ok).toBe(true);
  });

  test("the norm refuses a work package citing a criterion without Validation", async () => {
    const text: string = await readNorm();
    expect(text).toContain(
      "A work package MUST NOT cite a criterion that has no `Validation :` clause; the gate refuses it.",
    );
    expect(text).not.toContain("the gate decides what to do with it");
    expect(text).toContain("Each of the other four cells only has to begin with its word");
  });

  // No parser of the trailer exists in prd-model.ts: the gate reads trailers
  // through git. These two constants are the value grammar the norm states,
  // declared here only so that the norm's example cannot drift from it. A gate
  // that implements the grammar must accept and refuse exactly the same values.
  const WORK_PACKAGE_TRAILER: RegExp =
    /^Work-package: ([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/((?!\.{1,2}#)[A-Za-z0-9._-]{1,100})#([1-9][0-9]*) (WP-[1-9][0-9]{0,8})$/;
  const EXEMPT_TRAILER: RegExp = /^Exempt: ([a-z][a-z0-9-]*)$/;

  test("the trailer example holds two commits that declare one distinct value", async () => {
    const norm: string = await readNorm();
    const example: string = exampleOf(norm, "trailer-example", "text");
    const declarations: string[] = example
      .split("\n")
      .filter((line) => line.startsWith("Work-package:") || line.startsWith("Exempt:"));
    expect(declarations).toHaveLength(2);
    for (const declaration of declarations) {
      expect(WORK_PACKAGE_TRAILER.test(declaration) || EXEMPT_TRAILER.test(declaration)).toBe(true);
    }
    expect(new Set(declarations).size).toBe(1);
    expect(WORK_PACKAGE_TRAILER.exec(declarations[0] ?? "")?.slice(1)).toEqual([
      "libre-ai",
      "ai-work-supervision",
      "12",
      "WP-1",
    ]);
    // Two commit messages of the shape "subject, blank line, trailer block",
    // separated by one more blank line: four paragraphs, trailers in the 2nd and 4th.
    const paragraphs: string[] = example.split("\n\n");
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[1]?.startsWith("Work-package: ")).toBe(true);
    expect(paragraphs[3]?.startsWith("Work-package: ")).toBe(true);
  });

  test("the trailer grammar refuses what the norm says it refuses", () => {
    const accepted: string[] = [
      "Work-package: libre-ai/ai-work-supervision#12 WP-1",
      "Work-package: a/b.c_d-e#1 WP-30",
    ];
    const refused: string[] = [
      "Work-package: libre-ai/ai-work-supervision#012 WP-1",
      "Work-package: libre-ai/ai-work-supervision#12 WP-01",
      "Work-package: libre-ai/ai-work-supervision#12 WP-0",
      "Work-package: libre-ai/ai-work-supervision#12 WP-1234567890",
      "Work-package:  libre-ai/ai-work-supervision#12 WP-1",
      "Work-package: libre-ai/ai-work-supervision#12  WP-1",
      "Work-package: libre-ai/ai-work-supervision#12 WP-1 ",
      "Work-package: libre-ai/../x#12 WP-1",
      "Work-package: <owner>/<repo>#<n> WP-<k>",
    ];
    for (const value of accepted) expect(WORK_PACKAGE_TRAILER.test(value)).toBe(true);
    for (const value of refused) expect(WORK_PACKAGE_TRAILER.test(value)).toBe(false);
    expect(EXEMPT_TRAILER.test("Exempt: docs-only")).toBe(true);
    expect(EXEMPT_TRAILER.test("Exempt: Docs")).toBe(false);
    expect(EXEMPT_TRAILER.test("Exempt: <class>")).toBe(false);
  });

  test("the norm states the trailer rules, and no longer reads the description", async () => {
    const text: string = await readNorm();
    for (const sentence of [
      "git commit --trailer",
      "exactly one distinct value",
      "is not a declaration",
      "The description of the pull request plays no role in the declaration.",
      "is exempt implicitly",
      "It is not an authorization.",
      "are therefore the same for the agent and for the owner.",
    ]) {
      expect(text).toContain(sentence);
    }
    expect(text).not.toContain("## Pull-request line");
    expect(text).not.toContain("carries exactly one declaration line");
  });

  // The opening paragraph lists the labelled examples a test reads: the list
  // must be exactly the set of labelled fenced blocks of the norm.
  test("the opening paragraph names exactly the labelled examples of the norm", async () => {
    const text: string = await readNorm();
    const labelled: string[] = [...text.matchAll(/^```[a-z]+ ([a-z-]+-example)$/gm)].map(
      (match: RegExpMatchArray): string => match[1] as string,
    );
    const opening: string =
      text.split("\n").find((line: string): boolean => line.startsWith("The grammars below")) ?? "";
    const named: string[] = [...opening.matchAll(/`([a-z-]+-example)`/g)].map(
      (match: RegExpMatchArray): string => match[1] as string,
    );
    expect(labelled.length).toBe(5);
    expect([...named].sort()).toEqual([...labelled].sort());
    expect(opening).toContain("The five labelled examples below are read by tests");
  });

  test("the norm states the limits of the grammar, the exemption and the reading", async () => {
    const text: string = await readNorm();
    for (const sentence of [
      "a positive decimal integer of at most nine digits and no leading zero",
      "Only these three exact forms are detected and flagged; an equivalent entry (for example `**/**`) is not.",
      "The implicit exemption is decided by the author of the pull request, not by the author of each commit: a human who pushes to a bot's pull request keeps it (the limit of a shared identity).",
      "The parsers read each file as lines of text; how the Markdown renders does not matter",
      "a refusal that names them (at most twenty pairs, the rest counted as `and M more`)",
      "The globs of a `paths` predicate obey the grammar of a `Périmètre` entry",
      "It closes only on a line of zero to three spaces followed by a run of the same character at least as long as the opening run, and nothing after it but spaces or tabs",
      "A line indented by four or more spaces is not a fence, and its content counts.",
      "reads the diff once, under the same rule: every path is validated, a guarded path is refused with the same message, and an empty or unreadable diff is a refusal.",
    ]) {
      expect(text).toContain(sentence);
    }
    expect(text).not.toContain("The three labelled examples");
  });

  // Wave G (G3, G4): the norm says what the gate prints and what the suite
  // holds, and names two limits of the control it had left unwritten.
  test("the norm states only what the gate prints, and the limits of the cited commit and of the push", async () => {
    const text: string = await readNorm();
    for (const sentence of [
      "The gate judges one pull request per run and prints the volume it examined on one line",
      "the suite holds no mutant of the gate.",
      "Each following line whose first character, after leading spaces and tabs, is `|` is a row",
      "a backtick written in it is lost, not refused.",
      "coexists with the `WP-<k>` grammar and does not concern it.",
      "The work package is judged at the commit the issue cites, not at the latest PRD.",
      "runs on `opened`, `synchronize` and `reopened`. An edit of the issue, or a change of its labels, after a green verdict is seen only at the next run.",
    ]) {
      expect(text).toContain(sentence);
    }
    for (const stale of [
      "how many pull requests it examined",
      "failing against a mutant of the gate",
      "Each following line that starts with `|` is a row.",
      "or a backtick (backticks are stripped)",
      "The `Door:` line is the only declaration still read from the description",
    ]) {
      expect(text).not.toContain(stale);
    }
  });

  // Wave H (C1, C1 bis, Important): the norm lists what the reader refuses and
  // the one-header rule, and no longer says that the first table wins.
  test("the norm states the refused constructions and the one-header rule", async () => {
    const text: string = await readNorm();
    for (const sentence of [
      "A construction the parsers do not model is refused, never read:",
      "a run of three or more backticks or tildes right after a list marker (`-`, `*`, `+`, `1.`, `1)`) or a quote marker (`>`)",
      "a `<!--` anywhere but at the start of a line after at most three spaces (in a code span, an indented block, a quote or after text)",
      "the complete empty comments `<!-->` and `<!--->`",
      "the characters U+0085, U+2028 and U+2029, anywhere in the file",
      "Outside fences, `<!--` opens a comment only at the start of a line, after at most three spaces",
      "More than one line that reads as this header, outside fences and comments, makes the document unreadable, naming the lines: the parser never picks one of them.",
    ]) {
      expect(text).toContain(sentence);
    }
    for (const stale of [
      "Only the first table with this header is read.",
      "`<!--` opens a comment anywhere in a line",
    ]) {
      expect(text).not.toContain(stale);
    }
  });

  test("the norm covers the seven required subjects under stable headings", async () => {
    const text: string = await readNorm();
    const lines: string[] = text.split("\n");
    const headings: string[] = [
      "## Location of the documents",
      "## Criteria grammar",
      "## Work-package table",
      "## Document maturity",
      "## Commit trailer",
      "## Issue body",
      "## Limit of the control",
    ];
    for (const heading of headings) {
      expect(lines).toContain(heading);
    }
    // The ladder in the prose is the one the parser enforces, in the same order.
    const expectedLadder = `Ladder: ${MATURITY_LADDER.map((level) => `\`${level}\``).join(", ")}.`;
    expect(lines.filter((line) => line.startsWith("Ladder: "))).toEqual([expectedLadder]);
  });
});
