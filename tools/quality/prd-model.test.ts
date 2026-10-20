import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  atLeast,
  detectionForm,
  MATURITY_LADDER,
  type MaturityLevel,
  type Parsed,
  parseCriteria,
  parseWorkPackages,
  readDocumentMaturity,
  readRawLines,
  type WorkPackage,
} from "./prd-model";

const TABLE_HEADER =
  "| WP | CA-n couverts | Périmètre (chemins, globs) | Vérification (commande) | Porte anticipée |";
const TABLE_RULE = "| --- | --- | --- | --- | --- |";
const THREE: string = "```";

function table(...rows: string[]): string {
  return [TABLE_HEADER, TABLE_RULE, ...rows].join("\n");
}

// The level a readable document declares; a refusal here is a test failure.
function maturityOf(markdown: string): MaturityLevel | null {
  const read: Parsed<MaturityLevel | null> = readDocumentMaturity(markdown);
  if (!read.ok) throw new Error(`unexpected refusal: ${read.reason}`);
  return read.value;
}

// The reason of a refusal; a readable result here is a test failure.
function refusalOf(result: Parsed<unknown>): string {
  if (result.ok) throw new Error(`expected a refusal, read ${JSON.stringify(result.value)}`);
  return result.reason;
}

const char = (codePoint: number): string => String.fromCodePoint(codePoint);

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

  // Wave H3: the raw text is the authority. A criterion quoted in a fence or
  // a comment is a criterion, as the reviewer of the raw diff reads it.
  test("a CA-n definition inside a fence or a comment is read as live", () => {
    const markdown: string = [
      "- CA-1 Real. Validation : a",
      THREE,
      "- CA-2 In a fence. Validation : b",
      THREE,
      "<!--",
      "- CA-3 In a comment. Validation : c",
      "-->",
    ].join("\n");
    expect(parseCriteria(markdown)).toEqual({
      ok: true,
      value: [
        { id: "CA-1", line: 1, hasValidation: true },
        { id: "CA-2", line: 3, hasValidation: true },
        { id: "CA-3", line: 6, hasValidation: true },
      ],
    });
  });

  test("a document without any criterion is ok:true with zero entries, never an error", () => {
    expect(parseCriteria("# Nothing here\n")).toEqual({ ok: true, value: [] });
  });
});

// Wave H3, rule (3): every raw line that starts, after indentation, list,
// quote or heading markers and emphasis, with `CA-<n>` and a separator is a
// strict criterion bullet, or the document is refused.
describe("criteria: every definition form is strict or refused", () => {
  test.each([
    [
      "C1 an indented example",
      ["- CA-1 real. Validation : a", "", "    - CA-9 example. Validation : x"],
      3,
    ],
    ["a tab before the bullet", ["\t- CA-9 x. Validation : y"], 1],
    ["an ordered item", ["1. CA-9 x. Validation : y"], 1],
    ["a quote", ["> - CA-9 x. Validation : y"], 1],
    ["no bullet", ["CA-9 x. Validation : y"], 1],
    ["a heading", ["### CA-9 x"], 1],
    ["underscore emphasis", ["- __CA-9__ x. Validation : y"], 1],
    ["an entity hyphen", ["- CA&#45;9 x. Validation : y"], 1],
    ["fullwidth letters", [`- ${char(0xff23)}${char(0xff21)}-9 x. Validation : y`], 1],
    ["lower case", ["- ca-9 x. Validation : y"], 1],
  ])("(H3-3) %s is refused with its line", (_label: string, lines: string[], at: number) => {
    expect(refusalOf(parseCriteria(lines.join("\n")))).toBe(
      `line ${at}: a CA-<n> definition that is not a strict criterion bullet ("- CA-<n> …", at most three spaces of indentation) is not read`,
    );
  });

  test("C3 a criterion inside a processing instruction is read as live", () => {
    expect(parseCriteria(["<?x", "- CA-9 phantom. Validation : x", "?>"].join("\n"))).toEqual({
      ok: true,
      value: [{ id: "CA-9", line: 2, hasValidation: true }],
    });
  });

  test("a CA-n in the middle of a line, or in the cells of a table row, is not a definition", () => {
    const markdown: string = [
      "See CA-3 for the rule.",
      "| CA-3 | covered by WP-1 |",
      "  | CA-4 | x |",
      "- WP-1 covers CA-3.",
      "- CA-1 Real. Validation : a",
    ].join("\n");
    expect(parseCriteria(markdown)).toEqual({
      ok: true,
      value: [{ id: "CA-1", line: 5, hasValidation: true }],
    });
  });

  test("bold markers and three spaces of indentation are strict", () => {
    expect(
      parseCriteria("   - **CA-3** Bold. Validation : a\n* CA-4 Star. Validation : b"),
    ).toEqual({
      ok: true,
      value: [
        { id: "CA-3", line: 1, hasValidation: true },
        { id: "CA-4", line: 2, hasValidation: true },
      ],
    });
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

  // Wave H3: a table quoted in a fence is THE table: the raw text is read.
  test("a table inside a fenced block is read as live", () => {
    const fenced = [
      THREE,
      table("| `WP-1` | `CA-3` | `a/**` | `bun test` | `two-way` |"),
      THREE,
    ].join("\n");
    expect(parseWorkPackages(fenced).ok).toBe(true);
  });
});

// Wave H3, rule (2): one strict header, every header-like line is that header,
// and every `WP-<n>` row with a pipe belongs to its block.
describe("work-package table: one strict header, rows in its block", () => {
  const ROW: string = "| `WP-1` | `CA-1` | `a/**` | `bun test` | `one-way` |";
  const EXAMPLE: readonly string[] = [
    "| WP | CA-n | Périmètre | Vérification | Porte |",
    "| --- | --- | --- | --- | --- |",
    "| `WP-1` | `CA-1` | `**` | `true` | `two-way` |",
  ];
  const HEADER_LIKE = (line: number): string =>
    `line ${line}: a work-package table header that is not the exact header (\`| WP | CA-n | Périmètre | Vérification | Porte |\`, plain cells) is not read`;

  test("T1 a header without leading pipe after a quoted example is refused", () => {
    const markdown: string = [
      "<pre>",
      ...EXAMPLE,
      "</pre>",
      "",
      "WP | CA-n | Périmètre | Vérification | Porte",
      "--- | --- | --- | --- | ---",
      "WP-1 | CA-1 | a/** | bun test | one-way",
    ].join("\n");
    expect(refusalOf(parseWorkPackages(markdown))).toBe(HEADER_LIKE(7));
  });

  test("T2 a bold header is refused", () => {
    const markdown: string = [
      "| **WP** | **CA-n** | **Périmètre** | **Vérification** | **Porte** |",
      TABLE_RULE,
      "| WP-1 | CA-1 | a/** | bun test | one-way |",
    ].join("\n");
    expect(refusalOf(parseWorkPackages(markdown))).toBe(HEADER_LIKE(1));
  });

  test("T3 two strict headers are refused naming both lines, wherever they stand", () => {
    const markdown: string = [
      "- note",
      "  ```",
      TABLE_HEADER,
      TABLE_RULE,
      ROW,
      "",
      THREE,
      ...EXAMPLE,
      THREE,
    ].join("\n");
    expect(refusalOf(parseWorkPackages(markdown))).toBe(
      "work-package table header at lines 3 and 8: a PRD holds exactly one work-package table",
    );
  });

  test("T4 a WP row outside the block of the table is refused", () => {
    const markdown: string = [
      TABLE_HEADER,
      TABLE_RULE,
      ROW,
      "WP-2 | CA-2 | b/** | false | two-way",
    ].join("\n");
    expect(refusalOf(parseWorkPackages(markdown))).toBe(
      "line 4: a WP-<n> row outside the block of the work-package table is not read",
    );
  });

  test("a WP row after a blank line that ends the table is refused", () => {
    const markdown: string = [
      TABLE_HEADER,
      TABLE_RULE,
      ROW,
      "",
      "| `WP-2` | `CA-2` | `b/**` | `x` | `two-way` |",
    ].join("\n");
    expect(refusalOf(parseWorkPackages(markdown))).toBe(
      "line 5: a WP-<n> row outside the block of the work-package table is not read",
    );
  });

  test("T5 a separator row whose cell count differs from the header is refused", () => {
    expect(refusalOf(parseWorkPackages([TABLE_HEADER, "|---|", ROW].join("\n")))).toBe(
      "work-package table at line 1 has no separator row of 5 cells",
    );
  });

  test("T6 the minimal GFM separator is read", () => {
    const result: Parsed<readonly WorkPackage[]> = parseWorkPackages(
      [TABLE_HEADER, "|-|-|-|-|-|", ROW].join("\n"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((row: WorkPackage): string => row.id)).toEqual(["WP-1"]);
  });

  test("T7 a table indented in a list item is read", () => {
    const markdown: string = [
      "1. Lot",
      "",
      `    ${TABLE_HEADER}`,
      `    ${TABLE_RULE}`,
      `    ${ROW}`,
    ].join("\n");
    const result: Parsed<readonly WorkPackage[]> = parseWorkPackages(markdown);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((row: WorkPackage): string => row.id)).toEqual(["WP-1"]);
  });

  test("T9 a table quoted in a comment is a second header", () => {
    const markdown: string = ["<!--", ...EXAMPLE, "-->", TABLE_HEADER, TABLE_RULE, ROW].join("\n");
    expect(refusalOf(parseWorkPackages(markdown))).toBe(
      "work-package table header at lines 2 and 6: a PRD holds exactly one work-package table",
    );
  });

  test("a header written with an entity pipe is header-like, hence refused", () => {
    const markdown: string = [
      "WP &#124; CA-n &#124; Périmètre &#124; Vérification &#124; Porte",
      TABLE_HEADER,
      TABLE_RULE,
      ROW,
    ].join("\n");
    expect(refusalOf(parseWorkPackages(markdown))).toBe(HEADER_LIKE(1));
  });

  test("a legitimate PRD with fences and comments that hold no declaration form is read", () => {
    const markdown: string = [
      "# PRD",
      "<!-- note -->",
      "~~~",
      "x",
      "~~~",
      `${THREE}ts`,
      "y",
      THREE,
      TABLE_HEADER,
      TABLE_RULE,
      ROW,
    ].join("\r\n");
    expect(parseWorkPackages(markdown).ok).toBe(true);
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

  test("two strict lines of the same level give that level", () => {
    expect(maturityOf("Maturité du document : décision\n\n- Maturité du document : décision")).toBe(
      "décision",
    );
  });

  // Wave H3: a declaration quoted in a fence or a comment is a declaration.
  test("a declaration inside a fenced block or an HTML comment is read as live", () => {
    expect(maturityOf(`${THREE}\nMaturité du document : décision\n${THREE}\n`)).toBe("décision");
    expect(maturityOf("<!--\nMaturité du document : décision\n-->\n")).toBe("décision");
  });

  test("case is ignored on a strict line", () => {
    expect(maturityOf("MATURITÉ DU DOCUMENT : décision")).toBe("décision");
  });
});

// Wave H3, rule (1): every line that mentions "maturité du document", once
// normalised, is exactly one strict declaration line, or the document is
// refused. The review cases M1-M17 of f11a129 read `décision` where a human
// reads `proposition`; each now gives a refusal or no level, never décision.
describe("maturity: every mention is a strict declaration", () => {
  const MENTION = (line: number): string =>
    `line ${line}: "Maturité du document" outside a strict declaration line (\`Maturité du document : <level>\`, at most three spaces of indentation, an optional bullet and bold) is not read`;
  const T: string = THREE;
  const cases: readonly (readonly [string, readonly string[], number | null])[] = [
    [
      "M1 list-item fence closed by dedent",
      [
        "- note",
        `  ${T}`,
        "Maturité du document : proposition",
        "",
        T,
        "Maturité du document : décision",
        T,
      ],
      null,
    ],
    [
      "M2 list-item fence closed by sibling item",
      [
        "- note",
        `  ${T}`,
        "- Maturité du document : proposition",
        "",
        T,
        "Maturité du document : décision",
        T,
      ],
      null,
    ],
    [
      "M3 fence line inside an HTML block",
      [
        "<div>",
        T,
        "</div>",
        "",
        "Maturité du document : proposition",
        "",
        T,
        "Maturité du document : décision",
        T,
      ],
      null,
    ],
    [
      "M4 details block",
      [
        "<details><summary>x</summary>",
        T,
        "</details>",
        "",
        "Maturité du document : proposition",
        "",
        T,
        "Maturité du document : décision",
        T,
      ],
      null,
    ],
    [
      "M5 bold label",
      [
        "**Maturité du document** : proposition",
        "",
        "<?x",
        "Maturité du document : décision",
        "?>",
      ],
      1,
    ],
    [
      "M6 indented example",
      ["Maturité du document : proposition", "", "    Maturité du document : décision"],
      3,
    ],
    [
      "M7 escaped colon",
      ["Maturité du document \\: proposition", "", "Maturité du document : décision"],
      1,
    ],
    [
      "M8 entity in the label",
      ["Maturit&eacute; du document : proposition", "", "Maturité du document : décision"],
      1,
    ],
    [
      "M9 decomposed accent",
      [`Maturite${char(0x0301)} du document : proposition`, "", "Maturité du document : décision"],
      1,
    ],
    [
      "M10 heading",
      ["## Maturité du document : proposition", "", "Maturité du document : décision"],
      1,
    ],
    [
      "M11 link definition title",
      [
        "Maturité du document : proposition",
        "",
        "[a]: /u '",
        "Maturité du document : décision",
        "'",
      ],
      null,
    ],
    [
      "M12 script block",
      [
        "Maturité du document : proposition",
        "",
        '<script type="text/plain">',
        "Maturité du document : décision",
        "</script>",
      ],
      null,
    ],
    [
      "M13 CDATA",
      [
        "Maturité du document : proposition",
        "",
        "<![CDATA[",
        "Maturité du document : décision",
        "]]>",
      ],
      null,
    ],
    [
      "M14 declaration block",
      ["Maturité du document : proposition", "", "<!X", "Maturité du document : décision", ">"],
      null,
    ],
    [
      "M15 --!> comment end",
      [
        "<!-- a --!>",
        "Maturité du document : proposition",
        "-->",
        "",
        T,
        "Maturité du document : décision",
        T,
      ],
      null,
    ],
    [
      "M16 nested list fence indented by five",
      ["- a", "   - b", "", `     ${T}`, "     Maturité du document : décision", `     ${T}`],
      5,
    ],
    [
      "M17 tab-indented fence in a list item",
      ["- a", "", `\t${T}`, "\tMaturité du document : décision", `\t${T}`],
      4,
    ],
  ];

  test.each(cases)("%s never reads décision", (_label: string, lines: readonly string[], refusedAt:
    | number
    | null) => {
    const result: Parsed<MaturityLevel | null> = readDocumentMaturity(lines.join("\n"));
    if (refusedAt === null) {
      expect(result).toEqual({ ok: true, value: null });
    } else {
      expect(result).toEqual({ ok: false, reason: MENTION(refusedAt) });
    }
  });

  test.each([
    ["an entity", "Maturit&eacute; du document : décision"],
    ["a decimal entity", "Maturit&#233; du document : décision"],
    ["a hex entity", "Maturit&#xE9; du document : décision"],
    ["an unknown entity inside", "Matu&zwnj;rité du document : décision"],
    ["a no-break space entity", "Maturité&nbsp;du document : décision"],
    ["emphasis inside the words", "Matu**rité** du document : décision"],
    ["underscore emphasis", "_Maturité du document_ : décision"],
    ["a code span", "`Maturité du document` : décision"],
    ["a backslash", "Maturit\\é du document : décision"],
    ["a zero-width space", `Matu${char(0x200b)}rité du document : décision`],
    ["fullwidth letters", `${char(0xff2d)}aturité du document : décision`],
    // NFKC before decoding: a fullwidth `&` only forms an entity once folded.
    [
      "an entity with a fullwidth ampersand",
      `Maturit${char(0xff06)}eacute; du document : décision`,
    ],
    ["a tag inside", "Maturité <span>du</span> document : décision"],
    ["an indent of four", "    Maturité du document : décision"],
    ["a tab indent", "\tMaturité du document : décision"],
    ["a quote", "> Maturité du document : décision"],
    ["an ordered item", "1. Maturité du document : décision"],
    ["prose", "La maturité du document est une décision."],
    [
      "two mentions on one line",
      "Maturité du document : décision, Maturité du document : proposition",
    ],
  ])("(H3-1) %s is refused with its line", (_label: string, line: string) => {
    expect(readDocumentMaturity(`# PRD\n${line}`)).toEqual({ ok: false, reason: MENTION(2) });
  });
});

describe("raw lines", () => {
  test("CRLF, a lone CR and LF each end one line, and the numbers follow the original", () => {
    expect(readRawLines("a\r\nb\rc\nd")).toEqual({ ok: true, value: ["a", "b", "c", "d"] });
    const mixed: string = "# Cahier\r\nx\ry\n- CA-1 Real. Validation : a";
    expect(parseCriteria(mixed)).toEqual({
      ok: true,
      value: [{ id: "CA-1", line: 4, hasValidation: true }],
    });
    expect(refusalOf(readDocumentMaturity("a\r\nb\rc\n## Maturité du document : x"))).toContain(
      "line 4:",
    );
  });

  test.each([
    ["U+2028", 0x2028],
    ["U+2029", 0x2029],
    ["U+0085", 0x0085],
    ["U+0000", 0x0000],
    ["U+000B", 0x000b],
    ["U+001F", 0x001f],
  ])("a document holding %s is refused with its line, by every parser", (code: string, point: number) => {
    const markdown: string = [
      "Maturité du document : proposition",
      `The reader reads${char(point)}Maturité du document : décision`,
    ].join("\r\n");
    const expected: string = `line 2: the character ${code} is not read (a line separator or a control character)`;
    for (const result of [
      readRawLines(markdown),
      readDocumentMaturity(markdown),
      parseCriteria(markdown),
      parseWorkPackages(markdown),
    ] as readonly Parsed<unknown>[]) {
      expect(refusalOf(result)).toBe(expected);
    }
  });

  test("a tab and a no-break space are accepted", () => {
    const nbsp: string = char(0x00a0);
    expect(maturityOf(`x\ty${nbsp}z\nMaturité du document : décision`)).toBe("décision");
  });

  test("the detection form folds entities, accents, emphasis, case and spaces", () => {
    expect(detectionForm("  Maturit&eacute;  **du**\t`document` &amp; &#x41;\\_")).toBe(
      " maturite du document & a",
    );
    expect(detectionForm(`E${char(0x0301)}${char(0x200b)}<b>X</b>`)).toBe("ex");
  });

  test("the reader stays linear: 200 000 mixed lines in under a second", () => {
    const block: readonly string[] = [
      "<!-- a",
      "b -->",
      THREE,
      "x",
      THREE,
      "- CA-1 a. Validation : b",
      "text `code` more with é and &amp;",
      "| a | b |",
      "~~~~",
      "Maturité : prototype",
    ];
    const lines: string[] = [];
    for (let index = 0; index < 20_000; index += 1) lines.push(...block);
    const markdown: string = lines.join("\n");
    const started: number = performance.now();
    const maturity: Parsed<MaturityLevel | null> = readDocumentMaturity(markdown);
    const tableRead: Parsed<readonly WorkPackage[]> = parseWorkPackages(markdown);
    const elapsed: number = performance.now() - started;
    expect(maturity).toEqual({ ok: true, value: null });
    expect(tableRead.ok).toBe(false);
    expect(lines.length).toBe(200_000);
    expect(elapsed).toBeLessThan(1000);
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

// The text INSIDE the one fenced block `markdown <label>`. The norm is not a
// PRD: it quotes every declaration form, so each example is handed alone.
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

  // The norm quotes every declaration form, so read as a PRD it is refused:
  // that is assumed (it is a norm, not a PRD) and pinned here.
  test("the norm itself, read as a PRD, is refused", async () => {
    const norm: string = await readNorm();
    expect(readDocumentMaturity(norm).ok).toBe(false);
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

  // Wave H3: the norm states the raw invariant and the three rules, and no
  // longer describes a reading that imitates a renderer.
  test("the norm states the raw invariant, and drops every sentence about rendering", async () => {
    const text: string = await readNorm();
    for (const sentence of [
      "Every raw occurrence of a declaration form is either read as live or makes the document unreadable",
      "A PRD therefore never quotes a declaration form, not even in a fence, a comment, an indented block or a `<pre>` block: it paraphrases it.",
      "Every line that mentions `maturité du document`, once normalised, MUST be exactly one strict declaration line",
      "The document holds exactly one strict header; any other line that looks like a header makes it unreadable",
      "Every line that starts, after `|`, spaces and emphasis, with `WP-<n>` and holds a `|` MUST be a row of the block of that table",
      "Every line that starts, after indentation, list, quote or heading markers and emphasis, with `CA-<n>` followed by a separator MUST be a strict criterion bullet",
      "the characters U+0085, U+2028 and U+2029 and the control characters other than the tab",
      "The separator row has as many cells as the header",
      "This norm is not a PRD: it quotes every declaration form in its examples, so read as a PRD it is refused.",
    ]) {
      expect(text).toContain(sentence);
    }
    for (const stale of [
      "never the quoted one",
      "the quoted level is never taken",
      "hidden when rendered",
      "hides that whole line",
      "disagree on where a fence or a comment starts or ends",
      "Fenced code blocks and HTML comments are not read",
      "A line indented by four or more spaces is not a fence",
      "It closes only on a line of zero to three spaces",
      "since a renderer",
      "renders as code",
      "Only the first table with this header is read.",
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
